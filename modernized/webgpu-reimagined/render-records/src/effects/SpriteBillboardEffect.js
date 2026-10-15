import { createEffectDraw } from '../records/EffectDraw.js';
import { blendFromEffectMode } from '../records/blend.js';
import { defaultRng } from '../util/injectables.js';
import { alphaEnvelope } from './rules.js';

/**
 * 2D and 3D EffectTable effects (types '2D' and '3D'): textured billboards drawn
 * through the sprite pipeline. Ports legacy Renderer/Effects/TwoDEffect.js and
 * ThreeDEffect.js; one EffectDraw per visible draw (R-EFX-011..013).
 *
 * Legacy creates one GPU texture per instance in init() and never frees it; here
 * textures come from the caller's resolver (residency), so nothing leaks per instance.
 */

/** SpriteRenderer depth bias of each family (legacy beforeRender). */
export const SPRITE_EFFECT_DEPTH_BIAS = Object.freeze({ '3d': 0, '2d': 10 });

/** Sprite pixel → world conversion of the sprite pipeline (legacy SpriteRenderer.xSize/ySize). */
const SPRITE_WORLD_SIZE = 5;

/** Korean "effect" sprite folder of `spriteName` 3D effects. */
const EFFECT_SPRITE_DIR = 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/';

/**
 * Legacy `!isNaN(v)` (coerces: null and '' count as numbers, undefined does not).
 * @param {*} v
 */
const isNum = v => !Number.isNaN(Number(v));

/** ECMAScript ToInt16 (legacy stores the sprite anchor in an Int16Array). */
const toInt16 = v => (Math.trunc(v) << 16) >> 16;

/**
 * Elapsed time and progress of an instance.
 * @param {number} tick
 * @param {number} startTick
 * @param {number} endTick  −1 when open-ended (R-EFX-003)
 * @returns {{elapsed: number, duration: number, steps: number}} steps 0..100 (capped at 100)
 */
export function effectProgress(tick, startTick, endTick) {
	const elapsed = tick - startTick;
	const duration = endTick - startTick;
	let steps = (elapsed / duration) * 100;
	if (steps > 100) {
		steps = 100;
	}
	return { elapsed, duration, steps };
}

/**
 * Start → end animation of one 2D/3D parameter. Linear, or "smooth" (log10 ease:
 * log10(steps·0.09 + 1) reaches 1 at steps 100).
 * @param {number} start
 * @param {number} end
 * @param {number} steps 0..100
 * @param {boolean} smooth
 */
export function effectCurve(start, end, steps, smooth) {
	if (start == end) {
		return start;
	}
	if (smooth) {
		return Math.log10(steps * 0.09 + 1) * (end - start) + start;
	}
	return steps * ((end - start) / 100) + start;
}

/**
 * Legacy 3D random draw: uniform in [min, max], rounded to 3 decimals.
 * @param {() => number} rng
 */
const randBetween = rng => (min, max) => parseFloat(Math.min(min + rng() * (max - min), max).toFixed(3));

/**
 * Legacy 2D random draw: integer in [ceil(min), floor(max)].
 * @param {() => number} rng
 */
const randInt = rng => (min, max) => {
	const lo = Math.ceil(min);
	const hi = Math.floor(max);
	return Math.floor(rng() * (hi - lo + 1) + lo);
};

/**
 * One positional axis (pos / offset): fixed, start/end, and the random variants, in
 * the legacy precedence and random-draw order.
 */
function resolveAxis(spec, key, rand, out) {
	let start = spec[`${key}Start`] || 0;
	let end = spec[`${key}End`] || 0;
	if (spec[key]) {
		start = spec[key];
		end = spec[key];
	}
	if (spec[`${key}Rand`]) {
		start = rand(-spec[`${key}Rand`], spec[`${key}Rand`]);
		end = start;
	}
	if (spec[`${key}RandDiff`]) {
		start = rand(-spec[`${key}RandDiff`], spec[`${key}RandDiff`]);
		end = rand(-spec[`${key}RandDiff`], spec[`${key}RandDiff`]);
	}
	if (spec[`${key}StartRand`]) {
		const middle = spec[`${key}StartRandMiddle`] || 0;
		start = rand(middle - spec[`${key}StartRand`], middle + spec[`${key}StartRand`]);
	}
	if (spec[`${key}EndRand`]) {
		const middle = spec[`${key}EndRandMiddle`] || 0;
		end = rand(middle - spec[`${key}EndRand`], middle + spec[`${key}EndRand`]);
	}
	out[`${key}Start`] = start;
	out[`${key}End`] = end;
	out[`${key}Smooth`] = Boolean(spec[`${key}Smooth`]);
}

