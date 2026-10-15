/**
 * Real-stream parity page for gpu-webgpu (port of gpu-webgl2/smoke/entities.js):
 * the REAL legacy entity render path (Renderer/EntityManager.js → Entity.js and
 * its mixins → EntityRender.js → SpriteRenderer.js, all unmodified) draws a
 * ~200-entity scene into a WebGL2 canvas in one EntityManager.render pass per
 * frame, with its own depth sort. Every draw is captured from
 * SpriteRenderer.addRecordSink; gpu-webgpu then draws those same records into a
 * WebGPU canvas (SpriteRunRenderer + SpriteResidency + TextureArrayPools, frames
 * and palettes uploaded on miss from the same raw SPR data, offscreen target +
 * blit). Pixels are compared. Results land on `window.__parity` for
 * smoke/run-parity.mjs.
 */
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
// EntityManager before Entity: their circular import needs that order.
import EntityManager from 'Renderer/EntityManager.js';
import Entity from 'Renderer/Entity/Entity.js';
import StatusConst from 'DB/Status/StatusState.js';
import Camera from './cameraStub.js';
import { files, graphics, renderer } from './entities/stubs.js';
import { buildAssets, rng } from './entities/assets.js';
import { CAMERA, COUNTS, FOG, spawnScene } from './entities/scene.js';
import { cameraMatrices, createPageKit } from './common.js';
import { createWebGpuSide } from './webgpuKit.js';
import { SpriteResidency } from '../src/residency/SpriteResidency.js';
import { TextureArrayPools } from '../src/residency/TextureArrayPools.js';
import { SpriteRunRenderer } from '../src/sprites/SpriteRunRenderer.js';
import { fromLegacySpriteRecord } from '../src/sprites/legacyRecord.js';
import { batchKey } from '../src/sprites/runs.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
const CLEAR = [0.12, 0.14, 0.12, 1];
const EPOCH_MS = 1_700_000_000_000;
const FRAME_MS = 40;
/**
 * Captured frames (same as gpu-webgl2): name, clock (ms after spawn), fog, and what
 * happens to gpu-webgpu residency first: `evict` frees every slot and row (idle
 * eviction with age 0, so the frame re-uploads into recycled free-list layers);
 * `purge` is the device-loss purge (pools destroyed, every slot and row forgotten,
 * everything re-uploaded on miss). Frames in between still render on the legacy side.
 */
const CAPTURES = Object.freeze([
	{ name: 'entities-t120', at: 120, fog: false },
	{ name: 'entities-t520-fog-evicted', at: 520, fog: true, residency: 'evict' },
	{ name: 'entities-t1240-purged', at: 1240, fog: false, residency: 'purge' }
]);

const kit = createPageKit({
	width: WIDTH,
	height: HEIGHT,
	antialias: ANTIALIAS,
	tolerance: TOLERANCE,
	clearColor: CLEAR
});

/** Seeded Math.random and a fake Date.now / performance.now, as the root suite's determinism harness. */
function installClock(seed) {
	const saved = { random: Math.random, dateNow: Date.now, perfNow: performance.now };
	const clock = { now: 0 };
	Math.random = rng(seed);
	Date.now = () => EPOCH_MS + clock.now;
	performance.now = () => clock.now;
	clock.restore = () => {
		Math.random = saved.random;
		Date.now = saved.dateNow;
		performance.now = saved.perfNow;
	};
	return clock;
}

/**
 * Why runs break. `changes`: for each pair of consecutive records, which
 * pipeline-state fields changed (render-records run boundaries; a pair may count
 * under several). `batch`: the same, only at the boundaries gpu-webgpu actually
 * draws (batchKey: texture class no longer splits sprite batches).
 */
function runBreaks(records, mixTextureClasses) {
	const changes = { textureClass: 0, blend: 0, depthTest: 0, depthWrite: 0 };
	const batch = { textureClass: 0, blend: 0, depthTest: 0, depthWrite: 0 };
	for (let i = 1; i < records.length; i++) {
		const a = records[i - 1];
		const b = records[i];
		const split = batchKey(a, { mixTextureClasses }) !== batchKey(b, { mixTextureClasses });
		for (const field of Object.keys(changes)) {
			if (a[field] !== b[field]) {
				changes[field]++;
				if (split) {
					batch[field]++;
				}
			}
		}
	}
	return { changes, batch };
}

/** Entities still in the legacy manager (dying mobs leave after their fade). */
function liveEntities() {
	let n = 0;
	EntityManager.forEach(() => {
		n++;
	});
	return n;
}

/** One gpu-webgpu sprite path: pools, upload-on-miss residency and the run renderer. */
async function createSpritePath(gpu, source) {
	const residency = new SpriteResidency({
		uploader: new TextureArrayPools({ device: gpu.device }),
		now: () => performance.now(),
		source
	});
	const sprites = await new SpriteRunRenderer({ device: gpu.device, residency, sampleCount: gpu.sampleCount }).init();
	await sprites.pipelines.settled();
	return { residency, sprites };
}

