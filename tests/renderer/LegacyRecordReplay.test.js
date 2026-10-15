/**
 * Phase 1 exit gate of the WebGPU rebuild: "legacy scenes replay deterministically"
 * (analysis/webgpu/REIMAGINED_ARCHITECTURE.md §5 phase 1).
 *
 * Drives the real legacy entity render path -- Renderer/Entity/Entity.js (all mixins),
 * Renderer/Entity/EntityRender.js, Renderer/SpriteRenderer.js and Renderer/EntityManager.js --
 * through a scripted PC scene, with the harness LegacyRecordShim recording every sprite draw.
 *
 * Only the GL draw is removed: SpriteRenderer runs its real bind3DContext / RenderCanvas3D /
 * runWithDepth against a no-op WebGL context, so the "skip on no texture / alpha 0" early return
 * and the zIndex post-increment are legacy's own code. Assets are synthetic compiled SPR/ACT
 * objects served from an in-memory Client.loadFile.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installLegacyRecordShim } from '../../modernized/webgpu-reimagined/test-harness/src/legacy/LegacyRecordShim.js';
import { Recorder } from '../../modernized/webgpu-reimagined/test-harness/src/records/Recorder.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	FakeClock,
	FAKE_EPOCH_MS
} from '../../modernized/webgpu-reimagined/test-harness/src/determinism/FakeClock.js';

const mocks = vi.hoisted(() => {
	// In-memory archive: path -> compiled asset. Rebuilt per scene run (see buildAssets).
	const files = new Map();
	const nop = () => {};
	// Anything a module asks for that the scene does not exercise answers as a no-op.
	const inert = (base = {}) =>
		new Proxy(base, {
			get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k !== 'then' ? nop : undefined)
		});
	// jsdom has no 2D canvas; overlay mixins (EntityDisplay, EntityLife, ...) draw text into one
	// at import / construction time. They are DOM widgets, not part of the sprite stream.
	const ctx2d = canvas =>
		inert({
			canvas,
			measureText: () => ({ width: 100 }),
			getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
			createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
		});
	const originalGetContext = globalThis.HTMLCanvasElement.prototype.getContext;
	globalThis.HTMLCanvasElement.prototype.getContext = function getContext() {
		this._ctx ??= ctx2d(this);
		return this._ctx;
	};
	return {
		files,
		inert,
		originalGetContext,
		client: {
			// Legacy Client.loadFile answers synchronously from Memory once a file is cached.
			loadFile: (path, onLoad, onError) => {
				const data = files.get(path);
				if (data) {
					if (onLoad) {
						onLoad(data);
					}
					return data;
				}
				if (onError) {
					onError();
				}
				return undefined;
			}
		},
		camera: { direction: 0, zoom: 1, getLatitude: () => -45 },
		session: { AdminList: [], Playing: false, Entity: null },
		graphics: { performanceMode: false, viewArea: 10, pixelPerfectSprites: false }
	};
});

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
vi.mock('DB/DBManager.js', () => ({
	default: mocks.inert({
		isPlayer: job => job >= 0 && job < 4000,
		isBaby: () => false,
		isMonster: () => false,
		isSuperNovice: () => false,
		isDoram: () => false,
		getBodyPath: () => 'data/sprite/body',
		getHeadPath: () => 'data/sprite/head',
		getWeaponPath: () => 'data/sprite/weapon',
		getShieldPath: () => 'data/sprite/shield',
		getHatPath: id => `data/sprite/hat${id}`,
		getRobePath: () => 'data/sprite/robe',
		getCartPath: () => 'data/sprite/cart',
		getWeaponTrail: () => null,
		getWeaponSound: () => null,
		getBodyPalPath: () => null,
		getHeadPalPath: () => null,
		hasMountPalettes: () => false,
		getWeaponAction: () => 0,
		getAttackSlice: () => null
	})
}));

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

import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import EntityManager from 'Renderer/EntityManager.js';
import Entity from 'Renderer/Entity/Entity.js';


// ---------------------------------------------------------------------------------------------
// Synthetic compiled assets
// ---------------------------------------------------------------------------------------------

const PC_ACTIONS = 13; // EntityAction.js:160-172 (PC: IDLE 0 ... SKILL 12)
const DIRECTIONS = 8;
const ATTACK_FRAMES = 4;
const ATTACK_DELAY = 100; // ms, the ACT delay legacy stores (Loaders/Action.js:60, ×25 ticks)

/**
 * Compiled SPR as Loaders/Sprite.js compile() returns it (Sprite.js:420-436) after
 * Core/Client.js:313-351 attached GL textures: `frames[i].texture` and, for indexed sprites,
 * the palette texture on `spr.texture`. Texture handles are plain objects named in `names`.
 */
