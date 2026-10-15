/**
 * Synthetic textures of the effects2 parity page (mesh effect families), as PNG data
 * URLs (port of gpu-webgl2/smoke/effects2/assets.js: same images, same decodes). Legacy loads
 * each one through its own real upload path; gpu-webgpu decodes the
 * same image through the matching C-16 decode (residency upload on miss):
 *
 * | handle                 | legacy path                                                      | decode                     |
 * | ---------------------- | ---------------------------------------------------------------- | -------------------------- |
 * | `img:<name>`           | `Utils/WebGL.texture` (Texture.load, POT stretch, CLAMP)         | decodeImageTexture         |
 * | `tile:<name>:<size>`   | `Tiles.loadTexture` (180° rotation into size², REPEAT)           | decodeTileTexture          |
 * | `self:<name>:<deg>`    | Texture.load canvas drawn onto itself (spheres 0, lock-on 45°)   | decodeSelfDrawnTexture     |
 * | `raw:puddle`           | RainWeather `ensurePuddleFrame` (procedural 64×64, CLAMP)        | the same generator         |
 *
 * Looks: `png` alpha ramp with holes; `bmp` opaque with magenta (keyed) and black
 * blocks; `bright` every channel ≥ 0.5 (rings and LP/spider-web discard darker texels)
 * with an alpha ramp; `light` channels ≥ 0.1, opaque.
 */
import { rng } from '../entities/assets.js';
import { decodeImageTexture, decodeSelfDrawnTexture, decodeTileTexture } from '../../src/residency/imageTexture.js';

/** name (under data/texture/) → size and look. */
export const IMAGES = Object.freeze({
	// WebGL.texture images (cylinder, quadhorn, auras, rings, magic target, RSM, waterfall)
	'effect/ring_blue.tga': { width: 60, height: 40, look: 'png', seed: 101 },
	'effect/magic_green.tga': { width: 48, height: 48, look: 'png', seed: 102 },
	'effect/cyl_repeat.tga': { width: 64, height: 64, look: 'png', seed: 103 },
	'effect/cyl_wide.tga': { width: 100, height: 30, look: 'png', seed: 104 },
	'effect/ice.tga': { width: 40, height: 56, look: 'png', seed: 105 },
	'effect/stone.bmp': { width: 50, height: 30, look: 'bmp', seed: 106 },
	'effect/pikapika2.bmp': { width: 64, height: 64, look: 'png', seed: 107 },
	'effect/whitelight.tga': { width: 32, height: 32, look: 'png', seed: 108 },
	'effect/ring_red.tga': { width: 64, height: 32, look: 'bright', seed: 109 },
	'effect/ring_yellow.tga': { width: 50, height: 50, look: 'bright', seed: 110 },
	'effect/ring_jadu.tga': { width: 80, height: 40, look: 'bright', seed: 111 },
	'effect/magic_target.tga': { width: 64, height: 64, look: 'light', seed: 112 },
	'effect/ice.bmp': { width: 32, height: 32, look: 'bmp', seed: 113 },
	'effect/fire.bmp': { width: 40, height: 20, look: 'png', seed: 114 },
	'effect/waterfall11.tga': { width: 64, height: 128, look: 'png', seed: 115 },
	'effect/waterfall12.tga': { width: 64, height: 128, look: 'png', seed: 116 },
	'effect/waterfall13.tga': { width: 64, height: 128, look: 'png', seed: 117 },
	'effect/waterfall31.tga': { width: 48, height: 96, look: 'bmp', seed: 118 },
	'effect/waterfall32.tga': { width: 48, height: 96, look: 'bmp', seed: 119 },
	'effect/waterfall33.tga': { width: 48, height: 96, look: 'bmp', seed: 120 },
	'effect/freeze_a_small.bmp': { width: 16, height: 16, look: 'png', seed: 121 },
	// Tiles.loadTexture images (square power-of-two after the stretch)
	'effect/plain.bmp': { width: 40, height: 40, look: 'light', seed: 131 },
	'effect/big.bmp': { width: 90, height: 70, look: 'light', seed: 132 },
	'effect/lens_w.bmp': { width: 50, height: 30, look: 'light', seed: 133 },
	'effect/zz.bmp': { width: 64, height: 64, look: 'bmp', seed: 134 },
	'effect/aaa copy.bmp': { width: 60, height: 60, look: 'bright', seed: 135 },
	'effect/spiderweb.tga': { width: 100, height: 100, look: 'bright', seed: 136 },
	// Self-drawn canvases (natural size, power-of-two squares so REPEAT matches a layer)
	'effect/thunder_center.bmp': { width: 64, height: 64, look: 'png', seed: 141 },
	'effect/lockon128.tga': { width: 128, height: 128, look: 'png', seed: 142 }
});

/** Tile textures by file (Tiles.FlatTexture / HoveringTexture / LPEffect / SpiderWeb `textureSize`). */
export const TILE_SIZES = Object.freeze({
	'effect/plain.bmp': 64,
	'effect/big.bmp': 128,
	'effect/lens_w.bmp': 64,
	'effect/zz.bmp': 64,
	'effect/aaa copy.bmp': 64,
	'effect/spiderweb.tga': 128
});

