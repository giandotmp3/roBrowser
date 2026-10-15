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
