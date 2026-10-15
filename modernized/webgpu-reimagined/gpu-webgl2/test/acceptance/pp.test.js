import { describe, expect, it } from 'vitest';
import {
	activeChain,
	blindUniforms,
	bloomParams,
	blurMask,
	cartoonUniforms,
	casUniforms,
	fxaaReference,
	fxaaSubpixH,
	fxaaUniforms,
	POST_DEFAULTS,
	sceneTarget,
	vibranceChannel,
	vibranceUniforms
} from '../../src/post/PostChain.js';
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

describe('R-PP-001 module order', () => {
	it('Bloom → Blur → FXAA → CAS → Cartoon → Vibrance → VerticalFlip → Blind → Upsampling; last active writes to screen', () => {
		const all = Object.fromEntries(['bloom', 'blur', 'fxaa', 'cas', 'cartoon', 'vibrance', 'verticalFlip', 'blind', 'upsampling'].map(n => [n, true]));
		expect(activeChain(all).map(m => m.name)).toEqual(['bloom', 'blur', 'fxaa', 'cas', 'cartoon', 'vibrance', 'verticalFlip', 'blind', 'upsampling']);
		expect(activeChain({ vibrance: true, fxaa: true })).toEqual([
			{ name: 'fxaa', toScreen: false },
			{ name: 'vibrance', toScreen: true }
		]);
	});
});

describe('R-PP-002 scene target', () => {
	it('no active module → straight to screen', () => {
		expect(sceneTarget({ width: 800, height: 600, anyActive: false, performanceMode: false })).toEqual({ toScreen: true, width: 800, height: 600 });
	});
	it('otherwise RGB8 + DEPTH16, linear, clamp-to-edge, ping-pong', () => {
		expect(sceneTarget({ width: 800, height: 600, anyActive: true, performanceMode: false })).toMatchObject({ toScreen: false, color: 'RGB8', depth: 'DEPTH_COMPONENT16', filter: 'LINEAR', wrap: 'CLAMP_TO_EDGE', pingPong: true });
	});
});

describe('R-PP-003 performance-mode resolution', () => {
	it('scene at 0.75× and upsampled back', () => {
		expect(sceneTarget({ width: 800, height: 600, anyActive: false, performanceMode: true })).toMatchObject({ width: 600, height: 450, upsample: true });
	});
});

describe('R-PP-004 bloom', () => {
	it('threshold 0.88, knee 0.88·0.45, 0.25× buffer (0.125× perf), 4-texel taps', () => {
		expect(bloomParams({ intensity: 0.5, performanceMode: false, rendererString: 'ANGLE (NVIDIA)' })).toEqual({ enabled: true, intensity: 0.5, threshold: 0.88, knee: 0.88 * 0.45, downsample: 0.25, tapTexels: 4 });
		expect(bloomParams({ intensity: 0.5, performanceMode: true, rendererString: '' }).downsample).toBe(0.125);
	});
	it('disabled on SwiftShader + Intel', () => {
		expect(bloomParams({ intensity: 0.5, performanceMode: false, rendererString: 'ANGLE (Intel, SwiftShader Device)' }).enabled).toBe(false);
	});
});

describe('R-PP-005 peripheral blur', () => {
	it('mask = smoothstep(0.14, 0.64, d); offset = mask·intensity·0.5', () => {
		expect(blurMask(0.1, 3)).toEqual({ mask: 0, offsetTexels: 0 });
		expect(blurMask(0.7, 3)).toEqual({ mask: 1, offsetTexels: 1.5 });
	});
});

