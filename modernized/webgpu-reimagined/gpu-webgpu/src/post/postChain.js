import { BLIND, BLOOM, BLUR_MASK, FXAA } from '../constants.js';
import { mix, smoothstep } from '../math.js';
import { NotImplementedError } from '../errors.js';

/** R-PP-001 module order. */
export const POST_ORDER = Object.freeze(['Bloom', 'Blur', 'FXAA', 'CAS', 'Cartoon', 'Vibrance', 'VerticalFlip', 'Blind', 'Upsampling']);

/** R-PP-012 defaults (+ the parameter defaults from the visual-constants table). */
export const POST_DEFAULTS = Object.freeze({
	bloom: false,
	bloomIntensity: 0.5,
	blur: false,
	blurArea: 14.0,
	blurIntensity: 3.0,
	fxaaEnabled: false,
	fxaaSubpix: 0.25,
	fxaaEdgeThreshold: 0.125,
	vibranceEnabled: false,
	vibrance: 0.15,
	cartoonEnabled: false,
	cartoonPower: 1.5,
	cartoonEdgeSlope: 1.5,
	casEnabled: false,
	casContrast: 0.0,
	casSharpening: 1.0
});

/**
 * R-PP-004: legacy disables bloom only for Chrome + SwiftShader + Intel
 * (Utils/WebGL.js detectBadWebGL). Mapped onto GPUAdapterInfo.
 * `allowSoftwareAdapter` lets the test-harness produce WebGPU bloom goldens
 * on the pinned SwiftShader adapter (architecture §2.2 test-harness).
 */
export function bloomSupported({ vendor = '', description = '', userAgent = '' }, { allowSoftwareAdapter = false } = {}) {
	const isSwiftShader = `${vendor} ${description}`.toLowerCase().includes('swiftshader');
	const isIntel = vendor.toLowerCase().includes('intel');
	const isChrome = /chrome|chromium/i.test(userAgent) && !/edg|opr/i.test(userAgent);
	return allowSoftwareAdapter || !(isSwiftShader && isIntel && isChrome);
}

/**
 * R-PP-001/002/003: which modules run, and where each writes.
 * The scene is always rendered into the MSAA offscreen target and resolved;
 * with no active module the resolve is blitted straight to the swapchain
 * (WebGPU equivalent of "scene draws straight to the screen").
 * @param {Record<string, any>} settings  GraphicsSettings snapshot
 * @param {{illusion?: boolean, blind?: boolean, bloomAllowed?: boolean}} state
 */
export function planPostChain(settings, state = {}) {
	const s = { ...POST_DEFAULTS, ...settings };
	const active = {
		Bloom: s.bloom && state.bloomAllowed !== false,
		Blur: s.blur,
		FXAA: s.fxaaEnabled,
		CAS: s.casEnabled,
		Cartoon: s.cartoonEnabled,
		Vibrance: s.vibranceEnabled,
		VerticalFlip: Boolean(state.illusion),
		Blind: Boolean(state.blind),
		Upsampling: Boolean(s.performanceMode)
	};
	const modules = POST_ORDER.filter(m => active[m]);
	return {
		modules,
		passes: modules.map((name, i) => ({ name, output: i === modules.length - 1 ? 'swapchain' : i % 2 === 0 ? 'pingA' : 'pingB' })),
		directBlit: modules.length === 0,
		sceneScale: s.performanceMode ? 0.75 : 1,
		intermediateFormat: 'rgba8unorm',
		sampler: { magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }
	};
}

/** R-PP-004 bloom parameters. */
export function bloomUniforms(settings) {
	const s = { ...POST_DEFAULTS, ...settings };
	return {
		threshold: BLOOM.threshold,
		knee: BLOOM.knee,
		downsample: s.performanceMode ? BLOOM.downsamplePerf : BLOOM.downsample,
		tapTexels: BLOOM.tapTexels,
		intensity: s.bloomIntensity
	};
}
/** R-PP-004 composite reference: scene + bloom·intensity. */
export const bloomComposite = (scene, bloom, intensity) => scene.map((c, i) => c + bloom[i] * intensity);

