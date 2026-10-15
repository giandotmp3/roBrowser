import { IDLE_EVICT_MS, PALETTE_WIDTH, POT_CLASSES } from '../constants.js';
import { DeviceLimitError } from '../errors.js';
import { nextPot } from './imageKey.js';

/**
 * Texture-array residency (architecture §2.2, critic M3): one TEXTURE_2D_ARRAY
 * pool per (format r8/rgba8, POT size class 32–512). Slots come from a free
 * list, so nothing packs or fragments. Palettes live in one 256×N RGBA table.
 *
 * GL calls go through `uploader` so pools can be faked in tests.
 */
export class Residency {
	/**
	 * @param {{
	 *   uploader: {allocLayer(pool: string, size: number, layer: number, data: ArrayBufferView): void, uploadPalette(row: number, rgba: Uint8Array): void},
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
		/** @type {Map<string|number, {pool: string, layer: number, lastUsed: number}>} */
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
		const size = nextPot(Math.max(width, height, POT_CLASSES[0]));
		if (size > POT_CLASSES[POT_CLASSES.length - 1]) {
			throw new DeviceLimitError('spritePotClass', size, POT_CLASSES[POT_CLASSES.length - 1]);
		}
		return { pool: `${format}:${size}`, size };
	}

	/**
	 * @param {string|number} handle
	 * @param {{format: 'r8'|'rgba8', width: number, height: number, data: ArrayBufferView}} image  Already POT-padded
	 */
	upload(handle, image) {
		const { pool, size } = Residency.poolFor(image.format, image.width, image.height);
		let p = this._pools.get(pool);
		if (!p) {
			p = { free: [], next: 0 };
			this._pools.set(pool, p);
		}
		const layer = p.free.length ? p.free.pop() : p.next++;
		if (layer >= this._layersPerPool) {
			throw new DeviceLimitError(`layers:${pool}`, layer + 1, this._layersPerPool);
		}
		this._uploader.allocLayer(pool, size, layer, image.data);
		this._slots.set(handle, { pool, layer, lastUsed: this._now() });
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
	 * @param {{texture: string|number|null, palette?: string|number|null}} record
	 * @returns {{layer: number, paletteRow: number, pool: string|null}}
	 */
	slotOf(record) {
		const slot = this._slots.get(record.texture);
		if (slot) {
			slot.lastUsed = this._now();
		}
		return {
			layer: slot ? slot.layer : -1,
			pool: slot ? slot.pool : null,
			paletteRow: this._paletteRows.get(record.palette) ?? -1
		};
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

	/** R-CTX-006: on loss, every GPU slot is gone; assets re-upload on demand. */
	purgeAll() {
		this._pools.clear();
		this._slots.clear();
		this._paletteRows.clear();
		this._nextPaletteRow = 0;
	}

	get residentCount() {
		return this._slots.size;
	}
}
