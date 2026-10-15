import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_ADDITIVE, BLEND_NORMAL } from '../records/blend.js';
import { defaultRng } from '../util/injectables.js';

/** Client units are 1/5 of a world unit. */
const UNIT = 1 / 5;
export const WATERFALL_LAYERS = 4;
export const WATERFALL_SEGMENTS = 5;
const TEXTURE_COUNT = 3;
const SEGMENT_HEIGHT = 40 * UNIT;
const EFFECT_TICK_MS = 24;
/** Curtain opacity (uOpacity). */
export const WATERFALL_OPACITY = 80 / 255;

/** Spray puffs cycle through 38 client units at 0.05 units per tick. */
export const WATERFALL_SPRAY_TEXTURE = 'data/texture/effect/freeze_a_small.bmp';
const PARTICLE_CYCLE_MS = (38 / 0.05) * EFFECT_TICK_MS;
const PARTICLE_SIZE = 6 * Math.SQRT1_2 * UNIT;
const PARTICLE_COLOR = Object.freeze([0.65, 1.0, 0.75]);
const PARTICLE_FLOATS = 4;

/** Instanced spray quad corners (triangle strip). */
export const WATERFALL_SPRAY_CORNERS = Object.freeze([-1, -1, 1, -1, -1, 1, 1, 1]);

/**
 * Size and texture set of a variant name ('small' → narrow, fewer puffs; 'dark' → set 3).
 * @param {string} variant
 */
export function waterfallStyle(variant) {
	const small = variant.includes('small');
	const dark = variant.includes('dark');
	return {
		width: (small ? 18 : 36) * UNIT,
		particleCount: small ? 320 : 640,
		particleSpread: (small ? 12 : 22) * UNIT,
		textureSet: dark ? 3 : 1
	};
}

/**
 * Curtain textures waterfall{set}1–3.tga then the spray texture.
 * @param {number} textureSet
 * @returns {string[]}
 */
export function waterfallTextures(textureSet) {
	const files = [];
	for (let i = 1; i <= TEXTURE_COUNT; i++) {
		files.push(`data/texture/effect/waterfall${textureSet}${i}.tga`);
	}
	files.push(WATERFALL_SPRAY_TEXTURE);
	return files;
}

/**
 * Model matrix (column-major float32, as gl-matrix): translate to the RSW position
 * (undoing MapRenderer's −0.5 x/z, +1 altitude sprite offsets) and turn a quarter for
 * vertical waterfalls.
 * @param {ArrayLike<number>} position effect position
 * @param {boolean} vertical
 * @returns {Float32Array}
 */
export function waterfallModelMatrix(position, vertical) {
	const m = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	m[12] = position[0] + 0.5;
	m[13] = 1 - position[2];
	m[14] = position[1] + 0.5;
	if (vertical) {
		const s = Math.sin(Math.PI / 2);
		const c = Math.cos(Math.PI / 2);
		m[0] = c;
		m[2] = -s;
		m[8] = s;
		m[10] = c;
	}
	return m;
}

/**
 * Map waterfall (EffectTable 'WATERFALL') into EffectDraw records. Replaces legacy
 * Renderer/Effects/WaterfallEffect.js + WaterfallParticle.*.
 *
 * Per frame (process = ⌊(tick − start)/24⌋):
 * - 4 curtain layers × 5 segments, layer by layer: family 'waterfall', normal blend,
 *   colour alpha 80/255. Layer l scrolls with period 80 − 13l, is (width + l/5) wide,
 *   sits at depth (l − 1)/5 and cycles the 3 textures; the first and last segments are
 *   cropped by the scroll. params.vertices = 4 × (x, y, z, u, v) triangle strip.
 * - one instanced spray draw: family 'waterfallSpray', additive (R-EFX-014), colour
 *   (0.65, 1, 0.75), params.time = elapsed / 18240, size 6·√½/5, per-instance seeds
 *   (x ± spread, z ± 1, phase, drift angle) drawn from rng once.
 * Both: depth test on, depth write off, scene fog, after the entities.
 */
