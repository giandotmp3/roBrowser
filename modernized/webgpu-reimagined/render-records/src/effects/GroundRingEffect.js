import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_NORMAL } from '../records/blend.js';
import { defaultRng } from '../util/injectables.js';
import { identity, rotateY } from '../util/rotation.js';
import { effectPass } from './rules.js';

/**
 * Ring cone mesh shared by PropertyGround and MagicRing: 20 sides, each vertex
 * [sin, cos, z (0 bottom, 1 top), u, v] with the top ring offset by half a side.
 * Legacy loops one side too far; the extra iteration adds only bottom[20], top[20],
 * top[20] (a degenerate triangle), so the mesh has 20 · 6 + 3 = 123 vertices.
 * @returns {number[]} interleaved floats (5 per vertex)
 */
export function ringConeMesh() {
	const total = 20;
	const bottom = [];
	const top = [];
	for (let i = 0; i <= total; i++) {
		const a = i / total;
		const b = (i + 0.5) / total;
		bottom[i] = [Math.sin(a * Math.PI * 2), Math.cos(a * Math.PI * 2), 0, a, 1];
		top[i] = [Math.sin(b * Math.PI * 2), Math.cos(b * Math.PI * 2), 1, b, 0];
	}
	const mesh = [];
	for (let i = 0; i <= total; i++) {
		for (const v of [bottom[i], top[i], bottom[i + 1], top[i], bottom[i + 1], top[i + 1]]) {
			if (v) {
				mesh.push(...v);
			}
		}
	}
	return mesh;
}

export const RING_CONE_VERTEX_COUNT = 123;

/** PropertyGround rotation slots (spawn number % 16). */
export const PROPERTY_GROUND_SLOTS = 16;

/**
 * Rotation of a PropertyGround slot: 2π·slot/16 + tick/8 degrees around Y.
 * @param {number} slot
 * @param {number} tick
 * @returns {number[]}
 */
export function propertyGroundRotation(slot, tick) {
	return rotateY(identity(), (slot * 2 * Math.PI) / PROPERTY_GROUND_SLOTS + (tick / 8 / 180) * Math.PI);
}

/**
 * Rotation of every MagicRing: tick/4 degrees around Y.
 * @param {number} tick
 * @returns {number[]}
 */
export function magicRingRotation(tick) {
	return rotateY(identity(), (tick / 4 / 180) * Math.PI);
}

/**
 * Size pulse of a PropertyGround: sin(tick / 360π + phase), floored at 0.5.
 * @param {number} tick
 * @param {number} phase  the instance's random phase in [0, 10)
 */
export function propertyGroundPulse(tick, phase) {
	const sizeMult = Math.sin(tick / (360 * Math.PI) + phase);
	return sizeMult < 0.5 ? 0.5 : sizeMult;
}

/**
 * @typedef {Object} RingConeParams  EffectDraw.params of 'property-ground' / 'magic-ring'
 * @property {number} [sizeMult]    PropertyGround only: the size pulse
 * @property {number} topSize       uTopSize
 * @property {number} bottomSize    uBottomSize
 * @property {number} height        uHeight
 * @property {number} [slot]        PropertyGround only: rotation slot
 * @property {number[]} rotation    uRotationMat
 * @property {number} vertexCount
 */

/**
 * Elemental property cone under a unit (legacy Renderer/Effects/PropertyGround.js):
 * 'data/texture/effect/<texture>.tga', alpha forced to 0.42 by the shader, scene fog,
 * normal alpha, after-entities pass state (depth test and write on). Never finishes on
 * its own.
 */
export class PropertyGroundEffect {
	/**
	 * @param {{topSize: number, bottomSize: number, height: number, texture: string}} spec
	 * @param {Object} inst
	 * @param {ArrayLike<number>} inst.position
	 * @param {number} inst.index  0-based spawn number (legacy module counter)
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 * @param {{rng?: import('../util/injectables.js').Rng}} [ports]
	 */
	constructor({ topSize, bottomSize, height, texture }, inst, { rng = defaultRng } = {}) {
		this.position = [inst.position[0], inst.position[1], inst.position[2]];
		this.topSize = topSize;
		this.bottomSize = bottomSize;
		this.height = height;
		this.texture = `data/texture/effect/${texture}.tga`;
		this.phase = 0 + rng() * 10;
		this.slot = inst.index % PROPERTY_GROUND_SLOTS;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, false);
	}

	/**
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>}
	 */
	frame(tick, { sceneFog } = {}, stream) {
		const sizeMult = propertyGroundPulse(tick, this.phase);
		/** @type {RingConeParams} */
		const params = {
			sizeMult,
			topSize: this.topSize * sizeMult,
			bottomSize: this.bottomSize * sizeMult,
			height: this.height,
			slot: this.slot,
			rotation: propertyGroundRotation(this.slot, tick),
			vertexCount: RING_CONE_VERTEX_COUNT
		};
		const record = createEffectDraw({
			family: 'property-ground',
			pass: this.pass,
			texture: this.texture,
			position: this.position.slice(),
			color: [1, 1, 1, 0.42],
			blend: BLEND_NORMAL,
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

/**
 * Rotating ring around a caster (legacy Renderer/Effects/MagicRing.js): follows the
 * caster, alpha forced to 0.7 by the shader, scene fog, normal alpha, after-entities
 * pass state. Finishes after the frame where endTick < tick or the caster's cast bar is
 * hidden (that frame is still drawn).
 */
export class MagicRingEffect {
	/**
	 * @param {{topSize: number, bottomSize: number, height: number, texture: string}} spec
	 * @param {Object} inst
	 * @param {{position: ArrayLike<number>, cast: {display: boolean}}} inst.follow  caster
	 * @param {number} inst.endTick
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 */
	constructor({ topSize, bottomSize, height, texture }, inst) {
		this.topSize = topSize;
		this.bottomSize = bottomSize;
		this.height = height;
		this.texture = `data/texture/effect/${texture}.tga`;
		this.follow = inst.follow;
		this.endTick = inst.endTick;
		this.finished = false;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, false);
	}

	/**
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>}
	 */
	frame(tick, { sceneFog } = {}, stream) {
		const position = this.follow.position;
		/** @type {RingConeParams} */
		const params = {
			topSize: this.topSize,
			bottomSize: this.bottomSize,
			height: this.height,
			rotation: magicRingRotation(tick),
			vertexCount: RING_CONE_VERTEX_COUNT
		};
		const record = createEffectDraw({
			family: 'magic-ring',
			pass: this.pass,
			texture: this.texture,
			position: [position[0], position[1], position[2]],
			color: [1, 1, 1, 0.7],
			blend: BLEND_NORMAL,
			depthTest: true,
			depthWrite: true,
			depthCorrection: false,
			fog: Boolean(sceneFog && sceneFog.use),
			params
		});
		this.finished = this.endTick < tick || !this.follow.cast.display;
		stream?.effect(record);
		return record;
	}
}
