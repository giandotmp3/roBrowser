/**
 * Synthetic SPR/ACT/PAL assets for the real-stream entity parity page.
 *
 * Each sprite is a real legacy `Loaders/Sprite.js` SPR object filled with raw frames
 * (indexed indices or bottom-up ABGR, as the loader reads them), compiled by the real
 * `SPR.compile()` and sent to the legacy context the way `Core/Client.js:313-351`
 * does (per-frame TEXTURE_2D, LUMINANCE/RGBA, NEAREST/LINEAR, a 256×1 palette
 * texture). The same raw frames feed gpu-webgpu through the residency upload-on-miss
 * source (`decodeSprFrame`, C-16), so both sides start from identical decoded data.
 * ACTs are compiled-shape objects (Loaders/Action.js), as in the root Node suite's
 * tests/renderer/support/legacyPcScene.js.
 */
import SPR from 'Loaders/Sprite.js';
import { decodeSprFrame } from '../../src/residency/spriteFrames.js';

const PC_ACTIONS = 13; // EntityAction.js (PC: IDLE 0 … SKILL 12)
const DIRECTIONS = 8;
const WALK_FRAMES = 8;
const ATTACK_FRAMES = 4;
/** 'data/sprite/이펙트/' in CP949 bytes (EntityAttachments.js:85-87). */
const ATTACHMENT_DIR = 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/';
/** Palette index painted magenta (255,0,255): legacy compile keys it to 0. */
const MAGENTA_INDEX = 77;

/** mulberry32 */
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function makePalette(seed) {
	const random = rng(seed);
	const table = new Uint8Array(256 * 4);
	for (let i = 0; i < 256; i++) {
		table.set([random() * 256, random() * 256, random() * 256, 255].map(Math.floor), i * 4);
	}
	// Distinct colours on the edge indices so a wrong lookup is visible (index 255: spec #64).
	table.set([255, 40, 40, 255], 0);
	table.set([40, 255, 40, 255], 4);
	table.set([40, 40, 255, 255], 254 * 4);
	table.set([250, 250, 30, 255], 255 * 4);
	table.set([255, 0, 255, 255], MAGENTA_INDEX * 4);
	return table;
}

/** Raw indexed frame: an ellipse of bands (indices 1, 254, 255, magenta) and noise; 0 outside and in holes. */
function indexedFrame(width, height, seed) {
	const random = rng(seed);
	const data = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const dx = (x + 0.5) / width - 0.5;
			const dy = (y + 0.5) / height - 0.5;
			if (dx * dx + dy * dy > 0.23) {
				continue;
			}
			const band = ((x >> 2) + (y >> 3) + seed) % 7;
			let index = 2 + ((x * 7 + y * 13 + seed * 31) % 251);
			if (band === 0) {
				index = 255;
			} else if (band === 1) {
				index = 254;
			} else if (band === 2) {
				index = 1;
			} else if (band === 3 && random() < 0.3) {
				index = MAGENTA_INDEX;
			} else if (random() < 0.06) {
				index = 0;
			}
			data[y * width + x] = index;
		}
	}
	return { type: SPR.TYPE_PAL, width, height, data };
}

/** Raw RGBA frame as the loader holds it: bottom-up rows, bytes A, B, G, R. */
function rgbaFrame(width, height, seed) {
	const random = rng(seed);
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const dx = (x + 0.5) / width - 0.5;
			const dy = (y + 0.5) / height - 0.5;
			const r2 = dx * dx + dy * dy;
			if (r2 > 0.24 || ((x >> 3) + (y >> 3) + seed) % 5 === 0) {
				continue;
			}
			const p = ((height - 1 - y) * width + x) * 4;
			data[p] = r2 > 0.15 ? 96 + Math.floor(random() * 64) : 255; // A
			data[p + 1] = Math.floor(random() * 256); // B
			data[p + 2] = (y * 255) / height; // G
			data[p + 3] = ((x + seed * 17) * 255) / width; // R
		}
	}
	return { type: SPR.TYPE_RGBA, width, height, data };
}

/**
 * A real legacy SPR with raw frames: `indexed` palette frames first, then `rgba` RGBA
 * frames (the SPR 2.x layout: rgba_index = indexed count).
 */
