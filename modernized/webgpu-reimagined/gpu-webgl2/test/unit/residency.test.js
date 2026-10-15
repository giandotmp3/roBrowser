import { describe, expect, it } from 'vitest';
import { Residency } from '../../src/residency/Residency.js';
import { TextureArrayPools } from '../../src/residency/TextureArrayPools.js';
import { centerRgbaPot, decodeSprFrame } from '../../src/residency/spriteFrames.js';
import { RunRenderer } from '../../src/batching/RunRenderer.js';
import { GLStateCache } from '../../src/pipeline/GLStateCache.js';
import { fromLegacySpriteRecord } from '../../src/sprites/legacyRecord.js';
import { WebGL2Backend } from '../../src/WebGL2Backend.js';
import { DeviceLimitError } from '../../src/errors.js';
import { IDLE_EVICT_MS } from '../../src/constants.js';
import { createFakeCanvas, createFakeGl, createFakePorts } from '../support/fakeGl.js';
import { ADDITIVE, NORMAL, sprite } from '../support/records.js';

const img = (w, h, format = 'r8') => ({ format, width: w, height: h, data: new Uint8Array(w * h * (format === 'r8' ? 1 : 4)) });

/** Upload-on-miss source over fixed tables; logs every request. */
function fakeSource(frames = {}, palettes = {}) {
	const log = [];
	return {
		log,
		frames,
		palettes,
		frame: h => (log.push(['frame', h]), frames[h] ?? null),
		palette: h => (log.push(['palette', h]), palettes[h] ?? null)
	};
}

function recordingUploader() {
	const calls = [];
	return {
		calls,
		allocLayer: (pool, size, layer) => calls.push(['layer', pool, layer]),
		uploadPalette: row => calls.push(['palette', row]),
		purge: () => calls.push(['purge'])
	};
}

function clock(start = 0) {
	const c = { t: start, now: () => c.t };
	return c;
}

describe('residency upload-on-miss (C-16 FrameSourcePort)', () => {
	it('uploads a missing frame and palette through the source on first use, once', () => {
		const source = fakeSource({ a: img(64, 64) }, { p: new Uint8Array(1024) });
		const up = recordingUploader();
		const r = new Residency({ uploader: up, now: () => 0, source });
		expect(r.ensure({ texture: 'a', palette: 'p' })).toBe(true);
		expect(r.ensure({ texture: 'a', palette: 'p' })).toBe(true);
		expect(source.log).toEqual([
			['frame', 'a'],
			['palette', 'p']
		]);
		expect(up.calls).toEqual([
			['layer', 'r8:64', 0],
			['palette', 0]
		]);
		expect(r.slotOf({ texture: 'a', palette: 'p' })).toMatchObject({ layer: 0, paletteRow: 0, pool: 'r8:64' });
		expect(r.stats).toMatchObject({ frameUploads: 1, paletteUploads: 1, misses: 0 });
	});

	it('a source miss stays a discarded instance (layer −1) and is retried on the next lookup', () => {
		const source = fakeSource();
		const r = new Residency({ uploader: recordingUploader(), now: () => 0, source });
		expect(r.ensure({ texture: 'late', palette: null })).toBe(false);
		expect(r.slotOf({ texture: 'late' }).layer).toBe(-1);
		source.frames.late = img(32, 32, 'rgba8');
		expect(r.ensure({ texture: 'late', palette: null })).toBe(true);
		expect(r.slotOf({ texture: 'late' })).toMatchObject({ layer: 0, pool: 'rgba8:32' });
		expect(r.stats.misses).toBe(1);
	});

	it('RunRenderer uploads misses before it binds the sprite program and textures', () => {
		const gl = createFakeGl();
		const source = fakeSource({ 'spr:1': img(64, 32), 'spr:2': img(128, 128, 'rgba8') }, { 'pal:1': new Uint8Array(1024) });
		const residency = new Residency({ uploader: new TextureArrayPools({ gl }), now: () => 0, source });
		const rr = new RunRenderer({ gl, state: new GLStateCache(gl), residency });
		const records = [sprite(), sprite({ texture: 'spr:2', textureClass: 'rgba', palette: null, blend: ADDITIVE })];
		rr.draw(records);
		// Layer uploads (the 1×1 dummies that bind() creates for empty classes excluded).
		const uploads = gl.calls.flatMap((c, i) => (c[0] === 'texSubImage3D' && c[6] > 1 ? [i] : []));
		expect(uploads).toHaveLength(2);
		expect(uploads[1]).toBeLessThan(gl.calls.findIndex(c => c[0] === 'useProgram'));
		expect(rr.lastUploads).toBe(3);
		// The instance carries the uploaded layer and palette row (aLayer at float 18).
		const instances = gl.callsTo('bufferSubData').map(c => c[3]);
		expect([instances[0][18], instances[0][19], instances[0][20]]).toEqual([0, 0, 1]);
		gl.clearCalls();
		rr.draw(records);
		expect(gl.callsTo('texSubImage3D').filter(c => c[6] > 1)).toHaveLength(0);
		expect(rr.lastUploads).toBe(0);
	});
});

