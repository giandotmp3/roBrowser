/**
 * Architecture §1: one ordered record stream; backends draw contiguous runs
 * split only on pipeline-state change — never regrouped.
 */
import { describe, expect, it } from 'vitest';
import { BLEND_ADDITIVE, RecordStream, splitRuns } from '../../src/index.js';

describe('architecture contract: run-splitting by pipeline state', () => {
	it('merges consecutive records with identical pipeline state', () => {
		const s = new RecordStream();
		s.sprite({});
		s.sprite({});
		s.sprite({});
		expect(splitRuns(s.records)).toEqual([expect.objectContaining({ start: 0, count: 3 })]);
	});

	it('never regroups: A B A stays three runs in legacy order', () => {
		const s = new RecordStream();
		s.sprite({});
		s.sprite({ blend: BLEND_ADDITIVE });
		s.sprite({});
		const runs = splitRuns(s.records);
		expect(runs.map(r => [r.start, r.count])).toEqual([
			[0, 1],
			[1, 1],
			[2, 1]
		]);
	});

	it('splits on depth write/test, texture class and STR attachment', () => {
		const s = new RecordStream();
		s.sprite({});
		s.sprite({ depthWrite: false });
		s.sprite({ depthWrite: false, depthTest: false });
		s.sprite({ depthWrite: false, depthTest: false, textureClass: 'rgba' });
		s.effect({ strAttachment: false });
		s.effect({ strAttachment: true });
		expect(splitRuns(s.records)).toHaveLength(6);
	});

	it('records are immutable', () => {
		const s = new RecordStream();
		const r = s.sprite({});
		expect(Object.isFrozen(r)).toBe(true);
		expect(Object.isFrozen(s.records)).toBe(true);
	});
});
