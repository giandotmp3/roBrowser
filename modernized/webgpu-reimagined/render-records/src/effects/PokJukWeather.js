import { defaultRng } from '../util/injectables.js';
import { BLEND_ADDITIVE } from '../records/blend.js';
import { NEUTRAL_SPRITE_STATE, WEATHER_DEPTH, weatherSpriteDraw } from './weatherSprites.js';

/** Procedural 6×6 radial-gradient particle texture (white, alpha 1 → 0.8 → 0). */
export const POKJUK_TEXTURE = 'pokjuk:particle';
export const POKJUK_TEXTURE_DESC = Object.freeze({
	key: POKJUK_TEXTURE,
	width: 6,
	height: 6,
	radialGradient: Object.freeze({
		center: 3,
		radius: 2,
		stops: Object.freeze([
			[0, [255, 255, 255, 1]],
			[0.7, [255, 255, 255, 0.8]],
			[1, [255, 255, 255, 0]]
		])
	})
});

/** Launch sound (effect/폭죽.wav), played when a firework's process reaches 1. */
export const POKJUK_SOUND = 'effect/\xc6\xf8\xc1\xd7.wav';

const EXPLOSION_ALTITUDE = 8.0;
const PARTICLE_SIZE = 6;
const FIRE_LIFE_MS = 50;
const EXPLOSION_LIFE_MS = 1000;
const STEP_MS = 16;

/** Particle colours by colorType (−1: white gunpowder). */
const COLORS = Object.freeze({
	0: [100, 160, 255],
	1: [255, 100, 100],
	2: [100, 255, 100],
	3: [255, 255, 130],
	4: [255, 130, 255]
});
const WHITE = [255, 255, 255];

/**
 * EF_POKJUK fireworks map weather (R-EFX-016) into SpriteDraw records. Replaces legacy
 * Renderer/Effects/PokJukWeatherEffect.js.
 *
 * - 1–3 fireworks around the player (none without a player), launched 600–999 steps
 *   (+100 per index) of 16 ms later; the simulation runs in fixed 16 ms steps of the
 *   elapsed time (Δt ≤ 250 per frame).
 * - Ascent: +0.04 z per step with a late arc; explodes 8 cells above its start into 30
 *   gunpowder particles, then every 50 ms for 1 s adds 15 coloured + 60 gunpowder ones.
 *   Particles move by their velocity, gravity 0.003, fade 3 (coloured) / 6 (gunpowder) of
 *   255 per step. A spent firework is replaced by a new one around the current player.
 * - Every live firework / particle draws a 6×6 sprite-px billboard of its colour and
 *   alpha/255 (each particle's own size is unused).
 * - Discrepancy #51 [FLAG, fixed]: fireworks draw additive (SRC_ALPHA, ONE), as the pass
 *   intends. Legacy's render(false) re-sets normal alpha before every particle, so its
 *   additive blendFunc never reaches a draw.
 * - Discrepancies #47/#52 [FLAG, fixed]: every record is self-contained. Angle, offset,
 *   shadow, palette, depth bias and the zIndex counter are the values of a fresh
 *   SpriteRenderer state (NEUTRAL_SPRITE_STATE; zIndex counts from 0 each frame). Legacy
 *   sets only position, colour, size and texture and inherits the rest from whatever the
 *   previous SpriteRenderer user left.
 */
export class PokJukWeather {
	/**
	 * @param {{player: ArrayLike<number>|null}} inst
	 * @param {{rng?: function, playSound?: function}} [ports]
	 */
	constructor({ player }, { rng = defaultRng, playSound = () => {} } = {}) {
		this._rng = rng;
		this._playSound = playSound;
		this.fireworks = [];
		this.lastTick = 0;
		this.accumTime = 0;
		this.finished = false;
		if (!player) {
			return;
		}
		const count = Math.floor(rng() * 3) + 1;
		for (let ec = 0; ec < count; ec++) {
			const firework = this._create(player);
			firework.process -= ec * 100;
			this.fireworks.push(firework);
		}
	}

	_create(player) {
		const rng = this._rng;
		const process = -(600 + Math.floor(rng() * 400));
		const posNow = [player[0] + (rng() * 20 - 10), player[1] + (rng() * 20 - 10), player[2]];
		rng(); // horizontal drift x (unused)
		rng(); // horizontal drift y (unused)
		const colorType = Math.floor(rng() * 5);
		const arcDirection = rng() > 0.5 ? 1 : -1;
		const arcAmplitude = 3 + rng() * 2;
		return {
			process,
			posNow,
			startAlt: player[2],
			alpha: 0,
			colorType,
			state: 0,
			particles: [],
			arcDirection,
			arcAmplitude,
			explosionTimer: 0,
			lastWaveTime: 0
		};
	}

