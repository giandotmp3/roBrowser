/** Harness contract: seeded RNG + injectable clock (architecture §2.2, phase 1). */
import { describe, it, expect, afterEach } from 'vitest';
import { SeededRng } from '../../src/determinism/SeededRng.js';
import { FakeClock, FAKE_EPOCH_MS } from '../../src/determinism/FakeClock.js';
import { installDeterminism, createDeterministicPorts } from '../../src/determinism/installDeterminism.js';

describe('SeededRng', () => {
	it('is deterministic per seed and in [0,1)', () => {
		const a = new SeededRng(42);
		const b = new SeededRng(42);
		const xs = Array.from({ length: 1000 }, () => a.next());
		expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
		xs.forEach(x => {
			expect(x).toBeGreaterThanOrEqual(0);
			expect(x).toBeLessThan(1);
		});
	});

	it('different seeds diverge; reset rewinds; fork is independent and stable', () => {
		expect(new SeededRng(1).next()).not.toBe(new SeededRng(2).next());
		const r = new SeededRng(7);
		const first = r.next();
		r.next();
		r.reset();
		expect(r.next()).toBe(first);
		expect(r.calls).toBe(1);
		expect(new SeededRng(7).fork(3).next()).toBe(new SeededRng(7).fork(3).next());
		expect(new SeededRng(7).fork(3).next()).not.toBe(new SeededRng(7).fork(4).next());
	});

	it('is roughly uniform (bucket test)', () => {
		const r = new SeededRng(99);
		const buckets = new Array(10).fill(0);
		for (let i = 0; i < 100_000; i++) {
			buckets[Math.floor(r.next() * 10)]++;
		}
		buckets.forEach(b => expect(Math.abs(b - 10_000)).toBeLessThan(500));
	});
});

describe('FakeClock', () => {
	it('advances monotonic and epoch time together', () => {
		const c = new FakeClock();
		expect(c.now()).toBe(0);
		expect(c.dateNow()).toBe(FAKE_EPOCH_MS);
		c.advance(16);
		expect(c.now()).toBe(16);
		expect(c.dateNow()).toBe(FAKE_EPOCH_MS + 16);
	});

	it('fires timers in due order at their due time (debounce semantics)', () => {
		const c = new FakeClock();
		const log = [];
		const id = c.setTimeout(() => log.push(['a', c.now()]), 500);
		c.setTimeout(() => log.push(['b', c.now()]), 100);
		c.advance(300);
		c.clearTimeout(id);
		c.setTimeout(() => log.push(['c', c.now()]), 500);
		c.advance(499);
		expect(log).toEqual([['b', 100]]);
		c.advance(1);
		expect(log).toEqual([
			['b', 100],
			['c', 800]
		]);
		expect(c.pendingTimers).toBe(0);
	});

	it('rejects negative advances', () => {
		expect(() => new FakeClock().advance(-1)).toThrow(RangeError);
	});
});

describe('installDeterminism', () => {
	let restore = () => {};
	afterEach(() => restore());

	it('replaces Math.random / Date.now / performance.now and restores them', () => {
		const target = { Math: { random: () => 0.5 }, Date: { now: () => 1 }, performance: { now: () => 2 } };
		const orig = { r: target.Math.random, d: target.Date.now, p: target.performance.now };
		const inst = installDeterminism({ rng: new SeededRng(5), clock: new FakeClock({ now: 10 }), target });
		restore = inst.restore;
		expect(target.Math.random()).toBe(new SeededRng(5).next());
		expect(target.performance.now()).toBe(10);
		expect(target.Date.now()).toBe(FAKE_EPOCH_MS + 10);
		expect(() => installDeterminism({ target })).toThrow(/already installed/);
		inst.restore();
		restore = () => {};
		expect(target.Math.random).toBe(orig.r);
		expect(target.Date.now).toBe(orig.d);
		expect(target.performance.now).toBe(orig.p);
	});

	it('createDeterministicPorts yields injectable rng/now', () => {
		const { ports, clock } = createDeterministicPorts({ seed: 1, now: 5 });
		expect(ports.now()).toBe(5);
		clock.advance(5);
		expect(ports.now()).toBe(10);
		expect(ports.rng()).toBe(new SeededRng(1).next());
	});
});
