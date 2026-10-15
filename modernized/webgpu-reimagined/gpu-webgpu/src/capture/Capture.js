import { NotImplementedError } from '../errors.js';

/**
 * C-20: on request, the resolved frame (after any VerticalFlip) is copied to
 * a MAP_READ buffer inside the frame and handed to ScreenShot.js as an image;
 * html2canvas composites DOM overlays above it. Replaces legacy
 * preserveDrawingBuffer:true.
 */
export class Capture {
	constructor(deps) {
		this._deps = deps;
		/** @type {((img: any) => void)[]} */
		this._requests = [];
	}

	/** @returns {Promise<{width: number, height: number, data: Uint8Array}>} */
	request() {
		return new Promise(resolve => this._requests.push(resolve));
	}

	get pending() {
		return this._requests.length > 0;
	}

	/** Encode copyTextureToBuffer for pending requests; resolve after mapAsync. */
	encode(_encoder, _texture) {
		throw new NotImplementedError('Capture.encode (C-20)');
	}
}
