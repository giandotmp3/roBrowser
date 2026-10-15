import { IDLE_EVICT_MS, PALETTE_WIDTH, POT_CLASSES } from '../constants.js';
import { DeviceLimitError } from '../errors.js';
import { nextPow2 } from '../math.js';

/**
 * Handle-level sprite residency (architecture §2.2, critic M3), same contract
 * as gpu-webgl2's Residency: one texture_2d_array pool per (format r8/rgba8,
 * POT class 32–512), slots from a free list (nothing packs or fragments), and
 * one 256×N palette table. A frame occupies the top-left of its layer.
 *
 * GPU calls go through `uploader` (TextureArrayPools) so pools can be faked.
 */
export class SpriteResidency {
	/**
	 * @param {{
	 *   uploader: {allocLayer(pool: string, size: number, layer: number, data: ArrayBufferView, width?: number, height?: number): void, uploadPalette(row: number, rgba: Uint8Array): void, purge?(): void},
	 *   layersPerPool?: number,
	 *   now: () => number
	 * }} deps
	 */
	constructor({ uploader, layersPerPool = 64, now }) {
		this._uploader = uploader;
		this._layersPerPool = layersPerPool;
		this._now = now;
		/** @type {Map<string, {free: number[], next: number}>} */
		this._pools = new Map();
		/** @type {Map<string|number, {pool: string, layer: number, classIndex: number, width: number, height: number, lastUsed: number}>} */
		this._slots = new Map();
		/** @type {Map<string|number, number>} */
		this._paletteRows = new Map();
		this._nextPaletteRow = 0;
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

	/**
	 * @param {string|number} handle
	 * @param {{format: 'r8'|'rgba8', width: number, height: number, data: ArrayBufferView}} image  Tightly packed
	 */
	upload(handle, image) {
		const { pool, size, classIndex } = SpriteResidency.poolFor(image.format, image.width, image.height);
		const previous = this._slots.get(handle);
		if (previous && previous.pool === pool) {
			this._uploader.allocLayer(pool, size, previous.layer, image.data, image.width, image.height);
			Object.assign(previous, { width: image.width, height: image.height, lastUsed: this._now() });
			return;
		}
		if (previous) {
			this.release(handle);
		}
		let p = this._pools.get(pool);
		if (!p) {
			p = { free: [], next: 0 };
			this._pools.set(pool, p);
		}
		const layer = p.free.length ? p.free.pop() : p.next++;
		if (layer >= this._layersPerPool) {
			throw new DeviceLimitError(`layers:${pool}`, layer + 1, this._layersPerPool);
		}
		this._uploader.allocLayer(pool, size, layer, image.data, image.width, image.height);
		this._slots.set(handle, {
			pool,
			layer,
			classIndex,
			width: image.width,
			height: image.height,
			lastUsed: this._now()
		});
	}

	/**
	 * @param {string|number} handle
	 * @param {Uint8Array} rgba  256×4
	 */
	uploadPalette(handle, rgba) {
		if (rgba.length !== PALETTE_WIDTH * 4) {
			throw new RangeError('palette must be 256 RGBA entries');
		}
		let row = this._paletteRows.get(handle);
		if (row === undefined) {
			row = this._nextPaletteRow++;
			this._paletteRows.set(handle, row);
		}
		this._uploader.uploadPalette(row, rgba);
	}

	/**
	 * Instance lookup for one record. A miss gives layer −1 (the shader discards it).
	 * @param {{texture: string|number|null, palette?: string|number|null}} record
	 * @param {object} [out]  Reused result object (allocation-free packing)
	 */
	slotOf(record, out = {}) {
		const slot = this._slots.get(record.texture);
		if (slot) {
			slot.lastUsed = this._now();
		}
		out.layer = slot ? slot.layer : -1;
		out.pool = slot ? slot.pool : null;
		out.classIndex = slot ? slot.classIndex : 0;
		out.width = slot ? slot.width : 1;
		out.height = slot ? slot.height : 1;
		out.paletteRow = this._paletteRows.get(record.palette) ?? -1;
		return out;
	}

	/** GPU uploader behind this residency (TextureArrayPools in production). */
	get uploader() {
		return this._uploader;
	}

	/** @param {string|number} handle */
	release(handle) {
		const slot = this._slots.get(handle);
		if (!slot) {
			return;
		}
		this._pools.get(slot.pool).free.push(slot.layer);
		this._slots.delete(handle);
	}

	/** NFR-05: evict slots idle for more than 30 s. */
	evictIdle() {
		const cutoff = this._now() - IDLE_EVICT_MS;
		for (const [handle, slot] of this._slots) {
			if (slot.lastUsed < cutoff) {
				this.release(handle);
			}
		}
	}

	/** Device loss: every GPU slot is gone; assets re-upload on demand. */
	purgeAll() {
		this._uploader.purge?.();
		this._pools.clear();
		this._slots.clear();
		this._paletteRows.clear();
		this._nextPaletteRow = 0;
	}

	get residentCount() {
		return this._slots.size;
	}
}
