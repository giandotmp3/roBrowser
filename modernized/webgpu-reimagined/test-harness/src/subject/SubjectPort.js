/**
 * Subject port: what the acceptance suite drives.
 *
 * A subject is either the new pipeline (scene + render-records, plus a GPU fragment probe
 * from the active backend) or the legacy renderer instrumented with the record shim. Both
 * expose the same two capabilities, so every rule test can run against either.
 *
 * @typedef {object} FrameObservation
 * @property {number} index
 * @property {number} tick                 Renderer.tick for the frame (ms)
 * @property {number} loopTime             snapped last-frame time used by the fps cap (R-CTX-003)
 * @property {object[]} records            ordered stream incl. pass markers (RecordTypes)
 * @property {string[]} loop               loop work order (R-CTX-004): 'serverTick'|'events'|'callback:<id>'|'cursor'|'raf'
 * @property {object} camera               { zoom, zoomFinal, pitch, yaw, direction, vFov, zOffset, mode: 'iso'|'third'|'first',
 *                                           position, targetHeight, focus, modelView, normalMatrix, projectionParams: { vFov, aspect, near, far } }
 * @property {object} viewport             { cssWidth, cssHeight, width, height, sceneWidth, sceneHeight, resizes }
 * @property {object} map                  { currentMap, loading, reloads, clearColor, fog: { use, near, far, color },
 *                                           light: { env, direction, diffuse, ambient }, occluderStrength }
 * @property {object} mouse                { world: {x,y,z}, cursor, cursorFrameDelayMultiplier, snappedTo }
 * @property {object} hover                { gid|null, events: [{ type: 'over'|'out', gid }] }
 * @property {object[]} overlays           [{ gid, widget, display, x, y, zIndex, anchorCells, pixelOffsetX, pixelOffsetY,
 *                                           width, height, border, bars: { hp, sp, ap, hunger: { y, h, color } } }]
 * @property {object[]} pickRects          [{ gid, x0, y0, x1, y1, lift, priority, depth, pickable, meta }]
 * @property {Record<number, number>} entityDepth  sort depth per gid (clip w + tie-break, R-SPR-030)
 * @property {object[]} postChain          [{ module, input, output, scale, filter }] in run order
 * @property {object} device               { requested, defaults, state: 'ready'|'lost'|'failed', overlay, purged,
 *                                           settings (effective GraphicsSettings), sceneTarget }
 * @property {number} effectsAlive         live effect instances incl. distance-culled ones (R-EFX-005)
 * @property {number} cullDecisions        number of view-area cull evaluations this frame (R-PERF-001)
 * @property {object} perf                 effective perf-mode parameters (R-PERF-002)
 * @property {object[]} sounds
 * @property {object} preferencesWritten   keys persisted during the frame
 *
 * @typedef {object} RunResult
 * @property {FrameObservation[]} frames
 * @property {object[]} captures                screenshot / pixel captures
 * @property {object[]} errors
 *
 * @typedef {object} Subject
 * @property {string} name
 * @property {(script: object) => Promise<RunResult>} run
 * @property {(program: string, inputs: object) => Promise<number[]>} fragment
 *           Evaluate one fragment of a shared shader include (WGSL/GLSL) on the active
 *           backend and return linear RGBA in [0,1]. Used by shader-side rules.
 * @property {(name: string, inputs: object) => Promise<object>} [cpu]
 *           Evaluate a CPU-side contract function directly (e.g. 'altitude.height',
 *           'loader.groundAtlas') when a rule is not visible through a scene.
 */
import { NotImplementedError } from '../errors.js';

/** Default subject: nothing is implemented yet, so every rule test is pending. */
export class NotImplementedSubject {
	constructor() {
		this.name = 'not-implemented';
	}
	async run(script) {
		throw new NotImplementedError(`subject.run(${script?.name ?? 'scene'})`);
	}
	async fragment(program) {
		throw new NotImplementedError(`subject.fragment(${program})`);
	}
	async cpu(name) {
		throw new NotImplementedError(`subject.cpu(${name})`);
	}
}

/**
 * Resolve the subject from the environment (never from hard-coded paths into sibling
 * services, which are developed in parallel):
 *   HARNESS_SUBJECT_MODULE=<path or URL exporting createSubject({ rng, clock })>
 */
export async function resolveSubject({ env = process.env, ports } = {}) {
	const mod = env.HARNESS_SUBJECT_MODULE;
	if (!mod) {
		return new NotImplementedSubject();
	}
	const { createSubject } = await import(mod);
	if (typeof createSubject !== 'function') {
		throw new TypeError(`${mod} must export createSubject({ rng, clock })`);
	}
	return createSubject(ports ?? {});
}

/** Reference subject for parity diffs (legacy renderer + record shim). */
export async function resolveReference({ env = process.env, ports } = {}) {
	return resolveSubject({ env: { HARNESS_SUBJECT_MODULE: env.HARNESS_REFERENCE_MODULE }, ports });
}