/** Size overrides shared by both families (after the family's own default). */
function resolveSizeOverrides(spec, s) {
	if (spec.sizeStart) {
		s.sizeStartX = spec.sizeStart;
		s.sizeStartY = spec.sizeStart;
	}
	if (spec.sizeEnd) {
		s.sizeEndX = spec.sizeEnd;
		s.sizeEndY = spec.sizeEnd;
	}
	if (spec.sizeX) {
		s.sizeStartX = spec.sizeX;
		s.sizeEndX = spec.sizeX;
	}
	if (spec.sizeY) {
		s.sizeStartY = spec.sizeY;
		s.sizeEndY = spec.sizeY;
	}
	for (const k of ['sizeStartX', 'sizeStartY', 'sizeEndX', 'sizeEndY']) {
		if (spec[k]) {
			s[k] = spec[k];
		}
	}
}

/** Random size variants (sizeRand base differs per family). */
function resolveSizeRand(spec, s, rand, sizeRandBase) {
	if (spec.sizeRand) {
		s.sizeStartX = sizeRandBase + rand(-spec.sizeRand, spec.sizeRand);
		s.sizeStartY = s.sizeStartX;
		s.sizeEndX = s.sizeStartX;
		s.sizeEndY = s.sizeStartX;
	}
	if (spec.sizeRandX) {
		const middle = spec.sizeRandXMiddle ? spec.sizeRandXMiddle : 100;
		s.sizeStartX = rand(middle - spec.sizeRandX, middle + spec.sizeRandX);
		s.sizeEndX = s.sizeStartX;
	}
	if (spec.sizeRandY) {
		const middle = spec.sizeRandYMiddle ? spec.sizeRandYMiddle : 100;
		s.sizeStartY = rand(middle - spec.sizeRandY, middle + spec.sizeRandY);
		s.sizeEndY = s.sizeStartY;
	}
	s.sizeSmooth = Boolean(spec.sizeSmooth);
}

/** Fields both families resolve identically. */
function resolveCommon(spec) {
	return {
		texture: spec.file,
		zIndex: spec.zIndex ? spec.zIndex : 0,
		fadeIn: Boolean(spec.fadeIn),
		fadeOut: Boolean(spec.fadeOut),
		overlay: Boolean(spec.overlay),
		shadowTexture: Boolean(spec.shadowTexture),
		red: spec.red ? spec.red : 1,
		green: spec.green ? spec.green : 1,
		blue: spec.blue ? spec.blue : 1,
		blendMode: spec.blendMode
	};
}

/**
 * @typedef {Object} SoulStrikeGroup  shared by the instances of one spawn (legacy module state)
 * @property {Object|null} first  resolved pattern of the first instance
 */

/**
 * Resolve a 3D EffectTable entry into instance parameters (legacy ThreeDEffect
 * constructor, including its random draws in the same order).
 * @param {Object} spec EffectTable entry
 * @param {Object} inst
 * @param {number[]} inst.position
 * @param {number[]} inst.otherPosition
 * @param {number} inst.startTick
 * @param {number} [inst.duplicateID]
 * @param {{rng?: () => number, soulStrike?: SoulStrikeGroup}} [ports]
 */
