/**
 * Phase 2 record-diff of the level-99 aura stack (R-EFX-014 additive, R-EFX-015):
 * render-records' GroundAuraEffect (EF_LEVEL99_2), SwirlingAuraEffect (EF_LEVEL99) and
 * Level99BubbleEffect (EF_LEVEL99_3) against legacy Renderer/Effects/GroundAura.js,
 * SwirlingAura.js and Level99Bubble.js.
 *
 * The real legacy effects run the synthetic spawns of support/auraScene.js the way
 * EffectManager drives them (owner walking over non-uniform terrain, camera turning,
 * scene fog toggling), and their native records are collected through addRecordSink.
 * The render-records players get the same spawns, followed entity, terrain, camera,
 * fog and seeded randomness (Level99Bubble consumes Math.random in legacy order across
 * all instances, so every instance is advanced in legacy order). Both streams are diffed
 * per effect, per tick and per draw, field by field (tolerance 1e-5, relative above 1).
 *
 * Declared divergences (HITL round 2), each in its own scenario only:
 * - #55 [FLAG, fixed]: GroundAura / Level99Bubble frame deltas are clamped to [0, 250] ms, so
 *   a frame before an instance's start tick no longer runs it backwards. The main GroundAura
 *   and Level99Bubble diffs therefore leave out the frames before the common start (tick
 *   900) and the 'delayed' spawns. The #55 scenario runs every spawn alone: legacy differs
 *   when it sees the pre-start frames, and render-records over every tick equals legacy run
 *   without its pre-start frames, field by field from the start tick on.
 * - #53 [FLAG, fixed]: Level99Bubble with startTick 0 seeds its clock at the spawn frame.
 *   Legacy seeds it from Date.now() and never draws; render-records equals legacy spawned
 *   with startTick = the first frame's tick, field by field.
 * SwirlingAura is unaffected and still diffed over every spawn and tick.
 *
 * Not diffed: an entry whose texture never loads (legacy's ready gate; residency is the
 * backend's job in the rebuild). Level99Bubble's debug spawn volume (unreachable).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const camera = vi.hoisted(() => ({ angle: [230, 0, 0] }));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ attribute: {}, uniform: {} }),
		texture: (_gl, buffer, onload) => onload({ id: buffer })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, onload) => {
			if (!filename.includes('missing')) {
				onload(filename);
			}
		}
	}
}));
vi.mock('Renderer/Map/Altitude.js', async () => {
	const { cellHeight } = await import('./support/auraScene.js');
	return { default: { getCellHeight: cellHeight } };
});
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: { runWithDepth: (_t, _m, _c, fn) => fn() }
}));

import GroundAura from 'Renderer/Effects/GroundAura.js';
import SwirlingAura from 'Renderer/Effects/SwirlingAura.js';
import Level99Bubble from 'Renderer/Effects/Level99Bubble.js';
import {
	GroundAuraEffect,
	Level99BubbleEffect,
	SWIRL_INDICES,
	SwirlingAuraEffect
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	GROUND_AURA_SPAWNS,
	LEVEL99_BUBBLE_SPAWNS,
	SWIRLING_AURA_SPAWNS,
	TICKS,
	cameraAngleAt,
	cellHeight,
	fogAt,
	makeOwner,
	moveOwner,
	renderLegacyFrame,
	spawnLegacy
} from './support/auraScene.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';

const gl = new Proxy({}, { get: (_t, k) => (/^[A-Z_0-9]+$/.test(String(k)) ? k : () => ({})) });

let restore = null;
afterEach(() => {
	restore?.();
	restore = null;
});

/** render-records constructors of each legacy family, from the legacy spawn args. */
const FAMILIES = {
	ground: {
		Legacy: GroundAura,
		spawns: GROUND_AURA_SPAWNS,
		build: ([size, distance, textureName, startTick], inst) =>
			new GroundAuraEffect({ size, distance, textureName }, { ...inst, startTick })
	},
	swirl: {
		Legacy: SwirlingAura,
		spawns: SWIRLING_AURA_SPAWNS,
		build: ([textureName, startTick, sizeType], inst) =>
			new SwirlingAuraEffect({ textureName, sizeType }, { ...inst, startTick })
	},
	bubble: {
		Legacy: Level99Bubble,
		spawns: LEVEL99_BUBBLE_SPAWNS,
		build: ([textureName, startTick, flag1], inst, ports) =>
			new Level99BubbleEffect({ textureName, flag1 }, { ...inst, startTick }, ports)
	}
};

