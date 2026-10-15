/**
 * Synthetic EffectTable, entities and a scripted timeline for the EffectManager-level
 * record diff (legacy Renderer/EffectManager.js vs render-records EffectSystem).
 *
 * The table covers the orchestration paths, not the family maths (each family has its own
 * diff): STR (plain, /mineffect `min`, missing `min` → full-file fallback, `%d` random
 * pick), 3D / 2D (duplicates, delayStart, delayOffset/LateDelta, attachedEntity), CYLINDER
 * (persistent + repeatEnd, spec `repeat` with a negative repeatDelay), FUNC entries
 * (FlatColorTile colours, an attached Cylinder added through effects.add), the hard-coded
 * aura IDs (200, 881), a spec-level renderBeforeEntities, and far effects that are
 * distance-culled (and keep expiring / repeating) until the player walks up to them.
 *
 * Both sides get structurally identical tables (`makeTable(side, deps)`): the legacy one
 * carries `func(Params)` closures that build legacy classes and EffectManager.add them, the
 * rebuild one `FUNC(params, ctx)` closures that build render-records players and
 * ctx.effects.add them. Each side gets its own deep copy (legacy normalises entries in place).
 */

/** Texture files: Client.loadFile → WebGL.texture → { id: name }; name is the full path. */
const textureFile = path => [path, { name: path }];

export const TEXTURE_FILES = Object.fromEntries(
	[
		'data/texture/effect/a.tga',
		'data/texture/effect/b.tga',
		'data/texture/effect/c.tga',
		'data/texture/effect/ring_blue.tga',
		'data/texture/effect/ring_yellow.tga',
		'data/texture/effect/magic_green.tga'
	].map(textureFile)
);

/**
 * STR aliases of the compiled files of strEffectScene.js (r1..r3 are the `%d` picks).
 * @param {Record<string, object>} strFiles STR_FILES of support/strEffectScene.js
 */
export function strAliases(strFiles) {
	const dir = 'data/texture/effect/';
	return {
		[`${dir}r1.str`]: strFiles[`${dir}multi.str`],
		[`${dir}r2.str`]: strFiles[`${dir}loop.str`],
		[`${dir}r3.str`]: strFiles[`${dir}holes.str`]
	};
}

export const PLAYER_AID = 1;
export const OWNER_AID = 100;
export const TARGET_AID = 200;
export const TILE_AID = 300;
export const CHAIN_AID = 400;
export const GHOST_AID = 999;

/** Entities looked up by EntityManager.get / ctx.entities.get (shared by both sides). */
export function makeEntities() {
	const attachments = { add() {}, remove() {}, get: () => null };
	const entity = (GID, position, direction = 0) => ({
		GID,
		objecttype: 1,
		position: new Float32Array(position),
		direction,
		action: 0,
		xSize: 5,
		ySize: 5,
		attachments
	});
	return {
		[PLAYER_AID]: entity(PLAYER_AID, [50, 50, 0]),
		[OWNER_AID]: entity(OWNER_AID, [52, 48, 0.5], 3),
		[TARGET_AID]: entity(TARGET_AID, [55, 53, 0])
	};
}

/** Move the player (towards the far effects) and the owner, in place. */
export function moveEntities(entities, tick) {
	const player = entities[PLAYER_AID].position;
	player[0] = 50 + Math.max(0, Math.min(tick - 1300, 900)) / 60; // 50 → 65
	player[1] = 50 + Math.sin(tick / 300);
	const owner = entities[OWNER_AID].position;
	owner[0] = 52 + (tick - 1000) / 200;
	owner[1] = 48 - (tick - 1000) / 400;
	owner[2] = 0.5 + ((tick / 250) % 2);
}

/** Camera stand-in per tick (Cylinder reads angle[0..1], 2D / 3D the yaw and direction). */
export function cameraAt(tick) {
	return { angle: [200 + (tick % 60), ((tick - 1000) * 0.31) % 360, 0], direction: Math.floor(tick / 233) % 8 };
}

/**
 * Frame ticks. 1768 lands exactly on endTick + repeatDelay of the first CYL_REPEAT instance
 * (spawned 1518, duration 400, repeatDelay −150): legacy repeats only once the tick is
 * strictly past it.
 */
