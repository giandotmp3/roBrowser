/**
 * Phase 2 record-diff of render-records' LockOnEffect / MagicTargetEffect against legacy
 * Renderer/Effects/LockOnTarget.js and MagicTarget.js.
 *
 * The real legacy effects run the synthetic spawns of support/targetMarkerScene.js the way
 * EffectManager drives them; their native records are collected through addRecordSink.
 * render-records gets the same spawns, followed targets, camera latitude, scene fog and,
 * for MagicTarget, the skill's CastSize row plus the player's last skill level when the
 * player cast that skill (the caller's Session check). Both streams are diffed per
 * instance and per tick, field by field (tolerance 1e-5, relative above 1); instances
 * must finish on the same tick.
 *
 * Declared divergences: none.
 */
import { describe, expect, it, vi } from 'vitest';

const camera = vi.hoisted(() => ({
	angle: [240, 0],
	getLatitude() {
		return this.angle[0] - 180.0;
	}
}));
const session = vi.hoisted(() => ({ Entity: { lastSKID: 0, lastSkLvl: 0 } }));

vi.mock('Utils/WebGL.js', async () => (await import('./support/legacyEffectMocks.js')).webglMock);
vi.mock('Utils/Texture.js', async () => (await import('./support/legacyEffectMocks.js')).textureMock);
vi.mock('Core/Client.js', async () => (await import('./support/legacyEffectMocks.js')).clientMock);
vi.mock('Core/Configs.js', () => ({ default: { get: () => false } }));
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Engine/SessionStorage.js', () => ({ default: session }));
vi.mock('Renderer/Map/Altitude.js', async () => ({
	default: { generatePlane: (await import('./support/targetMarkerScene.js')).fakePlane }
}));

import {
	LockOnEffect,
	MagicTargetEffect,
	castAreaSize
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { createLoggingGl, fogAt, renderClassFrame } from './support/legacyEffectMocks.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';
import {
	CAST_SIZES,
	MARKER_TICKS,
	makeMarkerTarget,
	moveMarkerTargets,
	spawnLockOns,
	spawnMagicTargets
} from './support/targetMarkerScene.js';

const gl = createLoggingGl(null);

/** The player's last skill level when the player cast this skill last (legacy Session check). */
const ownLevel = spawn =>
	spawn.self && spawn.session && spawn.session.lastSKID === spawn.skillId ? spawn.session.lastSkLvl : undefined;

/**
 * Run legacy and render-records side by side over the scripted ticks.
 * @param {'lockon'|'magic'} kind
 * @param {object} [mutate] { startTick(t) } render-records-side mutation
 */
async function runScene(kind, mutate = {}) {
	vi.resetModules();
	const Ctor = (
		await import(kind === 'lockon' ? 'Renderer/Effects/LockOnTarget.js' : 'Renderer/Effects/MagicTarget.js')
	).default;
	const legacyTargets = [0, 1].map(makeMarkerTarget);
	const targets = [0, 1].map(makeMarkerTarget);
	const live = kind === 'lockon' ? spawnLockOns(Ctor, legacyTargets) : spawnMagicTargets(Ctor, session);
	const rebuilt = live.map(({ name, spawn }) => ({
		name,
		effect:
			kind === 'lockon'
				? new LockOnEffect({
						follow: targets[spawn.target],
						startTick: mutate.startTick ? mutate.startTick(spawn.startTick) : spawn.startTick,
						endTick: spawn.endTick
					})
				: new MagicTargetEffect(
						{ sizes: CAST_SIZES[spawn.skillId] },
						{ x: spawn.x, y: spawn.y, endTick: spawn.endTick, skillLevel: ownLevel(spawn) }
					)
	}));

	const mismatches = [];
	const perEffect = {};
	let records = 0;
	let sink = [];
	const stop = Ctor.addRecordSink(r => sink.push(r));
	try {
		MARKER_TICKS.forEach((tick, i) => {
			moveMarkerTargets(legacyTargets, tick);
			moveMarkerTargets(targets, tick);
			camera.angle = [200 + (tick % 70), (tick / 7) % 360];
			const fog = fogAt(i);
			const legacy = {};
			renderClassFrame(gl, Ctor, live, tick, fog, ({ name }, _t, drawn) => {
				expect(sink).toHaveLength(drawn ? 1 : 0);
				legacy[name] = sink[0] ?? null;
				sink = [];
			});
			const alive = new Set(live.map(e => e.name));
			for (const entry of rebuilt) {
				if (entry.done) {
					continue;
				}
				const m = entry.effect.frame(tick, {
					sceneFog: { use: !!(fog.use && fog.exist) },
					cameraLatitude: camera.getLatitude()
				});
				entry.done = entry.effect.finished;
				const l = legacy[entry.name];
				if (!l) {
					mismatches.push(`${entry.name}@${tick}: only render-records drew`);
					continue;
				}
				records++;
				perEffect[entry.name] = (perEffect[entry.name] ?? 0) + 1;
				for (const d of diffEffectRecord(l, m)) {
					mismatches.push(`${entry.name}@${tick} ${d}`);
				}
				if (alive.has(entry.name) === entry.done) {
					mismatches.push(
						`${entry.name}@${tick}: legacy alive ${alive.has(entry.name)}, finished ${entry.done}`
					);
				}
			}
		});
	} finally {
		stop();
	}
	return { records, mismatches, perEffect };
}

describe('target marker record-diff (legacy vs render-records)', () => {
	it('reproduces every legacy LockOnTarget record field by field', async () => {
		const { mismatches, perEffect } = await runScene('lockon');
		expect(mismatches).toEqual([]);
		expect(perEffect).toEqual({ 'lock-a': 10, 'lock-late': 13, 'lock-open': 1 });
	});

	it('reproduces every legacy MagicTarget record (all CastSize branches) field by field', async () => {
		const { mismatches, perEffect } = await runScene('magic');
		expect(mismatches).toEqual([]);
		expect(Object.keys(perEffect)).toHaveLength(7);
	});

	it('flags a wrong start tick (mutation guard)', async () => {
		const { mismatches } = await runScene('lockon', { startTick: t => t + 20 });
		expect(mismatches.some(m => m.includes('params.shade'))).toBe(true);
	});

	it('cast area size follows the legacy CastSize lookup', () => {
		expect(castAreaSize(undefined, 3)).toBe(1);
		expect(castAreaSize([3, 3, 5], 3)).toBe(5);
		expect(castAreaSize([3, 3, 5], 4)).toBe(3);
		expect(castAreaSize([3, 3, 5], 0)).toBe(3);
		expect(castAreaSize([0], undefined)).toBe(1);
	});
});
