import { padLayer } from '../residency/TextureArrayPools.js';

/** GPUTextureUsage bits (numeric so Node tests need no WebGPU globals). */
const USAGE = Object.freeze({ COPY_DST: 0x02, TEXTURE_BINDING: 0x04 });

/**
 * World model textures (static RSM batch, animated RSM) as `texture_2d_array`s, one per
 * power-of-two size class (the larger side of the POT-stretched image), split in
 * chunks of at most `maxLayers` layers. Port of gpu-webgl2 `world/LayerSet.js`: each
 * image sits in the top-left corner of its layer, edge-replicated to the class size
 * (TextureArrayPools.padLayer), and is sampled at uv × (size / class): with LINEAR +
 * clamp-to-edge this is exactly the legacy per-texture LINEAR + CLAMP_TO_EDGE sample
 * (the scale is a power of two, and the replicated edge reproduces the clamp).
 *
 * Map textures live as long as the map, so the arrays are built once per map (and
 * rebuilt when animated models add textures, or on a new device), not through the
 * sprite residency. The images are kept for that rebuild.
 */
export class LayerSet {
	/**
	 * @param {{device: GPUDevice, maxLayers?: number}} deps
	 */
	constructor({ device, maxLayers }) {
		this.device = device;
		this.maxLayers = maxLayers ?? device.limits?.maxTextureArrayLayers ?? 256;
		/** @type {({width: number, height: number, data: Uint8Array}|null)[]} */
		this.images = [];
		/** @type {Map<string, {texture: GPUTexture, view: GPUTextureView}>} */
		this.arrays = new Map();
		/** @type {({key: string, layer: number, scale: [number, number]}|null)[]} */
		this.slots = [];
	}

	/**
	 * @param {{width: number, height: number, data: Uint8Array}|null} image  null: not available (never drawn)
	 * @returns {number} slot index
	 */
	add(image) {
		this.images.push(image);
		return this.images.length - 1;
	}

	/** (Re)create the arrays from the retained images on `device` (default: the current one). */
	build(device = this.device) {
		this.dispose();
		this.device = device;
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
			const texture = device.createTexture({
				label: `world-models-${key}`,
				size: { width: size, height: size, depthOrArrayLayers: images.length },
				format: 'rgba8unorm',
				usage: USAGE.COPY_DST | USAGE.TEXTURE_BINDING
			});
			images.forEach(({ image }, layer) => {
				const data = padLayer(image.data, image.width, image.height, size, 4);
				device.queue.writeTexture(
					{ texture, origin: { x: 0, y: 0, z: layer } },
					data,
					{ bytesPerRow: size * 4, rowsPerImage: size },
					{ width: size, height: size, depthOrArrayLayers: 1 }
				);
			});
			// A one-layer array would default to a '2d' view.
			this.arrays.set(key, { texture, view: texture.createView({ dimension: '2d-array' }) });
		}
		return this;
	}

	/** @param {number} slot */
	slot(slot) {
		return this.slots[slot] ?? null;
	}

	/** Destroy the GPU arrays (the images are kept for a rebuild). */
	dispose() {
		for (const { texture } of this.arrays.values()) {
			texture.destroy?.();
		}
		this.arrays.clear();
	}

	/** Device loss: the arrays died with the device. */
	forget() {
		this.arrays.clear();
	}
}
