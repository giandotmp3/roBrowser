/**
 * Pixel parity page: the same SpriteDraw records drawn by the legacy
 * SpriteRenderer (WebGL2, one drawArrays per layer, driven through its static
 * API) and by gpu-webgpu (WebGPU, one instanced draw per run into the
 * rgba8unorm offscreen target, then blitted to the canvas), read back and
 * compared. Results land on `window.__parity` for smoke/run-parity.mjs.
 */
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import Camera from './cameraStub.js';
import { OffscreenTarget } from '../src/target/OffscreenTarget.js';
import { Blit } from '../src/target/Blit.js';
import { SpriteResidency } from '../src/residency/SpriteResidency.js';
import { TextureArrayPools } from '../src/residency/TextureArrayPools.js';
import { SpriteRunRenderer } from '../src/sprites/SpriteRunRenderer.js';
import { CAMERA, FOG, FRAMES, PALETTES, buildRecords, viewMatrices } from './scene.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 320);
const HEIGHT = Number(params.get('h') ?? 240);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
const CLEAR = [0.12, 0.14, 0.12, 1];

/** GPUTextureUsage / GPUBufferUsage / GPUMapMode bits. */
const TEXTURE_COPY_SRC = 0x01;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const BUFFER_MAP_READ = 0x01;
const BUFFER_COPY_DST = 0x08;
const MAP_READ = 0x01;

function addCanvas(label) {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	canvas.title = label;
	document.getElementById('canvases').append(canvas);
	return canvas;
}

/* ------------------------------------------------------------------ legacy */

function makeLegacy() {
	const canvas = addCanvas('legacy SpriteRenderer (WebGL2)');
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
	// Count draw calls without touching the renderer.
	const draws = { drawArrays: 0 };
	const original = gl.drawArrays.bind(gl);
	gl.drawArrays = (...args) => {
		draws.drawArrays++;
		return original(...args);
	};
	return { canvas, gl, draws };
}

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
	gl.viewport(0, 0, WIDTH, HEIGHT);
	gl.clearColor(...CLEAR);
	gl.clearDepth(1);
	gl.depthMask(true);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

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

/** Bottom-up RGBA rows, as gl.readPixels returns them. */
function readLegacy(gl) {
	const out = new Uint8Array(WIDTH * HEIGHT * 4);
	gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, out);
	return out;
}

/* -------------------------------------------------------------- gpu-webgpu */

