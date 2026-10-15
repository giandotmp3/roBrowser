/**
 * Phase 2 record-diff of render-records' STR player (R-EFX-007..010, R-SPR-032) against
 * legacy Renderer/Effects/StrEffect.js.
 *
 * The real legacy StrEffect runs the synthetic compiled STR files of
 * support/strEffectScene.js the way EffectManager / EntityAttachments drive it
 * (beforeRender, render per effect, afterRender), and its native records are collected
 * through StrEffect.addRecordSink. render-records' StrPlayer is given the very same STR
 * data, spawn parameters, owner entity and ticks; both streams are diffed per effect and
 * per tick, field by field (tolerance 1e-5, relative above magnitude 1, since legacy keeps
 * interpolated keys in Float32Array).
 *
 * Declared divergence -- only the flagged rule the rebuild fixes (spec §6, HITL):
 * - R-EFX-010: legacy never enables fog on STR layers; the rebuild's STR records obey
 *   the scene fog. Allowed: `fog` is false on every legacy record and equals the frame's
 *   sceneFog.use on every render-records record; no other field may differ.
 *
 * Not diffed: badblend.str (D3D codes 0/12/13). Legacy hands GL an undefined factor
 * (INVALID_ENUM, previous blend kept, record blend null); render-records' blendFromStr
 * falls back to normal alpha. That is not a declared divergence: it needs an SME decision.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({}));

vi.mock('Utils/WebGL.js', () => ({
	default: { createShaderProgram: () => ({ attribute: {}, uniform: {} }) }
}));
vi.mock('Core/Client.js', () => ({
	default: {
		loadFile: (filename, _onload, onerror) => {
			if (!(filename in files) && onerror) {
				onerror('404');
			}
			return files[filename] ?? null;
		}
	}
}));

import StrEffect from 'Renderer/Effects/StrEffect.js';
import { StrPlayer } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { SPAWNS, STR_FILES, spawnEffects } from './support/strEffectScene.js';

const gl = new Proxy({}, { get: (_t, k) => (/^[A-Z_0-9]+$/.test(String(k)) ? k : () => ({})) });
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const EPSILON = 1e-5;
const close = (l, m) => Math.abs(l - m) <= EPSILON * Math.max(1, Math.abs(m));
const SCALAR_PARAMS = ['scale', 'angle', 'yLower', 'clipZBias', 'srcBlend', 'dstBlend'];

/** Field-by-field mismatches of one legacy record against one render-records record. */
function diffRecord(l, m, fog) {
	const out = [];
	const vec = (name, a, b) => {
		if (a.length !== b.length || Array.from(a).some((v, i) => !close(v, b[i]))) {
			out.push(`${name}: ${Array.from(a)} vs ${Array.from(b)}`);
		}
	};
	const eq = (name, a, b) => {
		if (a !== b) {
			out.push(`${name}: ${a} vs ${b}`);
		}
	};
	for (const f of ['kind', 'family', 'texture', 'depthTest', 'depthWrite', 'depthCorrection', 'strAttachment']) {
		eq(f, l[f], m[f]);
	}
	vec('position', l.position, m.position);
	vec('color', l.color, m.color);
	if (JSON.stringify(l.blend) !== JSON.stringify(m.blend)) {
		out.push(`blend: ${JSON.stringify(l.blend)} vs ${JSON.stringify(m.blend)}`);
	}
	vec('params.xy', l.params.xy, m.params.xy);
	vec('params.pivot', l.params.pivot, m.params.pivot);
	// offset = pos − pivot: compared at the magnitude of the f32-stored key position
	vec(
		'params.offset+pivot',
		Array.from(l.params.offset, (v, i) => v + l.params.pivot[i]),
		m.params.offset.map((v, i) => v + m.params.pivot[i])
	);
	for (const p of SCALAR_PARAMS) {
		if (!close(l.params[p], m.params[p])) {
			out.push(`params.${p}: ${l.params[p]} vs ${m.params[p]}`);
		}
	}
	eq('params.aniframe|0', l.params.aniframe | 0, m.params.aniframe | 0);
	if (!close(l.params.aniframe, m.params.aniframe)) {
		out.push(`params.aniframe: ${l.params.aniframe} vs ${m.params.aniframe}`);
	}
	// R-EFX-010 (declared): legacy never fogs STR; the rebuild follows the scene fog
	eq('fog (legacy)', l.fog, false);
	eq('fog (rebuild)', m.fog, fog);
	return out;
}

/**
 * Run legacy and render-records side by side.
 * @returns {{frames: number, records: number, mismatches: string[], perEffect: Record<string, number>}}
 */
