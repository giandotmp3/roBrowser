/**
 * Synthetic compiled STR effects (Loaders/Str.js output after Client.js attached
 * `materials`) and a scripted spawn list, shared by the StrEffect GL snapshot test
 * and the STR record diff. Textures are named objects ({ id }).
 */

const tex = id => ({ id });

/** One STR keyframe in loader shape (colours already /255). */
function key(fields) {
	const k = {
		frame: 0,
		type: 0,
		pos: [320, 320],
		uv: [0, 0, 1, 0, 0, 1, 1, 1],
		xy: [-20, 20, -20, 20, -30, -30, 30, 30],
		aniframe: 0,
		anitype: 0,
		delay: 0,
		angle: 0,
		color: [1, 1, 1, 1],
		srcalpha: 5,
		destalpha: 2,
		mtpreset: 0,
		...fields
	};
	for (const f of ['pos', 'uv', 'xy', 'color']) {
		k[f] = new Float32Array(k[f]);
	}
	return k;
}

/** A delta key: every interpolated field moves by these amounts per key. */
const delta = fields =>
	key({
		type: 1,
		pos: [0, 0],
		uv: [0, 0, 0, 0, 0, 0, 0, 0],
		xy: [0, 0, 0, 0, 0, 0, 0, 0],
		color: [0, 0, 0, 0],
		anitype: 1,
		...fields
	});

function layer(materials, animations) {
	return {
		texcnt: materials.length,
		texname: materials.map((m, i) => `data\\texture\\effect\\t${i}.bmp`),
		materials,
		anikeynum: animations.length,
		animations
	};
}

function str(fps, maxKey, layers) {
	return { header: 'STRM', version: 0x94, fps, maxKey, layernum: layers.length, layers };
}

const M = ['m0', 'm1', 'm2', 'm3'].map(tex);

export const STR_FILES = {
	// Multiple layers, interpolation, anitype 1-4 and default, re-sourced keys.
	'data/texture/effect/multi.str': str(30, 20, [
		layer(M.slice(0, 3), [
			key({ frame: 0, pos: [300, 330], color: [1, 0.5, 0.25, 1], angle: 10 }),
			delta({
				frame: 0,
				aniframe: 0.25,
				color: [0, 0.01, 0, -0.02],
				pos: [1.5, -2],
				xy: [-0.5, 0.5, -0.25, 0.25, -1, -1, 1, 1],
				angle: 3
			}),
			key({ frame: 8, srcalpha: 5, destalpha: 6, aniframe: 1, angle: 45 }),
			delta({ frame: 8, anitype: 2, delay: 0.5, angle: -2, pos: [-3, 1] }),
			key({ frame: 16, aniframe: 2 })
		]),
		layer(M.slice(0, 2), [
			key({ frame: 2, srcalpha: 9, destalpha: 6, color: [0.8, 0.8, 1, 0.6], xy: [-8, 8, -8, 8, -4, -4, 12, 12] }),
			delta({ frame: 2, anitype: 3, delay: 0.7, color: [0, 0, -0.02, 0.01] })
		]),
		layer(M.slice(0, 4), [
			key({ frame: 0, aniframe: 3, angle: 90 }),
			delta({ frame: 0, anitype: 4, delay: 0.3 })
		]),
		layer(M.slice(0, 2), [
			key({ frame: 0, srcalpha: 2, destalpha: 2, aniframe: 1 }),
			delta({ frame: 0, anitype: 7, aniframe: 1 })
		])
	]),

	// D3D blend pairs, including the rare constant / saturate factors.
	'data/texture/effect/blends.str': str(
		60,
		30,
		[
			[11, 6],
			[14, 15],
			[1, 3],
			[7, 8],
			[4, 10],
			[9, 2]
		].map(([s, d], i) =>
			layer([tex(`b${i}`)], [key({ frame: 0, srcalpha: s, destalpha: d, angle: i * 15 }), delta({ frame: 0 })])
		)
	),

	// Codes outside the legacy D3DBLEND table (12, 13, 0): GL receives undefined.
	'data/texture/effect/badblend.str': str(60, 30, [
		layer([tex('u0')], [key({ frame: 0, srcalpha: 12, destalpha: 2 }), delta({ frame: 0 })]),
		layer([tex('u1')], [key({ frame: 0, srcalpha: 5, destalpha: 13 }), delta({ frame: 0 })]),
		layer([tex('u2')], [key({ frame: 0, srcalpha: 0, destalpha: 0 }), delta({ frame: 0 })])
	]),

	// Non-integer D3D codes (discrepancy #41): GL receives undefined as well. Not in SPAWNS.
	'data/texture/effect/fracblend.str': str(60, 30, [
		layer([tex('f0')], [key({ frame: 0, srcalpha: 5.5, destalpha: 2 }), delta({ frame: 0 })]),
		layer([tex('f1')], [key({ frame: 0, srcalpha: 5, destalpha: 6.25 }), delta({ frame: 0 })])
	]),

	// Persistent loop (wraps at maxKey, never removed).
	'data/texture/effect/loop.str': str(20, 10, [
		layer([tex('l0'), tex('l1')], [key({ frame: 0, angle: 5 }), delta({ frame: 0, pos: [2, 1], aniframe: 0.2 })])
	]),

	// Hat effect: layer 0 goes blank at key 6, layer 1 at key 9 (both blank → restart).
	'data/texture/effect/hat.str': str(20, 12, [
		layer(
			[tex('h0'), tex('h1')],
			[
				key({ frame: 0, pos: [310, 300], angle: 20 }),
				delta({ frame: 0, aniframe: 0.3, pos: [1, 1], angle: 1 }),
				key({ frame: 6 })
			]
		),
		layer(
			[tex('k0')],
			[
				key({ frame: 0, srcalpha: 5, destalpha: 6, color: [1, 1, 1, 0.5] }),
				delta({ frame: 0, color: [0, 0, 0, 0.02], xy: [-1, 1, -1, 1, 0, 0, 0, 0] }),
				key({ frame: 9 })
			]
		)
	]),

	// Fallback textures: material 1 never loaded, and a layer with no textures.
	'data/texture/effect/holes.str': str(10, 8, [
		layer([tex('f0'), undefined, tex('f2')], [key({ frame: 0 }), delta({ frame: 0, aniframe: 0.5 })]),
		layer([], [key({ frame: 0 }), delta({ frame: 0 })]),
		// starts later: blank before key 3
		layer([tex('f3')], [key({ frame: 3, angle: -30 }), delta({ frame: 3, angle: -5 })])
	])
};

