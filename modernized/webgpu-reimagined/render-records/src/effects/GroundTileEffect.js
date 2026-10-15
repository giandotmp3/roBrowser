import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_NORMAL } from '../records/blend.js';
import { effectPass } from './rules.js';

/** One quad per tile draw. */
export const TILE_VERTEX_COUNT = 6;

export const LAND_PROTECTOR_TEXTURE = 'data/texture/effect/aaa copy.bmp';
export const SPIDER_WEB_TEXTURE = 'data/texture/effect/spiderweb.tga';

/**
 * Pulse of instance `index` (1-based spawn number of its family counter): odd instances
 * start at phase 0, even ones at π; one cycle lasts 2π · 540π ms (about 10.7 s).
 * @param {number} index
 * @param {number} tick
 * @returns {number} in [−1, 1]
 */
export function tilePulse(index, tick) {
	const oddEven = index % 2 === 0 ? Math.PI : 0;
	return Math.sin(oddEven + tick / (540 * Math.PI));
}

/**
 * @typedef {Object} TileParams  EffectDraw.params of the ground tile families
 * @property {number} size         uSize: half the quad side in cells
 * @property {number} [textureSize] square canvas the texture is resampled into (rotated 180°)
 * @property {number} vertexCount
 */

/**
 * Shared shape of the ground tile families (legacy Tiles.js, LPEffect.js, SpiderWeb.js,
 * FlatColorTile.js): a flat quad over the cell, drawn in the before-entities pass with
 * normal alpha. Tiles that set no depth state carry the before-entities pass state
 * (depth test and write on).
 */
class GroundTile {
	/**
	 * @param {Object} inst
	 * @param {ArrayLike<number>} inst.position
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 */
	constructor(inst) {
		this.position = [inst.position[0], inst.position[1], inst.position[2]];
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, true);
	}

	/**
	 * @param {Object} fields family-specific EffectDraw fields
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>}
	 */
	emit(fields, stream) {
		const record = createEffectDraw({
			pass: this.pass,
			position: this.position.slice(),
			blend: BLEND_NORMAL,
			depthTest: true,
			depthWrite: true,
			depthCorrection: false,
			fog: false,
			...fields
		});
		stream?.effect(record);
		return record;
	}
}

/**
 * `Tiles.FlatTexture(file, size)` drawn by its own render (no caller uses it directly;
 * subclasses override it): depth test, write and correction off, scene fog; neither the
 * size nor the alpha uniform is uploaded, so the quad has size 0 and alpha 0.
 */
export class FlatTextureTileEffect extends GroundTile {
	/**
	 * @param {{texture: string, textureSize?: number}} spec
	 * @param {ConstructorParameters<typeof GroundTile>[0]} inst
	 */
	constructor({ texture, textureSize = 64 }, inst) {
		super(inst);
		this.texture = texture;
		this.textureSize = textureSize;
	}

	/**
	 * @param {number} _tick
	 * @param {{sceneFog?: {use: boolean}}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 */
	frame(_tick, { sceneFog } = {}, stream) {
		return this.emit(
			{
				family: 'flat-texture',
				texture: this.texture,
				color: [1, 1, 1, 0],
				depthTest: false,
				depthWrite: false,
				fog: Boolean(sceneFog && sceneFog.use),
				params: { size: 0, textureSize: this.textureSize, vertexCount: TILE_VERTEX_COUNT }
			},
			stream
		);
	}
}

/**
 * `Tiles.HoveringTexture(file, effectSize = 1, alpha = 1)`: a song / ensemble symbol
 * bobbing 0.2–0.6 cells above its cell, alpha forced by the uniform, scene fog.
 */
export class HoveringTextureEffect extends GroundTile {
	/**
	 * @param {{texture: string, effectSize?: number, alpha?: number}} spec
	 * @param {ConstructorParameters<typeof GroundTile>[0] & {index: number}} inst  index:
	 *   1-based spawn number shared by every hovering texture (legacy module counter)
	 */
	constructor({ texture, effectSize = 1, alpha = 1 }, inst) {
		super(inst);
		this.texture = texture;
		this.effectSize = effectSize;
		this.alpha = alpha;
		this.index = inst.index;
	}

	/**
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}}} [frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 */
	frame(tick, { sceneFog } = {}, stream) {
		const [x, y, z] = this.position;
		return this.emit(
			{
				family: 'hovering-texture',
				texture: this.texture,
				position: [x, y, z + 0.4 - 0.2 * tilePulse(this.index, tick)],
				color: [1, 1, 1, this.alpha],
				fog: Boolean(sceneFog && sceneFog.use),
				params: { size: this.effectSize, textureSize: 64, vertexCount: TILE_VERTEX_COUNT }
			},
			stream
		);
	}
}

