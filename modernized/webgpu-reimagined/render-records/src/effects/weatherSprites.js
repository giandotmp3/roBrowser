import { createSpriteDraw } from '../records/SpriteDraw.js';
import { BLEND_NORMAL } from '../records/blend.js';

/**
 * Shared helpers for the sprite-drawn weather (snow, sakura / maple, rain, fireworks,
 * cloud weather) and sky clouds. Their legacy draws all go through SpriteRenderer, so
 * they become SpriteDraw records here.
 */

/**
 * Depth state of ScreenEffectManager weather: runWithDepth(false, false, true) — no depth
 * test, no depth write, depth correction disabled.
 */
export const WEATHER_DEPTH = Object.freeze({ depthTest: false, depthWrite: false, depthCorrection: false });

/**
 * SpriteRenderer state the weather draws do not set themselves. The weather emitters
 * reset it in their beforeRender; the fireworks inherit whatever the previous
 * SpriteRenderer user left (see PokJukWeather).
 */
export const NEUTRAL_SPRITE_STATE = Object.freeze({
	angle: 0,
	offset: Object.freeze([0, 0]),
	shadowFactor: 1,
	zIndex: 0,
	depthBias: 0,
	palette: null,
	paletteSize: Object.freeze([0, 0]),
	xSize: 5,
	ySize: 5,
	ignoreDepthMinCap: false
});

/**
 * One weather SpriteDraw. Defaults: RGBA texture, no palette, normal blend, 5/5 scale.
 * @param {Object} fields
 * @returns {Readonly<Object>}
 */
export function weatherSpriteDraw(fields) {
	const palette = fields.palette ?? null;
	return createSpriteDraw({
		textureClass: palette === null ? 'rgba' : 'indexed',
		blend: BLEND_NORMAL,
		paletteSize: [0, 0],
		...fields,
		palette
	});
}

/**
 * Draws of one ACT frame of a weather sprite at a particle (legacy renderLayer of
 * SnowWeather.js / SakuraWeatherEffect.js). Per layer:
 * - index < 0 is skipped;
 * - indexed sprites (not spr_type 1, rgba_index ≠ 0) draw with the sprite palette and a
 *   palette size of twice the frame size; spr_type 1 shifts the frame by old_rgba_index;
 * - size = frame size × layer scale × particle scale (negative width when mirrored);
 * - colour = layer colour with alpha × particle alpha; offset = layer pos;
 * - a layer whose texture is missing or whose alpha is 0 is not drawn and does not
 *   consume a zIndex. The particle's zIndex starts at 0.
 *
 * @param {Object} opts
 * @param {Object} opts.spr   { frames[{texture,width,height}], texture, rgba_index, old_rgba_index }
 * @param {Object[]} opts.layers ACT layers
 * @param {number} opts.sizeScale particle scale
 * @param {number} opts.alpha particle alpha
 * @param {ArrayLike<number>} opts.position particle world position
 * @param {Object} [opts.state] inherited SpriteRenderer state (shadowFactor, depthBias, xSize...)
 * @returns {Object[]} SpriteDraw records
 */
export function actFrameDraws({ spr, layers, sizeScale, alpha, position, state = NEUTRAL_SPRITE_STATE }) {
	const out = [];
	let zIndex = 0;
	let paletteSize = state.paletteSize;
	for (const layer of layers) {
		if (layer.index < 0) {
			continue;
		}
		let index = layer.index;
		let palette = null;
		const isRgba = layer.spr_type === 1 || spr.rgba_index === 0;
		if (!isRgba) {
			palette = spr.texture;
			paletteSize = [2 * spr.frames[index].width, 2 * spr.frames[index].height];
		} else if (layer.spr_type === 1) {
			index += spr.old_rgba_index;
		}
		const frame = spr.frames[index];
		let width = frame.width * layer.scale[0] * sizeScale;
		const height = frame.height * layer.scale[1] * sizeScale;
		if (layer.is_mirror) {
			width = -width;
		}
		const color = [layer.color[0], layer.color[1], layer.color[2], layer.color[3] * alpha];
		if (!frame.texture || !color[3]) {
			continue;
		}
		out.push(
			weatherSpriteDraw({
				texture: frame.texture,
				palette,
				paletteSize,
				position: [position[0], position[1], position[2]],
				offset: [layer.pos[0], layer.pos[1]],
				size: [width, height],
				xSize: 5,
				ySize: 5,
				angle: layer.angle,
				color,
				shadowFactor: state.shadowFactor,
				zIndex: zIndex++,
				depthBias: state.depthBias,
				ignoreDepthMinCap: state.ignoreDepthMinCap,
				...WEATHER_DEPTH
			})
		);
	}
	return out;
}

/**
 * Lifetime of an emitter-style weather (snow, sakura, rain): open-ended (endTick −1)
 * until stop() sets a fade-out tail; emission stops EMIT_STOP_BEFORE_END before the end
 * and the effect finishes at endTick.
 *
 * @param {number} endTick
 * @param {number} tick
 * @returns {number} remaining ms (Infinity when open-ended)
 */
export function remainingMs(endTick, tick) {
	return endTick > 0 ? endTick - tick : Infinity;
}
