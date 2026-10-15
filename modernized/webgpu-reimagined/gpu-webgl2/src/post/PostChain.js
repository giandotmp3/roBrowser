import { BLIND, BLOOM, BLUR_MASK, FXAA, PERF_SCENE_SCALE, POST_ORDER } from '../constants.js';
import { smoothstep } from '../math.js';

export { fxaaAcrossOffset, fxaaLuma, fxaaReference, fxaaSubpixH } from './fxaa.js';

/** R-PP-012: every module defaults to off. */
export const POST_DEFAULTS = Object.freeze({
	bloom: false,
	bloomIntensity: 0.5,
	blur: false,
	blurArea: 14,
	blurIntensity: 3,
	fxaa: false,
	fxaaSubpix: 0.25,
	fxaaEdgeThreshold: 0.125,
	cas: false,
	casContrast: 0,
	casSharpening: 1,
	cartoon: false,
	cartoonPower: 1.5,
	cartoonEdgeSlope: 1.5,
	vibrance: false,
	vibranceValue: 0.15
});

/**
 * R-PP-001: active modules in fixed order; the last active one writes to the screen.
 * @param {Record<string, boolean>} active  keyed by POST_ORDER names
 */
export function activeChain(active) {
	const list = POST_ORDER.filter(name => active[name]);
	return list.map((name, i) => ({ name, toScreen: i === list.length - 1 }));
}

/**
 * R-PP-002/003: scene target. No active module → draw straight to screen.
 * Otherwise RGB8 + DEPTH16, linear, clamp-to-edge, ping-pong. Performance mode
 * renders at 0.75× and adds Upsampling.
 */
export function sceneTarget({ width, height, anyActive, performanceMode }) {
	if (!anyActive && !performanceMode) {
		return { toScreen: true, width, height };
	}
	const scale = performanceMode ? PERF_SCENE_SCALE : 1;
	return {
		toScreen: false,
		width: Math.round(width * scale),
		height: Math.round(height * scale),
		color: 'RGB8',
		depth: 'DEPTH_COMPONENT16',
		filter: 'LINEAR',
		wrap: 'CLAMP_TO_EDGE',
		pingPong: true,
		upsample: performanceMode
	};
}

/**
 * R-PP-004: bloom parameters, and SwiftShader/Intel disable.
 * @param {{intensity: number, performanceMode: boolean, rendererString: string}} p
 */
export function bloomParams({ intensity, performanceMode, rendererString }) {
	const disabled = /SwiftShader/i.test(rendererString) && /Intel/i.test(rendererString);
	return {
		enabled: !disabled,
		intensity,
		threshold: BLOOM.threshold,
		knee: BLOOM.knee,
		downsample: performanceMode ? BLOOM.downsamplePerf : BLOOM.downsample,
		tapTexels: BLOOM.tapTexels
	};
}

/** CPU reference of bloom prefilter soft knee on BT.709 luma. */
export function bloomLuma(rgb) {
	return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** R-PP-005: mask = smoothstep(0.14, 0.64, dist); offset = mask·intensity·0.5 texels. */
export function blurMask(distFromCentre, intensity) {
	const mask = smoothstep(BLUR_MASK.inner, BLUR_MASK.outer, distFromCentre);
	return { mask, offsetTexels: mask * intensity * 0.5 };
}

/**
 * R-PP-006 [FLAG → fixed, HITL round 2]: `fxaaSubpix` drives the FXAA 3.11 subpixel term in
 * shaders/fxaa.frag (CPU reference: post/fxaa.js). Legacy uploaded it but never read it.
 */
export function fxaaUniforms(settings) {
	return {
		// Legacy Shaders/FXAA.js `fxaaEdgeThreshold || 0.125` (not flagged: kept; matches gpu-webgpu).
		edgeThreshold: settings.fxaaEdgeThreshold || 0.125,
		edgeThresholdMin: 0,
		span: FXAA.span,
		reduceMul: FXAA.reduceMul,
		reduceMin: FXAA.reduceMin,
		subpix: settings.fxaaSubpix,
		subpixUsed: true
	};
}

/** R-PP-007 [FLAG → fixed]: peak = 8 − 3·contrast; sharpening 0 is honoured (no `|| 1.0`). */
export function casUniforms(settings) {
	const sharpening = settings.casSharpening ?? 1;
	return { peak: 8 - 3 * settings.casContrast, sharpening };
}

/** R-PP-008: power/slope default 1.5; 0 falls back to 1.5. */
export function cartoonUniforms(settings) {
	return { power: settings.cartoonPower || 1.5, edgeSlope: settings.cartoonEdgeSlope || 1.5 };
}

/** R-PP-009 [FLAG → fixed]: vibrance 0 is honoured (identity), only undefined falls back to 0.15. */
export function vibranceUniforms(settings) {
	return { vibrance: settings.vibranceValue ?? 0.15, balance: [1, 1, 1] };
}

/** CPU reference of vibrance.frag per channel. */
export function vibranceChannel(c, luma, v, saturation) {
	const k = 1 + v * (1 - Math.sign(v) * saturation);
	return luma + (c - luma) * k;
}

/** R-PP-010: blind radius/falloff from zoomFinal; active on EFST blind or EF_BLIND 334. */
export function blindUniforms({ zoomFinal, aspect, blinded }) {
	return {
		active: Boolean(blinded),
		radius: BLIND.radius + (BLIND.zoomRef - zoomFinal) / 1000,
		falloff: BLIND.falloff + (BLIND.zoomRef - zoomFinal) / 1000,
		aspect
	};
}

/**
 * Post chain resources. GL framebuffer handling sits behind `targets`.
 */
export class PostChain {
	/** @param {{targets: {resize(w: number, h: number): void, reinit(names: string[]): void}}} deps */
	constructor({ targets }) {
		this._targets = targets;
		this.active = [];
	}

	/** @param {Record<string, boolean>} flags */
	configure(flags) {
		this.active = activeChain(flags).map(m => m.name);
	}

	/** R-CTX-007: re-initialise active modules after restore. */
	reinit() {
		this._targets.reinit([...this.active]);
	}

	resize(w, h) {
		this._targets.resize(w, h);
	}
}
