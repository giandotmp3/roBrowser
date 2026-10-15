import { POT_CLASSES, ZINDEX_BIAS } from '../constants.js';
import { identity, invert } from '../math.js';
import { PipelineSet } from '../pipelines/PipelineSet.js';
import { ADDITIVE, NORMAL } from '../pipelines/pipelineKey.js';
import { resolveBlend } from '../pipelines/blendMap.js';
import { SHADERS } from '../shaders/index.js';
import { encodeBatches } from '../batching/encodeBatches.js';
import { spriteEffectClass, spriteEffectView } from '../effects/spriteEffect.js';
import { InstanceRing } from './InstanceRing.js';
import { SPRITE_INSTANCE_FLOATS, SPRITE_QUAD, SPRITE_VERTEX_BUFFERS, packSpriteInstance } from './instanceLayout.js';
import { programOf, splitBatches, splitRuns } from './runs.js';

export { SPRITE_INSTANCE_FLOATS };

/**
 * R-SPR-006 (shader side, reference of shaders/sprite.wgsl):
 * clip.z −= (zIndex·0.01 + depthBias) / max(zoom, 1).
 * @returns {number} the amount subtracted from clip z
 */
export function zIndexBias(zIndex, depthBias, zoom) {
	return (zIndex * ZINDEX_BIAS + depthBias) / Math.max(zoom, 1);
}

