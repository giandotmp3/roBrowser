/**
 * Run-length batching in legacy order (architecture §1, critic B1). A copy of
 * render-records `records/runs.js` (gpu-webgpu imports no sibling module): a
 * new run starts only when pipeline state changes (blend pair, depth
 * write/test, texture class, STR attachment). Never regroups by state.
 * The key format must stay identical so both backends and the record-diff
 * oracle agree on run boundaries (pinned by test/contract/recordsDrift.test.js).
 *
 * `batchKey` and `splitBatches` are backend-local: they decide which records
 * gpu-webgpu draws in one instanced call (same rule as gpu-webgl2). batchKey
 * is the run key with the texture class dropped for sprites, because the one
 * sprite pipeline binds both the indexed and the RGBA array sets plus the
 * palette table in one bind group and branches per instance on the sampling
 * flag (`layer.w`, SPRITE_SAMPLING in instanceLayout.js). Every other field
 * (kind, blend pair, depth test, depth write, STR attachment) is kept
 * verbatim, so a batch never spans records whose GPU pipeline differs, and
 * every batch is a union of whole, contiguous render-records runs. Still
 * never regroups or reorders.
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
 * Backend-local batching key (a coarsening of recordRunKey). With
 * `mixTextureClasses` false (the device cannot bind both array sets in one
 * fragment stage, see SpriteRunRenderer) it equals recordRunKey.
 * @param {{kind: string, blend: {src: string, dst: string}, depthTest: boolean, depthWrite: boolean, textureClass?: string, strAttachment?: boolean}} record
 * @param {{mixTextureClasses?: boolean}} [options]
 * @returns {string}
 */
export function batchKey(record, { mixTextureClasses = true } = {}) {
	if (record.kind !== 'sprite' || !mixTextureClasses) {
		return recordRunKey(record);
	}
	return recordRunKey({ ...record, textureClass: undefined });
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
	return splitBy(records, recordRunKey);
}

/**
 * Contiguous draw batches by `batchKey` (what SpriteRunRenderer draws as one call).
 * @param {ReadonlyArray<object>} records
 * @param {{mixTextureClasses?: boolean}} [options]
 * @returns {Run[]}
 */
export function splitBatches(records, options) {
	return splitBy(records, record => batchKey(record, options));
}

/**
 * @param {ReadonlyArray<object>} records
 * @param {(record: any) => string} keyOf
 * @returns {Run[]}
 */
function splitBy(records, keyOf) {
	/** @type {Run[]} */
	const runs = [];
	records.forEach((record, index) => {
		const key = keyOf(/** @type {any} */ (record));
		const last = runs[runs.length - 1];
		if (last && last.key === key) {
			last.count++;
		} else {
			runs.push({ key, start: index, count: 1 });
		}
	});
	return runs;
}
