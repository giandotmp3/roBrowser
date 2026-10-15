import { createEffectDraw } from '../records/EffectDraw.js';
import { strAttachmentTransform } from '../entity/attachments.js';
import { interpolateStrLayer, strKeyIndex } from './rules.js';
import { strLayerDrawFields } from './strDraw.js';

/** R-EFX-009 STR quad pivot, sprite pixels. */
export const STR_PIVOT = Object.freeze([320, 320]);

/**
 * @typedef {Object} StrAttachment  R-SPR-032 effect following an entity
 * @property {{position: number[], xSize: number, ySize: number}} entity
 * @property {number} [xOffset]
 * @property {number} [yOffset]
 *
 * @typedef {Object} StrLayerParams  EffectDraw.params of family 'str'
 * @property {number[]} xy        keyframe quad corners (x0..x3, y0..y3), sprite px, before scale
 * @property {number} scale       R-SPR-032 attachment scale (1 when free)
 * @property {number} angle       degrees
 * @property {number[]} offset    pos − pivot (+ attachment offset), sprite px
 * @property {number} yLower      world units the quad is lowered (0.5, 0 for attachments)
 * @property {number[]} pivot
 * @property {number} clipZBias
 * @property {number} aniframe    interpolated texture frame (texture = textures[aniframe | 0])
 * @property {number} srcBlend    raw D3DBLEND code
 * @property {number} dstBlend    raw D3DBLEND code
 */

/**
 * Build one STR layer EffectDraw from an interpolated frame (R-EFX-007..010, R-SPR-032).
 * @param {ReturnType<typeof interpolateStrLayer>} frame
 * @param {Object} s
 * @param {*} s.texture
 * @param {number[]} s.position
 * @param {StrAttachment|null} s.attachment
 * @param {{use: boolean}} [s.sceneFog]
 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>}
 */
export function strLayerDraw(frame, { texture, position, attachment, sceneFog }) {
	const base = strLayerDrawFields(frame, { position: [...position], attachment: Boolean(attachment), sceneFog });
	let scale = 1;
	let offset = [frame.pos[0] - STR_PIVOT[0], frame.pos[1] - STR_PIVOT[1]];
	if (attachment) {
		const t = strAttachmentTransform({
			xSize: attachment.entity.xSize,
			ySize: attachment.entity.ySize,
			xOffset: attachment.xOffset || 0,
			yOffset: attachment.yOffset || 0
		});
		scale = t.scale;
		// screen Y grows downward in STR space: the Y offset is flipped
		offset = [frame.pos[0] - t.pivot[0] + t.offset[0], frame.pos[1] - t.pivot[1] - t.offset[1]];
	}
	/** @type {StrLayerParams} */
	const params = {
		...base.params,
		xy: [...frame.xy],
		scale,
		angle: frame.angle,
		offset,
		pivot: STR_PIVOT,
		aniframe: frame.aniframe,
		srcBlend: frame.srcalpha,
		dstBlend: frame.destalpha
	};
	return createEffectDraw({ ...base, texture, params });
}

/**
 * Plays one compiled STR file (Loaders/Str.js shape) and emits one EffectDraw per
 * visible layer per frame, in layer order. Replaces legacy Renderer/Effects/StrEffect.
 *
 * - R-EFX-007 key = elapsed/1000·fps, wrapped by maxKey when persistent; finished once
 *   key ≥ maxKey (legacy compares the wrapped key, so a persistent effect only finishes
 *   when maxKey is 0).
 * - A layer draws textures[aniframe | 0]; a missing (not loaded / out of range) texture
 *   draws nothing.
 * - A file whose candidates all failed to load is finished at once (fail()).
 * - R-SPR-032 a persistent attachment reuses each layer's last valid frame on blank keys
 *   and restarts (startTick = tick) when no layer had a fresh frame.
 */
export class StrPlayer {
	/**
	 * @param {Object} s
	 * @param {Object|null} s.str  compiled STR, or null while loading
	 * @param {number} s.startTick
	 * @param {number[]} [s.position]
	 * @param {boolean} [s.persistent]
	 * @param {StrAttachment|null} [s.attachment]
	 * @param {(layer: Object) => ArrayLike<*>} [s.textures]  layer textures (default layer.materials)
	 */
	constructor({ str, startTick, position = [0, 0, 0], persistent = false, attachment = null, textures }) {
		this.str = str;
		this.startTick = startTick;
		this.position = position;
		this.persistent = persistent;
		this.attachment = attachment;
		this.textures = textures ?? (layer => layer.materials ?? []);
		this.finished = false;
		/** @type {Record<number, {frame: Object, texture: *}>} */
		this.lastValid = {};
	}

	/**
	 * The file and every fallback failed to load: the effect is removed without drawing.
	 */
	fail() {
		this.str = null;
		this.finished = true;
	}

	/**
	 * Records for one frame.
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]  also appended to, when given
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>[]}
	 */
	frame(tick, { sceneFog } = {}, stream) {
		const { attachment, str } = this;
		if (attachment && attachment.entity.position) {
			this.position = attachment.entity.position;
		}
		if (!str) {
			return [];
		}
		const key = strKeyIndex(tick - this.startTick, str.fps, str.maxKey, this.persistent);
		const hat = this.persistent && Boolean(attachment);
		const out = [];
		const emit = (frame, texture) =>
			out.push(strLayerDraw(frame, { texture, position: this.position, attachment, sceneFog }));
		let anyFresh = false;

		str.layers.slice(0, str.layernum).forEach((layer, i) => {
			const textures = this.textures(layer);
			if (!textures.length) {
				return;
			}
			const frame = interpolateStrLayer(layer, key);
			if (frame) {
				const texture = textures[frame.aniframe | 0];
				if (texture) {
					emit(frame, texture);
					anyFresh = true;
					if (hat) {
						this.lastValid[i] = { frame, texture };
					}
				}
			} else if (hat && this.lastValid[i]) {
				emit(this.lastValid[i].frame, this.lastValid[i].texture);
			}
		});

		if (hat && !anyFresh && str.maxKey > 0) {
			this.startTick = tick;
			this.lastValid = {};
		}
		if (key >= str.maxKey) {
			this.finished = true;
		}
		if (stream) {
			out.forEach(r => stream.effect(r));
		}
		return out;
	}
}
