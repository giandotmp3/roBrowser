import { BLEND_NORMAL } from '../records/blend.js';
import { createWorldDraw } from '../records/WorldDraw.js';
import {
	copy,
	create,
	fromQuat,
	identity,
	lerp3,
	mat3ToMat4,
	multiply,
	rotate,
	scale,
	slerp,
	translate
} from './glm32.js';

/**
 * R-MAP-016 animLen 0 is derived as max keyframe + 1.
 * @param {number} animLen
 * @param {number[]} keyframeFrames
 */
export function resolveAnimLen(animLen, keyframeFrames) {
	if (animLen > 0) {
		return animLen;
	}
	return keyframeFrames.length ? Math.max(...keyframeFrames) + 1 : 0;
}

/**
 * R-MAP-016 keyframe position: tick (ms) used directly as the frame value.
 * @param {number} tick
 * @param {number} animLen
 */
export function keyframePosition(tick, animLen) {
	return animLen > 0 ? tick % animLen : 0;
}

/**
 * R-MAP-016 recompute bucket; matrices are recomputed only when this changes.
 * @param {number} tick
 * @param {number} [fps]  frameRatePerSecond (default 30)
 * @param {boolean} [performanceMode]
 */
export function matrixUpdateBucket(tick, fps = 30, performanceMode = false) {
	const divisor = performanceMode ? fps / 2 : fps / 1.14;
	return Math.floor(tick / (1000 / divisor));
}

const isStaticNode = node =>
	!(node.rotKeyframes && node.rotKeyframes.length) &&
	!(node.posKeyframes && node.posKeyframes.length) &&
	!(node.scaleKeyFrames && node.scaleKeyFrames.length);

/**
 * Prepare a MAP_ANIMATED_MODEL payload (spec §3.2) for R-MAP-016/017: Float32 node data,
 * keyframe vectors / quaternions, the derived animLen, the node index by name and the
 * "static prefix" (legacy quirk kept for bit parity: nodes before the first animated node
 * multiply a precomputed T·R·S local matrix in, later nodes apply T·R·S in place). A
 * model without any animated node is static: its matrices are computed once.
 * @param {Object} payload
 */
export function prepareAnimatedRsm(payload) {
	let hasAnyAnimation = false;
	let maxFrame = 0;
	const nodes = payload.nodes.map((src, index) => {
		if (!isStaticNode(src)) {
			hasAnyAnimation = true;
		}
		const node = {
			name: src.name,
			parentname: src.parentname,
			isOnly: src.is_only,
			pos: Float32Array.from(src.pos),
			rotangle: src.rotangle,
			rotaxis: Float32Array.from(src.rotaxis),
			scale: Float32Array.from(src.scale),
			offset: Float32Array.from(src.offset),
			mat3: Float32Array.from(src.mat3),
			rotKeyframes: (src.rotKeyframes || []).map(kf => ({
				frame: kf.frame,
				quat: kf.q ? Float32Array.of(kf.q[0], kf.q[1], kf.q[2], kf.q[3]) : undefined
			})),
			posKeyframes: (src.posKeyframes || []).map(kf => ({
				frame: kf.frame,
				vec: Float32Array.of(kf.px, kf.py, kf.pz)
			})),
			scaleKeyFrames: (src.scaleKeyFrames || []).map(kf => ({
				Frame: kf.Frame,
				frame: kf.frame,
				vec: Float32Array.of(kf.Scale[0], kf.Scale[1], kf.Scale[2])
			})),
			isStatic: !hasAnyAnimation,
			index,
			staticLocal: null,
			final: create()
		};
		if (node.isStatic) {
			const local = create();
			translate(local, local, node.pos);
			rotate(local, local, node.rotangle, node.rotaxis);
			scale(local, local, node.scale);
			node.staticLocal = local;
		}
		node.rotKeyframes.forEach(kf => (maxFrame = Math.max(maxFrame, kf.frame || 0)));
		node.posKeyframes.forEach(kf => (maxFrame = Math.max(maxFrame, kf.frame || 0)));
		node.scaleKeyFrames.forEach(kf => (maxFrame = Math.max(maxFrame, kf.Frame || 0)));
		return node;
	});
	const instances = payload.instances.map(inst => copy(new Float32Array(16), inst));
	return {
		prepared: true,
		filename: payload.filename,
		alpha: payload.alpha,
		fps: payload.frameRatePerSecond || 30,
		animLen: payload.animLen || maxFrame + 1,
		staticModel: !hasAnyAnimation,
		box: { center: Float32Array.from(payload.box.center), max: Float32Array.from(payload.box.max) },
		instances,
		nodes,
		nodeIndex: new Map(nodes.map(n => [n.name, n.index])),
		globals: nodes.map(() => create())
	};
}

