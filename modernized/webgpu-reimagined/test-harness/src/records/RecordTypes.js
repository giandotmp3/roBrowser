/**
 * Backend-neutral draw records as the harness observes them (architecture §1, §2.1).
 *
 * render-records owns the producing code; the harness owns this *observed* shape so that
 * the legacy shim and the new pipeline can be diffed field-by-field. A record is a plain,
 * frozen, JSON-serialisable object. Arrays are plain number arrays (never typed arrays) so
 * diffs and snapshots are stable.
 */
import { HarnessContractError } from '../errors.js';

/** Unified blend-factor enum (render-records normalises the STR D3D and 2D/3D GL tables into it). */
export const BlendFactor = Object.freeze({
	ZERO: 'zero',
	ONE: 'one',
	SRC_COLOR: 'src',
	ONE_MINUS_SRC_COLOR: 'one-minus-src',
	SRC_ALPHA: 'src-alpha',
	ONE_MINUS_SRC_ALPHA: 'one-minus-src-alpha',
	DST_ALPHA: 'dst-alpha',
	ONE_MINUS_DST_ALPHA: 'one-minus-dst-alpha',
	DST_COLOR: 'dst',
	ONE_MINUS_DST_COLOR: 'one-minus-dst',
	SRC_ALPHA_SATURATE: 'src-alpha-saturated',
	CONSTANT: 'constant',
	ONE_MINUS_CONSTANT: 'one-minus-constant'
});

const FACTORS = new Set(Object.values(BlendFactor));

export const Blend = Object.freeze({
	NORMAL: Object.freeze({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.ONE_MINUS_SRC_ALPHA }),
	ADDITIVE: Object.freeze({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.ONE })
});

/** Kinds of record in a frame stream. */
export const RecordKind = Object.freeze({
	PASS: 'pass',
	SPRITE: 'sprite',
	EFFECT: 'effect',
	WORLD: 'world',
	DAMAGE: 'damage'
});

/** Pass names in legacy order (R-CTX-010). Index = expected position. */
export const MAP_PASSES = Object.freeze([
	'pp-prepare',
	'camera',
	'ground',
	'map-effects',
	'ground-pick',
	'sky-clouds',
	'occluder-begin',
	'static-models',
	'animated-models',
	'entity-cull',
	'gr2',
	'screen-effects-before',
	'effects-before',
	'entities',
	'water',
	'faded-models',
	'effects-after',
	'effect-entities',
	'damage',
	'signboards',
	'screen-effects',
	'sounds',
	'entity-pick',
	'memory-clean',
	'post-process'
]);

const toArr = (v, n, name) => {
	if (v == null) {
		return undefined;
	}
	const a = Array.from(v, Number);
	if (n != null && a.length !== n) {
		throw new HarnessContractError(`${name} must have ${n} components, got ${a.length}`);
	}
	return a;
};

const checkBlend = blend => {
	const b = blend ?? Blend.NORMAL;
	if (!FACTORS.has(b.src) || !FACTORS.has(b.dst)) {
		throw new HarnessContractError(`unknown blend factor pair ${JSON.stringify(b)}`);
	}
	return Object.freeze({ src: b.src, dst: b.dst, constant: toArr(b.constant, 4, 'blend.constant') });
};

const depthState = (d = {}) =>
	Object.freeze({
		test: d.test ?? true,
		write: d.write ?? true,
		correction: d.correction ?? true,
		ignoreMinCap: d.ignoreMinCap ?? false
	});

const strip = o => {
	for (const k of Object.keys(o)) {
		if (o[k] === undefined) {
			delete o[k];
		}
	}
	return Object.freeze(o);
};

/** @returns {Readonly<object>} */
export function passMarker(name) {
	return Object.freeze({ kind: RecordKind.PASS, name });
}

/**
 * One sprite layer (replaces one write of the legacy mutable SpriteRenderer + render()).
 * Sizes/offsets are in ACT pixels; world scale = px/175·xSize (R-SPR-003) is applied by the
 * backend, so the record keeps the legacy inputs and parity is exact.
 */