	_addParticle(fw, isGunpowder, colorType) {
		const rng = this._rng;
		const phi = rng() * Math.PI * 2;
		const theta = rng() * Math.PI;
		const speed = isGunpowder ? 0.02 + rng() * 0.04 : 0.08 + rng() * 0.07;
		const zOffset = isGunpowder ? 0.5 : 0;
		if (!isGunpowder) {
			rng(); // particle size (unused by the draw)
		}
		fw.particles.push({
			pos: [fw.posNow[0], fw.posNow[1], fw.posNow[2] + zOffset],
			vel: [
				Math.sin(theta) * Math.cos(phi) * speed,
				Math.sin(theta) * Math.sin(phi) * speed,
				Math.cos(theta) * speed
			],
			alpha: 255,
			colorType: isGunpowder ? -1 : colorType,
			fadeSpeed: isGunpowder ? 6 : 3
		});
	}

	_step(fw, player) {
		fw.process++;
		if (fw.process === 1) {
			this._playSound(POKJUK_SOUND);
		}
		if (fw.process <= 0) {
			return;
		}
		if (fw.state === 0) {
			fw.posNow[2] += 0.04;
			const ascent = Math.max(0, Math.min(1, (fw.posNow[2] - fw.startAlt) / EXPLOSION_ALTITUDE));
			const arc = Math.pow(Math.max(0, (ascent - 0.3) / 0.7), 2);
			fw.posNow[0] += arc * fw.arcAmplitude * fw.arcDirection * 0.02;
			fw.alpha = Math.floor(Math.min(ascent * 255 * 2, 255));
			if (fw.posNow[2] - fw.startAlt > EXPLOSION_ALTITUDE) {
				fw.state = 1;
				fw.explosionTimer = 0;
				fw.lastWaveTime = -50;
				for (let p = 0; p < 30; p++) {
					this._addParticle(fw, true);
				}
			}
			return;
		}
		fw.explosionTimer += STEP_MS;
		if (fw.explosionTimer < EXPLOSION_LIFE_MS && fw.explosionTimer - fw.lastWaveTime >= FIRE_LIFE_MS) {
			const colorType = Math.floor(this._rng() * 5);
			for (let i = 0; i < 15; i++) {
				this._addParticle(fw, false, colorType);
			}
			for (let i = 0; i < 60; i++) {
				this._addParticle(fw, true, colorType);
			}
			fw.lastWaveTime = fw.explosionTimer;
		}
		let active = 0;
		for (const p of fw.particles) {
			if (p.alpha <= 0) {
				continue;
			}
			p.pos[0] += p.vel[0];
			p.pos[1] += p.vel[1];
			p.pos[2] += p.vel[2];
			p.vel[2] -= 0.003;
			p.alpha -= p.fadeSpeed || 2;
			active++;
		}
		if (active === 0 && fw.explosionTimer > EXPLOSION_LIFE_MS) {
			Object.assign(fw, this._create(player));
		}
	}

	/** startOrRestart on the live instance (same map) keeps it as is. */
	restart() {}

	/** Fireworks run until the scene stops them; stop drops them at once. */
	stop() {
		this.finished = true;
	}

	/**
	 * @param {number} tick
	 * @param {Object} ctx
	 * @param {ArrayLike<number>|null} ctx.player  read when a spent firework is replaced
	 * @returns {Object[]} SpriteDraw records
	 */
	frame(tick, { player }) {
		if (this.finished) {
			return [];
		}
		const dt = Math.min(tick - (this.lastTick || tick), 250);
		this.lastTick = tick;
		this.accumTime = this.accumTime + dt;
		while (this.accumTime >= STEP_MS) {
			this.accumTime -= STEP_MS;
			for (const fw of this.fireworks) {
				this._step(fw, player);
			}
		}

		const out = [];
		const state = NEUTRAL_SPRITE_STATE;
		let zIndex = state.zIndex;
		const draw = (pos, alpha, rgb) => {
			const color = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, alpha / 255];
			if (!color[3]) {
				return;
			}
			out.push(
				weatherSpriteDraw({
					texture: POKJUK_TEXTURE,
					palette: state.palette,
					paletteSize: [state.paletteSize[0], state.paletteSize[1]],
					position: [pos[0], pos[1], pos[2]],
					offset: [state.offset[0], state.offset[1]],
					size: [PARTICLE_SIZE, PARTICLE_SIZE],
					xSize: 5,
					ySize: 5,
					angle: state.angle,
					color,
					shadowFactor: state.shadowFactor,
					zIndex: zIndex++,
					depthBias: state.depthBias,
					blend: BLEND_ADDITIVE,
					...WEATHER_DEPTH
				})
			);
		};
		for (const fw of this.fireworks) {
			if (fw.process <= 0) {
				continue;
			}
			if (fw.state === 0) {
				draw(fw.posNow, fw.alpha, WHITE);
				continue;
			}
			for (const p of fw.particles) {
				if (p.alpha > 0) {
					draw(p.pos, p.alpha, COLORS[p.colorType] ?? WHITE);
				}
			}
		}
		return out;
	}
}
