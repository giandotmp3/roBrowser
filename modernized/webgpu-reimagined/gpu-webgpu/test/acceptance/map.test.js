import { describe, expect, it } from 'vitest';
import {
	CLOUD_DEPTH,
	CLOUDS,
	FOGGED,
	GRID_SELECTOR,
	MapWorld,
	MODEL_DEPTH,
	OCCLUDER_BLEND_PASS_DEPTH,
	OCCLUDER_DEFAULTS,
	OccluderQueryScheduler,
	SHADE,
	WATER_DEPTH,
	applyFog,
	applyMagentaKey,
	bayerThreshold,
	cloudAlpha,
	computeNormals,
	createCloudField,
	fogUniforms,
	gridSelectorCells,
	gridSelectorQuad,
	groundAtlasLayout,
	lightmapAtlasLayout,
	lightmapRgb,
	modelAlpha,
	nextStrength,
	occluderFade,
	occluderFadeActive,
	occluderFragment,
	occluderVisibility,
	potSize,
	rsmInstanceMatrix,
	shadeGround,
	shadeModel,
	shadeWater,
	tileColorsToRgba,
	transformPointForTest,
	waterFrameIndex,
	waterOpacity,
	waterParams,
	waveOffset,
	waveY
} from './_mapImports.js';
import { createFakeGpu } from '../support/fakeGpu.js';

const light = { direction: [0, 1, 0], diffuse: [0.5, 0.5, 0.5], ambient: [0.25, 0.25, 0.25], env: [1, 1, 1] };
const seeded = (seed = 1) => () => {
	seed = (seed * 16807) % 2147483647;
	return (seed - 1) / 2147483646;
};

describe('MAP: ground', () => {
	it('R-MAP-001: c = tex·tileColor, ·clamp(max(N·L,0)·D + A), ·clamp(env); lightmap rgb·a + clamp(lm.rgb)', () => {
		const out = shadeGround({ tex: [1, 1, 1, 1], tileColor: [0.5, 1, 1], tileUv: [0.1, 0.1], normal: [0, 1, 0], light, lightmap: [0, 0, 0, 1], smoothlight: 1 });
		expect(out[0]).toBeCloseTo(0.5 * 0.75);
		expect(out[1]).toBeCloseTo(0.75);
		const noTile = shadeGround({ tex: [1, 1, 1, 1], tileColor: [0, 0, 0], tileUv: [0, 0], normal: [0, 1, 0], light, lightmap: [0.2, 0.2, 0.2, 0.5], smoothlight: 1 });
		expect(noTile[0]).toBeCloseTo(0.75 * 0.5 + 0.2);
	});

	it('R-MAP-002: smoothlight 0 posterises to 16 levels, 2 applies pow 1.1, 1 is raw; lightmap pref off drops the term', () => {
		const c = 100 / 255;
		expect(lightmapRgb([c], 0)[0]).toBeCloseTo((Math.floor(100 / 16) * 16) / 255);
		expect(lightmapRgb([c], 1)[0]).toBeCloseTo(c);
		expect(lightmapRgb([c], 2)[0]).toBeCloseTo(Math.pow(c, 1.1));
		const off = shadeGround({ tex: [1, 1, 1, 1], tileColor: [1, 1, 1], tileUv: [0, 0], normal: [0, 1, 0], light, lightmap: [1, 1, 1, 0], lightmapPref: false });
		expect(off[0]).toBeCloseTo(0.75);
	});

	it('R-MAP-003: ground texels with alpha < 0.1 are discarded', () => {
		const base = { tileColor: [1, 1, 1], tileUv: [0, 0], normal: [0, 1, 0], light, lightmap: [0, 0, 0, 1] };
		expect(shadeGround({ ...base, tex: [1, 1, 1, 0.09] })).toBeNull();
		expect(shadeGround({ ...base, tex: [1, 1, 1, 0.1] })).not.toBeNull();
	});

	it('R-MAP-004: fog = smoothstep(near·240, far·240, depth) mix, alpha preserved; one shared include in every fogged shader', () => {
		const fog = fogUniforms({ fogPref: true, entry: { near: 1, far: 2, color: [1, 0, 0], factor: 9 } });
		expect(fog).toMatchObject({ use: true, near: 240, far: 480 });
		expect(applyFog([0, 0, 0, 0.3], 240, fog)).toEqual([0, 0, 0, 0.3]);
		expect(applyFog([0, 0, 0, 0.3], 480, fog)).toEqual([1, 0, 0, 0.3]);
		expect(fogUniforms({ fogPref: true, entry: null }).use).toBe(false);
		expect(fogUniforms({ fogPref: false, entry: { near: 1, far: 2, color: [1, 1, 1] } }).use).toBe(false);
		expect(FOGGED).toEqual(expect.arrayContaining(['ground', 'sprite', 'models', 'str', 'effect']));
	});

	it('R-MAP-005: ground atlas is round(√N) wide in 258 px cells, POT sized', () => {
		const a = groundAtlasLayout(10);
		expect(a.cols).toBe(3);
		expect(a.rows).toBe(4);
		expect(a.cell).toBe(258);
		expect(a.width).toBe(1024);
		expect(a.height).toBe(2048);
		expect(a.cellOrigin(4)).toEqual({ x: 258 + 1, y: 258 + 1 });
	});

	it('R-MAP-006: lightmaps are 8×8 blocks in a POT atlas; UVs sample the inner 0.125–0.875', () => {
		const l = lightmapAtlasLayout(5);
		expect(l.perRow).toBe(3);
		expect(l.size).toBe(32);
		const r = l.uvRect(0);
		expect(r.u0).toBeCloseTo(1 / 32);
		expect(r.u1).toBeCloseTo(7 / 32);
	});

	it('R-MAP-007: tile colour BGRA -> RGBA; cells with no top tile are 0', () => {
		const out = tileColorsToRgba([[10, 20, 30, 255], null]);
		expect([...out]).toEqual([30, 20, 10, 255, 0, 0, 0, 0]);
	});
});

