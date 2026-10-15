/**
 * Synthetic assets of the effect parity page: images (STR materials and 2D/3D
 * EffectTable textures) and the SPR/ACT of the sprite-backed 3D effects.
 *
 * Images are PNG data URLs drawn here. Both sides start from the same URL:
 * - legacy: the real `Utils/WebGL.texture` (→ the real `Utils/Texture.load`: magenta
 *   key, then a stretch to POT on a 2D canvas) uploads a TEXTURE_2D per image, as
 *   Core/Client.js does for STR materials and ThreeDEffect/TwoDEffect.init for theirs;
 * - gpu-webgl2: residency uploads on miss through `decodeImageTexture` (C-16) from
 *   the same decoded image.
 * STR materials are BMP-like (opaque, magenta key, pure-black texels for the
 * R-EFX-009 discard); 2D/3D images are PNG-like (alpha ramps and holes).
 *
 * SPRs are real legacy `Loaders/Sprite.js` objects (entities/assets.js `makeSpr`),
 * compiled and uploaded as `Core/Client.js:313-351` does; gpu-webgl2 decodes the same
 * raw frames (`decodeSprFrame`). Palettes get the #64 compensation (entry 0 = entry
 * 255 on the legacy upload), as on the entity pages.
 */
import { compensate64, makeSpr, rng, uploadPalette } from '../entities/assets.js';
import { decodeSprFrame } from '../../src/residency/spriteFrames.js';
import { decodeImageTexture } from '../../src/residency/imageTexture.js';

/** 'data/sprite/이펙트/' in CP949 bytes (ThreeDEffect spriteName path). */
export const EFFECT_SPRITE_DIR = 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/';

/**
 * Image catalog: name → size and look. `bmp`: opaque with magenta and black blocks;
 * `png`: radial alpha ramp with transparent holes; `plain`: opaque, no black, no
 * magenta (the CPU fog check needs every texel kept).
 */
export const IMAGES = Object.freeze({
	// STR materials (Loaders/Str.js texname → Client.loadFile → WebGL.texture)
	'str/m0': { width: 50, height: 40, look: 'bmp', seed: 1 },
	'str/m1': { width: 64, height: 64, look: 'bmp', seed: 2 },
	'str/m2': { width: 30, height: 90, look: 'bmp', seed: 3 },
	'str/m3': { width: 128, height: 20, look: 'bmp', seed: 4 },
	'str/b0': { width: 48, height: 48, look: 'bmp', seed: 5 },
	'str/b1': { width: 60, height: 36, look: 'bmp', seed: 6 },
	'str/b2': { width: 40, height: 40, look: 'bmp', seed: 7 },
	'str/b3': { width: 70, height: 50, look: 'bmp', seed: 8 },
	'str/b4': { width: 32, height: 32, look: 'bmp', seed: 9 },
	'str/b5': { width: 90, height: 30, look: 'bmp', seed: 10 },
	'str/b6': { width: 45, height: 45, look: 'bmp', seed: 18 },
	'str/l0': { width: 36, height: 36, look: 'bmp', seed: 11 },
	'str/l1': { width: 36, height: 36, look: 'bmp', seed: 12 },
	'str/h0': { width: 52, height: 30, look: 'bmp', seed: 13 },
	'str/h1': { width: 52, height: 30, look: 'bmp', seed: 14 },
	'str/k0': { width: 24, height: 60, look: 'bmp', seed: 15 },
	'str/f0': { width: 40, height: 40, look: 'bmp', seed: 16 },
	'str/f2': { width: 40, height: 40, look: 'bmp', seed: 17 },
	'str/f3': { width: 200, height: 100, look: 'bmp', seed: 19 },
	'str/fog': { width: 80, height: 60, look: 'plain', seed: 20 },
	// 2D/3D EffectTable textures (data/texture/effect/*)
	'effect/a.tga': { width: 40, height: 24, look: 'png', seed: 31 },
	'effect/b.tga': { width: 100, height: 60, look: 'png', seed: 32 },
	'effect/c.tga': { width: 33, height: 70, look: 'png', seed: 33 },
	'effect/f0.tga': { width: 16, height: 16, look: 'png', seed: 34 },
	'effect/f1.tga': { width: 24, height: 12, look: 'png', seed: 35 },
	'effect/f2.tga': { width: 20, height: 20, look: 'bmp', seed: 36 }
});