/** Bracketing keyframes of `frame` (legacy linear scan); `frameOf` reads a keyframe's frame. */
function bracket(keyframes, frame, frameOf) {
	let prev = keyframes[0];
	for (const kf of keyframes) {
		if (frameOf(kf) > frame) {
			return { prev, next: kf };
		}
		prev = kf;
	}
	return { prev, next: null };
}

const frameOfKey = kf => kf.frame;
const frameOfScale = kf => (typeof kf.Frame !== 'undefined' ? kf.Frame : kf.frame);

/**
 * Keyframe value at `frame`: none → null, one key → that key, otherwise linear (or slerp)
 * between the bracketing keys, the last key held after the end.
 *
 * Discrepancy #69 FIX (declared divergence): before the first key (a first key after
 * frame 0) the first key is held, the same clamp legacy applies after the last key and to
 * a single key. Legacy brackets (first, first) there and interpolates with
 * t = (frame − f0) / 0 = −∞, giving NaN matrices for the node and its descendants.
 */
function keyAt(keyframes, frame, out, field, frameOf, interpolate) {
	if (!keyframes.length) {
		return null;
	}
	if (keyframes.length === 1 || frameOf(keyframes[0]) > frame) {
		return keyframes[0][field];
	}
	const { prev, next } = bracket(keyframes, frame, frameOf);
	if (!next) {
		return prev[field];
	}
	return interpolate(out, prev[field], next[field], (frame - frameOf(prev)) / (frameOf(next) - frameOf(prev)));
}

const _tmpVec = new Float32Array(3);
const _tmpScale = new Float32Array(3);
const _tmpQuat = Float32Array.of(0, 0, 0, 1);
const _tmpMat = create();
const _dest = create();

/**
 * R-MAP-017 node hierarchy → per-instance node matrices (CPU), packed 16 floats per
 * (node, instance) at index node·instances + instance (the RGBA32F matrix texture /
 * storage buffer layout):
 *   global = parentGlobal · T(posKey | pos) · R(slerp rotKey | axis-angle) · S(scaleKey | scale)
 *   final  = T(−center.x, −max.y, −center.z) · global · T(offset unless only node) · mat3
 *   matrix = instance · final
 * A node whose parent is itself or unknown starts from identity.
 * @param {Object} model  a MAP_ANIMATED_MODEL payload or a prepareAnimatedRsm result
 * @param {number} keyframe  keyframe position (R-MAP-016: tick % animLen)
 * @param {Float32Array} [out]
 * @returns {Float32Array}
 */
