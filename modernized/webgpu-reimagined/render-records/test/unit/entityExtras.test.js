/**
 * Focused tests of the remaining entity rules: Assumptio halo (R-SPR-024), after-image trails
 * (R-SPR-025), lookTo (R-SPR-029) and sprite attachments (R-SPR-031). Legacy parity of the whole
 * path is the root record-diff (tests/renderer/RecordDiff.entityExtras.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	ATTACHMENT_SPRITE_DIR,
	BLEND_ADDITIVE,
	BLEND_NORMAL,
	EntityRender,
	EntityType,
	PC_ACTIONS,
	RecordStream,
	addAttachment,
	afterImageFlags,
	attachmentOffset,
	createAttachment,
	directionTo,
	lookTo,
	removeAttachment,
	shouldCaptureTrail,
	trailAlpha,
	trailConfig
} from '../../src/index.js';

describe('trail rules (R-SPR-025)', () => {
	it('drops a snapshot at base alpha ≤ 0.05 (inclusive) or past its duration', () => {
		expect(trailAlpha(1, 349)).toBeGreaterThan(0.05);
		expect(trailAlpha(1, 350)).toBe(0); // 0.4·(1 − 350/400) = 0.05 exactly
		expect(trailAlpha(1, 401)).toBe(0);
	});

	it('type 3 tests the threshold before doubling; type 4 is never dropped', () => {
		// 0.4·(1 − 710/800) = 0.045 → dropped although doubled it would be 0.09
		expect(trailAlpha(3, 710)).toBe(0);
		expect(trailAlpha(3, 600)).toBeCloseTo(0.2);
		expect(trailAlpha(4, 790)).toBeCloseTo(0.005);
		expect(trailAlpha(4, 5000)).toBe(0);
	});

	it('configuration: fast moves override every interval; performance mode halves the length', () => {
		expect(trailConfig({ blurType: 5, fastMove: true }).interval).toBe(30);
		expect(trailConfig({ blurType: 1, performanceMode: true, trailLength: 7 }).maxSnapshots).toBe(3);
		expect(trailConfig({ blurType: 4, performanceMode: true }).maxSnapshots).toBe(1);
		expect(trailConfig({ blurType: 4 }).white).toBe(true);
	});

	it('flags: Bunshin wins over Hallucination Walk, which wins over the effect-table blur type', () => {
		expect(afterImageFlags({ opt3: { bunshin: true, hallucinationWalk: true }, blurType: 4 }).blurType).toBe(5);
		expect(afterImageFlags({ opt3: { hallucinationWalk: true }, blurType: 4 }).blurType).toBe(3);
		expect(afterImageFlags({ enableTrail: true, blurType: 4 })).toEqual({ halo: false, trail: true, blurType: 4 });
		expect(afterImageFlags({ fastMoveTrail: true })).toEqual({ halo: false, trail: true, blurType: 1 });
		expect(afterImageFlags({ opt3: { assumptio: true } })).toEqual({ halo: true, trail: false, blurType: 1 });
		expect(afterImageFlags({ opt3: { marionette: true } }).trail).toBe(false);
	});

	it('capture: walk / fast move for types 1 and 3, combat for 5, once for 4', () => {
		const base = { actions: PC_ACTIONS, fastMove: false, sinceLast: 100, stored: 0, interval: 80 };
		expect(shouldCaptureTrail({ ...base, blurType: 1, action: PC_ACTIONS.WALK })).toBe(true);
		expect(shouldCaptureTrail({ ...base, blurType: 1, action: PC_ACTIONS.IDLE })).toBe(false);
		expect(shouldCaptureTrail({ ...base, blurType: 1, action: PC_ACTIONS.IDLE, fastMove: true })).toBe(true);
		expect(shouldCaptureTrail({ ...base, blurType: 1, action: PC_ACTIONS.WALK, sinceLast: 80 })).toBe(false);
		expect(shouldCaptureTrail({ ...base, blurType: 5, action: PC_ACTIONS.SKILL })).toBe(true);
		expect(shouldCaptureTrail({ ...base, blurType: 5, action: PC_ACTIONS.WALK })).toBe(false);
		expect(shouldCaptureTrail({ ...base, blurType: 4, action: PC_ACTIONS.IDLE })).toBe(true);
		expect(shouldCaptureTrail({ ...base, blurType: 4, action: PC_ACTIONS.WALK, stored: 1 })).toBe(false);
	});
});

describe('lookTo (R-SPR-029)', () => {
	it('the head never sits more than one step off the body, and a turn never leaves the target behind', () => {
		for (let direction = 0; direction < 8; ++direction) {
			for (const headDir of [0, 1, 2]) {
				for (let target = 0; target < 8; ++target) {
					const next = lookTo({ direction, headDir }, target);
					expect([0, 1, 2]).toContain(next.headDir);
					const offset = { 0: 0, 1: 7, 2: 1 }[next.headDir];
					// headDir 1 = body one step clockwise of where it looks, 2 = counter-clockwise
					if ((direction - target + 8) % 8 !== 4 || headDir === 0) {
						expect((target + offset) % 8).toBe(next.direction);
					}
				}
			}
		}
	});

	it('directionTo rounds offsets first', () => {
		expect(directionTo(0.4, -0.4)).toBe(0);
		expect(directionTo(-0.6, 0.6)).toBe(3);
		expect(directionTo(1.2, 3)).toBe(5);
	});
});

describe('attachment lists (R-SPR-031)', () => {
	it('createAttachment normalises like legacy add', () => {
		const a = createAttachment({ uid: 'x', file: 'f', head: true, xOffset: 2.7, opacity: undefined }, 500);
		expect(a).toMatchObject({
			startTick: 500,
			opacity: 1,
			direction: true,
			frame: 0,
			head: true,
			position: [2, 0],
			repeat: false,
			duration: 0,
			stopAtEnd: false,
			delay: false,
			renderBefore: false,
			spr: `${ATTACHMENT_SPRITE_DIR}f.spr`,
			act: `${ATTACHMENT_SPRITE_DIR}f.act`
		});
		// An explicit frame (even 0) disables direction; null opacity coerces to 0 as legacy isNaN does
		expect(createAttachment({ file: 'f', frame: 0, opacity: null }, 0)).toMatchObject({ direction: false, opacity: null });
		expect(createAttachment({ completeFile: 'data/x' }, 0).spr).toBe('data/x.spr');
		expect(createAttachment({ strFile: 'a.str' }, 0)).toBeNull();
	});

	it('offsets win over the head lift', () => {
		expect(attachmentOffset({ position: false, head: true })).toEqual([0, -100]);
		expect(attachmentOffset({ position: [3, -4], head: true })).toEqual([3, -4]);
	});

	it('uid replaces unless stackable; an unloaded sprite never joins but still replaces', () => {
		const list = [];
		const view = { spr: {}, act: {} };
		addAttachment(list, { uid: 'a', n: 1, view });
		addAttachment(list, { uid: 'a', n: 2, view });
		addAttachment(list, { uid: 's', n: 3, stackable: true, view });
		addAttachment(list, { uid: 's', n: 4, stackable: true, view });
		expect(list.map(a => a.n)).toEqual([2, 3, 4]);
		addAttachment(list, { uid: 'a', n: 5, view: { spr: null, act: null } });
		expect(list.map(a => a.n)).toEqual([3, 4]);
		removeAttachment(list, 's');
		expect(list).toEqual([]);
	});
});

describe('EntityRender.renderRecords: halo, trails, attachments', () => {
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
	const actOf = (frames, layers, actions = 16) => ({
		actions: Array.from({ length: actions }, () => ({
			delay: 100,
			animations: Array.from({ length: frames }, (_, f) => ({ layers: layers(f), sound: -1, pos: [{ x: 0, y: 0 }] }))
		}))
	});
	const mob = (extra = {}) => {
		const entity = {
			gid: 9,
			type: EntityType.MOB,
			position: [10, 20, 1],
			direction: 0,
			headDir: 0,
			action: 0,
			actions: { IDLE: 0, WALK: 1, ATTACK: 2, ATTACK1: -1, ATTACK2: -1, ATTACK3: -1, SKILL: -1, DIE: 4 },
			animation: { tick: 0, frame: 0, repeat: true, play: true, next: false },
			effectColor: [1, 0.5, 1, 1],
			views: { body: { spr: sprite('mob', 2), act: actOf(2, () => [layer(0), layer(1)]), size: 1 } },
			...extra
		};
		EntityRender.call(entity);
		return entity;
	};
	const frame = tick => ({ tick, camera: { direction: 0 }, shadowFactorAt: () => 0.75, cellHeightAt: () => 0.5 });
	const render = (entity, tick) => {
		const stream = new RecordStream();
		entity.renderRecords(stream, frame(tick));
		return stream.records;
	};

	it('halo: additive redraw before the body, from zIndex 50, 1.15× size, alpha 0.6', () => {
		const records = render(mob({ opt3: { assumptio: true } }), 0);
		expect(records.map(r => [r.zIndex, r.blend])).toEqual([
			[50, BLEND_ADDITIVE],
			[51, BLEND_ADDITIVE],
			[150, BLEND_NORMAL],
			[151, BLEND_NORMAL]
		]);
		expect(records[0].size).toEqual([32 * 1.15, 64 * 1.15]);
		expect(records[0].color).toEqual([1, 1, 1, 0.6]);
		expect(records[0].depthWrite).toBe(false);
	});

	it('trail: snapshots persist on the entity across frames, unlifted, zIndex 140 − i', () => {
		const entity = mob({ enableTrail: true, action: 1, walk: { dist: 0, speed: 150 } });
		render(entity, 1000);
		entity.position = [11, 20, 1];
		render(entity, 1100);
		entity.position = [12, 20, 1];
		const records = render(entity, 1200);
		const ghosts = records.filter(r => r.zIndex < 150); // mob bodies write no depth either
		expect(ghosts.map(r => r.zIndex)).toEqual([140, 141, 139, 140, 138, 139]);
		expect(ghosts.map(r => r.position[0])).toEqual([12, 12, 11, 11, 10, 10]);
		expect(ghosts[0].position[2]).toBe(1); // no 0.2 body lift
		expect(ghosts[0].color).toEqual([1, 0.5, 1, 0.4]); // type 1 keeps the entity colour
		expect(entity.trails.body.snapshots).toHaveLength(3);
	});

	it('attachments: behind pass after the shadow at the raw position, front pass last; finished ones leave the list', () => {
		const view = { spr: sprite('att', 4), act: actOf(4, f => [layer(f)], 8) };
		const behind = { ...createAttachment({ uid: 'b', file: 'b', renderBefore: true, repeat: true }, 0), view };
		const once = { ...createAttachment({ uid: 'o', file: 'o', frame: 0, head: true, opacity: 0.5 }, 0), view };
		const entity = mob({ attachments: [behind, once] });
		const records = render(entity, 350);
		expect(records.map(r => [r.texture, r.zIndex, r.shadowFactor])).toEqual([
			['att#3', 1, 1],
			['mob#0', 150, 0.75], // #34: the body keeps its ground shadow (legacy leaks 1 here)
			['mob#1', 151, 0.75],
			['att#3', 500, 0.75]
		]);
		expect(records[0].position).toEqual([10, 20, 1]);
		expect(records[3].position).toEqual([10, 20, 1.2]);
		expect(records[3].offset).toEqual([0, -110]);
		expect(records[3].color).toEqual([1, 1, 1, 0.5]);
		expect(entity.attachments.map(a => a.uid)).toEqual(['b']);
	});

	it('#34: an ignoreShadow attachment draws at shadow factor 1 without leaking it to later draws', () => {
		const view = { spr: sprite('att', 4), act: actOf(4, f => [layer(f)], 8) };
		const front = (uid, extra) => ({ ...createAttachment({ uid, file: uid, repeat: true, ...extra }, 0), view });
		const entity = mob({ attachments: [front('a', { ignoreShadow: true }), front('b'), front('c', { ignoreShadow: true })] });
		const records = render(entity, 350);
		expect(records.map(r => [r.texture.split('#')[0], r.shadowFactor])).toEqual([
			['mob', 0.75],
			['mob', 0.75],
			['att', 1],
			['att', 0.75],
			['att', 1]
		]);
		// the next frame starts from the ground factor again
		expect(render(entity, 400)[0].shadowFactor).toBe(0.75);
	});
});
