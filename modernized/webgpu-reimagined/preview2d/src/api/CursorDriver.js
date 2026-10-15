import { Preview2DError } from '../errors.js';
import { CURSOR_ACTION } from '../domain/CursorTypes.js';
import { cursorHotspot, cursorStyle, selectCursorFrame } from '../domain/CursorAnimation.js';

/**
 * Cursor animation driver (R-UI-005).
 *
 * Owns frame selection, hotspot/magnetism and the "own loop" fallback. It does
 * not touch the DOM: `render(tick)` returns the style to apply (or `hidden`),
 * and the scene/UI layer writes it. When the scene loop is running, the scene
 * calls `render(tick)` after each frame (`setSceneDriven(true)`); when the
 * scene loop is stopped (login, server list) the driver animates itself on the
 * injected FrameScheduler.
 */
export class CursorDriver {
	#scheduler;
	#clock;
	#loopId = 0;
	#sceneDriven = false;

	/**
	 * @param {Object} deps
	 * @param {import('../ports.js').FrameScheduler} deps.scheduler
	 * @param {import('../ports.js').Clock} deps.clock
	 * @param {() => {cursor: boolean}} deps.graphics      reads GraphicsSettings.cursor
	 * @param {() => {snap?: boolean, itemsnap?: boolean}} [deps.controls]  reads ControlsSettings
	 * @param {() => object|null} [deps.overEntity]        hovered entity
	 * @param {() => {x: number, y: number}} [deps.mouse]  Mouse.screen
	 */
	constructor({
		scheduler,
		clock,
		graphics,
		controls = () => ({}),
		overEntity = () => null,
		mouse = () => ({ x: 0, y: 0 })
	} = {}) {
		if (!scheduler || !clock || !graphics) {
			throw new Preview2DError('scheduler, clock and graphics ports are required');
		}
		this.#scheduler = scheduler;
		this.#clock = clock;
		this.graphics = graphics;
		this.controls = controls;
		this.overEntity = overEntity;
		this.mouse = mouse;

		this.type = CURSOR_ACTION.DEFAULT;
		this.startTick = 0;
		this.oneShot = false;
		this.playing = true;
		this.pausedFrame = 0;
		this.magnetism = true;
		this.blockMagnetism = false;

		/** @type {{actions: ReadonlyArray<{delay: number, animations: ReadonlyArray<unknown>}>, cellIndex: number[][]}|null} */
		this.sheet = null;
		/** @type {ReturnType<CursorDriver['render']>|null} */
		this.last = null;
	}

	/** Attach a baked sheet (from Preview2DComposer.bakeCursorSheet) and its ACT actions. */
	setSheet(actions, cellIndex) {
		this.sheet = { actions, cellIndex };
		if (!this.#sceneDriven && !this.#loopId) {
			this.#startLoop();
		}
	}

	/**
	 * @param {number} type     CURSOR_ACTION.*
	 * @param {boolean} [oneShot]
	 * @param {number} [frame]  when given, pause on that frame
	 */
	setType(type, oneShot = false, frame) {
		this.type = type;
		this.oneShot = oneShot;
		this.startTick = this.#clock.now();
		this.playing = frame === undefined;
		this.pausedFrame = frame ?? 0;
	}

	/** @param {boolean} value */
	setSceneDriven(value) {
		this.#sceneDriven = value;
		if (value) {
			this.#scheduler.cancelFrame(this.#loopId);
			this.#loopId = 0;
		} else if (!this.#loopId && this.sheet) {
			this.#startLoop();
		}
	}

	get ownLoopActive() {
		return this.#loopId !== 0;
	}

	/**
	 * @param {number} tick
	 * @returns {{hidden: true} | {hidden: false, frame: number, cellIndex: number, hotspot: {x: number, y: number}, style: {spriteLeft: string, transform: string}}}
	 */
	render(tick) {
		if (!this.graphics().cursor || !this.sheet) {
			return (this.last = { hidden: true });
		}
		const { actions, cellIndex } = this.sheet;
		const type = actions[this.type] ? this.type : CURSOR_ACTION.DEFAULT;
		const action = actions[type];
		const frame = selectCursorFrame({
			type,
			actDelay: action.delay,
			frameCount: action.animations.length,
			tick,
			startTick: this.startTick,
			oneShot: this.oneShot,
			playing: this.playing,
			pausedFrame: this.pausedFrame
		});
		const cell = cellIndex[type]?.[frame];
		if (cell === undefined) {
			return (this.last = { hidden: true });
		}
		const hotspot = cursorHotspot({
			type,
			magnetism: this.magnetism,
			blockMagnetism: this.blockMagnetism,
			overEntity: this.overEntity(),
			mouse: this.mouse(),
			prefs: this.controls()
		});
		return (this.last = { hidden: false, frame, cellIndex: cell, hotspot, style: cursorStyle(cell, hotspot) });
	}

	#startLoop() {
		const loop = () => {
			this.render(this.#clock.now());
			this.#loopId = this.#scheduler.requestFrame(loop);
		};
		this.#loopId = this.#scheduler.requestFrame(loop);
	}
}
