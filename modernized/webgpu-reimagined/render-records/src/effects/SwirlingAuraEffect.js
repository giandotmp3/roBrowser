import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_ADDITIVE } from '../records/blend.js';
import { effectPass } from './rules.js';

/** Divisions of one band (0..20). */
export const SWIRL_DIVISIONS = 21;

/** Arc swept by one band (degrees). */
export const SWIRL_ARC_DEGREES = 315;

/** Floats per band vertex: x, y, z, u, v. */
export const SWIRL_VERTEX_STRIDE = 5;

/** Band alpha (alphaB 120). */
export const SWIRL_ALPHA = 120 / 255;

const DEG_TO_RAD = Math.PI / 180;
const GAME_TO_WORLD = 0.1 * 2.2;
const INNER_CIRCLE_SCALE = 0.6;
const GAME_TICK_MS = 25;

/**
 * Index list of one band strip: two triangles (base k, top k, base k+1) and
 * (top k, top k+1, base k+1) per division. Shared by every band and instance.
 */
export const SWIRL_INDICES = Object.freeze(
	Array.from({ length: SWIRL_DIVISIONS - 1 }, (_, k) => {
		const i0 = k * 2;
		return [i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2];
	}).flat()
);

/**
 * The three EF_LEVEL99 bands (start rotation, height, ring distance, rise angle, spin).
 * @returns {{initialRotStart: number, maxHeight: number, distance: number, riseAngle: number, spinSpeed: number}[]}
 */
export function swirlingAuraBands() {
	return [0, 1, 2].map(ec => ({
		initialRotStart: ec * 90,
		maxHeight: (15 - 2 * ec) * GAME_TO_WORLD,
		distance: (3.9 + 0.2 * ec) * GAME_TO_WORLD * INNER_CIRCLE_SCALE,
		riseAngle: (55 - 5 * ec) * DEG_TO_RAD,
		spinSpeed: ec + 3
	}));
}

/**
 * Height profile of a band at a game-tick count: max · sin(90° + (i − 10)·9°), scaled by
 * sin(process°) while process ≤ 90 (clamped to [0, max]). Values are float32 like legacy.
 *
 * @param {number} maxHeight
 * @param {number} process elapsed game ticks (may be fractional or negative)
 * @returns {Float32Array}
 */
export function swirlingAuraHeights(maxHeight, process) {
	const out = new Float32Array(SWIRL_DIVISIONS);
	for (let i = 0; i < SWIRL_DIVISIONS; i++) {
		const limit = maxHeight * Math.sin((90 + (i - 10) * 9) * DEG_TO_RAD);
		out[i] = process <= 90 ? Math.max(0, Math.min(limit * Math.sin(process * DEG_TO_RAD), limit)) : limit;
	}
	return out;
}

/**
 * Band mesh in model space: per division a base vertex on the ring (y 0, v 1) and a top
 * vertex pushed out by the rise angle and lifted by the height (v 0).
 *
 * @param {{distance: number, riseAngle: number}} band
 * @param {number} rotStart degrees
 * @param {ArrayLike<number>} heights
 * @returns {number[]} interleaved vertices
 */
export function swirlingAuraMesh(band, rotStart, heights) {
	const step = SWIRL_ARC_DEGREES / (SWIRL_DIVISIONS - 1);
	const cosRise = Math.cos(band.riseAngle);
	const sinRise = Math.sin(band.riseAngle);
	const out = [];
	for (let k = 0; k < SWIRL_DIVISIONS; k++) {
		const angle = (rotStart + k * step) * DEG_TO_RAD;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const baseX = band.distance * cos;
		const baseZ = band.distance * sin;
		const rx = cosRise * heights[k];
		const u = k / (SWIRL_DIVISIONS - 1);
		out.push(baseX, 0, baseZ, u, 1.0, baseX + rx * cos, -sinRise * heights[k], baseZ + rx * sin, u, 0.0);
	}
	return out;
}

/**
 * @typedef {Object} SwirlingAuraParams  EffectDraw.params of family 'swirlingAura'
 * @property {number} band          0..2
 * @property {number} rotStart      degrees
 * @property {number[]} vertices    SWIRL_DIVISIONS·2 vertices (x, y, z, u, v), model space
 * @property {number} indexCount    SWIRL_INDICES.length
 * @property {number} zIndex        0.01 + band · 0.001
 */

/**
 * EF_LEVEL99 swirling bands (EffectTable 200, R-EFX-015): three 315° strips spinning at
 * 3, 4, 5° per game tick and rising over the first 90 game ticks. Replaces legacy
 * Renderer/Effects/SwirlingAura.js; draws one EffectDraw per band per frame.
 *
 * Additive (R-EFX-014), depth test without write, before entities, scene fog. The pose
 * is a pure function of elapsed time. position is the uploaded model translation in
 * legacy GL space: (x + 0.5, −terrain height, y + 0.5) of the followed position.
 * sizeType 7 tints green, anything else blue (EffectTable never passes it).
 */
export class SwirlingAuraEffect {
	/**
	 * @param {Object} spec
	 * @param {string} spec.textureName  under data/texture/effect/
	 * @param {number} [spec.sizeType]   7 green, otherwise blue
	 * @param {Object} inst
	 * @param {ArrayLike<number>} inst.position
	 * @param {number} inst.startTick
	 * @param {{position: ArrayLike<number>}} [inst.follow]  entity followed every frame
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 */
	constructor({ textureName, sizeType }, inst) {
		this.position = [inst.position[0], inst.position[1], inst.position[2]];
		this.follow = inst.follow ?? null;
		this.startTick = inst.startTick;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, true);
		this.texture = `data/texture/effect/${textureName}`;
		const green = (sizeType || 4) === 7;
		this.color = [100 / 255, (green ? 255 : 100) / 255, (green ? 100 : 255) / 255, SWIRL_ALPHA];
		this.bands = swirlingAuraBands();
	}

	/**
	 * The records of one frame (one per band).
	 * @param {number} tick
	 * @param {Object} frameState
	 * @param {(x: number, y: number) => number} frameState.heightAt  terrain cell height
	 * @param {{use: boolean}} [frameState.sceneFog]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]  also appended to, when given
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>[]}
	 */
	frame(tick, { heightAt, sceneFog }, stream) {
		const source = this.follow ? this.follow.position : this.position;
		const position = [source[0] + 0.5, -heightAt(source[0], source[1]), source[1] + 0.5];
		const process = (tick - this.startTick) / GAME_TICK_MS;
		return this.bands.map((band, ec) => {
			const rotStart = (band.initialRotStart + process * band.spinSpeed) % 360;
			/** @type {SwirlingAuraParams} */
			const params = {
				band: ec,
				rotStart,
				vertices: swirlingAuraMesh(band, rotStart, swirlingAuraHeights(band.maxHeight, process)),
				indexCount: SWIRL_INDICES.length,
				zIndex: 0.01 + ec * 0.001
			};
			const record = createEffectDraw({
				family: 'swirlingAura',
				pass: this.pass,
				texture: this.texture,
				position: position.slice(),
				color: this.color.slice(),
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
