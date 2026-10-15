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
 * Declared divergences -- discrepancy #56 [FLAG, fixed, HITL round 2], each in one spawn only:
 * - 'stale-textures': legacy keeps the objects' textures on a same-count rebuild, so meshes
 *   swap textures; render-records rebinds. Only `texture` of that spawn may differ, and the
 *   rebuilt records must carry their own mesh's texture.
 * - 'regrow': after its object-count change legacy draws the failed texture's object with no
 *   texture bound (texture null); render-records does not draw failed textures
 *   (frameState.textureFailed). Only those null-texture legacy draws of 'regrow' are dropped
 *   before diffing; render-records' side is never filtered.
 * - 'timed': legacy ignores endTick and keeps drawing; render-records draws nothing past it
 *   and finishes. Only "N legacy draws vs 0" of 'timed' after its endTick may differ.
 *
 * Not diffed: a model file that never loads.
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
	RSM_TIMED_SPAWNS,
	TICKS,
	fogAt,
	makeOwner,
	moveOwner,
	renderLegacyFrame,
	spawnLegacy
} from './support/rsmEffectScene.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';

const gl = new Proxy({}, { get: (_t, k) => (/^[A-Z_0-9]+$/.test(String(k)) ? k : () => ({})) });

/** Texture loads that fail in the scene (Client.loadFile calls onerror). */
const textureFailed = texture => texture.includes('missing');
/** Every scene spawn plus the #56 endTick one. */
const SPAWNS = [...RSM_SPAWNS, ...RSM_TIMED_SPAWNS];
const TIMED_END = RSM_TIMED_SPAWNS[0].endTick;
const tickOf = m => Number(m.split('@')[1].split(/[#:]/)[0]);

/** #56 scope: the only mismatches render-records may show. */
const declared = m =>
	(m.startsWith('stale-textures@') && /#\d+ texture: /.test(m)) ||
	(m.startsWith('timed@') && tickOf(m) > TIMED_END && /: [1-9]\d* legacy draws vs 0$/.test(m));

/**
 * Run legacy and render-records side by side over the scripted ticks.
 * @param {object} [mutate] optional { spawn name: (effect) => void } applied to the players
 */
function runScene(mutate = {}) {
	LegacyRsmEffect.init(gl);
	const legacyOwner = makeOwner();
	const owner = makeOwner();
	const live = spawnLegacy(LegacyRsmEffect, SPAWNS, legacyOwner);
	const rebuilt = SPAWNS.filter(s => !s.effect.file.includes('missing')).map(s => ({
		name: s.name,
		effect: new RsmEffect(
			s.effect,
			{
				position: s.attached ? owner.position : s.position,
				startTick: s.startTick,
				endTick: s.endTick ?? -1,
				follow: s.attached ? owner : null
			},
			{ model: new FakeModel(`data\\model\\${s.effect.file}.rsm`) }
		)
	}));
	rebuilt.forEach(e => mutate[e.name]?.(e.effect));

	const mismatches = [];
	const perEffect = {};
	const drawnBy = {};
	let droppedNull = 0;
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
				// #56: only 'regrow' draws a failed texture with no texture bound (null) in legacy
				const kept = name === 'regrow' ? sink.filter(r => r.texture !== null) : sink;
				droppedNull += sink.length - kept.length;
				legacy[name] = drawn ? kept : [];
				sink = [];
			});
			for (const entry of rebuilt) {
				const mine = entry.effect.frame(tick, { sceneFog: { use: !!(fog.use && fog.exist) }, textureFailed });
				(drawnBy[entry.name] ??= []).push(...mine);
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
	return { records, mismatches, perEffect, drawn: drawnBy, droppedNull, rebuilt };
}

describe('RsmEffect record-diff (legacy vs render-records)', () => {
	it('reproduces every legacy RSM record (vertices included) field by field, except the #56 fixes', () => {
		const { records, mismatches, perEffect } = runScene();
		expect(mismatches.filter(m => !declared(m))).toEqual([]);
		expect(Object.keys(perEffect).sort()).toEqual(
			SPAWNS.map(s => s.name)
				.filter(n => n !== 'missing-model')
				.sort()
		);
		expect(records).toBeGreaterThan(600);
	});

	it('#56 divergence: stale textures rebound, failed textures not drawn, endTick honoured', () => {
		const { mismatches, drawn, droppedNull, rebuilt } = runScene();
		// stale textures: legacy swaps them after the first rebuild; render-records binds each mesh's own
		expect(mismatches.some(m => m.startsWith('stale-textures@'))).toBe(true);
		const stale = drawn['stale-textures'];
		const ice = 'data/texture/effect/ice.bmp';
		const fire = 'data/texture/effect/fire.bmp';
		for (let i = 0; i < stale.length; i += 2) {
			const pair = [stale[i].texture, stale[i + 1].texture];
			expect(pair).toEqual(stale[i].params.frame === null ? [fire, ice] : [ice, fire]);
		}
		expect(stale.some(r => r.params.frame !== null)).toBe(true);
		// failed textures: legacy drew 'regrow' objects with no texture; render-records never draws one
		expect(droppedNull).toBeGreaterThan(0);
		expect(Object.values(drawn).flat().filter(r => textureFailed(r.texture))).toEqual([]);
		// endTick: legacy keeps drawing past it; render-records stops and finishes
		expect(mismatches.some(m => m.startsWith('timed@'))).toBe(true);
		expect(drawn.timed.length).toBeGreaterThan(0);
		expect(rebuilt.find(e => e.name === 'timed').effect.finished).toBe(true);
		expect(rebuilt.find(e => e.name === 'spin').effect.finished).toBe(false);
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
