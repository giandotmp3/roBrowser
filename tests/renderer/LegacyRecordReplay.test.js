/**
 * Phase 1 exit gate of the WebGPU rebuild: "legacy scenes replay deterministically"
 * (analysis/webgpu/REIMAGINED_ARCHITECTURE.md §5 phase 1).
 *
 * Drives the real legacy entity render path -- Renderer/Entity/Entity.js (all mixins),
 * Renderer/Entity/EntityRender.js, Renderer/SpriteRenderer.js and Renderer/EntityManager.js --
 * through a scripted PC scene (support/legacyPcScene.js), with the harness LegacyRecordShim
 * recording every sprite draw.
 *
 * Only the GL draw is removed: SpriteRenderer runs its real bind3DContext / RenderCanvas3D /
 * runWithDepth against a no-op WebGL context, so the "skip on no texture / alpha 0" early return
 * and the zIndex post-increment are legacy's own code. Assets are synthetic compiled SPR/ACT
 * objects served from an in-memory Client.loadFile.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
	ATTACK_DELAY,
	ATTACK_SCENE_FRAMES,
	BACK_FRAMES,
	FAKE_EPOCH_MS,
	GID,
	IDLE_FRAMES,
	cleanupScene,
	runScene
} from './support/legacyPcScene.js';

const json = recorder => JSON.parse(JSON.stringify(recorder.toJSON()));
const part = record => record.texture.id.replace(/[#:].*$/, '');
const summary = frame => frame.records.map(r => [part(r), r.zIndex]);

// Never leak the shim or the patched globals into another test, even on failure.
afterEach(cleanupScene);

afterAll(() => {
	mocks.restoreCanvas();
});

describe('legacy entity scene record/replay (phase 1 exit gate)', () => {
	let first;

	beforeAll(() => {
		first = runScene(0x5eed);
	});

	it('records a non-empty, multi-layer stream for every frame', () => {
		const { frames } = first.recorder;
		expect(frames).toHaveLength(IDLE_FRAMES + ATTACK_SCENE_FRAMES + BACK_FRAMES);
		for (const frame of frames) {
			expect(frame.records.length).toBeGreaterThan(1);
			expect(frame.records.every(r => r.kind === 'sprite' && r.owner.gid === GID)).toBe(true);
		}
	});

	it('replays deterministically: same seed, deep-equal record stream', () => {
		const second = runScene(0x5eed);
		expect(json(second.recorder)).toEqual(json(first.recorder));
	});

	it('consumes no renderer randomness on this path, so the seed cannot change the stream', () => {
		// Seed sensitivity is not observable here: nothing on the PC sprite path calls Math.random.
		expect(first.rngCalls).toBe(0);
		const other = runScene(0xbad5eed);
		expect(other.rngCalls).toBe(0);
		expect(json(other.recorder)).toEqual(json(first.recorder));
	});

	it('animates: the attack advances body frames and moves the anchored head', () => {
		const frames = first.recorder.frames;
		const bodyFrames = new Set();
		const headOffsets = new Set();
		for (const frame of frames.slice(IDLE_FRAMES, IDLE_FRAMES + ATTACK_SCENE_FRAMES)) {
			for (const r of frame.records) {
				if (part(r) === 'body') {
					bodyFrames.add(r.texture.id);
				}
				if (part(r) === 'head') {
					headOffsets.add(r.offset.join(','));
				}
			}
		}
		expect(bodyFrames.size).toBeGreaterThan(2);
		expect(headOffsets.size).toBeGreaterThan(1);
	});

	it('phases idle non-head layers from the epoch until the first setAction', () => {
		// Entity.js:281-284: set() re-runs EntityAction Init for the `objecttype` key, which
		// replaces `animation` with a fresh Animation whose tick is 0 (EntityAction.js:64-66, 153),
		// discarding the tick setAction just stored (Entity.js:228, EntityAction.js:134). Until the
		// next setAction, calcAnimation's `Date.now() - animation.tick` (EntityRender.js:774) is the
		// absolute epoch time, so the repeating idle weapon cycles in phase with the wall clock.
		// The body/robe (headDir, EntityRender.js:950-959) and head (3 groups, :963-970) are pinned.
		const idle = first.recorder.frames.slice(0, IDLE_FRAMES);
		const weapon = idle.map(f => f.records.find(r => part(r) === 'weapon').texture.id);
		const fromEpoch = idle.map(f => `weapon#${Math.floor((FAKE_EPOCH_MS + f.tick) / ATTACK_DELAY) % 3}`);
		expect(weapon).toEqual(fromEpoch);
		expect(weapon[0]).not.toBe('weapon#0');
		// So replay needs the clock's epoch pinned, not only scene-relative time.
		const shifted = runScene(0x5eed, { epoch: FAKE_EPOCH_MS + ATTACK_DELAY });
		expect(json(shifted.recorder)).not.toEqual(json(first.recorder));
	});

	it('front-facing PC: draw order and zIndex follow legacy (R-SPR-007, R-SPR-006, R-SPR-011)', () => {
		const frame = first.recorder.frames[0];
		// EntityRender.js:330-342 shadow at -1; 426-430 front robe at robeCorrection(true) = 1
		// (379-402, no robe/body heights yet); 433-443 body 150; 454-457 head bodyZ+50 = 300;
		// 463-484 mid 350, top 450, lower 550; 506-510 weapon 500; 513-516 shield 550.
		// Every drawn layer post-increments zIndex (SpriteRenderer.js:72), so the body's second
		// layer is 151. The weapon's alpha-0 layer is skipped before the increment (:26-28).
		expect(summary(frame)).toEqual([
			['shadow', -1],
			['robe', 1],
			['body', 150],
			['body', 151],
			['head', 300],
			['hat7', 350],
			['hat6', 450],
			['hat5', 550],
			['weapon', 500],
			['shield', 550]
		]);
		const byPart = Object.fromEntries(frame.records.map(r => [part(r), r]));
		// Shadow: depth test on, write off, correction on (EntityRender.js:339); ignores
		// effectColor but keeps the layer alpha (EntityRender.js:1130-1134).
		expect(byPart.shadow.depth).toMatchObject({ test: true, write: false, correction: true });
		expect(byPart.shadow.color).toEqual([1, 1, 1, 0.5]);
		expect(byPart.shadow.position).toEqual([50, 60, 0.05000000074505806]);
		// PC layers write depth (EntityRender.js:366) and sit 0.2 above the cell (R-SPR-004, :360).
		for (const name of ['robe', 'body', 'head', 'hat5', 'weapon', 'shield']) {
			expect(byPart[name].depth).toMatchObject({ test: true, write: true, correction: true });
			expect(byPart[name].position[2]).toBeCloseTo(0.2, 6);
		}
		// Indexed body/head carry their palette texture; RGBA generics do not (EntityRender.js:1072-1083).
		expect(byPart.body.texture).toEqual({ id: 'body#1', indexed: true, filter: 'nearest' });
		expect(byPart.body.palette).toBe('body:pal');
		expect(byPart.weapon.palette).toBeNull();
		// Mirrored layer -> negative width (EntityRender.js:1120-1122).
		expect(byPart.shield.size[0]).toBeLessThan(0);
	});

	it('back-facing PC: shield first at -1 without depth write, robe after hats at bodyZ+400', () => {
		const frame = first.recorder.frames[IDLE_FRAMES + ATTACK_SCENE_FRAMES];
		// EntityRender.js:405-410 behind (dir 2-5): shield at -1 in runWithDepth(true, false, false);
		// 412 no front robe; 486-493 back robe at bodyZ + robeCorrection(false) = 250 + 400.
		expect(summary(frame)).toEqual([
			['shadow', -1],
			['shield', -1],
			['body', 150],
			['body', 151],
			['head', 300],
			['hat7', 350],
			['hat6', 450],
			['hat5', 550],
			['robe', 650],
			['weapon', 500]
		]);
		const shield = frame.records.find(r => part(r) === 'shield');
		expect(shield.depth).toMatchObject({ test: true, write: false });
	});
	it('native SpriteRenderer records match the harness shim record-for-record (phase 2 seam)', () => {
		const native = [];
		const { recorder } = runScene(0x5eed, { onNativeRecord: r => native.push(r) });
		const shimmed = recorder.frames.flatMap(f => f.records);
		expect(native).toHaveLength(shimmed.length);
		native.forEach((n, i) => {
			const r = shimmed[i];
			expect(n.texture).not.toBeNull();
			expect([n.zIndex, n.depthTest, n.depthWrite, n.depthCorrection, n.ignoreDepthMinCap]).toEqual([
				r.zIndex,
				r.depth.test,
				r.depth.write,
				r.depth.correction,
				r.depth.ignoreMinCap
			]);
			expect([n.xSize, n.ySize, n.angle, n.depthBias, n.shadowFactor]).toEqual([
				r.xSize,
				r.ySize,
				r.angle,
				r.depthBias,
				r.shadow
			]);
			expect(Array.from(n.position)).toEqual(Array.from(r.position));
			expect(Array.from(n.size)).toEqual(Array.from(r.size));
			expect(Array.from(n.offset)).toEqual(Array.from(r.offset));
			expect(Array.from(n.color)).toEqual(Array.from(r.color));
			expect(n.textureClass).toBe(r.texture.indexed ? 'indexed' : 'rgba');
		});
	});
});
