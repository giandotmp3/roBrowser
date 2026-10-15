/**
 * The GR2 record scene shared by GR2ModelRenderer.records.test.js and RecordDiff.gr2.test.js:
 * camera, per-frame light and fog, terrain, the GR2 instances (entity-backed through
 * GR2ModelRenderer.attach, dev ones through spawn), the entity timeline and an
 * asynchronous file queue standing in for Client.getFile.
 *
 * Node/jsdom-safe (no DOM, no GL). Ported from gpu-webgl2/smoke/gr2/scene.js and widened to
 * every branch of the legacy GR2 pass: a model that 404s, models still loading (instances
 * skipped), banks streaming in one file per frame (bind pose until a bank arrives, the
 * current action's bank prioritised), walking (world rebuilt, pose clock untouched),
 * facing changes, re-issued actions (animation.tick bump), one-shot reverts, the dead hold,
 * a missing-bank action (treasure box move/attack; the knight starting to walk before its
 * move bank arrives stays on standby until the action is re-issued), a looping walk, NPC
 * bind pose, the entity cull flag, an off-screen and a behind-camera instance (frustum cull), emblem load / swap / removal,
 * effectColor alpha (blend on while < 1), the death fade toggle, a map-ambient change (flag
 * grey), a detach, a frame without light and a frame with no instances.
 */
import { MODEL_PATHS } from './gr2Assets.js';

export const TICK_MS = 25;
export const LAST_TICK = 2600;
/** Fixed epoch for Date.now (the removal fade reads it). */
export const EPOCH = 1_700_000_000_000;

/** Camera matrices (legacy angle range, looking down from RO's negative Y). */
export function cameraMatrices({ target, distance, pitch, yaw, fovy }, width, height) {
	const mul = (a, b) => {
		const out = new Float32Array(16);
		for (let c = 0; c < 4; c++) {
			for (let r = 0; r < 4; r++) {
				let s = 0;
				for (let k = 0; k < 4; k++) {
					s += a[k * 4 + r] * b[c * 4 + k];
				}
				out[c * 4 + r] = s;
			}
		}
		return out;
	};
	const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	const translate = (x, y, z) => Object.assign(ident(), { 12: x, 13: y, 14: z });
	const rotX = deg => {
		const r = (deg * Math.PI) / 180;
		return Object.assign(ident(), { 5: Math.cos(r), 6: Math.sin(r), 9: -Math.sin(r), 10: Math.cos(r) });
	};
	const rotY = deg => {
		const r = (deg * Math.PI) / 180;
		return Object.assign(ident(), { 0: Math.cos(r), 2: -Math.sin(r), 8: Math.sin(r), 10: Math.cos(r) });
	};
	const modelView = [
		translate(0, -1, -distance),
		rotX(pitch),
		rotY(yaw),
		translate(-target[0] - 0.5, 0, -target[1] - 0.5)
	].reduce(mul);
	const f = 1 / Math.tan(((fovy / 2) * Math.PI) / 180);
	const near = 1;
	const far = 1000;
	const projection = new Float32Array([
		f / (width / height),
		0,
		0,
		0,
		0,
		f,
		0,
		0,
		0,
		0,
		(far + near) / (near - far),
		-1,
		0,
		0,
		(2 * far * near) / (near - far),
		0
	]);
	return { modelView, projection };
}

export const VIEW = cameraMatrices({ target: [20, 19], distance: 46, pitch: 230, yaw: 25, fovy: 20 }, 640, 480);
export const NORMAL3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Terrain cell height (Altitude.getCellHeight: a negated height). */
export const cellHeight = (x, y) => 0.1 * (Math.floor(x) % 7) - 0.05 * (Math.floor(y) % 5);

const DIRECTION = (() => {
	const v = [0.42, -0.81, 0.37];
	const n = Math.hypot(...v);
	return new Float32Array(v.map(c => c / n));
})();

