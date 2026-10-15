import { GL } from '../../pipeline/glEnums.js';
import { POT_CLASSES } from '../../constants.js';
import { resolveIncludes } from '../../shaders/index.js';
import { rotationAboutAxis, normalMatrix } from './legacyMatrix.js';
import {
	QUAD_XY,
	QUAD_XY_HALF,
	QUAD_XZ,
	SPRAY_CORNERS,
	cylinderMesh,
	groundRingMesh,
	quadHornMesh,
	swirlingAuraIndices
} from './meshes.js';
import tileVert from '../../shaders/effects/tile.vert?raw';
import tileFrag from '../../shaders/effects/tile.frag?raw';
import colorTileVert from '../../shaders/effects/colorTile.vert?raw';
import colorTileFrag from '../../shaders/effects/colorTile.frag?raw';
import ringVert from '../../shaders/effects/ring.vert?raw';
import ringFrag from '../../shaders/effects/ring.frag?raw';
import cylinderVert from '../../shaders/effects/cylinder.vert?raw';
import cylinderFrag from '../../shaders/effects/cylinder.frag?raw';
import quadhornVert from '../../shaders/effects/quadhorn.vert?raw';
import quadhornFrag from '../../shaders/effects/quadhorn.frag?raw';
import sphereVert from '../../shaders/effects/sphere.vert?raw';
import sphereFrag from '../../shaders/effects/sphere.frag?raw';
import lockOnVert from '../../shaders/effects/lockOn.vert?raw';
import lockOnFrag from '../../shaders/effects/lockOn.frag?raw';
import magicTargetVert from '../../shaders/effects/magicTarget.vert?raw';
import magicTargetFrag from '../../shaders/effects/magicTarget.frag?raw';
import groundAuraVert from '../../shaders/effects/groundAura.vert?raw';
import groundAuraFrag from '../../shaders/effects/groundAura.frag?raw';
import swirlingAuraVert from '../../shaders/effects/swirlingAura.vert?raw';
import swirlingAuraFrag from '../../shaders/effects/swirlingAura.frag?raw';
import level99BubbleVert from '../../shaders/effects/level99Bubble.vert?raw';
import level99BubbleFrag from '../../shaders/effects/level99Bubble.frag?raw';
import rsmVert from '../../shaders/effects/rsm.vert?raw';
import rsmFrag from '../../shaders/effects/rsm.frag?raw';
import waterfallVert from '../../shaders/effects/waterfall.vert?raw';
import waterfallFrag from '../../shaders/effects/waterfall.frag?raw';
import waterfallSprayVert from '../../shaders/effects/waterfallSpray.vert?raw';
import waterfallSprayFrag from '../../shaders/effects/waterfallSpray.frag?raw';
import rainPuddleVert from '../../shaders/effects/rainPuddle.vert?raw';
import rainPuddleFrag from '../../shaders/effects/rainPuddle.frag?raw';

/**
 * @typedef {Object} MeshProgram  One GL program of the mesh effect pipeline
 * @property {string} id
 * @property {string} vert  GLSL with a `#pragma attributes` line (replaced by the declarations)
 * @property {string} frag
 * @property {'instanced'|'stream'} mode
 *   instanced: a static mesh (or gl_VertexID corners) × one instance per record (or per
 *   `instances(record)`); stream: each record writes its own vertices, the record fields
 *   repeated on every vertex (per-record vertex data)
 * @property {number} primitive  GL.TRIANGLES or GL.TRIANGLE_STRIP
 * @property {ReadonlyArray<[string, number]>} vertex  per-vertex fields (name, size)
 * @property {ReadonlyArray<[string, number]>} instance  per-record fields (name, size)
 * @property {(record: any) => {key: string, data: ArrayLike<number>|null, count: number}} [mesh]  instanced
 * @property {(record: any) => number} [instances]  instanced: instances of one record (default 1)
 * @property {(record: any) => number} [vertices]  stream: vertices of one record
 * @property {(record: any, tex: number[], out: Float32Array, o: number, view?: any) => number} pack
 *   instanced: writes the record's instance(s); stream: writes the record's vertices
 * @property {boolean} [textured]  default true
 * @property {ReadonlyArray<string>} [uniforms]  extra per-pass uniforms
 * @property {(gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation|null>, view: any) => void} [frame]
 */