describe('residency eviction: free-list layers, refcounted palette rows, idle hook', () => {
	it('release() returns the layer to its pool free list; the next upload reuses it', () => {
		const up = recordingUploader();
		const r = new Residency({ uploader: up, now: () => 0, layersPerPool: 4 });
		r.upload('a', img(64, 64));
		r.upload('b', img(64, 64));
		expect(r.freeLayers('r8:64')).toBe(2);
		r.release('a');
		expect(r.freeLayers('r8:64')).toBe(3);
		r.upload('c', img(40, 64));
		expect(r.slotOf({ texture: 'c' }).layer).toBe(0);
		expect(r.slotOf({ texture: 'a' }).layer).toBe(-1);
		expect(r.stats.frameEvictions).toBe(1);
	});

	it('evictIdle frees frames unused for 30 s (NFR-05) and reports them through onEvict', () => {
		const c = clock();
		const evicted = [];
		const r = new Residency({
			uploader: recordingUploader(),
			now: c.now,
			onEvict: (h, kind) => evicted.push([h, kind])
		});
		r.upload('old', img(32, 32));
		r.upload('hot', img(32, 32));
		c.t = IDLE_EVICT_MS - 1;
		r.slotOf({ texture: 'hot' });
		c.t = IDLE_EVICT_MS + 1;
		expect(r.evictIdle()).toEqual({ frames: 1, palettes: 0 });
		expect(evicted).toEqual([['old', 'frame']]);
		expect(r.residentCount).toBe(1);
		r.upload('new', img(32, 32));
		expect(r.slotOf({ texture: 'new' }).layer).toBe(0);
		expect(r.evictIdle(-1)).toEqual({ frames: 2, palettes: 0 });
	});

	it('a full pool reclaims its least recently used layer that the current frame does not draw', () => {
		const c = clock();
		const source = fakeSource({ a: img(32, 32), b: img(32, 32), x: img(32, 32), y: img(32, 32) });
		const r = new Residency({ uploader: recordingUploader(), now: c.now, layersPerPool: 2, source });
		r.beginFrame();
		r.ensure({ texture: 'a' });
		c.t = 5;
		r.ensure({ texture: 'b' });
		r.beginFrame();
		c.t = 10;
		r.slotOf({ texture: 'b' }); // b drawn this frame; a is older and idle
		expect(r.ensure({ texture: 'x' })).toBe(true);
		expect(r.slotOf({ texture: 'x' }).layer).toBe(0); // a's layer
		expect(r.slotOf({ texture: 'a' }).layer).toBe(-1);
		// Every layer now belongs to the current frame: nothing to reclaim.
		expect(() => r.ensure({ texture: 'y' })).toThrow(DeviceLimitError);
	});

	it('palette rows are reference counted by owners; at 0 the row returns to the free list', () => {
		const evicted = [];
		const r = new Residency({
			uploader: recordingUploader(),
			now: () => 0,
			onEvict: (h, kind) => evicted.push([h, kind])
		});
		r.retainPalette('p0');
		r.retainPalette('p0');
		r.uploadPalette('p0', new Uint8Array(1024));
		r.uploadPalette('p1', new Uint8Array(1024));
		expect(r.paletteRefCount('p0')).toBe(2);
		r.releasePalette('p0');
		expect(r.slotOf({ texture: null, palette: 'p0' }).paletteRow).toBe(0);
		r.releasePalette('p0');
		expect(r.paletteRefCount('p0')).toBe(0);
		expect(r.slotOf({ texture: null, palette: 'p0' }).paletteRow).toBe(-1);
		expect(evicted).toEqual([['p0', 'palette']]);
		r.uploadPalette('p2', new Uint8Array(1024));
		expect(r.slotOf({ texture: null, palette: 'p2' }).paletteRow).toBe(0);
		expect(r.paletteCount).toBe(2);
	});

	it('idle eviction frees unowned palette rows only; owned rows stay', () => {
		const c = clock();
		const r = new Residency({ uploader: recordingUploader(), now: c.now });
		r.retainPalette('owned');
		r.uploadPalette('owned', new Uint8Array(1024));
		r.uploadPalette('loose', new Uint8Array(1024));
		c.t = IDLE_EVICT_MS + 1;
		expect(r.evictIdle()).toEqual({ frames: 0, palettes: 1 });
		expect(r.slotOf({ texture: null, palette: 'owned' }).paletteRow).toBe(0);
		expect(r.slotOf({ texture: null, palette: 'loose' }).paletteRow).toBe(-1);
	});

	it('a full palette table reclaims an unowned row not used this frame, never an owned one', () => {
		const r = new Residency({ uploader: recordingUploader(), now: () => 0, paletteRows: 2 });
		r.retainPalette('owned');
		r.uploadPalette('owned', new Uint8Array(1024));
		r.uploadPalette('loose', new Uint8Array(1024));
		r.beginFrame();
		r.uploadPalette('fresh', new Uint8Array(1024));
		expect(r.slotOf({ texture: null, palette: 'fresh' }).paletteRow).toBe(1);
		expect(r.slotOf({ texture: null, palette: 'loose' }).paletteRow).toBe(-1);
		expect(() => r.uploadPalette('more', new Uint8Array(1024))).toThrow(DeviceLimitError);
	});
});

