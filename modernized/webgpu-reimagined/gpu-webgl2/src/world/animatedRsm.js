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

/** Floats per animated-RSM vertex: position 3, normal 3, uv 2, alpha 1, matrix index 1. */
export const ANIMATED_VERTEX_FLOATS = 10;

/**
 * R-MAP-015 normals of one RSM node, as legacy `AnimatedModels.precalcFlatNormals` /
 * `precalcSmoothNormals` compute them (model space, stored as Float32).
 *
 * - `flat`: one normal per face (cross product of the face edges, normalised).
 * - `smooth` (shadeType 2 only): per smoothGroup 0..31 in use, one normal per vertex,
 *   the normalised sum of the flat normals of the group's faces using that vertex.
 *
 * shadeType NONE and unknown values use the flat normals in the animated path
 * (legacy keeps the face normal there; the static path's constant normal belongs to
 * the worker-side RSM compile).
 * @param {{vertices: ArrayLike<ArrayLike<number>>, faces: ReadonlyArray<{vertidx: number[], smoothGroup?: number}>}} node
 * @param {number} shadeType
 * @returns {{flat: Float32Array, smooth: Float32Array[]|null}}
 */
export function computeRsmNormals(node, shadeType) {
	const flat = flatNormals(node);
	return { flat, smooth: shadeType === 2 ? smoothNormals(node, flat) : null };
}

/** @param {{vertices: ArrayLike<ArrayLike<number>>, faces: ReadonlyArray<{vertidx: number[]}>}} node */
function flatNormals({ vertices, faces }) {
	const normals = new Float32Array(faces.length * 3);
	faces.forEach((face, f) => {
		const v0 = vertices[face.vertidx[0]];
		const v1 = vertices[face.vertidx[1]];
		const v2 = vertices[face.vertidx[2]];
		const ax = v1[0] - v0[0];
		const ay = v1[1] - v0[1];
		const az = v1[2] - v0[2];
		const bx = v2[0] - v0[0];
		const by = v2[1] - v0[1];
		const bz = v2[2] - v0[2];
		let nx = ay * bz - az * by;
		let ny = az * bx - ax * bz;
		let nz = ax * by - ay * bx;
		let len = nx * nx + ny * ny + nz * nz;
		if (len > 0) {
			len = 1.0 / Math.sqrt(len);
			nx *= len;
			ny *= len;
			nz *= len;
		}
		normals[f * 3] = nx;
		normals[f * 3 + 1] = ny;
		normals[f * 3 + 2] = nz;
	});
	return normals;
}

/**
 * @param {{vertices: ArrayLike<ArrayLike<number>>, faces: ReadonlyArray<{vertidx: number[], smoothGroup?: number}>}} node
 * @param {Float32Array} flat
 */
function smoothNormals({ vertices, faces }, flat) {
	const used = [];
	for (const face of faces) {
		const sg = face.smoothGroup;
		if (sg !== undefined && sg >= 0 && sg < 32) {
			used[sg] = true;
		}
	}
	/** @type {Float32Array[]} */
	const groups = [];
	for (let j = 0; j < 32; j++) {
		if (!used[j]) {
			continue;
		}
		const norm = new Float32Array(vertices.length * 3);
		groups[j] = norm;
		for (let v = 0; v < vertices.length; v++) {
			let x = 0;
			let y = 0;
			let z = 0;
			faces.forEach((face, f) => {
				if (
					face.smoothGroup === j &&
					(face.vertidx[0] === v || face.vertidx[1] === v || face.vertidx[2] === v)
				) {
					x += flat[f * 3];
					y += flat[f * 3 + 1];
					z += flat[f * 3 + 2];
				}
			});
			let len = x * x + y * y + z * z;
			if (len > 0) {
				len = 1.0 / Math.sqrt(len);
				x *= len;
				y *= len;
				z *= len;
			}
			norm[v * 3] = x;
			norm[v * 3 + 1] = y;
			norm[v * 3 + 2] = z;
		}
	}
	return groups;
}

const isStaticNode = node => !node.rotKeyframes?.length && !node.posKeyframes?.length && !node.scaleKeyFrames?.length;

/**
 * One MAP_ANIMATED_MODEL payload (spec §3.2), prepared for the GPU: the static
 * model-space geometry (grouped by texture, then node, then instance, as legacy
 * `AnimatedModels.add`), the mesh ranges per texture and the node hierarchy whose
 * matrices `update()` recomputes (R-MAP-016 timing, R-MAP-017 hierarchy).
 *
 * Matrices are computed with the legacy float32 arithmetic (glm32.js), so the
 * palette uploaded to the GPU is bit-identical to legacy's.
 */