/** Texture field of an instance: array layer (−1: not resident), POT class, size / class. */
export function textureField(slot, out = [0, 0, 0, 0]) {
	const classSize = POT_CLASSES[slot.classIndex ?? 0];
	out[0] = slot.layer;
	out[1] = slot.classIndex ?? 0;
	out[2] = (slot.width ?? classSize) / classSize;
	out[3] = (slot.height ?? classSize) / classSize;
	return out;
}

/** @param {Float32Array} out @param {number} o @param {ArrayLike<number>} v @param {number} n */
function put(out, o, v, n) {
	for (let i = 0; i < n; i++) {
		out[o + i] = v[i];
	}
	return o + n;
}

/** @param {Float32Array} out @param {number} o */
function put4(out, o, a, b = 0, c = 0, d = 0) {
	out[o] = a;
	out[o + 1] = b;
	out[o + 2] = c;
	out[o + 3] = d;
	return o + 4;
}

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const ZERO3 = Object.freeze([0, 0, 0]);
const fog = record => (record.fog ? 1 : 0);
const staticMesh = (key, data, count) => () => ({ key, data, count });
const mat4Fields = prefix => [0, 1, 2, 3].map(i => /** @type {[string, number]} */ ([`${prefix}${i}`, 4]));

/** Effect texture of a record is resident and sampled; `tex` comes from textureField. */
const quadMesh = staticMesh('quadXY', QUAD_XY, 6);

/** @type {MeshProgram} */
const TILE = {
	id: 'tile',
	vert: tileVert,
	frag: tileFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 2],
		['aTextureCoord', 2]
	],
	instance: [
		['iPosition', 4],
		['iShade', 4],
		['iTex', 4]
	],
	mesh: quadMesh,
	pack(r, tex, out, o) {
		// Tiles.fs keeps texels with every channel ≥ 0.1 and takes the record alpha (flat
		// tiles: uSize and alpha never set, 0); LPEffect/SpiderWeb.fs: ≥ 0.5, alpha 0.7.
		const threshold = r.family === 'lp' || r.family === 'spider-web' ? 0.5 : 0.1;
		o = put4(out, o, r.position[0], r.position[1], r.position[2], r.params?.size ?? 0);
		o = put4(out, o, threshold, r.color[3], fog(r));
		return put(out, o, tex, 4);
	}
};

/** @type {MeshProgram} */
const COLOR_TILE = {
	id: 'colorTile',
	vert: colorTileVert,
	frag: colorTileFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	textured: false,
	// Legacy binds the x, y, u, v quad and reads x, y only.
	vertex: [
		['aPosition', 2],
		['_uv', 2]
	],
	instance: [
		['iPosition', 4],
		['iColor', 4]
	],
	mesh: quadMesh,
	pack(r, _tex, out, o) {
		o = put4(out, o, r.position[0], r.position[1], r.position[2], r.params?.size ?? 0.5);
		return put(out, o, r.color, 4);
	}
};

const ringMeshData = groundRingMesh();

/** @type {MeshProgram} */
const RING = {
	id: 'ring',
	vert: ringVert,
	frag: ringFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aTextureCoord', 2]
	],
	instance: [['iPosition', 4], ['iShape', 4], ...mat4Fields('iRotation'), ['iTex', 4]],
	mesh: staticMesh('ring', ringMeshData, ringMeshData.length / 5),
	pack(r, tex, out, o) {
		const p = r.params;
		o = put4(out, o, r.position[0], r.position[1], r.position[2], fog(r));
		o = put4(out, o, p.topSize, p.bottomSize, p.height, r.color[3]);
		o = put(out, o, p.rotation ?? IDENTITY, 16);
		return put(out, o, tex, 4);
	}
};

