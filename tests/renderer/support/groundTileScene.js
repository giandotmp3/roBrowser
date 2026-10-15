/**
 * Synthetic ground-tile scene (Tiles.FlatTexture / HoveringTexture, LPEffect, SpiderWeb,
 * FlatColorTile) shared by the GL snapshot test (GroundTiles.records.test.js) and the
 * record diff (RecordDiff.groundTiles.test.js).
 *
 * Classes are built from a fresh module instance per run (the factories cache by name and
 * the instance counters that pick the hover / pulse phase are module-level). Each group is
 * one EffectManager list: a constructor plus its live instances. 'color-shared' mirrors
 * EffectManager keying lists by `constructor.name`: every FlatColorTile class is named
 * 'FlatColorTile', so a second colour spawned while the first is alive lands in the first
 * one's list and is never statically initialised.
 */

export const TILE_TICKS = [0, 40, 400, 1200, 2500, 4000, 5300, 6800, 9000, 12000, 17000];

/** Position of instance k of a group (EffectTable copies Params.Inst.position). */
const at = k => [30 + k * 2, 40 - k, 0.25 * k];

/**
 * Build the scripted groups from fresh modules.
 * @param {{Tiles: object, LPEffect: Function, SpiderWeb: Function, FlatColorTile: Function}} mods
 * @returns {Array<{group: string, Ctor: Function, live: Array, specs: object}>}
 */
export function buildTileGroups({ Tiles, LPEffect, SpiderWeb, FlatColorTile }) {
	const flat = Tiles.FlatTexture('data/texture/effect/plain.bmp');
	const flatBig = Tiles.FlatTexture('data/texture/effect/big.bmp', 128);
	const lens = Tiles.HoveringTexture('data/texture/effect/lens_w.bmp', 0.5, 0.7);
	const zz = Tiles.HoveringTexture('data/texture/effect/zz.bmp');
	const lost = Tiles.HoveringTexture('data/texture/effect/missing.bmp', 1, 1);
	const salmon = FlatColorTile('salmon', { r: 1, g: 0x8a / 255, b: 0xbb / 255, a: 0.6 });
	const lullabySpec = { r: 0.2, g: 0.4, b: 0.6 };
	const lullaby = FlatColorTile('lullaby', lullabySpec);
	const spawn = (Ctor, names) => {
		Ctor.needInit = true;
		return names.map((name, k) => {
			const effect = new Ctor(at(k), 100 * k);
			effect.needInit = true;
			return { name, effect };
		});
	};
	return [
		{
			group: 'flat',
			Ctor: flat,
			live: spawn(flat, ['flat-0']),
			spec: { kind: 'flat', texture: 'data/texture/effect/plain.bmp', textureSize: 64 }
		},
		{
			group: 'flat-big',
			Ctor: flatBig,
			live: spawn(flatBig, ['flat-big-0']),
			spec: { kind: 'flat', texture: 'data/texture/effect/big.bmp', textureSize: 128 }
		},
		{
			group: 'lens',
			Ctor: lens,
			live: spawn(lens, ['lens-0', 'lens-1']),
			spec: { kind: 'hover', texture: 'data/texture/effect/lens_w.bmp', effectSize: 0.5, alpha: 0.7 }
		},
		{
			group: 'zz',
			Ctor: zz,
			live: spawn(zz, ['zz-0']),
			spec: { kind: 'hover', texture: 'data/texture/effect/zz.bmp' }
		},
		{
			group: 'lost',
			Ctor: lost,
			live: spawn(lost, ['lost-0']),
			spec: { kind: 'hover', texture: 'data/texture/effect/missing.bmp', effectSize: 1, alpha: 1 }
		},
		{ group: 'lp', Ctor: LPEffect, live: spawn(LPEffect, ['lp-0', 'lp-1', 'lp-2']), spec: { kind: 'lp' } },
		{
			group: 'spider',
			Ctor: SpiderWeb,
			live: spawn(SpiderWeb, ['spider-0', 'spider-1']),
			spec: { kind: 'spider' }
		},
		{
			group: 'salmon',
			Ctor: salmon,
			live: spawn(salmon, ['salmon-0', 'salmon-1']),
			spec: { kind: 'color', name: 'salmon', color: { r: 1, g: 0x8a / 255, b: 0xbb / 255, a: 0.6 } }
		},
		{
			group: 'color-shared',
			Ctor: lullaby,
			live: [...spawn(lullaby, ['lullaby-0']), ...spawnForeign(FlatColorTile, at(5))],
			spec: { kind: 'color', name: 'lullaby', color: { ...lullabySpec, a: 0.5 } }
		}
	];
}

/** The second FlatColorTile colour of the scene (discrepancy #59). */
export const FOREIGN_COLOR = Object.freeze({ r: 0.9, g: 0.1, b: 0.1, a: 0.3 });

/** A different FlatColorTile colour whose instance joins another colour's list. */
function spawnForeign(FlatColorTile, position) {
	const Other = FlatColorTile('apple', { ...FOREIGN_COLOR });
	const effect = new Other(position, 0);
	effect.needInit = true;
	return [{ name: 'apple-foreign', effect, foreign: true, color: FOREIGN_COLOR }];
}
