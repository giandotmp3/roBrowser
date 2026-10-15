/**
 * Phase 2 record-diff of render-records' RsmEffect (EffectTable 'RSM' / 'RSM2') against
 * legacy Renderer/Effects/RsmEffect.js.
 *
 * The real legacy RsmEffect runs the synthetic models of support/rsmEffectScene.js the
 * way EffectManager drives it (static, failed texture, keyframed rotation / position /
 * scale with none, flat and smooth shading, an object-count change on the first rebuild,
 * keyframes with animLen 0, a followed owner), and its native records are collected
 * through RsmEffect.addRecordSink. render-records' RsmEffect gets its own FakeModel of
 * the same description (the RSM loader is outside the renderer), the same instance
 * parameters, followed entity and scene fog. Both streams are diffed per effect, per
 * tick and per draw, field by field, including every object's vertices (tolerance 1e-5,
 * relative above 1).
 *
 * Declared divergences: none.
 *
 * Not diffed: objects whose texture never loads. Legacy never draws them after the
 * initial load, but draws them with no texture bound after an object-count change
 * (texture null); residency is the backend's job in the rebuild, so both sides drop
 * those draws. A model file that never loads.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ attribute: {}, uniform: {} }),
		texture: (_gl, data, onload, ...args) => {
			if (typeof data !== 'string') {
				onload({ id: data.name }, ...args);
			}
		}
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		getFile: (filename, onload) => {
			if (!filename.includes('missing')) {
				onload(filename);
			}
		},
		loadFile: (filename, onload, onerror) => {
			if (filename.includes('missing')) {
				onerror?.();
			} else {
				onload({ name: filename });
			}
		}
	}
}));
vi.mock('Loaders/Model.js', async () => {
	const { FakeModel } = await import('./support/rsmEffectScene.js');
	return { default: FakeModel };
});

import LegacyRsmEffect from 'Renderer/Effects/RsmEffect.js';
import { RsmEffect, rsmKeyframePair } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	FakeModel,
	RSM_SPAWNS,
	TICKS,
	fogAt,
	makeOwner,
	moveOwner,
	renderLegacyFrame,
	spawnLegacy
} from './support/rsmEffectScene.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';

const gl = new Proxy({}, { get: (_t, k) => (/^[A-Z_0-9]+$/.test(String(k)) ? k : () => ({})) });

const unloaded = texture => texture === null || String(texture?.id ?? texture).includes('missing');

/**
 * Run legacy and render-records side by side over the scripted ticks.
 * @param {object} [mutate] optional { spawn name: (effect) => void } applied to the players
 */
function runScene(mutate = {}) {
	LegacyRsmEffect.init(gl);
	const legacyOwner = makeOwner();
	const owner = makeOwner();
	const live = spawnLegacy(LegacyRsmEffect, RSM_SPAWNS, legacyOwner);
	const rebuilt = RSM_SPAWNS.filter(s => !s.effect.file.includes('missing')).map(s => ({
		name: s.name,
		effect: new RsmEffect(
			s.effect,
			{ position: s.attached ? owner.position : s.position, startTick: s.startTick, follow: s.attached ? owner : null },
			{ model: new FakeModel(`data\\model\\${s.effect.file}.rsm`) }
		)
	}));
	rebuilt.forEach(e => mutate[e.name]?.(e.effect));

	const mismatches = [];
	const perEffect = {};
	let records = 0;
	let sink = [];
	const stop = LegacyRsmEffect.addRecordSink(r => sink.push(r));
	// legacy init draws Math.random for its (unused) instance file name
	const { restore } = installDeterminism({ rng: new SeededRng(0x45a) });
	try {
		TICKS.forEach((tick, i) => {
			moveOwner(legacyOwner, tick);
			moveOwner(owner, tick);
			const fog = fogAt(i);
			const legacy = {};
			renderLegacyFrame(gl, LegacyRsmEffect, live, tick, fog, ({ name }, _t, drawn) => {
				legacy[name] = drawn ? sink.filter(r => !unloaded(r.texture)) : [];
				sink = [];
			});
			for (const entry of rebuilt) {
				const mine = entry.effect
					.frame(tick, { sceneFog: { use: !!(fog.use && fog.exist) } })
					.filter(r => !unloaded(r.texture));
				const theirs = legacy[entry.name];
				if (mine.length !== theirs.length) {
					mismatches.push(`${entry.name}@${tick}: ${theirs.length} legacy draws vs ${mine.length}`);
					continue;
				}
				mine.forEach((m, d) => {
					records++;
					perEffect[entry.name] = (perEffect[entry.name] ?? 0) + 1;
					for (const diff of diffEffectRecord(theirs[d], m)) {
						mismatches.push(`${entry.name}@${tick}#${d} ${diff}`);
					}
				});
			}
		});
	} finally {
		stop();
		restore();
	}
	return { records, mismatches, perEffect };
}

describe('RsmEffect record-diff (legacy vs render-records)', () => {
	it('reproduces every legacy RSM record (vertices included) field by field', () => {
		const { records, mismatches, perEffect } = runScene();
		expect(mismatches).toEqual([]);
		expect(Object.keys(perEffect).sort()).toEqual(
			RSM_SPAWNS.map(s => s.name)
				.filter(n => n !== 'missing-model')
				.sort()
		);
		expect(records).toBeGreaterThan(600);
	});

	it('flags mutations (mutation guard)', () => {
		const fps = runScene({ spin: e => (e.fps = 21) });
		expect(fps.mismatches.some(m => m.includes('params.vertices'))).toBe(true);
		const smooth = runScene({ spin: e => (e.model.nodes[0].main = { ...e.model.nodes[0].main, shadeType: 1 }) });
		expect(smooth.mismatches.some(m => m.includes('params.vertices'))).toBe(true);
		const follow = runScene({ 'spin-attached': e => (e.follow = null) });
		expect(follow.mismatches.some(m => m.includes('position'))).toBe(true);
		const size = runScene({ static: e => (e.size = 1) });
		expect(size.mismatches.some(m => m.includes('params.size'))).toBe(true);
	});

	it('keyframe pairs wrap from the last key to the first over animLen', () => {
		const keys = [{ frame: 5 }, { frame: 25 }];
		expect(rsmKeyframePair(keys, k => k.frame, 15, 40)).toEqual({ prev: 0, next: 1, t: 0.5 });
		expect(rsmKeyframePair(keys, k => k.frame, 35, 40)).toEqual({ prev: 1, next: 0, t: 0.5 });
		expect(rsmKeyframePair(keys, k => k.frame, 0, 40)).toEqual({ prev: 1, next: 0, t: 0.75 });
		// exactly on a later key: that key alone
		expect(rsmKeyframePair(keys, k => k.frame, 25, 40)).toEqual({ prev: 1, next: 1, t: 0 });
	});
});
