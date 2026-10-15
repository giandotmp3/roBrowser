import { describe, expect, it, vi } from 'vitest';
import { createFakeGpu, fakeSettings } from '../support/fakeGpu.js';
import { WebGpuBackend } from '../../src/WebGpuBackend.js';
import { AnimatedRsm } from '../../src/world/animatedRsm.js';
import { mapLight } from '../../src/world/lighting.js';
import {
	MapWorld,
	OCCLUDER_MODE,
	WORLD_UNIFORM_BYTES,
	WORLD_UNIFORM_STRIDE,
	packWorldUniforms
} from '../../src/world/MapWorld.js';
import { SHADERS } from '../../src/shaders/index.js';
import { batchKey, programOf, splitBatches } from '../../src/sprites/runs.js';
import { chain, rotationX, rotationY } from '../../src/math.js';

/** A fake 2D canvas factory (atlas, POT stretch, grid tint run on it; texels read with getImageData). */
const fakeCanvas = (width, height) => ({
	width,
	height,
	getContext: () => ({
		clearRect() {},
		drawImage() {},
		fillRect() {},
		getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
	})
});
/** Decoder port: every source decodes to a fake keyed canvas of the size named in it. */
const images = {
	decode: async source => {
		if (!source) {
			return null;
		}
		const [w, h] = String(source).split('x').map(Number);
		return fakeCanvas(w || 64, h || 64);
	}
};
const FILES = {
	'data/texture/grid.tga': '32x32',
	'data\\texture\\ice.bmp': '32x32',
	'data\\texture\\fire.bmp': '40x20'
};

async function makeBackend({ files = FILES, limits } = {}) {
	const fake = createFakeGpu({ limits });
	const ports = {
		gpu: fake.gpu,
		canvas: fake.canvas,
		overlay: { show: vi.fn(), hide: vi.fn() },
		assets: { purge: vi.fn() },
		settings: fakeSettings(),
		scene: { runStep() {}, currentMap: () => 'prontera', setMap: vi.fn(async () => {}) },
		fallback: { switchToWebgl2: vi.fn(async () => {}) },
		now: () => 0,
		images,
		createCanvas: fakeCanvas,
		files: { load: async path => files[path] ?? null }
	};
	const backend = await new WebGpuBackend(ports).init();
	return { fake, backend, ports };
}

const quad = (x, n) => {
	const out = [];
	for (let i = 0; i < n; i++) {
		out.push(x + i, 0, 0, 0, 1, 0, 0, 0, 1);
	}
	return out;
};

const WORLD = {
	water: {
		level: 1,
		type: 0,
		waveHeight: 0.2,
		waveSpeed: 2,
		wavePitch: 50,
		animSpeed: 3,
		images: Array(32).fill('64x64')
	},
	light: { longitude: 45, latitude: 30, diffuse: [1, 0.9, 0.8], ambient: [0.2, 0.2, 0.2], opacity: 1 },
	sound: [],
	effect: []
};
const GROUND = {
	width: 2,
	height: 2,
	textures: ['256x256', '128x128'],
	lightmap: new Uint8Array(8 * 8 * 4),
	lightmapSize: 1,
	tileColor: new Uint8Array(16),
	shadowMap: new Uint8Array(256),
	mesh: new Float32Array(12 * 6),
	meshVertCount: 6,
	waterMesh: new Float32Array(5 * 6),
	waterVertCount: 6
};
const MODELS = {
	buffer: new Float32Array([...quad(0, 3), ...quad(3, 3), ...quad(6, 3), ...quad(9, 3)]),
	infos: [
		{ filename: 'a.bmp', vertOffset: 0, vertCount: 3, texture: '128x128' },
		{ filename: 'b.bmp', vertOffset: 3, vertCount: 3, texture: '100x60' },
		{ filename: 'c.bmp', vertOffset: 6, vertCount: 3, texture: '256x256' },
		{ filename: 'd.tga', vertOffset: 9, vertCount: 3, texture: '64x64' }
	]
};

