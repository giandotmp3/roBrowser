import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_ADDITIVE } from '../records/blend.js';
import { defaultClock, defaultRng } from '../util/injectables.js';
import { effectPass } from './rules.js';

const DEG_TO_RAD = Math.PI / 180;
const GAME_TO_WORLD = 0.1 * 2.2;
const GAME_TICK_MS = 25;
const MAX_FRAME_DT = 250;

/** Lift of the bubble base below the terrain (legacy GL space). */
export const BUBBLE_BASE_LIFT = 0.05;

/** Billboard scale (legacy debugConfig.scaleMult). */
export const BUBBLE_SCALE = 0.6;

/** Jitter amplitude per game tick. */
export const BUBBLE_DRIFT = 0.15;

/** Alpha envelope: clamp(250 + gain·(y + offset), 0, 250) / 255. */
export const BUBBLE_ALPHA_OFFSET = 20;
export const BUBBLE_ALPHA_GAIN = 30;

/** Vertex count of one billboard quad. */
export const BUBBLE_VERTEX_COUNT = 6;

/** Anchor jitter signs (B_pre, B_now, T_pre, T_now) and their phase-pair indices. */
const ANCHORS = Object.freeze([
	{ kx: 1, kz: 1, pa: 0, pb: 2 },
	{ kx: -1, kz: -1, pa: 4, pb: 6 },
	{ kx: 1, kz: -1, pa: 8, pb: 10 },
	{ kx: -1, kz: 1, pa: 12, pb: 14 }
]);

/** Billboard corners (bottom-left, bottom-right, top-right, top-left) and the quad's uv order. */
const CORNERS = Object.freeze([
	[-1, -1],
	[1, -1],
	[1, 1],
	[-1, 1]
]);
const QUAD_ORDER = Object.freeze([
	[0, 0, 0],
	[1, 1, 0],
	[2, 1, 1],
	[2, 1, 1],
	[3, 0, 1],
	[0, 0, 0]
]);

/**
 * Variant of a flag1 tint selector: 1 blue (two passes), 11 / 3 ghost (one column,
 * faster, deeper), anything else white.
 *
 * @param {number} flag1
 */
export function level99BubbleVariant(flag1) {
	const ghost = flag1 === 11 || flag1 === 3;
	const blue = flag1 === 1;
	return {
		ghost,
		radius: blue ? 2.4 : ghost ? 3.2 : 0.8,
		fallSpeed: ghost ? 0.6 : 0.15,
		seedMax: ghost ? 60 : 99,
		resetY: ghost ? -60 : -30,
		color: blue ? [80 / 255, 80 / 255, 255 / 255] : ghost ? [0.85, 0.85, 0.85] : [1.0, 1.0, 1.0],
		passCount: blue ? 2 : 1,
		columns: ghost ? 1 : 4
	};
}

/**
 * Alpha of an anchor at height y (game units; above 0 is not drawn).
 * @param {number} y
 */
export function level99BubbleAlpha(y) {
	return Math.max(0, Math.min(250, 250 + BUBBLE_ALPHA_GAIN * (y + BUBBLE_ALPHA_OFFSET))) / 255;
}

/**
 * @typedef {Object} Level99BubbleParams  EffectDraw.params of family 'level99Bubble'
 * @property {number} column
 * @property {number} anchor       0 B_pre, 1 B_now, 2 T_pre, 3 T_now
 * @property {number} pass         draw pass (blue draws each anchor twice)
 * @property {number[]} quad       6 vertices (x, y, z, u, v), legacy GL space, camera-facing
 * @property {number} zIndex       0.01 + column·0.002 + anchor·0.0001 + pass·0.00005
 * @property {number} vertexCount
 */

