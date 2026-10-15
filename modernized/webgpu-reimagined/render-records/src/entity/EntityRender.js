import { BLEND_ADDITIVE, BLEND_NORMAL } from '../records/blend.js';
import { DEFAULT_XSIZE, ENTITY_LIFT, EntityType, SHADOW_LIFT } from './constants.js';
import { PC_ACTIONS, createAnimationState, selectAnimationFrame, startAction } from './animation.js';
import { ATTACHMENT_ZINDEX, attachmentLifetime, attachmentOffset } from './attachments.js';
import { cartOffset, cartState } from './cart.js';
import { layerBlend, statusEffectColor } from './color.js';
import { actIndex, visualDirection } from './geometry.js';
import { planEntityLayers } from './layers.js';
import { removalAlpha } from './lifecycle.js';
import {
	HALO_COLOR,
	HALO_SCALE,
	HALO_ZINDEX_OFFSET,
	afterImageFlags,
	shouldCaptureTrail,
	trailAlpha,
	trailConfig
} from './overlays.js';
import { frameSampling, selectPalette } from './palette.js';

/**
 * @typedef {Object} EntityView   One loaded sprite slot (legacy ViewFiles after Client.loadFile)
 * @property {Object} spr          Compiled SPR (frames[i].texture, palette texture on `texture`)
 * @property {Object} act          Compiled ACT ({actions: [{animations, delay}]})
 * @property {Object|null} [pal]   External palette (.pal) — falls back to `spr` (R-SPR-015)
 * @property {number} [size]       Layer scale multiplier (shadow: ShadowTable[job])
 */

/**
 * @typedef {Object} EntityFrame  Per-frame context, injected (no globals)
 * @property {number} tick                      Render time (ms, same clock as animation.tick)
 * @property {{direction: number}} camera       R-CAM-008 direction 0..7
 * @property {(x: number, y: number) => number} [shadowFactorAt]  R-SPR-012 (default 1)
 * @property {(x: number, y: number) => number} [cellHeightAt]    R-SPR-011 ground height (default position z)
 * @property {boolean} [playing]                Session.Playing — gates the cart (R-SPR-010)
 * @property {{pixelPerfectSprites?: boolean}} [prefs]  R-SPR-014 sampler choice
 */

/**
 * Emit one element (legacy renderElement, EntityRender.js:742-877).
 * @this {Object} entity
 */
function emitElement(records, ctx, entry) {
	// Legacy sets zIndex before renderElement, so the reset holds even when the element is missing
	if (entry.zIndex !== null) {
		ctx.z = entry.zIndex;
	}

	const view = ctx.view(entry.slot);

	// Nothing to render / not loaded yet (EntityRender.js:749-760)
	if (!view || !view.spr || !view.act) {
		return;
	}
	const { spr, act } = view;
	const pal = selectPalette({ externalPalette: view.pal, spritePalette: spr }); // R-SPR-015

	// R-SPR-001 act index from the entity's current action (EntityRender.js:765-771)
	const actAction = act.actions[actIndex(this.action, ctx.visualDir, act.actions.length)];
	const selected = selectAnimationFrame(this, actAction, ctx.frame.tick - this.animation.tick, {
		part: entry.part,
		walkPhase: ctx.walkPhase
	});
	const animation = actAction.animations[selected.frame];
	if (!animation) {
		return;
	}

	// One-shot body ended: hold the last frame, then start `next` mid-frame, so the elements drawn
	// after the body already use the next action (EntityRender.js:1044-1050).
	if (selected.ended) {
		this.animation.frame = selected.frame;
		this.animation.play = false;
		if (selected.next) {
			startAction(this, selected.next, ctx.frame.tick);
		}
	}

	// Attach point (EntityRender.js:783-789) and cart offsets (:791-832, R-SPR-010)
	const offset = [0, 0];
	if (animation.pos.length && !entry.main) {
		offset[0] = ctx.anchor[0] - animation.pos[0].x;
		offset[1] = ctx.anchor[1] - animation.pos[0].y;
	}
	if (entry.part === 'cart' || entry.part === 'cartshadow') {
		[offset[0], offset[1]] = cartOffset(ctx.visualDir);
	}

	// R-SPR-023 additive bodies (EntityRender.js:834-841)
	const blend = layerBlend({
		berserk: ctx.opt3.berserk,
		marionette: ctx.opt3.marionette,
		isShadowLayer: entry.part === 'shadow'
	});

	// R-SPR-024/025 halo and after-images are drawn before the element's own layers (EntityRender.js:851-865)
	emitSecondBody.call(this, records, ctx, entry, animation.layers, spr, pal, view.size ?? 1, offset);

	for (const layer of animation.layers) {
		emitLayer.call(this, records, ctx, entry, layer, spr, pal, view.size ?? 1, offset, blend);
	}

	// Save the attach point (EntityRender.js:872-876)
	if (entry.main && animation.pos.length) {
		ctx.anchor[0] = animation.pos[0].x;
		ctx.anchor[1] = animation.pos[0].y;
	}
}

