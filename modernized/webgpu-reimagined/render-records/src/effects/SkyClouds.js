import { defaultClock, defaultRng } from '../util/injectables.js';
import { weatherSpriteDraw } from './weatherSprites.js';

/** R-MAP-022: number of sky clouds. */
export const SKY_CLOUD_COUNT = 150;

/** Cloud textures cloud1–7.tga (index 0..6). */
export const SKY_CLOUD_TEXTURES = Object.freeze(
	Array.from({ length: 7 }, (_, i) => `data/texture/effect/cloud${i + 1}.tga`)
);

/** Opaque black clear of a map without a sky entry (R-CTX-009). */
export const BLACK_CLEAR = Object.freeze([0, 0, 0, 1]);

/**
 * Map sky (R-CTX-009 clear colour, R-MAP-022 clouds) into a clear colour and SpriteDraw
 * records. Replaces legacy Renderer/Effects/Sky.js. One instance lives for the session:
 * like legacy's module state, the cloud list and the texture slots persist across maps.
 *
 * - init(entry): no entry → black clear, no clouds. Otherwise clear = skyColor and clouds
 *   show when the entry has a cloudColor. The 7 textures are requested once, the first
 *   time a map shows clouds (8 texture slots, the 8th never filled).
 * - setUp(player): every cloud respawns around the player, picks texture
 *   rng·(slots − 1) | 0 (0 when no map ever showed clouds), gets a death 0–8 s after its
 *   birth and is backdated 2 s; the list is then stably sorted by texture.
 *   A cloud's birth is now() only the very first time; afterwards it is its previous
 *   death + 2 s, also across maps (stale clouds respawn frame after frame until they
 *   catch up with the clock, invisible meanwhile).
 * - frame(tick): alpha (tick − born)/1 s while appearing, 1 while alive, 1 − Δ/2 s after
 *   death; 2 s after death the cloud respawns (that frame draws nothing). Positions move
 *   by direction · Δt/25 (Δt ≤ 250) in float32. Each draw: 500×500 sprite px, colour
 *   cloudColor (rgb) with that alpha, zIndex 0, depth test on, depth write off, no depth
 *   correction, the pass's (normal) blend.
 */
export class SkyClouds {
	/**
	 * @param {{rng?: function, now?: function}} [ports] now() is the wall clock (Date.now)
	 */
	constructor({ rng = defaultRng, now = defaultClock } = {}) {
		this._rng = rng;
		this._now = now;
		this.display = true;
		this.color = null;
		this.textureSlots = 0;
		this.clouds = [];
	}

	/**
	 * @param {{skyColor: number[], cloudColor?: number[]}|undefined} entry WeatherTable.sky[map]
	 * @returns {{clearColor: number[], display: boolean, loadTextures: string[]}}
	 *          loadTextures lists the textures to request now (only the first time)
	 */
	init(entry) {
		if (!entry) {
			this.display = false;
			return { clearColor: BLACK_CLEAR, display: false, loadTextures: [] };
		}
		this.color = entry.cloudColor;
		this.display = !!this.color;
		let loadTextures = [];
		if (!this.textureSlots && this.display) {
			this.textureSlots = 8;
			loadTextures = SKY_CLOUD_TEXTURES.slice();
		}
		const c = entry.skyColor;
		return { clearColor: [c[0], c[1], c[2], c[3]], display: this.display, loadTextures };
	}

	/** @param {ArrayLike<number>} player */
	setUp(player) {
		const rng = this._rng;
		for (let i = 0; i < SKY_CLOUD_COUNT; i++) {
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
			this._respawn(cloud, player);
			cloud.sprite = (rng() * (this.textureSlots - 1)) | 0;
			cloud.deathTick = cloud.bornTick + rng() * 8000;
			cloud.bornTick -= 2000;
		}
		this.clouds.sort((a, b) => a.sprite - b.sprite);
	}

	_respawn(cloud, player) {
		const rng = this._rng;
		cloud.position[0] = player[0] + ((rng() * 35) | 0) * (rng() > 0.5 ? 1 : -1);
		cloud.position[1] = player[1] + ((rng() * 35) | 0) * (rng() > 0.5 ? 1 : -1);
		cloud.position[2] = -10.0;
		cloud.direction[0] = rng() * 0.02 - 0.01;
		cloud.direction[1] = rng() * 0.02 - 0.01;
		cloud.direction[2] = rng() * 0.002 - 0.001;
		cloud.bornTick = cloud.deathTick ? cloud.deathTick + 2000 : this._now();
		cloud.deathTick = cloud.bornTick + 6000;
		cloud.lastTick = cloud.bornTick;
	}

	/**
	 * @param {number} tick
	 * @param {{player: ArrayLike<number>}} ctx  player read only when a cloud respawns
	 * @returns {Object[]} SpriteDraw records
	 */
	frame(tick, { player }) {
		if (!this.display) {
			return [];
		}
		const out = [];
		for (const cloud of this.clouds) {
			let opacity;
			if (cloud.bornTick + 1000 > tick) {
				opacity = (tick - cloud.bornTick) / 1000;
			} else if (cloud.deathTick + 2000 < tick) {
				this._respawn(cloud, player);
				opacity = 0.0;
			} else if (cloud.deathTick < tick) {
				opacity = 1.0 - (tick - cloud.deathTick) / 2000;
			} else {
				opacity = 1.0;
			}
			const dt = Math.min(tick - (cloud.lastTick || cloud.bornTick), 250);
			cloud.lastTick = tick;
			for (let k = 0; k < 3; k++) {
				cloud.position[k] = cloud.position[k] + cloud.direction[k] * (dt / 25);
			}
			const texture = cloud.sprite < SKY_CLOUD_TEXTURES.length ? SKY_CLOUD_TEXTURES[cloud.sprite] : null;
			if (!opacity || !texture || !this.textureSlots) {
				continue;
			}
			out.push(
				weatherSpriteDraw({
					texture,
					position: Array.from(cloud.position),
					offset: [0, 0],
					size: [500, 500],
					angle: 0,
					color: [this.color[0], this.color[1], this.color[2], opacity],
					shadowFactor: 1,
					zIndex: 0,
					depthBias: 0,
					depthTest: true,
					depthWrite: false,
					depthCorrection: false
				})
			);
		}
		return out;
	}
}