export function computeNodeMatrices(model, keyframe, out) {
	const m = model.prepared ? model : prepareAnimatedRsm(model);
	const { box, nodes, globals, nodeIndex, instances } = m;
	for (const node of nodes) {
		const global = globals[node.index];
		const parent = node.parentname ? nodeIndex.get(node.parentname) : undefined;
		if (parent !== undefined && node.parentname !== node.name) {
			copy(global, globals[parent]);
		} else {
			identity(global);
		}
		if (node.isStatic) {
			multiply(global, global, node.staticLocal);
		} else {
			translate(
				global,
				global,
				keyAt(node.posKeyframes, keyframe, _tmpVec, 'vec', frameOfKey, lerp3) || node.pos
			);
			const rot = keyAt(node.rotKeyframes, keyframe, _tmpQuat, 'quat', frameOfKey, slerp);
			if (rot) {
				fromQuat(_tmpMat, rot);
				multiply(global, global, _tmpMat);
			} else {
				rotate(global, global, node.rotangle, node.rotaxis);
			}
			scale(
				global,
				global,
				keyAt(node.scaleKeyFrames, keyframe, _tmpScale, 'vec', frameOfScale, lerp3) || node.scale
			);
		}
		const final = identity(node.final);
		translate(final, final, [-box.center[0], -box.max[1], -box.center[2]]);
		multiply(final, final, global);
		if (!node.isOnly) {
			translate(final, final, node.offset);
		}
		multiply(final, final, mat3ToMat4(node.mat3));
	}
	const count = instances.length;
	const result = out ?? new Float32Array(nodes.length * count * 16);
	nodes.forEach((node, n) => {
		for (let i = 0; i < count; i++) {
			multiply(_dest, instances[i], node.final);
			result.set(_dest, (n * count + i) * 16);
		}
	});
	return result;
}

/**
 * Animated RSM map models (C-05, R-MAP-016/017): one `world`/`animatedModel` record per
 * model per frame, in load order, carrying the model's node × instance matrices. The
 * matrices are recomputed only when the R-MAP-016 bucket changes (static models: once, at
 * load); between recomputes the record carries the last ones (`params.updated` false).
 */
export class AnimatedRsmComposer {
	constructor() {
		/** @type {ReturnType<typeof prepareAnimatedRsm>[]} */
		this.models = [];
	}

	/**
	 * Load a MAP_ANIMATED_MODEL payload (ignored when it has no node). Matrices are computed
	 * at keyframe 0 right away.
	 * @param {Object} payload
	 * @returns {number} the model index, or −1 when ignored
	 */
	add(payload) {
		if (!payload || !payload.nodes || payload.nodes.length === 0) {
			return -1;
		}
		const model = prepareAnimatedRsm(payload);
		model.matrices = new Float32Array(model.nodes.length * model.instances.length * 16);
		model.lastFrame = -1;
		model.lastAnimFrame = -1;
		this._update(model, 0, false, true);
		this.models.push(model);
		return this.models.length - 1;
	}

	/** Recompute when due (R-MAP-016); returns whether the matrices changed. */
	_update(model, frame, performanceMode, force) {
		const animFrame = matrixUpdateBucket(frame, model.fps, performanceMode);
		if (!force && model.lastAnimFrame === animFrame && !model.staticModel) {
			return false;
		}
		if (model.staticModel && model.lastAnimFrame !== -1 && !force) {
			return false;
		}
		model.lastAnimFrame = animFrame;
		model.lastFrame = frame;
		computeNodeMatrices(model, frame, model.matrices);
		return true;
	}

	/**
	 * The records of one frame (R-CTX-010 step 9).
	 * @param {number} tick  ms
	 * @param {{performanceMode?: boolean}} [opts]
	 * @returns {import('../records/WorldDraw.js').WorldDraw[]}
	 */
	compose(tick, { performanceMode = false } = {}) {
		return this.models.map((model, index) => {
			const updated = this._update(model, tick % (model.animLen || 1), performanceMode, false);
			return createWorldDraw({
				part: 'animatedModel',
				alpha: model.alpha,
				matrices: Float32Array.from(model.matrices),
				blend: BLEND_NORMAL,
				depthTest: true,
				depthWrite: true,
				params: Object.freeze({
					model: index,
					filename: model.filename,
					frame: model.lastFrame,
					animFrame: model.lastAnimFrame,
					updated
				})
			});
		});
	}

	/** Drop every model (map unload). */
	clear() {
		this.models = [];
	}
}
