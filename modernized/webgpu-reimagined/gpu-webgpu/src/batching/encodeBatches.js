import { LEGACY_BLEND_CONSTANT, blendConstantFor, resolveBlend, usesBlendConstant } from '../pipelines/blendMap.js';
import { programOf } from '../sprites/runs.js';

/**
 * @typedef {Object} BatchProgram  One WGSL program (or program family) drawing staged batches
 * @property {(pass: GPURenderPassEncoder) => void} bind  Set its vertex buffers (staged for this frame)
 * @property {(head: any) => GPUBindGroup} groupFor      Group 0 for a batch head
 * @property {(head: any) => {pipeline: GPURenderPipeline|null, fellBack: boolean}} pipelineFor
 * @property {(pass: GPURenderPassEncoder, staged: any, batch: {start: number, count: number}) => boolean} [drawBatch]
 *   Encode one batch from its staged value (`firsts` entry); false when it draws nothing.
 *   Without it the batch is `draw(4, count, 0, first)`: instanced 4-vertex strips.
 *
 * @typedef {Object} DirectProgram  A program that sets its own pass state (MapWorld's world steps)
 * @property {(pass: GPURenderPassEncoder, head: any, batch: {start: number, count: number}) => number} encodeDirect
 *   Encode the batch with its own pipelines, bind groups and vertex buffers; returns its draw calls.
 *   The cached pipeline, bind group and vertex-buffer state is invalidated after it.
 */

/**
 * Encode staged batches into `pass` in stream order (never reordered). Rebinds a
 * program's vertex buffers only when the program changes, sets the bind group and the
 * pipeline only when they change, and sets the blend constant as run state for pairs
 * that read it (legacy never calls blendColor: the constant is (0, 0, 0, 0), WebGPU's
 * default at pass begin; `blendConstantFor` splats alpha for CONSTANT_ALPHA pairs).
 *
 * @param {GPURenderPassEncoder} pass
 * @param {ReadonlyArray<any>} records
 * @param {ReadonlyArray<{start: number, count: number}>} batches  Every batch of the stream, in order
 * @param {Partial<Record<'sprite'|'str'|'mesh', BatchProgram>> & {world?: DirectProgram}} programs
 * @param {Partial<Record<'sprite'|'str'|'mesh', any[]>>} firsts  Staged value of each of that program's batches
 *   (first instance for the strip programs, a draw descriptor for `drawBatch` programs)
 * @returns {{drawCalls: number, fallbacks: number, skipped: number}} `skipped`: batches without a program here
 */
export function encodeBatches(pass, records, batches, programs, firsts) {
	const next = { sprite: 0, str: 0, mesh: 0 };
	let bound = null;
	let group = null;
	let pipeline = null;
	let constant = LEGACY_BLEND_CONSTANT;
	let drawCalls = 0;
	let fallbacks = 0;
	let skipped = 0;
	for (const batch of batches) {
		const head = records[batch.start];
		const name = programOf(head);
		const program = name ? programs[name] : undefined;
		if (!program) {
			skipped++;
			continue;
		}
		if ('encodeDirect' in program) {
			drawCalls += program.encodeDirect(pass, head, batch);
			bound = null;
			group = null;
			pipeline = null;
			continue;
		}
		const first = firsts[name][next[name]++];
		if (name !== bound) {
			program.bind(pass);
			bound = name;
		}
		const g = program.groupFor(head);
		if (g !== group) {
			pass.setBindGroup(0, g);
			group = g;
		}
		const blend = resolveBlend(head.blend);
		if (usesBlendConstant(blend)) {
			const wanted = blendConstantFor(blend);
			if (wanted.some((v, i) => v !== constant[i])) {
				pass.setBlendConstant(wanted);
				constant = wanted;
			}
		}
		const result = program.pipelineFor(head);
		if (!result.pipeline) {
			continue;
		}
		if (result.pipeline !== pipeline) {
			pass.setPipeline(result.pipeline);
			pipeline = result.pipeline;
		}
		if (program.drawBatch) {
			if (!program.drawBatch(pass, first, batch)) {
				continue;
			}
		} else {
			pass.draw(4, batch.count, 0, first);
		}
		drawCalls++;
		if (result.fellBack) {
			fallbacks++;
		}
	}
	return { drawCalls, fallbacks, skipped };
}
