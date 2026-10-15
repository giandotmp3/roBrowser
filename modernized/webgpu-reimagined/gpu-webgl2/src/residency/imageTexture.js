import { GL } from '../pipeline/glEnums.js';
import { applyMagentaKey, potStretchSize } from './imageKey.js';

/**
 * C-16 decode for image textures (STR materials, 2D/3D effect images): the texels
 * legacy `Utils/Texture.load` + `Utils/WebGL.texture` upload, as a residency
 * `ResidentImage` (rgba8, tightly packed) for the upload-on-miss source.
 *
 * Legacy, step by step (reproduced here with the same canvas operations, so the
 * browser resamples identically):
 *  1. Texture.load draws the decoded image at its natural size on a
 *     `willReadFrequently` 2D canvas and keys magenta to transparent black
 *     (R-MAP-024: r > 230, g < 20, b > 230).
 *  2. WebGL.texture draws that canvas **stretched** to the next power of two in
 *     each axis on a default 2D canvas (R-MAP-024: resize, not pad) and uploads it
 *     RGBA, LINEAR, CLAMP_TO_EDGE (no mipmaps unless `enableMipmap`).
 *
 * Unpack: legacy uploads the stretched canvas with `texImage2D(canvas)`
 * (UNPACK_PREMULTIPLY_ALPHA false), so the browser un-premultiplies the canvas
 * pixels; `getImageData` un-premultiplies with a different rounding (Chromium: one
 * level apart on some translucent texels). With `gl`, the texels are taken from that
 * same WebGL unpack (a scratch TEXTURE_2D read back through a framebuffer), which
 * makes them identical to legacy's; without it, from `getImageData`.
 *
 * The stretched image goes into the top-left corner of a texture-array layer of its
 * class (max side, 32..512), edge-replicated (TextureArrayPools.padLayer), and the
 * STR/sprite shaders sample uv × (size / class): LINEAR then matches the legacy
 * per-texture LINEAR + CLAMP_TO_EDGE exactly.
 *
 * @param {CanvasImageSource & {width: number, height: number}} image  Decoded image (HTMLImageElement, ImageBitmap, canvas)
 * @param {{createCanvas?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas,
 *   gl?: WebGL2RenderingContext}} [deps]  `gl`: unpack through WebGL, as legacy uploads
 * @returns {import('./Residency.js').ResidentImage}
 */
export function decodeImageTexture(image, { createCanvas = defaultCanvas, gl } = {}) {
	const width = image.width;
	const height = image.height;

	// 1. Texture.load: natural size, magenta key.
	const natural = createCanvas(width, height);
	const naturalCtx = /** @type {CanvasRenderingContext2D} */ (natural.getContext('2d', { willReadFrequently: true }));
	naturalCtx.drawImage(image, 0, 0, width, height);
	const keyed = naturalCtx.getImageData(0, 0, width, height);
	applyMagentaKey(keyed.data);
	naturalCtx.putImageData(keyed, 0, 0);

	// 2. WebGL.texture: stretch to POT.
	const pot = potStretchSize(width, height);
	const stretched = createCanvas(pot.width, pot.height);
	const stretchedCtx = /** @type {CanvasRenderingContext2D} */ (stretched.getContext('2d'));
	stretchedCtx.drawImage(/** @type {any} */ (natural), 0, 0, pot.width, pot.height);
	const data = gl
		? unpackViaGl(gl, stretched, pot.width, pot.height)
		: new Uint8Array(stretchedCtx.getImageData(0, 0, pot.width, pot.height).data.buffer);

	return { format: 'rgba8', width: pot.width, height: pot.height, data };
}

/**
 * The texels WebGL stores for `texImage2D(RGBA, UNSIGNED_BYTE, source)` with the
 * default unpack state: upload to a scratch texture and read it back. Restores the
 * TEXTURE_2D binding of the active unit and the framebuffer binding.
 * @param {WebGL2RenderingContext} gl
 * @param {TexImageSource} source
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} width×height RGBA, rows in upload order (top first)
 */
export function unpackViaGl(gl, source, width, height) {
	const previousTexture = gl.getParameter(GL.TEXTURE_BINDING_2D);
	const previousFramebuffer = gl.getParameter(GL.FRAMEBUFFER_BINDING);
	const texture = gl.createTexture();
	const framebuffer = gl.createFramebuffer();
	const out = new Uint8Array(width * height * 4);
	try {
		gl.bindTexture(GL.TEXTURE_2D, texture);
		gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, /** @type {any} */ (source));
		gl.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
		gl.readPixels(0, 0, width, height, GL.RGBA, GL.UNSIGNED_BYTE, out);
	} finally {
		gl.bindFramebuffer(GL.FRAMEBUFFER, previousFramebuffer);
		gl.bindTexture(GL.TEXTURE_2D, previousTexture);
		gl.deleteFramebuffer(framebuffer);
		gl.deleteTexture(texture);
	}
	return out;
}

/**
 * @param {number} width
 * @param {number} height
 */
function defaultCanvas(width, height) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}