/**
 * R-SPR-024 Assumptio halo and R-SPR-025 after-image trails of one element (legacy renderSecondBody,
 * EntityRender.js:569-731). Both save the running zIndex and restore it, so the element's own
 * layers still start at its zIndex.
 * @this {Object} entity
 */
function emitSecondBody(records, ctx, entry, layers, spr, pal, size, offset) {
	const { halo, trail, blurType } = ctx.afterImage;
	if ((!halo && !trail) || entry.part === 'shadow' || entry.part === 'cartshadow') {
		return;
	}

	// Halo: every layer at 1.15× scale, effect colour (1,1,1,0.6), from zIndex − 100, no depth
	// write, additive (renderLayer(…, true), EntityRender.js:588-623)
	if (halo) {
		const z = ctx.z;
		ctx.z = z + HALO_ZINDEX_OFFSET;
		for (const layer of layers) {
			emitLayer.call(this, records, ctx, entry, layer, spr, pal, size, offset, BLEND_ADDITIVE, {
				scale: HALO_SCALE,
				effect: HALO_COLOR,
				depthWrite: false
			});
		}
		ctx.z = z;
	}

	if (!trail) {
		return;
	}

	// One trail per legacy element *type*: head and the three headgears share the 'head' trail
	// (EntityRender.js:631-641), so headgears redraw the head's snapshots.
	const trails = (this.trails ??= {});
	const state = (trails[entry.part] ??= { snapshots: [], lastTick: 0 });
	const now = ctx.frame.tick;
	const config = trailConfig({
		blurType,
		fastMove: !!this.isFastMoving,
		performanceMode: !!ctx.frame.prefs?.performanceMode
	});
	const capture = shouldCaptureTrail({
		blurType,
		action: this.action,
		actions: this.actions ?? PC_ACTIONS,
		fastMove: !!this.isFastMoving,
		sinceLast: now - state.lastTick,
		stored: state.snapshots.length,
		interval: config.interval
	});
	if (capture) {
		// The snapshot keeps the raw entity position: ghosts draw without the 0.2 body lift (:671, 714)
		state.snapshots.unshift({
			position: [...this.position],
			tick: now,
			layers,
			spr,
			pal,
			offset: [...offset]
		});
		state.lastTick = now;
		if (state.snapshots.length > config.maxSnapshots) {
			state.snapshots.pop();
		}
	}

	const z = ctx.z;
	state.snapshots.forEach((snapshot, i) => {
		const alpha = trailAlpha(blurType, now - snapshot.tick);
		// Dropped snapshots still take their index in the zIndex (:697-705); alpha-0 type-4 ghosts are
		// skipped at draw time without consuming zIndex
		if (!alpha && blurType !== 4) {
			return;
		}
		const effect = config.white
			? [1, 1, 1, alpha]
			: [this.effectColor[0], this.effectColor[1], this.effectColor[2], alpha];
		ctx.z = z - 10 - i;
		for (const layer of snapshot.layers) {
			emitLayer.call(
				this,
				records,
				ctx,
				entry,
				layer,
				snapshot.spr,
				snapshot.pal,
				size,
				snapshot.offset,
				BLEND_NORMAL,
				{
					effect,
					depthWrite: false,
					position: snapshot.position
				}
			);
		}
	});
	ctx.z = z;
}

