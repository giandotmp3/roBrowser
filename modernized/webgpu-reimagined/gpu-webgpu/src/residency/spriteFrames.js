import { nextPow2 } from '../math.js';

/**
 * R-SPR-014 upload side: an indexed SPR frame becomes an r8 index image,
 * POT-padded and centred; indices whose palette colour is exactly
 * magenta (255,0,255) become 0 (transparent).
 *
 * @param {{width: number, height: number, indices: Uint8Array}} frame
 * @param {Uint8Array} palette  256 x RGBA
 * @returns {{width: number, height: number, data: Uint8Array, offsetX: number, offsetY: number}}
 */
export function prepareIndexedFrame(frame, palette) {
	const width = nextPow2(frame.width);
	const height = nextPow2(frame.height);
	const offsetX = Math.floor((width - frame.width) / 2);
	const offsetY = Math.floor((height - frame.height) / 2);
	const data = new Uint8Array(width * height);
	for (let y = 0; y < frame.height; y++) {
		for (let x = 0; x < frame.width; x++) {
			let idx = frame.indices[y * frame.width + x];
			const p = idx * 4;
			if (palette[p] === 255 && palette[p + 1] === 0 && palette[p + 2] === 255) {
				idx = 0;
			}
			data[(y + offsetY) * width + (x + offsetX)] = idx;
		}
	}
	return { width, height, data, offsetX, offsetY };
}

/**
 * R-SPR-016: RGBA SPR frames are stored bottom-up in ABGR order. Flip
 * vertically, reorder to RGBA, and zero the whole pixel when alpha is 0.
 *
 * @param {{width: number, height: number, abgr: Uint8Array}} frame
 * @returns {Uint8Array} RGBA8, top-down
 */
export function prepareRgbaFrame({ width, height, abgr }) {
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const srcRow = height - 1 - y;
		for (let x = 0; x < width; x++) {
			const s = (srcRow * width + x) * 4;
			const d = (y * width + x) * 4;
			const a = abgr[s];
			if (a === 0) {
				continue;
			}
			out[d] = abgr[s + 3];
			out[d + 1] = abgr[s + 2];
			out[d + 2] = abgr[s + 1];
			out[d + 3] = a;
		}
	}
	return out;
}

/**
 * Centre a tightly packed RGBA image in a power-of-two canvas (legacy Sprite.compile
 * padding: start = floor((pot − size) / 2), the rest transparent black).
 * Same as gpu-webgl2 `centerRgbaPot`.
 * @param {Uint8Array} rgba  width×height×4, top-down
 * @param {number} width
 * @param {number} height
 * @returns {{width: number, height: number, data: Uint8Array}}
 */
export function centerRgbaPot(rgba, width, height) {
	const potW = nextPow2(width);
	const potH = nextPow2(height);
	if (potW === width && potH === height) {
		return { width, height, data: rgba };
	}
	const out = new Uint8Array(potW * potH * 4);
	const ox = Math.floor((potW - width) / 2);
	const oy = Math.floor((potH - height) / 2);
	for (let y = 0; y < height; y++) {
		out.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), ((y + oy) * potW + ox) * 4);
	}
	return { width: potW, height: potH, data: out };
}

/**
 * C-16 decode for the residency upload-on-miss source (`FrameSourcePort`): one raw
 * SPR frame (as the legacy loader reads it, before `Sprite.compile`) to the texels
 * legacy `Core/Client.js` uploads. Indexed → r8 indices, POT-centred, magenta → 0
 * (R-SPR-014); RGBA (bottom-up ABGR) → top-down RGBA, POT-centred (R-SPR-016).
 * Same as gpu-webgl2 `decodeSprFrame`.
 * @param {{type: number, width: number, height: number, data: Uint8Array}} frame  type 0 indexed, 1 RGBA
 * @param {Uint8Array} palette  256×4 RGBA (the sprite's own palette: the magenta key uses it)
 * @returns {{format: 'r8'|'rgba8', width: number, height: number, data: Uint8Array}}
 */
export function decodeSprFrame(frame, palette) {
	if (frame.type === 0) {
		const { width, height, data } = prepareIndexedFrame({ ...frame, indices: frame.data }, palette);
		return { format: 'r8', width, height, data };
	}
	const rgba = prepareRgbaFrame({ width: frame.width, height: frame.height, abgr: frame.data });
	const { width, height, data } = centerRgbaPot(rgba, frame.width, frame.height);
	return { format: 'rgba8', width, height, data };
}

/**
 * R-SPR-014 filtering of a sprite record: indexed → nearest (the shader does the manual
 * palette bilinear); RGBA → linear unless pixelPerfectSprites forces nearest.
 * @param {'indexed'|'rgba'} textureClass
 * @param {boolean} pixelPerfectSprites
 * @returns {'nearest'|'linear'}
 */
export function spriteSampler(textureClass, pixelPerfectSprites) {
	return textureClass === 'indexed' || pixelPerfectSprites ? 'nearest' : 'linear';
}
