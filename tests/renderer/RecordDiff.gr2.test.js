/**
 * Record-diff of render-records' GR2 composer (Gr2Composer + Gr2ModelSource, R-GR2-001
 * lighting, R-GR2-003…005) against legacy Renderer/GR2/GR2ModelRenderer.js.
 *
 * The real legacy GR2 pass (with the real GR2Loader, gr2Pack, gr2World, actorAction,
 * gr2Banks and granny-ro-js `poseAt`) runs the synthetic skinned models of
 * support/gr2Assets.js through the timeline of support/gr2Scene.js; its native records are
 * collected through GR2ModelRenderer.addRecordSink. render-records gets its own file queue
 * (answered one file per frame, like legacy's), decodes through the same GR2Loader, poses
 * through the same `poseAt`, and is fed the entity state through gr2FrameState: the modern
 * frame runs the entity pass first and hands the composer the previous frame's state, which
 * is what legacy's GR2 pass (running before the entity pass) sees. Both streams are diffed
 * per frame and per draw, field by field: alpha, type, world matrix, bone palette (tolerance
 * 1e-5, relative above 1), emblem identity, blend and depth state, per-model light, and the
 * palette sharing between instances of one frame. The port is also checked bit-exact.
 *
 * Declared divergences: none.
 */
import { describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ getFile: null }));

vi.mock('Core/Client.js', () => ({
	default: { getFile: (...args) => bridge.getFile(...args) }
}));
vi.mock('Utils/WebGL.js', () => ({
	default: { createShaderProgram: () => ({ id: 'program' }) }
}));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: { runWithDepth: (_t, _m, _c, fn) => fn() }
}));
vi.mock('Engine/SessionStorage.js', () => ({ default: { Entity: null } }));
vi.mock('Renderer/Map/Altitude.js', async () => {
	const { cellHeight } = await import('./support/gr2Scene.js');
	return { default: { getCellHeight: cellHeight } };
});
vi.mock('Renderer/Effects/FlatColorTile.js', () => ({
	default: () =>
		class {
			static init() {}
			static beforeRender() {}
			static afterRender() {}
			render() {}
		}
}));
vi.mock('granny-ro-js/wasm', async importOriginal => {
	const real = await importOriginal();
	const { grannySeam } = await import('./support/gr2Assets.js');
	return { ...real, ...grannySeam };
});

