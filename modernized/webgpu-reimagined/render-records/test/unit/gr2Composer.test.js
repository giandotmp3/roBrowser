import { describe, expect, it } from 'vitest';
import {
	GR2_ACTIONS,
	Gr2Composer,
	Gr2ModelSource,
	gr2ActionName,
	gr2ActorPose,
	gr2BankPaths,
	gr2BuildWorld,
	gr2CullClip,
	gr2FrameState,
	gr2GroundOffset,
	gr2IsSupported,
	gr2LightFor,
	gr2PoseBucket,
	createGr2Actor,
	setGr2Action
} from '../../src/index.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const ACTION = { IDLE: 0, WALK: 1, ATTACK: 5, HURT: 6, DIE: 8, ATTACK1: 10, ATTACK2: 11, ATTACK3: 12 };
const FLAG = 'data/model/3dmob/guildflag90_1.gr2';
const GUARD = 'data/model/3dmob/kguardian90_7.gr2';

/** A synchronous archive: every requested file answers on deliver(). */
function archive(missing = []) {
	const pending = [];
	const requests = [];
	return {
		requests,
		fetchFile(path, onLoad, onError) {
			requests.push(path);
			pending.push(() => (missing.includes(path) ? onError() : onLoad({ path })));
		},
		deliverAll() {
			while (pending.length) {
				pending.shift()();
			}
		}
	};
}

const decode = ({ path }) => ({
	parsed: { animations: [{ duration: 1 }] },
	meshes: [{ bind: new Float32Array([0, 0, 0, 0, 0, 10]), vcount: 2, emblem: path.includes('guildflag') }],
	boneCount: 2,
	ipRow: IDENTITY
});
const flush = async () => {
	for (let i = 0; i < 3; i++) {
		await Promise.resolve();
	}
};

/** A camera looking down −Z from z = 50 at the origin (identity projection with w = −z). */
const VIEW = {
	modelView: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -10, 0, -50, 1],
	projection: [0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0]
};
const LIGHT = { ambient: [0.5, 0.25, 1], diffuse: [0.9, 0.9, 0.9] };

async function setup({ missing } = {}) {
	const files = archive(missing);
	const models = new Gr2ModelSource({ fetchFile: files.fetchFile, decode, parseBank: () => ({ animations: [{ duration: 0.5 }] }) });
	const calls = [];
	const poseAt = (parsed, idx, t) => {
		calls.push([idx, t]);
		return { skinningMatrices: [IDENTITY, IDENTITY.map(v => v * (1 + idx + t))] };
	};
	let now = 0;
	const composer = new Gr2Composer({ models, poseAt, now: () => now, fade: { death: true, vanish: false } });
	return { files, models, composer, calls, setNow: t => (now = t) };
}

const state = (fields = {}) => ({
	position: [10, 0, 0],
	direction: 0,
	action: ACTION.IDLE,
	ACTION,
	animTick: 0,
	effectAlpha: 1,
	culled: false,
	emblem: null,
	removeTick: 0,
	removeDelay: 0,
	...fields
});

