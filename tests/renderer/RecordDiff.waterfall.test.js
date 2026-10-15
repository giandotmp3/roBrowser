/**
 * Phase 2 record-diff of render-records' WaterfallEffect (EffectTable 'WATERFALL',
 * R-EFX-014 additive spray) against legacy Renderer/Effects/WaterfallEffect.js.
 *
 * The scripted waterfalls of support/waterfallScene.js run the way EffectManager drives
 * them, with deferred texture loads; native records come from
 * WaterfallEffect.addRecordSink (20 curtain quads + 1 instanced spray per render).
 * render-records' WaterfallEffect gets the same entries, positions, start ticks, scene
 * fog and seeded random sequence (spray seeds, drawn in spawn order); each legacy render
 * is diffed against the matching frame, field by field (tolerance 1e-5, relative above 1),
 * including the model matrix, quad vertices and spray seeds.
 *
 * Not diffed: frames before an effect's texture set is loaded (legacy's ready gate;
 * residency is the backend's job in the rebuild).
 * Declared divergences: none.
 */
import { describe, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() => ({ current: null }));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ attribute: {}, uniform: {} }),
		texture: (_gl, buffer, onload) => onload({ id: buffer.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: { loadFile: (filename, onload) => loader.current.loadFile(filename, onload) }
}));

import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	WATERFALL_SPRAY_CORNERS,
	WaterfallEffect
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { fogAt, makeGl } from './support/weatherScene.js';
import { diffEffectRecord } from './support/effectRecordDiff.js';
import { WATERFALL_FRAMES, WATERFALL_SEED, makeLoader, runLegacyWaterfall } from './support/waterfallScene.js';

async function run(seed, mutate = {}) {
	vi.resetModules();
	const Legacy = (await import('Renderer/Effects/WaterfallEffect.js')).default;
	const rng = new SeededRng(seed).fn;
	const uploads = [];
	const gl = makeGl((name, args) => {
		if (name === 'bufferData' && args[2] === 'STATIC_DRAW') {
			uploads.push(Array.from(args[1]));
		}
	});
	loader.current = makeLoader();
	const modern = new Map();
	let legacy = [];
	const mismatches = [];
	const perEffect = {};
	const stop = Legacy.addRecordSink(r => legacy.push(r));
	const { restore } = installDeterminism({ rng: new SeededRng(seed) });
	try {
		runLegacyWaterfall({
			WaterfallEffect: Legacy,
			gl,
			loader: loader.current,
			onSpawn: (name, _effect, spawn) => {
				const effect = { ...spawn.effect, variant: mutate.variant ?? spawn.effect.variant };
				modern.set(name, new WaterfallEffect(effect, { position: spawn.position, startTick: spawn.startTick }, { rng }));
			},
			onRender: (i, name, tick) => {
				const fog = fogAt(i);
				const mine = modern.get(name).frame(tick, { sceneFog: { use: !!(fog.use && fog.exist) } });
				if (legacy.length !== mine.length) {
					mismatches.push(`${name}@${tick}: ${legacy.length} vs ${mine.length} records`);
				}
				legacy.forEach((l, k) => {
					for (const d of mine[k] ? diffEffectRecord(l, mine[k]) : []) {
						mismatches.push(`${name}@${tick}#${k} ${d}`);
					}
				});
				perEffect[name] = (perEffect[name] ?? 0) + 1;
				legacy = [];
			}
		});
	} finally {
		restore();
		stop();
	}
	return { mismatches, perEffect, uploads, modern };
}

describe('Waterfall record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it('reproduces every legacy waterfall record field by field', async () => {
		const { mismatches, perEffect } = await run(WATERFALL_SEED);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(Object.keys(perEffect).sort()).toEqual(['dark', 'large', 'large-vertical', 'reloaded', 'small', 'small-dark']);
		expect(Object.values(perEffect).reduce((a, b) => a + b, 0)).toBeGreaterThan(40);
		expect(WATERFALL_FRAMES.length).toBeGreaterThan(10);
	});

	it('uploads the legacy spray corners and the render-records seeds', async () => {
		const { uploads, modern } = await run(WATERFALL_SEED);
		expect(uploads[0]).toEqual(Array.from(new Float32Array(WATERFALL_SPRAY_CORNERS)));
		expect(uploads[1]).toEqual(Array.from(modern.get('large').seeds));
	});

	it('fails the diff when the style is wrong (mutation guard)', async () => {
		expect((await run(WATERFALL_SEED, { variant: 'waterfall_small' })).mismatches.length).toBeGreaterThan(20);
	});
});
