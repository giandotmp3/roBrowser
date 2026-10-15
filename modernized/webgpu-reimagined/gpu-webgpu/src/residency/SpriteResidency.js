import { IDLE_EVICT_MS, PALETTE_WIDTH, POT_CLASSES } from '../constants.js';
import { DeviceLimitError } from '../errors.js';
import { nextPow2 } from '../math.js';
import { TEXTURED_MESH_FAMILIES } from '../effects/mesh/meshFamilies.js';

/**
 * Effect families whose textures (and 2D/3D palettes) are resident in the pools (as
 * gpu-webgl2): STR, 2D/3D and the textured mesh families (MeshEffectPipeline).
 */
export const RESIDENT_EFFECT_FAMILIES = Object.freeze(['str', '2d', '3d', ...TEXTURED_MESH_FAMILIES]);

/**
 * @typedef {Object} ResidentImage  One sprite frame, ready for a texture-array layer
 * @property {'r8'|'rgba8'} format
 * @property {number} width          ≤ 512 (legacy frames are already POT-padded and centred)
 * @property {number} height
 * @property {ArrayBufferView} data  Tightly packed width×height texels (1 or 4 bytes each)
 */

/**
 * @typedef {Object} FrameSourcePort  Upload-on-miss source (C-16). Synchronous, CPU only.
 *
 * Same contract as gpu-webgl2's `FrameSourcePort` (gpu-webgl2/src/residency/Residency.js).
 * Called the first time a record references a frame or palette handle that is not
 * resident (and again after an eviction or a device loss). The source owns the
 * decoded CPU data (in production: the legacy MemoryManager-held compiled SPR/PAL;
 * `decodeSprFrame` in spriteFrames.js is the legacy-identical decode). Returning
 * `null` means "not available yet": the lookup stays a miss (layer −1, the shader
 * discards it) and is retried on the next lookup. A source must return the same
 * pixels for the same handle for as long as the handle lives; handles are opaque.
 *
 * @property {(handle: unknown) => ResidentImage|null} frame
 * @property {(handle: unknown) => Uint8Array|null} palette  256×4 RGBA (the raw table; #64 is fixed in the shader)
 */

/**
 * @typedef {Object} ResidencyStats
 * @property {number} frameUploads     Frames uploaded (explicit + on miss)
 * @property {number} paletteUploads   Palette rows uploaded (explicit + on miss)
 * @property {number} misses           Lookups the source could not satisfy
 * @property {number} frameEvictions   Layers returned to a free list
 * @property {number} paletteEvictions Palette rows returned to the free list
 */

/**
 * Handle-level sprite residency (architecture §2.2, critic M3), same contract as
 * gpu-webgl2's Residency: one texture_2d_array pool per (format r8/rgba8, POT class
 * 32–512), slots from a free list (nothing packs or fragments), and one 256×N
 * palette table whose rows are also recycled through a free list. A frame occupies
 * the top-left of its layer.
 *
 * Lifetimes:
 * - **Frames** stay resident until `release(handle)`, idle eviction (`evictIdle`,
 *   unused for `idleMs`) or `purgeAll` (device loss). When a pool is full, the least
 *   recently used layer that the current frame has not touched is reclaimed; only if
 *   every layer is in use does it throw.
 * - **Palette rows** are reference counted by their owners (`retainPalette` /
 *   `releasePalette`). A row whose count drops to 0 is freed at once; a row uploaded
 *   on miss without an owner lives until idle eviction or until its row is needed
 *   and the current frame does not use it. Counts survive `purgeAll`.
 * - **Frame boundaries**: `beginFrame()` once per rendered frame (SpriteRunRenderer.encode
 *   does) so reclaiming never takes a slot the frame is drawing. Run `evictIdle`
 *   between frames (scene's R-CTX-010 step 24), never between `prepare` and the draw.
 *
 * GPU calls go through `uploader` (TextureArrayPools) so pools can be faked.
 */
