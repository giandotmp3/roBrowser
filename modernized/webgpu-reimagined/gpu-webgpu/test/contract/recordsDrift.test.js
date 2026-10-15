/**
 * Drift guard: gpu-webgpu keeps a copy of render-records' run key
 * (src/sprites/runs.js) so it imports no sibling module at runtime. This test
 * fails as soon as the copy and the source disagree.
 *
 * `batchKey` is backend-local (gpu-webgpu draw batching, not part of the record
 * contract, same rule as gpu-webgl2): the run key minus the sprite texture
 * class. It may only coarsen the run key (batchKey ⊆ pipelineKey): equal
 * batchKeys never join records whose kind, blend pair, depth test, depth write
 * or STR attachment differ, so one batch always maps to one GPU pipeline, and
 * every batch is a union of whole render-records runs.
 */
import { describe, expect, it } from 'vitest';
import * as local from '../../src/sprites/runs.js';
import { spriteSpec } from '../../src/sprites/SpriteRunRenderer.js';
import { pipelineSpecKey } from '../../src/pipelines/pipelineKey.js';
import * as source from '../../../render-records/src/records/runs.js';
import { BLEND_ADDITIVE, BLEND_NORMAL, blendFromStr } from '../../../render-records/src/records/blend.js';

const samples = [
	{ kind: 'sprite', blend: BLEND_NORMAL, depthTest: true, depthWrite: true, textureClass: 'indexed' },
	{ kind: 'sprite', blend: BLEND_ADDITIVE, depthTest: true, depthWrite: false, textureClass: 'rgba' },
	{ kind: 'effect', blend: blendFromStr(5, 2), depthTest: true, depthWrite: false, strAttachment: true },
	{ kind: 'effect', blend: BLEND_NORMAL, depthTest: false, depthWrite: false }
];

function variants() {
	const out = [];
	for (const kind of ['sprite', 'effect']) {
		for (const blend of [BLEND_NORMAL, BLEND_ADDITIVE, blendFromStr(5, 2)]) {
			for (const depthTest of [true, false]) {
				for (const depthWrite of [true, false]) {
					for (const textureClass of ['indexed', 'rgba', undefined]) {
						for (const strAttachment of [true, false]) {
							out.push({ kind, blend, depthTest, depthWrite, textureClass, strAttachment });
						}
					}
				}
			}
		}
	}
	return out;
}

describe('records drift guard (gpu-webgpu copy vs render-records)', () => {
	it('recordRunKey matches render-records pipelineKey for every sample', () => {
		samples.forEach(r => expect(local.recordRunKey(r)).toBe(source.pipelineKey(r)));
	});

	it('splitRuns gives identical runs', () => {
		const stream = [samples[0], samples[0], samples[1], samples[2], samples[2], samples[3], samples[0]];
		expect(local.splitRuns(stream)).toEqual(source.splitRuns(stream));
	});

	it('batchKey ⊆ pipelineKey: it only drops the sprite texture class, never blend or depth state', () => {
		const all = variants();
		const state = r => [r.kind, source.pipelineKey({ ...r, textureClass: undefined })].join('|');
		for (const a of all) {
			for (const b of all) {
				if (local.batchKey(a) === local.batchKey(b)) {
					// Same GPU pipeline state: blend, depth test/write, STR attachment and kind.
					expect(state(a)).toBe(state(b));
					if (a.kind !== 'sprite') {
						expect(source.pipelineKey(a)).toBe(source.pipelineKey(b));
					} else {
						expect(pipelineSpecKey(spriteSpec(a))).toBe(pipelineSpecKey(spriteSpec(b)));
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
		const runEnds = new Set(runs.map(r => r.start + r.count));
		batches.forEach(b => {
			expect(runStarts.has(b.start)).toBe(true);
			expect(runEnds.has(b.start + b.count)).toBe(true);
		});
		expect(local.splitBatches(stream, { mixTextureClasses: false })).toEqual(source.splitRuns(stream));
	});
});
