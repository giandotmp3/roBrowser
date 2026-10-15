import { createEffectDraw } from '../records/EffectDraw.js';
import { BLEND_NORMAL } from '../records/blend.js';
import { defaultClock, defaultRng } from '../util/injectables.js';
import { RAG_TICK_MS, WEATHER_PARAMS } from './weather.js';
import { WEATHER_DEPTH, remainingMs, weatherSpriteDraw } from './weatherSprites.js';
import { WEATHER_EMIT_STOP_BEFORE_END_MS, WEATHER_FADEOUT_TAIL_MS } from './SnowWeather.js';

const RAIN = WEATHER_PARAMS.rain;

/** Procedural rain textures (keys of the records; pixels from rainTexturePixels). */
export const RAIN_TEXTURES = Object.freeze({
	drop: 'rain:drop',
	filter: 'rain:filter',
	splash: 'rain:splash',
	puddle: 'rain:puddle'
});

/** Depth layers far / mid / near: pick weight, speed (cells per rag tick), size, look. */
export const RAIN_LAYERS = Object.freeze([
	Object.freeze({
		weight: 0.55,
		speedTick: [0.35, 0.55],
		widthPx: [1.0, 1.8],
		lengthPx: [22, 36],
		alphaScale: 0.12,
		brightness: [0.45, 0.65]
	}),
	Object.freeze({
		weight: 0.3,
		speedTick: [0.55, 0.85],
		widthPx: [1.6, 2.6],
		lengthPx: [36, 55],
		alphaScale: 0.22,
		brightness: [0.65, 0.85]
	}),
	Object.freeze({
		weight: 0.15,
		speedTick: [0.85, 1.25],
		widthPx: [2.3, 3.4],
		lengthPx: [55, 78],
		alphaScale: 0.35,
		brightness: [0.8, 1.0]
	})
]);

const LAYER_CDF = RAIN_LAYERS.reduce((out, layer) => {
	out.push((out.length ? out[out.length - 1] : 0) + layer.weight);
	return out;
}, []);

const FLASH_FADE_IN = 50;
const FLASH_FADE_OUT = 300;
const SPLASH_LIFE_MS = 220;
const SPLASH_SIZE_PX = [10, 18];
const SPLASH_ALPHA = 0.45;
const MAX_SPLASHES = 300;
const PUDDLE_INITIAL_SIZE = 20.0;
const PUDDLE_MAX_SIZE = 230.0;
const PUDDLE_GROWTH_PER_DROP = 4.5;
const PUDDLE_FADE_SPEED = 0.00004;
const PUDDLE_SEED_CHANCE = 0.06;

/**
 * RGBA8 pixels of the procedural rain textures (legacy ensure*Frame), for the backends.
 * @param {'drop'|'filter'|'splash'|'puddle'} name
 * @returns {{key: string, width: number, height: number, data: Uint8Array, filter: 'nearest'|'linear'}}
 */
export function rainTexturePixels(name) {
	const clampByte = a => Math.max(0, Math.min(255, Math.floor(a * 255)));
	if (name === 'drop') {
		const h = 16;
		const data = new Uint8Array(h * 4);
		for (let i = 0; i < h; i++) {
			const t = i / (h - 1);
			let a = Math.min(1, t / 0.7);
			if (t > 0.7) {
				a *= 1 - ((t - 0.7) / 0.3) * 0.35;
			}
			data.set([255, 255, 255, clampByte(a)], i * 4);
		}
		return { key: RAIN_TEXTURES.drop, width: 1, height: h, data, filter: 'nearest' };
	}
	if (name === 'filter') {
		return {
			key: RAIN_TEXTURES.filter,
			width: 1,
			height: 1,
			data: new Uint8Array([255, 255, 255, 255]),
			filter: 'nearest'
		};
	}
	const size = name === 'splash' ? 16 : 64;
	const data = new Uint8Array(size * size * 4);
	const c = (size - 1) / 2;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = x - c;
			const dy = y - c;
			let a = 0;
			if (name === 'splash') {
				const r = Math.sqrt(dx * dx + dy * dy) / c;
				if (r <= 1) {
					a = Math.exp(-r * r * 2.8);
					a = Math.max(a, Math.exp(-Math.pow((r - 0.65) / 0.12, 2)) * 0.9);
				}
				data.set([255, 255, 255, clampByte(a)], (y * size + x) * 4);
			} else {
				const angle = Math.atan2(dy, dx);
				const deform =
					1.0 + 0.15 * Math.sin(angle * 5) + 0.08 * Math.sin(angle * 3 + 1.5) + 0.05 * Math.cos(angle * 11);
				const r = Math.sqrt(dx * dx + dy * dy) / (c * 0.85 * deform);
				if (r <= 1.0) {
					a = Math.pow(1.0 - r, 0.7);
				}
				data.set([18, 32, 55, clampByte(a)], (y * size + x) * 4);
			}
		}
	}
	return { key: RAIN_TEXTURES[name], width: size, height: size, data, filter: 'linear' };
}

