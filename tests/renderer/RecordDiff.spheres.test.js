/**
 * Phase 2 record-diff of render-records' SpiritSphereEffect / WarlockSphereEffect
 * (R-EFX-014) against legacy Renderer/Effects/SpiritSphere.js and WarlockSphere.js.
 *
 * The real legacy effects run the synthetic spawns of support/sphereScene.js the way
 * EffectManager drives them; their native records are collected through addRecordSink.
 * render-records gets the same spawns, followed owners and camera. Both streams are
 * diffed per instance and per tick, record by record, field by field (tolerance 1e-5,
 * relative above 1).
 *
 * Declared divergence: #57 [SME, decided, HITL round 2]. render-records fades spheres in by
 * 0.005 per 1000/60 ms of elapsed time; legacy by 0.005 per drawn frame. On exact 60 fps
 * ticks (SPHERE_TICKS_60FPS) both are identical and every field must match. On the irregular
 * SPHERE_TICKS only the alpha component of `color` may differ, and render-records' alpha must
 * be the layer's base alpha × min(1, initial + 0.005 · elapsed / (1000/60)).
 */
import { describe, expect, it, vi } from 'vitest';

const camera = vi.hoisted(() => ({ angle: [240, 0], zoom: 1 }));

vi.mock('Utils/WebGL.js', async () => (await import('./support/legacyEffectMocks.js')).webglMock);
vi.mock('Utils/Texture.js', async () => (await import('./support/legacyEffectMocks.js')).textureMock);
vi.mock('Core/Client.js', async () => (await import('./support/legacyEffectMocks.js')).clientMock);
vi.mock('Core/Configs.js', () => ({ default: { get: () => false } }));
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: { runWithDepth: (_t, _w, _c, fn) => fn() }
}));

