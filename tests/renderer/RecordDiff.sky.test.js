/**
 * Phase 2 record-diff of render-records' SkyClouds (R-CTX-009 clear colour, R-MAP-022 sky
 * clouds) against legacy Renderer/Effects/Sky.js.
 *
 * Legacy sky clouds draw only through SpriteRenderer (no record seam needed): native
 * records come from SpriteRenderer.addRecordSink while Sky.render runs; the clear colour
 * is read from gl.clearColor. render-records' SkyClouds gets the same WeatherTable
 * entries, map sequence (no sky, clouds, sky without clouds, a tinted sky, a return after
 * a long gap), player path, wall clock and seeded random sequence. Records are diffed per
 * frame, field by field (tolerance 1e-5, relative above 1); cloud positions accumulate in
 * float32 on both sides.
 *
 * Declared divergences: none.
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	session: { Entity: null },
	camera: { zoom: 2, getLatitude: () => -45 }
}));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ attribute: {}, uniform: {} }),
		texture: (_gl, buffer, onload) => onload({ id: buffer.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: { loadFile: (filename, onload) => onload({ name: filename }) }
}));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));

import { FakeClock } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/FakeClock.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { SkyClouds } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { IDENTITY, PROJECTION, diffSpriteFrame, fogAt, makeGl, playerAt } from './support/weatherScene.js';

/** Map visits: name, ms on the map, frame step, wall-clock gap before arriving. */
const VISITS = [
	{ map: 'prontera.rsw', ms: 1500, step: 300, gap: 0 },
	{ map: 'airplane.rsw', ms: 21000, step: 170, gap: 500 },
	{ map: 'test_nocloud.rsw', ms: 2000, step: 400, gap: 300 },
	{ map: 'thana_boss.rsw', ms: 12000, step: 230, gap: 700 },
	{ map: 'gonryun.rsw', ms: 6000, step: 190, gap: 60000 }
];

async function run(seed, mutate = {}) {
	vi.resetModules();
	const { default: Sky } = await import('Renderer/Effects/Sky.js');
	const { default: SpriteRenderer } = await import('Renderer/SpriteRenderer.js');
	// the fresh WeatherTable instance Sky reads, plus a sky without clouds
	const { default: WeatherTable } = await import('DB/Effects/WeatherEffect.js');
	WeatherTable.sky['test_nocloud.rsw'] = { skyColor: [0.1, 0.2, 0.3, 1.0] };

	const clears = [];
	const gl = makeGl((name, args) => {
		if (name === 'clearColor') {
			clears.push(args);
		}
	});
	const clock = new FakeClock();
	const sky = new SkyClouds({ rng: new SeededRng(seed).fn, now: () => clock.dateNow() + (mutate.clock ?? 0) });
	const { restore } = installDeterminism({ rng: new SeededRng(seed), clock });
	let legacy = [];
	const stop = SpriteRenderer.addRecordSink(r => legacy.push(r));
	const mismatches = [];
	let records = 0;
	let frame = 0;
	try {
		SpriteRenderer.init(gl);
		for (const visit of VISITS) {
			clock.advance(visit.gap);
			mocks.session.Entity = { position: new Float32Array(playerAt(clock.now())) };
			Sky.init(gl, visit.map);
			const init = sky.init(WeatherTable.sky[visit.map]);
			const clear = clears.pop();
			if (JSON.stringify(Array.from(clear)) !== JSON.stringify(init.clearColor)) {
				mismatches.push(`${visit.map} clear ${clear} vs ${init.clearColor}`);
			}
			Sky.setUpCloudData();
			sky.setUp(mocks.session.Entity.position);
			for (let t = 0; t < visit.ms; t += visit.step) {
				clock.advance(visit.step);
				const tick = clock.dateNow();
				mocks.session.Entity = { position: new Float32Array(playerAt(clock.now())) };
				legacy = [];
				Sky.render(gl, IDENTITY, PROJECTION, fogAt(frame), tick);
				const mine = sky.frame(tick, { player: mocks.session.Entity.position });
				records += legacy.length;
				mismatches.push(...diffSpriteFrame(`${visit.map} frame ${frame} @${t}`, legacy, mine, x => x?.id));
				frame++;
			}
		}
	} finally {
		stop();
		restore();
	}
	return { mismatches, records };
}

describe('Sky record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it('reproduces every legacy clear colour and sky cloud record field by field', async () => {
		const { mismatches, records } = await run(0x5c1);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(records).toBeGreaterThan(20000);
	});

	it('is deterministic per seed', async () => {
		expect((await run(3)).mismatches.slice(0, 5)).toEqual([]);
	});

	it('fails the diff when the birth clock is off (mutation guard)', async () => {
		expect((await run(0x5c1, { clock: 40 })).mismatches.length).toBeGreaterThan(100);
	});
});
