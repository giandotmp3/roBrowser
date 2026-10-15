import { blendKey } from './blend.js';

/**
 * Pipeline-state key. A new run starts only when this changes
 * (architecture §1: blend pair, depth write/test, texture class, STR attachment).
 * @param {{kind: string, blend: import('./blend.js').BlendState, depthTest: boolean, depthWrite: boolean, textureClass?: string, strAttachment?: boolean}} record
 * @returns {string}
 */
export function pipelineKey(record) {
	return [
		record.kind,
		blendKey(record.blend),
		record.depthTest ? 'T' : 't',
		record.depthWrite ? 'W' : 'w',
		record.textureClass ?? '-',
		record.strAttachment ? 'S' : 's'
	].join(':');
}

/**
 * @typedef {Object} Run
 * @property {string} key
 * @property {number} start  Index of the first record in the stream
 * @property {number} count
 */

/**
 * Split an ordered record stream into contiguous runs. Never reorders.
 * @param {ReadonlyArray<object>} records
 * @returns {Run[]}
 */
export function splitRuns(records) {
	/** @type {Run[]} */
	const runs = [];
	records.forEach((record, index) => {
		const key = pipelineKey(/** @type {any} */ (record));
		const last = runs[runs.length - 1];
		if (last && last.key === key) {
			last.count++;
		} else {
			runs.push({ key, start: index, count: 1 });
		}
	});
	return runs;
}
