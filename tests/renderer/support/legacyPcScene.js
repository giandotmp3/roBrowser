/**
 * The scripted legacy PC scene shared by the phase 1 replay gate (LegacyRecordReplay.test.js) and
 * the phase 2 record-diff gate (RecordDiff.entity.test.js).
 *
 * Drives the real legacy entity render path -- Renderer/Entity/Entity.js (all mixins),
 * Renderer/Entity/EntityRender.js, Renderer/SpriteRenderer.js and Renderer/EntityManager.js --
 * with the harness LegacyRecordShim recording every sprite draw. Only the GL draw is removed:
 * SpriteRenderer runs its real bind3DContext / RenderCanvas3D / runWithDepth against a no-op WebGL
 * context. Assets are synthetic compiled SPR/ACT objects served from an in-memory Client.loadFile.
 *
 * Import only from a test file that has mocked the legacy seams onto `legacySceneMocks.js`.
 */
import { installLegacyRecordShim } from '../../../modernized/webgpu-reimagined/test-harness/src/legacy/LegacyRecordShim.js';
import { Recorder } from '../../../modernized/webgpu-reimagined/test-harness/src/records/Recorder.js';
import { installDeterminism } from '../../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	FakeClock,
	FAKE_EPOCH_MS
} from '../../../modernized/webgpu-reimagined/test-harness/src/determinism/FakeClock.js';

import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import EntityManager from 'Renderer/EntityManager.js';
import Entity from 'Renderer/Entity/Entity.js';

import { mocks } from './legacySceneMocks.js';

export { FAKE_EPOCH_MS };

// ---------------------------------------------------------------------------------------------
// Synthetic compiled assets
// ---------------------------------------------------------------------------------------------

const PC_ACTIONS = 13; // EntityAction.js:160-172 (PC: IDLE 0 ... SKILL 12)
const DIRECTIONS = 8;
export const ATTACK_FRAMES = 4;
export const ATTACK_DELAY = 100; // ms, the ACT delay legacy stores (Loaders/Action.js:60, ×25 ticks)

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
export function buildAssets() {
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
	// (SpriteRenderer.js:179) and the shim must not record (R-SPR-017).
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
export const FRAME_MS = 40;
export const IDLE_FRAMES = 10;
export const ATTACK_SCENE_FRAMES = 20;
export const BACK_FRAMES = 10;
export const TOTAL_FRAMES = IDLE_FRAMES + ATTACK_SCENE_FRAMES + BACK_FRAMES;
export const GID = 150001;

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
 *
 * @param {number} seed
 * @param {object} [opts]
 * @param {number} [opts.epoch] FakeClock epoch (legacy idle phase depends on it, discrepancy #13)
 * @param {function} [opts.onNativeRecord] SpriteRenderer.addRecordSink observer
 * @param {function} [opts.beforeFrame] (frameIndex, entity, clock) just before EntityManager.render
 * @param {function} [opts.afterFrame] (frameIndex, entity, clock) just after it
 * @param {function} [opts.onSpawn] (entity, clock) right after the entity is built and added
 */
export function runScene(seed, { epoch = FAKE_EPOCH_MS, onNativeRecord = null, beforeFrame, afterFrame, onSpawn } = {}) {
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
	const stopNative = onNativeRecord ? SpriteRenderer.addRecordSink(onNativeRecord) : null;

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
	if (onSpawn) {
		onSpawn(entity, clock);
	}

	for (let frame = 0; frame < TOTAL_FRAMES; ++frame) {
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
		if (beforeFrame) {
			beforeFrame(frame, entity, clock);
		}
		recorder.beginFrame(clock.now());
		shim.withContext({ owner: { gid: GID, type: 'pc' }, layer: 'entity' }, () => {
			EntityManager.render(gl, IDENTITY, IDENTITY, FOG, false);
		});
		recorder.endFrame();
		if (afterFrame) {
			afterFrame(frame, entity, clock);
		}
		clock.advance(FRAME_MS);
	}

	EntityManager.free();
	if (stopNative) {
		stopNative();
	}
	shim.uninstall();
	shim = null;
	const rngCalls = rng.calls;
	determinism.restore();
	determinism = null;
	return { recorder, rngCalls, entity, names };
}

/** Never leak the shim or the patched globals into another test, even on failure. */
export function cleanupScene() {
	if (shim) {
		shim.uninstall();
		shim = null;
	}
	if (determinism) {
		determinism.restore();
		determinism = null;
	}
	EntityManager.free();
}