describe('residency context-loss purge (R-CTX-006)', () => {
	it('purgeAll drops every slot and row but keeps owner counts; the next draw re-uploads on miss', () => {
		const source = fakeSource({ a: img(64, 64) }, { p: new Uint8Array(1024) });
		const up = recordingUploader();
		const r = new Residency({ uploader: up, now: () => 0, source });
		r.retainPalette('p');
		r.prepare([sprite({ texture: 'a', palette: 'p' })]);
		r.purgeAll();
		expect([r.residentCount, r.paletteCount, r.paletteRefCount('p')]).toEqual([0, 0, 1]);
		expect(r.slotOf({ texture: 'a', palette: 'p' })).toMatchObject({ layer: -1, paletteRow: -1 });
		expect(r.prepare([sprite({ texture: 'a', palette: 'p' })])).toBe(2);
		expect(up.calls).toEqual([['layer', 'r8:64', 0], ['palette', 0], ['purge'], ['layer', 'r8:64', 0], ['palette', 0]]);
	});

	it('the backend purges on webglcontextlost and re-uploads from its frames port after restore', () => {
		const ports = createFakePorts();
		const gl = createFakeGl();
		const canvas = createFakeCanvas({ contexts: { webgl2: gl } });
		const frames = fakeSource({ 'spr:1': img(32, 32) }, { 'pal:1': new Uint8Array(1024) });
		const backend = new WebGL2Backend({ ...ports, canvas, frames }).init();
		const frame = { passes: { entities: [sprite()] } };
		const pools = () => gl.callsTo('texStorage3D').filter(c => c[4] > 1);
		backend.drawFrame(frame);
		expect(pools()).toHaveLength(1);
		canvas.fire('webglcontextlost');
		expect(backend.residency.residentCount).toBe(0);
		canvas.fire('webglcontextrestored');
		backend.drawFrame(frame);
		expect(pools()).toHaveLength(2);
		expect(backend.residency.residentCount).toBe(1);
		expect(backend.evictIdle(-1)).toEqual({ frames: 1, palettes: 1 });
	});
});

