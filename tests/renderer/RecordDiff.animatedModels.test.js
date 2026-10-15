/**
 * Record-diff of render-records' animated RSM composer (AnimatedRsmComposer /
 * computeNodeMatrices, R-MAP-016 timing, R-MAP-017 node hierarchy) against legacy
 * Renderer/Map/AnimatedModels.js.
 *
 * The real legacy AnimatedModels loads the MAP_ANIMATED_MODEL payloads of
 * support/animatedModelScene.js (built from the root RSM fixtures of rsmEffectScene.js) and
 * runs the tick list with performance mode and the occluder-fade passes toggling; its
 * native per-frame records are collected through AnimatedModels.addRecordSink.
 * render-records loads fresh copies of the same payloads and composes the same ticks. Both
 * streams are diffed per frame and per model, field by field: model index, filename,
 * alpha, keyframe position, recompute bucket, whether the matrices were recomputed, and
 * every node × instance matrix (tolerance 1e-5, relative above 1; NaN equals NaN), then
 * bit-exact.
 *
 * Declared divergences: none. Observed legacy behaviour kept for parity: before a node's
 * first position / rotation / scale key (a first key after frame 0), legacy interpolates
 * between the first key and itself with t = −∞, so that node and its descendants get NaN
 * matrices (drawn as nothing) until the first key is reached in each loop.
 */
import { describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
	graphics: { performanceMode: false, occluderFade: 'off', occluderFadeOpacity: 0.25, occluderFadeRadius: 5 },
	queryHit: true
}));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ id: 'program', attribute: {}, uniform: {} }),
		texture: (_gl, data, onload) => onload({ id: data.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, onload, onerror) => (filename.includes('missing') ? onerror?.() : onload({ name: filename }))
	}
}));
vi.mock('Preferences/Graphics.js', () => ({ default: bridge.graphics }));
vi.mock('Renderer/Camera.js', () => ({
	default: { state: 1, states: { isometric: 0, third_person: 1, first_person: 2 }, focus: new Float32Array([1, 2, 3]) }
}));
vi.mock('Renderer/SpriteRenderer.js', () => ({ default: { runWithDepth: (_t, _m, _c, fn) => fn() } }));

