/**
 * Post-processing parity page (C-11, R-PP-001…012): the same synthetic scene image goes through the
 * real legacy chain (Effects/PostProcess.js + Effects/Shaders/*, unmodified, WebGL2, driven as
 * MapRenderer does: register in MapRenderer order once, then per frame prepare → draw the scene →
 * render) and through gpu-webgpu's PostChain (WebGPU), per configuration. GraphicsSettings is the
 * seam stub (entities/stubs.js `graphics`), Camera.zoomFinal the camera stub, Blind/VerticalFlip
 * are switched with their legacy setActive. Results land on `window.__parity` for run-parity.mjs.
 *
 * Image orientation: the scene image is defined top-down; legacy gets it bottom-up (GL rows), WebGPU
 * top-down, so both scenes show the same picture and both read-backs are bottom-up rows.
 */
import PostProcess from 'Renderer/Effects/PostProcess.js';
import Bloom from 'Renderer/Effects/Shaders/Bloom.js';
import GaussianBlur from 'Renderer/Effects/Shaders/GaussianBlur.js';
import FXAA from 'Renderer/Effects/Shaders/FXAA.js';
import CAS from 'Renderer/Effects/Shaders/CAS.js';
import Cartoon from 'Renderer/Effects/Shaders/Cartoon.js';
import Vibrance from 'Renderer/Effects/Shaders/Vibrance.js';
import VerticalFlip from 'Renderer/Effects/Shaders/VerticalFlip.js';
import Blind from 'Renderer/Effects/Shaders/Blind.js';
import Upsampling from 'Renderer/Effects/Shaders/Upsampling.js';
import WebGL from 'Utils/WebGL.js';
import Camera from './cameraStub.js';
import { graphics } from './entities/stubs.js';
import { createPageKit } from './common.js';
import { createWebGpuSide } from './webgpuKit.js';
import { PostChain } from '../src/post/PostChainRenderer.js';
import { buildPostPasses } from '../src/post/postPasses.js';
import { POST_DEFAULTS, bloomSupported, fxaaUniforms } from '../src/post/postChain.js';
import { fxaaReference } from '../src/post/fxaa.js';

const params = new URLSearchParams(location.search);
// Odd sizes on purpose: the 0.75× scene and the 0.25×/0.125× bloom targets all floor.
const WIDTH = Number(params.get('w') ?? 322);
const HEIGHT = Number(params.get('h') ?? 242);
const TOLERANCE = Number(params.get('tol') ?? 2);
const CLEAR = [0, 0, 0, 1];

/** GPUTextureUsage bits. */
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;

/**
 * Configurations. `legacy` overrides apply to the legacy side only (the declared fixes: legacy cannot express
 * them); `reference: 'fxaa-cpu'` gates against the CPU reference (src/post/fxaa.js) instead of legacy;
 * `gatePct` replaces the page gate (--max-diff-pct) for that configuration, with its analysis in smoke/README.md.
 */
const CONFIGS = [
	{ name: 'none (direct)' },
	{ name: 'bloom', settings: { bloom: true } },
	{ name: 'bloom intensity 1.5', settings: { bloom: true, bloomIntensity: 1.5 } },
	{ name: 'blur', settings: { blur: true } },
	{ name: 'blur area 30, intensity 6', settings: { blur: true, blurArea: 30, blurIntensity: 6 } },
	{ name: 'fxaa subpix 0 (= legacy)', settings: { fxaaEnabled: true, fxaaSubpix: 0 } },
	{
		name: 'fxaa threshold 0.063, subpix 0',
		settings: { fxaaEnabled: true, fxaaSubpix: 0, fxaaEdgeThreshold: 0.063 }
	},
	{ name: 'fxaa default (subpix 0.25, R-PP-006 fix)', settings: { fxaaEnabled: true }, reference: 'fxaa-cpu' },
	{ name: 'cas', settings: { casEnabled: true } },
	{ name: 'cas contrast 0.6, sharpening 0.5', settings: { casEnabled: true, casContrast: 0.6, casSharpening: 0.5 } },
	{
		name: 'cas sharpening 0 (R-PP-007 fix)',
		settings: { casEnabled: true, casSharpening: 0 },
		legacy: { casEnabled: false }
	},
	{ name: 'cartoon', settings: { cartoonEnabled: true } },
	{
		name: 'cartoon power 3, slope 1',
		settings: { cartoonEnabled: true, cartoonPower: 3, cartoonEdgeSlope: 1 }
	},
	{ name: 'vibrance', settings: { vibranceEnabled: true } },
	{ name: 'vibrance 0.8', settings: { vibranceEnabled: true, vibrance: 0.8 } },
	{ name: 'vibrance -0.5', settings: { vibranceEnabled: true, vibrance: -0.5 } },
	{
		name: 'vibrance 0 (R-PP-009 fix)',
		settings: { vibranceEnabled: true, vibrance: 0 },
		legacy: { vibranceEnabled: false }
	},
	{ name: 'vertical flip (illusion)', state: { illusion: true } },
	{ name: 'blind, zoom 63', state: { blind: true, zoomFinal: 63 } },
	{ name: 'blind, zoom 125', state: { blind: true, zoomFinal: 125 } },
	{ name: 'blind, zoom 30', state: { blind: true, zoomFinal: 30 } },
	{ name: 'performance mode', settings: { performanceMode: true } },
	{ name: 'performance + bloom', settings: { performanceMode: true, bloom: true } },
	{
		name: 'performance + fxaa, cas, cartoon',
		settings: {
			performanceMode: true,
			fxaaEnabled: true,
			fxaaSubpix: 0,
			casEnabled: true,
			cartoonEnabled: true
		}
	},
	{
		name: 'all on',
		settings: {
			bloom: true,
			blur: true,
			fxaaEnabled: true,
			fxaaSubpix: 0,
			casEnabled: true,
			cartoonEnabled: true,
			vibranceEnabled: true
		},
		state: { illusion: true, blind: true, zoomFinal: 90 },
		// Eight chained passes amplify per-pass 1-LSB cross-API rounding (smoke/README.md, post page).
		gatePct: 0.1
	},
	{
		name: 'all on + performance',
		settings: {
			bloom: true,
			blur: true,
			fxaaEnabled: true,
			fxaaSubpix: 0,
			casEnabled: true,
			cartoonEnabled: true,
			vibranceEnabled: true,
			performanceMode: true
		},
		state: { illusion: true, blind: true, zoomFinal: 90 }
	}
];

