/**
 * Seeded RNG (architecture §2.2 test-harness, critique B4).
 *
 * The 79 `Math.random` sites in 18 renderer files are routed through an injectable `rng()`
 * port. In tests that port is a SeededRng so scenes replay bit-identically.
 *
 * Algorithm: mulberry32 (32-bit state, period 2^32). Output in [0, 1) like Math.random.
 */
export class SeededRng {
	/** @param {number} seed */
	constructor(seed = 0x5eed) {
		this._seed = seed >>> 0;
		this._state = this._seed;
		this._calls = 0;
	}

	/** @returns {number} next value in [0, 1) */
	next() {
		this._calls++;
		this._state = (this._state + 0x6d2b79f5) >>> 0;
		let t = this._state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Bound function usable as a drop-in `rng()` port. */
	get fn() {
		return () => this.next();
	}

	/** Number of draws so far (lets tests assert that a code path consumed randomness). */
	get calls() {
		return this._calls;
	}

	get seed() {
		return this._seed;
	}

	/** Rewind to the initial seed. */
	reset() {
		this._state = this._seed;
		this._calls = 0;
	}

	/** Independent child stream, e.g. one per scene or per worker. */
	fork(salt) {
		return new SeededRng((this._seed ^ Math.imul((salt >>> 0) + 1, 0x9e3779b1)) >>> 0);
	}
}
