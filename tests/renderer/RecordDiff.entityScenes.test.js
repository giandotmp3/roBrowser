/**
 * Phase 2 record-diff, widened: render-records' entity composer against legacy on six more scenes
 * (walking, cart, riding, mob death, status tints, NPC). Companion of RecordDiff.entity.test.js.
 *
 * Each scene drives the real legacy Entity through the APIs MapEngine uses (walkTo, setAction,
 * remove, hasCart / CartNum, bodyState / healthState / effectState, toggleOpt3, Session.Playing,
 * Session.Entity.intravision). Inside every legacy entity.render, after walkProcess and right
 * before renderEntity, the live entity is snapshotted and EntityRender.renderRecords runs on it
 * (support/entityRecordDiff.js); both native record streams are diffed field by field (1e-5).
 * Walking position is legacy's post-walkProcess position: walk simulation is game state
 * (EntityWalk), the composer only renders it.
 *
 * The ground is not uniform here: Ground.getShadowFactor and Altitude.getCellHeight vary per cell
 * (support/legacySceneMocks.js `terrain`), and the composer gets the very same functions.
 *
 * Declared divergence -- exactly one, discrepancy #13 [FLAG, fixed]: legacy runs with its
 * animation clock pinned to spawn time (as in RecordDiff.entity.test.js), everything else must match.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// Shared seams; loaded before any legacy module (the canvas patch must precede Entity's import).
const { mocks } = await vi.hoisted(() => import('./support/legacySceneMocks.js'));

vi.mock('Core/Client.js', () => ({ default: mocks.client }));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Renderer/Map/Ground.js', () => ({ default: { getShadowFactor: (x, y) => mocks.terrain.shadowFactor(x, y) } }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: { getCellHeight: (x, y) => mocks.terrain.cellHeight(x, y) } }));
vi.mock('Renderer/Map/Water.js', () => ({ default: {} }));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));
vi.mock('Preferences/Graphics.js', () => ({ default: mocks.graphics }));
vi.mock('Network/PacketVerManager.js', () => ({ default: { value: 20221005, addSupport: () => {} } }));
vi.mock('Renderer/GR2/GR2ModelRenderer.js', () => ({
	default: { attach: () => null, detach: () => {}, isMissing: () => false, isSupported: () => false }
}));
vi.mock('Renderer/Renderer.js', () => ({ default: { tick: 0, getContext: () => null } }));
vi.mock('Utils/WebGL.js', () => ({
	default: { createShaderProgram: () => ({ uniform: {}, attribute: {} }) }
}));
vi.mock('Audio/SoundManager.js', () => ({ default: mocks.inert() }));
vi.mock('DB/DBManager.js', () => ({ default: mocks.db }));
vi.mock('Controls/KeyEventHandler.js', () => ({ default: {} }));
vi.mock('Controls/MouseEventHandler.js', () => ({ default: { screen: { x: 0, y: 0 } } }));
vi.mock('Utils/PathFinding.js', () => ({ default: mocks.inert(mocks.pathFinding) }));
vi.mock('Network/NetworkManager.js', () => ({ default: mocks.inert() }));
vi.mock('Network/PacketStructure.js', () => ({ default: {} }));
vi.mock('Engine/MapEngine/Friends.js', () => ({ default: mocks.inert() }));
vi.mock('Engine/MapEngine/Guild.js', () => ({ default: mocks.inert() }));
vi.mock('Engine/MapEngine/Group.js', () => ({ default: mocks.inert() }));
vi.mock('UI/CursorManager.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/InputBox/InputBox.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/ChatRoom/ChatRoom.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/ContextMenu/ContextMenu.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/PetInformations/PetInformations.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/Trade/Trade.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/NpcBox/NpcBox.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/ChatBox/ChatBox.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/Equipment/Equipment.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/Captcha/CaptchaSelector.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/PartyFriends/PartyFriends.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/HomunInformations/HomunInformations.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/MercenaryInformations/MercenaryInformations.js', () => ({ default: mocks.inert() }));
vi.mock('UI/Components/EntityRoom/EntityRoom.js', () => ({
	default: { clone: () => ({ ui: [{ style: {} }], append: () => {}, remove: () => {} }) }
}));
vi.mock('Renderer/Effects/StrEffect.js', () => ({ default: function StrEffect() {} }));

// The scene support loads EntityManager before Entity (their circular import needs that order).
import { FRAME_MS, PC_UNIT, WALK_FRAMES, cleanupScene } from './support/legacyPcScene.js';
import { runEntityDiff } from './support/entityRecordDiff.js';
import Entity from 'Renderer/Entity/Entity.js';
import StatusConst from 'DB/Status/StatusState.js';
import { RecordStream, WALK_MOTION_CONSTANT } from '../../modernized/webgpu-reimagined/render-records/src/index.js';

const { BodyState, HealthState, EffectState, Status } = StatusConst;

/** The composer gets the same ground seams the mocks above hand legacy. */
const GROUND = {
	shadowFactorAt: (x, y) => mocks.terrain.shadowFactor(x, y),
	cellHeightAt: (x, y) => mocks.terrain.cellHeight(x, y)
};

