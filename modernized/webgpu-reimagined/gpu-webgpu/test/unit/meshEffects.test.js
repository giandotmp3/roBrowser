import { describe, expect, it } from 'vitest';
import { createFakeGpu } from '../support/fakeGpu.js';
import { SpriteResidency, RESIDENT_EFFECT_FAMILIES } from '../../src/residency/SpriteResidency.js';
import { TextureArrayPools } from '../../src/residency/TextureArrayPools.js';
import { RunRenderer } from '../../src/batching/RunRenderer.js';
import { batchKey, effectProgram, programOf, splitBatches } from '../../src/sprites/runs.js';
import { fromLegacyEffectRecord } from '../../src/effects/legacyRecord.js';
import {
	MESH_PROGRAMS,
	RSM_LIGHT,
	meshFloats,
	meshShaderSource,
	meshVertexBuffers,
	textureField
} from '../../src/effects/mesh/programs.js';
import {
	MESH_EFFECT_FAMILIES,
	MESH_EFFECT_PROGRAM,
	TEXTURED_MESH_FAMILIES,
	meshProgramKey,
	meshWrap
} from '../../src/effects/mesh/meshFamilies.js';
import { cylinderMesh, groundRingMesh, swirlingAuraIndices } from '../../src/effects/mesh/meshes.js';
import { normalMatrix, rotationAboutAxis } from '../../src/effects/mesh/legacyMatrix.js';
import {
	MESH_FRAME_BYTES,
	MESH_WRAPS,
	meshCensus,
	meshSpec,
	packMeshFrame
} from '../../src/effects/mesh/MeshEffectPipeline.js';
import { SCENE_WRITE_MASK, describePipeline } from '../../src/pipelines/PipelineSet.js';
import { ADDITIVE, NORMAL } from '../../src/pipelines/pipelineKey.js';