/** @type {Map<string, Float32Array>} cylinder shape → mesh */
const cylinderMeshes = new Map();

/** @type {MeshProgram} */
const CYLINDER = {
	id: 'cylinder',
	vert: cylinderVert,
	frag: cylinderFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aTextureCoord', 2]
	],
	instance: [['iPosition', 4], ['iShape', 4], ...mat4Fields('iRotation'), ['iColor', 4], ['iMisc', 4], ['iTex', 4]],
	mesh(r) {
		const p = r.params;
		const key = `cylinder:${p.totalCircleSides}/${p.circleSides}/${p.repeatTextureX}`;
		let data = cylinderMeshes.get(key);
		if (!data) {
			data = cylinderMesh(p.totalCircleSides, p.circleSides, p.repeatTextureX);
			cylinderMeshes.set(key, data);
		}
		return { key, data, count: data.length / 5 };
	},
	pack(r, tex, out, o) {
		const p = r.params;
		// Legacy drawCylinderRecord uploads uBottomSize = baseBottomSize, then overrides it
		// (animations 3 and 4); the values left at the draw are the record's animated ones.
		o = put4(out, o, r.position[0], r.position[1], r.position[2], p.zIndex);
		o = put4(out, o, p.topSize, p.bottomSize, p.height, p.rotate ? 1 : 0);
		o = put(out, o, p.rotation ?? IDENTITY, 16);
		o = put(out, o, r.color, 4);
		o = put4(out, o, fog(r));
		return put(out, o, tex, 4);
	}
};

const AXIS_X = Object.freeze([1, 0, 0]);
const AXIS_Y = Object.freeze([0, 1, 0]);
const AXIS_Z = Object.freeze([0, 0, 1]);
const _rotation = new Float32Array(16);

/** The 3×3 block of a legacy `mat4.rotate(identity, rad, axis)`, column by column. */
function putRotation3(out, o, rad, axis) {
	const m = rotationAboutAxis(rad, axis, _rotation);
	for (let c = 0; c < 3; c++) {
		out[o++] = m[c * 4];
		out[o++] = m[c * 4 + 1];
		out[o++] = m[c * 4 + 2];
	}
	return o;
}

const quadHornMeshData = quadHornMesh();

/** @type {MeshProgram} */
const QUADHORN = {
	id: 'quadhorn',
	vert: quadhornVert,
	frag: quadhornFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aTextureCoord', 2]
	],
	instance: [
		['iPosition', 4],
		['iOffset', 4],
		['iRotX0', 3],
		['iRotX1', 3],
		['iRotX2', 3],
		['iRotY0', 3],
		['iRotY1', 3],
		['iRotY2', 3],
		['iRotZ0', 3],
		['iRotZ1', 3],
		['iRotZ2', 3],
		['iColor', 4],
		['iMisc', 4],
		['iTex', 4]
	],
	mesh: staticMesh('quadhorn', quadHornMeshData, 12),
	pack(r, tex, out, o) {
		const p = r.params;
		// Legacy uploads uOffsetZ = offsetZ, then the animationOut sink's value when set.
		const offsetZ = p.sinkOffsetZ ?? p.offsetZ;
		o = put4(out, o, r.position[0], r.position[1], r.position[2], p.height);
		o = put4(out, o, p.offsetX, p.offsetY, offsetZ, p.bottomSize);
		o = putRotation3(out, o, (p.rotateX * Math.PI) / 180, AXIS_X);
		o = putRotation3(out, o, (p.rotateY * Math.PI) / 180, AXIS_Y);
		o = putRotation3(out, o, ((180 + p.rotateZ) * Math.PI) / 180, AXIS_Z);
		o = put(out, o, r.color, 4);
		o = put4(out, o, fog(r));
		return put(out, o, tex, 4);
	}
};

