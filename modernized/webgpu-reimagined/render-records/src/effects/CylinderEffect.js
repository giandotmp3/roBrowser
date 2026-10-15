import { createEffectDraw } from '../records/EffectDraw.js';
import { blendFromEffectMode } from '../records/blend.js';
import { defaultRng } from '../util/injectables.js';
import { effectPass } from './rules.js';

/** Default side count of the cylinder base circle. */
export const CYLINDER_DEFAULT_SIDES = 20;

/** Floats per mesh vertex: x, y, z (0 bottom ring, 1 top ring), u, v. */
export const CYLINDER_VERTEX_STRIDE = 5;

/**
 * Legacy `!isNaN(v)` (coerces: null and '' count as numbers, undefined does not).
 * @param {*} v
 */
const isNum = v => !Number.isNaN(Number(v));

/** @type {Map<string, Float32Array>} */
const _meshes = new Map();

/**
 * Cylinder mesh (port of legacy generateCylinder): a ring of quads between a bottom
 * circle (z 0, v 1) and a top circle (z 1, v 0), radius 1. circleSides < totalCircleSides
 * draws a partial ring; u spans repeatTextureX over the drawn sides. Like legacy, the
 * last segment has no closing vertex, so the mesh ends with one degenerate triangle.
 *
 * Meshes are shared by key and never owned by an instance (the legacy per-instance
 * GL buffer, which was never deleted on free, has no counterpart here).
 *
 * @param {number} totalCircleSides
 * @param {number} circleSides
 * @param {number} repeatTextureX
 * @returns {Float32Array} interleaved vertices (read-only by convention)
 */
export function cylinderMesh(totalCircleSides, circleSides, repeatTextureX) {
	const key = `${totalCircleSides}|${circleSides}|${repeatTextureX}`;
	let mesh = _meshes.get(key);
	if (!mesh) {
		const ring = (i, z) => {
			const a = i / totalCircleSides;
			return [
				Math.sin(a * Math.PI * 2),
				Math.cos(a * Math.PI * 2),
				z,
				a * (totalCircleSides / circleSides) * repeatTextureX,
				1 - z
			];
		};
		const out = [];
		for (let i = 0; i <= circleSides; i++) {
			const b0 = ring(i, 0);
			const t0 = ring(i, 1);
			const last = i === circleSides;
			const b1 = last ? [] : ring(i + 1, 0);
			const t1 = last ? [] : ring(i + 1, 1);
			out.push(...b0, ...t0, ...b1, ...t0, ...b1, ...t1);
		}
		mesh = new Float32Array(out);
		_meshes.set(key, mesh);
	}
	return mesh;
}

/**
 * Animated cylinder shape (legacy Cylinder.render animation modes).
 * - 1: height grows over min(duration, 1000) ms
 * - 2: top size grows over min(duration, 1000) ms
 * - 3: both sizes shrink to 0 over the duration; height rises to full at the half and
 *      falls back (exactly at the half it is the full height)
 * - 4: both sizes grow from 0 over the duration (clamped at 0 before the start)
 * - 5: height rises to full at the half and falls back
 * Values are unclamped outside [0, duration] (except mode 4's lower clamp).
 *
 * @param {Object} s
 * @param {number} s.animation  0..5
 * @param {number} s.elapsed    tick − startTick
 * @param {number} s.duration   endTick − startTick
 * @param {number} s.topSize
 * @param {number} s.bottomSize
 * @param {number} s.height
 * @returns {{topSize: number, bottomSize: number, height: number}}
 */