const ROT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** One record of each mesh family, in the shape legacy and render-records emit (as gpu-webgl2's test). */
const SAMPLES = {
	'flat-texture': { params: { size: 0, textureSize: 64 }, color: [1, 1, 1, 0] },
	'hovering-texture': { params: { size: 0.5, textureSize: 64 }, color: [1, 1, 1, 0.7] },
	lp: { params: { size: 0.8, textureSize: 64 }, color: [1, 1, 1, 0.7] },
	'spider-web': { params: { size: 1.5, textureSize: 128 }, color: [1, 1, 1, 0.7] },
	'flat-color-tile': { texture: null, params: { size: 0.5 }, color: [1, 0.5, 0.7, 0.6] },
	'property-ground': { params: { topSize: 3, bottomSize: 1, height: 2, rotation: ROT }, color: [1, 1, 1, 0.42] },
	'magic-ring': { params: { topSize: 2.45, bottomSize: 0.8, height: 2.8, rotation: ROT }, color: [1, 1, 1, 0.7] },
	cylinder: {
		params: {
			topSize: 1,
			bottomSize: 0.5,
			height: 3,
			zIndex: 0,
			rotate: true,
			rotation: ROT,
			totalCircleSides: 20,
			circleSides: 20,
			repeatTextureX: 1,
			textureRepeat: false
		}
	},
	quadhorn: {
		params: {
			height: 2,
			offsetX: 0.5,
			offsetY: 0.5,
			offsetZ: 0.5,
			sinkOffsetZ: null,
			bottomSize: 0.4,
			rotateX: 10,
			rotateY: 20,
			rotateZ: 30
		}
	},
	'spirit-sphere': { params: { size: 0.3, zIndex: 0.01, cameraZoom: 1, rotation: ROT, textureRotation: ROT } },
	'warlock-sphere': { params: { size: 0.3, zIndex: 0.01, cameraZoom: 1, rotation: ROT, textureRotation: ROT } },
	'lock-on': { params: { shade: 0.5, size: 3, rotation: ROT } },
	'magic-target': {
		params: { x: 1, y: 2, size: 1, cameraLatitude: -50, rotation: ROT, vertexCount: 6, vertices: new Float32Array(30) }
	},
	groundAura: { params: { size: [100, 100], angle: 0.4, zIndex: 1 } },
	swirlingAura: { params: { vertices: new Float32Array(42 * 5), indexCount: 120, zIndex: 0.01 } },
	level99Bubble: { params: { quad: new Float32Array(30), zIndex: 0.01, vertexCount: 6 } },
	rsm: { params: { size: 1, vertCount: 3, vertices: new Float32Array(27) } },
	waterfall: { params: { vertices: new Float32Array(20), modelMatrix: ROT } },
	waterfallSpray: {
		params: { modelMatrix: ROT, time: 0.5, size: 0.1, seeds: new Float32Array(3 * 4), instanceCount: 3 }
	},
	rainPuddle: { params: { size: 60, angle: 1, zIndex: 1, time: 1.5, cameraPosition: [1, 2, 3] } }
};

const sample = (family, fields = {}) => ({
	kind: 'effect',
	family,
	pass: 'after',
	texture: `img:${family}`,
	position: [10, 20, 1],
	color: [1, 1, 1, 1],
	blend: NORMAL,
	depthTest: true,
	depthWrite: true,
	depthCorrection: false,
	fog: false,
	strAttachment: false,
	...SAMPLES[family],
	...fields
});

function fakePass() {
	const calls = [];
	const pass = new Proxy(
		{},
		{
			get:
				(_, name) =>
				(...args) =>
					calls.push([name, ...args])
		}
	);
	return { pass, calls };
}

async function setup() {
	const fake = createFakeGpu();
	const rgba = (w, h) => ({ format: 'rgba8', width: w, height: h, data: new Uint8Array(w * h * 4) });
	const residency = new SpriteResidency({
		uploader: new TextureArrayPools({ device: fake.device }),
		now: () => 0,
		source: { frame: handle => (String(handle).startsWith('img:') ? rgba(64, 32) : null), palette: () => null }
	});
	const runs = await new RunRenderer({ device: fake.device, residency, sampleCount: 1 }).init();
	return { fake, residency, runs };
}

/** `VertexIn` fields of a WGSL program body: [location, name, components]. */
function wgslAttributes(wgsl) {
	const struct = wgsl.slice(wgsl.indexOf('struct VertexIn'), wgsl.indexOf('};', wgsl.indexOf('struct VertexIn')));
	return [...struct.matchAll(/@location\((\d+)\)\s+(\w+)\s*:\s*(f32|vec([234])f)/g)].map(m => [
		Number(m[1]),
		m[2],
		m[4] ? Number(m[4]) : 1
	]);
}

describe('mesh effect families on WebGPU (MeshEffectPipeline)', () => {
	it('maps every family to a program; the textured ones are resident; every family is drawn', () => {
		expect(MESH_EFFECT_FAMILIES).toHaveLength(20);
		expect(new Set(Object.values(MESH_EFFECT_PROGRAM)).size).toBe(15);
		for (const family of MESH_EFFECT_FAMILIES) {
			expect(MESH_PROGRAMS[MESH_EFFECT_PROGRAM[family]]).toBeDefined();
			expect(SAMPLES[family]).toBeDefined();
			expect(programOf(sample(family))).toBe('mesh');
		}
		expect(TEXTURED_MESH_FAMILIES).not.toContain('flat-color-tile');
		expect(RESIDENT_EFFECT_FAMILIES).toEqual(expect.arrayContaining(TEXTURED_MESH_FAMILIES));
	});

	it('declares each program’s WGSL attributes in field order, within the 16 WebGPU guarantees', () => {
		for (const program of Object.values(MESH_PROGRAMS)) {
			const fields = [...program.vertex, ...program.instance];
			expect(fields.length, program.id).toBeLessThanOrEqual(16);
			expect(wgslAttributes(program.wgsl), program.id).toEqual(
				fields.map(([name, size], location) => [location, name, size])
			);
			const source = meshShaderSource(program);
			expect(source).toContain('fn vs_main');
			expect(source).toContain('fn fs_main');
			expect(source).toContain('fn gl_to_webgpu');
			// Every program ends in GL clip space and remaps once (sprite.wgsl / str.wgsl convention).
			expect(program.wgsl).toMatch(/gl_to_webgpu\(/);
		}
	});

	it('vertex buffer layouts match the packed floats (mesh per vertex, records per instance or per stream vertex)', () => {
		for (const program of Object.values(MESH_PROGRAMS)) {
			const layouts = meshVertexBuffers(program);
			const floats = meshFloats(program);
			const locations = layouts.flatMap(l => l.attributes.map(a => a.shaderLocation));
			expect(locations).toEqual([...program.vertex, ...program.instance].map((_, i) => i));
			if (program.mode === 'stream') {
				expect(layouts).toHaveLength(1);
				expect(layouts[0]).toMatchObject({ stepMode: 'vertex', arrayStride: floats.unit * 4 });
			} else {
				const instance = layouts[layouts.length - 1];
				expect(instance).toMatchObject({ stepMode: 'instance', arrayStride: floats.instance * 4 });
				expect(layouts).toHaveLength(program.vertex.length ? 2 : 1);
			}
			for (const layout of layouts) {
				expect(layout.arrayStride).toBeLessThanOrEqual(2048);
			}
		}
	});

	it('packs exactly the declared floats per instance or vertex, the texture field last', () => {
		const tex = [3, 1, 1, 0.5];
		for (const family of MESH_EFFECT_FAMILIES) {
			const program = MESH_PROGRAMS[MESH_EFFECT_PROGRAM[family]];
			const record = sample(family);
			const units = program.mode === 'stream' ? program.vertices(record) : (program.instances?.(record) ?? 1);
			const per = meshFloats(program).unit;
			const out = new Float32Array(units * per + 8);
			expect(program.pack(record, tex, out, 0), family).toBe(units * per);
			if (program.textured !== false) {
				expect(Array.from(out.subarray(per - 4, per)), family).toEqual(tex);
			}
		}
	});

	it('streams per-record vertices in legacy order (swirling band de-indexed)', () => {
		const indices = swirlingAuraIndices();
		expect(indices).toHaveLength(120);
		const vertices = new Float32Array(42 * 5).map((_, i) => i);
		const per = meshFloats(MESH_PROGRAMS.swirlingAura).unit;
		const out = new Float32Array(120 * per);
		MESH_PROGRAMS.swirlingAura.pack(
			sample('swirlingAura', { params: { vertices, indexCount: 120, zIndex: 0.5 } }),
			[0, 0, 1, 1],
			out,
			0
		);
		expect(Array.from(out.subarray(2 * per, 2 * per + 5))).toEqual([10, 11, 12, 13, 14]);
		expect(Array.from(out.subarray(3 * per, 3 * per + 5))).toEqual([5, 6, 7, 8, 9]);
		expect(MESH_PROGRAMS.magicTarget.vertices(sample('magic-target', { params: { vertexCount: 6 } }))).toBe(0);
	});

	it('generates the legacy static meshes and gl-matrix rotations (copies of gpu-webgl2)', () => {
		expect(groundRingMesh().length / 5).toBe(20 * 6 + 3);
		expect(cylinderMesh(12, 6, 3).length / 5).toBe(6 * 6 + 3);
		const rad = (37 * Math.PI) / 180;
		const c = Math.fround(Math.cos(rad));
		const s = Math.fround(Math.sin(rad));
		expect(Array.from(rotationAboutAxis(rad, [1, 0, 0]))).toEqual([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
		expect(normalMatrix(new Float32Array(16))).toBeNull();
	});

	it('packs the pass block as common.wgsl lays it out (mat3 columns 16 bytes apart, RSM light, fog)', () => {
		const modelView = [2, 0, 0, 0, 0, 0.5, 0.3, 0, 0, -0.3, 0.5, 0, 4, 5, 6, 1];
		const projection = Array.from({ length: 16 }, (_, i) => i + 100);
		const buffer = packMeshFrame({
			modelView,
			projection,
			zoom: 30,
			fog: { use: false, near: 30, far: 56, color: [0.5, 0.25, 0.75] }
		});
		expect(buffer.byteLength).toBe(MESH_FRAME_BYTES);
		const f = new Float32Array(buffer);
		expect(Array.from(f.subarray(0, 16))).toEqual(modelView.map(Math.fround));
		expect(Array.from(f.subarray(16, 32))).toEqual(projection);
		const n = normalMatrix(modelView);
		expect(Array.from(f.subarray(32, 35))).toEqual(Array.from(n.subarray(0, 3)));
		expect(Array.from(f.subarray(36, 39))).toEqual(Array.from(n.subarray(3, 6)));
		expect(Array.from(f.subarray(40, 43))).toEqual(Array.from(n.subarray(6, 9)));
		expect(Array.from(f.subarray(44, 48))).toEqual([...RSM_LIGHT.direction, RSM_LIGHT.opacity]);
		expect(Array.from(f.subarray(48, 51))).toEqual(Array.from(RSM_LIGHT.ambient));
		expect(Array.from(f.subarray(52, 55))).toEqual(Array.from(RSM_LIGHT.diffuse));
		// Fog values are uploaded even when the scene fog is off: each record's flag decides.
		expect(Array.from(f.subarray(56, 61))).toEqual([0.5, 0.25, 0.75, 30, 56]);
	});

	it('batches by program, wrap and static mesh; never across them (same keys as gpu-webgl2)', () => {
		const lp = sample('lp');
		const hover = sample('hovering-texture');
		const spider = sample('spider-web');
		expect(batchKey(lp)).toBe(batchKey(hover));
		expect(batchKey(lp)).toBe(batchKey(spider));
		expect(meshWrap(lp)).toBe('repeat');
		const cyl = sample('cylinder');
		const repeatCyl = sample('cylinder', { params: { ...SAMPLES.cylinder.params, textureRepeat: true } });
		const sixSides = sample('cylinder', { params: { ...SAMPLES.cylinder.params, circleSides: 6 } });
		expect(effectProgram(cyl)).toBe('mesh:cylinder:clamp:20/20/1');
		expect(batchKey(cyl)).not.toBe(batchKey(repeatCyl));
		expect(batchKey(cyl)).not.toBe(batchKey(sixSides));
		expect(batchKey(sample('property-ground'))).toBe(batchKey(sample('magic-ring')));
		expect(batchKey(sample('spirit-sphere'))).toBe(batchKey(sample('warlock-sphere')));
		expect(batchKey(lp)).not.toBe(batchKey(sample('lp', { blend: ADDITIVE })));
		expect(meshProgramKey({ family: 'str' })).toBeNull();
		expect(splitBatches([lp, hover, cyl, cyl, spider]).map(r => [r.start, r.count])).toEqual([
			[0, 2],
			[2, 2],
			[4, 1]
		]);
	});

	it('pipelines: per-program family and topology, record blend and depth, RGB-only writes', () => {
		const spec = meshSpec(sample('waterfall', { blend: ADDITIVE, depthWrite: false }));
		expect(spec).toEqual({
			family: 'mesh-waterfall',
			blend: ADDITIVE,
			depthTest: true,
			depthWrite: false,
			topology: 'triangle-strip'
		});
		expect(meshSpec(sample('rsm', { blend: null })).blend).toEqual(NORMAL);
		const desc = describePipeline(meshSpec(sample('cylinder')), {
			module: {},
			layout: 'auto',
			buffers: meshVertexBuffers(MESH_PROGRAMS.cylinder)
		});
		expect(desc.fragment.targets[0].writeMask).toBe(SCENE_WRITE_MASK);
		expect(desc.primitive.topology).toBe('triangle-list');
		expect(meshCensus()).toHaveLength(15 * 2);
	});

	it('draws one instanced call per static-mesh batch and one draw per stream batch, in stream order', async () => {
		const { fake, runs } = await setup();
		const records = [
			sample('property-ground'),
			sample('magic-ring'),
			sample('property-ground'),
			sample('rsm'),
			sample('rsm'),
			sample('waterfallSpray'),
			sample('waterfall'),
			sample('flat-color-tile')
		];
		await runs.warm(records);
		const { pass, calls } = fakePass();
		const stats = runs.encode(pass, records, { zoom: 30 });
		expect(stats).toMatchObject({ drawCalls: 5, batches: 5, fallbacks: 0, skipped: 0 });
		const draws = calls.filter(c => c[0] === 'draw').map(c => c.slice(1));
		expect(draws).toEqual([
			[20 * 6 + 3, 3, 0, 0], // three rings (static ring mesh × 3 instances)
			[6, 1, 0, 0], // two RSM records of 3 vertices each, streamed
			[4, 3, 0, 0], // spray: 4 corners × 3 seeds
			[4, 1, 0, 0], // waterfall strip, vertex_index corners
			[6, 1, 0, 0] // flat colour tile quad
		]);
		// Vertex buffers per batch: ring (mesh + instances), rsm (stream), spray (mesh + instances),
		// waterfall (instances only, slot 0), colour tile (mesh + instances).
		const slots = calls.filter(c => c[0] === 'setVertexBuffer').map(c => c[1]);
		expect(slots).toEqual([0, 1, 0, 0, 1, 0, 0, 1]);
		// One ring write for every mesh batch plus the pass block.
		const writes = fake.calls.filter(c => c[0] === 'queue.writeBuffer' && c[1][0].desc?.label !== 'mesh ring');
		expect(writes.some(c => c[1][0].desc?.label === 'mesh-frame')).toBe(true);
		// Static meshes are created once and reused.
		runs.encode(fakePass().pass, records, { zoom: 30 });
		const meshBuffers = fake.calls.filter(c => c[0] === 'createBuffer' && /^mesh (ring|sprayCorners|quadXY)/.test(c[1].label));
		expect(meshBuffers).toHaveLength(3);
	});

	it('binds the bind group of the batch’s texture wrap (repeat for tiles, clamp for rings)', async () => {
		const { fake, runs } = await setup();
		const records = [sample('lp'), sample('magic-ring'), sample('lp')];
		await runs.warm(records);
		const { pass, calls } = fakePass();
		runs.encode(pass, records, { zoom: 30 });
		const groups = calls.filter(c => c[0] === 'setBindGroup').map(c => c[2].desc.label);
		expect(groups).toEqual(['mesh group 0 (repeat)', 'mesh group 0 (clamp)', 'mesh group 0 (repeat)']);
		const samplers = fake.calls.filter(c => c[0] === 'createSampler' && /^mesh-/.test(c[1].label)).map(c => c[1]);
		expect(samplers).toHaveLength(3);
		expect(samplers.find(s => s.label === 'mesh-repeatS')).toMatchObject(MESH_WRAPS.repeatS);
	});

	it('uploads mesh family textures on miss and packs their layer; a miss packs layer −1', async () => {
		const { fake, residency, runs } = await setup();
		const records = [sample('quadhorn'), sample('flat-color-tile'), sample('lock-on', { texture: 'missing' })];
		runs.encode(fakePass().pass, records, { zoom: 30 });
		expect(residency.stats).toMatchObject({ frameUploads: 1, misses: 1 });
		const slot = residency.slotOf({ texture: 'img:quadhorn' });
		expect(textureField(slot)).toEqual([slot.layer, 1, 1, 0.5]);
		const ringWrite = fake.calls.filter(c => c[0] === 'queue.writeBuffer').find(c => c[1][0].desc?.label === 'sprite-instances');
		const data = new Float32Array(ringWrite[1][2], ringWrite[1][3], ringWrite[1][4] / 4);
		const quadhorn = meshFloats(MESH_PROGRAMS.quadhorn).unit;
		expect(Array.from(data.subarray(quadhorn - 4, quadhorn))).toEqual([slot.layer, 1, 1, 0.5]);
		expect(data[data.length - 4]).toBe(-1);
	});
});

describe('legacy mesh records → EffectDraw (fromLegacyEffectRecord)', () => {
	const native = (family, params, fields = {}) => ({
		kind: 'effect',
		family,
		pass: 'before',
		texture: { gl: 'texture' },
		position: [1, 2, 3],
		color: [1, 1, 1, 1],
		blend: NORMAL,
		depthTest: true,
		depthWrite: true,
		depthCorrection: false,
		fog: true,
		strAttachment: false,
		params,
		...fields
	});

	it('adds the magic-target ground plane and the puddle camera position, nothing else', () => {
		const plane = new Float32Array(9 * 30);
		const calls = [];
		const target = fromLegacyEffectRecord(native('magic-target', { x: 4.5, y: 6, size: 3, vertexCount: 54 }), {
			groundPlane: (x, y, size) => {
				calls.push([x, y, size]);
				return plane;
			}
		});
		expect(calls).toEqual([[4.5, 6, 3]]);
		expect(target.params.vertices).toBe(plane);
		expect(target.pass).toBe('before');
		expect(target.fog).toBe(true);
		const puddle = fromLegacyEffectRecord(native('rainPuddle', { size: 3 }), { cameraPosition: [7, 8, 9] });
		expect(puddle.params).toEqual({ size: 3, cameraPosition: [7, 8, 9] });
		const ring = native('magic-ring', { topSize: 1 });
		expect(fromLegacyEffectRecord(ring).params).toBe(ring.params);
	});

	it('hands the family to the texture handle and draws an invalid blend (#49) as normal alpha', () => {
		const families = [];
		const record = fromLegacyEffectRecord(native('cylinder', {}, { blend: null }), {
			textureHandle: (texture, family) => {
				families.push(family);
				return 'img:x';
			}
		});
		expect(families).toEqual(['cylinder']);
		expect(record.texture).toBe('img:x');
		expect(record.blend).toEqual(NORMAL);
	});
});
