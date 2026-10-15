import { describe, expect, it } from 'vitest';
import { createFakeGpu } from '../support/fakeGpu.js';
import { pipelineKey as recordsPipelineKey } from '../../../render-records/src/records/runs.js';
import {
	DeviceLimitError,
	FRAME_UNIFORM_BYTES,
	InstanceRing,
	OffscreenTarget,
	PipelineSet,
	SPRITE_FAMILIES,
	SPRITE_INSTANCE_ATTRIBUTES,
	SPRITE_INSTANCE_FLOATS,
	SPRITE_INSTANCE_STRIDE,
	SPRITE_VERTEX_BUFFERS,
	SpriteResidency,
	SpriteRunRenderer,
	TextureArrayPools,
	describePipeline,
	packFrameUniforms,
	packSpriteInstance,
	padLayer,
	recordRunKey,
	spriteBindGroupLayoutEntries,
	spriteCensus,
	spriteSpec,
	splitRuns
} from '../../src/index.js';
import { pipelineSpecKey } from '../../src/pipelines/pipelineKey.js';
import { SHADERS } from '../../src/shaders/index.js';

const NORMAL = { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' };
const ADDITIVE = { src: 'SRC_ALPHA', dst: 'ONE' };

function sprite(fields = {}) {
	return {
		kind: 'sprite',
		texture: 'f',
		textureClass: 'indexed',
		palette: 'p',
		sampler: 'nearest',
		position: [1, 2, 3],
		offset: [35, -70],
		size: [-64, 128],
		xSize: 5,
		ySize: 5,
		angle: 0,
		color: [1, 0.5, 0.25, 0.75],
		shadowFactor: 0.6,
		zIndex: 151,
		depthBias: 0.02,
		depthTest: true,
		depthWrite: true,
		depthCorrection: true,
		ignoreDepthMinCap: false,
		blend: NORMAL,
		...fields
	};
}

describe('sprite instance layout (C-08, byte-identical to gpu-webgl2)', () => {
	it('is 26 float32 per instance with the gpu-webgl2 byte offsets', () => {
		expect(SPRITE_INSTANCE_FLOATS).toBe(26);
		expect(SPRITE_INSTANCE_STRIDE).toBe(104);
		// gpu-webgl2 instanceLayout.js: position, offset, size, rotation, color, shadow,
		// zIndex (56) + depthBias (60) → one vec2 here, depthFlags, layer, frame.
		expect(SPRITE_INSTANCE_ATTRIBUTES.map(a => [a.name, a.offset, a.format])).toEqual([
			['position', 0, 'float32x3'],
			['offset', 12, 'float32x2'],
			['size', 20, 'float32x2'],
			['rotation', 28, 'float32x2'],
			['color', 36, 'float32x4'],
			['shadow', 52, 'float32'],
			['zIndexBias', 56, 'float32x2'],
			['depthFlags', 64, 'float32x2'],
			['layer', 72, 'float32x4'],
			['frame', 88, 'float32x4']
		]);
	});

	it('declares an instance-step buffer whose locations match sprite.wgsl, within 16 attributes', () => {
		const [quad, inst] = SPRITE_VERTEX_BUFFERS;
		expect(quad).toMatchObject({ arrayStride: 16, stepMode: 'vertex' });
		expect(inst).toMatchObject({ arrayStride: 104, stepMode: 'instance' });
		expect(quad.attributes.length + inst.attributes.length).toBeLessThanOrEqual(16);
		const struct = SHADERS.sprite.slice(SHADERS.sprite.indexOf('struct Instance'));
		const wgsl = [...struct.slice(0, struct.indexOf('};')).matchAll(/@location\((\d+)\) (\w+) : (\w+)/g)].map(
			([, loc, , type]) => [Number(loc), type]
		);
		const sizeOf = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 };
		expect(wgsl.map(([loc, type]) => [loc, sizeOf[type]])).toEqual(
			SPRITE_INSTANCE_ATTRIBUTES.map(a => [a.shaderLocation, a.size])
		);
	});

	it('packs a record as legacy SpriteRenderer fed its uniforms (px/175·xSize, offset y − 0.5, −angle, 2× palette step)', () => {
		const out = new Float32Array(SPRITE_INSTANCE_FLOATS);
		const slot = { layer: 3, paletteRow: 2, classIndex: 2, width: 64, height: 128 };
		expect(packSpriteInstance(sprite({ angle: 90 }), slot, out, 0)).toBe(26);
		const f = Array.from(out);
		expect(f.slice(0, 3)).toEqual([1, 2, 3]);
		expect(f[3]).toBeCloseTo(1);
		expect(f[4]).toBeCloseTo(-2.5);
		expect(f[5]).toBeCloseTo(-64 / 35); // mirrored: negative width
		expect(f[6]).toBeCloseTo(128 / 35);
		expect(f[7]).toBeCloseTo(0);
		expect(f[8]).toBeCloseTo(-1); // sin(−90°)
		expect(f.slice(9, 14).map(v => +v.toFixed(4))).toEqual([1, 0.5, 0.25, 0.75, 0.6]);
		expect(f[14]).toBe(151);
		expect(f[15]).toBeCloseTo(0.02);
		expect(f.slice(16)).toEqual([1, 0, 3, 2, 2, 0, 64, 128, 128, 256]);
		packSpriteInstance(sprite({ paletteSize: [10, 20], sampler: 'linear', ignoreDepthMinCap: true }), slot, out, 0);
		expect([out[17], out[21], out[24], out[25]]).toEqual([1, 1, 10, 20]);
	});
});

