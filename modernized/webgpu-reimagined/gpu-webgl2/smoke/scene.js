/**
 * Synthetic sprite scene for the legacy ↔ gpu-webgl2 pixel parity check.
 * Deterministic (seeded): frames, palettes, camera and ~40 SpriteDraw records
 * in the render-records shape (sizes and offsets in sprite pixels).
 */

import { cameraMatrices } from './common.js';

const NORMAL = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
const ADDITIVE = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE' });

/** mulberry32 */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Indexed (LUMINANCE) frame: an ellipse of stripes and noise; index 0 outside.
 * Uses the extreme indices 1, 254 and 255 on purpose (palette edge behaviour).
 */
function indexedFrame(width, height, seed) {
	const random = rng(seed);
	const data = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const dx = (x + 0.5) / width - 0.5;
			const dy = (y + 0.5) / height - 0.5;
			if (dx * dx + dy * dy > 0.22) {
				continue;
			}
			const band = ((x >> 2) + (y >> 3)) % 6;
			let index = 1 + ((x * 7 + y * 13 + seed) % 253);
			if (band === 0) {
				index = 255;
			} else if (band === 1) {
				index = 254;
			} else if (band === 2) {
				index = 1;
			} else if (random() < 0.08) {
				index = 0; // holes: transparent neighbours for the bilinear filter
			}
			data[y * width + x] = index;
		}
	}
	return { format: 'r8', width, height, data };
}

/** RGBA frame (already converted top-down RGBA, R-SPR-016): alpha 0 pixels are all zero. */
function rgbaFrame(width, height, seed) {
	const random = rng(seed);
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const dx = (x + 0.5) / width - 0.5;
			const dy = (y + 0.5) / height - 0.5;
			const r2 = dx * dx + dy * dy;
			if (r2 > 0.24 || ((x >> 3) + (y >> 3)) % 5 === 0) {
				continue;
			}
			const p = (y * width + x) * 4;
			data[p] = (x * 255) / width;
			data[p + 1] = (y * 255) / height;
			data[p + 2] = Math.floor(random() * 256);
			data[p + 3] = r2 > 0.15 ? 96 + Math.floor(random() * 64) : 255;
		}
	}
	return { format: 'rgba8', width, height, data };
}

function palette(seed) {
	const random = rng(seed);
	const table = new Uint8Array(256 * 4);
	for (let i = 0; i < 256; i++) {
		table[i * 4] = Math.floor(random() * 256);
		table[i * 4 + 1] = Math.floor(random() * 256);
		table[i * 4 + 2] = Math.floor(random() * 256);
		table[i * 4 + 3] = 255;
	}
	// Distinct, saturated colours on the edge indices so a wrong lookup is visible.
	table.set([255, 40, 40, 255], 0);
	table.set([40, 255, 40, 255], 1 * 4);
	table.set([40, 40, 255, 255], 254 * 4);
	table.set([250, 250, 30, 255], 255 * 4);
	return table;
}

/** POT frames, as legacy Sprite.compile leaves them. */
export const FRAMES = Object.freeze({
	'idx:32x32': indexedFrame(32, 32, 1),
	'idx:64x64': indexedFrame(64, 64, 2),
	'idx:64x128': indexedFrame(64, 128, 3),
	'idx:128x64': indexedFrame(128, 64, 4),
	'idx:16x32': indexedFrame(16, 32, 5),
	'idx:256x128': indexedFrame(256, 128, 6),
	'rgba:32x32': rgbaFrame(32, 32, 7),
	'rgba:64x32': rgbaFrame(64, 32, 8),
	'rgba:128x128': rgbaFrame(128, 128, 9)
});

export const PALETTES = Object.freeze({
	'pal:0': palette(10),
	'pal:1': palette(11),
	'pal:2': palette(12)
});

/** Camera: legacy-style view (pitched 50°, yawed 15°, 30 units back), fovy 20° like Renderer.vFov default. */
export const CAMERA = Object.freeze({ target: [10, 10], distance: 30, pitch: 50, yaw: 15, fovy: 20, zoom: 30 });

export const FOG = Object.freeze({ use: true, exist: true, near: 22, far: 40, color: [0.55, 0.6, 0.75] });