describe('GR2 composer helpers', () => {
	it('R-GR2-003 pose buckets round to the nearest 40 Hz step of clip seconds', () => {
		expect(gr2PoseBucket(0.012)).toBe(0);
		expect(gr2PoseBucket(0.013)).toBe(1);
		expect(gr2PoseBucket(1)).toBe(40);
	});

	it('R-GR2-003 one-frame lag: the previous state wins once one exists', () => {
		const prev = { a: 1 };
		const curr = { a: 2 };
		expect(gr2FrameState(prev, curr)).toBe(prev);
		expect(gr2FrameState(undefined, curr)).toBe(curr);
	});

	it('R-GR2-004 cull: behind the camera or beyond the 0.2-padded NDC box', () => {
		expect(gr2CullClip(0, 0, 0)).toBe(true);
		expect(gr2CullClip(1.2, 0, 1)).toBe(false);
		expect(gr2CullClip(1.21, 0, 1)).toBe(true);
		expect(gr2CullClip(0, -2.5, 2)).toBe(true);
	});

	it('actor: action-relative clock, one-shot revert, dead hold, missing bank → bind pose', () => {
		const model = { parsed: { animations: [{ duration: 2 }, undefined, { duration: 0.5 }, { duration: 1 }] } };
		const actor = createGr2Actor();
		expect(gr2ActorPose(actor, model, 2500, 0)).toEqual({ animIndex: 0, t: 0.5 });
		expect(gr2ActorPose(actor, model, 2500, -1)).toEqual({ animIndex: -1, t: 0 });
		setGr2Action(actor, 'attack', 1000);
		expect(gr2ActorPose(actor, model, 1200, 0)).toEqual({ animIndex: 2, t: 0.2 });
		expect(gr2ActorPose(actor, model, 1600, 0)).toEqual({ animIndex: 0, t: 0 });
		expect(actor.name).toBe('stand');
		setGr2Action(actor, 'dead', 0);
		expect(gr2ActorPose(actor, model, 5000, 0)).toEqual({ animIndex: 3, t: 1 });
		setGr2Action(actor, 'move', 0);
		expect(gr2ActorPose(actor, model, 100, 0)).toEqual({ animIndex: -1, t: 0 });
		expect(actor.name).toBe('stand');
		setGr2Action(actor, 'bogus', 0);
		expect(actor.name).toBe('stand');
	});

	it('maps entity actions and lists the external banks', () => {
		expect([ACTION.DIE, ACTION.HURT, ACTION.ATTACK3, ACTION.WALK, 99].map(a => gr2ActionName(a, ACTION))).toEqual([
			'dead',
			'damage',
			'attack',
			'move',
			'stand'
		]);
		expect(gr2BankPaths('data/model/3dmob/treasurebox_2.gr2').map(b => b.path)).toEqual([
			'data/model/3dmob_bone/2_dead.gr2',
			'data/model/3dmob_bone/2_damage.gr2'
		]);
		expect(gr2BankPaths(FLAG)).toEqual([]);
		expect(GR2_ACTIONS.damage).toBe(4);
	});

	it('R-GR2-001 roster and lighting; world matrix at the cell centre, 0.2 scale; grounding', () => {
		expect(gr2IsSupported(FLAG)).toBe(true);
		expect(gr2IsSupported('data/model/3dmob/dragon_5.gr2')).toBe(false);
		const flag = gr2LightFor(FLAG, LIGHT);
		expect(flag.diffuse[0]).toBeCloseTo(100 / 255, 6);
		expect(flag.ambient[1]).toBeCloseTo(0.299 * 0.5 + 0.587 * 0.25 + 0.114, 6);
		expect(gr2LightFor(GUARD, LIGHT).ambient[0]).toBeCloseTo(127 / 255, 6);
		expect(gr2LightFor('x/other.gr2', LIGHT).diffuse).toBe(LIGHT.diffuse);
		const world = gr2BuildWorld(90, [10, 0, 20]);
		expect(world[12]).toBeCloseTo(10.5, 6);
		expect(world[14]).toBeCloseTo(20.5, 6);
		expect(Math.hypot(world[0], world[1], world[2])).toBeCloseTo(0.2, 6);
		expect(gr2GroundOffset([{ bind: [0, 0, 10], vcount: 1 }], null)).toBeCloseTo(2, 5);
	});
});

describe('Gr2ModelSource', () => {
	it('fetches once per path, decodes after ready, flags 404s, streams banks priority-first', async () => {
		const { files, models } = await setup({ missing: ['data/model/3dmob/gone_3.gr2'] });
		models.acquire(GUARD);
		models.acquire(GUARD);
		models.acquire('data/model/3dmob/gone_3.gr2');
		expect(models.get(GUARD)).toBeNull();
		files.deliverAll();
		expect(models.get(GUARD)).toBeNull(); // decode waits for ready()
		await flush();
		expect(models.get(GUARD)).toMatchObject({ boneCount: 2, hasEmblem: false });
		expect(models.get(GUARD).groundOffset).toBeCloseTo(0, 5);
		expect(models.isMissing('data/model/3dmob/gone_3.gr2')).toBe(true);
		models.requestBank(GUARD, 'move');
		models.requestBank(GUARD, 'dead');
		files.deliverAll();
		expect(files.requests).toEqual([
			GUARD,
			'data/model/3dmob/gone_3.gr2',
			'data/model/3dmob_bone/7_move.gr2',
			'data/model/3dmob_bone/7_dead.gr2',
			'data/model/3dmob_bone/7_attack.gr2',
			'data/model/3dmob_bone/7_damage.gr2'
		]);
		expect(models.get(GUARD).parsed.animations[GR2_ACTIONS.move]).toEqual({ duration: 0.5 });
	});
});