/** The map light of a frame (the flag's grey follows the map ambient; it changes at 1200 ms). */
export function lightAt(tick) {
	const ambient = tick < 1200 ? [0.45, 0.4, 0.5] : [0.3, 0.32, 0.6];
	const diffuse = [0.9, 0.85, 0.8];
	return {
		opacity: 0.8,
		diffuse,
		ambient,
		env: new Float32Array(diffuse.map((d, i) => 1 - (1 - d) * (1 - ambient[i]))),
		direction: DIRECTION
	};
}

/** Scene fog of a frame (fog on in one segment, map fog absent in another). */
export function fogAt(tick) {
	return {
		use: tick >= 1000,
		exist: tick < 2000,
		near: 30,
		far: 62,
		color: new Float32Array([0.62, 0.68, 0.8])
	};
}

/** Legacy entity ACTION enum (the names GR2 reads through gr2ActionFor). */
export const ACTION = Object.freeze({
	IDLE: 0,
	WALK: 1,
	SIT: 2,
	PICKUP: 3,
	READYFIGHT: 4,
	ATTACK: 5,
	HURT: 6,
	DIE: 8,
	ATTACK1: 10,
	ATTACK2: 11,
	ATTACK3: 12
});

/** The fields of a legacy Entity that GR2ModelRenderer reads. */
export class GR2Entity {
	static TYPE_MOB = 5;
	static TYPE_NPC = 6;
}

/** A guild emblem image as Guild.requestGuildEmblem hands it over (already magenta-keyed). */
function emblemImage(id, size, seed) {
	const pixels = new Uint8ClampedArray(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const o = (y * size + x) * 4;
			const r = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5);
			const inside = r < size * 0.42;
			pixels[o] = inside ? (40 + seed * 30 + 7 * x) & 255 : 0;
			pixels[o + 1] = inside ? (60 + 6 * y) & 255 : 0;
			pixels[o + 2] = inside ? (200 - 5 * x) & 255 : 0;
			pixels[o + 3] = inside ? (y === 3 ? 200 : 255) : 0;
		}
	}
	return { id, width: size, height: size, pixels };
}

export const EMBLEMS = Object.freeze({ a: emblemImage('emblemA', 24, 1), b: emblemImage('emblemB', 32, 3) });

export const MISSING_PATH = 'data/model/3dmob/missing90_5.gr2';
export const PATHS = Object.freeze({ ...MODEL_PATHS, missing: MISSING_PATH });

/**
 * Entity-backed instances. `mob` false → NPC (bind pose, standbyIdx −1). `emblem` names
 * one of EMBLEMS. `culled` is the EntityManager view-area flag.
 */
export const ENTITIES = Object.freeze([
	{ id: 'flagMob', model: 'guildflag90_1', pos: [16, 22], dir: 2, mob: true, emblem: 'a' },
	{ id: 'flagNpc', model: 'guildflag90_1', pos: [24, 23], dir: 0, mob: false, emblem: 'b' },
	{ id: 'emp1', model: 'empelium90_0', pos: [20, 20], dir: 0, mob: true },
	{ id: 'emp2', model: 'empelium90_0', pos: [22, 18], dir: 4, mob: true },
	{ id: 'knight', model: 'kguardian90_7', pos: [17, 17], dir: 1, mob: true },
	{ id: 'archer', model: 'aguardian90_8', pos: [24, 16], dir: 3, mob: true },
	{ id: 'soldier', model: 'sguardian90_9', pos: [19, 15], dir: 5, mob: true },
	{ id: 'box', model: 'treasurebox_2', pos: [26, 20], dir: 6, mob: true },
	{ id: 'culled', model: 'sguardian90_9', pos: [21, 21], dir: 2, mob: true, culled: true },
	{ id: 'offscreen', model: 'kguardian90_7', pos: [70, 70], dir: 0, mob: true },
	{ id: 'behind', model: 'aguardian90_8', pos: [20, -140], dir: 0, mob: true },
	{ id: 'ghost', model: 'missing', pos: [18, 20], dir: 0, mob: true }
]);

/** Dev instances (GR2ModelRenderer.spawn): no entity, so no emblem and no action sync. */
export const SPAWNS = Object.freeze([
	{ model: 'guildflag90_1', pos: [13, 19], dir: 7 },
	{ model: 'aguardian90_8', pos: [27, 24], dir: 2, action: 'move' },
	{ model: 'kguardian90_7', pos: [15, 24], dir: 5, action: 'attack' }
]);

