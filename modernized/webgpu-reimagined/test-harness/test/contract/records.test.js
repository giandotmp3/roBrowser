/** Harness contract: record model, recorder, diff oracle, run splitting. */
import { describe, it, expect } from 'vitest';
import {
	spriteDraw,
	effectDraw,
	damageDraw,
	normalizeRecord,
	Blend,
	MAP_PASSES
} from '../../src/records/RecordTypes.js';
import { Recorder } from '../../src/records/Recorder.js';
import { diffRecords, formatDiff, toRuns } from '../../src/records/diffRecords.js';
import { HarnessContractError } from '../../src/errors.js';

describe('RecordTypes', () => {
	it('sprite records are frozen, plain-array, with legacy defaults', () => {
		const r = spriteDraw({ position: new Float32Array([1, 2, 3]), size: [10, 20], offset: [0, 0], zIndex: 150 });
		expect(Object.isFrozen(r)).toBe(true);
		expect(Array.isArray(r.position)).toBe(true);
		expect(r.blend).toEqual(Blend.NORMAL);
		expect(r.depth).toEqual({ test: true, write: true, correction: true, ignoreMinCap: false });
		expect(r.xSize).toBe(5);
	});

	it('rejects malformed vectors and unknown blend factors', () => {
		expect(() => spriteDraw({ position: [1, 2] })).toThrow(HarnessContractError);
		expect(() => effectDraw({ family: 'str', blend: { src: 'src-alpha', dst: 'nope' } })).toThrow(
			HarnessContractError
		);
		expect(() => normalizeRecord({ kind: 'bogus' })).toThrow(HarnessContractError);
	});

	it('damage records default to depth test off (R-DMG-009)', () => {
		expect(damageDraw({ damageType: 'normal' }).depth.test).toBe(false);
	});

	it('MAP_PASSES has the 25 passes of R-CTX-010', () => {
		expect(MAP_PASSES).toHaveLength(25);
		expect(MAP_PASSES.indexOf('water')).toBeGreaterThan(MAP_PASSES.indexOf('entities'));
	});
});

describe('Recorder', () => {
	it('groups records into frames with pass markers in order', () => {
		const rec = new Recorder();
		rec.beginFrame(0);
		rec.pass('entities');
		rec.push({ kind: 'sprite', zIndex: 1 });
		rec.beginFrame(16); // implicitly ends the previous frame
		rec.push({ kind: 'sprite', zIndex: 2 });
		rec.endFrame();
		expect(rec.frames.map(f => f.records.map(r => r.kind))).toEqual([['pass', 'sprite'], ['sprite']]);
		expect(rec.lastFrame.tick).toBe(16);
	});
});

describe('diffRecords', () => {
	const a = [spriteDraw({ zIndex: 1, position: [0, 0, 0] }), spriteDraw({ zIndex: 2, position: [1, 0, 0] })];

	it('equal streams within epsilon', () => {
		const b = [spriteDraw({ zIndex: 1, position: [0, 0, 1e-7] }), spriteDraw({ zIndex: 2, position: [1, 0, 0] })];
		expect(diffRecords(a, b).equal).toBe(true);
	});

	it('order is sacred: a swap is a diff', () => {
		const d = diffRecords(a, [a[1], a[0]]);
		expect(d.equal).toBe(false);
		expect(d.diffs.map(x => x.path)).toContain('zIndex');
		expect(formatDiff(d)).toMatch(/zIndex/);
	});

	it('length mismatch, ignore paths and filters', () => {
		expect(diffRecords(a, a.slice(0, 1)).diffs).toEqual([
			{ index: 1, path: '', expected: a[1], actual: undefined }
		]);
		const b = [spriteDraw({ zIndex: 1, position: [0, 0, 0], depthBias: 3 }), a[1]];
		expect(diffRecords(a, b, { ignore: ['depthBias'] }).equal).toBe(true);
		expect(diffRecords(a, [a[0]], { filter: r => r.zIndex === 1 }).equal).toBe(true);
	});
});

describe('toRuns (architecture §1 run-length batching in legacy order)', () => {
	it('starts a new run only on state change and never regroups', () => {
		const n = z => spriteDraw({ zIndex: z, texture: { id: 't', indexed: true } });
		const add = z => spriteDraw({ zIndex: z, blend: Blend.ADDITIVE, texture: { id: 't', indexed: true } });
		const runs = toRuns([n(1), n(2), add(3), n(4), { kind: 'pass', name: 'water' }, n(5)]);
		expect(runs.map(r => r.records.map(x => x.zIndex))).toEqual([[1, 2], [3], [4], [5]]);
	});
});
