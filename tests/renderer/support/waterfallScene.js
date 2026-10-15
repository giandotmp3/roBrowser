/**
 * Scripted map waterfalls (EffectTable 'WATERFALL', Renderer/Effects/WaterfallEffect.js)
 * shared by WaterfallEffect.records.test.js (GL snapshot) and RecordDiff.waterfall.test.js.
 *
 * Texture loads are deferred: Client.loadFile queues them and the scene flushes the queue
 * on scripted frames, so effects wait on the shared per-set texture cache (waiters), later
 * effects of a loaded set are ready at once, and a load landing after the type was freed
 * is deleted. The driver mirrors EffectManager.render for one constructor: type init on
 * demand, beforeRender, per-instance init / render when ready, afterRender, instance and
 * type free when the list empties.
 */
import { IDENTITY, PROJECTION, fogAt } from './weatherScene.js';

export const WATERFALL_SEED = 0xfa11;

/** Pending Client.loadFile callbacks (filled by the test's Client mock). */
export function makeLoader() {
	const pending = [];
	return {
		loadFile: (filename, onload) => {
			pending.push(() => onload({ name: filename }));
		},
		flush: () => {
			const run = pending.splice(0);
			run.forEach(fn => fn());
		},
		pending
	};
}

const spawn = (name, variant, vertical, position, startTick) => ({
	name,
	effect: { type: 'WATERFALL', variant, vertical },
	position,
	startTick
});

/** Frames: tick, spawns added before the frame, names removed after it, loader flush. */
export const WATERFALL_FRAMES = [
	{ tick: 1000, add: [spawn('large', 'waterfall', false, [50.5, 60.5, -3], 1000)] },
	{ tick: 1013, add: [spawn('large-vertical', 'waterfall', true, [44, 70, -1.25], 1010)] },
	{ tick: 1040, flush: true },
	{ tick: 1052, add: [spawn('small', 'waterfall_small', false, [30, 31, 0.5], 1050)] },
	{ tick: 1100, add: [spawn('dark', 'waterfall_dark', true, [12.25, 80, -6], 1090)] },
	{ tick: 1200, flush: true },
	{ tick: 1488 },
	{ tick: 1920, add: [spawn('small-dark', 'waterfall_small_dark', false, [70, 20, 2], 1500)] },
	{ tick: 2400 },
	{ tick: 2977, remove: ['large-vertical'] },
	{ tick: 3456 },
	{ tick: 5000 },
	{ tick: 9123, remove: ['large', 'small', 'dark', 'small-dark'] },
	{ tick: 9200, add: [spawn('after-free', 'waterfall_dark', false, [5, 5, 0], 9200)] },
	{ tick: 9250, remove: ['after-free'] },
	{ tick: 9300, flush: true },
	{ tick: 9400, add: [spawn('reloaded', 'waterfall', true, [8, 9, -2], 9350)] },
	{ tick: 9500, flush: true },
	{ tick: 9524 },
	{ tick: 28000 }
];

/**
 * Run the frames on the legacy WaterfallEffect.
 *
 * @param {object} deps
 * @param {function} deps.WaterfallEffect legacy class
 * @param {object} deps.gl fake GL
 * @param {object} deps.loader makeLoader() instance used by the Client mock
 * @param {function} [deps.onSpawn] (name, effect)
 * @param {function} [deps.onRender] (frameIndex, name, tick) after an instance render
 * @param {function} [deps.onFrame] (frameIndex, tick, live) after the frame
 */
export function runLegacyWaterfall({ WaterfallEffect, gl, loader, onSpawn, onRender, onFrame }) {
	let list = [];
	WATERFALL_FRAMES.forEach((frame, i) => {
		for (const s of frame.add ?? []) {
			const effect = new WaterfallEffect(s.effect, { position: s.position, startTick: s.startTick }, {});
			list.push({ name: s.name, effect });
			if (onSpawn) {
				onSpawn(s.name, effect, s);
			}
		}
		if (frame.flush) {
			loader.flush();
		}
		if (list.length) {
			if (!WaterfallEffect.ready && WaterfallEffect.needInit) {
				WaterfallEffect.init(gl);
				WaterfallEffect.needInit = false;
			}
			WaterfallEffect.beforeRender(gl, IDENTITY, PROJECTION, fogAt(i), frame.tick);
			for (const { name, effect } of list) {
				if (!effect.ready && effect.needInit) {
					effect.init(gl);
					effect.needInit = false;
				}
				if (effect.ready) {
					effect.render(gl, frame.tick);
					if (onRender) {
						onRender(i, name, frame.tick);
					}
				}
			}
			WaterfallEffect.afterRender(gl);
		}
		const removed = new Set(frame.remove ?? []);
		list = list.filter(({ name, effect }) => {
			if (removed.has(name)) {
				effect.free(gl);
				return false;
			}
			return true;
		});
		if (removed.size && !list.length) {
			WaterfallEffect.free(gl);
		}
		if (onFrame) {
			onFrame(i, frame.tick, list);
		}
	});
}