function makeSpr(part, { indexed, frames: count, width, height }, names) {
	const potW = 2 ** Math.ceil(Math.log2(width));
	const potH = 2 ** Math.ceil(Math.log2(height));
	const frames = [];
	for (let i = 0; i < count; ++i) {
		const texture = { gl: 'texture' };
		names.set(texture, `${part}#${i}`);
		frames.push({
			type: indexed ? 0 : 1,
			width: potW,
			height: potH,
			originalWidth: width,
			originalHeight: height,
			data: new Uint8Array(potW * potH * (indexed ? 1 : 4)),
			texture
		});
	}
	const spr = {
		frames,
		palette: new Uint8Array(256 * 4),
		rgba_index: indexed ? count : 0,
		old_rgba_index: indexed ? count : 0
	};
	if (indexed) {
		spr.texture = { gl: 'palette' };
		names.set(spr.texture, `${part}:pal`);
	}
	return spr;
}

const layer = (index, pos, extra = {}) => ({
	pos,
	index,
	is_mirror: 0,
	scale: [1, 1],
	color: [1, 1, 1, 1],
	angle: 0,
	spr_type: 0,
	width: 0,
	height: 0,
	...extra
});

/**
 * Compiled ACT as Loaders/Action.js returns it (Action.js:77-82, 112-172): 13 PC actions × 8
 * directions; each animation has `layers`, `sound` and the `pos` anchor list. `layersOf(action,
 * dir, frame)` returns that frame's layers, `anchorOf` its anchor.
 */
function makeAct({ idleFrames, layersOf, anchorOf }) {
	const actions = [];
	for (let a = 0; a < PC_ACTIONS; ++a) {
		for (let d = 0; d < DIRECTIONS; ++d) {
			const count = a === 0 ? idleFrames : ATTACK_FRAMES;
			const animations = [];
			for (let f = 0; f < count; ++f) {
				animations.push({ layers: layersOf(a, d, f), sound: -1, pos: [anchorOf(a, d, f)] });
			}
			actions.push({ animations, delay: ATTACK_DELAY });
		}
	}
	return { actions, sounds: [] };
}

/** A PC with body, head, three headgears, weapon, shield, robe and its shadow. */
function buildAssets() {
	const names = new Map();
	const files = new Map();
	const add = (path, spr, act) => {
		files.set(`${path}.spr`, spr);
		files.set(`${path}.act`, act);
	};
	const simple = (part, path, frames, layersOf, anchorOf = () => ({ x: 0, y: 0 }), indexed = false) =>
		add(
			path,
			makeSpr(part, { indexed, frames, width: 24, height: 24 }, names),
			makeAct({ idleFrames: 3, layersOf, anchorOf })
		);

	// Body: indexed (own palette), two drawn layers per frame plus an empty one (index -1, skipped
	// by renderLayer, EntityRender.js:1068). Its anchor moves during the attack, so the head and
	// headgears follow it (EntityRender.js:786-789, 873-876).
	add(
		'data/sprite/body',
		makeSpr('body', { indexed: true, frames: 2 * ATTACK_FRAMES, width: 40, height: 80 }, names),
		makeAct({
			idleFrames: 3,
			layersOf: (a, d, f) => [layer(2 * f, [0, -40]), layer(-1, [0, 0]), layer(2 * f + 1, [d, -20])],
			anchorOf: (a, d, f) => ({ x: a === 0 ? 0 : 2 * f, y: -70 })
		})
	);
	// Head: indexed, one layer; idle head frames split in 3 head-direction groups (EntityRender.js:963-970)
	simple(
		'head',
		'data/sprite/head',
		ATTACK_FRAMES,
		(a, d, f) => [layer(f, [0, -70])],
		() => ({ x: 0, y: -5 }),
		true
	);
	simple('hat5', 'data/sprite/hat5', 1, () => [layer(0, [0, -80])]); // lower headgear (accessory)
	simple('hat6', 'data/sprite/hat6', 1, () => [layer(0, [0, -90])]); // top headgear (accessory2)
	simple('hat7', 'data/sprite/hat7', 1, () => [layer(0, [0, -75])]); // mid headgear (accessory3)
	// Weapon: second layer has alpha 0, which RenderCanvas3D skips without bumping zIndex
	// (SpriteRenderer.js:26-28) and the shim must not record (R-SPR-017).
	simple('weapon', 'data/sprite/weapon', ATTACK_FRAMES, (a, d, f) => [
		layer(f, [10, -30], { spr_type: 1 }),
		layer(0, [10, -30], { color: [1, 1, 1, 0] })
	]);
	simple('shield', 'data/sprite/shield', 1, () => [layer(0, [-10, -30], { is_mirror: 1 })]);
	simple('robe', 'data/sprite/robe', 1, () => [layer(0, [0, -30])]);
	simple('shadow', 'data/sprite/shadow', 1, () => [layer(0, [0, 0], { color: [1, 1, 1, 0.5] })]);

	return { files, names };
}

