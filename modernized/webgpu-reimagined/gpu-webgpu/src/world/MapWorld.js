import {
	DEFAULT_DEPTH_COMPARE,
	DEPTH_FORMAT,
	MSAA_SAMPLES,
	OCCLUDER_DEFAULTS,
	OCCLUDER_QUERY,
	RENDER_FORMAT,
	WATER_FRAMES
} from '../constants.js';
import { SHADERS } from '../shaders/index.js';
import { toGpuBlend } from '../pipelines/blendMap.js';
import { SCENE_WRITE_MASK } from '../pipelines/PipelineSet.js';
import { padLayer } from '../residency/TextureArrayPools.js';
import { nextPow2 } from '../math.js';
import { AnimatedRsm, ANIMATED_VERTEX_FLOATS } from './animatedRsm.js';
import { LayerSet } from './LayerSet.js';
import { mapLight } from './lighting.js';
import { occluderFadeActive } from './occluderFade.js';
import { waterFrameIndex, waterOpacity, waveOffset } from './water.js';
import { invert } from './glm32.js';
import {
	canvasTexels,
	composeGridTexture,
	composeGroundAtlas,
	createImageDecoder,
	defaultCreateCanvas,
	potTexels
} from './worldImages.js';

/** Static RSM vertex: position 3, normal 3, uv 2, alpha 1 (spec §3.2 MAP_MODELS). */
const MODEL_VERTEX_FLOATS = 9;
/** Ground vertex: position 3, normal 3, uv 2, lightmap uv 2, tile-colour uv 2 (MAP_GROUND). */
const GROUND_VERTEX_FLOATS = 12;
/** Water vertex: position 3, uv 2 (MAP_GROUND waterMesh). */
const WATER_VERTEX_FLOATS = 5;
/** Grid-selector vertex: position 3, uv 2; 6 per cell. */
const GRID_VERTEX_FLOATS = 5;

/** Bytes of the WGSL `World` uniform block (shaders/world/common.wgsl). */
export const WORLD_UNIFORM_BYTES = 304;
/** Dynamic-offset stride of one block (minUniformBufferOffsetAlignment 256). */
export const WORLD_UNIFORM_STRIDE = 512;
/**
 * Blocks per frame: ground, grid, static opaque + query, animated opaque + query, water,
 * faded static + animated (9), with room to spare.
 */
export const WORLD_UNIFORM_SLOTS = 16;

/** Occluder fade shader modes (u.occ_mode, R-MAP-020). */
export const OCCLUDER_MODE = Object.freeze({ OFF: 0, DITHER: 1, ALPHA_OPAQUE: 2, ALPHA_BLEND: 3, QUERY: 4 });
/** Occlusion query slots (R-MAP-019): one per model renderer. */
export const QUERY_SLOT = Object.freeze({ MODELS: 0, ANIMATED: 1 });

/** R-CTX-010 steps this module draws (MAP_FRAME_STEPS names). */
export const WORLD_STEPS = Object.freeze([
	'ground',
	'groundPickAndGrid',
	'occluderFadeBegin',
	'staticModels',
	'animatedModels',
	'water',
	'fadedModels'
]);

/** GPUBufferUsage / GPUTextureUsage / GPUShaderStage / GPUMapMode bits (numeric for Node tests). */
const BUFFER = Object.freeze({
	MAP_READ: 0x01,
	COPY_SRC: 0x04,
	COPY_DST: 0x08,
	VERTEX: 0x20,
	UNIFORM: 0x40,
	STORAGE: 0x80,
	QUERY_RESOLVE: 0x200
});
const TEXTURE = Object.freeze({ COPY_DST: 0x02, TEXTURE_BINDING: 0x04 });
const STAGE = Object.freeze({ VERTEX: 0x1, FRAGMENT: 0x2 });
const MAP_READ = 0x01;
/** resolveQuerySet destination offsets are 256-byte aligned. */
const QUERY_RESOLVE_STRIDE = 256;

const NORMAL_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
const OPAQUE_STATE = Object.freeze({ blend: NORMAL_BLEND, depthTest: true, depthWrite: true });
const TRANSLUCENT_STATE = Object.freeze({ blend: NORMAL_BLEND, depthTest: true, depthWrite: false });
/** Line-of-sight query pass: colour writes off (legacy colorMask false), depth test off. */
const QUERY_STATE = Object.freeze({ blend: NORMAL_BLEND, depthTest: false, depthWrite: false, writeMask: 0 });
const WATER_STATE = TRANSLUCENT_STATE;

const ATTR = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
/** Vertex buffer layouts per program (strides in bytes). */
const VERTEX_LAYOUTS = Object.freeze({
	ground: [
		{
			arrayStride: GROUND_VERTEX_FLOATS * 4,
			attributes: [
				ATTR(0, 0, 'float32x3'),
				ATTR(1, 12, 'float32x3'),
				ATTR(2, 24, 'float32x2'),
				ATTR(3, 32, 'float32x2'),
				ATTR(4, 40, 'float32x2')
			]
		}
	],
	water: [{ arrayStride: WATER_VERTEX_FLOATS * 4, attributes: [ATTR(0, 0, 'float32x3'), ATTR(1, 12, 'float32x2')] }],
	grid: [{ arrayStride: GRID_VERTEX_FLOATS * 4, attributes: [ATTR(0, 0, 'float32x3'), ATTR(1, 12, 'float32x2')] }],
	static: [
		{
			arrayStride: MODEL_VERTEX_FLOATS * 4,
			attributes: [
				ATTR(0, 0, 'float32x3'),
				ATTR(1, 12, 'float32x3'),
				ATTR(2, 24, 'float32x2'),
				ATTR(3, 32, 'float32')
			]
		},
		{ arrayStride: 12, attributes: [ATTR(4, 0, 'float32x3')] }
	],
	animated: [
		{
			arrayStride: ANIMATED_VERTEX_FLOATS * 4,
			attributes: [
				ATTR(0, 0, 'float32x3'),
				ATTR(1, 12, 'float32x3'),
				ATTR(2, 24, 'float32x2'),
				ATTR(3, 32, 'float32'),
				ATTR(5, 36, 'float32')
			]
		},
		{ arrayStride: 12, attributes: [ATTR(4, 0, 'float32x3')] }
	]
});
/** Shader module and entry points per program. */
const PROGRAMS = Object.freeze({
	ground: { shader: 'ground', vertex: 'vs_main' },
	grid: { shader: 'grid', vertex: 'vs_main' },
	water: { shader: 'water', vertex: 'vs_main' },
	static: { shader: 'models', vertex: 'vs_static' },
	animated: { shader: 'models', vertex: 'vs_animated' }
});
/** Pipelines compiled at init (the rest, e.g. a water record's own state, on first use). */
const PRECOMPILED = Object.freeze([
	['ground', OPAQUE_STATE],
	['grid', OPAQUE_STATE],
	['water', WATER_STATE],
	['static', OPAQUE_STATE],
	['static', QUERY_STATE],
	['static', TRANSLUCENT_STATE],
	['animated', OPAQUE_STATE],
	['animated', QUERY_STATE],
	['animated', TRANSLUCENT_STATE]
]);

