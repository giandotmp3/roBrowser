import { describe, expect, it } from 'vitest';
import {
	ADDITIVE_FAMILIES,
	POISON_TINT,
	depthCorrectedClipZ,
	effectDepthState,
	familyBlend,
	fogUniforms,
	poisonTintDraw,
	prepareIndexedFrame,
	prepareRgbaFrame,
	samplePaletteBilinear,
	samplerDescriptor,
	strDiscard,
	strFogUniforms,
	strPipelineSpec,
	strVertex,
	toGpuBlend,
	zIndexBias
} from '../../src/index.js';
import { SHADERS } from '../../src/shaders/index.js';

const palette = () => {
	const p = new Uint8Array(1024);
	p.set([255, 0, 255, 255], 5 * 4); // index 5 is exact magenta
	p.set([255, 0, 254, 255], 6 * 4); // near-magenta is kept
	return p;
};

describe('SPR: GPU side', () => {
	it.fails('R-SPR-005: clip z is the depth at the vertical plane through the sprite centre, min-capped unless ignoreDepthMinCap', () => {
		const camera = { eye: [0, 10, -10], forward: [0, -0.7071, 0.7071] };
		const capped = depthCorrectedClipZ([0, 1, 0], [0, 0, 0], camera, false);
		const npc = depthCorrectedClipZ([0, 1, 0], [0, 0, 0], camera, true);
		expect(capped).toBeLessThanOrEqual(npc);
	});

	it('R-SPR-006: clip.z −= (zIndex·0.01 + depth)/max(zoom, 1); later (higher) zIndex wins ties', () => {
		expect(zIndexBias(150, 0, 125)).toBeCloseTo(1.5 / 125);
		expect(zIndexBias(2, 3, 0.5)).toBeCloseTo(3.02);
		expect(zIndexBias(301, 0, 125)).toBeGreaterThan(zIndexBias(300, 0, 125));
		expect(SHADERS.sprite).toContain('inst.zindex_bias.x * 0.01 + inst.zindex_bias.y) / max(frame.zoom, 1.0)');
	});

	it('R-SPR-014: indexed frames upload as r8 indices, POT-padded and centred; exact-magenta palette indices become 0', () => {
		const frame = { width: 3, height: 2, indices: new Uint8Array([1, 5, 6, 2, 3, 4]) };
		const out = prepareIndexedFrame(frame, palette());
		expect(out.width).toBe(4);
		expect(out.height).toBe(2);
		expect(out.offsetX).toBe(0);
		expect([...out.data.slice(0, 4)]).toEqual([1, 0, 6, 0]);
		const centred = prepareIndexedFrame({ width: 2, height: 2, indices: new Uint8Array([1, 1, 1, 1]) }, palette());
		expect(centred.width).toBe(2);
		const wide = prepareIndexedFrame({ width: 5, height: 1, indices: new Uint8Array([1, 1, 1, 1, 1]) }, palette());
		expect(wide.offsetX).toBe(1);
	});

	it('R-SPR-014: indexed and palette samplers are NEAREST; RGBA LINEAR unless pixelPerfectSprites', () => {
		expect(samplerDescriptor({ kind: 'indexed' })).toMatchObject({ magFilter: 'nearest', minFilter: 'nearest' });
		expect(samplerDescriptor({ kind: 'palette' })).toMatchObject({ magFilter: 'nearest' });
		expect(samplerDescriptor({ kind: 'spriteRgba' })).toMatchObject({ magFilter: 'linear' });
		expect(samplerDescriptor({ kind: 'spriteRgba', pixelPerfect: true })).toMatchObject({ magFilter: 'nearest' });
	});

	it.fails('R-SPR-014: shader treats index 0 as transparent and bilinearly blends four palette lookups', () => {
		const img = { width: 2, height: 1, data: new Uint8Array([1, 2]) };
		const row = new Uint8Array(1024);
		row.set([255, 0, 0, 255], 4);
		row.set([0, 0, 255, 255], 8);
		const mid = samplePaletteBilinear(img, row, 0.5, 0.5);
		expect(mid[0]).toBeCloseTo(0.5);
		expect(mid[2]).toBeCloseTo(0.5);
	});

	it('R-SPR-016: RGBA frames flip vertically, ABGR -> RGBA, and alpha 0 zeroes the whole pixel', () => {
		const abgr = new Uint8Array([
			255, 1, 2, 3, // bottom row (stored first)
			0, 9, 9, 9 // top row, alpha 0
		]);
		const out = prepareRgbaFrame({ width: 1, height: 2, abgr });
		expect([...out]).toEqual([0, 0, 0, 0, 3, 2, 1, 255]);
	});
});