export function viewMatrices(width, height) {
	return cameraMatrices(CAMERA, width, height);
}

function sprite(fields) {
	return {
		kind: 'sprite',
		source: null,
		texture: null,
		textureClass: 'indexed',
		palette: null,
		sampler: 'nearest',
		billboard: 'spherical',
		position: [0, 0, 0],
		offset: [0, 0],
		size: [0, 0],
		xSize: 5,
		ySize: 5,
		angle: 0,
		mirror: false,
		color: [1, 1, 1, 1],
		shadowFactor: 1,
		zIndex: 0,
		depthBias: 0,
		depthTest: true,
		depthWrite: true,
		depthCorrection: true,
		ignoreDepthMinCap: false,
		blend: NORMAL,
		...fields
	};
}

/** Indexed layer helper: quad size = frame size (R-SPR-003 padded size), mirrored → negative width. */
function idx(texture, pal, fields = {}) {
	const frame = FRAMES[texture];
	const scale = fields.scale ?? 1;
	const mirror = Boolean(fields.mirror);
	const w = frame.width * scale;
	delete fields.scale;
	return sprite({
		texture,
		palette: pal,
		textureClass: 'indexed',
		sampler: 'nearest',
		size: [mirror ? -w : w, frame.height * scale],
		paletteSize: [2 * frame.width, 2 * frame.height],
		...fields
	});
}

function rgba(texture, fields = {}) {
	const frame = FRAMES[texture];
	const scale = fields.scale ?? 1;
	const mirror = Boolean(fields.mirror);
	const w = frame.width * scale;
	delete fields.scale;
	return sprite({
		texture,
		textureClass: 'rgba',
		palette: null,
		sampler: 'linear',
		size: [mirror ? -w : w, frame.height * scale],
		...fields
	});
}

/**
 * ~40 records in legacy order (entities far → near, layers in draw order,
 * zIndex++ per layer). Covers indexed and RGBA frames, three palettes, every
 * POT class 32–256, mirroring, rotation, additive blend, depth test/write off,
 * depth correction off, ignoreDepthMinCap, depth bias, shadow factor, tints,
 * translucency, xSize 4/20, a 1.15× halo and a zero-alpha (skipped) layer.
 */
