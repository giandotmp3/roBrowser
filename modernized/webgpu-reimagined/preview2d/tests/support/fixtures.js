import { createSpriteFrame } from '../../src/domain/SpriteFrame.js';
import { FRAME_TYPE } from '../../src/constants.js';

/** Synthetic 256-colour palette: index i -> (i, 255 - i, 128, 255); index 7 is magenta. */
export function makePalette() {
	const pal = new Uint8Array(1024);
	for (let i = 0; i < 256; i++) {
		pal.set([i, 255 - i, 128, 255], i * 4);
	}
	pal.set([255, 0, 255, 255], 7 * 4);
	return pal;
}

/** 2x2 indexed frame: [0, 1, 2, 3] (index 0 transparent). */
export function indexedFrame() {
	return createSpriteFrame({ type: FRAME_TYPE.INDEXED, width: 2, height: 2, data: new Uint8Array([0, 1, 2, 3]) });
}

/** 2x1 RGBA frame: one transparent pixel, one opaque (200, 100, 50, 255). */
export function rgbaFrame() {
	return createSpriteFrame({ type: FRAME_TYPE.RGBA, width: 2, height: 1, data: new Uint8Array([0, 0, 0, 0, 200, 100, 50, 255]) });
}

/** FrameSource backed by plain maps. */
export function mapFrameSource(frames = {}, palettes = {}) {
	return {
		getFrame: h => frames[h] ?? null,
		getPalette: h => palettes[h] ?? null
	};
}

/** SpriteDraw-shaped record (2D units). Mirrors render-records' createSpriteDraw shape. */
export function spriteRecord(fields = {}) {
	return Object.freeze({
		kind: 'sprite',
		texture: 'f0',
		textureClass: 'indexed',
		palette: 'p0',
		offset: [0, 0],
		size: [2, 2],
		angle: 0,
		mirror: false,
		color: [1, 1, 1, 1],
		...fields
	});
}

/** Manual scheduler + clock for the cursor driver. */
export function manualScheduler() {
	let id = 0;
	const pending = new Map();
	return {
		pending,
		requestFrame(cb) {
			pending.set(++id, cb);
			return id;
		},
		cancelFrame(i) {
			pending.delete(i);
		},
		flush(ts = 0) {
			const cbs = [...pending.values()];
			pending.clear();
			cbs.forEach(cb => cb(ts));
		}
	};
}
