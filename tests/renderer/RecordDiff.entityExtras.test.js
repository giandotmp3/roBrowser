/**
 * Phase 2 record-diff, remaining entity rules: render-records' entity composer against legacy for
 * the Assumptio halo (R-SPR-024), after-image trails (R-SPR-025), head turning (R-SPR-029) and
 * sprite attachments (R-SPR-031). Companion of RecordDiff.entity / RecordDiff.entityScenes.
 *
 * Same driver as RecordDiff.entityScenes (support/entityRecordDiff.js): the real legacy Entity is
 * driven through the APIs MapEngine and the effect table use (toggleOpt3, _enableHalo /
 * _enableTrail / _blurType, walkTo with isFastMove, lookTo, bodyState / healthState,
 * attachments.add / remove); inside every legacy entity.render the live entity is snapshotted and
 * EntityRender.renderRecords runs on it; both native record streams are diffed field by field
 * (1e-5). Cross-frame composer state (trail snapshots, the attachment list) is render-records'
 * own: attachments are mirrored only as add / remove *calls*; lookTo is computed by render-records
 * and replaces the snapshot's direction / headDir.
 *
 * STR attachments (R-SPR-032) are out of scope here.
 *
 * Declared divergence -- exactly one, discrepancy #13 [FLAG, fixed]: legacy runs with its
 * animation clock pinned to spawn time; everything else must match.
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
import { FRAME_MS, PC_UNIT, cleanupScene } from './support/legacyPcScene.js';
import { runEntityDiff } from './support/entityRecordDiff.js';
import Entity from 'Renderer/Entity/Entity.js';
import StatusConst from 'DB/Status/StatusState.js';
import { directionTo, lookTo } from '../../modernized/webgpu-reimagined/render-records/src/index.js';

const { BodyState, HealthState, Status } = StatusConst;

/** The composer gets the same ground seams the mocks above hand legacy. */
const GROUND = {
	shadowFactorAt: (x, y) => mocks.terrain.shadowFactor(x, y),
	cellHeightAt: (x, y) => mocks.terrain.cellHeight(x, y)
};

const diff = scene => runEntityDiff({ ground: GROUND, ...scene });

