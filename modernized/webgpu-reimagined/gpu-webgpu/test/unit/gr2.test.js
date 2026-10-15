/**
 * C-14 GR2 pass on gpu-webgpu: residency (types, emblems), the per-instance encode sequence
 * (palettes and instance blocks with dynamic offsets) and the R-GR2-001/002/006 GPU-side
 * rules, against the recording fake GPU. Port of gpu-webgl2 test/unit/gr2.test.js.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFakeGpu, fakeSettings } from '../support/fakeGpu.js';
import { WebGpuBackend } from '../../src/WebGpuBackend.js';
import { SHADERS } from '../../src/shaders/index.js';
import { GR2_ALPHA_REF, GR2_ROSTER, RENDER_FORMAT } from '../../src/constants.js';
import { SCENE_WRITE_MASK } from '../../src/pipelines/PipelineSet.js';
import {
	emblemTexels,
	gr2Basename,
	gr2LightUniforms,
	gr2Profile,
	gr2Route,
	interleaveGr2Mesh,
	keyGr2Magenta
} from '../../src/gr2/gr2.js';
import { GR2_INSTANCE_BYTES, GR2_PALETTE_BYTES, packGr2Instance } from '../../src/gr2/Gr2Renderer.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const INSTANCE_STRIDE = 512;

function mesh({ texFile = 'body.bmp', emblem = false } = {}) {
	return {
		vcount: 3,
		indices: new Uint16Array([0, 1, 2]),
		bind: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
		uv: new Float32Array([0, 0, 1, 0, 0, 1]),
		bidx: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
		bw: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
		texFile,
		emblem
	};
}

const TYPES = {
	'data/model/3dmob/guildflag90_1.gr2': {
		meshes: [mesh(), mesh({ texFile: '', emblem: true })],
		textures: [{ name: 'body.bmp', width: 2, height: 1, pixels: new Uint8Array([255, 0, 255, 255, 9, 9, 9, 255]) }]
	},
	'data/model/3dmob/empelium90_0.gr2': {
		meshes: [mesh(), mesh({ texFile: 'missing.bmp' })],
		textures: [{ name: 'body.bmp', width: 1, height: 1, pixels: null }]
	}
};

async function setup({ emblems = {} } = {}) {
	const fake = createFakeGpu();
	const requests = [];
	const gr2 = {
		type: path => {
			requests.push(path);
			return TYPES[path] ?? null;
		},
		emblem: handle => emblems[handle] ?? null
	};
	const createCanvas = () => ({
		getContext: () => ({
			drawImage() {},
			getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(0xff) })
		})
	});
	const ports = {
		gpu: fake.gpu,
		canvas: fake.canvas,
		overlay: { show: vi.fn(), hide: vi.fn() },
		assets: { purge: vi.fn() },
		settings: fakeSettings(),
		scene: { runStep() {}, currentMap: () => 'prontera', setMap: vi.fn(async () => {}) },
		fallback: { switchToWebgl2: vi.fn(async () => {}) },
		now: () => 0,
		gr2,
		createCanvas
	};
	const backend = await new WebGpuBackend(ports).init();
	return { fake, backend, requests };
}

function record(type, { alpha = 1, bones = new Float32Array(32), emblem = null } = {}) {
	return {
		kind: 'world',
		part: 'gr2',
		alpha,
		matrices: bones,
		blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
		depthTest: true,
		depthWrite: true,
		params: { type: `data/model/3dmob/${type}.gr2`, world: IDENTITY, emblem }
	};
}

const view = { modelView: IDENTITY, projection: IDENTITY, zoom: 30, fog: { use: false, near: 0, far: 1, color: [0, 0, 0] } };
/** One frame; `named` then sees only its calls (the fake's call log is kept: it counts requestDevice). */
const frameOf = (fake, backend, records, extra = {}) => {
	fake.mark = fake.calls.length;
	return backend.drawFrame({ gr2Models: records, ...extra }, { view, world: {} });
};
const named = (fake, name) => fake.calls.slice(fake.mark ?? 0).filter(c => c[0] === name);
const drawIndexed = fake => named(fake, 'pass.drawIndexed');

