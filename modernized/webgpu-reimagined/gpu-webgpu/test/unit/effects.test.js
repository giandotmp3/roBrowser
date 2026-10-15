import { describe, expect, it } from 'vitest';
import { createFakeGpu } from '../support/fakeGpu.js';
import { SpriteResidency } from '../../src/residency/SpriteResidency.js';
import { TextureArrayPools } from '../../src/residency/TextureArrayPools.js';
import { decodeImageTexture, unpackViaGl } from '../../src/residency/imageTexture.js';
import { RunRenderer } from '../../src/batching/RunRenderer.js';
import {
	STR_INSTANCE_ATTRIBUTES,
	STR_INSTANCE_FLOATS,
	STR_VERTEX_BUFFERS,
	packStrInstance
} from '../../src/effects/strInstance.js';
import { strBindGroupLayoutEntries, strSpec } from '../../src/effects/StrPipeline.js';
import { spriteEffectView } from '../../src/effects/spriteEffect.js';
import { fromLegacyEffectRecord } from '../../src/effects/legacyRecord.js';
import { SPRITE_INSTANCE_FLOATS, SPRITE_SAMPLING, packSpriteInstance } from '../../src/sprites/instanceLayout.js';
import { spriteSpec } from '../../src/sprites/SpriteRunRenderer.js';
import { SCENE_WRITE_MASK, describePipeline } from '../../src/pipelines/PipelineSet.js';
import {
	blendConstantFor,
	isMixedConstantBlend,
	resolveBlend,
	toGpuBlend,
	usesBlendConstant
} from '../../src/pipelines/blendMap.js';
import { ADDITIVE, NORMAL } from '../../src/pipelines/pipelineKey.js';
import { SHADERS } from '../../src/shaders/index.js';

/** STR layer record (render-records StrPlayer / legacy native shape). */
const strLayer = (fields = {}, params = {}) => ({
	kind: 'effect',
	family: 'str',
	pass: 'after',
	texture: 'img:str',
	position: [10, 20, 1],
	color: [1, 0.5, 0.25, 0.75],
	blend: NORMAL,
	depthTest: true,
	depthWrite: false,
	depthCorrection: false,
	fog: false,
	strAttachment: false,
	...fields,
	params: {
		xy: [-20, 20, -10, 10, -30, -30, 30, 30],
		scale: 1,
		angle: 0,
		offset: [-20, 10],
		yLower: 0.5,
		clipZBias: -0.1,
		...params
	}
});

/** 2D/3D record (ThreeDEffect / TwoDEffect / render-records SpriteBillboardEffect shape). */
const spriteFx = (family = '3d', fields = {}, params = {}) => ({
	kind: 'effect',
	family,
	pass: 'after',
	texture: 'img:fx',
	position: [10, 20, 1],
	color: [1, 1, 1, 0.5],
	blend: NORMAL,
	depthTest: true,
	depthWrite: family === '2d',
	depthCorrection: true,
	fog: false,
	strAttachment: false,
	...fields,
	params: {
		size: [40, 60],
		offset: [3, -4],
		angle: 30,
		zIndex: 2,
		depthBias: family === '2d' ? 10 : 0,
		shadowFactor: 1,
		xSize: 5,
		ySize: 5,
		ignoreDepthMinCap: false,
		palette: null,
		paletteSize: [64, 64],
		...params
	}
});

