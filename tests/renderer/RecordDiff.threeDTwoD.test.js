/**
 * Phase 2 record-diff of render-records' 3D / 2D effect players (R-EFX-003, 011..013)
 * against legacy Renderer/Effects/ThreeDEffect.js and TwoDEffect.js.
 *
 * The real legacy effects run the scripted spawns of support/spriteEffectScene.js the
 * way EffectManager drives them (beforeRender, render per ready effect, afterRender,
 * removal on needCleanUp), through the real SpriteRenderer. Their native records come
 * from ThreeDEffect/TwoDEffect.addRecordSink. render-records' ThreeDEffectPlayer and
 * TwoDEffectPlayer get the same EffectTable entries, spawn parameters, owners, seeded
 * random sequence (legacy constructors draw from Math.random, patched by the harness),
 * camera, terrain and ticks. Both streams are diffed per effect and per tick, field by
 * field (tolerance 1e-5, relative above magnitude 1: legacy keeps state in Float32Array).
 *
 * Declared divergences: none. R-EFX-011 [FLAG] is a normalisation, and both sides already
 * name the GL-order factors identically for codes 0..16 and -1.
 *
 * Not compared:
 * - params.spriteType: the uIsRGBA uniform is uploaded but never read (spec #12); legacy
 *   inherits it from whatever sprite SpriteRenderer drew last.
 * - params.paletteSize when the draw has no palette (uTextSize is only uploaded with one).
 * Not diffed (needs an HITL decision): a plain 3D effect drawn right after a sprite-backed
 * 3D effect in the same pass inherits its SpriteRenderer offset and palette (LEAK_3D).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({}));
const camera = vi.hoisted(() => ({ zoom: 2, getLatitude: () => -45, angle: [0, 0, 0], direction: 0 }));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ attribute: {}, uniform: {} }),
		texture: (_gl, buffer, callback) => callback({ id: buffer.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, onload) => {
			const value = files[filename] ?? null;
			if (value && onload) {
				onload(value);
			}
			return value;
		}
	}
}));
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Renderer/Map/Altitude.js', () => ({
	default: { getCellHeight: (x, y) => 0.1 * x - 0.05 * y + 0.25 }
}));
vi.mock('Renderer/Entity/Entity.js', () => ({
	default: class Entity {
		static TYPE_EFFECT = 9;
		action = 0;
		direction = 0;
	}
}));
vi.mock('Renderer/EntityManager.js', () => ({ default: { add: () => {} } }));

import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import ThreeDEffect from 'Renderer/Effects/ThreeDEffect.js';
import TwoDEffect from 'Renderer/Effects/TwoDEffect.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import {
	ThreeDEffectPlayer,
	TwoDEffectPlayer
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import {
	ALL_FILES,
	LEAK_3D,
	SPAWNS_2D,
	SPAWNS_3D,
	SPRITE_FILES,
	TICKS,
	cameraAt,
	cellHeight,
	spawnEffects
} from './support/spriteEffectScene.js';

const gl = new Proxy({}, { get: (_t, k) => (/^[A-Z_0-9]+$/.test(String(k)) ? k : () => ({})) });
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const SEED = 0x3d2d;

const EPSILON = 1e-5;
const close = (l, m) => l === m || Math.abs(l - m) <= EPSILON * Math.max(1, Math.abs(m));
const id = t => (t ? t.id : t);

/** Field-by-field mismatches of one legacy record against one render-records record. */
function diffRecord(l, m) {
	const out = [];
	const vec = (name, a, b) => {
		if (!a || !b || a.length !== b.length || Array.from(a).some((v, i) => !close(v, b[i]))) {
			out.push(`${name}: ${a && Array.from(a)} vs ${b && Array.from(b)}`);
		}
	};
	const eq = (name, a, b) => {
		if (a !== b) {
			out.push(`${name}: ${a} vs ${b}`);
		}
	};
	for (const f of ['kind', 'family', 'depthTest', 'depthWrite', 'depthCorrection', 'fog', 'strAttachment']) {
		eq(f, l[f], m[f]);
	}
	eq('texture', id(l.texture), id(m.texture));
	vec('position', l.position, m.position);
	vec('color', l.color, m.color);
	eq('blend', JSON.stringify(l.blend), JSON.stringify(m.blend));
	const lp = l.params;
	const mp = m.params;
	vec('params.size', lp.size, mp.size);
	vec('params.offset', lp.offset, mp.offset);
	for (const p of ['angle', 'zIndex', 'depthBias', 'shadowFactor', 'xSize', 'ySize']) {
		if (!close(lp[p], mp[p])) {
			out.push(`params.${p}: ${lp[p]} vs ${mp[p]}`);
		}
	}
	for (const p of ['ignoreDepthMinCap', 'blendMode', 'overlay', 'layer']) {
		eq(`params.${p}`, lp[p], mp[p]);
	}
	eq('params.palette', id(lp.palette), id(mp.palette));
	if (lp.palette) {
		vec('params.paletteSize', lp.paletteSize, mp.paletteSize);
	}
	return out;
}

