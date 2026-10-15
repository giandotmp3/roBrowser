import { defaultRng } from '../util/injectables.js';
import { NEUTRAL_SPRITE_STATE, weatherSpriteDraw } from './weatherSprites.js';
import { weatherEffectId } from './weather.js';

/**
 * Cloud weather profiles by EffectConst id (EF_CLOUD … EF_CLOUD8). Unknown ids use 229.
 */
export const CLOUD_WEATHER_PROFILES = Object.freeze({
	229: Object.freeze({
		maxClouds: 40,
		overlay: true,
		speed: 0.05,
		area: 35,
		zIndex: -125,
		cloudColor: [1.0, 1.0, 1.0, 0.18]
	}),
	230: Object.freeze({
		maxClouds: 60,
		overlay: false,
		speed: 0.05,
		area: 35,
		zIndex: 40,
		cloudColor: [1.0, 1.0, 1.0, 0.58]
	}),
	233: Object.freeze({
		maxClouds: 40,
		overlay: true,
		speed: 0.015,
		area: 45,
		zIndex: 1,
		cloudColor: [0.47, 0.43, 0.39, 0.78]
	}),
	515: Object.freeze({
		maxClouds: 80,
		overlay: false,
		speed: 0.05,
		area: 35,
		zIndex: -125,
		cloudColor: [1.0, 1.0, 1.0, 0.58]
	}),
	516: Object.freeze({
		maxClouds: 80,
		overlay: false,
		speed: 0.2,
		area: 50,
		zIndex: 40,
		cloudColor: [0.88, 0.83, 0.76, 0.7]
	}),
	592: Object.freeze({
		maxClouds: 80,
		overlay: false,
		speed: 0.035,
		area: 35,
		zIndex: 40,
		cloudColor: [1.0, 1.0, 1.0, 0.58]
	}),
	697: Object.freeze({
		maxClouds: 80,
		overlay: false,
		speed: 0.05,
		area: 35,
		zIndex: 40,
		cloudColor: [0.2, 0.31, 0.63, 0.55]
	}),
	698: Object.freeze({
		maxClouds: 80,
		overlay: false,
		speed: 0.05,
		area: 35,
		zIndex: 40,
		cloudColor: [1.0, 0.55, 0.2, 0.62]
	})
});

/** stop() ends cloud weather 2 s later (no fade). */
export const CLOUD_WEATHER_TAIL_MS = 2000;

/**
 * Cloud textures of a profile: EF_CLOUD3 uses fog1–3, the others cloud4 / cloud1 / cloud2.
 * @param {number} effectId
 * @returns {string[]} texture paths
 */
export function cloudWeatherTextures(effectId) {
	const files = effectId === 233 ? ['fog1', 'fog2', 'fog3'] : ['cloud4', 'cloud1', 'cloud2'];
	return files.map(f => `data/texture/effect/${f}.tga`);
}

/**
 * EF_CLOUD… weather (R-EFX-016) into SpriteDraw records. Replaces legacy
 * Renderer/Effects/CloudWeatherEffect.js.
 *
 * - maxClouds billboards of 1000×1000 sprite px tinted with the profile colour, zIndex of
 *   the profile. Texture index = rng·3 | 0 over all three textures (discrepancy #61 fix;
 *   legacy's rng·(3 − 1) | 0 never picks the third). Clouds are then sorted by texture.
 * - Clouds spawn within ±area (integer) cells of the player at z −10 and drift by
 *   (2·rng − 1)·speed per 25 ms (vertical (0.1·rng − 0.05)·speed), Δt capped at 250.
 *   Positions and directions are float32 (gl-matrix vec3).
 * - The first batch is backdated 2 s with a death in the next 0–8 s; respawns happen
 *   2 s after death (a respawn frame does not draw). Alpha: min(age/1 s, colour alpha)
 *   while appearing, colour alpha while alive, colour alpha − Δ/2 s once dead (goes
 *   negative before the respawn; negative alpha is truthy and still drawn).
 * - Overlay profiles draw without depth test but with depth correction; the others with
 *   depth test and no depth correction. No depth write. Blend: the pass's (normal).
 * - stop(): the effect ends 2 s later, abruptly.
 */
export class CloudWeather {
	/**
	 * @param {{effectId?: number, effectID?: number, startTick: number, endTick?: number}} inst
	 *        either id spelling (#60: EF_CLOUD2 from the EffectTable passes effectID)
	 * @param {{rng?: function}} [ports]
	 */
	constructor(inst, { rng = defaultRng } = {}) {
		const { startTick, endTick = -1 } = inst;
		const effectId = weatherEffectId(inst);
		this.effectId = effectId;
		this.profile = CLOUD_WEATHER_PROFILES[effectId] || CLOUD_WEATHER_PROFILES[229];
		this.startTick = startTick;
		this.endTick = endTick;
		this.textures = cloudWeatherTextures(effectId);
		this.clouds = [];
		this.finished = false;
		this._rng = rng;
	}

