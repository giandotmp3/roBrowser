import { SPRITE_EFFECT_FAMILIES } from '../effects/spriteEffect.js';

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
 * imply equal blend/depth state.
 *
 * Effect records also carry the GL program that draws their family
 * (`effectProgram`): pipelineKey has no family, so one render-records run may
 * hold, say, an STR layer and a 3D effect with the same blend and depth state,
 * which two different programs draw. Such a run is split at the family change
 * (contiguous sub-runs, order kept). So a sprite batch is a union of whole
 * pipelineKey runs, and an effect batch is a contiguous part of one. Still never
 * regroups or reorders.
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
 * Backend-local batching key: for sprites a coarsening of pipelineKey (the texture
 * class dropped; with `mixTextureClasses` false, fewer than SPRITE_MIXED_TEXTURE_UNITS
 * fragment texture units, see SpritePipeline, it equals pipelineKey), for effects
 * pipelineKey plus the drawing program (and, in the split fallback, the texture class
 * of sprite-program effects).
 * @param {{kind: string, family?: string, params?: {palette?: unknown}, blend: import('../ports.js').BlendState, depthTest: boolean, depthWrite: boolean, textureClass?: string, strAttachment?: boolean}} record
 * @param {{mixTextureClasses?: boolean}} [options]
 * @returns {string}
 */
export function batchKey(record, { mixTextureClasses = true } = {}) {
	if (record.kind === 'effect') {
		const program = effectProgram(record);
		// Split-class fallback: a sprite-program run binds one texture class set.
		const textureClass =
			program === 'sprite' && !mixTextureClasses
				? `:${(record.params?.palette ?? null) !== null ? 'indexed' : 'rgba'}`
				: '';
		return `${pipelineKey(record)}:${program}${textureClass}`;
	}
	if (record.kind !== 'sprite' || !mixTextureClasses) {
		return pipelineKey(record);
	}
	return pipelineKey({ ...record, textureClass: undefined });
}

/**
 * The GL program family that draws an effect record: 'sprite' for the 2D/3D
 * families, otherwise the family itself ('str', ...).
 * @param {{family?: string}} record
 * @returns {string}
 */
export function effectProgram(record) {
	return SPRITE_EFFECT_FAMILIES.includes(/** @type {string} */ (record.family)) ? 'sprite' : String(record.family);
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
