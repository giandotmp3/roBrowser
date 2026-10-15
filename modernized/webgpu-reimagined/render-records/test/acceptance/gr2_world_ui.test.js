/**
 * C-14 GR2 pose/anim (R-GR2-003..005), C-05 animated RSM CPU matrices
 * (R-MAP-016/017),
 * and water alpha fix (R-MAP-010). The R-UI-002 life-bar fix is owned by scene.
 */
import { describe, expect, it } from 'vitest';
import {
	advanceModelClock,
	assertBoneCount,
	computeNodeMatrices,
	gr2DrawState,
	gr2FrameState,
	gr2Visible,
	gr2Yaw,
	keyframePosition,
	matrixUpdateBucket,
	poseCacheKey,
	quantisePoseTime,
	resolveAnimLen,
	waterDrawFields,
	waterOpacity
} from '../../src/index.js';

describe('C-14 GR2 skeletal models (record side)', () => {
	it('R-GR2-003: 40 Hz pose quantisation, cache key, clock restarts on action change, 48 bones', () => {
		expect(quantisePoseTime(24)).toBe(0);
		expect(quantisePoseTime(25)).toBe(1);
		expect(quantisePoseTime(1000)).toBe(40);
		expect(poseCacheKey('guildflag90_1.gr2', 0, 3)).toBe('guildflag90_1.gr2|0|3');
		const s = { action: 0, clockStart: 100 };
		expect(advanceModelClock(s, 0, 500)).toBe(s);
		expect(advanceModelClock(s, 5, 500)).toEqual({ action: 5, clockStart: 500 });
		expect(assertBoneCount(48)).toBe(48);
		expect(() => assertBoneCount(49)).toThrow(RangeError);
	});

	it.fails('R-GR2-003 [pending]: GR2 renders one frame behind the entity state (kept parity)', () => {
		const prev = { action: 1 };
		const curr = { action: 2 };
		expect(gr2FrameState(prev, curr)).toBe(prev);
	});

	it('R-GR2-004: yaw = dir·45°; cull by ground anchor with 0.2 NDC margin and entity cull', () => {
		expect(gr2Yaw(3)).toBe(135);
		expect(gr2Visible([1.1, 0], false)).toBe(true);
		expect(gr2Visible([1.3, 0], false)).toBe(false);
		expect(gr2Visible([0, -1.21], false)).toBe(false);
		expect(gr2Visible([0, 0], true)).toBe(false);
	});

	it('R-GR2-005: no removal fade by default; effectColor alpha only; no shadow blob', () => {
		expect(gr2DrawState({ effectColorAlpha: 0.5, removing: false })).toEqual({ visible: true, alpha: 0.5, shadow: false });
		expect(gr2DrawState({ effectColorAlpha: 1, removing: true }).visible).toBe(false);
	});
});

describe('C-05 animated RSM (CPU matrices)', () => {
	it('R-MAP-016: animLen derivation, tick-as-frame, fps/1.14 (perf fps/2) recompute cadence', () => {
		expect(resolveAnimLen(0, [0, 10, 29])).toBe(30);
		expect(resolveAnimLen(500, [0, 10])).toBe(500);
		expect(keyframePosition(1234, 1000)).toBe(234);
		// 30 fps → divisor 26.315…, interval 38 ms
		expect(matrixUpdateBucket(37)).toBe(0);
		expect(matrixUpdateBucket(39)).toBe(1);
		// performance mode → divisor 15, interval 66.67 ms
		expect(matrixUpdateBucket(66, 30, true)).toBe(0);
		expect(matrixUpdateBucket(67, 30, true)).toBe(1);
	});

	it.fails('R-MAP-017 [pending]: single-node identity model yields identity × instance matrix', () => {
		const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
		const model = {
			instances: [identity],
			nodes: [{ name: 'root', parentname: '', pos: [0, 0, 0], rotangle: 0, rotaxis: [0, 1, 0], scale: [1, 1, 1], offset: [0, 0, 0], mat3: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
			box: { center: [0, 0, 0], max: [0, 0, 0] }
		};
		expect([...computeNodeMatrices(model, 0)]).toEqual(identity);
	});
});

describe('flagged-bug fixes shared by both backends', () => {
	it('R-MAP-010 FIX (legacy squared opacity to 0.64): water alpha is the opacity applied once', () => {
		expect(waterOpacity(0)).toBe(0.8);
		expect(waterOpacity(4)).toBe(1.0);
		expect(waterOpacity(6)).toBe(1.0);
		const w = waterDrawFields({ waterType: 0, tick: 0, animSpeed: 3 });
		expect(w.alpha).toBe(0.8);
		expect(w.alpha).not.toBeCloseTo(0.64);
		expect(w).toMatchObject({ depthTest: true, depthWrite: false });
	});
});
