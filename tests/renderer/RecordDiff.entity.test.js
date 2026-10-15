/**
 * Phase 2 exit gate of the WebGPU rebuild: record-diff of the entity composer against legacy
 * (analysis/webgpu/REIMAGINED_ARCHITECTURE.md §5 phase 2).
 *
 * Runs the scripted legacy PC scene of support/legacyPcScene.js (idle front, one-shot attack →
 * idle, idle back; 40 frames) and collects the native SpriteRenderer records legacy draws each
 * frame (SpriteRenderer.addRecordSink). Just before each legacy frame it snapshots the legacy
 * entity's state (support/legacyEntitySnapshot.js), runs render-records' EntityRender.renderRecords
 * mixin on that snapshot with the same frame context (tick, camera, ground shadow, cell height,
 * Session.Playing), and diffs both streams field by field (float tolerance 1e-5).
 *
 * Declared divergence -- exactly one, discrepancy #13 [FLAG, fixed] (spec §5 "Discrepancies"):
 * legacy starts the animation clock at epoch 0 after an `objecttype` spawn (Entity.js:281-284,
 * EntityAction.js:64-66, read at EntityRender.js:774), render-records starts it at spawn. The gate
 * therefore runs legacy with its clock pinned to spawn time (the fixed behaviour) and must be
 * identical on every field of every frame; a second test runs legacy unpinned and proves the
 * only difference is the epoch-phased `texture` of repeating idle layers before the first setAction.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// Shared seams; loaded before any legacy module (the canvas patch must precede Entity's import).
const { mocks } = await vi.hoisted(() => import('./support/legacySceneMocks.js'));

// Assets, camera, ground, session: the unavoidable Node seams.
vi.mock('Core/Client.js', () => ({ default: mocks.client }));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Renderer/Map/Ground.js', () => ({ default: { getShadowFactor: () => 1 } }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: { getCellHeight: () => 0 } }));
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

// DB lookups: paths name the synthetic assets; every other query answers "no".
vi.mock('DB/DBManager.js', () => ({ default: mocks.db }));

// Input, network and DOM widgets pulled in by Controls/EntityControl.js and the overlays.
vi.mock('Controls/KeyEventHandler.js', () => ({ default: {} }));
vi.mock('Controls/MouseEventHandler.js', () => ({ default: { screen: { x: 0, y: 0 } } }));
vi.mock('Utils/PathFinding.js', () => ({ default: mocks.inert() }));
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

import {
	BLEND_ADDITIVE,
	EntityRender,
	RecordStream
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { IDLE_FRAMES, TOTAL_FRAMES, cleanupScene, runScene } from './support/legacyPcScene.js';
import { snapshotLegacyEntity } from './support/legacyEntitySnapshot.js';

const EPSILON = 1e-5;
const VECTOR_FIELDS = ['position', 'offset', 'size', 'color'];
const NUMBER_FIELDS = ['xSize', 'ySize', 'angle', 'shadowFactor', 'zIndex', 'depthBias'];
const EXACT_FIELDS = ['kind', 'textureClass', 'depthTest', 'depthWrite', 'depthCorrection', 'ignoreDepthMinCap'];
const IDENTITY_FIELDS = ['texture', 'palette'];

/** Native records name the blend 'normal' / 'additive' (SpriteRenderer.js:91). */
const blendName = blend => (blend === BLEND_ADDITIVE ? 'additive' : 'normal');

/**
 * Field-by-field diff of one frame. Returns mismatches as {frame, index, field, legacy, modern};
 * a different record count is reported once as field 'count'.
 */
function diffFrame(frame, legacy, modern) {
	const out = [];
	const push = (index, field, l, m) => out.push({ frame, index, field, legacy: l, modern: m });
	if (legacy.length !== modern.length) {
		push(-1, 'count', legacy.length, modern.length);
	}
	for (let i = 0; i < Math.min(legacy.length, modern.length); ++i) {
		const l = legacy[i];
		const m = modern[i];
		for (const field of EXACT_FIELDS) {
			if (l[field] !== m[field]) {
				push(i, field, l[field], m[field]);
			}
		}
		for (const field of IDENTITY_FIELDS) {
			if (l[field] !== m[field]) {
				push(i, field, l[field], m[field]);
			}
		}
		for (const field of NUMBER_FIELDS) {
			if (!(Math.abs(l[field] - m[field]) <= EPSILON)) {
				push(i, field, l[field], m[field]);
			}
		}
		for (const field of VECTOR_FIELDS) {
			const lv = Array.from(l[field]);
			const mv = Array.from(m[field]);
			if (lv.length !== mv.length || lv.some((v, k) => !(Math.abs(v - mv[k]) <= EPSILON))) {
				push(i, field, lv, mv);
			}
		}
		if (l.blend !== blendName(m.blend)) {
			push(i, 'blend', l.blend, blendName(m.blend));
		}
	}
	return out;
}

