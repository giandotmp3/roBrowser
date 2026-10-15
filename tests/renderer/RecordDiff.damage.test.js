/**
 * Phase 2 record-diff of render-records' damage composer (C-10, R-DMG-001..009) against legacy
 * Renderer/Effects/Damage.js.
 *
 * support/legacyDamageScene.js runs the real legacy Damage + SpriteRenderer the way MapRenderer
 * does (Damage.init at map load; per frame an entity-pass probe sprite, then Damage.render) and
 * collects the native SpriteRenderer records. The very same Damage.add calls are fed to
 * render-records' DamageComposer.add, and each frame DamageComposer.emit writes into a RecordStream
 * after the same probe; both streams are diffed field by field (tolerance 1e-5).
 *
 * Texture identity. Legacy composes each number into a canvas and uploads it as a fresh WebGL
 * texture; render-records names the glyph texture `damage/<num|msg|msgBlue>/<skin>/<text|frame>`
 * and leaves composition to the backend atlas. The scene records which glyph canvases were drawn
 * into every uploaded canvas, so a legacy texture is compared by that glyph key (displayed text or
 * msg.spr frame name, plus sheet and skin). The canvas size and glyph placements legacy composed
 * are compared separately against the composer's layout helpers (R-DMG-007).
 *
 * Declared divergences -- only the two flagged rules the rebuild fixes (spec §6, HITL):
 * - R-DMG-004: legacy keeps Miss/Lucky in its list until 1500 ms although their motion ends at
 *   800 ms; between 800 and 1500 ms it still emits a draw with alpha 1 − t/800 < 0. The rebuild
 *   drops them at 800 ms. Allowed: exactly those legacy records (alpha < 0, on the miss motion
 *   z = +3.5 + 7·t/800 with t/800 ∈ (1, 1.875]) are absent; and since the depth bias is the list
 *   index, each later record's depthBias is lower by the number of such zombies before it in the
 *   frame (compared per legacy list index, corrected for the zombies the rebuild no longer holds).
 * - R-DMG-009: legacy leaves SpriteRenderer.depth at the last damage index; the next frame's entity
 *   pass (which never sets depth) inherits it. Allowed: only the probe record's depthBias differs,
 *   legacy showing the previous frame's last damage index, the rebuild 0.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

const { damageMocks } = await vi.hoisted(() => import('./support/legacyDamageScene.js'));

vi.mock('Core/Client.js', () => ({ default: damageMocks.client }));
vi.mock('Core/Configs.js', () => ({ default: damageMocks.configs }));
vi.mock('Loaders/Sprite.js', () => ({ default: damageMocks.Sprite }));
vi.mock('Loaders/Action.js', () => ({ default: damageMocks.Action }));
vi.mock('Renderer/Renderer.js', () => ({ default: damageMocks.renderer }));
vi.mock('Renderer/Camera.js', () => ({ default: damageMocks.camera }));
vi.mock('Preferences/Map.js', () => ({ default: damageMocks.mapPrefs }));
vi.mock('Preferences/Graphics.js', () => ({ default: damageMocks.graphics }));
vi.mock('DB/DBManager.js', () => ({ default: damageMocks.db }));
vi.mock('Audio/SoundManager.js', () => ({ default: damageMocks.sound }));
vi.mock('Renderer/EffectManager.js', () => ({ default: damageMocks.effectManager }));
vi.mock('Core/MemoryManager.js', () => ({ default: { remove: () => {} } }));
vi.mock('Renderer/Entity/Entity.js', () => ({ default: damageMocks.Entity }));
vi.mock('Network/PacketVerManager.js', () => ({ default: damageMocks.packetver }));
vi.mock('Utils/WebGL.js', async importOriginal => {
	const { default: WebGL } = await importOriginal();
	return { default: { ...WebGL, createShaderProgram: () => ({ uniform: {}, attribute: {} }) } };
});

import {
	BLEND_ADDITIVE,
	DamageComposer,
	DamageType as T,
	RecordStream,
	damageGlyphs,
	layoutDamageMessage,
	layoutDamageNumber,
	loadedDamageSkins
} from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import {
	MOB_GID,
	MSG_NAMES,
	PC_GID,
	PROBE,
	PROBE_TEXTURE,
	msgFrame,
	runDamageScene,
	skinMetrics
} from './support/legacyDamageScene.js';

/**
 * Tolerance 1e-5, relative above magnitude 1: legacy records hold Float32Array copies of
 * SpriteRenderer state, and combo-title sizes reach ~500 sprite px where one float32 ulp is 3e-5.
 */