export function resolveThreeDSpec(spec, inst, { rng = defaultRng, soulStrike = { first: null } } = {}) {
	const rand = randBetween(rng);
	const duplicateID = inst.duplicateID;
	const s = resolveCommon(spec);
	s.textureList = Array.isArray(spec.fileList) ? spec.fileList : [];
	s.frameDelay = isNum(spec.frameDelay) ? spec.frameDelay : 10;
	s.spriteName = spec.spriteName;
	s.absoluteSpriteName = spec.absoluteSpriteName;
	s.playSprite = Boolean(spec.playSprite);
	s.sprDelay = spec.sprDelay ? spec.sprDelay : 0;
	s.rotatePosX = spec.rotatePosX > 0 ? spec.rotatePosX : 0;
	s.rotatePosY = spec.rotatePosY > 0 ? spec.rotatePosY : 0;
	s.nbOfRotation = spec.nbOfRotation > 0 ? spec.nbOfRotation : 1;
	s.rotateLate = spec.rotateLate > 0 ? spec.rotateLate : 0;
	s.rotateLate += spec.rotateLateDelta ? spec.rotateLateDelta * duplicateID : 0;
	s.rotationClockwise = Boolean(spec.rotationClockwise);
	s.sparkling = Boolean(spec.sparkling);
	if (spec.sparkNumber > 0) {
		s.sparkNumber = spec.sparkNumber;
	} else {
		s.sparkNumber = spec.sparkNumberRand ? rand(spec.sparkNumberRand[0], spec.sparkNumberRand[1]) : 1;
	}
	const clamp01 = v => Math.max(Math.min(v, 1), 0);
	s.alphaMax = isNum(spec.alphaMax) ? clamp01(spec.alphaMax) : 1;
	s.alphaMax = clamp01(s.alphaMax + (isNum(spec.alphaMaxDelta) ? spec.alphaMaxDelta * duplicateID : 0));

	for (const axis of ['posx', 'posy', 'posz']) {
		resolveAxis(spec, axis, rand, s);
	}
	s.xOffset = isNum(spec.xOffset) ? spec.xOffset : 0;
	s.yOffset = isNum(spec.yOffset) ? spec.yOffset : 0;
	s.zOffset = isNum(spec.zOffset) ? spec.zOffset : 0;
	s.zOffsetStart = isNum(spec.zOffsetStart) ? spec.zOffsetStart : 0;
	s.zOffsetEnd = isNum(spec.zOffsetEnd) ? spec.zOffsetEnd : 0;
	s.arc = isNum(spec.arc) ? spec.arc : 0;
	s.retreat = isNum(spec.retreat) ? spec.retreat : 0;

	// fromSrc / toSrc: travel between the owner and the other position
	const travel = (fromOther, toOther) => {
		const r = k => (spec[k] ? rand(-spec[k], spec[k]) : 0);
		const randStart = [r('posxStartRand'), r('posyStartRand'), r('poszStartRand')];
		const randEnd = [r('posxEndRand'), r('posyEndRand'), r('poszEndRand')];
		const other = i => inst.otherPosition[i] - inst.position[i];
		const offsets = [s.xOffset, s.yOffset, s.zOffset];
		['posx', 'posy', 'posz'].forEach((axis, i) => {
			const zStart = i === 2 ? s.zOffsetStart : 0;
			const zEnd = i === 2 ? s.zOffsetEnd : 0;
			s[`${axis}Start`] = (fromOther ? other(i) : 0) + offsets[i] + zStart + randStart[i];
			s[`${axis}End`] = (toOther ? other(i) : 0) + offsets[i] + zEnd + randEnd[i];
		});
	};
	if (spec.fromSrc) {
		travel(false, true);
	}
	if (spec.toSrc) {
		travel(true, false);
	}

	const size = spec.size ? spec.size : 1;
	Object.assign(s, { sizeStartX: size, sizeStartY: size, sizeEndX: size, sizeEndY: size });
	if (spec.sizeDelta) {
		for (const k of ['sizeStartX', 'sizeStartY', 'sizeEndX', 'sizeEndY']) {
			s[k] += spec.sizeDelta * duplicateID;
		}
	}
	resolveSizeOverrides(spec, s);
	resolveSizeRand(spec, s, rand, spec.size);

	s.angle = spec.angle ? spec.angle : 0;
	s.rotate = Boolean(spec.rotate);
	s.toAngle = spec.toAngle ? spec.toAngle : 0;
	s.rotateToTarget = Boolean(spec.rotateToTarget);
	if (s.rotateToTarget) {
		s.angle += 90 - Math.atan2(s.posyEnd - s.posyStart, s.posxEnd - s.posxStart) * (180 / Math.PI);
	}
	s.rotateWithCamera = Boolean(spec.rotateWithCamera);

	// Soul Strike / Drain: five-point star of hits; duplicates share the first pattern
	if (spec.soulStrikePattern || spec.drainPattern) {
		let pattern = soulStrike.first;
		if (!duplicateID || spec.drainPattern) {
			const hitIndex = spec.drainPattern ? duplicateID + 1 : Math.floor((inst.startTick / spec.duration) % 5);
			const offsetAngle = hitIndex * 72;
			pattern = {
				offsetX: Math.cos((offsetAngle * Math.PI) / 180) * 2,
				offsetY: Math.sin((offsetAngle * Math.PI) / 180) * 2,
				retreat: (s.retreat || 0) * (1 + hitIndex * 0.2) + (spec.drainPattern ? rand(0, 2) : 0),
				arc: (s.arc || 0) * (1 + hitIndex * 0.1) + (spec.drainPattern ? rand(0, 2) : 0),
				angle: offsetAngle
			};
			soulStrike.first = pattern;
		}
		const p = pattern ?? {};
		s.posxStart = (s.posxStart || 0) + p.offsetX;
		s.posyStart = (s.posyStart || 0) + p.offsetY;
		s.retreat = p.retreat;
		s.arc = p.arc;
		s.angle = (s.angle || 0) + p.angle;
	}
	return s;
}

