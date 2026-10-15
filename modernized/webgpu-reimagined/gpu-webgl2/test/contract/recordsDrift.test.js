/**
 * Drift guard: this backend keeps a structural copy of render-records' record
 * shapes and run key (test/support/records.js, src/batching/runs.js) so it can
 * build on its own. This test fails as soon as the copy and the source disagree.
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

	it('fixture blend constants and sprite fields match the source shapes', () => {
		expect(fixtures.NORMAL).toEqual(BLEND_NORMAL);
		expect(fixtures.ADDITIVE).toEqual(BLEND_ADDITIVE);
		const missing = Object.keys(fixtures.sprite()).filter(k => !(k in SPRITE_DEFAULTS) && k !== 'kind');
		expect(missing).toEqual([]);
	});
});