const textures = file => {
	const f = ALL_FILES[`data/texture/${file}`];
	return f ? { id: f.name } : null;
};
const sprites = path => SPRITE_FILES[path] ?? null;
const altitude = { getCellHeight: cellHeight };

/** Legacy effects and their render-records players, spawned from one seeded sequence. */
function spawnScene(spawns3d, spawns2d) {
	const determinism = installDeterminism({ rng: new SeededRng(SEED) });
	let legacy3d, legacy2d;
	try {
		legacy3d = spawnEffects(ThreeDEffect, spawns3d);
		legacy2d = spawnEffects(TwoDEffect, spawns2d);
	} finally {
		determinism.restore();
	}
	const rng = new SeededRng(SEED).fn;
	const soulStrike = { first: null };
	const common = e => ({
		spec: e.spawn.effect,
		position: e.inst.position,
		startTick: e.inst.startTick,
		endTick: e.inst.endTick,
		owner: e.owner ?? null,
		rng
	});
	const players3d = legacy3d.map(
		e =>
			new ThreeDEffectPlayer({
				...common(e),
				otherPosition: e.inst.otherPosition,
				duplicateID: e.inst.duplicateID,
				soulStrike
			})
	);
	const players2d = legacy2d.map(e => new TwoDEffectPlayer(common(e)));
	return [
		{ Ctor: ThreeDEffect, legacy: legacy3d, players: players3d },
		{ Ctor: TwoDEffect, legacy: legacy2d, players: players2d }
	];
}

/**
 * Run legacy and render-records side by side.
 * @returns {{records: number, mismatches: string[], perEffect: Record<string, number>, groups: object[]}}
 */
function runScene(spawns3d, spawns2d, ticks = TICKS) {
	const groups = spawnScene(spawns3d, spawns2d);
	groups.forEach(g => g.legacy.forEach(e => e.effect.init(gl)));
	const mismatches = [];
	const perEffect = {};
	let records = 0;
	let sink = [];
	const stops = [ThreeDEffect.addRecordSink(r => sink.push(r)), TwoDEffect.addRecordSink(r => sink.push(r))];
	try {
		ticks.forEach((tick, f) => {
			const cam = cameraAt(tick);
			camera.angle[1] = cam.angle1;
			camera.direction = cam.direction;
			const sceneFog = { use: f % 2 === 0, exist: true };
			const frame = { camera: { yaw: cam.angle1, direction: cam.direction }, sceneFog, textures, sprites, altitude };
			for (const { Ctor, legacy, players } of groups) {
				legacy.forEach(e => e.move?.(tick));
				Ctor.beforeRender(gl, IDENTITY, IDENTITY, { near: 10, far: 100, color: [0, 0, 0], ...sceneFog }, tick);
				legacy.forEach((e, i) => {
					if (e.done) {
						return;
					}
					const key = `${Ctor.name}:${e.name}`;
					const at = `${key}@${tick}`;
					sink = [];
					if (e.effect.ready) {
						e.effect.render(gl, tick);
					}
					const mine = players[i].frame(tick, frame);
					perEffect[key] = (perEffect[key] ?? 0) + sink.length;
					records += sink.length;
					if (sink.length !== mine.length) {
						mismatches.push(`${at}: ${sink.length} legacy records vs ${mine.length}`);
					} else {
						sink.forEach((l, r) => diffRecord(l, mine[r]).forEach(d => mismatches.push(`${at}#${r} ${d}`)));
					}
					if (e.effect.ready && Boolean(e.effect.needCleanUp) !== players[i].finished) {
						mismatches.push(`${at}: removal ${Boolean(e.effect.needCleanUp)} vs ${players[i].finished}`);
					}
					e.done = Boolean(e.effect.needCleanUp);
				});
				Ctor.afterRender(gl);
			}
		});
	} finally {
		stops.forEach(stop => stop());
	}
	return { records, mismatches, perEffect, groups };
}