/**
 * Global wind of a tick: strength 0.14 ± 0.06 and a camera-space angle up to 0.55 rad,
 * slowly oscillating, turned into world space by the camera yaw so the on-screen slant
 * stays put while the camera rotates.
 *
 * @param {number} tick
 * @param {number} yawDeg Camera.angle[1]
 * @returns {{xTick: number, yTick: number, xMs: number, yMs: number}}
 */
export function rainWind(tick, yawDeg) {
	const t = tick * 0.00012;
	const strength = RAIN.wind + RAIN.windJitter * Math.sin(t * 2.3);
	const angleCam = Math.sin(t * 1.1) * RAIN.maxWindAngle;
	const camX = Math.cos(angleCam) * strength;
	const camY = Math.sin(angleCam) * strength * 0.35;
	const yaw = ((yawDeg || 0) * Math.PI) / 180;
	const cos = Math.cos(yaw);
	const sin = Math.sin(yaw);
	const xTick = camX * cos + camY * sin;
	const yTick = -camX * sin + camY * cos;
	return { xTick, yTick, xMs: xTick / RAG_TICK_MS, yMs: yTick / RAG_TICK_MS };
}

/**
 * On-screen tilt (degrees) of a streak moving with (vx, vy) cells/ms horizontally and
 * falling speedMs: the view-space direction of the velocity in map coords (x, −z, y).
 *
 * @param {number} vx
 * @param {number} vy
 * @param {number} speedMs
 * @param {ArrayLike<number>|null} modelView Camera.modelView (column-major)
 * @returns {number}
 */
export function rainDropTilt(vx, vy, speedMs, modelView) {
	const m = modelView;
	if (!m) {
		return 0;
	}
	const my = speedMs;
	const vxView = m[0] * vx + m[4] * my + m[8] * vy;
	const vyView = m[1] * vx + m[5] * my + m[9] * vy;
	if (Math.abs(vxView) < 0.000001 && Math.abs(vyView) < 0.000001) {
		return 0;
	}
	return (Math.atan2(vxView, vyView) * 180) / Math.PI;
}

/**
 * Thunder overlay of the wall-clock time since the flash started.
 * @param {number} elapsed ms
 * @param {number} multi 1 or 2 (double strobe)
 * @returns {number|null} flash alpha, or null once the flash is over
 */
export function rainFlashAlpha(elapsed, multi) {
	let e = elapsed;
	if (multi === 2) {
		if (e < 80) {
			return 0.6 * (1 - e / 80);
		}
		if (e < 160) {
			return 0;
		}
		e -= 160;
	}
	if (e < FLASH_FADE_IN) {
		return (e / FLASH_FADE_IN) * 0.8;
	}
	if (e < FLASH_FADE_IN + FLASH_FADE_OUT) {
		return 0.8 * (1 - (e - FLASH_FADE_IN) / FLASH_FADE_OUT);
	}
	return null;
}

/**
 * EF_RAIN weather (R-EFX-017) into records. Replaces legacy Renderer/Effects/RainWeather.js
 * (web-audio rain / plinks / thunder are not render rules: `playSound` gets 'thunder' and
 * 'drop' events; legacy's plink randomness only exists with an AudioContext).
 *
 * frame() — the after-entities pass, SpriteDraw records, no depth test or write, depth
 * correction off, normal blend:
 * 1. Wind for the tick and camera yaw.
 * 2. Thunder on the wall clock (`now`): every 5–60 s, 40 % double strobe; the screen filter
 *    (6000 px billboard at the player, zIndex −1000) is grey (0.65, 0.67, 0.7, 0.14) or the
 *    flash colour (0.9, 0.95, 1) with the flash alpha; during the fade-out tail and not
 *    flashing the grey alpha scales with the remaining tail.
 * 3. At endTick the effect finishes (after the filter).
 * 4. 10 drops per elapsed rag tick while more than 160 rag ticks remain and not stopping,
 *    at most 1100 (oldest dropped). Each drop picks a layer, spawns within 70 cells of the
 *    player shifted upwind by the drift of its fall, at ground + 22–42.
 * 5. Drops, newest first: one at or below ground + 0.05 may splash (chance alphaScale·0.6;
 *    at most 300 splashes), feeds the puddles and is dropped; the others fall, drift with
 *    the wind (+ jitter), fade by fall progress (in 8 %, out 15 %) with a shimmer, and draw
 *    as a streak tilted along their projected motion.
 * 6. Splashes, newest first: 220 ms, growing, fading from 0.45. Their angle is
 *    drop.angle · 0.2 with drop.angle never set, so NaN (kept).
 * puddles() — the before-entities pass, EffectDraw 'rainPuddle' records (see legacy
 * RainWeather.renderPuddles): puddles not hit for their life dry out, shrink and go.
 */
