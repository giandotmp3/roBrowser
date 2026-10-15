import { defaultRng } from '../util/injectables.js';
import { RAG_TICK_MS, WEATHER_PARAMS, weatherEffectId } from './weather.js';
import { actFrameDraws, remainingMs } from './weatherSprites.js';
import { WEATHER_EMIT_STOP_BEFORE_END_MS, WEATHER_FADEOUT_TAIL_MS } from './SnowWeather.js';

const SAKURA = WEATHER_PARAMS.sakura;

/** EffectConst ids: EF_SAKURA petals, EF_MAPLE leaves. */
export const EF_SAKURA = 163;
export const EF_MAPLE = 333;

/** Sprites (data/sprite/이팩트/sakura01, data/sprite/이팩트/단풍). */
export const SAKURA_SPRITE_PATH = 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/sakura01';
export const MAPLE_SPRITE_PATH = 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/\xb4\xdc\xc7\xb3';

const FADEIN_MS = 20 * RAG_TICK_MS;
const FADEOUT_START_MS = (SAKURA.lifeMs * 4) / 5;
const RADIUS = 70;
const SPAWN_HEIGHT = [32, 42];

/**
 * Sway of one axis (legacy CEffectPrim::PrimSakura port): climb 3° a frame towards the
 * target (cap 359) or drop 2° (floor 0); on reaching it pick a new target below
 * (rng·current) or above (359 − rng·current).
 *
 * @param {number} current degrees
 * @param {number} target degrees
 * @param {function} rng
 * @returns {{c: number, t: number}}
 */
export function sakuraSway(current, target, rng) {
	if (target > current) {
		current += 3;
		if (current > 359) {
			current = 359;
		}
		if (current > target) {
			target = rng() * current;
		}
	} else {
		current -= 2;
		if (current < 0) {
			current = 0;
		}
		if (current <= target) {
			target = 359 - rng() * current;
		}
	}
	return { c: current, t: target };
}

/**
 * EF_SAKURA / EF_MAPLE weather (R-EFX-017) into SpriteDraw records. Replaces legacy
 * Renderer/Effects/SakuraWeatherEffect.js.
 *
 * - One leaf every 150 ms while more than 160 rag ticks remain (none once stopping; the
 *   emission clock still advances); each lives 15 s.
 * - Leaves spawn within 70 cells of the player at ground + 32–42, scale 0.5–0.8. Fall
 *   speed per rag tick: sakura (2 + 2·rng)·0.1·0.5, maple (2 + 4·rng)·0.03·0.5.
 * - Every frame (not every rag tick) both sway angles step once; position drifts by
 *   0.1·factor·sin(angle) per elapsed rag tick (sakura 0.24 / 0.3, maple 0.12 / 0.15).
 * - Alpha: fade in over 500 ms, out over the last fifth; sakura is capped at 0.5 only
 *   during the fades (full 1.0 in between), maple at 1.
 * Draws: no depth test or write, depth correction off, normal blend.
 */
export class SakuraWeather {
	/**
	 * @param {{effectId?: number, effectID?: number, startTick: number, endTick?: number}} inst
	 *        either id spelling (#60: map-flag 'leaves' passes effectId, the EffectTable effectID)
	 * @param {{rng?: function}} [ports]
	 */
	constructor(inst, { rng = defaultRng } = {}) {
		const { startTick, endTick = -1 } = inst;
		const effectId = weatherEffectId(inst);
		this.effectId = effectId;
		this.isMaple = effectId === EF_MAPLE;
		this.startTick = startTick;
		this.endTick = endTick;
		this.lastEmitTick = startTick;
		this.stopping = false;
		this.leaves = [];
		this.finished = false;
		this._rng = rng;
	}

	/** Sprite path of this weather (without extension). */
	get spritePath() {
		return this.isMaple ? MAPLE_SPRITE_PATH : SAKURA_SPRITE_PATH;
	}

	/**
	 * startOrRestart on the live instance of the same kind: revive a fading one.
	 * @param {number} now
	 */
	restart(now) {
		this.stopping = false;
		if (this.endTick > 0) {
			this.endTick = -1;
			this.lastEmitTick = now;
		}
	}

	/** @param {number} now */
	stop(now) {
		if (this.endTick === -1) {
			this.endTick = now + WEATHER_FADEOUT_TAIL_MS;
			this.stopping = true;
		}
	}

