/**
 * C-08 entity sprites: R-SPR-001..033 (record side).
 * Pending rules use `it.fails` (expected failure) and are tagged with the rule ID.
 */
import { describe, expect, it } from 'vitest';
import {
	Action,
	BLEND_ADDITIVE,
	BLEND_NORMAL,
	EntityRender,
	EntityType,
	RecordStream,
	WALK_MOTION_CONSTANT,
	actIndex,
	attachmentLifetime,
	attachmentRecordState,
	bodyDepthState,
	bodyStateTint,
	cartOffset,
	cartState,
	composeEffectColor,
	createSpriteDraw,
	decodeRgbaFrame,
	depthCorrectionFlags,
	directionTo,
	droppedItemZ,
	entityPass,
	entitySortDepth,
	finalLayerColor,
	frameSampling,
	haloFromLayer,
	healthStateTint,
	invisibilityTint,
	layerBlend,
	liftedBodyPosition,
	lookTo,
	offsetToWorld,
	persistentHatFrame,
	pixelsToWorld,
	planPlayerLayers,
	remapMagentaIndices,
	removalAlpha,
	removalPlan,
	robeZCorrection,
	selectAnimationFrame,
	selectPalette,
	shadowFactorAt,
	shadowLayer,
	shouldDrawShadow,
	shouldResort,
	sortFarToNear,
	strAttachmentTransform,
	suppressDuplicateHeadgears,
	trailAlpha,
	trailConfig,
	trailLayerDepth,
	virtueTint,
	visualDirection,
	walkFrame,
	xSizeFor,
	zIndexClipBias
} from '../../src/index.js';

const bodyLayer = index => ({
	index,
	pos: [0, 0],
	scale: [1, 1],
	color: [1, 1, 1, 1],
	angle: 0,
	is_mirror: 0,
	spr_type: 0
});

const close = (actual, expected) => expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 6));

