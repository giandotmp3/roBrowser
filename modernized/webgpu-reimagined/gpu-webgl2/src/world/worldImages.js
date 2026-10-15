import { GRID_SELECTOR, GROUND_ATLAS_CELL, GROUND_TEXTURE_SIZE } from '../constants.js';
import { keyedCanvas, unpackViaGl } from '../residency/imageTexture.js';
import { nextPot, potStretchSize } from '../residency/imageKey.js';

/**
 * C-16/C-17 image decode for the world textures (ground atlas, water frames, model
 * textures, grid selector). The MAP_* payloads carry image sources (blob or data
 * URLs, spec §3.2); these helpers turn them into the texels legacy uploads, with the
 * same canvas operations so the browser resamples identically:
 *
 * - `Texture.load`: the decoded image at its natural size on a `willReadFrequently`
 *   canvas, magenta keyed (R-MAP-024) → `ImageDecoderPort.decode`.
 * - `WebGL.texture`: that canvas stretched to the next power of two on a default 2D
 *   canvas (R-MAP-024) → `stretchToPot`, then `potTexels` reads the WebGL unpack.
 * - `Ground.initTextures`: the atlas (R-MAP-005) → `composeGroundAtlas`.
 * - `GridSelector.init`: alpha 0.6, tinted source-atop (R-MAP-021) → `composeGridTexture`.
 */

/**
 * @typedef {Object} ImageDecoderPort
 * @property {(source: unknown) => Promise<(CanvasImageSource & {width: number, height: number})|null>} decode
 *   Legacy `Texture.load`: the keyed natural-size canvas, or null when the source is
 *   missing or fails to decode.
 *
 * @typedef {Object} FilePort  Legacy `Client.loadFile` (grid.tga, animated RSM textures)
 * @property {(path: string) => Promise<unknown>} load  An image source for `decode`, or null
 *
 * @typedef {(width: number, height: number) => HTMLCanvasElement|OffscreenCanvas} CreateCanvas
 */

/** @type {CreateCanvas} */
export function defaultCreateCanvas(width, height) {
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	return new OffscreenCanvas(width, height);
}

/**
 * Default `ImageDecoderPort` for string sources (blob/data/http URLs), as legacy
 * `Texture.load` decodes them: an `Image` (async decoding), drawn at its natural size,
 * magenta keyed. Other sources (TGA ArrayBuffers) go through `decodeOther` when given.
 * Legacy revokes blob URLs once loaded; so does this decoder.
 * @param {{createCanvas?: CreateCanvas, decodeOther?: (source: unknown) => Promise<any>}} [deps]
 * @returns {ImageDecoderPort}
 */
export function createImageDecoder({ createCanvas = defaultCreateCanvas, decodeOther } = {}) {
	return {
		decode(source) {
			if (!source) {
				return Promise.resolve(null);
			}
			if (typeof source !== 'string') {
				return decodeOther ? decodeOther(source) : Promise.resolve(null);
			}
			return new Promise(resolve => {
				const img = new Image();
				img.decoding = 'async';
				img.onload = () => {
					if (source.startsWith('blob:')) {
						URL.revokeObjectURL(source);
					}
					resolve(keyedCanvas(img, createCanvas).canvas);
				};
				img.onerror = () => resolve(null);
				img.src = source;
			});
		}
	};
}

/**
 * Legacy `WebGL.texture`: the keyed canvas stretched to the next power of two in each
 * axis on a default 2D canvas.
 * @param {CanvasImageSource & {width: number, height: number}} keyed
 * @param {CreateCanvas} [createCanvas]
 */
export function stretchToPot(keyed, createCanvas = defaultCreateCanvas) {
	const pot = potStretchSize(keyed.width, keyed.height);
	const canvas = createCanvas(pot.width, pot.height);
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
	ctx.drawImage(/** @type {any} */ (keyed), 0, 0, pot.width, pot.height);
	return canvas;
}

/**
 * The texels `WebGL.texture` uploads for a keyed canvas (stretched, read back
 * through the WebGL unpack, top row first).
 * @param {WebGL2RenderingContext} gl
 * @param {CanvasImageSource & {width: number, height: number}} keyed
 * @param {CreateCanvas} [createCanvas]
 * @returns {import('../residency/Residency.js').ResidentImage}
 */
export function potTexels(gl, keyed, createCanvas = defaultCreateCanvas) {
	const canvas = stretchToPot(keyed, createCanvas);
	return {
		format: 'rgba8',
		width: canvas.width,
		height: canvas.height,
		data: unpackViaGl(gl, /** @type {any} */ (canvas), canvas.width, canvas.height)
	};
}

/**
 * R-MAP-005: grid round(√N) wide of 258 px cells on a POT canvas (`willReadFrequently`,
 * as legacy's shared processing canvas); each texture is drawn stretched to 258 px
 * first (the 1 px border), then at 256 px inside it. Missing textures leave their
 * cell transparent.
 * @param {ReadonlyArray<(CanvasImageSource & {width: number, height: number})|null>} keyed
 * @param {CreateCanvas} [createCanvas]
 */
export function composeGroundAtlas(keyed, createCanvas = defaultCreateCanvas) {
	const count = keyed.length;
	const cols = Math.round(Math.sqrt(count));
	const width = nextPot(cols * GROUND_ATLAS_CELL);
	const height = nextPot(Math.ceil(Math.sqrt(count)) * GROUND_ATLAS_CELL);
	const canvas = createCanvas(width, height);
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
	ctx.clearRect(0, 0, width, height);
	keyed.forEach((image, index) => {
		if (!image) {
			return;
		}
		const x = (index % cols) * GROUND_ATLAS_CELL;
		const y = Math.floor(index / cols) * GROUND_ATLAS_CELL;
		const inner = GROUND_TEXTURE_SIZE;
		ctx.drawImage(/** @type {any} */ (image), x, y, GROUND_ATLAS_CELL, GROUND_ATLAS_CELL);
		ctx.drawImage(/** @type {any} */ (image), x + 1, y + 1, inner, inner);
	});
	return canvas;
}

/**
 * R-MAP-021: grid.tga stretched to POT at alpha 0.6, tinted rgb(50, 240, 160) with a
 * source-atop fill (default 2D canvas, as legacy).
 * @param {CanvasImageSource & {width: number, height: number}} keyed
 * @param {CreateCanvas} [createCanvas]
 */
export function composeGridTexture(keyed, createCanvas = defaultCreateCanvas) {
	const canvas = createCanvas(nextPot(keyed.width), nextPot(keyed.height));
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
	ctx.globalAlpha = GRID_SELECTOR.alpha;
	ctx.drawImage(/** @type {any} */ (keyed), 0, 0, canvas.width, canvas.height);
	ctx.fillStyle = `rgb( ${GRID_SELECTOR.tint.join(', ')})`;
	ctx.globalCompositeOperation = 'source-atop';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	return canvas;
}
