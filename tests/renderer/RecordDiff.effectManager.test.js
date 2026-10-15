/**
 * Phase 2 record-diff of the effect ORCHESTRATION: legacy Renderer/EffectManager.js against
 * render-records' EffectSystem (R-EFX-001..006).
 *
 * The REAL legacy EffectManager runs a small synthetic EffectTable (support/effectManagerScene.js,
 * mocked in as DB/Effects/EffectTable.js) over a scripted timeline: spam (EF_Init_Par,
 * duplicates, delays, /effect, /mineffect, `%d` picks, fallbacks), FUNC entries, the two
 * render passes per frame (before / after entities, including the hard-coded aura IDs),
 * distance culling against Session.Entity (20 cells, viewArea in performance mode),
 * persistent / repeatEnd / spec-repeat chains, remove / endRepeat. Its draws are collected
 * from the per-class record sinks (StrEffect, ThreeDEffect, TwoDEffect, Cylinder,
 * FlatColorTile) into one stream in emission order, each tagged with the pass being rendered.
 *
 * render-records' EffectSystem gets the same table (FUNC closures in the injected
 * FUNC(params, ctx) form), the same entities, prefs, camera, ticks and an identically seeded
 * random sequence (legacy draws from the patched Math.random in the same order: duplicates,
 * `%d` picks, constructors, repeats spawned mid-pass). Both streams are diffed frame by frame
 * and pass by pass, record by record, field by field (tolerance 1e-5) including `pass`.
 *
 * Declared divergence (HITL round 2), scoped to the FlatColorTile collision scene only:
 * - #59 [FLAG, fixed]: legacy keys its lists by constructor.name, so the blue FlatColorTile
 *   (spawned while the red one is alive) joins the red one's list, is never initialised and
 *   never draws. The rebuild tracks per instance: the blue tile draws in its own group,
 *   appended where it was first spawned. Allowed: rebuild-only records of family
 *   'flat-color-tile' with the blue colour; nothing else may differ (order included).
 *
 * Not compared (covered by the per-family diffs or not record fields): family maths beyond
 * what the orchestrator feeds them (each family is diffed on its own), the STR fog fix
 * (R-EFX-010: frames run without scene fog, so both sides carry fog false), audio.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
	files: {},
	table: {},
	entities: {},
	renderer: { tick: 0 },
	prefs: { effect: true, mineffect: false },
	graphics: { performanceMode: false, viewArea: 14 },
	session: { Entity: null },
	camera: { zoom: 2, getLatitude: () => -45, angle: [200, 0, 0], direction: 0 }
}));

vi.mock('DB/Effects/EffectTable.js', () => ({ default: env.table }));
vi.mock('DB/Skills/SkillEffect.js', () => ({ default: {} }));
vi.mock('DB/Skills/SkillUnit.js', () => ({ default: {} }));
vi.mock('DB/Skills/SkillUnitConst.js', () => ({ default: {} }));
vi.mock('DB/Items/ItemEffect.js', () => ({ default: {} }));
vi.mock('Controls/ProcessCommand.js', () => ({
	default: { add() {}, remove() {}, isEnabled: () => false }
}));
vi.mock('Core/Events.js', () => ({ default: { setTimeout() {} } }));
vi.mock('Core/Configs.js', () => ({ default: { get: () => false } }));
vi.mock('Audio/SoundManager.js', () => ({ default: { playPosition() {} } }));
vi.mock('Preferences/Map.js', () => ({ default: env.prefs }));
vi.mock('Preferences/Graphics.js', () => ({ default: env.graphics }));
vi.mock('Engine/SessionStorage.js', () => ({ default: env.session }));
vi.mock('Renderer/Renderer.js', () => ({ default: env.renderer }));
vi.mock('Renderer/Camera.js', () => ({ default: env.camera }));
vi.mock('Renderer/Map/Altitude.js', () => ({ default: { getCellHeight: (x, y) => 0.1 * x - 0.05 * y } }));
vi.mock('Renderer/Entity/Entity.js', () => ({
	default: class Entity {
		static TYPE_EFFECT = 9;
		action = 0;
		direction = 0;
	}
}));
vi.mock('Renderer/EntityManager.js', () => ({
	default: { get: aid => env.entities[aid] ?? null, add() {}, remove() {} }
}));
vi.mock('Renderer/Effects/Trail.js', () => ({ default: class Trail {} }));
vi.mock('Renderer/Effects/RsmEffect.js', () => ({ default: class RsmEffect {} }));
vi.mock('Renderer/Effects/WaterfallEffect.js', () => ({ default: class WaterfallEffect {} }));
vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ attribute: {}, uniform: {} }),
		texture: (_gl, buffer, callback) => callback({ id: buffer.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, onload, onerror) => {
			const value = env.files[filename] ?? null;
			if (value === null) {
				onerror?.('404');
				return null;
			}
			onload?.(value);
			return value;
		}
	}
}));

import EffectManager from 'Renderer/EffectManager.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import StrEffect from 'Renderer/Effects/StrEffect.js';
import ThreeDEffect from 'Renderer/Effects/ThreeDEffect.js';
import TwoDEffect from 'Renderer/Effects/TwoDEffect.js';
import Cylinder from 'Renderer/Effects/Cylinder.js';
import QuadHorn from 'Renderer/Effects/QuadHorn.js';
import FlatColorTile from 'Renderer/Effects/FlatColorTile.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	CylinderEffect,
	EffectSystem,
	QuadHornEffect,
	flatColorTileClass
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { STR_FILES } from './support/strEffectScene.js';
import {
	BLUE_COLOR,
	FX,
	PLAYER_AID,
	SCRIPT,
	TEXTURE_FILES,
	TICKS,
	cameraAt,
	makeEntities,
	makeTable,
	moveEntities,
	strAliases
} from './support/effectManagerScene.js';

const gl = new Proxy({}, { get: (_t, k) => (/^[A-Z_0-9]+$/.test(String(k)) ? k : () => ({})) });
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const SEED = 0xef7;
const FOG = { use: false, exist: false, near: 10, far: 100, color: [0, 0, 0] };
const PASSES = ['before', 'after'];
const LEGACY_CLASSES = { QuadHorn, Cylinder };

const EPSILON = 1e-5;
const close = (l, m) => Object.is(l, m) || Math.abs(l - m) <= EPSILON * Math.max(1, Math.abs(m));
const isVec = v => Array.isArray(v) || ArrayBuffer.isView(v);
const texId = t => (t && typeof t === 'object' ? t.id : t);

/** One field: vectors element-wise, numbers with tolerance, the rest strictly. */
function diffValue(name, l, m, out) {
	if (isVec(l) || isVec(m)) {
		if (!isVec(l) || !isVec(m) || l.length !== m.length || Array.from(l).some((v, i) => !close(v, m[i]))) {
			out.push(`${name}: ${l && Array.from(l)} vs ${m && Array.from(m)}`);
		}
	} else if (typeof l === 'number' && typeof m === 'number') {
		if (!close(l, m)) {
			out.push(`${name}: ${l} vs ${m}`);
		}
	} else if (texId(l) !== texId(m)) {
		out.push(`${name}: ${String(texId(l))} vs ${String(texId(m))}`);
	}
}