export function spriteDraw(r) {
	return strip({
		kind: RecordKind.SPRITE,
		owner: r.owner ?? null, // { gid, type } or null for non-entity sprites
		layer: r.layer ?? 'body', // body|head|hat-low|hat-mid|hat-top|weapon|weapon-trail|shield|robe|cart|cart-shadow|shadow|halo|trail|attachment|item|cloud|...
		position: toArr(r.position, 3, 'position'),
		size: toArr(r.size, 2, 'size'),
		offset: toArr(r.offset, 2, 'offset'),
		color: toArr(r.color ?? [1, 1, 1, 1], 4, 'color'),
		shadow: r.shadow ?? 1,
		zIndex: r.zIndex ?? 0,
		depthBias: r.depthBias ?? 0,
		angle: r.angle ?? 0,
		xSize: r.xSize ?? 5,
		ySize: r.ySize ?? 5,
		texture: r.texture ?? null, // { id, indexed, filter: 'nearest'|'linear' }
		palette: r.palette ?? null, // palette asset id or null
		frame: r.frame,
		action: r.action,
		direction: r.direction,
		mirror: r.mirror ?? false,
		blend: checkBlend(r.blend),
		depth: depthState(r.depth),
		// rule-specific annotations: lift, heightLift, pixelOffset, scale, snapshot, walkPhase, headDir, bodyDir
		meta: r.meta ? Object.freeze({ ...r.meta }) : undefined
	});
}

export function effectDraw(r) {
	return strip({
		kind: RecordKind.EFFECT,
		family: r.family, // str|2d|3d|cylinder|rsm|quadhorn|ground-aura|swirling-aura|level99|spirit-sphere|warlock-sphere|pokjuk|waterfall|poison|weather-*|...
		effectId: r.effectId,
		owner: r.owner ?? null,
		pass: r.pass ?? 'after', // before|after
		position: toArr(r.position, 3, 'position'),
		size: toArr(r.size, 2, 'size'),
		color: toArr(r.color ?? [1, 1, 1, 1], 4, 'color'),
		texture: r.texture ?? null,
		blend: checkBlend(r.blend),
		depth: depthState(r.depth),
		fog: r.fog ?? false,
		key: r.key,
		meta: r.meta ? Object.freeze({ ...r.meta }) : undefined
	});
}

export function worldDraw(r) {
	return strip({
		kind: RecordKind.WORLD,
		layer: r.layer, // ground|water|static-models|animated-models|faded-models|grid|clouds|gr2|occluder-query
		uniforms: r.uniforms ? Object.freeze({ ...r.uniforms }) : undefined,
		blend: checkBlend(r.blend),
		depth: depthState(r.depth),
		instances: r.instances,
		meta: r.meta ? Object.freeze({ ...r.meta }) : undefined
	});
}

export function damageDraw(r) {
	return strip({
		kind: RecordKind.DAMAGE,
		owner: r.owner ?? null,
		damageType: r.damageType, // normal|heal|sp|miss|lucky|crit|combo|combo-final|critbg
		text: r.text,
		position: toArr(r.position, 3, 'position'),
		scale: r.scale,
		color: toArr(r.color, 4, 'color'),
		depthBias: r.depthBias ?? 0,
		depth: depthState({ test: false, write: false, ...r.depth }),
		skin: r.skin ?? 0
	});
}

const FACTORIES = {
	[RecordKind.PASS]: r => passMarker(r.name),
	[RecordKind.SPRITE]: spriteDraw,
	[RecordKind.EFFECT]: effectDraw,
	[RecordKind.WORLD]: worldDraw,
	[RecordKind.DAMAGE]: damageDraw
};

/** Normalise any record-shaped object (e.g. from a subject or JSON) into a frozen record. */
export function normalizeRecord(r) {
	const f = FACTORIES[r?.kind];
	if (!f) {
		throw new HarnessContractError(`unknown record kind: ${r?.kind}`);
	}
	return f(r);
}
