/**
 * Phase 2 record-diff of render-records' PropertyGroundEffect / MagicRingEffect against
 * legacy Renderer/Effects/PropertyGround.js and MagicRing.js.
 *
 * The real legacy effects run the synthetic spawns of support/groundRingScene.js the way
 * EffectManager drives them; their native records are collected through addRecordSink.
 * render-records gets the same spawns, spawn numbers, casters, scene fog and seeded
 * randomness (one Math.random per PropertyGround, in spawn order). Both streams are
 * diffed per instance and per tick, field by field (tolerance 1e-5, relative above 1);
 * MagicRing instances must finish on the same tick.
 *
 * Declared divergences: none.
 *
 * Not diffed: a spawn whose texture never loads (legacy's ready gate; residency is the
 * backend's job in the rebuild).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('Utils/WebGL.js', async () => (await import('./support/legacyEffectMocks.js')).webglMock);
vi.mock('Core/Client.js', async () => (await import('./support/legacyEffectMocks.js')).clientMock);

import {
	MagicRingEffect,
	PropertyGroundEffect,
	RING_CONE_VERTEX_COUNT,
	ringConeMesh
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { createLoggingGl, fogAt, renderClassFrame } from './support/legacyEffectMocks.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';
import {
	RING_TICKS,
	makeCaster,
	spawnMagicRings,
	spawnPropertyGrounds,
	updateCasters
} from './support/groundRingScene.js';

const gl = createLoggingGl(null);

let restore = null;
afterEach(() => {
	restore?.();
	restore = null;
});

/**
 * Run legacy and render-records side by side over the scripted ticks.
 * @param {'property'|'ring'} kind
 * @param {number} seed
 * @param {object} [mutate] { slot(k) } render-records-side mutation of the spawn numbers
 */
async function runScene(kind, seed, mutate = {}) {
	vi.resetModules();
	const Ctor = (
		await import(kind === 'property' ? 'Renderer/Effects/PropertyGround.js' : 'Renderer/Effects/MagicRing.js')
	).default;
	const legacyCasters = [0, 1, 2].map(makeCaster);
	const casters = [0, 1, 2].map(makeCaster);
	({ restore } = installDeterminism({ rng: new SeededRng(seed) }));
	const live = kind === 'property' ? spawnPropertyGrounds(Ctor) : spawnMagicRings(Ctor, legacyCasters);
	restore();
	restore = null;

	const rng = new SeededRng(seed).fn;
	const rebuilt = live.map(({ name, spawn }, k) => {
		const spec = {
			topSize: spawn.topSize ?? 2.45,
			bottomSize: spawn.bottomSize ?? 0.8,
			height: spawn.height ?? 2.8,
			texture: spawn.texture
		};
		const effect =
			kind === 'property'
				? new PropertyGroundEffect(
						spec,
						{ position: spawn.position, index: mutate.slot ? mutate.slot(k) : k },
						{ rng }
					)
				: new MagicRingEffect(spec, { follow: casters[spawn.caster], endTick: spawn.endTick });
		return { name, skip: spawn.texture.includes('missing'), effect };
	});

	const mismatches = [];
	const perEffect = {};
	let records = 0;
	let sink = [];
	const stop = Ctor.addRecordSink(r => sink.push(r));
	try {
		RING_TICKS.forEach((tick, i) => {
			updateCasters(legacyCasters, tick);
			updateCasters(casters, tick);
			const fog = fogAt(i);
			const legacy = {};
			renderClassFrame(gl, Ctor, live, tick, fog, ({ name }, _t, drawn) => {
				expect(sink).toHaveLength(drawn ? 1 : 0);
				legacy[name] = sink[0] ?? null;
				sink = [];
			});
			const alive = new Set(live.map(e => e.name));
			for (const entry of rebuilt) {
				if (entry.done || entry.skip) {
					continue;
				}
				const m = entry.effect.frame(tick, { sceneFog: { use: !!(fog.use && fog.exist) } });
				entry.done = Boolean(entry.effect.finished);
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

describe('ground ring record-diff (legacy vs render-records)', () => {
	it('reproduces every legacy PropertyGround record field by field', async () => {
		const { records, mismatches, perEffect } = await runScene('property', 0x7a1);
		expect(mismatches).toEqual([]);
		expect(Object.keys(perEffect)).toHaveLength(16);
		expect(records).toBe(16 * RING_TICKS.length);
	});

	it('reproduces every legacy MagicRing record and finishes on the same tick', async () => {
		const { mismatches, perEffect } = await runScene('ring', 0x7a1);
		expect(mismatches).toEqual([]);
		expect(perEffect).toEqual({ 'ring-long': 12, 'ring-cast-hidden': 7, 'ring-short': 6 });
	});

	it('is deterministic per seed and flags a wrong rotation slot (mutation guard)', async () => {
		expect((await runScene('property', 3)).mismatches).toEqual([]);
		const { mismatches } = await runScene('property', 3, { slot: k => k + 1 });
		expect(mismatches.some(m => m.includes('params.rotation'))).toBe(true);
	});

	it('uses the legacy ring cone mesh', async () => {
		vi.resetModules();
		const PropertyGround = (await import('Renderer/Effects/PropertyGround.js')).default;
		const uploads = [];
		const logGl = createLoggingGl(uploads);
		PropertyGround.init(logGl);
		const data = uploads.find(l => l.startsWith('bufferData '));
		expect(data).toBe(
			`bufferData ARRAY_BUFFER [${Array.from(new Float32Array(ringConeMesh())).join(',')}] STATIC_DRAW`
		);
		expect(ringConeMesh().length / 5).toBe(RING_CONE_VERTEX_COUNT);
	});
});
