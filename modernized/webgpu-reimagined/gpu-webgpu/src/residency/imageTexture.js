import { applyMagentaKey, potSize } from './imageKey.js';

/** WebGL enums used by `unpackViaGl` (numeric: gpu-webgpu has no GL enum table). */
const GL = Object.freeze({
	TEXTURE_2D: 0x0de1,
	TEXTURE_BINDING_2D: 0x8069,
	FRAMEBUFFER: 0x8d40,
	FRAMEBUFFER_BINDING: 0x8ca6,
	COLOR_ATTACHMENT0: 0x8ce0,
	RGBA: 0x1908,
	UNSIGNED_BYTE: 0x1401
});

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
 * level apart on some translucent texels). With `gl` (any WebGL2 context, e.g. a
 * scratch one), the texels are taken from that same WebGL unpack (a scratch
 * TEXTURE_2D read back through a framebuffer), which makes them identical to
 * legacy's, as gpu-webgl2 does; without it, from `getImageData`. A WebGPU-only
 * client has no GL context: it takes the `getImageData` texels (or
 * `copyExternalImageToTexture`, whose un-premultiply is the browser's again), i.e.
 * possibly one level off legacy on translucent texels of stretched images.
 * Copy of gpu-webgl2's `residency/imageTexture.js` (same decodes, same texels; also the
 * mesh families' tile and self-drawn canvases below).
 *
 * The stretched image goes into the top-left corner of a texture-array layer of its
 * class (max side, 32..512), edge-replicated (TextureArrayPools.padLayer), and the
 * STR/sprite shaders sample uv × (size / class): LINEAR then matches the legacy
 * per-texture LINEAR + CLAMP_TO_EDGE exactly.
 *
 * @param {CanvasImageSource & {width: number, height: number}} image  Decoded image (HTMLImageElement, ImageBitmap, canvas)
 * @param {{createCanvas?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas,
 *   gl?: WebGL2RenderingContext}} [deps]  `gl`: unpack through WebGL, as legacy uploads
 * @returns {import('./SpriteResidency.js').ResidentImage}
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
	const pot = potSize(width, height);
	const stretched = createCanvas(pot.width, pot.height);
	const stretchedCtx = /** @type {CanvasRenderingContext2D} */ (stretched.getContext('2d'));
	stretchedCtx.drawImage(/** @type {any} */ (natural), 0, 0, pot.width, pot.height);
	const data = gl
		? unpackViaGl(gl, stretched, pot.width, pot.height)
		: new Uint8Array(stretchedCtx.getImageData(0, 0, pot.width, pot.height).data.buffer);

	return { format: 'rgba8', width: pot.width, height: pot.height, data };
}

/**
 * Legacy `Texture.load`: the decoded image at its natural size on a `willReadFrequently`
 * canvas, magenta keyed (R-MAP-024).
 * @param {CanvasImageSource & {width: number, height: number}} image
 * @param {(width: number, height: number) => HTMLCanvasElement | OffscreenCanvas} createCanvas
 */
export function keyedCanvas(image, createCanvas) {
	const canvas = createCanvas(image.width, image.height);
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
	ctx.drawImage(image, 0, 0, image.width, image.height);
	const keyed = ctx.getImageData(0, 0, image.width, image.height);
	applyMagentaKey(keyed.data);
	ctx.putImageData(keyed, 0, 0);
	return { canvas, ctx };
}

/**
 * C-16 decode for the ground-tile textures (legacy `Tiles.loadTexture`: FlatTexture,
 * HoveringTexture, LPEffect, SpiderWeb): the keyed image drawn rotated by 180° and
 * stretched into a `size`×`size` canvas (default 2D context), uploaded as is (no wrap
 * set: REPEAT, LINEAR). `size` is the class's power-of-two textureSize (64 or 128), so
 * the image fills its texture-array layer.
 * @param {CanvasImageSource & {width: number, height: number}} image
 * @param {number} size
 * @param {{createCanvas?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas,
 *   gl?: WebGL2RenderingContext}} [deps]
 * @returns {import('./SpriteResidency.js').ResidentImage}
 */
export function decodeTileTexture(image, size, { createCanvas = defaultCanvas, gl } = {}) {
	const { canvas: keyed } = keyedCanvas(image, createCanvas);
	const canvas = createCanvas(size, size);
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
	ctx.save();
	ctx.translate(canvas.width / 2, canvas.height / 2);
	ctx.rotate(Math.PI);
	ctx.translate(-canvas.width / 2, -canvas.height / 2);
	ctx.drawImage(/** @type {any} */ (keyed), 0, 0, size, size);
	ctx.restore();
	const data = gl
		? unpackViaGl(gl, canvas, size, size)
		: new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
	return { format: 'rgba8', width: size, height: size, data };
}

/**
 * C-16 decode for textures legacy uploads straight from the `Texture.load` canvas after
 * drawing that canvas onto itself (SpiritSphere / WarlockSphere `thunder_center.bmp`,
 * unrotated; LockOnTarget `lockon128.tga`, rotated 45° about its centre). Drawing a
 * canvas onto itself composites translucent texels over themselves, so the canvas
 * operations are repeated here exactly. Natural size, no wrap set (REPEAT), LINEAR.
 * @param {CanvasImageSource & {width: number, height: number}} image
 * @param {{rotation?: number|null, createCanvas?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas,
 *   gl?: WebGL2RenderingContext}} [options]  rotation in radians (null: no rotate call)
 * @returns {import('./SpriteResidency.js').ResidentImage}
 */
export function decodeSelfDrawnTexture(image, { rotation = null, createCanvas = defaultCanvas, gl } = {}) {
	const { canvas, ctx } = keyedCanvas(image, createCanvas);
	ctx.save();
	ctx.translate(canvas.width / 2, canvas.height / 2);
	if (rotation !== null) {
		ctx.rotate(rotation);
	}
	ctx.translate(-canvas.width / 2, -canvas.height / 2);
	ctx.drawImage(/** @type {any} */ (canvas), 0, 0);
	ctx.restore();
	const { width, height } = canvas;
	const data = gl
		? unpackViaGl(gl, canvas, width, height)
		: new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
	return { format: 'rgba8', width, height, data };
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