/**
 * Resolve a 2D EffectTable entry into instance parameters (legacy TwoDEffect
 * constructor, including its random draws in the same order). Like legacy,
 * `angleDelta` multiplies `spec.duplicateID` (not the instance's), and sizes stay
 * undefined when the entry gives none. Unlike legacy, `durationRand` does not
 * rewrite the shared table entry (legacy only affected the next spawn's duration).
 * @param {Object} spec EffectTable entry
 * @param {{rng?: () => number}} [ports]
 */
export function resolveTwoDSpec(spec, { rng = defaultRng } = {}) {
	const rand = randInt(rng);
	const s = resolveCommon(spec);
	s.alphaMax = isNum(spec.alphaMax) ? Math.max(Math.min(spec.alphaMax, 1), 0) : 1;
	for (const axis of ['posx', 'posy', 'posz', 'offsetx', 'offsety']) {
		resolveAxis(spec, axis, rand, s);
	}
	if (spec.size) {
		Object.assign(s, { sizeStartX: spec.size, sizeStartY: spec.size, sizeEndX: spec.size, sizeEndY: spec.size });
	}
	resolveSizeOverrides(spec, s);
	resolveSizeRand(spec, s, rand, 100);

	s.angle = spec.angle ? spec.angle : 0;
	s.rotate = Boolean(spec.rotate);
	s.toAngle = spec.toAngle ? spec.toAngle : 0;
	if (spec.angleDelta) {
		s.angle += spec.angleDelta * spec.duplicateID;
		s.toAngle += spec.angleDelta * spec.duplicateID;
	}
	if (spec.rotateToTarget) {
		s.angle += 90 - Math.atan2(s.posyEnd - s.posyStart, s.posxEnd - s.posxStart) * (180 / Math.PI);
	}
	if (spec.angleRand) {
		s.angle = rand(spec.angleRand[0], spec.angleRand[1]);
	}
	if (spec.circlePattern) {
		const dist = rand(spec.circleOuterSizeRand[0], spec.circleOuterSizeRand[1]);
		const a = s.angle * ((Math.PI * 2) / 360);
		s.posxEnd = Math.sin(a) * dist;
		s.posyEnd = Math.cos(a) * dist;
		s.posxStart = Math.sin(a) * spec.circleInnerSize;
		s.posyStart = Math.cos(a) * spec.circleInnerSize;
	}
	if (spec.sizeRandStartX) {
		s.sizeStartX = rand(spec.sizeRandStartX[0], spec.sizeRandStartX[1]);
	}
	if (spec.sizeRandStartY) {
		s.sizeStartY = rand(spec.sizeRandStartY[0], spec.sizeRandStartY[1]);
	}
	if (spec.sizeRandEndY) {
		s.sizeEndY = rand(spec.sizeRandEndY[0], spec.sizeRandEndY[1]);
	}
	if (spec.sizeRandEndX) {
		s.sizeEndX = rand(spec.sizeRandEndX[0], spec.sizeRandEndX[1]);
	}
	if (spec.durationRand) {
		s.durationRand = rand(spec.durationRand[0], spec.durationRand[1]);
	}
	return s;
}

/**
 * Fields every 2D/3D draw shares. R-EFX-013: an overlay neither tests depth nor
 * applies the depth correction; a non-overlay 3D effect tests depth without
 * writing it, a 2D effect also writes it.
 */