const stateKey = (program, s) =>
	`${program}:${s.blend.src}|${s.blend.dst}:${s.depthTest ? 'T' : 't'}${s.depthWrite ? 'W' : 'w'}:${s.writeMask ?? SCENE_WRITE_MASK}`;

/**
 * Pack one `World` uniform block (shaders/world/common.wgsl) into `out` (byte offset 0).
 * @param {ArrayBuffer} out  at least WORLD_UNIFORM_BYTES
 * @param {{
 *   modelView: ArrayLike<number>, projection: ArrayLike<number>,
 *   light?: {direction: ArrayLike<number>, opacity: number, ambient: ArrayLike<number>, diffuse: ArrayLike<number>, env: ArrayLike<number>},
 *   lightmapUse?: boolean, smoothLight?: number,
 *   occluder?: {mode: number, eye?: ArrayLike<number>, radius?: number, focus?: ArrayLike<number>, opacity?: number, strength?: number},
 *   water?: {waveHeight: number, wavePitch: number, offset: number, opacity: number, layer: number, scale: ArrayLike<number>},
 *   targetHeight?: number, flipY?: boolean,
 *   fog?: {use: boolean, near: number, far: number, color: ArrayLike<number>}
 * }} p
 */
export function packWorldUniforms(out, p) {
	const f = new Float32Array(out, 0, WORLD_UNIFORM_BYTES / 4);
	const u = new Uint32Array(out, 0, WORLD_UNIFORM_BYTES / 4);
	f.fill(0);
	f.set(p.modelView, 0);
	f.set(p.projection, 16);
	if (p.light) {
		f.set(p.light.direction, 32);
		f[35] = p.light.opacity;
		f.set(p.light.ambient, 36);
		f.set(p.light.diffuse, 40);
		f.set(p.light.env, 44);
	}
	u[39] = p.lightmapUse ? 1 : 0;
	u[43] = p.smoothLight ?? 0;
	const occ = p.occluder;
	u[47] = occ?.mode ?? 0;
	if (occ && occ.mode) {
		f.set(occ.eye, 48);
		f[51] = occ.radius;
		f.set(occ.focus, 52);
		f[55] = occ.opacity;
		f[56] = occ.strength;
	}
	const water = p.water;
	if (water) {
		f[57] = water.waveHeight;
		f[58] = water.wavePitch;
		f[59] = water.offset;
		f[60] = water.opacity;
		u[61] = water.layer;
		f[62] = water.scale[0];
		f[63] = water.scale[1];
	}
	f[64] = p.targetHeight ?? 0;
	f[65] = p.flipY ? 1 : 0;
	const fog = p.fog;
	if (fog) {
		f.set(fog.color, 68);
		u[71] = fog.use ? 1 : 0;
		f[72] = fog.near;
		f[73] = fog.far;
	}
	return out;
}

/**
 * @typedef {Object} WorldView  Camera and fog of the frame (the record passes' view)
 * @property {ArrayLike<number>} modelView
 * @property {ArrayLike<number>} projection
 * @property {{use: boolean, near: number, far: number, color: ArrayLike<number>}} [fog]  `use` = pref && map entry
 *
 * @typedef {Object} WorldFrame  Per-frame world inputs (scene side; same shape as gpu-webgl2's)
 * @property {number} [tick]                 Game tick (ms): water wave/frame, animated RSM, occluder Δt
 * @property {boolean} [lightmap]            MapPreferences.lightmap (R-MAP-002/012/013), default true
 * @property {0|1|2} [smoothlight]           MapPreferences.smoothlight (R-MAP-002), default 0
 * @property {boolean} [performanceMode]     R-MAP-016 animated RSM cadence
 * @property {Partial<{direction: ArrayLike<number>, diffuse: ArrayLike<number>, ambient: ArrayLike<number>, env: ArrayLike<number>, opacity: number}>} [light]
 *   Overrides of the map light (night mode, R-CTX-013)
 * @property {{x: number, y: number}[]} [grid]  Grid-selector cells, in draw order (R-MAP-021; scene picks)
 * @property {{mode?: string, opacity?: number, radius?: number, firstPerson?: boolean, focus?: ArrayLike<number>}} [occluder]
 *   R-MAP-018…020 settings and the camera focus
 * @property {Map<AnimatedRsm, Float32Array>} [matrices]  animatedModel records' matrices (replace R-MAP-016/017's)
 * @property {boolean} [flipY]  The view's projection is y-flipped (diagnostics: ANGLE's raster orientation, the
 *   frame lands upside down); the dither cell (R-MAP-020) then reads the framebuffer row as GL's gl_FragCoord.y
 */

/**
 * The per-map GPU scene of gpu-webgpu (MapScene, spec §2.1; port of gpu-webgl2
 * `world/MapWorld.js`): consumes the MAP_* worker payloads (spec §3.2, shapes unchanged)
 * and encodes the world steps of R-CTX-010 into the frame's scene pass — ground (C-03),
 * grid selector, occluder-fade begin, static RSM batch, animated RSM (C-05), water
 * (C-04) and the faded model pass (C-06) — with the legacy shader arithmetic
 * (shaders/ground.wgsl, water.wgsl, models.wgsl, world/*.wgsl).
 *
 * - Textures: ground atlas, lightmap and tile colours as 2D textures (REPEAT, LINEAR);
 *   the 32 water frames as one `texture_2d_array`; model textures as per-size-class arrays
 *   (LayerSet); grid.tga composed as legacy.
 * - Animated RSM: every animated model of the map in one vertex buffer, the matrices in one
 *   storage buffer (`array<mat4x4f>`, architecture §2.2), capped at
 *   `maxStorageBufferBindingSize` (models past it are not drawn; `paletteOverflow`).
 * - Uniforms: one `World` block per draw in a 16-slot buffer with dynamic offsets, written
 *   with `queue.writeBuffer` while the pass is encoded (queue order puts every write before
 *   the frame's submit).
 * - Occluder fade (R-MAP-019): an `occlusion` GPUQuerySet of 2 slots attached to the scene
 *   pass; the line-of-sight redraw of each model renderer runs inside
 *   begin/endOcclusionQuery, is resolved after the pass (`encodeAfterPass`) and read back
 *   with `mapAsync` after the submit (`afterSubmit`). The strength update of a later frame
 *   collects it: the result lags 1 frame when the read-back resolves before the next frame
 *   (legacy GL queries polled with QUERY_RESULT_AVAILABLE behave the same), 2 or more when
 *   the GPU is behind; no query is issued while one is pending.
 *
 * Everything hangs off the instance (no module singletons). The CPU payloads and the decoded
 * images are retained, so a device loss rebuilds the map on the new device without the worker
 * (R-CTX-007, `rebuild`).
 */