const EPSILON = 1e-5;
const close = (l, m) => Math.abs(l - m) <= EPSILON * Math.max(1, Math.abs(m));
const VECTOR_FIELDS = ['position', 'offset', 'size', 'color'];
const NUMBER_FIELDS = ['xSize', 'ySize', 'angle', 'shadowFactor', 'zIndex', 'depthBias'];
const EXACT_FIELDS = ['kind', 'textureClass', 'palette', 'depthTest', 'depthWrite', 'depthCorrection', 'ignoreDepthMinCap'];
const blendName = blend => (blend === BLEND_ADDITIVE ? 'additive' : 'normal');

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------

const C = T.COMBO;
const F = T.COMBO_FINAL;

/** Skill combo series as MapEngine/Entity.js:1655-1690 adds it: per hit a number and a combo title. */
const comboSeries = (frame, total, count, { blue = false, target = 'mob', skin, spacing = 200 } = {}) =>
	Array.from({ length: count }, (_, i) => [
		{ frame, target, skin, amount: total / count, delay: spacing * i, weapon: 1 },
		{
			frame,
			target,
			skin,
			amount: (total / count) * (i + 1),
			delay: spacing * i,
			weapon: 1,
			type: (blue ? T.COMBO_B : C) | (i + 1 === count ? F : 0)
		}
	]).flat();

/** Skin 0, no suffix, DPR 1, current PACKETVER, damageMotion 0. */
const MAIN = {
	name: 'main: every damage kind on a mob and a PC',
	frames: 100,
	events: [
		{ frame: 0, amount: 1234, weapon: 1 }, // normal hit
		{ frame: 2, amount: 5678, type: T.CRIT, weapon: 1 }, // crit + critbg (R-DMG-006)
		{ frame: 4, amount: 250, type: T.HEAL }, // heal
		{ frame: 5, amount: 40, type: T.HEAL | T.SP }, // SP (MapEngine/Main.js:711)
		{ frame: 6, amount: 0 }, // miss
		{ frame: 7, amount: 0, type: T.LUCKY }, // lucky (miss glyph)
		{ frame: 7, amount: 77, type: T.LUCKY }, // lucky with a number
		...comboSeries(8, 100, 3), // combo series
		{ frame: 10, target: 'pc', amount: 321, weapon: 1 }, // hit on a PC (red)
		{ frame: 11, target: 'pc', amount: 222, type: T.CRIT }, // crit on a PC: red, no critbg
		{ frame: 12, target: 'pc', amount: 50, type: C | F }, // combo on a PC: red, 1500 ms
		{ frame: 12, target: 'pc', amount: 0 }, // miss on a PC
		{ frame: 14, amount: 99, type: T.DAMAGE | T.ENDURE, weapon: 2 }, // endure
		{ frame: 15, amount: 0, miss: false }, // miss with the `miss` preference off
		...comboSeries(16, 90, 2, { blue: true }), // blue combo (COMBO_B, bluemsg critbg)
		{ frame: 18, amount: 12.7 }, // floored
		{ frame: 18, amount: -5 }, // ignored
		{ frame: 18, amount: 0.4 }, // floors to a miss
		{ frame: 19, amount: 123456789 }, // suffix off: all digits
		{ frame: 19, amount: 1234567 },
		{ frame: 20, amount: 0, type: T.HEAL }, // heal of 0: miss glyph on the heal motion
		{ frame: 22, amount: 0, type: T.CRIT }, // crit of 0: critbg + miss glyph on the crit motion
		{ frame: 24, amount: 4321, delay: 330, weapon: 3 }, // starts in the future (attackMT)
		{ frame: 40, amount: 0 }, // a second burst while older numbers expire
		{ frame: 40, amount: 11 },
		{ frame: 41, amount: 0, type: T.LUCKY },
		...comboSeries(42, 60, 4),
		{ frame: 43, amount: 8, target: 'pc' },
		{ frame: 44, amount: 5, type: T.HEAL | T.SP, target: 'pc' },
		// Slow series: a non-final title outlives 15 % of its delay before the next one arrives.
		...comboSeries(60, 120, 2, { spacing: 700 }),
		...comboSeries(62, 30, 2, { target: 'pc', spacing: 400 })
	]
};