function baseDraw(family, s, blend, sceneFog) {
	return {
		family,
		blend,
		depthTest: !s.overlay,
		depthWrite: family === '2d' && !s.overlay,
		depthCorrection: !s.overlay,
		fog: Boolean(sceneFog && sceneFog.use && sceneFog.exist !== false)
	};
}

/** EffectDraw.params of the 2D/3D families (sprite pixels, like SpriteDraw). */
function drawParams(family, s, fields) {
	return {
		depthBias: SPRITE_EFFECT_DEPTH_BIAS[family],
		shadowFactor: 1,
		xSize: SPRITE_WORLD_SIZE,
		ySize: SPRITE_WORLD_SIZE,
		ignoreDepthMinCap: false,
		palette: null,
		paletteSize: null,
		blendMode: s.blendMode,
		overlay: s.overlay,
		layer: -1,
		...fields
	};
}

/**
 * @typedef {Object} SpriteEffectFrame  per-frame inputs
 * @property {{yaw: number, direction: number}} camera  yaw in degrees, 8-way direction
 * @property {{use: boolean, exist?: boolean}} [sceneFog]
 * @property {(file: string) => *} textures   resident texture of data/texture/<file>, or null
 * @property {(path: string) => *} [sprites]  loaded SPR/ACT resource, or null
 * @property {{getCellHeight: (x: number, y: number) => number}} [altitude]
 */

/**
 * Plays one 3D effect instance (EffectTable type '3D').
 *
 * - Position: per-axis curve, or a circle (rotatePosX/Y), or a retreat/arc travel
 *   (fromSrc/toSrc, Soul Strike); shadowTexture snaps z to the ground.
 * - R-EFX-012 alpha envelope (fadeIn, fadeOut, sparkling).
 * - Texture: a single file, a fileList cycled every frameDelay ms, or the frames of
 *   an SPR/ACT (one draw per ACT layer; like legacy, only the first layer's angle
 *   applies to every layer and the layer anchor mixes world and pixel units).
 * - An attached effect shares its owner's live position array.
 */
export class ThreeDEffectPlayer {
	/**
	 * @param {Object} o
	 * @param {Object} o.spec EffectTable entry
	 * @param {number[]} o.position live array (owner's when attachedEntity)
	 * @param {number[]} o.otherPosition
	 * @param {number} o.startTick
	 * @param {number} o.endTick
	 * @param {number} [o.duplicateID]
	 * @param {{action: number, direction: number}|null} [o.owner] drives sprite frame selection
	 * @param {() => number} [o.rng]
	 * @param {SoulStrikeGroup} [o.soulStrike]
	 */
	constructor({ spec, position, otherPosition, startTick, endTick, duplicateID = 0, owner = null, rng, soulStrike }) {
		this.position = position;
		this.startTick = startTick;
		this.endTick = endTick;
		this.owner = owner;
		this.s = resolveThreeDSpec(spec, { position, otherPosition, startTick, duplicateID }, { rng, soulStrike });
		this.blend = blendFromEffectMode(this.s.blendMode);
		this.sprite = null;
		this.finished = false;
	}

	/** SPR/ACT of a sprite-backed effect (resolved lazily, like legacy). */
	resolveSprite(sprites) {
		const s = this.s;
		if (!this.sprite?.spr && sprites) {
			let base = null;
			if (s.shadowTexture) {
				base = 'data/sprite/shadow';
			} else if (s.absoluteSpriteName) {
				base = s.absoluteSpriteName;
			} else if (s.spriteName) {
				base = `${EFFECT_SPRITE_DIR}${s.spriteName}`;
			}
			if (base) {
				this.sprite = { spr: sprites(`${base}.spr`), act: sprites(`${base}.act`) };
			}
		}
		return this.sprite?.spr ? this.sprite : null;
	}

