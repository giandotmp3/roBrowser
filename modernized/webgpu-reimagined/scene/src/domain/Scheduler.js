import { FrameClock } from './FrameClock.js';

/**
 * Game clock + UI scheduler, split out of the GPU loop (architecture §2.2 "scene").
 * Owns Renderer.tick, the ~30 UI render callbacks, Events.process and Session.serverTick.
 *
 * Frame order (R-CTX-004):
 *   1. Session.serverTick += Date.now delta
 *   2. Events.process(tick)
 *   3. each registered render callback(tick)
 *   4. cursor.render(tick)
 *   5. schedule next frame
 */
export class Scheduler {
	/**
	 * @param {object} deps
	 * @param {import('../ports.js').Clock} deps.clock
	 * @param {import('../ports.js').SessionPort} deps.session
	 * @param {import('../ports.js').GraphicsSettingsPort} deps.settings
	 * @param {import('../ports.js').EventsPort} deps.events
	 * @param {import('../ports.js').CursorPort} deps.cursor
	 * @param {import('../ports.js').FrameRequester} deps.frames
	 * @param {(err: unknown) => void} [deps.onRenderError] Hook for gpu backend fallback (R-CTX-005, gpu-webgpu owned).
	 */
	constructor({ clock, session, settings, events, cursor, frames, onRenderError = () => {} }) {
		this.clock = clock;
		this.session = session;
		this.events = events;
		this.cursor = cursor;
		this.frames = frames;
		this.onRenderError = onRenderError;
		this.frameClock = new FrameClock({ session, settings });
		/** @type {Array<(tick: number) => void>} */
		this.callbacks = [];
		/** Renderer.tick compatibility value (ms). */
		this.tick = 0;
		this._lastDateNow = null;
		this._rafId = null;
		this.running = false;
	}

	/** Renderer.render(fn) */
	register(fn) {
		if (typeof fn === 'function' && !this.callbacks.includes(fn)) {
			this.callbacks.push(fn);
		}
		if (!this.running) {
			this.start();
		}
	}

	/** Renderer.stop(fn?) — no argument clears every callback and stops the loop. */
	unregister(fn) {
		if (fn === undefined) {
			this.callbacks.length = 0;
			this.stop();
			return;
		}
		const i = this.callbacks.indexOf(fn);
		if (i !== -1) {
			this.callbacks.splice(i, 1);
		}
	}

	start() {
		this.running = true;
		this._lastDateNow = this.clock.dateNow();
		this._schedule();
	}

	stop() {
		this.running = false;
		if (this._rafId !== null) {
			this.frames.cancel(this._rafId);
			this._rafId = null;
		}
	}

	_schedule() {
		this._rafId = this.frames.request(() => this.onAnimationFrame());
	}

	/** rAF entry point. Applies the throttle then runs one frame. */
	onAnimationFrame() {
		if (!this.running) {
			return;
		}
		const now = this.clock.now();
		if (this.frameClock.isFrameDue(now)) {
			this.runFrame(now);
			return;
		}
		this._schedule();
	}

	/**
	 * Execute one frame in contract order (R-CTX-004).
	 * @param {number} now
	 */
	runFrame(now) {
		this.tick = now;
		const dateNow = this.clock.dateNow();
		this.session.serverTick += dateNow - (this._lastDateNow ?? dateNow);
		this._lastDateNow = dateNow;

		this.events.process(this.tick);
		for (const fn of [...this.callbacks]) {
			try {
				fn(this.tick);
			} catch (err) {
				this.onRenderError(err);
			}
		}
		this.cursor.render(this.tick);
		if (this.running) {
			this._schedule();
		}
	}
}
