/**
 * Focused tests of the entity composer: planPlayerLayers / planEntityLayers (R-SPR-007…013),
 * selectAnimationFrame (R-SPR-027/028) and the EntityRender.renderRecords mixin. The legacy
 * parity of the whole path is the root record-diff (tests/renderer/RecordDiff.entity.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_ADDITIVE,
	BLEND_NORMAL,
	EntityRender,
	EntityType,
	PC_ACTIONS,
	RecordStream,
	invisibilityTint,
	planEntityLayers,
	planPlayerLayers,
	resolveInvisibility,
	selectAnimationFrame,
	statusEffectColor
} from '../../src/index.js';

const order = plan => plan.map(e => [e.slot, e.zIndex]);

describe('planPlayerLayers (R-SPR-007)', () => {
	const full = { type: EntityType.PC, weapon: 1, shield: 1, robe: 1, hats: { top: 6, mid: 7, bottom: 5 } };

	it('front: shadow, cart, robe, body, head, hats, weapon, trail, shield in legacy draw order', () => {
		expect(order(planPlayerLayers({ ...full, direction: 0, cart: true }))).toEqual([
			['shadow', -1],
			['cartShadow', -1],
			['cart', 1],
			['robe', 1],
			['body', 150],
			['head', 300],
			['hatMid', 350],
			['hatTop', 450],
			['hatBottom', 550],
			['weapon', 500],
			['weaponTrail', null],
			['shield', 550]
		]);
	});

	it('direction 2 is "behind" (shield first) but not "back" (robe still in front)', () => {
		const plan = order(planPlayerLayers({ ...full, direction: 2 }));
		expect(plan.slice(0, 3)).toEqual([
			['shadow', -1],
			['shield', -1],
			['robe', 1]
		]);
		expect(plan.filter(([slot]) => slot === 'shield')).toHaveLength(1);
	});

	it('back (3-5): robe after the hats at bodyZ + 400, cart at bodyZ + 500 continuing the counter', () => {
		const plan = planPlayerLayers({ ...full, direction: 4, cart: true });
		expect(order(plan)).toEqual([
			['shadow', -1],
			['shield', -1],
			['body', 150],
			['head', 300],
			['hatMid', 350],
			['hatTop', 450],
			['hatBottom', 550],
			['robe', 650],
			['cartShadow', 750],
			['cart', null],
			['weapon', 500],
			['weaponTrail', null]
		]);
		expect(plan.find(e => e.slot === 'shield').depthWrite).toBe(false);
		expect(plan.find(e => e.slot === 'cart').depthWrite).toBe(false);
	});

	it('riding doubles bodyZ; riding while walking toward the front adds 250 and doubles the body', () => {
		const walk = planPlayerLayers({ ...full, riding: true, action: PC_ACTIONS.WALK, direction: 0 });
		expect(walk.find(e => e.slot === 'body').zIndex).toBe(300);
		expect(walk.find(e => e.slot === 'head').zIndex).toBe(800);
		const idle = planPlayerLayers({ ...full, riding: true, direction: 4 });
		expect(idle.find(e => e.slot === 'body').zIndex).toBe(150);
		expect(idle.find(e => e.slot === 'head').zIndex).toBe(550);
	});

	it('R-SPR-008: mid equal to lower and top equal to mid are not planned', () => {
		const plan = planPlayerLayers({ hats: { top: 7, mid: 5, bottom: 5 } });
		expect(plan.map(e => e.slot)).not.toContain('hatMid');
		expect(plan.map(e => e.slot)).toContain('hatTop');
		const plan2 = planPlayerLayers({ hats: { top: 7, mid: 7, bottom: 5 } });
		expect(plan2.map(e => e.slot)).not.toContain('hatTop');
	});

	it('R-SPR-009: a tall robe (taller than body + head) goes behind the front body', () => {
		const plan = planPlayerLayers({ robe: 1, direction: 0, robeHeight: 300, bodyHeight: 128 });
		expect(plan.find(e => e.slot === 'robe').zIndex).toBe(-300);
	});

	it('R-SPR-011: no shadow when sitting, dead (player ids) or job 45', () => {
		expect(planPlayerLayers({ action: PC_ACTIONS.SIT })[0].slot).toBe('body');
		expect(planPlayerLayers({ action: PC_ACTIONS.DIE })[0].slot).toBe('body');
		expect(planPlayerLayers({ job: 45 })[0].slot).toBe('body');
		expect(planPlayerLayers({ hideShadow: true })[0].slot).toBe('body');
		expect(planPlayerLayers({})[0]).toMatchObject({ slot: 'shadow', zIndex: -1, depthWrite: false });
	});
});

describe('planEntityLayers (R-SPR-013, R-SPR-005)', () => {
	it('mobs only test depth; falcons use 1000; NPC bodies ignore the depth min cap', () => {
		const mobActions = { IDLE: 0, WALK: 1, ATTACK: 2, HURT: 3, DIE: 4, SIT: -1 };
		expect(planEntityLayers({ type: EntityType.MOB, actions: mobActions })).toEqual([
			{ slot: 'shadow', part: 'shadow', zIndex: -1, depthWrite: false, main: false },
			{ slot: 'body', part: 'body', zIndex: 150, depthWrite: false, main: true, ignoreDepthMinCap: false }
		]);
		// A mob dies with action 4 (EntityAction.js:229): no shadow
		expect(planEntityLayers({ type: EntityType.MOB, actions: mobActions, action: 4 })).toHaveLength(1);
		expect(planEntityLayers({ type: EntityType.FALCON }).at(-1)).toMatchObject({ zIndex: 1000, depthWrite: true });
		expect(planEntityLayers({ type: EntityType.NPC }).at(-1)).toMatchObject({
			depthWrite: true,
			ignoreDepthMinCap: true
		});
	});
});

describe('selectAnimationFrame (R-SPR-027, R-SPR-028)', () => {
	const act = (frames, delay = 100) => ({ delay, animations: Array.from({ length: frames }, () => ({})) });
	const pc = (action, animation = {}) => ({
		type: EntityType.PC,
		action,
		headDir: 1,
		animation: { tick: 0, frame: 0, repeat: true, play: true, next: false, ...animation }
	});

	it('idle PC body / robe show headDir; head and hats split into 3 head-direction groups', () => {
		expect(selectAnimationFrame(pc(PC_ACTIONS.IDLE), act(3), 999, { part: 'body' }).frame).toBe(1);
		expect(selectAnimationFrame(pc(PC_ACTIONS.IDLE), act(3), 999, { part: 'robe' }).frame).toBe(1);
		// 6 head frames → 2 per group; headDir 1 → group starting at 2; 250 ms / 100 → step 2 % 2 = 0
		expect(selectAnimationFrame(pc(PC_ACTIONS.IDLE), act(6), 250, { part: 'head' }).frame).toBe(2);
		expect(selectAnimationFrame(pc(PC_ACTIONS.IDLE), act(6), 150, { part: 'head' }).frame).toBe(3);
	});

	it('shadows show frame 0; an idle cart shows frame 0', () => {
		expect(selectAnimationFrame(pc(PC_ACTIONS.ATTACK1), act(4), 250, { part: 'shadow' }).frame).toBe(0);
		expect(selectAnimationFrame(pc(PC_ACTIONS.IDLE), act(4), 250, { part: 'cart' }).frame).toBe(0);
	});

	it('one-shot: holds the last frame; the body reports the end and its `next`', () => {
		const next = { action: 0, repeat: true };
		const attack = pc(PC_ACTIONS.ATTACK1, { repeat: false, next });
		expect(selectAnimationFrame(attack, act(4), 250, { part: 'body' })).toEqual({
			frame: 2,
			ended: false,
			next: null
		});
		expect(selectAnimationFrame(attack, act(4), 300, { part: 'body' })).toEqual({ frame: 3, ended: true, next });
		expect(selectAnimationFrame(attack, act(4), 900, { part: 'weapon' })).toEqual({
			frame: 3,
			ended: false,
			next: null
		});
	});

	it('attacks without an ACT delay use attack_speed / frames, at least 100 ms', () => {
		const attack = { ...pc(PC_ACTIONS.ATTACK1), attackSpeed: 800 };
		expect(selectAnimationFrame(attack, act(4, 0), 450, { part: 'weapon' }).frame).toBe(2);
		expect(selectAnimationFrame({ ...attack, attackSpeed: 200 }, act(4, 0), 250, { part: 'weapon' }).frame).toBe(
			2
		);
	});

	it('animation.speed and animation.length override delay and frame count; paused stays put', () => {
		const e = pc(PC_ACTIONS.ATTACK1, { speed: 50, length: 2 });
		expect(selectAnimationFrame(e, act(4), 150, { part: 'weapon' }).frame).toBe(1);
		expect(selectAnimationFrame(pc(PC_ACTIONS.ATTACK1, { play: false, frame: 3 }), act(4), 999).frame).toBe(3);
	});

	it('R-SPR-028: walk frames follow distance, the body phase is shared with later parts', () => {
		const walker = { ...pc(PC_ACTIONS.WALK), walk: { dist: 2, speed: 150 } };
		const shared = {};
		expect(selectAnimationFrame(walker, act(8, 100), 0, { part: 'body', walkPhase: shared }).frame).toBe(3);
		// A part with another ACT delay reuses the body phase within the frame
		expect(selectAnimationFrame(walker, act(8, 200), 0, { part: 'head', walkPhase: shared }).frame).toBe(3);
		const falcon = { ...walker, type: EntityType.FALCON };
		expect(selectAnimationFrame(falcon, act(8, 100), 0, { part: 'body' }).frame).toBe(0);
	});
});

describe('EntityRender.renderRecords', () => {
	const layer = (index, extra = {}) => ({
		index,
		pos: [0, -10],
		scale: [1, 1],
		color: [1, 1, 1, 1],
		angle: 0,
		is_mirror: 0,
		spr_type: 0,
		...extra
	});
	const sprite = (name, count) => ({
		rgba_index: 0,
		old_rgba_index: 0,
		frames: Array.from({ length: count }, (_, i) => ({ width: 32, height: 64, texture: `${name}#${i}` }))
	});
	/** One ACT action per (action × 8 directions); every frame holds `layers(frame)`. */
	const actOf = (frames, layers, anchor = { x: 0, y: 0 }) => ({
		actions: Array.from({ length: 16 }, () => ({
			delay: 100,
			animations: Array.from({ length: frames }, (_, f) => ({ layers: layers(f), sound: -1, pos: [anchor] }))
		}))
	});
	const pcEntity = (extra = {}) => {
		const entity = {
			gid: 7,
			type: EntityType.PC,
			position: [10, 20, 1],
			direction: 0,
			headDir: 0,
			action: PC_ACTIONS.IDLE,
			animation: { tick: 1000, frame: 0, repeat: true, play: true, next: false },
			job: 0,
			effectColor: [1, 0.5, 1, 1],
			views: {
				shadow: { spr: sprite('shadow', 1), act: actOf(1, () => [layer(0, { color: [1, 1, 1, 0.5] })]), size: 1 },
				body: {
					spr: sprite('body', 2),
					act: actOf(2, () => [layer(0), layer(-1), layer(1, { is_mirror: 1 })], { x: 0, y: -70 }),
					size: 1
				},
				head: { spr: sprite('head', 1), act: actOf(3, () => [layer(0)], { x: 0, y: -5 }), size: 1 },
				weapon: {
					spr: sprite('weapon', 1),
					act: actOf(4, () => [layer(0, { color: [1, 1, 1, 0] }), layer(0)]),
					size: 1
				}
			},
			weapon: 1,
			...extra
		};
		EntityRender.call(entity);
		return entity;
	};
	const frame = (tick = 1000) => ({
		tick,
		camera: { direction: 0 },
		shadowFactorAt: () => 0.75,
		cellHeightAt: () => 0.5
	});

	it('emits legacy order and zIndex: per-element reset, post-increment per drawn layer only', () => {
		const stream = new RecordStream();
		pcEntity().renderRecords(stream, frame());
		expect(stream.records.map(r => [r.source, r.zIndex])).toEqual([
			['7/shadow', -1],
			['7/body', 150],
			['7/body', 151],
			['7/head', 300],
			['7/weapon', 500] // the alpha-0 weapon layer did not consume 500
		]);
		// RecordStream's own counter continues from the composer's last record (R-SPR-006)
		expect(stream.sprite({}).zIndex).toBe(501);
	});

	it('positions: body lifted 0.2 (R-SPR-004), shadow on the cell height + 0.05 (R-SPR-011)', () => {
		const stream = new RecordStream();
		pcEntity().renderRecords(stream, frame());
		const [shadow, body] = stream.records;
		expect(shadow.position[2]).toBeCloseTo(0.55, 10);
		expect(body.position[2]).toBeCloseTo(1.2, 10);
		expect(shadow).toMatchObject({ depthWrite: false, depthTest: true, depthCorrection: true });
		expect(body).toMatchObject({ depthWrite: true, depthCorrection: true, ignoreDepthMinCap: false });
	});

	it('colour: layer × effectColor (shadow ignores it); ground shadow travels as shadowFactor (R-SPR-017)', () => {
		const stream = new RecordStream();
		pcEntity().renderRecords(stream, frame());
		const [shadow, body] = stream.records;
		expect(shadow.color).toEqual([1, 1, 1, 0.5]);
		expect(body.color).toEqual([1, 0.5, 1, 1]);
		expect(stream.records.every(r => r.shadowFactor === 0.75)).toBe(true);
	});

	it('mirrored layers get a negative width; head anchors on the body attach point', () => {
		const stream = new RecordStream();
		pcEntity().renderRecords(stream, frame());
		const records = stream.records;
		expect(records[1].size).toEqual([32, 64]);
		expect(records[2].size).toEqual([-32, 64]);
		expect(records[2].mirror).toBe(true);
		// head offset = layer pos + (body anchor - head anchor) = (0,-10) + (0,-70) - (0,-5)
		expect(records[3].offset).toEqual([0, -75]);
	});

	it('a one-shot body switches to `next` mid-frame, so later elements already use it', () => {
		const entity = pcEntity({
			action: PC_ACTIONS.ATTACK1,
			animation: {
				tick: 0,
				frame: 0,
				repeat: false,
				play: true,
				next: { action: PC_ACTIONS.IDLE, repeat: true, play: true }
			}
		});
		entity.views.body = { spr: sprite('body', 2), act: actOf(2, f => [layer(f)]), size: 1 };
		entity.views.head = { spr: sprite('head', 3), act: actOf(3, f => [layer(f)]), size: 1 };
		const stream = new RecordStream();
		entity.renderRecords(stream, frame(1000));
		expect(entity.action).toBe(PC_ACTIONS.IDLE);
		expect(entity.animation).toMatchObject({ tick: 1000, repeat: true, play: true, frame: 0 });
		// The body drew the attack's held last frame; the head after it already runs idle (frame 0,
		// where the attack would have held head#2)
		expect(stream.records.find(r => r.source === '7/body').texture).toBe('body#1');
		expect(stream.records.find(r => r.source === '7/head').texture).toBe('head#0');
	});

	it('discrepancy #13 FIX: an entity without a started clock starts it at its first frame, not epoch 0', () => {
		const entity = pcEntity();
		delete entity.animation;
		const epoch = 1_700_000_000_123;
		entity.renderRecords(new RecordStream(), frame(epoch));
		expect(entity.animation.tick).toBe(epoch);
	});

	it('R-SPR-023: berserk draws additive except the shadow; marionette makes every layer additive', () => {
		const stream = new RecordStream();
		pcEntity({ opt3: { berserk: true } }).renderRecords(stream, frame());
		expect(stream.records[0].blend).toBe(BLEND_NORMAL);
		expect(stream.records.slice(1).every(r => r.blend === BLEND_ADDITIVE)).toBe(true);
		const marionette = new RecordStream();
		pcEntity({ opt3: { marionette: true } }).renderRecords(marionette, frame());
		expect(marionette.records.every(r => r.blend === BLEND_ADDITIVE)).toBe(true);
	});

	it('draws nothing when invisible, hidden or a GR2 body; a missing view keeps its zIndex reset', () => {
		for (const extra of [{ effectColor: [1, 1, 1, 0] }, { hideEntity: true }, { gr2: true }]) {
			const stream = new RecordStream();
			pcEntity(extra).renderRecords(stream, frame());
			expect(stream.records).toHaveLength(0);
		}
		const stream = new RecordStream();
		const entity = pcEntity();
		entity.views.weaponTrail = entity.views.weapon;
		delete entity.views.weapon;
		entity.renderRecords(stream, frame());
		// weapon (500) has no files; the trail continues from the 500 reset (EntityRender.js:507-510)
		expect(stream.records.at(-1)).toMatchObject({ source: '7/weaponTrail', zIndex: 500 });
	});

	it('R-SPR-010: the cart draws only while playing; Super Novices use cart 0', () => {
		const cartView = name => ({ spr: sprite(name, 1), act: actOf(1, () => [layer(0)]), size: 1 });
		const entity = pcEntity({ hasCart: true, cartNum: 2, isSuperNovice: true });
		entity.views.cartShadow = cartView('cartShadow');
		entity.views.cart = [cartView('cart0'), cartView('cart1'), cartView('cart2')];
		const idle = new RecordStream();
		entity.renderRecords(idle, frame());
		expect(idle.records.map(r => r.source)).not.toContain('7/cart');
		const playing = new RecordStream();
		entity.renderRecords(playing, { ...frame(), playing: true });
		const cart = playing.records.find(r => r.source === '7/cart');
		expect(cart).toMatchObject({ texture: 'cart0#0', zIndex: 1, depthWrite: false, offset: [0, -40] });
	});

	it('R-SPR-018…023: without an effectColor, colour and blend come from the status', () => {
		const stream = new RecordStream();
		const entity = pcEntity({ effectColor: undefined, status: { body: 'STONE', virtue: ['BERSERK'] } });
		entity.renderRecords(stream, frame());
		const body = stream.records.find(r => r.source === '7/body');
		expect(body.color.map(v => +v.toFixed(6))).toEqual([0.1, 0.04, 0.04, 1]);
		expect(body.blend).toBe(BLEND_ADDITIVE);
		expect(stream.records[0]).toMatchObject({ source: '7/shadow', blend: BLEND_NORMAL, color: [1, 1, 1, 0.5] });
		const cloaked = new RecordStream();
		pcEntity({ effectColor: undefined, status: { invisibility: ['CLOAK'] } }).renderRecords(cloaked, frame());
		expect(cloaked.records).toHaveLength(0);
	});
});

