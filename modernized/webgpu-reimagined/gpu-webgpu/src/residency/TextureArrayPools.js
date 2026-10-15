import { PALETTE_WIDTH, POT_CLASSES } from '../constants.js';
import { DeviceLimitError } from '../errors.js';

/** GPUTextureUsage bits (numeric so Node tests need no WebGPU globals). */
const USAGE = Object.freeze({ COPY_DST: 0x02, TEXTURE_BINDING: 0x04 });

const GPU_FORMAT = Object.freeze({ r8: 'r8unorm', rgba8: 'rgba8unorm' });

/**
 * Copy a tightly packed `width`×`height` image into the top-left corner of a
 * `size`×`size` layer and fill the rest by replicating the last column and row.
 * With the frame's texel space unchanged (uv·frameSize), hardware LINEAR and
 * NEAREST over the layer then match a per-frame CLAMP_TO_EDGE texture exactly.
 * (Same as gpu-webgl2 TextureArrayPools.padLayer.)
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
 * GPU side of sprite residency (architecture §2.2 "Residency"): one
 * texture_2d_array per (format, POT class), created on first use with
 * `layersPerPool` layers, plus one 256×N rgba8unorm palette table. Uploads go
 * through `queue.writeTexture`. Implements the SpriteResidency uploader port.
 */
export class TextureArrayPools {
	/**
	 * @param {{device: GPUDevice, layersPerPool?: number, paletteRows?: number}} deps
	 */
	constructor({ device, layersPerPool = 64, paletteRows = 256 }) {
		this.device = device;
		this.layersPerPool = layersPerPool;
		this.paletteRows = paletteRows;
		/** @type {Map<string, GPUTexture>} */
		this.textures = new Map();
		this.paletteTexture = null;
		/** @type {{r8: GPUTexture|null, rgba8: GPUTexture|null}} 1×1×1 stand-ins for empty classes */
		this._dummies = { r8: null, rgba8: null };
		/** Bumped whenever a texture handle changes, so bind groups know to rebuild. */
		this.version = 0;
	}

	_createArray(format, size, layers, label) {
		this.version++;
		return this.device.createTexture({
			label,
			size: { width: size, height: size, depthOrArrayLayers: layers },
			dimension: '2d',
			format: GPU_FORMAT[format],
			mipLevelCount: 1,
			usage: USAGE.TEXTURE_BINDING | USAGE.COPY_DST
		});
	}

	/**
	 * @param {string} pool  e.g. 'r8:64'
	 * @param {number} size
	 */
	_texture(pool, size) {
		let texture = this.textures.get(pool);
		if (!texture) {
			texture = this._createArray(pool.split(':')[0], size, this.layersPerPool, `sprite-pool ${pool}`);
			this.textures.set(pool, texture);
		}
		return texture;
	}

	/**
	 * Residency uploader port: one frame into one array layer (top-left, edge-replicated padding).
	 * @param {string} pool
	 * @param {number} size
	 * @param {number} layer
	 * @param {ArrayBufferView} data  Tightly packed width×height texels
	 * @param {number} [width]
	 * @param {number} [height]
	 */
	allocLayer(pool, size, layer, data, width = size, height = size) {
		const channels = pool.startsWith('r8') ? 1 : 4;
		const texture = this._texture(pool, size);
		const pixels = padLayer(data, width, height, size, channels);
		this.device.queue.writeTexture(
			{ texture, mipLevel: 0, origin: { x: 0, y: 0, z: layer } },
			pixels,
			{ offset: 0, bytesPerRow: size * channels, rowsPerImage: size },
			{ width: size, height: size, depthOrArrayLayers: 1 }
		);
	}

	/**
	 * Residency uploader port: one 256×1 RGBA row of the palette table.
	 * @param {number} row
	 * @param {Uint8Array} rgba
	 */
	uploadPalette(row, rgba) {
		if (row >= this.paletteRows) {
			throw new DeviceLimitError('paletteRows', row + 1, this.paletteRows);
		}
		if (!this.paletteTexture) {
			this.version++;
			this.paletteTexture = this.device.createTexture({
				label: 'sprite-palettes',
				size: { width: PALETTE_WIDTH, height: this.paletteRows, depthOrArrayLayers: 1 },
				dimension: '2d',
				format: 'rgba8unorm',
				mipLevelCount: 1,
				usage: USAGE.TEXTURE_BINDING | USAGE.COPY_DST
			});
		}
		this.device.queue.writeTexture(
			{ texture: this.paletteTexture, mipLevel: 0, origin: { x: 0, y: row, z: 0 } },
			rgba,
			{ offset: 0, bytesPerRow: PALETTE_WIDTH * 4, rowsPerImage: 1 },
			{ width: PALETTE_WIDTH, height: 1, depthOrArrayLayers: 1 }
		);
	}

	_dummy(format) {
		if (!this._dummies[format]) {
			// Zero-initialised by WebGPU: index 0 / transparent black.
			this._dummies[format] = this._createArray(format, 1, 1, `sprite-pool ${format}:empty`);
		}
		return this._dummies[format];
	}

	/**
	 * Views for the sprite bind group: palette table, then r8 pools and rgba8 pools by POT class.
	 * @returns {{palette: GPUTextureView, indexed: GPUTextureView[], rgba: GPUTextureView[]}}
	 */
	views() {
		if (!this.paletteTexture) {
			this.uploadPalette(0, new Uint8Array(PALETTE_WIDTH * 4));
		}
		const view = (format, size) =>
			(this.textures.get(`${format}:${size}`) ?? this._dummy(format)).createView({ dimension: '2d-array' });
		return {
			palette: this.paletteTexture.createView({ dimension: '2d' }),
			indexed: POT_CLASSES.map(size => view('r8', size)),
			rgba: POT_CLASSES.map(size => view('rgba8', size))
		};
	}

	/** R-CTX-006 / device loss: every texture died with the device; forget the handles. */
	purge() {
		this.textures.clear();
		this.paletteTexture = null;
		this._dummies = { r8: null, rgba8: null };
		this.version++;
	}

	/** Release GPU memory (backend dispose). */
	dispose() {
		for (const texture of [...this.textures.values(), this.paletteTexture, ...Object.values(this._dummies)]) {
			texture?.destroy?.();
		}
		this.purge();
	}
}