/**
 * Emit one ACT layer (legacy renderLayer, EntityRender.js:1066-1154, plus the RenderCanvas3D
 * skip, SpriteRenderer.js:177-192).
 * `over` replaces what legacy changed around a renderLayer call: layer scale factor (halo),
 * effect colour (halo, trails, attachments), position (trails, behind attachments), depth write,
 * depth bias (attachments).
 * @this {Object} entity
 */
function emitLayer(records, ctx, entry, layer, spr, pal, size, offset, blend, over = {}) {
	// Nothing to render (EntityRender.js:1067-1070)
	if (layer.index < 0) {
		return;
	}

	// R-SPR-014: indexed frames carry the palette; RGBA frames sit after old_rgba_index (:1076-1088)
	let index = layer.index;
	const rgba = layer.spr_type === 1 || spr.rgba_index === 0;
	if (rgba && layer.spr_type === 1) {
		index += spr.old_rgba_index;
	}
	const frame = spr.frames[index];
	if (!frame) {
		return; // EntityRender.js:1090-1093
	}

	// Discrepancy #15: quads use the compiled (power-of-two padded) frame size (:1095-1101)
	const scale = over.scale ?? 1;
	let width = frame.width * (scale === 1 ? layer.scale[0] : layer.scale[0] * scale) * size;
	const height = frame.height * (scale === 1 ? layer.scale[1] : layer.scale[1] * scale) * size;

	// Measured heights feed R-SPR-009 on later elements / frames (:1112, 1115-1117)
	if (entry.part === 'body') {
		this.bodyHeight = height;
	}
	if (entry.part === 'robe') {
		this.robeHeight = height + layer.pos[1];
	}

	// Mirrored layer: negative width (:1119-1122)
	if (layer.is_mirror) {
		width = -width;
	}

	// R-SPR-017: layer colour × effectColor; the shadow ignores effectColor (:1124-1135). Legacy
	// does NOT multiply the ground shadow into the colour: it travels as shadowFactor and the
	// fragment shader applies it (SpriteRenderer.fs:159), so the record keeps them apart.
	const effect = entry.part === 'shadow' ? [1, 1, 1, 1] : (over.effect ?? this.effectColor);
	const color = [0, 1, 2, 3].map(i => layer.color[i] * effect[i]);

	// R-SPR-026 removal fade (:1137-1140)
	if (this.removal && this.removal.tick) {
		color[3] *= removalAlpha(ctx.frame.tick - this.removal.tick, this.removal.delay);
	}

	// Skipped draws consume no zIndex (SpriteRenderer.js:179)
	if (!frame.texture || !color[3]) {
		return;
	}

	const indexed = !rgba;
	records.sprite({
		source: `${this.gid ?? 'entity'}/${entry.slot}`,
		texture: frame.texture,
		textureClass: indexed ? 'indexed' : 'rgba',
		palette: indexed ? (pal.texture ?? null) : null,
		sampler: frameSampling({ indexed }, ctx.frame.prefs).sampler,
		position: [...(over.position ?? (entry.part === 'shadow' ? ctx.groundPosition : ctx.bodyPosition))],
		offset: [layer.pos[0] + offset[0], layer.pos[1] + offset[1]],
		size: [width, height],
		xSize: this.xSize ?? DEFAULT_XSIZE,
		ySize: this.ySize ?? DEFAULT_XSIZE,
		angle: layer.angle,
		mirror: !!layer.is_mirror,
		color,
		shadowFactor: ctx.shadowFactor,
		// zIndex post-increments per drawn layer only (SpriteRenderer.js:85, discrepancy #14)
		zIndex: ctx.z++,
		depthBias: over.depthBias ?? 0,
		depthTest: true,
		depthWrite: over.depthWrite ?? entry.depthWrite,
		// Every entity pass keeps depth correction on (runWithDepth(…, false), EntityRender.js:339, 366)
		depthCorrection: true,
		ignoreDepthMinCap: !!entry.ignoreDepthMinCap,
		blend
	});
}