import {
	AnimatedRsmComposer,
	computeNodeMatrices
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import {
	MODEL_VIEW,
	NORMAL3,
	PROJECTION,
	TICKS,
	animatedPayloads,
	fogAt,
	lightAt,
	settingsAt
} from './support/animatedModelScene.js';
import { close } from './support/effectRecordDiff.js';

const gl = new Proxy(
	{},
	{
		get: (_t, k) =>
			/^[A-Z_0-9]+$/.test(String(k))
				? k
				: (...args) =>
						k === 'getQueryParameter' ? (args[1] === 'QUERY_RESULT_AVAILABLE' ? true : bridge.queryHit) : {}
	}
);

/** Legacy: the records of each frame. */
async function runLegacy() {
	vi.resetModules();
	const { default: AnimatedModels } = await import('Renderer/Map/AnimatedModels.js');
	const { default: OccluderFade } = await import('Renderer/Map/OccluderFade.js');
	let pending = [];
	const stop = AnimatedModels.addRecordSink(r => pending.push(r));
	const frames = [];
	try {
		for (const data of animatedPayloads()) {
			AnimatedModels.add(gl, data);
		}
		TICKS.forEach((tick, i) => {
			const { queryHit, ...graphics } = settingsAt(i);
			Object.assign(bridge.graphics, graphics);
			bridge.queryHit = queryHit;
			OccluderFade.beginFrame(gl, MODEL_VIEW, tick);
			AnimatedModels.render(gl, MODEL_VIEW, PROJECTION, NORMAL3, fogAt(i), lightAt(i), tick);
			AnimatedModels.renderFaded(gl, MODEL_VIEW, PROJECTION, NORMAL3, fogAt(i), lightAt(i));
			frames.push(pending);
			pending = [];
		});
		AnimatedModels.free(gl);
		OccluderFade.free(gl);
	} finally {
		stop();
	}
	return frames;
}

/** render-records over the same payloads and ticks. */
function runModern() {
	const composer = new AnimatedRsmComposer();
	for (const data of animatedPayloads()) {
		composer.add(data);
	}
	return TICKS.map((tick, i) => composer.compose(tick, { performanceMode: settingsAt(i).performanceMode }));
}

function diffRecord(l, m, exact) {
	const out = [];
	for (const f of ['kind', 'part', 'depthTest', 'depthWrite']) {
		if (l[f] !== m[f]) {
			out.push(`${f}: ${l[f]} vs ${m[f]}`);
		}
	}
	if (JSON.stringify(l.blend) !== JSON.stringify(m.blend)) {
		out.push(`blend: ${JSON.stringify(l.blend)} vs ${JSON.stringify(m.blend)}`);
	}
	if (!close(l.alpha, m.alpha)) {
		out.push(`alpha: ${l.alpha} vs ${m.alpha}`);
	}
	for (const k of ['model', 'filename', 'frame', 'animFrame', 'updated']) {
		if (l.params[k] !== m.params[k]) {
			out.push(`params.${k}: ${l.params[k]} vs ${m.params[k]}`);
		}
	}
	if (l.matrices.length !== m.matrices.length) {
		out.push(`matrices: ${l.matrices.length} vs ${m.matrices.length} floats`);
	} else {
		const bad = Array.from(l.matrices).findIndex((v, i) => !(exact ? Object.is(v, m.matrices[i]) : close(v, m.matrices[i])));
		if (bad !== -1) {
			out.push(`matrices[${bad}]: ${l.matrices[bad]} vs ${m.matrices[bad]}`);
		}
	}
	return out;
}

function diffRuns(legacy, modern, exact = false) {
	const mismatches = [];
	TICKS.forEach((tick, i) => {
		const l = legacy[i];
		const m = modern[i];
		if (l.length !== m.length) {
			mismatches.push(`@${tick}: ${l.length} legacy records vs ${m.length}`);
			return;
		}
		l.forEach((rec, k) => {
			for (const d of diffRecord(rec, m[k], exact)) {
				mismatches.push(`@${tick} ${rec.params.filename}: ${d}`);
			}
		});
	});
	return mismatches;
}

describe('RecordDiff: render-records animated RSM vs legacy AnimatedModels', () => {
	it('reproduces every legacy per-frame model record field by field', async () => {
		const legacy = await runLegacy();
		const modern = runModern();
		expect(legacy.flat()).toHaveLength(5 * TICKS.length);
		expect(diffRuns(legacy, modern)).toEqual([]);
		// the float32 port is bit-exact, not just within tolerance
		expect(diffRuns(legacy, modern, true)).toEqual([]);

		const all = legacy.flat();
		// recomputes happen, in both modes, and some frames reuse the last matrices
		expect(all.filter(r => r.params.updated).length).toBeGreaterThan(60);
		expect(all.filter(r => !r.params.updated).length).toBeGreaterThan(60);
		// the first position key after frame 0 yields NaN matrices before it (kept for parity)
		expect(all.some(r => r.params.model === 0 && Number.isNaN(r.matrices[0]))).toBe(true);
		expect(all.some(r => r.params.model === 0 && Number.isFinite(r.matrices[0]))).toBe(true);
	});

	it('computeNodeMatrices of a raw payload equals the legacy matrices at load (keyframe 0)', async () => {
		const legacy = [];
		vi.resetModules();
		const { default: AnimatedModels } = await import('Renderer/Map/AnimatedModels.js');
		const stop = AnimatedModels.addRecordSink(r => legacy.push(r));
		animatedPayloads().forEach(data => AnimatedModels.add(gl, data));
		AnimatedModels.render(gl, MODEL_VIEW, PROJECTION, NORMAL3, fogAt(1), lightAt(1), 0);
		stop();
		AnimatedModels.free(gl);
		const payloads = animatedPayloads().filter(p => p.nodes.length);
		legacy.forEach((rec, i) => {
			const m = computeNodeMatrices(payloads[i], 0);
			expect(Array.from(rec.matrices).every((v, k) => close(v, m[k]))).toBe(true);
		});
	});
});