describe('MAP: water', () => {
	it('R-MAP-008: wave offset = (frame·speed mod 360) − 180; y += sin(rad(offset + 0.5·p·(x+z+diff)))·h; level and height /5', () => {
		const p = waterParams({ level: 10, waveHeight: 5, waveSpeed: 2, wavePitch: 50, animSpeed: 3, type: 0 });
		expect(p.level).toBe(2);
		expect(p.waveHeight).toBe(1);
		expect(waveOffset(0, 2)).toBe(-180);
		expect(waveOffset(1000, 2)).toBeCloseTo(((60 * 2) % 360) - 180);
		expect(waveY(0, { x: 0, z: 0, diff: 0 }, { offset: 90, wavePitch: 50, waveHeight: 1 })).toBeCloseTo(1);
	});

	it('R-MAP-009: 32 frames, index floor(frame/animSpeed) % 32 at frame = tick/16.67', () => {
		expect(waterFrameIndex(0, 3)).toBe(0);
		expect(waterFrameIndex(1000, 3)).toBe(Math.floor(60 / 3) % 32);
		expect(waterFrameIndex(10000, 1)).toBe(600 % 32);
	});

	it('R-MAP-010: FIX (legacy R-MAP-010 squared opacity to 0.64): water alpha is the opacity applied once; texture alpha ignored', () => {
		expect(waterOpacity(0)).toBe(0.8);
		expect(waterOpacity(4)).toBe(1.0);
		expect(waterOpacity(6)).toBe(1.0);
		expect(shadeWater([0.2, 0.3, 0.4, 0.1], waterOpacity(0))).toEqual([0.2, 0.3, 0.4, 0.8]);
	});

	// R-MAP-011 corner convention: legacy (HITL round 2). Water geometry comes unchanged from the legacy
	// MAP payload (Loaders/Ground.js:547-585), to be confirmed by a world-record diff; gpu-webgl2 tests the mirror.
	it('R-MAP-011: water is drawn after opaque entities with depth test on and depth write off', async () => {
		const { MAP_FRAME_STEPS } = await import('../../src/index.js');
		const steps = MAP_FRAME_STEPS.map(s => s.step);
		expect(steps.indexOf('water')).toBeGreaterThan(steps.indexOf('entitiesNonEffect'));
		expect(WATER_DEPTH).toEqual({ depthTest: true, depthWrite: false });
	});
});

