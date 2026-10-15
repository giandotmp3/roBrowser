/**
 * Pipeline cache key. One render format and one sample count keep this small
 * (architecture §2.2). Key = shader family, blend pair, depth test/write, topology.
 *
 * @typedef {Object} PipelineSpec
 * @property {string} family        'sprite' | 'str' | 'effect2d' | 'ground' | 'water' | 'model' | ...
 * @property {{src: string, dst: string}} blend
 * @property {boolean} depthTest
 * @property {boolean} depthWrite
 * @property {GPUPrimitiveTopology} [topology]
 */

/** @param {PipelineSpec} s */
export function pipelineSpecKey(s) {
	return [s.family, `${s.blend.src}|${s.blend.dst}`, s.depthTest ? 'T' : 't', s.depthWrite ? 'W' : 'w', s.topology ?? 'triangle-list'].join(':');
}

export const NORMAL = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
export const ADDITIVE = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE' });
