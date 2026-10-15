import { nextPot } from './imageKey.js';

/**
 * R-SPR-014: indexed frame → R8 index data, POT-padded and centred. Indices
 * whose palette colour is exactly magenta (255,0,255) become 0 (transparent).
 * @param {{width: number, height: number, indices: Uint8Array}} frame
 * @param {Uint8Array} palette  256×4 RGBA
 */
export function padIndexedFrame(frame, palette) {
	const potW = nextPot(frame.width);
	const potH = nextPot(frame.height);
	const out = new Uint8Array(potW * potH);
	const ox = Math.floor((potW - frame.width) / 2);
	const oy = Math.floor((potH - frame.height) / 2);
	for (let y = 0; y < frame.height; y++) {
		for (let x = 0; x < frame.width; x++) {
			const idx = frame.indices[y * frame.width + x];
			const p = idx * 4;
			const isMagenta = palette[p] === 255 && palette[p + 1] === 0 && palette[p + 2] === 255;
			out[(y + oy) * potW + (x + ox)] = isMagenta ? 0 : idx;
		}
	}
	return { width: potW, height: potH, data: out, offsetX: ox, offsetY: oy };
}

/**
 * R-SPR-016: RGBA frames are stored bottom-up as ABGR. Flip vertically,
 * reorder to RGBA, and zero the whole pixel when alpha is 0 (no fringe).
 * @param {{width: number, height: number, abgr: Uint8Array}} frame
 * @returns {Uint8Array} RGBA, top-down
 */
export function convertRgbaFrame(frame) {
	const { width, height, abgr } = frame;
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const srcRow = (height - 1 - y) * width * 4;
		const dstRow = y * width * 4;
		for (let x = 0; x < width; x++) {
			const s = srcRow + x * 4;
			const d = dstRow + x * 4;
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
 * @param {Uint8Array} rgba  width×height×4, top-down
 * @param {number} width
 * @param {number} height
 */
export function centerRgbaPot(rgba, width, height) {
	const potW = nextPot(width);
	const potH = nextPot(height);
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
 * C-16 decode for the residency upload-on-miss source: one raw SPR frame (as the
 * legacy loader reads it, before `Sprite.compile`) to the texels legacy
 * `Core/Client.js` uploads: indexed → R8 indices, POT-centred, magenta → 0
 * (R-SPR-014); RGBA (bottom-up ABGR) → top-down RGBA, POT-centred (R-SPR-016).
 * @param {{type: number, width: number, height: number, data: Uint8Array}} frame  type 0 indexed, 1 RGBA
 * @param {Uint8Array} palette  256×4 RGBA (the sprite's own palette: the magenta key uses it)
 * @returns {import('./Residency.js').ResidentImage}
 */
export function decodeSprFrame(frame, palette) {
	if (frame.type === 0) {
		const { width, height, data } = padIndexedFrame({ ...frame, indices: frame.data }, palette);
		return { format: 'r8', width, height, data };
	}
	const rgba = convertRgbaFrame({ width: frame.width, height: frame.height, abgr: frame.data });
	const { width, height, data } = centerRgbaPot(rgba, frame.width, frame.height);
	return { format: 'rgba8', width, height, data };
}

/**
 * R-SPR-014 filtering: indexed → NEAREST (the shader does manual palette
 * bilinear); RGBA → LINEAR unless pixelPerfectSprites forces NEAREST.
 * @param {'indexed'|'rgba'} textureClass
 * @param {boolean} pixelPerfectSprites
 * @returns {'nearest'|'linear'}
 */
export function spriteSampler(textureClass, pixelPerfectSprites) {
	if (textureClass === 'indexed' || pixelPerfectSprites) {
		return 'nearest';
	}
	return 'linear';
}
