import { describe, expect, it } from 'vitest';
import { Residency, RESIDENT_EFFECT_FAMILIES } from '../../src/residency/Residency.js';
import { TextureArrayPools } from '../../src/residency/TextureArrayPools.js';
import { RunRenderer } from '../../src/batching/RunRenderer.js';
import { batchKey, effectProgram, splitBatches } from '../../src/batching/runs.js';
import { GLStateCache } from '../../src/pipeline/GLStateCache.js';
import { GL } from '../../src/pipeline/glEnums.js';
import { fromLegacyEffectRecord } from '../../src/effects/legacyRecord.js';
import { MESH_PROGRAMS, textureField, vertexSource, fragmentSource } from '../../src/effects/mesh/programs.js';
import {
	MESH_EFFECT_FAMILIES,
	MESH_EFFECT_PROGRAM,
	TEXTURED_MESH_FAMILIES,
	meshProgramKey,
	meshWrap
} from '../../src/effects/mesh/meshFamilies.js';
import { cylinderMesh, groundRingMesh, swirlingAuraIndices } from '../../src/effects/mesh/meshes.js';
import { normalMatrix, rotationAboutAxis } from '../../src/effects/mesh/legacyMatrix.js';
import { createFakeGl } from '../support/fakeGl.js';
import { ADDITIVE, NORMAL, effect } from '../support/records.js';

const ROT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** One record of each mesh family, in the shape legacy and render-records emit. */
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

const sample = (family, fields = {}) =>
	effect({
		family,
		texture: `img:${family}`,
		position: [10, 20, 1],
		color: [1, 1, 1, 1],
		blend: NORMAL,
		depthTest: true,
		depthWrite: true,
		fog: false,
		...SAMPLES[family],
		...fields
	});

function setup() {
	const gl = createFakeGl();
	const rgba = (w, h) => ({ format: 'rgba8', width: w, height: h, data: new Uint8Array(w * h * 4) });
	const residency = new Residency({
		uploader: new TextureArrayPools({ gl }),
		now: () => 0,
		source: { frame: handle => (String(handle).startsWith('img:') ? rgba(64, 32) : null), palette: () => null }
	});
	const rr = new RunRenderer({ gl, state: new GLStateCache(gl), residency });
	return { gl, residency, rr };
}

