/**
 * Global determinism installer for code that cannot take injected ports yet (the legacy
 * renderer during phase 1). The rebuilt modules receive `{ rng, now }` explicitly instead.
 *
 * Replaces Math.random, Date.now and performance.now; returns a restore function.
 * Always restore in afterEach — the installer refuses to nest.
 */
import { SeededRng } from './SeededRng.js';
import { FakeClock } from './FakeClock.js';

let _installed = null;

/**
 * @param {object} [opts]
 * @param {SeededRng} [opts.rng]
 * @param {FakeClock} [opts.clock]
 * @param {object} [opts.target=globalThis] object holding Math/Date/performance (test seam)
 * @returns {{ rng: SeededRng, clock: FakeClock, restore: () => void }}
 */
export function installDeterminism({ rng = new SeededRng(), clock = new FakeClock(), target = globalThis } = {}) {
	if (_installed) {
		throw new Error('installDeterminism: already installed; call restore() first');
	}
	const saved = {
		random: target.Math.random,
		dateNow: target.Date.now,
		perfNow: target.performance?.now
	};
	target.Math.random = rng.fn;
	target.Date.now = () => clock.dateNow();
	if (target.performance) {
		target.performance.now = () => clock.now();
	}
	const restore = () => {
		target.Math.random = saved.random;
		target.Date.now = saved.dateNow;
		if (target.performance && saved.perfNow) {
			target.performance.now = saved.perfNow;
		}
		_installed = null;
	};
	_installed = { rng, clock, restore };
	return _installed;
}

/** Ports object for injected (non-global) consumers: render-records, scene, backends. */
export function createDeterministicPorts({ seed = 0x5eed, now = 0 } = {}) {
	const rng = new SeededRng(seed);
	const clock = new FakeClock({ now });
	return { rng, clock, ports: { rng: rng.fn, now: clock.fn, dateNow: () => clock.dateNow() } };
}