/** @type {MeshProgram} */
const SPHERE = {
	id: 'sphere',
	vert: sphereVert,
	frag: sphereFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 2],
		['aTextureCoord', 2]
	],
	instance: [
		['iPosition', 4],
		['iDepth', 4],
		...mat4Fields('iTexRot'),
		...mat4Fields('iRotation'),
		['iColor', 4],
		['iTex', 4]
	],
	mesh: quadMesh,
	pack(r, tex, out, o) {
		const p = r.params;
		o = put4(out, o, r.position[0], r.position[1], r.position[2], p.size);
		o = put4(out, o, p.zIndex, p.cameraZoom);
		o = put(out, o, p.textureRotation ?? IDENTITY, 16);
		o = put(out, o, p.rotation ?? IDENTITY, 16);
		o = put(out, o, r.color, 4);
		return put(out, o, tex, 4);
	}
};

/** @type {MeshProgram} */
const LOCK_ON = {
	id: 'lockOn',
	vert: lockOnVert,
	frag: lockOnFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 2],
		['aTextureCoord', 2]
	],
	instance: [['iPosition', 4], ...mat4Fields('iRotation'), ['iMisc', 4], ['iTex', 4]],
	mesh: staticMesh('quadXYHalf', QUAD_XY_HALF, 6),
	pack(r, tex, out, o) {
		const p = r.params;
		o = put4(out, o, r.position[0], r.position[1], r.position[2], p.size);
		o = put(out, o, p.rotation ?? IDENTITY, 16);
		o = put4(out, o, p.shade, fog(r));
		return put(out, o, tex, 4);
	}
};

/** @type {MeshProgram} */
const MAGIC_TARGET = {
	id: 'magicTarget',
	vert: magicTargetVert,
	frag: magicTargetFrag,
	mode: 'stream',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aTextureCoord', 2]
	],
	instance: [...mat4Fields('iRotation'), ['iMisc', 4], ['iTex', 4]],
	// The plane comes from the record (params.vertices, built by the world/altitude layer
	// or the legacy record adapter); without it nothing is drawn.
	vertices: r => (r.params.vertices ? (r.params.vertexCount ?? r.params.vertices.length / 5) : 0),
	pack(r, tex, out, o) {
		const p = r.params;
		const plane = p.vertices;
		const count = MAGIC_TARGET.vertices(r);
		for (let v = 0; v < count; v++) {
			o = put(out, o, plane.subarray ? plane.subarray(v * 5, v * 5 + 5) : plane.slice(v * 5, v * 5 + 5), 5);
			o = put(out, o, p.rotation ?? IDENTITY, 16);
			o = put4(out, o, p.cameraLatitude, fog(r));
			o = put(out, o, tex, 4);
		}
		return o;
	}
};

/** @type {MeshProgram} */
const GROUND_AURA = {
	id: 'groundAura',
	vert: groundAuraVert,
	frag: groundAuraFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aTextureCoord', 2]
	],
	instance: [
		['iPosition', 4],
		['iShape', 4],
		['iColor', 4],
		['iTex', 4]
	],
	mesh: staticMesh('quadXZ', QUAD_XZ, 6),
	pack(r, tex, out, o) {
		const p = r.params;
		o = put4(out, o, r.position[0], r.position[1], r.position[2]);
		o = put4(out, o, p.size[0], p.size[1], p.angle, p.zIndex);
		o = put(out, o, r.color, 4);
		return put(out, o, tex, 4);
	}
};

const SWIRL_INDICES = swirlingAuraIndices();

/** @type {MeshProgram} */
const SWIRLING_AURA = {
	id: 'swirlingAura',
	vert: swirlingAuraVert,
	frag: swirlingAuraFrag,
	mode: 'stream',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aTextureCoord', 2]
	],
	instance: [
		['iTranslation', 4],
		['iColor', 4],
		['iMisc', 4],
		['iTex', 4]
	],
	// Legacy drawElements(TRIANGLES, indexCount): the same triangles, vertices in index order.
	vertices: r => r.params.indexCount ?? SWIRL_INDICES.length,
	pack(r, tex, out, o) {
		const p = r.params;
		const verts = p.vertices;
		const count = SWIRLING_AURA.vertices(r);
		for (let i = 0; i < count; i++) {
			const v = SWIRL_INDICES[i] * 5;
			for (let k = 0; k < 5; k++) {
				out[o++] = verts[v + k];
			}
			o = put4(out, o, r.position[0], r.position[1], r.position[2]);
			o = put(out, o, r.color, 4);
			o = put4(out, o, p.zIndex, fog(r));
			o = put(out, o, tex, 4);
		}
		return o;
	}
};

