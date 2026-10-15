import { describe, expect, it } from 'vitest';
import { applyFog, fogUniforms } from '../../src/world/fog.js';
import { composeGroundAtlas, groundAtlasLayout, lightmapBlockUV, lightmapColor, shadeGround, tileColorRgba } from '../../src/world/ground.js';
import { hasWaterQuad, waterAlpha, waterFrameIndex, waterParamsFromRsw, waterQuadVertices, waterUV, waveOffset, waveY, WATER_PASS_STATE } from '../../src/world/water.js';
import { batchStaticModels, computeRsmNormals, MODEL_PASS_STATE, normalMode, rsmAlpha, rsmInstanceMatrix, shadeModel } from '../../src/world/models.js';
import { alphaModeOpaqueDiscard, ditherDiscard, FADED_PASS_STATE, OccluderFade, occluderFadeActive, occluderVisibility, queryKeepsFragment } from '../../src/world/occluderFade.js';
import { GRID_MATERIAL, selectorQuads } from '../../src/world/gridSelector.js';
import { cloudAlpha, cloudDrift, CLOUD_PASS_STATE, spawnCloud } from '../../src/world/clouds.js';
import { applyMagentaKey, potStretchSize } from '../../src/residency/imageKey.js';
import { chain, deg2rad, rotationX, rotationY, rotationZ, scaling, translation } from '../../src/math.js';
import { SHADERS } from '../../src/shaders/index.js';

const light = { dir: [0, 1, 0], diffuse: [1, 1, 1], ambient: [0, 0, 0], env: [1, 1, 1] };

describe('R-MAP-001 ground shading', () => {
	it('tex · tileColor · clamp(N·L·D + A) · clamp(env), then lightmap shadow × + additive rgb', () => {
		const out = shadeGround({
			tex: [1, 1, 1, 1],
			tileColor: [0.5, 1, 1],
			tileUV: [0.2, 0.2],
			normal: [0, 1, 0],
			light: { dir: [0, 1, 0], diffuse: [0.5, 0.5, 0.5], ambient: [0.25, 0.25, 0.25], env: [1, 1, 1] },
			lightmap: [0, 0, 0, 0.5],
			lightmapPref: true,
			smoothlight: 1
		});
		expect(out[0]).toBeCloseTo(0.5 * 0.75 * 0.5);
		expect(out[1]).toBeCloseTo(0.75 * 0.5);
	});
	it('skips tile colour when its UV is (0,0)', () => {
		const out = shadeGround({ tex: [1, 1, 1, 1], tileColor: [0, 0, 0], tileUV: [0, 0], normal: [0, 1, 0], light, lightmap: null, lightmapPref: false, smoothlight: 0 });
		expect(out).toEqual([1, 1, 1, 1]);
	});
});

describe('R-MAP-002 lightmap quality preference', () => {
	it('smoothlight 0 posterises to 16 levels', () => {
		expect(lightmapColor([100 / 255], 0)[0]).toBeCloseTo(96 / 255);
	});
	it('smoothlight 1 is raw, 2 is pow 1.1', () => {
		expect(lightmapColor([0.5], 1)[0]).toBe(0.5);
		expect(lightmapColor([0.5], 2)[0]).toBeCloseTo(Math.pow(0.5, 1.1));
	});
	it('lightmap preference off removes the whole term', () => {
		const out = shadeGround({ tex: [1, 1, 1, 1], tileColor: [1, 1, 1], tileUV: [0, 0], normal: [0, 1, 0], light, lightmap: [1, 1, 1, 0], lightmapPref: false, smoothlight: 0 });
		expect(out).toEqual([1, 1, 1, 1]);
	});
});

describe('R-MAP-003 ground alpha cutout', () => {
	it('discards texels with alpha < 0.1', () => {
		const base = { tileColor: [1, 1, 1], tileUV: [0, 0], normal: [0, 1, 0], light, lightmap: null, lightmapPref: false, smoothlight: 0 };
		expect(shadeGround({ ...base, tex: [1, 1, 1, 0.09] })).toBeNull();
		expect(shadeGround({ ...base, tex: [1, 1, 1, 0.1] })).not.toBeNull();
		expect(SHADERS.groundFrag).toContain('tex.a < 0.1');
	});
});