function runScene(spawns, ticks) {
	const legacy = spawnEffects(StrEffect, spawns);
	const players = legacy.map(({ spawn, effect }) => {
		const player = new StrPlayer({
			str: STR_FILES[spawn.file] ?? null,
			startTick: spawn.startTick,
			position: spawn.position.slice(),
			persistent: Boolean(spawn.persistent),
			attachment: spawn.attachment ? { entity: effect.ownerEntity, ...spawn.attachment } : null
		});
		// the scene's loader reports a file with no loadable candidate
		if (!(spawn.file in STR_FILES)) {
			player.fail();
		}
		return player;
	});
	const mismatches = [];
	const perEffect = {};
	let sink = [];
	let records = 0;
	const stop = StrEffect.addRecordSink(r => sink.push(r));
	try {
		ticks.forEach((tick, f) => {
			const fog = { use: f % 2 === 0 };
			legacy.forEach(({ move }) => move?.(tick));
			StrEffect.beforeRender(gl, IDENTITY, IDENTITY, { near: 10, far: 100, color: [0, 0, 0], ...fog }, tick);
			legacy.forEach(({ name, effect }, e) => {
				sink = [];
				effect.render(gl, tick);
				const mine = players[e].frame(tick, { sceneFog: fog });
				const at = `${name}@${tick}`;
				perEffect[name] = (perEffect[name] ?? 0) + sink.length;
				records += sink.length;
				if (sink.length !== mine.length) {
					mismatches.push(`${at}: ${sink.length} legacy records vs ${mine.length}`);
					return;
				}
				sink.forEach((l, i) => diffRecord(l, mine[i], fog.use).forEach(d => mismatches.push(`${at}#${i} ${d}`)));
				if (Boolean(effect.needCleanUp) !== players[e].finished) {
					mismatches.push(`${at}: removal ${Boolean(effect.needCleanUp)} vs ${players[e].finished}`);
				}
				if (effect.startTick !== players[e].startTick) {
					mismatches.push(`${at}: startTick ${effect.startTick} vs ${players[e].startTick}`);
				}
			});
			StrEffect.afterRender(gl);
		});
	} finally {
		stop();
	}
	return { frames: ticks.length, records, mismatches, perEffect };
}

const TICKS = Array.from({ length: 46 }, (_, i) => 1000 + i * 19);
const DIFFED = SPAWNS.filter(s => s.name !== 'badblend');

describe('record-diff: legacy StrEffect vs render-records StrPlayer', () => {
	beforeAll(() => {
		Object.assign(files, STR_FILES);
		StrEffect.init(gl);
	});

	it('every scripted effect matches field by field (only R-EFX-010 fog differs)', () => {
		const { records, mismatches, perEffect } = runScene(DIFFED, TICKS);
		expect(mismatches).toEqual([]);
		expect(records).toBeGreaterThan(400);
		for (const s of DIFFED.filter(s => s.name !== 'missing')) {
			expect(perEffect[s.name], s.name).toBeGreaterThan(0);
		}
		expect(perEffect.missing).toBe(0);
	});

	it('covers the hat restart, blank-key reuse and removal paths', () => {
		const hat = DIFFED.find(s => s.name === 'hat');
		const legacy = spawnEffects(StrEffect, [hat])[0];
		const player = new StrPlayer({
			str: STR_FILES[hat.file],
			startTick: hat.startTick,
			persistent: true,
			attachment: { entity: legacy.effect.ownerEntity, ...hat.attachment }
		});
		expect(player.frame(1250).length).toBe(2);
		// key 6: layer 0 is blank and reuses its last valid frame
		const reused = player.frame(1300);
		expect(reused.length).toBe(2);
		expect(reused[0].params.aniframe).toBeCloseTo(0.3 * 5);
		// key 10: both layers blank -> both reused, then the effect restarts
		expect(player.frame(1500).length).toBe(2);
		expect(player.startTick).toBe(1500);
		expect(player.frame(1500).length).toBe(2);

		const once = new StrPlayer({ str: STR_FILES[DIFFED[0].file], startTick: 0 });
		once.frame(666);
		expect(once.finished).toBe(false);
		once.frame(667);
		expect(once.finished).toBe(true);
	});

	it('fails when the STR composer is broken (mutation guard)', () => {
		const frame = StrPlayer.prototype.frame;
		StrPlayer.prototype.frame = function (...args) {
			return frame.apply(this, args).map(r => ({ ...r, params: { ...r.params, yLower: 0.25 } }));
		};
		try {
			expect(runScene(DIFFED, TICKS.slice(0, 5)).mismatches.length).toBeGreaterThan(0);
		} finally {
			StrPlayer.prototype.frame = frame;
		}
	});
});