export const TICKS = [1000, 1040, 1100, 1210, 1300, 1390, 1480, 1560, 1640, 1700];

/** Owner entity of the attachment effects; moves every tick. */
export function makeOwner() {
	return { position: [5, 6, 0.5], direction: 2, xSize: 10, ySize: 8 };
}

/**
 * Spawn parameters (shared by legacy and render-records).
 * attachment: { xOffset, yOffset } when the effect follows the owner entity.
 */
export const SPAWNS = [
	{ name: 'multi', file: 'data/texture/effect/multi.str', position: [10, 20, 1], startTick: 1000 },
	{ name: 'blends', file: 'data/texture/effect/blends.str', position: [3, 4, 0], startTick: 1000 },
	{ name: 'badblend', file: 'data/texture/effect/badblend.str', position: [3, 4, 0], startTick: 1000 },
	{ name: 'loop', file: 'data/texture/effect/loop.str', position: [7, 7, 2], startTick: 1000, persistent: true },
	{
		name: 'hat',
		file: 'data/texture/effect/hat.str',
		position: [0, 0, 0],
		startTick: 1000,
		persistent: true,
		attachment: { xOffset: 3, yOffset: -2 }
	},
	{
		name: 'hatOnce',
		file: 'data/texture/effect/hat.str',
		position: [0, 0, 0],
		startTick: 1100,
		attachment: { xOffset: 0, yOffset: 4 }
	},
	{ name: 'holes', file: 'data/texture/effect/holes.str', position: [1, 1, 1], startTick: 1040 },
	{ name: 'missing', file: 'data/texture/effect/missing.str', position: [0, 0, 0], startTick: 1000 }
];

/**
 * Invalid D3D blend codes (discrepancy #41: 0/12/13 and non-integer). Legacy hands GL an
 * undefined factor; render-records draws normal alpha.
 */
export const INVALID_BLEND_SPAWNS = [
	SPAWNS.find(s => s.name === 'badblend'),
	{ name: 'fracblend', file: 'data/texture/effect/fracblend.str', position: [3, 4, 0], startTick: 1000 }
];

/** Move an owner entity deterministically with the tick. */
export function moveOwner(owner, tick) {
	owner.position[0] = 5 + (tick - 1000) / 400;
	owner.position[1] = 6 - (tick - 1000) / 800;
}

/**
 * Build legacy StrEffect instances the way EffectManager / EntityAttachments do.
 * @param {Function} StrEffect legacy class
 */
export function spawnEffects(StrEffect, spawns = SPAWNS) {
	return spawns.map(spawn => {
		const effect = new StrEffect(spawn.file, spawn.position.slice(), spawn.startTick, '');
		let move;
		if (spawn.persistent) {
			effect.persistent = true;
		}
		if (spawn.attachment) {
			const owner = makeOwner();
			effect.ownerEntity = owner;
			effect.xOffset = spawn.attachment.xOffset;
			effect.yOffset = spawn.attachment.yOffset;
			move = tick => moveOwner(owner, tick);
		}
		return { name: spawn.name, spawn, effect, move };
	});
}