/** Self-drawn canvases: file → rotation (legacy expression), null when legacy does not rotate. */
export const SELF_DRAWN = Object.freeze({
	'effect/thunder_center.bmp': null,
	'effect/lockon128.tga': (45 / 180) * Math.PI
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
			const dx = u - 0.5;
			const dy = v - 0.5;
			const d = Math.sqrt(dx * dx + dy * dy);
			let r = Math.floor(40 + 215 * u);
			let g = Math.floor(40 + 215 * v);
			let b = Math.floor(random() * 256);
			let a = 255;
			if (look === 'bmp') {
				if (block === 0) {
					[r, g, b] = [255, 0, 255];
				} else if (block === 5) {
					[r, g, b] = [0, 0, 0];
				} else if (block === 7) {
					[r, g, b] = [250, 10, 240];
				}
			} else if (look === 'png') {
				a = d > 0.5 || block === 3 ? 0 : Math.round(255 * Math.min(1, (0.55 - d) * 2.2));
			} else if (look === 'bright') {
				r = 110 + Math.floor(145 * u);
				g = 110 + Math.floor(145 * (1 - v));
				b = 100 + Math.floor(random() * 156);
				a = block === 3 ? 0 : Math.round(255 * Math.min(1, Math.max(0.2, (0.6 - d) * 2)));
			} else {
				r = 20 + Math.floor(235 * u);
				g = 20 + Math.floor(235 * v);
				b = 20 + Math.floor(random() * 236);
				if (block === 6) {
					[r, g, b] = [10, 200, 120]; // a channel below 0.1: discarded by the 0.1 shaders
				}
			}
			data.set([r, g, b, a], p);
		}
	}
	return new ImageData(data, width, height);
}

function toDataUrl(spec) {
	const canvas = document.createElement('canvas');
	canvas.width = spec.width;
	canvas.height = spec.height;
	canvas.getContext('2d').putImageData(paint(spec), 0, 0);
	return canvas.toDataURL('image/png');
}

async function loadImage(url) {
	const img = new Image();
	img.src = url;
	await img.decode();
	return img;
}

/**
 * Legacy RainWeather `ensurePuddleFrame` texels (64×64 deformed disc, raw RGBA upload).
 * @returns {import('../../src/residency/SpriteResidency.js').ResidentImage}
 */
export function puddleTexels() {
	const w = 64;
	const h = 64;
	const data = new Uint8Array(w * h * 4);
	const cx = (w - 1) / 2;
	const cy = (h - 1) / 2;
	const maxR = Math.min(cx, cy) * 0.85;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const angle = Math.atan2(dy, dx);
			const deform =
				1.0 + 0.15 * Math.sin(angle * 5) + 0.08 * Math.sin(angle * 3 + 1.5) + 0.05 * Math.cos(angle * 11);
			const r = dist / (maxR * deform);
			let a = 0;
			if (r <= 1.0) {
				a = Math.pow(1.0 - r, 0.7);
			}
			const alphaByte = Math.max(0, Math.min(255, Math.floor(a * 255)));
			const idx = (y * w + x) * 4;
			data[idx + 0] = 18;
			data[idx + 1] = 32;
			data[idx + 2] = 55;
			data[idx + 3] = alphaByte;
		}
	}
	return { format: 'rgba8', width: w, height: h, data };
}

/**
 * Build every image. Legacy textures are created later by the real classes.
 * @param {{unpackGl?: WebGL2RenderingContext}} [options]  scratch WebGL2 context (texels through its unpack, as legacy uploads them)
 */
export async function buildEffect2Assets({ unpackGl } = {}) {
	/** @type {Map<string, string>} name → data URL */
	const urls = new Map();
	/** @type {Map<string, HTMLImageElement>} */
	const images = new Map();
	for (const [name, spec] of Object.entries(IMAGES)) {
		const url = toDataUrl(spec);
		urls.set(name, url);
		images.set(name, await loadImage(url));
	}
	/** @type {Map<unknown, string>} legacy texture → residency handle */
	const handles = new Map();
	const decodes = new Set();
	return {
		urls,
		images,
		handles,
		/** Legacy texture → handle; textures created outside WebGL.texture are known by family. */
		textureHandle(texture, family) {
			if (!texture) {
				return null;
			}
			const known = handles.get(texture);
			if (known) {
				return known;
			}
			if (family === 'spirit-sphere' || family === 'warlock-sphere') {
				return 'self:effect/thunder_center.bmp';
			}
			if (family === 'lock-on') {
				return 'self:effect/lockon128.tga';
			}
			if (family === 'rainPuddle') {
				return 'raw:puddle';
			}
			return null;
		},
		counts: { images: images.size },
		source: {
			decodes,
			frame(handle) {
				if (typeof handle !== 'string') {
					return null;
				}
				decodes.add(handle);
				const [kind, name] = [handle.slice(0, handle.indexOf(':')), handle.slice(handle.indexOf(':') + 1)];
				if (kind === 'raw' && name === 'puddle') {
					return puddleTexels();
				}
				const image = images.get(name);
				if (!image) {
					return null;
				}
				if (kind === 'img') {
					return decodeImageTexture(image, { gl: unpackGl });
				}
				if (kind === 'tile') {
					return decodeTileTexture(image, TILE_SIZES[name], { gl: unpackGl });
				}
				if (kind === 'self') {
					return decodeSelfDrawnTexture(image, { rotation: SELF_DRAWN[name], gl: unpackGl });
				}
				return null;
			},
			palette() {
				return null;
			}
		}
	};
}