describe('entity status colour (R-SPR-018…022)', () => {
	it('R-SPR-021: one invisibility state applies, by legacy precedence', () => {
		expect(resolveInvisibility([])).toBe('NONE');
		expect(resolveInvisibility(['SHADOWFORM', 'CLOAK'])).toBe('CLOAK');
		expect(resolveInvisibility(['CAMOUFLAGE', 'SHADOWFORM'])).toBe('CAMOUFLAGE');
		expect(resolveInvisibility(['CHASEWALK', 'INVISIBLE'])).toBe('INVISIBLE');
	});

	it('R-SPR-021: INVISIBLE stays hidden under intravision; the others turn black', () => {
		expect(invisibilityTint('INVISIBLE', true)).toEqual([1, 1, 1, 0]);
		expect(invisibilityTint('CLOAK', true)).toEqual([0, 0, 0, 1]);
		expect(invisibilityTint('SHADOWFORM', true)).toEqual([0, 0, 0, 1]);
	});

	it('statusEffectColor multiplies body × health × effect × virtue × flash', () => {
		expect(statusEffectColor()).toEqual([1, 1, 1, 1]);
		const c = statusEffectColor({
			body: 'FREEZE',
			health: { poison: true },
			invisibility: ['SHADOWFORM'],
			virtue: ['QUICKEN', 'MARIONETTE'],
			flash: [1, 1, 0.5, 1]
		});
		const expected = [0 * 0.9 * 0.2 * 1, 0.4 * 0.4 * 0.2 * 0.34, 0.8 * 0.8 * 0.2 * 0.71 * 0.5, 0.2 * 0.5];
		c.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
	});
});
