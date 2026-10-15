/**
 * Run-length batching in legacy order (architecture §1, critic B1).
 * A new run starts only when pipeline state changes: blend pair, depth
 * write/test, texture class, STR attachment. Never regroups by state.
 *
 * `pipelineKey` and `splitRuns` match render-records exactly, so both backends
 * and the record-diff oracle agree on pipeline-state boundaries
 * (test/contract/recordsDrift.test.js).
 *
 * `batchKey` and `splitBatches` are backend-local: they decide which records
 * gpu-webgl2 draws in one instanced call. batchKey is pipelineKey with the
 * texture class dropped for sprites, because the sprite program binds both the
 * indexed and the RGBA array sets for every run and branches per instance on
 * a class flag (aLayer.w, see instanceLayout.js). Every other field (kind,
 * blend pair, depth test, depth write, STR attachment) is kept verbatim, so a
 * batch never spans records whose GL pipeline state differs: equal batchKeys
 * imply equal blend/depth state, and every batch is a union of whole,
 * contiguous pipelineKey runs. Still never regroups or reorders.
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
 * Backend-local batching key (a coarsening of pipelineKey). With
 * `mixTextureClasses` false (fewer than SPRITE_MIXED_TEXTURE_UNITS fragment
 * texture units, see SpritePipeline) it equals pipelineKey.
 * @param {{kind: string, blend: import('../ports.js').BlendState, depthTest: boolean, depthWrite: boolean, textureClass?: string, strAttachment?: boolean}} record
 * @param {{mixTextureClasses?: boolean}} [options]
 * @returns {string}
 */
export function batchKey(record, { mixTextureClasses = true } = {}) {
	if (record.kind !== 'sprite' || !mixTextureClasses) {
		return pipelineKey(record);
	}
	return pipelineKey({ ...record, textureClass: undefined });
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
	return splitBy(records, pipelineKey);
}

/**
 * Contiguous draw batches by `batchKey` (what RunRenderer draws as one call).
 * @param {ReadonlyArray<import('../ports.js').DrawRecord>} records
 * @param {{mixTextureClasses?: boolean}} [options]
 * @returns {Run[]}
 */
export function splitBatches(records, options) {
	return splitBy(records, record => batchKey(record, options));
}

/**
 * @param {ReadonlyArray<import('../ports.js').DrawRecord>} records
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