describe('C-14 GR2 helpers (copies of gpu-webgl2)', () => {
	it('R-GR2-001 roster uses the legacy basenames; profile from the path', () => {
		expect(GR2_ROSTER).toContain('kguardian90_7');
		expect(gr2Basename('data\\model\\3dmob\\KGuardian90_7.gr2')).toBe('kguardian90_7');
		expect(gr2Profile('data/model/3dmob/guildflag90_1.gr2')).toBe('flag');
		expect(gr2Profile('data/model/3dmob/sguardian90_9.gr2')).toBe('emp');
		expect(gr2Profile('data/model/3dmob/dragon_5.gr2')).toBeNull();
		expect(gr2Route('data/model/3dmob/aguardian90_8.gr2').mode).toBe('gr2');
	});

	it('R-GR2-001 light uniforms: flag grey-broadcasts the map ambient (Rec.601), others are fixed', () => {
		const flag = gr2LightUniforms('a/guildflag90_1.gr2', { ambient: [1, 0, 0] });
		expect(Array.from(flag.diffuse)).toEqual(Array(3).fill(Math.fround(100 / 255)));
		expect(Array.from(flag.ambient)).toEqual(Array(3).fill(Math.fround(0.299)));
		const emp = gr2LightUniforms('a/treasurebox_2.gr2', { ambient: [1, 0, 0] });
		expect(Array.from(emp.diffuse)).toEqual(Array(3).fill(Math.fround(128 / 255)));
		expect(Array.from(emp.ambient)).toEqual(Array(3).fill(Math.fround(127 / 255)));
	});

	it('type textures: magenta keyed only when fully opaque; emblem texels keyed then A4R4G4B4', () => {
		expect(Array.from(keyGr2Magenta(new Uint8Array([250, 5, 249, 255, 1, 2, 3, 255])))).toEqual([
			0, 0, 0, 0, 1, 2, 3, 255
		]);
		const own = new Uint8Array([250, 5, 249, 255, 1, 2, 3, 128]);
		expect(keyGr2Magenta(own)).toBe(own);
		const px = new Uint8Array([0x12, 0x34, 0x56, 0xcf, 255, 0, 255, 255]);
		expect(Array.from(emblemTexels(px))).toEqual([0x11, 0x33, 0x55, 0xcc, 0, 0, 0, 0]);
	});

	it('interleave: 16 floats per vertex (pos, normal, uv, bone index, bone weight)', () => {
		const buf = interleaveGr2Mesh(mesh());
		expect(buf).toHaveLength(48);
		expect(Array.from(buf.subarray(16, 32))).toEqual([1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
	});
});

describe('C-14 GR2 WGSL and uniform block', () => {
	it('gr2.wgsl mirrors GR2Model.vs/fs: 48-bone palette, legacy skinning and lighting, alpha ref, fog', () => {
		const src = SHADERS.gr2;
		expect(src).toContain('var<uniform> bones : array<mat4x4f, 48>;');
		expect(src).toContain('let skin = bone_weight.x * bones[u32(i32(bone_index.x))]');
		expect(src).toContain('o.pos = gl_clip((u.projection * u.model_view) * skinned);');
		expect(src).toContain('let n = normalize(u.normal_mat * (skin3 * normal));');
		expect(src).toContain('o.light_weighting = (1.0 - u.light_opacity) + light_weight * u.light_opacity;');
		expect(src).toContain('if (texture_sample.a < u.alpha_ref) {');
		expect(src).toContain('fn apply_fog('); // shared R-MAP-004 include
	});

	it('packs the WGSL Gr2 struct offsets (mat3 columns padded, fog after env)', () => {
		const out = new Float32Array(GR2_INSTANCE_BYTES / 4 + 4).fill(-1);
		packGr2Instance(out, 0, {
			modelView: Array.from({ length: 16 }, (_, i) => i),
			projection: Array.from({ length: 16 }, (_, i) => 100 + i),
			normal: [1, 2, 3, 4, 5, 6, 7, 8, 9],
			lightDirection: [0.1, 0.2, 0.3],
			lightOpacity: 0.5,
			ambient: [0.4, 0.4, 0.4],
			diffuse: [0.6, 0.6, 0.6],
			env: [0.9, 0.8, 0.7],
			alphaRef: GR2_ALPHA_REF,
			alpha: 0.25,
			fog: { use: true, near: 30, far: 60, color: [0.1, 0.2, 0.3] }
		});
		const u = new Uint32Array(out.buffer);
		expect(out[15]).toBe(15);
		expect(out[16]).toBe(100);
		expect(Array.from(out.subarray(32, 44))).toEqual([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0]);
		expect(out[47]).toBe(0.5);
		expect(out[51]).toBe(Math.fround(GR2_ALPHA_REF));
		expect(out[55]).toBe(0.25);
		expect(out[56]).toBe(Math.fround(0.9));
		expect(u[63]).toBe(1);
		expect([out[64], out[65]]).toEqual([30, 60]);
		expect(out[GR2_INSTANCE_BYTES / 4]).toBe(-1); // nothing written past the block
		expect(GR2_PALETTE_BYTES % 256).toBe(0);
	});
});

describe('C-14 GR2 pass (R-CTX-010 step 11)', () => {
	it('uploads each type once on miss: vertex + uint16 index buffer per submesh, legacy fallback texels', async () => {
		const { fake, backend, requests } = await setup();
		expect(frameOf(fake, backend, [record('empelium90_0'), record('empelium90_0')])).toMatchObject({
			drawn: true,
			unsupportedRecords: 0,
			gr2: { records: 2, instances: 2, drawCalls: 4, palettes: 2 }
		});
		const uploads = named(fake, 'queue.writeTexture').map(c => Array.from(c[1][1]));
		expect(uploads).toEqual([
			[200, 200, 200, 255], // a texture that decoded no pixels
			[180, 180, 185, 255] // the grey stand-in (no matching texFile)
		]);
		const buffers = named(fake, 'createBuffer').map(c => c[1]);
		expect(buffers.filter(b => b.label === 'gr2-vertices')).toHaveLength(2);
		// 3 uint16 indices padded to 8 bytes (writeBuffer granularity)
		expect(buffers.filter(b => b.label === 'gr2-indices').map(b => b.size)).toEqual([8, 8]);
		frameOf(fake, backend, [record('empelium90_0')]);
		expect(requests).toEqual(['data/model/3dmob/empelium90_0.gr2']);
		expect(named(fake, 'createTexture')).toHaveLength(0);
		const indexed = drawIndexed(fake);
		expect(indexed).toHaveLength(2);
		expect(indexed[0][1]).toEqual([3, 1, 0, 0, 0]);
		expect(named(fake, 'pass.setIndexBuffer')[0][1][1]).toBe('uint16');
	});

	it('pipelines: opaque (no blend) and normal fade, depth test + write, less-equal, RGB write mask, clamp/linear sampler', async () => {
		const { fake } = await setup();
		const gr2 = fake.calls.filter(c => c[0] === 'createRenderPipelineAsync' && c[1].label.startsWith('gr2-'));
		expect(gr2.map(c => c[1].label).sort()).toEqual(['gr2-SRC_ALPHA|ONE_MINUS_SRC_ALPHA', 'gr2-opaque']);
		const opaque = gr2.find(c => c[1].label === 'gr2-opaque')[1];
		expect(opaque.fragment.targets[0]).toEqual({ format: RENDER_FORMAT, writeMask: SCENE_WRITE_MASK });
		expect(opaque.depthStencil).toMatchObject({ depthWriteEnabled: true, depthCompare: 'less-equal' });
		expect(opaque.primitive.cullMode).toBe('none');
		expect(opaque.vertex.buffers[0].arrayStride).toBe(64);
		const sampler = named(fake, 'createSampler').find(c => c[1].label === 'gr2')[1];
		expect(sampler).toMatchObject({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
	});

	it('shared palettes upload once; each instance binds its palette and block with dynamic offsets', async () => {
		const { fake, backend } = await setup();
		const shared = new Float32Array(16).fill(1);
		frameOf(fake, backend, [
			record('empelium90_0', { bones: shared }),
			record('empelium90_0', { bones: new Float32Array(16) }),
			record('empelium90_0', { bones: shared })
		]);
		expect(backend.gr2.lastPalettes).toBe(2);
		const writes = named(fake, 'queue.writeBuffer').map(c => c[1]);
		const palettes = writes.find(w => w[0].desc.label === 'gr2-palettes');
		expect(palettes[4]).toBe(2 * GR2_PALETTE_BYTES);
		const instances = writes.find(w => w[0].desc.label === 'gr2-instances');
		expect(instances[4]).toBe(3 * INSTANCE_STRIDE);
		const offsets = named(fake, 'pass.setBindGroup')
			.filter(c => c[1][0] === 0 && c[1][2])
			.map(c => c[1][2]);
		expect(offsets).toEqual([
			[0, 0],
			[INSTANCE_STRIDE, GR2_PALETTE_BYTES],
			[2 * INSTANCE_STRIDE, 0]
		]);
	});

	it('R-GR2-002/005: opaque pipeline unless the entity alpha is < 1; alpha in the block', async () => {
		const { fake, backend } = await setup();
		frameOf(fake, backend, [
			record('empelium90_0'),
			record('empelium90_0', { alpha: 0.5 }),
			record('empelium90_0')
		]);
		const labels = named(fake, 'pass.setPipeline')
			.map(c => c[1][0].desc.label)
			.filter(l => l.startsWith('gr2-'));
		expect(labels).toEqual(['gr2-opaque', 'gr2-SRC_ALPHA|ONE_MINUS_SRC_ALPHA', 'gr2-opaque']);
		const block = named(fake, 'queue.writeBuffer').find(c => c[1][0].desc.label === 'gr2-instances')[1];
		const floats = new Float32Array(block[2]);
		expect([floats[55], floats[INSTANCE_STRIDE / 4 + 55]]).toEqual([1, 0.5]);
		expect(floats[51]).toBe(Math.fround(GR2_ALPHA_REF));
	});

	it('R-GR2-006: the emblem submesh is skipped until its emblem loads, then drawn with the 32×32 emblem', async () => {
		const { fake, backend } = await setup({ emblems: { guild7: { width: 24, height: 24 } } });
		frameOf(fake, backend, [record('guildflag90_1'), record('guildflag90_1', { emblem: 'missing' })]);
		expect(drawIndexed(fake)).toHaveLength(2);
		frameOf(fake, backend, [record('guildflag90_1', { emblem: 'guild7' })]);
		expect(drawIndexed(fake)).toHaveLength(2);
		const emblem = named(fake, 'createTexture').map(c => c[1]);
		expect(emblem).toMatchObject([{ label: 'gr2-emblem', size: { width: 32, height: 32 } }]);
		expect(named(fake, 'queue.writeTexture')[0][1][1][3]).toBe(0xff);
		expect(backend.gr2Residency.emblems.size).toBe(1);
		backend.releaseGr2Emblem('guild7');
		expect(backend.gr2Residency.emblems.size).toBe(0);
	});

	it('the flag keys its fully opaque texture (≥ 248, < 8, ≥ 248)', async () => {
		const { fake, backend } = await setup();
		frameOf(fake, backend, [record('guildflag90_1')]);
		expect(Array.from(named(fake, 'queue.writeTexture')[0][1][1])).toEqual([0, 0, 0, 0, 9, 9, 9, 255]);
	});

	it('records over 48 bones and unknown types are not drawn; other records of the step still are', async () => {
		const { fake, backend } = await setup();
		const stats = frameOf(fake, backend, [
			record('empelium90_0', { bones: new Float32Array(49 * 16) }),
			record('nothere'),
			record('empelium90_0'),
			{ kind: 'effect', family: 'snow' }
		]);
		expect(drawIndexed(fake)).toHaveLength(2);
		expect(stats).toMatchObject({ unsupportedRecords: 1, gr2: { records: 3, instances: 1 } });
	});

	it('GR2 records draw without a loaded map, at the GR2 step between the neighbouring steps', async () => {
		const { fake, backend } = await setup();
		fake.calls.length = 0;
		const sprite = {
			kind: 'sprite',
			texture: 'none',
			textureClass: 'rgba',
			position: [0, 0, 0],
			size: [1, 1],
			offset: [0, 0],
			color: [1, 1, 1, 1],
			blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
			depthTest: true,
			depthWrite: true
		};
		backend.drawFrame(
			{ animatedModels: [], gr2Models: [record('empelium90_0')], entitiesNonEffect: [sprite] },
			{ view, world: {} }
		);
		const order = fake.calls
			.filter(c => c[0] === 'pass.drawIndexed' || c[0] === 'pass.setPipeline')
			.map(c => (c[0] === 'pass.drawIndexed' ? 'gr2-draw' : c[1][0].desc.label));
		expect(order.slice(0, 3)).toEqual(['gr2-opaque', 'gr2-draw', 'gr2-draw']);
		expect(backend.lastFrame.records).toBe(1); // the sprite; the GR2 marker is not a record
	});

	it('device loss forgets the GR2 resources; the rebuilt pass re-uploads on the new device; beginMap frees them', async () => {
		const { fake, backend, requests } = await setup();
		frameOf(fake, backend, [record('empelium90_0')]);
		fake.device.destroy();
		await new Promise(resolve => setTimeout(resolve, 0)); // device.lost settles
		expect(await backend.recovered()).toBe('webgpu');
		expect(backend.gr2Residency.types.size).toBe(0);
		expect(backend.gr2Residency.device).toBe(backend.device);
		expect(backend.device).not.toBe(fake.device);
		frameOf(fake, backend, [record('empelium90_0')]);
		expect(requests).toHaveLength(2);
		expect(drawIndexed(fake)).toHaveLength(2);
		expect(
			fake.calls.filter(
				c => c[0] === 'createRenderPipelineAsync' && c[1].label === 'gr2-opaque' && c[2] === backend.device.id
			)
		).toHaveLength(1);
		expect(backend.evictIdle(-1)).toMatchObject({ gr2Emblems: 0 });
		backend.beginMap(2);
		expect(backend.gr2Residency.types.size).toBe(0);
	});

	it('normal matrix and view light match the legacy gl-matrix arithmetic', async () => {
		const { backend } = await setup();
		const mv = new Float32Array([2, 0, 0, 0, 0, 0, 3, 0, 0, -4, 0, 0, 1, 2, 3, 1]);
		const n = backend.gr2._normalMatrix(mv);
		expect(Array.from(n, v => v + 0)).toEqual([0.5, 0, 0, 0, 0, Math.fround(1 / 3), 0, -0.25, 0]);
		const l = backend.gr2._viewLight(IDENTITY, [0, 3, 4]);
		expect(Array.from(l)).toEqual([0, Math.fround(0.6), Math.fround(0.8)]);
	});
});
