import { describe, it, expect } from 'vitest';
import { CursorDriver } from '../../src/api/CursorDriver.js';
import { Preview2DComposer } from '../../src/api/Preview2DComposer.js';
import { CURSOR_ACTION, CURSOR_INFO, ENTITY_TYPE, cursorInfo } from '../../src/domain/CursorTypes.js';
import { cursorHotspot, cursorStyle, selectCursorFrame } from '../../src/domain/CursorAnimation.js';
import { CURSOR_CELL_SIZE } from '../../src/constants.js';
import { fakeCanvasFactory } from '../support/FakeCanvas.js';
import { indexedFrame, rgbaFrame, makePalette, mapFrameSource, spriteRecord, manualScheduler } from '../support/fixtures.js';

const ACT_DELAY = 100;
const frameAt = (type, elapsed, extra = {}) =>
	selectCursorFrame({ type, actDelay: ACT_DELAY, frameCount: 4, tick: 1000 + elapsed, startTick: 1000, ...extra });

describe('R-UI-005 game cursor: animation rate', () => {
	it('[R-UI-005] frame period is ACT delay x multiplier: DEFAULT 2.0, TARGET 0.5, listed others 1.0', () => {
		expect(cursorInfo(CURSOR_ACTION.DEFAULT).delayMult).toBe(2.0);
		expect(cursorInfo(CURSOR_ACTION.TARGET).delayMult).toBe(0.5);
		for (const t of [CURSOR_ACTION.TALK, CURSOR_ACTION.WARP, CURSOR_ACTION.ROTATE, CURSOR_ACTION.PICK, CURSOR_ACTION.NOWALK]) {
			expect(cursorInfo(t).delayMult).toBe(1.0);
		}
		expect(frameAt(CURSOR_ACTION.DEFAULT, 199)).toBe(0);
		expect(frameAt(CURSOR_ACTION.DEFAULT, 200)).toBe(1);
		expect(frameAt(CURSOR_ACTION.TARGET, 50)).toBe(1);
		expect(frameAt(CURSOR_ACTION.TALK, 100)).toBe(1);
	});

	// HITL round 2: the legacy table wins (CursorManager.js:230, 317-323). Types missing from
	// ActionInformations (CLICK, LOCK, ATTACK, ...) use DEFAULT's multiplier, 2.0, not the spec's "others 1.0".
	it('[R-UI-005] unlisted types (CLICK/LOCK/ATTACK) use the DEFAULT multiplier 2.0 (legacy table, HITL round 2)', () => {
		for (const t of [CURSOR_ACTION.CLICK, CURSOR_ACTION.LOCK, CURSOR_ACTION.ATTACK, 99]) {
			expect(cursorInfo(t).delayMult).toBe(2.0);
		}
		expect(frameAt(CURSOR_ACTION.CLICK, 199)).toBe(0);
		expect(frameAt(CURSOR_ACTION.CLICK, 200)).toBe(1);
	});

	it('[R-UI-005] looping cursors wrap; one-shot cursors clamp at their last frame', () => {
		expect(frameAt(CURSOR_ACTION.TALK, 450)).toBe(0); // floor(4.5) % 4
		expect(frameAt(CURSOR_ACTION.TALK, 450, { oneShot: true })).toBe(3);
		expect(frameAt(CURSOR_ACTION.TALK, 99999, { oneShot: true })).toBe(3);
	});

	it('[R-UI-005] a paused cursor keeps its selected frame', () => {
		expect(frameAt(CURSOR_ACTION.TALK, 999, { playing: false, pausedFrame: 2 })).toBe(2);
	});
});

describe('R-UI-005 game cursor: hotspots and magnetism', () => {
	it('[R-UI-005] hotspots come from the per-type table; unknown types use DEFAULT', () => {
		expect(cursorHotspot({ type: CURSOR_ACTION.TARGET })).toEqual({ x: 20, y: 28 });
		expect(cursorHotspot({ type: CURSOR_ACTION.NOWALK })).toEqual({ x: 14, y: 6 });
		expect(cursorHotspot({ type: CURSOR_ACTION.ATTACK })).toEqual({ x: 0, y: 0 });
		expect(CURSOR_INFO[CURSOR_ACTION.PICK]).toMatchObject({ startX: 15, startY: 15 });
	});

	const rect = { x1: 100, y1: 200, x2: 140, y2: 260 }; // centre (120, 230)
	const mouse = { x: 125, y: 233 };

	it('[R-UI-005] with `snap`, the cursor snaps to the centre of a hovered mob / NPC_ABR / NPC_BIONIC', () => {
		for (const objecttype of [ENTITY_TYPE.MOB, ENTITY_TYPE.NPC_ABR, ENTITY_TYPE.NPC_BIONIC]) {
			const h = cursorHotspot({ type: CURSOR_ACTION.DEFAULT, magnetism: true, overEntity: { objecttype, boundingRect: rect }, mouse, prefs: { snap: true } });
			expect(h).toEqual({ x: 5, y: 3 });
			// drawn top-left = mouse - hotspot = rect centre
			expect([mouse.x - h.x, mouse.y - h.y]).toEqual([120, 230]);
		}
	});

	it('[R-UI-005] items snap only with `itemsnap`; mobs do not snap with `itemsnap` alone', () => {
		const item = { objecttype: ENTITY_TYPE.ITEM, boundingRect: rect };
		const mob = { objecttype: ENTITY_TYPE.MOB, boundingRect: rect };
		expect(cursorHotspot({ type: 0, magnetism: true, overEntity: item, mouse, prefs: { itemsnap: true } })).toEqual({ x: 5, y: 3 });
		expect(cursorHotspot({ type: 0, magnetism: true, overEntity: item, mouse, prefs: { snap: true } })).toEqual({ x: 0, y: 0 });
		expect(cursorHotspot({ type: 0, magnetism: true, overEntity: mob, mouse, prefs: { itemsnap: true } })).toEqual({ x: 0, y: 0 });
	});

	it('[R-UI-005] no snap without magnetism, when blocked, or for PCs / plain NPCs', () => {
		const mob = { objecttype: ENTITY_TYPE.MOB, boundingRect: rect };
		const prefs = { snap: true, itemsnap: true };
		expect(cursorHotspot({ type: 0, magnetism: false, overEntity: mob, mouse, prefs })).toEqual({ x: 0, y: 0 });
		expect(cursorHotspot({ type: 0, magnetism: true, blockMagnetism: true, overEntity: mob, mouse, prefs })).toEqual({ x: 0, y: 0 });
		for (const objecttype of [ENTITY_TYPE.PC, ENTITY_TYPE.NPC]) {
			expect(cursorHotspot({ type: 0, magnetism: true, overEntity: { objecttype, boundingRect: rect }, mouse, prefs })).toEqual({ x: 0, y: 0 });
		}
	});

	it('[R-UI-005] style: sheet offset = -cell x 50 px; transform negates the hotspot (valid CSS when negative)', () => {
		expect(cursorStyle(3, { x: 20, y: 28 })).toEqual({ spriteLeft: '-150px', transform: 'translate(-20px, -28px)' });
		expect(cursorStyle(0, { x: -5, y: 3 }).transform).toBe('translate(5px, -3px)');
	});
});