const sprite = (fields = {}) => ({
	kind: 'sprite',
	texture: 'f',
	palette: 'p',
	textureClass: 'indexed',
	sampler: 'nearest',
	position: [1, 2, 3],
	offset: [0, 0],
	size: [64, 128],
	angle: 0,
	color: [1, 1, 1, 1],
	shadowFactor: 1,
	zIndex: 0,
	depthBias: 0,
	blend: NORMAL,
	depthTest: true,
	depthWrite: true,
	depthCorrection: true,
	ignoreDepthMinCap: false,
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

describe('STR instance packing (legacy StrEffect.vs inputs, R-EFX-009)', () => {
	it('packs corners in strip order 0,1,3,2 × scale, the rotation of −angle, offset, colour, yLower, bias, fog', () => {
		const out = new Float32Array(STR_INSTANCE_FLOATS);
		const r = strLayer({ fog: true }, { scale: 2, angle: 90 });
		const next = packStrInstance(r, { layer: 3, classIndex: 1, width: 32, height: 64 }, out, 0);
		expect(next).toBe(26);
		expect(STR_INSTANCE_FLOATS).toBe(26);
		const v = Array.from(out);
		expect(v.slice(0, 3)).toEqual([10, 20, 1]);
		expect(v.slice(3, 7)).toEqual([-40, 40, 20, -20]); // xy[0], xy[1], xy[3], xy[2] × 2
		expect(v.slice(7, 11)).toEqual([-60, -60, 60, 60]); // xy[4], xy[5], xy[7], xy[6] × 2
		expect(v[11]).toBeCloseTo(0, 6);
		expect(v[12]).toBeCloseTo(-1, 6); // sin(−90°)
		expect(v.slice(13, 15)).toEqual([-20, 10]);
		expect(v.slice(15, 19)).toEqual([1, 0.5, 0.25, 0.75]);
		expect(v.slice(19, 22).map(x => Math.round(x * 1e6) / 1e6)).toEqual([0.5, -0.1, 1]);
		expect(v.slice(22, 26)).toEqual([3, 1, 0.5, 1]); // layer, class, 32/64, 64/64
	});

	it('a residency miss packs layer −1 (the shader discards it); attachments keep yLower 0', () => {
		const out = new Float32Array(STR_INSTANCE_FLOATS);
		packStrInstance(strLayer({}, { yLower: 0 }), { layer: -1, classIndex: 0, width: 1, height: 1 }, out, 0);
		expect(out[19]).toBe(0);
		expect(out[22]).toBe(-1);
		expect(SHADERS.str).toContain('if (i.tex.x < 0.0) {\n    discard;');
	});

	it('one instance-step vertex buffer, 8 attributes at the packed offsets (no per-vertex buffer)', () => {
		expect(STR_VERTEX_BUFFERS).toHaveLength(1);
		expect(STR_VERTEX_BUFFERS[0]).toMatchObject({ arrayStride: 104, stepMode: 'instance' });
		expect(STR_INSTANCE_ATTRIBUTES.map(a => [a.shaderLocation, a.offset, a.format])).toEqual([
			[0, 0, 'float32x3'],
			[1, 12, 'float32x4'],
			[2, 28, 'float32x4'],
			[3, 44, 'float32x2'],
			[4, 52, 'float32x2'],
			[5, 60, 'float32x4'],
			[6, 76, 'float32x3'],
			[7, 88, 'float32x4']
		]);
		expect(strBindGroupLayoutEntries().map(e => e.binding)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	it('str.wgsl reproduces legacy StrEffect.vs/.fs (1/35 px, Project billboard, clip z bias, product discard)', () => {
		const src = SHADERS.str;
		expect(src).toContain('const PIXEL_RATIO : f32 = 1.0 / 35.0;');
		expect(src).toContain(
			'var position = angle * vec4f(corner.x * PIXEL_RATIO, -corner.y * PIXEL_RATIO, 0.0, 1.0);'
		);
		expect(src).toContain('position.y -= inst.offset.y * PIXEL_RATIO + inst.str.x;');
		expect(src).toContain('var clip = frame.projection * project(frame.model_view, inst.position) * position;');
		expect(src).toContain('clip.z += inst.str.y;');
		expect(src).toContain('clip.z = (clip.z + clip.w) * 0.5;');
		expect(src).toContain('o.uv = vec2f(f32(id & 1u), f32(id >> 1u));');
		expect(src).toContain('if (color.a == 0.0 || (color.r == 0.0 && color.g == 0.0 && color.b == 0.0)) {');
	});
});

describe('2D/3D effects through the sprite pipeline', () => {
	it('maps SpriteRenderer-shaped params onto the sprite instance (RGBA image: LINEAR)', () => {
		const view = spriteEffectView(spriteFx('3d'));
		expect(view).toMatchObject({
			kind: 'sprite',
			texture: 'img:fx',
			textureClass: 'rgba',
			sampler: 'linear',
			paletteSize: null,
			size: [40, 60],
			angle: 30,
			zIndex: 2,
			depthBias: 0,
			depthCorrection: true
		});
		const out = new Float32Array(SPRITE_INSTANCE_FLOATS);
		packSpriteInstance(view, { layer: 1, paletteRow: -1, classIndex: 2, width: 64, height: 128 }, out, 0);
		expect(out[21]).toBe(SPRITE_SAMPLING.rgbaLinear);
	});

	it('a palette makes an indexed layer with its paletteSize; overlay drops the correction', () => {
		const view = spriteEffectView(spriteFx('3d', { depthCorrection: false, depthTest: false }, { palette: 'pal' }));
		expect(view).toMatchObject({ textureClass: 'indexed', sampler: 'nearest', paletteSize: [64, 64] });
		expect(view.depthCorrection).toBe(false);
	});

	it('the sprite pipeline spec takes the record blend and depth state', () => {
		expect(spriteSpec(spriteFx('2d', { blend: ADDITIVE }))).toMatchObject({
			family: 'sprite',
			blend: ADDITIVE,
			depthTest: true,
			depthWrite: true
		});
	});
});

describe('blend state (R-EFX-008, R-EFX-011, #41/#49)', () => {
	it('every valid pair is kept verbatim; null, unknown and mixed constant colour/alpha pairs draw normal alpha', () => {
		expect(resolveBlend({ src: 'DST_COLOR', dst: 'ONE' })).toEqual({ src: 'DST_COLOR', dst: 'ONE' });
		expect(resolveBlend({ src: 'SRC_ALPHA_SATURATE', dst: 'ONE_MINUS_SRC_ALPHA' }).src).toBe('SRC_ALPHA_SATURATE');
		expect(resolveBlend(null)).toEqual(NORMAL);
		expect(resolveBlend({ src: 'BOGUS', dst: 'ONE' })).toEqual(NORMAL);
		const d3d1415 = { src: 'CONSTANT_COLOR', dst: 'ONE_MINUS_CONSTANT_ALPHA' };
		expect(isMixedConstantBlend(d3d1415)).toBe(true);
		expect(resolveBlend(d3d1415)).toEqual(NORMAL);
		expect(strSpec(strLayer({ blend: d3d1415 })).blend).toEqual(NORMAL);
	});

	it('constant factors read the legacy blend constant (0, 0, 0, 0); alpha-constant pairs splat alpha', () => {
		expect(usesBlendConstant({ src: 'CONSTANT_COLOR', dst: 'ONE_MINUS_SRC_ALPHA' })).toBe(true);
		expect(usesBlendConstant(NORMAL)).toBe(false);
		expect(blendConstantFor({ src: 'ZERO', dst: 'ONE_MINUS_CONSTANT_ALPHA' })).toEqual([0, 0, 0, 0]);
		expect(toGpuBlend({ src: 'ZERO', dst: 'ONE_MINUS_CONSTANT_ALPHA' }).color.dstFactor).toBe('one-minus-constant');
	});

	it('scene pipelines never write alpha: legacy buffers have none, so DST_ALPHA reads 1 (D3D 7/8/11)', () => {
		const desc = describePipeline(strSpec(strLayer()), { module: {}, layout: 'auto' });
		expect(desc.fragment.targets[0].writeMask).toBe(SCENE_WRITE_MASK);
		expect(SCENE_WRITE_MASK).toBe(0x7);
	});
});

describe('RunRenderer: sprite and STR batches in one pass, stream order', () => {
	async function setup() {
		const fake = createFakeGpu();
		const pools = new TextureArrayPools({ device: fake.device });
		const images = {
			'img:str': { format: 'rgba8', width: 64, height: 32, data: new Uint8Array(64 * 32 * 4) },
			'img:fx': { format: 'rgba8', width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) },
			f: { format: 'r8', width: 64, height: 128, data: new Uint8Array(64 * 128) }
		};
		const source = {
			frame: handle => images[handle] ?? null,
			palette: () => new Uint8Array(1024)
		};
		const residency = new SpriteResidency({ uploader: pools, now: () => 0, source });
		const runs = await new RunRenderer({ device: fake.device, residency, sampleCount: 1 }).init();
		return { fake, runs, residency };
	}

	it('switches programs per batch, keeps first instances per program, and skips families it does not draw', async () => {
		const { fake, runs } = await setup();
		const constantPair = { src: 'CONSTANT_COLOR', dst: 'ONE_MINUS_SRC_ALPHA' };
		const records = [
			sprite(),
			spriteFx('3d'),
			strLayer(),
			strLayer(),
			strLayer({ blend: constantPair }),
			spriteFx('2d', {}, { palette: 'pal' }),
			{ ...strLayer(), family: 'cylinder' },
			strLayer()
		];
		await runs.warm(records);
		const before = fake.calls.length;
		const { pass, calls } = fakePass();
		const stats = runs.encode(pass, records, { zoom: 30 });
		expect(stats).toMatchObject({ drawCalls: 6, batches: 7, fallbacks: 0, skipped: 1 });
		// Kind is pipeline state: the sprite and the 3D effect are two batches of the sprite program.
		expect(calls.filter(c => c[0] === 'draw').map(c => c.slice(1))).toEqual([
			[4, 1, 0, 0], // sprite (sprite program, instance 0)
			[4, 1, 0, 1], // 3d (sprite program, instance 1)
			[4, 2, 0, 0], // str, str (STR program, instances 0–1)
			[4, 1, 0, 2], // str, constant pair
			[4, 1, 0, 2], // 2d (sprite program, instance 2)
			[4, 1, 0, 3] // str (the cylinder before it has no renderer here)
		]);
		// Program switches rebind vertex buffers: sprite (2 slots), str (1), sprite (2), str (1).
		expect(calls.filter(c => c[0] === 'setVertexBuffer').map(c => c[1])).toEqual([0, 1, 0, 0, 1, 0]);
		// The legacy constant (0, 0, 0, 0) is WebGPU's default at pass begin: nothing to set.
		expect(calls.filter(c => c[0] === 'setBlendConstant')).toEqual([]);
		// Uploads on miss: STR and 2D/3D images, the sprite frame, the sprite and 2D palettes.
		expect(runs.lastUploads).toBe(5);
		const writes = fake.calls.slice(before).filter(c => c[0] === 'queue.writeBuffer');
		expect(writes).toHaveLength(4); // sprite instances + uniforms, STR instances + uniforms
		expect(writes[2][1][4] ?? writes[2][1][2].byteLength).toBe(4 * STR_INSTANCE_FLOATS * 4);
	});
});

describe('legacy native effect record → EffectDraw (smoke replay)', () => {
	const native = (fields = {}) => ({
		kind: 'effect',
		family: 'str',
		texture: { gl: 1 },
		position: [1, 2, 3],
		color: [1, 1, 1, 1],
		blend: { src: 'SRC_ALPHA', dst: 'ONE' },
		depthTest: true,
		depthWrite: false,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: { xy: [], offset: [0, 0] },
		...fields
	});

	it('#41/#49: an invalid blend code (null) draws normal alpha', () => {
		expect(fromLegacyEffectRecord(native({ blend: null })).blend).toEqual(NORMAL);
	});

	it('R-EFX-010 fix: STR layers take the scene fog (legacy records never ask for it)', () => {
		expect(fromLegacyEffectRecord(native(), { sceneFog: { use: true } }).fog).toBe(true);
		expect(fromLegacyEffectRecord(native(), { sceneFog: null }).fog).toBe(false);
	});

	it('2D/3D palettes become residency handles; pixelPerfectSprites makes sprite-backed RGBA layers NEAREST', () => {
		const r = fromLegacyEffectRecord(native({ family: '3d', params: { palette: { gl: 2 }, layer: 0 } }), {
			paletteHandle: () => 'pal'
		});
		expect(r.params.palette).toBe('pal');
		const rgba = fromLegacyEffectRecord(native({ family: '3d', params: { palette: null, layer: 1 } }), {
			pixelPerfectSprites: true
		});
		expect(rgba.params.sampler).toBe('nearest');
	});
});

describe('image textures (C-16, R-MAP-024): legacy Texture.load + WebGL.texture', () => {
	/** Fake 2D canvas holding RGBA pixels; drawImage copies (nearest) and stretches. */
	function fakeCanvas(width, height) {
		const canvas = { width, height, pixels: new Uint8ClampedArray(width * height * 4), contexts: [] };
		canvas.getContext = (_type, attrs) => {
			canvas.contexts.push(attrs ?? null);
			return {
				drawImage(src, x, y, w, h) {
					for (let j = 0; j < h; j++) {
						for (let i = 0; i < w; i++) {
							const si = Math.floor((i * src.width) / w);
							const sj = Math.floor((j * src.height) / h);
							const from = (sj * src.width + si) * 4;
							canvas.pixels.set(src.pixels.subarray(from, from + 4), ((y + j) * width + x + i) * 4);
						}
					}
				},
				getImageData: (x, y, w, h) => ({ data: canvas.pixels.slice(), width: w, height: h }),
				putImageData: image => canvas.pixels.set(image.data)
			};
		};
		return canvas;
	}

	it('keys magenta on a willReadFrequently canvas, then stretches to POT on a default canvas', () => {
		const image = fakeCanvas(3, 2);
		image.pixels.set([
			255, 0, 255, 255, 10, 20, 30, 255, 231, 19, 231, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 128
		]);
		const made = [];
		const decoded = decodeImageTexture(image, {
			createCanvas: (w, h) => {
				const c = fakeCanvas(w, h);
				made.push(c);
				return c;
			}
		});
		expect(decoded).toMatchObject({ format: 'rgba8', width: 4, height: 2 });
		expect(made.map(c => [c.width, c.height, c.contexts[0]])).toEqual([
			[3, 2, { willReadFrequently: true }],
			[4, 2, null]
		]);
		// Row 0 stretched 3 → 4 (nearest in this fake): keyed magenta, colour, keyed near-magenta.
		expect([...decoded.data.subarray(0, 16)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0]);
	});

	it('with a gl, takes the texels from the WebGL unpack and restores the bindings', () => {
		const calls = [];
		const gl = new Proxy(
			{ getParameter: name => ({ name }) },
			{
				get: (target, name) =>
					target[name] ??
					((...args) => {
						calls.push([name, ...args]);
						return name.startsWith('create') ? { name } : undefined;
					})
			}
		);
		const pixels = unpackViaGl(gl, { width: 4, height: 2 }, 4, 2);
		expect(pixels).toHaveLength(32);
		expect(calls.map(c => c[0])).toEqual(
			expect.arrayContaining([
				'texImage2D',
				'framebufferTexture2D',
				'readPixels',
				'deleteFramebuffer',
				'deleteTexture'
			])
		);
		// Bindings restored to what getParameter reported.
		const binds = calls.filter(c => c[0] === 'bindFramebuffer');
		expect(binds[binds.length - 1][2]).toEqual({ name: 0x8ca6 });
	});
});