	/** World position of the frame (before the shadow ground snap). */
	placement(steps) {
		const s = this.s;
		const turn = (steps * 3.5 * s.nbOfRotation * Math.PI) / 180 - (s.rotateLate * Math.PI) / 2;
		let dx;
		if (s.rotatePosX > 0) {
			dx = s.rotatePosX * Math.cos(turn) * (s.rotationClockwise ? -1 : 1);
		} else {
			dx = effectCurve(s.posxStart, s.posxEnd, steps, s.posxSmooth);
		}
		const dy =
			s.rotatePosY > 0 ? s.rotatePosY * Math.sin(turn) : effectCurve(s.posyStart, s.posyEnd, steps, s.posySmooth);
		const pos = [this.position[0] + dx, this.position[1] + dy, 0];
		if (s.retreat !== 0) {
			let x = effectCurve(s.posxStart, s.posxEnd, steps, false);
			let y = effectCurve(s.posyStart, s.posyEnd, steps, false);
			const ddx = s.posxEnd - s.posxStart;
			const ddy = s.posyEnd - s.posyStart;
			const dist = Math.sqrt(ddx * ddx + ddy * ddy);
			if (dist > 0.001) {
				const back = Math.sin((steps * Math.PI) / 100) * s.retreat;
				x -= (ddx / dist) * back;
				y -= (ddy / dist) * back;
			}
			pos[0] = this.position[0] + x;
			pos[1] = this.position[1] + y;
		}
		let dz = effectCurve(s.poszStart, s.poszEnd, steps, s.poszSmooth);
		if (s.arc !== 0) {
			dz += s.arc * Math.sin((steps * Math.PI) / 100);
		}
		pos[2] = this.position[2] + dz;
		return pos;
	}

	/**
	 * Records of one frame (none before startTick or while a texture is not resident).
	 * @param {number} tick
	 * @param {SpriteEffectFrame} f
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>[]}
	 */
	frame(tick, { camera, sceneFog, textures, sprites, altitude }) {
		const s = this.s;
		let texture = null;
		if (s.textureList.length > 0) {
			const list = s.textureList.map(textures);
			if (list.some(t => !t)) {
				return [];
			}
			texture = list[Math.floor((tick - this.startTick) / s.frameDelay) % list.length];
		} else if (s.texture) {
			texture = textures(s.texture);
			if (!texture) {
				return [];
			}
		}
		if (this.startTick > tick) {
			return [];
		}
		const { elapsed, duration, steps } = effectProgress(tick, this.startTick, this.endTick);
		const sprite = this.resolveSprite(sprites);
		if (sprite && s.textureList.length === 0) {
			texture = sprite.spr.frames[0].texture;
		}

		const position = this.placement(steps);
		if (s.shadowTexture) {
			position[2] = altitude.getCellHeight(position[0], position[1]);
		}
		const alpha = alphaEnvelope({
			elapsed,
			duration,
			alphaMax: s.alphaMax,
			fadeIn: s.fadeIn,
			fadeOut: s.fadeOut,
			sparkling: s.sparkling,
			sparkNumber: s.sparkNumber,
			steps
		});
		const sizeX = effectCurve(s.sizeStartX, s.sizeEndX, steps, s.sizeSmooth);
		const sizeY = effectCurve(s.sizeStartY, s.sizeEndY, steps, s.sizeSmooth);
		let angle = s.rotate ? steps * ((s.toAngle - s.angle) / 100) + s.angle : s.angle;
		if (s.rotateWithCamera) {
			angle += camera.yaw;
		}

		const base = { ...baseDraw('3d', s, this.blend, sceneFog), position };
		const records = [];
		const emit = (fields, params) => {
			if (fields.texture && fields.color[3]) {
				records.push(
					createEffectDraw({
						...base,
						...fields,
						params: drawParams('3d', s, { ...params, zIndex: s.zIndex + records.length })
					})
				);
			}
		};

		if (sprite?.act) {
			const { spr, act } = sprite;
			const entity = this.owner ?? { action: 0, direction: 0 };
			const actions =
				act.actions[(entity.action * 8 + ((camera.direction + entity.direction + 8) % 8)) % act.actions.length];
			const delay = s.sprDelay || actions.delay;
			const animation = s.playSprite
				? actions.animations[Math.floor((tick - this.startTick) / delay) % actions.animations.length]
				: actions.animations[0];
			const anchor = animation.pos.length
				? [toInt16(this.position[0] - animation.pos[0].x), toInt16(this.position[1] - animation.pos[0].y)]
				: [0, 0];
			const layerAngle = angle + (s.rotateToTarget ? 0 : animation.layers[0].angle);
			animation.layers.forEach((layer, i) => {
				const indexed = !(layer.spr_type === 1 || spr.rgba_index === 0);
				const sizeFrame = spr.frames[layer.index + (!indexed && layer.spr_type === 1 ? spr.old_rgba_index : 0)];
				const width = sizeFrame.width * (layer.scale[0] / 100) * sizeX;
				const height = sizeFrame.height * (layer.scale[1] / 100) * sizeY;
				emit(
					{
						texture: spr.frames[layer.index].texture,
						color: [
							s.red * layer.color[0],
							s.green * layer.color[1],
							s.blue * layer.color[2],
							alpha * layer.color[3]
						]
					},
					{
						size: [layer.is_mirror ? -width : width, height],
						offset: [layer.pos[0] + anchor[0], layer.pos[1] + anchor[1]],
						angle: layerAngle,
						palette: indexed ? spr.texture : null,
						paletteSize: indexed ? [spr.frames[layer.index].width, spr.frames[layer.index].height] : null,
						layer: i
					}
				);
			});
		} else {
			emit({ texture, color: [s.red, s.green, s.blue, alpha] }, { size: [sizeX, sizeY], offset: [0, 0], angle });
		}

		this.finished = this.endTick < tick;
		return records;
	}
}