/** Params compared per family (the per-family diffs' conventions). */
const PARAMS = {
	str: (l, m, out) => {
		for (const p of ['xy', 'pivot', 'scale', 'angle', 'yLower', 'clipZBias', 'srcBlend', 'dstBlend', 'aniframe']) {
			diffValue(`params.${p}`, l[p], m[p], out);
		}
		// offset = pos − pivot, compared at the magnitude of the f32-stored key position
		diffValue(
			'params.offset+pivot',
			Array.from(l.offset, (v, i) => v + l.pivot[i]),
			m.offset.map((v, i) => v + m.pivot[i]),
			out
		);
	},
	sprite: (l, m, out) => {
		for (const p of ['size', 'offset', 'angle', 'zIndex', 'depthBias', 'shadowFactor', 'xSize', 'ySize']) {
			diffValue(`params.${p}`, l[p], m[p], out);
		}
		for (const p of ['ignoreDepthMinCap', 'blendMode', 'overlay', 'layer', 'palette']) {
			diffValue(`params.${p}`, l[p], m[p], out);
		}
	},
	all: (l, m, out) => {
		for (const k of new Set([...Object.keys(l), ...Object.keys(m)])) {
			if (!(k in l) || !(k in m)) {
				out.push(`params.${k}: only on ${k in l ? 'legacy' : 'render-records'}`);
			} else {
				diffValue(`params.${k}`, l[k], m[k], out);
			}
		}
	}
};

