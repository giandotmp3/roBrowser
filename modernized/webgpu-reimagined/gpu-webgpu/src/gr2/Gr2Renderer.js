import {
	DEFAULT_DEPTH_COMPARE,
	DEPTH_FORMAT,
	GR2_ALPHA_REF,
	GR2_MAX_BONES,
	MSAA_SAMPLES,
	RENDER_FORMAT
} from '../constants.js';
import { SHADERS } from '../shaders/index.js';
import { toGpuBlend } from '../pipelines/blendMap.js';
import { SCENE_WRITE_MASK } from '../pipelines/PipelineSet.js';
import { nextPow2 } from '../math.js';
import { multiply } from '../world/glm32.js';
import { GR2_VERTEX_FLOATS, gr2LightUniforms } from './gr2.js';

/** Bytes of one bone palette (48 mat4, the WGSL `array<mat4x4f, 48>`); a multiple of 256. */
export const GR2_PALETTE_BYTES = GR2_MAX_BONES * 64;
const PALETTE_FLOATS = GR2_PALETTE_BYTES / 4;
/** Bytes of the WGSL `Gr2` uniform block (shaders/gr2.wgsl). */
export const GR2_INSTANCE_BYTES = 272;
/** Dynamic-offset stride of one instance block (minUniformBufferOffsetAlignment 256). */
const INSTANCE_STRIDE = 512;

/** GPUBufferUsage / GPUShaderStage bits (numeric for Node tests). */
const BUFFER = Object.freeze({ COPY_DST: 0x08, UNIFORM: 0x40 });
const STAGE = Object.freeze({ VERTEX: 0x1, FRAGMENT: 0x2 });

const NORMAL_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
const NO_ENV = Object.freeze([1, 1, 1]);
const NO_FOG = Object.freeze({ use: false, near: 0, far: 1, color: [0, 0, 0] });

/** The GR2 interleave (gr2.js interleaveGr2Mesh): position, normal, uv, bone index, bone weight. */
const VERTEX_LAYOUT = Object.freeze([
	{
		arrayStride: GR2_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x3' },
			{ shaderLocation: 1, offset: 12, format: 'float32x3' },
			{ shaderLocation: 2, offset: 24, format: 'float32x2' },
			{ shaderLocation: 3, offset: 32, format: 'float32x4' },
			{ shaderLocation: 4, offset: 48, format: 'float32x4' }
		]
	}
]);

const blendKey = blend => (blend ? `${blend.src}|${blend.dst}` : 'opaque');

/**
 * Pack one `Gr2` uniform block (shaders/gr2.wgsl) into `out` at float offset `at`.
 * @param {Float32Array} out
 * @param {number} at  float offset (block start)
 * @param {{
 *   modelView: ArrayLike<number>, projection: ArrayLike<number>, normal: ArrayLike<number>,
 *   lightDirection: ArrayLike<number>, lightOpacity: number, ambient: ArrayLike<number>,
 *   diffuse: ArrayLike<number>, env: ArrayLike<number>, alphaRef: number, alpha: number,
 *   fog: {use: boolean, near: number, far: number, color: ArrayLike<number>}
 * }} p
 */
export function packGr2Instance(out, at, p) {
	const u = new Uint32Array(out.buffer, out.byteOffset, out.length);
	out.fill(0, at, at + GR2_INSTANCE_BYTES / 4);
	out.set(p.modelView, at);
	out.set(p.projection, at + 16);
	// mat3x3f: three vec3 columns, each padded to 16 bytes.
	for (let c = 0; c < 3; c++) {
		for (let r = 0; r < 3; r++) {
			out[at + 32 + c * 4 + r] = p.normal[c * 3 + r];
		}
	}
	out.set(p.lightDirection, at + 44);
	out[at + 47] = p.lightOpacity;
	out.set(p.ambient, at + 48);
	out[at + 51] = p.alphaRef;
	out.set(p.diffuse, at + 52);
	out[at + 55] = p.alpha;
	out.set(p.env, at + 56);
	out.set(p.fog.color, at + 60);
	u[at + 63] = p.fog.use ? 1 : 0;
	out[at + 64] = p.fog.near;
	out[at + 65] = p.fog.far;
	return out;
}

/**
 * @typedef {Object} Gr2Record  A GR2 instance draw (WorldDraw-shaped, part 'gr2'; same shape as gpu-webgl2's)
 * @property {'world'} kind
 * @property {'gr2'} part
 * @property {number} alpha                 entity alpha (effectColor[3], R-GR2-005); < 1 blends
 * @property {Float32Array} matrices        bone palette: boneCount ≤ 48 column-major mat4 (R-GR2-003)
 * @property {{src: string, dst: string}} [blend]  fade blend (default normal alpha)
 * @property {{type: string, world: ArrayLike<number>, emblem?: unknown}} params
 *   type: the .gr2 path (residency key, R-GR2-001 profile); world: the instance world
 *   matrix (column-major, R-GR2-004 facing applied); emblem: the guild emblem handle (R-GR2-006)
 */

