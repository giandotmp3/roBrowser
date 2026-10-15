/**
 * Phase 2 record-diff of render-records' CylinderEffect (EffectTable 'CYLINDER',
 * R-EFX-003/011) against legacy Renderer/Effects/Cylinder.js.
 *
 * The real legacy Cylinder runs the synthetic entries of support/cylinderQuadHornScene.js
 * the way EffectManager drives it (beforeRender, init when needed, render when ready,
 * free + remove on needCleanUp, afterRender); its native records are collected through
 * Cylinder.addRecordSink. render-records' CylinderEffect gets the same entries, instance
 * parameters, followed entity, camera angles, scene fog and seeded randomness (legacy
 * Math.random is patched with the same seed and consumed in the same order). Both
 * streams are diffed per effect and per tick, field by field (tolerance 1e-5, relative
 * above 1), and the instances must finish on the same tick.
 *
 * Declared divergences: none. R-EFX-011 (FLAG) is normalised into the unified blend enum
 * with the same visual result, so blend states compare equal.
 *
 * Not diffed: an entry whose texture never loads. Legacy never draws it (EffectManager's
 * ready gate); render-records emits its record and leaves residency to the backend.
 * Not a record field: legacy's per-instance mesh buffer is never deleted on free; the
 * rebuild shares one mesh per (totalCircleSides, circleSides, repeatTextureX) key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const camera = vi.hoisted(() => ({ angle: [240, 0] }));

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
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: { runWithDepth: (_t, _m, _c, fn) => fn() }
}));

import Cylinder from 'Renderer/Effects/Cylinder.js';
import { CylinderEffect, cylinderMesh } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	CYLINDER_SPAWNS,
	TICKS,
	cameraAngleAt,
	fogAt,
	makeOwner,
	moveOwner,
	renderLegacyFrame,
	spawnLegacy
} from './support/cylinderQuadHornScene.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';

const gl = new Proxy({}, { get: (_t, k) => (/^[A-Z_0-9]+$/.test(String(k)) ? k : () => ({})) });

let restore = null;
afterEach(() => {
	restore?.();
	restore = null;
});

/**
 * Run legacy and render-records side by side over the scripted ticks.
 * @param {number} seed
 */
function runScene(seed) {
	Cylinder.init(gl);
	const legacyOwner = makeOwner();
	const owner = makeOwner();
	({ restore } = installDeterminism({ rng: new SeededRng(seed) }));
	const live = spawnLegacy(Cylinder, CYLINDER_SPAWNS, legacyOwner);
	restore();
	restore = null;

	const rng = new SeededRng(seed).fn;
	const rebuilt = live.map(({ spawn, inst }) => ({
		name: spawn.name,
		skip: spawn.effect.textureName.includes('missing'),
		effect: new CylinderEffect(spawn.effect, { ...inst, follow: spawn.attached ? owner : null }, { rng })
	}));

	const mismatches = [];
	const perEffect = {};
	let records = 0;
	let sink = [];
	const stop = Cylinder.addRecordSink(r => sink.push(r));
	try {
		TICKS.forEach((tick, i) => {
			moveOwner(legacyOwner, tick);
			moveOwner(owner, tick);
			camera.angle = cameraAngleAt(tick);
			const fog = fogAt(i);
			const legacy = {};
			renderLegacyFrame(gl, Cylinder, live, tick, fog, ({ name }, _t, drawn) => {
				expect(sink).toHaveLength(drawn ? 1 : 0);
				legacy[name] = sink[0] ?? null;
				sink = [];
			});
			const alive = new Set(live.map(e => e.name));
			const compared = new Set();
			for (const entry of rebuilt) {
				if (entry.done || entry.skip) {
					continue;
				}
				const m = entry.effect.frame(tick, { camera, sceneFog: { use: !!(fog.use && fog.exist) } });
				entry.done = entry.effect.finished;
				compared.add(entry.name);
				if (!legacy[entry.name]) {
					mismatches.push(`${entry.name}@${tick}: only render-records drew`);
					continue;
				}
				records++;
				perEffect[entry.name] = (perEffect[entry.name] ?? 0) + 1;
				for (const d of diffEffectRecord(legacy[entry.name], m)) {
					mismatches.push(`${entry.name}@${tick} ${d}`);
				}
				if (alive.has(entry.name) === entry.done) {
					mismatches.push(`${entry.name}@${tick}: legacy alive ${alive.has(entry.name)}, finished ${entry.done}`);
				}
			}
			for (const [name, record] of Object.entries(legacy)) {
				if (record && !compared.has(name)) {
					mismatches.push(`${name}@${tick}: only legacy drew`);
				}
			}
		});
	} finally {
		stop();
	}
	return { records, mismatches, perEffect, rebuilt };
}

describe('Cylinder record-diff (legacy vs render-records)', () => {
	it('reproduces every legacy cylinder record field by field', () => {
		const { records, mismatches, perEffect } = runScene(0xc11);
		expect(mismatches).toEqual([]);
		// every drawable entry is compared (the missing texture is never drawn)
		expect(Object.keys(perEffect).sort()).toEqual(
			CYLINDER_SPAWNS.map(s => s.name)
				.filter(n => n !== 'missing-texture')
				.sort()
		);
		expect(records).toBeGreaterThan(100);
	});

	it('is deterministic per seed (random angles consumed in legacy order)', () => {
		const a = runScene(1);
		const b = runScene(2);
		expect(a.mismatches).toEqual([]);
		expect(b.mismatches).toEqual([]);
		const angle = run => run.rebuilt.find(e => e.name === 'fixed-perspective').effect.angleY;
		expect(angle(a)).not.toBe(angle(b));
	});

	it('shares one mesh per key, identical to the legacy per-instance vertices', () => {
		Cylinder.init(gl);
		const owner = makeOwner();
		({ restore } = installDeterminism({ rng: new SeededRng(3) }));
		const live = spawnLegacy(Cylinder, CYLINDER_SPAWNS, owner);
		for (const { effect } of live) {
			effect.init(gl);
			const mesh = cylinderMesh(effect.totalCircleSides, effect.circleSides, effect.repeatTextureX);
			expect(Array.from(mesh)).toEqual(Array.from(effect.vertices));
			expect(mesh.length / 5).toBe(effect.verticeCount);
		}
		expect(cylinderMesh(20, 20, 1)).toBe(cylinderMesh(20, 20, 1));
	});

	it('follows the attached entity and flags the mismatch when it does not (mutation guard)', () => {
		const owner = makeOwner();
		const spec = CYLINDER_SPAWNS.find(s => s.name === 'attached-delayed');
		const follow = new CylinderEffect(spec.effect, { ...spec, position: owner.position, follow: owner });
		const still = new CylinderEffect(spec.effect, { ...spec, position: owner.position });
		moveOwner(owner, 2000);
		const a = follow.frame(2000);
		const b = still.frame(2000);
		expect(a.position).toEqual(Array.from(owner.position));
		expect(b.position).not.toEqual(a.position);
	});
});