// ---------------------------------------------------------------------------------------------
// Scripted scene
// ---------------------------------------------------------------------------------------------

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const FOG = { use: false, exist: false, near: 0, far: 1, color: new Float32Array(3) };
const FRAME_MS = 40;
const IDLE_FRAMES = 10;
const ATTACK_SCENE_FRAMES = 20;
const BACK_FRAMES = 10;
const GID = 150001;

/** WebGL context whose every call is a no-op: the only part of SpriteRenderer replaced. */
function noopGL() {
	const consts = new Map();
	return new Proxy(
		{},
		{
			get(_, key) {
				if (typeof key !== 'string') {
					return undefined;
				}
				if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
					if (!consts.has(key)) {
						consts.set(key, consts.size + 1);
					}
					return consts.get(key);
				}
				return key.startsWith('create') ? () => ({ gl: key }) : () => {};
			}
		}
	);
}

let determinism = null;
let shim = null;

/**
 * Run the scripted scene and return the recorder plus what the scene consumed.
 * Frames: 0-9 IDLE facing front, 10-29 ATTACK (one-shot, then legacy's `next` IDLE),
 * 30-39 IDLE facing back. Each frame is one EntityManager.render (EntityManager.js:400-454),
 * which binds SpriteRenderer's 3D context and calls entity.render(modelView, projection).
 */
function runScene(seed, { epoch = FAKE_EPOCH_MS } = {}) {
	determinism = installDeterminism({ rng: new SeededRng(seed), clock: new FakeClock({ epoch }) });
	const { clock, rng } = determinism;
	const { files, names } = buildAssets();
	mocks.files.clear();
	for (const [path, data] of files) {
		mocks.files.set(path, data);
	}

	const recorder = new Recorder();
	shim = installLegacyRecordShim(SpriteRenderer, {
		recorder,
		textureId: tex => names.get(tex) ?? 'unknown'
	});
	const gl = noopGL();
	SpriteRenderer.init(gl);

	const entity = new Entity({
		GID,
		objecttype: Entity.TYPE_PC,
		job: 7,
		sex: 1,
		head: 2,
		weapon: 1101,
		shield: 2101,
		accessory: 5,
		accessory2: 6,
		accessory3: 7,
		Robe: 1,
		PosDir: [50, 60, 4] // server dir 4 -> entity.direction 0 (Entity.js:297)
	});
	EntityManager.add(entity);

	const total = IDLE_FRAMES + ATTACK_SCENE_FRAMES + BACK_FRAMES;
	for (let frame = 0; frame < total; ++frame) {
		if (frame === IDLE_FRAMES) {
			entity.setAction({
				action: entity.ACTION.ATTACK,
				frame: 0,
				repeat: false,
				play: true,
				next: { action: entity.ACTION.IDLE, frame: 0, repeat: true, play: true }
			});
		}
		if (frame === IDLE_FRAMES + ATTACK_SCENE_FRAMES) {
			entity.direction = 4;
		}
		recorder.beginFrame(clock.now());
		shim.withContext({ owner: { gid: GID, type: 'pc' }, layer: 'entity' }, () => {
			EntityManager.render(gl, IDENTITY, IDENTITY, FOG, false);
		});
		recorder.endFrame();
		clock.advance(FRAME_MS);
	}

	EntityManager.free();
	shim.uninstall();
	shim = null;
	const rngCalls = rng.calls;
	determinism.restore();
	determinism = null;
	return { recorder, rngCalls, entity };
}

const json = recorder => JSON.parse(JSON.stringify(recorder.toJSON()));
const part = record => record.texture.id.replace(/[#:].*$/, '');
const summary = frame => frame.records.map(r => [part(r), r.zIndex]);

afterEach(() => {
	// Never leak the shim or the patched globals into another test, even on failure.
	if (shim) {
		shim.uninstall();
		shim = null;
	}
	if (determinism) {
		determinism.restore();
		determinism = null;
	}
	EntityManager.free();
});

afterAll(() => {
	globalThis.HTMLCanvasElement.prototype.getContext = mocks.originalGetContext;
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
});
