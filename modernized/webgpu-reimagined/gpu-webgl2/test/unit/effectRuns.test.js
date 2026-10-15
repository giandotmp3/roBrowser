import { describe, expect, it } from 'vitest';
import { Residency } from '../../src/residency/Residency.js';
import { TextureArrayPools } from '../../src/residency/TextureArrayPools.js';
import { RunRenderer } from '../../src/batching/RunRenderer.js';
import { GLStateCache, LEGACY_BLEND_CONSTANT } from '../../src/pipeline/GLStateCache.js';
import { isWebGLInvalidBlend, toGlBlend } from '../../src/pipeline/blendMap.js';
import { GL } from '../../src/pipeline/glEnums.js';
import { packStrInstance, STR_INSTANCE_ATTRIBUTES, STR_INSTANCE_FLOATS } from '../../src/effects/strInstance.js';
import { spriteEffectView } from '../../src/effects/spriteEffect.js';
import { fromLegacyEffectRecord } from '../../src/effects/legacyRecord.js';
import { packSpriteInstance, SPRITE_INSTANCE_FLOATS, SPRITE_SAMPLING } from '../../src/batching/instanceLayout.js';
import { decodeImageTexture, unpackViaGl } from '../../src/residency/imageTexture.js';
import { SHADERS } from '../../src/shaders/index.js';
import { createFakeGl } from '../support/fakeGl.js';
import { ADDITIVE, NORMAL, effect, sprite } from '../support/records.js';

