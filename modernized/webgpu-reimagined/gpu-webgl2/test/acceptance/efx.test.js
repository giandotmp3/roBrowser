import { describe, expect, it } from 'vitest';
import { GL_BLEND_FACTOR, toGlBlend } from '../../src/pipeline/blendMap.js';
import { GLStateCache } from '../../src/pipeline/GLStateCache.js';
import { GL } from '../../src/pipeline/glEnums.js';
import { STR_DEPTH_WRITE, strClipZ, strCorner, strDiscard, strFogUniforms } from '../../src/effects/str.js';
import { ADDITIVE_FAMILIES, effectDepthState, familyBlend, poisonTintQuad } from '../../src/effects/effectState.js';
import { SHADERS } from '../../src/shaders/index.js';
import { createFakeGl } from '../support/fakeGl.js';

describe('R-EFX-008 STR blending', () => {
	// render-records normalised D3DBLEND codes to the unified enum; this backend maps enum → GL.
	const d3d = { 1: 'ZERO', 2: 'ONE', 3: 'SRC_COLOR', 4: 'ONE_MINUS_SRC_COLOR', 5: 'SRC_ALPHA', 6: 'ONE_MINUS_SRC_ALPHA', 7: 'DST_ALPHA', 8: 'ONE_MINUS_DST_ALPHA', 9: 'DST_COLOR', 10: 'ONE_MINUS_DST_COLOR', 11: 'SRC_ALPHA_SATURATE', 14: 'CONSTANT_COLOR', 15: 'ONE_MINUS_CONSTANT_ALPHA' };
	const glFor = { 1: GL.ZERO, 2: GL.ONE, 3: GL.SRC_COLOR, 4: GL.ONE_MINUS_SRC_COLOR, 5: GL.SRC_ALPHA, 6: GL.ONE_MINUS_SRC_ALPHA, 7: GL.DST_ALPHA, 8: GL.ONE_MINUS_DST_ALPHA, 9: GL.DST_COLOR, 10: GL.ONE_MINUS_DST_COLOR, 11: GL.SRC_ALPHA_SATURATE, 14: GL.CONSTANT_COLOR, 15: GL.ONE_MINUS_CONSTANT_ALPHA };
	it.each(Object.keys(d3d))('D3DBLEND %s maps to the matching GL factor', code => {
		expect(GL_BLEND_FACTOR[d3d[code]]).toBe(glFor[code]);
	});
	it('constant factors set the blend constant as run state', () => {
		const gl = createFakeGl();
		new GLStateCache(gl).apply({ blend: { src: 'SRC_ALPHA', dst: 'CONSTANT_COLOR' }, depthTest: true, depthWrite: false, blendConstant: [0.5, 0.5, 0.5, 1] });
		expect(gl.callsTo('blendColor')).toEqual([['blendColor', 0.5, 0.5, 0.5, 1]]);
	});
	it('unknown factors fall back to normal alpha', () => {
		expect(toGlBlend({ src: 'BOGUS', dst: 'ONE' })).toEqual({ src: GL.SRC_ALPHA, dst: GL.ONE_MINUS_SRC_ALPHA });
	});
	it('STR depth write is off', () => {
		expect(STR_DEPTH_WRITE).toBe(false);
	});
});

describe('R-EFX-009 STR billboard', () => {
	it('1/35 world unit per px, pivot 320, Y lowered 0.5 except attachments', () => {
		expect(strCorner([355, 320], false)).toEqual([1, -0.5]);
		expect(strCorner([355, 320], true)).toEqual([1, 0]);
	});
	it('clip z reduced by 0.1; black or zero-alpha texels discarded', () => {
		expect(strClipZ(0.5)).toBeCloseTo(0.4);
		expect(strDiscard([0, 0, 0, 1])).toBe(true);
		expect(strDiscard([1, 0, 0, 0])).toBe(true);
		expect(strDiscard([0.1, 0, 0, 1])).toBe(false);
		expect(SHADERS.strFrag).toContain('discard');
	});
});

describe('R-EFX-010 STR effects obey fog (FLAG fixed; legacy R-EFX-010 never set uFogUse)', () => {
	it('uFogUse follows the scene fog when the record asks for fog', () => {
		const sceneFog = { use: true, near: 240, far: 480, color: [1, 1, 1] };
		expect(strFogUniforms({ fog: true }, sceneFog).use).toBe(true);
		expect(strFogUniforms({ fog: true }, { ...sceneFog, use: false }).use).toBe(false);
		expect(strFogUniforms({ fog: true }, sceneFog).near).toBe(240);
	});
	it('the STR shader applies the shared fog include', () => {
		expect(SHADERS.strFrag).toContain('applyFog(tex * uColor)');
	});
});

describe('R-EFX-013 overlay flag', () => {
	it('overlay disables depth test and correction', () => {
		expect(effectDepthState({ overlay: true, family: '3d' })).toEqual({ depthTest: false, depthWrite: false, depthCorrection: false });
	});
	it('non-overlay tests depth; 2D also writes it', () => {
		expect(effectDepthState({ overlay: false, family: '3d' })).toMatchObject({ depthTest: true, depthWrite: false });
		expect(effectDepthState({ overlay: false, family: '2d' })).toMatchObject({ depthTest: true, depthWrite: true });
	});
});

describe('R-EFX-014 additive effect families', () => {
	it.each(ADDITIVE_FAMILIES)('%s uses SRC_ALPHA, ONE', family => {
		expect(toGlBlend(familyBlend(family))).toEqual({ src: GL.SRC_ALPHA, dst: GL.ONE });
	});
	it('other families use normal alpha', () => {
		expect(toGlBlend(familyBlend('str'))).toEqual({ src: GL.SRC_ALPHA, dst: GL.ONE_MINUS_SRC_ALPHA });
	});
});

describe('R-EFX-018 poison screen tint', () => {
	it('4000×4000 billboard (0.5, 0, 0.5, 0.15) at the player, no depth', () => {
		expect(poisonTintQuad([10, 20, 1])).toEqual({ position: [10, 20, 1], size: [4000, 4000], color: [0.5, 0, 0.5, 0.15], depthTest: false, depthWrite: false });
	});
});
