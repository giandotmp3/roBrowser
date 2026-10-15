import { defaultRng } from '../util/injectables.js';
import { RAG_TICK_MS, WEATHER_PARAMS } from './weather.js';
import { actFrameDraws, remainingMs } from './weatherSprites.js';

const SNOW = WEATHER_PARAMS.snow;

/** stop() leaves a 1000 rag-tick tail before the effect ends. */
export const WEATHER_FADEOUT_TAIL_MS = 1000 * RAG_TICK_MS;
/** Emission stops 160 rag ticks before the end. */
export const WEATHER_EMIT_STOP_BEFORE_END_MS = 160 * RAG_TICK_MS;

/** Snow sprite (data/sprite/이팩트/ef_snow.spr / .act). */
export const SNOW_SPRITE_PATH = 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/ef_snow';

// last fifth of life (legacy (LIFE * 4) / 5, kept for bit-identical alpha)
const FLAKE_FADEOUT_START_MS = (SNOW.lifeMs * 4) / 5;
const FALL_PER_MS = SNOW.fallPerTick / RAG_TICK_MS;

/**
 * EF_SNOW weather (R-EFX-017) into SpriteDraw records. Replaces legacy
 * Renderer/Effects/SnowWeather.js (one live instance, owned by the scene).
 *
 * Per frame, in legacy order:
 * - no player: nothing happens (no emission, no fall);
 * - at endTick (after stop()) the effect finishes without drawing;
 * - while more than 160 rag ticks remain, 2 flakes are emitted per elapsed 25 ms rag tick
 *   (none once stopping, but the emission clock still advances);
 * - flakes are walked newest first: expired ones (8 s) are dropped, the rest fall
 *   0.1 cell per rag tick, fade in over 250 ms and out over the last fifth, and draw
 *   the ACT action 0 frame of their age (delay `|| 150`).
 * Flakes spawn within 60 cells of the player at ground + 18–22, scale 0.5–0.8.
 * Draws: no depth test or write, depth correction off, normal blend, zIndex from 0 per flake.
 */
export class SnowWeather {
	/**
	 * @param {{startTick: number, endTick?: number}} inst
	 * @param {{rng?: function}} [ports]
	 */
	constructor({ startTick, endTick = -1 }, { rng = defaultRng } = {}) {
		this.startTick = startTick;
		this.endTick = endTick;
		this.lastEmitTick = startTick;
		this.stopping = false;
		this.flakes = [];
		this.finished = false;
		this._rng = rng;
	}

	/**
	 * startOrRestart on the live instance: revive a fading snow.
	 * @param {number} now
	 */
	restart(now) {
		this.stopping = false;
		if (this.endTick > 0) {
			this.endTick = -1;
			this.lastEmitTick = now;
		}
	}

	/**
	 * Fade out: the effect ends FADEOUT_TAIL after now and emits no more flakes.
	 * @param {number} now
	 */
	stop(now) {
		if (this.endTick === -1) {
			this.endTick = now + WEATHER_FADEOUT_TAIL_MS;
			this.stopping = true;
		}
	}

	/**
	 * @param {number} tick
	 * @param {ArrayLike<number>} player
	 * @param {function} cellHeight (x, y) => ground z
	 */
	_spawn(tick, player, cellHeight) {
		const rng = this._rng;
		const theta = rng() * Math.PI * 2;
		const radius = rng() * SNOW.radius;
		const x = player[0] + Math.cos(theta) * radius;
		const y = player[1] + Math.sin(theta) * radius;
		const groundZ = cellHeight(x, y);
		const spawnHeight = SNOW.spawnHeight[0] + rng() * (SNOW.spawnHeight[1] - SNOW.spawnHeight[0]);
		this.flakes.push({ spawnTick: tick, x, y, z: groundZ + spawnHeight, size: 0.5 + rng() * 0.3, lastTick: 0 });
	}

	/**
	 * @param {number} tick
	 * @param {Object} ctx
	 * @param {ArrayLike<number>|null} ctx.player  local player position (Session.Entity)
	 * @param {function} ctx.cellHeight  (x, y) => ground z (R-MAP-023)
	 * @param {{spr: Object, act: Object}|null} ctx.sprite  loaded snow sprite, or null
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
		if (remaining > WEATHER_EMIT_STOP_BEFORE_END_MS) {
			const ticksToEmit = Math.floor((tick - this.lastEmitTick) / RAG_TICK_MS);
			if (ticksToEmit > 0) {
				for (let i = 0; i < ticksToEmit && !this.stopping; i++) {
					const emitTick = this.lastEmitTick + i * RAG_TICK_MS;
					for (let n = 0; n < SNOW.perTick; n++) {
						this._spawn(emitTick, player, cellHeight);
					}
				}
				this.lastEmitTick += ticksToEmit * RAG_TICK_MS;
			}
		}

		const { spr, act } = sprite;
		const action = act.actions[0];
		const frameDelay = Math.max(action.delay || 150, 1);
		const frameCount = action.animations.length || 1;
		const out = [];
		for (let f = this.flakes.length - 1; f >= 0; f--) {
			const flake = this.flakes[f];
			const age = tick - flake.spawnTick;
			if (age >= SNOW.lifeMs) {
				this.flakes.splice(f, 1);
				continue;
			}
			flake.z -= FALL_PER_MS * (tick - (flake.lastTick || flake.spawnTick));
			flake.lastTick = tick;

			let alpha = 1.0;
			if (age < SNOW.fadeInMs) {
				alpha = age / SNOW.fadeInMs;
			} else if (age > FLAKE_FADEOUT_START_MS) {
				alpha = Math.max(0, 1 - (age - FLAKE_FADEOUT_START_MS) / (SNOW.lifeMs - FLAKE_FADEOUT_START_MS));
			}
			const animation = action.animations[Math.floor(age / frameDelay) % frameCount];
			out.push(
				...actFrameDraws({
					spr,
					layers: animation.layers,
					sizeScale: flake.size,
					alpha,
					position: [flake.x, flake.y, flake.z]
				})
			);
		}
		return out;
	}
}