export function makeSpr({ indexed = 0, rgba = 0, width, height, seed, toRgba = false }) {
	const spr = new SPR();
	spr.palette = makePalette(seed);
	spr.frames = [];
	for (let i = 0; i < indexed; i++) {
		spr.frames.push(indexedFrame(width, height, seed * 101 + i));
	}
	for (let i = 0; i < rgba; i++) {
		spr.frames.push(rgbaFrame(width, height, seed * 103 + i));
	}
	spr.indexed_count = indexed;
	spr._indexed_count = indexed;
	spr.rgba_count = rgba;
	spr.rgba_index = indexed;
	if (toRgba) {
		spr.switchToRGBA(); // Client.loadFile(..., { to_rgba: true })
	}
	return spr;
}

const layer = (index, pos, extra = {}) => ({
	pos,
	index,
	is_mirror: 0,
	scale: [1, 1],
	color: [1, 1, 1, 1],
	angle: 0,
	spr_type: 0,
	width: 0,
	height: 0,
	...extra
});

/** Compiled ACT (Loaders/Action.js shape): `actions` actions × 8 directions. */
function makeAct({
	actions: actionCount = PC_ACTIONS,
	framesOf = a => (a === 0 ? 3 : a === 1 ? WALK_FRAMES : ATTACK_FRAMES),
	delayOf = () => 100,
	layersOf,
	anchorOf = () => ({ x: 0, y: 0 })
}) {
	const actions = [];
	for (let a = 0; a < actionCount; ++a) {
		for (let d = 0; d < DIRECTIONS; ++d) {
			const animations = [];
			for (let f = 0; f < framesOf(a); ++f) {
				animations.push({ layers: layersOf(a, d, f), sound: -1, pos: [anchorOf(a, d, f)] });
			}
			actions.push({ animations, delay: delayOf(a) });
		}
	}
	return { actions, sounds: [] };
}

/** #64 compensation (as smoke/parity.js): legacy shows entry 0 for index 255, so give entry 0 entry 255's colour. */
export function compensate64(rgba) {
	const out = new Uint8Array(rgba);
	out.set(rgba.subarray(255 * 4, 256 * 4), 0);
	return out;
}

/** #64 control for the gpu-webgpu side: emulate the legacy wrap (index 255 shows entry 0). */
export function wrap64(rgba) {
	const out = new Uint8Array(rgba);
	out.set(rgba.subarray(0, 4), 255 * 4);
	return out;
}

