import { describe, expect, it } from 'vitest';
import { cappedDepth, correctedClipZ, zIndexBias } from '../../src/sprites/depth.js';
import { convertRgbaFrame, padIndexedFrame, spriteSampler } from '../../src/residency/spriteFrames.js';
import { Residency } from '../../src/residency/Residency.js';
import { RunRenderer } from '../../src/batching/RunRenderer.js';
import { GLStateCache } from '../../src/pipeline/GLStateCache.js';
import { splitRuns } from '../../src/batching/runs.js';
import { SHADERS } from '../../src/shaders/index.js';
import { createFakeGl } from '../support/fakeGl.js';
import { ADDITIVE, effect, sprite } from '../support/records.js';

describe('R-SPR-005 billboard depth correction (shader side)', () => {
	it('caps with min(original, corrected) except NPCs which take corrected outright', () => {
		expect(cappedDepth(0.5, 0.7, false)).toBe(0.5);
		expect(cappedDepth(0.5, 0.7, true)).toBe(0.7);
	});
	it('depthCorrection and ignoreDepthMinCap reach the shader as instance attributes', () => {
		expect(SHADERS.spriteVert).toContain('aDepthFlags');
	});
	it('[R-SPR-005] corrected z = depth of the camera ray hitting the vertical plane through the sprite centre', () => {
		// Camera 20 units back, pitched 45° down (legacy-style view matrix), 45° fov.
		const c = Math.SQRT1_2;
		const modelView = [1, 0, 0, 0, 0, c, -c, 0, 0, c, c, 0, 0, 0, -20, 1];
		const f = 1 / Math.tan(Math.PI / 8);
		const projection = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0];
		const position = [0, 0, 0];
		// The quad centre lies on the plane: corrected == original.
		const centre = correctedClipZ({ modelView, projection, position, local: [0, 0] });
		expect(centre.corrected).toBeCloseTo(centre.original, 5);
		// The head of a billboard tilts toward the camera; the plane puts it farther away.
		const head = correctedClipZ({ modelView, projection, position, local: [0, 1.5] });
		expect(head.corrected).toBeGreaterThan(head.original);
		expect(head.z).toBe(head.original);
		const npc = correctedClipZ({ modelView, projection, position, local: [0, 1.5], ignoreDepthMinCap: true });
		expect(npc.z).toBe(npc.corrected);
		// The feet tilt away: corrected is nearer and wins the min cap.
		const feet = correctedClipZ({ modelView, projection, position, local: [0, -1] });
		expect(feet.z).toBe(feet.corrected);
		expect(feet.corrected).toBeLessThan(feet.original);
		expect(SHADERS.spriteVert).toContain('clip.z = aDepthFlags.y > 0.5 ? correctedZBase : min(clip.z, correctedZBase)');
	});
});

describe('R-SPR-006 z-index bias within an entity', () => {
	it('clip.z −= (zIndex·0.01 + depth)/max(zoom, 1)', () => {
		expect(zIndexBias(150, 0, 0.5)).toBeCloseTo(1.5);
		expect(zIndexBias(150, 2, 10)).toBeCloseTo(0.35);
		expect(SHADERS.spriteVert).toContain('clip.z -= (aZIndex * 0.01 + aDepthBias) / max(uZoom, 1.0)');
	});
	it('later layers get a larger bias, so they win ties', () => {
		expect(zIndexBias(151, 0, 1)).toBeGreaterThan(zIndexBias(150, 0, 1));
	});
});

describe('R-SPR-014 palette sprites', () => {
	const palette = new Uint8Array(256 * 4);
	palette.set([255, 0, 255, 255], 7 * 4);
	palette.set([10, 20, 30, 255], 3 * 4);

	it('indexed frames are POT-padded and centred; magenta palette indices become 0', () => {
		const out = padIndexedFrame({ width: 3, height: 2, indices: new Uint8Array([3, 7, 3, 3, 3, 3]) }, palette);
		expect(out.width).toBe(4);
		expect(out.height).toBe(2);
		expect(out.offsetX).toBe(0);
		expect(Array.from(out.data)).toEqual([3, 0, 3, 0, 3, 3, 3, 0]);
	});
	it('indexed → NEAREST; RGBA → LINEAR unless pixelPerfectSprites', () => {
		expect(spriteSampler('indexed', false)).toBe('nearest');
		expect(spriteSampler('rgba', false)).toBe('linear');
		expect(spriteSampler('rgba', true)).toBe('nearest');
	});
	it('the fragment shader treats index 0 as transparent and bilinearly blends 4 palette lookups', () => {
		expect(SHADERS.spriteFrag).toContain('i00 == 0.0 ? vec4(0.0)');
		expect(SHADERS.spriteFrag).toContain('mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y)');
	});
	it('palettes upload as 256×1 RGBA rows of one table', () => {
		const rows = [];
		const r = new Residency({ uploader: { allocLayer() {}, uploadPalette: (row, rgba) => rows.push([row, rgba.length]) }, now: () => 0 });
		r.uploadPalette('pal:a', palette);
		r.uploadPalette('pal:b', palette);
		expect(rows).toEqual([[0, 1024], [1, 1024]]);
		expect(() => r.uploadPalette('bad', new Uint8Array(10))).toThrow(RangeError);
	});
});

describe('R-SPR-016 RGBA sprite frames', () => {
	it('flips vertically, reorders ABGR → RGBA, zeroes alpha-0 pixels', () => {
		// 1×2, bottom-up: row0 (bottom) = A=255 B=3 G=2 R=1 ; row1 (top) = A=0 with colour
		const abgr = new Uint8Array([255, 3, 2, 1, 0, 9, 9, 9]);
		expect(Array.from(convertRgbaFrame({ width: 1, height: 2, abgr }))).toEqual([0, 0, 0, 0, 1, 2, 3, 255]);
	});
});

describe('run-length batching (architecture §1; supports R-SPR-006 order)', () => {
	it('never reorders; splits only on state change', () => {
		const recs = [sprite(), sprite(), sprite({ blend: ADDITIVE }), sprite(), effect()];
		expect(splitRuns(recs).map(r => [r.start, r.count])).toEqual([[0, 2], [2, 1], [3, 1], [4, 1]]);
	});
	it('draws each sprite run as one instanced call in record order', () => {
		const gl = createFakeGl();
		const residency = new Residency({ uploader: { allocLayer() {}, uploadPalette() {} }, now: () => 0 });
		const rr = new RunRenderer({ gl, state: new GLStateCache(gl), residency });
		rr.draw([sprite({ zIndex: 1 }), sprite({ zIndex: 2 }), sprite({ zIndex: 3, depthWrite: false })]);
		expect(gl.callsTo('drawArraysInstanced').map(c => c[4])).toEqual([2, 1]);
		expect(rr.lastDrawCalls).toBe(2);
		const first = gl.callsTo('bufferSubData')[0][3];
		expect(first[14]).toBe(1); // zIndex of instance 0 (field offset 14)
	});
	it('texture-array residency reuses freed layers (no fragmentation)', () => {
		const r = new Residency({ uploader: { allocLayer() {}, uploadPalette() {} }, now: () => 0 });
		const img = { format: 'r8', width: 40, height: 20, data: new Uint8Array(1) };
		r.upload('a', img);
		r.upload('b', img);
		r.release('a');
		r.upload('c', img);
		expect(r.slotOf({ texture: 'c' })).toMatchObject({ layer: 0, pool: 'r8:64' });
	});
});
