/**
 * Scripted legacy damage-number scene for the record-diff gate (RecordDiff.damage.test.js).
 *
 * Drives the real legacy Renderer/Effects/Damage.js (init → add → render) and the real
 * Renderer/SpriteRenderer.js the way Renderer/MapRenderer.js does: Damage.init(gl) at map load
 * (MapRenderer.js:576), then per frame the entity pass followed by Damage.render(gl, modelView,
 * projection, fog, tick) (MapRenderer.js:345-358). The entity pass is reduced to one "probe"
 * sprite that, like EntityRender, never sets SpriteRenderer.depth -- so it shows the depth the
 * previous damage pass leaked (R-DMG-009).
 *
 * Seams (all synthetic, no binary assets):
 * - Client.getFiles serves descriptors; mocked Loaders/Sprite + Loaders/Action turn them into
 *   frame canvases (sizes from the metric functions below) and an ACT layer scale per skin.
 * - Canvas 2D contexts record drawImage calls; the GL mock records which canvas each texture was
 *   uploaded from. `describeTexture(tex)` therefore names a legacy damage texture by its glyphs:
 *   `damage/<num|msg|msgBlue>/<skin>/<text or msg frame name>`, plus its canvas size and glyph
 *   placements. This is the glyph-texture identity used to compare legacy canvas textures with
 *   render-records' texture keys.
 *
 * Import from a test file's `vi.hoisted` block (before any legacy module loads): it imports no
 * mocked module statically; legacy modules are imported fresh per run (vi.resetModules).
 */
import { vi } from 'vitest';
import { installDeterminism } from '../../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { FakeClock } from '../../../modernized/webgpu-reimagined/test-harness/src/determinism/FakeClock.js';

// ---------------------------------------------------------------------------------------------
// Synthetic damage skins
// ---------------------------------------------------------------------------------------------

/** Legacy `_msgNames` (Damage.js:68-75): msg.spr / bluemsg.spr frame order. */
export const MSG_NAMES = ['miss', 'guard', 'crit', 'critbg', 'luckybg', 'lucky'];
const SUFFIX = { 10: 'K', 11: 'M' };

/** Number-sheet frame size: digits differ in width and height so layout and centring matter. */
export const numberFrame = (skin, i) => ({ width: 7 + ((i * 3 + skin) % 5), height: 11 + 2 * skin + (i % 2) });
/** msg.spr / bluemsg.spr frame size (not powers of two, so the POT padding matters). */
export const msgFrame = (sheet, skin, i) =>
	sheet === 'msgBlue'
		? { width: 31 + 5 * i + skin, height: 14 + i }
		: { width: 29 + 7 * i + skin, height: 12 + i + skin };
/** Layer 0 scale of each skin's number ACT (Damage.js:170-180). */
export const SKIN_SCALE = { 0: [1.1, 0.9], 1: [1.5, 1.25], 2: [0.75, 0.75], 3: [2, 2] };
const SKIN_BY_BASE = { '\xbc\xfd\xc0\xda': 0, NewNumber: 1, Han: 2, NewNumberH: 3 };

/** Damage-skin metrics as an atlas would read them from the same SPR/ACT (composer input). */
export function skinMetrics(skin, numberCount) {
	const sheet = name => Object.fromEntries(MSG_NAMES.map((n, i) => [n, msgFrame(name, skin, i)]));
	return {
		numbers: Array.from({ length: numberCount }, (_, i) => numberFrame(skin, i)),
		msg: sheet('msg'),
		msgBlue: sheet('msgBlue'),
		scale: SKIN_SCALE[skin]
	};
}

function frameCanvas(sheet, skin, index) {
	const { width, height } = sheet === 'num' ? numberFrame(skin, index) : msgFrame(sheet, skin, index);
	const canvas = globalThis.document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	canvas._dmg = { sheet, skin, index };
	return canvas;
}

class MockSprite {
	constructor(desc) {
		this.desc = desc;
	}
	getCanvasFromFrame(index) {
		return frameCanvas(this.desc.sheet, this.desc.skin, index);
	}
}

class MockAction {
	constructor(desc) {
		this.actions = [{ animations: [{ layers: [{ scale: SKIN_SCALE[desc.skin] }] }] }];
	}
}

/** Legacy Entity statics Damage reads (TYPE_PC); targets are instances so `constructor` works. */
class MockEntity {
	static TYPE_PC = 0;
	static TYPE_MOB = 5;
	constructor(gid, objecttype, position) {
		this.GID = gid;
		this.objecttype = objecttype;
		this.position = position;
		this._job = 0;
	}
}

