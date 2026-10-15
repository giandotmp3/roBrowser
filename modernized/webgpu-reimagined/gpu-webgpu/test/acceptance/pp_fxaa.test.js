import { describe, expect, it } from 'vitest';
import { fxaaReference, fxaaSubpixH, fxaaUniforms, POST_DEFAULTS } from '../../src/index.js';
import { SHADERS } from '../../src/shaders/index.js';
import {
	diagonalImage,
	dotImage,
	eachPixel,
	flatImage,
	legacyFxaaFs,
	noiseImage,
	samplerAt,
	stepImage
} from '../support/fxaaImages.js';

const IMAGES = { step: stepImage(), diagonal: diagonalImage(), dot: dotImage(), noise: noiseImage(7) };
const run = (sample, settings) => fxaaReference(sample, fxaaUniforms(settings));

describe('R-PP-006 FXAA: legacy edge path plus the FXAA 3.11 subpixel term (HITL round 2)', () => {
	it.each(Object.keys(IMAGES))(
		'R-PP-006: FIX (legacy R-PP-006 ignored fxaaSubpix; HITL round 2) subpix 0 is identical to legacy FXAA.fs (%s)',
		name => {
			const img = IMAGES[name];
			for (const edgeThreshold of [0.063, 0.125, 0.25]) {
				const settings = { fxaaSubpix: 0, fxaaEdgeThreshold: edgeThreshold };
				expect(eachPixel(img, s => run(s, settings))).toEqual(eachPixel(img, s => legacyFxaaFs(s, edgeThreshold)));
			}
		}
	);

	it('R-PP-006: below the legacy edge threshold the pixel is unchanged for any subpix (HITL round 2)', () => {
		for (const fxaaSubpix of [0, 0.25, 1]) {
			expect(eachPixel(flatImage(), s => run(s, { fxaaSubpix }))).toEqual(flatImage().px);
		}
		// Legacy semantics: range < max(0, lumaMax * fxaaEdgeThreshold) exits early.
		const faint = stepImage();
		faint.px = faint.px.map(c => (c[0] ? [0.5, 0.5, 0.5] : [0.45, 0.45, 0.45]));
		expect(run(samplerAt(faint, 4, 4), { fxaaSubpix: 1, fxaaEdgeThreshold: 0.125 })).toEqual([0.5, 0.5, 0.5]);
	});

	it('R-PP-006: subpixH is the FXAA 3.11 term: lowpass of the 3x3, subpixA..G, squared smoothstep x subpix (HITL round 2)', () => {
		// Isolated pixel: subpixA = 0, subpixB = -1, subpixC = 1 → subpixH = subpix.
		const dot = { m: 1, n: 0, s: 0, w: 0, e: 0, nw: 0, ne: 0, sw: 0, se: 0 };
		expect(fxaaSubpixH(dot, 0.75)).toBe(0.75);
		expect(fxaaSubpixH(dot, 0)).toBe(0);
		// subpixA = 2 + 4 = 6, subpixB = 0.5, range 1 → subpixC = 0.5 → D = 2, E = 0.25, F = 0.5, G = 0.25.
		const half = { m: 0, n: 1, s: 0, w: 0, e: 0, nw: 1, ne: 1, sw: 1, se: 1 };
		expect(fxaaSubpixH(half, 1)).toBeCloseTo(0.25, 12);
		expect(fxaaSubpixH(half, 0.5)).toBeCloseTo(0.125, 12);
		// M equal to the lowpass average → no subpixel blend.
		expect(fxaaSubpixH({ m: 0.5, n: 1, s: 0, w: 1, e: 0, nw: 0.5, ne: 0.5, sw: 0.5, se: 0.5 }, 1)).toBe(0);
	});

	it('R-PP-006: an isolated pixel blends towards its across-edge neighbour by subpixH = fxaaSubpix (HITL round 2)', () => {
		const sample = samplerAt(dotImage(), 2, 2);
		expect(run(sample, { fxaaSubpix: 0 })).toEqual([1, 1, 1]);
		for (const fxaaSubpix of [0.25, 0.5, 0.75, 1]) {
			const out = run(sample, { fxaaSubpix });
			out.forEach(c => expect(c).toBeCloseTo(1 - fxaaSubpix, 12));
		}
		expect(run(sample, POST_DEFAULTS)).toEqual([0.75, 0.75, 0.75]);
	});

	it('R-PP-006: final blend = max(edge blend, subpixH) (HITL round 2)', () => {
		// Diagonal edge: the legacy edge filter already moves each pixel further than subpixH, so it wins.
		const diag = diagonalImage();
		const legacy = eachPixel(diag, s => legacyFxaaFs(s, 0.125));
		expect(legacy).not.toEqual(diag.px);
		expect(eachPixel(diag, s => run(s, POST_DEFAULTS))).toEqual(legacy);
		// Axis-aligned step: legacy leaves it untouched (dir runs along the edge); FXAA 3.11 subpix
		// blends towards the across-edge neighbour. M 0, E 1, NE 1, SE 1 → subpixC = 1/3 → subpixH = (7/27)² x subpix.
		const step = stepImage();
		expect(legacyFxaaFs(samplerAt(step, 3, 4), 0.125)).toEqual([0, 0, 0]);
		const h = (7 / 27) ** 2 * POST_DEFAULTS.fxaaSubpix;
		run(samplerAt(step, 3, 4), POST_DEFAULTS).forEach(c => expect(c).toBeCloseTo(h, 12));
		run(samplerAt(step, 4, 4), POST_DEFAULTS).forEach(c => expect(c).toBeCloseTo(1 - h, 12));
	});

	it('R-PP-006: fxaa.wgsl mirrors the CPU reference (legacy edge path + FXAA 3.11 subpix block) (HITL round 2)', () => {
		const src = SHADERS.FXAA;
		expect(src).toContain('dot(c, vec3f(0.299, 0.587, 0.114))');
		expect(src).toContain('max(u.edge_threshold_min, luma_max * u.edge_threshold)');
		expect(src).toContain('max((nw + ne + sw + se) * u.reduce_mul, u.reduce_min)');
		expect(src).toContain('let subpix_a = (n + s + w + e) * 2.0 + (nw + sw + ne + se);');
		expect(src).toContain('let subpix_b = subpix_a * (1.0 / 12.0) - m;');
		expect(src).toContain('let subpix_d = -2.0 * subpix_c + 3.0;');
		expect(src).toContain('let subpix_g = subpix_f * subpix_f;');
		expect(src).toContain('let subpix_h = subpix_g * u.subpix;');
		expect(src).toContain('max(edge_blend, subpix_h) == edge_blend');
		expect(src).not.toMatch(/mix\(1\.0, contrast/);
	});
});