/** @returns {string[]} field mismatches of one tagged legacy record against one rebuild record */
function diffRecord({ record: l, pass }, m) {
	const out = [];
	diffValue('pass', pass, m.pass, out);
	for (const f of ['kind', 'family', 'depthTest', 'depthWrite', 'depthCorrection', 'fog', 'strAttachment']) {
		diffValue(f, l[f], m[f], out);
	}
	diffValue('texture', l.texture, m.texture, out);
	diffValue('position', l.position, m.position, out);
	diffValue('color', l.color, m.color, out);
	if (JSON.stringify(l.blend) !== JSON.stringify(m.blend)) {
		out.push(`blend: ${JSON.stringify(l.blend)} vs ${JSON.stringify(m.blend)}`);
	}
	if (l.family === m.family) {
		PARAMS[{ str: 'str', '3d': 'sprite', '2d': 'sprite' }[l.family] ?? 'all'](l.params, m.params, out);
	}
	return out;
}

/** Reset the shared scene state (entities, prefs, files, table) for one side's run. */
function resetScene(table) {
	for (const key of Object.keys(env.table)) {
		delete env.table[key];
	}
	Object.assign(env.table, table);
	for (const key of Object.keys(env.entities)) {
		delete env.entities[key];
	}
	Object.assign(env.entities, makeEntities());
	Object.assign(env.prefs, { effect: true, mineffect: false });
	Object.assign(env.graphics, { performanceMode: false, viewArea: 14 });
	env.session.Entity = env.entities[PLAYER_AID];
}

/** Advance the shared world to `tick`; returns the scripted actions due now. */
function stepWorld(tick, done) {
	env.renderer.tick = tick;
	moveEntities(env.entities, tick);
	const cam = cameraAt(tick);
	env.camera.angle = cam.angle;
	env.camera.direction = cam.direction;
	return SCRIPT.filter((action, i) => !done.has(i) && action.at <= tick && done.add(i));
}

/**
 * Legacy run: real EffectManager, records from every class sink, tagged with the pass.
 * @returns {Array<Record<'before'|'after', object[]>>} per frame, per pass
 */
function runLegacy() {
	resetScene(makeTable('legacy', { EffectManager, FlatColorTile, Cylinder }));
	EffectManager.free(gl);
	const frames = [];
	let pass = null;
	let sink = null;
	const collect = record => sink.push({ record, pass });
	const stops = [StrEffect, ThreeDEffect, TwoDEffect, Cylinder, FlatColorTile].map(C => C.addRecordSink(collect));
	const { restore } = installDeterminism({ rng: new SeededRng(SEED) });
	const api = {
		spam: params => EffectManager.spam(params),
		remove: (cls, aid, ids) => EffectManager.remove(cls ? LEGACY_CLASSES[cls] : null, aid, ids),
		endRepeat: aid => EffectManager.endRepeat(null, aid),
		pref: (name, value) => {
			(name in env.prefs ? env.prefs : env.graphics)[name] = value;
		}
	};
	try {
		const done = new Set();
		for (const tick of TICKS) {
			stepWorld(tick, done).forEach(action => action.run(api));
			const frame = {};
			for (pass of PASSES) {
				sink = frame[pass] = [];
				EffectManager.render(gl, IDENTITY, IDENTITY, FOG, tick, pass === 'before');
			}
			frames.push(frame);
		}
	} finally {
		restore();
		stops.forEach(stop => stop());
		EffectManager.free(gl);
	}
	return frames;
}

