import { GR2_EMBLEM, IDLE_EVICT_MS } from '../constants.js';
import { defaultCreateCanvas } from '../world/worldImages.js';
import { emblemTexels, interleaveGr2Mesh, keyGr2Magenta } from './gr2.js';

/**
 * @typedef {Object} Gr2Mesh  One textured submesh, as Loaders/GR2Loader.packModel packs it
 * @property {number} vcount
 * @property {Uint16Array} indices
 * @property {Float32Array} bind   bind-pose positions (3 per vertex)
 * @property {Float32Array} nrm    normals (3)
 * @property {Float32Array} uv     (2)
 * @property {Float32Array} bidx   global bone indices (4)
 * @property {Float32Array} bw     normalised weights (4)
 * @property {string} texFile      embedded texture name ('' or unknown → grey stand-in)
 * @property {boolean} emblem      the guild emblem plane (R-GR2-006)
 *
 * @typedef {Object} Gr2TypeData  CPU side of a GR2 type (C-16: decoded off the GPU)
 * @property {Gr2Mesh[]} meshes
 * @property {{name: string, width: number, height: number, pixels: Uint8Array|null}[]} textures
 *
 * @typedef {Object} Gr2SourcePort  Upload-on-miss source. Synchronous, CPU only; null = not available yet.
 * @property {(path: string) => Gr2TypeData|null} type
 * @property {(handle: unknown) => (CanvasImageSource|null)} emblem  The entity's emblem image (already image-keyed)
 */

/** Legacy fallback texels: a texture that decoded no pixels, and a submesh with no matching texture. */
const TEX_MISSING_PX = new Uint8Array([200, 200, 200, 255]);
const TEX_GREY_PX = new Uint8Array([180, 180, 185, 255]);

/** GPUBufferUsage / GPUTextureUsage bits (numeric for Node tests). */
const BUFFER = Object.freeze({ COPY_DST: 0x08, INDEX: 0x10, VERTEX: 0x20 });
const TEXTURE = Object.freeze({ COPY_DST: 0x02, TEXTURE_BINDING: 0x04 });

/**
 * GR2 residency of gpu-webgpu (C-14, C-16; port of gpu-webgl2 `gr2/Gr2Residency.js`): the
 * per-type GPU resources (one vertex and one uint16 index buffer per submesh, one rgba8unorm
 * 2D texture per embedded texture plus the grey stand-in, each with its group-1 bind group)
 * and the per-instance guild emblem textures, uploaded on first use from a `Gr2SourcePort`.
 *
 * GR2 textures stay plain 2D textures (not the sprite texture arrays): they are NPOT,
 * sampled LINEAR with clamp-to-edge over their exact extent, which a padded array layer
 * would change at the edges. Texels are the decoded bytes legacy hands texImage2D (no
 * premultiply, no flip), so `writeTexture` stores the same values.
 *
 * Lifetimes: types live until `free()` (map unload, legacy GR2ModelRenderer.free);
 * emblems until `releaseEmblem(handle)` (instance detach), idle eviction or `free()`.
 * `purgeAll()` forgets every GPU object after a device loss; `reset(device)` then points
 * the residency at the new device and the next use re-uploads.
 */
export class Gr2Residency {
	/**
	 * @param {{
	 *   device: GPUDevice,
	 *   textureLayout?: GPUBindGroupLayout|null,
	 *   source?: Gr2SourcePort|null,
	 *   createCanvas?: (w: number, h: number) => any,
	 *   now?: () => number,
	 *   idleMs?: number
	 * }} deps  `textureLayout`: the group-1 layout of the GR2 pipeline (set by Gr2Renderer.init)
	 */
	constructor({
		device,
		textureLayout = null,
		source = null,
		createCanvas = defaultCreateCanvas,
		now = () => 0,
		idleMs = IDLE_EVICT_MS
	}) {
		this.device = device;
		this.textureLayout = textureLayout;
		this.source = source;
		this.createCanvas = createCanvas;
		this.now = now;
		this.idleMs = idleMs;
		/** @type {Map<string, any>} */
		this.types = new Map();
		/** @type {Map<unknown, {texture: GPUTexture, group: GPUBindGroup, lastUsed: number}>} */
		this.emblems = new Map();
		this.stats = { typeUploads: 0, emblemUploads: 0, misses: 0, emblemEvictions: 0 };
	}

	/**
	 * The resident type, uploading it on miss; null while the source has no data.
	 * @param {string} path
	 */
	type(path) {
		const hit = this.types.get(path);
		if (hit) {
			return hit;
		}
		const data = this.source?.type(path) ?? null;
		if (!data) {
			this.stats.misses++;
			return null;
		}
		const type = this._uploadType(data);
		this.types.set(path, type);
		this.stats.typeUploads++;
		return type;
	}

	/**
	 * The emblem bind group of `handle`, uploading it on miss; null without a handle or
	 * while the source has no image (the emblem submesh is then skipped, R-GR2-006).
	 * @param {unknown} handle
	 * @returns {GPUBindGroup|null}
	 */
	emblem(handle) {
		if (handle === null || handle === undefined) {
			return null;
		}
		let entry = this.emblems.get(handle);
		if (!entry) {
			const image = this.source?.emblem(handle) ?? null;
			if (!image) {
				this.stats.misses++;
				return null;
			}
			const texture = this._uploadEmblem(image);
			entry = { texture, group: this._group(texture), lastUsed: 0 };
			this.emblems.set(handle, entry);
			this.stats.emblemUploads++;
		}
		entry.lastUsed = this.now();
		return entry.group;
	}

