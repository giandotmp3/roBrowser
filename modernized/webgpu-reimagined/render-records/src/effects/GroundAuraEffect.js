import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_ADDITIVE } from '../records/blend.js';
import { auraFrameDelta, effectPass } from './rules.js';

/** Game tick of the aura pulse (ms). */
export const AURA_GAME_TICK_MS = 25;

/** Largest frame delta the pulse integrates (ms). */
export const AURA_MAX_FRAME_DT = 250;

/** Lift of the ground aura above the cell height (avoids z-fighting). */
export const GROUND_AURA_LIFT = 0.05;

/** Ring colour of the ground aura (white, alpha 0.8). */
export const GROUND_AURA_COLOR = Object.freeze([1.0, 1.0, 1.0, 0.8]);

/** Vertex count of the flat ground quad. */
export const GROUND_AURA_VERTEX_COUNT = 6;

/**
 * Flat ground quad (x, y 0, z, u, v), unit size −0.5..0.5; the shader scales it by size
 * and rotates it by angle. Shared by every instance.
 */
export const GROUND_AURA_QUAD = Object.freeze([
	-0.5, 0.0, -0.5, 0.0, 0.0, 0.5, 0.0, -0.5, 1.0, 0.0, -0.5, 0.0, 0.5, 0.0, 1.0, 0.5, 0.0, -0.5, 1.0, 0.0, 0.5, 0.0,
	0.5, 1.0, 1.0, -0.5, 0.0, 0.5, 0.0, 1.0
]);

/**
 * Size change of one ring per game tick (port of legacy calculateSize). Like legacy, the
 * angles are degrees handed to Math.sin / Math.cos (which take radians); parity is kept.
 *
 * @param {number} distance ring distance (15)
 * @param {number} riseAngle ring rise angle (legacy degrees)
 * @param {number} auraAngle ring angle (ring · 23)
 * @returns {[number, number]} [width, height] modifiers
 */
export function groundAuraSizeStep(distance, riseAngle, auraAngle) {
	const wrap = a => (a >= 360 ? a - 360 : a);
	const reach = distance * 0.8 + distance * 0.1 * (Math.sin(riseAngle) + 1);
	const a1 = wrap(auraAngle + 90);
	const a2 = wrap(a1 + 90);
	const a3 = wrap(a2 + 90);
	const startX = Math.cos(auraAngle) * reach;
	const endX = Math.cos(a1) * reach;
	const startY = Math.sin(a2) * reach;
	const endY = Math.sin(a3) * reach;
	return [Math.abs(endX - startX), Math.abs(endY - startY)];
}

/**
 * @typedef {Object} GroundAuraParams  EffectDraw.params of family 'groundAura'
 * @property {number} ring          0 inner, 1 outer
 * @property {[number, number]} size  quad size in SpriteRenderer units (shader converts)
 * @property {number} angle         radians (ring · 23°)
 * @property {number} zIndex        1 + ring
 * @property {number} vertexCount
 */

/**
 * EF_LEVEL99_2 ground ring (EffectTable 201, R-EFX-015): two flat pulsing quads on the
 * ground under the owner. Replaces legacy Renderer/Effects/GroundAura.js; draws one
 * EffectDraw per ring per frame.
 *
 * Additive (R-EFX-014), depth test without write, before entities, scene fog. The
 * pulse integrates whole 25 ms game ticks of the frame delta, clamped to [0, 250] ms
 * (discrepancy #55 fix: a frame before the start tick does not run the pulse backwards, see
 * auraFrameDelta). position is the
 * uploaded uWorldPosition: the followed (x, y) and the terrain height under it + 0.05.
 */
export class GroundAuraEffect {
	/**
	 * @param {Object} spec
	 * @param {number} spec.size       100 for EF_LEVEL99_2
	 * @param {number} spec.distance   15 for EF_LEVEL99_2
	 * @param {string} spec.textureName  under data/texture/effect/
	 * @param {Object} inst
	 * @param {ArrayLike<number>} inst.position
	 * @param {number} inst.startTick
	 * @param {{position: ArrayLike<number>}} [inst.follow]  entity followed every frame
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 */
	constructor({ size, distance, textureName }, inst) {
		this.position = [inst.position[0], inst.position[1], inst.position[2]];
		this.follow = inst.follow ?? null;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, true);
		this.texture = `data/texture/effect/${textureName}`;
		this.size = size;
		const min = size + distance;
		const max = size + distance * 2;
		this.rings = [
			{ riseAngle: 0, direction: 1, size: [min, min], initialSize: [min, min] },
			{ riseAngle: 0, direction: -1, size: [max, max], initialSize: [max, max] }
		];
		this.ringDistance = 15.0;
		this.lastTick = inst.startTick;
		this.accum = 0;
	}

	/**
	 * Integrate the pulse up to a tick.
	 * @param {number} tick
	 */
	advance(tick) {
		const dt = auraFrameDelta(tick, this.lastTick, AURA_MAX_FRAME_DT);
		if (dt === null) {
			return;
		}
		this.lastTick = tick;
		this.accum += dt;
		while (this.accum >= AURA_GAME_TICK_MS) {
			this.accum -= AURA_GAME_TICK_MS;
			this.rings.forEach((ring, i) => {
				ring.riseAngle += 3;
				if (ring.riseAngle && !(ring.riseAngle % 180)) {
					ring.direction *= -1;
					// keeps the ring from drifting larger or smaller over time
					if (
						(ring.direction < 0 && ring.size[0] < ring.initialSize[0]) ||
						(ring.direction > 0 && ring.size[0] > ring.initialSize[0])
					) {
						ring.size[0] = ring.initialSize[0];
						ring.size[1] = ring.initialSize[1];
					}
				}
				if (ring.riseAngle >= 360) {
					ring.riseAngle -= 360;
				}
				const [w, h] = groundAuraSizeStep(this.ringDistance, ring.riseAngle, i * 23);
				ring.size[0] += (w * ring.direction) / (this.size / 2);
				ring.size[1] += (h * ring.direction) / (this.size / 2);
			});
		}
	}

	/**
	 * The records of one frame (one per ring).
	 * @param {number} tick
	 * @param {Object} frameState
	 * @param {(x: number, y: number) => number} frameState.heightAt  terrain cell height
	 * @param {{use: boolean}} [frameState.sceneFog]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]  also appended to, when given
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>[]}
	 */
	frame(tick, { heightAt, sceneFog }, stream) {
		this.advance(tick);
		const source = this.follow ? this.follow.position : this.position;
		const position = [source[0], source[1], heightAt(source[0], source[1]) + GROUND_AURA_LIFT];
		return this.rings.map((ring, i) => {
			/** @type {GroundAuraParams} */
			const params = {
				ring: i,
				size: [ring.size[0], ring.size[1]],
				angle: (i * 23 * Math.PI) / 180,
				zIndex: 1 + i,
				vertexCount: GROUND_AURA_VERTEX_COUNT
			};
			const record = createEffectDraw({
				family: 'groundAura',
				pass: this.pass,
				texture: this.texture,
				position: position.slice(),
				color: GROUND_AURA_COLOR.slice(),
				blend: BLEND_ADDITIVE,
				depthTest: true,
				depthWrite: false,
				depthCorrection: false,
				fog: Boolean(sceneFog && sceneFog.use),
				params
			});
			stream?.effect(record);
			return record;
		});
	}
}
