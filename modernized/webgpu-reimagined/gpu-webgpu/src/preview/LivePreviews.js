import { NotImplementedError } from '../errors.js';

/**
 * C-19 live previews (CharSelect, CharCreate, Equipment, PlayerViewEquip,
 * Sense, SlotMachine, ItemPreview): SpriteDraw records drawn on the shared
 * device into each preview canvas's own GPUCanvasContext. Baked outputs
 * (cursor, guild portrait, item icons) are NOT here: they belong to preview2d.
 */
export class LivePreviews {
	constructor(deps) {
		this._deps = deps;
		/** @type {Map<string, {canvas: any, context: any}>} */
		this.contexts = new Map();
	}

	/** Register a preview canvas; configured on the current device. */
	attach(id, canvas) {
		this.contexts.set(id, { canvas, context: null });
	}

	detach(id) {
		this.contexts.get(id)?.context?.unconfigure?.();
		this.contexts.delete(id);
	}

	/** Device loss step 3: reconfigure every live-preview context. */
	reconfigureAll(_device) {
		throw new NotImplementedError('LivePreviews.reconfigureAll (C-19, R-CTX-007)');
	}

	render(_id, _records) {
		throw new NotImplementedError('LivePreviews.render (C-19)');
	}
}