export class MapWorld {
	/**
	 * @param {{
	 *   device: GPUDevice,
	 *   images?: import('./worldImages.js').ImageDecoderPort,
	 *   files?: import('./worldImages.js').FilePort,
	 *   createCanvas?: import('./worldImages.js').CreateCanvas,
	 *   unpackGl?: WebGL2RenderingContext|null,
	 *   sampleCount?: number,
	 *   depthFormat?: GPUTextureFormat
	 * }} deps  `unpackGl`: texels through a WebGL unpack, as legacy uploads (worldImages.js)
	 */
	constructor({
		device,
		images,
		files,
		createCanvas = defaultCreateCanvas,
		unpackGl = null,
		sampleCount = MSAA_SAMPLES,
		depthFormat = DEPTH_FORMAT
	}) {
		this.device = device;
		this.createCanvas = createCanvas;
		this.images = images ?? createImageDecoder({ createCanvas });
		this.files = files ?? { load: () => Promise.resolve(null) };
		this.unpackGl = unpackGl;
		this.sampleCount = sampleCount;
		this.depthFormat = depthFormat;
		/** Device objects shared by every map (modules, layouts, samplers, pipelines, uniforms, queries). */
		this._gpu = null;
		this._pending = new Set();
		/** Uniform staging block. */
		this._staging = new ArrayBuffer(WORLD_UNIFORM_BYTES);
		this._slot = 0;
		/** @type {{view: WorldView, frame: WorldFrame, targetHeight: number, records: Record<string, any[]>}|null} */
		this._frameCtx = null;
		/** Query slots begun in the current frame. @type {number[]} */
		this._issued = [];
		/** @type {Promise<void>|null} */
		this._reads = null;
		this._reset();
	}

	/** Forget every map resource (GPU objects and retained payloads). */
	_reset() {
		/** @type {ReturnType<typeof mapLight>|null} */
		this.light = null;
		this.water = null;
		this.ground = null;
		this.altitude = null;
		this.models = null;
		/** @type {AnimatedRsm[]} */
		this.animated = [];
		this.animatedGpu = null;
		this.grid = null;
		this.occluder = {
			strength: 0,
			lastTick: 0,
			eye: new Float32Array(3),
			pending: [false, false],
			ready: [false, false],
			result: [false, false],
			hit: [false, false],
			settings: { ...OCCLUDER_DEFAULTS },
			focus: new Float32Array(3),
			active: false
		};
		/** Animated models left out because the palette exceeds maxStorageBufferBindingSize. */
		this.paletteOverflow = 0;
		/** Draw calls issued by the last `encodeStep`, and over the current frame (diagnostics). */
		this.lastDrawCalls = 0;
		this.frameDrawCalls = 0;
		this._generation = (this._generation ?? 0) + 1;
	}

	/** True once any part of a map arrived (the backend then inserts the world steps). */
	get loaded() {
		return Boolean(this.ground || this.water || this.models || this.animated.length || this.grid);
	}

	/** Resolves once every upload started so far has finished. */
	whenReady() {
		return Promise.all([...this._pending]).then(() => undefined);
	}

	/** Resolves once the occlusion read-backs started by the last submit have landed. */
	whenQueriesRead() {
		return this._reads ?? Promise.resolve();
	}

	/** @param {Promise<any>} promise */
	_track(promise) {
		const tracked = promise.finally(() => this._pending.delete(tracked));
		this._pending.add(tracked);
		return tracked;
	}

	// ---------------------------------------------------------------- device objects

