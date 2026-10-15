/**
 * Run-length batching in legacy order (architecture §1, critic B1). A copy of
 * render-records `records/runs.js` (gpu-webgpu imports no sibling module): a
 * new run starts only when pipeline state changes (blend pair, depth
 * write/test, texture class, STR attachment). Never regroups by state.
 * The key format must stay identical so both backends and the record-diff
 * oracle agree on run boundaries (pinned by test/unit/sprites.test.js).
 */

/**
 * @param {{kind: string, blend: {src: string, dst: string}, depthTest: boolean, depthWrite: boolean, textureClass?: string, strAttachment?: boolean}} record
 * @returns {string}
 */
export function recordRunKey(record) {
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
		const key = recordRunKey(/** @type {any} */ (record));
		const last = runs[runs.length - 1];
		if (last && last.key === key) {
			last.count++;
		} else {
			runs.push({ key, start: index, count: 1 });
		}
	});
	return runs;
}
