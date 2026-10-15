/**
 * Drift guard: this backend keeps a structural copy of render-records' record
 * shapes and run key (test/support/records.js, src/batching/runs.js) so it can
 * build on its own. This test fails as soon as the copy and the source disagree.
 *
 * `batchKey` is backend-local (gpu-webgl2 draw batching, not part of the
 * record contract): pipelineKey minus the sprite texture class, plus the GL
 * program of effect records (STR vs the sprite program of 2D/3D). Equal
 * batchKeys never join records whose kind, blend pair, depth test, depth write
 * or STR attachment differ; a sprite batch is a union of whole render-records
 * runs, an effect batch a contiguous part of one (split where the program changes).
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

	it('batchKey never joins different GL state: it drops the sprite texture class and adds the effect program', () => {
		const variants = [];
		const familiesOf = kind => (kind === 'effect' ? ['str', '3d', '2d', 'cylinder'] : [undefined]);
		for (const kind of ['sprite', 'effect']) {
			for (const family of familiesOf(kind)) {
				for (const blend of [BLEND_NORMAL, BLEND_ADDITIVE, blendFromStr(5, 2)]) {
					for (const depthTest of [true, false]) {
						for (const depthWrite of [true, false]) {
							for (const textureClass of ['indexed', 'rgba', undefined]) {
								for (const strAttachment of [true, false]) {
									variants.push({ kind, family, blend, depthTest, depthWrite, textureClass, strAttachment });
								}
							}
						}
					}
				}
			}
		}
		const state = r => [r.kind, source.pipelineKey({ ...r, textureClass: undefined })].join('|');
		const program = r => (r.kind === 'effect' ? local.effectProgram(r) : 'sprite');
		for (const a of variants) {
			for (const b of variants) {
				if (local.batchKey(a) === local.batchKey(b)) {
					// Same GL pipeline state (blend, depth test/write, STR attachment, kind) and program.
					expect(state(a)).toBe(state(b));
					expect(program(a)).toBe(program(b));
					if (a.kind !== 'sprite') {
						expect(source.pipelineKey(a)).toBe(source.pipelineKey(b));
					}
				}
				if (source.pipelineKey(a) === source.pipelineKey(b) && program(a) === program(b)) {
					expect(local.batchKey(a)).toBe(local.batchKey(b));
				}
			}
			if (a.kind === 'sprite') {
				expect(local.batchKey(a, { mixTextureClasses: false })).toBe(source.pipelineKey(a));
			} else {
				expect(local.batchKey(a, { mixTextureClasses: false }).startsWith(source.pipelineKey(a))).toBe(true);
			}
		}
	});

	it('effect batches split a render-records run where the drawing program changes (order kept)', () => {
		const str = { kind: 'effect', family: 'str', blend: BLEND_NORMAL, depthTest: true, depthWrite: false };
		const threeD = { ...str, family: '3d', params: { palette: null } };
		const twoD = { ...str, family: '2d', params: { palette: 'pal' } };
		const stream = [str, str, threeD, twoD, str];
		expect(source.splitRuns(stream).map(r => [r.start, r.count])).toEqual([[0, 5]]);
		expect(local.splitBatches(stream).map(b => [b.start, b.count])).toEqual([
			[0, 2],
			[2, 2],
			[4, 1]
		]);
		// Split-class fallback: the sprite program binds one class set per run.
		expect(local.splitBatches(stream, { mixTextureClasses: false }).map(b => [b.start, b.count])).toEqual([
			[0, 2],
			[2, 1],
			[3, 1],
			[4, 1]
		]);
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
		const span = list => list.map(r => [r.start, r.count]);
		expect(span(local.splitBatches(stream, { mixTextureClasses: false }))).toEqual(span(source.splitRuns(stream)));
	});

	it('fixture blend constants and sprite fields match the source shapes', () => {
		expect(fixtures.NORMAL).toEqual(BLEND_NORMAL);
		expect(fixtures.ADDITIVE).toEqual(BLEND_ADDITIVE);
		const missing = Object.keys(fixtures.sprite()).filter(k => !(k in SPRITE_DEFAULTS) && k !== 'kind');
		expect(missing).toEqual([]);
	});
});
