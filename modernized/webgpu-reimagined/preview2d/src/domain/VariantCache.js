import { FRAME_TYPE, MAX_COLOR_VARIANTS } from '../constants.js';

/**
 * R-SPR-034: per-(frame, palette) cache of colourised canvases.
 *
 * frame -> { rgba: Map(colorKey -> canvas), byPalette: WeakMap(palette -> Map(colorKey -> canvas)) }
 *
 * One canvas per (frame, palette, colour) rather than one shared scratch canvas:
 * Safari defers drawImage() from a canvas source, so a shared scratch canvas made
 * layers pick up each other's pixels. Eviction is FIFO by insertion, capped at
 * MAX_COLOR_VARIANTS per (frame, palette): fading/tinted sprites produce many colours.
 */
export class VariantCache {
	/** @type {WeakMap<object, {rgba: Map<string, any>, byPalette: WeakMap<object, Map<string, any>>}>} */
	#entries = new WeakMap();

	/** @param {number} [limit] */
	constructor(limit = MAX_COLOR_VARIANTS) {
		this.limit = limit;
	}

	/** @param {ArrayLike<number>} color */
	static colorKey(color) {
		return `${color[0]},${color[1]},${color[2]},${color[3]}`;
	}

	/**
	 * Bucket for (frame, palette). RGBA frames (or frames without a palette) ignore the palette.
	 * @returns {Map<string, any>}
	 */
	bucket(frame, palette) {
		let entry = this.#entries.get(frame);
		if (!entry) {
			entry = { rgba: new Map(), byPalette: new WeakMap() };
			this.#entries.set(frame, entry);
		}
		if (frame.type === FRAME_TYPE.RGBA || !palette) {
			return entry.rgba;
		}
		let byColor = entry.byPalette.get(palette);
		if (!byColor) {
			byColor = new Map();
			entry.byPalette.set(palette, byColor);
		}
		return byColor;
	}

	/**
	 * @template T
	 * @param {object} frame
	 * @param {object|null} palette
	 * @param {ArrayLike<number>} color
	 * @param {() => T} build  Called only on a miss
	 * @returns {T}
	 */
	getOrCreate(frame, palette, color, build) {
		const byColor = this.bucket(frame, palette);
		const key = VariantCache.colorKey(color);
		let value = byColor.get(key);
		if (value === undefined) {
			if (byColor.size >= this.limit) {
				byColor.delete(byColor.keys().next().value);
			}
			value = build();
			byColor.set(key, value);
		}
		return value;
	}

	/** Number of cached variants for (frame, palette). */
	size(frame, palette) {
		return this.bucket(frame, palette).size;
	}
}
