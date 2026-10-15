import { GL } from '../pipeline/glEnums.js';
import { padLayer } from '../residency/TextureArrayPools.js';

/**
 * World model textures (static RSM batch, animated RSM) as TEXTURE_2D_ARRAYs, one per
 * power-of-two size class (the larger side of the POT-stretched image), split in
 * chunks of at most `maxLayers` layers. Each image sits in the top-left corner of its
 * layer, edge-replicated to the class size (TextureArrayPools.padLayer), and is
 * sampled at uv × (size / class): with LINEAR + CLAMP_TO_EDGE this is exactly the
 * legacy per-texture LINEAR + CLAMP_TO_EDGE sample (the scale is a power of two, and
 * the replicated edge reproduces the clamp).
 *
 * Map textures live as long as the map, so the arrays are built once per map (and
 * rebuilt when animated models add textures), not through the sprite residency.
 */
export class LayerSet {
	/**
	 * @param {{gl: WebGL2RenderingContext, maxLayers?: number, mipmaps?: boolean}} deps
	 */
	constructor({ gl, maxLayers, mipmaps = false }) {
		this.gl = gl;
		this.maxLayers = maxLayers ?? gl.getParameter(GL.MAX_ARRAY_TEXTURE_LAYERS) ?? 256;
		this.mipmaps = mipmaps;
		/** @type {(import('../residency/Residency.js').ResidentImage|null)[]} */
		this.images = [];
		/** @type {Map<string, WebGLTexture>} */
		this.arrays = new Map();
		/** @type {({key: string, layer: number, scale: [number, number]}|null)[]} */
		this.slots = [];
	}

	/**
	 * @param {import('../residency/Residency.js').ResidentImage|null} image  null: not available (never drawn)
	 * @returns {number} slot index
	 */
	add(image) {
		this.images.push(image);
		return this.images.length - 1;
	}

	/** (Re)create the arrays from the retained images. */
	build() {
		const { gl } = this;
		this.dispose();
		/** @type {Map<string, {size: number, images: {slot: number, image: any}[]}>} */
		const groups = new Map();
		const perClass = new Map();
		this.slots = this.images.map((image, slot) => {
			if (!image) {
				return null;
			}
			const size = Math.max(image.width, image.height);
			const n = perClass.get(size) ?? 0;
			perClass.set(size, n + 1);
			const key = `${size}:${Math.floor(n / this.maxLayers)}`;
			if (!groups.has(key)) {
				groups.set(key, { size, images: [] });
			}
			const group = groups.get(key);
			group.images.push({ slot, image });
			return { key, layer: group.images.length - 1, scale: [image.width / size, image.height / size] };
		});
		for (const [key, { size, images }] of groups) {
			const texture = gl.createTexture();
			const levels = this.mipmaps ? Math.log2(size) + 1 : 1;
			gl.bindTexture(GL.TEXTURE_2D_ARRAY, texture);
			gl.texStorage3D(GL.TEXTURE_2D_ARRAY, levels, GL.RGBA8, size, size, images.length);
			gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
			images.forEach(({ image }, layer) => {
				const data = padLayer(image.data, image.width, image.height, size, 4);
				gl.texSubImage3D(GL.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, GL.RGBA, GL.UNSIGNED_BYTE, data);
			});
			gl.pixelStorei(GL.UNPACK_ALIGNMENT, 4);
			gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
			gl.texParameteri(
				GL.TEXTURE_2D_ARRAY,
				GL.TEXTURE_MIN_FILTER,
				this.mipmaps ? GL.LINEAR_MIPMAP_LINEAR : GL.LINEAR
			);
			gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
			gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
			if (this.mipmaps) {
				gl.generateMipmap(GL.TEXTURE_2D_ARRAY);
			}
			gl.bindTexture(GL.TEXTURE_2D_ARRAY, null);
			this.arrays.set(key, texture);
		}
		return this;
	}

	/** @param {number} slot */
	slot(slot) {
		return this.slots[slot] ?? null;
	}

	/** Delete the GL arrays (the images are kept for a rebuild). */
	dispose() {
		for (const texture of this.arrays.values()) {
			this.gl.deleteTexture(texture);
		}
		this.arrays.clear();
	}

	/** Context loss: the arrays died with the context. */
	forget() {
		this.arrays.clear();
	}
}
