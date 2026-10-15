import { GL } from '../pipeline/glEnums.js';
import { PALETTE_WIDTH, POT_CLASSES } from '../constants.js';
import { DeviceLimitError } from '../errors.js';

/** Texture units used by the sprite program (11 of the 16 WebGL2 guarantees). */
export const SPRITE_TEXTURE_UNITS = Object.freeze({
	palette: 0,
	indexed: 1, // 1..5: r8 pools by POT class
	rgba: 1 + POT_CLASSES.length // 6..10: rgba8 pools by POT class
});

/**
 * Copy a tightly packed `width`×`height` image into the top-left corner of a
 * `size`×`size` layer and fill the rest by replicating the last column and row.
 * With the frame's texel space unchanged (uv·frameSize), hardware LINEAR and
 * NEAREST over the layer then match a per-frame CLAMP_TO_EDGE texture exactly.
 * @param {ArrayBufferView} data
 * @param {number} width
 * @param {number} height
 * @param {number} size
 * @param {number} channels  1 (r8) or 4 (rgba8)
 * @returns {Uint8Array}
 */
export function padLayer(data, width, height, size, channels) {
	const src = new Uint8Array(data.buffer, data.byteOffset, width * height * channels);
	if (width === size && height === size) {
		return src;
	}
	const out = new Uint8Array(size * size * channels);
	const row = width * channels;
	for (let y = 0; y < size; y++) {
		const sy = Math.min(y, height - 1);
		const dst = y * size * channels;
		out.set(src.subarray(sy * row, sy * row + row), dst);
		const last = dst + row - channels;
		for (let x = width; x < size; x++) {
			out.copyWithin(dst + x * channels, last, last + channels);
		}
	}
	return out;
}

/**
 * GL side of sprite residency (architecture §2.2, critic M3): one immutable
 * TEXTURE_2D_ARRAY per (format, POT class), allocated on first use with
 * `layersPerPool` layers, plus one 256×N RGBA palette table. Implements the
 * `Residency` uploader port; `Residency` owns the free lists.
 */
export class TextureArrayPools {
	/**
	 * @param {{gl: WebGL2RenderingContext, layersPerPool?: number, paletteRows?: number}} deps
	 */
	constructor({ gl, layersPerPool = 64, paletteRows = 256 }) {
		this.gl = gl;
		this.layersPerPool = layersPerPool;
		this.paletteRows = paletteRows;
		/** @type {Map<string, WebGLTexture>} */
		this.textures = new Map();
		this.paletteTexture = null;
		/** @type {{r8: WebGLTexture|null, rgba8: WebGLTexture|null}} 1×1×1 stand-ins for empty classes */
		this._dummies = { r8: null, rgba8: null };
	}

	/**
	 * @param {string} pool  e.g. 'r8:64'
	 * @param {number} size
	 */
	_texture(pool, size) {
		let texture = this.textures.get(pool);
		if (!texture) {
			const r8 = pool.startsWith('r8');
			texture = this._createArray(r8, size, this.layersPerPool);
			this.textures.set(pool, texture);
		}
		return texture;
	}