/**
 * Entity changes applied in the entity pass of a frame (after the GR2 pass): `action`
 * (ACTION name, re-issued: bumps animation.tick), `alpha` (effectColor[3]), `dir`,
 * `walk` ([dx, dy] per frame until the next walk event), `emblem` (EMBLEMS key or null),
 * `culled`, `remove` (removal starts: remove_tick = now, remove_delay), `detach`.
 */
export const EVENTS = Object.freeze([
	{ at: 200, id: 'knight', action: 'WALK', walk: [0.04, 0.01], dir: 2 },
	{ at: 300, id: 'box', action: 'WALK' },
	{ at: 500, id: 'soldier', action: 'HURT' },
	{ at: 500, id: 'box', action: 'HURT' },
	{ at: 600, id: 'flagMob', emblem: 'b' },
	{ at: 650, id: 'knight', action: 'WALK' },
	{ at: 700, id: 'soldier', action: 'HURT' },
	{ at: 900, id: 'culled', culled: false },
	{ at: 1250, id: 'knight', walk: [0, 0], action: 'IDLE', dir: 3 },
	{ at: 1100, id: 'flagNpc', emblem: null },
	{ at: 1300, id: 'knight', action: 'ATTACK' },
	{ at: 1300, id: 'archer', action: 'ATTACK2' },
	{ at: 1325, id: 'box', action: 'ATTACK' },
	{ at: 1500, id: 'soldier', action: 'DIE', remove: 600 },
	{ at: 1500, id: 'box', action: 'DIE' },
	{ at: 1600, id: 'emp1', remove: 800 },
	{ at: 1700, id: 'archer', alpha: 0.6 },
	{ at: 1700, id: 'emp2', alpha: 0.35 },
	{ at: 1800, id: 'flagNpc', emblem: 'a' },
	{ at: 2000, id: 'archer', action: 'ATTACK' },
	{ at: 2050, id: 'culled', culled: true },
	{ at: 2100, id: 'emp2', alpha: 1.4 },
	{ at: 2200, id: 'soldier', detach: true },
	{ at: 2300, id: 'archer', walk: [-0.03, 0.02], action: 'WALK', dir: 6 }
]);

/** Ticks with no light (the pass returns before touching anything). */
export const DARK_TICKS = Object.freeze([150]);

/**
 * Every frame tick of the timeline: 25 ms frames (one 40 Hz pose bucket each), with a
 * 10 ms segment (1800…2000) where consecutive frames share pose buckets, so poses come
 * from the previous frame's cache.
 */
export const TICKS = Object.freeze(
	(() => {
		const ticks = [];
		for (let t = 0; t <= LAST_TICK; t += t >= 1800 && t < 2000 ? 10 : TICK_MS) {
			ticks.push(t);
		}
		return ticks;
	})()
);

/** Build the legacy entities of the scene. */
export function makeEntities() {
	const entities = new Map();
	for (const spec of ENTITIES) {
		const [x, y] = spec.pos;
		entities.set(
			spec.id,
			Object.assign(new GR2Entity(), {
				gr2: PATHS[spec.model],
				position: [x, y, cellHeight(x, y)],
				direction: spec.dir,
				objecttype: spec.mob ? GR2Entity.TYPE_MOB : GR2Entity.TYPE_NPC,
				ACTION,
				action: ACTION.IDLE,
				animation: { tick: 0 },
				effectColor: [1, 1, 1, 1],
				culled: Boolean(spec.culled),
				emblem: spec.emblem ? { emblem: EMBLEMS[spec.emblem] } : null,
				remove_tick: 0,
				remove_delay: 0,
				_walk: null
			})
		);
	}
	return entities;
}

/**
 * The entity pass of frame `tick` (runs after the GR2 pass, like EntityManager.render):
 * the frame's events, then walking. `onDetach(id)` receives detach events.
 */
