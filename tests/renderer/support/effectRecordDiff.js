/**
 * Field-by-field diff of one legacy native EffectDraw-shaped record against one
 * render-records EffectDraw (Cylinder / QuadHorn record diffs).
 *
 * Numbers compare with tolerance 1e-5, relative above magnitude 1 (legacy keeps colours
 * and matrices in Float32Array). NaN equals NaN. Texture: the legacy GL texture object
 * ({ id: path } in the tests' WebGL mock) against the render-records texture key (path).
 * params must have the same key set on both sides.
 */
const EPSILON = 1e-5;

export const close = (l, m) => Object.is(l, m) || Math.abs(l - m) <= EPSILON * Math.max(1, Math.abs(m));

const isVec = v => Array.isArray(v) || ArrayBuffer.isView(v);

function diffValue(name, l, m, out) {
	if (isVec(l) || isVec(m)) {
		if (!isVec(l) || !isVec(m) || l.length !== m.length || Array.from(l).some((v, i) => !close(v, m[i]))) {
			out.push(`${name}: ${l && Array.from(l)} vs ${m && Array.from(m)}`);
		}
	} else if (typeof l === 'number' && typeof m === 'number') {
		if (!close(l, m)) {
			out.push(`${name}: ${l} vs ${m}`);
		}
	} else if (l !== m) {
		out.push(`${name}: ${String(l)} vs ${String(m)}`);
	}
}

/**
 * @param {object} l legacy record
 * @param {object} m render-records record
 * @returns {string[]} mismatches
 */
export function diffEffectRecord(l, m) {
	const out = [];
	for (const f of ['kind', 'family', 'pass', 'depthTest', 'depthWrite', 'depthCorrection', 'fog', 'strAttachment']) {
		diffValue(f, l[f], m[f], out);
	}
	diffValue('texture', l.texture?.id, m.texture, out);
	diffValue('position', l.position, m.position, out);
	diffValue('color', l.color, m.color, out);
	if (JSON.stringify(l.blend) !== JSON.stringify(m.blend)) {
		out.push(`blend: ${JSON.stringify(l.blend)} vs ${JSON.stringify(m.blend)}`);
	}
	const keys = new Set([...Object.keys(l.params), ...Object.keys(m.params)]);
	for (const k of keys) {
		if (!(k in l.params) || !(k in m.params)) {
			out.push(`params.${k}: only on ${k in l.params ? 'legacy' : 'render-records'}`);
			continue;
		}
		diffValue(`params.${k}`, l.params[k], m.params[k], out);
	}
	return out;
}
