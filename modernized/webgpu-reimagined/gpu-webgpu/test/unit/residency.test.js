import { describe, expect, it } from 'vitest';
import { createFakeGpu } from '../support/fakeGpu.js';
import {
	DeviceLimitError,
	IDLE_EVICT_MS,
	SpriteResidency,
	SpriteRunRenderer,
	TextureArrayPools,
	centerRgbaPot,
	decodeSprFrame,
	fromLegacySpriteRecord
} from '../../src/index.js';

const img = (w, h, format = 'r8') => ({
	format,
	width: w,
	height: h,
	data: new Uint8Array(w * h * (format === 'r8' ? 1 : 4))
});

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

describe('sprite residency upload-on-miss (C-16 FrameSourcePort, same contract as gpu-webgl2)', () => {
	it('uploads a missing frame and palette through the source on first use, once', () => {
		const source = fakeSource({ a: img(64, 64) }, { p: new Uint8Array(1024) });
		const up = recordingUploader();
		const r = new SpriteResidency({ uploader: up, now: () => 0, source });
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
		const r = new SpriteResidency({ uploader: recordingUploader(), now: () => 0, source });
		expect(r.ensure({ texture: 'late', palette: null })).toBe(false);
		expect(r.slotOf({ texture: 'late' }).layer).toBe(-1);
		source.frames.late = img(32, 32, 'rgba8');
		expect(r.ensure({ texture: 'late', palette: null })).toBe(true);
		expect(r.slotOf({ texture: 'late' })).toMatchObject({ layer: 0, pool: 'rgba8:32' });
		expect(r.stats.misses).toBe(1);
	});

	it('prepare() uploads only sprite records and reports the upload count; no source is a no-op', () => {
		const source = fakeSource({ a: img(32, 32), b: img(32, 32) }, { p: new Uint8Array(1024) });
		const r = new SpriteResidency({ uploader: recordingUploader(), now: () => 0, source });
		const n = r.prepare([
			{ kind: 'sprite', texture: 'a', palette: 'p' },
			{ kind: 'effect', texture: 'b' },
			{ kind: 'sprite', texture: 'a', palette: 'p' }
		]);
		expect(n).toBe(2);
		expect(r.residentCount).toBe(1);
		expect(new SpriteResidency({ uploader: recordingUploader(), now: () => 0 }).prepare([{ kind: 'sprite', texture: 'a' }])).toBe(0);
	});

	it('a full pool reclaims the least recently used layer the current frame does not draw', () => {
		const c = clock();
		const evicted = [];
		const source = fakeSource({ a: img(32, 32), b: img(32, 32), c: img(32, 32) });
		const r = new SpriteResidency({
			uploader: recordingUploader(),
			layersPerPool: 2,
			now: c.now,
			source,
			onEvict: (h, kind) => evicted.push([h, kind])
		});
		r.beginFrame();
		r.ensure({ texture: 'a' });
		c.t = 10;
		r.ensure({ texture: 'b' });
		// Same frame: both layers are in use, so a third frame cannot take one.
		expect(() => r.ensure({ texture: 'c' })).toThrow(DeviceLimitError);
		r.beginFrame();
		c.t = 20;
		r.slotOf({ texture: 'b' });
		expect(r.ensure({ texture: 'c' })).toBe(true);
		expect(evicted).toEqual([['a', 'frame']]);
		expect(r.slotOf({ texture: 'c' }).layer).toBe(0);
		expect(r.slotOf({ texture: 'a' }).layer).toBe(-1);
	});

	it('palette rows are refcounted by owners; unowned rows are reclaimed when the table is full', () => {
		const source = fakeSource({}, { p: new Uint8Array(1024), q: new Uint8Array(1024), s: new Uint8Array(1024) });
		const r = new SpriteResidency({ uploader: recordingUploader(), paletteRows: 2, now: () => 0, source });
		r.retainPalette('p');
		r.beginFrame();
		r.ensure({ texture: null, palette: 'p' });
		r.ensure({ texture: null, palette: 'q' });
		r.beginFrame();
		// 'p' is owned, 'q' is not: 's' takes q's row.
		r.ensure({ texture: null, palette: 's' });
		expect(r.slotOf({ palette: 's' }).paletteRow).toBe(1);
		expect(r.slotOf({ palette: 'q' }).paletteRow).toBe(-1);
		expect(r.paletteRefCount('p')).toBe(1);
		r.releasePalette('p');
		expect(r.slotOf({ palette: 'p' }).paletteRow).toBe(-1);
		expect(r.paletteCount).toBe(1);
	});

	it('evictIdle frees layers and unowned rows idle for maxAge (default IDLE_EVICT_MS); purgeAll keeps owner counts', () => {
		const c = clock();
		const up = recordingUploader();
		const source = fakeSource({ a: img(32, 32), b: img(64, 64) }, { p: new Uint8Array(1024) });
		const r = new SpriteResidency({ uploader: up, now: c.now, source });
		r.retainPalette('p');
		r.prepare([
			{ kind: 'sprite', texture: 'a', palette: 'p' },
			{ kind: 'sprite', texture: 'b', palette: null }
		]);
		c.t = IDLE_EVICT_MS - 1;
		r.slotOf({ texture: 'b' });
		c.t = IDLE_EVICT_MS + 1;
		expect(r.evictIdle()).toEqual({ frames: 1, palettes: 0 });
		expect(r.residentCount).toBe(1);
		expect(r.evictIdle(-1)).toEqual({ frames: 1, palettes: 0 });
		expect(r.freeLayers('r8:32')).toBe(64);
		r.purgeAll();
		expect(up.calls.at(-1)).toEqual(['purge']);
		expect(r.paletteCount).toBe(0);
		expect(r.paletteRefCount('p')).toBe(1);
		r.ensure({ texture: 'a', palette: 'p' });
		expect(r.slotOf({ texture: 'a', palette: 'p' })).toMatchObject({ layer: 0, paletteRow: 0 });
	});

	it('SpriteRunRenderer.encode uploads misses before it packs the instances', async () => {
		const fake = createFakeGpu();
		const source = fakeSource({ 'spr:1': img(64, 32) }, { 'pal:1': new Uint8Array(1024) });
		const residency = new SpriteResidency({
			uploader: new TextureArrayPools({ device: fake.device }),
			now: () => 0,
			source
		});
		const renderer = await new SpriteRunRenderer({ device: fake.device, residency }).init();
		await renderer.pipelines.settled();
		const record = {
			kind: 'sprite',
			texture: 'spr:1',
			textureClass: 'indexed',
			palette: 'pal:1',
			sampler: 'nearest',
			position: [0, 0, 0],
			offset: [0, 0],
			size: [64, 32],
			angle: 0,
			color: [1, 1, 1, 1],
			shadowFactor: 1,
			zIndex: 0,
			depthBias: 0,
			depthTest: true,
			depthWrite: true,
			depthCorrection: false,
			ignoreDepthMinCap: false,
			blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' }
		};
		const pass = new Proxy({}, { get: () => () => {} });
		residency.beginFrame();
		renderer.encode(pass, [record, record]);
		expect(renderer.lastUploads).toBe(2);
		expect(renderer._instances[18]).toBe(0); // layer
		expect(renderer._instances[19]).toBe(0); // palette row
		renderer.encode(pass, [record]);
		expect(renderer.lastUploads).toBe(0);
	});
});