/**
 * Run the legacy scene and, per frame, the render-records composer on a snapshot of the legacy
 * entity taken just before legacy renders it.
 * @param {{pinAnimationClock: boolean}} opts pin legacy's spawn clock (discrepancy #13 fix)
 */
function runDiff({ pinAnimationClock }) {
	const legacy = [];
	const modern = [];
	const heights = [];
	let spawnTick = 0;
	let snapshot = null;
	const { names } = runScene(0x5eed, {
		onSpawn: entity => {
			spawnTick = Date.now();
			if (pinAnimationClock) {
				entity.animation.tick = spawnTick;
			}
		},
		onNativeRecord: record => legacy[legacy.length - 1].push(record),
		beforeFrame: (_frame, entity) => {
			legacy.push([]);
			snapshot = snapshotLegacyEntity(entity, {
				loadFile: mocks.client.loadFile,
				isSuperNovice: mocks.db.isSuperNovice,
				spawnTick
			});
			EntityRender.call(snapshot);
			const stream = new RecordStream();
			stream.beginFrame();
			snapshot.renderRecords(stream, {
				tick: Date.now(),
				camera: { direction: mocks.camera.direction },
				// The same ground seams legacy reads (Ground.getShadowFactor, Altitude.getCellHeight mocks)
				shadowFactorAt: () => 1,
				cellHeightAt: () => 0,
				playing: mocks.session.Playing,
				prefs: mocks.graphics
			});
			modern.push(stream.records);
		},
		afterFrame: (_frame, entity) => {
			heights.push({
				legacy: [entity.bodyHeight, entity.robeHeight],
				modern: [snapshot.bodyHeight, snapshot.robeHeight]
			});
		}
	});
	const mismatches = legacy.flatMap((records, frame) => diffFrame(frame, records, modern[frame]));
	return { legacy, modern, heights, mismatches, names };
}

afterEach(cleanupScene);

afterAll(() => {
	mocks.restoreCanvas();
});

describe('record-diff: render-records entity composer vs legacy (phase 2 exit gate)', () => {
	it('reproduces every legacy record field by field on all 40 frames (legacy clock pinned to spawn, #13)', () => {
		const { legacy, modern, mismatches } = runDiff({ pinAnimationClock: true });
		expect(legacy).toHaveLength(TOTAL_FRAMES);
		expect(modern).toHaveLength(TOTAL_FRAMES);
		for (const records of legacy) {
			expect(records.length).toBeGreaterThan(1);
		}
		expect(mismatches).toEqual([]);
	});

	it('keeps the measured body/robe heights legacy feeds into R-SPR-009', () => {
		const { heights } = runDiff({ pinAnimationClock: true });
		for (const { legacy, modern } of heights) {
			expect(modern).toEqual(legacy);
		}
		expect(heights[0].legacy[0]).toBe(128);
	});

	it('discrepancy #13 [FLAG] is the only divergence from the unpinned legacy clock', () => {
		const { mismatches, names } = runDiff({ pinAnimationClock: false });
		// Non-vacuous: the epoch-phased idle weapon really differs from the spawn-keyed one.
		expect(mismatches.length).toBeGreaterThan(0);
		for (const m of mismatches) {
			// Before the first setAction only (frames 0-9), and only the frame texture of a repeating
			// idle layer; body/robe (headDir) and head/hats (3 groups) are pinned (EntityRender.js:950-970).
			expect(m.frame).toBeLessThan(IDLE_FRAMES);
			expect(m.field).toBe('texture');
			expect(names.get(m.legacy)).toMatch(/^weapon#/);
			expect(names.get(m.modern)).toMatch(/^weapon#/);
		}
	});
});