const diff = scene => runEntityDiff({ ground: GROUND, ...scene });

const nameOf = (names, record) => names.get(record.texture) ?? 'unknown';
const partOf = (names, record) => nameOf(names, record).split(/[#:]/)[0];
const recordsOf = (names, records, part) => records.filter(r => partOf(names, r) === part);

const idle = action => ({ action, frame: 0, repeat: true, play: true });

afterEach(cleanupScene);

afterAll(() => {
	mocks.restoreCanvas();
});

// ------------------------------------------------------------------------------------------------
// 1. PC walking (R-SPR-028 walk cadence, walk position / direction)
// ------------------------------------------------------------------------------------------------
describe('record-diff scene 1: PC walking (R-SPR-028)', () => {
	const WALK = {
		frames: 75,
		script: (frame, e) => {
			if (frame === 2) {
				e.walkTo(50, 60, 55, 57); // diagonal then straight, toward the front
			}
			if (frame === 40) {
				e.walkTo(55, 57, 53, 62); // back toward +y: back-facing directions while walking
			}
		}
	};

	it('reproduces every legacy record field by field over two walks and the stops', () => {
		const { legacy, mismatches, states } = diff(WALK);
		expect(legacy).toHaveLength(75);
		expect(mismatches).toEqual([]);
		// Non-vacuous: the entity really walked, between cells, turning through front and back directions
		const walking = states.filter(s => s && s.action === 1);
		expect(walking.length).toBeGreaterThan(30);
		expect(walking.some(s => !Number.isInteger(s.position[0]))).toBe(true);
		const dirs = new Set(walking.map(s => s.direction));
		expect([...dirs].some(d => d > 2 && d < 6)).toBe(true);
		expect([...dirs].some(d => d < 2 || d > 5)).toBe(true);
		expect(states[74].action).toBe(0);
	});

	it('walk frames follow walked distance: body frame = floor(dist * 170.2 / delay) % 8, shared by all parts', () => {
		const { legacy, modern, states, names } = diff(WALK);
		const seen = new Set();
		states.forEach((s, frame) => {
			if (!s || s.action !== 1) {
				return;
			}
			const expected = Math.floor((s.walkDist * WALK_MOTION_CONSTANT) / 100) % WALK_FRAMES;
			seen.add(expected);
			for (const records of [legacy[frame], modern[frame]]) {
				expect(nameOf(names, recordsOf(names, records, 'body')[0])).toBe(`body#${2 * expected}`);
				expect(nameOf(names, recordsOf(names, records, 'head')[0])).toBe(`head#${expected}`);
				expect(nameOf(names, recordsOf(names, records, 'weapon')[0])).toBe(`weapon#${expected}`);
			}
		});
		expect(seen.size).toBe(WALK_FRAMES);
	});

	it('every layer follows the interpolated position; the shadow sits on that cell height + 0.05', () => {
		const { legacy, states, names } = diff(WALK);
		const frame = states.findIndex(s => s && s.action === 1 && !Number.isInteger(s.position[1]));
		const [x, y, z] = states[frame].position;
		const shadow = recordsOf(names, legacy[frame], 'shadow')[0];
		expect(Array.from(shadow.position)).toEqual([x, y, mocks.terrain.cellHeight(x, y) + 0.05].map(Math.fround));
		const body = recordsOf(names, legacy[frame], 'body')[0];
		expect(body.position[2]).toBeCloseTo(z + 0.2, 5);
		expect(body.shadowFactor).toBeCloseTo(mocks.terrain.shadowFactor(x, y), 6);
	});
});

// ------------------------------------------------------------------------------------------------
// 2. PC with cart while Session.Playing (R-SPR-010, discrepancy #16)
// ------------------------------------------------------------------------------------------------
describe('record-diff scene 2: PC with cart (R-SPR-010, #16)', () => {
	const CART = {
		frames: 70,
		onSpawn: e => {
			// MapEngine ON_PUSH_CART (Engine/MapEngine/Entity.js:1979-1984)
			e.hasCart = true;
			e.CartNum = 2;
		},
		script: (frame, e) => {
			const at = {
				0: () => (mocks.session.Playing = false),
				5: () => (mocks.session.Playing = true),
				12: () => (e.direction = 1),
				16: () => (e.direction = 2),
				20: () => (e.direction = 4),
				25: () => (e.direction = 3),
				30: () => (e.direction = 5),
				35: () => (e.direction = 6),
				38: () => e.walkTo(50, 60, 50, 57), // walking cart, front (cart before the body)
				52: () => e.walkTo(50, 57, 50, 60), // walking cart, back (cart after the body)
				66: () => (mocks.session.Playing = false)
			};
			at[frame]?.();
		}
	};

	it('reproduces every legacy record field by field (front, behind, back, walking, not playing)', () => {
		const { legacy, mismatches } = diff(CART);
		expect(mismatches).toEqual([]);
		expect(legacy.every(records => records.length > 1)).toBe(true);
	});

	it('the cart draws only while Session.Playing; idle shows frame 0; back-facing continues the counter (#16)', () => {
		const { legacy, names, states } = diff(CART);
		expect(recordsOf(names, legacy[2], 'cart2')).toEqual([]);
		expect(recordsOf(names, legacy[68], 'cart2')).toEqual([]);
		expect(recordsOf(names, legacy[7], 'cart2').map(r => nameOf(names, r))).toEqual(['cart2#0']);
		// Front: cart shadow -1, cart 1, no depth write; offsets by visual direction
		const front = legacy[7];
		const cart = recordsOf(names, front, 'cart2')[0];
		expect([cart.zIndex, cart.depthWrite]).toEqual([1, false]);
		expect(Array.from(cart.offset)).toEqual([0 + 2, -30 + 5]);
		// Back (direction 4): cart shadow at bodyZ + 500 = 750, the cart continues at 751
		const back = legacy[22];
		const shadows = recordsOf(names, back, 'shadow');
		expect(shadows.map(r => r.zIndex)).toEqual([-1, 750]);
		expect(recordsOf(names, back, 'cart2')[0].zIndex).toBe(751);
		// Walking: the cart follows the walked distance -- on its own 80 ms phase when drawn before the
		// body (front), on the body's 100 ms phase when drawn after it (back)
		const walkFrames = states.map((s, i) => (s && s.action === 1 && i < 66 ? i : -1)).filter(i => i >= 0);
		expect(walkFrames.length).toBeGreaterThan(15);
		for (const i of walkFrames) {
			const back = states[i].direction > 2 && states[i].direction < 6;
			const phase = Math.floor((states[i].walkDist * WALK_MOTION_CONSTANT) / (back ? 100 : 80)) % WALK_FRAMES;
			expect(nameOf(names, recordsOf(names, legacy[i], 'cart2')[0])).toBe(`cart2#${phase}`);
		}
		expect(walkFrames.some(i => states[i].direction === 4)).toBe(true);
	});

	it('a Super Novice always uses cart 0', () => {
		const original = mocks.db.isSuperNovice;
		mocks.db.isSuperNovice = () => true;
		try {
			const { legacy, mismatches, names } = diff({ ...CART, frames: 24 });
			expect(mismatches).toEqual([]);
			expect(recordsOf(names, legacy[7], 'cart0')).toHaveLength(1);
			expect(recordsOf(names, legacy[7], 'cart2')).toEqual([]);
		} finally {
			mocks.db.isSuperNovice = original;
		}
	});
});

// ------------------------------------------------------------------------------------------------
// 3. Riding (R-SPR-007 riding bodyZ, R-SPR-009 riding robe)
// ------------------------------------------------------------------------------------------------
describe('record-diff scene 3: riding PC (R-SPR-007, R-SPR-009)', () => {
	const RIDING = {
		unit: { ...PC_UNIT, Robe: 2 },
		frames: 75,
		onSpawn: e => {
			e.effectState = EffectState.RIDING; // as MapEngine's option packet sets it
		},
		script: (frame, e) => {
			const SIT = () => e.setAction(idle(e.ACTION.SIT));
			const IDLE = () => e.setAction(idle(e.ACTION.IDLE));
			const at = {
				10: SIT,
				15: () => {
					IDLE();
					e.direction = 4;
				},
				20: SIT,
				25: () => {
					IDLE();
					e.direction = 0;
					e.robe = 3;
				},
				30: SIT,
				35: () => {
					IDLE();
					e.direction = 4;
				},
				40: SIT,
				45: () => {
					IDLE();
					e.direction = 0;
				},
				47: () => e.walkTo(50, 60, 50, 55), // riding walk toward the front
				62: () => e.walkTo(50, 55, 50, 59) // riding walk toward the back
			};
			at[frame]?.();
		}
	};

	it('reproduces every legacy record field by field (idle, sitting, walking; two tall robes)', () => {
		const { legacy, mismatches } = diff(RIDING);
		expect(legacy).toHaveLength(75);
		expect(mismatches).toEqual([]);
	});

	it('exercises the riding zIndex and robe branches legacy takes', () => {
		const { legacy, names, states } = diff(RIDING);
		const z = (frame, part) => recordsOf(names, legacy[frame], part)[0]?.zIndex;
		// Idle front, riding: bodyZ 500 → head 550; robe2 tall only with the riding-front bonus → -300
		expect(z(5, 'head')).toBe(550);
		expect(z(5, 'robe2')).toBe(-300);
		// Sitting front, riding: body doubled to 300; robe2 not tall when sitting → -100
		expect(z(12, 'body')).toBe(300);
		expect(z(12, 'robe2')).toBe(-100);
		// Idle back: robe2 not tall (no bonus) → bodyZ + 400
		expect(z(17, 'robe2')).toBe(900);
		// Sitting back → bodyZ + 550
		expect(z(22, 'robe2')).toBe(1050);
		// robe3 (tall even sitting): sitting front -450, back riding 1 / 100
		expect(z(32, 'robe3')).toBe(-450);
		expect(z(42, 'robe3')).toBe(501);
		expect(z(37, 'robe3')).toBe(600);
		// Walking toward the front: body 300, bodyZ 750 → head 800
		const front = states.findIndex((s, i) => i > 47 && s && s.action === 1);
		expect(z(front, 'body')).toBe(300);
		expect(z(front, 'head')).toBe(800);
	});
});

// ------------------------------------------------------------------------------------------------
// 4. Mob: idle → attack → death (R-SPR-026, #20, R-SPR-013)
// ------------------------------------------------------------------------------------------------
describe('record-diff scene 4: mob idle → death (R-SPR-026, R-SPR-011 #20, R-SPR-013)', () => {
	const DEATH_FRAME = 10;
	const FADE_FRAMES = 5000 / FRAME_MS;
	const MOB = {
		unit: { GID: 210001, objecttype: Entity.TYPE_MOB, job: 1004, PosDir: [52, 61, 2] },
		owner: 'mob',
		frames: DEATH_FRAME + FADE_FRAMES + 6,
		script: (frame, e) => {
			if (frame === 2) {
				e.setAction({ action: e.ACTION.ATTACK, frame: 0, repeat: false, play: true, next: idle(e.ACTION.IDLE) });
			}
			if (frame === DEATH_FRAME) {
				e.remove(Entity.VT.DEAD); // onEntityVanish with VT.DEAD
			}
		}
	};

	it('reproduces every legacy record field by field through the 5000 ms fade and the removal', () => {
		const { legacy, modern, mismatches } = diff(MOB);
		expect(mismatches).toEqual([]);
		expect(legacy[DEATH_FRAME - 1].length).toBeGreaterThan(1);
		// Removed by EntityManager once remove_tick + delay < now: nothing drawn either side
		expect(legacy.at(-1)).toEqual([]);
		expect(modern.at(-1)).toEqual([]);
	});

	it('mob DIE (action 4) hides the shadow; bodies only test depth; alpha fades linearly', () => {
		const { legacy, names } = diff(MOB);
		expect(recordsOf(names, legacy[DEATH_FRAME - 1], 'shadow')).toHaveLength(1);
		expect(recordsOf(names, legacy[DEATH_FRAME + 1], 'shadow')).toEqual([]);
		for (const records of legacy) {
			for (const r of recordsOf(names, records, 'mob')) {
				expect([r.depthTest, r.depthWrite, r.zIndex >= 150]).toEqual([true, false, true]);
			}
		}
		const k = 50;
		const body = recordsOf(names, legacy[DEATH_FRAME + k], 'mob')[0];
		expect(body.color[3]).toBeCloseTo(0.9 * (1 - (k * FRAME_MS) / 5000), 5);
		// The one-shot DIE holds its last frame (3 frames: index 4*3 + 2)
		expect(nameOf(names, body)).toBe('mob#14');
	});

	it('#22: past the delay the composer clamps the fade (draws nothing) where legacy would go negative', () => {
		const { lastSnapshot } = diff(MOB);
		const stream = new RecordStream();
		stream.beginFrame();
		lastSnapshot.renderRecords(stream, {
			tick: lastSnapshot.removal.tick + 6000,
			camera: { direction: 0 },
			...GROUND
		});
		expect(stream.records).toEqual([]);
	});
});

// ------------------------------------------------------------------------------------------------
// 5. Status tints (R-SPR-018…023), composed by render-records from the status
// ------------------------------------------------------------------------------------------------
describe('record-diff scene 5: status tints (R-SPR-018…023)', () => {
	const intravision = (e, on) => {
		mocks.session.Entity = on ? { intravision: true } : null;
		e.effectState = e.effectState; // MapEngine CLAIRVOYANCE refresh (Engine/MapEngine/Entity.js:1968-1976)
	};
	const STATUS = {
		frames: 66,
		composeStatus: true,
		script: (frame, e) => {
			const at = {
				3: () => (e.bodyState = BodyState.STONEWAIT),
				6: () => (e.bodyState = BodyState.STONE),
				10: () => (e.bodyState = 0),
				12: () => (e.bodyState = BodyState.FREEZE),
				16: () => (e.bodyState = 0),
				18: () => (e.healthState = HealthState.POISON),
				20: () => (e.healthState = HealthState.POISON | HealthState.CURSE),
				22: () => (e.healthState = HealthState.CURSE),
				24: () => (e.healthState = 0),
				26: () => (e.effectState = EffectState.CLOAK),
				28: () => intravision(e, true),
				30: () => (e.effectState = EffectState.INVISIBLE),
				32: () => {
					e.effectState = 0;
					intravision(e, false);
				},
				34: () => e.toggleOpt3(Status.BERSERK, true),
				38: () => e.toggleOpt3(Status.TWOHANDQUICKEN, true),
				40: () => e.toggleOpt3(Status.BERSERK, false),
				42: () => e.toggleOpt3(Status.MARIONETTE, true),
				46: () => {
					e.toggleOpt3(Status.MARIONETTE, false);
					e.toggleOpt3(Status.TWOHANDQUICKEN, false);
				},
				48: () => {
					e.Shadowform = true;
					e.effectState = e.effectState;
				},
				52: () => intravision(e, true),
				54: () => {
					e.Shadowform = false;
					intravision(e, false);
					e.healthState = HealthState.POISON;
					e.bodyState = BodyState.STONE;
					e.toggleOpt3(Status.BERSERK, true);
				},
				60: () => e.setAction({ action: e.ACTION.ATTACK, frame: 0, repeat: false, play: true, next: false })
			};
			at[frame]?.();
		}
	};

	it('reproduces every legacy record field by field, effectColor composed from the status', () => {
		const { legacy, mismatches } = diff(STATUS);
		expect(legacy).toHaveLength(66);
		expect(mismatches).toEqual([]);
	});

	it('the scene covers each tint legacy applies', () => {
		const { legacy, names } = diff(STATUS);
		const body = frame => recordsOf(names, legacy[frame], 'body')[0];
		const rgba = frame => Array.from(body(frame).color).map(v => Math.round(v * 1000) / 1000);
		expect(rgba(4)).toEqual([0.3, 0.3, 0.3, 1]); // stone-wait
		expect(rgba(8)).toEqual([0.1, 0.1, 0.1, 1]); // stone
		expect(rgba(14)).toEqual([0, 0.4, 0.8, 1]); // freeze
		expect(rgba(19)).toEqual([0.9, 0.4, 0.8, 1]); // poison
		expect(rgba(21)).toEqual([0.45, 0.06, 0.08, 1]); // poison × curse
		expect(legacy[27]).toEqual([]); // cloak
		expect(rgba(29)).toEqual([0, 0, 0, 1]); // cloak seen with intravision
		expect(legacy[31]).toEqual([]); // INVISIBLE is never revealed, even with intravision
		expect(rgba(36)).toEqual([1, 0.4, 0.4, 1]); // berserk
		expect(body(36).blend).toBe('additive');
		expect(recordsOf(names, legacy[36], 'shadow')[0].blend).toBe('normal');
		expect(rgba(41)).toEqual([1, 1, 0, 1]); // quicken
		expect(rgba(44)).toEqual([1, 0.34, 0.71, 0.5]); // marionette overwrites quicken's B (later wins)
		expect(recordsOf(names, legacy[44], 'shadow')[0].blend).toBe('additive');
		expect(rgba(50)).toEqual([0.2, 0.2, 0.2, 0.2]); // shadow form
		expect(rgba(53)).toEqual([0, 0, 0, 1]); // shadow form seen with intravision
		expect(rgba(56)).toEqual([0.09, 0.016, 0.032, 1]); // stone × poison × berserk
	});
});

// ------------------------------------------------------------------------------------------------
// 6. NPC (R-SPR-005 ignoreDepthMinCap, R-SPR-013)
// ------------------------------------------------------------------------------------------------
describe('record-diff scene 6: NPC (R-SPR-005, R-SPR-013)', () => {
	const NPC = {
		unit: { GID: 110001, objecttype: Entity.TYPE_NPC, job: 86, PosDir: [48, 58, 0] },
		owner: 'npc',
		frames: 50,
		script: (frame, e) => {
			if (frame === 10) {
				e.direction = 2;
			}
			if (frame === 15) {
				mocks.camera.direction = 3;
			}
			if (frame === 22) {
				e.walkTo(48, 58, 50, 61); // unitwalk NPC
			}
		}
	};

	it('reproduces every legacy record field by field (idle, turned, camera rotated, walking)', () => {
		const { legacy, mismatches } = diff(NPC);
		expect(legacy).toHaveLength(50);
		expect(mismatches).toEqual([]);
	});

	it('NPC bodies write depth and skip the depth min cap; the shadow keeps both off', () => {
		const { legacy, names } = diff(NPC);
		for (const records of legacy) {
			for (const r of recordsOf(names, records, 'npc')) {
				expect([r.depthWrite, r.ignoreDepthMinCap, r.zIndex]).toEqual([true, true, 150]);
				expect(r.textureClass).toBe('rgba');
			}
			for (const r of recordsOf(names, records, 'shadow')) {
				expect([r.depthWrite, r.ignoreDepthMinCap]).toEqual([false, false]);
			}
		}
		// The 2-action ACT wraps (action * 8 + dir) % 16; idle uses the 150 ms default delay
		expect(new Set(legacy.slice(0, 10).map(r => nameOf(names, recordsOf(names, r, 'npc')[0]))).size).toBe(2);
	});
});