import GR2Loader from 'Loaders/GR2Loader.js';
import { parseAnimated, poseAt } from 'granny-ro-js/wasm';
import {
	Gr2Composer,
	Gr2ModelSource,
	gr2FrameState
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { buildGr2Files } from './support/gr2Assets.js';
import { installEmblemCanvas } from './support/gr2GlLog.js';
import {
	DARK_TICKS,
	ENTITIES,
	EPOCH,
	PATHS,
	SPAWNS,
	TICKS,
	TICK_MS,
	VIEW,
	cellHeight,
	createFileQueue,
	driveLegacy,
	entityStep,
	flushMicrotasks,
	lightAt,
	makeEntities
} from './support/gr2Scene.js';
import { close } from './support/effectRecordDiff.js';

const gl = new Proxy({}, { get: (_t, k) => (/^[A-Z_0-9]+$/.test(String(k)) ? k : () => ({})) });

/** Legacy: records per frame tick, and the file requests in order. */
async function runLegacy() {
	vi.resetModules();
	const { default: renderer } = await import('Renderer/GR2/GR2ModelRenderer.js');
	const queue = createFileQueue(buildGr2Files());
	bridge.getFile = queue.getFile;
	const frames = new Map();
	let pending = [];
	const stop = renderer.addRecordSink(r => pending.push(r));
	const restoreCanvas = installEmblemCanvas([]);
	try {
		await driveLegacy({
			renderer,
			gl,
			queue,
			onFrame: tick => {
				frames.set(tick, pending);
				pending = [];
			}
		});
	} finally {
		stop();
		restoreCanvas();
	}
	return { frames, requests: queue.requests };
}

/** What the GR2 pass reads from a legacy entity. */
const snapshot = e => ({
	position: [e.position[0], e.position[1], e.position[2]],
	direction: e.direction,
	action: e.action,
	ACTION: e.ACTION,
	animTick: e.animation.tick,
	effectAlpha: e.effectColor[3],
	culled: e.culled,
	emblem: (e.emblem && e.emblem.emblem) || null,
	removeTick: e.remove_tick,
	removeDelay: e.remove_delay
});

/**
 * render-records over the same timeline. The modern frame runs the entity pass first and
 * feeds the composer gr2FrameState(previous, current); `lag: false` feeds the current state
 * instead (sensitivity check).
 */
async function runModern({ lag = true } = {}) {
	const queue = createFileQueue(buildGr2Files());
	let now = EPOCH;
	const models = new Gr2ModelSource({
		fetchFile: queue.getFile,
		decode: buffer => {
			const loader = new GR2Loader(buffer);
			return { parsed: loader.parsed, meshes: loader.meshes, boneCount: loader.boneCount, ipRow: loader.ipRow };
		},
		parseBank: buffer => parseAnimated(new Uint8Array(buffer)),
		ready: () => GR2Loader.ready()
	});
	const composer = new Gr2Composer({ models, poseAt, now: () => now, fade: { death: true, vanish: false } });
	const frames = new Map();
	composer.compose({ modelView: VIEW.modelView, projection: VIEW.projection, light: lightAt(0), tick: -TICK_MS });

	const entities = makeEntities();
	const instances = new Map();
	for (const spec of ENTITIES) {
		const e = entities.get(spec.id);
		instances.set(spec.id, composer.attach({ path: e.gr2, npc: !spec.mob, position: e.position, direction: e.direction }));
	}
	SPAWNS.forEach((spec, i) => {
		const pos = [...spec.pos, cellHeight(spec.pos[0], spec.pos[1])];
		instances.set(`spawn${i}`, composer.spawn(PATHS[spec.model], { pos, dir: spec.dir, action: spec.action }));
	});
	const states = () => {
		const map = new Map();
		for (const [id, e] of entities) {
			if (instances.has(id)) {
				map.set(instances.get(id), snapshot(e));
			}
		}
		return map;
	};
	let previous = states();
	for (const tick of TICKS) {
		now = EPOCH + tick;
		// this frame's entity pass first (detaches land after the GR2 pass, as in legacy)
		const detached = [];
		entityStep(entities, tick, now, id => detached.push(id));
		const current = states();
		const light = DARK_TICKS.includes(tick) ? null : lightAt(tick);
		frames.set(
			tick,
			composer.compose({
				modelView: VIEW.modelView,
				projection: VIEW.projection,
				light,
				tick,
				states: lag ? gr2FrameState(previous, current) : current
			})
		);
		for (const id of detached) {
			composer.detach(instances.get(id));
			instances.delete(id);
		}
		previous = states();
		queue.deliver(1);
		await flushMicrotasks();
	}
	return { frames, requests: queue.requests, composer };
}

let exact = false;
const same = (l, m) => (exact ? Object.is(l, m) : close(l, m));

const vec = (name, l, m, out) => {
	if (!l || !m || l.length !== m.length || Array.from(l).some((v, i) => !same(v, m[i]))) {
		out.push(`${name}: ${l && l.length} vs ${m && m.length}`);
	}
};

/** Field-by-field diff of one legacy native GR2 record against one render-records record. */
function diffGr2Record(l, m) {
	const out = [];
	for (const f of ['kind', 'part', 'depthTest', 'depthWrite']) {
		if (l[f] !== m[f]) {
			out.push(`${f}: ${l[f]} vs ${m[f]}`);
		}
	}
	if (!same(l.alpha, m.alpha)) {
		out.push(`alpha: ${l.alpha} vs ${m.alpha}`);
	}
	if (JSON.stringify(l.blend) !== JSON.stringify(m.blend)) {
		out.push(`blend: ${JSON.stringify(l.blend)} vs ${JSON.stringify(m.blend)}`);
	}
	if (l.params.type !== m.params.type) {
		out.push(`params.type: ${l.params.type} vs ${m.params.type}`);
	}
	if (l.params.emblem !== m.params.emblem) {
		out.push(`params.emblem: ${l.params.emblem?.id} vs ${m.params.emblem?.id}`);
	}
	vec('params.world', l.params.world, m.params.world, out);
	vec('matrices', l.matrices, m.matrices, out);
	vec('params.light.diffuse', l.params.light.diffuse, m.params.light.diffuse, out);
	vec('params.light.ambient', l.params.light.ambient, m.params.light.ambient, out);
	return out;
}

/** Index of the first record sharing each record's palette, per frame. */
const sharing = records => records.map(r => records.findIndex(o => o.matrices === r.matrices));

function diffRuns(legacy, modern) {
	const mismatches = [];
	for (const tick of TICKS) {
		const l = legacy.frames.get(tick) ?? [];
		const m = modern.frames.get(tick) ?? [];
		if (l.length !== m.length) {
			mismatches.push(`@${tick}: ${l.length} legacy draws vs ${m.length}`);
			continue;
		}
		l.forEach((rec, i) => {
			for (const d of diffGr2Record(rec, m[i])) {
				mismatches.push(`@${tick} #${i} ${rec.params.type}: ${d}`);
			}
		});
		if (JSON.stringify(sharing(l)) !== JSON.stringify(sharing(m))) {
			mismatches.push(`@${tick}: palette sharing ${sharing(l)} vs ${sharing(m)}`);
		}
	}
	return mismatches;
}

describe('RecordDiff: render-records GR2 composer vs legacy GR2ModelRenderer', () => {
	it('reproduces every legacy GR2 record field by field, frame by frame', async () => {
		const legacy = await runLegacy();
		const modern = await runModern();

		expect(modern.requests).toEqual(legacy.requests);
		const total = [...legacy.frames.values()].reduce((n, f) => n + f.length, 0);
		expect(total).toBeGreaterThan(400);
		expect(diffRuns(legacy, modern)).toEqual([]);
		// the port is bit-exact, not just within tolerance
		exact = true;
		try {
			expect(diffRuns(legacy, modern)).toEqual([]);
		} finally {
			exact = false;
		}
		expect(modern.composer.overBoneLimit).toBe(0);

		// the scene exercises what it claims
		const all = [...modern.frames.values()].flat();
		expect(all.some(r => r.alpha < 1 && r.alpha > 0)).toBe(true);
		expect(new Set(all.map(r => r.params.emblem?.id ?? null)).size).toBe(3);
		expect(new Set(all.map(r => r.matrices.length))).toEqual(new Set([48, 64, 128, 656]));
		expect(modern.frames.get(DARK_TICKS[0])).toEqual([]);
	});

	it('the diff is sensitive: without the one-frame lag the GR2 records diverge', async () => {
		const legacy = await runLegacy();
		const modern = await runModern({ lag: false });
		expect(diffRuns(legacy, modern).length).toBeGreaterThan(0);
	});
});
