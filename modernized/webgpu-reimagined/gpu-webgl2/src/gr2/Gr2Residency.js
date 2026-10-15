import { GL } from '../pipeline/glEnums.js';
import { GR2_EMBLEM, IDLE_EVICT_MS } from '../constants.js';
import { defaultCreateCanvas } from '../world/worldImages.js';
import { emblemTexels, GR2_VERTEX_FLOATS, interleaveGr2Mesh, keyGr2Magenta } from './gr2.js';

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

/** Vertex attributes (location, size, float offset) of the GR2 interleave, gr2.vert locations. */
const ATTRIBUTES = Object.freeze([
	[0, 3, 0],
	[1, 3, 3],
	[2, 2, 6],
	[3, 4, 8],
	[4, 4, 12]
]);

/**
 * GR2 residency (C-14, C-16): the per-type GPU resources (one VBO/IBO/VAO per submesh,
 * one TEXTURE_2D per embedded texture plus the grey stand-in) and the per-instance
 * guild emblem textures, uploaded on first use from a `Gr2SourcePort`.
 *
 * GR2 textures stay plain TEXTURE_2D (not the sprite texture arrays): they are NPOT,
 * sampled LINEAR with CLAMP_TO_EDGE over their exact extent, which a padded array layer
 * would change at the edges.
 *
 * Lifetimes: types live until `free()` (map unload, legacy GR2ModelRenderer.free);
 * emblems until `releaseEmblem(handle)` (instance detach), idle eviction or `free()`.
 * `purgeAll()` forgets every GL handle after a context loss; the next use re-uploads.
 */
export class Gr2Residency {
	/**
	 * @param {{gl: WebGL2RenderingContext, source?: Gr2SourcePort|null, createCanvas?: (w: number, h: number) => any, now?: () => number, idleMs?: number}} deps
	 */
	constructor({ gl, source = null, createCanvas = defaultCreateCanvas, now = () => 0, idleMs = IDLE_EVICT_MS }) {
		this.gl = gl;
		this.source = source;
		this.createCanvas = createCanvas;
		this.now = now;
		this.idleMs = idleMs;
		/** @type {Map<string, any>} */
		this.types = new Map();
		/** @type {Map<unknown, {texture: WebGLTexture, lastUsed: number}>} */
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
	 * The emblem texture of `handle`, uploading it on miss; null without a handle or
	 * while the source has no image (the emblem submesh is then skipped, R-GR2-006).
	 * @param {unknown} handle
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
			entry = { texture: this._uploadEmblem(image), lastUsed: 0 };
			this.emblems.set(handle, entry);
			this.stats.emblemUploads++;
		}
		entry.lastUsed = this.now();
		return entry.texture;
	}

	/** Instance detach: free its emblem texture now. @param {unknown} handle */
	releaseEmblem(handle) {
		const entry = this.emblems.get(handle);
		if (entry) {
			this.gl.deleteTexture(entry.texture);
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

	/** Map unload: delete every GR2 GL resource. */
	free() {
		const { gl } = this;
		for (const type of this.types.values()) {
			for (const sm of type.submeshes) {
				gl.deleteVertexArray(sm.vao);
				gl.deleteBuffer(sm.vbo);
				gl.deleteBuffer(sm.ibo);
			}
			for (const texture of type.textures) {
				gl.deleteTexture(texture);
			}
		}
		for (const entry of this.emblems.values()) {
			gl.deleteTexture(entry.texture);
		}
		this.types.clear();
		this.emblems.clear();
	}

	/** Context loss: every handle died with the context; forget them (no deletes). */
	purgeAll() {
		this.types.clear();
		this.emblems.clear();
	}

	/** @param {Gr2TypeData} data */
	_uploadType(data) {
		const { gl } = this;
		this._unpackDefaults();
		const byFile = new Map();
		const textures = [];
		for (const t of data.textures ?? []) {
			const texture = t?.pixels
				? this._texture(t.width, t.height, keyGr2Magenta(t.pixels))
				: this._texture(1, 1, TEX_MISSING_PX);
			textures.push(texture);
			byFile.set(t.name, texture);
		}
		const grey = this._texture(1, 1, TEX_GREY_PX);
		textures.push(grey);
		const submeshes = data.meshes.map(mesh => {
			const vao = gl.createVertexArray();
			gl.bindVertexArray(vao);
			const vbo = gl.createBuffer();
			gl.bindBuffer(GL.ARRAY_BUFFER, vbo);
			gl.bufferData(GL.ARRAY_BUFFER, interleaveGr2Mesh(mesh), GL.STATIC_DRAW);
			for (const [location, size, offset] of ATTRIBUTES) {
				gl.enableVertexAttribArray(location);
				gl.vertexAttribPointer(location, size, GL.FLOAT, false, GR2_VERTEX_FLOATS * 4, offset * 4);
			}
			const ibo = gl.createBuffer();
			gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, ibo);
			gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, mesh.indices, GL.STATIC_DRAW);
			gl.bindVertexArray(null);
			return {
				vao,
				vbo,
				ibo,
				count: mesh.indices.length,
				texture: byFile.get(mesh.texFile) ?? grey,
				emblem: Boolean(mesh.emblem)
			};
		});
		gl.bindBuffer(GL.ARRAY_BUFFER, null);
		return { submeshes, textures, hasEmblem: submeshes.some(sm => sm.emblem) };
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
		this._unpackDefaults();
		return this._texture(potSize, potSize, texels);
	}

	_unpackDefaults() {
		const { gl } = this;
		gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, false);
		gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.pixelStorei(GL.UNPACK_ALIGNMENT, 4);
	}

	/** LINEAR + CLAMP_TO_EDGE, no mipmaps (the client's sampler 0, legacy makeTypeTextures). */
	_texture(width, height, data) {
		const { gl } = this;
		const texture = gl.createTexture();
		gl.bindTexture(GL.TEXTURE_2D, texture);
		gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, width, height, 0, GL.RGBA, GL.UNSIGNED_BYTE, data);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
		gl.bindTexture(GL.TEXTURE_2D, null);
		return texture;
	}
}
