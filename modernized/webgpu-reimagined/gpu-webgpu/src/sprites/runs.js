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
 * every sprite batch is a union of whole, contiguous render-records runs.
 *
 * Effect records also carry the WGSL program that draws their family
 * (`effectProgram`, same rule as gpu-webgl2): recordRunKey has no family, so one
 * render-records run may hold, say, an STR layer and a 3D effect with the same
 * blend and depth state, which two different pipelines draw. Such a run is split
 * at the program change (contiguous sub-runs, order kept). An effect batch is
 * therefore a contiguous part of one render-records run. Still never regroups or
 * reorders.
 */

import { SPRITE_EFFECT_FAMILIES } from '../effects/spriteEffect.js';
import { meshProgramKey } from '../effects/mesh/meshFamilies.js';

/**
 * Backend-internal marker of an R-CTX-010 world step (`{kind: 'worldStep', step}`): WebGpuBackend
 * puts one at the stream position of each world step, and the batch it forms (its own batch key,
 * one per step) is encoded by MapWorld (`programOf` 'world'). Never part of a record stream.
 */
export const WORLD_STEP_KIND = 'worldStep';

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
 * Backend-local batching key. For sprites a coarsening of recordRunKey (the texture
 * class dropped; with `mixTextureClasses` false, the device cannot bind both array
 * sets in one fragment stage, see SpriteRunRenderer, it equals recordRunKey). For
 * effects recordRunKey plus the drawing program (and, in the split fallback, the
 * texture class of sprite-program effects). Same keys as gpu-webgl2's batchKey.
 * @param {{kind: string, family?: string, params?: {palette?: unknown}, blend: {src: string, dst: string}, depthTest: boolean, depthWrite: boolean, textureClass?: string, strAttachment?: boolean}} record
 * @param {{mixTextureClasses?: boolean}} [options]
 * @returns {string}
 */
export function batchKey(record, { mixTextureClasses = true } = {}) {
	if (record.kind === WORLD_STEP_KIND) {
		return `${WORLD_STEP_KIND}:${record.step}`;
	}
	if (record.kind === 'effect') {
		const program = effectProgram(record);
		// Split-class fallback: a sprite-program batch binds one texture class set.
		const textureClass =
			program === 'sprite' && !mixTextureClasses
				? `:${(record.params?.palette ?? null) !== null ? 'indexed' : 'rgba'}`
				: '';
		return `${recordRunKey(record)}:${program}${textureClass}`;
	}
	if (record.kind !== 'sprite' || !mixTextureClasses) {
		return recordRunKey(record);
	}
	return recordRunKey({ ...record, textureClass: undefined });
}

/**
 * The WGSL program that draws an effect record: 'sprite' for the 2D/3D families
 * (SpriteRenderer draws in legacy), `mesh:<program>:<wrap>:<mesh>` for the mesh families
 * (MeshEffectPipeline: the program plus the sampler wrap and static mesh a batch must
 * share), otherwise the family itself ('str', ...). Same keys as gpu-webgl2.
 * @param {{family?: string, params?: Record<string, any>}} record
 * @returns {string}
 */
export function effectProgram(record) {
	if (SPRITE_EFFECT_FAMILIES.includes(/** @type {string} */ (record.family))) {
		return 'sprite';
	}
	return meshProgramKey(record) ?? String(record.family);
}

/**
 * Program of a batch head: 'sprite' (sprites and 2D/3D effects), 'str', 'mesh' (the
 * mesh effect families: cylinder, quadhorn, RSM, auras, spheres, tiles, rings, target
 * markers, waterfall, rain puddles), 'world' (a world-step marker, WORLD_STEP_KIND), or
 * null (a family without a renderer here).
 * @param {{kind: string, family?: string, params?: Record<string, any>}} record
 * @returns {'sprite'|'str'|'mesh'|'world'|null}
 */
export function programOf(record) {
	if (record.kind === WORLD_STEP_KIND) {
		return 'world';
	}
	if (record.kind === 'sprite') {
		return 'sprite';
	}
	if (record.kind === 'effect') {
		const program = effectProgram(record);
		if (program.startsWith('mesh:')) {
			return 'mesh';
		}
		return program === 'sprite' || program === 'str' ? program : null;
	}
	return null;
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
 * Contiguous draw batches by `batchKey` (what RunRenderer / SpriteRunRenderer draw as one call).
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