export const TICKS = [
	...Array.from({ length: 30 }, (_, i) => 1000 + i * 37),
	...Array.from({ length: 30 }, (_, i) => 2110 + i * 53),
	1768,
	3700,
	3712,
	3760
].sort((a, b) => a - b);

const RED = { r: 1, g: 0, b: 0, a: 0.6 };
const BLUE = { r: 0, g: 0, b: 1, a: 0.6 };

const CYL_FUNC = {
	textureName: 'magic_green',
	topSize: 1,
	bottomSize: 0.5,
	height: 2,
	animation: 2,
	alphaMax: 0.7,
	blendMode: 2
};

/** Effect IDs of the table (named for readability in the test). */
export const FX = Object.freeze({
	STR_PLAIN: 1,
	STR_MIN: 2,
	STR_MIN_MISSING: 3,
	STR_RAND: 4,
	THREE_D_DUP: 5,
	TWO_D_ATTACHED: 6,
	CYL_PERSIST: 7,
	CYL_REPEAT: 8,
	STR_PERSIST: 9,
	THREE_D_BEFORE: 10,
	FAR: 11,
	FAR_REPEAT: 12,
	AURA_CYL: 200,
	AURA_STR: 881,
	TILE_RED: 500,
	TILE_BLUE: 501,
	FUNC_ATTACHED: 502,
	TWO_D_NOW: 13
});

/**
 * Table data shared by both sides (no closures).
 */
function tableData() {
	return {
		[FX.STR_PLAIN]: [{ type: 'STR', file: 'multi', duplicate: 0 }],
		[FX.STR_MIN]: [{ type: 'STR', file: 'blends', min: 'loop' }],
		[FX.STR_MIN_MISSING]: [{ type: 'STR', file: 'holes', min: 'nomin' }],
		[FX.STR_RAND]: [{ type: 'STR', file: 'r%d', rand: [1, 3] }],
		[FX.THREE_D_DUP]: [
			{
				type: '3D',
				file: 'effect/a.tga',
				duration: 400,
				duplicate: 3,
				timeBetweenDupli: 150,
				delayStart: 50,
				fadeIn: true,
				posxStart: -1,
				posxEnd: 2,
				sizeStart: 40,
				sizeEnd: 90,
				sizeDelta: 5,
				alphaMax: 0.6,
				alphaMaxDelta: 0.1,
				blendMode: 2
			},
			{ type: '2D', file: 'effect/b.tga', duration: 500, size: 60, fadeOut: true, delayStart: 120 }
		],
		[FX.TWO_D_ATTACHED]: [
			{ type: '2D', file: 'effect/c.tga', attachedEntity: true, duration: 600, delayStart: 100, posz: 1, size: 50 },
			{ type: '3D', file: 'effect/b.tga', attachedEntity: true, duration: 700, posz: 2, size: 30, rotateWithCamera: true }
		],
		[FX.CYL_PERSIST]: [
			{
				type: 'CYLINDER',
				textureName: 'ring_blue',
				topSize: 1.2,
				bottomSize: 0.8,
				height: 3,
				animation: 1,
				fade: true,
				duration: 300,
				repeatDelay: 100,
				delayOffset: 40,
				delayLate: 30,
				delayStart: 20
			}
		],
		[FX.CYL_REPEAT]: [
			{
				type: 'CYLINDER',
				textureName: 'magic_green',
				topSize: 0.6,
				bottomSize: 1,
				height: 1.5,
				duration: 400,
				repeat: true,
				repeatDelay: -150,
				delayOffset: 25,
				delayOffsetDelta: 10,
				delayLate: 15,
				duplicate: 2,
				timeBetweenDupli: 90
			}
		],
		[FX.STR_PERSIST]: [{ type: 'STR', file: 'loop' }],
		[FX.TWO_D_NOW]: [{ type: '2D', file: 'effect/a.tga', duration: 300, size: 45 }],
		[FX.THREE_D_BEFORE]: [{ type: '3D', file: 'effect/c.tga', renderBeforeEntities: true, duration: 500, size: 70 }],
		[FX.FAR]: [
			{ type: '3D', file: 'effect/a.tga', duration: 500, size: 40 },
			{ type: 'CYLINDER', textureName: 'ring_blue', topSize: 1, bottomSize: 1, height: 1, duration: 900 },
			{ type: 'STR', file: 'multi' }
		],
		[FX.FAR_REPEAT]: [
			{
				type: 'CYLINDER',
				textureName: 'ring_yellow',
				topSize: 0.5,
				bottomSize: 0.5,
				height: 4,
				duration: 200,
				repeat: true,
				repeatDelay: 50
			}
		],
		[FX.AURA_CYL]: [
			{
				type: 'CYLINDER',
				textureName: 'ring_yellow',
				topSize: 2,
				bottomSize: 2,
				height: 0.5,
				renderBeforeEntities: false,
				duration: 2000
			}
		],
		[FX.AURA_STR]: [{ type: 'STR', file: 'multi' }],
		[FX.TILE_RED]: [{ type: 'FUNC' }],
		[FX.TILE_BLUE]: [{ type: 'FUNC' }],
		[FX.FUNC_ATTACHED]: [{ type: 'FUNC', attachedEntity: true, duration: 700, cyl: CYL_FUNC }]
	};
}