export function buildRecords() {
	const records = [];
	const entity = (position, shadowFactor, layers) => {
		let z = 150;
		for (const layer of layers) {
			records.push({ ...layer, position: [...position], shadowFactor, zIndex: layer.zIndex ?? z++ });
		}
	};

	// Far row
	entity([6, 15, 0], 1, [
		idx('idx:64x128', 'pal:0', { offset: [0, -40] }),
		idx('idx:32x32', 'pal:1', { offset: [2, -100] }),
		idx('idx:16x32', 'pal:2', { offset: [-20, -60], angle: 30 })
	]);
	entity([10, 16, -0.5], 0.6, [
		idx('idx:64x64', 'pal:1', { offset: [0, -30], mirror: true }),
		idx('idx:32x32', 'pal:0', { offset: [0, -80], mirror: true, color: [1, 0.7, 0.7, 1] }),
		rgba('rgba:32x32', { offset: [24, -50] })
	]);
	entity([14, 15, 0], 1, [
		idx('idx:128x64', 'pal:2', { offset: [0, -20], angle: 200 }),
		idx('idx:64x64', 'pal:2', { offset: [0, -70], color: [1, 1, 1, 0.55], depthWrite: false })
	]);

	// Cart-like layer drawn first without depth write, then the rider
	entity([11.5, 13.5, 0], 1, [
		rgba('rgba:64x32', { offset: [0, -16], depthWrite: false }),
		idx('idx:64x128', 'pal:1', { offset: [0, -40] }),
		idx('idx:32x32', 'pal:0', { offset: [0, -100] }),
		idx('idx:16x32', 'pal:2', { offset: [22, -40], angle: 330 })
	]);

	// Middle row: additive body (R-SPR-023), NPC (ignoreDepthMinCap), depth-off overlay
	entity([7, 11, 0], 0.8, [
		idx('idx:64x128', 'pal:1', { offset: [0, -40], blend: ADDITIVE }),
		idx('idx:32x32', 'pal:2', { offset: [0, -100], blend: ADDITIVE }),
		idx('idx:64x64', 'pal:0', { offset: [0, -30], blend: ADDITIVE, mirror: true, depthWrite: false })
	]);
	entity([10.5, 11, 0.3], 1, [
		idx('idx:64x128', 'pal:2', { offset: [0, -40], ignoreDepthMinCap: true }),
		idx('idx:32x32', 'pal:1', { offset: [0, -100], ignoreDepthMinCap: true, angle: -15 }),
		idx('idx:16x32', 'pal:0', { offset: [18, -70], ignoreDepthMinCap: true, depthBias: 0.02 })
	]);
	entity([13.5, 11, 0], 1, [
		rgba('rgba:128x128', { offset: [0, -40], sampler: 'nearest' }),
		rgba('rgba:64x32', { offset: [0, -110], angle: 90, color: [0.6, 1, 0.8, 1] }),
		rgba('rgba:64x32', { offset: [0, -20], mirror: true, depthTest: false, depthWrite: false })
	]);

	// Halo (R-SPR-024 shape: 1.15×, alpha 0.6, zIndex −100, no depth write) + body
	entity([8.5, 8.5, 0], 1, [
		idx('idx:64x128', 'pal:0', {
			offset: [0, -40],
			scale: 1.15,
			color: [1, 1, 1, 0.6],
			zIndex: -100,
			depthWrite: false
		}),
		idx('idx:64x128', 'pal:0', { offset: [0, -40] }),
		idx('idx:32x32', 'pal:1', { offset: [0, -100] })
	]);

	// Depth correction off (effects / weather style), rotated RGBA, linear vs nearest
	entity([12, 8, 0], 1, [
		rgba('rgba:32x32', { offset: [0, -30], depthCorrection: false, angle: 45 }),
		rgba('rgba:32x32', { offset: [0, -30], depthCorrection: false, sampler: 'nearest', scale: 2 }),
		idx('idx:256x128', 'pal:2', {
			offset: [0, 0],
			depthCorrection: false,
			xSize: 4,
			ySize: 4,
			color: [0.9, 0.9, 1, 0.8]
		})
	]);

	// Near row: baby (xSize 4), warp-sized (xSize 20, small frame), shadowed, a skipped layer
	entity([6.5, 6.5, 0], 0.5, [
		idx('idx:64x64', 'pal:2', { offset: [0, -30], xSize: 4, ySize: 4 }),
		idx('idx:32x32', 'pal:0', { offset: [0, -80], xSize: 4, ySize: 4, color: [1, 1, 1, 0] }),
		idx('idx:32x32', 'pal:1', { offset: [0, -75], xSize: 4, ySize: 4 })
	]);
	entity([10, 5.5, 0], 1, [
		idx('idx:16x32', 'pal:1', {
			offset: [0, 0],
			xSize: 20,
			ySize: 20,
			blend: ADDITIVE,
			depthWrite: false,
			color: [1, 1, 1, 0.7]
		})
	]);
	entity([13, 6, 0], 0.9, [
		idx('idx:128x64', 'pal:0', { offset: [0, -10], mirror: true }),
		rgba('rgba:128x128', { offset: [0, -60], scale: 0.5 }),
		rgba('rgba:64x32', { offset: [20, -90], blend: ADDITIVE }),
		idx('idx:64x64', 'pal:1', { offset: [-10, -60], depthBias: -0.05, angle: 10 })
	]);
	entity([9, 4, 0], 1, [
		idx('idx:64x128', 'pal:2', { offset: [0, -40], color: [0.4, 0.4, 0.4, 1] }),
		idx('idx:64x128', 'pal:1', { offset: [5, -45], color: [1, 1, 1, 0.5], depthWrite: false }),
		idx('idx:32x32', 'pal:2', { offset: [0, -100] }),
		rgba('rgba:32x32', { offset: [-20, -60], mirror: true }),
		rgba('rgba:32x32', { offset: [20, -60] })
	]);

	return records.map(r => ({ ...r, mirror: r.size[0] < 0 }));
}
