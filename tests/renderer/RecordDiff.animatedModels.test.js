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
 * Declared divergence #69 (fixed legacy bug, HITL round 2): before a node's first
 * position / rotation / scale key (a first key after frame 0), legacy interpolates between
 * the first key and itself with t = −∞, so that node and its descendants get NaN matrices
 * (drawn as nothing) until the first key is reached in each loop. render-records holds the
 * first key there, the clamp legacy applies after the last key and to a single key. The
 * divergence is checked narrowly:
 * - against legacy as is, only the matrices of (node, instance) slots whose node or an
 *   ancestor is in its pre-first-key window (at the record's keyframe position) differ:
 *   NaN in legacy, finite here; every other field and slot stays bit-exact;
 * - against legacy fed a copy of each such first key at frame 0 (legacy then holds the
 *   first key before it, see holdFirstKeys), every record is bit-exact, so the divergent
 *   slots equal the clamped values.
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

const frameOfKey = kf => kf.frame;
const frameOfScale = kf => (typeof kf.Frame !== 'undefined' ? kf.Frame : kf.frame);
const KEY_LISTS = [
	['rotKeyframes', frameOfKey],
	['posKeyframes', frameOfKey],
	['scaleKeyFrames', frameOfScale]
];

/** A key list is in its pre-first-key window at `frame` (legacy's t = −∞ case). */
const preKey = (keys, frameOf, frame) => keys.length > 1 && frameOf(keys[0]) > frame;

/**
 * #69: indices of the nodes of `data` whose matrices are in a pre-first-key window at
 * keyframe position `frame`: own key list before its first key, or such an ancestor.
 */
function preKeyNodes(data, frame) {
	const index = new Map(data.nodes.map((n, i) => [n.name, i]));
	const own = data.nodes.map(n => KEY_LISTS.some(([field, frameOf]) => preKey(n[field], frameOf, frame)));
	const hit = (i, seen = new Set()) => {
		if (own[i]) {
			return true;
		}
		const n = data.nodes[i];
		const parent = index.get(n.parentname);
		if (parent === undefined || n.parentname === n.name || seen.has(i)) {
			return false;
		}
		seen.add(i);
		return hit(parent, seen);
	};
	return new Set(data.nodes.map((_, i) => i).filter(i => hit(i)));
}

/**
 * #69 reference payloads: every key list whose first key is after frame 0 gets a copy of
 * that key at frame 0. Legacy then interpolates between two equal keys before the first
 * key (lerp a + t·0 = a; the slerp of equal quaternions rounds back to a in its float32
 * output), i.e. it holds the first key; at and after the first key the bracket, animLen and
 * every value are unchanged.
 */
function holdFirstKeys(payloads) {
	for (const data of payloads) {
		for (const node of data.nodes) {
			for (const [field, frameOf] of KEY_LISTS) {
				const keys = node[field];
				if (preKey(keys, frameOf, 0)) {
					const [first] = keys;
					keys.unshift(typeof first.Frame !== 'undefined' ? { ...first, Frame: 0 } : { ...first, frame: 0 });
				}
			}
		}
	}
	return payloads;
}

/** Legacy: the records of each frame. `clamp`: run the #69 reference payloads. */
async function runLegacy({ ticks = TICKS, clamp = false } = {}) {
	vi.resetModules();
	const { default: AnimatedModels } = await import('Renderer/Map/AnimatedModels.js');
	const { default: OccluderFade } = await import('Renderer/Map/OccluderFade.js');
	let pending = [];
	const stop = AnimatedModels.addRecordSink(r => pending.push(r));
	const frames = [];
	try {
		const payloads = clamp ? holdFirstKeys(animatedPayloads()) : animatedPayloads();
		for (const data of payloads) {
			AnimatedModels.add(gl, data);
		}
		ticks.forEach((tick, i) => {
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

/**
 * Field-by-field diff of two records. `divergent` (#69): the node indices whose slots may
 * differ; there legacy must hold NaN and render-records finite values.
 */
function diffRecord(l, m, exact, divergent = new Set()) {
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
		return out;
	}
	const slots = l.matrices.length / 16;
	const instances = slots / (l.params.nodes ?? slots);
	for (let slot = 0; slot < slots; slot++) {
		const node = Math.floor(slot / instances);
		const lm = Array.from(l.matrices.subarray(slot * 16, slot * 16 + 16));
		const mm = Array.from(m.matrices.subarray(slot * 16, slot * 16 + 16));
		if (divergent.has(node)) {
			if (!lm.some(Number.isNaN) || !mm.every(Number.isFinite)) {
				out.push(`#69 slot ${slot} (node ${node}): legacy ${lm} vs ${mm}`);
			}
			continue;
		}
		const bad = lm.findIndex((v, i) => !(exact ? Object.is(v, mm[i]) : close(v, mm[i])));
		if (bad !== -1) {
			out.push(`matrices[${slot * 16 + bad}]: ${lm[bad]} vs ${mm[bad]}`);
		}
	}
	return out;
}

/**
 * Per-frame diff. `declared` (#69): the payloads, to allow the pre-first-key slots of
 * each record (at its keyframe position) to diverge; returns them in `divergentSlots`.
 */
function diffRuns(legacy, modern, { exact = false, declared = null, ticks = TICKS } = {}) {
	const mismatches = [];
	const divergentSlots = [];
	ticks.forEach((tick, i) => {
		const l = legacy[i];
		const m = modern[i];
		if (l.length !== m.length) {
			mismatches.push(`@${tick}: ${l.length} legacy records vs ${m.length}`);
			return;
		}
		l.forEach((rec, k) => {
			const data = declared?.[rec.params.model];
			const divergent = data ? preKeyNodes(data, rec.params.frame) : new Set();
			const nodes = data?.nodes.length;
			for (const node of divergent) {
				divergentSlots.push({ tick, model: rec.params.model, node, frame: rec.params.frame });
			}
			for (const d of diffRecord({ ...rec, params: { ...rec.params, nodes } }, m[k], exact, divergent)) {
				mismatches.push(`@${tick} ${rec.params.filename}: ${d}`);
			}
		});
	});
	return { mismatches, divergentSlots };
}

describe('RecordDiff: render-records animated RSM vs legacy AnimatedModels', () => {
	it('reproduces every legacy per-frame model record field by field, #69 pre-first-key slots declared', async () => {
		const legacy = await runLegacy();
		const modern = runModern();
		expect(legacy.flat()).toHaveLength(5 * TICKS.length);
		const declared = animatedPayloads();
		const { mismatches, divergentSlots } = diffRuns(legacy, modern, { declared });
		expect(mismatches).toEqual([]);
		// the float32 port is bit-exact outside the declared slots, not just within tolerance
		expect(diffRuns(legacy, modern, { exact: true, declared }).mismatches).toEqual([]);

		// #69 is exercised: spin (root's first position key at 300 ms, its children with it)
		// and regrow (lid's first rotation key at 90 ms)
		const hit = new Set(divergentSlots.map(d => `${d.model}:${d.node}`));
		expect([...hit].sort()).toEqual(['0:0', '0:1', '0:2', '2:1']);

		const all = legacy.flat();
		// recomputes happen, in both modes, and some frames reuse the last matrices
		expect(all.filter(r => r.params.updated).length).toBeGreaterThan(60);
		expect(all.filter(r => !r.params.updated).length).toBeGreaterThan(60);
		// legacy: NaN before the first key, finite after; render-records: always finite
		expect(all.some(r => r.params.model === 0 && Number.isNaN(r.matrices[0]))).toBe(true);
		expect(all.some(r => r.params.model === 0 && Number.isFinite(r.matrices[0]))).toBe(true);
		expect(modern.flat().every(r => r.matrices.every(Number.isFinite))).toBe(true);
	});

	it('#69 FIX: the pre-first-key slots equal legacy with the first key held (bit-exact everywhere)', async () => {
		const clamped = await runLegacy({ clamp: true });
		const modern = runModern();
		expect(clamped.flat().every(r => r.matrices.every(Number.isFinite))).toBe(true);
		expect(diffRuns(clamped, modern).mismatches).toEqual([]);
		expect(diffRuns(clamped, modern, { exact: true }).mismatches).toEqual([]);
		// the clamped reference only changes the declared slots of legacy as is
		const legacy = await runLegacy();
		expect(diffRuns(legacy, clamped, { exact: true, declared: animatedPayloads() }).mismatches).toEqual([]);
	});

	it('#69 FIX: computeNodeMatrices of a raw payload at load (keyframe 0) equals legacy with the first key held', async () => {
		const ticks = [0];
		const raw = (await runLegacy({ ticks }))[0];
		const clamped = (await runLegacy({ ticks, clamp: true }))[0];
		const payloads = animatedPayloads().filter(p => p.nodes.length);
		raw.forEach((rec, i) => {
			const m = computeNodeMatrices(payloads[i], 0);
			expect(Array.from(clamped[i].matrices).every((v, k) => Object.is(v, m[k]))).toBe(true);
			// legacy as is differs only in the pre-first-key slots (NaN there)
			const divergent = preKeyNodes(payloads[i], 0);
			const diff = diffRecord({ ...rec, params: { ...rec.params, nodes: payloads[i].nodes.length } }, clamped[i], true, divergent);
			expect(diff).toEqual([]);
		});
		expect(raw.some(rec => rec.matrices.some(Number.isNaN))).toBe(true);
	});
});