import {
	SPHERE_FADE_IN_FRAME_MS,
	SPHERE_FADE_IN_STEP,
	SPHERE_LAYERS,
	SpiritSphereEffect,
	WarlockSphereEffect,
	sphereOrbit
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { createLoggingGl, fogAt, renderClassFrame } from './support/legacyEffectMocks.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';
import {
	SPHERE_TICKS,
	SPHERE_TICKS_60FPS,
	SPIRIT_SPAWNS,
	WARLOCK_SPAWNS,
	makeSphereOwner,
	moveSphereOwner,
	sphereCameraAt,
	spawnSpheres
} from './support/sphereScene.js';

const gl = createLoggingGl(null);

const KINDS = {
	spirit: {
		path: 'Renderer/Effects/SpiritSphere.js',
		spawns: SPIRIT_SPAWNS,
		make: (spawn, follow) => new SpiritSphereEffect(spawn, { follow, initialAlpha: spawn.initialAlpha })
	},
	warlock: {
		path: 'Renderer/Effects/WarlockSphere.js',
		spawns: WARLOCK_SPAWNS,
		make: (spawn, follow) => new WarlockSphereEffect(spawn, { follow, initialAlpha: spawn.initialAlpha })
	}
};

/**
 * Run legacy and render-records side by side over the scripted ticks.
 * @param {'spirit'|'warlock'} kind
 * @param {object} [mutate] { cameraAngle(angle) } render-records-side mutation
 * @param {object} [opts]
 * @param {number[]} [opts.ticks]
 * @param {boolean} [opts.timeFade] #57 scope: compare color alpha against the time-based fade
 *        instead of legacy (every other field and colour component still against legacy)
 */
async function runScene(kind, mutate = {}, { ticks = SPHERE_TICKS_60FPS, timeFade = false } = {}) {
	vi.resetModules();
	const Ctor = (await import(KINDS[kind].path)).default;
	const { spawns } = KINDS[kind];
	const legacyOwners = spawns.map((_s, k) => makeSphereOwner(k));
	const owners = spawns.map((_s, k) => makeSphereOwner(k));
	const live = spawnSpheres(Ctor, kind, spawns, legacyOwners);
	const rebuilt = spawns.map((spawn, k) => ({ name: spawn.name, effect: KINDS[kind].make(spawn, owners[k]) }));

	const mismatches = [];
	const perEffect = {};
	const layers = new Set();
	let alphaDiffs = 0;
	let records = 0;
	let sink = [];
	const stop = Ctor.addRecordSink(r => sink.push(r));
	try {
		ticks.forEach((tick, i) => {
			const cam = sphereCameraAt(tick);
			Object.assign(camera, cam);
			legacyOwners.forEach((o, k) => moveSphereOwner(o, k, tick));
			owners.forEach((o, k) => moveSphereOwner(o, k, tick));
			const legacy = {};
			renderClassFrame(gl, Ctor, live, tick, fogAt(i), ({ name }) => {
				legacy[name] = sink;
				sink = [];
			});
			const angle = mutate.cameraAngle ? mutate.cameraAngle(cam.angle) : cam.angle;
			for (const { name, effect } of rebuilt) {
				const mine = effect.frame(tick, { camera: { angle, zoom: cam.zoom } });
				const theirs = legacy[name] ?? [];
				if (mine.length !== theirs.length) {
					mismatches.push(`${name}@${tick}: ${theirs.length} legacy vs ${mine.length} render-records draws`);
					continue;
				}
				mine.forEach((m, j) => {
					records++;
					perEffect[name] = (perEffect[name] ?? 0) + 1;
					layers.add(m.params.layer);
					let l = theirs[j];
					if (timeFade) {
						const spawn = spawns.find(s => s.name === name);
						const spec = SPHERE_LAYERS[m.params.layer];
						const base = (spawn.isCoin ? spec.coin : spec.plain)[4];
						const fade = Math.min(
							1,
							(spawn.initialAlpha ?? 0) + (SPHERE_FADE_IN_STEP * (tick - ticks[0])) / SPHERE_FADE_IN_FRAME_MS
						);
						if (Math.abs(m.color[3] - base * fade) > 1e-5) {
							mismatches.push(`${name}@${tick}#${j} time-based alpha: ${m.color[3]} vs ${base * fade}`);
						}
						if (Math.abs(l.color[3] - m.color[3]) > 1e-5) {
							alphaDiffs++;
						}
						l = { ...l, color: [l.color[0], l.color[1], l.color[2], m.color[3]] };
					}
					for (const d of diffEffectRecord(l, m)) {
						mismatches.push(`${name}@${tick}#${j} ${d}`);
					}
				});
			}
		});
	} finally {
		stop();
	}
	return { records, mismatches, perEffect, layers, alphaDiffs };
}

describe.each(['spirit', 'warlock'])('%s sphere record-diff (legacy vs render-records)', kind => {
	it('reproduces every legacy sphere record field by field at 60 fps (#57 fade identical)', async () => {
		const { records, mismatches, perEffect, layers } = await runScene(kind);
		expect(mismatches).toEqual([]);
		// every non-empty spawn is compared, every layer branch is hit
		const drawn = KINDS[kind].spawns.filter(s => (s.num ?? s.spheres?.length ?? 0) > 0).map(s => s.name);
		expect(Object.keys(perEffect).sort()).toEqual(drawn.sort());
		expect(layers).toEqual(new Set(Object.keys(SPHERE_LAYERS)));
		expect(records).toBeGreaterThan(300);
	});

	it('#57 divergence: on irregular frames only the fade alpha differs, and it follows elapsed time', async () => {
		const legacyOnly = await runScene(kind, {}, { ticks: SPHERE_TICKS });
		expect(legacyOnly.mismatches.length).toBeGreaterThan(0);
		expect(legacyOnly.mismatches.filter(m => !/#\d+ color: /.test(m))).toEqual([]);
		const { mismatches, alphaDiffs, records } = await runScene(kind, {}, { ticks: SPHERE_TICKS, timeFade: true });
		expect(mismatches).toEqual([]);
		expect(alphaDiffs).toBeGreaterThan(0);
		expect(records).toBeGreaterThan(50);
	});

	it('flags a wrong camera pitch (mutation guard)', async () => {
		const { mismatches } = await runScene(kind, { cameraAngle: ([pitch, yaw]) => [pitch + 1, yaw] });
		expect(mismatches.some(m => m.includes('params.textureRotation'))).toBe(true);
	});
});

describe('sphere orbit', () => {
	it('slot 0 at tick 0 is the identity orbit; slots are 72° apart', () => {
		const orbit = sphereOrbit(0, [90, 0]);
		expect(orbit[0].rotation).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
		expect(orbit[1].rotation[0]).toBeCloseTo(Math.cos((72 * Math.PI) / 180));
	});
});