/* ------------------------------------------------------------- scene image */

/** Seeded LCG (deterministic noise). */
function lcg(seed) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/**
 * The synthetic scene at w × h, top-down RGBA8: gradients, hard and diagonal edges, 1 px lines,
 * a checkerboard, saturated patches, black, grey noise and bright (bloom) spots.
 */
function sceneImage(w, h) {
	const out = new Uint8Array(w * h * 4);
	const noise = lcg(1234);
	const noiseTable = new Float32Array(64 * 64).map(() => noise());
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const u = (x + 0.5) / w;
			const v = (y + 0.5) / h;
			// Base: two gradients and a soft wave.
			let r = 255 * u;
			let g = 255 * v;
			let b = 128 + 90 * Math.sin(u * 9 + v * 5);
			// Rotated square (diagonal edges).
			const du = u - 0.3;
			const dv = (v - 0.35) * (h / w);
			if (Math.abs(du + dv) + Math.abs(du - dv) < 0.18) {
				[r, g, b] = [230, 200, 40];
			}
			// Circle.
			if (Math.hypot(u - 0.7, (v - 0.3) * (h / w)) < 0.11) {
				[r, g, b] = [30, 60, 200];
			}
			// Checkerboard (8 px).
			if (u > 0.05 && u < 0.25 && v > 0.65 && v < 0.92) {
				const c = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) * 220 + 20;
				[r, g, b] = [c, c, c];
			}
			// Saturated patches.
			if (v > 0.65 && v < 0.78) {
				const patches = [
					[255, 0, 0],
					[0, 255, 0],
					[0, 0, 255],
					[255, 255, 0],
					[0, 0, 0]
				];
				const i = Math.floor((u - 0.3) / 0.08);
				if (u > 0.3 && i >= 0 && i < patches.length) {
					[r, g, b] = patches[i];
				}
			}
			// Grey noise (subpixel content).
			if (u > 0.3 && u < 0.7 && v > 0.8 && v < 0.95) {
				const n = noiseTable[(y % 64) * 64 + (x % 64)];
				[r, g, b] = [n * 255, n * 230, n * 200];
			}
			// 1 px lines: vertical, horizontal, diagonal.
			if (x === Math.floor(w * 0.5) || y === Math.floor(h * 0.55) || (x - y === 20 && x < w * 0.45)) {
				[r, g, b] = [250, 250, 250];
			}
			// Bright spots (above the 0.88 bloom threshold) on the right.
			for (const [cu, cv, rad] of [
				[0.85, 0.7, 0.03],
				[0.92, 0.85, 0.015],
				[0.8, 0.88, 0.006]
			]) {
				if (Math.hypot(u - cu, (v - cv) * (h / w)) < rad) {
					[r, g, b] = [255, 255, 255];
				}
			}
			const i = (y * w + x) * 4;
			out[i] = Math.round(Math.min(255, Math.max(0, r)));
			out[i + 1] = Math.round(Math.min(255, Math.max(0, g)));
			out[i + 2] = Math.round(Math.min(255, Math.max(0, b)));
			out[i + 3] = 255;
		}
	}
	return out;
}