/**
 * @param {'legacy'|'rebuild'} side
 * @param {object} deps legacy: { EffectManager, FlatColorTile, Cylinder };
 *   rebuild: { flatColorTileClass, CylinderEffect }
 */
export function makeTable(side, deps) {
	const table = structuredClone(tableData());
	const fn = {};
	if (side === 'legacy') {
		const { EffectManager, FlatColorTile, Cylinder } = deps;
		const tile = (name, color) => Params => {
			const Tile = FlatColorTile(name, { ...color });
			EffectManager.add(new Tile(Params.Inst.position, Params.Inst.startTick), Params);
		};
		fn[FX.TILE_RED] = tile('emRed', RED);
		fn[FX.TILE_BLUE] = tile('emBlue', BLUE);
		fn[FX.FUNC_ATTACHED] = Params => {
			EffectManager.add(new Cylinder(Params.effect.cyl, Params.Inst, Params.Init), Params);
		};
		for (const [id, func] of Object.entries(fn)) {
			table[id][0].func = func;
		}
	} else {
		const { flatColorTileClass, CylinderEffect } = deps;
		const tile = (name, color) => (params, ctx) => {
			const Tile = flatColorTileClass(name, color);
			ctx.effects.add(new Tile({ position: params.Inst.position, effectId: params.Inst.effectID }), params);
		};
		fn[FX.TILE_RED] = tile('emRed', RED);
		fn[FX.TILE_BLUE] = tile('emBlue', BLUE);
		fn[FX.FUNC_ATTACHED] = (params, ctx) => {
			const { Inst } = params;
			const effect = new CylinderEffect(
				params.effect.cyl,
				{ ...Inst, effectId: Inst.effectID, follow: { position: Inst.position } },
				{ rng: ctx.effects.rng }
			);
			ctx.effects.add(effect, params);
		};
		for (const [id, FUNC] of Object.entries(fn)) {
			table[id][0].FUNC = FUNC;
		}
	}
	return table;
}

/** The blue FlatColorTile colour (the #59 collision). */
export const BLUE_COLOR = [BLUE.r, BLUE.g, BLUE.b, BLUE.a];

/**
 * Scripted actions, run once at the first frame whose tick reaches `at`, before rendering.
 * `api` is the side adapter: spam(params), remove(ctorKey, aid, ids), endRepeat(aid),
 * pref(name, value) (/effect, /mineffect, performanceMode, viewArea).
 */
