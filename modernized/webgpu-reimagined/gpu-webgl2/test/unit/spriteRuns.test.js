import { describe, expect, it } from 'vitest';
import { Residency } from '../../src/residency/Residency.js';
import { padLayer, SPRITE_TEXTURE_UNITS, TextureArrayPools } from '../../src/residency/TextureArrayPools.js';
import {
	packSpriteInstance,
	SPRITE_INSTANCE_ATTRIBUTES,
	SPRITE_INSTANCE_FLOATS,
	SPRITE_INSTANCE_STRIDE
} from '../../src/batching/instanceLayout.js';
import { InstanceRing } from '../../src/batching/InstanceRing.js';
import { RunRenderer } from '../../src/batching/RunRenderer.js';
import { GLStateCache } from '../../src/pipeline/GLStateCache.js';
import { GL } from '../../src/pipeline/glEnums.js';
import { SHADERS } from '../../src/shaders/index.js';
import { invert, multiply } from '../../src/math.js';
import { DeviceLimitError } from '../../src/errors.js';
import { createFakeGl } from '../support/fakeGl.js';
import { ADDITIVE, effect, sprite } from '../support/records.js';

const nullUploader = () => ({ allocLayer() {}, uploadPalette() {} });

describe('residency: texture-array pools per (format, POT class)', () => {
	it('maps a POT-padded frame to one layer of its class and reports class index and frame size', () => {
		const r = new Residency({ uploader: nullUploader(), now: () => 0 });
		r.upload('wide', { format: 'r8', width: 128, height: 64, data: new Uint8Array(128 * 64) });
		r.upload('tiny', { format: 'rgba8', width: 8, height: 16, data: new Uint8Array(8 * 16 * 4) });
		expect(r.slotOf({ texture: 'wide' })).toMatchObject({
			pool: 'r8:128',
			layer: 0,
			classIndex: 2,
			width: 128,
			height: 64
		});
		expect(r.slotOf({ texture: 'tiny' })).toMatchObject({
			pool: 'rgba8:32',
			layer: 0,
			classIndex: 0,
			width: 8,
			height: 16
		});
		expect(r.slotOf({ texture: 'missing' })).toMatchObject({ layer: -1, paletteRow: -1 });
	});

	it('re-uploads in place within a class and moves to the new class otherwise', () => {
		const calls = [];
		const r = new Residency({
			uploader: { allocLayer: (pool, size, layer) => calls.push([pool, size, layer]), uploadPalette() {} },
			now: () => 0
		});
		const img = (w, h) => ({ format: 'r8', width: w, height: h, data: new Uint8Array(w * h) });
		r.upload('a', img(64, 64));
		r.upload('b', img(64, 64));
		r.upload('a', img(64, 32));
		r.upload('b', img(256, 256));
		r.upload('c', img(64, 64));
		expect(calls).toEqual([
			['r8:64', 64, 0],
			['r8:64', 64, 1],
			['r8:64', 64, 0],
			['r8:256', 256, 0],
			['r8:64', 64, 1]
		]);
	});

	it('throws a DeviceLimitError past the pool layer count and above the 512 class', () => {
		const r = new Residency({ uploader: nullUploader(), layersPerPool: 2, now: () => 0 });
		const img = { format: 'rgba8', width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
		r.upload('a', img);
		r.upload('b', img);
		expect(() => r.upload('c', img)).toThrow(DeviceLimitError);
		expect(() => Residency.poolFor('r8', 1024, 4)).toThrow(DeviceLimitError);
	});

	it('padLayer keeps the frame in the top-left corner and replicates its last column and row', () => {
		const out = padLayer(new Uint8Array([1, 2, 3, 4]), 2, 2, 4, 1);
		expect(Array.from(out)).toEqual([1, 2, 2, 2, 3, 4, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4]);
		const rgba = padLayer(new Uint8Array([1, 2, 3, 4]), 1, 1, 2, 4);
		expect(Array.from(rgba)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
		const full = new Uint8Array(4);
		expect(padLayer(full, 2, 2, 2, 1)).toEqual(full);
	});

	it('TextureArrayPools allocates one immutable array per pool and uploads layers with texSubImage3D', () => {
		const gl = createFakeGl();
		const pools = new TextureArrayPools({ gl, layersPerPool: 8 });
		const r = new Residency({ uploader: pools, now: () => 0 });
		r.upload('a', { format: 'r8', width: 64, height: 32, data: new Uint8Array(64 * 32) });
		r.upload('b', { format: 'r8', width: 64, height: 64, data: new Uint8Array(64 * 64) });
		r.upload('c', { format: 'rgba8', width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) });
		const storage = gl.callsTo('texStorage3D').map(c => c.slice(1));
		expect(storage).toEqual([
			[GL.TEXTURE_2D_ARRAY, 1, GL.R8, 64, 64, 8],
			[GL.TEXTURE_2D_ARRAY, 1, GL.RGBA8, 32, 32, 8]
		]);
		const layers = gl.callsTo('texSubImage3D').map(c => [c[5], c[6], c[7], c[9], c[11].length]);
		expect(layers).toEqual([
			[0, 64, 64, GL.RED, 64 * 64],
			[1, 64, 64, GL.RED, 64 * 64],
			[0, 32, 32, GL.RGBA, 32 * 32 * 4]
		]);
		const filters = gl
			.callsTo('texParameteri')
			.filter(c => c[2] === GL.TEXTURE_MIN_FILTER)
			.map(c => c[3]);
		expect(filters).toEqual([GL.NEAREST, GL.LINEAR]);
	});

	it('palettes are rows of one 256×N table; overflow is a DeviceLimitError', () => {
		const gl = createFakeGl();
		const pools = new TextureArrayPools({ gl, paletteRows: 2 });
		const r = new Residency({ uploader: pools, now: () => 0 });
		r.uploadPalette('p0', new Uint8Array(1024));
		r.uploadPalette('p1', new Uint8Array(1024));
		expect(gl.callsTo('texStorage2D').map(c => c.slice(3))).toEqual([[GL.RGBA8, 256, 2]]);
		expect(gl.callsTo('texSubImage2D').map(c => c[4])).toEqual([0, 1]);
		expect(r.slotOf({ texture: null, palette: 'p1' }).paletteRow).toBe(1);
		expect(() => r.uploadPalette('p2', new Uint8Array(1024))).toThrow(DeviceLimitError);
	});

	it('bind() puts the palette on unit 0 and every class pool (or a dummy) on its unit', () => {
		const gl = createFakeGl();
		const pools = new TextureArrayPools({ gl });
		pools.allocLayer('rgba8:128', 128, 0, new Uint8Array(128 * 128 * 4));
		gl.clearCalls();
		pools.bind();
		const units = gl.callsTo('activeTexture').map(c => c[1] - GL.TEXTURE0);
		expect(units).toEqual([0, 1, 6, 2, 7, 3, 8, 4, 9, 5, 10, 0]);
		expect(SPRITE_TEXTURE_UNITS).toEqual({ palette: 0, indexed: 1, rgba: 6 });
		// Final binding per (unit, target), replaying the call log.
		const bound = new Map();
		let unit = 0;
		for (const [name, a, b] of gl.calls) {
			if (name === 'activeTexture') {
				unit = a - GL.TEXTURE0;
			} else if (name === 'bindTexture') {
				bound.set(`${unit}:${a}`, b);
			}
		}
		const array = u => bound.get(`${u}:${GL.TEXTURE_2D_ARRAY}`);
		expect(array(SPRITE_TEXTURE_UNITS.rgba + 2)).toBe(pools.textures.get('rgba8:128'));
		expect(bound.get(`0:${GL.TEXTURE_2D}`)).toBe(pools.paletteTexture);
		for (let i = 0; i < 5; i++) {
			expect(array(SPRITE_TEXTURE_UNITS.indexed + i)).toBe(pools._dummies.r8);
			if (i !== 2) {
				expect(array(SPRITE_TEXTURE_UNITS.rgba + i)).toBe(pools._dummies.rgba8);
			}
		}
	});
});

describe('instance packing (one record → one instance)', () => {
	it('attribute table matches the shader layout and the packed stride', () => {
		expect(SPRITE_INSTANCE_FLOATS).toBe(26);
		expect(SPRITE_INSTANCE_STRIDE).toBe(104);
		for (const { name, location, size } of SPRITE_INSTANCE_ATTRIBUTES) {
			const type = size === 1 ? 'float' : `vec${size}`;
			expect(SHADERS.spriteVert).toContain(`layout(location = ${location}) in ${type} ${name};`);
		}
		const last = SPRITE_INSTANCE_ATTRIBUTES[SPRITE_INSTANCE_ATTRIBUTES.length - 1];
		expect(last.offset + last.size * 4).toBe(SPRITE_INSTANCE_STRIDE);
	});

	it('converts sprite pixels to world units exactly as legacy SpriteRenderer (R-SPR-003)', () => {
		const out = new Float32Array(SPRITE_INSTANCE_FLOATS);
		const r = sprite({ offset: [35, -70], size: [-64, 128], xSize: 4, ySize: 5, angle: 0 });
		packSpriteInstance(r, { layer: 3, paletteRow: 2, classIndex: 2, width: 64, height: 128 }, out, 0);
		expect(out[3]).toBe(Math.fround((35 / 175) * 4));
		expect(out[4]).toBe(Math.fround((-70 / 175) * 5 - 0.5));
		expect(out[5]).toBe(Math.fround((-64 / 175) * 4)); // mirror = negative width
		expect(out[6]).toBe(Math.fround((128 / 175) * 5));
		expect([out[7], out[8]]).toEqual([1, 0]); // angle 0 → identity rotation
		expect(Array.from(out.subarray(18, 26))).toEqual([3, 2, 2, 0, 64, 128, 128, 256]);
	});

	it('rotation is (cos, sin) of −angle; paletteSize overrides the 2× default; linear sampler flag', () => {
		const out = new Float32Array(SPRITE_INSTANCE_FLOATS);
		const r = sprite({ angle: 90, sampler: 'linear', paletteSize: [10, 20] });
		packSpriteInstance(r, { layer: 0, paletteRow: -1, width: 32, height: 32 }, out, 0);
		expect(out[7]).toBe(Math.fround(Math.cos(-Math.PI / 2)));
		expect(out[8]).toBe(-1);
		expect(out[21]).toBe(1);
		expect([out[24], out[25]]).toEqual([10, 20]);
	});

	it('packs depth flags, zIndex, depth bias, colour and shadow in place', () => {
		const out = new Float32Array(SPRITE_INSTANCE_FLOATS * 2);
		const next = packSpriteInstance(
			sprite({ color: [1, 0.5, 0.25, 0.75], shadowFactor: 0.5, zIndex: 151, depthBias: 0.02 }),
			{ layer: 0, paletteRow: 0 },
			out,
			SPRITE_INSTANCE_FLOATS
		);
		expect(next).toBe(SPRITE_INSTANCE_FLOATS * 2);
		const o = SPRITE_INSTANCE_FLOATS;
		expect(Array.from(out.subarray(o + 9, o + 18))).toEqual([
			1,
			0.5,
			0.25,
			0.75,
			0.5,
			151,
			Math.fround(0.02),
			1,
			0
		]);
	});
});

describe('streaming instance buffer', () => {
	it('appends runs, orphans on wrap and grows for an oversize run', () => {
		const gl = createFakeGl();
		const ring = new InstanceRing({ gl, capacityBytes: 64 });
		expect(ring.write(new Float32Array(4))).toBe(0);
		expect(ring.write(new Float32Array(8))).toBe(16);
		expect(ring.write(new Float32Array(8))).toBe(0); // 48 + 32 > 64 → orphan
		expect(ring.orphans).toBe(1);
		expect(ring.write(new Float32Array(40))).toBe(0); // 160 bytes > capacity → grow
		expect(ring.capacity).toBe(256);
		expect(gl.callsTo('bufferData').map(c => c[2])).toEqual([64, 64, 256]);
		expect(gl.callsTo('createBuffer')).toHaveLength(1);
	});
});

describe('sprite runs on the GL pipeline', () => {
	const setup = () => {
		const gl = createFakeGl();
		const residency = new Residency({ uploader: new TextureArrayPools({ gl }), now: () => 0 });
		residency.upload('spr:1', { format: 'r8', width: 32, height: 32, data: new Uint8Array(1024) });
		residency.uploadPalette('pal:1', new Uint8Array(1024));
		const rr = new RunRenderer({ gl, state: new GLStateCache(gl), residency });
		gl.clearCalls();
		return { gl, rr };
	};

	it('compiles the program once and issues one drawArraysInstanced per run, in record order', () => {
		const { gl, rr } = setup();
		const recs = [sprite(), sprite(), sprite({ blend: ADDITIVE }), sprite({ textureClass: 'rgba', palette: null })];
		rr.draw(recs);
		rr.draw(recs);
		expect(gl.callsTo('createProgram')).toHaveLength(1);
		expect(gl.callsTo('drawArraysInstanced').map(c => c[4])).toEqual([2, 1, 1, 2, 1, 1]);
		expect(rr.lastDrawCalls).toBe(3);
		expect(rr.lastRuns.map(r => r.count)).toEqual([2, 1, 1]);
		// uIndexedRun follows the run's texture class
		const indexedFlags = gl
			.callsTo('uniform1i')
			.filter(c => c[1]?.uniform === 'uIndexedRun')
			.map(c => c[2]);
		expect(indexedFlags).toEqual([1, 0, 1, 0]);
	});

	it('points the instance attributes at each run’s base offset in the ring', () => {
		const { gl, rr } = setup();
		rr.draw([sprite(), sprite(), sprite({ depthWrite: false })]);
		const zIndexPointers = gl
			.callsTo('vertexAttribPointer')
			.filter(c => c[1] === 8) // aZIndex
			.map(c => c[6]);
		expect(zIndexPointers).toEqual([14 * 4, 2 * SPRITE_INSTANCE_STRIDE + 14 * 4]);
	});

	it('rebinds the sprite program after an effect family run', () => {
		const { gl } = setup();
		const residency = new Residency({ uploader: new TextureArrayPools({ gl }), now: () => 0 });
		const rr = new RunRenderer({ gl, state: new GLStateCache(gl), residency, families: { str: () => {} } });
		rr.draw([sprite(), effect(), sprite()]);
		expect(gl.callsTo('useProgram')).toHaveLength(2);
		expect(rr.lastDrawCalls).toBe(3);
	});

	it('uploads uViewModel = inverse(uModelView), as legacy bind3DContext', () => {
		const { gl, rr } = setup();
		const modelView = new Float32Array([1, 0, 0, 0, 0, 0.8, -0.6, 0, 0, 0.6, 0.8, 0, 2, -3, -20, 1]);
		rr.draw([sprite()], {
			modelView,
			projection: new Float32Array(16),
			zoom: 2,
			fog: { use: true, near: 1, far: 2, color: [1, 1, 1] }
		});
		const vm = gl.callsTo('uniformMatrix4fv').find(c => c[1]?.uniform === 'uViewModel')[3];
		const product = multiply(modelView, vm);
		[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((v, i) => expect(product[i]).toBeCloseTo(v, 5));
		expect(invert(new Float32Array(16))).toBeNull();
		expect(gl.callsTo('uniform1f').find(c => c[1]?.uniform === 'uZoom')[2]).toBe(2);
	});
});

describe('spec #64 palette index 255 (fixed, HITL delegated policy)', () => {
	it('clamps the palette column instead of wrapping index 255 to entry 0', () => {
		expect(SHADERS.spriteFrag).toMatch(/min\(int\(floor\(i \* 256\.0\)\), 255\)/);
		expect(SHADERS.spriteFrag).not.toMatch(/& 255/);
	});
});