// ---------------------------------------------------------------------------------------------
// Canvas 2D: record drawImage, so uploads can be named by the glyphs drawn into them
// ---------------------------------------------------------------------------------------------

const nop = () => {};
const recordingContext = canvas => {
	const ctx = {
		canvas,
		ops: [],
		drawImage(src, x, y, w, h) {
			ctx.ops.push({ src, x, y, w: w ?? src.width, h: h ?? src.height });
		},
		clearRect() {
			ctx.ops.length = 0;
		}
	};
	return new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : nop) });
};
const originalGetContext = globalThis.HTMLCanvasElement.prototype.getContext;
globalThis.HTMLCanvasElement.prototype.getContext = function getContext() {
	this._ctx ??= recordingContext(this);
	return this._ctx;
};

/**
 * Name the canvas being uploaded by its glyphs and consume its draw log (every legacy upload
 * follows a fresh clearRect / resize and draw, Damage.js:446-468, 188-212).
 */
function describeCanvas(canvas) {
	const ops = canvas._ctx ? canvas._ctx.ops.splice(0) : [];
	const glyphs = ops.map(op => op.src._dmg);
	if (!glyphs.length || glyphs.some(g => !g)) {
		return { key: null, width: canvas.width, height: canvas.height, placements: [] };
	}
	const { sheet, skin } = glyphs[0];
	const name = sheet === 'num' ? glyphs.map(g => SUFFIX[g.index] ?? String(g.index)).join('') : MSG_NAMES[glyphs[0].index];
	return {
		key: `damage/${sheet}/${skin}/${name}`,
		width: canvas.width,
		height: canvas.height,
		placements: ops.map(op => ({ glyph: op.src._dmg.index, x: op.x, y: op.y, w: op.w, h: op.h }))
	};
}

/** WebGL mock: no-op except texture creation / binding / upload, which it tracks. */
function recordingGL(uploads) {
	const consts = new Map();
	let bound = null;
	let next = 1;
	const impl = {
		createTexture: () => ({ damageTexture: next++ }),
		bindTexture: (_target, texture) => {
			bound = texture;
		},
		texImage2D: (...args) => {
			uploads.set(bound, describeCanvas(args[5]));
		}
	};
	return new Proxy(
		{},
		{
			get(_, key) {
				if (typeof key !== 'string') {
					return undefined;
				}
				if (key in impl) {
					return impl[key];
				}
				if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
					if (!consts.has(key)) {
						consts.set(key, consts.size + 1);
					}
					return consts.get(key);
				}
				return key.startsWith('create') ? () => ({ gl: key }) : nop;
			}
		}
	);
}

// ---------------------------------------------------------------------------------------------
// Mocks the test file points its vi.mock calls at
// ---------------------------------------------------------------------------------------------