/** Every sprite of the scene: path → SPR spec + ACT. */
function catalog() {
	const list = [];
	const add = (path, spr, act) => list.push({ path, spr, act });

	// PC bodies (indexed, own palette; two indexed layers per frame, an RGBA extra on odd directions, an empty layer).
	for (const [path, seed, w, h] of [
		['data/sprite/body', 11, 44, 90],
		['data/sprite/body2', 12, 40, 96]
	]) {
		add(
			path,
			makeSpr({ indexed: 16, rgba: 2, width: w, height: h, seed }),
			makeAct({
				layersOf: (a, d, f) => [
					layer((a * 5 + d * 2 + f) % 16, [0, -45]),
					layer(-1, [0, 0]),
					...(d % 2 ? [layer(f % 2, [d - 4, -20], { spr_type: 1 })] : [])
				],
				anchorOf: (a, d, f) => ({ x: a === 0 ? 0 : 2 * f, y: -70 })
			})
		);
	}
	add(
		'data/sprite/head',
		makeSpr({ indexed: 8, width: 26, height: 30, seed: 13 }),
		makeAct({ layersOf: (a, d, f) => [layer((f + d) % 8, [0, -70])], anchorOf: () => ({ x: 0, y: -5 }) })
	);
	for (const [n, w, h, y] of [
		[5, 30, 20, -80],
		[6, 28, 24, -92],
		[7, 36, 16, -75]
	]) {
		add(
			`data/sprite/hat${n}`,
			makeSpr({ rgba: 2, width: w, height: h, seed: 20 + n }),
			makeAct({ layersOf: (a, d) => [layer(d % 2, [0, y], { is_mirror: d > 4 ? 1 : 0 })] })
		);
	}
	add(
		'data/sprite/weapon',
		makeSpr({ rgba: 8, width: 50, height: 50, seed: 31 }),
		makeAct({
			layersOf: (a, d, f) => [
				layer(f, [10, -30], { spr_type: 1 }),
				layer(0, [10, -30], { color: [1, 1, 1, 0] }) // alpha 0: legacy skips it (R-SPR-017)
			]
		})
	);
	add(
		'data/sprite/shield',
		makeSpr({ rgba: 1, width: 28, height: 36, seed: 32 }),
		makeAct({ layersOf: () => [layer(0, [-10, -30], { is_mirror: 1 })] })
	);
	add(
		'data/sprite/robe',
		makeSpr({ indexed: 2, width: 60, height: 70, seed: 33 }),
		makeAct({ layersOf: (a, d) => [layer(d % 2, [0, -30])] })
	);
	// Shadow: indexed on disk, loaded with to_rgba (Entity.js:236).
	add(
		'data/sprite/shadow',
		makeSpr({ indexed: 1, width: 28, height: 14, seed: 34, toRgba: true }),
		makeAct({ layersOf: () => [layer(0, [0, 0], { color: [1, 1, 1, 0.5] })] })
	);
	add(
		'data/sprite/cart2',
		makeSpr({ rgba: WALK_FRAMES, width: 40, height: 30, seed: 35 }),
		makeAct({ delayOf: () => 80, layersOf: (a, d, f) => [layer(f, [2, 5])], anchorOf: () => ({ x: 7, y: 3 }) })
	);

	// Mobs (EntityAction.js: IDLE 0, WALK 1, ATTACK 2, HURT 3, DIE 4)
	const MOB_FRAMES = [4, 4, 3, 2, 3];
	const MOB_DELAYS = [120, 100, 75, 100, 100];
	const mobAct = layersOf =>
		makeAct({
			actions: 5,
			framesOf: a => MOB_FRAMES[a],
			delayOf: a => MOB_DELAYS[a],
			layersOf,
			anchorOf: () => ({ x: 0, y: -30 })
		});
	add(
		'data/sprite/mob',
		makeSpr({ rgba: 16, width: 70, height: 60, seed: 41 }),
		mobAct((a, d, f) => [
			layer((a * 3 + f) % 16, [d - 4, -20], { scale: [1.2, 0.8], color: [1, 0.5, 0.5, 0.9] }),
			layer(f, [3, -10], { is_mirror: 1, angle: 15, spr_type: 1 })
		])
	);
	add(
		'data/sprite/mob2',
		makeSpr({ indexed: 12, width: 100, height: 120, seed: 42 }),
		mobAct((a, d, f) => [layer((a * 2 + f + d) % 12, [0, -50], { is_mirror: d > 4 ? 1 : 0 })])
	);
	add(
		'data/sprite/boss',
		makeSpr({ indexed: 6, rgba: 2, width: 200, height: 180, seed: 43 }),
		mobAct((a, d, f) => [
			layer((a + f) % 6, [0, -80], { scale: [1.1, 1.1] }),
			layer(f % 2, [30, -120], { spr_type: 1, angle: 20 * d, color: [1, 1, 1, 0.7] })
		])
	);
	// NPC (IDLE 0, WALK 1): RGBA, ACT idle delay 0 (150 ms default)
	add(
		'data/sprite/npc',
		makeSpr({ rgba: 8, width: 36, height: 72, seed: 44 }),
		makeAct({
			actions: 2,
			framesOf: a => (a === 0 ? 2 : 4),
			delayOf: a => (a === 0 ? 0 : 120),
			layersOf: (a, d, f) => [layer(a * 4 + f, [0, -30 - d])],
			anchorOf: () => ({ x: 0, y: -50 })
		})
	);

	// Status attachments (EntityState.js), RGBA, loaded with to_rgba: one ACT action per direction.
	const attachment = (file, { frames, delay = 100, seed, layersOf }) =>
		add(
			`${ATTACHMENT_DIR}${file}`,
			makeSpr({ rgba: 8 * frames, width: 32, height: 32, seed }),
			makeAct({
				actions: 1,
				framesOf: () => frames,
				delayOf: () => delay,
				layersOf: (a, d, f) => layersOf(d, f, d * frames + f)
			})
		);
	attachment('\xbe\xf3\xc0\xbd\xb6\xaf', {
		frames: 4,
		seed: 51,
		layersOf: (d, f, i) => [layer(i, [0, -20 + f], { color: [0.8, 0.9, 1, 0.9] })]
	});
	attachment('status-sleep', { frames: 3, delay: 120, seed: 52, layersOf: (d, f, i) => [layer(i, [2, -10])] });
	attachment('status-stun', {
		frames: 4,
		delay: 90,
		seed: 53,
		layersOf: (d, f, i) => [layer(i, [-3, -12], { scale: [0.8, 0.8] }), layer(-1, [0, 0])]
	});
	attachment('status-curse', {
		frames: 2,
		delay: 150,
		seed: 54,
		layersOf: (d, f, i) => [layer(i, [d, -8], { is_mirror: d > 4 ? 1 : 0 })]
	});
	return list;
}