describe('C-16 decode for the upload-on-miss source (legacy Sprite.compile layout)', () => {
	const palette = new Uint8Array(1024);
	palette.set([255, 0, 255, 255], 7 * 4); // magenta

	it('indexed: POT-centred R8 indices, magenta → 0', () => {
		const out = decodeSprFrame({ type: 0, width: 3, height: 2, data: new Uint8Array([3, 7, 3, 3, 3, 3]) }, palette);
		expect(out.format).toBe('r8');
		expect([out.width, out.height]).toEqual([4, 2]);
		expect(Array.from(out.data)).toEqual([3, 0, 3, 0, 3, 3, 3, 0]);
	});

	it('RGBA: bottom-up ABGR → top-down RGBA, POT-centred, alpha 0 zeroed', () => {
		// 1×3 bottom-up: bottom row A=255 B=3 G=2 R=1; middle A=0 with colour; top A=128 B=6 G=5 R=4.
		const abgr = new Uint8Array([255, 3, 2, 1, 0, 9, 9, 9, 128, 6, 5, 4]);
		const out = decodeSprFrame({ type: 1, width: 1, height: 3, data: abgr }, palette);
		expect(out.format).toBe('rgba8');
		expect([out.width, out.height]).toEqual([1, 4]);
		// start_y = floor((4 − 3) / 2) = 0: rows top, middle, bottom, then the transparent pad.
		expect(Array.from(out.data)).toEqual([4, 5, 6, 128, 0, 0, 0, 0, 1, 2, 3, 255, 0, 0, 0, 0]);
	});

	it('centerRgbaPot keeps POT images as they are and centres the others', () => {
		const pot = new Uint8Array(2 * 2 * 4).fill(1);
		expect(centerRgbaPot(pot, 2, 2).data).toBe(pot);
		const out = centerRgbaPot(new Uint8Array([9, 9, 9, 9]), 1, 1);
		expect([out.width, out.height]).toEqual([1, 1]);
		const odd = centerRgbaPot(new Uint8Array(3 * 4).fill(7), 3, 1);
		// start_x = floor((4 − 3) / 2) = 0, as legacy: the pad column is on the right.
		expect([odd.width, odd.height]).toEqual([4, 1]);
		expect(Array.from(odd.data)).toEqual([...new Array(12).fill(7), 0, 0, 0, 0]);
		const wide = centerRgbaPot(new Uint8Array(5 * 4).fill(5), 5, 1);
		expect(Array.from(wide.data.subarray(0, 4))).toEqual([0, 0, 0, 0]); // start_x = floor(3 / 2) = 1
	});
});

describe('legacy native sprite record → SpriteDraw (phase 2a record sink)', () => {
	const native = {
		kind: 'sprite',
		texture: { gl: 'frame' },
		palette: { gl: 'pal' },
		textureClass: 'indexed',
		paletteSize: new Float32Array([64, 128]),
		spriteType: 0,
		position: new Float32Array([1, 2, 3]),
		offset: new Float32Array([4, 5]),
		size: new Float32Array([-32, 64]),
		xSize: 5,
		ySize: 5,
		angle: 15,
		color: new Float32Array([1, 1, 1, 0.5]),
		shadowFactor: 0.8,
		zIndex: 151,
		depthBias: 0,
		depthTest: true,
		depthWrite: false,
		depthCorrection: true,
		ignoreDepthMinCap: false,
		blend: 'additive',
		setBlend: true
	};

	it('maps GL objects to residency handles, blend names to pairs and derives sampler and mirror', () => {
		const handles = new Map([
			[native.texture, 'body#0'],
			[native.palette, 'body:pal']
		]);
		const r = fromLegacySpriteRecord(native, { textureHandle: t => handles.get(t), paletteHandle: p => handles.get(p) });
		expect(r).toMatchObject({
			kind: 'sprite',
			texture: 'body#0',
			palette: 'body:pal',
			sampler: 'nearest',
			mirror: true,
			blend: ADDITIVE,
			zIndex: 151,
			depthWrite: false
		});
		expect(r.paletteSize).toBe(native.paletteSize);
	});

	it('RGBA records drop the palette and sample LINEAR unless pixelPerfectSprites', () => {
		const rgba = { ...native, textureClass: 'rgba', palette: null, blend: 'normal' };
		expect(fromLegacySpriteRecord(rgba)).toMatchObject({ palette: null, sampler: 'linear', blend: NORMAL });
		expect(fromLegacySpriteRecord(rgba, { pixelPerfectSprites: true }).sampler).toBe('nearest');
	});
});
