import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_NORMAL } from '../records/blend.js';
import { identity, rotateY, rotateZ } from '../util/rotation.js';
import { effectPass } from './rules.js';

/** Lock-on marker texture; legacy draws it into its canvas rotated 45° before upload. */
export const LOCK_ON_TEXTURE = 'data/texture/effect/lockon128.tga';
export const MAGIC_TARGET_TEXTURE = 'data/texture/effect/magic_target.tga';

/**
 * Lock-on shade (the shader multiplies green and blue by it): (20 − floor(t/20) % 20) / 20,
 * a red blink every 400 ms. Before the start tick (t < 0) it exceeds 1.
 * @param {number} elapsed ms since the start tick
 */
export function lockOnShade(elapsed) {
	return (20 - (Math.floor(elapsed / 20) % 20)) / 20;
}

/**
 * Lock-on size: (6 − clamp(t / 50, 1, 5)) · 3, shrinking from 15 to 3 between 50 and 250 ms.
 * @param {number} elapsed ms since the start tick
 */
export function lockOnSize(elapsed) {
	return (6 - Math.min(Math.max(elapsed / 50, 1), 5)) * 3;
}

/**
 * Lock-on spin: tick/4 degrees around Y.
 * @param {number} tick
 */
export function lockOnRotation(tick) {
	return rotateY(identity(), (tick / 4 / 180) * Math.PI);
}

/**
 * Magic target spin: 40 degrees per second around Z.
 * @param {number} tick
 */
export function magicTargetRotation(tick) {
	return rotateZ(identity(), (((tick / 1000) * 40) / 180) * Math.PI);
}

/**
 * Area side of a ground-cast marker (legacy MagicTarget CastSize lookup): no row → 1;
 * with a known level (the player's own last cast of this skill) within the row →
 * row[level − 1]; otherwise row[0]; a 0 entry becomes 1.
 * @param {number[]|undefined} sizes  the skill's CastSize row
 * @param {number} [level]  only when the session player cast this skill last
 */
export function castAreaSize(sizes, level) {
	if (!sizes) {
		return 1;
	}
	if (level && sizes.length >= level) {
		return sizes[level - 1] || 1;
	}
	return sizes[0] || 1;
}

/**
 * Shared marker shape: before-entities pass, normal alpha, pass depth state (depth test
 * and write on), scene fog. Finished after the frame where endTick < tick.
 */
class TargetMarker {
	/**
	 * @param {Object} inst
	 * @param {number} inst.endTick
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 */
	constructor(inst) {
		this.endTick = inst.endTick;
		this.finished = false;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, true);
	}

	/**
	 * @param {number} tick
	 * @param {Object} fields family-specific EffectDraw fields
	 * @param {{use: boolean}} [sceneFog]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 */
	emit(tick, fields, sceneFog, stream) {
		const record = createEffectDraw({
			pass: this.pass,
			blend: BLEND_NORMAL,
			depthTest: true,
			depthWrite: true,
			depthCorrection: false,
			fog: Boolean(sceneFog && sceneFog.use),
			...fields
		});
		this.finished = this.endTick < tick;
		stream?.effect(record);
		return record;
	}
}

/**
 * Lock-on marker on a target (legacy Renderer/Effects/LockOnTarget.js).
 */
export class LockOnEffect extends TargetMarker {
	/**
	 * @param {Object} inst
	 * @param {{position: ArrayLike<number>}} inst.follow  target entity
	 * @param {number} inst.startTick
	 * @param {number} inst.endTick
	 */
	constructor(inst) {
		super(inst);
		this.follow = inst.follow;
		this.startTick = inst.startTick;
	}

	/**
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>}
	 */
	frame(tick, { sceneFog } = {}, stream) {
		const elapsed = tick - this.startTick;
		const shade = lockOnShade(elapsed);
		const p = this.follow.position;
		return this.emit(
			tick,
			{
				family: 'lock-on',
				texture: LOCK_ON_TEXTURE,
				position: [p[0], p[1], p[2]],
				color: [1, shade, shade, 1],
				params: { shade, size: lockOnSize(elapsed), rotation: lockOnRotation(tick), vertexCount: 6 }
			},
			sceneFog,
			stream
		);
	}
}

/**
 * Ground-cast area marker (legacy Renderer/Effects/MagicTarget.js): a size × size cell
 * plane over the ground heights around (x, y), built by the world/altitude layer; the
 * record carries the cell, size and camera latitude.
 */
export class MagicTargetEffect extends TargetMarker {
	/**
	 * @param {{sizes?: number[]}} spec  the skill's CastSize row
	 * @param {Object} inst
	 * @param {number} inst.x
	 * @param {number} inst.y
	 * @param {number} inst.endTick
	 * @param {number} [inst.skillLevel]  only when the session player cast this skill last
	 */
	constructor({ sizes }, inst) {
		super(inst);
		this.x = inst.x;
		this.y = inst.y;
		this.size = castAreaSize(sizes, inst.skillLevel);
	}

	/**
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}, cameraLatitude: number}} frameState
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>}
	 */
	frame(tick, { sceneFog, cameraLatitude }, stream) {
		return this.emit(
			tick,
			{
				family: 'magic-target',
				texture: MAGIC_TARGET_TEXTURE,
				position: [this.x, this.y, 0],
				color: [1, 1, 1, 1],
				params: {
					x: this.x,
					y: this.y,
					size: this.size,
					cameraLatitude,
					rotation: magicTargetRotation(tick),
					vertexCount: this.size * this.size * 6
				}
			},
			sceneFog,
			stream
		);
	}
}
