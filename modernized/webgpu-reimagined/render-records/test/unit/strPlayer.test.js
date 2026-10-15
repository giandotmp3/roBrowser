/**
 * StrPlayer: STR keyframe playback into EffectDraw records (R-EFX-007..010, R-SPR-032).
 * Field-by-field parity with legacy StrEffect is proved in the root suite
 * (tests/renderer/RecordDiff.strEffect.test.js).
 */
import { describe, expect, it } from 'vitest';
import { BlendFactor, RecordStream, StrPlayer } from '../../src/index.js';

const key = o => ({
	frame: 0,
	type: 0,
	pos: [320, 320],
	uv: [0, 0, 0, 0, 0, 0, 0, 0],
	xy: [-10, 10, -10, 10, -10, -10, 10, 10],
	aniframe: 0,
	anitype: 0,
	delay: 0,
	angle: 0,
	color: [1, 1, 1, 1],
	srcalpha: 5,
	destalpha: 2,
	...o
});
const delta = o =>
	key({ type: 1, pos: [0, 0], xy: [0, 0, 0, 0, 0, 0, 0, 0], color: [0, 0, 0, 0], anitype: 1, ...o });
const layer = (materials, animations) => ({ texcnt: materials.length, materials, animations });
const str = (fps, maxKey, layers) => ({ fps, maxKey, layernum: layers.length, layers });

describe('StrPlayer', () => {
	it('R-EFX-007/008/009: interpolated layer records, D3D blend, billboard params, removal at maxKey', () => {
		const file = str(10, 5, [layer(['a', 'b'], [key({ pos: [330, 300] }), delta({ pos: [1, 0], aniframe: 0.5, angle: 2 })])]);
		const player = new StrPlayer({ str: file, startTick: 0, position: [1, 2, 3] });
		const stream = new RecordStream();
		const [r] = player.frame(200, { sceneFog: { use: false } }, stream);
		expect(stream.records).toEqual([r]);
		expect(r).toMatchObject({ kind: 'effect', family: 'str', texture: 'b', depthWrite: false, strAttachment: false });
		expect(r.blend).toEqual({ src: BlendFactor.SRC_ALPHA, dst: BlendFactor.ONE });
		expect(r.params).toMatchObject({ offset: [12, -20], angle: 4, aniframe: 1, scale: 1, yLower: 0.5, clipZBias: -0.1 });
		expect(r.position).toEqual([1, 2, 3]);
		expect(player.finished).toBe(false);
		player.frame(500);
		expect(player.finished).toBe(true);
	});

	it('R-EFX-010 FIX: STR records follow the scene fog', () => {
		const file = str(10, 5, [layer(['a'], [key({}), delta({})])]);
		const player = new StrPlayer({ str: file, startTick: 0 });
		expect(player.frame(0, { sceneFog: { use: true } })[0].fog).toBe(true);
		expect(player.frame(0, { sceneFog: { use: false } })[0].fog).toBe(false);
	});

	it('R-SPR-032: attachments follow and scale with the entity; hats reuse blank keys and restart', () => {
		const entity = { position: [4, 5, 0], xSize: 10, ySize: 10 };
		const file = str(10, 10, [
			layer(['a'], [key({}), delta({ aniframe: 0 }), key({ frame: 3 })]),
			layer(['c'], [key({}), delta({}), key({ frame: 6 })])
		]);
		const player = new StrPlayer({ str: file, startTick: 0, persistent: true, attachment: { entity, xOffset: 1, yOffset: 2 } });
		const [first] = player.frame(100);
		expect(first).toMatchObject({ strAttachment: true, position: [4, 5, 0] });
		expect(first.params).toMatchObject({ scale: 2, yLower: 0, offset: [14, -28] });
		entity.position = [9, 9, 0];
		const blank = player.frame(400); // layer 0 blank at key 4: reuses its key-1 frame
		expect(blank.map(r => r.texture)).toEqual(['a', 'c']);
		expect(blank[0].position).toEqual([9, 9, 0]);
		player.frame(700); // key 7: every layer blank -> restart
		expect(player.startTick).toBe(700);
		expect(player.finished).toBe(false);
	});

	it('missing textures draw nothing; a failed load or a null (loading) file emits nothing', () => {
		const file = str(10, 5, [layer(['a', undefined], [key({}), delta({ aniframe: 1 })]), layer([], [key({}), delta({})])]);
		const player = new StrPlayer({ str: file, startTick: 0 });
		expect(player.frame(0)).toHaveLength(1);
		expect(player.frame(100)).toHaveLength(0);
		const loading = new StrPlayer({ str: null, startTick: 0 });
		expect(loading.frame(5000)).toEqual([]);
		expect(loading.finished).toBe(false);
		loading.fail();
		expect(loading.finished).toBe(true);
	});
});
