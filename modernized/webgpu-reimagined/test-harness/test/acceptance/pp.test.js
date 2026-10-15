/** AI_NATIVE_SPEC §5.7 — PP: post-processing (12 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run, LOCAL_GID } from '../support/scenes.js';
import { mob } from '../../src/scenes/fixtures.js';
import { lastFrame, overlaysOf } from '../../src/subject/queries.js';

const ALL = { bloom: true, blur: true, fxaa: true, cas: true, cartoon: true, vibrance: true };
const near4 = (a, b, eps = 2 / 255) => {
	expect(Array.from(a)).toHaveLength(b.length);
	b.forEach((v, i) => expect(Math.abs(a[i] - v)).toBeLessThanOrEqual(eps));
};
/** 3×3 neighbourhood with a single bright centre — enough to exercise every filter. */
const PATCH = { size: [3, 3], pixels: [0.2, 0.2, 0.2, 0.2, 0.9, 0.2, 0.2, 0.2, 0.2].map(v => [v, v, v, 1]) };

describe('PP', () => {
	rule(
		'R-PP-001',
		'Bloom → Blur → FXAA → CAS → Cartoon → Vibrance → VerticalFlip → Blind → Upsampling; last writes screen',
		async s => {
			const r = await run(
				s,
				inGame('pp-001', { prefs: { ...ALL, performanceMode: true } })
					.screen('parseStatus', { gid: LOCAL_GID, efst: 'ILLUSION', on: true })
					.screen('parseStatus', { gid: LOCAL_GID, efst: 'HEALTHSTATE_BLIND', on: true })
					.advance(16)
			);
			const chain = lastFrame(r).postChain;
			expect(chain.map(p => p.module)).toEqual([
				'bloom',
				'blur',
				'fxaa',
				'cas',
				'cartoon',
				'vibrance',
				'verticalflip',
				'blind',
				'upsampling'
			]);
			expect(chain.at(-1).output).toBe('screen');
			chain.slice(0, -1).forEach(p => expect(p.output).not.toBe('screen'));
		}
	);

	rule(
		'R-PP-002',
		'no active module → scene to screen; else rgb8 + depth16 target, linear, clamp, ping-pong',
		async s => {
			const none = await run(s, inGame('pp-002-none').advance(16));
			expect(lastFrame(none).postChain).toHaveLength(0);
			expect(lastFrame(none).device.sceneTarget).toBe('screen');
			const one = await run(s, inGame('pp-002', { prefs: { fxaa: true, cas: true } }).advance(16));
			const t = lastFrame(one).device.sceneTarget;
			expect(t).toMatchObject({
				color: 'rgba8unorm',
				depth: 'depth16unorm',
				filter: 'linear',
				address: 'clamp-to-edge'
			});
			const [a, b] = lastFrame(one).postChain;
			expect(a.output).toBe(b.input);
			expect(a.input).not.toBe(a.output);
		}
	);

	rule('R-PP-003', 'performance mode: scene at 0.75× canvas, Upsampling (linear) to full size', async s => {
		const r = await run(s, inGame('pp-003', { prefs: { performanceMode: true } }).advance(16));
		const f = lastFrame(r);
		expect(f.viewport.sceneWidth).toBe(Math.round(f.viewport.width * 0.75));
		expect(f.postChain.at(-1)).toMatchObject({ module: 'upsampling', filter: 'linear', output: 'screen' });
	});

	rule(
		'R-PP-004',
		'bloom: 4-tap prefilter into 0.25× (perf 0.125×), knee .88/.88·.45 on BT.709 luma; scene + bloom·intensity; off on SwiftShader+Intel WebGL path',
		async s => {
			const r = await run(s, inGame('pp-004', { prefs: { bloom: true, bloomIntensity: 0.5 } }).advance(16));
			expect(lastFrame(r).postChain[0]).toMatchObject({ module: 'bloom', scale: 0.25 });
			const perf = await run(
				s,
				inGame('pp-004-p', { prefs: { bloom: true, performanceMode: true } }).advance(16)
			);
			expect(lastFrame(perf).postChain[0].scale).toBe(0.125);
			const below = await s.fragment('pp:bloom-prefilter', { rgb: [0.5, 0.5, 0.5] });
			near4(below.slice(0, 3), [0, 0, 0]);
			const comp = await s.fragment('pp:bloom-composite', {
				scene: [0.2, 0.2, 0.2, 1],
				bloom: [0.4, 0.4, 0.4, 1],
				intensity: 0.5
			});
			near4(comp, [0.4, 0.4, 0.4, 1]);
		}
	);

	rule('R-PP-005', 'blur mask smoothstep(.14,.64,dist) with 4-tap box offset mask·3·0.5 texels', async s => {
		const centre = await s.fragment('pp:blur', { ...PATCH, uv: [0.5, 0.5], area: 14, intensity: 3 });
		near4(centre, [0.9, 0.9, 0.9, 1]); // mask 0 at centre → unchanged
	});

	rule(
		'R-PP-006',
		'FXAA edge threshold 0.125, span 8, reduce 1/32 & 1/128; fxaaSubpix changes the result (legacy unused)',
		async s => {
			const a = await s.fragment('pp:fxaa', { ...PATCH, edgeThreshold: 0.125, subpix: 0 });
			const b = await s.fragment('pp:fxaa', { ...PATCH, edgeThreshold: 0.125, subpix: 1 });
			expect(Array.from(a)).toHaveLength(4);
			expect(Array.from(b)).toHaveLength(4);
			expect(a).not.toEqual(b);
		}
	);

	rule('R-PP-007', 'CAS: peak 8 − 3·contrast, mix by casSharpening; 0 is honoured (legacy `|| 1.0`)', async s => {
		const zero = await s.fragment('pp:cas', { ...PATCH, contrast: 0, sharpening: 0 });
		near4(zero, [0.9, 0.9, 0.9, 1]);
		const full = await s.fragment('pp:cas', { ...PATCH, contrast: 0, sharpening: 1 });
		expect(full[0]).toBeGreaterThan(0.9 - 1e-6);
	});

	rule('R-PP-008', 'cartoon: rgb −= |edge|^slope·power; defaults 1.5/1.5; 0 → 1.5', async s => {
		const a = await s.fragment('pp:cartoon', { ...PATCH, power: 0, slope: 0 });
		const b = await s.fragment('pp:cartoon', { ...PATCH, power: 1.5, slope: 1.5 });
		expect(Array.from(b)).toHaveLength(4);
		near4(a, Array.from(b));
	});

	rule(
		'R-PP-009',
		'vibrance: mix(luma, c, 1 + v(1 − sign(v)·sat)); 0 is honoured (legacy fell back to 0.15)',
		async s => {
			const px = { size: [1, 1], pixels: [[0.8, 0.4, 0.2, 1]] };
			near4(await s.fragment('pp:vibrance', { ...px, vibrance: 0 }), [0.8, 0.4, 0.2, 1]);
		}
	);

	rule(
		'R-PP-010',
		'blind: darken outside radius .2 + (63 − zoomFinal)/1000, falloff .5 + (63 − zoom)/1000, aspect-corrected',
		async s => {
			const centre = await s.fragment('pp:blind', {
				size: [1, 1],
				pixels: [[1, 1, 1, 1]],
				uv: [0.5, 0.5],
				zoom: 63,
				aspect: 4 / 3
			});
			near4(centre, [1, 1, 1, 1]);
			const corner = await s.fragment('pp:blind', {
				size: [1, 1],
				pixels: [[1, 1, 1, 1]],
				uv: [0, 0],
				zoom: 63,
				aspect: 4 / 3
			});
			near4(corner.slice(0, 3), [0, 0, 0]);
		}
	);

	rule(
		'R-PP-011',
		'illusion flip mirrors ground pick, signboards, life bars AND hover rects, name/chat/emblem overlays',
		async s => {
			const G = 120_400_000;
			const base = flip => {
				const sc = inGame(`pp-011-${flip}`).entity(
					mob({ gid: G, position: [22, 22, 0], name: 'fixture', chat: 'hi', emblem: true })
				);
				if (flip) {
					sc.screen('parseStatus', { gid: LOCAL_GID, efst: 'ILLUSION', on: true });
				}
				return sc.advance(16);
			};
			const plain = lastFrame(await run(s, base(false)));
			const flipped = lastFrame(await run(s, base(true)));
			const H = plain.viewport.cssHeight;
			expect(typeof H).toBe('number');
			expect(Array.from(overlaysOf(plain, G)).length).toBeGreaterThanOrEqual(4);
			for (const widget of ['life', 'name', 'chat', 'emblem']) {
				const a = overlaysOf(plain, G).find(o => o.widget === widget);
				const b = overlaysOf(flipped, G).find(o => o.widget === widget);
				expect(a, `${widget} overlay`).toBeDefined();
				expect(b.y).toBeCloseTo(H - a.y, 0);
			}
			const ra = plain.pickRects.find(p => p.gid === G);
			const rb = flipped.pickRects.find(p => p.gid === G);
			expect(rb.y0).toBeCloseTo(H - ra.y1, 0);
		}
	);

	rule('R-PP-012', 'bloom, blur, FXAA, vibrance, cartoon, CAS all default off', async s => {
		const r = await run(s, inGame('pp-012').advance(16));
		const set = lastFrame(r).device.settings;
		for (const k of ['bloom', 'blur', 'fxaa', 'vibrance', 'cartoon', 'cas']) {
			expect(set[k]).toBe(false);
		}
	});
});