/** RGBA pixels of one catalog image. */
function paint({ width, height, look, seed }) {
	const random = rng(seed);
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const p = (y * width + x) * 4;
			const u = (x + 0.5) / width;
			const v = (y + 0.5) / height;
			const block = ((x >> 3) + (y >> 3) * 3 + seed) % 11;
			let r = Math.floor(40 + 215 * u);
			let g = Math.floor(40 + 215 * v);
			let b = Math.floor(random() * 256);
			let a = 255;
			if (look === 'bmp') {
				if (block === 0) {
					[r, g, b] = [255, 0, 255]; // magenta key (R-MAP-024)
				} else if (block === 5) {
					[r, g, b] = [0, 0, 0]; // pure black: STR discard (R-EFX-009)
				} else if (block === 7) {
					[r, g, b] = [250, 10, 240]; // near-magenta: keyed too (r > 230, g < 20, b > 230)
				}
			} else if (look === 'png') {
				const dx = u - 0.5;
				const dy = v - 0.5;
				const d = Math.sqrt(dx * dx + dy * dy);
				a = d > 0.5 || block === 3 ? 0 : Math.round(255 * Math.min(1, (0.55 - d) * 2.2));
			} else {
				b = 60 + Math.floor(random() * 160);
			}
			data.set([r, g, b, a], p);
		}
	}
	return new ImageData(data, width, height);
}

/** PNG data URL of one catalog image. */
function toDataUrl(spec) {
	const canvas = document.createElement('canvas');
	canvas.width = spec.width;
	canvas.height = spec.height;
	canvas.getContext('2d').putImageData(paint(spec), 0, 0);
	return canvas.toDataURL('image/png');
}

/** Decoded <img> of a URL. */
async function loadImage(url) {
	const img = new Image();
	img.src = url;
	await img.decode();
	return img;
}

/**
 * Raw sprite catalog of the sprite-backed 3D effects: path → SPR (raw, compiled later) + ACT.
 * ACT layers follow EffectTable sprites (scale in percent, as ThreeDEffect reads it).
 */
function sprites() {
	const layer = fields => ({
		index: 0,
		spr_type: 0,
		scale: [100, 100],
		is_mirror: false,
		color: [1, 1, 1, 1],
		angle: 0,
		pos: [0, 0],
		...fields
	});
	return [
		{
			// Indexed shadow (ThreeDEffect shadowTexture).
			path: 'data/sprite/shadow',
			spr: makeSpr({ indexed: 1, width: 24, height: 12, seed: 51 }),
			act: { actions: [{ delay: 100, animations: [{ pos: [], layers: [layer({ pos: [0, 1] })] }] }] }
		},
		{
			// absoluteSpriteName + to_rgba: every frame RGBA (rgba_index 0), spr_type 1 layers
			// offset by old_rgba_index.
			path: 'data/sprite/fx/abs',
			spr: makeSpr({ indexed: 2, rgba: 2, width: 32, height: 40, seed: 52, toRgba: true }),
			act: {
				actions: [0, 1, 2].map(a => ({
					delay: 60 + a * 10,
					animations: [0, 1, 2].map(f => ({
						pos: f === 1 ? [] : [{ x: 3 + a, y: -2 - f }],
						layers: [
							layer({ index: f % 2, angle: 10 + f, pos: [2, -4], color: [1, 0.5, 0.25, 0.8] }),
							layer({
								index: 1,
								spr_type: 1,
								scale: [50, 150],
								is_mirror: true,
								angle: 25,
								pos: [-6, 3]
							}),
							layer({ index: 3, angle: -5, color: [0.5, 1, 1, 0.5] })
						]
					}))
				}))
			}
		},
		{
			// spriteName: indexed frames with a palette (rgba_index 2), spr_type 0 layers on
			// the indexed frames only (see README: a spr_type 0 layer on an RGBA frame of a
			// mixed SPR goes through the palette path in legacy).
			path: `${EFFECT_SPRITE_DIR}fx2`,
			spr: makeSpr({ indexed: 2, rgba: 2, width: 20, height: 30, seed: 53 }),
			act: {
				actions: Array.from({ length: 16 }, (_, a) => ({
					delay: 100,
					animations: [
						{
							pos: [{ x: 1, y: 1 }],
							layers: [
								layer({ index: a % 2, angle: 7, pos: [1, 2] }),
								layer({ index: 1, angle: 3, scale: [120, 80], color: [1, 1, 0.6, 0.9] })
							]
						}
					]
				}))
			}
		}
	];
}