export function cylinderShape({ animation, elapsed, duration, topSize, bottomSize, height }) {
	const out = { topSize, bottomSize, height };
	const ramp = full =>
		duration > 1000 ? (elapsed <= 1000 ? (elapsed / 1000) * full : full) : (elapsed / duration) * full;
	switch (animation) {
		case 1:
			out.height = ramp(height);
			break;
		case 2:
			out.topSize = ramp(topSize);
			break;
		case 3:
			out.bottomSize = (1 - elapsed / duration) * bottomSize;
			out.topSize = (1 - elapsed / duration) * topSize;
			if (elapsed < duration / 2) {
				out.height = (elapsed * height) / (duration / 2);
			} else if (elapsed > duration / 2) {
				out.height = ((duration - elapsed) * height) / (duration / 2);
			}
			break;
		case 4: {
			const b = (elapsed / duration) * bottomSize;
			const t = (elapsed / duration) * topSize;
			out.bottomSize = b < 0 ? 0 : b;
			out.topSize = t < 0 ? 0 : t;
			break;
		}
		case 5:
			out.height =
				elapsed < duration / 2
					? ((elapsed * 2) / duration) * height
					: ((duration - elapsed) * height) / (duration / 2);
			break;
		default:
	}
	return out;
}

/**
 * Cylinder alpha: `fade` ramps in over the first quarter and out over the last quarter
 * of the duration. Unlike R-EFX-012 it is one flag and it is NOT clamped (negative
 * before the start and after the end, like legacy).
 *
 * @param {{fade: boolean, elapsed: number, duration: number, alphaMax: number}} s
 */
export function cylinderAlpha({ fade, elapsed, duration, alphaMax }) {
	if (fade) {
		if (elapsed < duration / 4) {
			return (elapsed * alphaMax) / (duration / 4);
		}
		if (elapsed > duration / 2 + duration / 4) {
			return ((duration - elapsed) * alphaMax) / (duration / 4);
		}
	}
	return alphaMax;
}

// gl-matrix compatible post-multiplied rotations on column-major 4x4 arrays.
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function rotateX(m, rad) {
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const r1 = m.slice(4, 8);
	const r2 = m.slice(8, 12);
	for (let i = 0; i < 4; i++) {
		m[4 + i] = r1[i] * c + r2[i] * s;
		m[8 + i] = r2[i] * c - r1[i] * s;
	}
}

function rotateY(m, rad) {
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const r0 = m.slice(0, 4);
	const r2 = m.slice(8, 12);
	for (let i = 0; i < 4; i++) {
		m[i] = r0[i] * c - r2[i] * s;
		m[8 + i] = r0[i] * s + r2[i] * c;
	}
}

function rotateZ(m, rad) {
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const r0 = m.slice(0, 4);
	const r1 = m.slice(4, 8);
	for (let i = 0; i < 4; i++) {
		m[i] = r0[i] * c + r1[i] * s;
		m[4 + i] = r1[i] * c - r0[i] * s;
	}
}

const DEG = Math.PI / 180;

/**
 * Cylinder placement (legacy Cylinder.render): world position with the pos offsets and
 * the rotation matrix the vertex shader applies (uRotate / uRotationMat).
 *
 * - rotate spins 1° per 4 ms of game tick around Y; then the fixed angleX/Y/Z apply.
 * - rotateWithCamera / fixedPerspective turn the offsets with the camera yaw
 *   (fixedPerspective also tilts by pitch − 180 and, with posZ, lifts the position).
 * - Without any rotation flag, pos offsets are added as is and uRotate is false.
 *
 * @param {Object} s
 * @param {ArrayLike<number>} s.position   anchor (the followed entity's position when attached)
 * @param {Object} s.effect                normalised CylinderEffect fields
 * @param {number} s.tick
 * @param {ArrayLike<number>} [s.cameraAngle]  [pitch, yaw] degrees
 * @returns {{position: number[], rotate: boolean, rotation: number[]}}
 */
