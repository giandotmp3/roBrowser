/**
 * Pixel parity page: the same SpriteDraw records drawn by the legacy
 * SpriteRenderer (one drawArrays per layer, driven through its static API) and
 * by gpu-webgl2 (one drawArraysInstanced per run), then read back and compared.
 * Results land on `window.__parity` for smoke/run-parity.mjs.
 */
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import Camera from './cameraStub.js';
import { applyDefaultState } from '../src/device/GLDevice.js';
import { GLStateCache } from '../src/pipeline/GLStateCache.js';
import { Residency } from '../src/residency/Residency.js';
import { TextureArrayPools } from '../src/residency/TextureArrayPools.js';
import { RunRenderer } from '../src/batching/RunRenderer.js';
import { CAMERA, FOG, FRAMES, PALETTES, buildRecords, viewMatrices } from './scene.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 320);
const HEIGHT = Number(params.get('h') ?? 240);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
const CLEAR = [0.12, 0.14, 0.12, 1];

function makeCanvas(label) {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	canvas.title = label;
	document.getElementById('canvases').append(canvas);
	const gl = canvas.getContext('webgl2', {
		alpha: false,
		depth: true,
		stencil: false,
		antialias: ANTIALIAS,
		premultipliedAlpha: false,
		preserveDrawingBuffer: true
	});
	if (!gl) {
		throw new Error('WebGL2 unavailable');
	}
	return { canvas, gl };
}

/** Count draw calls on one context without touching the renderers. */
function countDraws(gl) {
	const counts = { drawArrays: 0, drawArraysInstanced: 0 };
	for (const name of Object.keys(counts)) {
		const original = gl[name].bind(gl);
		gl[name] = (...args) => {
			counts[name]++;
			return original(...args);
		};
	}
	return counts;
}

function clear(gl) {
	gl.viewport(0, 0, WIDTH, HEIGHT);
	gl.clearColor(...CLEAR);
	gl.clearDepth(1);
	gl.depthMask(true);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

function readPixels(gl) {
	const out = new Uint8Array(WIDTH * HEIGHT * 4);
	gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, out);
	return out;
}

/* ------------------------------------------------------------------ legacy */

/**
 * Spec #64 (fixed in the rebuild): legacy's REPEAT-wrapped palette lookup shows entry 0
 * for index 255. Index 0 is transparent and never looked up, so copying entry 255 into
 * entry 0 makes legacy display exactly what the fixed lookup shows: the parity frames
 * then prove the fix pixel-for-pixel. The #64 control renders legacy with the raw table.
 */
function compensate64(rgba) {
	const out = new Uint8Array(rgba);
	out.set(rgba.subarray(255 * 4, 256 * 4), 0);
	return out;
}

function legacyUploads(gl, { compensate = true } = {}) {
	// As Core/Client.js uploads SPR frames and palettes (per-frame TEXTURE_2D).
	const textures = new Map();
	for (const [handle, frame] of Object.entries(FRAMES)) {
		const filters = frame.format === 'r8' ? ['nearest'] : ['linear', 'nearest'];
		for (const filter of filters) {
			const texture = gl.createTexture();
			const format = frame.format === 'r8' ? gl.LUMINANCE : gl.RGBA;
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, format, frame.width, frame.height, 0, format, gl.UNSIGNED_BYTE, frame.data);
			const f = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			textures.set(`${handle}|${filter}`, texture);
		}
	}
	const palettes = new Map();
	for (const [handle, rgba] of Object.entries(PALETTES)) {
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			256,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			compensate ? compensate64(rgba) : rgba
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		palettes.set(handle, texture);
	}
	return { textures, palettes };
}

function drawLegacy(gl, assets, records, view, fog) {
	// R-CTX-002 default state, as Renderer.js sets it.
	gl.enable(gl.DEPTH_TEST);
	gl.depthFunc(gl.LEQUAL);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	clear(gl);

	const SR = SpriteRenderer;
	SR.init(gl);
	SR.bind3DContext(gl, view.modelView, view.projection, fog);
	for (const r of records) {
		const sampler = r.textureClass === 'indexed' ? 'nearest' : r.sampler;
		SR.image.texture = assets.textures.get(`${r.texture}|${sampler}`);
		SR.image.palette = r.palette ? assets.palettes.get(r.palette) : null;
		if (r.paletteSize) {
			SR.image.size.set(r.paletteSize);
		}
		SR.sprite = null;
		SR.position.set(r.position);
		SR.offset.set(r.offset);
		SR.size.set(r.size);
		SR.xSize = r.xSize;
		SR.ySize = r.ySize;
		SR.angle = r.angle;
		SR.color.set(r.color);
		SR.shadow = r.shadowFactor;
		SR.zIndex = r.zIndex;
		SR.depth = r.depthBias;
		SR.ignoreDepthMinCap = r.ignoreDepthMinCap;
		const additive = r.blend.src === 'SRC_ALPHA' && r.blend.dst === 'ONE';
		SR.runWithDepth(r.depthTest, r.depthWrite, !r.depthCorrection, () => SR.render(additive));
	}
	SR.unbind(gl);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.finish();
}

/* -------------------------------------------------------------- gpu-webgl2 */

function modernUploads(gl) {
	const residency = new Residency({ uploader: new TextureArrayPools({ gl }), now: () => performance.now() });
	for (const [handle, frame] of Object.entries(FRAMES)) {
		residency.upload(handle, frame);
	}
	for (const [handle, rgba] of Object.entries(PALETTES)) {
		residency.uploadPalette(handle, rgba);
	}
	return residency;
}

