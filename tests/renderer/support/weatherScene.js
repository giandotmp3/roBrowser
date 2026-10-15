/**
 * Shared fixtures for the weather / sky / waterfall GL snapshot tests and record diffs
 * (Rain, Snow, Sakura, PokJuk, CloudWeather, Sky, Waterfall).
 *
 * - makeGl(): fake WebGL context. Created textures and buffers are named objects
 *   ({ id }), isTexture() answers for them, and an optional logger receives every call.
 * - Terrain, camera and player stand-ins (non-uniform, moving every frame).
 * - Synthetic SPR/ACT resources for the snow / sakura / maple sprites.
 * - diffSpriteRecord(): field-by-field diff of a legacy SpriteRenderer native record
 *   against a render-records SpriteDraw (tolerance 1e-5, relative above magnitude 1).
 */
import { createHash } from 'node:crypto';

const isTypedOrArray = v => Array.isArray(v) || ArrayBuffer.isView(v);

/** JSON-friendly view of one GL call argument. */
export const serialize = v =>
	v === null || v === undefined || typeof v !== 'object'
		? v
		: isTypedOrArray(v)
			? Array.from(v, Number)
			: (v.id ?? '[obj]');

/**
 * Fake GL context. Constants resolve to their names; createTexture / createBuffer
 * return { id } objects; isTexture is true for created, undeleted textures.
 *
 * @param {function} [onCall] (name, args) for every method call
 * @returns {object} gl
 */
export function makeGl(onCall) {
	let textures = 0;
	let buffers = 0;
	const live = new Set();
	const methods = {
		createTexture: () => {
			const t = { id: `texture${++textures}` };
			live.add(t);
			return t;
		},
		createBuffer: () => ({ id: `buffer${++buffers}` }),
		deleteTexture: t => live.delete(t),
		isTexture: t => live.has(t)
	};
	return new Proxy(
		{},
		{
			get(_t, k) {
				if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) {
					return k;
				}
				return (...args) => {
					if (onCall) {
						onCall(k, args);
					}
					return methods[k] ? methods[k](...args) : undefined;
				};
			}
		}
	);
}

/**
 * Streaming GL call logger: hashes every call and keeps the calls a filter selects.
 * @param {function} [keep] (name, args) => boolean
 */
export function makeGlLog(keep = () => false) {
	const hash = createHash('sha256');
	const kept = [];
	let count = 0;
	const onCall = (name, args) => {
		const entry = [name, ...args.map(serialize)];
		hash.update(JSON.stringify(entry));
		count++;
		if (keep(name, args)) {
			kept.push(entry);
		}
	};
	return {
		onCall,
		mark: label => {
			hash.update(`@${JSON.stringify(label)}`);
			count++;
		},
		summary: () => ({ calls: count, sha256: hash.digest('hex'), kept })
	};
}

export const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const PROJECTION = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);

/** Scene fog of frame i (exists on two frames out of three). */
export function fogAt(i) {
	return { use: true, exist: i % 3 !== 0, near: 10 + (i % 7), far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };
}

/** Altitude.getCellHeight stand-in (non-uniform terrain). */
export const cellHeight = (x, y) => 0.1 * x - 0.05 * y + 0.25;

/** Player position of a tick (the weather emitters follow Session.Entity). */
export function playerAt(tick) {
	return [100 + tick / 400, 120 - tick / 900, -1.5 + tick / 20000];
}

/** Camera.angle [pitch, yaw] of a tick. */
export function cameraAngleAt(tick) {
	return [200 + (tick % 70), (tick / 37) % 360];
}

/** Camera.modelView of a tick: a rotation about Y and X plus a translation. */
export function modelViewAt(tick) {
	const a = (tick / 3000) % (2 * Math.PI);
	const b = 0.6 + 0.2 * Math.sin(tick / 5000);
	const ca = Math.cos(a);
	const sa = Math.sin(a);
	const cb = Math.cos(b);
	const sb = Math.sin(b);
	// column-major: Rx(b) * Ry(a)
	return new Float32Array([ca, sa * sb, -sa * cb, 0, 0, cb, sb, 0, sa, -ca * sb, ca * cb, 0, -100, 20, -150, 1]);
}

const tex = id => ({ id });

function frame(id, width, height) {
	return { texture: tex(id), width, height };
}

function sprLayer(fields) {
	return {
		index: 0,
		spr_type: 0,
		scale: [1, 1],
		is_mirror: false,
		color: [1, 1, 1, 1],
		angle: 0,
		pos: [0, 0],
		...fields
	};
}

/**
 * Snow-like sprite: indexed frames 0..1, RGBA frames from 2 (old_rgba_index 2).
 * Layers cover the indexed, RGBA (spr_type 1), mirrored, skipped (index -1) and
 * alpha-0 branches of the weather renderLayer.
 */
const SNOW_SPR = {
	frames: [frame('snow:0', 16, 16), frame('snow:1', 12, 20), frame('snow:2', 8, 8), frame('snow:3', 10, 6)],
	palette: new Uint8Array(4),
	texture: tex('snow:pal'),
	rgba_index: 2,
	old_rgba_index: 2
};
const SNOW_ACT = {
	actions: [
		{
			delay: 90,
			animations: [0, 1, 2].map(f => ({
				layers: [
					sprLayer({ index: f % 2, angle: 5 * f, pos: [1, -2], color: [1, 0.9, 0.8, 0.9] }),
					sprLayer({ index: 1, spr_type: 1, scale: [0.5, 1.5], is_mirror: true, angle: -15, pos: [-3, 2] }),
					sprLayer({ index: -1 }),
					sprLayer({ index: 0, color: [1, 1, 1, f === 2 ? 0 : 0.5], scale: [2, 2] })
				]
			}))
		}
	]
};