describe('record-diff: legacy ThreeDEffect / TwoDEffect vs render-records players', () => {
	beforeAll(() => {
		Object.assign(files, ALL_FILES);
		SpriteRenderer.init(gl);
		ThreeDEffect.init(gl);
		TwoDEffect.init(gl);
	});

	it('every scripted 3D and 2D effect matches field by field (no declared divergence)', () => {
		const { records, mismatches, perEffect } = runScene(SPAWNS_3D, SPAWNS_2D);
		expect(mismatches).toEqual([]);
		expect(records).toBeGreaterThan(1000);
		const silent = ['ThreeDEffect:noTexture', 'ThreeDEffect:missing', 'TwoDEffect:missing'];
		for (const [list, Ctor] of [
			[SPAWNS_3D, ThreeDEffect],
			[SPAWNS_2D, TwoDEffect]
		]) {
			for (const s of list) {
				const key = `${Ctor.name}:${s.name}`;
				if (silent.includes(key)) {
					expect(perEffect[key], key).toBe(0);
				} else {
					expect(perEffect[key], key).toBeGreaterThan(0);
				}
			}
		}
	});

	it('consumes the same random draws as the legacy constructors', () => {
		const [three, two] = spawnScene(SPAWNS_3D, SPAWNS_2D);
		const randomized = (g, name) => g.players[g.legacy.findIndex(e => e.name === name)].s;
		expect(randomized(three, 'rand').posxStart).toBe(three.legacy.find(e => e.name === 'rand').effect.posxStart);
		expect(randomized(three, 'sparkRand').sparkNumber).toBe(three.legacy.find(e => e.name === 'sparkRand').effect.sparkNumber);
		expect(randomized(two, 'circle').posyEnd).toBe(two.legacy.find(e => e.name === 'circle').effect.posyEnd);
		expect(randomized(two, 'rand').sizeEndX).toBe(two.legacy.find(e => e.name === 'rand').effect.sizeEndX);
	});

	it('2D shadow attachment request matches the legacy owner attachment', () => {
		const [, two] = spawnScene([], SPAWNS_2D);
		const i = two.legacy.findIndex(e => e.name === 'attached');
		expect(two.legacy[i].owner.log[0]).toEqual(['add', 'data/sprite/shadow', true, true, false, true]);
		expect(two.players[i].shadowAttachment).toMatchObject({
			completeFile: 'data/sprite/shadow',
			head: true,
			direction: true,
			repeat: false,
			stopAtEnd: true
		});
		expect(two.players[two.legacy.findIndex(e => e.name === 'ownerNoShadow')].shadowAttachment).toBeNull();
	});

	it('legacy leaks sprite-layer state into the next plain 3D draw (documented, not diffed)', () => {
		// the palette leaks once sprName (RGBA-only) has ended and sprAbs draws last
		const { mismatches } = runScene([...SPAWNS_3D, ...LEAK_3D], []);
		const leaked = mismatches.filter(m => m.startsWith('ThreeDEffect:afterSprite'));
		expect(leaked.some(m => m.includes('params.offset'))).toBe(true);
		expect(leaked.some(m => m.includes('params.palette'))).toBe(true);
		expect(mismatches.filter(m => !m.startsWith('ThreeDEffect:afterSprite'))).toEqual([]);
	});

	it('fails when a composer is broken (mutation guard)', () => {
		for (const Player of [ThreeDEffectPlayer, TwoDEffectPlayer]) {
			const frame = Player.prototype.frame;
			Player.prototype.frame = function (...args) {
				return frame.apply(this, args).map(r => ({ ...r, params: { ...r.params, angle: r.params.angle + 0.5 } }));
			};
			try {
				expect(runScene(SPAWNS_3D, SPAWNS_2D, TICKS.slice(0, 8)).mismatches.length).toBeGreaterThan(0);
			} finally {
				Player.prototype.frame = frame;
			}
		}
	});
});