/**
 * Pulsing textured tile (size base + 0.05 · pulse), alpha forced to 0.7 by the shader,
 * no fog.
 */
class PulsingTileEffect extends GroundTile {
	/**
	 * @param {{family: string, texture: string, base: number, textureSize: number}} o
	 * @param {ConstructorParameters<typeof GroundTile>[0] & {index: number}} inst  index:
	 *   1-based spawn number of the family's own counter
	 */
	constructor(o, inst) {
		super(inst);
		Object.assign(this, o);
		this.index = inst.index;
	}

	/**
	 * @param {number} tick
	 * @param {Object} [_frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 */
	frame(tick, _frameState, stream) {
		return this.emit(
			{
				family: this.family,
				texture: this.texture,
				color: [1, 1, 1, 0.7],
				params: {
					size: this.base + 0.05 * tilePulse(this.index, tick),
					textureSize: this.textureSize,
					vertexCount: TILE_VERTEX_COUNT
				}
			},
			stream
		);
	}
}

/** Land Protector ground tile (legacy LPEffect). */
export class LandProtectorEffect extends PulsingTileEffect {
	/** @param {ConstructorParameters<typeof PulsingTileEffect>[1]} inst */
	constructor(inst) {
		super({ family: 'lp', texture: LAND_PROTECTOR_TEXTURE, base: 0.8, textureSize: 64 }, inst);
	}
}

/** Spider Web ground tile (legacy SpiderWeb). */
export class SpiderWebEffect extends PulsingTileEffect {
	/** @param {ConstructorParameters<typeof PulsingTileEffect>[1]} inst */
	constructor(inst) {
		super({ family: 'spider-web', texture: SPIDER_WEB_TEXTURE, base: 1.5, textureSize: 128 }, inst);
	}
}

/**
 * Validated [r, g, b, a] of a FlatColorTile spec (legacy checks: each channel present and
 * in 0..1; a defaults to 0.5). The spec is not mutated.
 * @param {{r: number, g: number, b: number, a?: number}} spec
 * @returns {number[]}
 */
function flatColor({ r, g, b, a = 0.5 }) {
	for (const value of [r, g, b, a]) {
		if (value === undefined) {
			throw new Error('FlatColorTile: need to pass r, g, b, a');
		}
		if (value > 1.0 || value < 0.0) {
			throw new Error('FlatColorTile: r, g, b, a need to be 0.0-1.0');
		}
	}
	return [r, g, b, a];
}

/**
 * Untextured colour tile (legacy FlatColorTile(name, { r, g, b, a = 0.5 })), size 0.5,
 * no fog. The spec is validated like legacy (each channel present and in 0..1) but not
 * mutated. Every instance draws on its own (no per-class list or init gate, #59).
 */
export class FlatColorTileEffect extends GroundTile {
	/**
	 * @param {{r: number, g: number, b: number, a?: number}} spec
	 * @param {ConstructorParameters<typeof GroundTile>[0]} inst
	 */
	constructor(spec, inst) {
		super(inst);
		this.color = flatColor(spec);
	}

	/**
	 * @param {number} _tick
	 * @param {Object} [_frameState]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]
	 */
	frame(_tick, _frameState, stream) {
		return this.emit(
			{
				family: 'flat-color-tile',
				texture: null,
				color: this.color.slice(),
				params: { size: 0.5, vertexCount: TILE_VERTEX_COUNT }
			},
			stream
		);
	}
}

/** Cache key of a FlatColorTile colour (#59): the colour itself, never the song name. */
export const flatColorTileKey = spec => flatColor(spec).join(',');

/** @type {Map<string, typeof FlatColorTileEffect>} */
const _flatColorTiles = new Map();

/**
 * Discrepancy #59 [FLAG, fixed]: the FlatColorTile class of a colour, cached by colour key.
 * Legacy caches by `name`, and Songs.js reuses 'humming' for ForgetEffects, so Forget draws
 * Humming's colour; here two specs share a class only when their colours are equal, and
 * `name` is just a label. Instances of the returned class take only `inst`.
 * @param {string} name label (legacy cache key, unused for caching)
 * @param {{r: number, g: number, b: number, a?: number}} spec
 * @returns {typeof FlatColorTileEffect}
 */
export function flatColorTileClass(name, spec) {
	const key = flatColorTileKey(spec);
	let Tile = _flatColorTiles.get(key);
	if (!Tile) {
		const [r, g, b, a] = flatColor(spec);
		const color = Object.freeze({ r, g, b, a });
		Tile = class extends FlatColorTileEffect {
			static colorKey = key;
			static label = name;
			/** @param {ConstructorParameters<typeof GroundTile>[0]} inst */
			constructor(inst) {
				super(color, inst);
			}
		};
		_flatColorTiles.set(key, Tile);
	}
	return Tile;
}
