import { BLOOM } from '../constants.js';
import {
	POST_DEFAULTS,
	blindUniforms,
	bloomUniforms,
	cartoonUniforms,
	casUniforms,
	fxaaUniforms,
	planPostChain,
	vibranceUniforms
} from './postChain.js';

/** Bytes of one pass's uniform block (8 f32) and the stride between blocks (minUniformBufferOffsetAlignment). */
export const POST_UNIFORM_BYTES = 32;
export const POST_UNIFORM_STRIDE = 256;
/** At most 9 modules + the bloom prefilter, or the direct copy. */
export const POST_MAX_PASSES = 10;

/** Shaders/GaussianBlur.js focusFalloff. */
const BLUR_FALLOFF = 0.5;
/** Camera.zoomFinal when the scene gives none (R-PP-010 reference zoom: radius 0.2, falloff 0.5). */
const BLIND_DEFAULT_ZOOM = 63;

/**
 * Pipeline per pass: shader key in SHADERS + fragment entry point.
 * `Copy` is the "no active module" path (R-PP-002): the scene goes straight to the screen.
 */
export const POST_PIPELINES = Object.freeze({
	'Bloom.prefilter': { shader: 'Bloom', entryPoint: 'fs_prefilter' },
	Bloom: { shader: 'Bloom', entryPoint: 'fs_main' },
	Blur: { shader: 'Blur', entryPoint: 'fs_main' },
	FXAA: { shader: 'FXAA', entryPoint: 'fs_main' },
	CAS: { shader: 'CAS', entryPoint: 'fs_main' },
	Cartoon: { shader: 'Cartoon', entryPoint: 'fs_main' },
	Vibrance: { shader: 'Vibrance', entryPoint: 'fs_main' },
	VerticalFlip: { shader: 'VerticalFlip', entryPoint: 'fs_main' },
	Blind: { shader: 'Blind', entryPoint: 'fs_main' },
	Upsampling: { shader: 'Upsampling', entryPoint: 'fs_main' },
	Copy: { shader: 'Upsampling', entryPoint: 'fs_main' }
});

/**
 * Legacy target sizes (Effects/PostProcess.js validateBuffers, Shaders/Bloom.js render):
 * scene/ping-pong = floor(canvas · 0.75) in performance mode; bloom = floor(scene · 0.25), or · 0.125
 * in performance mode (PostProcess.createFbo floors the already-floored scene size).
 */
export function postTargetSizes({ width, height, performanceMode = false }) {
	const s = performanceMode ? 0.75 : 1;
	const scene = { width: Math.floor(width * s), height: Math.floor(height * s) };
	const f = performanceMode ? BLOOM.downsamplePerf : BLOOM.downsample;
	const bloom = { width: Math.floor(scene.width * f), height: Math.floor(scene.height * f) };
	return { canvas: { width, height }, scene, bloom };
}

/**
 * Uniform blocks (8 f32 each, the WGSL struct layouts in shaders/post/*.wgsl), computed as the legacy
 * Shaders/*.js upload them:
 * - texel steps come from the **canvas** size (gl.canvas.width), also in performance mode where the pass
 *   reads the 0.75× ping-pong target (legacy behaviour, kept); Bloom's from its internal target (×4);
 * - every texel step has a negative y: WebGPU uv.y runs top-down, so −1/h is the legacy +1/h (common.wgsl).
 * @returns {Record<string, Float32Array>}
 */
export function postUniformBlocks(settings, state, sizes) {
	const s = { ...POST_DEFAULTS, ...settings };
	const { width, height } = sizes.canvas;
	const block = values => {
		const out = new Float32Array(POST_UNIFORM_BYTES / 4);
		out.set(values);
		return out;
	};
	const texel = (k = 1) => [k / width, -k / height];
	const bloom = bloomUniforms(s);
	const fxaa = fxaaUniforms(s);
	const cas = casUniforms(s);
	const cartoon = cartoonUniforms(s);
	const vibrance = vibranceUniforms(s);
	const blind = blindUniforms({ zoomFinal: state.zoomFinal ?? BLIND_DEFAULT_ZOOM, width, height });
	const bloomTexel = [bloom.tapTexels / sizes.bloom.width, -bloom.tapTexels / sizes.bloom.height];
	return {
		'Bloom.prefilter': block([...bloomTexel, bloom.threshold, BLOOM.softKnee, bloom.intensity]),
		Bloom: block([...bloomTexel, bloom.threshold, BLOOM.softKnee, bloom.intensity]),
		Blur: block([...texel(s.blurIntensity), s.blurArea / 100, BLUR_FALLOFF]),
		FXAA: block([
			...texel(),
			fxaa.edgeThreshold,
			fxaa.edgeThresholdMin,
			fxaa.span,
			fxaa.reduceMul,
			fxaa.reduceMin,
			fxaa.subpix
		]),
		CAS: block([...texel(), s.casContrast || 0, cas.sharpening]),
		Cartoon: block([...texel(), cartoon.power, cartoon.edgeSlope]),
		Vibrance: block([...vibrance.balance, vibrance.vibrance]),
		VerticalFlip: block([]),
		Blind: block([blind.aspect, 1, blind.radius, blind.falloff]),
		Upsampling: block([]),
		Copy: block([])
	};
}

/**
 * C-11 pass graph: the GPU passes of one frame, in legacy order (R-PP-001), with their targets and uniforms.
 *
 * - The scene is the first input ('scene', OffscreenTarget.resolve at `sizes.scene`); module i writes
 *   'pingA'/'pingB' alternately, the last active module writes 'swapchain' at canvas size (R-PP-001/002).
 * - Bloom is two passes: prefilter into 'bloom' (0.25× / 0.125× of the scene target), then the composite
 *   reads the module input plus 'bloom' (R-PP-004).
 * - No active module: one 'Copy' pass from the scene to the swapchain (R-PP-002 "straight to the screen").
 *
 * @param {Record<string, any>} settings  GraphicsSettings snapshot
 * @param {{illusion?: boolean, blind?: boolean, bloomAllowed?: boolean, zoomFinal?: number}} state
 * @param {{width: number, height: number}} canvas  swapchain size in device pixels
 */
export function buildPostPasses(settings, state, canvas) {
	const plan = planPostChain(settings, state);
	const sizes = postTargetSizes({ ...canvas, performanceMode: Boolean(settings.performanceMode) });
	const uniforms = postUniformBlocks(settings, state, sizes);
	const sizeOf = target => (target === 'swapchain' ? sizes.canvas : target === 'bloom' ? sizes.bloom : sizes.scene);
	const pass = (name, module, input, output, input2 = null) => ({
		name,
		module,
		pipeline: name,
		input,
		input2,
		output,
		size: sizeOf(output),
		uniforms: uniforms[name]
	});

	const passes = [];
	if (plan.directBlit) {
		passes.push(pass('Copy', null, 'scene', 'swapchain'));
	}
	let input = 'scene';
	for (const { name, output } of plan.passes) {
		if (name === 'Bloom') {
			passes.push(pass('Bloom.prefilter', name, input, 'bloom'));
			passes.push(pass('Bloom', name, input, output, 'bloom'));
		} else {
			passes.push(pass(name, name, input, output));
		}
		input = output;
	}
	passes.forEach((p, slot) => (p.slot = slot));
	return { plan, sizes, passes };
}