describe('R-UI-005 game cursor: sheet and loop', () => {
	const actions = [
		{ delay: 100, animations: [{}, {}, {}] }, // DEFAULT: frames 0 and 2 identical
		{ delay: 100, animations: [{}] } // TALK
	];
	const recordsFor = (i, j) => {
		if (i === 0) {
			return [spriteRecord({ texture: j === 1 ? 'rgba' : 'idx' })];
		}
		return [spriteRecord({ texture: 'idx' })];
	};
	const bake = () => {
		const factory = fakeCanvasFactory();
		const composer = new Preview2DComposer({
			canvasFactory: factory,
			frameSource: mapFrameSource({ idx: indexedFrame(), rgba: rgbaFrame() }, { p0: makePalette() })
		});
		return { factory, ...composer.bakeCursorSheet({ actions, recordsFor }) };
	};

	it('[R-UI-005] each animation is baked into a 50x50 cell at its type draw origin; identical cells are shared', () => {
		const { cellIndex, cellCount, sheet } = bake();
		// DEFAULT frame 0 and 2 are identical -> same cell; TALK uses a different origin -> new cell
		expect(cellIndex[0][0]).toBe(cellIndex[0][2]);
		expect(cellIndex[0][1]).not.toBe(cellIndex[0][0]);
		expect(cellCount).toBe(3);
		expect(sheet.width).toBe(3 * CURSOR_CELL_SIZE);
		expect(sheet.height).toBe(CURSOR_CELL_SIZE);
		const xs = sheet.getContext('2d').ops.filter(o => o[0] === 'drawImage').map(o => o[2]);
		expect(xs).toEqual([0, 50, 100]);
	});

	it('[R-UI-005] cell origin is (drawX, drawY) of the action type', () => {
		const { factory } = bake();
		const cells = factory.created.filter(c => c.width === 50 && c.height === 50);
		const t0 = cells[0].getContext('2d').ops.find(o => o[0] === 'translate');
		expect(t0.slice(1)).toEqual([CURSOR_INFO[0].drawX, (CURSOR_INFO[0].drawY - 17.5) | 0]);
		const talk = cells[cells.length - 1].getContext('2d').ops.find(o => o[0] === 'translate');
		expect(talk.slice(1)).toEqual([CURSOR_INFO[1].drawX, (CURSOR_INFO[1].drawY - 17.5) | 0]);
	});

	const makeDriver = (overrides = {}) => {
		const scheduler = manualScheduler();
		let now = 0;
		const settings = { cursor: true };
		const driver = new CursorDriver({ scheduler, clock: { now: () => now }, graphics: () => settings, ...overrides });
		return { driver, scheduler, settings, setNow: v => (now = v) };
	};

	it('[R-UI-005] shown only when the `cursor` preference is true', () => {
		const { driver, settings } = makeDriver();
		const { cellIndex } = bake();
		driver.setSceneDriven(true);
		driver.setSheet(actions, cellIndex);
		expect(driver.render(0).hidden).toBe(false);
		settings.cursor = false;
		expect(driver.render(0)).toEqual({ hidden: true });
	});

	it('[R-UI-005] when the scene loop is stopped the cursor animates on its own frame loop', () => {
		const { driver, scheduler, setNow } = makeDriver();
		const { cellIndex } = bake();
		driver.setSheet(actions, cellIndex); // not scene-driven -> own loop
		expect(driver.ownLoopActive).toBe(true);
		setNow(200); // DEFAULT: 100 x 2.0 -> frame 1
		scheduler.flush();
		expect(driver.last).toMatchObject({ hidden: false, frame: 1, cellIndex: cellIndex[0][1] });
		expect(scheduler.pending.size).toBe(1); // re-armed
	});

	it('[R-UI-005] scene-driven mode cancels the own loop; stopping the scene restarts it', () => {
		const { driver, scheduler } = makeDriver();
		driver.setSheet(actions, bake().cellIndex);
		driver.setSceneDriven(true);
		expect(driver.ownLoopActive).toBe(false);
		expect(scheduler.pending.size).toBe(0);
		driver.setSceneDriven(false);
		expect(driver.ownLoopActive).toBe(true);
	});
});
