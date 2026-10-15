/** AI_NATIVE_SPEC §5.5 — EFX: effects (18 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run, LOCAL_GID } from '../support/scenes.js';
import { flatMap } from '../../src/scenes/fixtures.js';
import { lastFrame, effects, inPass } from '../../src/subject/queries.js';
import { Blend, BlendFactor as F } from '../../src/records/RecordTypes.js';

const spam = o => ({ ownerAID: LOCAL_GID, position: [20, 20, 0], startTick: 0, ...o });

describe('EFX', () => {
	rule('R-EFX-001', '/effect off suppresses spawns; /mineffect uses the min STR when present', async s => {
		const off = await run(
			s,
			inGame('efx-001', { prefs: { effect: false } })
				.effect(spam({ effectId: 'fixture-str' }))
				.advance(16)
		);
		expect(effects(lastFrame(off))).toHaveLength(0);
		const min = await run(
			s,
			inGame('efx-001-min', { prefs: { mineffect: true } })
				.effect(spam({ effectId: 'fixture-str-with-min' }))
				.advance(16)
		);
		expect(effects(lastFrame(min))[0].meta.file).toBe('fixture://str/min');
	});

	rule('R-EFX-002', 'duplicate −1 → 999, cap 999, default 1; spaced timeBetweenDupli (200 ms)', async s => {
		const r = await run(
			s,
			inGame('efx-002')
				.effect(spam({ effectId: 'fixture-dup-3' }))
				.advance(450, 1)
		);
		const starts = effects(lastFrame(r))
			.map(e => e.meta.startTick)
			.sort((a, b) => a - b);
		expect(starts).toEqual([0, 200, 400]);
		expect(await s.cpu('records.duplicateCount', { duplicate: -1 })).toBe(999);
		expect(await s.cpu('records.duplicateCount', { duplicate: 5000 })).toBe(999);
		expect(await s.cpu('records.duplicateCount', {})).toBe(1);
	});

	rule(
		'R-EFX-003',
		'start = spawn + delayStart (repeat: delayOffset + delayLate); end = start+duration or −1',
		async s => {
			expect(await s.cpu('records.effectTiming', { spawn: 100, delayStart: 50, duration: 300 })).toEqual({
				start: 150,
				end: 450
			});
			expect(await s.cpu('records.effectTiming', { spawn: 100, delayStart: 0, duration: 0 })).toEqual({
				start: 100,
				end: -1
			});
			expect(
				(
					await s.cpu('records.effectTiming', {
						spawn: 100,
						repeat: true,
						delayOffset: 30,
						delayLate: 20,
						duration: 10
					})
				).start
			).toBe(50);
		}
	);

	rule(
		'R-EFX-004',
		'persistent/repeatEnd effects respawn at end+repeatDelay (or cleanup+repeatDelay) until repeatEnd',
		async s => {
			const r = await run(
				s,
				inGame('efx-004')
					.effect(spam({ effectId: 'fixture-repeat-500', repeatEnd: 1600 }))
					.frames(120, 16)
			);
			const spawns = new Set(r.frames.flatMap(f => Array.from(effects(f)).map(e => e.meta.startTick)));
			expect([...spawns].every(t => t <= 1600)).toBe(true);
			expect(spawns.size).toBeGreaterThan(1);
			expect(effects(lastFrame(r))).toHaveLength(0);
		}
	);

	rule(
		'R-EFX-005',
		'effects > 20 cells (viewArea in perf mode) from the player are not drawn but still advance',
		async s => {
			const r = await run(
				s,
				inGame('efx-005')
					.effect(spam({ effectId: 'fixture-str', position: [45, 20, 0], ownerAID: 0 }))
					.advance(16)
			);
			expect(effects(lastFrame(r))).toHaveLength(0);
			expect(lastFrame(r).effectsAlive).toBe(1);
			const perf = await run(
				s,
				inGame('efx-005-p', { prefs: { performanceMode: true, viewArea: 14 } })
					.effect(spam({ effectId: 'fixture-str', position: [36, 20, 0], ownerAID: 0 }))
					.advance(16)
			);
			expect(effects(lastFrame(perf))).toHaveLength(0);
		}
	);

	rule(
		'R-EFX-006',
		'effect flag decides the pass, else constructor default; aura IDs 200,201,202,362,397,398,881 before entities',
		async s => {
			const sc = inGame('efx-006');
			[200, 201, 202, 362, 397, 398, 881].forEach(id => sc.effect(spam({ effectId: id })));
			const f = lastFrame(await run(s, sc.advance(16)));
			expect(
				inPass(f, 'effects-before')
					.filter(x => x.kind === 'effect')
					.map(e => e.effectId)
					.sort((a, b) => a - b)
			).toEqual([200, 201, 202, 362, 397, 398, 881]);
		}
	);

	rule(
		'R-EFX-007',
		'key = elapsed/1000·fps (wrapped if persistent); linear deltas; anitype 1–4; removed at maxKey; colour /255',
		async s => {
			const r = await run(
				s,
				inGame('efx-007')
					.effect(spam({ effectId: 'fixture-str-60fps-30keys' }))
					.advance(250, 1)
					.advance(300, 1)
			);
			const e = effects(r.frames[0], { family: 'str' })[0];
			expect(e.key).toBeCloseTo((250 / 1000) * 60, 3);
			expect(effects(r.frames[1], { family: 'str' })).toHaveLength(0); // key 33 > maxKey 30
			expect(await s.cpu('records.strAniframe', { anitype: 3, frame: 7, count: 5 })).toBe(2);
		}
	);

	rule(
		'R-EFX-008',
		'STR blend = D3DBLEND[src], D3DBLEND[dst] (1 ZERO … 15 1−CONSTANT_ALPHA); depth write off',
		async s => {
			const map = {
				1: F.ZERO,
				2: F.ONE,
				3: F.SRC_COLOR,
				4: F.ONE_MINUS_SRC_COLOR,
				5: F.SRC_ALPHA,
				6: F.ONE_MINUS_SRC_ALPHA,
				7: F.DST_ALPHA,
				8: F.ONE_MINUS_DST_ALPHA,
				9: F.DST_COLOR,
				10: F.ONE_MINUS_DST_COLOR,
				11: F.SRC_ALPHA_SATURATE,
				14: F.CONSTANT,
				15: F.ONE_MINUS_CONSTANT
			};
			for (const [d3d, factor] of Object.entries(map)) {
				expect(await s.cpu('records.strBlend', { d3d: Number(d3d) })).toBe(factor);
			}
			const r = await run(
				s,
				inGame('efx-008')
					.effect(spam({ effectId: 'fixture-str' }))
					.advance(16)
			);
			expect(effects(lastFrame(r), { family: 'str' })[0].depth.write).toBe(false);
		}
	);

	rule(
		'R-EFX-009',
		'STR billboard: 1/35 unit/px, pivot pos−(320,320), Y −0.5 (not attachments), clip z −0.1; black/zero-α discarded',
		async s => {
			const g = await s.cpu('records.strGeometry', { pos: [320, 320], attachment: false });
			expect(g).toMatchObject({ unitsPerPixel: 1 / 35, pivot: [0, 0], yBase: -0.5, clipZBias: -0.1 });
			expect((await s.cpu('records.strGeometry', { pos: [320, 320], attachment: true })).yBase).toBe(0);
			expect(await s.fragment('str', { tex: [0, 0, 0, 1], color: [1, 1, 1, 1] })).toBeNull();
			expect(await s.fragment('str', { tex: [1, 1, 1, 0], color: [1, 1, 1, 1] })).toBeNull();
		}
	);

	rule('R-EFX-010', 'STR effects are fogged with the shared fog include (legacy never set uFogUse)', async s => {
		const map = flatMap({ fog: { near: 0.01, far: 0.02, color: [1, 0, 0] } });
		const r = await run(
			s,
			inGame('efx-010', { map, prefs: { fog: true } })
				.effect(spam({ effectId: 'fixture-str' }))
				.advance(16)
		);
		const e = effects(lastFrame(r), { family: 'str' })[0];
		expect(e.fog).toBe(true);
		const fogged = await s.fragment('str', {
			tex: [0, 0, 1, 1],
			color: [1, 1, 1, 1],
			fog: { near: 0.01, far: 0.02, color: [1, 0, 0] },
			viewDepth: 1000
		});
		expect(fogged[0]).toBeCloseTo(1, 2);
	});

	rule(
		'R-EFX-011',
		'2D/3D/cylinder/QuadHorn blendMode n (GL order) normalised into the one enum, same visual result',
		async s => {
			// legacy GL-order table: 1 ZERO, 2 ONE, 3 SRC_COLOR, 4 1−SRC_COLOR, 5 DST_COLOR, 6 1−DST_COLOR, 7 SRC_ALPHA, ...
			const legacyGl = {
				1: F.ZERO,
				2: F.ONE,
				3: F.SRC_COLOR,
				4: F.ONE_MINUS_SRC_COLOR,
				5: F.DST_COLOR,
				6: F.ONE_MINUS_DST_COLOR,
				7: F.SRC_ALPHA,
				8: F.ONE_MINUS_SRC_ALPHA,
				9: F.DST_ALPHA,
				10: F.ONE_MINUS_DST_ALPHA
			};
			for (const family of ['2d', '3d', 'cylinder', 'quadhorn']) {
				for (const [n, dst] of Object.entries(legacyGl)) {
					expect(await s.cpu('records.effectBlend', { family, blendMode: Number(n) })).toEqual({
						src: F.SRC_ALPHA,
						dst
					});
				}
				expect(await s.cpu('records.effectBlend', { family, blendMode: 0 })).toEqual(Blend.NORMAL);
				expect(await s.cpu('records.effectBlend', { family, blendMode: 99 })).toEqual(Blend.NORMAL);
			}
		}
	);

	rule(
		'R-EFX-012',
		'fadeIn first ¼, fadeOut last ¼, sparkling αmax(cos(steps·11·n°)+1)/2, clamped [0,1]',
		async s => {
			expect(await s.cpu('records.alphaEnvelope', { fadeIn: true, alphaMax: 0.8, t: 0.125 })).toBeCloseTo(0.4, 6);
			expect(await s.cpu('records.alphaEnvelope', { fadeOut: true, alphaMax: 0.8, t: 0.875 })).toBeCloseTo(
				0.4,
				6
			);
			expect(await s.cpu('records.alphaEnvelope', { sparkling: true, alphaMax: 1, steps: 0, n: 0 })).toBeCloseTo(
				1,
				6
			);
			expect(await s.cpu('records.alphaEnvelope', { alphaMax: 2, t: 0.5 })).toBe(1);
		}
	);

	rule(
		'R-EFX-013',
		'overlay disables depth test and correction; non-overlay tests depth; 2D also writes',
		async s => {
			const r = await run(
				s,
				inGame('efx-013')
					.effect(spam({ effectId: 'fixture-2d-overlay' }))
					.effect(spam({ effectId: 'fixture-2d' }))
					.effect(spam({ effectId: 'fixture-3d' }))
					.advance(16)
			);
			const f = lastFrame(r);
			expect(effects(f, { effectId: 'fixture-2d-overlay' })[0].depth).toMatchObject({
				test: false,
				correction: false
			});
			expect(effects(f, { effectId: 'fixture-2d' })[0].depth).toMatchObject({ test: true, write: true });
			expect(effects(f, { effectId: 'fixture-3d' })[0].depth).toMatchObject({ test: true, write: false });
		}
	);

	rule(
		'R-EFX-014',
		'GroundAura, SwirlingAura, Level99Bubble, SpiritSphere, WarlockSphere, PokJuk, Waterfall use SRC_ALPHA, ONE',
		async s => {
			const fams = [
				'ground-aura',
				'swirling-aura',
				'level99',
				'spirit-sphere',
				'warlock-sphere',
				'pokjuk',
				'waterfall'
			];
			const sc = inGame('efx-014');
			fams.forEach(f => sc.effect(spam({ effectId: `fixture-${f}` })));
			const f = lastFrame(await run(s, sc.advance(16)));
			for (const family of fams) {
				const e = effects(f, { family });
				expect(e.length).toBeGreaterThan(0);
				e.forEach(x => expect(x.blend).toEqual(Blend.ADDITIVE));
			}
		}
	);

	rule(
		'R-EFX-015',
		'level-99 aura: pref>0 and level ≥ 99 (server override) and visible; 1 → _3 only, 2 → all three; pref change reloads',
		async s => {
			const p1 = await run(s, inGame('efx-015-1', { prefs: { aura: 1 }, local: { level: 99 } }).advance(16));
			expect(effects(lastFrame(p1), { family: 'level99' }).map(e => e.effectId)).toEqual(['EF_LEVEL99_3']);
			const p2 = await run(
				s,
				inGame('efx-015-2', { prefs: { aura: 2 }, local: { level: 99 } })
					.advance(16)
					.preferences({ aura: 0 })
					.advance(16)
			);
			expect(new Set(effects(p2.frames[0], { family: 'level99' }).map(e => e.effectId))).toEqual(
				new Set(['EF_LEVEL99', 'EF_LEVEL99_2', 'EF_LEVEL99_3'])
			);
			expect(effects(p2.frames[1], { family: 'level99' })).toHaveLength(0);
		}
	);

	rule(
		'R-EFX-016',
		'WeatherTable effects[map].weather starts snow/rain/fireworks/leaves/sakura/cloud1–8 at map load',
		async s => {
			for (const w of ['snow', 'rain', 'sakura']) {
				const r = await run(s, inGame(`efx-016-${w}`, { map: flatMap({ weather: w }) }).advance(500, 1));
				expect(effects(lastFrame(r), { family: `weather-${w}` }).length).toBeGreaterThan(0);
			}
		}
	);

	rule(
		'R-EFX-017',
		'snow 2/tick, 8 s, radius 60; rain 10/tick ≤1100, radius 70; sakura 1/150 ms, 15 s (1 tick = 25 ms)',
		async s => {
			const rain = await run(s, inGame('efx-017', { map: flatMap({ weather: 'rain' }) }).frames(400, 25));
			const drops = effects(lastFrame(rain), { family: 'weather-rain' }).filter(e => e.meta.kind === 'drop');
			expect(drops.length).toBeLessThanOrEqual(1100);
			drops.forEach(d =>
				expect(Math.hypot(d.position[0] - 20.5, d.position[2] - 20.5)).toBeLessThanOrEqual(70.5)
			);
			const snow = await run(s, inGame('efx-017-s', { map: flatMap({ weather: 'snow' }) }).frames(4, 25));
			expect(effects(lastFrame(snow), { family: 'weather-snow' })).toHaveLength(8);
		}
	);

	rule('R-EFX-018', 'poisoned local player: 4000×4000 billboard (.5,0,.5,.15), no depth', async s => {
		const r = await run(
			s,
			inGame('efx-018').screen('parseStatus', { gid: LOCAL_GID, efst: 'POISON', on: true }).advance(16)
		);
		const p = effects(lastFrame(r), { family: 'poison' })[0];
		expect(p).toMatchObject({ size: [4000, 4000], color: [0.5, 0, 0.5, 0.15] });
		expect(p.depth).toMatchObject({ test: false, write: false });
	});
});