/** Frames from the common start tick on (no frame before any main-scene start tick, #55). */
const MAIN_TICKS = TICKS.filter(t => t >= 1000);

/** Spawns of the main diffs: no 'delayed' (#55) and no zero-start bubble (#53). */
const mainSpawns = key => FAMILIES[key].spawns.filter(s => s.name !== 'delayed' && !(key === 'bubble' && s.name === 'zero-start'));

/**
 * Run one legacy family and its render-records players side by side over the ticks.
 * @param {keyof FAMILIES} key
 * @param {number} seed
 * @param {object} [mutate] optional { spawn name: (effect) => void } applied to the players
 * @param {object} [opts]
 * @param {Array} [opts.spawns] spawns (default: the family's main spawns)
 * @param {number[]} [opts.ticks] frames render-records draws (default MAIN_TICKS)
 * @param {(tick: number) => boolean} [opts.legacyTick] frames legacy draws (and that are compared)
 * @param {(spawn: object) => Array} [opts.legacyArgs] legacy constructor args (default spawn.args)
 */
function runScene(
	key,
	seed,
	mutate = {},
	{ spawns = mainSpawns(key), ticks = MAIN_TICKS, legacyTick = () => true, legacyArgs = s => s.args } = {}
) {
	const { Legacy, build } = FAMILIES[key];
	Legacy.init(gl);
	const legacyOwner = makeOwner();
	const owner = makeOwner();
	({ restore } = installDeterminism({ rng: new SeededRng(seed) }));
	const live = spawnLegacy(
		Legacy,
		spawns.map(s => ({ ...s, args: legacyArgs(s) })),
		legacyOwner
	);
	const rng = new SeededRng(seed).fn;
	const rebuilt = spawns.map(s => ({
		name: s.name,
		skip: s.args.some(a => typeof a === 'string' && a.includes('missing')),
		effect: build(
			s.args,
			{ position: s.attached ? owner.position : s.position, follow: s.attached ? owner : null },
			{ rng }
		)
	}));
	rebuilt.forEach(e => mutate[e.name]?.(e.effect));

	const mismatches = [];
	const perEffect = {};
	let records = 0;
	let sink = [];
	const stop = Legacy.addRecordSink(r => sink.push(r));
	try {
		ticks.forEach(tick => {
			// scene state (fog) follows the tick, so a frame means the same in every scenario
			const i = TICKS.indexOf(tick);
			moveOwner(legacyOwner, tick);
			moveOwner(owner, tick);
			const cameraAngle = cameraAngleAt(tick);
			[camera.angle[0], camera.angle[1]] = cameraAngle;
			const fog = fogAt(i);
			const legacy = {};
			const compared = legacyTick(tick);
			if (compared) {
				renderLegacyFrame(gl, Legacy, live, tick, fog, ({ name }, _t, drawn) => {
					legacy[name] = drawn ? sink : null;
					sink = [];
				});
			}
			for (const entry of rebuilt) {
				const frameState = { heightAt: cellHeight, cameraAngle, sceneFog: { use: !!(fog.use && fog.exist) } };
				if (!compared) {
					entry.effect.frame(tick, frameState);
					continue;
				}
				if (entry.skip) {
					expect(legacy[entry.name]).toBeNull();
					continue;
				}
				const mine = entry.effect.frame(tick, frameState);
				const theirs = legacy[entry.name] ?? [];
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
		restore = null;
	}
	return { records, mismatches, perEffect };
}

const drawable = spawns => spawns.map(s => s.name).filter(n => !n.includes('missing'));

describe('Aura record-diff (legacy vs render-records)', () => {
	it('GroundAura: reproduces every legacy ring record field by field', () => {
		const { records, mismatches, perEffect } = runScene('ground', 1);
		expect(mismatches).toEqual([]);
		expect(Object.keys(perEffect).sort()).toEqual(drawable(mainSpawns('ground')).sort());
		expect(records).toBeGreaterThan(500);
	});

	it('SwirlingAura: reproduces every legacy band record (mesh included) field by field', () => {
		const { records, mismatches, perEffect } = runScene('swirl', 1, {}, { spawns: SWIRLING_AURA_SPAWNS, ticks: TICKS });
		expect(mismatches).toEqual([]);
		expect(Object.keys(perEffect).sort()).toEqual(drawable(SWIRLING_AURA_SPAWNS).sort());
		expect(records).toBeGreaterThan(900);
		expect(SWIRL_INDICES).toHaveLength(120);
	});

	it('Level99Bubble: reproduces every legacy anchor record (seeded) field by field', () => {
		const { records, mismatches, perEffect } = runScene('bubble', 0x99b);
		expect(mismatches).toEqual([]);
		expect(Object.keys(perEffect).sort()).toEqual(drawable(mainSpawns('bubble')).sort());
		expect(records).toBeGreaterThan(2000);
	});

	describe('#55 divergence: frames before the start tick (dt clamped to [0, 250] ms)', () => {
		const PRE_START = {
			ground: GROUND_AURA_SPAWNS.filter(s => s.args[3] > TICKS[0] && !s.name.includes('missing')),
			bubble: LEVEL99_BUBBLE_SPAWNS.filter(s => s.args[1] > TICKS[0] && !s.name.includes('missing'))
		};
		const startOf = (key, s) => s.args[key === 'ground' ? 3 : 1];

		for (const key of ['ground', 'bubble']) {
			it(`${key}: legacy runs backwards on pre-start frames; render-records equals legacy without them`, () => {
				expect(PRE_START[key].map(s => s.name)).toContain('delayed');
				for (const spawn of PRE_START[key]) {
					const start = startOf(key, spawn);
					// legacy sees the pre-start frames: running 600 ms backwards, 'delayed' differs for good
					// (a 100 ms backwards run can cancel out, so only 'delayed' must differ)
					if (spawn.name === 'delayed') {
						const raw = runScene(key, 0x55, {}, { spawns: [spawn], ticks: TICKS });
						expect(raw.mismatches.length, spawn.name).toBeGreaterThan(0);
					}
					// fixed behaviour: identical to legacy that never saw a frame before its start tick
					const fixed = runScene(key, 0x55, {}, { spawns: [spawn], ticks: TICKS, legacyTick: t => t >= start });
					expect(fixed.mismatches, spawn.name).toEqual([]);
					expect(fixed.records, spawn.name).toBeGreaterThan(0);
				}
			});
		}
	});

	it('#53 divergence: a zero-start bubble seeds its clock at the spawn frame and draws', () => {
		const zero = LEVEL99_BUBBLE_SPAWNS.filter(s => s.name === 'zero-start');
		// legacy: seeded from Date.now(), the first delta is hugely negative and it never draws
		const raw = runScene('bubble', 0x53, {}, { spawns: zero, ticks: TICKS });
		expect(raw.records).toBe(0);
		expect(raw.mismatches.length).toBeGreaterThan(0);
		expect(raw.mismatches.every(m => / 0 legacy draws vs [1-9]/.test(m))).toBe(true);
		// fixed: identical to legacy spawned with startTick = the first frame's tick
		const fixed = runScene('bubble', 0x53, {}, {
			spawns: zero,
			ticks: TICKS,
			legacyArgs: s => [s.args[0], TICKS[0], s.args[2]]
		});
		expect(fixed.mismatches).toEqual([]);
		expect(fixed.records).toBeGreaterThan(100);
	});

	it('Level99Bubble: is deterministic per seed', () => {
		const a = runScene('bubble', 7);
		const b = runScene('bubble', 8);
		expect(a.mismatches).toEqual([]);
		expect(b.mismatches).toEqual([]);
		expect(a.records).not.toBe(b.records);
	});

	it('flags mutations (mutation guard)', () => {
		const ground = runScene('ground', 1, { 'level99-2': e => (e.size = 101) });
		expect(ground.mismatches.length).toBeGreaterThan(0);
		const swirl = runScene('swirl', 1, { level99: e => (e.bands[1].spinSpeed = 4.01) });
		expect(swirl.mismatches.some(m => m.includes('params.vertices'))).toBe(true);
		const bubble = runScene('bubble', 0x99b, { blue: e => (e.variant.passCount = 1) });
		expect(bubble.mismatches.length).toBeGreaterThan(0);
		const follow = runScene('ground', 1, { 'level99-2': e => (e.follow = null) });
		expect(follow.mismatches.some(m => m.includes('position'))).toBe(true);
	});
});
