import { SpriteRunRenderer, spriteSpec } from '../sprites/SpriteRunRenderer.js';
import { StrPipeline, strSpec } from '../effects/StrPipeline.js';
import { MeshEffectPipeline, meshSpec } from '../effects/mesh/MeshEffectPipeline.js';
import { programOf, splitBatches, splitRuns } from '../sprites/runs.js';
import { encodeBatches } from './encodeBatches.js';

/**
 * Draws an ordered record stream as contiguous batches in one render pass
 * (`splitBatches`: pipeline-state runs, indexed and RGBA sprite layers merged when
 * the sprite pipeline binds both array sets, effect runs split where the drawing
 * program changes; never regrouped or reordered). Sprites and the 2D/3D effects
 * (SpriteRenderer draws in legacy) are instanced quads of the sprite pipeline
 * (sprite.wgsl); STR layers are instanced quads of the STR pipeline (str.wgsl);
 * the mesh effect families (cylinder, quadhorn, RSM, auras, spheres, tiles, rings,
 * target markers, waterfall, rain puddles) are one draw per batch of MeshEffectPipeline
 * (15 WGSL programs, cached meshes or streamed vertices); all sample the same
 * texture-array pools of one SpriteResidency. Batches of other families (weather,
 * world) have no renderer here yet and are skipped (`lastSkipped`).
 *
 * Same structure as gpu-webgl2's RunRenderer. Holds no rendering rules: every value
 * comes from the records.
 */
export class RunRenderer {
	/**
	 * @param {{
	 *   device: GPUDevice,
	 *   residency: import('../residency/SpriteResidency.js').SpriteResidency,
	 *   sampleCount?: number,
	 *   depthFormat?: GPUTextureFormat,
	 *   sprites?: SpriteRunRenderer,
	 *   str?: StrPipeline,
	 *   meshes?: MeshEffectPipeline,
	 *   mixTextureClasses?: boolean
	 * }} deps
	 */
	constructor({ device, residency, sampleCount, depthFormat, sprites, str, meshes, mixTextureClasses }) {
		this.device = device;
		this.residency = residency;
		this.sprites =
			sprites ?? new SpriteRunRenderer({ device, residency, sampleCount, depthFormat, mixTextureClasses });
		this.str = str ?? new StrPipeline({ device, residency, sampleCount, depthFormat });
		this.meshes = meshes ?? new MeshEffectPipeline({ device, residency, sampleCount, depthFormat });
		/** Draw calls issued by the last `encode()`. */
		this.lastDrawCalls = 0;
		/** render-records runs of the last `encode()` (pipeline-state boundaries), for diagnostics. */
		this.lastRuns = [];
		/** Draw batches of the last `encode()` (batchKey boundaries). */
		this.lastBatches = [];
		/** Batches drawn with the normal-alpha fallback pipeline (pair still compiling). */
		this.lastFallbacks = 0;
		/** Batches without a renderer here (other effect families, world). */
		this.lastSkipped = 0;
		/** Frames and palettes uploaded on miss by the last `encode()`. */
		this.lastUploads = 0;
	}

	/** Create every program's GPU objects and precompile their default census. */
	async init() {
		await Promise.all([this.sprites.init(), this.str.init(), this.meshes.init()]);
		return this;
	}

	/**
	 * Compile every pipeline `records` needs (blend-pair census of a stream, e.g. at map
	 * load), so no batch draws through the normal-alpha fallback.
	 * @param {ReadonlyArray<any>} records
	 */
	async warm(records) {
		for (const record of records) {
			const program = programOf(record);
			if (program === 'sprite') {
				this.sprites.pipelines.compile(spriteSpec(record));
			} else if (program === 'str') {
				this.str.pipelines.compile(strSpec(record));
			} else if (program === 'mesh') {
				this.meshes.pipelines.compile(meshSpec(record));
			}
		}
		await Promise.all([
			this.sprites.pipelines.settled(),
			this.str.pipelines.settled(),
			this.meshes.pipelines.settled()
		]);
	}

	/**
	 * Encode `records` into `pass`. Uploads missing textures and palettes first (C-16),
	 * then writes instance data and frame uniforms with queue writes, so call once per
	 * submitted frame (after `residency.beginFrame()`).
	 * @param {GPURenderPassEncoder} pass
	 * @param {ReadonlyArray<any>} records  Legacy order
	 * @param {import('../sprites/SpriteRunRenderer.js').SpriteView} [view]  Camera, zoom and fog of this pass
	 * @returns {{drawCalls: number, runs: number, batches: number, fallbacks: number, skipped: number}}
	 */
	encode(pass, records, view) {
		// Upload on miss before packing, so slots exist.
		this.lastUploads = this.residency.prepare?.(records) ?? 0;
		this.lastRuns = splitRuns(records);
		this.lastBatches = splitBatches(records, { mixTextureClasses: this.sprites.mixTextureClasses });
		const spriteBatches = [];
		const strBatches = [];
		const meshBatches = [];
		for (const batch of this.lastBatches) {
			const program = programOf(records[batch.start]);
			if (program === 'sprite') {
				spriteBatches.push(batch);
			} else if (program === 'str') {
				strBatches.push(batch);
			} else if (program === 'mesh') {
				meshBatches.push(batch);
			}
		}
		const firsts = {
			sprite: this.sprites.stage(records, spriteBatches, view),
			str: this.str.stage(records, strBatches, view),
			mesh: this.meshes.stage(records, meshBatches, view)
		};
		const stats = encodeBatches(
			pass,
			records,
			this.lastBatches,
			{ sprite: this.sprites, str: this.str, mesh: this.meshes },
			firsts
		);
		this.lastDrawCalls = stats.drawCalls;
		this.lastFallbacks = stats.fallbacks;
		this.lastSkipped = stats.skipped;
		return {
			drawCalls: stats.drawCalls,
			runs: this.lastRuns.length,
			batches: this.lastBatches.length,
			fallbacks: stats.fallbacks,
			skipped: stats.skipped
		};
	}

	/** Device loss: every GPU object of every program died; `init()` again on the new device. */
	reset(device = this.device) {
		this.device = device;
		this.sprites.reset(device);
		this.str.reset(device);
		this.meshes.reset(device);
	}
}