/** @type {MeshProgram} */
const LEVEL99_BUBBLE = {
	id: 'level99Bubble',
	vert: level99BubbleVert,
	frag: level99BubbleFrag,
	mode: 'stream',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aTextureCoord', 2]
	],
	instance: [
		['iColor', 4],
		['iMisc', 4],
		['iTex', 4]
	],
	vertices: r => r.params.vertexCount ?? 6,
	pack(r, tex, out, o) {
		const p = r.params;
		const count = LEVEL99_BUBBLE.vertices(r);
		for (let v = 0; v < count; v++) {
			for (let k = 0; k < 5; k++) {
				out[o++] = p.quad[v * 5 + k];
			}
			o = put(out, o, r.color, 4);
			o = put4(out, o, p.zIndex, fog(r));
			o = put(out, o, tex, 4);
		}
		return o;
	}
};

/** Legacy RsmEffect `_light` (a constant of the family, not carried by records). */
const RSM_LIGHT = Object.freeze({
	opacity: 1.0,
	ambient: new Float32Array([Math.PI, Math.PI, Math.PI]),
	diffuse: new Float32Array([0, 0, 0]),
	direction: new Float32Array([0, 1, 0])
});
const _normalMat = new Float32Array(9);

/** @type {MeshProgram} */
const RSM = {
	id: 'rsm',
	vert: rsmVert,
	frag: rsmFrag,
	mode: 'stream',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aVertexNormal', 3],
		['aTextureCoord', 2],
		['aAlpha', 1]
	],
	instance: [
		['iPosition', 4],
		['iMisc', 4],
		['iTex', 4]
	],
	vertices: r => r.params.vertCount,
	pack(r, tex, out, o) {
		const p = r.params;
		const verts = p.vertices;
		for (let v = 0; v < p.vertCount; v++) {
			for (let k = 0; k < 9; k++) {
				out[o++] = verts[v * 9 + k];
			}
			o = put4(out, o, r.position[0], r.position[1], r.position[2], p.size);
			o = put4(out, o, fog(r));
			o = put(out, o, tex, 4);
		}
		return o;
	},
	uniforms: ['uNormalMat', 'uLightDirection', 'uLightAmbient', 'uLightDiffuse', 'uLightOpacity'],
	frame(gl, u, view) {
		// Legacy beforeRender: mat4.toInverseMat3(modelView) then mat3.transpose. A singular
		// model-view leaves legacy's previous matrix; it never happens with a camera.
		const normal = normalMatrix(view?.modelView ?? IDENTITY, _normalMat) ?? _normalMat;
		gl.uniformMatrix3fv(u.uNormalMat, false, normal);
		gl.uniform3fv(u.uLightDirection, RSM_LIGHT.direction);
		gl.uniform1f(u.uLightOpacity, RSM_LIGHT.opacity);
		gl.uniform3fv(u.uLightAmbient, RSM_LIGHT.ambient);
		gl.uniform3fv(u.uLightDiffuse, RSM_LIGHT.diffuse);
	}
};

/** @type {MeshProgram} */
const WATERFALL = {
	id: 'waterfall',
	vert: waterfallVert,
	frag: waterfallFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLE_STRIP,
	vertex: [],
	instance: [
		['iCornerX', 4],
		['iCornerY', 4],
		['iCornerZ', 4],
		['iCornerU', 4],
		['iCornerV', 4],
		...mat4Fields('iModel'),
		['iMisc', 4],
		['iTex', 4]
	],
	// No vertex buffer: the strip corner is gl_VertexID (legacy draws 4 strip vertices).
	mesh: staticMesh('strip4', null, 4),
	pack(r, tex, out, o) {
		const p = r.params;
		const v = p.vertices;
		for (let field = 0; field < 5; field++) {
			for (let corner = 0; corner < 4; corner++) {
				out[o++] = v[corner * 5 + field];
			}
		}
		o = put(out, o, p.modelMatrix ?? IDENTITY, 16);
		o = put4(out, o, r.color[3], fog(r));
		return put(out, o, tex, 4);
	}
};

