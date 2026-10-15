import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_NORMAL } from '../records/blend.js';
import { effectPass } from './rules.js';

/** Floats per RSM effect vertex: position, normal, uv, alpha. */
export const RSM_VERTEX_STRIDE = 9;

/** Default model frame rate when the RSM has none. */
export const RSM_DEFAULT_FPS = 30;

/** Instance transform every RSM effect model is created with. */
export const RSM_EFFECT_SCALE = Object.freeze([-0.075, -0.075, 0.075]);

const EPSILON = 0.000001;

// ---------------------------------------------------------------------------------------
// float32 matrix helpers (legacy gl-matrix semantics: column-major, Float32Array storage)
// ---------------------------------------------------------------------------------------

const mat4Identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function mat4Multiply(out, a, b) {
	const a00 = a[0],
		a01 = a[1],
		a02 = a[2],
		a03 = a[3],
		a10 = a[4],
		a11 = a[5],
		a12 = a[6],
		a13 = a[7],
		a20 = a[8],
		a21 = a[9],
		a22 = a[10],
		a23 = a[11],
		a30 = a[12],
		a31 = a[13],
		a32 = a[14],
		a33 = a[15];
	for (let c = 0; c < 16; c += 4) {
		const b0 = b[c],
			b1 = b[c + 1],
			b2 = b[c + 2],
			b3 = b[c + 3];
		out[c] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
		out[c + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
		out[c + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
		out[c + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
	}
	return out;
}

/** In-place translate (gl-matrix mat4.translate with out === a). */
function mat4Translate(m, v) {
	const x = v[0],
		y = v[1],
		z = v[2];
	m[12] = m[0] * x + m[4] * y + m[8] * z + m[12];
	m[13] = m[1] * x + m[5] * y + m[9] * z + m[13];
	m[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
	m[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
}

/** In-place scale. */
function mat4Scale(m, v) {
	for (let i = 0; i < 12; i++) {
		m[i] = m[i] * v[(i / 4) | 0];
	}
}

/** In-place axis-angle rotation; a near-zero axis leaves m untouched (gl-matrix returns null). */
function mat4Rotate(m, rad, axis) {
	let x = axis[0],
		y = axis[1],
		z = axis[2];
	let len = Math.sqrt(x * x + y * y + z * z);
	if (Math.abs(len) < EPSILON) {
		return;
	}
	len = 1 / len;
	x *= len;
	y *= len;
	z *= len;
	const s = Math.sin(rad);
	const c = Math.cos(rad);
	const t = 1 - c;
	const b = [
		x * x * t + c,
		y * x * t + z * s,
		z * x * t - y * s,
		x * y * t - z * s,
		y * y * t + c,
		z * y * t + x * s,
		x * z * t + y * s,
		y * z * t - x * s,
		z * z * t + c
	];
	const a = m.slice(0, 12);
	for (let col = 0; col < 3; col++) {
		for (let row = 0; row < 4; row++) {
			m[col * 4 + row] = a[row] * b[col * 3] + a[4 + row] * b[col * 3 + 1] + a[8 + row] * b[col * 3 + 2];
		}
	}
}

/** In-place quaternion rotation (legacy gl-matrix extension mat4.rotateQuat). */
function mat4RotateQuat(m, w) {
	const norm = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2] + w[3] * w[3]);
	const a = w[0] / norm,
		b = w[1] / norm,
		c = w[2] / norm,
		d = w[3] / norm;
	mat4Multiply(m, m, [
		1.0 - 2.0 * (b * b + c * c),
		2.0 * (a * b + c * d),
		2.0 * (a * c - b * d),
		0.0,
		2.0 * (a * b - c * d),
		1.0 - 2.0 * (a * a + c * c),
		2.0 * (c * b + a * d),
		0.0,
		2.0 * (a * c + b * d),
		2.0 * (b * c - a * d),
		1.0 - 2.0 * (a * a + b * b),
		0.0,
		0.0,
		0.0,
		0.0,
		1.0
	]);
}

/** Upper 3×3 of m with each column normalised (legacy mat4.extractRotation into an identity). */
function mat4ExtractRotation(m) {
	const out = mat4Identity();
	for (let col = 0; col < 3; col++) {
		const k = col * 4;
		const inv = 1.0 / Math.sqrt(m[k] * m[k] + m[k + 1] * m[k + 1] + m[k + 2] * m[k + 2]);
		out[k] = m[k] * inv;
		out[k + 1] = m[k + 1] * inv;
		out[k + 2] = m[k + 2] * inv;
	}
	return out;
}

const mat3ToMat4 = m => new Float32Array([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1]);

function quatSlerp(a, b, t) {
	const ax = a[0],
		ay = a[1],
		az = a[2],
		aw = a[3];
	let bx = b[0],
		by = b[1],
		bz = b[2],
		bw = b[3];
	let cosom = ax * bx + ay * by + az * bz + aw * bw;
	if (cosom < 0.0) {
		cosom = -cosom;
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
	}
	let scale0 = 1.0 - t;
	let scale1 = t;
	if (1.0 - cosom > 0.000001) {
		const omega = Math.acos(cosom);
		const sinom = Math.sin(omega);
		scale0 = Math.sin((1.0 - t) * omega) / sinom;
		scale1 = Math.sin(t * omega) / sinom;
	}
	return new Float32Array([
		scale0 * ax + scale1 * bx,
		scale0 * ay + scale1 * by,
		scale0 * az + scale1 * bz,
		scale0 * aw + scale1 * bw
	]);
}

const vec3Lerp = (a, b, t) =>
	new Float32Array([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);

/** Face normal of (a, b, c): normalize((c − b) × (a − b)), zero when degenerate, float32. */
function faceNormal(a, b, c) {
	const x1 = c[0] - b[0],
		y1 = c[1] - b[1],
		z1 = c[2] - b[2];
	const x2 = a[0] - b[0],
		y2 = a[1] - b[1],
		z2 = a[2] - b[2];
	const x3 = y1 * z2 - z1 * y2;
	const y3 = z1 * x2 - x1 * z2;
	const z3 = x1 * y2 - y1 * x2;
	const dist = x3 * x3 + y3 * y3 + z3 * z3;
	if (!(dist > 0)) {
		return new Float32Array(3);
	}
	const len = 1 / Math.sqrt(dist);
	return new Float32Array([x3 * len, y3 * len, z3 * len]);
}

// ---------------------------------------------------------------------------------------
// keyframes
// ---------------------------------------------------------------------------------------

/**
 * Bracketing keyframes of a frame (legacy search): the last key at or before the frame
 * and the first key at or after it; past the last key (or before the first) the pair
 * wraps from the last key to the first over animLen. Returns t clamped to [0, 1].
 *
 * @param {Array} keys sorted keyframes
 * @param {(k: object) => number} frameOf
 * @param {number} frame
 * @param {number} animLen
 * @returns {{prev: number, next: number, t: number}}
 */
export function rsmKeyframePair(keys, frameOf, frame, animLen) {
	let prev = 0;
	let next = 0;
	for (let i = 0; i < keys.length; i++) {
		if (frameOf(keys[i]) <= frame) {
			prev = i;
		}
		if (frameOf(keys[i]) >= frame) {
			next = i;
			break;
		}
	}
	if (next === 0 || frameOf(keys[next]) < frame) {
		prev = keys.length - 1;
		next = 0;
	}
	if (prev === next) {
		return { prev, next, t: 0 };
	}
	const prevFrame = frameOf(keys[prev]);
	let nextFrame = frameOf(keys[next]);
	if (nextFrame < prevFrame) {
		nextFrame += animLen;
	}
	if (frame < prevFrame) {
		frame += animLen;
	}
	const t = nextFrame - prevFrame > 0 ? (frame - prevFrame) / (nextFrame - prevFrame) : 0;
	return { prev, next, t: Math.max(0, Math.min(1, t)) };
}

/**
 * Node rotation / position / scale at a frame (null without keyframes).
 * @param {Object} node RSM node
 * @param {number} frame
 * @param {number} animLen
 */
export function rsmNodePose(node, frame, animLen) {
	const pose = { rotation: null, position: null, scale: null };
	const rot = node.rotKeyframes;
	if (rot && rot.length) {
		if (rot.length === 1) {
			pose.rotation = rot[0].q;
		} else {
			const { prev, next, t } = rsmKeyframePair(rot, k => k.frame, frame, animLen);
			pose.rotation = prev === next ? rot[prev].q : quatSlerp(rot[prev].q, rot[next].q, t);
		}
	}
	const pos = node.posKeyframes;
	if (pos && pos.length) {
		const xyz = k => [k.px, k.py, k.pz];
		if (pos.length === 1) {
			pose.position = xyz(pos[0]);
		} else {
			const { prev, next, t } = rsmKeyframePair(pos, k => k.frame, frame, animLen);
			pose.position = prev === next ? xyz(pos[prev]) : vec3Lerp(xyz(pos[prev]), xyz(pos[next]), t);
		}
	}
	const sc = node.scaleKeyFrames;
	if (sc && sc.length) {
		if (sc.length === 1) {
			pose.scale = sc[0].Scale;
		} else {
			const { prev, next, t } = rsmKeyframePair(sc, k => k.Frame, frame, animLen);
			pose.scale = prev === next ? sc[prev].Scale : vec3Lerp(sc[prev].Scale, sc[next].Scale, t);
		}
	}
	return pose;
}

// ---------------------------------------------------------------------------------------
// node mesh at a frame (port of legacy RsmEffect compileNodeAtFrame)
// ---------------------------------------------------------------------------------------

/**
 * Mesh of one node and instance at a keyframe: vertices transformed to model space and
 * normals by shade type (0 none: (0, −1, 0); 1 flat: face normal through the node
 * rotation; 2 smooth: per smoothing group averaged face normals). One Float32Array per
 * model texture index (9 floats per vertex).
 *
 * @param {Object} node RSM node
 * @param {ArrayLike<number>} instanceMatrix
 * @param {number} frame
 * @param {number} animLen
 * @returns {Object<string, Float32Array>}
 */
export function rsmNodeMeshAtFrame(node, instanceMatrix, frame, animLen) {
	const { faces, textures, vertices } = node;
	const matrix = mat4Identity();
	mat4Translate(matrix, [-node.main.box.center[0], -node.main.box.max[1], -node.main.box.center[2]]);

	const nodeMatrix = mat4Identity();
	const pose = rsmNodePose(node, frame, animLen);
	mat4Translate(nodeMatrix, pose.position ?? node.pos);
	if (pose.rotation) {
		mat4RotateQuat(nodeMatrix, pose.rotation);
	} else {
		mat4Rotate(nodeMatrix, node.rotangle, node.rotaxis);
	}
	mat4Scale(nodeMatrix, pose.scale ?? node.scale);

	mat4Multiply(matrix, matrix, nodeMatrix);
	if (!node.is_only) {
		mat4Translate(matrix, node.offset);
	}
	mat4Multiply(matrix, matrix, mat3ToMat4(node.mat3));

	const modelView = mat4Multiply(new Float32Array(16), instanceMatrix, matrix);
	const normalMat = mat4ExtractRotation(modelView);

	const vert = new Float32Array(vertices.length * 3);
	vertices.forEach(([x, y, z], i) => {
		for (let r = 0; r < 3; r++) {
			vert[i * 3 + r] = modelView[r] * x + modelView[4 + r] * y + modelView[8 + r] * z + modelView[12 + r];
		}
	});

	// face normals
	const faceNormals = new Float32Array(faces.length * 3);
	const shadeType = node.main.shadeType === 1 || node.main.shadeType === 2 ? node.main.shadeType : 0;
	const groupUsed = [];
	if (shadeType === 0) {
		for (let i = 1; i < faceNormals.length; i += 3) {
			faceNormals[i] = -1;
		}
	} else {
		faces.forEach((face, i) => {
			const n = faceNormal(vertices[face.vertidx[0]], vertices[face.vertidx[1]], vertices[face.vertidx[2]]);
			for (let r = 0; r < 3; r++) {
				faceNormals[i * 3 + r] =
					normalMat[r] * n[0] + normalMat[4 + r] * n[1] + normalMat[8 + r] * n[2] + normalMat[12 + r];
			}
			if (face.smoothGroup !== undefined) {
				groupUsed[face.smoothGroup] = true;
			}
		});
	}

	// smoothing groups: per vertex, the normalised sum of the group's face normals touching it
	const groups = [];
	if (shadeType === 2) {
		for (let g = 0; g < 32; g++) {
			if (!groupUsed[g]) {
				continue;
			}
			const norm = new Float32Array(vertices.length * 3);
			for (let v = 0; v < vertices.length; v++) {
				let x = 0,
					y = 0,
					z = 0;
				faces.forEach((face, i) => {
					if (face.smoothGroup === g && face.vertidx.includes(v)) {
						x += faceNormals[i * 3];
						y += faceNormals[i * 3 + 1];
						z += faceNormals[i * 3 + 2];
					}
				});
				let len = 1 / Math.sqrt(x * x + y * y + z * z);
				if (!isFinite(len)) {
					len = 1;
				}
				norm[v * 3] = x * len;
				norm[v * 3 + 1] = y * len;
				norm[v * 3 + 2] = z * len;
			}
			groups[g] = norm;
		}
	}

	// interleave per model texture
	const counts = {};
	textures.forEach(t => (counts[t] = 0));
	faces.forEach(face => counts[textures[face.texid]]++);
	const mesh = {};
	const offset = {};
	textures.forEach(t => {
		mesh[t] = new Float32Array(counts[t] * 27);
		offset[t] = 0;
	});
	faces.forEach((face, i) => {
		const t = textures[face.texid];
		const out = mesh[t];
		let o = offset[t];
		for (let j = 0; j < 3; j++, o += 9) {
			const a = face.vertidx[j] * 3;
			const b = face.tvertidx[j] * 6;
			const n = shadeType === 2 ? groups[face.smoothGroup] : faceNormals;
			const k = shadeType === 2 ? a : i * 3;
			out[o] = vert[a];
			out[o + 1] = vert[a + 1];
			out[o + 2] = vert[a + 2];
			out[o + 3] = n[k];
			out[o + 4] = n[k + 1];
			out[o + 5] = n[k + 2];
			out[o + 6] = node.tvertices[b + 4];
			out[o + 7] = node.tvertices[b + 5];
			out[o + 8] = node.main.alpha;
		}
		offset[t] = o;
	});
	return mesh;
}

/**
 * Merge per-node meshes into one vertex buffer (legacy order: node-major, instance,
 * then texture index ascending) and its object list.
 *
 * @param {Array<Object<string, Float32Array>>} meshes
 * @param {string[]} textures model texture names
 * @returns {{buffer: Float32Array, objects: {texture: string, vertOffset: number, vertCount: number}[]}}
 */
export function rsmMergeMeshes(meshes, textures) {
	const parts = [];
	for (const mesh of meshes) {
		for (const key of Object.keys(mesh)) {
			parts.push({ texture: `data/texture/${textures[key]}`, mesh: mesh[key] });
		}
	}
	const buffer = new Float32Array(parts.reduce((n, p) => n + p.mesh.length, 0));
	let offset = 0;
	const objects = parts.map(({ texture, mesh }) => {
		buffer.set(mesh, offset);
		const object = { texture, vertOffset: offset / RSM_VERTEX_STRIDE, vertCount: mesh.length / RSM_VERTEX_STRIDE };
		offset += mesh.length;
		return object;
	});
	return { buffer, objects };
}

/**
 * @typedef {Object} RsmParams  EffectDraw.params of family 'rsm'
 * @property {number} object        index in the effect's object list
 * @property {number} size          uSize model scale
 * @property {number|null} frame    keyframe the mesh was rebuilt at; null while the static compile shows
 * @property {number} vertOffset
 * @property {number} vertCount
 * @property {Float32Array} vertices  the object's vertices (9 floats each)
 */

/**
 * One EffectTable 'RSM' / 'RSM2' instance: a 3D model drawn at the effect position.
 * Replaces legacy Renderer/Effects/RsmEffect.js; draws one EffectDraw per mesh object
 * (texture) per frame.
 *
 * The parsed model comes from the RSM loader (Loaders/Model.js: nodes, textures,
 * animLen, frameRatePerSecond, createInstance, compile). Like legacy, the model gets one
 * instance (scale (−0.075, −0.075, 0.075)) and starts from the loader's static compile;
 * a model with keyframes and animLen > 0 is rebuilt here whenever
 * floor((elapsed·fps/1000) mod animLen) changes (a first computed frame of −1 keeps the
 * static compile).
 *
 * Fixed legacy flags (discrepancy #56, HITL round 2):
 * - every rebuild binds each object to its own mesh's texture (legacy re-resolves textures
 *   only when the object count changes, so a same-count rebuild keeps stale textures);
 * - an object whose texture failed to load (frameState.textureFailed) is not drawn (legacy
 *   draws it with no texture bound after an object-count change);
 * - `endTick` is honoured: past an endTick > 0 the effect draws nothing and is finished
 *   (legacy never sets needCleanUp). endTick −1 (no duration) never ends.
 *
 * Sets no blend or depth state: the record describes the pass it runs in (after
 * entities: normal alpha, depth test and write). Scene fog applies.
 */
export class RsmEffect {
	/**
	 * @param {Object} spec    EffectTable entry
	 * @param {number} [spec.size]
	 * @param {Object} inst
	 * @param {ArrayLike<number>} inst.position
	 * @param {number} [inst.startTick]
	 * @param {number} [inst.endTick]  −1 / ≤ 0: open-ended
	 * @param {{position: ArrayLike<number>}} [inst.follow]  entity followed every frame (attachedEntity)
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 * @param {{model: Object}} ports  parsed RSM (loader output)
	 */
	constructor(spec, inst, { model }) {
		this.position = [inst.position[0], inst.position[1], inst.position[2]];
		this.follow = inst.follow ?? null;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, false);
		this.size = spec.size || 1;
		this.startTick = inst.startTick || 0;
		this.endTick = inst.endTick ?? -1;
		this.finished = false;
		this.model = model;
		this.animLen = model.animLen || 0;
		this.fps = model.frameRatePerSecond || RSM_DEFAULT_FPS;
		this.isAnimated = model.nodes.some(
			n => n.rotKeyframes?.length > 0 || n.posKeyframes?.length > 0 || n.scaleKeyFrames?.length > 0
		);
		this.lastFrame = -1;

		model.createInstance(
			{
				position: new Float32Array(3),
				rotation: new Float32Array(3),
				scale: new Float32Array(RSM_EFFECT_SCALE),
				filename: null
			},
			0,
			0
		);
		const compiled = model.compile();
		const { buffer, objects } = rsmMergeMeshes(compiled.meshes, compiled.textures);
		this.buffer = buffer;
		this.objects = objects;
	}

	/**
	 * Rebuild the mesh at a keyframe; every object takes its own mesh's texture (#56).
	 * @param {number} frame
	 */
	rebuild(frame) {
		const meshes = [];
		for (const node of this.model.nodes) {
			for (const instance of this.model.instances) {
				meshes.push(rsmNodeMeshAtFrame(node, instance, frame, this.model.animLen));
			}
		}
		const { buffer, objects } = rsmMergeMeshes(meshes, this.model.textures);
		this.buffer = buffer;
		this.objects = objects;
	}

	/**
	 * The records of one frame (one per object whose texture did not fail).
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}, textureFailed?: (texture: string) => boolean}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]  also appended to, when given
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>[]}
	 */
	frame(tick, { sceneFog, textureFailed = () => false } = {}, stream) {
		if (this.finished || (this.endTick > 0 && tick > this.endTick)) {
			this.finished = true;
			return [];
		}
		if (this.isAnimated && this.animLen > 0) {
			const frame = Math.floor((((tick - this.startTick) * this.fps) / 1000) % this.animLen);
			if (frame !== this.lastFrame) {
				this.rebuild(frame);
				this.lastFrame = frame;
			}
		}
		const source = this.follow ? this.follow.position : this.position;
		const out = [];
		this.objects.forEach((object, i) => {
			if (textureFailed(object.texture)) {
				return;
			}
			const start = object.vertOffset * RSM_VERTEX_STRIDE;
			/** @type {RsmParams} */
			const params = {
				object: i,
				size: this.size,
				frame: this.lastFrame === -1 ? null : this.lastFrame,
				vertOffset: object.vertOffset,
				vertCount: object.vertCount,
				vertices: this.buffer.slice(start, start + object.vertCount * RSM_VERTEX_STRIDE)
			};
			const record = createEffectDraw({
				family: 'rsm',
				pass: this.pass,
				texture: object.texture,
				position: [source[0], source[1], source[2]],
				color: [1, 1, 1, 1],
				blend: BLEND_NORMAL,
				depthTest: true,
				depthWrite: true,
				depthCorrection: false,
				fog: Boolean(sceneFog && sceneFog.use),
				params
			});
			stream?.effect(record);
			out.push(record);
		});
		return out;
	}
}