const node = (name, parentname, extra = {}) => ({
	name,
	parentname,
	is_only: false,
	textures: [0, 1],
	vertices: [
		[0, 0, 0],
		[1, 0, 0],
		[0, 1, 0]
	],
	tvertices: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
	faces: [
		{ vertidx: [0, 1, 2], tvertidx: [0, 1, 2], texid: 1, smoothGroup: 0 },
		{ vertidx: [0, 2, 1], tvertidx: [0, 2, 1], texid: 0, smoothGroup: 0 }
	],
	pos: [0, 0, 0],
	rotangle: 0,
	rotaxis: [0, 0, 0],
	scale: [1, 1, 1],
	offset: [0, 0, 0],
	mat3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
	rotKeyframes: [],
	posKeyframes: [],
	scaleKeyFrames: [],
	...extra
});
const ANIMATED = {
	filename: 'spin.rsm',
	animLen: 1000,
	frameRatePerSecond: 20,
	shadeType: 1,
	alpha: 1,
	textures: ['ice.bmp', 'fire.bmp'],
	instances: [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 20, 1]],
	nodes: [
		node('root', '', {
			posKeyframes: [
				{ frame: 0, px: 0, py: 0, pz: 0 },
				{ frame: 500, px: 2, py: 0, pz: 0 }
			]
		}),
		node('child', 'root', { pos: [0, 1, 0] })
	],
	box: { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], offset: [0, 0, 0], range: [0, 0, 0] }
};

async function loadMap(backend) {
	backend.beginMap(1);
	for (const [type, payload] of [
		['MAP_ALTITUDE', { cells: new Float32Array(5 * 4).fill(0.5), width: 2, height: 2 }],
		['MAP_WORLD', WORLD],
		['MAP_GROUND', GROUND],
		['MAP_MODELS', MODELS],
		['MAP_ANIMATED_MODEL', ANIMATED]
	]) {
		backend.acceptMapMessage({ type, payload, request: 1 });
	}
	await backend.whenMapReady();
}

const VIEW = {
	modelView: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1]),
	projection: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]),
	zoom: 30,
	fog: { use: false, near: 0, far: 1, color: [0, 0, 0] }
};

/** The pipeline label (`world-<program>:…`) or 'records' of every draw of the last frame, in order. */
function drawOrder(fake) {
	const order = [];
	let current = null;
	for (const [name, ...args] of fake.calls) {
		if (name === 'pass.setPipeline') {
			const label = args[0][0].desc.label ?? '';
			current = label.startsWith('world-') ? label.slice(6).split(':')[0] : 'records';
		}
		if (name === 'pass.draw') {
			order.push(current);
		}
	}
	return order;
}
const dedupe = list => list.filter((p, i) => p !== list[i - 1]);

describe('C-17 acceptMapMessage (MAP_* payloads, shapes unchanged)', () => {
	it('uploads ground, water (one 32-layer array), models, animated models and the grid texture', async () => {
		const { backend, fake } = await makeBackend();
		await loadMap(backend);
		const world = backend.world;
		expect(world.ground.gpu.count).toBe(6);
		expect(world.water.gpu.scales.every(s => s[0] === 1 && s[1] === 1)).toBe(true);
		const water = fake.calls.find(c => c[0] === 'createTexture' && c[1].label === 'world-water')[1];
		expect(water.size).toEqual({ width: 64, height: 64, depthOrArrayLayers: 32 });
		expect(world.grid.gpu.texture).toBeTruthy();
		expect(world.animated).toHaveLength(1);
		expect(world.animatedGpu.runs.length).toBeGreaterThan(0);
		// the matrix palette is a storage buffer, one mat4 per (node, instance)
		const palette = fake.calls.find(c => c[0] === 'createBuffer' && c[1].label === 'world-animated-palette')[1];
		expect(palette.size).toBe(2 * 64);
		expect(palette.usage & 0x80).toBe(0x80);
	});

	it('drops messages of another load request (MapRenderer loadEvent)', async () => {
		const { backend } = await makeBackend();
		backend.beginMap(2);
		await backend.acceptMapMessage({ type: 'MAP_MODELS', payload: MODELS, request: 1 });
		expect(backend.world.models).toBeNull();
	});

	it('R-PERF-004: one draw per contiguous run of same-class textures, legacy order kept', async () => {
		const { backend } = await makeBackend();
		await loadMap(backend);
		// classes: 128, 128 (100×60 → 128×64), 256, 64 → three runs, in info order
		expect(backend.world.models.runs.map(r => [r.key, r.first, r.count])).toEqual([
			['128:0', 0, 6],
			['256:0', 6, 3],
			['64:0', 9, 3]
		]);
		expect(backend.world.models.layers.slot(1).scale).toEqual([1, 0.5]);
	});

	it('the animated palette is capped at maxStorageBufferBindingSize (models past it are not drawn)', async () => {
		const { backend } = await makeBackend({ limits: { maxStorageBufferBindingSize: 64 } });
		await loadMap(backend);
		expect(backend.world.paletteOverflow).toBe(1);
		expect(backend.world.animatedGpu.runs).toEqual([]);
	});
});

