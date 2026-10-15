/**
 * Phase 2 record-diff of render-records' QuadHornEffect (EffectTable 'QuadHorn',
 * R-EFX-003/011) against legacy Renderer/Effects/QuadHorn.js.
 *
 * The real legacy QuadHorn runs the synthetic entries of support/cylinderQuadHornScene.js
 * the way EffectManager drives it, and its native records are collected through
 * QuadHorn.addRecordSink. render-records' QuadHornEffect gets the same entries, instance
 * parameters, followed entity, scene fog and seeded randomness ([min, max] ranges consume
 * Math.random in legacy order). Both streams are diffed per effect and per tick, field by
 * field (tolerance 1e-5, relative above 1); instances must finish on the same tick.
 *
 * Declared divergences: none. R-EFX-011 (FLAG) is normalised into the unified blend enum
 * with the same visual result.
 *
 * Not diffed: an entry whose texture never loads (legacy's ready gate; residency is the
 * backend's job in the rebuild).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import QuadHorn from 'Renderer/Effects/QuadHorn.js';
import { QUADHORN_TEXCOORDS, QUADHORN_VERTICES, QuadHornEffect } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	QUADHORN_SPAWNS,
	TICKS,
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
	QuadHorn.init(gl);
	const legacyOwner = makeOwner();
	const owner = makeOwner();
	({ restore } = installDeterminism({ rng: new SeededRng(seed) }));
	const live = spawnLegacy(QuadHorn, QUADHORN_SPAWNS, legacyOwner);
	restore();
	restore = null;

	const rng = new SeededRng(seed).fn;
	const rebuilt = live.map(({ spawn, inst }) => ({
		name: spawn.name,
		skip: spawn.effect.textureFile.includes('missing'),
		effect: new QuadHornEffect(spawn.effect, { ...inst, follow: spawn.attached ? owner : null }, { rng })
	}));

	const mismatches = [];
	const perEffect = {};
	let records = 0;
	let sink = [];
	const stop = QuadHorn.addRecordSink(r => sink.push(r));
	try {
		TICKS.forEach((tick, i) => {
			moveOwner(legacyOwner, tick);
			moveOwner(owner, tick);
			const fog = fogAt(i);
			const legacy = {};
			renderLegacyFrame(gl, QuadHorn, live, tick, fog, ({ name }, _t, drawn) => {
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
				const m = entry.effect.frame(tick, { sceneFog: { use: !!(fog.use && fog.exist) } });
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

describe('QuadHorn record-diff (legacy vs render-records)', () => {
	it('reproduces every legacy QuadHorn record field by field', () => {
		const { records, mismatches, perEffect } = runScene(0x9a4);
		expect(mismatches).toEqual([]);
		// every drawable entry is compared (the missing texture is never drawn)
		expect(Object.keys(perEffect).sort()).toEqual(
			QUADHORN_SPAWNS.map(s => s.name)
				.filter(n => n !== 'missing-texture')
				.sort()
		);
		expect(records).toBeGreaterThan(100);
	});

	it('is deterministic per seed (ranges consumed in legacy order)', () => {
		const a = runScene(1);
		const b = runScene(2);
		expect(a.mismatches).toEqual([]);
		expect(b.mismatches).toEqual([]);
		const height = run => run.rebuilt.find(e => e.name === 'grow-open-ended').effect.height;
		expect(height(a)).not.toBe(height(b));
	});

	it('uses the legacy horn mesh', () => {
		QuadHorn.init(gl);
		const calls = [];
		const logGl = new Proxy(
			{},
			{
				get: (_t, k) =>
					/^[A-Z_0-9]+$/.test(String(k)) ? k : (...args) => (calls.push([k, ...args]), { id: calls.length })
			}
		);
		const [{ effect }] = spawnLegacy(QuadHorn, QUADHORN_SPAWNS.slice(0, 1), makeOwner());
		effect.init(logGl);
		const uploads = calls.filter(c => c[0] === 'bufferData').map(c => Array.from(c[2]));
		expect(uploads).toEqual([Array.from(new Float32Array(QUADHORN_VERTICES)), Array.from(new Float32Array(QUADHORN_TEXCOORDS))]);
	});

	it('follows the attached entity and flags the mismatch when it does not (mutation guard)', () => {
		const owner = makeOwner();
		const spec = QUADHORN_SPAWNS.find(s => s.name === 'attached');
		const follow = new QuadHornEffect(spec.effect, { ...spec, position: owner.position, follow: owner });
		const still = new QuadHornEffect(spec.effect, { ...spec, position: owner.position });
		moveOwner(owner, 2000);
		const a = follow.frame(2000);
		const b = still.frame(2000);
		expect(a.position).toEqual(Array.from(owner.position));
		expect(b.position).not.toEqual(a.position);
	});
});
