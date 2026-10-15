import { effectProgram, splitBatches } from './runs.js';
import { packSpriteInstance, SPRITE_INSTANCE_FLOATS } from './instanceLayout.js';
import { SpritePipeline } from '../sprites/SpritePipeline.js';
import { StrPipeline } from '../effects/StrPipeline.js';
import { packStrInstance, STR_INSTANCE_FLOATS } from '../effects/strInstance.js';
import { spriteEffectClass, spriteEffectView } from '../effects/spriteEffect.js';
import { MeshEffectPipeline } from '../effects/mesh/MeshEffectPipeline.js';

/**
 * Draws an ordered record stream as contiguous runs (`splitBatches`: pipeline
 * state runs, with indexed and RGBA sprite layers merged into one run when the
 * sprite program can bind both array sets, and effect runs split where the
 * drawing program changes). Sprites, and the 2D/3D effects (SpriteRenderer draws
 * in legacy), are instanced quads (4-vertex strip × N instances) of the sprite
 * program; STR layers are instanced quads of the STR program; the other effect
 * families (cylinder, quadhorn, RSM, auras, spheres, tiles, rings, target markers,
 * waterfall, rain puddles) are one draw per run of the mesh effect pipeline; all sample
 * the texture-array pools. World records, and any family given in `families`, dispatch
 * to their family renderers.
 *
 * Holds no rendering rules: every value comes from the records.
 */
export class RunRenderer {
	/**
	 * @param {{
	 *   gl: WebGL2RenderingContext,
	 *   state: import('../pipeline/GLStateCache.js').GLStateCache,
	 *   residency: import('../residency/Residency.js').Residency,
	 *   families?: Record<string, (records: ReadonlyArray<object>, gl: WebGL2RenderingContext) => void>,
	 *   sprites?: SpritePipeline,
	 *   str?: StrPipeline,
	 *   meshes?: MeshEffectPipeline
	 * }} deps
	 */
	constructor({ gl, state, residency, families = {}, sprites, str, meshes }) {
		this.gl = gl;
		this.state = state;
		this.residency = residency;
		this.families = families;
		this.sprites = sprites ?? new SpritePipeline({ gl, pools: residency.uploader });
		this.str = str ?? new StrPipeline({ gl, pools: residency.uploader });
		this.meshes = meshes ?? new MeshEffectPipeline({ gl, pools: residency.uploader });
		this._instances = new Float32Array(Math.max(SPRITE_INSTANCE_FLOATS, STR_INSTANCE_FLOATS) * 256);
		this._slot = {};
		this._view = {};
		/** Draw calls issued in the last `draw()` (draw count is measured, §5 phase 3). */
		this.lastDrawCalls = 0;
		/** Runs of the last `draw()`, for diagnostics. */
		this.lastRuns = [];
		/** Frames and palettes uploaded on miss by the last `draw()`. */
		this.lastUploads = 0;
	}

	/**
	 * @param {ReadonlyArray<import('../ports.js').DrawRecord>} records  Legacy order
	 * @param {import('../sprites/SpritePipeline.js').SpriteView} [view]  Camera, zoom and fog of this pass
	 */
	draw(records, view) {
		this.lastDrawCalls = 0;
		// Upload-on-miss before anything is bound: a first upload may create a pool
		// texture, and creating or filling one rebinds texture units.
		this.lastUploads = this.residency.prepare?.(records) ?? 0;
		this.lastRuns = splitBatches(records, { mixTextureClasses: this.sprites.mixedClasses });
		/** @type {'sprite'|'str'|'mesh'|null} program currently bound */
		let bound = null;
		for (const run of this.lastRuns) {
			const head = /** @type {any} */ (records[run.start]);
			this.state.apply(head);
			const program = this._programOf(head);
			if (program !== bound) {
				// A family renderer may change program, VAO or textures: rebind before the next run.
				this._unbind(bound);
				bound = program;
				if (program === 'sprite') {
					this.sprites.bindFrame(view);
				} else if (program === 'str') {
					this.str.bindFrame(view);
				} else if (program === 'mesh') {
					this.meshes.bindFrame(view);
				}
			}
			if (program === 'sprite') {
				const textureClass = head.kind === 'sprite' ? head.textureClass : spriteEffectClass(head);
				this._drawSpriteRun(/** @type {any} */ (records), run.start, run.count, textureClass);
				continue;
			}
			if (program === 'str') {
				this._drawStrRun(/** @type {any} */ (records), run.start, run.count);
				continue;
			}
			if (program === 'mesh') {
				this.meshes.drawRun(records, run.start, run.count, this.residency);
				this.lastDrawCalls++;
				continue;
			}
			const family = head.kind === 'effect' ? head.family : head.part;
			const fn = this.families[family];
			if (fn) {
				fn(records.slice(run.start, run.start + run.count), this.gl);
				this.lastDrawCalls++;
			}
		}
		this._unbind(bound);
		this.state.restoreDefault();
	}

