import { describe, expect, it } from 'vitest';
import {
	ADDITIVE_FAMILIES,
	POISON_TINT,
	depthCorrectedClipZ,
	packSpriteInstance,
	projectSprite,
	spriteVertexClip,
	unpackSpriteInstance,
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
import { chain, invert, rotationX, transformPoint, translation } from '../../src/math.js';

const palette = () => {
	const p = new Uint8Array(1024);
	p.set([255, 0, 255, 255], 5 * 4); // index 5 is exact magenta
	p.set([255, 0, 254, 255], 6 * 4); // near-magenta is kept
	return p;
};

describe('SPR: GPU side', () => {
	it('R-SPR-005: clip z is the depth at the vertical plane through the sprite centre, min-capped unless ignoreDepthMinCap', () => {
		// Legacy-style camera (pitched 45°, yaw 0, so the flattened forward is GL world +Z or −Z).
		const width = 640;
		const height = 480;
		const modelView = chain(translation(0, -1, -40), rotationX(45), translation(-50.5, 0, -50.5));
		const f = 1 / Math.tan((10 * Math.PI) / 180);
		const projection = new Float32Array([f / (width / height), 0, 0, 0, 0, f, 0, 0, 0, 0, -1001 / 999, -1, 0, 0, -2000 / 999, 0]);
		const frame = { modelView, projection, zoom: 40 };
		const record = {
			position: [50, 50, 0.3],
			offset: [0, -40],
			size: [70, 140],
			angle: 0,
			color: [1, 1, 1, 1],
			shadowFactor: 1,
			zIndex: 0,
			depthBias: 0,
			depthCorrection: true,
			ignoreDepthMinCap: false
		};
		const data = new Float32Array(26);
		packSpriteInstance(record, { layer: 0, paletteRow: 0 }, data, 0);
		const inst = unpackSpriteInstance(data);
		const view = projectSprite(modelView, inst.position);
		const viewModel = invert(modelView);
		const eye = transformPoint(viewModel, [0, 0, 0]);
		const toWorld = v => transformPoint(viewModel, v);
		const mul = (m, v) => [0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
		const centre = mul(view, [0, 0, 0, 1]);
		const centreWorld = toWorld(centre);
		const results = [];
		for (const corner of [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]]) {
			const local = [corner[0] * inst.size[0] + inst.offset[0], corner[1] * inst.size[1] - (inst.offset[1] + 0.5), 0, 1];
			const viewPosition = mul(view, local);
			const clip = mul(projection, viewPosition);
			const capped = depthCorrectedClipZ(viewPosition, centre, frame, false);
			const npc = depthCorrectedClipZ(viewPosition, centre, frame, true);
			// Independent geometry: the camera ray through the vertex meets the plane Z = centre Z.
			const v = toWorld(viewPosition);
			const t = (centreWorld[2] - eye[2]) / (v[2] - eye[2]);
			const hit = [0, 1, 2].map(i => eye[i] + t * (v[i] - eye[i]));
			const hitClip = mul(projection, mul(modelView, [...hit, 1]));
			expect(npc / clip[3]).toBeCloseTo(hitClip[2] / hitClip[3], 9);
			expect(capped).toBeCloseTo(Math.min(clip[2], npc), 12);
			results.push({ z: clip[2], npc, capped });
			// The whole vs_main: same x/y as the plain projection, z mapped to WebGPU [0, w].
			const full = spriteVertexClip(corner, inst, frame);
			expect(full[0]).toBeCloseTo(clip[0], 9);
			expect(full[1]).toBeCloseTo(clip[1], 9);
			expect(full[2]).toBeCloseTo((capped + clip[3]) / 2, 9);
			const npcFull = spriteVertexClip(corner, { ...inst, depthFlags: [1, 1] }, frame);
			expect(npcFull[2]).toBeCloseTo((npc + clip[3]) / 2, 9);
			const off = spriteVertexClip(corner, { ...inst, depthFlags: [0, 0], zIndexBias: [150, 0] }, frame);
			expect(off[2]).toBeCloseTo((clip[2] - 1.5 / 40 + clip[3]) / 2, 9);
		}
		// The billboard top leans away from the camera: corrected depth is nearer, the cap keeps it.
		// The bottom leans towards the camera: corrected is farther, the cap keeps the original
		// (and NPCs take the corrected depth outright).
		const [top, , bottom] = results;
		expect(top.npc).toBeLessThan(top.z);
		expect(top.capped).toBe(top.npc);
		expect(bottom.npc).toBeGreaterThan(bottom.z);
		expect(bottom.capped).toBe(bottom.z);
		expect(SHADERS.sprite).toContain('clip.z = select(min(clip.z, corrected_z_base), corrected_z_base, inst.depth_flags.y > 0.5);');
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

	it('R-SPR-014: shader treats index 0 as transparent and bilinearly blends four palette lookups (legacy 2× frame-size step, spec #65)', () => {
		const img = { width: 2, height: 1, data: new Uint8Array([1, 2]) };
		const row = new Uint8Array(1024);
		row.set([255, 0, 0, 255], 4); // index 1 red
		row.set([0, 0, 255, 255], 8); // index 2 blue
		row.set([0, 255, 0, 255], 255 * 4); // index 255 green
		// Legacy uTextSize = 2 × frame size (4×2): taps 1/4 apart, f = fract(uv·4) advances twice per texel.
		// At the texel-1 centre f is 0, so the result is texel 1 alone (no blend).
		expect(samplePaletteBilinear(img, row, 0.5, 0.5)).toEqual([0, 0, 1, 1]);
		// Between texel 0 and 1: f.x = fract(0.375·4) = 0.5 blends red and blue.
		const mid = samplePaletteBilinear(img, row, 0.375, 0.25);
		expect(mid[0]).toBeCloseTo(0.5);
		expect(mid[1]).toBeCloseTo(0);
		expect(mid[2]).toBeCloseTo(0.5);
		expect(mid[3]).toBeCloseTo(1);
		// An explicit record paletteSize (here the frame size itself) replaces the step.
		expect(samplePaletteBilinear(img, row, 0.25, 0.5, [2, 1]).map(v => +v.toFixed(6))).toEqual([0.5, 0, 0.5, 1]);
		// Index 0 is transparent: it blends as (0, 0, 0, 0).
		const holed = samplePaletteBilinear({ width: 2, height: 1, data: new Uint8Array([0, 2]) }, row, 0.375, 0.25);
		expect(holed).toEqual([0, 0, 0.5, 0.5]);
		// Spec #64 (fixed): index 255 shows entry 255, not entry 0.
		expect(samplePaletteBilinear({ width: 1, height: 1, data: new Uint8Array([255]) }, row, 0.25, 0.25)).toEqual([0, 1, 0, 1]);
		// Default step matches the packed instance (legacy entity/weather records pass 2× the frame size).
		const packed = new Float32Array(26);
		packSpriteInstance(
			{ position: [0, 0, 0], offset: [0, 0], size: [1, 1], angle: 0, color: [1, 1, 1, 1], shadowFactor: 1, zIndex: 0, depthBias: 0 },
			{ layer: 0, paletteRow: 0, width: 2, height: 1 },
			packed,
			0
		);
		expect(unpackSpriteInstance(packed).frame).toEqual([2, 1, 4, 2]);
		expect(SHADERS.sprite).toContain('let f = fract(i.uv * i.frame_size.zw);');
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
		// Per record (render-records strLayerDrawFields: fog = scene fog use), scene fog uniforms of the pass.
		expect(SHADERS.str).toContain('if (i.fog > 0.5) {\n    return apply_fog(color, i.pos, frame.fog);');
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