describe('Gr2Composer', () => {
	it('emits nothing without light or instances, and skips models still loading', async () => {
		const { files, composer } = await setup();
		expect(composer.compose({ ...VIEW, light: LIGHT, tick: 0 })).toEqual([]);
		composer.spawn(GUARD, { pos: [10, 0, 0] });
		expect(composer.compose({ ...VIEW, light: LIGHT, tick: 0 })).toEqual([]);
		files.deliverAll();
		await flush();
		expect(composer.compose({ ...VIEW, light: null, tick: 0 })).toEqual([]);
		const [record] = composer.compose({ ...VIEW, light: LIGHT, tick: 0 });
		expect(record).toMatchObject({ kind: 'world', part: 'gr2', alpha: 1, depthTest: true, depthWrite: true });
		expect(record.params.type).toBe(GUARD);
		expect(record.matrices).toHaveLength(32);
	});

	it('R-GR2-003 shares one palette per (path, anim, bucket) and keeps it across frames', async () => {
		const { files, composer, calls } = await setup();
		composer.spawn(GUARD, { pos: [10, 0, 0] });
		composer.spawn(GUARD, { pos: [11, 0, 0] });
		files.deliverAll();
		await flush();
		const a = composer.compose({ ...VIEW, light: LIGHT, tick: 100 });
		expect(a[0].matrices).toBe(a[1].matrices);
		expect(calls).toEqual([[0, 0.1]]);
		const b = composer.compose({ ...VIEW, light: LIGHT, tick: 110 }); // same 40 Hz bucket
		expect(b[0].matrices).toBe(a[0].matrices);
		expect(calls).toHaveLength(1);
		composer.compose({ ...VIEW, light: LIGHT, tick: 140 });
		expect(calls).toHaveLength(2);
	});

	it('R-GR2-003/004/005: entity sync, action restart, culling, NPC bind pose, fade, emblem', async () => {
		const { files, composer, calls, setNow } = await setup();
		const mob = composer.attach({ path: GUARD, npc: false, position: [10, 0, 0], direction: 0 });
		const npc = composer.attach({ path: FLAG, npc: true, position: [10, 0, 0], direction: 2 });
		files.deliverAll();
		await flush();
		const frame = (tick, mobState, npcState = state({ emblem: 'emblem' })) =>
			composer.compose({ ...VIEW, light: LIGHT, tick, states: new Map([[mob, mobState], [npc, npcState]]) });

		let records = frame(0, state());
		expect(records.map(r => r.params.emblem)).toEqual([null, 'emblem']);
		expect(calls.at(-1)).toEqual([-1, 0]); // NPC: bind pose
		calls.length = 0;
		frame(500, state({ action: ACTION.ATTACK, animTick: 500 }));
		expect(calls[0]).toEqual([-1, 0]); // attack bank not loaded yet: bind pose
		records = frame(525, state({ culled: true }));
		expect(records).toHaveLength(1);
		records = frame(550, state({ position: [5000, 0, 0] }));
		expect(records).toHaveLength(1); // frustum-culled
		const world = frame(575, state({ direction: 4 }))[0].params.world;
		expect(Array.from(world)).not.toEqual(Array.from(frame(600, state({ direction: 0 }))[0].params.world));
		setNow(1000);
		records = frame(1000, state({ action: ACTION.DIE, effectAlpha: 0.8, removeTick: 500, removeDelay: 1000 }));
		expect(records[0].alpha).toBeCloseTo(0.4, 6);
		records = frame(1025, state({ effectAlpha: 0.8, removeTick: 500, removeDelay: 1000 })); // vanish fade off
		expect(records[0].alpha).toBeCloseTo(0.8, 6);
		records = frame(1050, state({ effectAlpha: 3 }));
		expect(records[0].alpha).toBe(1);
	});

	it('skips a skeleton beyond the 48-bone palette', async () => {
		const files = archive();
		const models = new Gr2ModelSource({
			fetchFile: files.fetchFile,
			decode: buffer => ({ ...decode(buffer), boneCount: 49 }),
			parseBank: () => ({ animations: [] })
		});
		const composer = new Gr2Composer({ models, poseAt: () => ({ skinningMatrices: [] }) });
		composer.spawn(GUARD, { pos: [10, 0, 0] });
		files.deliverAll();
		await flush();
		expect(composer.compose({ ...VIEW, light: LIGHT, tick: 0 })).toEqual([]);
		expect(composer.overBoneLimit).toBe(1);
		composer.clear();
		expect(composer.instances).toEqual([]);
	});
});