/** R-PP-005: mask = smoothstep(0.14, 0.64, dist from centre); tap offset mask·intensity·0.5 texels. */
export function blurMask(uv, settings) {
	const s = { ...POST_DEFAULTS, ...settings };
	const d = Math.hypot(uv[0] - 0.5, uv[1] - 0.5);
	const focusRadius = s.blurArea / 100;
	const mask = smoothstep(focusRadius, focusRadius + (BLUR_MASK.outer - BLUR_MASK.inner), d);
	return { mask, tapOffsetTexels: mask * s.blurIntensity * 0.5 };
}

/**
 * R-PP-006 FIX: fxaaSubpix is uploaded AND used by shaders/post/fxaa.wgsl
 * (legacy uploaded it but never read it).
 */
export function fxaaUniforms(settings) {
	const s = { ...POST_DEFAULTS, ...settings };
	return { edgeThreshold: s.fxaaEdgeThreshold, edgeThresholdMin: 0, span: FXAA.span, reduceMul: FXAA.reduceMul, reduceMin: FXAA.reduceMin, subpix: s.fxaaSubpix };
}

/**
 * R-PP-007 FIX: sharpening of 0 is honoured (legacy `|| 1.0` made 0 impossible).
 * peak = 8 − 3·contrast.
 */
export function casUniforms(settings) {
	const s = { ...POST_DEFAULTS, ...settings };
	return { peak: 8 - 3 * (s.casContrast ?? 0), sharpening: s.casSharpening ?? 1.0 };
}

/** R-PP-008: power/slope default 1.5, and 0 falls back to 1.5 (not flagged: kept). */
export function cartoonUniforms(settings) {
	const s = { ...POST_DEFAULTS, ...settings };
	return { power: s.cartoonPower || 1.5, edgeSlope: s.cartoonEdgeSlope || 1.5 };
}
/** R-PP-008 reference: rgb −= |edge|^slope·power. */
export const cartoonApply = (rgb, edge, { power, edgeSlope }) => rgb.map(c => c - Math.pow(Math.abs(edge), edgeSlope) * power);

/** R-PP-009 FIX: vibrance 0 is honoured (legacy `||` fell back to 0.15). */
export function vibranceUniforms(settings) {
	const s = { ...POST_DEFAULTS, ...settings };
	return { vibrance: s.vibrance ?? 0.15, balance: [1, 1, 1] };
}
/** R-PP-009 reference: per channel mix(luma, c, 1 + v·(1 − sign(v)·saturation)). */
export function vibranceApply(rgb, v) {
	const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
	const saturation = Math.max(...rgb) - Math.min(...rgb);
	const t = 1 + v * (1 - Math.sign(v) * saturation);
	return rgb.map(c => mix(luma, c, t));
}

/** R-PP-010: radius 0.2 + (63 − zoomFinal)/1000, falloff 0.5 + (63 − zoom)/1000, aspect-corrected. */
export function blindUniforms({ zoomFinal, width, height }) {
	const k = (BLIND.zoomRef - zoomFinal) / 1000;
	return { radius: BLIND.radius + k, falloff: BLIND.falloff + k, aspect: width / height };
}

/** Per-resize GPU resources and encoding of the chain (C-11). */
export class PostChain {
	constructor(deps) {
		this._deps = deps;
	}

	resize(_width, _height) {
		throw new NotImplementedError('PostChain.resize (C-11)');
	}

	encode(_encoder, _plan, _sceneTexture, _swapchainView) {
		throw new NotImplementedError('PostChain.encode (C-11)');
	}

	rebuild(_device) {
		throw new NotImplementedError('PostChain.rebuild (R-CTX-007)');
	}
}