/**
 * The GR2 pass of gpu-webgpu (R-CTX-010 step 11, C-14; port of gpu-webgl2 `gr2/Gr2Pipeline.js`):
 * GPU skinning with a 48-bone palette per instance, the R-GR2-001 per-model light, the
 * R-GR2-002 hard alpha test with depth test and write (no blend), the entity alpha (a
 * normal-alpha pipeline only while < 1) and the R-GR2-006 emblem submesh.
 *
 * Per frame, two uniform buffers written with `queue.writeBuffer` while the pass is encoded:
 * the palettes (each distinct palette once, so instances sharing a 40 Hz pose share it) and
 * one `Gr2` block per instance; group 0 binds both with dynamic offsets. Group 1 is the
 * submesh texture (or the instance's emblem). The per-instance matrices follow legacy
 * GR2ModelRenderer.render exactly (float32 view·world, inverse-transpose normal matrix,
 * view-space light direction), as gpu-webgl2. One `drawIndexed` per submesh per instance,
 * in record order. Colour writes RGB only (SCENE_WRITE_MASK), as every scene pipeline.
 */
export class Gr2Renderer {
	/**
	 * @param {{
	 *   device: GPUDevice,
	 *   residency: import('./Gr2Residency.js').Gr2Residency,
	 *   sampleCount?: number,
	 *   depthFormat?: GPUTextureFormat
	 * }} deps
	 */
	constructor({ device, residency, sampleCount = MSAA_SAMPLES, depthFormat = DEPTH_FORMAT }) {
		this.device = device;
		this.residency = residency;
		this.sampleCount = sampleCount;
		this.depthFormat = depthFormat;
		this._mv = new Float32Array(16);
		this._nmat = new Float32Array(9);
		this._lightView = new Float32Array(3);
		this._gpu = null;
		this._resetFrameState();
	}

	_resetFrameState() {
		this._instanceStaging = new Float32Array(0);
		this._paletteStaging = new Float32Array(0);
		/** Draw calls issued by the last encode() (diagnostics). */
		this.lastDrawCalls = 0;
		/** Distinct palettes uploaded by the last encode(). */
		this.lastPalettes = 0;
		/** Instances drawn by the last encode(). */
		this.lastInstances = 0;
	}

