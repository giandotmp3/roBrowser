/**
 * Injectable randomness and time. The test-harness module supplies seeded /
 * fake implementations; render-records never calls Math.random or Date.now
 * directly (architecture §2.2 test-harness).
 *
 * @typedef {() => number} Rng   Returns a float in [0, 1)
 * @typedef {() => number} Clock Returns milliseconds
 */

/** @type {Rng} */
export const defaultRng = () => Math.random();

/** @type {Clock} */
export const defaultClock = () => Date.now();