	_createArray(r8, size, layers) {
		const { gl } = this;
		const texture = gl.createTexture();
		gl.bindTexture(GL.TEXTURE_2D_ARRAY, texture);
		gl.texStorage3D(GL.TEXTURE_2D_ARRAY, 1, r8 ? GL.R8 : GL.RGBA8, size, size, layers);
		// R-SPR-014: indexed frames are NEAREST (the shader filters the palette itself);
		// RGBA frames are LINEAR (pixelPerfectSprites → per-instance texelFetch instead).
		const filter = r8 ? GL.NEAREST : GL.LINEAR;
		gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MAG_FILTER, filter);
		gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
		gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
		return texture;
	}

	/**
	 * Residency uploader port.
	 * @param {string} pool
	 * @param {number} size
	 * @param {number} layer
	 * @param {ArrayBufferView} data  Tightly packed width×height texels
	 * @param {number} [width]
	 * @param {number} [height]
	 */
	allocLayer(pool, size, layer, data, width = size, height = size) {
		const { gl } = this;
		const r8 = pool.startsWith('r8');
		const texture = this._texture(pool, size);
		const pixels = padLayer(data, width, height, size, r8 ? 1 : 4);
		gl.bindTexture(GL.TEXTURE_2D_ARRAY, texture);
		gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
		gl.texSubImage3D(
			GL.TEXTURE_2D_ARRAY,
			0,
			0,
			0,
			layer,
			size,
			size,
			1,
			r8 ? GL.RED : GL.RGBA,
			GL.UNSIGNED_BYTE,
			pixels
		);
	}

	/**
	 * Residency uploader port: one 256×1 RGBA row of the palette table.
	 * @param {number} row
	 * @param {Uint8Array} rgba
	 */
	uploadPalette(row, rgba) {
		const { gl } = this;
		if (row >= this.paletteRows) {
			throw new DeviceLimitError('paletteRows', row + 1, this.paletteRows);
		}
		if (!this.paletteTexture) {
			this.paletteTexture = gl.createTexture();
			gl.bindTexture(GL.TEXTURE_2D, this.paletteTexture);
			gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, PALETTE_WIDTH, this.paletteRows);
			gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
			gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
			gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
			gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
		}
		gl.bindTexture(GL.TEXTURE_2D, this.paletteTexture);
		gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
		gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, row, PALETTE_WIDTH, 1, GL.RGBA, GL.UNSIGNED_BYTE, rgba);
	}

	_dummy(format) {
		if (!this._dummies[format]) {
			const r8 = format === 'r8';
			this._dummies[format] = this._createArray(r8, 1, 1);
			this.gl.texSubImage3D(
				GL.TEXTURE_2D_ARRAY,
				0,
				0,
				0,
				0,
				1,
				1,
				1,
				r8 ? GL.RED : GL.RGBA,
				GL.UNSIGNED_BYTE,
				new Uint8Array(r8 ? 1 : 4)
			);
		}
		return this._dummies[format];
	}

	/** Bind the palette table and every class pool to the units in SPRITE_TEXTURE_UNITS. */
	bind() {
		const { gl } = this;
		if (!this.paletteTexture) {
			this.uploadPalette(0, new Uint8Array(PALETTE_WIDTH * 4));
		}
		// Resolve every texture first: creating a dummy binds it, which must not
		// clobber a unit that is already set up.
		const arrays = POT_CLASSES.flatMap(size =>
			['r8', 'rgba8'].map(format => this.textures.get(`${format}:${size}`) ?? this._dummy(format))
		);
		gl.activeTexture(GL.TEXTURE0 + SPRITE_TEXTURE_UNITS.palette);
		gl.bindTexture(GL.TEXTURE_2D, this.paletteTexture);
		POT_CLASSES.forEach((_, i) => {
			gl.activeTexture(GL.TEXTURE0 + SPRITE_TEXTURE_UNITS.indexed + i);
			gl.bindTexture(GL.TEXTURE_2D_ARRAY, arrays[2 * i]);
			gl.activeTexture(GL.TEXTURE0 + SPRITE_TEXTURE_UNITS.rgba + i);
			gl.bindTexture(GL.TEXTURE_2D_ARRAY, arrays[2 * i + 1]);
		});
		gl.activeTexture(GL.TEXTURE0);
	}

	/** R-CTX-006: the context dropped every texture; forget the handles. */
	purge() {
		this.textures.clear();
		this.paletteTexture = null;
		this._dummies = { r8: null, rgba8: null };
	}

	/** Release GPU memory (backend dispose). */
	dispose() {
		for (const texture of [...this.textures.values(), this.paletteTexture, ...Object.values(this._dummies)]) {
			if (texture) {
				this.gl.deleteTexture(texture);
			}
		}
		this.purge();
	}
}