/** Skins 1/2 (and Invi), K/M suffix, DPR 2, damageMotion cycling 0..3. */
const SKINS_SUFFIX = {
	name: 'skins 1/2/3, dmg suffix on, DPR 2, every damageMotion',
	frames: 80,
	dpr: 2,
	enableDmgSuffix: true,
	motionAt: frame => Math.floor(frame / 5) % 4,
	events: [
		{ frame: 0, amount: 1234567, skin: 1 }, // 1234K
		{ frame: 1, amount: 123456789, skin: 2 }, // 123M
		{ frame: 2, amount: 999999, skin: 1 }, // below the K threshold
		{ frame: 3, amount: 777, type: T.CRIT, skin: 1 },
		{ frame: 4, amount: 0, skin: 2 },
		{ frame: 5, amount: 300, type: T.HEAL, skin: 0 },
		...comboSeries(6, 3000000, 3, { skin: 1 }),
		{ frame: 9, amount: 55, target: 'pc', skin: 2 },
		{ frame: 12, amount: 66, skin: 3 }, // Invi: suppressed, but becomes the render skin
		{ frame: 20, amount: 88, skin: 1 },
		{ frame: 21, amount: 0, type: T.LUCKY, skin: 1 },
		...comboSeries(22, 40, 2, { blue: true, skin: 2 })
	]
};

/** PACKETVER before 20220821: only skin 0 loads, other skins fall back to it; Invi still hides. */
const OLD_PACKETVER = {
	name: 'old PACKETVER forces skin 0 (R-DMG-008)',
	frames: 60,
	packetver: 20211103,
	motionAt: () => 2,
	events: [
		{ frame: 0, amount: 4242, skin: 1 },
		{ frame: 1, amount: 31, type: T.CRIT, skin: 2 },
		{ frame: 2, amount: 0, skin: 1 },
		{ frame: 3, amount: 99, skin: 3 }, // suppressed even here (legacy checks Invi first) ...
		{ frame: 20, amount: 7, skin: 0 }, // ... and until the next add every number loses the ACT scale
		{ frame: 30, amount: 12, skin: 2 }
	]
};

const SCENES = [MAIN, SKINS_SUFFIX, OLD_PACKETVER];

// ---------------------------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------------------------

