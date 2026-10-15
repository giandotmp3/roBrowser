/**
 * Injectable clock (architecture §2.2 test-harness).
 *
 * Replaces `Date.now()` (EntityManager.js:402 and Renderer.js serverTick delta, R-CTX-004) and
 * `performance.now()` / rAF timestamps. `now()` is the monotonic ms value the scene/render loop
 * sees; `dateNow()` is the epoch value (fake, fixed origin) for code that reads Date.now.
 */
export const FAKE_EPOCH_MS = 1_700_000_000_000;

export class FakeClock {
	/**
	 * @param {object} [opts]
	 * @param {number} [opts.now=0] initial monotonic ms
	 * @param {number} [opts.epoch=FAKE_EPOCH_MS] epoch ms corresponding to now=0
	 */
	constructor({ now = 0, epoch = FAKE_EPOCH_MS } = {}) {
		this._now = now;
		this._epoch = epoch;
		this._timers = [];
		this._nextTimer = 1;
	}

	now() {
		return this._now;
	}

	dateNow() {
		return this._epoch + this._now;
	}

	/** Bound `now()` port. */
	get fn() {
		return () => this.now();
	}

	/** setTimeout replacement driven by advance(); used for debounces (R-CTX-008, R-CAM-011). */
	setTimeout(cb, ms = 0) {
		const id = this._nextTimer++;
		this._timers.push({ id, at: this._now + Math.max(0, ms), cb });
		return id;
	}

	clearTimeout(id) {
		this._timers = this._timers.filter(t => t.id !== id);
	}

	/** Move time forward, firing due timers in order. */
	advance(ms) {
		if (!(ms >= 0)) {
			throw new RangeError(`FakeClock.advance expects ms >= 0, got ${ms}`);
		}
		const target = this._now + ms;
		for (;;) {
			const due = this._timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
			if (!due) {
				break;
			}
			this._timers = this._timers.filter(t => t !== due);
			this._now = due.at;
			due.cb();
		}
		this._now = target;
	}

	get pendingTimers() {
		return this._timers.length;
	}
}