describe('sprite.wgsl (R-SPR-005/006/012/014/017, #64)', () => {
	const src = SHADERS.sprite;

	it('keeps GL clip space until the end, then maps z to [0, w] (same window depth as legacy)', () => {
		expect(src).toContain(
			'clip.z = select(min(clip.z, corrected_z_base), corrected_z_base, inst.depth_flags.y > 0.5);'
		);
		expect(src.indexOf('max(frame.zoom, 1.0)')).toBeLessThan(src.indexOf('clip.z = (clip.z + clip.w) * 0.5;'));
	});

	it('clamps palette index 255 to entry 255 (spec #64) and treats index 0 as transparent', () => {
		expect(src).toContain('min(i32(floor(i * 256.0)), 255)');
		expect(src).toContain('select(palette_at(i00, row), vec4f(0.0), i00 == 0.0)');
		expect(src).toContain('let f = fract(i.uv * i.frame_size.zw);');
	});

	it('applies shadow to rgb, then colour, then the shared fog include', () => {
		expect(src).toContain('vec4f(sampled.rgb * i.shadow, sampled.a)');
		expect(src).toContain('apply_fog(shaded * i.color, i.pos, frame.fog)');
		expect(src).toContain('fn apply_fog');
	});

	it('declares the bindings the bind group layout provides', () => {
		const bindings = [...src.matchAll(/@group\(0\) @binding\((\d+)\)/g)].map(m => Number(m[1]));
		expect(bindings).toEqual(spriteBindGroupLayoutEntries().map(e => e.binding));
		expect(spriteBindGroupLayoutEntries().filter(e => e.texture)).toHaveLength(11);
	});
});

describe('frame uniforms', () => {
	it('packs model view, its inverse, projection, zoom and the WGSL Fog struct at the right offsets', () => {
		const modelView = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1]);
		const buf = packFrameUniforms({
			modelView,
			projection: new Float32Array(16).fill(2),
			zoom: 30,
			fog: { use: true, near: 22, far: 40, color: [0.5, 0.25, 0.125] }
		});
		expect(buf.byteLength).toBe(FRAME_UNIFORM_BYTES);
		const f = new Float32Array(buf);
		expect(Array.from(f.slice(28, 31))).toEqual([-4, -5, -6]);
		expect(f[32]).toBe(2);
		expect(f[48]).toBe(30);
		expect(Array.from(f.slice(52, 55))).toEqual([0.5, 0.25, 0.125]);
		expect(new Uint32Array(buf)[55]).toBe(1);
		expect([f[56], f[57]]).toEqual([22, 40]);
	});
});