export function cylinderPlacement({ position, effect, tick, cameraAngle = [0, 0] }) {
	const { posX, posY, posZ, angleX, angleY, angleZ, rotateWithCamera, fixedPerspective } = effect;
	const out = [position[0], position[1], position[2]];
	const rotation = identity();
	const rotate = Boolean(effect.rotate || angleX || angleY || angleZ || rotateWithCamera || fixedPerspective);
	if (!rotate) {
		return { position: [out[0] + posX, out[1] + posY, out[2] + posZ], rotate, rotation };
	}
	if (effect.rotate) {
		rotateY(rotation, (tick / 4 / 180) * Math.PI);
	}
	if (angleX) {
		rotateX(rotation, (angleX / 180) * Math.PI);
	}
	if (angleY) {
		rotateY(rotation, (angleY / 180) * Math.PI);
	}
	if (angleZ) {
		rotateZ(rotation, (angleZ / 180) * Math.PI);
	}
	if (rotateWithCamera || fixedPerspective) {
		let magic = posY;
		if (fixedPerspective) {
			const vc = (cameraAngle[0] - 180) * DEG;
			if (posZ) {
				out[2] += posZ * Math.cos(vc) - posY * Math.sin(vc);
				magic = posY * Math.sin(vc) + posZ * Math.sin(vc);
			}
			rotateX(rotation, vc);
		}
		const hc = cameraAngle[1] * DEG;
		if (posX || posY) {
			out[0] += posX * Math.cos(hc) - magic * Math.sin(hc);
			out[1] += magic * Math.cos(hc) + posX * Math.sin(hc);
		}
		rotateY(rotation, hc);
	} else {
		out[0] += posX;
		out[1] += posY;
		out[2] += posZ;
	}
	return { position: out, rotate, rotation };
}

/** Legacy loose animation mode ('1' == 1), 0 when none. */
const animationMode = animation => [1, 2, 3, 4, 5].find(m => animation == m) ?? 0;

/**
 * @typedef {Object} CylinderParams  EffectDraw.params of family 'cylinder'
 * @property {number} topSize        animated top radius (uTopSize)
 * @property {number} bottomSize     animated bottom radius (uBottomSize)
 * @property {number} height         animated height (uHeight)
 * @property {number} baseTopSize
 * @property {number} baseBottomSize
 * @property {number} baseHeight
 * @property {number} animation      0..5
 * @property {number} elapsed        tick − startTick
 * @property {number} duration       endTick − startTick
 * @property {number} zIndex         clip-space z bias (gl_Position.z −= zIndex)
 * @property {boolean} rotate        rotation matrix applies
 * @property {number[]} rotation     column-major 4x4
 * @property {number} totalCircleSides  mesh key
 * @property {number} circleSides       mesh key
 * @property {number} repeatTextureX    mesh key
 * @property {number} vertexCount
 * @property {boolean} textureRepeat    wrap S = REPEAT (repeatTextureX > 1)
 * @property {number} blendMode         raw GL-order code (R-EFX-011)
 */

/**
 * One EffectTable 'CYLINDER' instance (cone / cylinder / ring, R-EFX-011). Replaces
 * legacy Renderer/Effects/Cylinder.js; draws one EffectDraw per frame. Depth test on,
 * depth write off, scene fog on (sceneFog.use is the legacy fog.use && fog.exist).
 *
 * Lifetime: like legacy, the instance draws every frame it is rendered (also before its
 * startTick) and is finished once endTick < tick, after drawing that frame. An
 * open-ended instance (endTick −1) therefore draws exactly one frame.
 */
export class CylinderEffect {
	/**
	 * @param {Object} spec  EffectTable entry
	 * @param {Object} inst
	 * @param {ArrayLike<number>} inst.position
	 * @param {ArrayLike<number>} [inst.otherPosition]  target (rotateToTarget)
	 * @param {number} [inst.direction]                 source direction (rotateWithSource)
	 * @param {number} inst.startTick
	 * @param {number} inst.endTick
	 * @param {{position: ArrayLike<number>}} [inst.follow]  entity followed every frame (attachedEntity)
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 * @param {{rng?: import('../util/injectables.js').Rng}} [ports]
	 */
	constructor(spec, inst, { rng = defaultRng } = {}) {
		const { position, otherPosition, direction = 0, startTick, endTick, follow = null } = inst;
		const num = (v, fallback) => (isNum(v) ? v : fallback);
		this.startTick = startTick;
		this.endTick = endTick;
		this.follow = follow;
		this.position = [position[0], position[1], position[2]];
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, false);
		this.texture = `data/texture/effect/${spec.textureName}.tga`;

