/**
 * Run-length batching in legacy order (architecture §1, critic B1).
 * A new run starts only when pipeline state changes: blend pair, depth
 * write/test, texture class, STR attachment. Never regroups by state.
 *
 * The key format matches render-records' `pipelineKey`, so both backends and
 * the record-diff oracle agree on run boundaries.
 */

/**
 * @param {{kind: string, blend: import('../ports.js').BlendState, depthTest: boolean, depthWrite: boolean, textureClass?: string, strAttachment?: boolean}} record
 * @returns {string}
 */
export function pipelineKey(record) {
	return [
		record.kind,
		`${record.blend?.src}|${record.blend?.dst}`,
		record.depthTest ? 'T' : 't',
		record.depthWrite ? 'W' : 'w',
		record.textureClass ?? '-',
		record.strAttachment ? 'S' : 's'
	].join(':');
}

/**
 * @typedef {Object} Run
 * @property {string} key
 * @property {number} start
 * @property {number} count
 */

/**
 * @param {ReadonlyArray<import('../ports.js').DrawRecord>} records
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
