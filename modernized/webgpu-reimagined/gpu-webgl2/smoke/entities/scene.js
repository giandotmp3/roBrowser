/**
 * The ~200-entity legacy scene for the real-stream parity page: PCs with head,
 * headgears, weapon, shield, robe and dyes; mobs (three sprites, one a 256 class
 * boss); NPCs; every direction; idle, walking, attacking, sitting, hurt and dying;
 * a few carts; status tints (stone, freeze, poison, curse, cloak) and Berserk's
 * additive blend. Driven through the APIs MapEngine uses on a live entity
 * (Entity.set unit data, walkTo, setAction, toggleOpt3, bodyState / healthState /
 * effectState, hasCart / CartNum, remove).
 *
 * Deterministic: positions, jobs and scripts come from a seeded generator.
 */
import { rng } from './assets.js';

/** Map cells covered by the scene (camera target is its centre). */
export const AREA = Object.freeze({ x0: 40, y0: 40, size: 22 });

export const COUNTS = Object.freeze({ pc: 120, mob: 52, npc: 28 });

/** Camera: legacy-style view of the area (pitched 50°, yawed 25°), fovy 20°. */
export const CAMERA = Object.freeze({
	target: [AREA.x0 + AREA.size / 2, AREA.y0 + AREA.size / 2],
	distance: 70,
	pitch: 50,
	yaw: 25,
	fovy: 20
});

export const FOG = Object.freeze({ use: true, exist: true, near: 55, far: 95, color: [0.55, 0.6, 0.75] });

/**
 * Spawn the scene into the legacy EntityManager.
 * @param {{Entity: any, EntityManager: any, StatusConst: any, seed?: number}} deps
 * @returns {{entities: any[], features: Record<string, number>}}
 */
export function spawnScene({ Entity, EntityManager, StatusConst, seed = 0x200 }) {
	const random = rng(seed);
	const pick = list => list[Math.floor(random() * list.length)];
	const cell = () => [AREA.x0 + Math.floor(random() * AREA.size), AREA.y0 + Math.floor(random() * AREA.size)];
	const { BodyState, HealthState, EffectState, Status } = StatusConst;
	const features = {};
	const count = key => (features[key] = (features[key] ?? 0) + 1);
	const entities = [];
	let gid = 150000;

	const spawn = unit => {
		const entity = new Entity({ GID: ++gid, ...unit });
		EntityManager.add(entity);
		entities.push(entity);
		return entity;
	};
	const idle = e => ({ action: e.ACTION.IDLE, frame: 0, repeat: true, play: true });

	for (let i = 0; i < COUNTS.pc; i++) {
		const [x, y] = cell();
		const e = spawn({
			objecttype: Entity.TYPE_PC,
			job: pick([7, 8, 11, 12]),
			sex: i % 2,
			head: 2 + (i % 3),
			headpalette: i % 3, // 0: the sprite's own palette, 1–2: dye files
			bodypalette: i % 4, // 0: own palette, 1–3: dye files
			weapon: random() < 0.8 ? 1101 : 0,
			shield: random() < 0.5 ? 2101 : 0,
			accessory: random() < 0.6 ? 5 : 0,
			accessory2: random() < 0.6 ? 6 : 0,
			accessory3: random() < 0.4 ? 7 : 0,
			Robe: random() < 0.35 ? 1 : 0,
			PosDir: [x, y, i % 8]
		});
		const roll = random();
		if (roll < 0.25) {
			e.walkTo(x, y, x + Math.floor(random() * 9) - 4, y + Math.floor(random() * 9) - 4);
			count('pc.walk');
		} else if (roll < 0.45) {
			e.setAction({ action: e.ACTION.ATTACK, frame: 0, repeat: true, play: true });
			count('pc.attack');
		} else if (roll < 0.55) {
			e.setAction({ action: e.ACTION.SIT, frame: 0, repeat: true, play: true });
			count('pc.sit');
		} else if (roll < 0.62) {
			e.setAction({ action: e.ACTION.READYFIGHT, frame: 0, repeat: true, play: true });
			count('pc.ready');
		} else {
			count('pc.idle');
		}
		// Status tints and Berserk's additive blend (R-SPR-018…023)
		const status = i % 20;
		if (status === 3 || status === 13) {
			e.toggleOpt3(Status.BERSERK, true);
			count('status.berserk');
		} else if (status === 5) {
			e.bodyState = BodyState.STONE;
			count('status.stone');
		} else if (status === 7) {
			e.bodyState = BodyState.FREEZE;
			count('status.freeze');
		} else if (status === 9) {
			e.healthState = HealthState.POISON;
			count('status.poison');
		} else if (status === 11) {
			e.healthState = HealthState.CURSE;
			count('status.curse');
		} else if (status === 15) {
			e.effectState = EffectState.CLOAK;
			count('status.cloak');
		} else if (status === 17) {
			// MapEngine ON_PUSH_CART
			e.hasCart = true;
			e.CartNum = 2;
			count('pc.cart');
		}
	}

	for (let i = 0; i < COUNTS.mob; i++) {
		const [x, y] = cell();
		const job = i % 13 === 0 ? 1039 : pick([1002, 1002, 1004]);
		const e = spawn({ objecttype: Entity.TYPE_MOB, job, PosDir: [x, y, (i * 3) % 8] });
		const roll = random();
		if (roll < 0.25) {
			e.walkTo(x, y, x + Math.floor(random() * 7) - 3, y + Math.floor(random() * 7) - 3);
			count('mob.walk');
		} else if (roll < 0.45) {
			e.setAction({ action: e.ACTION.ATTACK, frame: 0, repeat: true, play: true });
			count('mob.attack');
		} else if (roll < 0.55) {
			e.setAction({ action: e.ACTION.HURT, frame: 0, repeat: false, play: true, next: idle(e) });
			count('mob.hurt');
		} else if (roll < 0.62) {
			e.remove(Entity.VT.DEAD); // DIE, then the 5000 ms fade (R-SPR-026)
			count('mob.dying');
		} else {
			count('mob.idle');
		}
		if (job === 1039) {
			count('mob.boss');
		}
		if (i % 11 === 4) {
			e.healthState = HealthState.POISON;
			count('status.poison');
		}
	}

	for (let i = 0; i < COUNTS.npc; i++) {
		const [x, y] = cell();
		const e = spawn({ objecttype: Entity.TYPE_NPC, job: 50 + i, PosDir: [x, y, i % 8] });
		if (i % 5 === 0) {
			e.walkTo(x, y, x + 2, y - 2);
			count('npc.walk');
		} else {
			count('npc.idle');
		}
	}

	return { entities, features };
}