describe('MAP: models', () => {
	it('R-MAP-012: rgb·clamp(N·L·D + A)·clamp(env), alpha = tex.a × model alpha, alpha-0 discard, depth test+write on', () => {
		const out = shadeModel({ tex: [1, 1, 1, 0.5], alpha: 0.5, normal: [0, 1, 0], light, lightmapPref: true });
		expect(out[0]).toBeCloseTo(0.75);
		expect(out[3]).toBeCloseTo(0.25);
		expect(shadeModel({ tex: [1, 1, 1, 0], alpha: 1, normal: [0, 1, 0], light, lightmapPref: true })).toBeNull();
		expect(modelAlpha(1.4, 128)).toBeCloseTo(128 / 255);
		expect(modelAlpha(2.0, 255)).toBe(1);
		expect(modelAlpha(1.3, 10)).toBe(1);
		expect(MODEL_DEPTH).toEqual({ depthTest: true, depthWrite: true });
	});

	it('R-MAP-013: FIX (legacy R-MAP-013 animated RSM ignored the lightmap pref): animated models use full diffuse when lightmap is off', () => {
		const sideways = { tex: [1, 1, 1, 1], alpha: 1, normal: [1, 0, 0], light };
		const animatedOff = shadeModel({ ...sideways, lightmapPref: false, animated: true });
		const staticOff = shadeModel({ ...sideways, lightmapPref: false, animated: false });
		expect(animatedOff).toEqual(staticOff);
		expect(animatedOff[0]).toBeCloseTo(0.75); // N·L treated as 1
	});

	it('R-MAP-014: T(pos+mapOffset)·RotZ·RotX·RotY·Scale, plus flip/offset/box terms for RSM >= 2.2', () => {
		const m = rsmInstanceMatrix({ position: [1, 2, 3], mapOffset: [10, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2], version: 2.0 });
		expect(transformPointForTest(m, [1, 1, 1])).toEqual([13, 4, 5]);
		const m22 = rsmInstanceMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], version: 2.2, flip: [1, -1, 1], offset: [0, 1, 0], boxRangeY: 2, boxOffset: [0, 0, 1] });
		expect(transformPointForTest(m22, [0, 0, 0])).toEqual([0, -3, 1]);
		const r = rsmInstanceMatrix({ position: [0, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1], version: 1.4 });
		transformPointForTest(r, [0, 0, 1]).forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0][i]));
	});

	it('R-MAP-015: NONE constant normals, FLAT per face, SMOOTH averaged within smoothGroup, unknown -> NONE', () => {
		const faces = [
			{ vertices: [[0, 0, 0], [0, 0, 1], [1, 0, 0]], vertexIds: [0, 1, 2], smoothGroup: 0 },
			{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], vertexIds: [0, 2, 3], smoothGroup: 0 }
		];
		expect(computeNormals(SHADE.NONE, faces)[0][0]).toEqual([-1, -1, -1]);
		expect(computeNormals(99, faces)).toEqual(computeNormals(SHADE.NONE, faces));
		const flat = computeNormals(SHADE.FLAT, faces);
		flat[0][0].forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0][i]));
		const smooth = computeNormals(SHADE.SMOOTH, faces);
		const shared = smooth[0][0];
		expect(Math.hypot(...shared)).toBeCloseTo(1);
		expect(shared[1]).toBeGreaterThan(0);
		expect(shared[2]).toBeGreaterThan(0); // averaged with face 2's (0,0,1)
		expect(smooth[0][1]).toEqual(flat[0][1]); // vertex 1 belongs to face 1 only
	});
});