async function run() {
	const gpu = await createWebGpuSide({ width: WIDTH, height: HEIGHT, antialias: ANTIALIAS, clearColor: CLEAR });
	if (gpu.noAdapter) {
		return { ok: false, noAdapter: true, error: `no WebGPU adapter: ${gpu.reason}` };
	}
	const legacy = kit.makeCanvas('legacy entity path (WebGL2)');
	const legacyDraws = kit.countDraws(legacy.gl);
	const debug = legacy.gl.getExtension('WEBGL_debug_renderer_info');
	const legacyRenderer = debug ? legacy.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

	// Legacy side: assets in the legacy context, Client.loadFile answers from `files`.
	const assets = buildAssets(legacy.gl, { pixelPerfectSprites: graphics.pixelPerfectSprites });
	for (const [path, data] of assets.files) {
		files.set(path, data);
	}
	const view = cameraMatrices(CAMERA, WIDTH, HEIGHT);
	Camera.zoom = CAMERA.distance;
	Camera.direction = 0;
	Camera.modelView.set(view.modelView);
	Camera.projection.set(view.projection);
	renderer.width = WIDTH;
	renderer.height = HEIGHT;

	// gpu-webgpu side: residency with upload-on-miss from the same raw frames.
	const source = assets.source();
	const main = await createSpritePath(gpu, source);
	const shaderMessages = (await main.sprites.module.getCompilationInfo()).messages.map(
		m => `${m.type} ${m.lineNum}:${m.linePos} ${m.message}`
	);
	const toModern = native =>
		fromLegacySpriteRecord(native, {
			textureHandle: assets.textureHandle,
			paletteHandle: assets.paletteHandle,
			pixelPerfectSprites: graphics.pixelPerfectSprites
		});
	const fogOf = on => ({ ...FOG, use: on });
	const drawModern = (records, fog, path = main) =>
		gpu.render(pass => {
			path.residency.beginFrame();
			return path.sprites.encode(pass, records, {
				modelView: view.modelView,
				projection: view.projection,
				zoom: Camera.zoom,
				fog: { use: fog.use && fog.exist, near: fog.near, far: fog.far, color: fog.color }
			});
		});

	// R-CTX-002 default state on the legacy context, as Renderer.js sets it.
	const lgl = legacy.gl;
	lgl.enable(lgl.DEPTH_TEST);
	lgl.depthFunc(lgl.LEQUAL);
	lgl.enable(lgl.BLEND);
	lgl.blendFunc(lgl.SRC_ALPHA, lgl.ONE_MINUS_SRC_ALPHA);
	SpriteRenderer.init(lgl);

	const clock = installClock(0x5eed);
	const frames = [];
	let control = null;
	let control64 = null;
	let features;
	try {
		({ features } = spawnScene({ Entity, EntityManager, StatusConst }));
		const last = CAPTURES[CAPTURES.length - 1].at;
		for (let t = 0; t <= last; t += FRAME_MS) {
			clock.now = t;
			renderer.tick = t;
			const capture = CAPTURES.find(c => c.at === t);
			const fog = fogOf(Boolean(capture?.fog));
			const native = [];
			const stop = capture ? SpriteRenderer.addRecordSink(r => native.push(r)) : null;
			legacyDraws.drawArrays = 0;
			kit.clear(lgl);
			EntityManager.render(lgl, view.modelView, view.projection, fog, false);
			lgl.finish();
			stop?.();
			if (!capture) {
				continue;
			}

			const records = native.map(toModern);
			const unmapped = records.filter(
				r => r.texture === null || (r.textureClass === 'indexed' && r.palette === null)
			);
			const legacyDrawCalls = legacyDraws.drawArrays;
			const a = kit.readPixels(lgl);
			const legacyPng = legacy.canvas.toDataURL('image/png');
			if (capture.residency === 'evict') {
				main.residency.evictIdle(-1);
			} else if (capture.residency === 'purge') {
				main.residency.uploader.dispose(); // as the lost device took every texture with it
				main.residency.purgeAll();
			}
			const { pixels: b, result: stats } = await drawModern(records, fog);
			frames.push({
				name: capture.name,
				...kit.compare(a, b),
				records: records.length,
				entities: liveEntities(),
				additive: records.filter(r => r.blend.dst === 'ONE').length,
				indexed: records.filter(r => r.textureClass === 'indexed').length,
				unmapped: unmapped.length,
				uploads: main.sprites.lastUploads,
				resident: { frames: main.residency.residentCount, palettes: main.residency.paletteCount },
				legacyDrawCalls,
				modernDrawCalls: stats.drawCalls,
				fallbacks: stats.fallbacks,
				runs: main.sprites.lastRuns.length,
				batches: main.sprites.lastBatches.map(r => r.count),
				breaks: runBreaks(records, main.sprites.mixTextureClasses),
				images: { legacy: legacyPng, modern: gpu.toPng(b), diff: kit.diffImage(a, b) }
			});

			if (frames.length === 1) {
				// Sensitivity control: nudge one record by 0.01 world units in the gpu-webgpu
				// stream only (the last opaque-ish one: drawn on top, so it is visible).
				const target = records.findLastIndex(r => r.color[3] > 0.5);
				const nudged = records.map((r, i) =>
					i === target ? { ...r, position: [r.position[0] + 0.01, r.position[1], r.position[2]] } : r
				);
				control = kit.compare(a, (await drawModern(nudged, fog)).pixels);
				// #64 control: gpu-webgpu with the legacy wrap emulated (index 255 shows entry 0)
				// must differ from the compensated legacy frame, or no record uses index 255.
				const wrapped = await createSpritePath(gpu, assets.source({ wrapPalettes: true }));
				control64 = kit.compare(a, (await drawModern(records, fog, wrapped)).pixels);
				wrapped.residency.uploader.dispose();
			}
		}
	} finally {
		clock.restore();
	}

	await gpu.device.queue.onSubmittedWorkDone();
	return {
		ok: true,
		page: 'entities',
		adapter: gpu.adapter,
		fallbackAdapter: gpu.fallbackAdapter,
		legacyRenderer,
		canvasFormat: gpu.format,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: frames.map(f => f.records),
		scene: { counts: COUNTS, features, assets: assets.counts },
		residency: { ...main.residency.stats, decodes: source.decodes.size },
		glError: lgl.getError(),
		gpuErrors: gpu.errors,
		shaderMessages,
		pipelines: main.sprites.pipelines.readyCount,
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