describe('R-MAP-004 fog formula', () => {
	it('near/far are DB ×240; no entry or pref off → no fog', () => {
		expect(fogUniforms({ near: 1, far: 2, color: [1, 0, 0] }, true)).toEqual({ use: true, near: 240, far: 480, color: [1, 0, 0] });
		expect(fogUniforms(undefined, true).use).toBe(false);
		expect(fogUniforms({ near: 1, far: 2, color: [1, 0, 0] }, false).use).toBe(false);
	});
	it('mix(rgb, fogColor, smoothstep(near, far, depth)) with alpha preserved', () => {
		const fog = fogUniforms({ near: 1, far: 2, color: [1, 1, 1] }, true);
		expect(applyFog([0, 0, 0, 0.3], 480, fog)).toEqual([1, 1, 1, 0.3]);
		expect(applyFog([0, 0, 0, 0.3], 100, fog)).toEqual([0, 0, 0, 0.3]);
	});
	it('one shared include is spliced into ground, sprite, model, water and STR shaders', () => {
		for (const src of [SHADERS.groundFrag, SHADERS.spriteFrag, SHADERS.modelsFrag, SHADERS.waterFrag, SHADERS.strFrag]) {
			expect(src).toContain('smoothstep(uFogNear, uFogFar, depth)');
			expect(src).not.toContain('#include');
		}
	});
});

describe('R-MAP-005 ground texture atlas', () => {
	it('grid round(√N) wide of 258 px cells, POT size', () => {
		expect(groundAtlasLayout(5)).toEqual({ cols: 2, rows: 3, cell: 258, width: 1024, height: 1024 });
		expect(groundAtlasLayout(16)).toMatchObject({ cols: 4, width: 2048 });
	});
	// R-MAP-005 pending: 1 px border made by drawing the texture stretched to 258 first.
	it.fails('[R-MAP-005] composes each cell with the stretched 1 px border', () => {
		expect(composeGroundAtlas()).toBeDefined();
	});
});

describe('R-MAP-006 lightmap atlas', () => {
	it('samples the inner 0.125–0.875 of each 8×8 block', () => {
		expect(lightmapBlockUV(1, 0, 64)).toEqual([9 / 64, 1 / 64, 15 / 64, 7 / 64]);
	});
});

describe('R-MAP-007 tile colour is BGRA', () => {
	it('converts BGRA to RGBA; no top tile → 0', () => {
		expect(tileColorRgba(new Uint8Array([10, 20, 30, 40]))).toEqual([30, 20, 10, 40]);
		expect(tileColorRgba(null)).toEqual([0, 0, 0, 0]);
	});
});

describe('R-MAP-008 water wave', () => {
	it('offset = (frame·speed mod 360) − 180 with frame = t/(1000/60)', () => {
		expect(waveOffset(1000, 3)).toBeCloseTo(((60 * 3) % 360) - 180);
	});
	it('y += sin(rad(offset + 0.5·p·(x+z+diff)))·h with checker diff', () => {
		expect(waveY(0, 0, 0, 0, 2, 1)).toBeCloseTo(Math.sin(deg2rad(1)));
		expect(waveY(0, 1, 1, 0, 2, 1)).toBeCloseTo(Math.sin(deg2rad(1)));
		expect(waveY(0, 1, 0, 0, 2, 1)).toBeCloseTo(Math.sin(deg2rad(1)));
	});
	it('wave height and level are RSW /5', () => {
		expect(waterParamsFromRsw({ level: 10, waveHeight: 5, waveSpeed: 2, wavePitch: 50, animSpeed: 3, type: 0 })).toMatchObject({ level: 2, waveHeight: 1 });
	});
});

describe('R-MAP-009 water texture animation', () => {
	it('index = floor(frame/animSpeed) % 32', () => {
		expect(waterFrameIndex(1100, 3)).toBe(Math.floor(66 / 3) % 32);
		expect(waterFrameIndex(1000 * 10, 1)).toBe(600 % 32);
		// exact on frame boundaries (legacy tick/(1000/60) gave 59.99… at tick 1000)
		expect(waterFrameIndex(1000, 1)).toBe(60 % 32);
	});
});