describe('MAP: occluder fade', () => {
	it('R-MAP-018: active for dither/alpha (default off, 0.25, 5) except in first person', () => {
		expect(OCCLUDER_DEFAULTS).toEqual({ mode: 'off', opacity: 0.25, radius: 5.0 });
		expect(occluderFadeActive('off', 'iso')).toBe(false);
		expect(occluderFadeActive('dither', 'iso')).toBe(true);
		expect(occluderFadeActive('alpha', 'third')).toBe(true);
		expect(occluderFadeActive('alpha', 'first')).toBe(false);
	});

	it('R-MAP-019: strength rises Δt/150 when blocked, falls Δt/300 when clear, Δt capped at 100; no query while pending', () => {
		expect(nextStrength(0, true, 75)).toBeCloseTo(0.5);
		expect(nextStrength(1, false, 150)).toBeCloseTo(1 - 100 / 300);
		expect(nextStrength(0, true, 1000)).toBeCloseTo(100 / 150);
		const q = new OccluderQueryScheduler();
		expect(q.beginFrame()).toBe(true);
		expect(q.beginFrame()).toBe(false);
		q.resolve(true);
		expect(q.lastBlocked).toBe(true);
		expect(q.beginFrame()).toBe(true);
	});

	it('R-MAP-019: occlusion GPUQuerySet is created and attached to the scene pass, resolved and read back late', async () => {
		const fake = createFakeGpu();
		const images = { decode: async () => null };
		const world = await new MapWorld({ device: fake.device, images }).init();
		const querySet = fake.calls.find(c => c[0] === 'createQuerySet')[1];
		expect(querySet).toMatchObject({ type: 'occlusion', count: 2 });
		expect(world.occlusionQuerySet).toBeTruthy();
		await world.accept({ type: 'MAP_MODELS', payload: { buffer: new Float32Array(9 * 3), infos: [] } });
		const modelView = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1];
		const view = { modelView, projection: new Float32Array(16) };
		const calls = [];
		const recorder = () => new Proxy({}, { get: (_, name) => () => calls.push(name) });
		const pass = recorder();
		const encoder = recorder();
		const frame = tick => {
			world.beginFrame({ view, frame: { tick, occluder: { mode: 'dither' } }, targetHeight: 480 });
			world.encodeStep(pass, 'occluderFadeBegin');
			world.encodeStep(pass, 'staticModels');
			world.encodeAfterPass(encoder);
			world.afterSubmit();
		};
		frame(100);
		const expected = ['beginOcclusionQuery', 'endOcclusionQuery', 'resolveQuerySet', 'copyBufferToBuffer'];
		expect(calls).toEqual(expect.arrayContaining(expected));
		calls.length = 0;
		frame(130); // read-back not collected yet: pending, no new query
		expect(calls).not.toContain('beginOcclusionQuery');
		await world.whenQueriesRead();
		calls.length = 0;
		frame(160); // collected one frame late, then re-issued
		expect(calls).toContain('beginOcclusionQuery');
	});

	it('R-MAP-020: fade shape, Bayer dither, and alpha mode opaque/blend split', () => {
		expect(occluderFade({ axisDist: 0, pastFocus: -1, radius: 5, strength: 1 })).toBe(1);
		expect(occluderFade({ axisDist: 5, pastFocus: -1, radius: 5, strength: 1 })).toBe(0);
		expect(occluderFade({ axisDist: 0, pastFocus: 0, radius: 5, strength: 1 })).toBe(0);
		expect(occluderVisibility(1, 0.25)).toBeCloseTo(0.25);
		expect(bayerThreshold(0, 0)).toBeCloseTo(0.5 / 16);
		expect(bayerThreshold(1, 0)).toBeCloseTo(8.5 / 16);
		expect(occluderFragment({ mode: 'dither', fade: 1, opacity: 0.25, px: 1, py: 0 }).discard).toBe(true);
		expect(occluderFragment({ mode: 'dither', fade: 1, opacity: 0.25, px: 0, py: 0 }).discard).toBe(false);
		expect(occluderFragment({ mode: 'alpha', pass: 'opaque', fade: 0.5, opacity: 0.25 }).discard).toBe(true);
		expect(occluderFragment({ mode: 'alpha', pass: 'opaque', fade: 0.005, opacity: 0.25 }).discard).toBe(false);
		const blend = occluderFragment({ mode: 'alpha', pass: 'blend', fade: 1, opacity: 0.25 });
		expect(blend).toEqual({ discard: false, alphaScale: 0.25 });
		expect(OCCLUDER_BLEND_PASS_DEPTH).toEqual({ depthTest: true, depthWrite: false });
	});
});