describe('legacy decode and record adapter (real-stream parity inputs)', () => {
	it('decodeSprFrame: indexed → POT-centred r8 with magenta keyed to 0; RGBA → flipped, POT-centred rgba8', () => {
		const palette = new Uint8Array(1024);
		palette.set([255, 0, 255, 255], 7 * 4);
		const indexed = decodeSprFrame({ type: 0, width: 3, height: 1, data: new Uint8Array([1, 7, 2]) }, palette);
		expect(indexed).toMatchObject({ format: 'r8', width: 4, height: 1 });
		expect([...indexed.data]).toEqual([1, 0, 2, 0]);
		const rgba = decodeSprFrame({ type: 1, width: 1, height: 2, data: new Uint8Array([255, 1, 2, 3, 128, 4, 5, 6]) }, palette);
		expect(rgba).toMatchObject({ format: 'rgba8', width: 1, height: 2 });
		expect([...rgba.data]).toEqual([6, 5, 4, 128, 3, 2, 1, 255]);
		const centred = centerRgbaPot(new Uint8Array([9, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7]), 3, 1);
		expect(centred.width).toBe(4);
		expect([...centred.data.subarray(0, 4)]).toEqual([9, 9, 9, 9]);
	});

	it('fromLegacySpriteRecord maps handles, blend pair, sampler and mirror like gpu-webgl2', () => {
		const native = {
			texture: { gl: 1 },
			palette: { gl: 2 },
			textureClass: 'indexed',
			paletteSize: [128, 128],
			position: [1, 2, 3],
			offset: [0, 0],
			size: [-20, 40],
			xSize: 5,
			ySize: 5,
			angle: 0,
			color: [1, 1, 1, 1],
			shadowFactor: 1,
			zIndex: 3,
			depthBias: 0,
			depthTest: true,
			depthWrite: false,
			depthCorrection: true,
			ignoreDepthMinCap: false,
			blend: 'additive'
		};
		const r = fromLegacySpriteRecord(native, { textureHandle: () => 'spr#0', paletteHandle: () => 'spr:pal' });
		expect(r).toMatchObject({
			kind: 'sprite',
			texture: 'spr#0',
			palette: 'spr:pal',
			sampler: 'nearest',
			mirror: true,
			blend: { src: 'SRC_ALPHA', dst: 'ONE' }
		});
		const rgba = fromLegacySpriteRecord({ ...native, textureClass: 'rgba', blend: 'normal' });
		expect(rgba).toMatchObject({ palette: null, sampler: 'linear', blend: { dst: 'ONE_MINUS_SRC_ALPHA' } });
		expect(fromLegacySpriteRecord(native, { pixelPerfectSprites: true }).sampler).toBe('nearest');
	});
});
