import { describe, expect, it } from 'vitest';
import { WebGL2Backend } from '../../src/WebGL2Backend.js';
import { AnimatedRsm } from '../../src/world/animatedRsm.js';
import { mapLight } from '../../src/world/lighting.js';
import { chain, deg2rad, rotationX, rotationY } from '../../src/math.js';
import { GL } from '../../src/pipeline/glEnums.js';
import { createFakeCanvas, createFakeGl, createFakePorts } from '../support/fakeGl.js';

/** A fake 2D canvas factory (atlas, POT stretch, grid tint run on it). */
const fakeCanvas = (width, height) => ({
	width,
	height,
	getContext: () => ({ clearRect() {}, drawImage() {}, fillRect() {} })
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

function makeBackend(files = {}) {
	const gl = createFakeGl();
	const backend = new WebGL2Backend({
		...createFakePorts(),
		canvas: createFakeCanvas({ contexts: { webgl2: gl } }),
		images,
		createCanvas: fakeCanvas,
		files: { load: async path => files[path] ?? null }
	}).init();
	return { backend, gl };
}

const quad = (x, n) => {
	const out = [];
	for (let i = 0; i < n; i++) {
		out.push(x + i, 0, 0, 0, 1, 0, 0, 0, 1);
	}
	return out;
};

const WORLD = {
	water: { level: 1, type: 0, waveHeight: 0.2, waveSpeed: 2, wavePitch: 50, animSpeed: 3, images: Array(32).fill('64x64') },
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

describe('C-17 acceptMapMessage (MAP_* payloads, shapes unchanged)', () => {
	it('uploads ground, water, models, animated models and the grid texture', async () => {
		const { backend } = makeBackend({ 'data/texture/grid.tga': '32x32', 'data\\texture\\ice.bmp': '32x32', 'data\\texture\\fire.bmp': '40x20' });
		await loadMap(backend);
		const world = backend.world;
		expect(world.ground.gl.count).toBe(6);
		expect(world.water.gl.scales.every(s => s[0] === 1 && s[1] === 1)).toBe(true);
		expect(world.grid.gl.texture).toBeTruthy();
		expect(world.animated).toHaveLength(1);
		expect(world.animatedGpu.runs.length).toBeGreaterThan(0);
	});

	it('drops messages of another load request (MapRenderer loadEvent)', async () => {
		const { backend } = makeBackend();
		backend.beginMap(2);
		await backend.acceptMapMessage({ type: 'MAP_MODELS', payload: MODELS, request: 1 });
		expect(backend.world.models).toBeNull();
	});

	it('R-PERF-004: one draw per contiguous run of same-class textures, legacy order kept', async () => {
		const { backend } = makeBackend();
		await loadMap(backend);
		// classes: 128, 128 (100×60 → 128×64), 256, 64 → three runs, in info order
		expect(backend.world.models.runs.map(r => [r.key, r.first, r.count])).toEqual([
			['128:0', 0, 6],
			['256:0', 6, 3],
			['64:0', 9, 3]
		]);
		const slot = backend.world.models.layers.slot(1);
		expect(slot.scale).toEqual([1, 0.5]);
	});
});

describe('R-CTX-010 world steps inside drawFrame', () => {
	it('ground, grid, static models, animated models, water, in step order, after the clear', async () => {
		const { backend, gl } = makeBackend({ 'data/texture/grid.tga': '32x32', 'data\\texture\\ice.bmp': '32x32', 'data\\texture\\fire.bmp': '40x20' });
		await loadMap(backend);
		const programs = backend.world._program();
		const names = new Map(Object.entries(programs).map(([k, v]) => [v.program, k]));
		gl.clearCalls();
		backend.drawFrame({
			passes: {},
			view: VIEW,
			world: { sky: { skyColor: [0.1, 0.2, 0.3, 1] }, tick: 100, grid: [{ x: 0, y: 0 }] }
		});
		const order = [];
		let program = null;
		for (const [name, ...args] of gl.calls) {
			if (name === 'useProgram') {
				program = names.get(args[0]) ?? 'other';
			}
			if (name === 'clear') {
				order.push('clear');
			}
			if (name === 'drawArrays') {
				order.push(program);
			}
		}
		expect(gl.callsTo('clearColor')[0].slice(1)).toEqual([0.1, 0.2, 0.3, 1]);
		expect(order.filter((p, i) => p !== order[i - 1])).toEqual(['clear', 'ground', 'grid', 'models', 'animated', 'water']);
	});

	it('a water record supplies the R-MAP-010 alpha and frame; default is 0.8 applied once', async () => {
		const { backend, gl } = makeBackend();
		await loadMap(backend);
		const water = backend.world._program().water;
		const opacity = () => gl.callsTo('uniform1f').filter(c => c[1] === water.u.uOpacity).map(c => c[2]);
		gl.clearCalls();
		backend.drawFrame({ passes: {}, view: VIEW, world: { tick: 1000 } });
		expect(opacity()).toEqual([0.8]);
		gl.clearCalls();
		backend.drawFrame({
			passes: { water: [{ kind: 'world', part: 'water', alpha: 0.5, textureIndex: 7, depthTest: true, depthWrite: false }] },
			view: VIEW,
			world: { tick: 1000 }
		});
		expect(opacity()).toEqual([0.5]);
		expect(gl.callsTo('uniform1f').some(c => c[1] === water.u.uLayer && c[2] === 7)).toBe(true);
	});

	it('R-MAP-019: occluder query pass only while active, never re-issued while pending', async () => {
		const { backend, gl } = makeBackend();
		await loadMap(backend);
		const frame = tick => backend.drawFrame({ passes: {}, view: VIEW, world: { tick, occluder: { mode: 'dither' } } });
		gl.clearCalls();
		frame(100);
		expect(gl.callsTo('beginQuery')).toHaveLength(2); // static, then animated models
		frame(130);
		expect(gl.callsTo('beginQuery')).toHaveLength(2);
		expect(gl.callsTo('beginQuery')[0][1]).toBe(GL.ANY_SAMPLES_PASSED_CONSERVATIVE);
	});
});

describe('R-CTX-007 context restore rebuilds the map from retained payloads', () => {
	it('re-uploads ground, water and models without the worker', async () => {
		const { backend, gl } = makeBackend();
		await loadMap(backend);
		const canvas = backend._ports.canvas;
		canvas.fire('webglcontextlost');
		expect(backend.world.ground.gl).toBeNull();
		gl.clearCalls();
		canvas.fire('webglcontextrestored');
		expect(backend.world.ground.gl.count).toBe(6);
		expect(backend.world.models.runs).toHaveLength(3);
		expect(gl.callsTo('texStorage3D').length).toBeGreaterThanOrEqual(4);
	});
});

describe('R-CTX-012 map light', () => {
	it('env = 1 − (1 − D)(1 − A); direction = −(RotY(lon)·RotX(lat)·(0,1,0)) in float32', () => {
		const light = mapLight({ longitude: 45, latitude: 30, diffuse: [1, 0.5, 0], ambient: [0, 0.5, 0.5], opacity: 1 });
		expect(Array.from(light.env)).toEqual([1, 0.75, 0.5]);
		const m = chain(rotationY(deg2rad(45)), rotationX(deg2rad(30)));
		const expected = [-m[4], -m[5], -m[6]];
		Array.from(light.direction).forEach((c, i) => expect(c).toBeCloseTo(expected[i], 6));
	});
});

describe('R-MAP-016/017 animated RSM matrices', () => {
	it('position keys interpolate; the child inherits the parent; buckets gate recomputation', () => {
		const model = new AnimatedRsm(structuredClone(ANIMATED));
		expect(model.update(0, false, true)).toBe(true);
		// root at frame 0: translation 0; child: + pos (0, 1, 0); instance translation (10, 0, 20)
		expect(Array.from(model.matrices.slice(12, 15))).toEqual([10, 0, 20]);
		expect(Array.from(model.matrices.slice(28, 31))).toEqual([10, 1, 20]);
		// fps 20 → bucket 1000 / (20 / 1.14) = 57 ms
		expect(model.update(50)).toBe(false);
		expect(model.update(250)).toBe(true);
		expect(model.matrices[12]).toBeCloseTo(11, 5); // halfway between px 0 and 2
		expect(model.matrices[28]).toBeCloseTo(11, 5);
		// tick % animLen: 1250 ≡ 250, same bucket as the previous update
		expect(model.update(1250)).toBe(false);
	});

	it('geometry is grouped by texture id, then node, then instance (legacy layout)', () => {
		const model = new AnimatedRsm(structuredClone(ANIMATED));
		expect(model.meshes).toEqual([
			{ textureIndex: 0, vertOffset: 0, vertCount: 6 },
			{ textureIndex: 1, vertOffset: 6, vertCount: 6 }
		]);
		// matrix index (10th float) of the first vertex of each node within texture 0
		expect(model.vertexData[9]).toBe(0);
		expect(model.vertexData[3 * 10 + 9]).toBe(1);
	});
});