async function makeModern() {
	if (!navigator.gpu) {
		return { noAdapter: true, reason: 'navigator.gpu missing' };
	}
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) {
		return { noAdapter: true, reason: 'requestAdapter() returned null' };
	}
	const device = await adapter.requestDevice();
	const errors = [];
	device.addEventListener('uncapturederror', e => errors.push(String(e.error?.message ?? e.error)));
	device.lost.then(info => errors.push(`device lost: ${info.reason} ${info.message}`));

	const canvas = addCanvas('gpu-webgpu');
	const context = canvas.getContext('webgpu');
	const format = navigator.gpu.getPreferredCanvasFormat();
	context.configure({
		device,
		format,
		alphaMode: 'opaque',
		usage: TEXTURE_RENDER_ATTACHMENT | TEXTURE_COPY_SRC
	});

	const sampleCount = ANTIALIAS ? 4 : 1;
	const target = new OffscreenTarget(device, { sampleCount });
	target.resize(WIDTH, HEIGHT);

	const pools = new TextureArrayPools({ device });
	const residency = new SpriteResidency({ uploader: pools, now: () => performance.now() });
	for (const [handle, frame] of Object.entries(FRAMES)) {
		residency.upload(handle, frame);
	}
	for (const [handle, rgba] of Object.entries(PALETTES)) {
		residency.uploadPalette(handle, rgba);
	}

	const sprites = new SpriteRunRenderer({ device, residency, sampleCount });
	await sprites.init();
	const shaderMessages = (await sprites.module.getCompilationInfo()).messages.map(
		m => `${m.type} ${m.lineNum}:${m.linePos} ${m.message}`
	);
	await sprites.pipelines.settled();
	const blit = await new Blit({ device, format }).init();

	const info = adapter.info ?? {};
	return {
		device,
		context,
		format,
		target,
		sprites,
		blit,
		errors,
		shaderMessages,
		adapter: `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.trim(),
		fallbackAdapter: Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter)
	};
}

/**
 * Draw the records into the offscreen target, blit to the canvas, and read the
 * canvas texture back (copyTextureToBuffer + mapAsync). Returns bottom-up RGBA
 * rows so the bytes line up with gl.readPixels.
 */
async function drawModern(m, records, view, fog) {
	const { device, context, target, sprites, blit } = m;
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass(target.passDescriptor(CLEAR));
	const stats = sprites.encode(pass, records, {
		modelView: view.modelView,
		projection: view.projection,
		zoom: Camera.zoom,
		fog: { use: fog.use && fog.exist, near: fog.near, far: fog.far, color: fog.color }
	});
	pass.end();

	const swap = context.getCurrentTexture();
	blit.encode(encoder, target.resolve, swap.createView());

	const bytesPerRow = Math.ceil((WIDTH * 4) / 256) * 256; // copy rows are 256-byte aligned
	const buffer = device.createBuffer({ size: bytesPerRow * HEIGHT, usage: BUFFER_MAP_READ | BUFFER_COPY_DST });
	encoder.copyTextureToBuffer(
		{ texture: swap },
		{ buffer, bytesPerRow, rowsPerImage: HEIGHT },
		{ width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 }
	);
	device.queue.submit([encoder.finish()]);
	await buffer.mapAsync(MAP_READ);
	const src = new Uint8Array(buffer.getMappedRange());
	const bgra = m.format.startsWith('bgra');
	const out = new Uint8Array(WIDTH * HEIGHT * 4);
	for (let y = 0; y < HEIGHT; y++) {
		const s = y * bytesPerRow;
		const d = (HEIGHT - 1 - y) * WIDTH * 4; // WebGPU row 0 is the top; GL's is the bottom
		for (let x = 0; x < WIDTH * 4; x += 4) {
			out[d + x] = src[s + x + (bgra ? 2 : 0)];
			out[d + x + 1] = src[s + x + 1];
			out[d + x + 2] = src[s + x + (bgra ? 0 : 2)];
			// The canvas is alphaMode 'opaque' (legacy: alpha:false): stored alpha is never
			// displayed, and legacy's RGB backbuffer reads back 255. Compare what is shown.
			out[d + x + 3] = 255;
		}
	}
	buffer.unmap();
	buffer.destroy();
	return { pixels: out, stats };
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

/** Bottom-up RGBA rows → PNG data URL (screen orientation). */
function toPng(rows) {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext('2d');
	const img = ctx.createImageData(WIDTH, HEIGHT);
	for (let y = 0; y < HEIGHT; y++) {
		img.data.set(rows.subarray((HEIGHT - 1 - y) * WIDTH * 4, (HEIGHT - y) * WIDTH * 4), y * WIDTH * 4);
	}
	ctx.putImageData(img, 0, 0);
	return canvas.toDataURL('image/png');
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

async function run() {
	const modern = await makeModern();
	if (modern.noAdapter) {
		return { ok: false, noAdapter: true, error: `no WebGPU adapter: ${modern.reason}` };
	}
	const legacy = makeLegacy();
	const legacyAssets = legacyUploads(legacy.gl);
	const records = buildRecords();
	const view = viewMatrices(WIDTH, HEIGHT);
	const debug = legacy.gl.getExtension('WEBGL_debug_renderer_info');
	const legacyRenderer = debug ? legacy.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

	const frames = [];
	for (const [name, fog] of [
		['no-fog', { ...FOG, use: false }],
		['fog', FOG]
	]) {
		legacy.draws.drawArrays = 0;
		drawLegacy(legacy.gl, legacyAssets, records, view, fog);
		const a = readLegacy(legacy.gl);
		const { pixels: b, stats } = await drawModern(modern, records, view, fog);
		frames.push({
			name,
			...compare(a, b),
			legacyDrawCalls: legacy.draws.drawArrays,
			modernDrawCalls: stats.drawCalls,
			fallbacks: stats.fallbacks,
			runs: modern.sprites.lastRuns.map(r => r.count),
			images: { legacy: toPng(a), modern: toPng(b), diff: diffImage(a, b) }
		});
	}

	// Sensitivity control: nudge one mid-stack record by 0.01 world units in the
	// modern stream only. The comparison must see it, or the harness proves nothing.
	const nudged = records.map((r, i) =>
		i === 20 ? { ...r, position: [r.position[0] + 0.01, ...r.position.slice(1)] } : r
	);
	drawLegacy(legacy.gl, legacyAssets, records, view, FOG);
	const control = compare(readLegacy(legacy.gl), (await drawModern(modern, nudged, view, FOG)).pixels);

	// #64 control: legacy with its raw palettes (index 255 wraps to entry 0) must differ
	// from the fixed lookup, or the scene does not exercise index 255.
	drawLegacy(legacy.gl, legacyUploads(legacy.gl, { compensate: false }), records, view, FOG);
	const control64 = compare(readLegacy(legacy.gl), (await drawModern(modern, records, view, FOG)).pixels);

	// Diagnostics (?isolate=1): each record drawn alone, so a mismatch names its record.
	const isolated = [];
	if (params.get('isolate') === '1') {
		for (let i = 0; i < records.length; i++) {
			drawLegacy(legacy.gl, legacyAssets, [records[i]], view, FOG);
			const d = compare(readLegacy(legacy.gl), (await drawModern(modern, [records[i]], view, FOG)).pixels);
			const r = records[i];
			isolated.push({ i, texture: r.texture, differing: d.differing, maxDiff: d.maxDiff, covered: d.coveredPct });
		}
	}

	await modern.device.queue.onSubmittedWorkDone();
	return {
		isolated,
		ok: true,
		adapter: modern.adapter,
		fallbackAdapter: modern.fallbackAdapter,
		legacyRenderer,
		canvasFormat: modern.format,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: records.length,
		camera: CAMERA,
		glError: legacy.gl.getError(),
		gpuErrors: modern.errors,
		shaderMessages: modern.shaderMessages,
		pipelines: modern.sprites.pipelines.readyCount,
		control: { differing: control.differing, maxDiff: control.maxDiff },
		control64: { differing: control64.differing, maxDiff: control64.maxDiff },
		frames
	};
}

run()
	.catch(error => ({ ok: false, error: String(error?.stack ?? error) }))
	.then(result => {
		window.__parity = result;
		document.getElementById('log').textContent = JSON.stringify(
			result,
			(key, value) => (key === 'images' ? '[omitted]' : value),
			2
		);
	});