describe('R-MAP-010 water opacity (FLAG fixed; legacy R-MAP-010 squared it to 0.64)', () => {
	it('type 0 has effective alpha 0.8, applied once', () => {
		expect(waterAlpha(0)).toBe(0.8);
		expect(SHADERS.waterFrag).toContain('vec4(rgb, uOpacity)');
		expect(SHADERS.waterFrag).not.toMatch(/uOpacity\s*\*\s*uOpacity|\*=\s*uOpacity/);
	});
	it('types 4 and 6 are opaque', () => {
		expect(waterAlpha(4)).toBe(1);
		expect(waterAlpha(6)).toBe(1);
	});
});

describe('R-MAP-011 water geometry and depth', () => {
	it('quad only where a ground corner is below the surface', () => {
		expect(hasWaterQuad([1, 1, 1, 1], 2)).toBe(false);
		expect(hasWaterQuad([1, 3, 1, 1], 2)).toBe(true);
	});
	it('UVs repeat every 5 tiles', () => {
		expect(waterUV(5, 7)).toEqual([0, 2 / 5]);
	});
	// HITL round 2: the rebuild keeps the legacy corner convention (Loaders/Ground.js:547-585);
	// to be confirmed by a world-record diff once world records are seamed.
	it('legacy corner convention (HITL round 2): quad when a corner is below level - waveHeight', () => {
		expect(hasWaterQuad([1, 1, 1, 1], 2, 0.5)).toBe(false);
		expect(hasWaterQuad([1, 1, 1.6, 1], 2, 0.5)).toBe(true); // below the crest (1.5), above the level (2)
		expect(hasWaterQuad([1, 1, 1.4, 1], 2, 0.5)).toBe(false);
	});
	it('legacy corner convention (HITL round 2): far corners use `|| 1`, vertex order matches Ground.js', () => {
		// Transcription of Ground.js:555-585.
		const legacy = (x, y, L) => [
			[(x + 0) * 2, L, (y + 0) * 2, ((x + 0) % 5) / 5, ((y + 0) % 5) / 5],
			[(x + 1) * 2, L, (y + 0) * 2, ((x + 1) % 5) / 5 || 1, ((y + 0) % 5) / 5],
			[(x + 1) * 2, L, (y + 1) * 2, ((x + 1) % 5) / 5 || 1, ((y + 1) % 5) / 5 || 1],
			[(x + 1) * 2, L, (y + 1) * 2, ((x + 1) % 5) / 5 || 1, ((y + 1) % 5) / 5 || 1],
			[(x + 0) * 2, L, (y + 1) * 2, ((x + 0) % 5) / 5, ((y + 1) % 5) / 5 || 1],
			[(x + 0) * 2, L, (y + 0) * 2, ((x + 0) % 5) / 5, ((y + 0) % 5) / 5]
		];
		for (let y = 0; y < 11; y++) {
			for (let x = 0; x < 11; x++) {
				expect(waterQuadVertices(x, y, -3.5)).toEqual(legacy(x, y, -3.5));
			}
		}
		// The tile before a 5-tile boundary ends at u = 1, not 0; the next one starts at 0.
		expect(waterQuadVertices(4, 0, 0)[1][3]).toBe(1);
		expect(waterQuadVertices(5, 0, 0)[0][3]).toBe(0);
	});
	it('depth test on, depth write off', () => {
		expect(WATER_PASS_STATE).toMatchObject({ depthTest: true, depthWrite: false });
	});
});

describe('R-MAP-012 static RSM shading', () => {
	it('rgb·clamp(N·L·D + A)·clamp(env), alpha = tex.a × model alpha', () => {
		expect(shadeModel({ tex: [1, 1, 1, 0.5], modelAlpha: 0.5, normal: [0, 1, 0], light: { ...light, diffuse: [0.5, 0.5, 0.5], ambient: [0.1, 0.1, 0.1] }, lightmapPref: true })).toEqual([0.6, 0.6, 0.6, 0.25]);
	});
	it('discards alpha exactly 0', () => {
		expect(shadeModel({ tex: [1, 1, 1, 0], modelAlpha: 1, normal: [0, 1, 0], light, lightmapPref: true })).toBeNull();
	});
	it('RSM ≥ 1.4 stores alpha as byte /255; depth test and write on', () => {
		expect(rsmAlpha(255, 1.4)).toBe(1);
		expect(rsmAlpha(1, 1.3)).toBe(1);
		expect(MODEL_PASS_STATE).toMatchObject({ depthTest: true, depthWrite: true });
	});
});

