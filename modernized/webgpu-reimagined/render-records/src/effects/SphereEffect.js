import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_ADDITIVE } from '../records/blend.js';
import { identity, rotateX, rotateY } from '../util/rotation.js';
import { effectPass } from './rules.js';

/** Both sphere families sample this texture (legacy loads it once per family). */
export const SPHERE_TEXTURE = 'data/texture/effect/thunder_center.bmp';

/** Orbit slots: sphere i uses slot i % 5. */
export const SPHERE_ORBIT_SLOTS = 5;

/** One quad per layer draw. */
export const SPHERE_VERTEX_COUNT = 6;

/** Fade-in: alpha factor added per 60 fps frame (SPHERE_FADE_IN_FRAME_MS), clamped to 1. */
export const SPHERE_FADE_IN_STEP = 0.005;

/** Discrepancy #57: the fade-in step is per 1000/60 ms of elapsed time, not per drawn frame. */
export const SPHERE_FADE_IN_FRAME_MS = 1000 / 60;

/**
 * Size, rgb, base alpha (before the fade-in factor) and zIndex per layer and palette.
 * @type {Readonly<Record<string, {coin: number[], plain: number[], zIndex: number}>>}
 */
export const SPHERE_LAYERS = Object.freeze({
	outer: { coin: [0.3, 1.0, 0.9, 0.4, 0.2], plain: [0.55, 0.0, 0.0, 1.0, 0.2], zIndex: 0.0 },
	middle: { coin: [0.2, 1.0, 0.9, 0.4, 0.4], plain: [0.35, 0.0, 0.0, 1.0, 0.6], zIndex: 0.01 },
	core: { coin: [0.1, 1.0, 0.9, 0.4, 0.6], plain: [0.25, 0.0, 0.0, 1.0, 1.0], zIndex: 0.02 },
	glow: { coin: [0.05, 1.0, 1.0, 0.7, 1.0], plain: [0.15, 0.8, 0.8, 1.0, 1.0], zIndex: 0.03 }
});

/**
 * Layers drawn for sphere i (i counts down from the sphere count): i > 10 one 'outer'
 * quad, i > 5 one 'middle' quad, otherwise a 'core' quad then a 'glow' quad.
 * @param {number} i
 * @returns {string[]}
 */
export function sphereLayers(i) {
	if (i > 10) {
		return ['outer'];
	}
	if (i > 5) {
		return ['middle'];
	}
	return ['core', 'glow'];
}

/**
 * Orbit and billboard matrices of the 5 slots at a tick (legacy beforeRender):
 * slot k orbits at rot = 2πk/5 − tick/64 degrees around Y; the texture matrix is
 * Rx(pitch − 90°) · Ry(yaw − rot).
 * @param {number} tick
 * @param {[number, number]} cameraAngle [pitch, yaw] degrees
 * @returns {{rotation: number[], textureRotation: number[]}[]}
 */
export function sphereOrbit(tick, cameraAngle) {
	const vcRad = ((cameraAngle[0] - 90) * Math.PI) / 180;
	const hcRad = (cameraAngle[1] * Math.PI) / 180;
	return Array.from({ length: SPHERE_ORBIT_SLOTS }, (_v, k) => {
		const rotRad = (k * 2 * Math.PI) / SPHERE_ORBIT_SLOTS - (tick / 64 / 180) * Math.PI;
		return {
			rotation: rotateY(identity(), rotRad),
			textureRotation: rotateY(rotateX(identity(), vcRad), hcRad - rotRad)
		};
	});
}

/**
 * @typedef {Object} SphereParams  EffectDraw.params of families 'spirit-sphere' / 'warlock-sphere'
 * @property {number} index        sphere number i (counted down)
 * @property {number} slot         i % 5
 * @property {'outer'|'middle'|'core'|'glow'} layer  'glow' reuses the core's matrices
 * @property {number} size         uSize
 * @property {number} zIndex       uZIndex
 * @property {number} cameraZoom   uCameraZoom
 * @property {number[]} rotation   orbit matrix (uRotationMat)
 * @property {number[]} textureRotation  billboard matrix (uTextureRotMat)
 * @property {number} vertexCount
 */

