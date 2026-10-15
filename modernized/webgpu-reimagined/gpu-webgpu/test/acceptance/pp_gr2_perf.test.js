import { describe, expect, it } from 'vitest';
import { createFakeGpu } from '../support/fakeGpu.js';
import {
	POST_DEFAULTS,
	POST_ORDER,
	PipelineSet,
	batchStaticModels,
	blindUniforms,
	bloomComposite,
	bloomSupported,
	bloomUniforms,
	blurMask,
	cartoonApply,
	cartoonUniforms,
	casUniforms,
	fxaaUniforms,
	gr2AlphaTest,
	gr2ModelInfo,
	gr2PipelineState,
	mipLevelCount,
	planPostChain,
	prepareEmblem,
	samplerDescriptor,
	sceneSize,
	shouldDrawSubmesh,
	vibranceApply,
	vibranceUniforms
} from '../../src/index.js';
import { SHADERS } from '../../src/shaders/index.js';

const all = { bloom: true, blur: true, fxaaEnabled: true, casEnabled: true, cartoonEnabled: true, vibranceEnabled: true, performanceMode: true };

describe('PP: post-processing', () => {
	it('R-PP-001: Bloom → Blur → FXAA → CAS → Cartoon → Vibrance → VerticalFlip → Blind → Upsampling; only active run; last writes the screen', () => {
		expect(POST_ORDER).toEqual(['Bloom', 'Blur', 'FXAA', 'CAS', 'Cartoon', 'Vibrance', 'VerticalFlip', 'Blind', 'Upsampling']);
		const full = planPostChain(all, { illusion: true, blind: true });
		expect(full.modules).toEqual(POST_ORDER);
		const some = planPostChain({ fxaaEnabled: true, vibranceEnabled: true });
		expect(some.modules).toEqual(['FXAA', 'Vibrance']);
		expect(some.passes.map(p => p.output)).toEqual(['pingA', 'swapchain']);
		for (const m of POST_ORDER) {
			expect(SHADERS[m]).toContain('fn fs_main');
		}
	});

	it('R-PP-002: no active module -> resolved scene goes straight to the screen; otherwise rgba8unorm ping-pong, linear, clamp-to-edge', () => {
		const none = planPostChain({});
		expect(none.directBlit).toBe(true);
		expect(none.passes).toEqual([]);
		const one = planPostChain({ blur: true });
		expect(one.directBlit).toBe(false);
		expect(one.intermediateFormat).toBe('rgba8unorm');
		expect(one.sampler).toMatchObject({ magFilter: 'linear', addressModeU: 'clamp-to-edge' });
	});

	it('R-PP-003: performance mode renders the scene at 0.75× and upsamples (linear) to full size', () => {
		const p = planPostChain({ performanceMode: true });
		expect(p.sceneScale).toBe(0.75);
		expect(p.modules).toEqual(['Upsampling']);
		expect(sceneSize({ width: 1920, height: 1080, performanceMode: true })).toEqual({ width: 1440, height: 810 });
		expect(sceneSize({ width: 1920, height: 1080, performanceMode: false })).toEqual({ width: 1920, height: 1080 });
	});

	it('R-PP-004: bloom 4-tap prefilter at 0.25× (0.125× perf), threshold 0.88, knee 0.88·0.45; composite scene + bloom·intensity', () => {
		expect(bloomUniforms({})).toMatchObject({ threshold: 0.88, downsample: 0.25, tapTexels: 4, intensity: 0.5 });
		expect(bloomUniforms({}).knee).toBeCloseTo(0.396);
		expect(bloomUniforms({ performanceMode: true }).downsample).toBe(0.125);
		expect(bloomComposite([0.5, 0.5, 0.5], [0.2, 0.4, 0], 0.5)).toEqual([0.6, 0.7, 0.5]);
	});

	it('R-PP-004: bloom disabled only on Chrome + SwiftShader + Intel (golden harness may override)', () => {
		const chrome = 'Mozilla/5.0 Chrome/130.0';
		expect(bloomSupported({ vendor: 'intel', description: 'SwiftShader', userAgent: chrome })).toBe(false);
		expect(bloomSupported({ vendor: 'google', description: 'SwiftShader', userAgent: chrome })).toBe(true);
		expect(bloomSupported({ vendor: 'intel', description: 'Iris', userAgent: chrome })).toBe(true);
		expect(bloomSupported({ vendor: 'intel', description: 'SwiftShader', userAgent: 'Firefox/130' })).toBe(true);
		expect(bloomSupported({ vendor: 'intel', description: 'SwiftShader', userAgent: chrome }, { allowSoftwareAdapter: true })).toBe(true);
		expect(planPostChain({ bloom: true }, { bloomAllowed: false }).modules).toEqual([]);
	});

	it('R-PP-005: blur mask = smoothstep(0.14, 0.64, dist from centre); tap offset mask·3·0.5 texels', () => {
		expect(blurMask([0.5, 0.5], { blurArea: 14, blurIntensity: 3 }).mask).toBe(0);
		const edge = blurMask([0.5, 0.5 + 0.64], { blurArea: 14, blurIntensity: 3 });
		expect(edge.mask).toBeCloseTo(1);
		expect(edge.tapOffsetTexels).toBeCloseTo(1.5);
		expect(blurMask([0.5, 0.89], { blurArea: 14, blurIntensity: 3 }).mask).toBeCloseTo(0.5);
	});

	it('R-PP-006: FIX (legacy R-PP-006 uploaded fxaaSubpix but never read it): subpix reaches the shader and is used', () => {
		const u = fxaaUniforms({ fxaaSubpix: 0.75 });
		expect(u).toMatchObject({ edgeThreshold: 0.125, edgeThresholdMin: 0, span: 8, subpix: 0.75 });
		expect(u.reduceMul).toBeCloseTo(1 / 32);
		expect(u.reduceMin).toBeCloseTo(1 / 128);
		expect(SHADERS.FXAA).toMatch(/mix\(1\.0, contrast, u\.subpix\)/);
	});

	it('R-PP-007: FIX (legacy R-PP-007 `|| 1.0` made sharpening 0 impossible): casSharpening 0 is honoured; peak = 8 − 3·contrast', () => {
		expect(casUniforms({ casSharpening: 0, casContrast: 0 })).toEqual({ peak: 8, sharpening: 0 });
		expect(casUniforms({ casContrast: 1 }).peak).toBe(5);
		expect(casUniforms({}).sharpening).toBe(1.0);
	});

	it('R-PP-008: rgb −= |edge|^slope·power; defaults 1.5/1.5 and 0 falls back to 1.5', () => {
		expect(cartoonUniforms({})).toEqual({ power: 1.5, edgeSlope: 1.5 });
		expect(cartoonUniforms({ cartoonPower: 0, cartoonEdgeSlope: 0 })).toEqual({ power: 1.5, edgeSlope: 1.5 });
		const out = cartoonApply([1, 1, 1], 0.5, { power: 1.5, edgeSlope: 2 });
		expect(out[0]).toBeCloseTo(1 - 0.25 * 1.5);
	});

	it('R-PP-009: FIX (legacy R-PP-009 `||` turned vibrance 0 into 0.15): vibrance 0 is honoured and is the identity', () => {
		expect(vibranceUniforms({ vibrance: 0 })).toEqual({ vibrance: 0, balance: [1, 1, 1] });
		expect(vibranceUniforms({}).vibrance).toBe(0.15);
		const c = [0.8, 0.4, 0.2];
		vibranceApply(c, 0).forEach((v, i) => expect(v).toBeCloseTo(c[i]));
		const boosted = vibranceApply(c, 0.5);
		expect(boosted[0]).toBeGreaterThan(c[0]);
	});

	it('R-PP-010: blind radius 0.2 + (63 − zoom)/1000, falloff 0.5 + (63 − zoom)/1000, aspect-corrected', () => {
		const u = blindUniforms({ zoomFinal: 125, width: 1920, height: 1080 });
		expect(u.radius).toBeCloseTo(0.2 - 0.062);
		expect(u.falloff).toBeCloseTo(0.5 - 0.062);
		expect(u.aspect).toBeCloseTo(1920 / 1080);
		expect(planPostChain({}, { blind: true }).modules).toEqual(['Blind']);
	});

	it('R-PP-012: bloom, blur, FXAA, vibrance, cartoon and CAS default to off', () => {
		expect(POST_DEFAULTS).toMatchObject({ bloom: false, blur: false, fxaaEnabled: false, vibranceEnabled: false, cartoonEnabled: false, casEnabled: false });
		expect(planPostChain({}).modules).toEqual([]);
	});
});