describe('texture-array residency (C-16)', () => {
	it('padLayer puts the frame top-left and replicates the last column and row', () => {
		const out = padLayer(new Uint8Array([1, 2, 3, 4]), 2, 2, 4, 1);
		expect(Array.from(out)).toEqual([1, 2, 2, 2, 3, 4, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4]);
	});

	it('creates one texture_2d_array per (format, POT class) and writes layers with queue.writeTexture', () => {
		const fake = createFakeGpu();
		const pools = new TextureArrayPools({ device: fake.device, layersPerPool: 8 });
		const residency = new SpriteResidency({ uploader: pools, layersPerPool: 8, now: () => 0 });
		residency.upload('a', { format: 'r8', width: 16, height: 32, data: new Uint8Array(16 * 32) });
		residency.upload('b', { format: 'r8', width: 32, height: 32, data: new Uint8Array(32 * 32) });
		residency.upload('c', { format: 'rgba8', width: 64, height: 32, data: new Uint8Array(64 * 32 * 4) });
		const created = fake.calls.filter(c => c[0] === 'createTexture').map(c => c[1]);
		expect(created.map(d => [d.format, d.size.width, d.size.depthOrArrayLayers])).toEqual([
			['r8unorm', 32, 8],
			['rgba8unorm', 64, 8]
		]);
		const writes = fake.calls.filter(c => c[0] === 'queue.writeTexture').map(c => c[1]);
		expect(writes.map(([dst, , layout]) => [dst.origin.z, layout.bytesPerRow])).toEqual([
			[0, 32],
			[1, 32],
			[0, 256]
		]);
		expect(residency.slotOf({ texture: 'b', palette: null })).toMatchObject({
			layer: 1,
			classIndex: 0,
			paletteRow: -1
		});
		expect(residency.slotOf({ texture: 'c' })).toMatchObject({ layer: 0, classIndex: 1, width: 64, height: 32 });
		expect(residency.slotOf({ texture: 'missing' }).layer).toBe(-1);
	});

	it('reuses freed layers, enforces the layer and POT limits, and writes palette rows', () => {
		const fake = createFakeGpu();
		const pools = new TextureArrayPools({ device: fake.device, layersPerPool: 2, paletteRows: 2 });
		const residency = new SpriteResidency({ uploader: pools, layersPerPool: 2, now: () => 0 });
		const img = { format: 'r8', width: 32, height: 32, data: new Uint8Array(1024) };
		residency.upload('a', img);
		residency.upload('b', img);
		expect(() => residency.upload('c', img)).toThrow(DeviceLimitError);
		residency.release('a');
		residency.upload('d', img);
		expect(residency.slotOf({ texture: 'd' }).layer).toBe(0);
		expect(() => SpriteResidency.poolFor('r8', 1024, 4)).toThrow(DeviceLimitError);
		residency.uploadPalette('p0', new Uint8Array(1024));
		residency.uploadPalette('p1', new Uint8Array(1024));
		expect(residency.slotOf({ texture: 'd', palette: 'p1' }).paletteRow).toBe(1);
		expect(() => residency.uploadPalette('p2', new Uint8Array(1024))).toThrow(DeviceLimitError);
		const paletteWrites = fake.calls.filter(c => c[0] === 'queue.writeTexture' && c[1][3].width === 256);
		expect(paletteWrites.map(c => c[1][0].origin.y)).toEqual([0, 1]);
	});

	it('binds 1×1 stand-ins for empty classes and bumps the version when handles change', () => {
		const fake = createFakeGpu();
		const pools = new TextureArrayPools({ device: fake.device });
		const v0 = pools.version;
		const views = pools.views();
		expect(views.indexed).toHaveLength(5);
		expect(views.rgba.every(v => v.dimension === '2d-array')).toBe(true);
		expect(views.palette.dimension).toBe('2d');
		expect(pools.version).toBeGreaterThan(v0);
		const v1 = pools.version;
		pools.views();
		expect(pools.version).toBe(v1);
	});
});