	/** Shader module, layouts, sampler, the opaque and normal-fade pipelines. */
	async init() {
		const device = this.device;
		const module = device.createShaderModule({ label: 'gr2', code: SHADERS.gr2 });
		const frameLayout = device.createBindGroupLayout({
			label: 'gr2-frame',
			entries: [
				{
					binding: 0,
					visibility: STAGE.VERTEX | STAGE.FRAGMENT,
					buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: GR2_INSTANCE_BYTES }
				},
				{
					binding: 1,
					visibility: STAGE.VERTEX,
					buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: GR2_PALETTE_BYTES }
				},
				{ binding: 2, visibility: STAGE.FRAGMENT, sampler: { type: 'filtering' } }
			]
		});
		const textureLayout = device.createBindGroupLayout({
			label: 'gr2-texture',
			entries: [{ binding: 0, visibility: STAGE.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } }]
		});
		this._gpu = {
			module,
			frameLayout,
			textureLayout,
			layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, textureLayout] }),
			// The client's sampler 0 (legacy makeTypeTextures): LINEAR, CLAMP_TO_EDGE, no mipmaps.
			sampler: device.createSampler({
				label: 'gr2',
				magFilter: 'linear',
				minFilter: 'linear',
				mipmapFilter: 'nearest',
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge'
			}),
			/** @type {Map<string, GPURenderPipeline>} */
			pipelines: new Map(),
			instances: null,
			palettes: null,
			group: null
		};
		this.residency.textureLayout = textureLayout;
		await Promise.all(
			[null, NORMAL_BLEND].map(async blend => {
				const pipeline = await device.createRenderPipelineAsync(this._describe(blend));
				this._gpu.pipelines.set(blendKey(blend), pipeline);
			})
		);
		return this;
	}

	/** Device loss: every GPU object died; `init()` again on `device`. @param {GPUDevice} device */
	reset(device = this.device) {
		this.device = device;
		this._gpu = null;
		this._resetFrameState();
	}

	/** The group-1 layout (Gr2Residency's texture bind groups). */
	get textureLayout() {
		return this._gpu?.textureLayout ?? null;
	}

	/** Pipelines compiled so far (diagnostics). */
	get pipelineCount() {
		return this._gpu?.pipelines.size ?? 0;
	}

	/** @param {{src: string, dst: string}|null} blend  null: opaque (R-GR2-002) */
	_describe(blend) {
		const gpu = this._gpu;
		return {
			label: `gr2-${blendKey(blend)}`,
			layout: gpu.layout,
			vertex: { module: gpu.module, entryPoint: 'vs_main', buffers: VERTEX_LAYOUT },
			fragment: {
				module: gpu.module,
				entryPoint: 'fs_main',
				targets: [
					{
						format: RENDER_FORMAT,
						...(blend ? { blend: toGpuBlend(blend) } : {}),
						writeMask: SCENE_WRITE_MASK
					}
				]
			},
			primitive: { topology: 'triangle-list', cullMode: 'none' },
			// R-GR2-002: depth test and write on (depth correction does not apply to this program).
			depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: DEFAULT_DEPTH_COMPARE },
			multisample: { count: this.sampleCount }
		};
	}

	_pipeline(blend) {
		const key = blendKey(blend);
		let pipeline = this._gpu.pipelines.get(key);
		if (!pipeline) {
			pipeline = this.device.createRenderPipeline(this._describe(blend));
			this._gpu.pipelines.set(key, pipeline);
		}
		return pipeline;
	}

	/** Grow the per-frame uniform buffers to hold `instances` blocks and `palettes` palettes. */
	_ensureCapacity(instances, palettes) {
		const gpu = this._gpu;
		const grow = (current, bytes, label) => {
			if (current && current.capacity >= bytes) {
				return current;
			}
			// The old buffer is not destroyed: an earlier submitted frame may still read it.
			const capacity = nextPow2(bytes);
			const buffer = this.device.createBuffer({ label, size: capacity, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
			return { buffer, capacity };
		};
		const instanceBuffer = grow(gpu.instances, instances * INSTANCE_STRIDE, 'gr2-instances');
		const paletteBuffer = grow(gpu.palettes, palettes * GR2_PALETTE_BYTES, 'gr2-palettes');
		if (instanceBuffer !== gpu.instances || paletteBuffer !== gpu.palettes || !gpu.group) {
			gpu.instances = instanceBuffer;
			gpu.palettes = paletteBuffer;
			gpu.group = this.device.createBindGroup({
				label: 'gr2-frame',
				layout: gpu.frameLayout,
				entries: [
					{ binding: 0, resource: { buffer: instanceBuffer.buffer, size: GR2_INSTANCE_BYTES } },
					{ binding: 1, resource: { buffer: paletteBuffer.buffer, size: GR2_PALETTE_BYTES } },
					{ binding: 2, resource: gpu.sampler }
				]
			});
		}
	}

	/**
	 * Encode the GR2 records of one frame into the scene pass (the R-CTX-010 GR2 step).
	 * @param {GPURenderPassEncoder} pass
	 * @param {ReadonlyArray<Gr2Record>} records  in legacy instance order
	 * @param {{modelView: ArrayLike<number>, projection: ArrayLike<number>, fog?: {use: boolean, near: number, far: number, color: ArrayLike<number>}}} view
	 * @param {{direction: ArrayLike<number>, ambient?: ArrayLike<number>, diffuse?: ArrayLike<number>, env?: ArrayLike<number>, opacity?: number}} light  map light
	 * @returns {number} draw calls
	 */
	encode(pass, records, view, light) {
		this.lastDrawCalls = 0;
		this.lastPalettes = 0;
		this.lastInstances = 0;
		if (!this._gpu) {
			return 0;
		}
		const items = [];
		for (const record of records) {
			const type = this.residency.type(record.params.type);
			if (!type || !record.matrices || record.matrices.length > PALETTE_FLOATS) {
				continue;
			}
			items.push({ record, type });
		}
		if (items.length === 0) {
			return 0;
		}

		// One upload of every distinct palette (identity = the same 40 Hz pose).
		const palettes = new Map();
		for (const { record } of items) {
			if (!palettes.has(record.matrices)) {
				palettes.set(record.matrices, palettes.size * GR2_PALETTE_BYTES);
			}
		}
		this._ensureCapacity(items.length, palettes.size);
		const gpu = this._gpu;
		const paletteFloats = (palettes.size * GR2_PALETTE_BYTES) / 4;
		if (this._paletteStaging.length < paletteFloats) {
			this._paletteStaging = new Float32Array(paletteFloats);
		}
		for (const [matrices, offset] of palettes) {
			this._paletteStaging.set(matrices, offset / 4);
		}
		this.device.queue.writeBuffer(gpu.palettes.buffer, 0, this._paletteStaging.buffer, 0, paletteFloats * 4);
		this.lastPalettes = palettes.size;

		// One Gr2 block per instance.
		const instanceFloats = (items.length * INSTANCE_STRIDE) / 4;
		if (this._instanceStaging.length < instanceFloats) {
			this._instanceStaging = new Float32Array(instanceFloats);
		}
		const fog = view.fog ?? NO_FOG;
		const lightDirection = this._viewLight(view.modelView, light.direction);
		const env = light.env ?? NO_ENV;
		const lightOpacity = light.opacity ?? 1;
		items.forEach(({ record }, i) => {
			const mv = multiply(this._mv, view.modelView, record.params.world);
			const { diffuse, ambient } = gr2LightUniforms(record.params.type, light);
			packGr2Instance(this._instanceStaging, (i * INSTANCE_STRIDE) / 4, {
				modelView: mv,
				projection: view.projection,
				normal: this._normalMatrix(mv),
				lightDirection,
				lightOpacity,
				ambient,
				diffuse,
				env,
				alphaRef: GR2_ALPHA_REF,
				alpha: Math.min(1, Math.max(0, record.alpha ?? 1)),
				fog
			});
		});
		this.device.queue.writeBuffer(gpu.instances.buffer, 0, this._instanceStaging.buffer, 0, instanceFloats * 4);

		let bound = null;
		items.forEach(({ record, type }, i) => {
			const emblem = type.hasEmblem ? this.residency.emblem(record.params.emblem) : null;
			// R-GR2-002: opaque; R-GR2-005: blended only while the entity alpha is < 1.
			const pipeline = this._pipeline((record.alpha ?? 1) < 1 ? (record.blend ?? NORMAL_BLEND) : null);
			if (pipeline !== bound) {
				pass.setPipeline(pipeline);
				bound = pipeline;
			}
			pass.setBindGroup(0, gpu.group, [i * INSTANCE_STRIDE, palettes.get(record.matrices)]);
			for (const sm of type.submeshes) {
				if (sm.emblem && !emblem) {
					// R-GR2-006: skipped until the emblem has loaded.
					continue;
				}
				pass.setBindGroup(1, sm.emblem ? emblem : sm.group);
				pass.setVertexBuffer(0, sm.vertices);
				pass.setIndexBuffer(sm.indices, 'uint16');
				pass.drawIndexed(sm.count, 1, 0, 0, 0);
				this.lastDrawCalls++;
			}
		});
		this.lastInstances = items.length;
		return this.lastDrawCalls;
	}

	/**
	 * Light direction (world) → view space with the view's upper 3×3, normalised, stored
	 * float32 at the same points as legacy (mat3MulVec3 + normalize3). Same as gpu-webgl2.
	 */
	_viewLight(m, v) {
		const out = this._lightView;
		out[0] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
		out[1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
		out[2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
		const len = Math.hypot(out[0], out[1], out[2]) || 1;
		out[0] /= len;
		out[1] /= len;
		out[2] /= len;
		return out;
	}

	/**
	 * Inverse-transpose of the upper 3×3 (gl-matrix mat4.toInverseMat3 then
	 * mat3.transpose, same arithmetic); a singular matrix keeps the previous value.
	 * Same as gpu-webgl2.
	 */
	_normalMatrix(mat) {
		const dest = this._nmat;
		const a00 = mat[0];
		const a01 = mat[1];
		const a02 = mat[2];
		const a10 = mat[4];
		const a11 = mat[5];
		const a12 = mat[6];
		const a20 = mat[8];
		const a21 = mat[9];
		const a22 = mat[10];
		const b01 = a22 * a11 - a12 * a21;
		const b11 = -a22 * a10 + a12 * a20;
		const b21 = a21 * a10 - a11 * a20;
		const d = a00 * b01 + a01 * b11 + a02 * b21;
		if (!d) {
			return dest;
		}
		const id = 1 / d;
		dest[0] = b01 * id;
		dest[1] = (-a22 * a01 + a02 * a21) * id;
		dest[2] = (a12 * a01 - a02 * a11) * id;
		dest[3] = b11 * id;
		dest[4] = (a22 * a00 - a02 * a20) * id;
		dest[5] = (-a12 * a00 + a02 * a10) * id;
		dest[6] = b21 * id;
		dest[7] = (-a21 * a00 + a01 * a20) * id;
		dest[8] = (a11 * a00 - a01 * a10) * id;
		// transpose in place (gl-matrix mat3.transpose, out === a)
		const t01 = dest[1];
		const t02 = dest[2];
		const t12 = dest[5];
		dest[1] = dest[3];
		dest[2] = dest[6];
		dest[3] = t01;
		dest[5] = dest[7];
		dest[6] = t02;
		dest[7] = t12;
		return dest;
	}
}
