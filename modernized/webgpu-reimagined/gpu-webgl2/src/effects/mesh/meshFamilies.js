/**
 * Effect families drawn by the mesh effect pipeline (MeshEffectPipeline), grouped into
 * GL programs where legacy's shader maths is identical:
 *
 * | program        | families                                              | geometry                      |
 * | -------------- | ----------------------------------------------------- | ----------------------------- |
 * | tile           | flat-texture, hovering-texture, lp, spider-web        | static quad, instanced        |
 * | colorTile      | flat-color-tile                                       | static quad, instanced        |
 * | ring           | property-ground, magic-ring                           | static ring mesh, instanced   |
 * | cylinder       | cylinder                                              | cached mesh per shape key     |
 * | quadhorn       | quadhorn                                              | static mesh, instanced        |
 * | sphere         | spirit-sphere, warlock-sphere                         | static quad, instanced        |
 * | lockOn         | lock-on                                               | static quad, instanced        |
 * | magicTarget    | magic-target                                          | per-record ground plane       |
 * | groundAura     | groundAura                                            | static XZ quad, instanced     |
 * | swirlingAura   | swirlingAura                                          | per-record band (de-indexed)  |
 * | level99Bubble  | level99Bubble                                         | per-record billboard quad     |
 * | rsm            | rsm                                                   | per-record object vertices    |
 * | waterfall      | waterfall                                             | per-record strip, instanced   |
 * | waterfallSpray | waterfallSpray                                        | static corners × seeds        |
 * | rainPuddle     | rainPuddle                                            | static XZ quad, instanced     |
 *
 * The `variant` is the part of the program state a run must share beyond the
 * pipelineKey: the static mesh (cylinder shape) and the texture wrap (sampler object).
 * No shader sources here, so the batching code can import it cheaply.
 */

/** @type {Readonly<Record<string, string>>} family → program id */
export const MESH_EFFECT_PROGRAM = Object.freeze({
	'flat-texture': 'tile',
	'hovering-texture': 'tile',
	lp: 'tile',
	'spider-web': 'tile',
	'flat-color-tile': 'colorTile',
	'property-ground': 'ring',
	'magic-ring': 'ring',
	cylinder: 'cylinder',
	quadhorn: 'quadhorn',
	'spirit-sphere': 'sphere',
	'warlock-sphere': 'sphere',
	'lock-on': 'lockOn',
	'magic-target': 'magicTarget',
	groundAura: 'groundAura',
	swirlingAura: 'swirlingAura',
	level99Bubble: 'level99Bubble',
	rsm: 'rsm',
	waterfall: 'waterfall',
	waterfallSpray: 'waterfallSpray',
	rainPuddle: 'rainPuddle'
});

/** Families drawn by the mesh pipeline. */
export const MESH_EFFECT_FAMILIES = Object.freeze(Object.keys(MESH_EFFECT_PROGRAM));

/** Mesh families that sample a texture (flat-color-tile draws a plain colour). */
export const TEXTURED_MESH_FAMILIES = Object.freeze(MESH_EFFECT_FAMILIES.filter(f => f !== 'flat-color-tile'));

/**
 * Texture wrap of a family's legacy texture:
 * - 'clamp': WebGL.texture uploads (CLAMP_TO_EDGE), and the procedural puddle;
 * - 'repeat': textures legacy uploads without setting a wrap (WebGL default REPEAT on
 *   both axes): the tiles (Tiles.loadTexture), the spheres and the lock-on marker;
 * - 'repeatS': a cylinder with repeatTextureX > 1 sets WRAP_S to REPEAT on its texture.
 * @param {{family?: string, params?: {textureRepeat?: boolean}}} record
 * @returns {'clamp'|'repeat'|'repeatS'}
 */
export function meshWrap(record) {
	switch (MESH_EFFECT_PROGRAM[/** @type {string} */ (record.family)]) {
		case 'tile':
		case 'sphere':
		case 'lockOn':
			return 'repeat';
		case 'cylinder':
			return record.params?.textureRepeat ? 'repeatS' : 'clamp';
		default:
			return 'clamp';
	}
}

/**
 * Static mesh key of a record ('' when the program has one mesh, or none).
 * @param {{family?: string, params?: Record<string, any>}} record
 */
export function meshKey(record) {
	if (record.family !== 'cylinder') {
		return '';
	}
	const p = record.params ?? {};
	return `${p.totalCircleSides}/${p.circleSides}/${p.repeatTextureX}`;
}

/**
 * Drawing program of a mesh family record, with its variant: `mesh:<program>:<wrap>:<mesh>`,
 * or null for a family this pipeline does not draw.
 * @param {{family?: string, params?: Record<string, any>}} record
 * @returns {string|null}
 */
export function meshProgramKey(record) {
	const program = MESH_EFFECT_PROGRAM[/** @type {string} */ (record.family)];
	if (!program) {
		return null;
	}
	return `mesh:${program}:${meshWrap(record)}:${meshKey(record)}`;
}
