import { DeviceLimitError, NotImplementedError } from '../errors.js';
import { PALETTE_WIDTH } from '../constants.js';
import { sizeClass } from './imageKey.js';

const LAYERS_PER_PAGE = 64;

/**
 * Free-list slot allocator for one (format, size class) texture_2d_array pool.
 * Pages are fixed-size arrays; nothing is packed or fragmented.
 */
export class ArrayPool {
	constructor(format, size, layersPerPage = LAYERS_PER_PAGE) {
		this.format = format;
		this.size = size;
		this.layersPerPage = layersPerPage;
		this.pages = 0;
		/** @type {{page: number, layer: number}[]} */
		this._free = [];
	}

	/** @returns {{page: number, layer: number, newPage: boolean}} */
	allocate() {
		let newPage = false;
		if (this._free.length === 0) {
			const page = this.pages++;
			newPage = true;
			for (let layer = this.layersPerPage - 1; layer >= 0; layer--) {
				this._free.push({ page, layer });
			}
		}
		return { ...this._free.pop(), newPage };
	}

	release(slot) {
		this._free.push({ page: slot.page, layer: slot.layer });
	}

	get freeCount() {
		return this._free.length;
	}
}

/**
 * Palette table: one rgba8unorm texture, 256 x N, one row per resident palette.
 */
export class PaletteTable {
	constructor(rows = 256) {
		this.rows = rows;
		this.width = PALETTE_WIDTH;
		/** @type {number[]} */
		this._free = Array.from({ length: rows }, (_, i) => rows - 1 - i);
	}

	allocate() {
		const row = this._free.pop();
		if (row === undefined) {
			throw new DeviceLimitError('paletteTableRows', this.rows + 1, this.rows);
		}
		return row;
	}

	release(row) {
		this._free.push(row);
	}
}

/**
 * Asset -> GPU residency (C-16). Owns pools per (format r8/rgba8, POT class),
 * the palette table, samplers and mip generation. Idle eviction timing is
 * driven by scene (R-CTX-010 step 24) calling evict().
 */
export class Residency {
	/** @param {{limit(name: string): number}} device */
	constructor(device) {
		this._device = device;
		/** @type {Map<string, ArrayPool>} */
		this.pools = new Map();
		this.palettes = new PaletteTable();
	}

	/**
	 * @param {'r8unorm'|'rgba8unorm'} format
	 * @param {number} width
	 * @param {number} height
	 */
	slotFor(format, width, height) {
		const cls = sizeClass(width, height);
		if (cls === 'oversize') {
			const max = this._device.limit('maxTextureDimension2D');
			const side = Math.max(width, height);
			if (side > max) {
				throw new DeviceLimitError('maxTextureDimension2D', side, max);
			}
			return { format, size: 'oversize', page: -1, layer: -1 };
		}
		const key = `${format}:${cls}`;
		let pool = this.pools.get(key);
		if (!pool) {
			pool = new ArrayPool(format, cls);
			this.pools.set(key, pool);
		}
		const slot = pool.allocate();
		return { format, size: cls, page: slot.page, layer: slot.layer };
	}

	/** Upload pixel data into a slot (queue.writeTexture) and generate mips (R-PERF-003). */
	upload(_slot, _data) {
		throw new NotImplementedError('Residency.upload (C-16)');
	}

	/** Drop all GPU resources; slots are re-uploaded on demand after device loss. */
	reset(device) {
		this._device = device;
		this.pools.clear();
		this.palettes = new PaletteTable();
	}
}