	/** Instance detach: free its emblem texture now. @param {unknown} handle */
	releaseEmblem(handle) {
		const entry = this.emblems.get(handle);
		if (entry) {
			entry.texture.destroy?.();
			this.emblems.delete(handle);
		}
	}

	/** NFR-05: drop emblems not drawn for `maxAgeMs`. Types are map-scoped (freed on unload). */
	evictIdle(maxAgeMs = this.idleMs) {
		const now = this.now();
		let evicted = 0;
		for (const [handle, entry] of this.emblems) {
			if (now - entry.lastUsed > maxAgeMs) {
				this.releaseEmblem(handle);
				evicted++;
			}
		}
		this.stats.emblemEvictions += evicted;
		return evicted;
	}

	/**
	 * Map unload: destroy every GR2 GPU object (a frame already submitted keeps its objects
	 * until it completes; WebGPU defers the release).
	 */
	free() {
		for (const type of this.types.values()) {
			for (const sm of type.submeshes) {
				sm.vertices.destroy?.();
				sm.indices.destroy?.();
			}
			for (const texture of type.textures) {
				texture.destroy?.();
			}
		}
		for (const entry of this.emblems.values()) {
			entry.texture.destroy?.();
		}
		this.types.clear();
		this.emblems.clear();
	}

	/** Device loss: every object died with the device; forget them (no destroys). */
	purgeAll() {
		this.types.clear();
		this.emblems.clear();
	}

	/**
	 * After a device loss: upload to `device` from now on.
	 * @param {GPUDevice} device
	 * @param {GPUBindGroupLayout|null} [textureLayout]
	 */
	reset(device, textureLayout = this.textureLayout) {
		this.purgeAll();
		this.device = device;
		this.textureLayout = textureLayout;
	}

	/** @param {Gr2TypeData} data */
	_uploadType(data) {
		const byFile = new Map();
		const textures = [];
		const add = texture => {
			textures.push(texture);
			return this._group(texture);
		};
		for (const t of data.textures ?? []) {
			const texture = t?.pixels
				? this._texture(t.width, t.height, keyGr2Magenta(t.pixels), 'gr2-texture')
				: this._texture(1, 1, TEX_MISSING_PX, 'gr2-texture-missing');
			byFile.set(t.name, add(texture));
		}
		const grey = add(this._texture(1, 1, TEX_GREY_PX, 'gr2-texture-grey'));
		const submeshes = data.meshes.map(mesh => ({
			vertices: this._buffer(interleaveGr2Mesh(mesh), BUFFER.VERTEX, 'gr2-vertices'),
			indices: this._buffer(mesh.indices, BUFFER.INDEX, 'gr2-indices'),
			count: mesh.indices.length,
			group: byFile.get(mesh.texFile) ?? grey,
			emblem: Boolean(mesh.emblem)
		}));
		return { submeshes, textures, hasEmblem: submeshes.some(sm => sm.emblem) };
	}

	/**
	 * A buffer holding `data`, its size rounded up to 4 bytes (writeBuffer's granularity;
	 * an odd uint16 index count gets one zero pad, never drawn).
	 * @param {ArrayBufferView} data
	 */
	_buffer(data, usage, label) {
		const size = Math.max(4, Math.ceil(data.byteLength / 4) * 4);
		const buffer = this.device.createBuffer({ label, size, usage: usage | BUFFER.COPY_DST });
		const bytes = new Uint8Array(size);
		bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
		this.device.queue.writeBuffer(buffer, 0, bytes.buffer, 0, size);
		return buffer;
	}

	/**
	 * R-GR2-006 with legacy buildEmblemTexture's canvas steps: the image drawn 24×24
	 * (no smoothing) in the top-left of a 32×32 canvas, read back, keyed and quantised.
	 * @param {CanvasImageSource} image
	 */
	_uploadEmblem(image) {
		const { srcSize, potSize } = GR2_EMBLEM;
		const canvas = this.createCanvas(potSize, potSize);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(image, 0, 0, srcSize, srcSize);
		const im = ctx.getImageData(0, 0, potSize, potSize);
		const texels = emblemTexels(new Uint8Array(im.data.buffer, im.data.byteOffset, im.data.byteLength));
		return this._texture(potSize, potSize, texels, 'gr2-emblem');
	}

	/** An rgba8unorm 2D texture, one level (LINEAR + clamp come from the pass sampler). */
	_texture(width, height, data, label) {
		const texture = this.device.createTexture({
			label,
			size: { width, height, depthOrArrayLayers: 1 },
			format: 'rgba8unorm',
			usage: TEXTURE.COPY_DST | TEXTURE.TEXTURE_BINDING
		});
		this.device.queue.writeTexture(
			{ texture },
			data,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			{ width, height, depthOrArrayLayers: 1 }
		);
		return texture;
	}

	/** The group-1 bind group (diffuse texture) of `texture`. */
	_group(texture) {
		return this.device.createBindGroup({
			label: 'gr2-texture',
			layout: this.textureLayout,
			entries: [{ binding: 0, resource: texture.createView() }]
		});
	}
}