describe('R-MAP-013 animated RSM respects the lightmap pref (FLAG fixed; legacy R-MAP-013 ignored it)', () => {
	it('lightmap pref off → full diffuse, same as static models', () => {
		const out = shadeModel({ tex: [1, 1, 1, 1], modelAlpha: 1, normal: [0, -1, 0], light: { ...light, diffuse: [0.5, 0.5, 0.5], ambient: [0, 0, 0] }, lightmapPref: false });
		expect(out[0]).toBeCloseTo(0.5);
	});
	it('the shader branches on uLightmapUse for N·L', () => {
		expect(SHADERS.modelsFrag).toContain('uLightmapUse ? max(dot(vNormal, uLightDir), 0.0) : 1.0');
	});
});

describe('R-MAP-014 RSM instance transform', () => {
	it('T(pos+mapOffset)·RotZ·RotX·RotY·Scale', () => {
		const m = rsmInstanceMatrix({ pos: [1, 2, 3], mapOffset: [10, 0, 0], rot: [10, 20, 30], scale: [1, 2, 1], version: 1.4 });
		const expected = chain(translation(11, 2, 3), rotationZ(deg2rad(30)), rotationX(deg2rad(10)), rotationY(deg2rad(20)), scaling(1, 2, 1));
		expect(Array.from(m)).toEqual(Array.from(expected));
	});
	it('RSM ≥ 2.2 appends flip, offset, box range Y and box offset', () => {
		const m = rsmInstanceMatrix({ pos: [0, 0, 0], mapOffset: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], version: 2.2, flip: [1, -1, 1], offset: [1, 0, 0], boxRangeY: 2, boxOffset: [0, 0, 3] });
		// Scale(flip) applies to the appended translations: (1, 2, 3) → (1, −2, 3)
		expect(Array.from(m.slice(12, 15))).toEqual([1, -2, 3]);
	});
});

describe('R-MAP-015 RSM normals', () => {
	it('unknown shadeType is treated as NONE', () => {
		expect(normalMode(0)).toBe('none');
		expect(normalMode(1)).toBe('flat');
		expect(normalMode(2)).toBe('smooth');
		expect(normalMode(9)).toBe('none');
	});
	it.fails('[R-MAP-015] SMOOTH averages normals within each smoothGroup', () => {
		expect(computeRsmNormals()).toBeDefined();
	});
});

describe('R-MAP-018 occluder fade enablement', () => {
	it('dither/alpha enable it, never in first person; default off', () => {
		expect(occluderFadeActive('dither', false)).toBe(true);
		expect(occluderFadeActive('alpha', false)).toBe(true);
		expect(occluderFadeActive('off', false)).toBe(false);
		expect(occluderFadeActive('alpha', true)).toBe(false);
	});
});

describe('R-MAP-019 occluder detection', () => {
	it('keeps only fragments within 0.7 of the axis and > 0.5 before focus', () => {
		expect(queryKeepsFragment(0.7, 0.6)).toBe(true);
		expect(queryKeepsFragment(0.71, 0.6)).toBe(false);
		expect(queryKeepsFragment(0.1, 0.5)).toBe(false);
	});
	it('does not issue a new query while one is pending; uses last result', () => {
		let pollResult = null;
		const fade = new OccluderFade({ begin() {}, end() {}, poll: () => pollResult });
		expect(fade.issue()).toBe(true);
		expect(fade.issue()).toBe(false);
		fade.collect();
		expect(fade.pending).toBe(true);
		pollResult = true;
		fade.collect();
		expect(fade.pending).toBe(false);
		expect(fade.update(75)).toBeCloseTo(0.5);
	});
	it('strength up Δt/150 blocked, down Δt/300 clear, Δt capped at 100', () => {
		const fade = new OccluderFade({ begin() {}, end() {}, poll: () => true });
		fade.lastBlocked = true;
		expect(fade.update(1000)).toBeCloseTo(100 / 150);
		fade.lastBlocked = false;
		expect(fade.update(30)).toBeCloseTo(100 / 150 - 0.1);
	});
});