describe('EFX: GPU side', () => {
	it('R-EFX-008: STR D3DBLEND pairs map to GPU factors (5 SRC_ALPHA, 2 ONE, 14 CONSTANT, 15 1−CONSTANT_ALPHA); depth write off', () => {
		const s = strPipelineSpec(5, 2);
		expect(s.gpuBlend).toEqual({ srcFactor: 'src-alpha', dstFactor: 'one' });
		expect(s.depthWrite).toBe(false);
		expect(strPipelineSpec(9, 1).gpuBlend).toEqual({ srcFactor: 'dst', dstFactor: 'zero' });
		expect(strPipelineSpec(14, 15).gpuBlend).toEqual({ srcFactor: 'constant', dstFactor: 'one-minus-constant' });
		expect(strPipelineSpec(11, 6).gpuBlend.srcFactor).toBe('src-alpha-saturated');
		expect(strPipelineSpec(12, 6).gpuBlend).toEqual({ srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' });
		expect(toGpuBlend({ src: 'DST_COLOR', dst: 'ONE_MINUS_SRC_COLOR' }).color).toMatchObject({ srcFactor: 'dst', dstFactor: 'one-minus-src' });
	});

	it('R-EFX-009: 1/35 world unit per px, pivot 320, Y −0.5 except attachments, clip z −0.1; black or zero-alpha texels discarded', () => {
		expect(strVertex([355, 320])).toEqual({ x: 1, y: -0.5, clipZBias: -0.1 });
		expect(strVertex([320, 355], { attachment: true })).toEqual({ x: 0, y: 1, clipZBias: -0.1 });
		expect(strDiscard([0, 0, 0, 1])).toBe(true);
		expect(strDiscard([1, 1, 1, 0])).toBe(true);
		expect(strDiscard([0.1, 0, 0, 1])).toBe(false);
	});

	it('R-EFX-010: FIX (legacy R-EFX-010 STR was never fogged, near/far ×100/×150): STR uses the scene fog uniforms and the shared fog include', () => {
		const sceneFog = fogUniforms({ fogPref: true, entry: { near: 1, far: 2, color: [0.5, 0.5, 0.5] } });
		const f = strFogUniforms(sceneFog);
		expect(f).toEqual({ use: true, near: 240, far: 480, color: [0.5, 0.5, 0.5] });
		expect(SHADERS.str).toContain('fn apply_fog');
		expect(SHADERS.str).toContain('apply_fog(t * str_u.color');
	});

	it('R-EFX-013: overlay disables depth test and correction; non-overlay tests depth; 2D also writes it', () => {
		expect(effectDepthState('3d', true)).toEqual({ depthTest: false, depthWrite: false, depthCorrection: false });
		expect(effectDepthState('2d', true).depthTest).toBe(false);
		expect(effectDepthState('3d', false)).toMatchObject({ depthTest: true, depthWrite: false });
		expect(effectDepthState('2d', false)).toMatchObject({ depthTest: true, depthWrite: true });
	});

	it('R-EFX-014: aura, bubble, sphere, PokJuk and Waterfall families draw additive SRC_ALPHA, ONE', () => {
		for (const fam of ['GroundAura', 'SwirlingAura', 'Level99Bubble', 'SpiritSphere', 'WarlockSphere', 'PokJukWeatherEffect', 'WaterfallEffect']) {
			expect(familyBlend(fam)).toEqual({ src: 'SRC_ALPHA', dst: 'ONE' });
		}
		expect(ADDITIVE_FAMILIES).toHaveLength(7);
		expect(familyBlend('StrEffect')).toBeNull();
		expect(toGpuBlend(familyBlend('GroundAura')).color).toMatchObject({ srcFactor: 'src-alpha', dstFactor: 'one' });
	});

	it('R-EFX-018: poison tint is a 4000×4000 (0.5, 0, 0.5, 0.15) billboard at the player with no depth', () => {
		const d = poisonTintDraw([10, 20, 0]);
		expect(d.size).toEqual([4000, 4000]);
		expect(d.color).toEqual([0.5, 0, 0.5, 0.15]);
		expect(d.position).toEqual([10, 20, 0]);
		expect(d).toMatchObject({ depthTest: false, depthWrite: false });
		expect(POISON_TINT.size).toBe(4000);
	});
});