/**
 * Rebuild run: render-records EffectSystem over the same scene.
 * @param {(system: EffectSystem) => void} [mutate] test hook (mutation guards)
 * @returns {{frames: Array<Record<'before'|'after', object[]>>, system: EffectSystem}}
 */
function runRebuild(mutate) {
	resetScene(makeTable('rebuild', { flatColorTileClass, CylinderEffect }));
	const prefs = { effect: true, mineffect: false, performanceMode: false, viewArea: 14 };
	const system = new EffectSystem({
		table: env.table,
		ctx: {
			camera: {},
			altitude: { getCellHeight: (x, y) => 0.1 * x - 0.05 * y },
			screenFx: {},
			audio: {},
			session: env.session,
			entities: { get: aid => env.entities[aid] ?? null },
			resources: { str: path => env.files[path] ?? null }
		},
		prefs,
		rng: new SeededRng(SEED).fn,
		now: () => env.renderer.tick
	});
	mutate?.(system);
	const api = {
		spam: params => system.spam(params),
		remove: (cls, aid, ids) => system.remove(cls, aid, ids),
		endRepeat: aid => system.endRepeat(null, aid),
		pref: (name, value) => {
			prefs[name] = value;
		}
	};
	const textures = file => {
		const f = env.files[`data/texture/${file}`];
		return f ? { id: f.name } : null;
	};
	const frames = [];
	const done = new Set();
	for (const tick of TICKS) {
		stepWorld(tick, done).forEach(action => action.run(api));
		const camera = { angle: env.camera.angle, yaw: env.camera.angle[1], direction: env.camera.direction };
		const state = {
			tick,
			playerPosition: env.session.Entity.position,
			sceneFog: { use: false },
			camera,
			textures,
			sprites: () => null,
			altitude: system.ctx.altitude
		};
		const frame = {};
		for (const pass of PASSES) {
			frame[pass] = system.emit(null, pass, state);
		}
		frames.push(frame);
	}
	return { frames, system };
}

const isBlueTile = r => r.family === 'flat-color-tile' && BLUE_COLOR.every((c, i) => close(r.color[i], c));

/**
 * Diff both runs. `allow59` drops the rebuild-only blue tile records (the declared #59 fix).
 * @returns {{mismatches: string[], records: number, perFamily: Record<string, number>, blue: object[]}}
 */
function diffRuns(legacy, rebuild, { allow59 = true } = {}) {
	const mismatches = [];
	const perFamily = {};
	const blue = [];
	let records = 0;
	legacy.forEach((frame, f) => {
		for (const pass of PASSES) {
			const at = `${TICKS[f]}/${pass}`;
			let mine = rebuild[f][pass];
			if (allow59) {
				blue.push(...mine.filter(isBlueTile).map(r => ({ tick: TICKS[f], r })));
				mine = mine.filter(r => !isBlueTile(r));
			}
			const theirs = frame[pass];
			if (theirs.length !== mine.length) {
				mismatches.push(
					`${at}: ${theirs.length} legacy records [${theirs.map(t => t.record.family)}] vs ${mine.length} [${mine.map(r => r.family)}]`
				);
				continue;
			}
			theirs.forEach((l, i) => {
				records++;
				perFamily[`${l.record.family}/${pass}`] = (perFamily[`${l.record.family}/${pass}`] ?? 0) + 1;
				// legacy self-consistency: classes that record their pass drew in that pass
				if (l.record.pass && l.record.pass !== pass) {
					mismatches.push(`${at}#${i}: legacy ${l.record.family} records pass ${l.record.pass}`);
				}
				diffRecord(l, mine[i]).forEach(d => mismatches.push(`${at}#${i} ${l.record.family} ${d}`));
			});
		}
	});
	return { mismatches, records, perFamily, blue };
}