function drawModern(gl, residency, records, view, fog) {
	applyDefaultState(gl);
	clear(gl);
	const runs = new RunRenderer({ gl, state: new GLStateCache(gl), residency });
	runs.draw(records, {
		modelView: view.modelView,
		projection: view.projection,
		zoom: Camera.zoom,
		fog: { use: fog.use && fog.exist, near: fog.near, far: fog.far, color: fog.color }
	});
	gl.finish();
	return runs;
}

/* ----------------------------------------------------------------- compare */

function compare(a, b) {
	let maxDiff = 0;
	let differing = 0;
	let overTolerance = 0;
	let covered = 0;
	const histogram = new Array(9).fill(0); // max channel diff buckets: 0,1,2,3,4-7,8-15,16-63,64-127,128+
	const bg = CLEAR.map(v => Math.round(v * 255));
	for (let i = 0; i < a.length; i += 4) {
		let d = 0;
		for (let c = 0; c < 4; c++) {
			d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
		}
		if (a[i] !== bg[0] || a[i + 1] !== bg[1] || a[i + 2] !== bg[2]) {
			covered++;
		}
		maxDiff = Math.max(maxDiff, d);
		if (d > 0) {
			differing++;
		}
		if (d > TOLERANCE) {
			overTolerance++;
		}
		const bucket = d < 4 ? d : d < 8 ? 4 : d < 16 ? 5 : d < 64 ? 6 : d < 128 ? 7 : 8;
		histogram[bucket]++;
	}
	const pixels = a.length / 4;
	return {
		pixels,
		coveredPct: (100 * covered) / pixels,
		maxDiff,
		differing,
		differingPct: (100 * differing) / pixels,
		overTolerance,
		overTolerancePct: (100 * overTolerance) / pixels,
		histogram
	};
}

/** Diff image (amplified ×16, red) as a data URL, flipped to screen orientation. */
function diffImage(a, b) {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext('2d');
	const img = ctx.createImageData(WIDTH, HEIGHT);
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const s = ((HEIGHT - 1 - y) * WIDTH + x) * 4;
			const d = (y * WIDTH + x) * 4;
			let m = 0;
			for (let c = 0; c < 3; c++) {
				m = Math.max(m, Math.abs(a[s + c] - b[s + c]));
			}
			img.data[d] = Math.min(255, m * 16);
			img.data[d + 1] = a[s + 1] >> 2;
			img.data[d + 2] = a[s + 2] >> 2;
			img.data[d + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	document.getElementById('canvases').append(canvas);
	return canvas.toDataURL('image/png');
}

/* -------------------------------------------------------------------- main */

function run() {
	const legacy = makeCanvas('legacy SpriteRenderer');
	const modern = makeCanvas('gpu-webgl2');
	const legacyDraws = countDraws(legacy.gl);
	const modernDraws = countDraws(modern.gl);
	const legacyAssets = legacyUploads(legacy.gl);
	const residency = modernUploads(modern.gl);
	const records = buildRecords();
	const view = viewMatrices(WIDTH, HEIGHT);
	const debug = modern.gl.getExtension('WEBGL_debug_renderer_info');
	const rendererName = debug ? modern.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

	const frames = [];
	for (const [name, fog] of [
		['no-fog', { ...FOG, use: false }],
		['fog', FOG]
	]) {
		legacyDraws.drawArrays = 0;
		modernDraws.drawArraysInstanced = 0;
		drawLegacy(legacy.gl, legacyAssets, records, view, fog);
		const runs = drawModern(modern.gl, residency, records, view, fog);
		const a = readPixels(legacy.gl);
		const b = readPixels(modern.gl);
		const stats = compare(a, b);
		frames.push({
			name,
			...stats,
			legacyDrawCalls: legacyDraws.drawArrays,
			modernDrawCalls: modernDraws.drawArraysInstanced,
			runs: runs.lastRuns.map(r => r.count),
			images: {
				legacy: legacy.canvas.toDataURL('image/png'),
				modern: modern.canvas.toDataURL('image/png'),
				diff: diffImage(a, b)
			}
		});
	}

	// Sensitivity control: nudge one mid-stack record by 0.01 world units in the
	// modern stream only. The comparison must see it, or the harness proves nothing.
	const nudged = records.map((r, i) =>
		i === 20 ? { ...r, position: [r.position[0] + 0.01, ...r.position.slice(1)] } : r
	);
	drawLegacy(legacy.gl, legacyAssets, records, view, FOG);
	drawModern(modern.gl, residency, nudged, view, FOG);
	const control = compare(readPixels(legacy.gl), readPixels(modern.gl));

	// #64 control: legacy with its raw palettes (index 255 wraps to entry 0) must differ
	// from the fixed lookup, or the scene does not exercise index 255.
	const rawAssets = legacyUploads(legacy.gl, { compensate: false });
	drawLegacy(legacy.gl, rawAssets, records, view, FOG);
	drawModern(modern.gl, residency, records, view, FOG);
	const control64 = compare(readPixels(legacy.gl), readPixels(modern.gl));

	const glErrors = { legacy: legacy.gl.getError(), modern: modern.gl.getError() };
	return {
		ok: true,
		renderer: rendererName,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: records.length,
		camera: CAMERA,
		glErrors,
		control: { differing: control.differing, maxDiff: control.maxDiff },
		control64: { differing: control64.differing, maxDiff: control64.maxDiff },
		frames
	};
}

try {
	window.__parity = run();
} catch (error) {
	window.__parity = { ok: false, error: String(error?.stack ?? error) };
}
document.getElementById('log').textContent = JSON.stringify(
	window.__parity,
	(key, value) => (key === 'images' ? '[omitted]' : value),
	2
);