export class WaterfallEffect {
	/**
	 * @param {{variant: string, vertical?: boolean}} spec EffectTable entry
	 * @param {{position: ArrayLike<number>, startTick: number}} inst
	 * @param {{rng?: function}} [ports]
	 */
	constructor(spec, { position, startTick }, { rng = defaultRng } = {}) {
		const style = waterfallStyle(spec.variant);
		this.position = position;
		this.startTick = startTick;
		this.vertical = spec.vertical;
		this.width = style.width;
		this.particleCount = style.particleCount;
		this.textures = waterfallTextures(style.textureSet);
		this.seeds = new Float32Array(style.particleCount * PARTICLE_FLOATS);
		for (let i = 0; i < style.particleCount; i++) {
			this.seeds[i * PARTICLE_FLOATS] = (rng() * 2 - 1) * style.particleSpread;
			this.seeds[i * PARTICLE_FLOATS + 1] = (rng() * 2 - 1) * 5 * UNIT;
			this.seeds[i * PARTICLE_FLOATS + 2] = rng();
			this.seeds[i * PARTICLE_FLOATS + 3] = rng() * Math.PI * 2;
		}
	}

	/**
	 * @param {number} tick
	 * @param {{sceneFog?: {use: boolean}}} [ctx]
	 * @returns {Object[]} 20 curtain records then the spray record
	 */
	frame(tick, { sceneFog = { use: false } } = {}) {
		const modelMatrix = waterfallModelMatrix(this.position, this.vertical);
		const position = Array.from(this.position);
		const fog = !!sceneFog.use;
		const elapsed = tick - this.startTick;
		const process = Math.floor(elapsed / EFFECT_TICK_MS);
		const common = { pass: 'after', position, depthTest: true, depthWrite: false, depthCorrection: false, fog };
		const out = [];
		for (let layer = 0; layer < WATERFALL_LAYERS; layer++) {
			const speed = 80 - layer * 13;
			const scroll = ((process % speed) * SEGMENT_HEIGHT) / speed;
			const crop = scroll / SEGMENT_HEIGHT;
			const phase = Math.floor((process % (TEXTURE_COUNT * speed)) / speed);
			const halfWidth = (this.width + layer * UNIT) / 2;
			const depth = (layer - 1) * UNIT;
			for (let segment = 0; segment < WATERFALL_SEGMENTS; segment++) {
				const top = scroll - segment * SEGMENT_HEIGHT;
				const bottom = top - SEGMENT_HEIGHT;
				let visibleTop = top;
				let visibleBottom = bottom;
				let vTop = 0;
				let vBottom = 1;
				if (segment === 0) {
					visibleTop = top + (bottom - top) * crop;
					vTop = crop;
				} else if (segment === WATERFALL_SEGMENTS - 1) {
					visibleBottom = top + (bottom - top) * crop;
					vBottom = crop;
				}
				const vertices = new Float32Array([
					-halfWidth,
					-visibleBottom,
					depth,
					0,
					vBottom,
					halfWidth,
					-visibleBottom,
					depth,
					1,
					vBottom,
					-halfWidth,
					-visibleTop,
					depth,
					0,
					vTop,
					halfWidth,
					-visibleTop,
					depth,
					1,
					vTop
				]);
				out.push(
					createEffectDraw({
						...common,
						family: 'waterfall',
						texture: this.textures[(segment + phase) % TEXTURE_COUNT],
						color: [1, 1, 1, WATERFALL_OPACITY],
						blend: BLEND_NORMAL,
						params: { modelMatrix, vertices, layer, segment, vertexCount: 4 }
					})
				);
			}
		}
		out.push(
			createEffectDraw({
				...common,
				family: 'waterfallSpray',
				texture: this.textures[TEXTURE_COUNT],
				color: [PARTICLE_COLOR[0], PARTICLE_COLOR[1], PARTICLE_COLOR[2], 1],
				blend: BLEND_ADDITIVE,
				params: {
					modelMatrix,
					time: elapsed / PARTICLE_CYCLE_MS,
					size: PARTICLE_SIZE,
					seeds: this.seeds,
					instanceCount: this.particleCount,
					vertexCount: 4
				}
			})
		);
		return out;
	}
}