function diffFrame(frame, legacy, modern, textureOf) {
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
		const lt = textureOf.legacy(l.texture);
		const mt = textureOf.modern(m.texture);
		if (lt !== mt) {
			push(i, 'texture', lt, mt);
		}
		for (const field of NUMBER_FIELDS) {
			if (!close(l[field], m[field])) {
				push(i, field, l[field], m[field]);
			}
		}
		for (const field of VECTOR_FIELDS) {
			const lv = Array.from(l[field]);
			const mv = Array.from(m[field]);
			if (lv.length !== mv.length || lv.some((v, k) => !close(v, mv[k]))) {
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
 * Apply the two declared divergences to one legacy frame; returns the normalised legacy records
 * plus what was removed / rewritten, so the tests can assert the divergences stay narrow.
 */
function applyDeclaredDivergences(records, positions) {
	const [probe, ...damage] = records;
	const zombies = [];
	const kept = [];
	for (const record of damage) {
		if (record.color[3] < 0) {
			zombies.push(record);
			continue;
		}
		// R-DMG-004: the rebuild's list no longer holds the zombies in front of this record.
		kept.push({
			...record,
			depthBias: record.depthBias - zombies.length,
			zIndex: record.zIndex - zombies.length
		});
	}
	// R-DMG-009: the probe's depth is whatever the previous damage pass leaked.
	const leakedDepth = probe.depthBias;
	for (const z of zombies) {
		const perc = 1 - z.color[3];
		const entity = positions.find(p => p[0] === z.position[0] && p[1] === z.position[1]);
		z.check = { perc, onMissMotion: !!entity && Math.abs(z.position[2] - (entity[2] + 3.5 + perc * 7)) <= 1e-4 };
	}
	return { normalised: [{ ...probe, depthBias: 0 }, ...kept], zombies, leakedDepth };
}

/** Run one scene through legacy and the composer; collect everything the tests assert on. */
async function runDiff(scene, { mutate } = {}) {
	const packetver = scene.packetver ?? 20250101;
	const dpr = scene.dpr ?? 1;
	const numberCount = scene.enableDmgSuffix ? 12 : 10;
	const skins = Object.fromEntries(loadedDamageSkins(packetver).map(s => [s, skinMetrics(s, numberCount)]));
	const composer = new DamageComposer({ skins, packetver, dpr, enableDmgSuffix: !!scene.enableDmgSuffix });
	if (mutate) {
		mutate(composer);
	}
	const targets = new Map();
	const effectMismatches = [];
	const frames = [];
	let describeTexture = null;

	const result = await runDamageScene({
		...scene,
		onAdd: ({ event, entity, startTick, skin, miss, effects }) => {
			if (!targets.has(entity.GID)) {
				targets.set(entity.GID, { gid: entity.GID, position: entity.position });
			}
			const added = composer.add(
				{
					amount: event.amount,
					entity: targets.get(entity.GID),
					tick: startTick,
					type: event.type ?? 0,
					isPC: event.target === 'pc'
				},
				{ damageSkin: skin, miss }
			);
			const legacyEffects = effects.map(({ effectId, ownerAID, position, startTick: s }) => ({
				effectId,
				ownerAID,
				position,
				startTick: s
			}));
			if (JSON.stringify(legacyEffects) !== JSON.stringify(added.effects)) {
				effectMismatches.push({ event, legacy: legacyEffects, modern: added.effects });
			}
		},
		onFrame: ({ frame, tick, motion, records }) => {
			const stream = new RecordStream();
			stream.beginFrame();
			stream.sprite({
				source: 'probe',
				texture: PROBE_TEXTURE,
				textureClass: 'rgba',
				position: PROBE.position,
				size: PROBE.size,
				offset: [0, 0],
				color: [1, 1, 1, 1]
			});
			composer.emit(stream, tick, { damageMotion: motion });
			frames.push({ frame, tick, legacy: records, modern: stream.records });
		}
	});
	describeTexture = result.describeTexture;

	const textureOf = {
		legacy: t => (t === PROBE_TEXTURE ? 'probe' : (describeTexture(t)?.key ?? t)),
		modern: t => (t === PROBE_TEXTURE ? 'probe' : t)
	};
	const positions = [...targets.values()].map(t => Array.from(new Float32Array(t.position)));
	const mismatches = [];
	const zombies = [];
	const leaks = [];
	let previousLastDepth = 0;
	for (const f of frames) {
		const { normalised, zombies: z, leakedDepth } = applyDeclaredDivergences(f.legacy, positions);
		zombies.push(...z.map(r => ({ frame: f.frame, ...r.check })));
		leaks.push({ frame: f.frame, leakedDepth, previousLastDepth });
		if (f.legacy.length > 1) {
			previousLastDepth = f.legacy[f.legacy.length - 1].depthBias;
		}
		mismatches.push(...diffFrame(f.frame, normalised, f.modern, textureOf));
	}
	return { frames, mismatches, zombies, leaks, effectMismatches, describeTexture, textureOf, dpr, numberCount };
}

const results = new Map();
const diffOf = async scene => {
	if (!results.has(scene)) {
		results.set(scene, await runDiff(scene));
	}
	return results.get(scene);
};

afterAll(() => {
	damageMocks.restoreCanvas();
});

describe('record-diff: render-records damage composer vs legacy Damage.js', () => {
	for (const scene of SCENES) {
		describe(scene.name, () => {
			it('reproduces every legacy damage record field by field (declared R-DMG-004/009 divergences only)', async () => {
				const { frames, mismatches, effectMismatches } = await diffOf(scene);
				expect(frames).toHaveLength(scene.frames);
				// Non-vacuous: most frames draw damage numbers.
				expect(frames.filter(f => f.legacy.length > 1).length).toBeGreaterThan(scene.frames / 2);
				expect(mismatches).toEqual([]);
				expect(effectMismatches).toEqual([]);
			});

			it('composes the same glyph canvases legacy uploads (R-DMG-007 layout, POT×DPR)', async () => {
				const { frames, describeTexture, dpr, numberCount } = await diffOf(scene);
				const seen = new Set();
				for (const f of frames) {
					for (const r of f.legacy.slice(1)) {
						const d = describeTexture(r.texture);
						expect(d?.key).toBeTruthy();
						if (seen.has(d.key)) {
							continue;
						}
						seen.add(d.key);
						const [, sheet, skin, name] = d.key.split('/');
						if (sheet === 'num') {
							const layout = layoutDamageNumber(damageGlyphs(name), skinMetrics(+skin, numberCount).numbers, dpr);
							expect([d.width, d.height]).toEqual([layout.width, layout.height]);
							expect(d.placements.map(({ glyph, x, y }) => ({ glyph, x, y }))).toEqual(layout.placements);
						} else {
							const layout = layoutDamageMessage(msgFrame(sheet, +skin, MSG_NAMES.indexOf(name)), dpr);
							expect([d.width, d.height]).toEqual([layout.width, layout.height]);
							expect(d.placements).toHaveLength(1);
							expect([d.placements[0].x, d.placements[0].y]).toEqual([layout.x, layout.y]);
						}
					}
				}
				expect(seen.size).toBeGreaterThan(3);
			});

			it('R-DMG-004 divergence is narrow: only Miss/Lucky draws past 800 ms (alpha < 0) are dropped', async () => {
				const { zombies } = await diffOf(scene);
				for (const z of zombies) {
					expect(z.onMissMotion).toBe(true);
					expect(z.perc).toBeGreaterThan(1);
					expect(z.perc).toBeLessThanOrEqual(1500 / 800 + EPSILON);
				}
				if (scene === MAIN) {
					expect(zombies.length).toBeGreaterThan(10);
				}
			});

			it('R-DMG-009 divergence is narrow: only the next pass inherits the last damage index', async () => {
				const { leaks } = await diffOf(scene);
				for (const { leakedDepth, previousLastDepth } of leaks) {
					// SpriteRenderer.depth is set before the alpha gate, so a final alpha-0 entry can
					// leave a higher index than the last emitted record.
					expect(leakedDepth).toBeGreaterThanOrEqual(previousLastDepth);
					expect(Number.isInteger(leakedDepth)).toBe(true);
				}
				expect(leaks.some(l => l.leakedDepth > 0)).toBe(true);
			});
		});
	}

	it('covers every kind of the main scene (colours, glyph sheets, crit background, combo, PC)', async () => {
		const { frames, textureOf } = await diffOf(MAIN);
		const records = frames.flatMap(f => f.modern.slice(1));
		const keys = new Set(records.map(r => textureOf.modern(r.texture)));
		for (const key of [
			'damage/num/0/1234',
			'damage/num/0/5678',
			'damage/msg/0/critbg',
			'damage/msgBlue/0/critbg',
			'damage/msg/0/miss',
			'damage/num/0/123456789',
			'damage/num/0/12',
			'damage/num/0/4321'
		]) {
			expect(keys).toContain(key);
		}
		const colours = new Set(records.map(r => r.color.slice(0, 3).join(',')));
		for (const c of ['1,1,1', '0.9,0.9,0.15', '0,1,0', '0.13,0.19,0.75', '1,0,0', '0.66,0.66,0.66']) {
			expect(colours).toContain(c);
		}
		const sources = new Set(records.map(r => r.source));
		expect(sources).toEqual(new Set([`damage:${MOB_GID}`, `damage:${PC_GID}`]));
	});

	it('the diff catches a broken composer (mutation check)', async () => {
		const mutants = [
			// every z off by 0.1 %
			c => {
				const emit = c.emit.bind(c);
				c.emit = (records, tick, prefs) =>
					emit({ sprite: f => records.sprite({ ...f, position: [f.position[0], f.position[1], f.position[2] * 1.001] }) }, tick, prefs);
			},
			// depth bias leaks across records again
			c => {
				const emit = c.emit.bind(c);
				c.emit = (records, tick, prefs) => emit({ sprite: f => records.sprite({ ...f, depthBias: 0 }) }, tick, prefs);
			}
		];
		for (const mutate of mutants) {
			const { mismatches } = await runDiff(MAIN, { mutate });
			expect(mismatches.length).toBeGreaterThan(0);
		}
	});
});