/** opt3 flag → OPT3 virtue name (StatusState.js:71-92). */
const OPT3_NAMES = Object.freeze({
	berserk: 'BERSERK',
	marionette: 'MARIONETTE',
	assumptio: 'ASSUMPTIO',
	energyCoat: 'ENERGYCOAT',
	bunshin: 'BUNSIN',
	hallucinationWalk: 'HALLUCINATIONWALK',
	quicken: 'QUICKEN',
	overthrust: 'OVERTHRUST',
	explosionSpirits: 'EXPLOSIONSPIRITS'
});

/**
 * R-SPR-023/024/025 opt3 flags: explicit `opt3`, else the status virtue names (getOpt3,
 * EntityState.js:105-116).
 * @returns {Object<string, boolean>} {berserk, marionette, assumptio, energyCoat, bunshin,
 *          hallucinationWalk, quicken, overthrust, explosionSpirits}
 */
function opt3Of(entity) {
	const virtue = new Set(entity.status?.virtue ?? []);
	const out = {};
	for (const [flag, name] of Object.entries(OPT3_NAMES)) {
		out[flag] = entity.opt3 ? !!entity.opt3[flag] : virtue.has(name);
	}
	return out;
}

/**
 * R-SPR-031 one attachment pass (legacy AttachmentManager._renderFiltered / renderAttachment,
 * EntityAttachments.js:172-347). Attachments draw with the effect colour white × opacity, from
 * zIndex 1 (behind) or 500 (front), no depth write, normal blend. Finished attachments are
 * removed from `this.attachments` (non-repeating at their last frame unless stopAtEnd, repeating
 * once `duration` elapsed).
 *
 * Shadow state, discrepancy #34 [FLAG, fixed]: an attachment with ignoreShadow (every behind one)
 * draws with shadow factor 1 for itself only; the factor is restored to the ground value for the
 * next attachment and for everything drawn after the pass. Legacy leaks the 1 into every later
 * draw -- for a behind pass the whole entity body (EntityAttachments.js:181-201).
 * @this {Object} entity
 * @param {boolean} behind
 */
function emitAttachments(records, ctx, behind) {
	const list = this.attachments;
	// Legacy matches the flag strictly here and by truthiness below (:181, 197)
	if (!list || !list.some(a => a.renderBefore === behind)) {
		return;
	}
	ctx.shadowFactor = ctx.groundShadowFactor;
	for (let i = 0; i < list.length; ++i) {
		const a = list[i];
		if (!!a.renderBefore !== behind) {
			continue;
		}
		ctx.shadowFactor = a.ignoreShadow || a.renderBefore ? 1 : ctx.groundShadowFactor;
		if (emitAttachment.call(this, records, ctx, a, behind)) {
			list.splice(i, 1);
			i--;
		}
	}
	ctx.shadowFactor = ctx.groundShadowFactor;
}

/**
 * One sprite attachment; returns true when it must be removed (EntityAttachments.js:256-347).
 * @this {Object} entity
 */
