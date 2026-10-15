/**
 * Synthetic fixtures for scripted scenes. Everything here is invented test data:
 * fake GIDs, `fixture://` asset ids, small procedural maps. No legacy data files, server
 * addresses, accounts or credentials are used (security invariant).
 */

let _gid = 110_000_000;
/** Deterministic fake GID generator (resettable per test file). */
export const nextGid = () => ++_gid;
export const resetGids = () => {
	_gid = 110_000_000;
};

/** Entity type ids as the facade sees them (legacy Entity.TYPE_* semantic names). */
export const EntityType = Object.freeze({
	PC: 'pc',
	MOB: 'mob',
	NPC: 'npc',
	ITEM: 'item',
	PET: 'pet',
	HOM: 'hom',
	MERC: 'merc',
	ELEM: 'elem',
	FALCON: 'falcon',
	WUG: 'wug',
	EFFECT: 'effect',
	WARP: 'warp',
	ABR: 'abr',
	BIONIC: 'bionic'
});

/**
 * Procedural flat (or sloped) map. Heights are per-cell corner heights in GAT units.
 * @param {object} [o]
 */
export function flatMap({
	name = 'fixture_flat',
	width = 40,
	height = 40,
	cellHeight = 0,
	slope = 0,
	indoor = false,
	fog = null, // { near, far, color: [r,g,b] } in DB units (×240 applied by the renderer)
	sky = null, // { skyColor: [r,g,b,a], cloudColor?: [r,g,b] }
	water = null, // { level, type, waveHeight, waveSpeed, wavePitch, animSpeed }
	light = { longitude: 45, latitude: 45, diffuse: [1, 1, 1], ambient: [0.3, 0.3, 0.3], opacity: 1 },
	walkable = () => true,
	weather = null
} = {}) {
	const cells = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const h = cellHeight + slope * x;
			cells.push({ x, y, heights: [h, h + slope, h, h + slope], type: walkable(x, y) ? 0 : 1 });
		}
	}
	return { name, width, height, indoor, fog, sky, water, light, cells, weather };
}

const base = (type, o) => ({
	gid: o.gid ?? nextGid(),
	type,
	position: o.position ?? [20, 20, 0],
	direction: o.direction ?? 0,
	headDir: o.headDir ?? 0,
	action: o.action ?? 'idle',
	job: o.job ?? 0,
	views: o.views ?? {},
	states: o.states ?? {},
	...o
});

/** Player character with optional full equipment (R-SPR-007). */
export const pc = (o = {}) =>
	base(EntityType.PC, {
		job: 4001,
		views: {
			body: 'fixture://pc/body',
			head: 'fixture://pc/head',
			...(o.full
				? {
						weapon: 'fixture://pc/weapon',
						shield: 'fixture://pc/shield',
						robe: 'fixture://pc/robe',
						accessory: 'fixture://hat/low',
						accessory2: 'fixture://hat/top',
						accessory3: 'fixture://hat/mid',
						cart: 'fixture://cart/1'
					}
				: {}),
			...(o.views ?? {})
		},
		...o
	});

export const mob = (o = {}) => base(EntityType.MOB, { job: 1002, views: { body: 'fixture://mob/body' }, ...o });
export const npc = (o = {}) => base(EntityType.NPC, { job: 100, views: { body: 'fixture://npc/body' }, ...o });
export const homun = (o = {}) => base(EntityType.HOM, { job: 6001, views: { body: 'fixture://hom/body' }, ...o });
export const merc = (o = {}) => base(EntityType.MERC, { job: 6017, views: { body: 'fixture://merc/body' }, ...o });
export const falcon = (o = {}) => base(EntityType.FALCON, { job: 0, views: { body: 'fixture://falcon/body' }, ...o });
export const pet = (o = {}) => base(EntityType.PET, { job: 1002, views: { body: 'fixture://pet/body' }, ...o });
export const warp = (o = {}) => base(EntityType.WARP, { job: 45, views: { body: 'fixture://warp/body' }, ...o });
export const gr2Mob = (model, o = {}) => base(EntityType.MOB, { gr2: model, views: {}, ...o });

/** Synthetic ACT/SPR layer description used by fixture bodies (pixel units). */
export const fixtureLayer = ({ width = 40, height = 80, offset = [0, -40], color = [255, 255, 255, 255] } = {}) => ({
	width,
	height,
	offset,
	color
});