const nameOf = (names, record) => names.get(record.texture) ?? 'unknown';
const partOf = (names, record) => nameOf(names, record).split(/[#:]/)[0];
const recordsOf = (names, records, part) => records.filter(r => partOf(names, r) === part);
const at = table => (frame, e) => table[frame]?.(e);
const idle = action => ({ action, frame: 0, repeat: true, play: true });
const MOB_UNIT = { GID: 210001, objecttype: Entity.TYPE_MOB, job: 1004, PosDir: [52, 61, 2] };

/** A halo record: additive, alpha 0.6 × layer alpha, no depth write (body/head layers have alpha 1). */
const isHalo = r => r.blend === 'additive' && Math.abs(r.color[3] - 0.6) < 1e-6 && !r.depthWrite;

afterEach(cleanupScene);

afterAll(() => {
	mocks.restoreCanvas();
});

// ------------------------------------------------------------------------------------------------
// R-SPR-024 Assumptio halo
// ------------------------------------------------------------------------------------------------
describe('R-SPR-024: Assumptio halo', () => {
	const HALO = {
		frames: 60,
		script: at({
			3: e => e.toggleOpt3(Status.ASSUMPTIO, true),
			12: e =>
				e.setAction({ action: e.ACTION.ATTACK, frame: 0, repeat: false, play: true, next: idle(e.ACTION.IDLE) }),
			24: e => (e.direction = 4), // back-facing: shield behind, robe after the hats
			30: e => e.toggleOpt3(Status.BERSERK, true), // halo stays additive, body turns additive too
			36: e => {
				e.toggleOpt3(Status.BERSERK, false);
				e.toggleOpt3(Status.ASSUMPTIO, false);
			},
			40: e => (e._enableHalo = true), // skill-driven halo (EffectTable.js:8678)
			46: e => e.remove(Entity.VT.OUTOFSIGHT), // removal fade applies to the halo too
			50: e => (e._enableHalo = false)
		})
	};

	it('reproduces every legacy record field by field (opt3 and skill halo, attack, back, berserk, fade)', () => {
		const { legacy, mismatches } = diff(HALO);
		expect(legacy).toHaveLength(60);
		expect(mismatches).toEqual([]);
	});

	it('each element is redrawn first at 1.15×, (1,1,1,0.6), additive, from its own zIndex − 100', () => {
		const { legacy, names } = diff(HALO);
		expect(legacy[2].filter(isHalo)).toEqual([]);
		const frame = legacy[5];
		const halos = frame.filter(isHalo);
		// body (2 drawn layers) + head + 3 hats + robe + weapon (1 visible layer) + shield; not the shadow
		expect(halos.map(r => partOf(names, r))).toEqual([
			'robe',
			'body',
			'body',
			'head',
			'hat7',
			'hat6',
			'hat5',
			'weapon',
			'shield'
		]);
		const body = recordsOf(names, frame, 'body');
		expect(body.map(r => r.zIndex)).toEqual([50, 51, 150, 151]); // halo from 150 − 100, then 150 again
		expect(body[0].size[0]).toBeCloseTo(body[2].size[0] * 1.15, 5);
		expect(body[0].size[1]).toBeCloseTo(body[2].size[1] * 1.15, 5);
		expect(recordsOf(names, frame, 'shadow').filter(isHalo)).toEqual([]);
		// Skill halo and the out-of-sight fade
		expect(legacy[42].filter(isHalo).length).toBe(halos.length);
		const faded = legacy[48].filter(r => r.blend === 'additive');
		expect(faded.length).toBeGreaterThan(0);
		expect(faded[0].color[3]).toBeCloseTo(0.6 * (1 - (2 * FRAME_MS) / 1000), 5);
	});

	it('a mob halo redraws its body only', () => {
		const { legacy, mismatches, names } = diff({
			unit: MOB_UNIT,
			owner: 'mob',
			frames: 12,
			script: at({ 2: e => e.toggleOpt3(Status.ASSUMPTIO, true) })
		});
		expect(mismatches).toEqual([]);
		const mob = recordsOf(names, legacy[5], 'mob');
		expect(mob.filter(r => r.blend === 'additive').map(r => r.zIndex)).toEqual([50, 51]);
	});
});

// ------------------------------------------------------------------------------------------------
// R-SPR-025 after-image trails
// ------------------------------------------------------------------------------------------------
describe('R-SPR-025: after-image trails', () => {
	/** Trail ghosts: drawn at the raw (unlifted) position, so their z is not the lifted body z. */
	const ghostsOf = (names, records, part, bodyZ) =>
		recordsOf(names, records, part).filter(r => !r.depthWrite && Math.abs(r.position[2] - bodyZ) > 0.1);

	const walkScene = (toggle, extra = {}) => ({
		frames: 60,
		script: at({
			1: toggle,
			3: e => e.walkTo(50, 60, 55, 57),
			28: e => e.walkTo(55, 57, 53, 62),
			...extra
		})
	});

	it('Energy Coat while walking (type 1): every 80 ms, ≤ 5 kept, coloured, fading 0.4 → 0.05 over 400 ms', () => {
		const { legacy, mismatches, names, states } = diff(walkScene(e => e.toggleOpt3(Status.ENERGYCOAT, true)));
		expect(mismatches).toEqual([]);
		const frame = states.findIndex((s, i) => i > 10 && s && s.action === 1);
		const bodyZ = states[frame].position[2] + 0.2;
		const ghosts = ghostsOf(names, legacy[frame], 'body', bodyZ);
		expect(ghosts.length).toBeGreaterThan(0);
		expect(ghosts.length).toBeLessThanOrEqual(5 * 2);
		for (const g of ghosts) {
			expect(g.color[3]).toBeGreaterThan(0.05);
			expect(g.color[3]).toBeLessThanOrEqual(0.4 + 1e-6);
			expect(g.blend).toBe('normal');
		}
		// After the walks end, ghosts fade out within 400 ms
		expect(ghostsOf(names, legacy[59], 'body', states[59].position[2] + 0.2)).toEqual([]);
	});

	it('Quicken and Overthrust trails keep the entity colour; Explosion Spirits too', () => {
		for (const toggle of [
			e => e.toggleOpt3(Status.TWOHANDQUICKEN, true),
			e => e.toggleOpt3(Status.OVERTHRUST, true),
			e => e.toggleOpt3(Status.EXPLOSIONSPIRITS, true)
		]) {
			const { mismatches, legacy } = diff(walkScene(toggle));
			expect(mismatches).toEqual([]);
			expect(legacy.some(records => records.length > 12)).toBe(true);
		}
	});

	it('Hallucination Walk (type 3): white, 560 ms spacing, doubled alpha over 800 ms', () => {
		const { legacy, mismatches } = diff(walkScene(e => e.toggleOpt3(Status.HALLUCINATIONWALK, true)));
		expect(mismatches).toEqual([]);
		const alphas = legacy.flat().filter(r => r.blend === 'normal' && !r.depthWrite && r.color[3] > 0.4 + 1e-6);
		expect(alphas.length).toBeGreaterThan(0); // only type 3 doubles past 0.4
	});

	it('Bunshin (type 5): snapshots only during attacks or skills, white', () => {
		const { legacy, mismatches, names } = diff({
			frames: 50,
			script: at({
				1: e => e.toggleOpt3(Status.NJ_BUNSINJYUTSU, true),
				4: e => e.walkTo(50, 60, 52, 60), // walking takes no type-5 snapshot
				20: e => e.setAction({ action: e.ACTION.ATTACK, frame: 0, repeat: true, play: true }),
				40: e => e.setAction(idle(e.ACTION.IDLE))
			})
		});
		expect(mismatches).toEqual([]);
		const extra = frame => legacy[frame].filter(r => !r.depthWrite && partOf(names, r) === 'body').length;
		expect(extra(10)).toBe(0);
		expect(extra(22)).toBeGreaterThan(0);
	});

	it('fast move: 30 ms snapshots while moving, even without a status', () => {
		const { legacy, mismatches, names, states } = diff({
			frames: 40,
			script: at({ 2: e => e.walkTo(50, 60, 56, 60, 0, undefined, undefined, true, 60) })
		});
		expect(mismatches).toEqual([]);
		const moving = states.findIndex((s, i) => i > 6 && s && s.position[0] > 51);
		expect(ghostsOf(names, legacy[moving], 'body', states[moving].position[2] + 0.2).length).toBeGreaterThan(0);
	});

	it('_enableTrail with _blurType 4 keeps one white snapshot (effect-table trails)', () => {
		const { mismatches, legacy } = diff({
			frames: 40,
			script: at({
				2: e => {
					e._enableTrail = true;
					e._blurType = 4;
				},
				5: e => e.walkTo(50, 60, 54, 60),
				30: e => (e._enableTrail = false)
			})
		});
		expect(mismatches).toEqual([]);
		expect(legacy[6].filter(r => !r.depthWrite && r.color[0] === 1 && r.color[3] < 0.41).length).toBeGreaterThan(0);
	});

	it('performance mode halves the snapshots kept (5 → 2)', () => {
		const scene = walkScene(e => e.toggleOpt3(Status.ENERGYCOAT, true));
		const count = run => Math.max(...run.legacy.map(records => records.filter(r => !r.depthWrite && r.zIndex < 150 && r.zIndex > 130).length));
		const normal = diff(scene);
		mocks.graphics.performanceMode = true;
		try {
			const perf = diff(scene);
			expect(perf.mismatches).toEqual([]);
			expect(count(perf)).toBeLessThan(count(normal));
		} finally {
			mocks.graphics.performanceMode = false;
		}
	});

	it('is deterministic under the same seed and clock', () => {
		const scene = walkScene(e => e.toggleOpt3(Status.ENERGYCOAT, true));
		const a = diff({ ...scene, seed: 7 });
		const b = diff({ ...scene, seed: 7 });
		expect(b.modern).toEqual(a.modern);
		expect(b.legacy).toEqual(a.legacy);
	});

	it('a mob trail (Quicken) follows its own walk', () => {
		const { mismatches } = diff({
			unit: MOB_UNIT,
			owner: 'mob',
			frames: 30,
			script: at({
				1: e => e.toggleOpt3(Status.TWOHANDQUICKEN, true),
				3: e => e.walkTo(52, 61, 56, 63)
			})
		});
		expect(mismatches).toEqual([]);
	});
});

// ------------------------------------------------------------------------------------------------
// R-SPR-029 head turning (lookTo)
// ------------------------------------------------------------------------------------------------
describe('R-SPR-029: head turning (lookTo)', () => {
	it('matches legacy Entity.lookTo for every direction, head state and target', () => {
		const e = new Entity({ ...PC_UNIT });
		const offsets = [];
		for (let dx = -2; dx <= 2; ++dx) {
			for (let dy = -2; dy <= 2; ++dy) {
				offsets.push([dx, dy], [dx + 0.4, dy - 0.4]);
			}
		}
		let checked = 0;
		for (let direction = 0; direction < 8; ++direction) {
			for (const headDir of [0, 1, 2]) {
				for (const [dx, dy] of offsets) {
					e.direction = direction;
					e.headDir = headDir;
					e.lookTo(e.position[0] + dx, e.position[1] + dy);
					const target = directionTo(dx, dy);
					expect(lookTo({ direction, headDir }, target)).toEqual({ direction: e.direction, headDir: e.headDir });
					checked++;
				}
			}
		}
		expect(checked).toBe(8 * 3 * 50);
	});

	it('record-diff: render-records turns the head / body itself and draws what legacy draws', () => {
		// Legacy turns through Entity.lookTo; render-records' state comes from its own lookTo, not legacy's.
		// 0 → head left (d 2), body to target (d 1, head already left), head right (d 5), body (d 7),
		// head right (d 5), body (d 7), opposite with a straight head (d 4), d 6, d 2
		const targets = {
			2: [1, 0],
			6: [1, 0],
			10: [-1, -1],
			14: [-1, -1],
			18: [0, 1],
			22: [0, 1],
			26: [0, -1],
			30: [-1, 0],
			33: [1, -1]
		};
		let state = null;
		const turns = [];
		const { legacy, mismatches, names } = diff({
			frames: 36,
			script: (frame, e) => {
				if (targets[frame]) {
					e.lookTo(e.position[0] + targets[frame][0], e.position[1] + targets[frame][1]);
				}
			},
			onSnapshot: (snapshot, frame) => {
				state ??= { direction: snapshot.direction, headDir: snapshot.headDir };
				if (targets[frame]) {
					state = lookTo(state, directionTo(...targets[frame]));
					turns.push({ ...state });
				}
				snapshot.direction = state.direction;
				snapshot.headDir = state.headDir;
			}
		});
		expect(mismatches).toEqual([]);
		// Head-only turns and body turns both happened; the idle body frame follows headDir
		expect(new Set(turns.map(t => t.headDir))).toEqual(new Set([0, 1, 2]));
		expect(new Set(turns.map(t => t.direction)).size).toBeGreaterThan(2);
		expect(nameOf(names, recordsOf(names, legacy[3], 'body')[0])).not.toBe(nameOf(names, recordsOf(names, legacy[0], 'body')[0]));
	});
});

// ------------------------------------------------------------------------------------------------
// R-SPR-031 sprite attachments
// ------------------------------------------------------------------------------------------------
describe('R-SPR-031: sprite attachments', () => {
	const STATUS = {
		frames: 70,
		script: at({
			2: e => (e.bodyState = BodyState.FREEZE), // ice block (paused, fixed frame 0)
			10: e => (e.bodyState = 0), // ice break: frame 1, one-shot, removed at its last frame
			20: e => (e.bodyState = BodyState.STUN), // head, repeating
			28: e => (e.bodyState = BodyState.SLEEP), // stun removed, sleep added
			34: e => (e.healthState = HealthState.CURSE), // head, direction-aware, opacity 0.5
			38: e => (e.direction = 3),
			42: () => (mocks.camera.direction = 2),
			48: e => (e.bodyState = 0),
			52: e => (e.healthState = 0),
			56: e => (e.healthState = HealthState.CURSE),
			60: e => e.remove(Entity.VT.OUTOFSIGHT) // the fade applies to attachments too
		})
	};

	it('status attachments (freeze, ice break, stun, sleep, curse) match field by field and are removed alike', () => {
		const { legacy, mismatches, names, attachments } = diff(STATUS);
		expect(mismatches).toEqual([]);
		for (const { legacy: l, modern: m } of attachments.filter(Boolean)) {
			expect(m).toEqual(l);
		}
		// Non-vacuous: every status sprite really loaded and drew
		const parts = new Set(legacy.flat().map(r => partOf(names, r)));
		for (const part of ['att-freeze', 'att-stun', 'att-sleep', 'att-curse']) {
			expect(parts.has(part)).toBe(true);
		}
		// The ice break (100 ms × 4 frames) is gone a few frames later
		expect(attachments[9].legacy).toEqual(['status-freeze']);
		expect(attachments[18].legacy).toEqual([]);
	});

	it('front attachments: zIndex 500, white × opacity, no depth write; head ones lifted 100 px', () => {
		const { legacy, names } = diff(STATUS);
		const stun = recordsOf(names, legacy[24], 'att-stun')[0];
		expect([stun.zIndex, stun.depthWrite, stun.blend]).toEqual([500, false, 'normal']);
		expect(Array.from(stun.offset)).toEqual([-3, -12 - 100]);
		const curse = recordsOf(names, legacy[36], 'att-curse')[0];
		expect(curse.color[3]).toBeCloseTo(0.5, 6);
		// Direction-aware: the ACT action follows the visual direction (entity 3, then camera 2 → 5)
		const action = frame => Math.floor(Number(nameOf(names, recordsOf(names, legacy[frame], 'att-curse')[0]).split('#')[1]) / 2);
		expect([action(36), action(40), action(44)]).toEqual([0, 3, 5]);
		// Drawn after the whole entity, at the lifted body position
		const last = legacy[36].at(-1);
		expect(partOf(names, last)).toBe('att-curse');
		const body = recordsOf(names, legacy[36], 'body')[0];
		expect(Array.from(last.position)).toEqual(Array.from(body.position));
	});

	const CUSTOM = {
		frames: 40,
		script: at({
			// Behind-entity aura: zIndex 1, raw position, ground shadow ignored; limited by duration
			2: e => e.attachments.add({ uid: 'aura', file: 'test-aura', renderBefore: true, repeat: true, opacity: 0.7, duration: 600 }),
			// One-shot burst removed at its last frame; a stopAtEnd one holds it
			4: e => e.attachments.add({ uid: 'burst', file: 'test-burst', frame: 2 }),
			5: e => e.attachments.add({ uid: 'hold', file: 'test-burst', frame: 3, stopAtEnd: true, xOffset: 6, yOffset: -9, head: true }),
			// Explicit delay, depth bias and ignoreShadow; stackable copies
			8: e => e.attachments.add({ uid: 'fx', file: 'test-burst', repeat: true, delay: 60, depth: 3.5, ignoreShadow: true, stackable: true }),
			9: e => e.attachments.add({ uid: 'fx', file: 'test-burst', repeat: true, frame: 6, stackable: true }),
			// A missing sprite never joins the list; a uid replace still removes the old one
			12: e => e.attachments.add({ uid: 'burst', file: 'missing-sprite' }),
			14: e => e.attachments.add({ uid: 'pop', file: 'test-burst', frame: 1 }),
			20: e => e.attachments.remove('fx'),
			24: e => e.attachments.add({ uid: 'aura2', completeFile: 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/test-aura', renderBefore: true, repeat: true })
		})
	};

	it('scene attachments (behind, one-shot, stopAtEnd, offsets, delay, depth, stackable, replace) match', () => {
		const { legacy, mismatches, names, attachments } = diff(CUSTOM);
		expect(mismatches).toEqual([]);
		for (const { legacy: l, modern: m } of attachments.filter(Boolean)) {
			expect(m).toEqual(l);
		}
		expect(attachments[6].legacy).toEqual(['aura', 'burst', 'hold']);
		expect(attachments[13].legacy).toEqual(['aura', 'hold', 'fx', 'fx']); // burst replaced by a missing sprite
		expect(attachments[19].legacy).toEqual(['hold', 'fx', 'fx', 'pop']); // aura's 600 ms elapsed
		expect(attachments[22].legacy).toEqual(['hold', 'pop']);
		expect(attachments[30].legacy).toEqual(['hold', 'aura2']); // pop (5 × 100 ms) done, hold stops at its end
		const aura = recordsOf(names, legacy[4], 'att-aura');
		expect(aura.map(r => r.zIndex)).toEqual([1, 2]);
		expect(aura[0].color[3]).toBeCloseTo(0.7, 6);
		expect(aura[0].shadowFactor).toBe(1);
		const hold = recordsOf(names, legacy[16], 'att-burst').find(r => r.offset[0] === 6 + 4);
		expect(Array.from(hold.offset)).toEqual([6 + 4, -9 - 4]); // offsets win over the head lift
		const fx = recordsOf(names, legacy[10], 'att-burst').find(r => r.depthBias === 3.5);
		expect(fx).toBeDefined();
	});

	it('legacy quirk kept: a behind attachment leaves the shadow factor at 1 for the whole body', () => {
		const { legacy, names } = diff(CUSTOM);
		const body = recordsOf(names, legacy[4], 'body')[0];
		const shadow = recordsOf(names, legacy[4], 'shadow')[0];
		expect(shadow.shadowFactor).not.toBe(1);
		expect(body.shadowFactor).toBe(1);
		const plain = recordsOf(names, legacy[1], 'body')[0];
		expect(plain.shadowFactor).toBe(shadow.shadowFactor);
	});

	it('a mob with a behind attachment and a death fade matches', () => {
		const { mismatches, legacy, names } = diff({
			unit: MOB_UNIT,
			owner: 'mob',
			frames: 30,
			script: at({
				1: e => e.attachments.add({ uid: 'aura', file: 'test-aura', renderBefore: true, repeat: true }),
				3: e => e.attachments.add({ uid: 'stun', file: 'status-stun', head: true, repeat: true, frame: 0 }),
				10: e => e.remove(Entity.VT.DEAD)
			})
		});
		expect(mismatches).toEqual([]);
		expect(recordsOf(names, legacy[20], 'att-aura').length).toBeGreaterThan(0);
	});
});