function emitAttachment(records, ctx, a, behind) {
	const tick = ctx.frame.tick;
	if (a.startTick > tick) {
		return false;
	}
	const spr = a.view?.spr;
	const act = a.view?.act;
	if (!spr || !act || !spr.frames) {
		return false;
	}
	// Direction-aware attachments pick the ACT action by visual direction (:309-310)
	const actAction = act.actions[(a.direction ? ctx.visualDir : a.frame) % act.actions.length];
	const life = attachmentLifetime(a, tick, { frames: actAction.animations.length, actDelay: actAction.delay });
	if (!life.draw) {
		return !life.alive;
	}
	const offset = attachmentOffset(a);
	ctx.z = behind ? ATTACHMENT_ZINDEX.behind : ATTACHMENT_ZINDEX.front;
	const entry = { slot: `attachment:${a.uid ?? ''}`, part: 'attachment', depthWrite: false, main: false };
	for (const layer of actAction.animations[life.frame].layers) {
		// The attachment sprite is its own palette (renderLayer(…, spr, spr, 1.0, …), :340)
		emitLayer.call(this, records, ctx, entry, layer, spr, spr, 1.0, offset, BLEND_NORMAL, {
			effect: [1, 1, 1, a.opacity],
			depthWrite: false,
			depthBias: a.depth || 0,
			// Behind attachments sit at the raw entity position (EntityRender.js:344-346); front ones
			// where the entity left the sprite position, the lifted body position
			position: behind ? ctx.rawPosition : ctx.bodyPosition
		});
	}
	return !life.alive;
}

/** Layer-plan input from the entity state (riding, cart gate, ids). */
function planInput(entity, visualDir, playing) {
	return {
		type: entity.type,
		direction: visualDir,
		action: entity.action,
		actions: entity.actions ?? PC_ACTIONS,
		job: entity.job,
		hideShadow: !!entity.hideShadow,
		weapon: entity.weapon ?? 0,
		shield: entity.shield ?? 0,
		robe: entity.robe ?? 0,
		hats: entity.hats ?? {},
		cart: !!(playing && entity.hasCart),
		riding: !!entity.riding,
		robeHeight: entity.robeHeight ?? 0,
		bodyHeight: entity.bodyHeight ?? 0
	};
}

/**
 * EntityRender mixin. Per AGENTS.md the entity system uses composition: this
 * is applied to an Entity with `EntityRender.call(entity)` — never converted
 * to class inheritance. Instead of drawing through `SpriteRenderer.render()`
 * it emits SpriteDraw records into the injected RecordStream.
 *
 * Entity state read from `this` (a snapshot or a live entity): gid, type (EntityType), position,
 * direction, headDir, action, actions?, animation {tick, frame, play, repeat, next, delay, speed,
 * length, save}, job, isSuperNovice, views {shadow, robe, body, head, hatMid, hatTop, hatBottom,
 * weapon, weaponTrail, shield, cartShadow, cart: EntityView[]}, weapon, shield, robe,
 * hats {top, mid, bottom}, hasCart, cartNum, riding, effectColor, hideShadow, hideEntity, gr2,
 * xSize, ySize, robeHeight, bodyHeight, opt3 {berserk, marionette}, status (EntityStatus, used when
 * effectColor / opt3 are absent), removal {tick, delay},
 * walk {dist, speed}, attackSpeed.
 *
 * Halo / after-image state (R-SPR-024/025): opt3 {assumptio, energyCoat, bunshin, hallucinationWalk,
 * quicken, overthrust, explosionSpirits} (or status.virtue names), enableHalo, enableTrail,
 * fastMoveTrail, isFastMoving, blurType; `trails` holds the per-element snapshots across frames.
 * Sprite attachments (R-SPR-031): `attachments`, the list addAttachment() maintains (each with
 * `view: {spr, act}`); finished ones are removed from it while composing.
 *
 * Not composed here yet: STR attachments (R-SPR-032), sounds, picking rectangles (R-PICK-003).
 *
 * @this {Object}
 */