describe('mesh effect families (MeshEffectPipeline)', () => {
	it('maps every family to a program; the textured ones are resident', () => {
		expect(MESH_EFFECT_FAMILIES).toHaveLength(Object.keys(SAMPLES).length);
		for (const family of MESH_EFFECT_FAMILIES) {
			expect(MESH_PROGRAMS[MESH_EFFECT_PROGRAM[family]]).toBeDefined();
			expect(SAMPLES[family]).toBeDefined();
		}
		expect(TEXTURED_MESH_FAMILIES).not.toContain('flat-color-tile');
		expect(RESIDENT_EFFECT_FAMILIES).toEqual(expect.arrayContaining(TEXTURED_MESH_FAMILIES));
	});

	it('declares each program’s attributes in order, within the 16 WebGL2 guarantees', () => {
		for (const program of Object.values(MESH_PROGRAMS)) {
			const fields = [...program.vertex, ...program.instance];
			expect(fields.length).toBeLessThanOrEqual(16);
			const vs = vertexSource(program);
			expect(vs).not.toMatch(/#pragma attributes/);
			fields.forEach(([name, size], location) => {
				const type = size === 1 ? 'float' : `vec${size}`;
				expect(vs).toContain(`layout(location = ${location}) in ${type} ${name};`);
			});
			expect(fragmentSource(program)).not.toMatch(/#include/);
		}
	});

	it('packs exactly the declared floats per instance or vertex', () => {
		const tex = [3, 1, 1, 0.5];
		for (const family of MESH_EFFECT_FAMILIES) {
			const program = MESH_PROGRAMS[MESH_EFFECT_PROGRAM[family]];
			const record = sample(family);
			const vertexFloats = program.vertex.reduce((n, [, s]) => n + s, 0);
			const instanceFloats = program.instance.reduce((n, [, s]) => n + s, 0);
			const units =
				program.mode === 'stream' ? program.vertices(record) : (program.instances?.(record) ?? 1);
			const per = program.mode === 'stream' ? vertexFloats + instanceFloats : instanceFloats;
			const out = new Float32Array(units * per + 8);
			expect(program.pack(record, tex, out, 0), family).toBe(units * per);
			if (program.textured !== false) {
				// The texture field is the last of each unit.
				expect(Array.from(out.subarray(per - 4, per)), family).toEqual(tex);
			}
		}
	});

	it('streams per-record vertices in legacy order (swirling band de-indexed, bubble quad, RSM, plane)', () => {
		const indices = swirlingAuraIndices();
		expect(indices).toHaveLength(120);
		expect(Array.from(indices.subarray(0, 6))).toEqual([0, 1, 2, 1, 3, 2]);
		const vertices = new Float32Array(42 * 5).map((_, i) => i);
		const program = MESH_PROGRAMS.swirlingAura;
		const per = 5 + 16;
		const out = new Float32Array(120 * per);
		program.pack(sample('swirlingAura', { params: { vertices, indexCount: 120, zIndex: 0.5 } }), [0, 0, 1, 1], out, 0);
		// Third streamed vertex = band vertex 2; fourth = band vertex 1.
		expect(Array.from(out.subarray(2 * per, 2 * per + 5))).toEqual([10, 11, 12, 13, 14]);
		expect(Array.from(out.subarray(3 * per, 3 * per + 5))).toEqual([5, 6, 7, 8, 9]);
		expect(MESH_PROGRAMS.magicTarget.vertices(sample('magic-target', { params: { vertexCount: 6 } }))).toBe(0);
	});

	it('generates the legacy static meshes (short last segment)', () => {
		const ring = groundRingMesh();
		expect(ring.length / 5).toBe(20 * 6 + 3);
		const cylinder = cylinderMesh(12, 6, 3);
		expect(cylinder.length / 5).toBe(6 * 6 + 3);
		// Last three vertices: bottom[6], top[6], top[6]; u = a · (total / sides) · repeat.
		const last = Array.from(cylinder.subarray(cylinder.length - 15));
		expect(last.slice(5, 10)).toEqual(last.slice(10, 15));
		expect(last[2]).toBe(0);
		expect(last[7]).toBe(1);
		expect(last[3]).toBeCloseTo((6 / 12) * 2 * 3, 6);
	});

	it('builds the QuadHorn rotations as legacy gl-matrix does (float32)', () => {
		const rad = (37 * Math.PI) / 180;
		const x = rotationAboutAxis(rad, [1, 0, 0]);
		const c = Math.fround(Math.cos(rad));
		const s = Math.fround(Math.sin(rad));
		expect(Array.from(x)).toEqual([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
		const z = rotationAboutAxis(rad, [0, 0, 1]);
		expect(Array.from(z.subarray(0, 6))).toEqual([c, s, 0, 0, -s, c]);
		// Normal matrix = transpose(inverse(upper 3x3)).
		const mv = [2, 0, 0, 0, 0, 0.5, 0.3, 0, 0, -0.3, 0.5, 0, 4, 5, 6, 1];
		const n = normalMatrix(mv);
		const m3 = [mv[0], mv[1], mv[2], mv[4], mv[5], mv[6], mv[8], mv[9], mv[10]];
		for (let r = 0; r < 3; r++) {
			for (let col = 0; col < 3; col++) {
				// M3 · N^T = I (column-major), N = transpose(inverse(M3)).
				let sum = 0;
				for (let k = 0; k < 3; k++) {
					sum += m3[k * 3 + r] * n[k * 3 + col];
				}
				expect(sum).toBeCloseTo(r === col ? 1 : 0, 5);
			}
		}
		expect(normalMatrix(new Float32Array(16))).toBeNull();
	});

	it('batches by program, wrap and static mesh; never across them', () => {
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
		expect(batchKey(sample('lp'))).not.toBe(batchKey(sample('lp', { blend: ADDITIVE })));
		expect(meshProgramKey({ family: 'str' })).toBeNull();
		const runs = splitBatches([lp, hover, cyl, cyl, spider]);
		expect(runs.map(r => [r.start, r.count])).toEqual([
			[0, 2],
			[2, 2],
			[4, 1]
		]);
	});

	it('draws one instanced call per static-mesh run and one drawArrays per stream run', () => {
		const { gl, rr } = setup();
		rr.draw([
			sample('property-ground'),
			sample('magic-ring'),
			sample('property-ground'),
			sample('rsm'),
			sample('rsm'),
			sample('waterfallSpray')
		]);
		expect(rr.lastDrawCalls).toBe(3);
		const instanced = gl.callsTo('drawArraysInstanced');
		expect(instanced[0]).toEqual(['drawArraysInstanced', GL.TRIANGLES, 0, 20 * 6 + 3, 3]);
		expect(instanced[1]).toEqual(['drawArraysInstanced', GL.TRIANGLE_STRIP, 0, 4, 3]);
		expect(gl.callsTo('drawArrays')).toEqual([['drawArrays', GL.TRIANGLES, 0, 6]]);
		// One program per family group, compiled once.
		expect(gl.callsTo('linkProgram')).toHaveLength(3);
	});

	it('binds a REPEAT sampler for wrapping textures and unbinds it after the mesh runs', () => {
		const { gl, rr } = setup();
		rr.draw([sample('lp'), sample('cylinder'), sample('lp')]);
		const binds = gl.callsTo('bindSampler');
		// lp: repeat on units 1..5; cylinder: clamp (null); lp: repeat; end: null.
		expect(binds).toHaveLength(4 * 5);
		expect(binds.slice(0, 5).every(c => c[2] && c[2].fake === 'createSampler')).toBe(true);
		expect(binds.slice(5, 10).every(c => c[2] === null)).toBe(true);
		expect(binds.slice(15).every(c => c[2] === null)).toBe(true);
		expect(binds.map(c => c[1])).toEqual(Array.from({ length: 20 }, (_, i) => 1 + (i % 5)));
		const params = gl.callsTo('samplerParameteri').map(c => [c[2], c[3]]);
		expect(params).toContainEqual([GL.TEXTURE_WRAP_S, GL.REPEAT]);
		expect(params).toContainEqual([GL.TEXTURE_WRAP_T, GL.REPEAT]);
	});

	it('uploads mesh family textures on miss and packs their layer', () => {
		const { gl, residency, rr } = setup();
		rr.draw([sample('quadhorn'), sample('flat-color-tile')]);
		expect(residency.stats).toMatchObject({ frameUploads: 1, misses: 0 });
		const slot = residency.slotOf({ texture: 'img:quadhorn' });
		expect(textureField(slot)).toEqual([slot.layer, 1, 1, 0.5]);
		// The instance data written for the quadhorn ends with its texture field.
		const floats = MESH_PROGRAMS.quadhorn.instance.reduce((n, [, size]) => n + size, 0);
		const write = gl.callsTo('bufferSubData').find(c => c[3].length === floats);
		expect(Array.from(write[3].subarray(-4))).toEqual([slot.layer, 1, 1, 0.5]);
	});

	it('keeps an injected family renderer in front of the mesh pipeline', () => {
		const { gl } = setup();
		const residency = new Residency({ uploader: new TextureArrayPools({ gl }), now: () => 0 });
		const seen = [];
		const rr = new RunRenderer({
			gl,
			state: new GLStateCache(gl),
			residency,
			families: { cylinder: records => seen.push(records.length) }
		});
		rr.draw([sample('cylinder'), sample('cylinder')]);
		expect(seen).toEqual([2]);
		expect(gl.callsTo('drawArraysInstanced')).toHaveLength(0);
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
		expect(target.params.vertexCount).toBe(54);
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