export class AnimatedRsm {
	/**
	 * @param {Object} data  MAP_ANIMATED_MODEL payload
	 * @param {number} [matrixBase]  first matrix index of this model in a shared palette
	 */
	constructor(data, matrixBase = 0) {
		const instances = data.instances.map(inst => copy(new Float32Array(16), inst));
		this.filename = data.filename;
		this.instances = instances;
		this.textures = data.textures.slice();
		this.shadeType = data.shadeType;
		this.alpha = data.alpha;
		this.fps = data.frameRatePerSecond || 30;
		this.box = {
			center: Float32Array.from(data.box.center),
			max: Float32Array.from(data.box.max)
		};
		let hasAnyAnimation = false;
		this.nodes = data.nodes.map((src, index) => {
			if (!isStaticNode(src)) {
				hasAnyAnimation = true;
			}
			const node = {
				name: src.name,
				parentname: src.parentname,
				isOnly: src.is_only,
				textures: src.textures,
				vertices: src.vertices,
				tvertices: Float32Array.from(src.tvertices),
				faces: src.faces,
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
				// Legacy quirk kept for bit parity: nodes before the first animated node use a
				// precomputed local matrix (multiplied in), later ones apply T·R·S in place.
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
			return node;
		});
		this.staticModel = !hasAnyAnimation;
		this.animLen = resolveAnimLen(data.animLen, this.nodes);
		this.nodeIndex = new Map(this.nodes.map(n => [n.name, n.index]));
		this.globals = this.nodes.map(() => create());
		this.matrixBase = matrixBase;
		this.matrixCount = this.nodes.length * instances.length;
		this.matrices = new Float32Array(this.matrixCount * 16);
		this.lastAnimFrame = -1;
		this._buildGeometry(data.alpha);
	}

	/** Geometry plan: texture id ascending, then node, then instance (legacy `for…in` order). */
	_buildGeometry(alpha) {
		const numInstances = this.instances.length;
		/** @type {Map<number, {nodeIndex: number, instanceIndex: number, faceCount: number}[]>} */
		const groups = new Map();
		for (const node of this.nodes) {
			node.normals = computeRsmNormals(node, this.shadeType);
			/** @type {Map<number, number>} */
			const perTexture = new Map();
			for (const face of node.faces) {
				const tid = node.textures[face.texid];
				perTexture.set(tid, (perTexture.get(tid) ?? 0) + 1);
			}
			for (const [tid, faceCount] of perTexture) {
				if (!groups.has(tid)) {
					groups.set(tid, []);
				}
				for (let inst = 0; inst < numInstances; inst++) {
					groups.get(tid).push({ nodeIndex: node.index, instanceIndex: inst, faceCount });
				}
			}
		}
		const order = [...groups.keys()].sort((a, b) => a - b);
		let vertices = 0;
		/** @type {{textureIndex: number, vertOffset: number, vertCount: number}[]} */
		this.meshes = order.map(tid => {
			const count = groups.get(tid).reduce((n, p) => n + p.faceCount * 3, 0);
			const mesh = { textureIndex: tid, vertOffset: vertices, vertCount: count };
			vertices += count;
			return mesh;
		});
		this.vertexCount = vertices;
		const buffer = new Float32Array(vertices * ANIMATED_VERTEX_FLOATS);
		let o = 0;
		for (const tid of order) {
			for (const plan of groups.get(tid)) {
				const node = this.nodes[plan.nodeIndex];
				const matrixIndex = this.matrixBase + plan.nodeIndex * numInstances + plan.instanceIndex;
				o = this._writeNode(node, tid, buffer, o, alpha, matrixIndex);
			}
		}
		this.vertexData = buffer;
	}

	_writeNode(node, textureId, buffer, offset, alpha, matrixIndex) {
		const { flat, smooth } = node.normals;
		let o = offset;
		node.faces.forEach((face, f) => {
			if (node.textures[face.texid] !== textureId) {
				return;
			}
			const smoothNorm = smooth && face.smoothGroup !== undefined ? (smooth[face.smoothGroup] ?? null) : null;
			for (let vi = 0; vi < 3; vi++) {
				const v = node.vertices[face.vertidx[vi]];
				const t = face.tvertidx[vi] * 6;
				buffer[o++] = v[0];
				buffer[o++] = v[1];
				buffer[o++] = v[2];
				if (smoothNorm) {
					const n = face.vertidx[vi] * 3;
					buffer[o++] = smoothNorm[n];
					buffer[o++] = smoothNorm[n + 1];
					buffer[o++] = smoothNorm[n + 2];
				} else {
					buffer[o++] = flat[f * 3];
					buffer[o++] = flat[f * 3 + 1];
					buffer[o++] = flat[f * 3 + 2];
				}
				buffer[o++] = node.tvertices[t + 4];
				buffer[o++] = node.tvertices[t + 5];
				buffer[o++] = alpha;
				buffer[o++] = matrixIndex;
			}
		});
		return o;
	}

	/**
	 * R-MAP-016: keyframe position `tick % animLen` (ms used as the frame value); the
	 * matrices are recomputed only when floor(frame / (1000 / (fps / 1.14))) changes
	 * (fps / 2 in performance mode). A model without animated nodes computes once.
	 * @param {number} tick
	 * @param {boolean} [performanceMode]
	 * @param {boolean} [force]
	 * @returns {boolean} whether the matrices changed
	 */
	update(tick, performanceMode = false, force = false) {
		const frame = tick % (this.animLen || 1);
		const frameDuration = 1000 / (this.fps / (performanceMode ? 2 : 1.14));
		const animFrame = Math.floor(frame / frameDuration);
		if (!force && this.lastAnimFrame === animFrame && !this.staticModel) {
			return false;
		}
		if (this.staticModel && this.lastAnimFrame !== -1 && !force) {
			return false;
		}
		this.lastAnimFrame = animFrame;
		this.computeMatrices(frame);
		return true;
	}

	/**
	 * R-MAP-017: global = parentGlobal·T(posKey|pos)·R(slerp rotKey|axis-angle)·S(scaleKey|scale);
	 * final = T(−center.x, −max.y, −center.z)·global·T(offset unless only node)·mat3;
	 * each instance matrix = instance · final, packed 16 floats per (node, instance).
	 * @param {number} frame
	 */
	computeMatrices(frame) {
		const box = this.box;
		const tmpVec = new Float32Array(3);
		const tmpScale = new Float32Array(3);
		const tmpQuat = Float32Array.of(0, 0, 0, 1);
		const tmpMat = create();
		this.nodes.forEach((node, n) => {
			const global = this.globals[n];
			const parent = node.parentname ? this.nodeIndex.get(node.parentname) : undefined;
			if (parent !== undefined && node.parentname !== node.name) {
				copy(global, this.globals[parent]);
			} else {
				identity(global);
			}
			if (node.isStatic) {
				multiply(global, global, node.staticLocal);
			} else {
				translate(global, global, positionAt(node.posKeyframes, frame, tmpVec) || node.pos);
				const rot = rotationAt(node.rotKeyframes, frame, tmpQuat);
				if (rot) {
					fromQuat(tmpMat, rot);
					multiply(global, global, tmpMat);
				} else {
					rotate(global, global, node.rotangle, node.rotaxis);
				}
				scale(global, global, scaleAt(node.scaleKeyFrames, frame, tmpScale) || node.scale);
			}
			const final = identity(node.final);
			translate(final, final, [-box.center[0], -box.max[1], -box.center[2]]);
			multiply(final, final, global);
			if (!node.isOnly) {
				translate(final, final, node.offset);
			}
			multiply(final, final, mat3ToMat4(node.mat3));
		});
		const dest = create();
		const numInstances = this.instances.length;
		this.nodes.forEach((node, n) => {
			for (let i = 0; i < numInstances; i++) {
				multiply(dest, this.instances[i], node.final);
				this.matrices.set(dest, (n * numInstances + i) * 16);
			}
		});
	}
}

/**
 * R-MAP-016: animLen 0 is derived as max keyframe + 1.
 * @param {number} animLen
 * @param {ReadonlyArray<any>} nodes
 */
function resolveAnimLen(animLen, nodes) {
	if (animLen) {
		return animLen;
	}
	let max = 0;
	for (const node of nodes) {
		for (const kf of node.rotKeyframes) {
			max = Math.max(max, kf.frame || 0);
		}
		for (const kf of node.posKeyframes) {
			max = Math.max(max, kf.frame || 0);
		}
		for (const kf of node.scaleKeyFrames) {
			max = Math.max(max, kf.Frame || 0);
		}
	}
	return max + 1;
}

/**
 * Bracketing keyframes of `frame` (legacy linear scan); `frameOf` reads a keyframe's frame.
 *
 * Callers hold the first key before it (discrepancy #69 FIX, declared divergence): legacy
 * brackets (first, first) there and interpolates with t = (frame − f0) / 0 = −∞, giving NaN
 * matrices for the node and its descendants. Holding the first key is the clamp legacy
 * already applies after the last key and to a single key.
 */
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

function positionAt(keyframes, frame, out) {
	if (!keyframes.length) {
		return null;
	}
	if (keyframes.length === 1 || keyframes[0].frame > frame) {
		return keyframes[0].vec;
	}
	const { prev, next } = bracket(keyframes, frame, kf => kf.frame);
	if (!next) {
		return prev.vec;
	}
	return lerp3(out, prev.vec, next.vec, (frame - prev.frame) / (next.frame - prev.frame));
}

function rotationAt(keyframes, frame, out) {
	if (!keyframes.length) {
		return null;
	}
	if (keyframes.length === 1 || keyframes[0].frame > frame) {
		return keyframes[0].quat;
	}
	const { prev, next } = bracket(keyframes, frame, kf => kf.frame);
	if (!next) {
		return prev.quat;
	}
	return slerp(out, prev.quat, next.quat, (frame - prev.frame) / (next.frame - prev.frame));
}

function scaleAt(keyframes, frame, out) {
	if (!keyframes.length) {
		return null;
	}
	const frameOf = kf => (typeof kf.Frame !== 'undefined' ? kf.Frame : kf.frame);
	if (keyframes.length === 1 || frameOf(keyframes[0]) > frame) {
		return keyframes[0].vec;
	}
	const { prev, next } = bracket(keyframes, frame, frameOf);
	if (!next) {
		return prev.vec;
	}
	return lerp3(out, prev.vec, next.vec, (frame - frameOf(prev)) / (frameOf(next) - frameOf(prev)));
}