describe('sprite pipelines (architecture §2.2: census, normal-alpha fallback)', () => {
	it('censuses both texture classes × normal/additive × every depth state, with unique keys', () => {
		const specs = spriteCensus();
		expect(specs).toHaveLength(16);
		expect(new Set(specs.map(pipelineSpecKey)).size).toBe(16);
		expect(spriteSpec(sprite({ textureClass: 'rgba', blend: ADDITIVE }))).toEqual({
			family: SPRITE_FAMILIES.rgba,
			blend: ADDITIVE,
			depthTest: true,
			depthWrite: true,
			topology: 'triangle-strip'
		});
	});

	it('describes entry points, strip topology and sample count; depth test off writes no depth (GL)', () => {
		const shader = { module: {}, layout: {}, buffers: [], fragmentEntry: 'fs_rgba' };
		const d = describePipeline({ ...spriteSpec(sprite()), depthTest: false }, shader, { sampleCount: 1 });
		expect(d.fragment.entryPoint).toBe('fs_rgba');
		expect(d.vertex.entryPoint).toBe('vs_main');
		expect(d.primitive.topology).toBe('triangle-strip');
		expect(d.multisample.count).toBe(1);
		expect(d.depthStencil).toMatchObject({ depthCompare: 'always', depthWriteEnabled: false });
		expect(describePipeline(spriteSpec(sprite()), shader).multisample.count).toBe(4);
	});

	it('PipelineSet.settled waits for every pending compile', async () => {
		const fake = createFakeGpu();
		const set = new PipelineSet(fake.device, () => ({ module: {}, layout: {} }), { sampleCount: 1 });
		await set.precompile(spriteCensus());
		await set.settled();
		expect(set.readyCount).toBe(16);
		const descs = fake.calls.filter(c => c[0] === 'createRenderPipelineAsync').map(c => c[1]);
		expect(descs.every(d => d.multisample.count === 1)).toBe(true);
	});
});

describe('run splitting (copy of render-records)', () => {
	it('uses the render-records run key, so both agree on run boundaries', () => {
		const records = [
			sprite(),
			sprite({ blend: ADDITIVE }),
			sprite({ textureClass: 'rgba' }),
			sprite({ depthWrite: false }),
			{ kind: 'effect', blend: NORMAL, depthTest: true, depthWrite: false, strAttachment: true }
		];
		for (const r of records) {
			expect(recordRunKey(r)).toBe(recordsPipelineKey(r));
		}
		expect(splitRuns([sprite(), sprite(), sprite({ blend: ADDITIVE }), sprite()]).map(r => r.count)).toEqual([
			2, 1, 1
		]);
	});
});

