import { chain, deg2rad, rotationX, rotationY, rotationZ, scaling, translation } from '../math.js';
import { clamp01 } from '../math.js';
import { NotImplementedError } from '../errors.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * CPU reference of shaders/models.frag (R-MAP-012), also used for animated
 * models (R-MAP-013 [FLAG → fixed]: animated RSM now honours the lightmap
 * preference exactly like static RSM). Returns null when discarded (tex.a == 0).
 * @param {{tex: number[], modelAlpha: number, normal: number[], light: {dir: number[], diffuse: number[], ambient: number[], env: number[]}, lightmapPref: boolean}} f
 */
export function shadeModel(f) {
	if (f.tex[3] === 0) {
		return null;
	}
	const nl = f.lightmapPref ? Math.max(dot(f.normal, f.light.dir), 0) : 1;
	const rgb = f.tex.slice(0, 3).map((c, i) => c * clamp01(nl * f.light.diffuse[i] + f.light.ambient[i]) * clamp01(f.light.env[i]));
	return [...rgb, f.tex[3] * f.modelAlpha];
}

/** R-MAP-012: RSM ≥ 1.4 (and RSM2) store alpha as a byte /255. */
export function rsmAlpha(raw, version) {
	return version >= 1.4 ? raw / 255 : raw;
}

/** R-MAP-012: depth test + write on, global alpha blend on, no translucent sorting. */
export const MODEL_PASS_STATE = Object.freeze({ depthTest: true, depthWrite: true, blend: Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' }) });

/**
 * R-MAP-014: T(pos + mapOffset)·RotZ·RotX·RotY·Scale; RSM ≥ 2.2 appends
 * ·Scale(flip)·T(offset)·T(0, box.range.y, 0)·T(box.offset).
 * @param {{pos: number[], mapOffset: number[], rot: number[], scale: number[], version: number, flip?: number[], offset?: number[], boxRangeY?: number, boxOffset?: number[]}} m
 */
export function rsmInstanceMatrix(m) {
	const p = m.pos.map((v, i) => v + m.mapOffset[i]);
	const base = [
		translation(p[0], p[1], p[2]),
		rotationZ(deg2rad(m.rot[2])),
		rotationX(deg2rad(m.rot[0])),
		rotationY(deg2rad(m.rot[1])),
		scaling(m.scale[0], m.scale[1], m.scale[2])
	];
	if (m.version >= 2.2) {
		const f = m.flip ?? [1, 1, 1];
		const o = m.offset ?? [0, 0, 0];
		const bo = m.boxOffset ?? [0, 0, 0];
		base.push(scaling(f[0], f[1], f[2]), translation(o[0], o[1], o[2]), translation(0, m.boxRangeY ?? 0, 0), translation(bo[0], bo[1], bo[2]));
	}
	return chain(...base);
}

/** R-MAP-015: shadeType selector; unknown values are treated as NONE. */
export function normalMode(shadeType) {
	return { 0: 'none', 1: 'flat', 2: 'smooth' }[shadeType] ?? 'none';
}

/**
 * R-MAP-015: generate normals (NONE constant, FLAT per face, SMOOTH averaged per smoothGroup).
 * @returns {never}
 */
export function computeRsmNormals() {
	throw new NotImplementedError('R-MAP-015 normal generation');
}

/**
 * R-PERF-004: merge static RSM draws by texture over contiguous vertex ranges,
 * once all textures have loaded. Infos arrive sorted by texture (§3.2).
 * @param {{texture: string, vertOffset: number, vertCount: number}[]} infos
 * @param {boolean} allTexturesLoaded
 */
export function batchStaticModels(infos, allTexturesLoaded) {
	if (!allTexturesLoaded) {
		return infos.map(i => ({ ...i }));
	}
	/** @type {{texture: string, vertOffset: number, vertCount: number}[]} */
	const out = [];
	for (const info of infos) {
		const last = out[out.length - 1];
		if (last && last.texture === info.texture && last.vertOffset + last.vertCount === info.vertOffset) {
			last.vertCount += info.vertCount;
		} else {
			out.push({ texture: info.texture, vertOffset: info.vertOffset, vertCount: info.vertCount });
		}
	}
	return out;
}
