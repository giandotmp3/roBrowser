/**
 * Ground tiles (Tiles.FlatTexture / HoveringTexture, LPEffect, SpiderWeb, FlatColorTile)
 * into EffectDraw records. Field-by-field parity with legacy is proved in the root suite
 * (tests/renderer/RecordDiff.groundTiles.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_NORMAL,
	FlatColorTileEffect,
	FlatTextureTileEffect,
	HoveringTextureEffect,
	LAND_PROTECTOR_TEXTURE,
	LandProtectorEffect,
	RecordStream,
	SpiderWebEffect,
	tilePulse
} from '../../src/index.js';

const inst = { position: [3, 4, 0.5], index: 1 };

describe('ground tiles', () => {
	it('odd and even spawns pulse in opposite phase', () => {
		expect(tilePulse(1, 0)).toBe(0);
		expect(tilePulse(1, (540 * Math.PI * Math.PI) / 2)).toBeCloseTo(1);
		expect(tilePulse(2, (540 * Math.PI * Math.PI) / 2)).toBeCloseTo(-1);
	});

	it('before-entities pass, normal alpha, pass depth state; one record per frame', () => {
		const stream = new RecordStream();
		const r = new LandProtectorEffect(inst).frame(0, {}, stream);
		expect(stream.records).toEqual([r]);
		expect(r).toMatchObject({
			family: 'lp',
			pass: 'before',
			texture: LAND_PROTECTOR_TEXTURE,
			position: [3, 4, 0.5],
			color: [1, 1, 1, 0.7],
			depthTest: true,
			depthWrite: true,
			fog: false
		});
		expect(r.blend).toBe(BLEND_NORMAL);
		expect(r.params).toEqual({ size: 0.8, textureSize: 64, vertexCount: 6 });
		expect(new SpiderWebEffect(inst).frame(0).params).toEqual({ size: 1.5, textureSize: 128, vertexCount: 6 });
	});

	it('hovering textures bob 0.2–0.6 above the cell, keep their alpha and follow scene fog', () => {
		const effect = new HoveringTextureEffect({ texture: 't.bmp', effectSize: 0.5, alpha: 0.7 }, inst);
		const r = effect.frame(0, { sceneFog: { use: true } });
		expect(r.position[2]).toBeCloseTo(0.9);
		expect(r.color).toEqual([1, 1, 1, 0.7]);
		expect(r.fog).toBe(true);
		expect(r.params.size).toBe(0.5);
	});

	it('FlatTexture base draw: depth off, size and alpha never uploaded', () => {
		const r = new FlatTextureTileEffect({ texture: 't.bmp', textureSize: 128 }, inst).frame(0);
		expect(r).toMatchObject({ family: 'flat-texture', depthTest: false, depthWrite: false, color: [1, 1, 1, 0] });
		expect(r.params.size).toBe(0);
	});

	it('flat colour tiles: untextured, default alpha 0.5', () => {
		const r = new FlatColorTileEffect({ r: 1, g: 0, b: 0 }, inst).frame(0);
		expect(r).toMatchObject({ family: 'flat-color-tile', texture: null, color: [1, 0, 0, 0.5], fog: false });
	});
});
