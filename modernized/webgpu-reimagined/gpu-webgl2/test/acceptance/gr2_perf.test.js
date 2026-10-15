import { describe, expect, it } from 'vitest';
import { drawEmblemSubmesh, gr2AlphaTest, gr2Light, gr2PassState, gr2Route, prepareEmblem } from '../../src/gr2/gr2.js';
import { worldTextureFilter } from '../../src/residency/mipmaps.js';
import { GL } from '../../src/pipeline/glEnums.js';
import { SHADERS } from '../../src/shaders/index.js';

describe('R-GR2-001 roster and lighting', () => {
	it('only the roster renders in 3D; unlisted or 404 → Poring sprite', () => {
		expect(gr2Route('empelium90_0')).toEqual({ mode: 'gr2', model: 'empelium90_0' });
		expect(gr2Route('somethingelse')).toEqual({ mode: 'sprite', sprite: 'poring' });
		expect(gr2Route('kguardian', false)).toEqual({ mode: 'sprite', sprite: 'poring' });
	});
	it('flag: diffuse 100/255, ambient = Rec.601 grey of map ambient; others 128/255, 127/255', () => {
		const flag = gr2Light('guildflag90_1', [1, 0, 0]);
		expect(flag.diffuse).toBeCloseTo(100 / 255);
		expect(flag.ambient).toBeCloseTo(0.299);
		expect(gr2Light('treasurebox_2', [1, 1, 1])).toEqual({ diffuse: 128 / 255, ambient: 127 / 255 });
	});
});

describe('R-GR2-002 hard alpha test', () => {
	it('alpha < 207/255 discarded, rest opaque', () => {
		expect(gr2AlphaTest(206 / 255)).toBeNull();
		expect(gr2AlphaTest(207 / 255)).toBe(1);
		expect(SHADERS.gr2Frag).toContain('textureSample.a < uAlphaRef');
	});
	it('depth test, write and correction-disable on; blend only when fading; no lightmap pref, no occluder fade', () => {
		expect(gr2PassState(false)).toEqual({ depthTest: true, depthWrite: true, disableDepthCorrection: true, blend: false, lightmapPref: false, occluderFade: false });
		expect(gr2PassState(true).blend).toBe(true);
	});
});

describe('R-GR2-006 guild flag emblem', () => {
	it('quantises to A4R4G4B4, pads 24 → 32, magenta-keys (≥248, <8, ≥248)', () => {
		const src = new Uint8Array(24 * 24 * 4);
		src.set([0x12, 0x34, 0x56, 0xff], 0);
		src.set([248, 7, 250, 255], 4);
		const out = prepareEmblem(src);
		expect(out.width).toBe(32);
		expect(out.height).toBe(32);
		expect(Array.from(out.data.slice(0, 8))).toEqual([0x11, 0x33, 0x55, 0xff, 0, 0, 0, 0]);
	});
	it('emblem submesh is skipped until loaded', () => {
		expect(drawEmblemSubmesh(false)).toBe(false);
		expect(drawEmblemSubmesh(true)).toBe(true);
	});
});

describe('R-PERF-003 mipmaps are opt-in', () => {
	it('enableMipmap → LINEAR_MIPMAP_LINEAR + generateMipmap; otherwise LINEAR, no mips', () => {
		expect(worldTextureFilter(true)).toEqual({ min: GL.LINEAR_MIPMAP_LINEAR, mag: GL.LINEAR, generateMipmap: true });
		expect(worldTextureFilter(false)).toEqual({ min: GL.LINEAR, mag: GL.LINEAR, generateMipmap: false });
	});
});