describe('R-CTX-010 world steps inside drawFrame (one scene pass)', () => {
	it('ground, grid, static models, animated models, records, water, in step order, after the sky clear', async () => {
		const { backend, fake } = await makeBackend();
		await loadMap(backend);
		fake.calls.length = 0;
		const sprite = {
			kind: 'sprite',
			texture: 'f',
			palette: 'p',
			textureClass: 'indexed',
			position: [1, 2, 3],
			offset: [0, 0],
			size: [64, 128],
			color: [1, 1, 1, 1],
			blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
			depthTest: true,
			depthWrite: true
		};
		const stats = backend.drawFrame(
			{ entitiesNonEffect: [sprite] },
			{ view: VIEW, world: { sky: { skyColor: [0.1, 0.2, 0.3, 1] }, tick: 100, grid: [{ x: 0, y: 0 }] } }
		);
		expect(stats).toMatchObject({ drawn: true, records: 1, unsupportedRecords: 0 });
		const [scenePass] = fake.calls.filter(c => c[0] === 'beginRenderPass').map(c => c[1]);
		expect(scenePass.colorAttachments[0].clearValue).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
		expect(scenePass.occlusionQuerySet).toBe(backend.world.occlusionQuerySet);
		// the sprite record has no frame source here: its batch draws nothing, the order is still checked
		expect(dedupe(drawOrder(fake))).toEqual([
			'ground',
			'grid',
			'static',
			'animated',
			'records',
			'water',
			'records'
		]);
		expect(stats.worldDrawCalls).toBe(1 + 1 + 3 + 2 + 1);
	});

	it('world steps are batches of their own between the records of the neighbouring steps', () => {
		const marker = step => ({ kind: 'worldStep', step });
		expect(programOf(marker('ground'))).toBe('world');
		expect(batchKey(marker('staticModels'))).not.toBe(batchKey(marker('animatedModels')));
		expect(splitBatches([marker('staticModels'), marker('animatedModels')])).toHaveLength(2);
	});

	it('a water record supplies the R-MAP-010 alpha and frame; default is 0.8 applied once', async () => {
		const { backend, fake } = await makeBackend();
		await loadMap(backend);
		const waterBlock = () => {
			const offset = fake.calls
				.filter(c => c[0] === 'pass.setBindGroup' && c[1][1] === backend.world.water.gpu.group)
				.map(c => c[1][2][0])[0];
			const write = fake.calls.find(
				c => c[0] === 'queue.writeBuffer' && c[1][1] === offset && c[1][0] === backend.world._gpu.uniforms
			);
			const buffer = write[1][2];
			return {
				f: new Float32Array(buffer, 0, WORLD_UNIFORM_BYTES / 4),
				u: new Uint32Array(buffer, 0, WORLD_UNIFORM_BYTES / 4)
			};
		};
		fake.calls.length = 0;
		backend.drawFrame({}, { view: VIEW, world: { tick: 1000 } });
		expect(waterBlock().f[60]).toBeCloseTo(0.8, 6);
		expect(waterBlock().u[61]).toBe(Math.floor(60 / 3) % 32);
		fake.calls.length = 0;
		const stats = backend.drawFrame(
			{
				water: [
					{ kind: 'world', part: 'water', alpha: 0.5, textureIndex: 7, depthTest: true, depthWrite: false }
				]
			},
			{ view: VIEW, world: { tick: 1000 } }
		);
		expect(stats.unsupportedRecords).toBe(0);
		expect(waterBlock().f[60]).toBe(0.5);
		expect(waterBlock().u[61]).toBe(7);
	});

	it("an animatedModel record replaces that model's matrices", async () => {
		const { backend, fake } = await makeBackend();
		await loadMap(backend);
		const matrices = new Float32Array(32).fill(3);
		fake.calls.length = 0;
		backend.drawFrame(
			{ animatedModels: [{ kind: 'world', part: 'animatedModel', params: { model: 0 }, matrices }] },
			{ view: VIEW, world: { tick: 0 } }
		);
		const palette = backend.world.animatedGpu.gpu.palette;
		const write = fake.calls.find(c => c[0] === 'queue.writeBuffer' && c[1][0] === palette);
		expect(Array.from(new Float32Array(write[1][2]).slice(0, 32))).toEqual(Array(32).fill(3));
	});
});