/**
 * Build every asset. Legacy textures are created later by the page (real
 * WebGL.texture for images); SPRs are compiled and uploaded here.
 *
 * @param {WebGL2RenderingContext} gl  Legacy context
 * @param {{unpackGl?: WebGL2RenderingContext}} [options]  gpu-webgl2 context: image texels
 *   through its WebGL unpack, as legacy uploads them (decodeImageTexture)
 */
export async function buildEffectAssets(gl, { unpackGl } = {}) {
	/** @type {Map<string, string>} image name → data URL */
	const urls = new Map();
	/** @type {Map<string, HTMLImageElement>} image name → decoded image (gpu-webgl2 source) */
	const images = new Map();
	for (const [name, spec] of Object.entries(IMAGES)) {
		const url = toDataUrl(spec);
		urls.set(name, url);
		images.set(name, await loadImage(url));
	}

	/** @type {Map<string, object>} path → compiled asset (legacy Memory) */
	const files = new Map();
	/** @type {Map<WebGLTexture, string>} legacy texture → residency handle */
	const textureHandles = new Map();
	const paletteHandles = new Map();
	const rawFrames = new Map();
	const rawPalettes = new Map();
	for (const { path, spr, act } of sprites()) {
		const data = spr.compile();
		// Core/Client.js:313-351
		data.frames.forEach((frame, i) => {
			frame.texture = gl.createTexture();
			const precision = frame.type ? gl.LINEAR : gl.NEAREST;
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
		});
		if (data.rgba_index !== 0) {
			data.texture = gl.createTexture();
			uploadPalette(gl, data.texture, compensate64(data.palette));
			paletteHandles.set(data.texture, `${path}:pal`);
			rawPalettes.set(`${path}:pal`, spr.palette);
		}
		files.set(`${path}.spr`, data);
		files.set(`${path}.act`, act);
	}

	const decodes = new Set();
	return {
		urls,
		images,
		files,
		/** Register a legacy image texture (created by the real WebGL.texture) under its image name. */
		registerImageTexture(texture, name) {
			textureHandles.set(texture, `img:${name}`);
		},
		textureHandle: texture => (texture ? (textureHandles.get(texture) ?? null) : null),
		paletteHandle: texture => paletteHandles.get(texture) ?? null,
		counts: { images: images.size, sprites: sprites().length, frames: rawFrames.size, palettes: rawPalettes.size },
		/** Residency upload-on-miss source (FrameSourcePort): images and SPR frames. */
		source: {
			decodes,
			frame(handle) {
				if (typeof handle === 'string' && handle.startsWith('img:')) {
					const image = images.get(handle.slice(4));
					decodes.add(handle);
					return image ? decodeImageTexture(image, { gl: unpackGl }) : null;
				}
				const raw = rawFrames.get(handle);
				if (!raw) {
					return null;
				}
				decodes.add(handle);
				return decodeSprFrame(raw.frame, raw.palette);
			},
			palette(handle) {
				return rawPalettes.get(handle) ?? null;
			}
		}
	};
}