describe('MAP: grid, sky, image keying', () => {
	it('R-MAP-021: grid on walkable hit cell at alpha 0.6, tint (50,240,160), lowered 0.1; captcha draws the walkable range; non-walkable none', () => {
		const walk = (x, y) => !(x === 6 && y === 5);
		expect(gridSelectorCells({ hit: { x: 5, y: 5 }, isWalkable: walk })).toEqual([{ x: 5, y: 5 }]);
		expect(gridSelectorCells({ hit: { x: 6, y: 5 }, isWalkable: walk })).toEqual([]);
		expect(gridSelectorCells({ hit: { x: 5, y: 5 }, isWalkable: walk, captchaRange: 1 })).toHaveLength(8);
		const q = gridSelectorQuad({ x: 5, y: 5 }, [-1, -1, -2, -2]);
		expect(q.vertices[0]).toEqual([5, -1.1, 5]);
		expect(q.alpha).toBe(0.6);
		expect(q.tint).toEqual([50, 240, 160]);
		expect(GRID_SELECTOR.texture).toBe('grid.tga');
	});

	it('R-MAP-022: 150 cloud billboards of 500 px within ±35 cells at z −10, tinted; 1 s fade-in; depth test on, write off, no correction', () => {
		const field = createCloudField(seeded(7), [100, 100], [0.9, 0.9, 1]);
		expect(field.clouds).toHaveLength(150);
		expect(field.color).toEqual([0.9, 0.9, 1]);
		for (const c of field.clouds) {
			expect(Math.abs(c.position[0] - 100)).toBeLessThanOrEqual(35);
			expect(Math.abs(c.position[1] - 100)).toBeLessThanOrEqual(35);
			expect(c.position[2]).toBe(-10);
			expect(c.size).toBe(500);
			expect(CLOUDS.textures).toContain(c.texture);
		}
		expect(cloudAlpha(0)).toBe(0);
		expect(cloudAlpha(500)).toBeCloseTo(0.5);
		expect(cloudAlpha(1000)).toBe(1);
		expect(cloudAlpha(60000)).toBeNull();
		expect(CLOUD_DEPTH).toEqual({ depthTest: true, depthWrite: false, depthCorrection: false });
	});

	it('R-MAP-024: r>230, g<20, b>230 becomes transparent black; images stretch to POT', () => {
		const px = new Uint8ClampedArray([231, 19, 231, 255, 230, 0, 255, 255, 255, 20, 255, 255]);
		applyMagentaKey(px);
		expect([...px.slice(0, 4)]).toEqual([0, 0, 0, 0]);
		expect([...px.slice(4, 8)]).toEqual([230, 0, 255, 255]);
		expect([...px.slice(8, 12)]).toEqual([255, 20, 255, 255]);
		expect(potSize(100, 33)).toEqual({ width: 128, height: 64 });
	});
});