/** @type {MeshProgram} */
const WATERFALL_SPRAY = {
	id: 'waterfallSpray',
	vert: waterfallSprayVert,
	frag: waterfallSprayFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLE_STRIP,
	vertex: [['aCorner', 2]],
	instance: [['aSeed', 4], ...mat4Fields('iModel'), ['iMisc', 4], ['iColor', 4], ['iTex', 4]],
	mesh: staticMesh('sprayCorners', SPRAY_CORNERS, 4),
	instances: r => r.params.instanceCount ?? 0,
	pack(r, tex, out, o) {
		const p = r.params;
		const n = WATERFALL_SPRAY.instances(r);
		for (let i = 0; i < n; i++) {
			o = put(out, o, p.seeds.subarray ? p.seeds.subarray(i * 4, i * 4 + 4) : p.seeds.slice(i * 4, i * 4 + 4), 4);
			o = put(out, o, p.modelMatrix ?? IDENTITY, 16);
			o = put4(out, o, p.time, p.size, fog(r));
			o = put(out, o, r.color, 4);
			o = put(out, o, tex, 4);
		}
		return o;
	}
};

/** @type {MeshProgram} */
const RAIN_PUDDLE = {
	id: 'rainPuddle',
	vert: rainPuddleVert,
	frag: rainPuddleFrag,
	mode: 'instanced',
	primitive: GL.TRIANGLES,
	vertex: [
		['aPosition', 3],
		['aTextureCoord', 2]
	],
	instance: [
		['iPosition', 4],
		['iShape', 4],
		['iColor', 4],
		['iCamera', 4],
		['iTex', 4]
	],
	mesh: staticMesh('quadXZ', QUAD_XZ, 6),
	pack(r, tex, out, o, view) {
		const p = r.params;
		// Legacy uploads uSize = (size, size) and the camera position of the pass
		// (Camera.position): params.cameraPosition (legacy record adapter), else the
		// pass view's cameraPosition.
		const camera = p.cameraPosition ?? view?.cameraPosition ?? ZERO3;
		o = put4(out, o, r.position[0], r.position[1], r.position[2], p.size);
		o = put4(out, o, p.angle, p.zIndex, p.time, fog(r));
		o = put(out, o, r.color, 4);
		o = put4(out, o, camera[0], camera[1], camera[2]);
		return put(out, o, tex, 4);
	}
};

/** Every mesh program by id. */
export const MESH_PROGRAMS = Object.freeze(
	Object.fromEntries(
		[
			TILE,
			COLOR_TILE,
			RING,
			CYLINDER,
			QUADHORN,
			SPHERE,
			LOCK_ON,
			MAGIC_TARGET,
			GROUND_AURA,
			SWIRLING_AURA,
			LEVEL99_BUBBLE,
			RSM,
			WATERFALL,
			WATERFALL_SPRAY,
			RAIN_PUDDLE
		].map(p => [p.id, p])
	)
);

/**
 * Vertex shader source with the program's attribute declarations in place of
 * `#pragma attributes`: vertex fields first, then instance fields, locations in order.
 * @param {MeshProgram} program
 */
export function vertexSource(program) {
	const type = size => (size === 1 ? 'float' : `vec${size}`);
	const lines = [...program.vertex, ...program.instance].map(
		([name, size], location) => `layout(location = ${location}) in ${type(size)} ${name};`
	);
	return program.vert.replace(/^#pragma attributes\s*$/m, lines.join('\n'));
}

/** @param {MeshProgram} program */
export function fragmentSource(program) {
	return resolveIncludes(program.frag);
}
