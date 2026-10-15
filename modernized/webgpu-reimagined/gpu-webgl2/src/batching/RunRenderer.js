import { splitRuns } from './runs.js';
import { packSpriteInstance, SPRITE_INSTANCE_FLOATS } from './instanceLayout.js';
import { SpritePipeline } from '../sprites/SpritePipeline.js';

/**
 * Draws an ordered record stream as contiguous runs. Sprites are instanced
 * quads (4-vertex strip × N instances) sampling texture-array pools; effects
 * and world records dispatch to their family renderers.
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
	 *   sprites?: SpritePipeline
	 * }} deps
	 */
	constructor({ gl, state, residency, families = {}, sprites }) {
		this.gl = gl;
		this.state = state;
		this.residency = residency;
		this.families = families;
		this.sprites = sprites ?? new SpritePipeline({ gl, pools: residency.uploader });
		this._instances = new Float32Array(SPRITE_INSTANCE_FLOATS * 256);
		this._slot = {};
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
		this.lastRuns = splitRuns(records);
		let spritesBound = false;
		for (const run of this.lastRuns) {
			const head = /** @type {any} */ (records[run.start]);
			this.state.apply(head);
			if (head.kind === 'sprite') {
				if (!spritesBound) {
					this.sprites.bindFrame(view);
					spritesBound = true;
				}
				this._drawSpriteRun(/** @type {any} */ (records), run.start, run.count, head.textureClass);
				continue;
			}
			// A family renderer may change program, VAO or textures: rebind before the next sprite run.
			if (spritesBound) {
				this.sprites.endFrame();
				spritesBound = false;
			}
			const family = head.kind === 'effect' ? head.family : head.part;
			const fn = this.families[family];
			if (fn) {
				fn(records.slice(run.start, run.start + run.count), this.gl);
				this.lastDrawCalls++;
			}
		}
		if (spritesBound) {
			this.sprites.endFrame();
		}
		this.state.restoreDefault();
	}

	/**
	 * @param {ReadonlyArray<import('../ports.js').SpriteRecord>} records
	 * @param {number} start
	 * @param {number} count
	 * @param {string} textureClass
	 */
	_drawSpriteRun(records, start, count, textureClass) {
		const need = count * SPRITE_INSTANCE_FLOATS;
		if (this._instances.length < need) {
			this._instances = new Float32Array(need * 2);
		}
		let offset = 0;
		for (let i = start; i < start + count; i++) {
			const record = records[i];
			offset = packSpriteInstance(record, this.residency.slotOf(record, this._slot), this._instances, offset);
		}
		this.sprites.drawRun(this._instances.subarray(0, offset), count, textureClass === 'indexed');
		this.lastDrawCalls++;
	}
}