describe('SpriteRunRenderer (C-08)', () => {
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

	async function setup(sampleCount = 1) {
		const fake = createFakeGpu();
		const pools = new TextureArrayPools({ device: fake.device });
		const residency = new SpriteResidency({ uploader: pools, now: () => 0 });
		residency.upload('f', { format: 'r8', width: 64, height: 128, data: new Uint8Array(64 * 128) });
		residency.upload('g', { format: 'rgba8', width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) });
		residency.uploadPalette('p', new Uint8Array(1024));
		const renderer = await new SpriteRunRenderer({ device: fake.device, residency, sampleCount }).init();
		await renderer.pipelines.settled();
		return { fake, renderer };
	}

	it('draws one instanced strip per run with consecutive firstInstance, switching pipelines only on state change', async () => {
		const { fake, renderer } = await setup();
		const records = [
			sprite(),
			sprite(),
			sprite({ blend: ADDITIVE }),
			{ kind: 'effect', blend: NORMAL, depthTest: true, depthWrite: false },
			sprite({ texture: 'g', textureClass: 'rgba', palette: null }),
			sprite({ texture: 'g', textureClass: 'rgba', palette: null })
		];
		const before = fake.calls.length;
		const { pass, calls } = fakePass();
		const stats = renderer.encode(pass, records, {
			modelView: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
			zoom: 30
		});
		expect(stats).toEqual({ drawCalls: 3, runs: 3, fallbacks: 0 });
		expect(calls.filter(c => c[0] === 'draw').map(c => c.slice(1))).toEqual([
			[4, 2, 0, 0],
			[4, 1, 0, 2],
			[4, 2, 0, 3]
		]);
		expect(calls.filter(c => c[0] === 'setPipeline')).toHaveLength(3);
		expect(calls.filter(c => c[0] === 'setBindGroup')).toHaveLength(1);
		const writes = fake.calls.slice(before).filter(c => c[0] === 'queue.writeBuffer');
		// one instance write (5 sprites × 104 bytes) + one uniform write
		expect(writes.map(c => c[1][4] ?? c[1][2].byteLength)).toEqual([5 * 104, FRAME_UNIFORM_BYTES]);
	});

	it('creates the bind group once and rebuilds it only when a pool texture is created', async () => {
		const { fake, renderer } = await setup();
		const count = () => fake.calls.filter(c => c[0] === 'createBindGroup').length;
		renderer.encode(fakePass().pass, [sprite()]);
		renderer.encode(fakePass().pass, [sprite()]);
		expect(count()).toBe(1);
		renderer.residency.upload('h', { format: 'r8', width: 256, height: 256, data: new Uint8Array(65536) });
		renderer.encode(fakePass().pass, [sprite()]);
		expect(count()).toBe(2);
	});

	it('falls back to normal alpha while an uncommon pipeline is still compiling', async () => {
		const fake = createFakeGpu({ compileDelay: d => d.label.includes('DST_COLOR') });
		const pools = new TextureArrayPools({ device: fake.device });
		const residency = new SpriteResidency({ uploader: pools, now: () => 0 });
		const renderer = await new SpriteRunRenderer({ device: fake.device, residency }).init();
		const stats = renderer.encode(fakePass().pass, [sprite({ blend: { src: 'DST_COLOR', dst: 'ZERO' } })]);
		expect(stats).toEqual({ drawCalls: 1, runs: 1, fallbacks: 1 });
	});
});

describe('InstanceRing and OffscreenTarget', () => {
	it('appends within a frame, rewinds on beginFrame, and grows into a new buffer when full', () => {
		const fake = createFakeGpu();
		const ring = new InstanceRing({ device: fake.device, capacityBytes: 64 });
		expect(ring.write(new Float32Array(8)).offset).toBe(0);
		expect(ring.write(new Float32Array(8)).offset).toBe(32);
		const grown = ring.write(new Float32Array(4));
		expect(grown.offset).toBe(0);
		expect(ring.grows).toBe(1);
		expect(grown.buffer.desc.size).toBe(128);
		ring.beginFrame();
		expect(ring.write(new Float32Array(4)).offset).toBe(0);
	});

	it('with MSAA off renders straight into the resolve texture (two textures, stored)', () => {
		const fake = createFakeGpu();
		const t = new OffscreenTarget(fake.device, { sampleCount: 1 });
		t.resize(8, 8);
		expect(fake.calls.filter(c => c[0] === 'createTexture')).toHaveLength(2);
		const color = t.passDescriptor([0, 0, 0, 1]).colorAttachments[0];
		expect(color.resolveTarget).toBeUndefined();
		expect(color.storeOp).toBe('store');
		expect(OffscreenTarget.descriptors(8, 8, 1).depth.sampleCount).toBe(1);
	});
});
