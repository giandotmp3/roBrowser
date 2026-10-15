import { createEffectDraw } from '../records/EffectDraw.js';
import { blendFromEffectMode } from '../records/blend.js';
import { defaultRng } from '../util/injectables.js';
import { effectPass } from './rules.js';

/**
 * QuadHorn mesh: a four-faced pyramid (apex at y 1, base corners at y −1, x/z ±1),
 * 12 vertices. The vertex shader scales x/z by bottomSize and y by height. Shared by
 * every instance (legacy uploads one copy per instance).
 */
export const QUADHORN_VERTICES = Object.freeze([
	0.0, 1.0, 0.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0,

	0.0, 1.0, 0.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0,

	0.0, 1.0, 0.0, 1.0, -1.0, -1.0, -1.0, -1.0, -1.0,

	0.0, 1.0, 0.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0
]);

export const QUADHORN_TEXCOORDS = Object.freeze([
	0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0
]);

export const QUADHORN_VERTEX_COUNT = 12;

/**
 * @typedef {Object} QuadHornParams  EffectDraw.params of family 'quadhorn'
 * @property {'grow'|'move'|'rise'|'emerge'|null} step  running intro animation (1, 2, 3, 4)
 * @property {number} height        animated uHeight
 * @property {number} offsetZ       uOffsetZ of the intro step
 * @property {number|null} sinkOffsetZ  uOffsetZ of the animationOut sink after endTick (wins over offsetZ)
 * @property {number} offsetX
 * @property {number} offsetY
 * @property {number} bottomSize
 * @property {number} rotateX       degrees
 * @property {number} rotateY       degrees
 * @property {number} rotateZ       degrees (the shader's Z rotation adds 180)
 * @property {number} blendMode     GL-order code after `blendMode || 1` (R-EFX-011)
 * @property {number} vertexCount
 */

/**
 * One EffectTable 'QuadHorn' instance (Ice Wall / Earth Spike style horns). Replaces
 * legacy Renderer/Effects/QuadHorn.js; draws one EffectDraw per frame.
 *
 * Legacy defaults kept: blendMode `|| 1` (0 → ZERO), offsetX/Y `?? 0.5` but offsetZ
 * `|| 0.5` (0 → 0.5), height/bottomSize/rotations `|| 0`, animationSpeed `|| 100`.
 * Ranges [min, max] pick min + rng·(max − min) rounded to 3 decimals, in legacy order.
 * QuadHorn sets no depth state; the record describes the before-entities pass it runs
 * in (depth test and write on). Scene fog applies (sceneFog.use = fog.use && fog.exist).
 */