/**
 * EF_LEVEL99_3 bubble sparkle (EffectTable 202, R-EFX-015): emitter columns of four
 * anchors that fall from a random height, jitter along random phase walks once below
 * the ground line, fade in by height and respawn. Replaces legacy
 * Renderer/Effects/Level99Bubble.js; draws one EffectDraw per visible anchor per pass.
 *
 * Additive (R-EFX-014), depth test without write, before entities, scene fog.
 * Randomness goes through the rng port in legacy order (construction: per column 16
 * phase/target pairs then 4 anchor heights; per frame: one step draw per phase walk, one
 * more when a walk reaches its target, five per respawn). Like legacy, a start tick of
 * 0 seeds the frame clock from dateNow, and the frame delta is capped at 250 ms but not
 * floored (an earlier tick runs the simulation backwards).
 */
export class Level99BubbleEffect {
	/**
	 * @param {Object} spec
	 * @param {string} [spec.textureName]  under data/texture/effect/ (default whitelight.tga)
	 * @param {number} [spec.flag1]        tint selector (default 1, blue)
	 * @param {Object} inst
	 * @param {ArrayLike<number>} inst.position
	 * @param {number} inst.startTick
	 * @param {{position: ArrayLike<number>}} [inst.follow]  entity followed every frame
	 * @param {number} [inst.effectId]
	 * @param {boolean} [inst.renderBeforeEntities]
	 * @param {{rng?: import('../util/injectables.js').Rng, dateNow?: import('../util/injectables.js').Clock}} [ports]
	 */
	constructor({ textureName, flag1 }, inst, { rng = defaultRng, dateNow = defaultClock } = {}) {
		this.rng = rng;
		this.position = [inst.position[0], inst.position[1], inst.position[2]];
		this.follow = inst.follow ?? null;
		this.pass = effectPass({ effectId: inst.effectId, renderBeforeEntities: inst.renderBeforeEntities }, true);
		this.texture = `data/texture/effect/${textureName || 'whitelight.tga'}`;
		this.lastTick = inst.startTick || dateNow();
		this.flag1 = flag1 === 0 || flag1 ? flag1 : 1;
		this.variant = level99BubbleVariant(this.flag1);

		const rand = (min, max) => min + rng() * (max - min);
		this.columns = Array.from({ length: this.variant.columns }, () => {
			// float32 like legacy, so phase-walk comparisons match
			const phases = new Float32Array(16);
			const targets = new Float32Array(16);
			for (let p = 0; p < 16; p++) {
				phases[p] = rand(0, 360);
				targets[p] = rand(0, 360);
			}
			const anchors = ANCHORS.map(() => ({ x: 0, y: rand(0, this.variant.seedMax), z: 0 }));
			return { phases, targets, anchors };
		});
	}

	/**
	 * Step every phase walk of a column toward its target (2–3° per game tick).
	 * @param {{phases: Float32Array, targets: Float32Array}} column
	 * @param {number} stepScale
	 */
	walkPhases(column, stepScale) {
		for (let i = 0; i < 16; i++) {
			const current = column.phases[i];
			const target = column.targets[i];
			const diff = ((target - current + 540) % 360) - 180;
			const step = (2 + this.rng()) * stepScale;
			if (Math.abs(diff) <= step) {
				column.phases[i] = target;
				column.targets[i] = this.rng() * 360;
			} else {
				let angle = (current + Math.sign(diff) * step) % 360;
				if (angle < 0) {
					angle += 360;
				}
				column.phases[i] = angle;
			}
		}
	}

	/**
	 * Jitter (below ground only), fall, and respawn an anchor.
	 * @param {Object} column
	 * @param {number} ai
	 * @param {number} stepScale
	 */
	moveAnchor(column, ai, stepScale) {
		const anchor = column.anchors[ai];
		const { kx, kz, pa, pb } = ANCHORS[ai];
		if (anchor.y < 0) {
			anchor.x += kx * BUBBLE_DRIFT * Math.sin(column.phases[pa] * DEG_TO_RAD) * stepScale;
			anchor.z += kz * BUBBLE_DRIFT * Math.sin(column.phases[pb] * DEG_TO_RAD) * stepScale;
		}
		anchor.y -= this.variant.fallSpeed * stepScale;
		if (anchor.y < this.variant.resetY) {
			anchor.x = 0;
			anchor.z = 0;
			anchor.y = this.rng() * this.variant.seedMax;
			column.phases[pa] = this.rng() * 360;
			column.targets[pa] = this.rng() * 360;
			column.phases[pb] = this.rng() * 360;
			column.targets[pb] = this.rng() * 360;
		}
	}