describe('R-MAP-019 occlusion queries (GPUQuerySet, resolved and read back late)', () => {
	it('query pass only while active, resolved after the pass, mapped after the submit, never re-issued while pending', async () => {
		const { backend, fake } = await makeBackend();
		await loadMap(backend);
		const world = backend.world;
		const set = fake.calls.find(c => c[0] === 'createQuerySet')[1];
		expect(set).toMatchObject({ type: 'occlusion', count: 2 });
		const frame = (tick, mode = 'dither') =>
			backend.drawFrame({}, { view: VIEW, world: { tick, occluder: { mode, focus: [0, 0, 0] } } });
		fake.calls.length = 0;
		frame(100, 'off');
		expect(fake.calls.filter(c => c[0] === 'pass.beginOcclusionQuery')).toHaveLength(0);
		fake.calls.length = 0;
		frame(130);
		// static, then animated models; each is a colour-write-off redraw inside the query
		expect(fake.calls.filter(c => c[0] === 'pass.beginOcclusionQuery').map(c => c[1][0])).toEqual([0, 1]);
		const resolves = fake.calls.filter(c => c[0] === 'resolveQuerySet').map(c => c[1].slice(1, 2).concat(c[1][4]));
		expect(resolves).toEqual([
			[0, 0],
			[1, 256]
		]);
		const names = fake.calls.map(c => c[0]);
		expect(names.lastIndexOf('resolveQuerySet')).toBeLessThan(names.indexOf('queue.submit'));
		const queryPipelines = fake.calls
			.filter(c => c[0] === 'pass.setPipeline' && c[1][0].desc.fragment?.targets[0].writeMask === 0)
			.map(c => c[1][0].desc.depthStencil.depthCompare);
		expect(queryPipelines).toEqual(['always', 'always']);
		// pending: the next frame (read-back not landed yet) issues no query
		fake.calls.length = 0;
		frame(160);
		expect(fake.calls.filter(c => c[0] === 'pass.beginOcclusionQuery')).toHaveLength(0);
		await world.whenQueriesRead();
		// the result (0 samples: not blocked) is collected by the next frame, which issues new queries
		fake.calls.length = 0;
		frame(190);
		expect(world.occluder.hit).toEqual([false, false]);
		expect(fake.calls.filter(c => c[0] === 'pass.beginOcclusionQuery')).toHaveLength(2);
	});

	it('strength rises Δt/150 while a query reports samples, in the frame after the read-back', async () => {
		const { backend } = await makeBackend();
		await loadMap(backend);
		const world = backend.world;
		const frame = tick => backend.drawFrame({}, { view: VIEW, world: { tick, occluder: { mode: 'alpha' } } });
		frame(100);
		world.occluder.result = [true, false];
		world.occluder.ready = [true, true];
		frame(130);
		expect(world.occluderStrength).toBeCloseTo(30 / 150, 6);
		expect(OCCLUDER_MODE.QUERY).toBe(4);
	});
});

