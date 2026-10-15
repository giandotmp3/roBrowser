/**
 * Ground tiles (Tiles.FlatTexture / HoveringTexture, LPEffect, SpiderWeb, FlatColorTile)
 * into EffectDraw records. Field-by-field parity with legacy is proved in the root suite
 * (tests/renderer/RecordDiff.groundTiles.test.js).
 */
import { describe, expect, it } from 'vitest';
import {
	BLEND_NORMAL,
	EffectSystem,
	FlatColorTileEffect,
	FlatTextureTileEffect,
	HoveringTextureEffect,
	LAND_PROTECTOR_TEXTURE,
	LandProtectorEffect,
	RecordStream,
	SpiderWebEffect,
	flatColorTileClass,
	flatColorTileKey,
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

	it('#59: FlatColorTile classes are cached by colour key, so ForgetEffects keeps its own colour', () => {
		// legacy Songs.js:175 / :185 both call FlatColorTile('humming', ...)
		const humming = { r: 0xe6 / 255, g: 0xd1 / 255, b: 0xd1 / 255, a: 0.05 };
		const forget = { r: 0x1c / 255, g: 0xff / 255, b: 0x73 / 255, a: 0.05 };
		const Humming = flatColorTileClass('humming', humming);
		const Forget = flatColorTileClass('humming', forget);
		expect(Forget).not.toBe(Humming);
		expect(new Forget(inst).frame(0).color).toEqual([forget.r, forget.g, forget.b, 0.05]);
		expect(new Humming(inst).frame(0).color).toEqual([humming.r, humming.g, humming.b, 0.05]);
		// same colour under another name: the same class
		expect(flatColorTileClass('other-name', { ...humming })).toBe(Humming);
		expect(Humming.colorKey).toBe(flatColorTileKey(humming));
		expect(() => flatColorTileClass('bad', { r: 2, g: 0, b: 0 })).toThrow('0.0-1.0');
	});

	it('#59: effects are tracked per instance; remove(ctor) matches by identity, not class name', () => {
		const Red = flatColorTileClass('red', { r: 1, g: 0, b: 0 });
		const Blue = flatColorTileClass('blue', { r: 0, g: 0, b: 1 });
		expect(Red.name).toBe(Blue.name); // same class name, like every legacy FlatColorTile
		const system = new EffectSystem({ table: {}, ctx: {} });
		const red = new Red(inst);
		const blue = new Blue({ ...inst, position: [5, 6, 0] });
		system.add(red, { ownerAID: 1 });
		system.add(blue, { ownerAID: 1 });
		// a second colour spawned while the first is alive is tracked and draws on its own
		expect(system.instances.map(i => i.effect)).toEqual([red, blue]);
		expect(blue.frame(0).color).toEqual([0, 0, 1, 0.5]);
		expect(system.remove(Red, 1)).toBe(1);
		expect(system.instances.map(i => i.effect)).toEqual([blue]);
	});
});