	/** @param {'sprite'|'str'|'mesh'|null} program */
	_unbind(program) {
		if (program === 'sprite') {
			this.sprites.endFrame();
		} else if (program === 'str') {
			this.str.endFrame();
		} else if (program === 'mesh') {
			this.meshes.endFrame();
		}
	}

	/**
	 * GL program of a run head: the instanced sprite program (sprites, 2D/3D effects),
	 * the instanced STR program, the mesh effect pipeline, or null (a family renderer;
	 * one given in `families` wins over the built-in programs).
	 * @param {{kind: string, family?: string, part?: string}} head
	 * @returns {'sprite'|'str'|'mesh'|null}
	 */
	_programOf(head) {
		const family = head.kind === 'effect' ? head.family : head.part;
		if (family && this.families[family]) {
			return null;
		}
		return programOf(head);
	}

	/** @param {number} floats */
	_scratch(floats) {
		if (this._instances.length < floats) {
			this._instances = new Float32Array(floats * 2);
		}
		return this._instances;
	}

	/**
	 * @param {ReadonlyArray<import('../ports.js').SpriteRecord|import('../ports.js').EffectRecord>} records
	 * @param {number} start
	 * @param {number} count
	 * @param {'indexed'|'rgba'} textureClass  Head record's class (split fallback only)
	 */
	_drawSpriteRun(records, start, count, textureClass) {
		const instances = this._scratch(count * SPRITE_INSTANCE_FLOATS);
		let offset = 0;
		for (let i = start; i < start + count; i++) {
			const record = /** @type {any} */ (records[i]);
			const sprite = record.kind === 'sprite' ? record : spriteEffectView(record, this._view);
			offset = packSpriteInstance(sprite, this.residency.slotOf(sprite, this._slot), instances, offset);
		}
		this.sprites.drawRun(instances.subarray(0, offset), count, textureClass);
		this.lastDrawCalls++;
	}

	/**
	 * @param {ReadonlyArray<import('../ports.js').EffectRecord>} records  STR layers
	 * @param {number} start
	 * @param {number} count
	 */
	_drawStrRun(records, start, count) {
		const instances = this._scratch(count * STR_INSTANCE_FLOATS);
		let offset = 0;
		for (let i = start; i < start + count; i++) {
			const record = /** @type {any} */ (records[i]);
			offset = packStrInstance(record, this.residency.slotOf(record, this._slot), instances, offset);
		}
		this.str.drawRun(instances.subarray(0, offset), count);
		this.lastDrawCalls++;
	}

	/** R-CTX-006: every GL object of the run programs died with the context. */
	reset() {
		this.sprites.reset();
		this.str.reset();
		this.meshes.reset();
	}
}

/**
 * Built-in GL program of a run head (see RunRenderer._programOf).
 * @param {{kind: string, family?: string}} head
 * @returns {'sprite'|'str'|'mesh'|null}
 */
function programOf(head) {
	if (head.kind === 'sprite') {
		return 'sprite';
	}
	if (head.kind === 'effect') {
		const program = effectProgram(head);
		if (program.startsWith('mesh:')) {
			return 'mesh';
		}
		return program === 'sprite' || program === 'str' ? program : null;
	}
	return null;
}