describe('R-CTX-007 device loss rebuilds the map from retained payloads', () => {
	it('re-uploads ground, water and models on the new device without the worker', async () => {
		const { backend, fake } = await makeBackend();
		await loadMap(backend);
		// (calls kept: the fake counts requestDevice calls to hand out a new device)
		const mark = fake.calls.length;
		fake.loseDevice('unknown');
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(await backend.recovered()).toBe('webgpu');
		const world = backend.world;
		expect(world.device).toBe(fake.devices[1]);
		expect(world.ground.gpu.count).toBe(6);
		expect(world.models.runs).toHaveLength(3);
		const textures = fake.calls
			.slice(mark)
			.filter(c => c[0] === 'createTexture' && String(c[1].label).startsWith('world-'));
		expect(textures.map(c => c[1].label)).toEqual(
			expect.arrayContaining([
				'world-lightmap',
				'world-tile-color',
				'world-ground-atlas',
				'world-water',
				'world-grid'
			])
		);
		expect(fake.calls.slice(mark).some(c => c[0] === 'createQuerySet')).toBe(true);
		const stats = backend.drawFrame({}, { view: VIEW, world: { tick: 10 } });
		expect(stats.worldDrawCalls).toBeGreaterThan(0);
	});
});

describe('World uniform block', () => {
	it('packs the WGSL World struct offsets (common.wgsl)', () => {
		const out = new ArrayBuffer(WORLD_UNIFORM_BYTES);
		packWorldUniforms(out, {
			modelView: Array.from({ length: 16 }, (_, i) => i),
			projection: Array.from({ length: 16 }, (_, i) => 100 + i),
			light: { direction: [1, 2, 3], opacity: 0.5, ambient: [4, 5, 6], diffuse: [7, 8, 9], env: [10, 11, 12] },
			lightmapUse: true,
			smoothLight: 2,
			occluder: {
				mode: OCCLUDER_MODE.DITHER,
				eye: [13, 14, 15],
				radius: 5,
				focus: [16, 17, 18],
				opacity: 0.25,
				strength: 0.75
			},
			water: { waveHeight: 0.1, wavePitch: 50, offset: -180, opacity: 0.8, layer: 3, scale: [0.5, 1] },
			targetHeight: 480,
			flipY: true,
			fog: { use: true, near: 30, far: 60, color: [0.1, 0.2, 0.3] }
		});
		const f = new Float32Array(out);
		const u = new Uint32Array(out);
		expect(f[15]).toBe(15);
		expect(f[16]).toBe(100);
		expect([f[32], f[35], f[36], f[40], f[44]]).toEqual([1, 0.5, 4, 7, 10]);
		expect([u[39], u[43], u[47]]).toEqual([1, 2, 1]);
		expect([f[48], f[51], f[52], f[55], f[56]]).toEqual([13, 5, 16, 0.25, 0.75]);
		expect([f[57], f[58], f[59], u[61], f[62], f[63]].map(v => Math.fround(v))).toEqual(
			[0.1, 50, -180, 3, 0.5, 1].map(Math.fround)
		);
		expect([f[64], f[65]]).toEqual([480, 1]);
		expect([u[71], f[72], f[73]]).toEqual([1, 30, 60]);
		expect(WORLD_UNIFORM_BYTES).toBe(74 * 4 + 8);
		expect(WORLD_UNIFORM_STRIDE % 256).toBe(0);
		// the WGSL struct ends with the Fog block at byte 272
		expect(SHADERS.ground).toContain('target_height : f32, flip_y : f32, _pad1 : f32, _pad2 : f32,\n  fog : Fog,');
	});

	it('world shaders mirror the legacy GLSL arithmetic', () => {
		expect(SHADERS.water).toContain('let diff = select(0.0, select(-1.0, 1.0, y < 1.0), x < 1.0);');
		expect(SHADERS.water).toContain('fn glsl_mod(x : f32, y : f32) -> f32');
		expect(SHADERS.ground).toContain('if (any(i.tile_color_uv != vec2f(0.0, 0.0))) {\n    tex *= tile_color;');
		expect(SHADERS.models).toContain(
			'o.light_weighting = (1.0 - u.light_opacity) + light_weight * u.light_opacity;'
		);
		expect(SHADERS.models).toContain('var<storage, read> palette : array<mat4x4f>;');
		expect(SHADERS.models).toContain('select(u.target_height - frag_coord.y, frag_coord.y, u.flip_y > 0.5)');
		expect(SHADERS.grid).toContain('p.y -= 0.1;');
	});
});