	_spawn(tick, player, cellHeight) {
		const rng = this._rng;
		const theta = rng() * Math.PI * 2;
		const radius = rng() * RADIUS;
		const x = player[0] + Math.cos(theta) * radius;
		const y = player[1] + Math.sin(theta) * radius;
		const groundZ = cellHeight(x, y);
		const spawnHeight = SPAWN_HEIGHT[0] + rng() * (SPAWN_HEIGHT[1] - SPAWN_HEIGHT[0]);
		const fallSpeedBase = this.isMaple ? (2 + rng() * 4) * 0.03 : (2 + rng() * 2) * 0.1;
		const size = 0.5 + rng() * 0.3;
		const angX = rng() * 360;
		const targetX = rng() * 360;
		const angY = rng() * 360;
		const targetY = rng() * 360;
		this.leaves.push({
			spawnTick: tick,
			x,
			y,
			z: groundZ + spawnHeight,
			size,
			speed: fallSpeedBase * 0.5,
			swayFacX: this.isMaple ? 0.12 : 0.24,
			swayFacY: this.isMaple ? 0.15 : 0.3,
			angX,
			targetX,
			angY,
			targetY,
			lastTick: tick
		});
	}

	/**
	 * @param {number} tick
	 * @param {Object} ctx
	 * @param {ArrayLike<number>|null} ctx.player
	 * @param {function} ctx.cellHeight
	 * @param {{spr: Object, act: Object}|null} ctx.sprite  loaded sprite of `spritePath`
	 * @returns {Object[]} SpriteDraw records
	 */
	frame(tick, { player, cellHeight, sprite }) {
		if (!player || !sprite || !sprite.spr || !sprite.act) {
			return [];
		}
		const remaining = remainingMs(this.endTick, tick);
		if (remaining <= 0) {
			this.finished = true;
			return [];
		}
		if (remaining > WEATHER_EMIT_STOP_BEFORE_END_MS && tick - this.lastEmitTick >= SAKURA.spawnIntervalMs) {
			if (!this.stopping) {
				this._spawn(tick, player, cellHeight);
			}
			this.lastEmitTick = tick;
		}

		const { spr, act } = sprite;
		const action = act.actions[0];
		const frameDelay = Math.max(action.delay || 150, 1);
		const frameCount = action.animations.length || 1;
		const alphaCap = this.isMaple ? 1.0 : 0.5;
		const rng = this._rng;
		const out = [];
		for (let f = this.leaves.length - 1; f >= 0; f--) {
			const leaf = this.leaves[f];
			const age = tick - leaf.spawnTick;
			if (age >= SAKURA.lifeMs) {
				this.leaves.splice(f, 1);
				continue;
			}
			const resX = sakuraSway(leaf.angX, leaf.targetX, rng);
			leaf.angX = resX.c;
			leaf.targetX = resX.t;
			const resY = sakuraSway(leaf.angY, leaf.targetY, rng);
			leaf.angY = resY.c;
			leaf.targetY = resY.t;

			const dt = tick - leaf.lastTick;
			leaf.z -= leaf.speed * (dt / RAG_TICK_MS);
			const driftX = leaf.swayFacX * Math.sin((leaf.angX * Math.PI) / 180);
			const driftY = leaf.swayFacY * Math.sin((leaf.angY * Math.PI) / 180);
			const driftScale = dt / RAG_TICK_MS;
			leaf.x += driftX * 0.1 * driftScale;
			leaf.y += driftY * 0.1 * driftScale;
			leaf.lastTick = tick;

			let alpha = 1.0;
			if (age < FADEIN_MS) {
				alpha = (age / FADEIN_MS) * alphaCap;
			} else if (age > FADEOUT_START_MS) {
				alpha = Math.max(0, (1 - (age - FADEOUT_START_MS) / (SAKURA.lifeMs - FADEOUT_START_MS)) * alphaCap);
			}
			const animation = action.animations[Math.floor(age / frameDelay) % frameCount];
			out.push(
				...actFrameDraws({
					spr,
					layers: animation.layers,
					sizeScale: leaf.size,
					alpha,
					position: [leaf.x, leaf.y, leaf.z]
				})
			);
		}
		return out;
	}
}
