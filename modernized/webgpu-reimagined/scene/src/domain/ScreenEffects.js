import { NIGHT } from '../constants.js';
import { notImplemented } from '../errors.js';

/** RSW env colour: 1-(1-D)(1-A) per channel (R-CTX-012 formula, used by the night step). */
export const envColor = (diffuse, ambient) => diffuse.map((d, i) => 1 - (1 - d) * (1 - ambient[i]));

/**
 * Night transition (R-CTX-013): every 8 ms R and G drop by 0.005 until both ≤ 0.5; blue untouched;
 * env recomputed each step. Day reverses up to the map diffuse.
 */
export class NightTransition {
	/**
	 * @param {{ diffuse: number[], ambient: number[] }} light map light (mutated diffuse copy kept here)
	 */
	constructor(light) {
		this.mapDiffuse = [...light.diffuse];
		this.ambient = [...light.ambient];
		this.diffuse = [...light.diffuse];
		this.env = envColor(this.diffuse, this.ambient);
		this.night = false;
		this.lastStep = null;
	}

	setNight(on, tick) {
		this.night = on;
		this.lastStep = tick;
	}

	/** Advance to `tick`, applying as many 8 ms steps as elapsed. */
	update(tick) {
		if (this.lastStep === null) {
			this.lastStep = tick;
			return;
		}
		while (tick - this.lastStep >= NIGHT.INTERVAL_MS) {
			this.lastStep += NIGHT.INTERVAL_MS;
			this._step();
		}
	}

	_step() {
		for (const i of [0, 1]) {
			if (this.night) {
				if (this.diffuse[0] > NIGHT.FLOOR || this.diffuse[1] > NIGHT.FLOOR) {
					this.diffuse[i] = Math.max(NIGHT.FLOOR, this.diffuse[i] - NIGHT.STEP);
				}
			} else {
				this.diffuse[i] = Math.min(this.mapDiffuse[i], this.diffuse[i] + NIGHT.STEP);
			}
		}
		this.env = envColor(this.diffuse, this.ambient);
	}
}

/**
 * ScreenEffects state (ScreenEffectManager contract). The illusion flag drives
 * R-PP-011 mirroring for picking + overlays; the flip itself is a gpu post pass.
 */
export class ScreenEffects {
	constructor() {
		this.illusion = false;
		this.blind = false;
		this.poison = false;
		/** @type {NightTransition|null} */
		this.nightTransition = null;
	}

	get flipped() {
		return this.illusion;
	}

	/** @param {{ diffuse: number[], ambient: number[] }} light */
	bindMapLight(light) {
		this.nightTransition = new NightTransition(light);
	}

	setNight(on, tick) {
		this.nightTransition?.setNight(on, tick);
	}

	/** Map EFST status packet to screen state (illusion/blind/poison). */
	parseStatus(_efst, _flag) {
		notImplemented('ScreenEffects.parseStatus', 'R-PP-011');
	}

	cleanStatusEffect() {
		this.illusion = false;
		this.blind = false;
		this.poison = false;
	}

	clean() {
		this.cleanStatusEffect();
		this.nightTransition = null;
	}
}