/** External palettes (body/head dyes): DB.getBodyPalPath / getHeadPalPath. */
const PAL_FILES = [
	['data/palette/body_1.pal', 61],
	['data/palette/body_2.pal', 62],
	['data/palette/body_3.pal', 63],
	['data/palette/head_1.pal', 64],
	['data/palette/head_2.pal', 65]
];

export function uploadPalette(gl, texture, rgba) {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
}

/**
 * Build every asset, upload it to the legacy context as Core/Client.js does, and
 * expose the gpu-webgpu side: GL texture → residency handle maps and the
 * upload-on-miss source over the same raw frames and palettes.
 *
 * @param {WebGL2RenderingContext} gl  Legacy context
 * @param {{pixelPerfectSprites?: boolean, compensate?: boolean}} [options]
 */
export function buildAssets(gl, { pixelPerfectSprites = false, compensate = true } = {}) {
	/** @type {Map<string, object>} path → compiled asset (legacy Memory) */
	const files = new Map();
	/** @type {Map<WebGLTexture, string>} */
	const textureHandles = new Map();
	/** @type {Map<WebGLTexture, string>} */
	const paletteHandles = new Map();
	/** @type {Map<string, {frame: object, palette: Uint8Array}>} handle → raw frame */
	const rawFrames = new Map();
	/** @type {Map<string, Uint8Array>} handle → raw palette */
	const rawPalettes = new Map();
	const counts = { sprites: 0, frames: 0, palettes: 0 };

	for (const { path, spr, act } of catalog()) {
		const data = spr.compile();
		// Core/Client.js:313-351
		data.frames.forEach((frame, i) => {
			frame.texture = gl.createTexture();
			const precision = pixelPerfectSprites ? gl.NEAREST : frame.type ? gl.LINEAR : gl.NEAREST;
			const format = frame.type ? gl.RGBA : gl.LUMINANCE;
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.bindTexture(gl.TEXTURE_2D, frame.texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, format, frame.width, frame.height, 0, format, gl.UNSIGNED_BYTE, frame.data);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, precision);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, precision);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			const handle = `${path}#${i}`;
			textureHandles.set(frame.texture, handle);
			rawFrames.set(handle, { frame: spr.frames[i], palette: spr.palette });
			counts.frames++;
		});
		if (data.rgba_index !== 0) {
			data.texture = gl.createTexture();
			uploadPalette(gl, data.texture, compensate ? compensate64(data.palette) : data.palette);
			const handle = `${path}:pal`;
			paletteHandles.set(data.texture, handle);
			rawPalettes.set(handle, spr.palette);
			counts.palettes++;
		}
		files.set(`${path}.spr`, data);
		files.set(`${path}.act`, act);
		counts.sprites++;
	}
	for (const [path, seed] of PAL_FILES) {
		const palette = makePalette(seed);
		const texture = gl.createTexture();
		uploadPalette(gl, texture, compensate ? compensate64(palette) : palette);
		files.set(path, { palette, texture });
		paletteHandles.set(texture, path);
		rawPalettes.set(path, palette);
		counts.palettes++;
	}

	return {
		files,
		counts,
		textureHandle: texture => textureHandles.get(texture) ?? null,
		paletteHandle: texture => paletteHandles.get(texture) ?? null,
		/**
		 * Residency upload-on-miss source (FrameSourcePort) over the raw frames.
		 * @param {{wrapPalettes?: boolean}} [opts]  wrapPalettes: the #64 control (legacy wrap emulated)
		 */
		source({ wrapPalettes = false } = {}) {
			const decoded = new Map();
			return {
				decodes: decoded,
				frame(handle) {
					const raw = rawFrames.get(handle);
					if (!raw) {
						return null;
					}
					const image = decodeSprFrame(raw.frame, raw.palette);
					decoded.set(handle, image);
					return image;
				},
				palette(handle) {
					const rgba = rawPalettes.get(handle);
					return rgba ? (wrapPalettes ? wrap64(rgba) : rgba) : null;
				}
			};
		}
	};
}