	/** Shader modules, layouts, samplers, the uniform ring, the query set and the census pipelines. */
	async init() {
		const device = this.device;
		const modules = {};
		for (const name of ['ground', 'grid', 'water', 'models']) {
			modules[name] = device.createShaderModule({ label: `world-${name}`, code: SHADERS[name] });
		}
		const uniform = {
			binding: 0,
			visibility: STAGE.VERTEX | STAGE.FRAGMENT,
			buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: WORLD_UNIFORM_BYTES }
		};
		const sampler = { binding: 1, visibility: STAGE.FRAGMENT, sampler: { type: 'filtering' } };
		const tex = (binding, viewDimension) => ({
			binding,
			visibility: STAGE.FRAGMENT,
			texture: { sampleType: 'float', viewDimension }
		});
		const layout = entries => device.createBindGroupLayout({ entries });
		const groups = {
			ground: layout([uniform, sampler, tex(2, '2d'), tex(3, '2d'), tex(4, '2d')]),
			grid: layout([uniform, sampler, tex(2, '2d')]),
			water: layout([uniform, sampler, tex(2, '2d-array')]),
			base: layout([uniform, sampler]),
			animated: layout([
				uniform,
				sampler,
				{ binding: 2, visibility: STAGE.VERTEX, buffer: { type: 'read-only-storage' } }
			]),
			modelTexture: layout([
				{ binding: 0, visibility: STAGE.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } }
			])
		};
		const pipelineLayouts = {
			ground: device.createPipelineLayout({ bindGroupLayouts: [groups.ground] }),
			grid: device.createPipelineLayout({ bindGroupLayouts: [groups.grid] }),
			water: device.createPipelineLayout({ bindGroupLayouts: [groups.water] }),
			static: device.createPipelineLayout({ bindGroupLayouts: [groups.base, groups.modelTexture] }),
			animated: device.createPipelineLayout({ bindGroupLayouts: [groups.animated, groups.modelTexture] })
		};
		const linear = { magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest' };
		const gpu = {
			device,
			modules,
			groups,
			pipelineLayouts,
			/** Legacy default wrap (no wrap set): ground atlas, lightmap, tile colours, grid. */
			repeat: device.createSampler({ ...linear, addressModeU: 'repeat', addressModeV: 'repeat' }),
			/** Water frames and model textures (WebGL.texture: CLAMP_TO_EDGE). */
			clamp: device.createSampler({ ...linear, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }),
			uniforms: device.createBuffer({
				label: 'world-uniforms',
				size: WORLD_UNIFORM_STRIDE * WORLD_UNIFORM_SLOTS,
				usage: BUFFER.UNIFORM | BUFFER.COPY_DST
			}),
			querySet: device.createQuerySet({ label: 'world-occluder', type: 'occlusion', count: 2 }),
			resolve: device.createBuffer({
				label: 'world-occluder-resolve',
				size: QUERY_RESOLVE_STRIDE * 2,
				usage: BUFFER.QUERY_RESOLVE | BUFFER.COPY_SRC
			}),
			readback: [0, 1].map(slot =>
				device.createBuffer({
					label: `world-occluder-read-${slot}`,
					size: 8,
					usage: BUFFER.MAP_READ | BUFFER.COPY_DST
				})
			),
			/** @type {Map<string, GPURenderPipeline>} */
			pipelines: new Map()
		};
		this._gpu = gpu;
		await Promise.all(
			PRECOMPILED.map(async ([program, state]) => {
				const pipeline = await device.createRenderPipelineAsync(this._describe(program, state));
				gpu.pipelines.set(stateKey(program, state), pipeline);
			})
		);
		return this;
	}

	/**
	 * @param {keyof typeof PROGRAMS} program
	 * @param {{blend: {src: string, dst: string}, depthTest: boolean, depthWrite: boolean, writeMask?: number}} state
	 */
	_describe(program, state) {
		const gpu = this._gpu;
		const { shader, vertex } = PROGRAMS[program];
		return {
			label: `world-${stateKey(program, state)}`,
			layout: gpu.pipelineLayouts[program],
			vertex: { module: gpu.modules[shader], entryPoint: vertex, buffers: VERTEX_LAYOUTS[program] },
			fragment: {
				module: gpu.modules[shader],
				entryPoint: 'fs_main',
				targets: [
					{
						format: RENDER_FORMAT,
						blend: toGpuBlend(state.blend),
						writeMask: state.writeMask ?? SCENE_WRITE_MASK
					}
				]
			},
			primitive: { topology: 'triangle-list', cullMode: 'none' },
			depthStencil: {
				format: this.depthFormat,
				depthWriteEnabled: Boolean(state.depthTest && state.depthWrite),
				depthCompare: state.depthTest ? DEFAULT_DEPTH_COMPARE : 'always'
			},
			multisample: { count: this.sampleCount }
		};
	}

	/** A pipeline for `state` (census ones are precompiled; others compile on first use). */
	_pipeline(program, state) {
		const key = stateKey(program, state);
		let pipeline = this._gpu.pipelines.get(key);
		if (!pipeline) {
			pipeline = this.device.createRenderPipeline(this._describe(program, state));
			this._gpu.pipelines.set(key, pipeline);
		}
		return pipeline;
	}

	/** The occlusion query set the scene pass carries (R-MAP-019). */
	get occlusionQuerySet() {
		return this._gpu?.querySet ?? null;
	}

	// ---------------------------------------------------------------- C-17 payloads

	/**
	 * One MAP_* worker message (spec §3.2). Image sources decode asynchronously; the
	 * returned promise settles once this message's GPU uploads are done.
	 * @param {{type: string, payload: any}} msg
	 * @returns {Promise<void>}
	 */
	accept({ type, payload }) {
		switch (type) {
			case 'MAP_WORLD':
				return this._track(this._acceptWorld(payload));
			case 'MAP_GROUND':
				return this._track(this._acceptGround(payload));
			case 'MAP_ALTITUDE':
				return this._track(this._acceptAltitude(payload));
			case 'MAP_MODELS':
				return this._track(this._acceptModels(payload));
			case 'MAP_ANIMATED_MODEL':
				return this._track(this._acceptAnimated(payload));
			default:
				return Promise.resolve();
		}
	}

	/** New map (or `MapRenderer.free`): release the current one. */
	free() {
		this._destroyMap();
		this._reset();
	}

	/** R-CTX-006: every GPU object died with the device; keep the CPU side. */
	contextLost() {
		this._gpu = null;
		for (const part of [this.ground, this.water, this.models, this.animatedGpu, this.grid]) {
			if (part) {
				part.gpu = null;
			}
		}
		this.models?.layers?.forget();
		this.animatedGpu?.layers.forget();
		this.occluder.pending = [false, false];
		this.occluder.ready = [false, false];
		this._issued = [];
	}

	/**
	 * R-CTX-007: the device objects on `device`, then the current map re-uploaded from the
	 * retained payloads and decoded images.
	 * @param {GPUDevice} device
	 */
	async rebuild(device) {
		this.contextLost();
		this.device = device;
		await this.init();
		if (this.ground?.keyed) {
			this._uploadGround();
		}
		if (this.water?.keyed && this.water.vertCount) {
			this._uploadWater();
		}
		if (this.models?.keyed) {
			this._uploadModels();
		}
		if (this.animated.some(m => m.keyed)) {
			this._uploadAnimated();
		}
		if (this.grid) {
			this._uploadGrid();
		}
	}

	async _acceptWorld(payload) {
		this.light = mapLight(payload.light);
		this.water = { params: payload.water, keyed: null, frames: null, mesh: null, vertCount: 0, gpu: null };
		if (this.ground) {
			this._attachWaterMesh();
		}
		await this._decodeWater();
	}

	async _decodeWater() {
		const water = this.water;
		const sources = water.params.images ?? [];
		const generation = this._generation;
		const keyed = await Promise.all(Array.from({ length: WATER_FRAMES }, (_, i) => this.images.decode(sources[i])));
		if (generation !== this._generation || water !== this.water) {
			return;
		}
		water.keyed = keyed;
		if (water.vertCount) {
			this._uploadWater();
		}
	}

	_attachWaterMesh() {
		this.water.mesh = this.ground.payload.waterMesh;
		this.water.vertCount = this.ground.payload.waterVertCount;
		if (this.water.keyed && this.water.vertCount) {
			this._uploadWater();
		}
	}

	async _acceptGround(payload) {
		this.ground = { payload, keyed: null, atlas: null, gpu: null };
		if (this.water) {
			this._attachWaterMesh();
		}
		const ground = this.ground;
		const generation = this._generation;
		const keyed = await Promise.all(payload.textures.map(source => this.images.decode(source)));
		if (generation !== this._generation || ground !== this.ground) {
			return;
		}
		ground.keyed = keyed;
		this._uploadGround();
	}

	async _acceptAltitude(payload) {
		this.altitude = { cells: payload.cells, width: payload.width, height: payload.height };
		const generation = this._generation;
		const source = await this.files.load('data/texture/grid.tga');
		const keyed = source ? await this.images.decode(source) : null;
		if (generation !== this._generation || !keyed) {
			return;
		}
		this.grid = { keyed, texels: null, gpu: null };
		this._uploadGrid();
	}

	async _acceptModels(payload) {
		this.models = { payload, keyed: null, layers: null, gpu: null, runs: [] };
		const models = this.models;
		const generation = this._generation;
		const keyed = await Promise.all(payload.infos.map(info => this.images.decode(info.texture)));
		if (generation !== this._generation || models !== this.models) {
			return;
		}
		models.keyed = keyed;
		this._uploadModels();
	}

	async _acceptAnimated(payload) {
		if (!payload || !payload.nodes || payload.nodes.length === 0) {
			return;
		}
		const base = this.animated.reduce((n, m) => n + m.matrixCount, 0);
		const model = new AnimatedRsm(payload, base);
		model.update(0, false, true);
		this.animated.push(model);
		const generation = this._generation;
		model.keyed = await Promise.all(
			model.textures.map(async name => {
				const source = await this.files.load(`data\\texture\\${name}`);
				return source ? this.images.decode(source) : null;
			})
		);
		if (generation !== this._generation) {
			return;
		}
		this._uploadAnimated();
	}

	// ---------------------------------------------------------------- GPU uploads

	/** A VERTEX buffer holding `data`. @param {Float32Array} data */
	_vertexBuffer(data, label) {
		const buffer = this.device.createBuffer({
			label,
			size: Math.max(4, data.byteLength),
			usage: BUFFER.VERTEX | BUFFER.COPY_DST
		});
		if (data.byteLength) {
			this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
		}
		return buffer;
	}

	/**
	 * An rgba8unorm 2D texture holding `texels` (top row first, as legacy uploads).
	 * @param {{width: number, height: number, data: ArrayBufferView}} texels
	 */
	_texture2d(texels, label) {
		const texture = this.device.createTexture({
			label,
			size: { width: texels.width, height: texels.height, depthOrArrayLayers: 1 },
			format: 'rgba8unorm',
			usage: TEXTURE.COPY_DST | TEXTURE.TEXTURE_BINDING
		});
		const bytes = texels.width * texels.height * 4;
		const data = new Uint8Array(texels.data.buffer, texels.data.byteOffset, bytes);
		this.device.queue.writeTexture(
			{ texture },
			data,
			{ bytesPerRow: texels.width * 4, rowsPerImage: texels.height },
			{ width: texels.width, height: texels.height, depthOrArrayLayers: 1 }
		);
		return texture;
	}

	/** R-MAP-005/006/007: mesh, lightmap atlas, tile colours, texture atlas. */
	_uploadGround() {
		const ground = this.ground;
		const { payload } = ground;
		const size = payload.lightmapSize;
		ground.atlas ??= canvasTexels(composeGroundAtlas(ground.keyed, this.createCanvas), this.unpackGl);
		const lightmap = this._texture2d(
			{
				width: nextPow2(Math.round(Math.sqrt(size)) * 8),
				height: nextPow2(Math.ceil(Math.sqrt(size)) * 8),
				data: payload.lightmap
			},
			'world-lightmap'
		);
		// Legacy WebGL2 path: NPOT, LINEAR, never mipmapped.
		const tileColor = this._texture2d(
			{ width: payload.width, height: payload.height, data: payload.tileColor },
			'world-tile-color'
		);
		const atlas = this._texture2d(ground.atlas, 'world-ground-atlas');
		const gpu = this._gpu;
		ground.gpu = {
			buffer: this._vertexBuffer(payload.mesh, 'world-ground'),
			count: payload.meshVertCount,
			textures: [lightmap, tileColor, atlas],
			group: this.device.createBindGroup({
				layout: gpu.groups.ground,
				entries: [
					{ binding: 0, resource: { buffer: gpu.uniforms, size: WORLD_UNIFORM_BYTES } },
					{ binding: 1, resource: gpu.repeat },
					{ binding: 2, resource: atlas.createView() },
					{ binding: 3, resource: lightmap.createView() },
					{ binding: 4, resource: tileColor.createView() }
				]
			})
		};
	}

	/** R-MAP-008/009: water mesh and the 32 frames as one texture array. */
	_uploadWater() {
		const water = this.water;
		if (water.gpu) {
			water.gpu.buffer.destroy?.();
			water.gpu.texture.destroy?.();
		}
		water.frames ??= water.keyed.map(image =>
			image ? potTexels(image, { createCanvas: this.createCanvas, unpackGl: this.unpackGl }) : null
		);
		const frames = water.frames;
		const size = Math.max(1, ...frames.map(f => (f ? Math.max(f.width, f.height) : 1)));
		const texture = this.device.createTexture({
			label: 'world-water',
			size: { width: size, height: size, depthOrArrayLayers: WATER_FRAMES },
			format: 'rgba8unorm',
			usage: TEXTURE.COPY_DST | TEXTURE.TEXTURE_BINDING
		});
		frames.forEach((frame, layer) => {
			if (frame) {
				this.device.queue.writeTexture(
					{ texture, origin: { x: 0, y: 0, z: layer } },
					padLayer(frame.data, frame.width, frame.height, size, 4),
					{ bytesPerRow: size * 4, rowsPerImage: size },
					{ width: size, height: size, depthOrArrayLayers: 1 }
				);
			}
		});
		const gpu = this._gpu;
		water.gpu = {
			buffer: this._vertexBuffer(water.mesh, 'world-water'),
			texture,
			scales: frames.map(f => (f ? [f.width / size, f.height / size] : null)),
			group: this.device.createBindGroup({
				layout: gpu.groups.water,
				entries: [
					{ binding: 0, resource: { buffer: gpu.uniforms, size: WORLD_UNIFORM_BYTES } },
					{ binding: 1, resource: gpu.clamp },
					{ binding: 2, resource: texture.createView({ dimension: '2d-array' }) }
				]
			})
		};
	}

	/** One bind group (group 1) per texture array of `layers`. @param {LayerSet} layers */
	_layerGroups(layers) {
		const groups = new Map();
		for (const [key, { view }] of layers.arrays) {
			groups.set(
				key,
				this.device.createBindGroup({
					layout: this._gpu.groups.modelTexture,
					entries: [{ binding: 0, resource: view }]
				})
			);
		}
		return groups;
	}

	/**
	 * R-MAP-012 static batch + R-PERF-004: one draw per contiguous run of the infos
	 * (legacy order kept) whose textures share a size-class array.
	 */
	_uploadModels() {
		const models = this.models;
		const { buffer, infos } = models.payload;
		models.layers ??= new LayerSet({ device: this.device });
		if (models.layers.images.length === 0) {
			for (const image of models.keyed) {
				models.layers.add(
					image ? potTexels(image, { createCanvas: this.createCanvas, unpackGl: this.unpackGl }) : null
				);
			}
		}
		models.layers.build(this.device);
		const vertexCount = buffer.length / MODEL_VERTEX_FLOATS;
		const layerData = new Float32Array(vertexCount * 3);
		/** @type {{key: string, first: number, count: number}[]} */
		const runs = [];
		infos.forEach((info, i) => {
			const slot = models.layers.slot(i);
			if (!slot) {
				return;
			}
			for (let v = info.vertOffset; v < info.vertOffset + info.vertCount; v++) {
				layerData.set([slot.layer, slot.scale[0], slot.scale[1]], v * 3);
			}
			const last = runs[runs.length - 1];
			if (last && last.key === slot.key && last.first + last.count === info.vertOffset) {
				last.count += info.vertCount;
			} else {
				runs.push({ key: slot.key, first: info.vertOffset, count: info.vertCount });
			}
		});
		models.runs = runs;
		const gpu = this._gpu;
		models.gpu = {
			buffers: [this._vertexBuffer(buffer, 'world-models'), this._vertexBuffer(layerData, 'world-models-layers')],
			textures: this._layerGroups(models.layers),
			group: this.device.createBindGroup({
				layout: gpu.groups.base,
				entries: [
					{ binding: 0, resource: { buffer: gpu.uniforms, size: WORLD_UNIFORM_BYTES } },
					{ binding: 1, resource: gpu.clamp }
				]
			})
		};
	}

	/**
	 * R-MAP-017: every animated model in one vertex buffer, one shared storage-buffer palette
	 * (architecture §2.2), capped at maxStorageBufferBindingSize.
	 */
	_uploadAnimated() {
		this._destroyAnimated();
		const limit = this.device.limits?.maxStorageBufferBindingSize ?? 134217728;
		const maxMatrices = Math.floor(limit / 64);
		const fits = model => model.matrixBase + model.matrixCount <= maxMatrices;
		this.paletteOverflow = this.animated.filter(m => !fits(m)).length;
		const layers = this.animatedGpu?.layers ?? new LayerSet({ device: this.device });
		const ready = this.animated.filter(m => m.keyed && fits(m));
		for (const model of ready) {
			if (model.slots === undefined) {
				model.slots = model.keyed.map(image =>
					layers.add(
						image ? potTexels(image, { createCanvas: this.createCanvas, unpackGl: this.unpackGl }) : null
					)
				);
			}
		}
		layers.build(this.device);
		const total = ready.reduce((n, m) => n + m.vertexCount, 0);
		const vertices = new Float32Array(total * ANIMATED_VERTEX_FLOATS);
		const layerData = new Float32Array(total * 3);
		/** @type {{key: string, first: number, count: number}[]} */
		const runs = [];
		let base = 0;
		for (const model of ready) {
			vertices.set(model.vertexData, base * ANIMATED_VERTEX_FLOATS);
			for (const mesh of model.meshes) {
				const slot = layers.slot(model.slots[mesh.textureIndex] ?? -1);
				const first = base + mesh.vertOffset;
				if (!slot) {
					continue;
				}
				for (let v = first; v < first + mesh.vertCount; v++) {
					layerData.set([slot.layer, slot.scale[0], slot.scale[1]], v * 3);
				}
				const last = runs[runs.length - 1];
				if (last && last.key === slot.key && last.first + last.count === first) {
					last.count += mesh.vertCount;
				} else {
					runs.push({ key: slot.key, first, count: mesh.vertCount });
				}
			}
			base += model.vertexCount;
		}
		const matrices = Math.min(
			maxMatrices,
			this.animated.reduce((n, m) => n + m.matrixCount, 0)
		);
		const gpu = this._gpu;
		const palette = this.device.createBuffer({
			label: 'world-animated-palette',
			size: Math.max(64, matrices * 64),
			usage: BUFFER.STORAGE | BUFFER.COPY_DST
		});
		this.animatedGpu = {
			layers,
			runs,
			paletteData: new Float32Array(Math.max(1, matrices) * 16),
			dirty: true,
			gpu: {
				buffers: [
					this._vertexBuffer(vertices, 'world-animated'),
					this._vertexBuffer(layerData, 'world-animated-layers')
				],
				palette,
				textures: this._layerGroups(layers),
				group: this.device.createBindGroup({
					layout: gpu.groups.animated,
					entries: [
						{ binding: 0, resource: { buffer: gpu.uniforms, size: WORLD_UNIFORM_BYTES } },
						{ binding: 1, resource: gpu.clamp },
						{ binding: 2, resource: { buffer: palette } }
					]
				})
			}
		};
	}

	/** R-MAP-021: grid.tga at alpha 0.6, tinted, POT. */
	_uploadGrid() {
		const grid = this.grid;
		grid.texels ??= canvasTexels(composeGridTexture(grid.keyed, this.createCanvas), this.unpackGl);
		const texture = this._texture2d(grid.texels, 'world-grid');
		const gpu = this._gpu;
		grid.gpu = {
			buffer: null,
			capacity: 0,
			texture,
			group: this.device.createBindGroup({
				layout: gpu.groups.grid,
				entries: [
					{ binding: 0, resource: { buffer: gpu.uniforms, size: WORLD_UNIFORM_BYTES } },
					{ binding: 1, resource: gpu.repeat },
					{ binding: 2, resource: texture.createView() }
				]
			})
		};
	}

	_destroyAnimated() {
		const part = this.animatedGpu?.gpu;
		if (!part) {
			return;
		}
		part.buffers.forEach(b => b.destroy?.());
		part.palette.destroy?.();
		this.animatedGpu.layers.dispose();
		this.animatedGpu.gpu = null;
	}

	_destroyMap() {
		const destroy = o => o?.destroy?.();
		if (this.ground?.gpu) {
			destroy(this.ground.gpu.buffer);
			this.ground.gpu.textures.forEach(destroy);
		}
		if (this.water?.gpu) {
			destroy(this.water.gpu.buffer);
			destroy(this.water.gpu.texture);
		}
		if (this.models?.gpu) {
			this.models.gpu.buffers.forEach(destroy);
			this.models.layers.dispose();
		}
		this._destroyAnimated();
		if (this.grid?.gpu) {
			destroy(this.grid.gpu.buffer);
			destroy(this.grid.gpu.texture);
		}
	}

	/** Device objects too (dispose of the backend). */
	destroy() {
		this.free();
		const gpu = this._gpu;
		if (gpu) {
			[gpu.uniforms, gpu.resolve, ...gpu.readback, gpu.querySet].forEach(o => o?.destroy?.());
		}
		this._gpu = null;
	}

	// ---------------------------------------------------------------- frame

	/**
	 * Start a frame: the uniform slots, the frame's view and world inputs, the `world`
	 * records per step (a `water` record supplies the R-MAP-010 alpha, R-MAP-009 frame and
	 * depth state; `animatedModel` records with `matrices` and `params.model` replace that
	 * model's R-MAP-016/017 matrices).
	 * @param {{view: WorldView, frame?: WorldFrame, targetHeight: number, records?: Record<string, ReadonlyArray<any>>}} ctx
	 */
	beginFrame({ view, frame = {}, targetHeight, records = {} }) {
		this._slot = 0;
		// Queries of a frame that never reached its submit (afterSubmit clears the list) are dropped.
		for (const slot of this._issued) {
			this.occluder.pending[slot] = false;
		}
		this._issued = [];
		this.frameDrawCalls = 0;
		const matrices = new Map();
		for (const r of records.animatedModels ?? []) {
			const model = r.part === 'animatedModel' ? this.animated[r.params?.model ?? -1] : null;
			if (model && r.matrices) {
				matrices.set(model, r.matrices);
			}
		}
		this._frameCtx = { view, frame: { ...frame, matrices }, targetHeight, records };
	}

	/**
	 * Encode one R-CTX-010 world step into the scene pass (stream position of the step).
	 * @param {GPURenderPassEncoder} pass
	 * @param {string} step  one of WORLD_STEPS
	 * @returns {number} draw calls
	 */
	encodeStep(pass, step) {
		const ctx = this._frameCtx;
		this.lastDrawCalls = 0;
		if (!ctx || !this._gpu) {
			return 0;
		}
		const { view, frame, records } = ctx;
		switch (step) {
			case 'ground':
				this._drawGround(pass, view, frame);
				break;
			case 'groundPickAndGrid':
				this._drawGrid(pass, view, frame.grid ?? []);
				break;
			case 'occluderFadeBegin':
				this.beginOccluder(view, frame);
				break;
			case 'staticModels':
				this._drawStaticModels(pass, view, frame);
				break;
			case 'animatedModels':
				this._drawAnimatedModels(pass, view, frame);
				break;
			case 'water':
				this._drawWater(pass, view, frame, (records.water ?? []).find(r => r.part === 'water') ?? null);
				break;
			case 'fadedModels':
				this._drawFaded(pass, view, frame);
				break;
			default:
				break;
		}
		this.frameDrawCalls += this.lastDrawCalls;
		return this.lastDrawCalls;
	}

	/**
	 * After the scene pass: resolve this frame's occlusion queries into the read-back buffers.
	 * @param {GPUCommandEncoder} encoder
	 */
	encodeAfterPass(encoder) {
		const gpu = this._gpu;
		if (!gpu) {
			return;
		}
		for (const slot of this._issued) {
			const offset = slot * QUERY_RESOLVE_STRIDE;
			encoder.resolveQuerySet(gpu.querySet, slot, 1, gpu.resolve, offset);
			encoder.copyBufferToBuffer(gpu.resolve, offset, gpu.readback[slot], 0, 8);
		}
	}

	/** After the submit: map this frame's query read-backs (collected by a later frame). */
	afterSubmit() {
		const gpu = this._gpu;
		const issued = this._issued;
		this._issued = [];
		if (!gpu || issued.length === 0) {
			return;
		}
		const occ = this.occluder;
		const generation = this._generation;
		this._reads = Promise.all(
			issued.map(slot => {
				const buffer = gpu.readback[slot];
				return buffer.mapAsync(MAP_READ).then(
					() => {
						const samples = new BigUint64Array(buffer.getMappedRange(0, 8))[0];
						buffer.unmap();
						if (generation === this._generation && this._gpu === gpu) {
							occ.result[slot] = samples > 0n;
							occ.ready[slot] = true;
						}
					},
					() => {
						// Device lost before the read-back: forget the query.
						if (this._gpu === gpu) {
							occ.pending[slot] = false;
						}
					}
				);
			})
		).then(() => undefined);
	}

	/**
	 * One World uniform block for the next draw; returns its dynamic offset.
	 * @param {Parameters<typeof packWorldUniforms>[1]} fields
	 */
	_uniforms(fields) {
		if (this._slot >= WORLD_UNIFORM_SLOTS) {
			throw new RangeError('MapWorld: more world draws in one frame than uniform slots');
		}
		const offset = this._slot++ * WORLD_UNIFORM_STRIDE;
		packWorldUniforms(this._staging, {
			...fields,
			targetHeight: this._frameCtx?.targetHeight ?? 0,
			flipY: Boolean(this._frameCtx?.frame.flipY)
		});
		this.device.queue.writeBuffer(this._gpu.uniforms, offset, this._staging, 0, WORLD_UNIFORM_BYTES);
		return offset;
	}

	/** Map light with the frame's overrides (R-CTX-012, R-CTX-013); the GR2 pass reads it too. @param {WorldFrame} frame */
	frameLight(frame = {}) {
		return this._light(frame);
	}

	/** Map light with the frame's overrides (R-CTX-012, R-CTX-013). @param {WorldFrame} frame */
	_light(frame) {
		const base =
			this.light ?? mapLight({ longitude: 45, latitude: 45, diffuse: [1, 1, 1], ambient: [0, 0, 0], opacity: 1 });
		return { ...base, ...(frame.light ?? {}) };
	}

	/** @param {WorldView} view */
	_fog(view) {
		return view.fog ?? { use: false, near: 0, far: 1, color: [0, 0, 0] };
	}

	/** Uniform fields shared by the lit passes. */
	_lit(view, frame) {
		return {
			modelView: view.modelView,
			projection: view.projection,
			light: this._light(frame),
			lightmapUse: frame.lightmap !== false,
			fog: this._fog(view)
		};
	}

	/** R-CTX-010 step 3, R-MAP-001…007. */
	_drawGround(pass, view, frame) {
		const part = this.ground?.gpu;
		if (!part) {
			return;
		}
		const offset = this._uniforms({ ...this._lit(view, frame), smoothLight: frame.smoothlight ?? 0 });
		pass.setPipeline(this._pipeline('ground', OPAQUE_STATE));
		pass.setBindGroup(0, part.group, [offset]);
		pass.setVertexBuffer(0, part.buffer);
		pass.draw(part.count, 1, 0, 0);
		this.lastDrawCalls++;
	}

	/**
	 * R-CTX-010 step 5, R-MAP-021: one draw for every selector cell, in order (each cell is
	 * the legacy 4-vertex strip as two triangles: same vertices, same order).
	 * @param {ReadonlyArray<{x: number, y: number}>} cells
	 */
	_drawGrid(pass, view, cells) {
		const part = this.grid?.gpu;
		if (!part || cells.length === 0) {
			return;
		}
		const data = new Float32Array(cells.length * 6 * GRID_VERTEX_FLOATS);
		cells.forEach(({ x, y }, i) => {
			const z = this.cellCorners(x, y);
			const v = [
				[x, z[0], y, 0, 0],
				[x + 1, z[1], y, 1, 0],
				[x, z[2], y + 1, 0, 1],
				[x + 1, z[3], y + 1, 1, 1]
			];
			data.set([...v[0], ...v[1], ...v[2], ...v[2], ...v[1], ...v[3]], i * 30);
		});
		if (part.capacity < data.byteLength) {
			// Not destroyed: an earlier submitted frame may still read it.
			part.capacity = nextPow2(data.byteLength);
			part.buffer = this.device.createBuffer({
				label: 'world-grid',
				size: part.capacity,
				usage: BUFFER.VERTEX | BUFFER.COPY_DST
			});
		}
		this.device.queue.writeBuffer(part.buffer, 0, data.buffer, 0, data.byteLength);
		const offset = this._uniforms({ modelView: view.modelView, projection: view.projection, fog: this._fog(view) });
		pass.setPipeline(this._pipeline('grid', OPAQUE_STATE));
		pass.setBindGroup(0, part.group, [offset]);
		pass.setVertexBuffer(0, part.buffer);
		pass.draw(cells.length * 6, 1, 0, 0);
		this.lastDrawCalls++;
	}

	/**
	 * GAT corner heights of a cell (legacy Altitude.getCell): zero outside the map.
	 * @param {number} x
	 * @param {number} y
	 */
	cellCorners(x, y) {
		const alt = this.altitude;
		const cx = Math.floor(x);
		const cy = Math.floor(y);
		const out = new Float32Array(4);
		if (!alt || cx < 0 || cy < 0 || cx >= alt.width || cy >= alt.height) {
			return out;
		}
		const index = (cx + cy * alt.width) * 5;
		out.set(alt.cells.subarray(index, index + 4));
		return out;
	}

	/**
	 * R-CTX-010 step 7, R-MAP-018/019: collect the finished occlusion queries and ease the
	 * fade strength; refresh the eye (inverse view) and the focus.
	 * @param {WorldView} view
	 * @param {WorldFrame} frame
	 */
	beginOccluder(view, frame = {}) {
		const occ = this.occluder;
		const settings = { ...OCCLUDER_DEFAULTS, ...(frame.occluder ?? {}) };
		occ.settings = settings;
		occ.focus.set(frame.occluder?.focus ?? [0, 0, 0]);
		const inverse = invert(new Float32Array(16), view.modelView);
		if (inverse) {
			occ.eye[0] = inverse[12];
			occ.eye[1] = inverse[13];
			occ.eye[2] = inverse[14];
		}
		const tick = frame.tick ?? 0;
		const dt = occ.lastTick ? Math.min(tick - occ.lastTick, OCCLUDER_QUERY.dtCapMs) : 0;
		occ.lastTick = tick;
		occ.active = occluderFadeActive(settings.mode, settings.firstPerson ? 'first' : 'third');
		if (!occ.active) {
			occ.strength = 0;
			return;
		}
		for (let slot = 0; slot < 2; slot++) {
			if (occ.pending[slot] && occ.ready[slot]) {
				occ.hit[slot] = occ.result[slot];
				occ.pending[slot] = false;
				occ.ready[slot] = false;
			}
		}
		if (occ.hit[QUERY_SLOT.MODELS] || occ.hit[QUERY_SLOT.ANIMATED]) {
			occ.strength = Math.min(1, occ.strength + dt / OCCLUDER_QUERY.fadeInMs);
		} else {
			occ.strength = Math.max(0, occ.strength - dt / OCCLUDER_QUERY.fadeOutMs);
		}
	}

	/** Whether the fade shows this frame (R-MAP-018). */
	_fading() {
		return this.occluder.active && this.occluder.strength > 0.001;
	}

	_occluderFields(mode) {
		const occ = this.occluder;
		if (mode === OCCLUDER_MODE.OFF) {
			return { mode };
		}
		return {
			mode,
			eye: occ.eye,
			focus: occ.focus,
			radius: mode === OCCLUDER_MODE.QUERY ? OCCLUDER_QUERY.axisRadius : occ.settings.radius,
			opacity: occ.settings.opacity,
			strength: occ.strength
		};
	}

	_opaqueMode() {
		if (!this._fading()) {
			return OCCLUDER_MODE.OFF;
		}
		return this.occluder.settings.mode === 'alpha' ? OCCLUDER_MODE.ALPHA_OPAQUE : OCCLUDER_MODE.DITHER;
	}

	/**
	 * Opaque pass then the line-of-sight query pass of one model renderer (R-MAP-019/020).
	 * @param {GPURenderPassEncoder} pass
	 * @param {'static'|'animated'} program
	 * @param {object} lit  uniform fields
	 * @param {(offset: number) => void} draw  binds group 0 at `offset` and draws the runs
	 * @param {number} slot
	 */
	_opaqueAndQuery(pass, program, lit, draw, slot) {
		const occ = this.occluder;
		pass.setPipeline(this._pipeline(program, OPAQUE_STATE));
		draw(this._uniforms({ ...lit, occluder: this._occluderFields(this._opaqueMode()) }));
		if (!occ.active || occ.pending[slot]) {
			return;
		}
		pass.setPipeline(this._pipeline(program, QUERY_STATE));
		const offset = this._uniforms({ ...lit, occluder: this._occluderFields(OCCLUDER_MODE.QUERY) });
		pass.beginOcclusionQuery(slot);
		draw(offset);
		pass.endOcclusionQuery();
		occ.pending[slot] = true;
		occ.ready[slot] = false;
		this._issued.push(slot);
	}

	/**
	 * @param {GPURenderPassEncoder} pass
	 * @param {{key: string, first: number, count: number}[]} runs
	 * @param {Map<string, GPUBindGroup>} textures
	 */
	_drawRuns(pass, runs, textures) {
		let bound = null;
		for (const run of runs) {
			const group = textures.get(run.key);
			if (group !== bound) {
				pass.setBindGroup(1, group);
				bound = group;
			}
			pass.draw(run.count, 1, run.first, 0);
			this.lastDrawCalls++;
		}
	}

	/** Group 0 at `offset`, the vertex buffers, then the runs. */
	_modelDraw(pass, part, runs) {
		return offset => {
			pass.setBindGroup(0, part.group, [offset]);
			pass.setVertexBuffer(0, part.buffers[0]);
			pass.setVertexBuffer(1, part.buffers[1]);
			this._drawRuns(pass, runs, part.textures);
		};
	}

	/** R-CTX-010 step 8, R-MAP-012, R-PERF-004. */
	_drawStaticModels(pass, view, frame) {
		const part = this.models?.gpu;
		if (!part) {
			return;
		}
		this._opaqueAndQuery(
			pass,
			'static',
			this._lit(view, frame),
			this._modelDraw(pass, part, this.models.runs),
			QUERY_SLOT.MODELS
		);
	}

	/** Recompute the matrices whose R-MAP-016 bucket changed and upload the palette. */
	_updatePalette(frame) {
		const gpu = this.animatedGpu;
		let dirty = gpu.dirty;
		for (const model of this.animated) {
			if (frame.matrices?.has(model)) {
				model.matrices.set(frame.matrices.get(model));
				dirty = true;
			} else if (model.update(frame.tick ?? 0, Boolean(frame.performanceMode))) {
				dirty = true;
			}
		}
		if (!dirty) {
			return;
		}
		const capacity = gpu.paletteData.length / 16;
		for (const model of this.animated) {
			if (model.matrixBase + model.matrixCount <= capacity) {
				gpu.paletteData.set(model.matrices, model.matrixBase * 16);
			}
		}
		this.device.queue.writeBuffer(gpu.gpu.palette, 0, gpu.paletteData.buffer, 0, gpu.paletteData.byteLength);
		gpu.dirty = false;
	}

	/**
	 * R-CTX-010 step 9, R-MAP-013 (fixed: honours the lightmap preference), R-MAP-016/017.
	 */
	_drawAnimatedModels(pass, view, frame) {
		const gpu = this.animatedGpu;
		if (!gpu?.gpu || this.animated.length === 0) {
			return;
		}
		this._updatePalette(frame);
		this._opaqueAndQuery(
			pass,
			'animated',
			this._lit(view, frame),
			this._modelDraw(pass, gpu.gpu, gpu.runs),
			QUERY_SLOT.ANIMATED
		);
	}

	/**
	 * R-CTX-010 step 15, R-MAP-008…011. Fields of a `world`/`water` record (R-MAP-010
	 * alpha, R-MAP-009 frame, depth state) win over the local computation.
	 */
	_drawWater(pass, view, frame, record) {
		const water = this.water;
		if (!water?.gpu || !water.vertCount) {
			return;
		}
		const params = water.params;
		const tick = frame.tick ?? 0;
		const layer = record?.textureIndex ?? waterFrameIndex(tick, params.animSpeed);
		const scale = water.gpu.scales[layer];
		if (!scale) {
			return;
		}
		const state = {
			blend: record?.blend ?? NORMAL_BLEND,
			depthTest: record?.depthTest ?? true,
			depthWrite: record?.depthWrite ?? false
		};
		const offset = this._uniforms({
			modelView: view.modelView,
			projection: view.projection,
			fog: this._fog(view),
			water: {
				waveHeight: params.waveHeight,
				wavePitch: params.wavePitch,
				offset: record?.params?.waveOffset ?? waveOffset(tick, params.waveSpeed),
				opacity: record?.alpha ?? waterOpacity(params.type),
				layer,
				scale
			}
		});
		pass.setPipeline(this._pipeline('water', state));
		pass.setBindGroup(0, water.gpu.group, [offset]);
		pass.setVertexBuffer(0, water.gpu.buffer);
		pass.draw(water.vertCount, 1, 0, 0);
		this.lastDrawCalls++;
	}

	/**
	 * R-CTX-010 step 16, R-MAP-020 alpha mode: the faded region of the static then the
	 * animated models, translucent (depth test on, write off), after the entities.
	 */
	_drawFaded(pass, view, frame) {
		if (!(this._fading() && this.occluder.settings.mode === 'alpha')) {
			return;
		}
		const lit = { ...this._lit(view, frame), occluder: this._occluderFields(OCCLUDER_MODE.ALPHA_BLEND) };
		if (this.models?.gpu) {
			pass.setPipeline(this._pipeline('static', TRANSLUCENT_STATE));
			this._modelDraw(pass, this.models.gpu, this.models.runs)(this._uniforms(lit));
		}
		if (this.animatedGpu?.gpu && this.animated.length) {
			pass.setPipeline(this._pipeline('animated', TRANSLUCENT_STATE));
			this._modelDraw(pass, this.animatedGpu.gpu, this.animatedGpu.runs)(this._uniforms(lit));
		}
	}

	/** Current occluder fade strength (diagnostics). */
	get occluderStrength() {
		return this.occluder.strength;
	}
}