		this.totalCircleSides = num(spec.totalCircleSides, CYLINDER_DEFAULT_SIDES);
		this.circleSides = num(spec.circleSides, this.totalCircleSides);
		this.repeatTextureX = num(spec.repeatTextureX, 1);
		this.rgb = [num(spec.red, 1), num(spec.green, 1), num(spec.blue, 1)];
		this.alphaMax = spec.alphaMax > 0 ? spec.alphaMax : 1;
		this.posX = num(spec.posX, 0);
		this.posY = num(spec.posY, 0);
		this.posZ = num(spec.posZ, 0);
		this.topSize = spec.topSize;
		this.bottomSize = spec.bottomSize;
		this.height = spec.height;
		this.animation = animationMode(spec.animation);
		this.fade = spec.fade;
		this.rotate = spec.rotate;

		// rng is consumed in legacy order: X, Y, Z
		this.angleX = num(spec.angleX, 0) + (isNum(spec.angleXRandom) ? Math.floor(rng() * spec.angleXRandom) : 0);
		this.angleY = num(spec.angleY, 0) + (isNum(spec.angleYRandom) ? Math.floor(rng() * spec.angleYRandom) : 0);
		this.angleZ = num(spec.angleZ, 0) + (isNum(spec.angleZRandom) ? Math.floor(rng() * spec.angleZRandom) : 0);
		if (spec.rotateToTarget) {
			const x = otherPosition[0] - position[0];
			const y = otherPosition[1] - position[1];
			this.angleY += 90 - Math.atan2(y, x) * (180 / Math.PI);
		}
		if (spec.rotateWithSource) {
			this.angleY += 180 + direction * -45;
		}
		this.rotateWithCamera = Boolean(spec.rotateWithCamera);
		this.fixedPerspective = Boolean(spec.fixedPerspective);
		this.zIndex = num(spec.zIndex, 0);
		this.blendMode = spec.blendMode;
		this.blend = blendFromEffectMode(spec.blendMode);
		this.vertexCount =
			cylinderMesh(this.totalCircleSides, this.circleSides, this.repeatTextureX).length / CYLINDER_VERTEX_STRIDE;
		this.finished = false;
	}

	/** Shared mesh of this instance (cylinderMesh). */
	get mesh() {
		return cylinderMesh(this.totalCircleSides, this.circleSides, this.repeatTextureX);
	}

	/**
	 * The record of one frame.
	 * @param {number} tick
	 * @param {{camera?: {angle: ArrayLike<number>}, sceneFog?: {use: boolean}}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]  also appended to, when given
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>}
	 */
	frame(tick, { camera, sceneFog } = {}, stream) {
		const elapsed = tick - this.startTick;
		const duration = this.endTick - this.startTick;
		const shape = cylinderShape({
			animation: this.animation,
			elapsed,
			duration,
			topSize: this.topSize,
			bottomSize: this.bottomSize,
			height: this.height
		});
		const alpha = cylinderAlpha({ fade: this.fade, elapsed, duration, alphaMax: this.alphaMax });
		const anchor = this.follow ? this.follow.position : this.position;
		const { position, rotate, rotation } = cylinderPlacement({
			position: anchor,
			effect: this,
			tick,
			cameraAngle: camera?.angle
		});
		/** @type {CylinderParams} */
		const params = {
			...shape,
			baseTopSize: this.topSize,
			baseBottomSize: this.bottomSize,
			baseHeight: this.height,
			animation: this.animation,
			elapsed,
			duration,
			zIndex: this.zIndex,
			rotate,
			rotation,
			totalCircleSides: this.totalCircleSides,
			circleSides: this.circleSides,
			repeatTextureX: this.repeatTextureX,
			vertexCount: this.vertexCount,
			textureRepeat: this.repeatTextureX > 1,
			blendMode: this.blendMode
		};
		const record = createEffectDraw({
			family: 'cylinder',
			pass: this.pass,
			texture: this.texture,
			position,
			color: [...this.rgb, alpha],
			blend: this.blend,
			depthTest: true,
			depthWrite: false,
			depthCorrection: false,
			fog: Boolean(sceneFog && sceneFog.use),
			params
		});
		this.finished = this.endTick < tick;
		stream?.effect(record);
		return record;
	}
}