	/**
	 * The records of one frame.
	 * @param {number} tick
	 * @param {Object} frameState
	 * @param {(x: number, y: number) => number} frameState.heightAt  terrain cell height
	 * @param {[number, number]} frameState.cameraAngle  [pitch, yaw] degrees
	 * @param {{use: boolean}} [frameState.sceneFog]
	 * @param {import('../records/RecordStream.js').RecordStream} [stream]  also appended to, when given
	 * @returns {Readonly<import('../records/EffectDraw.js').EffectDraw>[]}
	 */
	frame(tick, { heightAt, cameraAngle, sceneFog }, stream) {
		const source = this.follow ? this.follow.position : this.position;
		const base = [source[0] + 0.5, -heightAt(source[0], source[1]) - BUBBLE_BASE_LIFT, source[1] + 0.5];
		const beta = ((360 - cameraAngle[0] + 90) % 360) * DEG_TO_RAD;
		const alpha = ((360 - cameraAngle[1]) % 360) * DEG_TO_RAD;
		const radius = this.variant.radius * GAME_TO_WORLD * BUBBLE_SCALE;
		// camera-facing corner offsets: R_y(alpha) · R_x(beta) of the scaled unit square
		const corners = CORNERS.map(([cx, cy]) => {
			const lx = cx * radius;
			const lz = cy * radius;
			const rz = lz * Math.cos(beta);
			return [
				lx * Math.cos(alpha) + rz * Math.sin(alpha),
				-lz * Math.sin(beta),
				-lx * Math.sin(alpha) + rz * Math.cos(alpha)
			];
		});

		const dt = Math.min(tick - (this.lastTick || tick), MAX_FRAME_DT);
		this.lastTick = tick;
		const stepScale = dt / GAME_TICK_MS;
		const fog = Boolean(sceneFog && sceneFog.use);
		const out = [];

		this.columns.forEach((column, ec) => {
			this.walkPhases(column, stepScale);
			column.anchors.forEach((anchor, ai) => {
				this.moveAnchor(column, ai, stepScale);
				// above the ground line (positive y) is not drawn yet
				if (anchor.y > 0) {
					return;
				}
				const a = level99BubbleAlpha(anchor.y);
				if (a <= 0) {
					return;
				}
				const points = corners.map(c => [
					base[0] + anchor.x * GAME_TO_WORLD + c[0],
					base[1] + anchor.y * GAME_TO_WORLD + c[1],
					base[2] + anchor.z * GAME_TO_WORLD + c[2]
				]);
				const quad = QUAD_ORDER.flatMap(([p, u, v]) => [...points[p], u, v]);
				for (let pass = 0; pass < this.variant.passCount; pass++) {
					/** @type {Level99BubbleParams} */
					const params = {
						column: ec,
						anchor: ai,
						pass,
						quad: quad.slice(),
						zIndex: 0.01 + ec * 0.002 + ai * 0.0001 + pass * 0.00005,
						vertexCount: BUBBLE_VERTEX_COUNT
					};
					const record = createEffectDraw({
						family: 'level99Bubble',
						pass: this.pass,
						texture: this.texture,
						position: base.slice(),
						color: [...this.variant.color, a],
						blend: BLEND_ADDITIVE,
						depthTest: true,
						depthWrite: false,
						depthCorrection: false,
						fog,
						params
					});
					stream?.effect(record);
					out.push(record);
				}
			});
		});
		return out;
	}
}