describe('legacy observation: late static pass defaults (R-EFX-006 refinement, proposed flag)', () => {
	it('the first QuadHorn spawned before its class initialises is drawn after entities in legacy', () => {
		Object.assign(env.files, { 'data/texture/effect/qh.tga': { name: 'qh' } });
		resetScene({ 700: [{ type: 'QuadHorn', textureFile: 'effect/qh.tga', height: 1, duration: 5000 }] });
		EffectManager.init(gl);
		EffectManager.free(gl);
		expect(QuadHorn.renderBeforeEntities).toBeUndefined();
		const seen = [];
		let pass = null;
		const stop = QuadHorn.addRecordSink(r => seen.push(`${pass}:${r.pass}`));
		try {
			env.renderer.tick = 1000;
			EffectManager.spam({ effectId: 700, position: [50, 50, 0] });
			for (pass of PASSES) {
				EffectManager.render(gl, IDENTITY, IDENTITY, FOG, 1000, pass === 'before');
			}
			// QuadHorn.init (first render) sets the class default; later spawns go before entities
			EffectManager.spam({ effectId: 700, position: [51, 50, 0] });
			seen.length = 0;
			for (pass of PASSES) {
				EffectManager.render(gl, IDENTITY, IDENTITY, FOG, 1010, pass === 'before');
			}
		} finally {
			stop();
			EffectManager.free(gl);
		}
		expect(seen).toEqual(['before:before', 'after:after']);
		// the rebuild applies the class default from the first spawn (spec R-EFX-006 wording)
		const system = new EffectSystem({ table: env.table, ctx: {}, now: () => 1000 });
		expect(system.spam({ effectId: 700, position: [50, 50, 0] }).map(i => i.pass)).toEqual(['before']);
		expect(system.instances[0].player).toBeInstanceOf(QuadHornEffect);
	});
});