/** Column-major mat4 × vec4 (WGSL `m * v`). */
const mulVec4 = (m, v) => {
	const out = [0, 0, 0, 0];
	for (let r = 0; r < 4; r++) {
		out[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
	}
	return out;
};
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length3 = a => Math.sqrt(dot3(a, a));
/** WGSL normalize: v / length(v) (a zero vector gives NaN, as on the GPU). */
const normalize3 = a => {
	const l = length3(a);
	return [a[0] / l, a[1] / l, a[2] / l];
};
const fract = x => x - Math.floor(x);
const mix4 = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

/**
 * R-SPR-002 `project()` of sprite.wgsl (legacy SpriteRenderer.vs `Project`): translate
 * the model-view by the sprite's (x, −z, y) + half a cell, then drop the view rotation
 * (spherical billboard; row 3 is kept).
 * @param {ArrayLike<number>} modelView  Column-major mat4
 * @param {ArrayLike<number>} pos        Sprite position (record `position`)
 * @returns {number[]}
 */
export function projectSprite(modelView, pos) {
	const m = Array.from(modelView);
	const x = pos[0] + 0.5;
	const y = -pos[2];
	const z = pos[1] + 0.5;
	for (let r = 0; r < 4; r++) {
		m[12 + r] += m[r] * x + m[4 + r] * y + m[8 + r] * z;
	}
	m[0] = 1;
	m[1] = 0;
	m[2] = 0;
	m[4] = 0;
	m[5] = 1;
	m[6] = 0;
	m[8] = 0;
	m[9] = 0;
	m[10] = 1;
	return m;
}

/**
 * R-SPR-005 CPU reference: the depth-correction block of sprite.wgsl `vs_main`
 * (legacy SpriteRenderer.vs:69-89), operation for operation, in f64 (the GPU runs
 * it in f32). The vertex takes the depth where its camera ray meets the vertical
 * plane through the sprite centre (normal = flattened camera forward), capped with
 * min(original, corrected) unless ignoreDepthMinCap (NPCs).
 *
 * @param {ArrayLike<number>} viewPosition  vec4: projectSprite(modelView, position) × the rotated quad corner
 * @param {ArrayLike<number>} viewCenter    vec4: projectSprite(modelView, position) × (0, 0, 0, 1)
 * @param {{modelView: ArrayLike<number>, projection: ArrayLike<number>, viewModel?: ArrayLike<number>}} frame
 *   `viewModel` = inverse(modelView) (computed when absent, as packFrameUniforms does)
 * @param {boolean} ignoreDepthMinCap
 * @returns {number} GL-style clip z (before the R-SPR-006 bias and the WebGPU depth remap)
 */
export function depthCorrectedClipZ(viewPosition, viewCenter, frame, ignoreDepthMinCap) {
	const viewModel = frame.viewModel ?? invert(frame.modelView) ?? identity();
	const clip = mulVec4(frame.projection, viewPosition);
	const cameraPos = mulVec4(viewModel, [0, 0, 0, 1]).slice(0, 3);
	const cameraForward = normalize3(mulVec4(viewModel, [0, 0, -1, 0]).slice(0, 3));
	const planePoint = mulVec4(viewModel, viewCenter).slice(0, 3);
	let planeNormal = normalize3([cameraForward[0], 0, cameraForward[2]]);
	if (length3(planeNormal) < 0.000001) {
		planeNormal = cameraForward;
	}

	const worldVertex = mulVec4(viewModel, viewPosition).slice(0, 3);
	const rayDir = normalize3(sub3(worldVertex, cameraPos));
	const denom = Math.max(dot3(planeNormal, rayDir), 0.000001);
	const dist = dot3(sub3(planePoint, cameraPos), planeNormal) / denom;

	const hit = [cameraPos[0] + rayDir[0] * dist, cameraPos[1] + rayDir[1] * dist, cameraPos[2] + rayDir[2] * dist, 1];
	const planeClip = mulVec4(frame.projection, mulVec4(frame.modelView, hit));
	const correctedZBase = planeClip[2] * (clip[3] / Math.max(planeClip[3], 0.000001));

	return ignoreDepthMinCap ? correctedZBase : Math.min(clip[2], correctedZBase);
}

/**
 * CPU reference of the whole sprite.wgsl `vs_main` position for one quad corner
 * (R-SPR-002/003/005/006): billboard, rotation, offset, depth correction, zIndex
 * bias, then GL clip z [−w, w] → WebGPU [0, w].
 * @param {ArrayLike<number>} corner  Quad corner (±0.5, ±0.5), SPRITE_QUAD
 * @param {{position: ArrayLike<number>, offset: ArrayLike<number>, size: ArrayLike<number>,
 *   rotation: ArrayLike<number>, zIndexBias: ArrayLike<number>, depthFlags: ArrayLike<number>}} inst
 *   Instance fields as packed (world units; `unpackSpriteInstance` reads them back)
 * @param {{modelView: ArrayLike<number>, projection: ArrayLike<number>, viewModel?: ArrayLike<number>, zoom: number}} frame
 * @returns {number[]} WebGPU clip position (x, y, z, w)
 */
export function spriteVertexClip(corner, inst, frame) {
	const [cos, sin] = inst.rotation;
	const px = corner[0] * inst.size[0];
	const py = corner[1] * inst.size[1];
	const position = [cos * px - sin * py + inst.offset[0], sin * px + cos * py - (inst.offset[1] + 0.5), 0, 1];

	const modelView = projectSprite(frame.modelView, inst.position);
	const viewPosition = mulVec4(modelView, position);
	const viewCenter = mulVec4(modelView, [0, 0, 0, 1]);
	const clip = mulVec4(frame.projection, viewPosition);
	if (inst.depthFlags[0] > 0.5) {
		clip[2] = depthCorrectedClipZ(viewPosition, viewCenter, frame, inst.depthFlags[1] > 0.5);
	}
	clip[2] -= zIndexBias(inst.zIndexBias[0], inst.zIndexBias[1], frame.zoom);
	clip[2] = (clip[2] + clip[3]) * 0.5;
	return clip;
}

/**
 * R-SPR-014 CPU reference: sprite.wgsl `sample_indexed` (legacy SpriteRenderer.fs
 * `bilinearSample`), operation for operation. Four NEAREST, clamp-to-edge index taps
 * `1/textSize` apart; index 0 is transparent; the palette lookup clamps index 255 to
 * entry 255 (spec #64 fix); colours blend with f = fract(uv·textSize).
 *
 * Spec #65: legacy passes `uTextSize = 2 × frame size`, so the taps step half a texel
 * and f advances twice per texel. That is the default here, as in packSpriteInstance;
 * records carry `paletteSize` to override it.
 *
 * @param {{width: number, height: number, data: ArrayLike<number>}} indexImage  r8 indices
 *   (the POT frame, as resident: width×height is the instance's frame size)
 * @param {ArrayLike<number>} paletteRow  256×4 RGBA bytes
 * @param {number} u
 * @param {number} v
 * @param {ArrayLike<number>} [textSize]  Legacy uTextSize (record `paletteSize`), default 2× the frame size
 * @returns {number[]} RGBA in 0…1 (before shadow, colour and fog)
 */
export function samplePaletteBilinear(indexImage, paletteRow, u, v, textSize) {
	const { width, height, data } = indexImage;
	const tw = textSize ? textSize[0] : 2 * width;
	const th = textSize ? textSize[1] : 2 * height;
	const ix = 1 / tw;
	const iy = 1 / th;
	// nearest_texel + fetch_index: r8unorm index, normalised.
	const index = (s, t) => {
		const x = Math.min(Math.max(Math.floor(s * width), 0), width - 1);
		const y = Math.min(Math.max(Math.floor(t * height), 0), height - 1);
		return data[y * width + x] / 255;
	};
	// palette_at (+ the index-0 select).
	const colour = i => {
		if (i === 0) {
			return [0, 0, 0, 0];
		}
		const column = Math.min(Math.floor(i * 256), 255) * 4;
		return [paletteRow[column] / 255, paletteRow[column + 1] / 255, paletteRow[column + 2] / 255, 1];
	};
	const c00 = colour(index(u, v));
	const c10 = colour(index(u + ix, v));
	const c01 = colour(index(u, v + iy));
	const c11 = colour(index(u + ix, v + iy));
	const fx = fract(u * tw);
	const fy = fract(v * th);
	return mix4(mix4(c00, c10, fx), mix4(c01, c11, fx), fy);
}

/**
 * One sprite pipeline family: the texture class is a per-instance flag (`layer.w`),
 * not a pipeline, so indexed and RGBA records share `fs_main` (runs.js batchKey).
 */
export const SPRITE_FAMILY = 'sprite';

/** Sampled textures `sprite.wgsl` binds in its fragment stage: palette table + 5 indexed + 5 RGBA pools. */
export const SPRITE_MIXED_SAMPLED_TEXTURES = 1 + 2 * POT_CLASSES.length;

/** WebGPU's guaranteed maxSampledTexturesPerShaderStage, assumed when the device reports none. */
const WEBGPU_MIN_SAMPLED_TEXTURES = 16;

/**
 * Whether one batch may mix indexed and RGBA layers: true when the device binds the
 * SPRITE_MIXED_SAMPLED_TEXTURES (11) sampled textures the mixed shader needs in one
 * fragment stage. Every conformant WebGPU device allows at least 16, so the split
 * fallback (palette + the batch's 5 class pools, batches split on texture class)
 * exists only for adapters that report less.
 * @param {{limits?: {maxSampledTexturesPerShaderStage?: number}}} device
 */
export function canMixTextureClasses(device) {
	const limit = device?.limits?.maxSampledTexturesPerShaderStage ?? WEBGPU_MIN_SAMPLED_TEXTURES;
	return limit >= SPRITE_MIXED_SAMPLED_TEXTURES;
}

/**
 * `sprite.wgsl` for the chosen mode. The split variant drops the rgba0..4 bindings
 * and reads every class pool through idx0..4 (bindings 3..7), where the renderer binds
 * the batch's class (indexed or RGBA views); fs_main still branches on layer.w.
 * @param {{mixTextureClasses?: boolean}} [options]
 */
export function spriteShaderSource({ mixTextureClasses = true } = {}) {
	if (mixTextureClasses) {
		return SHADERS.sprite;
	}
	return SHADERS.sprite
		.split('\n')
		.filter(line => !/^@group\(0\) @binding\(\d+\) var rgba\d /.test(line))
		.join('\n')
		.replace(/\brgba([0-4])\b/g, 'idx$1');
}

const DEPTH_STATES = Object.freeze([
	{ depthTest: true, depthWrite: true },
	{ depthTest: true, depthWrite: false },
	{ depthTest: false, depthWrite: true },
	{ depthTest: false, depthWrite: false }
]);

/**
 * Pipeline spec of a sprite-program record (batch head: a sprite or a 2D/3D effect).
 * The blend pair is resolved (`resolveBlend`: invalid or WebGPU-inexpressible pairs
 * draw normal alpha, #41/#49).
 * @param {{textureClass?: string, blend: {src: string, dst: string}|null, depthTest: boolean, depthWrite: boolean}} record
 */
export function spriteSpec(record) {
	return {
		family: SPRITE_FAMILY,
		blend: resolveBlend(record.blend),
		depthTest: record.depthTest,
		depthWrite: record.depthWrite,
		topology: 'triangle-strip'
	};
}

/**
 * Sprite blend/depth census (architecture §2.2 "Pipelines"): SpriteDraw blends are
 * normal alpha or additive (R-SPR-023), with any depth test/write combination. The
 * texture class is per instance, so there is one family: 2 blends × 4 depth states.
 * @param {ReadonlyArray<{src: string, dst: string}>} [blends]
 */
export function spriteCensus(blends = [NORMAL, ADDITIVE]) {
	const specs = [];
	for (const blend of blends) {
		for (const depth of DEPTH_STATES) {
			specs.push(spriteSpec({ blend, ...depth }));
		}
	}
	return specs;
}

/** Frame uniform block (WGSL `Frame`): 3 mat4, zoom, Fog{vec3 color, u32 use, near, far}. */
export const FRAME_UNIFORM_FLOATS = 60;
export const FRAME_UNIFORM_BYTES = FRAME_UNIFORM_FLOATS * 4;

/**
 * @typedef {Object} SpriteView  Per-frame inputs (legacy SpriteRenderer.bind3DContext)
 * @property {ArrayLike<number>} modelView
 * @property {ArrayLike<number>} projection
 * @property {number} zoom                 Camera.zoom (R-SPR-006)
 * @property {{use: boolean, near: number, far: number, color: ArrayLike<number>}} [fog]  `use` = fog.use && fog.exist
 */

/**
 * @param {SpriteView} [view]
 * @param {ArrayBuffer} [out]
 * @returns {ArrayBuffer}
 */
export function packFrameUniforms(view, out = new ArrayBuffer(FRAME_UNIFORM_BYTES)) {
	const f = new Float32Array(out);
	const u = new Uint32Array(out);
	const modelView = view?.modelView ?? identity();
	f.set(modelView, 0);
	f.set(invert(modelView) ?? identity(), 16);
	f.set(view?.projection ?? identity(), 32);
	f[48] = view?.zoom ?? 1;
	const fog = view?.fog;
	f.set(fog?.color ?? [0, 0, 0], 52);
	u[55] = fog?.use ? 1 : 0;
	f[56] = fog?.near ?? 0;
	f[57] = fog?.far ?? 1;
	return out;
}

/** GPU usage / stage bits (numeric so Node tests need no WebGPU globals). */
const BUFFER = Object.freeze({ COPY_DST: 0x08, VERTEX: 0x20, UNIFORM: 0x40 });
const STAGE = Object.freeze({ VERTEX: 0x1, FRAGMENT: 0x2 });

/**
 * Bind group layout entries of `sprite.wgsl` group 0 (the split variant has no RGBA set).
 * @param {{mixTextureClasses?: boolean}} [options]
 */
export function spriteBindGroupLayoutEntries({ mixTextureClasses = true } = {}) {
	const texture = (binding, viewDimension) => ({
		binding,
		visibility: STAGE.FRAGMENT,
		texture: { sampleType: 'float', viewDimension }
	});
	return [
		{ binding: 0, visibility: STAGE.VERTEX | STAGE.FRAGMENT, buffer: { type: 'uniform' } },
		{ binding: 1, visibility: STAGE.FRAGMENT, sampler: { type: 'filtering' } },
		texture(2, '2d'),
		...POT_CLASSES.map((_, i) => texture(3 + i, '2d-array')),
		...(mixTextureClasses ? POT_CLASSES.map((_, i) => texture(3 + POT_CLASSES.length + i, '2d-array')) : [])
	];
}

/**
 * Texture class of a sprite-program record (split fallback bind group).
 * @param {{kind: string, textureClass?: string, params?: {palette?: unknown}}} record
 * @returns {'indexed'|'rgba'}
 */
export function spriteProgramClass(record) {
	return record.kind === 'sprite' ? (record.textureClass === 'rgba' ? 'rgba' : 'indexed') : spriteEffectClass(record);
}

/** @param {{kind: string, family?: string}} record */
const isSpriteProgram = record => programOf(record) === 'sprite';

/**
 * Draws sprite-program batches (contiguous, legacy order; runs.js `splitBatches`,
 * unions of whole render-records runs that mix texture classes): SpriteDraw records
 * and the 2D/3D EffectDraw records (SpriteRenderer draws in legacy, mapped by
 * `spriteEffectView`), as instanced quads: one pipeline switch (when the state
 * changes) and one `draw(4, count, 0, first)` per batch, all instances of the frame
 * in one instance-step vertex buffer write. `encode` draws only this program's
 * batches; RunRenderer interleaves them with STR batches (`stage`/`bind`/`groupFor`/
 * `pipelineFor`, batching/encodeBatches.js).
 */
export class SpriteRunRenderer {
	/**
	 * @param {{
	 *   device: GPUDevice,
	 *   residency: import('../residency/SpriteResidency.js').SpriteResidency,
	 *   pools?: import('../residency/TextureArrayPools.js').TextureArrayPools,
	 *   sampleCount?: number,
	 *   ring?: InstanceRing,
	 *   mixTextureClasses?: boolean
	 * }} deps  `mixTextureClasses` defaults to `canMixTextureClasses(device)`
	 */
	constructor({ device, residency, pools, sampleCount, ring, mixTextureClasses }) {
		this.device = device;
		/** One bind group with both array sets, batches mix texture classes (else split fallback). */
		this.mixTextureClasses = mixTextureClasses ?? canMixTextureClasses(device);
		this.residency = residency;
		this.pools = pools ?? /** @type {any} */ (residency.uploader);
		this.sampleCount = sampleCount;
		this.ring = ring ?? new InstanceRing({ device });
		this.module = null;
		this.bindGroupLayout = null;
		this.pipelineLayout = null;
		/** @type {PipelineSet|null} */
		this.pipelines = null;
		this.quad = null;
		this.uniforms = null;
		this.sampler = null;
		/** @type {Map<string, GPUBindGroup>} keyed 'mixed', or the class in split mode */
		this._bindGroups = new Map();
		this._bindGroupVersion = -1;
		this._uniformData = new ArrayBuffer(FRAME_UNIFORM_BYTES);
		this._instances = new Float32Array(SPRITE_INSTANCE_FLOATS * 256);
		this._slot = {};
		this._view = {};
		this._staged = null;
		/** Draw calls issued by the last `encode()` (draw count is measured, §5 phase 3). */
		this.lastDrawCalls = 0;
		/** Sprite render-records runs of the last `encode()` (pipeline-state boundaries), for diagnostics. */
		this.lastRuns = [];
		/** Draw batches of the last `encode()` (batchKey boundaries: what was drawn). */
		this.lastBatches = [];
		/** Runs drawn with the normal-alpha fallback pipeline in the last `encode()`. */
		this.lastFallbacks = 0;
		/** Frames and palette rows uploaded on miss by the last `encode()`. */
		this.lastUploads = 0;
	}

	/**
	 * Create the GPU objects and precompile the sprite census (normal-alpha
	 * variants are awaited, the rest compile in the background).
	 * @param {ReturnType<typeof spriteCensus>} [census]
	 */
	async init(census = spriteCensus()) {
		const { device } = this;
		const mode = { mixTextureClasses: this.mixTextureClasses };
		this.module = device.createShaderModule({ label: 'sprite.wgsl', code: spriteShaderSource(mode) });
		this.bindGroupLayout = device.createBindGroupLayout({
			label: 'sprite group 0',
			entries: spriteBindGroupLayoutEntries(mode)
		});
		this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
		this.pipelines = new PipelineSet(
			device,
			() => ({
				module: this.module,
				layout: this.pipelineLayout,
				buffers: /** @type {any} */ (SPRITE_VERTEX_BUFFERS),
				vertexEntry: 'vs_main',
				fragmentEntry: 'fs_main'
			}),
			this.sampleCount === undefined ? undefined : { sampleCount: this.sampleCount }
		);
		this.quad = device.createBuffer({
			label: 'sprite-quad',
			size: SPRITE_QUAD.length * 4,
			usage: BUFFER.VERTEX | BUFFER.COPY_DST
		});
		device.queue.writeBuffer(this.quad, 0, new Float32Array(SPRITE_QUAD));
		this.uniforms = device.createBuffer({
			label: 'sprite-frame',
			size: FRAME_UNIFORM_BYTES,
			usage: BUFFER.UNIFORM | BUFFER.COPY_DST
		});
		// R-SPR-014: RGBA frames filter LINEAR (pixelPerfect → per-instance textureLoad instead);
		// indexed frames and palettes are read with textureLoad (NEAREST).
		this.sampler = device.createSampler({
			label: 'sprite-linear',
			magFilter: 'linear',
			minFilter: 'linear',
			mipmapFilter: 'nearest',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
		await this.pipelines.precompile(census);
		return this;
	}

	/**
	 * Group 0 for a batch: one group with both array sets when classes mix, else one
	 * per class (its pools on bindings 3..7). Rebuilt when a pool texture is created.
	 * @param {string} [textureClass]  Batch class (split fallback only)
	 */
	_bindGroupFor(textureClass) {
		const key = this.mixTextureClasses ? 'mixed' : textureClass === 'rgba' ? 'rgba' : 'indexed';
		if (this._bindGroupVersion !== this.pools.version) {
			this._bindGroups.clear();
		}
		let group = this._bindGroups.get(key);
		if (!group) {
			const views = this.pools.views();
			const pools = key === 'rgba' ? views.rgba : views.indexed;
			const resources = [
				{ binding: 0, resource: { buffer: this.uniforms } },
				{ binding: 1, resource: this.sampler },
				{ binding: 2, resource: views.palette },
				...pools.map((resource, i) => ({ binding: 3 + i, resource })),
				...(key === 'mixed'
					? views.rgba.map((resource, i) => ({ binding: 3 + POT_CLASSES.length + i, resource }))
					: [])
			];
			group = this.device.createBindGroup({
				label: `sprite group 0 (${key})`,
				layout: this.bindGroupLayout,
				entries: resources
			});
			// views() may create the palette table or dummies; read the version after it.
			if (this._bindGroupVersion !== this.pools.version) {
				this._bindGroups.clear();
				this._bindGroupVersion = this.pools.version;
			}
			this._bindGroups.set(key, group);
		}
		return group;
	}

	/**
	 * Pack the sprite-program batches of one frame (stream order) and write them with
	 * the frame uniforms. Records must be resident already (`residency.prepare`).
	 * @param {ReadonlyArray<any>} records
	 * @param {ReadonlyArray<{start: number, count: number}>} batches  Sprite-program batches only
	 * @param {SpriteView} [view]
	 * @returns {number[]} first instance of each batch
	 */
	stage(records, batches, view) {
		const total = batches.reduce((n, batch) => n + batch.count, 0);
		if (this._instances.length < total * SPRITE_INSTANCE_FLOATS) {
			this._instances = new Float32Array(total * SPRITE_INSTANCE_FLOATS * 2);
		}
		const firsts = [];
		let offset = 0;
		let first = 0;
		for (const batch of batches) {
			firsts.push(first);
			for (let i = batch.start; i < batch.start + batch.count; i++) {
				const record = records[i];
				const sprite = record.kind === 'sprite' ? record : spriteEffectView(record, this._view);
				offset = packSpriteInstance(sprite, this.residency.slotOf(sprite, this._slot), this._instances, offset);
			}
			first += batch.count;
		}
		this._staged = null;
		if (total) {
			this.ring.beginFrame();
			this._staged = this.ring.write(this._instances.subarray(0, offset));
			this.device.queue.writeBuffer(this.uniforms, 0, packFrameUniforms(view, this._uniformData));
		}
		return firsts;
	}

	/**
	 * Switch the pass to the sprite program: quad (slot 0) and staged instances (slot 1).
	 * @param {GPURenderPassEncoder} pass
	 */
	bind(pass) {
		pass.setVertexBuffer(0, this.quad);
		pass.setVertexBuffer(1, this._staged.buffer, this._staged.offset);
	}

	/**
	 * Group 0 of a batch: the mixed group, or its class's group in split mode.
	 * @param {any} head
	 */
	groupFor(head) {
		return this._bindGroupFor(spriteProgramClass(head));
	}

	/**
	 * Pipeline of a batch (normal-alpha fallback while an uncommon pair compiles).
	 * @param {any} head
	 * @returns {{pipeline: GPURenderPipeline|null, fellBack: boolean}}
	 */
	pipelineFor(head) {
		return this.pipelines.get(spriteSpec(head));
	}

	/**
	 * Encode every sprite-program batch of `records` (sprites, 2D/3D effects) into
	 * `pass`. Uploads missing frames and palettes through the residency's source first
	 * (C-16), then writes the frame uniforms and instance data with queue writes, so
	 * call once per submitted frame (after `residency.beginFrame()`).
	 * Other batches (STR and the remaining effect families) are skipped; RunRenderer draws STR.
	 * @param {GPURenderPassEncoder} pass
	 * @param {ReadonlyArray<any>} records  Legacy order
	 * @param {SpriteView} [view]
	 * @returns {{drawCalls: number, runs: number, batches: number, fallbacks: number}}
	 */
	encode(pass, records, view) {
		this.lastDrawCalls = 0;
		this.lastFallbacks = 0;
		// C-16 upload on miss (no-op without a FrameSourcePort): before packing, so slots exist.
		this.lastUploads = this.residency.prepare?.(records) ?? 0;
		const ours = run => isSpriteProgram(records[run.start]);
		this.lastRuns = splitRuns(records).filter(ours);
		this.lastBatches = splitBatches(records, { mixTextureClasses: this.mixTextureClasses }).filter(ours);
		const runs = this.lastRuns.length;
		if (!runs) {
			return { drawCalls: 0, runs: 0, batches: 0, fallbacks: 0 };
		}
		const firsts = this.stage(records, this.lastBatches, view);
		const stats = encodeBatches(pass, records, this.lastBatches, { sprite: this }, { sprite: firsts });
		this.lastDrawCalls = stats.drawCalls;
		this.lastFallbacks = stats.fallbacks;
		return {
			drawCalls: this.lastDrawCalls,
			runs,
			batches: this.lastBatches.length,
			fallbacks: this.lastFallbacks
		};
	}

	/** Device loss: every GPU object died; `init()` again on the new device. */
	reset(device = this.device) {
		this.device = device;
		this.ring = new InstanceRing({ device });
		this.module = this.bindGroupLayout = this.pipelineLayout = this.pipelines = null;
		this.quad = this.uniforms = this.sampler = null;
		this._bindGroups.clear();
		this._bindGroupVersion = -1;
		this._staged = null;
	}
}
