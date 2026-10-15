/**
 * Deterministic test doubles (architecture §2.2 test-harness: seeded RNG + injectable clock).
 * No credentials or legacy configuration values are used anywhere in the fixtures.
 */
import { Altitude } from '../../src/domain/Altitude.js';
import { createScene } from '../../src/index.js';
import { EntityKind } from '../../src/domain/EntityTypes.js';

/** mulberry32 seeded RNG */
export const seededRng = (seed = 0x5eed) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

export class FakeClock {
	constructor(now = 0, dateNow = 1_700_000_000_000) {
		this._now = now;
		this._date = dateNow;
	}
	now() {
		return this._now;
	}
	dateNow() {
		return this._date;
	}
	advance(ms) {
		this._now += ms;
		this._date += ms;
	}
}

/** Manual requestAnimationFrame queue. */
export class FakeFrames {
	constructor(log = null) {
		this.queue = new Map();
		this.nextId = 1;
		this.log = log;
	}
	request(cb) {
		const id = this.nextId++;
		this.queue.set(id, cb);
		this.log?.push('raf');
		return id;
	}
	cancel(id) {
		this.queue.delete(id);
	}
	/** Run every queued callback once. */
	flush() {
		const pending = [...this.queue.values()];
		this.queue.clear();
		pending.forEach((cb) => cb(0));
	}
}

export class FakeTimers {
	constructor() {
		this.now = 0;
		this.timers = [];
	}
	setTimeout(cb, ms) {
		const h = { at: this.now + ms, cb };
		this.timers.push(h);
		return h;
	}
	clearTimeout(h) {
		this.timers = this.timers.filter((t) => t !== h);
	}
	advanceTo(t) {
		this.now = t;
		const due = this.timers.filter((x) => x.at <= t);
		this.timers = this.timers.filter((x) => x.at > t);
		due.forEach((x) => x.cb());
	}
}

export const fakeSession = (over = {}) => ({ Playing: true, serverTick: 0, packetVer: 20220101, Entity: null, ...over });

export const fakeSettings = (over = {}) => ({ fpslimit: 60, performanceMode: false, viewArea: 14, quality: 100, ...over });

/**
 * Altitude from a per-cell height function (all 4 corners = h(x, y)) and type function.
 */
export const makeAltitude = (width, height, h = () => 0, type = () => 1) => {
	const cells = new Float32Array(width * height * 5);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (x + y * width) * 5;
			const v = h(x, y);
			cells.set([v, v, v, v, type(x, y)], i);
		}
	}
	return new Altitude({ cells, width, height });
};

let gid = 1000;
export const makeEntity = (over = {}) => ({
	GID: gid++,
	kind: EntityKind.PC,
	position: [0, 0, 0],
	depth: 10,
	pickRect: null,
	overlays: {},
	...over
});

/** createScene() wired entirely to fakes. */
export const makeScene = (over = {}) => {
	const calls = [];
	const rec =
		(name) =>
		(...args) =>
			calls.push([name, ...args]);
	const deps = {
		clock: new FakeClock(),
		rng: seededRng(),
		session: fakeSession(),
		settings: fakeSettings(),
		events: { process: rec('events.process') },
		cursor: { render: rec('cursor.render'), setType: rec('cursor.setType') },
		frames: new FakeFrames(),
		loader: { load: (f) => (calls.push(['loader.load', f]), 7) },
		backend: { init: rec('backend.init'), resize: rec('backend.resize'), contextLost: false, onMapReady: rec('backend.onMapReady') },
		effects: {
			spam: rec('effects.spam'),
			spamSkill: rec('effects.spamSkill'),
			remove: rec('effects.remove'),
			startOrRestartWeather: rec('effects.weather'),
			free: rec('effects.free')
		},
		damage: { add: rec('damage.add'), free: rec('damage.free') },
		readWindow: () => ({ cssWidth: 1920, cssHeight: 1080, dpr: 2, quality: 50 }),
		...over
	};
	return { scene: createScene(deps), deps, calls };
};
