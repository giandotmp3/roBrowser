import { GL } from '../pipeline/glEnums.js';
import { splitRuns } from './runs.js';
import { packSpriteInstance, SPRITE_INSTANCE_FLOATS } from './instanceLayout.js';

/**
 * Draws an ordered record stream as contiguous runs. Sprites are instanced
 * quads (4-vertex strip × N instances) sampling a texture array; effects and
 * world records dispatch to their family renderers.
 *
 * Holds no rendering rules: every value comes from the records.
 */
export class RunRenderer {
	/**
	 * @param {{
	 *   gl: WebGL2RenderingContext,
	 *   state: import('../pipeline/GLStateCache.js').GLStateCache,
	 *   residency: import('../residency/Residency.js').Residency,
	 *   families?: Record<string, (records: ReadonlyArray<object>, gl: WebGL2RenderingContext) => void>
	 * }} deps
	 */
	constructor({ gl, state, residency, families = {} }) {
		this.gl = gl;
		this.state = state;
		this.residency = residency;
		this.families = families;
		this._instances = new Float32Array(SPRITE_INSTANCE_FLOATS * 256);
		/** Draw calls issued in the last `draw()` (draw count is measured, §5 phase 3). */
		this.lastDrawCalls = 0;
	}

	/**
	 * @param {ReadonlyArray<import('../ports.js').DrawRecord>} records  Legacy order
	 */
	draw(records) {
		this.lastDrawCalls = 0;
		for (const run of splitRuns(records)) {
			const slice = records.slice(run.start, run.start + run.count);
			const head = /** @type {any} */ (slice[0]);
			this.state.apply(head);
			if (head.kind === 'sprite') {
				this._drawSpriteRun(/** @type {any} */ (slice));
			} else {
				const family = head.kind === 'effect' ? head.family : head.part;
				const fn = this.families[family];
				if (fn) {
					fn(slice, this.gl);
					this.lastDrawCalls++;
				}
			}
		}
		this.state.restoreDefault();
	}

	/** @param {ReadonlyArray<import('../ports.js').SpriteRecord>} run */
	_drawSpriteRun(run) {
		const need = run.length * SPRITE_INSTANCE_FLOATS;
		if (this._instances.length < need) {
			this._instances = new Float32Array(need * 2);
		}
		let offset = 0;
		for (const record of run) {
			offset = packSpriteInstance(record, this.residency.slotOf(record), this._instances, offset);
		}
		this.gl.bufferSubData(0x8892 /* ARRAY_BUFFER */, 0, this._instances.subarray(0, offset));
		this.gl.drawArraysInstanced(GL.TRIANGLE_STRIP, 0, 4, run.length);
		this.lastDrawCalls++;
	}
}