export const damageMocks = {
	Sprite: MockSprite,
	Action: MockAction,
	Entity: MockEntity,
	config: { enableDmgSuffix: false, enableMipmap: false },
	configs: { get: key => damageMocks.config[key] },
	graphics: { damageSkin: 0, damageMotion: 0 },
	mapPrefs: { miss: true },
	packetver: { value: 20250101, addSupport: nop },
	renderer: { gl: null, tick: 0 },
	camera: { zoom: 1, getLatitude: () => -45, direction: 0 },
	effects: [],
	sounds: [],
	effectManager: { spam: params => damageMocks.effects.push(params) },
	sound: { playPosition: (file, position) => damageMocks.sounds.push({ file, position }) },
	db: {
		getJobHitSound: () => 'job_hit.wav',
		getWeaponHitSound: weapon => `weapon${weapon}_hit.wav`
	},
	client: {
		getFiles(paths, callback) {
			const base = paths[0].replace(/^.*\//, '').replace(/\.spr$/, '');
			const skin = SKIN_BY_BASE[base];
			callback(...['num', 'msg', 'msgBlue', 'act'].map(sheet => ({ sheet, skin })));
		}
	},
	restoreCanvas() {
		globalThis.HTMLCanvasElement.prototype.getContext = originalGetContext;
	}
};

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const FOG = { use: false, exist: false, near: 0, far: 1, color: [0, 0, 0] };
export const PROBE_TEXTURE = { probe: true };
export const PROBE = { position: [3, 4, 0.5], size: [32, 64] };
export const MOB_GID = 120300001;
export const PC_GID = 150001;

/**
 * Run the scene through legacy.
 *
 * @param {object} opts
 * @param {Array<object>} opts.events {frame, target: 'mob'|'pc', amount, type?, delay?, skin?, miss?, weapon?}
 * @param {number} opts.frames
 * @param {number} [opts.frameMs]
 * @param {number} [opts.start] monotonic ms of frame 0 (Renderer.tick)
 * @param {number} [opts.dpr] window.devicePixelRatio when Damage.js loads
 * @param {number} [opts.packetver]
 * @param {boolean} [opts.enableDmgSuffix]
 * @param {(frame: number) => number} [opts.motionAt] GraphicsSettings.damageMotion per frame
 * @param {[number, number, number]} [opts.mobPosition]
 * @param {[number, number, number]} [opts.pcPosition]
 * @param {(add: object) => void} [opts.onAdd] called after each Damage.add with what legacy received
 * @param {(frame: object) => void} [opts.onFrame] called after each frame with its records
 * @returns {Promise<{describeTexture: function, uploads: Map}>}
 */
export async function runDamageScene({
	events,
	frames,
	frameMs = 50,
	start = 10_000,
	dpr = 1,
	packetver = 20250101,
	enableDmgSuffix = false,
	motionAt = () => 0,
	mobPosition = [12.5, 30.25, 1.5],
	pcPosition = [15.5, 28.75, 0.75],
	onAdd = nop,
	onFrame = nop
}) {
	// Fresh legacy module state per run (Damage's _list, prevCombo, loaded skins, dpr).
	vi.resetModules();
	const savedDpr = globalThis.devicePixelRatio;
	globalThis.devicePixelRatio = dpr;
	damageMocks.config.enableDmgSuffix = enableDmgSuffix;
	damageMocks.packetver.value = packetver;
	damageMocks.graphics.damageSkin = 0;
	damageMocks.graphics.damageMotion = 0;
	damageMocks.mapPrefs.miss = true;
	damageMocks.effects.length = 0;
	damageMocks.sounds.length = 0;

	const { default: Damage } = await import('Renderer/Effects/Damage.js');
	const { default: SpriteRenderer } = await import('Renderer/SpriteRenderer.js');
	globalThis.devicePixelRatio = savedDpr;

	const determinism = installDeterminism({ rng: new SeededRng(0xda3a), clock: new FakeClock({ now: start }) });
	const uploads = new Map();
	const gl = recordingGL(uploads);
	damageMocks.renderer.gl = gl;
	const mob = new MockEntity(MOB_GID, MockEntity.TYPE_MOB, mobPosition);
	const pc = new MockEntity(PC_GID, MockEntity.TYPE_PC, pcPosition);

	let records = null;
	const stop = SpriteRenderer.addRecordSink(record => records.push(record));
	try {
		SpriteRenderer.init(gl);
		Damage.init(gl); // MapRenderer.js:576, at map load

		for (let frame = 0; frame < frames; ++frame) {
			const tick = determinism.clock.now();
			for (const ev of events.filter(e => e.frame === frame)) {
				const entity = ev.target === 'pc' ? pc : mob;
				const startTick = tick + (ev.delay ?? 0);
				damageMocks.graphics.damageSkin = ev.skin ?? 0;
				damageMocks.mapPrefs.miss = ev.miss ?? true;
				const effectsBefore = damageMocks.effects.length;
				Damage.add(ev.amount, entity, startTick, ev.weapon, ev.type);
				onAdd({
					event: ev,
					entity,
					startTick,
					skin: damageMocks.graphics.damageSkin,
					miss: damageMocks.mapPrefs.miss,
					effects: damageMocks.effects.slice(effectsBefore)
				});
			}

			records = [];
			const motion = motionAt(frame);
			damageMocks.graphics.damageMotion = motion;

			// Entity pass stand-in: one sprite that, like EntityRender, sets zIndex but not depth.
			SpriteRenderer.bind3DContext(gl, IDENTITY, IDENTITY, FOG);
			SpriteRenderer.zIndex = 0;
			SpriteRenderer.shadow = 1;
			SpriteRenderer.angle = 0;
			SpriteRenderer.sprite = { type: 1 };
			SpriteRenderer.image.palette = null;
			SpriteRenderer.image.texture = PROBE_TEXTURE;
			SpriteRenderer.position.set(PROBE.position);
			SpriteRenderer.size.set(PROBE.size);
			SpriteRenderer.offset.set([0, 0]);
			SpriteRenderer.color.set([1, 1, 1, 1]);
			SpriteRenderer.render();
			SpriteRenderer.unbind(gl);

			Damage.render(gl, IDENTITY, IDENTITY, FOG, tick); // MapRenderer.js:358
			onFrame({ frame, tick, motion, records });
			determinism.clock.advance(frameMs);
		}
	} finally {
		stop();
		Damage.free(gl);
		determinism.restore();
	}
	return { describeTexture: texture => uploads.get(texture), uploads };
}
