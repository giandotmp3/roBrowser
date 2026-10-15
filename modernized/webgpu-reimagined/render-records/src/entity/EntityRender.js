import { DEFAULT_XSIZE, ENTITY_LIFT, EntityType, SHADOW_LIFT } from './constants.js';
import { PC_ACTIONS, createAnimationState, selectAnimationFrame, startAction } from './animation.js';
import { cartOffset, cartState } from './cart.js';
import { layerBlend } from './color.js';
import { actIndex, visualDirection } from './geometry.js';
import { planEntityLayers } from './layers.js';
import { removalAlpha } from './lifecycle.js';
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
	const opt3 = this.opt3 ?? {};
	const blend = layerBlend({
		berserk: !!opt3.berserk,
		marionette: !!opt3.marionette,
		isShadowLayer: entry.part === 'shadow'
	});

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
 * Emit one ACT layer (legacy renderLayer, EntityRender.js:1066-1154, plus the RenderCanvas3D
 * skip, SpriteRenderer.js:177-192).
 * @this {Object} entity
 */
function emitLayer(records, ctx, entry, layer, spr, pal, size, offset, blend) {
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
	let width = frame.width * layer.scale[0] * size;
	const height = frame.height * layer.scale[1] * size;

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
	const effect = entry.part === 'shadow' ? [1, 1, 1, 1] : this.effectColor;
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
		position: entry.part === 'shadow' ? [...ctx.groundPosition] : [...ctx.bodyPosition],
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
		depthBias: 0,
		depthTest: true,
		depthWrite: entry.depthWrite,
		// Every entity pass keeps depth correction on (runWithDepth(…, false), EntityRender.js:339, 366)
		depthCorrection: true,
		ignoreDepthMinCap: !!entry.ignoreDepthMinCap,
		blend
	});
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
 * xSize, ySize, robeHeight, bodyHeight, opt3 {berserk, marionette}, removal {tick, delay},
 * walk {dist, speed}, attackSpeed.
 *
 * Not composed here yet: Assumptio halo and after-image trails (R-SPR-024/025, EntityRender.js:569-731),
 * sprite/STR attachments (R-SPR-031/032), sounds, picking rectangles (R-PICK-003).
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
		const effectColor = this.effectColor ?? [1, 1, 1, 1];
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
		const ctx = {
			frame,
			visualDir,
			z: 1, // EntityRender.js:302
			anchor: [0, 0], // EntityRender.js:306-307
			walkPhase: {},
			// R-SPR-012 one factor per entity, applied to every layer (EntityRender.js:301)
			shadowFactor: frame.shadowFactorAt ? frame.shadowFactorAt(position[0], position[1]) : 1,
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
		for (const entry of before.slice(0, bodyAt + 1)) {
			emitElement.call(this, records, ctx, entry);
		}
		const after = planEntityLayers({
			...planInput(this, visualDir, frame.playing),
			type: this.type ?? EntityType.PC
		});
		for (const entry of after.slice(after.findIndex(e => e.slot === 'body') + 1)) {
			emitElement.call(this, records, ctx, entry);
		}
	};
}