export class QuadHornEffect {
	/**
	 * @param {Object} spec  EffectTable entry
	 * @param {Object} inst
	 * @param {ArrayLike<number>} inst.position
	 * @param {number} inst.startTick
	 * @param {number} inst.endTick   −1 when open-ended
	 * @param {{position: ArrayLike<number>}} [inst.follow]  entity followed every frame (attachedEntity)
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 * @param {{rng?: import('../util/injectables.js').Rng}} [ports]
	 */
	constructor(spec, inst, { rng = defaultRng } = {}) {
		const rand = (min, max) => parseFloat(Math.min(min + rng() * (max - min), max).toFixed(3));
		const pick = v => (v && Array.isArray(v) ? rand(v[0], v[1]) : v);

		this.position = [inst.position[0], inst.position[1], inst.position[2]];
		this.follow = inst.follow ?? null;
		this.startTick = inst.startTick;
		this.endTick = inst.endTick;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, true);
		this.texture = `data/texture/${spec.textureFile}`;
		this.blendMode = spec.blendMode || 1;
		this.blend = blendFromEffectMode(this.blendMode);
		// rng is consumed in legacy order
		this.height = pick(spec.height) || 0.0;
		this.rotateX = pick(spec.rotateX) || 0.0;
		this.rotateY = pick(spec.rotateY) || 0.0;
		this.rotateZ = pick(spec.rotateZ) || 0.0;
		this.offsetX = pick(spec.offsetX) ?? 0.5;
		this.offsetY = pick(spec.offsetY) ?? 0.5;
		this.offsetZ = pick(spec.offsetZ) || 0.5;
		this.bottomSize = pick(spec.bottomSize) || 0.0;
		this.color = spec.color ? spec.color.slice() : [1.0, 1.0, 1.0, 1.0];
		this.baseAlpha = this.color[3];
		this.animation = spec.animation || 0;
		this.animationSpeed = spec.animationSpeed || 100;
		this.animationOut = spec.animationOut || false;
		this.riseDistance = pick(spec.riseDistance) || 0.0;
		this.fadeOut = spec.fadeOut || 0;
		this.introDone = !(spec.animation > 0);
		this.finished = false;
	}

	/**
	 * Intro step of a frame; ends the intro once its target is passed.
	 * @param {number} elapsedSec
	 * @returns {{step: QuadHornParams['step'], height: number, offsetZ: number}}
	 */
	intro(elapsedSec) {
		const out = { step: null, height: this.height, offsetZ: this.offsetZ };
		if (this.introDone) {
			return out;
		}
		const lerp = elapsedSec / (this.animationSpeed / 1000);
		switch (this.animation) {
			case 1:
				out.step = 'grow';
				if (lerp > this.height) {
					this.introDone = true;
				} else {
					out.height = lerp;
				}
				break;
			case 2:
				out.step = 'move';
				if (lerp > this.offsetZ) {
					this.introDone = true;
				} else {
					out.offsetZ = lerp;
				}
				break;
			case 3:
				out.step = 'rise';
				if (lerp > this.height / 2) {
					this.introDone = true;
				} else {
					out.offsetZ = lerp;
				}
				break;
			case 4: {
				out.step = 'emerge';
				const progress = Math.min(lerp, 1.0);
				const eased = 1.0 - (1.0 - progress) * (1.0 - progress);
				if (progress >= 1.0) {
					this.introDone = true;
				}
				out.offsetZ = this.offsetZ - this.riseDistance * (1.0 - eased);
				break;
			}
			default:
		}
		return out;
	}

	/**
	 * The record of one frame (a finished instance still draws its last frame).
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]  also appended to, when given
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>}
	 */
	frame(tick, { sceneFog } = {}, stream) {
		const { step, height, offsetZ } = this.intro((tick - this.startTick) / 1000.0);
		const open = !(this.endTick > 0);
		if (this.fadeOut > 0 && !open) {
			this.color[3] = this.baseAlpha * Math.max(0, Math.min(1, (this.endTick - tick) / this.fadeOut));
		}
		let sinkOffsetZ = null;
		if (!open && this.endTick < tick) {
			if (this.animationOut && this.introDone) {
				// sinks height per animationSpeed ms below the ground, then is removed
				sinkOffsetZ = -(((tick - this.endTick) / 1000.0 / (this.animationSpeed / 1000)) * this.height);
				if (sinkOffsetZ < -(this.height + this.offsetZ)) {
					this.finished = true;
				}
			} else {
				this.finished = true;
			}
		}
		const position = this.follow ? this.follow.position : this.position;
		/** @type {QuadHornParams} */
		const params = {
			step,
			height,
			offsetZ,
			sinkOffsetZ,
			offsetX: this.offsetX,
			offsetY: this.offsetY,
			bottomSize: this.bottomSize,
			rotateX: this.rotateX,
			rotateY: this.rotateY,
			rotateZ: this.rotateZ,
			blendMode: this.blendMode,
			vertexCount: QUADHORN_VERTEX_COUNT
		};
		const record = createEffectDraw({
			family: 'quadhorn',
			pass: this.pass,
			texture: this.texture,
			position: [position[0], position[1], position[2]],
			color: this.color.slice(),
			blend: this.blend,
			depthTest: true,
			depthWrite: true,
			depthCorrection: false,
			fog: Boolean(sceneFog && sceneFog.use),
			params
		});
		stream?.effect(record);
		return record;
	}
}