export class RainWeather {
	/**
	 * @param {{startTick: number, endTick?: number}} inst
	 * @param {{rng?: function, now?: function, playSound?: function}} [ports]
	 *        now() is the wall clock (Date.now) driving thunder
	 */
	constructor({ startTick, endTick = -1 }, { rng = defaultRng, now = defaultClock, playSound = () => {} } = {}) {
		this._rng = rng;
		this._now = now;
		this._playSound = playSound;
		this.startTick = startTick;
		this.endTick = endTick;
		this.lastEmitTick = startTick;
		this.stopping = false;
		this.drops = [];
		this.splashes = [];
		this.puddles = [];
		this.wind = { xTick: 0, yTick: 0, xMs: 0, yMs: 0 };
		this.nextLightningTime = now() + this._range(RAIN.thunderMs[0], RAIN.thunderMs[1]);
		this.isFlashing = false;
		this.flashStartTime = 0;
		this.flashMultiCount = 1;
		this.finished = false;
	}

	_range(min, max) {
		return min + this._rng() * (max - min);
	}

	/** @param {number} now */
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
			this.stopping = true;
			this.endTick = now + WEATHER_FADEOUT_TAIL_MS;
		}
	}

	_pickLayer() {
		const r = this._rng() * LAYER_CDF[LAYER_CDF.length - 1];
		for (let i = 0; i < LAYER_CDF.length; i++) {
			if (r <= LAYER_CDF[i]) {
				return i;
			}
		}
		return LAYER_CDF.length - 1;
	}

	_spawnDrop(tick, player, cellHeight) {
		const rng = this._rng;
		const layer = RAIN_LAYERS[this._pickLayer()];
		const theta = rng() * Math.PI * 2;
		const radius = rng() * RAIN.radius;
		const speedTick = this._range(layer.speedTick[0], layer.speedTick[1]);
		const widthPx = this._range(layer.widthPx[0], layer.widthPx[1]);
		const lengthPx = this._range(layer.lengthPx[0], layer.lengthPx[1]);
		const spawnHeight = this._range(RAIN.spawnHeight[0], RAIN.spawnHeight[1]);
		const driftTicks = spawnHeight / speedTick;
		const x = player[0] + Math.cos(theta) * radius + -this.wind.xTick * driftTicks;
		const y = player[1] + Math.sin(theta) * radius + -this.wind.yTick * driftTicks;
		const groundZ = cellHeight(x, y);
		const z = groundZ + spawnHeight;
		const windJitterXMs = (rng() - 0.5) * 0.002;
		const windJitterYMs = (rng() - 0.5) * 0.002;
		const tiltJitter = this._range(-4, 4);
		const brightness = this._range(layer.brightness[0], layer.brightness[1]);
		const flicker = rng() * 1000;
		this.drops.push({
			spawnTick: tick,
			x,
			y,
			z,
			spawnZ: z,
			groundZ,
			speedMs: speedTick / RAG_TICK_MS,
			windJitterXMs,
			windJitterYMs,
			tiltJitter,
			widthPx,
			lengthPx,
			alphaScale: layer.alphaScale,
			brightness,
			flicker,
			lastTick: 0
		});
		if (this.drops.length > RAIN.maxDrops) {
			this.drops.splice(0, this.drops.length - RAIN.maxDrops);
		}
	}

	_feedPuddle(x, y, z, tick) {
		let best = null;
		let bestDistSq = Infinity;
		for (const p of this.puddles) {
			const dx = p.x - x;
			const dy = p.y - y;
			const distSq = dx * dx + dy * dy;
			const impactRadius = Math.max(1.5, (p.size / 35.0) * 0.8);
			if (distSq < impactRadius * impactRadius && distSq < bestDistSq) {
				bestDistSq = distSq;
				best = p;
			}
		}
		if (best) {
			best.size = Math.min(PUDDLE_MAX_SIZE, best.size + PUDDLE_GROWTH_PER_DROP);
			best.alpha = Math.min(RAIN.maxPuddleAlpha, best.alpha + 0.02);
			const currentLife = Math.max(0, (best.nextDryTick || tick) - tick);
			best.nextDryTick = tick + Math.min(10000, currentLife + 1500);
			return;
		}
		if (!(this._rng() < PUDDLE_SEED_CHANCE)) {
			return;
		}
		for (const p of this.puddles) {
			const dx = p.x - x;
			const dy = p.y - y;
			if (dx * dx + dy * dy < PUDDLE_MAX_SIZE / 4) {
				p.size = Math.min(PUDDLE_MAX_SIZE, p.size + PUDDLE_GROWTH_PER_DROP * 0.5);
				return;
			}
		}
		if (this.puddles.length >= RAIN.maxPuddles) {
			let worst = 0;
			let minScore = Infinity;
			this.puddles.forEach((p, i) => {
				const score = p.size * p.alpha;
				if (score < minScore) {
					minScore = score;
					worst = i;
				}
			});
			this.puddles.splice(worst, 1);
		}
		this.puddles.push({
			x,
			y,
			z,
			size: PUDDLE_INITIAL_SIZE,
			alpha: 0.12,
			angle: this._rng() * Math.PI * 2,
			nextDryTick: tick + 3500,
			lastTick: 0
		});
	}

	/**
	 * After-entities pass.
	 *
	 * @param {number} tick
	 * @param {Object} ctx
	 * @param {ArrayLike<number>|null} ctx.player
	 * @param {function} ctx.cellHeight (x, y) => ground z
	 * @param {{yaw: number, modelView: ArrayLike<number>|null}} ctx.camera  yaw = Camera.angle[1]
	 * @returns {Object[]} SpriteDraw records
	 */
	frame(tick, { player, cellHeight, camera }) {
		if (!player) {
			return [];
		}
		const rng = this._rng;
		this.wind = rainWind(tick, camera.yaw);
		const now = this._now();
		if (!this.isFlashing && now >= this.nextLightningTime) {
			this._playSound('thunder');
			this.isFlashing = true;
			this.flashStartTime = now;
			this.flashMultiCount = rng() > 0.6 ? 2 : 1;
			this.nextLightningTime = now + this._range(RAIN.thunderMs[0], RAIN.thunderMs[1]);
		}
		let overlay = [0.65, 0.67, 0.7, 0.14];
		if (this.isFlashing) {
			const flash = rainFlashAlpha(now - this.flashStartTime, this.flashMultiCount);
			if (flash === null) {
				this.isFlashing = false;
			} else {
				overlay = [0.9, 0.95, 1.0, flash];
			}
		}
		if (this.endTick > 0 && !this.isFlashing) {
			overlay[3] *= Math.max(0, Math.min(1, (this.endTick - tick) / WEATHER_FADEOUT_TAIL_MS));
		}

		const out = [];
		let zIndex = -1000;
		const draw = fields => {
			if (!fields.color[3]) {
				return;
			}
			out.push(
				weatherSpriteDraw({
					offset: [0, 0],
					shadowFactor: 1,
					depthBias: 0,
					...WEATHER_DEPTH,
					...fields,
					zIndex: zIndex++
				})
			);
		};
		draw({
			texture: RAIN_TEXTURES.filter,
			position: [player[0], player[1], player[2]],
			color: overlay,
			angle: 0,
			size: [6000, 6000]
		});

		const remaining = remainingMs(this.endTick, tick);
		if (remaining <= 0) {
			this.finished = true;
			return out;
		}
		if (remaining > WEATHER_EMIT_STOP_BEFORE_END_MS) {
			const ticksToEmit = Math.floor((tick - this.lastEmitTick) / RAG_TICK_MS);
			if (ticksToEmit > 0) {
				for (let i = 0; i < ticksToEmit && !this.stopping; i++) {
					const emitTick = this.lastEmitTick + i * RAG_TICK_MS;
					for (let e = 0; e < RAIN.perTick; e++) {
						this._spawnDrop(emitTick, player, cellHeight);
					}
				}
				this.lastEmitTick += ticksToEmit * RAG_TICK_MS;
			}
		}

		for (let d = this.drops.length - 1; d >= 0; d--) {
			const drop = this.drops[d];
			if (drop.z <= drop.groundZ + 0.05) {
				if (rng() < drop.alphaScale * 0.6) {
					this.splashes.push({
						x: drop.x,
						y: drop.y,
						z: drop.groundZ + 0.02,
						startTick: tick,
						maxSizePx: this._range(SPLASH_SIZE_PX[0], SPLASH_SIZE_PX[1]),
						angle: drop.angle * 0.2
					});
					if (this.splashes.length > MAX_SPLASHES) {
						this.splashes.splice(0, this.splashes.length - MAX_SPLASHES);
					}
					this._playSound('drop');
				}
				this._feedPuddle(drop.x, drop.y, drop.groundZ, tick);
				this.drops.splice(d, 1);
				continue;
			}
			const dt = tick - (drop.lastTick || drop.spawnTick);
			drop.lastTick = tick;
			const windXMs = this.wind.xMs + (drop.windJitterXMs || 0);
			const windYMs = this.wind.yMs + (drop.windJitterYMs || 0);
			drop.z -= drop.speedMs * dt;
			drop.x += windXMs * dt;
			drop.y += windYMs * dt;
			const denom = drop.spawnZ - drop.groundZ;
			const progress = Math.min(1, Math.max(0, denom > 0.0001 ? (drop.spawnZ - drop.z) / denom : 0));
			let alpha = drop.alphaScale;
			if (progress < 0.08) {
				alpha *= progress / 0.08;
			} else if (progress > 0.85) {
				alpha *= (1 - progress) / 0.15;
			}
			alpha *= 0.9 + 0.1 * Math.sin((tick + drop.flicker) * 0.015);
			zIndex = 0;
			draw({
				texture: RAIN_TEXTURES.drop,
				position: [drop.x, drop.y, drop.z],
				color: [0.6 * drop.brightness, 0.72 * drop.brightness, 1.0 * drop.brightness, alpha],
				angle: rainDropTilt(windXMs, windYMs, drop.speedMs, camera.modelView) + (drop.tiltJitter || 0),
				size: [drop.widthPx, drop.lengthPx]
			});
		}

		for (let s = this.splashes.length - 1; s >= 0; s--) {
			const splash = this.splashes[s];
			const age = tick - splash.startTick;
			if (age >= SPLASH_LIFE_MS) {
				this.splashes.splice(s, 1);
				continue;
			}
			const sp = age / SPLASH_LIFE_MS;
			const size = splash.maxSizePx * (0.6 + sp * 0.8);
			zIndex = 0;
			draw({
				texture: RAIN_TEXTURES.splash,
				position: [splash.x, splash.y, splash.z],
				color: [0.75, 0.8, 0.9, SPLASH_ALPHA * (1 - sp)],
				angle: splash.angle,
				size: [size, size]
			});
		}
		return out;
	}

	/**
	 * Before-entities pass (only while puddles exist and a player is present).
	 *
	 * @param {number} tick
	 * @param {{player: ArrayLike<number>|null, sceneFog?: {use: boolean}}} ctx
	 * @returns {Object[]} EffectDraw 'rainPuddle' records (params: size, angle in radians,
	 *          zIndex 1, time tick·0.001, vertexCount 6; position z lifted by 0.01)
	 */
	puddleFrame(tick, { player, sceneFog = { use: false } }) {
		if (!this.puddles.length || !player) {
			return [];
		}
		const out = [];
		for (let p = this.puddles.length - 1; p >= 0; p--) {
			const puddle = this.puddles[p];
			if (tick > (puddle.nextDryTick || tick)) {
				const dt = tick - (puddle.lastTick || tick);
				const fade = (PUDDLE_FADE_SPEED / (1.0 + puddle.size * 0.003)) * dt;
				puddle.alpha -= fade;
				puddle.size -= fade * 8500.0;
			}
			puddle.lastTick = tick;
			if (puddle.size <= 0.1 || puddle.alpha <= 0.0001) {
				this.puddles.splice(p, 1);
				continue;
			}
			out.push(
				createEffectDraw({
					family: 'rainPuddle',
					pass: 'before',
					texture: RAIN_TEXTURES.puddle,
					position: [puddle.x, puddle.y, puddle.z + 0.01],
					color: [1.0, 1.0, 1.0, puddle.alpha],
					blend: BLEND_NORMAL,
					depthTest: true,
					depthWrite: false,
					depthCorrection: false,
					fog: !!sceneFog.use,
					params: { size: puddle.size, angle: puddle.angle, zIndex: 1, time: tick * 0.001, vertexCount: 6 }
				})
			);
		}
		return out;
	}
}