/** STR layer record (render-records StrPlayer / legacy native shape). */
const strLayer = (fields = {}, params = {}) =>
	effect({
		family: 'str',
		texture: 'img:str',
		position: [10, 20, 1],
		color: [1, 0.5, 0.25, 0.75],
		fog: false,
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
const spriteFx = (family = '3d', fields = {}, params = {}) =>
	effect({
		family,
		texture: 'img:fx',
		position: [10, 20, 1],
		color: [1, 1, 1, 0.5],
		depthTest: true,
		depthWrite: family === '2d',
		depthCorrection: true,
		fog: false,
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

const rgba = (w, h) => ({ format: 'rgba8', width: w, height: h, data: new Uint8Array(w * h * 4) });

function setup({ frames = {}, palettes = {} } = {}) {
	const gl = createFakeGl();
	const residency = new Residency({
		uploader: new TextureArrayPools({ gl }),
		now: () => 0,
		source: { frame: h => frames[h] ?? null, palette: h => palettes[h] ?? null }
	});
	const rr = new RunRenderer({ gl, state: new GLStateCache(gl), residency });
	return { gl, residency, rr };
}

describe('STR instance packing (legacy StrEffect.vs inputs, R-EFX-009)', () => {
	it('packs corners in strip order 0,1,3,2 × scale, the rotation of −angle, offset, colour, yLower, bias, fog', () => {
		const out = new Float32Array(STR_INSTANCE_FLOATS);
		const record = strLayer({ fog: true }, { scale: 2, angle: 90 });
		const end = packStrInstance(record, { layer: 3, classIndex: 1, width: 64, height: 32 }, out, 0);
		expect(end).toBe(STR_INSTANCE_FLOATS);
		const at = name => STR_INSTANCE_ATTRIBUTES.find(a => a.name === name).offset / 4;
		expect([...out.slice(at('aPosition'), at('aPosition') + 3)]).toEqual([10, 20, 1]);
		expect([...out.slice(at('aQuadX'), at('aQuadX') + 4)]).toEqual([-40, 40, 20, -20]);
		expect([...out.slice(at('aQuadY'), at('aQuadY') + 4)]).toEqual([-60, -60, 60, 60]);
		expect(out[at('aRotation')]).toBeCloseTo(0, 6); // cos(−90°)
		expect(out[at('aRotation') + 1]).toBeCloseTo(-1, 6); // sin(−90°)
		expect([...out.slice(at('aOffset'), at('aOffset') + 2)]).toEqual([-20, 10]);
		expect([...out.slice(at('aColor'), at('aColor') + 4)]).toEqual([1, 0.5, 0.25, 0.75]);
		expect([...out.slice(at('aStr'), at('aStr') + 3)]).toEqual([0.5, Math.fround(-0.1), 1]);
		// 64×32 image in the 64 class: uv × (1, 0.5).
		expect([...out.slice(at('aTex'), at('aTex') + 4)]).toEqual([3, 1, 1, 0.5]);
	});

	it('a residency miss packs layer −1 (the shader discards it); attachments keep yLower 0', () => {
		const out = new Float32Array(STR_INSTANCE_FLOATS);
		packStrInstance(strLayer({ strAttachment: true }, { yLower: 0 }), { layer: -1 }, out, 0);
		const tex = STR_INSTANCE_ATTRIBUTES.find(a => a.name === 'aTex').offset / 4;
		const str = STR_INSTANCE_ATTRIBUTES.find(a => a.name === 'aStr').offset / 4;
		expect(out[tex]).toBe(-1);
		expect(out[str]).toBe(0);
	});

	it('the STR vertex shader reproduces legacy StrEffect.vs (1/35 px, Project billboard, clip z bias)', () => {
		expect(SHADERS.strVert).toContain('const float pixelRatio = 1.0 / 35.0;');
		expect(SHADERS.strVert).toContain('-corner.y * pixelRatio');
		expect(SHADERS.strVert).toContain('position.y -= aOffset.y * pixelRatio + aStr.x;');
		expect(SHADERS.strVert).toContain('gl_Position = uProjection * Project(uModelView, aPosition) * position;');
		expect(SHADERS.strVert).toContain('vUv = vec2(float(id & 1), float(id >> 1));');
		// R-EFX-009: discard tests texture × colour, as legacy StrEffect.fs.
		expect(SHADERS.strFrag).toContain('* vColor;');
		expect(SHADERS.strFrag).toMatch(/color\.a == 0\.0 \|\| \(color\.r == 0\.0 && color\.g == 0\.0 && color\.b == 0\.0\)/);
	});
});

describe('2D/3D effects through the sprite program', () => {
	it('maps SpriteRenderer-shaped params onto the sprite instance (RGBA image: LINEAR)', () => {
		const record = spriteFx('2d');
		const view = spriteEffectView(record);
		expect(view).toMatchObject({
			kind: 'sprite',
			textureClass: 'rgba',
			sampler: 'linear',
			palette: null,
			paletteSize: null,
			size: [40, 60],
			offset: [3, -4],
			angle: 30,
			zIndex: 2,
			depthBias: 10,
			depthWrite: true,
			depthCorrection: true
		});
		const a = new Float32Array(SPRITE_INSTANCE_FLOATS);
		const b = new Float32Array(SPRITE_INSTANCE_FLOATS);
		const slot = { layer: 1, paletteRow: -1, classIndex: 1, width: 64, height: 64 };
		packSpriteInstance(view, slot, a, 0);
		packSpriteInstance(
			sprite({ ...view, textureClass: 'rgba', sampler: 'linear', xSize: 5, ySize: 5, paletteSize: null }),
			slot,
			b,
			0
		);
		expect([...a]).toEqual([...b]);
		expect(a[SPRITE_INSTANCE_FLOATS - 5]).toBe(SPRITE_SAMPLING.rgbaLinear);
	});

	it('a palette makes an indexed layer (NEAREST + palette bilinear with its paletteSize); overlay drops the correction', () => {
		const view = spriteEffectView(
			spriteFx('3d', { depthTest: false, depthCorrection: false }, { palette: 'pal:fx', paletteSize: [32, 64], layer: 0 })
		);
		expect(view).toMatchObject({ textureClass: 'indexed', sampler: 'nearest', palette: 'pal:fx', paletteSize: [32, 64] });
		expect(view.depthCorrection).toBe(false);
		expect(spriteEffectView(spriteFx('3d', {}, { sampler: 'nearest' })).sampler).toBe('nearest');
	});

	it('draws consecutive 3D/2D records with equal state as one instanced sprite run, STR runs with the STR program', () => {
		const { gl, rr } = setup({ frames: { 'img:fx': rgba(64, 64), 'img:str': rgba(128, 64) } });
		const stream = [
			spriteFx('3d'),
			spriteFx('3d', {}, { palette: null, angle: 0 }),
			strLayer(),
			strLayer({}, { angle: 45 }),
			spriteFx('3d'),
			spriteFx('2d', { depthWrite: false })
		];
		rr.draw(stream);
		// 3d+3d | str+str | 3d+2d (same blend/depth state, same program): 3 draws.
		expect(rr.lastRuns.map(r => r.count)).toEqual([2, 2, 2]);
		expect(gl.callsTo('drawArraysInstanced').map(c => c[4])).toEqual([2, 2, 2]);
		expect(gl.callsTo('drawArrays')).toEqual([]);
		// Program switches: sprite → STR → sprite.
		expect(gl.callsTo('useProgram')).toHaveLength(3);
		expect(rr.lastUploads).toBe(2);
	});

	it('splits on blend and depth like any run, and keeps the record order', () => {
		const { gl, rr } = setup({ frames: { 'img:fx': rgba(64, 64) } });
		rr.draw([
			spriteFx('3d', { blend: ADDITIVE }),
			spriteFx('3d'),
			spriteFx('2d'),
			spriteFx('3d', { depthTest: false })
		]);
		expect(rr.lastRuns.map(r => [r.start, r.count])).toEqual([
			[0, 1],
			[1, 1],
			[2, 1],
			[3, 1]
		]);
		expect(gl.callsTo('blendFunc')[0]).toEqual(['blendFunc', GL.SRC_ALPHA, GL.ONE]);
		expect(gl.callsTo('depthMask').map(c => c[1])).toEqual([false, true, false, true]);
	});

	it('residency uploads effect textures and 2D/3D palettes on miss (params.palette)', () => {
		const palette = new Uint8Array(256 * 4);
		const { residency, rr } = setup({
			frames: { 'img:fx': rgba(48, 30), 'spr#0': { format: 'r8', width: 32, height: 32, data: new Uint8Array(1024) } },
			palettes: { 'pal:fx': palette }
		});
		// The cylinder (a mesh family) samples the same image: resident once, no miss.
		rr.draw([
			spriteFx('3d'),
			spriteFx('3d', { texture: 'spr#0' }, { palette: 'pal:fx' }),
			effect({ family: 'cylinder', texture: 'img:fx' })
		]);
		expect(residency.stats).toMatchObject({ frameUploads: 2, paletteUploads: 1, misses: 0 });
		expect(residency.slotOf({ texture: 'img:fx' })).toMatchObject({ pool: 'rgba8:64', width: 48, height: 30 });
	});
});

describe('blend state of effect runs', () => {
	it('constant factors use the legacy blend constant (0, 0, 0, 0): legacy never calls blendColor', () => {
		const gl = createFakeGl();
		new GLStateCache(gl).apply({ blend: { src: 'SRC_ALPHA', dst: 'CONSTANT_ALPHA' }, depthTest: true, depthWrite: false });
		expect(gl.callsTo('blendColor')).toEqual([['blendColor', 0, 0, 0, 0]]);
		expect(LEGACY_BLEND_CONSTANT).toEqual([0, 0, 0, 0]);
	});

	it('a pair WebGL rejects (constant colour with constant alpha, STR 14/15) falls back to normal alpha', () => {
		const pair = { src: 'CONSTANT_COLOR', dst: 'ONE_MINUS_CONSTANT_ALPHA' };
		expect(isWebGLInvalidBlend(pair)).toBe(true);
		expect(isWebGLInvalidBlend({ src: 'CONSTANT_COLOR', dst: 'ONE_MINUS_SRC_ALPHA' })).toBe(false);
		expect(toGlBlend(pair)).toEqual({ src: GL.SRC_ALPHA, dst: GL.ONE_MINUS_SRC_ALPHA });
		const gl = createFakeGl();
		new GLStateCache(gl).apply({ blend: pair, depthTest: true, depthWrite: false });
		expect(gl.callsTo('blendColor')).toEqual([]);
	});
});

describe('legacy native effect record → EffectDraw (smoke replay)', () => {
	const native = (family, fields = {}, params = {}) => ({
		kind: 'effect',
		family,
		texture: { gl: 'tex' },
		position: [1, 2, 3],
		color: new Float32Array([1, 1, 1, 1]),
		blend: null,
		depthTest: true,
		depthWrite: false,
		depthCorrection: family !== 'str',
		fog: false,
		strAttachment: false,
		...fields,
		params: { palette: null, layer: -1, ...params }
	});
	const handles = { textureHandle: () => 'tex:1', paletteHandle: () => 'pal:1' };

	it('#41/#49: an invalid blend code (null) draws normal alpha', () => {
		expect(fromLegacyEffectRecord(native('str'), handles).blend).toEqual(NORMAL);
		expect(fromLegacyEffectRecord(native('3d'), handles).blend).toEqual(NORMAL);
		expect(fromLegacyEffectRecord(native('3d', { blend: ADDITIVE }), handles).blend).toBe(ADDITIVE);
	});

	it('R-EFX-010 fix: STR layers take the scene fog (legacy records never ask for it)', () => {
		expect(fromLegacyEffectRecord(native('str'), { ...handles, sceneFog: { use: true } }).fog).toBe(true);
		expect(fromLegacyEffectRecord(native('str'), { ...handles, sceneFog: { use: false } }).fog).toBe(false);
		expect(fromLegacyEffectRecord(native('str'), handles)).toMatchObject({ fog: false, texture: 'tex:1' });
		// 2D/3D already carry the pass fog.
		expect(fromLegacyEffectRecord(native('2d', { fog: true }), handles).fog).toBe(true);
	});

	it('2D/3D palettes become residency handles; pixelPerfectSprites makes sprite-backed RGBA layers NEAREST', () => {
		const indexed = fromLegacyEffectRecord(native('3d', {}, { palette: { gl: 'pal' }, layer: 0 }), handles);
		expect(indexed.params).toMatchObject({ palette: 'pal:1', sampler: undefined });
		const pixelPerfect = { ...handles, pixelPerfectSprites: true };
		expect(fromLegacyEffectRecord(native('3d', {}, { layer: 1 }), pixelPerfect).params.sampler).toBe('nearest');
		expect(fromLegacyEffectRecord(native('3d', {}, { layer: -1 }), pixelPerfect).params.sampler).toBeUndefined();
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
							canvas.pixels.set(src.pixels.subarray((sj * src.width + si) * 4, (sj * src.width + si) * 4 + 4), ((y + j) * width + x + i) * 4);
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
		image.pixels.set([255, 0, 255, 255, 10, 20, 30, 255, 231, 19, 231, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 128]);
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
		const gl = createFakeGl();
		const pixels = unpackViaGl(gl, { width: 4, height: 2 }, 4, 2);
		expect(pixels).toHaveLength(32);
		const names = gl.calls.map(c => c[0]);
		expect(names).toEqual(
			expect.arrayContaining(['texImage2D', 'framebufferTexture2D', 'readPixels', 'deleteFramebuffer', 'deleteTexture'])
		);
		expect(gl.callsTo('bindFramebuffer').map(c => c[2])).toHaveLength(2);
	});
});