function flipRows(rgba, w, h) {
	const out = new Uint8Array(rgba.length);
	for (let y = 0; y < h; y++) {
		out.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
	}
	return out;
}

const images = new Map();
/** Scene image at the scene size: `{ topDown, bottomUp }`. */
function sceneFor({ width, height }) {
	const key = `${width}x${height}`;
	if (!images.has(key)) {
		const topDown = sceneImage(width, height);
		images.set(key, { topDown, bottomUp: flipRows(topDown, width, height) });
	}
	return images.get(key);
}

/* ------------------------------------------------------------------ legacy */

const VS = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
out vec4 fragColor;
void main() { fragColor = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0); }`;

/** Draws the scene image into whatever PostProcess.prepare bound (FBO or screen), texel for texel. */
function makeSceneDrawer(gl) {
	const compile = (type, src) => {
		const s = gl.createShader(type);
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			throw new Error(gl.getShaderInfoLog(s));
		}
		return s;
	};
	const program = gl.createProgram();
	gl.attachShader(program, compile(gl.VERTEX_SHADER, VS));
	gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
	gl.linkProgram(program);
	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);
	const buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	const loc = gl.getAttribLocation(program, 'aPosition');
	gl.enableVertexAttribArray(loc);
	gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	const textures = new Map();

	return size => {
		const key = `${size.width}x${size.height}`;
		if (!textures.has(key)) {
			const t = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, t);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA8,
				size.width,
				size.height,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				sceneFor(size).bottomUp
			);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			textures.set(key, t);
		}
		gl.disable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		gl.useProgram(program);
		gl.bindVertexArray(vao);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, textures.get(key));
		gl.uniform1i(gl.getUniformLocation(program, 'uScene'), 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.useProgram(null);
	};
}

const LEGACY_GRAPHICS = { ...POST_DEFAULTS, performanceMode: false };

function applyLegacy(settings, state) {
	Object.assign(graphics, LEGACY_GRAPHICS, settings);
	Blind.setActive(Boolean(state.blind));
	VerticalFlip.setActive(Boolean(state.illusion));
	Camera.zoomFinal = state.zoomFinal ?? 63;
}

/* --------------------------------------------------------- CPU references */

/** R-PP-006 CPU reference over the bottom-up scene (GL orientation: +dy is up), bilinear clamp-to-edge. */
function fxaaCpu(bottomUp, w, h, settings) {
	const u = fxaaUniforms(settings);
	const at = (x, y, c) => bottomUp[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
	const out = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const sample = (dx, dy) => {
				const px = x + dx;
				const py = y + dy;
				const x0 = Math.floor(px);
				const y0 = Math.floor(py);
				const fx = px - x0;
				const fy = py - y0;
				const rgb = [0, 0, 0];
				for (let c = 0; c < 3; c++) {
					const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
					const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
					rgb[c] = (top * (1 - fy) + bottom * fy) / 255;
				}
				return rgb;
			};
			const rgb = fxaaReference(sample, u);
			const i = (y * w + x) * 4;
			for (let c = 0; c < 3; c++) {
				out[i + c] = Math.round(Math.min(1, Math.max(0, rgb[c])) * 255);
			}
			out[i + 3] = 255;
		}
	}
	return out;
}

/* -------------------------------------------------------------------- run */

async function run() {
	const kit = createPageKit({
		width: WIDTH,
		height: HEIGHT,
		antialias: false,
		tolerance: TOLERANCE,
		clearColor: CLEAR
	});
	const { gl } = kit.makeCanvas('legacy PostProcess (WebGL2)');
	const draws = kit.countDraws(gl);
	const drawScene = makeSceneDrawer(gl);

	// MapRenderer.registerPostProcessModules, verbatim order and bloom guard.
	const badWebGL = WebGL.detectBadWebGL(gl);
	if (badWebGL) {
		graphics.bloom = false;
	} else {
		PostProcess.register(Bloom, gl);
	}
	for (const module of [GaussianBlur, FXAA, CAS, Cartoon, Vibrance, VerticalFlip, Blind, Upsampling]) {
		PostProcess.register(module, gl);
	}

	const gpu = await createWebGpuSide({ width: WIDTH, height: HEIGHT, antialias: false, clearColor: CLEAR });
	if (gpu.noAdapter) {
		return { noAdapter: true, error: `no WebGPU adapter: ${gpu.reason}` };
	}
	const { device } = gpu;
	const chain = await new PostChain({ device, format: gpu.format }).init();
	const bloomAllowedProduction = bloomSupported({ ...gpu.info, userAgent: navigator.userAgent });
	// Integration decision #2: the smoke harness renders WebGPU bloom on the software adapter.
	const bloomAllowed = bloomSupported(
		{ ...gpu.info, userAgent: navigator.userAgent },
		{ allowSoftwareAdapter: true }
	);

	const sceneTextures = new Map();
	function webgpuScene(size) {
		const key = `${size.width}x${size.height}`;
		if (!sceneTextures.has(key)) {
			const texture = device.createTexture({
				label: `scene ${key}`,
				size,
				format: 'rgba8unorm',
				usage: TEXTURE_BINDING | TEXTURE_COPY_DST
			});
			device.queue.writeTexture(
				{ texture },
				sceneFor(size).topDown,
				{ bytesPerRow: size.width * 4, rowsPerImage: size.height },
				size
			);
			sceneTextures.set(key, texture);
		}
		return sceneTextures.get(key);
	}

	function renderLegacy(settings, state) {
		applyLegacy(settings, state);
		const before = draws.drawArrays;
		PostProcess.prepare(gl);
		const s = { ...LEGACY_GRAPHICS, ...settings };
		const scale = s.performanceMode ? 0.75 : 1;
		const active = [Bloom, GaussianBlur, FXAA, CAS, Cartoon, Vibrance, VerticalFlip, Blind, Upsampling].some(m =>
			m.isActive()
		);
		drawScene(
			active
				? { width: Math.floor(WIDTH * scale), height: Math.floor(HEIGHT * scale) }
				: { width: WIDTH, height: HEIGHT }
		);
		PostProcess.render(gl);
		return { pixels: kit.readPixels(gl), draws: draws.drawArrays - before - 1 };
	}

	async function renderWebGpu(settings, state) {
		const graph = buildPostPasses({ ...settings }, { ...state, bloomAllowed }, { width: WIDTH, height: HEIGHT });
		const scene = webgpuScene(graph.sizes.scene);
		const { pixels } = await gpu.present(null, (encoder, swapView) =>
			chain.encode(encoder, graph, scene, swapView)
		);
		return { pixels, graph };
	}

	const results = [];
	for (const config of CONFIGS) {
		const settings = config.settings ?? {};
		const state = config.state ?? {};
		const legacy = renderLegacy({ ...settings, ...config.legacy }, state);
		const modern = await renderWebGpu(settings, state);
		const vsLegacy = kit.compare(legacy.pixels, modern.pixels);
		let gate = vsLegacy;
		let gatedAgainst = config.legacy ? 'legacy (declared fix: legacy side without the module)' : 'legacy';
		if (config.reference === 'fxaa-cpu') {
			const size = modern.graph.sizes.scene;
			const reference = fxaaCpu(sceneFor(size).bottomUp, size.width, size.height, {
				...POST_DEFAULTS,
				...settings
			});
			gate = kit.compare(reference, modern.pixels);
			gatedAgainst = 'CPU reference (src/post/fxaa.js)';
		}
		results.push({
			name: config.name,
			gatedAgainst,
			gatePct: config.gatePct,
			passes: modern.graph.passes.map(
				p =>
					`${p.name}:${p.input}${p.input2 ? `+${p.input2}` : ''}→${p.output}@${p.size.width}x${p.size.height}`
			),
			legacyModuleDraws: legacy.draws,
			...gate,
			vsLegacy: config.reference ? vsLegacy : undefined,
			images: {
				legacy: gpu.toPng(legacy.pixels),
				modern: gpu.toPng(modern.pixels),
				diff: kit.diffImage(legacy.pixels, modern.pixels)
			}
		});
	}

	// Sensitivity control: WebGPU bloom intensity 0.5 vs legacy 0.55 must differ.
	const controlLegacy = renderLegacy({ bloom: true, bloomIntensity: 0.55 }, {});
	const controlModern = await renderWebGpu({ bloom: true, bloomIntensity: 0.5 }, {});
	const control = kit.compare(controlLegacy.pixels, controlModern.pixels);

	await device.queue.onSubmittedWorkDone();
	return {
		ok: true,
		page: 'post',
		adapter: gpu.adapter,
		fallbackAdapter: gpu.fallbackAdapter,
		legacyRenderer: `${gl.getParameter(gl.VENDOR)} / ${gl.getParameter(gl.RENDERER)}`,
		legacyBadWebGL: badWebGL,
		bloomAllowedProduction,
		bloomAllowed,
		userAgent: navigator.userAgent,
		size: [WIDTH, HEIGHT],
		canvasFormat: gpu.format,
		tolerance: TOLERANCE,
		pipelines: chain.pipelines.size,
		glError: gl.getError(),
		gpuErrors: gpu.errors,
		configs: results,
		control: { differing: control.differing, maxDiff: control.maxDiff }
	};
}

run()
	.then(result => {
		window.__parity = result;
	})
	.catch(e => {
		console.error(e);
		window.__parity = { ok: false, error: String(e?.stack ?? e) };
	});