/**
 * Plays one 2D effect instance (EffectTable type '2D').
 *
 * - Position offsets rotate with the camera yaw; screen offsets (offsetx/y) do not.
 * - R-EFX-012 fadeIn / fadeOut (2D has no sparkling).
 * - With shadowTexture and an owner, legacy adds an SPR shadow attachment to the
 *   owner at spawn (shadowAttachment). Legacy's per-frame attachment update uses a
 *   key that never matches it, so it is not ported.
 */
export class TwoDEffectPlayer {
	/**
	 * @param {Object} o
	 * @param {Object} o.spec EffectTable entry
	 * @param {number[]} o.position live array (owner's when attachedEntity)
	 * @param {number} o.startTick
	 * @param {number} o.endTick
	 * @param {Object|null} [o.owner]
	 * @param {() => number} [o.rng]
	 */
	constructor({ spec, position, startTick, endTick, owner = null, rng }) {
		this.position = position;
		this.startTick = startTick;
		this.endTick = endTick;
		this.s = resolveTwoDSpec(spec, { rng });
		this.blend = blendFromEffectMode(this.s.blendMode);
		this.shadowAttachment =
			owner && this.s.shadowTexture
				? Object.freeze({
						completeFile: 'data/sprite/shadow',
						head: true,
						direction: true,
						repeat: false,
						stopAtEnd: true
					})
				: null;
		this.finished = false;
	}

	/**
	 * Records of one frame (none before startTick or while the texture is not resident).
	 * @param {number} tick
	 * @param {SpriteEffectFrame} f
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>[]}
	 */
	frame(tick, { camera, sceneFog, textures }) {
		const s = this.s;
		const texture = textures(s.texture);
		if (!texture || this.startTick > tick) {
			return [];
		}
		const { elapsed, duration, steps } = effectProgress(tick, this.startTick, this.endTick);
		const rad = (camera.yaw * Math.PI) / 180;
		const x = effectCurve(s.posxStart, s.posxEnd, steps, s.posxSmooth);
		const y = effectCurve(s.posyStart, s.posyEnd, steps, s.posySmooth);
		const position = [
			this.position[0] + (x * Math.cos(rad) - y * Math.sin(rad)),
			this.position[1] + (y * Math.cos(rad) + x * Math.sin(rad)),
			this.position[2] + effectCurve(s.poszStart, s.poszEnd, steps, s.poszSmooth)
		];
		const alpha = alphaEnvelope({ elapsed, duration, alphaMax: s.alphaMax, fadeIn: s.fadeIn, fadeOut: s.fadeOut });
		const records = [];
		if (alpha) {
			records.push(
				createEffectDraw({
					...baseDraw('2d', s, this.blend, sceneFog),
					texture,
					position,
					color: [s.red, s.green, s.blue, alpha],
					params: drawParams('2d', s, {
						size: [
							effectCurve(s.sizeStartX, s.sizeEndX, steps, s.sizeSmooth),
							effectCurve(s.sizeStartY, s.sizeEndY, steps, s.sizeSmooth)
						],
						offset: [
							effectCurve(s.offsetxStart, s.offsetxEnd, steps, s.offsetxSmooth),
							effectCurve(s.offsetyStart, s.offsetyEnd, steps, s.offsetySmooth)
						],
						angle: s.rotate ? steps * ((s.toAngle - s.angle) / 100) + s.angle : s.angle,
						zIndex: s.zIndex
					})
				})
			);
		}
		this.finished = this.endTick < tick;
		return records;
	}
}