describe('R-CTX-012 map light', () => {
	it('env = 1 − (1 − D)(1 − A); direction = −(RotY(lon)·RotX(lat)·(0,1,0)) in float32', () => {
		const light = mapLight({
			longitude: 45,
			latitude: 30,
			diffuse: [1, 0.5, 0],
			ambient: [0, 0.5, 0.5],
			opacity: 1
		});
		expect(Array.from(light.env)).toEqual([1, 0.75, 0.5]);
		const m = chain(rotationY(45), rotationX(30));
		const expected = [-m[4], -m[5], -m[6]];
		Array.from(light.direction).forEach((c, i) => expect(c).toBeCloseTo(expected[i], 6));
	});
});

describe('R-MAP-016/017 animated RSM matrices (copy of gpu-webgl2 animatedRsm.js)', () => {
	it('position keys interpolate; the child inherits the parent; buckets gate recomputation', () => {
		const model = new AnimatedRsm(structuredClone(ANIMATED));
		expect(model.update(0, false, true)).toBe(true);
		expect(Array.from(model.matrices.slice(12, 15))).toEqual([10, 0, 20]);
		expect(Array.from(model.matrices.slice(28, 31))).toEqual([10, 1, 20]);
		// fps 20 → bucket 1000 / (20 / 1.14) = 57 ms
		expect(model.update(50)).toBe(false);
		expect(model.update(250)).toBe(true);
		expect(model.matrices[12]).toBeCloseTo(11, 5);
		expect(model.matrices[28]).toBeCloseTo(11, 5);
		expect(model.update(1250)).toBe(false);
	});

	it('#69 FIX: before a first key after frame 0 the first key is held (legacy: NaN), the child follows', () => {
		const data = structuredClone(ANIMATED);
		data.nodes[0].posKeyframes = [
			{ frame: 200, px: 2, py: 0, pz: 0 },
			{ frame: 600, px: 4, py: 0, pz: 0 }
		];
		data.nodes[0].rotKeyframes = [
			{ frame: 100, q: [0, 0, 0, 1] },
			{ frame: 300, q: [0, 0, 1, 0] }
		];
		data.nodes[0].scaleKeyFrames = [
			{ Frame: 100, Scale: [1, 1, 1] },
			{ Frame: 300, Scale: [2, 2, 2] }
		];
		const model = new AnimatedRsm(data);
		model.update(0, false, true);
		expect(model.matrices.every(Number.isFinite)).toBe(true);
		expect(Array.from(model.matrices.slice(12, 15))).toEqual([12, 0, 20]);
		expect(Array.from(model.matrices.slice(28, 31))).toEqual([12, 1, 20]);
		const before = Array.from(model.matrices);
		// at the first keys themselves (rotation / scale at 100, position at 200) nothing moves
		model.update(100, false, true);
		expect(Array.from(model.matrices)).toEqual(before);
		model.update(200, false, true);
		expect(model.matrices[12]).toBe(12);
		// interpolation after the first key is unchanged
		model.update(400, false, true);
		expect(model.matrices[12]).toBe(13);
	});

	it('geometry is grouped by texture id, then node, then instance (legacy layout)', () => {
		const model = new AnimatedRsm(structuredClone(ANIMATED));
		expect(model.meshes).toEqual([
			{ textureIndex: 0, vertOffset: 0, vertCount: 6 },
			{ textureIndex: 1, vertOffset: 6, vertCount: 6 }
		]);
		expect(model.vertexData[9]).toBe(0);
		expect(model.vertexData[3 * 10 + 9]).toBe(1);
	});

	it('MapWorld is usable standalone (init, accept, encode) on a device', async () => {
		const fake = createFakeGpu();
		const world = await new MapWorld({ device: fake.device, images, createCanvas: fakeCanvas }).init();
		await world.accept({ type: 'MAP_MODELS', payload: MODELS });
		expect(world.loaded).toBe(true);
		world.beginFrame({ view: VIEW, frame: {}, targetHeight: 480 });
		const calls = [];
		const pass = new Proxy(
			{},
			{
				get:
					(_, name) =>
					(...a) =>
						calls.push([name, a])
			}
		);
		expect(world.encodeStep(pass, 'staticModels')).toBe(3);
		expect(calls.filter(c => c[0] === 'draw').map(c => c[1])).toEqual([
			[6, 1, 0, 0],
			[3, 1, 6, 0],
			[3, 1, 9, 0]
		]);
	});
});