export class SpriteResidency {
	/**
	 * @param {{
	 *   uploader: {allocLayer(pool: string, size: number, layer: number, data: ArrayBufferView, width?: number, height?: number): void, uploadPalette(row: number, rgba: Uint8Array): void, purge?(): void, paletteRows?: number},
	 *   layersPerPool?: number,
	 *   paletteRows?: number,
	 *   now: () => number,
	 *   source?: FrameSourcePort|null,
	 *   idleMs?: number,
	 *   onEvict?: (handle: unknown, kind: 'frame'|'palette') => void
	 * }} deps
	 */
	constructor({ uploader, layersPerPool = 64, paletteRows, now, source = null, idleMs = IDLE_EVICT_MS, onEvict }) {
		this._uploader = uploader;
		this._layersPerPool = layersPerPool;
		this._paletteRows = paletteRows ?? uploader.paletteRows ?? 256;
		this._now = now;
		this._source = source;
		this._idleMs = idleMs;
		this._onEvict = onEvict ?? null;
		/** @type {Map<string, {free: number[], next: number}>} */
		this._pools = new Map();
		/** @type {Map<unknown, {pool: string, layer: number, classIndex: number, width: number, height: number, lastUsed: number, frame: number}>} */
		this._slots = new Map();
		/** @type {Map<unknown, {row: number, lastUsed: number, frame: number}>} */
		this._palettes = new Map();
		/** @type {Map<unknown, number>} owner reference counts (survive purgeAll) */
		this._paletteRefs = new Map();
		/** @type {number[]} */
		this._freePaletteRows = [];
		this._nextPaletteRow = 0;
		this._frame = 0;
		/** @type {ResidencyStats} */
		this.stats = { frameUploads: 0, paletteUploads: 0, misses: 0, frameEvictions: 0, paletteEvictions: 0 };
	}

	/**
	 * @param {'r8'|'rgba8'} format
	 * @param {number} width
	 * @param {number} height
	 */
	static poolFor(format, width, height) {
		const size = nextPow2(Math.max(width, height, POT_CLASSES[0]));
		const max = POT_CLASSES[POT_CLASSES.length - 1];
		if (size > max) {
			throw new DeviceLimitError('spritePotClass', size, max);
		}
		return { pool: `${format}:${size}`, size, classIndex: POT_CLASSES.indexOf(size) };
	}

	/** Start a rendered frame: slots touched from now on are protected from reclaiming. */
	beginFrame() {
		this._frame++;
	}

	/**
	 * Explicit upload (re-uploads in place when the handle keeps its class).
	 * @param {unknown} handle
	 * @param {ResidentImage} image  Tightly packed
	 */
	upload(handle, image) {
		const { pool, size, classIndex } = SpriteResidency.poolFor(image.format, image.width, image.height);
		const previous = this._slots.get(handle);
		if (previous && previous.pool === pool) {
			this._uploader.allocLayer(pool, size, previous.layer, image.data, image.width, image.height);
			Object.assign(previous, { width: image.width, height: image.height, lastUsed: this._now() });
			this.stats.frameUploads++;
			return;
		}
		if (previous) {
			this._freeSlot(handle, previous, false);
		}
		const layer = this._allocLayer(pool);
		this._uploader.allocLayer(pool, size, layer, image.data, image.width, image.height);
		this._slots.set(handle, {
			pool,
			layer,
			classIndex,
			width: image.width,
			height: image.height,
			lastUsed: this._now(),
			frame: this._frame
		});
		this.stats.frameUploads++;
	}

	/** @param {string} pool */
	_allocLayer(pool) {
		let p = this._pools.get(pool);
		if (!p) {
			p = { free: [], next: 0 };
			this._pools.set(pool, p);
		}
		if (p.free.length) {
			return p.free.pop();
		}
		if (p.next < this._layersPerPool) {
			return p.next++;
		}
		// Full: reclaim the least recently used layer the current frame does not draw.
		let victim = null;
		for (const [handle, slot] of this._slots) {
			if (slot.pool === pool && slot.frame !== this._frame && (!victim || slot.lastUsed < victim[1].lastUsed)) {
				victim = [handle, slot];
			}
		}
		if (!victim) {
			throw new DeviceLimitError(`layers:${pool}`, this._layersPerPool + 1, this._layersPerPool);
		}
		this._freeSlot(victim[0], victim[1], true);
		return p.free.pop();
	}