describe('record-diff: legacy EffectManager vs render-records EffectSystem', () => {
	let legacy;

	beforeAll(() => {
		Object.assign(env.files, TEXTURE_FILES, STR_FILES, strAliases(STR_FILES));
		SpriteRenderer.init(gl);
		EffectManager.init(gl);
		legacy = runLegacy();
	});

	afterEach(() => {
		Object.assign(env.prefs, { effect: true, mineffect: false });
	});

	it('every frame and pass matches record by record, field by field (only #59 differs)', () => {
		const { frames } = runRebuild();
		const { mismatches, records, perFamily, blue } = diffRuns(legacy, frames);
		expect(mismatches).toEqual([]);
		expect(records).toBeGreaterThan(700);
		// every family drew in the pass the orchestrator chose for it
		for (const key of ['str/before', 'str/after', '3d/before', '3d/after', '2d/after', 'cylinder/before', 'cylinder/after']) {
			expect(perFamily[key], key).toBeGreaterThan(0);
		}
		expect(perFamily['flat-color-tile/before']).toBeGreaterThan(0);
		// #59: the blue tile draws (once per frame, before entities) from its spawn to its removal
		expect(blue.length).toBeGreaterThan(5);
		expect(blue.every(({ tick, r }) => tick >= 1222 && tick < 2010 && r.pass === 'before')).toBe(true);
		expect(new Set(blue.map(b => b.tick)).size).toBe(blue.length);
	});

	it('#59 divergence is exactly the blue tile: without the allowance only blue tile records differ', () => {
		const { frames } = runRebuild();
		const { mismatches } = diffRuns(legacy, frames, { allow59: false });
		expect(mismatches.length).toBeGreaterThan(0);
		// each mismatching frame differs by one extra flat-color-tile record in the before pass
		for (const m of mismatches) {
			expect(m).toMatch(/\/before: (\d+) legacy records .* vs (\d+) /);
			const [, l, r] = m.match(/: (\d+) legacy records .* vs (\d+) /);
			expect(Number(r) - Number(l)).toBe(1);
		}
	});

	it('exercises the orchestration paths on the legacy side', () => {
		const at = tick => legacy[TICKS.indexOf(tick)];
		const near = (x, y) => r => Math.round(r.position[0]) === x && Math.round(r.position[1]) === y;
		const has = (tick, pass, pred) => at(tick)[pass].some(t => pred(t.record));
		const textures = (tick, pred) => at(tick).after.filter(t => pred(t.record)).map(t => texId(t.record.texture));
		// aura IDs 200 (Cylinder with renderBeforeEntities:false) and 881 (STR) drew before entities
		expect(has(1037, 'before', r => r.family === 'cylinder')).toBe(true);
		expect(has(1037, 'before', r => r.family === 'str')).toBe(true);
		// far effects: culled until the player walks up; the 3D one (duration 500) expired while
		// culled and never draws; the STR (no duration) draws once more when back in range
		expect(TICKS.filter(t => t < 2163).some(t => has(t, 'after', r => r.position[0] >= 77))).toBe(false);
		expect(has(2163, 'after', r => r.family === 'str' && r.position[0] === 80)).toBe(true);
		expect(TICKS.some(t => has(t, 'after', r => r.family === '3d' && r.position[0] >= 77))).toBe(false);
		// performance mode (viewArea 14) culls the persistent STR chain at (46, 46) between 1814 and 2163
		expect(has(1777, 'after', near(46, 46))).toBe(true);
		expect(has(1888, 'after', near(46, 46))).toBe(false);
		expect(has(2269, 'after', near(46, 46))).toBe(true);
		// persistent + repeatEnd cylinder chain: still drawn well past its first end (1357), gone after 2300
		expect(has(2216, 'after', r => r.family === 'cylinder' && near(48, 49)(r))).toBe(true);
		expect(has(2481, 'after', near(48, 49))).toBe(false);
		// /mineffect: the `min` file plays (loop.str layers l*), a missing `min` falls back to the full file
		expect(textures(1296, near(50, 52))).toEqual(['l0']);
		expect(textures(1296, near(52, 52))).toEqual(['f0']);
		expect(textures(1296, near(50, 47)).length).toBe(6);
		// remove(QuadHorn, owner) with no live QuadHorn removed the owner's other effects (its aura)
		expect(at(2587).before.length).toBeGreaterThan(0);
		expect(at(2640).before).toEqual([]);
	});

	it('repeat chains, culling and the rebuild instance bookkeeping agree at the end', () => {
		const { system } = runRebuild();
		// the persistent STR chain was removed by effectID; the chain cylinders were stopped by endRepeat
		expect(system.instances.some(i => i.effectId === FX.STR_PERSIST)).toBe(false);
		expect(system.instances.some(i => i.effectId === FX.CYL_PERSIST)).toBe(true);
	});

	it('fails when the orchestration is broken (mutation guards)', () => {
		const mutations = {
			'no repeat': system => {
				system.repeat = () => {};
			},
			'aura IDs ignored': system => {
				const track = system.track.bind(system);
				system.track = (player, params, fields) => {
					const instance = track(player, params, fields);
					if (instance.effectId === FX.AURA_CYL || instance.effectId === FX.AURA_STR) {
						instance.pass = 'after';
					}
					return instance;
				};
			},
			'no culling': system => {
				const prefs = system.prefs;
				system.prefs = new Proxy(prefs, {
					get: (target, key) => ({ performanceMode: true, viewArea: 1e9 })[key] ?? target[key]
				});
			},
			'performance mode ignored': system => {
				const prefs = system.prefs;
				system.prefs = new Proxy(prefs, {
					get: (target, key) => (key === 'performanceMode' ? false : target[key])
				});
			},
			'new groups first': system => {
				const track = system.track.bind(system);
				system.track = (player, params, fields) => {
					const fresh = !system.groups.has(fields.key);
					const instance = track(player, params, fields);
					if (fresh) {
						system.groups = new Map([[fields.key, system.groups.get(fields.key)], ...system.groups]);
					}
					return instance;
				};
			},
			'delayStart ignored on duplicates': system => {
				const spawn = system.spawnInstance.bind(system);
				system.spawnInstance = (spec, inst, init) => spawn({ ...spec, delayStart: 0 }, inst, init);
			}
		};
		for (const [name, mutate] of Object.entries(mutations)) {
			const { frames } = runRebuild(mutate);
			expect(diffRuns(legacy, frames).mismatches.length, name).toBeGreaterThan(0);
		}
	});
});