/**
 * Orbiting spheres around an entity (legacy Renderer/Effects/SpiritSphere.js and
 * WarlockSphere.js). One EffectDraw per layer quad, additive (R-EFX-014), no fog.
 * Alpha fades in by SPHERE_FADE_IN_STEP per SPHERE_FADE_IN_FRAME_MS of elapsed time since
 * the first drawn frame, clamped to 1 (discrepancy #57 [SME, decided]: legacy steps 0.005 per
 * drawn frame, so its fade depends on the frame rate; at 60 fps both are identical).
 */
class SphereEffect {
	/**
	 * @param {Object} o
	 * @param {string} o.family
	 * @param {number} o.count
	 * @param {boolean} o.isCoin
	 * @param {{test: boolean, write: boolean}} o.depth
	 * @param {Object} inst
	 * @param {{position: ArrayLike<number>}} inst.follow  owner entity (followed every frame)
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 * @param {number} [inst.initialAlpha]
	 */
	constructor({ family, count, isCoin, depth }, inst) {
		this.family = family;
		this.count = count;
		this.isCoin = isCoin;
		this.depth = depth;
		this.follow = inst.follow;
		this.alpha = inst.initialAlpha ?? 0;
		this.lastTick = null;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, false);
	}

	/**
	 * Records of one frame (spheres never finish on their own).
	 * @param {number} tick
	 * @param {{camera: {angle: [number, number], zoom: number}}} frameState
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]  also appended to, when given
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>[]}
	 */
	frame(tick, { camera }, stream) {
		if (this.lastTick !== null && this.alpha < 1) {
			const elapsed = Math.max(0, tick - this.lastTick);
			this.alpha = Math.min(this.alpha + (SPHERE_FADE_IN_STEP * elapsed) / SPHERE_FADE_IN_FRAME_MS, 1);
		}
		this.lastTick = this.lastTick === null ? tick : Math.max(this.lastTick, tick);
		const orbit = sphereOrbit(tick, camera.angle);
		const position = this.follow.position;
		const records = [];
		for (let i = this.count; i > 0; i--) {
			const slot = i % SPHERE_ORBIT_SLOTS;
			for (const layer of sphereLayers(i)) {
				const spec = SPHERE_LAYERS[layer];
				const [size, r, g, b, a] = this.isCoin ? spec.coin : spec.plain;
				/** @type {SphereParams} */
				const params = {
					index: i,
					slot,
					layer,
					size,
					zIndex: spec.zIndex,
					cameraZoom: camera.zoom,
					rotation: orbit[slot].rotation,
					textureRotation: orbit[slot].textureRotation,
					vertexCount: SPHERE_VERTEX_COUNT
				};
				const record = createEffectDraw({
					family: this.family,
					pass: this.pass,
					texture: SPHERE_TEXTURE,
					position: [position[0], position[1], position[2]],
					color: [r, g, b, a * this.alpha],
					blend: BLEND_ADDITIVE,
					depthTest: this.depth.test,
					depthWrite: this.depth.write,
					depthCorrection: false,
					fog: false,
					params
				});
				stream?.effect(record);
				records.push(record);
			}
		}
		return records;
	}
}

/**
 * Monk spirit spheres / Gunslinger coins (`new SpiritSphere(entity, num, isCoin)`).
 * Depth test on, depth write off.
 */
export class SpiritSphereEffect extends SphereEffect {
	/**
	 * @param {{num: number, isCoin?: boolean}} spec
	 * @param {ConstructorParameters<typeof SphereEffect>[1]} inst
	 */
	constructor(spec, inst) {
		super(
			{
				family: 'spirit-sphere',
				count: spec.num,
				isCoin: Boolean(spec.isCoin),
				depth: { test: true, write: false }
			},
			inst
		);
	}
}

/**
 * Warlock summoned spheres (`new WarlockSphere(entity, spheres)`). Legacy draws the
 * spirit-sphere look for every element (the element list only gives the count) and
 * draws with depth test off, depth write on.
 */
export class WarlockSphereEffect extends SphereEffect {
	/**
	 * @param {{spheres?: number[]}} spec
	 * @param {ConstructorParameters<typeof SphereEffect>[1]} inst
	 */
	constructor(spec, inst) {
		super(
			{
				family: 'warlock-sphere',
				count: spec.spheres ? spec.spheres.length : 0,
				isCoin: false,
				depth: { test: false, write: true }
			},
			inst
		);
	}
}