	/**
	 * Explicit palette upload (re-uploads in place when the handle already has a row).
	 * @param {unknown} handle
	 * @param {Uint8Array} rgba  256×4
	 */
	uploadPalette(handle, rgba) {
		if (rgba.length !== PALETTE_WIDTH * 4) {
			throw new RangeError('palette must be 256 RGBA entries');
		}
		let entry = this._palettes.get(handle);
		if (!entry) {
			entry = { row: this._allocPaletteRow(), lastUsed: this._now(), frame: this._frame };
			this._palettes.set(handle, entry);
		}
		this._uploader.uploadPalette(entry.row, rgba);
		this.stats.paletteUploads++;
	}

	_allocPaletteRow() {
		if (this._freePaletteRows.length) {
			return this._freePaletteRows.pop();
		}
		if (this._nextPaletteRow < this._paletteRows) {
			return this._nextPaletteRow++;
		}
		// Full: reclaim the least recently used unowned row the current frame does not use.
		let victim = null;
		for (const [handle, entry] of this._palettes) {
			if (
				!this._paletteRefs.get(handle) &&
				entry.frame !== this._frame &&
				(!victim || entry.lastUsed < victim[1].lastUsed)
			) {
				victim = [handle, entry];
			}
		}
		if (!victim) {
			throw new DeviceLimitError('paletteRows', this._paletteRows + 1, this._paletteRows);
		}
		this._freePalette(victim[0], victim[1]);
		return this._freePaletteRows.pop();
	}

	/**
	 * An owner (e.g. a loaded SPR or PAL asset) holds this palette. Rows are uploaded
	 * on first use; the count only decides when the row may be freed.
	 * @param {unknown} handle
	 */
	retainPalette(handle) {
		this._paletteRefs.set(handle, (this._paletteRefs.get(handle) ?? 0) + 1);
	}

	/**
	 * Drop one owner reference; at 0 the row returns to the free list at once.
	 * @param {unknown} handle
	 */
	releasePalette(handle) {
		const refs = (this._paletteRefs.get(handle) ?? 0) - 1;
		if (refs > 0) {
			this._paletteRefs.set(handle, refs);
			return;
		}
		this._paletteRefs.delete(handle);
		const entry = this._palettes.get(handle);
		if (entry) {
			this._freePalette(handle, entry);
		}
	}

	/** @param {unknown} handle */
	paletteRefCount(handle) {
		return this._paletteRefs.get(handle) ?? 0;
	}

	/**
	 * Make one record's frame and palette resident, uploading through the source on a
	 * miss. Call before the instances are packed (SpriteRunRenderer.encode does).
	 * @param {{texture: unknown, palette?: unknown}} record
	 * @returns {boolean} true when the frame (and its palette, if any) is resident
	 */
	ensure(record) {
		let ok = true;
		if (record.texture !== null && record.texture !== undefined && !this._slots.has(record.texture)) {
			const image = this._source?.frame(record.texture) ?? null;
			if (image) {
				this.upload(record.texture, image);
			} else {
				this.stats.misses++;
				ok = false;
			}
		}
		if (record.palette !== null && record.palette !== undefined && !this._palettes.has(record.palette)) {
			const rgba = this._source?.palette(record.palette) ?? null;
			if (rgba) {
				this.uploadPalette(record.palette, rgba);
			} else {
				this.stats.misses++;
				ok = false;
			}
		}
		return ok;
	}

	/**
	 * Upload-on-miss pre-pass over one ordered record stream: sprite records, and the
	 * effect families whose textures live in the pools (RESIDENT_EFFECT_FAMILIES: STR
	 * images, 2D/3D images and SPR frames; their palette is `params.palette`).
	 * @param {ReadonlyArray<{kind: string, family?: string, texture?: unknown, palette?: unknown, params?: {palette?: unknown}}>} records
	 * @returns {number} uploads issued by this call
	 */
	prepare(records) {
		if (!this._source) {
			return 0;
		}
		const before = this.stats.frameUploads + this.stats.paletteUploads;
		const refs = { texture: null, palette: null };
		for (const record of records) {
			if (record.kind === 'sprite') {
				this.ensure(/** @type {any} */ (record));
			} else if (
				record.kind === 'effect' &&
				RESIDENT_EFFECT_FAMILIES.includes(/** @type {string} */ (record.family))
			) {
				refs.texture = record.texture ?? null;
				refs.palette = record.params?.palette ?? null;
				this.ensure(refs);
			}
		}
		return this.stats.frameUploads + this.stats.paletteUploads - before;
	}