/** Sakura sprite: RGBA only (rgba_index 0), delay 0 (falls back to 150 ms). */
const SAKURA_SPR = {
	frames: [frame('sakura:0', 14, 14), frame('sakura:1', 18, 10)],
	palette: null,
	texture: tex('sakura:pal'),
	rgba_index: 0,
	old_rgba_index: 0
};
const SAKURA_ACT = {
	actions: [
		{
			delay: 0,
			animations: [0, 1].map(f => ({
				layers: [sprLayer({ index: f, angle: 30 * f, pos: [f, -f] }), sprLayer({ index: 1 - f, is_mirror: f === 1 })]
			}))
		}
	]
};

/** Maple sprite: one indexed frame, no animations (frameCount falls back to 1). */
const MAPLE_SPR = {
	frames: [frame('maple:0', 20, 20)],
	palette: new Uint8Array(4),
	texture: tex('maple:pal'),
	rgba_index: 1,
	old_rgba_index: 1
};
const MAPLE_ACT = {
	actions: [{ delay: 120, animations: [{ layers: [sprLayer({ index: 0, color: [1, 0.6, 0.3, 1] })] }] }]
};

const EFFECT_SPRITE_DIR = 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/';

/** Sprite resources returned synchronously by Client.loadFile(path). */
export const WEATHER_SPRITES = {
	[`${EFFECT_SPRITE_DIR}ef_snow.spr`]: SNOW_SPR,
	[`${EFFECT_SPRITE_DIR}ef_snow.act`]: SNOW_ACT,
	[`${EFFECT_SPRITE_DIR}sakura01.spr`]: SAKURA_SPR,
	[`${EFFECT_SPRITE_DIR}sakura01.act`]: SAKURA_ACT,
	[`${EFFECT_SPRITE_DIR}\xb4\xdc\xc7\xb3.spr`]: MAPLE_SPR,
	[`${EFFECT_SPRITE_DIR}\xb4\xdc\xc7\xb3.act`]: MAPLE_ACT
};

const EPSILON = 1e-5;
const close = (l, m) => Object.is(l, m) || Math.abs(l - m) <= EPSILON * Math.max(1, Math.abs(m));

/**
 * Field-by-field diff of a legacy SpriteRenderer native record against a render-records
 * SpriteDraw. Texture / palette identity goes through `textureKey` (legacy GL object →
 * render-records key). Not compared: spriteType (uIsRGBA is never read, spec #12),
 * paletteSize without a palette (uTextSize is only uploaded with one), setBlend (a GL
 * state-cache detail; the record's blend is compared instead).
 *
 * @param {object} l legacy record
 * @param {object} m render-records record
 * @param {function} [textureKey] legacy texture → key
 * @returns {string[]} mismatches
 */
export function diffSpriteRecord(l, m, textureKey = t => t) {
	const out = [];
	const num = (name, a, b) => {
		if (!(typeof a === 'number' && typeof b === 'number' && close(a, b))) {
			out.push(`${name}: ${a} vs ${b}`);
		}
	};
	const vec = (name, a, b) => {
		if (!isTypedOrArray(a) || !isTypedOrArray(b) || a.length !== b.length || Array.from(a).some((v, i) => !close(v, b[i]))) {
			out.push(`${name}: ${a && Array.from(a)} vs ${b && Array.from(b)}`);
		}
	};
	const eq = (name, a, b) => {
		if (a !== b) {
			out.push(`${name}: ${String(a)} vs ${String(b)}`);
		}
	};
	for (const f of ['kind', 'textureClass', 'depthTest', 'depthWrite', 'depthCorrection', 'ignoreDepthMinCap']) {
		eq(f, l[f], m[f]);
	}
	eq('texture', textureKey(l.texture), m.texture);
	eq('palette', l.palette === null ? null : textureKey(l.palette), m.palette);
	for (const f of ['position', 'offset', 'size', 'color']) {
		vec(f, l[f], m[f]);
	}
	for (const f of ['xSize', 'ySize', 'angle', 'shadowFactor', 'zIndex', 'depthBias']) {
		num(f, l[f], m[f]);
	}
	if (l.palette !== null) {
		vec('paletteSize', l.paletteSize, m.paletteSize);
	}
	const blend = m.blend && m.blend.dst === 'ONE' ? 'additive' : 'normal';
	eq('blend', l.blend, blend);
	return out;
}

/**
 * Diff two per-frame record lists in order.
 * @returns {string[]} mismatches prefixed with `label#index`
 */
export function diffSpriteFrame(label, legacy, modern, textureKey) {
	const out = [];
	if (legacy.length !== modern.length) {
		out.push(`${label}: ${legacy.length} legacy records vs ${modern.length}`);
	}
	for (let i = 0; i < Math.min(legacy.length, modern.length); i++) {
		for (const d of diffSpriteRecord(legacy[i], modern[i], textureKey)) {
			out.push(`${label}#${i} ${d}`);
		}
	}
	return out;
}
