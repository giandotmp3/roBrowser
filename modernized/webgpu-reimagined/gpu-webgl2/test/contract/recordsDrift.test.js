/**
 * Drift guard: this backend keeps a structural copy of render-records' record
 * shapes and run key (test/support/records.js, src/batching/runs.js) so it can
 * build on its own. This test fails as soon as the copy and the source disagree.
 *
 * `batchKey` is backend-local (gpu-webgl2 draw batching, not part of the
 * record contract): pipelineKey minus the sprite texture class. It may only
 * coarsen pipelineKey (batchKey ⊆ pipelineKey): equal batchKeys never join
 * records whose kind, blend pair, depth test, depth write or STR attachment
 * differ, and every batch is a union of whole render-records runs.
 */
import { describe, expect, it } from 'vitest';
import * as local from '../../src/batching/runs.js';
import * as fixtures from '../support/records.js';
import * as source from '../../../render-records/src/records/runs.js';
import { BLEND_ADDITIVE, BLEND_NORMAL, blendFromStr } from '../../../render-records/src/records/blend.js';
import { SPRITE_DEFAULTS } from '../../../render-records/src/records/SpriteDraw.js';

const samples = [
	{ kind: 'sprite', blend: BLEND_NORMAL, depthTest: true, depthWrite: true, textureClass: 'indexed' },
	{ kind: 'sprite', blend: BLEND_ADDITIVE, depthTest: true, depthWrite: false, textureClass: 'rgba' },
	{ kind: 'effect', blend: blendFromStr(5, 2), depthTest: true, depthWrite: false, strAttachment: true },
	{ kind: 'effect', blend: BLEND_NORMAL, depthTest: false, depthWrite: false }
];

describe('records drift guard (gpu-webgl2 copy vs render-records)', () => {
	it('pipelineKey matches render-records for every sample', () => {
		samples.forEach(r => expect(local.pipelineKey(r)).toBe(source.pipelineKey(r)));
	});

	it('splitRuns gives identical runs', () => {
		const stream = [samples[0], samples[0], samples[1], samples[2], samples[2], samples[3], samples[0]];
		expect(local.splitRuns(stream)).toEqual(source.splitRuns(stream));
	});

	it('batchKey ⊆ pipelineKey: it only drops the sprite texture class, never blend or depth state', () => {
		const variants = [];
		for (const kind of ['sprite', 'effect']) {
			for (const blend of [BLEND_NORMAL, BLEND_ADDITIVE, blendFromStr(5, 2)]) {
				for (const depthTest of [true, false]) {
					for (const depthWrite of [true, false]) {
						for (const textureClass of ['indexed', 'rgba', undefined]) {
							for (const strAttachment of [true, false]) {
								variants.push({ kind, blend, depthTest, depthWrite, textureClass, strAttachment });
							}
						}
					}
				}
			}
		}
		const state = r => [r.kind, source.pipelineKey({ ...r, textureClass: undefined })].join('|');
		for (const a of variants) {
			for (const b of variants) {
				if (local.batchKey(a) === local.batchKey(b)) {
					// Same GL pipeline state: blend, depth test/write, STR attachment and kind.
					expect(state(a)).toBe(state(b));
					if (a.kind !== 'sprite') {
						expect(source.pipelineKey(a)).toBe(source.pipelineKey(b));
					}
				}
				if (source.pipelineKey(a) === source.pipelineKey(b)) {
					expect(local.batchKey(a)).toBe(local.batchKey(b));
				}
			}
			expect(local.batchKey(a, { mixTextureClasses: false })).toBe(source.pipelineKey(a));
		}
	});

	it('splitBatches only merges whole render-records runs (indexed ↔ RGBA sprites)', () => {
		const rgba = { ...samples[0], textureClass: 'rgba' };
		const stream = [samples[0], rgba, samples[0], samples[1], samples[2], samples[2], samples[3], rgba];
		const runs = source.splitRuns(stream);
		const batches = local.splitBatches(stream);
		expect(batches.map(b => [b.start, b.count])).toEqual([
			[0, 3],
			[3, 1],
			[4, 2],
			[6, 1],
			[7, 1]
		]);
		const runStarts = new Set(runs.map(r => r.start));
		batches.forEach(b => expect(runStarts.has(b.start)).toBe(true));
		expect(local.splitBatches(stream, { mixTextureClasses: false })).toEqual(source.splitRuns(stream));
	});

	it('fixture blend constants and sprite fields match the source shapes', () => {
		expect(fixtures.NORMAL).toEqual(BLEND_NORMAL);
		expect(fixtures.ADDITIVE).toEqual(BLEND_ADDITIVE);
		const missing = Object.keys(fixtures.sprite()).filter(k => !(k in SPRITE_DEFAULTS) && k !== 'kind');
		expect(missing).toEqual([]);
	});
});
