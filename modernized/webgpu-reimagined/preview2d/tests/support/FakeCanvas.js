/**
 * Minimal Canvas2D stub for node tests (no jsdom / node-canvas needed).
 *
 * - Pixel ops (createImageData / putImageData / getImageData) are real.
 * - Transform and drawImage calls are recorded in `ops`.
 * - toDataURL() is a deterministic signature of pixels + ops, so identical
 *   compositions produce identical strings (used for cursor-cell dedupe).
 */
let nextId = 1;

export class FakeContext2D {
	constructor(canvas) {
		this.canvas = canvas;
		this.ops = [];
	}
	save() {
		this.ops.push(['save']);
	}
	restore() {
		this.ops.push(['restore']);
	}
	translate(x, y) {
		this.ops.push(['translate', x, y]);
	}
	rotate(r) {
		this.ops.push(['rotate', r]);
	}
	scale(x, y) {
		this.ops.push(['scale', x, y]);
	}
	clearRect(x, y, w, h) {
		this.ops.push(['clearRect', x, y, w, h]);
		if (x === 0 && y === 0 && w >= this.canvas.width && h >= this.canvas.height) {
			this.canvas.pixels.fill(0);
			this.ops = [];
		}
	}
	drawImage(src, ...args) {
		this.ops.push(['drawImage', src.signature(), ...args]);
	}
	createImageData(w, h) {
		return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
	}
	putImageData(img, x, y) {
		const W = this.canvas.width;
		for (let j = 0; j < img.height; j++) {
			for (let i = 0; i < img.width; i++) {
				const s = (j * img.width + i) * 4;
				const d = ((y + j) * W + (x + i)) * 4;
				for (let c = 0; c < 4; c++) {
					this.canvas.pixels[d + c] = img.data[s + c];
				}
			}
		}
		this.ops.push(['putImageData', x, y]);
	}
	getImageData(x, y, w, h) {
		const out = this.createImageData(w, h);
		const W = this.canvas.width;
		for (let j = 0; j < h; j++) {
			for (let i = 0; i < w; i++) {
				const s = ((y + j) * W + (x + i)) * 4;
				const d = (j * w + i) * 4;
				for (let c = 0; c < 4; c++) {
					out.data[d + c] = this.canvas.pixels[s + c];
				}
			}
		}
		return out;
	}
}

export class FakeCanvas {
	constructor(width, height) {
		this.id = nextId++;
		this.width = width;
		this.height = height;
		this.pixels = new Uint8ClampedArray(width * height * 4);
		this._ctx = new FakeContext2D(this);
	}
	getContext(type) {
		return type === '2d' ? this._ctx : null;
	}
	signature() {
		return `${this.width}x${this.height}:${Array.from(this.pixels).join('.')}`;
	}
	toDataURL() {
		const body = JSON.stringify([this.signature(), this._ctx.ops]);
		return `data:image/png;fake,${body}`;
	}
}

export function fakeCanvasFactory() {
	const created = [];
	return {
		created,
		create(w, h) {
			const c = new FakeCanvas(w, h);
			created.push(c);
			return c;
		}
	};
}
