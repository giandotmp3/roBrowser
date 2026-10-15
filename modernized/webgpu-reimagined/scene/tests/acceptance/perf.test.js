import { describe, it, expect } from 'vitest';
import { computeVisibleSet, perfParams } from '../../src/domain/Culling.js';
import { makeEntity, makeScene } from '../support/fakes.js';

describe('R-PERF-001 entity view-area culling', () => {
	const player = { position: [100, 100, 0] };
	const near = makeEntity({ position: [114, 100, 0] });
	const far = makeEntity({ position: [110.1, 110.1, 0] }); // dist^2 = 204.02 > 196

	it('[R-PERF-001] performance mode skips entities beyond viewArea (squared XY)', () => {
		const v = computeVisibleSet([near, far], player, { performanceMode: true, viewArea: 14 });
		expect(v.has(near)).toBe(true);
		expect(v.has(far)).toBe(false);
	});

	it('[R-PERF-001] no culling outside performance mode', () => {
		const v = computeVisibleSet([near, far], player, { performanceMode: false, viewArea: 14 });
		expect(v.size).toBe(2);
	});

	it('[R-PERF-001] decided once per frame: isCulled is stable until the next cull()', () => {
		const { scene, deps } = makeScene();
		deps.settings.performanceMode = true;
		deps.session.Entity = { position: [0, 0, 0] };
		const e = scene.EntityManager.add(makeEntity({ position: [5, 0, 0] }));
		scene.EntityManager.cull();
		e.position = [50, 0, 0];
		expect(scene.EntityManager.isCulled(e)).toBe(false);
		scene.EntityManager.cull();
		expect(scene.EntityManager.isCulled(e)).toBe(true);
	});
});

describe('R-PERF-002 performance-mode reductions', () => {
	it('[R-PERF-002] performance mode parameters', () => {
		expect(perfParams({ performanceMode: true, viewArea: 14 })).toEqual({
			effectCullRadius: 14,
			sortEveryFrames: 6,
			trailMax: 2,
			animatedRsmDivisor: 2,
			bloomScale: 0.125,
			sceneScale: 0.75
		});
	});

	it('[R-PERF-002] normal mode parameters', () => {
		expect(perfParams({ performanceMode: false, viewArea: 14 })).toEqual({
			effectCullRadius: 20,
			sortEveryFrames: 3,
			trailMax: 5,
			animatedRsmDivisor: 1.14,
			bloomScale: 0.25,
			sceneScale: 1
		});
	});
});
