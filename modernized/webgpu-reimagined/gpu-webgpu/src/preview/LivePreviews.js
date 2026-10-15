import { NotImplementedError } from '../errors.js';
import { DEVICE_REQUEST } from '../device/RenderDevice.js';

/**
 * C-19 live previews (CharSelect, CharCreate, Equipment, PlayerViewEquip,
 * Sense, SlotMachine, ItemPreview): SpriteDraw records drawn on the shared
 * device into each preview canvas's own GPUCanvasContext. Baked outputs
 * (cursor, guild portrait, item icons) are NOT here: they belong to preview2d.
 *
 * This is also the contexts registry of the device-loss rebuild (architecture
 * §2.2 step 3): `reconfigureAll(device)` configures every attached canvas on the
 * new device.
 */
export class LivePreviews {
	/** @param {{device?: GPUDevice|null, format?: string}} deps  format: the canvas format (default bgra8unorm) */
	constructor(deps = {}) {
		this._deps = deps;
		this.device = deps.device ?? null;
		this.format = deps.format ?? 'bgra8unorm';
		/** @type {Map<string, {canvas: any, context: any}>} */
		this.contexts = new Map();
	}

	/** Register a preview canvas; configured on the current device (if any). */
	attach(id, canvas) {
		const entry = { canvas, context: null };
		this.contexts.set(id, entry);
		if (this.device) {
			this._configure(entry);
		}
	}

	detach(id) {
		this.contexts.get(id)?.context?.unconfigure?.();
		this.contexts.delete(id);
	}

	/**
	 * Device loss step 3: reconfigure every live-preview context on `device`.
	 * @param {GPUDevice} device
	 * @returns {number} contexts configured
	 */
	reconfigureAll(device) {
		this.device = device;
		for (const entry of this.contexts.values()) {
			this._configure(entry);
		}
		return this.contexts.size;
	}

	_configure(entry) {
		entry.context ??= entry.canvas.getContext('webgpu');
		entry.context?.configure({
			device: this.device,
			format: this.format,
			alphaMode: DEVICE_REQUEST.canvas.alphaMode
		});
	}

	render(_id, _records) {
		throw new NotImplementedError('LivePreviews.render (C-19)');
	}
}