describe('GR2: draw side', () => {
	it('R-GR2-001: only the roster draws in 3D; flag lit 100/255 + Rec.601 ambient, others 128/255 and 127/255; else Poring', () => {
		const flag = gr2ModelInfo('guildflag90_1', [1, 0, 0]);
		expect(flag.diffuse).toBeCloseTo(100 / 255);
		expect(flag.ambient[0]).toBeCloseTo(0.299);
		const emp = gr2ModelInfo('empelium90_0', [1, 1, 1]);
		expect(emp).toMatchObject({ draw3d: true });
		expect(emp.diffuse).toBeCloseTo(128 / 255);
		expect(emp.ambient[1]).toBeCloseTo(127 / 255);
		for (const m of ['kguardian', 'aguardian', 'sguardian', 'treasurebox_2']) {
			expect(gr2ModelInfo(m, [0, 0, 0]).draw3d).toBe(true);
		}
		expect(gr2ModelInfo('somethingelse', [0, 0, 0])).toEqual({ draw3d: false, fallbackSprite: 'poring' });
		expect(gr2ModelInfo('kguardian', [0, 0, 0], { loaded: false }).draw3d).toBe(false);
	});

	it('R-GR2-002: alpha < 207/255 discarded, rest opaque; depth test+write, correction off; blend only while fading', () => {
		expect(gr2AlphaTest([1, 1, 1, 206 / 255])).toBeNull();
		expect(gr2AlphaTest([1, 0.5, 0, 207 / 255])).toEqual([1, 0.5, 0, 1]);
		expect(gr2PipelineState(1)).toEqual({ depthTest: true, depthWrite: true, depthCorrection: false, blend: 'none' });
		expect(gr2PipelineState(0.5).blend).toBe('normal');
		expect(SHADERS.gr2).toContain('207.0 / 255.0');
		expect(SHADERS.gr2).not.toContain('apply_fog');
	});

	it('R-GR2-006: emblem magenta-keyed (≥248, <8, ≥248), A4R4G4B4-quantised, top-left in a 32×32 pad; submesh waits for it', () => {
		const src = new Uint8Array(24 * 24 * 4).fill(255);
		src.set([250, 7, 250, 255], 0); // keyed
		src.set([0x37, 0x8f, 0xf0, 0xff], 4); // quantised
		const out = prepareEmblem(src);
		expect(out.length).toBe(32 * 32 * 4);
		expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0]);
		expect([...out.slice(4, 8)]).toEqual([0x33, 0x88, 0xff, 0xff]);
		expect([...out.slice(24 * 4, 25 * 4)]).toEqual([0, 0, 0, 0]); // padding column
		expect(shouldDrawSubmesh({ isEmblem: true }, false)).toBe(false);
		expect(shouldDrawSubmesh({ isEmblem: true }, true)).toBe(true);
		expect(shouldDrawSubmesh({ isEmblem: false }, false)).toBe(true);
	});
});