describe('C-08 entity sprites', () => {
	it('R-SPR-001: visual direction and act index; negative action renders as IDLE', () => {
		const dir = visualDirection(1, 3);
		expect(dir).toBe(4);
		expect(actIndex(2, dir, 64)).toBe(20);
		expect(actIndex(-1, dir, 64)).toBe(actIndex(Action.IDLE, dir, 64));
	});

	it('R-SPR-002: sprite records are spherical billboards', () => {
		expect(createSpriteDraw().billboard).toBe('spherical');
		expect(new RecordStream().sprite({}).billboard).toBe('spherical');
	});

	it('R-SPR-003: 35 px per cell at xSize 5; baby 4; warp 20; offsets minus 0.5 on Y', () => {
		expect(pixelsToWorld(35)).toBeCloseTo(1);
		expect(xSizeFor({})).toBe(5);
		expect(xSizeFor({ isBaby: true })).toBe(4);
		expect(xSizeFor({ isWarp: true })).toBe(20);
		close(offsetToWorld([35, 35]), [1, 0.5]);
	});

	it('R-SPR-004: entity body is lifted 0.2 cells', () => {
		close(liftedBodyPosition([1, 2, 3]), [1, 2, 3.2]);
	});

	it('R-SPR-005: depth correction on; NPCs take corrected z outright (ignoreDepthMinCap)', () => {
		expect(depthCorrectionFlags(EntityType.NPC)).toEqual({ depthCorrection: true, ignoreDepthMinCap: true });
		expect(depthCorrectionFlags(EntityType.MOB)).toEqual({ depthCorrection: true, ignoreDepthMinCap: false });
	});

	it('R-SPR-006: zIndex auto-increments after each draw; clip bias = (z·0.01 + depth)/max(zoom,1)', () => {
		const stream = new RecordStream();
		expect(stream.sprite({ zIndex: 150 }).zIndex).toBe(150);
		expect(stream.sprite({}).zIndex).toBe(151);
		expect(stream.sprite({}).zIndex).toBe(152);
		expect(zIndexClipBias(150, 0, 2)).toBeCloseTo(0.75);
		expect(zIndexClipBias(150, 0, 0.5)).toBeCloseTo(1.5);
	});

	it('R-SPR-007: PC front-facing layer plan by zIndex', () => {
		const plan = planPlayerLayers({
			type: EntityType.PC,
			direction: 0,
			weapon: 1,
			shield: 1,
			robe: 1,
			hats: { top: 1, mid: 2, bottom: 3 },
			cart: 1
		});
		const z = Object.fromEntries(plan.map(l => [l.slot, l.zIndex]));
		expect(z).toMatchObject({
			shadow: -1,
			cartShadow: -1,
			cart: 1,
			robe: 1,
			body: 150,
			head: 300,
			hatMid: 350,
			hatTop: 450,
			hatBottom: 550,
			weapon: 500,
			shield: 550
		});
	});

	it('R-SPR-007: EntityRender mixin (applied via .call) emits records instead of drawing', () => {
		const texture = { id: 'body#0' };
		const act = { actions: [{ delay: 100, animations: [{ layers: [bodyLayer(0)], sound: -1, pos: [] }] }] };
		const entity = {
			type: EntityType.MOB,
			position: [1, 2, 3],
			views: { body: { spr: { frames: [{ width: 32, height: 64, texture }], rgba_index: 0, old_rgba_index: 0 }, act } }
		};
		EntityRender.call(entity);
		expect(Object.getPrototypeOf(entity)).toBe(Object.prototype);
		const stream = new RecordStream();
		entity.renderRecords(stream, { tick: 0, camera: { direction: 0 } });
		expect(stream.records).toHaveLength(1);
		expect(stream.records[0]).toMatchObject({ texture, zIndex: 150, depthWrite: false, size: [32, 64] });
	});

	it('R-SPR-008: duplicate headgears are suppressed', () => {
		expect(suppressDuplicateHeadgears({ top: 5, mid: 3, bottom: 3 })).toEqual({ top: 5, mid: 0, bottom: 3 });
		expect(suppressDuplicateHeadgears({ top: 3, mid: 4, bottom: 3 })).toEqual({ top: 0, mid: 4, bottom: 3 });
		expect(suppressDuplicateHeadgears({ top: 4, mid: 4, bottom: 1 })).toEqual({ top: 0, mid: 4, bottom: 1 });
	});

	it('R-SPR-009: robe z-correction (default and tall robe)', () => {
		const base = { riding: false, sitting: false };
		expect(robeZCorrection({ ...base, lookingFront: true })).toBe(1);
		expect(robeZCorrection({ ...base, lookingFront: false })).toBe(400);
		expect(robeZCorrection({ ...base, sitting: true, lookingFront: true })).toBe(-100);
		expect(robeZCorrection({ ...base, sitting: true, lookingFront: false })).toBe(550);

		const tall = { robeHeight: 120, bodyHeight: 50 };
		expect(robeZCorrection({ ...base, ...tall, lookingFront: true })).toBe(-300);
		expect(robeZCorrection({ ...base, ...tall, lookingFront: false })).toBe(1);
		expect(robeZCorrection({ ...base, ...tall, riding: true, lookingFront: false })).toBe(100);
		expect(robeZCorrection({ ...tall, sitting: true, riding: false, lookingFront: true })).toBe(-450);
		expect(robeZCorrection({ ...tall, sitting: true, riding: false, lookingFront: false })).toBe(-100);
		expect(robeZCorrection({ ...tall, sitting: true, riding: true, lookingFront: false })).toBe(1);

		// +50 compensation only when riding and facing front
		const borderline = { robeHeight: 70, bodyHeight: 50 };
		expect(robeZCorrection({ ...base, ...borderline, lookingFront: true })).toBe(1);
		expect(robeZCorrection({ ...base, ...borderline, riding: true, lookingFront: true })).toBe(-300);
	});

	it('R-SPR-010: cart offsets, Super Novice cart 0, only while playing, idle frame 0', () => {
		expect(cartOffset(0)).toEqual([0, -30]);
		expect(cartOffset(2)).toEqual([40, 0]);
		expect(cartOffset(7)).toEqual([-30, -10]);
		expect(cartState({ cartType: 3, isSuperNovice: true, playing: true, idle: false, frame: 4 }).sprite).toBe(0);
		expect(cartState({ cartType: 3, isSuperNovice: false, playing: false, idle: false, frame: 4 }).visible).toBe(false);
		expect(cartState({ cartType: 3, isSuperNovice: false, playing: true, idle: true, frame: 4 }).frame).toBe(0);
	});

	it('R-SPR-011: shadow visibility and layer parameters', () => {
		expect(shouldDrawShadow({ action: Action.IDLE, job: 0 })).toBe(true);
		expect(shouldDrawShadow({ action: Action.DIE, job: 0 })).toBe(false);
		expect(shouldDrawShadow({ action: Action.SIT, job: 0 })).toBe(false);
		expect(shouldDrawShadow({ action: Action.IDLE, job: 45 })).toBe(false);
		expect(shouldDrawShadow({ action: Action.IDLE, job: 0, hideShadow: true })).toBe(false);

		const s = shadowLayer({ job: 1002, cellHeight: 2 }, { 1002: 1.5 });
		expect(s.z).toBeCloseTo(2.05);
		expect(s).toMatchObject({ frame: 0, scale: 1.5, ignoreEffectColor: true, depthTest: true, depthWrite: false, depthCorrection: true });
		expect(shadowLayer({ job: 1, cellHeight: 0 }).scale).toBe(1.0);
		expect(shadowLayer({ job: 1, isItem: true, cellHeight: 0 }).scale).toBe(0.25);
	});

	it('R-SPR-012: ground shadow factor = 6×6 shadow-map average /255; 1.0 before map load', () => {
		expect(shadowFactorAt(null, 2, 1, 1)).toBe(1.0);
		const map = new Uint8Array(16 * 16).fill(255);
		expect(shadowFactorAt(map, 2, 1, 1)).toBeCloseTo(1.0);
		map.fill(102);
		expect(shadowFactorAt(map, 2, 1, 1)).toBeCloseTo(0.4);
	});

	it('R-SPR-013: depth write by entity type; falcon zIndex 1000', () => {
		for (const t of [EntityType.PC, EntityType.MERC, EntityType.HOM, EntityType.FALCON, EntityType.NPC]) {
			expect(bodyDepthState(t).depthWrite).toBe(true);
		}
		expect(bodyDepthState(EntityType.MOB)).toEqual({ depthTest: true, depthWrite: false, zIndex: 150 });
		expect(bodyDepthState(EntityType.FALCON).zIndex).toBe(1000);
	});

	it('R-SPR-014: indexed frames nearest; RGBA linear unless pixelPerfectSprites; magenta palette index → 0', () => {
		expect(frameSampling({ indexed: true })).toEqual({ textureClass: 'indexed', sampler: 'nearest' });
		expect(frameSampling({ indexed: false })).toEqual({ textureClass: 'rgba', sampler: 'linear' });
		expect(frameSampling({ indexed: false }, { pixelPerfectSprites: true }).sampler).toBe('nearest');
		const palette = new Uint8Array(256 * 4);
		palette.set([255, 0, 255, 255], 7 * 4);
		palette.set([255, 0, 254, 255], 8 * 4);
		expect([...remapMagentaIndices(new Uint8Array([7, 8, 0]), palette)]).toEqual([0, 8, 0]);
	});

	it('R-SPR-015: external .pal is preferred over the sprite palette', () => {
		expect(selectPalette({ externalPalette: 'body_1.pal', spritePalette: 'own' })).toBe('body_1.pal');
		expect(selectPalette({ externalPalette: null, spritePalette: 'own' })).toBe('own');
	});

	it('R-SPR-016: RGBA frames are flipped, ABGR→RGBA, alpha 0 zeroes the pixel', () => {
		const abgr = new Uint8Array([
			255, 3, 2, 1, // stored row 0 = bottom
			0, 9, 9, 9 // stored row 1 = top, alpha 0
		]);
		expect([...decodeRgbaFrame(abgr, 1, 2)]).toEqual([0, 0, 0, 0, 1, 2, 3, 255]);
	});

	it('R-SPR-017: final colour = layer colour × effectColor, rgb × shadow factor; alpha 0 skips', () => {
		const { color, skip } = finalLayerColor([255, 255, 255, 255], [1, 0.5, 1, 1], 0.5);
		close(color, [0.5, 0.25, 0.5, 1]);
		expect(skip).toBe(false);
		expect(finalLayerColor([255, 255, 255, 0], [1, 1, 1, 1], 1).skip).toBe(true);
	});

	it('R-SPR-018: effectColor is the per-channel product of the five states', () => {
		close(
			composeEffectColor({
				bodyState: [0.5, 1, 1, 1],
				healthState: [1, 0.5, 1, 1],
				effectState: [1, 1, 0.5, 1],
				virtue: [1, 1, 1, 0.5],
				flash: [0.5, 1, 1, 1]
			}),
			[0.25, 0.5, 0.5, 0.5]
		);
	});

	it('R-SPR-019: body state tints', () => {
		const stone = bodyStateTint('STONE');
		close(stone.color, [0.1, 0.1, 0.1, 1]);
		expect(stone.pauseAnimation).toBe(true);
		close(bodyStateTint('STONE_WAIT').color, [0.3, 0.3, 0.3, 1]);
		const freeze = bodyStateTint('FREEZE');
		close(freeze.color, [0, 0.4, 0.8, 1]);
		expect(freeze.pose).toBe('FREEZE2');
		expect(freeze.attachments).toContain('ice');
		expect(bodyStateTint('SLEEP').attachments).toEqual(['head:sleep']);
		expect(bodyStateTint('STUN').attachments).toEqual(['head:stun']);
	});

	it('R-SPR-020: health state tints and attachments', () => {
		const h = healthStateTint({ curse: true, poison: true, silence: true });
		close(h.color, [0.45, 0.06, 0.08, 1]);
		expect(h.attachments).toContainEqual({ id: 'curse', opacity: 0.5 });
		expect(h.attachments).toContainEqual({ id: 'emotion:silence', depth: 5 });
	});

	it('R-SPR-021: invisibility states and intravision', () => {
		expect(invisibilityTint('INVISIBLE', false)[3]).toBe(0);
		// Refined by the record-diff: INVISIBLE is checked before intravision (EntityState.js:432-434)
		expect(invisibilityTint('INVISIBLE', true)[3]).toBe(0);
		expect(invisibilityTint('HIDE', false)[3]).toBe(0);
		expect(invisibilityTint('HIDE', true)).toEqual([0, 0, 0, 1]);
		expect(invisibilityTint('CAMOUFLAGE', false)[3]).toBeCloseTo(0.1);
		expect(invisibilityTint('STEALTHFIELD', false)[3]).toBeCloseTo(0.1);
		expect(invisibilityTint('SHADOWFORM', false)).toEqual([0.2, 0.2, 0.2, 0.2]);
	});

	it('R-SPR-022: virtue tints; later checks overwrite earlier ones', () => {
		expect(virtueTint(['QUICKEN'])).toEqual([1, 1, 0, 1]);
		expect(virtueTint(['QUICKEN', 'BERSERK'])).toEqual([1, 0.4, 0.4, 1]);
		expect(virtueTint(['SOULLINK'])).toEqual([0.35, 0.35, 0.9, 0.9]);
		expect(virtueTint(['UNDEAD'])).toEqual([0.7, 1, 0.65, 1]);
		expect(virtueTint(['MARIONETTE'])).toEqual([1, 0.34, 0.71, 0.5]);
	});

	it('R-SPR-023: Berserk (non-shadow) or Marionette layers are additive', () => {
		expect(layerBlend({ berserk: true })).toBe(BLEND_ADDITIVE);
		expect(layerBlend({ berserk: true, isShadowLayer: true })).toBe(BLEND_NORMAL);
		expect(layerBlend({ marionette: true, isShadowLayer: true })).toBe(BLEND_ADDITIVE);
		expect(layerBlend({})).toBe(BLEND_NORMAL);
	});

	it('R-SPR-024: Assumptio halo redraws at 1.15×, (1,1,1,0.6), zIndex −100, no depth write', () => {
		const halo = haloFromLayer(createSpriteDraw({ size: [2, 4], zIndex: 150, color: [1, 0.5, 1, 1] }));
		close(halo.size, [2.3, 4.6]);
		// Legacy: zIndex − 100 is relative to the element (EntityRender.js:608-609); the effect colour
		// multiplies the layer colour, and the redraw is additive (renderLayer(…, true), :614)
		close(halo.color, [1, 0.5, 1, 0.6]);
		expect(halo).toMatchObject({ zIndex: 50, depthWrite: false, blend: BLEND_ADDITIVE });
	});

	it('R-SPR-025: after-image trail intervals, counts, alpha and depth', () => {
		expect(trailConfig({ blurType: 1 })).toMatchObject({ interval: 80, maxSnapshots: 5, duration: 400, white: false });
		expect(trailConfig({ blurType: 3 })).toMatchObject({ interval: 560, duration: 800, white: true });
		expect(trailConfig({ blurType: 5 }).interval).toBe(560);
		expect(trailConfig({ blurType: 1, fastMove: true }).interval).toBe(30);
		expect(trailConfig({ blurType: 1, performanceMode: true }).maxSnapshots).toBe(2);
		expect(trailConfig({ blurType: 4 }).maxSnapshots).toBe(1);
		expect(trailAlpha(1, 0)).toBeCloseTo(0.4);
		expect(trailAlpha(1, 200)).toBeCloseTo(0.2);
		expect(trailAlpha(3, 0)).toBeCloseTo(0.8);
		expect(trailAlpha(1, 360)).toBe(0);
		expect(trailLayerDepth(150, 2)).toEqual({ zIndex: 138, depthWrite: false });
	});

	it('R-SPR-026: removal fade', () => {
		expect(removalPlan({ reason: 'outOfSight', type: EntityType.PC }).fadeMs).toBe(1000);
		expect(removalPlan({ reason: 'death', type: EntityType.MOB })).toMatchObject({ fadeMs: 5000, playDie: true });
		expect(removalPlan({ reason: 'death', type: EntityType.PC })).toMatchObject({ loopDie: true, remove: false });
		expect(removalPlan({ reason: 'death', type: EntityType.WUG }).fadeMs).toBe(0);
		expect(removalPlan({ reason: 'other', type: EntityType.MOB }).fadeMs).toBe(0);
		expect(removalAlpha(500, 1000)).toBeCloseTo(0.5);
	});

	it('R-SPR-027: default frame delay is the ACT delay ×25 ms, or 150 ms', () => {
		const result = selectAnimationFrame({ action: Action.IDLE }, { delay: 0, frames: 4 }, 300);
		expect(result.frame).toBe(2);
	});

	it('R-SPR-028: walk cadence follows distance', () => {
		expect(WALK_MOTION_CONSTANT).toBeCloseTo(170.2);
		expect(walkFrame(2, 100, 8)).toBe(3);
	});

	it('R-SPR-029: 1-step turns move only the head; further turns put the body one step short (legacy lookTo)', () => {
		// d = current − target (mod 8). d 1 / 7: head only (2 / 1), or the body takes the target when
		// the head already turned that way (Entity.js:525-554)
		expect(lookTo({ direction: 1, headDir: 0 }, 0)).toEqual({ direction: 1, headDir: 2 });
		expect(lookTo({ direction: 1, headDir: 2 }, 0)).toEqual({ direction: 0, headDir: 0 });
		expect(lookTo({ direction: 7, headDir: 0 }, 0)).toEqual({ direction: 7, headDir: 1 });
		expect(lookTo({ direction: 7, headDir: 1 }, 0)).toEqual({ direction: 0, headDir: 0 });
		// d 2, 3 / 5, 6: the body rotates to one step short of the target, head turned
		expect(lookTo({ direction: 3, headDir: 0 }, 0)).toEqual({ direction: 1, headDir: 2 });
		expect(lookTo({ direction: 6, headDir: 0 }, 0)).toEqual({ direction: 7, headDir: 1 });
		// d 0 straightens the head; d 4 (opposite) keeps a turned head's side, a straight head turns fully.
		// Legacy contradicts the spec's "a larger turn rotates the body and straightens the head" here.
		expect(lookTo({ direction: 0, headDir: 2 }, 0)).toEqual({ direction: 0, headDir: 0 });
		expect(lookTo({ direction: 0, headDir: 1 }, 4)).toEqual({ direction: 3, headDir: 1 });
		expect(lookTo({ direction: 0, headDir: 0 }, 4)).toEqual({ direction: 4, headDir: 0 });
		expect([directionTo(1, 0), directionTo(-1, 0), directionTo(0, 1), directionTo(0, 0), directionTo(0.6, -2)]).toEqual([
			6, 2, 4, 0, 7
		]);
	});

	it('R-SPR-030: far→near sort with GID tie-break; re-sort cadence; pass split', () => {
		expect(entitySortDepth(10, 123)).toBeCloseTo(10.023);
		const sorted = sortFarToNear([
			{ id: 'near', depth: entitySortDepth(5, 1) },
			{ id: 'far', depth: entitySortDepth(20, 1) },
			{ id: 'tieB', depth: entitySortDepth(10, 2) },
			{ id: 'tieA', depth: entitySortDepth(10, 1) }
		]);
		expect(sorted.map(e => e.id)).toEqual(['far', 'tieB', 'tieA', 'near']);
		expect(shouldResort({ listChanged: false, frame: 3 })).toBe(true);
		expect(shouldResort({ listChanged: false, frame: 4 })).toBe(false);
		expect(shouldResort({ listChanged: false, frame: 3, performanceMode: true })).toBe(false);
		expect(shouldResort({ listChanged: false, frame: 6, performanceMode: true })).toBe(true);
		expect(shouldResort({ listChanged: true, frame: 1 })).toBe(true);
		expect(entityPass({ isEffect: false })).toBe('entities');
		expect(entityPass({ isEffect: true })).toBe('effectEntities');
	});

	it('R-SPR-031: attachment record state (opacity, head lift, z, shadow)', () => {
		expect(attachmentRecordState({ opacity: 0.5, head: true, directional: true }, 3)).toEqual({
			color: [1, 1, 1, 0.5],
			zIndex: 500,
			depthWrite: false,
			ignoreShadow: false,
			liftPx: 100,
			direction: 3
		});
		expect(attachmentRecordState({ behind: true }, 3)).toMatchObject({ zIndex: 1, ignoreShadow: true, direction: 0 });
	});

	it('R-SPR-031: non-repeating attachment is removed at its last frame unless stopAtEnd', () => {
		expect(attachmentLifetime({ repeat: false, stopAtEnd: false, frames: 4, delay: 100, startTick: 0 }, 1000).alive).toBe(false);
		// Drawn once more on that last frame
		expect(attachmentLifetime({ repeat: false, frames: 4, delay: 100, startTick: 0 }, 300)).toMatchObject({
			draw: true,
			alive: false,
			frame: 3
		});
		expect(attachmentLifetime({ repeat: false, stopAtEnd: true, frames: 4, delay: 100, startTick: 0 }, 1000)).toMatchObject({
			alive: true,
			frame: 3
		});
		// duration caps repeating ones (removed undrawn)
		expect(attachmentLifetime({ repeat: true, duration: 500, frames: 4, delay: 100, startTick: 0 }, 499)).toMatchObject({
			draw: true,
			alive: true,
			frame: 0
		});
		expect(attachmentLifetime({ repeat: true, duration: 500, frames: 4, delay: 100, startTick: 0 }, 500)).toMatchObject({
			draw: false,
			alive: false
		});
	});

	it('R-SPR-032: STR attachments scale with the entity', () => {
		expect(strAttachmentTransform({ xSize: 5, ySize: 5, xOffset: 1, yOffset: 2 })).toEqual({
			scale: 1,
			pivot: [320, 320],
			verticalBase: 0,
			offset: [7, 14]
		});
		expect(strAttachmentTransform({ xSize: 10, ySize: 10 }).scale).toBe(2);
	});

	it.fails('R-SPR-032 [pending]: persistent hat effect reuses the last valid frame on blank keys', () => {
		expect(persistentHatFrame({ lastValid: { aniframe: 2 } }, 5)).toMatchObject({ aniframe: 2 });
	});

	it('R-SPR-033: dropped item falls 25 cells/s and stops at the ground', () => {
		expect(droppedItemZ(0, 10, 200)).toBeCloseTo(5);
		expect(droppedItemZ(0, 30, 1000)).toBeCloseTo(5);
		expect(droppedItemZ(1, 10, 1000)).toBe(1);
	});
});