	/**
	 * Instance lookup for one record. A miss gives layer −1 (the shader discards it).
	 * Marks the frame and palette as used by the current frame.
	 * @param {{texture: unknown, palette?: unknown}} record
	 * @param {object} [out]  Reused result object (allocation-free packing)
	 * @returns {{layer: number, paletteRow: number, pool: string|null, classIndex: number, width: number, height: number}}
	 */
	slotOf(record, out = {}) {
		const slot = this._slots.get(record.texture);
		const palette = this._palettes.get(record.palette);
		const now = slot || palette ? this._now() : 0;
		if (slot) {
			slot.lastUsed = now;
			slot.frame = this._frame;
		}
		if (palette) {
			palette.lastUsed = now;
			palette.frame = this._frame;
		}
		out.layer = slot ? slot.layer : -1;
		out.pool = slot ? slot.pool : null;
		out.classIndex = slot ? slot.classIndex : 0;
		out.width = slot ? slot.width : 1;
		out.height = slot ? slot.height : 1;
		out.paletteRow = palette ? palette.row : -1;
		return out;
	}

	/** GPU uploader behind this residency (TextureArrayPools in production). */
	get uploader() {
		return this._uploader;
	}

	/**
	 * Free a frame's layer (back to its pool's free list).
	 * @param {unknown} handle
	 */
	release(handle) {
		const slot = this._slots.get(handle);
		if (slot) {
			this._freeSlot(handle, slot, true);
		}
	}

	_freeSlot(handle, slot, notify) {
		this._pools.get(slot.pool).free.push(slot.layer);
		this._slots.delete(handle);
		if (notify) {
			this.stats.frameEvictions++;
			this._onEvict?.(handle, 'frame');
		}
	}

	_freePalette(handle, entry) {
		this._freePaletteRows.push(entry.row);
		this._palettes.delete(handle);
		this.stats.paletteEvictions++;
		this._onEvict?.(handle, 'palette');
	}

	/**
	 * NFR-05 idle eviction (scene's asset-eviction tick, R-CTX-010 step 24): free frame
	 * layers unused for `maxAgeMs` and unowned palette rows unused as long.
	 * @param {number} [maxAgeMs]
	 * @returns {{frames: number, palettes: number}}
	 */
	evictIdle(maxAgeMs = this._idleMs) {
		const cutoff = this._now() - maxAgeMs;
		let frames = 0;
		let palettes = 0;
		for (const [handle, slot] of this._slots) {
			if (slot.lastUsed < cutoff) {
				this._freeSlot(handle, slot, true);
				frames++;
			}
		}
		for (const [handle, entry] of this._palettes) {
			if (entry.lastUsed < cutoff && !this._paletteRefs.get(handle)) {
				this._freePalette(handle, entry);
				palettes++;
			}
		}
		return { frames, palettes };
	}

	/**
	 * R-CTX-006 / device loss: every GPU slot and row is gone; assets re-upload on
	 * demand through the source. Owner reference counts are kept.
	 */
	purgeAll() {
		this._uploader.purge?.();
		this._pools.clear();
		this._slots.clear();
		this._palettes.clear();
		this._freePaletteRows.length = 0;
		this._nextPaletteRow = 0;
	}

	get residentCount() {
		return this._slots.size;
	}

	get paletteCount() {
		return this._palettes.size;
	}

	/**
	 * Free layers per pool (diagnostics and tests).
	 * @param {string} pool
	 */
	freeLayers(pool) {
		const p = this._pools.get(pool);
		return p ? p.free.length + (this._layersPerPool - p.next) : this._layersPerPool;
	}
}