export function EntityRender() {
	/**
	 * Emit this entity's layer records for the frame, in legacy order (EntityRender.js:56-100, 292-556).
	 * Mutates the entity's own animation state exactly where legacy did (deferred action, one-shot
	 * end → `next`) and its measured robe/body heights.
	 * @param {import('../records/RecordStream.js').RecordStream} records
	 * @param {EntityFrame} frame
	 */
	this.renderRecords = function renderRecords(records, frame) {
		// R-SPR-018…022: an explicit effectColor wins; otherwise it is composed from the status
		const effectColor = this.effectColor ?? (this.status ? statusEffectColor(this.status) : [1, 1, 1, 1]);
		// Invisible entities draw nothing (EntityRender.js:93); hidden ones neither (:296-298)
		if (!effectColor[3] || this.hideEntity) {
			return;
		}
		this.effectColor = effectColor;

		// Discrepancy #13 FIX: an entity without a started clock starts it now (spawn), never at epoch 0
		if (!this.animation || typeof this.animation.tick !== 'number') {
			this.animation = { ...createAnimationState(frame.tick), ...this.animation, tick: frame.tick };
		}
		this.action ??= (this.actions ?? PC_ACTIONS).IDLE;

		// Deferred action is due (EntityRender.js:309-312)
		if (this.animation.save && this.animation.delay < frame.tick) {
			startAction(this, this.animation.save, frame.tick);
		}

		// GR2 3D bodies draw no billboard and no shadow (EntityRender.js:320-322)
		if (this.gr2) {
			return;
		}

		const position = this.position ?? [0, 0, 0];
		const visualDir = visualDirection(frame.camera?.direction ?? 0, this.direction ?? 0);
		const cellHeight = frame.cellHeightAt ? frame.cellHeightAt(position[0], position[1]) : position[2];
		const views = this.views ?? {};
		const cart = cartState({
			cartType: this.cartNum ?? 0,
			isSuperNovice: !!this.isSuperNovice,
			playing: !!frame.playing,
			idle: false,
			frame: 0
		});
		const opt3 = opt3Of(this);
		const groundShadowFactor = frame.shadowFactorAt ? frame.shadowFactorAt(position[0], position[1]) : 1;
		const ctx = {
			frame,
			visualDir,
			z: 1, // EntityRender.js:302
			anchor: [0, 0], // EntityRender.js:306-307
			opt3,
			afterImage: afterImageFlags({
				opt3,
				enableHalo: this.enableHalo,
				enableTrail: this.enableTrail,
				fastMoveTrail: this.fastMoveTrail,
				blurType: this.blurType
			}),
			walkPhase: {},
			// R-SPR-012 one factor per entity, applied to every layer (EntityRender.js:301); an
			// ignoreShadow attachment uses 1 for itself only (emitAttachments, #34)
			groundShadowFactor,
			shadowFactor: groundShadowFactor,
			rawPosition: [position[0], position[1], position[2]],
			// R-SPR-011 shadow on the ground (:334-336); R-SPR-004 body lift (:360, 520, 527, 535, 544)
			groundPosition: [position[0], position[1], cellHeight + SHADOW_LIFT],
			bodyPosition: [position[0], position[1], position[2] + ENTITY_LIFT],
			// R-SPR-010: Super Novices always use cart 0 (EntityRender.js:415, 498)
			view: slot => (slot === 'cart' ? views.cart?.[cart.sprite] : views[slot]) ?? null
		};

		// The plan is re-taken after the body: legacy reads action, robe/body heights live, and a
		// one-shot body may have switched to `next` (EntityRender.js:446-452, 491 vs 1044-1050).
		const before = planEntityLayers({
			...planInput(this, visualDir, frame.playing),
			type: this.type ?? EntityType.PC
		});
		const bodyAt = before.findIndex(e => e.slot === 'body');
		const shadowAt = before[0]?.slot === 'shadow' ? 1 : 0;
		for (const entry of before.slice(0, shadowAt)) {
			emitElement.call(this, records, ctx, entry);
		}
		// R-SPR-031 behind-entity attachments: after the shadow, before every other element (EntityRender.js:344-346)
		emitAttachments.call(this, records, ctx, true);
		for (const entry of before.slice(shadowAt, bodyAt + 1)) {
			emitElement.call(this, records, ctx, entry);
		}
		const after = planEntityLayers({
			...planInput(this, visualDir, frame.playing),
			type: this.type ?? EntityType.PC
		});
		for (const entry of after.slice(after.findIndex(e => e.slot === 'body') + 1)) {
			emitElement.call(this, records, ctx, entry);
		}
		// R-SPR-031 front attachments, after the whole entity (EntityRender.js:92-95)
		emitAttachments.call(this, records, ctx, false);
	};
}