export const SCRIPT = [
	{
		at: 1000,
		run: api => {
			api.spam({ effectId: FX.STR_PLAIN, position: [51, 50, 0] });
			api.spam({ effectId: FX.THREE_D_DUP, ownerAID: OWNER_AID, otherAID: TARGET_AID });
			api.spam({ effectId: FX.AURA_CYL, ownerAID: OWNER_AID });
			api.spam({ effectId: FX.THREE_D_BEFORE, position: [49, 51, 0.5] });
		}
	},
	{
		at: 1037,
		run: api => {
			api.spam({ effectId: FX.CYL_PERSIST, position: [48, 49, 0], persistent: true, repeatEnd: 2300, ownerAID: TARGET_AID });
			api.spam({ effectId: FX.AURA_STR, ownerAID: OWNER_AID });
		}
	},
	{
		at: 1111,
		run: api => {
			api.spam({ effectId: FX.TWO_D_ATTACHED, ownerAID: OWNER_AID });
			api.spam({ effectId: FX.TILE_RED, position: [53, 50, 0], ownerAID: TILE_AID });
		}
	},
	{
		at: 1222,
		run: api => {
			api.spam({ effectId: FX.TILE_BLUE, position: [54, 50, 0], ownerAID: TILE_AID });
			api.spam({ effectId: FX.FAR, position: [80, 50, 0] });
			api.spam({ effectId: FX.FAR_REPEAT, position: [78, 52, 0], ownerAID: CHAIN_AID });
			// negative repeatDelay: repeats while culled and still alive
			api.spam({ effectId: FX.CYL_REPEAT, position: [79, 47, 0], ownerAID: CHAIN_AID });
		}
	},
	{
		at: 1296,
		run: api => {
			api.pref('mineffect', true);
			api.spam({ effectId: FX.STR_MIN, position: [50, 52, 0] });
			api.spam({ effectId: FX.STR_MIN_MISSING, position: [52, 52, 0] });
			api.pref('mineffect', false);
			api.spam({ effectId: FX.STR_MIN, position: [50, 47, 0] });
			api.spam({ effectId: FX.STR_RAND, position: [47, 50, 0] });
			api.spam({ effectId: FX.STR_RAND, position: [47, 52, 0] });
		}
	},
	{
		at: 1370,
		run: api => {
			api.spam({ effectId: FX.STR_PERSIST, position: [46, 46, 1], persistent: true, repeatDelay: 60 });
		}
	},
	{
		at: 1444,
		run: api => {
			api.pref('effect', false);
			api.spam({ effectId: FX.STR_PLAIN, position: [51, 51, 0] });
			api.spam({ effectId: FX.TILE_RED, position: [50, 50, 0], ownerAID: TILE_AID });
			api.pref('effect', true);
		}
	},
	{
		at: 1518,
		run: api => {
			api.spam({ effectId: FX.CYL_REPEAT, position: [55, 47, 0], ownerAID: CHAIN_AID });
		}
	},
	{
		at: 1592,
		run: api => {
			api.spam({ effectId: FX.FUNC_ATTACHED, ownerAID: OWNER_AID });
			// attachedEntity FUNC without an owner entity is not run
			api.spam({ effectId: FX.FUNC_ATTACHED, ownerAID: GHOST_AID, position: [50, 50, 0] });
			api.spam({ effectId: FX.THREE_D_DUP, position: [58, 50, 0] });
		}
	},
	{
		at: 1814,
		run: api => {
			api.pref('performanceMode', true);
			api.spam({ effectId: FX.FAR, position: [63, 51, 0] });
		}
	},
	{
		at: 2010,
		run: api => {
			api.remove(null, TILE_AID);
		}
	},
	{
		at: 2163,
		run: api => {
			api.pref('performanceMode', false);
			api.endRepeat(CHAIN_AID);
		}
	},
	{
		at: 2481,
		run: api => {
			api.spam({ effectId: FX.STR_PLAIN, position: [60, 52, 0], ownerAID: OWNER_AID });
			api.spam({ effectId: FX.CYL_REPEAT, position: [60, 50, 0], ownerAID: OWNER_AID });
			api.spam({ effectId: FX.THREE_D_DUP, ownerAID: TARGET_AID });
		}
	},
	{
		// cast-cancel style remove of a class with no live instance: legacy falls back to
		// every class, so all of the owner's effects go (kept for parity, proposed flag)
		at: 2640,
		run: api => {
			api.remove('QuadHorn', OWNER_AID);
		}
	},
	{
		at: 2905,
		run: api => {
			api.remove('Cylinder', TARGET_AID);
			api.remove(null, null, [FX.STR_PERSIST]);
			api.spam({ effectId: FX.CYL_PERSIST, position: [62, 50, 0], persistent: true });
		}
	},
	{
		// the 3D and STR groups emptied and were dropped: re-created after the Cylinder group
		at: 3011,
		run: api => {
			api.spam({ effectId: FX.THREE_D_DUP, position: [61, 51, 0] });
			api.spam({ effectId: FX.STR_PLAIN, position: [61, 49, 0] });
		}
	},
	{
		// the 2D group emptied in the previous frame's after pass: legacy dropped it there, so the
		// new 2D effect draws after the STR group, not at the 2D group's old place
		at: 3700,
		run: api => {
			api.spam({ effectId: FX.TWO_D_NOW, position: [62, 49, 0] });
		}
	}
];