describe('R-PP-006 FXAA (FLAG fixed, HITL round 2: legacy edge path + FXAA 3.11 subpixel term)', () => {
	const run = (sample, settings) => fxaaReference(sample, fxaaUniforms({ ...POST_DEFAULTS, ...settings }));
	const IMAGES = { step: stepImage(), diagonal: diagonalImage(), dot: dotImage(), noise: noiseImage(7) };

	it('edge threshold from settings, min 0, span 8, reduce 1/32 and 1/128; subpix consumed', () => {
		expect(fxaaUniforms(POST_DEFAULTS)).toEqual({ edgeThreshold: 0.125, edgeThresholdMin: 0, span: 8, reduceMul: 1 / 32, reduceMin: 1 / 128, subpix: 0.25, subpixUsed: true });
	});

	it.each(Object.keys(IMAGES))('subpix 0 is identical to legacy FXAA.fs (%s)', name => {
		const img = IMAGES[name];
		for (const edgeThreshold of [0.063, 0.125, 0.25]) {
			const settings = { fxaaSubpix: 0, fxaaEdgeThreshold: edgeThreshold };
			expect(eachPixel(img, s => run(s, settings))).toEqual(eachPixel(img, s => legacyFxaaFs(s, edgeThreshold)));
		}
	});

	it('below the legacy edge threshold the pixel is unchanged for any subpix', () => {
		for (const fxaaSubpix of [0, 0.25, 1]) {
			expect(eachPixel(flatImage(), s => run(s, { fxaaSubpix }))).toEqual(flatImage().px);
		}
		const faint = stepImage();
		faint.px = faint.px.map(c => (c[0] ? [0.5, 0.5, 0.5] : [0.45, 0.45, 0.45]));
		expect(run(samplerAt(faint, 4, 4), { fxaaSubpix: 1 })).toEqual([0.5, 0.5, 0.5]);
	});

	it('subpixH is the FXAA 3.11 term: 3x3 lowpass, subpixA..G, squared smoothstep x subpix', () => {
		const dot = { m: 1, n: 0, s: 0, w: 0, e: 0, nw: 0, ne: 0, sw: 0, se: 0 };
		expect(fxaaSubpixH(dot, 0.75)).toBe(0.75);
		expect(fxaaSubpixH(dot, 0)).toBe(0);
		const half = { m: 0, n: 1, s: 0, w: 0, e: 0, nw: 1, ne: 1, sw: 1, se: 1 };
		expect(fxaaSubpixH(half, 1)).toBeCloseTo(0.25, 12);
		expect(fxaaSubpixH({ m: 0.5, n: 1, s: 0, w: 1, e: 0, nw: 0.5, ne: 0.5, sw: 0.5, se: 0.5 }, 1)).toBe(0);
	});

	it('an isolated pixel blends towards its across-edge neighbour by subpixH = fxaaSubpix', () => {
		const sample = samplerAt(dotImage(), 2, 2);
		expect(run(sample, { fxaaSubpix: 0 })).toEqual([1, 1, 1]);
		for (const fxaaSubpix of [0.25, 0.5, 0.75, 1]) {
			run(sample, { fxaaSubpix }).forEach(c => expect(c).toBeCloseTo(1 - fxaaSubpix, 12));
		}
	});

	it('final blend = max(edge blend, subpixH)', () => {
		const diag = diagonalImage();
		expect(eachPixel(diag, s => run(s, {}))).toEqual(eachPixel(diag, s => legacyFxaaFs(s, 0.125)));
		const h = (7 / 27) ** 2 * POST_DEFAULTS.fxaaSubpix;
		run(samplerAt(stepImage(), 3, 4), {}).forEach(c => expect(c).toBeCloseTo(h, 12));
	});

	it('fxaa.frag mirrors the CPU reference (legacy edge path + FXAA 3.11 subpix block)', () => {
		const src = SHADERS.fxaaFrag;
		expect(src).toContain('dot(c, vec3(0.299, 0.587, 0.114))');
		expect(src).toContain('max(uEdgeThresholdMin, lumaMax * uEdgeThreshold)');
		expect(src).toContain('max((nw + ne + sw + se) * uReduceMul, uReduceMin)');
		expect(src).toContain('float subpixA = (n + s + w + e) * 2.0 + (nw + sw + ne + se);');
		expect(src).toContain('float subpixB = subpixA * (1.0 / 12.0) - m;');
		expect(src).toContain('float subpixD = -2.0 * subpixC + 3.0;');
		expect(src).toContain('float subpixG = subpixF * subpixF;');
		expect(src).toContain('float subpixH = subpixG * uSubpix;');
		expect(src).toContain('max(edgeBlend, subpixH) == edgeBlend');
	});
});

describe('R-PP-007 CAS (FLAG fixed; legacy R-PP-007 could not set sharpening 0)', () => {
	it('peak = 8 − 3·contrast; sharpening 0 honoured', () => {
		expect(casUniforms({ casContrast: 1, casSharpening: 0 })).toEqual({ peak: 5, sharpening: 0 });
	});
});

describe('R-PP-008 cartoon', () => {
	it('defaults 1.5/1.5; 0 falls back to 1.5', () => {
		expect(cartoonUniforms({ cartoonPower: 0, cartoonEdgeSlope: 2 })).toEqual({ power: 1.5, edgeSlope: 2 });
	});
});

describe('R-PP-009 vibrance (FLAG fixed; legacy R-PP-009 could not set 0)', () => {
	it('vibrance 0 honoured and is the identity', () => {
		expect(vibranceUniforms({ vibranceValue: 0 }).vibrance).toBe(0);
		expect(vibranceChannel(0.7, 0.4, 0, 0.5)).toBeCloseTo(0.7);
	});
	it('mix(luma, c, 1 + v·(1 − sign(v)·sat)), balance (1,1,1), unset falls back to 0.15', () => {
		expect(vibranceUniforms({})).toEqual({ vibrance: 0.15, balance: [1, 1, 1] });
		expect(vibranceChannel(0.7, 0.4, 0.5, 0.2)).toBeCloseTo(0.4 + 0.3 * 1.4);
	});
});

describe('R-PP-010 blind status', () => {
	it('radius 0.2 + (63 − zoom)/1000, falloff 0.5 + (63 − zoom)/1000, aspect-corrected', () => {
		const u = blindUniforms({ zoomFinal: 125, aspect: 16 / 9, blinded: true });
		expect(u.radius).toBeCloseTo(0.2 - 0.062);
		expect(u.falloff).toBeCloseTo(0.5 - 0.062);
		expect(u.aspect).toBeCloseTo(16 / 9);
		expect(u.active).toBe(true);
	});
});

describe('R-PP-012 post-process defaults', () => {
	it('bloom, blur, FXAA, vibrance, cartoon and CAS default off', () => {
		for (const k of ['bloom', 'blur', 'fxaa', 'vibrance', 'cartoon', 'cas']) {
			expect(POST_DEFAULTS[k]).toBe(false);
		}
		expect(activeChain(POST_DEFAULTS)).toEqual([]);
	});
});
