import { Camera } from './Camera.js';
import { notImplemented } from '../errors.js';

/**
 * Map-less scene for the Model, GR2, Effect and Str viewers and the Enchant overlay (C-18).
 * Replaces the viewers' direct `gl.clear` / raw GL calls with a backend-neutral surface.
 */
export class ViewerScene {
	/**
	 * @param {object} deps
	 * @param {import('../ports.js').RecordsPort} deps.records
	 * @param {import('../ports.js').Rng} [deps.rng]
	 */
	constructor({ records, rng }) {
		this.records = records;
		this.camera = new Camera({ rng });
		/** @type {Array<{ kind: 'rsm'|'gr2'|'str'|'effect'|'tint', ref: unknown }>} */
		this.items = [];
		this.clearColor = [0, 0, 0, 1];
	}

	/** @param {{ kind: 'rsm'|'gr2'|'str'|'effect'|'tint', ref: unknown }} item */
	add(item) {
		this.items.push(item);
		return item;
	}

	remove(item) {
		this.items = this.items.filter((i) => i !== item);
	}

	setClearColor(rgba) {
		this.clearColor = [...rgba];
	}

	/** Emit one frame of viewer records. */
	render(_tick) {
		notImplemented('ViewerScene.render', 'C-18');
	}
}