describe('PERF: GPU side', () => {
	it('R-PERF-003: enableMipmap adds linear-mipmap filtering and a full mip chain; otherwise one level, linear', () => {
		expect(mipLevelCount(256, 256, false)).toBe(1);
		expect(mipLevelCount(256, 256, true)).toBe(9);
		expect(samplerDescriptor({ kind: 'world', enableMipmap: true })).toMatchObject({ minFilter: 'linear', mipmapFilter: 'linear' });
		expect(samplerDescriptor({ kind: 'world', enableMipmap: false })).toMatchObject({ minFilter: 'linear', mipmapFilter: 'nearest' });
	});

	it('R-PERF-004: static RSM draws merge per texture over contiguous ranges once all textures load', () => {
		const infos = [
			{ texture: 'a', vertOffset: 0, vertCount: 3 },
			{ texture: 'a', vertOffset: 3, vertCount: 6 },
			{ texture: 'b', vertOffset: 9, vertCount: 3 },
			{ texture: 'b', vertOffset: 15, vertCount: 3 }
		];
		expect(batchStaticModels(infos, false)).toHaveLength(4);
		expect(batchStaticModels(infos, true)).toEqual([
			{ texture: 'a', first: 0, count: 9 },
			{ texture: 'b', first: 9, count: 3 },
			{ texture: 'b', first: 15, count: 3 }
		]);
	});

	it('Arch M2 (not a contract rule): pipelines precompile from the census and an uncompiled pair falls back to normal alpha for that frame', async () => {
		const fake = createFakeGpu({ compileDelay: d => d.label.includes('DST_COLOR') });
		const set = new PipelineSet(fake.device, () => ({ module: {}, layout: 'auto' }));
		const base = { family: 'str', depthTest: true, depthWrite: false };
		await set.precompile([{ ...base, blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' } }, { ...base, blend: { src: 'SRC_ALPHA', dst: 'ONE' } }]);
		await Promise.resolve();
		expect(set.get({ ...base, blend: { src: 'SRC_ALPHA', dst: 'ONE' } }).fellBack).toBe(false);
		const r = set.get({ ...base, blend: { src: 'DST_COLOR', dst: 'ZERO' } });
		expect(r.fellBack).toBe(true);
		expect(r.pipeline.desc.fragment.targets[0].blend.color.dstFactor).toBe('one-minus-src-alpha');
	});
});