export function entityStep(entities, tick, now, onDetach) {
	for (const event of EVENTS.filter(e => e.at === tick)) {
		const entity = entities.get(event.id);
		if (event.action) {
			entity.action = ACTION[event.action];
			entity.animation.tick = tick; // a re-issued action bumps the animation tick
		}
		if (event.alpha !== undefined) {
			entity.effectColor[3] = event.alpha;
		}
		if (event.dir !== undefined) {
			entity.direction = event.dir;
		}
		if (event.walk) {
			entity._walk = event.walk[0] || event.walk[1] ? event.walk : null;
		}
		if (event.emblem !== undefined) {
			entity.emblem = event.emblem ? { emblem: EMBLEMS[event.emblem] } : null;
		}
		if (event.culled !== undefined) {
			entity.culled = event.culled;
		}
		if (event.remove) {
			entity.remove_tick = now;
			entity.remove_delay = event.remove;
		}
		if (event.detach) {
			onDetach(event.id);
		}
	}
	for (const entity of entities.values()) {
		if (entity._walk) {
			// Entity.position is mutated in place by walking (the GR2 instance copies it)
			const p = entity.position;
			p[0] += entity._walk[0];
			p[1] += entity._walk[1];
			p[2] = cellHeight(p[0], p[1]);
		}
	}
}

/**
 * Client.getFile stand-in: requests queue up and are answered `deliver(n)` at a time
 * (FIFO), the way the GRF answers asynchronously. A path missing from `files` errors.
 */
export function createFileQueue(files) {
	const pending = [];
	const requests = [];
	return {
		requests,
		getFile(path, onLoad, onError) {
			requests.push(path);
			pending.push({ path, onLoad, onError });
		},
		deliver(n = 1) {
			for (let i = 0; i < n && pending.length; i++) {
				const { path, onLoad, onError } = pending.shift();
				if (files.has(path)) {
					onLoad(files.get(path));
				} else {
					onError?.();
				}
			}
		},
		get pending() {
			return pending.length;
		}
	};
}

/** Let promise callbacks (GR2Loader.ready().then decode) run. */
export async function flushMicrotasks() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

/**
 * Drive the legacy GR2 pass over the timeline: a pre-roll frame with no instances, then
 * attach every entity and spawn the dev instances, then per tick: GR2 render (Date.now
 * pinned to EPOCH + tick), the entity pass, one file delivered, microtasks flushed.
 * FADE.death is on for the run (the vanish fade stays off), then restored.
 * @param {{renderer: object, gl: object, queue: ReturnType<typeof createFileQueue>, onFrame?: Function}} opts
 *   onFrame(tick) runs after each GR2 render.
 */
export async function driveLegacy({ renderer, gl, queue, onFrame = () => {} }) {
	const savedNow = Date.now;
	let now = EPOCH;
	Date.now = () => now;
	const fade = { ...renderer.FADE };
	renderer.FADE.death = true;
	renderer.FADE.vanish = false;
	try {
		renderer.init(gl);
		renderer.render(gl, VIEW.modelView, VIEW.projection, NORMAL3, fogAt(0), lightAt(0), -TICK_MS);
		const entities = makeEntities();
		const instances = new Map();
		for (const [id, entity] of entities) {
			instances.set(id, renderer.attach(entity));
		}
		SPAWNS.forEach((spec, i) => {
			instances.set(
				`spawn${i}`,
				renderer.spawn(PATHS[spec.model], { pos: [...spec.pos, 0], dir: spec.dir, action: spec.action })
			);
		});
		for (const tick of TICKS) {
			now = EPOCH + tick;
			renderer.debugCell = tick === 2400;
			const light = DARK_TICKS.includes(tick) ? null : lightAt(tick);
			renderer.render(gl, VIEW.modelView, VIEW.projection, NORMAL3, fogAt(tick), light, tick);
			onFrame(tick, instances);
			entityStep(entities, tick, now, id => {
				renderer.detach(instances.get(id));
				instances.delete(id);
			});
			queue.deliver(1);
			await flushMicrotasks();
		}
		renderer.debugCell = false;
		renderer.clear();
		renderer.free(gl);
	} finally {
		Date.now = savedNow;
		Object.assign(renderer.FADE, fade);
	}
}