describe('R-MAP-020 occluder fade shape and modes', () => {
	it('visibility = 1 − fade·(1 − opacity)', () => {
		const { fade, visibility } = occluderVisibility({ distToAxis: 0, signedPastFocus: -1, strength: 1 });
		expect(fade).toBe(1);
		expect(visibility).toBeCloseTo(0.25);
	});
	it('dither discards when visibility ≤ (b + 0.5)/16', () => {
		expect(ditherDiscard(0.25, 0, 0)).toBe(false);
		expect(ditherDiscard(0.01, 0, 0)).toBe(true);
	});
	it('alpha mode: opaque pass discards fade ≥ 0.01; faded pass test on, write off', () => {
		expect(alphaModeOpaqueDiscard(0.01)).toBe(true);
		expect(alphaModeOpaqueDiscard(0.009)).toBe(false);
		expect(FADED_PASS_STATE).toMatchObject({ depthTest: true, depthWrite: false });
	});
});

describe('R-MAP-021 grid selector', () => {
	const altitude = {
		isWalkable: (x, y) => !(x === 6 && y === 5),
		cornerHeights: () => [1, 1, 1, 1]
	};
	it('draws walkable cells lowered by 0.1, none on non-walkable', () => {
		expect(selectorQuads({ x: 5, y: 5 }, altitude)).toEqual([{ x: 5, y: 5, heights: [0.9, 0.9, 0.9, 0.9] }]);
		expect(selectorQuads({ x: 6, y: 5 }, altitude)).toEqual([]);
	});
	it('captcha mode draws every walkable cell in range', () => {
		expect(selectorQuads({ x: 5, y: 5 }, altitude, { range: 1 })).toHaveLength(8);
	});
	it('grid.tga at alpha 0.6 tinted rgb(50,240,160) source-atop', () => {
		expect(GRID_MATERIAL).toEqual({ texture: 'grid.tga', alpha: 0.6, tint: [50, 240, 160], composite: 'source-atop' });
	});
});

describe('R-MAP-022 sky clouds', () => {
	it('fades in 1 s, holds to 6 s, fades out 2 s, then respawns', () => {
		expect(cloudAlpha(500).alpha).toBeCloseTo(0.5);
		expect(cloudAlpha(3000).alpha).toBe(1);
		expect(cloudAlpha(7000).alpha).toBeCloseTo(0.5);
		expect(cloudAlpha(8001).respawn).toBe(true);
	});
	it('spawns within ±35 cells at z = −10 with deterministic rng', () => {
		const c = spawnCloud([100, 100], () => 0);
		expect(c.position).toEqual([65, 65, -10]);
		expect(c.texture).toBe('cloud1.tga');
	});
	it('drift is capped at Δt 250; depth test on, write off, no correction', () => {
		expect(cloudDrift(1000, () => 1)).toEqual(cloudDrift(250, () => 1));
		expect(cloudDrift(250, () => 1)[0]).toBeCloseTo(0.1);
		expect(CLOUD_PASS_STATE).toEqual({ depthTest: true, depthWrite: false, depthCorrection: false });
	});
});

describe('R-MAP-024 magenta colour key on images', () => {
	it('r > 230, g < 20, b > 230 → transparent black; others untouched', () => {
		const px = new Uint8ClampedArray([231, 19, 231, 255, 230, 0, 255, 255]);
		applyMagentaKey(px);
		expect(Array.from(px)).toEqual([0, 0, 0, 0, 230, 0, 255, 255]);
	});
	it('then stretches to POT for upload', () => {
		expect(potStretchSize(100, 33)).toEqual({ width: 128, height: 64 });
	});
});

describe('R-PERF-004 static model batching', () => {
	it('merges contiguous same-texture ranges once all textures loaded', () => {
		const infos = [
			{ texture: 'a', vertOffset: 0, vertCount: 3 },
			{ texture: 'a', vertOffset: 3, vertCount: 3 },
			{ texture: 'b', vertOffset: 6, vertCount: 3 }
		];
		expect(batchStaticModels(infos, true)).toEqual([
			{ texture: 'a', vertOffset: 0, vertCount: 6 },
			{ texture: 'b', vertOffset: 6, vertCount: 3 }
		]);
		expect(batchStaticModels(infos, false)).toHaveLength(3);
	});
});