	/**
	 * Place the clouds around the player (legacy init → setUpCloudData).
	 * @param {number} now
	 * @param {ArrayLike<number>} player
	 */
	setUp(now, player) {
		const rng = this._rng;
		for (let i = 0; i < this.profile.maxClouds; i++) {
			if (!this.clouds[i]) {
				this.clouds[i] = {
					position: new Float32Array(3),
					direction: new Float32Array(3),
					bornTick: 0,
					deathTick: 0,
					lastTick: 0,
					sprite: 0
				};
			}
			const cloud = this.clouds[i];
			this._respawn(cloud, now, player);
			cloud.sprite = this.textureIndex(rng());
			cloud.deathTick = cloud.bornTick + rng() * 8000;
			cloud.bornTick -= 2000;
		}
		// stable sort by texture
		this.clouds.sort((a, b) => a.sprite - b.sprite);
	}

	/**
	 * Discrepancy #61 [FLAG, fixed]: texture of a new cloud from one random draw r in [0, 1),
	 * over all the profile's textures. Legacy's r·(3 − 1) | 0 never picks the third one.
	 * @param {number} r
	 * @returns {number}
	 */
	textureIndex(r) {
		return (r * this.textures.length) | 0;
	}

	_respawn(cloud, now, player) {
		const rng = this._rng;
		const { area, speed } = this.profile;
		cloud.position[0] = player[0] + ((rng() * area) | 0) * (rng() > 0.5 ? 1 : -1);
		cloud.position[1] = player[1] + ((rng() * area) | 0) * (rng() > 0.5 ? 1 : -1);
		cloud.position[2] = -10;
		cloud.direction[0] = (rng() * 2 - 1) * speed;
		cloud.direction[1] = (rng() * 2 - 1) * speed;
		cloud.direction[2] = (rng() * 0.1 - 0.05) * speed;
		cloud.bornTick = cloud.deathTick ? cloud.deathTick + 2000 : now;
		cloud.deathTick = cloud.bornTick + 6000;
		cloud.lastTick = cloud.bornTick;
	}

	/** startOrRestart on the live instance: cancel a pending stop. */
	restart() {
		if (this.endTick > 0) {
			this.endTick = -1;
		}
	}

	/** @param {number} now */
	stop(now) {
		if (this.endTick === -1) {
			this.endTick = now + CLOUD_WEATHER_TAIL_MS;
		}
	}

	/**
	 * @param {number} tick
	 * @param {{player: ArrayLike<number>|null}} ctx  player read only when a cloud respawns
	 * @returns {Object[]} SpriteDraw records
	 */
	frame(tick, { player }) {
		if (this.endTick > 0 && tick >= this.endTick) {
			this.finished = true;
			return [];
		}
		const { overlay, zIndex, cloudColor } = this.profile;
		const out = [];
		for (const cloud of this.clouds) {
			let opacity;
			if (cloud.bornTick + 1000 > tick) {
				opacity = Math.min((tick - cloud.bornTick) / 1000, cloudColor[3]);
			} else if (cloud.deathTick + 2000 < tick) {
				this._respawn(cloud, tick, player);
				opacity = 0.0;
			} else if (cloud.deathTick < tick) {
				opacity = cloudColor[3] - (tick - cloud.deathTick) / 2000;
			} else {
				opacity = cloudColor[3];
			}
			const dt = Math.min(tick - (cloud.lastTick || cloud.bornTick), 250);
			cloud.lastTick = tick;
			for (let k = 0; k < 3; k++) {
				cloud.position[k] = cloud.position[k] + cloud.direction[k] * (dt / 25);
			}
			if (!opacity) {
				continue;
			}
			out.push(
				weatherSpriteDraw({
					texture: this.textures[cloud.sprite],
					position: Array.from(cloud.position),
					offset: [0, 0],
					size: [1000, 1000],
					xSize: NEUTRAL_SPRITE_STATE.xSize,
					ySize: NEUTRAL_SPRITE_STATE.ySize,
					angle: 0,
					color: [cloudColor[0], cloudColor[1], cloudColor[2], opacity],
					shadowFactor: 1,
					zIndex,
					depthBias: 0,
					depthTest: !overlay,
					depthWrite: false,
					depthCorrection: overlay
				})
			);
		}
		return out;
	}
}
