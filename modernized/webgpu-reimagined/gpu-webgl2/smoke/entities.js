/**
 * Real-stream parity page (phase 3b): the REAL legacy entity render path
 * (Renderer/EntityManager.js → Entity.js and its mixins → EntityRender.js →
 * SpriteRenderer.js, all unmodified) draws a ~200-entity scene into canvas A in one
 * EntityManager.render pass per frame, with its own depth sort. Every draw is
 * captured from SpriteRenderer.addRecordSink; gpu-webgl2 then draws those same
 * records into canvas B (RunRenderer + SpritePipeline + Residency, frames and
 * palettes uploaded on miss from the same raw SPR data). Pixels are compared.
 * Results land on `window.__parity` for smoke/run-parity.mjs.
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
import { applyDefaultState } from '../src/device/GLDevice.js';
import { GLStateCache } from '../src/pipeline/GLStateCache.js';
import { Residency } from '../src/residency/Residency.js';
import { TextureArrayPools } from '../src/residency/TextureArrayPools.js';
import { RunRenderer } from '../src/batching/RunRenderer.js';
import { fromLegacySpriteRecord } from '../src/sprites/legacyRecord.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
const CLEAR = [0.12, 0.14, 0.12, 1];
const EPOCH_MS = 1_700_000_000_000;
const FRAME_MS = 40;
/**
 * Captured frames: name, clock (ms after spawn), fog, and what happens to gpu-webgl2
 * residency first: `evict` frees every slot and row (idle eviction with age 0, so the
 * frame re-uploads into recycled free-list layers); `purge` is the context-loss purge
 * (every pool and row forgotten, everything re-uploaded on miss). Frames in between
 * still render on the legacy side (legacy keeps playing).
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
 * Why runs break: for each pair of consecutive records in different runs, which
 * pipeline-state fields changed (a break may count under several).
 */
function runBreaks(records) {
	const breaks = { textureClass: 0, blend: 0, depthTest: 0, depthWrite: 0 };
	for (let i = 1; i < records.length; i++) {
		const a = records[i - 1];
		const b = records[i];
		if (a.textureClass !== b.textureClass) {
			breaks.textureClass++;
		}
		if (a.blend !== b.blend) {
			breaks.blend++;
		}
		if (a.depthTest !== b.depthTest) {
			breaks.depthTest++;
		}
		if (a.depthWrite !== b.depthWrite) {
			breaks.depthWrite++;
		}
	}
	return breaks;
}

/** Entities still in the legacy manager (dying mobs leave after their fade). */
function liveEntities() {
	let n = 0;
	EntityManager.forEach(() => {
		n++;
	});
	return n;
}

function run() {
	const legacy = kit.makeCanvas('legacy entity path');
	const modern = kit.makeCanvas('gpu-webgl2');
	const legacyDraws = kit.countDraws(legacy.gl);
	const modernDraws = kit.countDraws(modern.gl);
	const debug = modern.gl.getExtension('WEBGL_debug_renderer_info');
	const rendererName = debug ? modern.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

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

	// gpu-webgl2 side: residency with upload-on-miss from the same raw frames.
	const source = assets.source();
	const residency = new Residency({
		uploader: new TextureArrayPools({ gl: modern.gl }),
		now: () => performance.now(),
		source
	});
	const runs = new RunRenderer({ gl: modern.gl, state: new GLStateCache(modern.gl), residency });
	const toModern = native =>
		fromLegacySpriteRecord(native, {
			textureHandle: assets.textureHandle,
			paletteHandle: assets.paletteHandle,
			pixelPerfectSprites: graphics.pixelPerfectSprites
		});
	const fogOf = on => ({ ...FOG, use: on });
	const drawModern = (records, fog, target = runs) => {
		applyDefaultState(modern.gl);
		kit.clear(modern.gl);
		residency.beginFrame();
		target.draw(records, {
			modelView: view.modelView,
			projection: view.projection,
			zoom: Camera.zoom,
			fog: { use: fog.use && fog.exist, near: fog.near, far: fog.far, color: fog.color }
		});
		modern.gl.finish();
	};

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
			if (capture.residency === 'evict') {
				residency.evictIdle(-1);
			} else if (capture.residency === 'purge') {
				residency.uploader.dispose(); // as the lost context dropped every texture
				residency.purgeAll();
			}
			modernDraws.drawArraysInstanced = 0;
			drawModern(records, fog);
			const a = kit.readPixels(lgl);
			const b = kit.readPixels(modern.gl);
			const stats = kit.compare(a, b);
			const runCounts = runs.lastRuns.map(r => r.count);
			frames.push({
				name: capture.name,
				...stats,
				records: records.length,
				entities: liveEntities(),
				additive: records.filter(r => r.blend.dst === 'ONE').length,
				indexed: records.filter(r => r.textureClass === 'indexed').length,
				unmapped: unmapped.length,
				uploads: runs.lastUploads,
				resident: { frames: residency.residentCount, palettes: residency.paletteCount },
				legacyDrawCalls,
				modernDrawCalls: modernDraws.drawArraysInstanced,
				runs: runCounts,
				breaks: runBreaks(records),
				images: {
					legacy: legacy.canvas.toDataURL('image/png'),
					modern: modern.canvas.toDataURL('image/png'),
					diff: kit.diffImage(a, b)
				}
			});

			if (frames.length === 1) {
				// Sensitivity control: nudge one record by 0.01 world units in the gpu-webgl2
				// stream only (the last opaque-ish one: drawn on top, so it is visible).
				// The comparison must see it.
				const target = records.findLastIndex(r => r.color[3] > 0.5);
				const nudged = records.map((r, i) =>
					i === target ? { ...r, position: [r.position[0] + 0.01, r.position[1], r.position[2]] } : r
				);
				drawModern(nudged, fog);
				control = kit.compare(a, kit.readPixels(modern.gl));
				// #64 control: gpu-webgl2 with the legacy wrap emulated (index 255 shows entry 0)
				// must differ from the compensated legacy frame, or no record uses index 255.
				const wrapped = new Residency({
					uploader: new TextureArrayPools({ gl: modern.gl }),
					now: () => performance.now(),
					source: assets.source({ wrapPalettes: true })
				});
				const wrappedRuns = new RunRenderer({
					gl: modern.gl,
					state: new GLStateCache(modern.gl),
					residency: wrapped
				});
				drawModern(records, fog, wrappedRuns);
				control64 = kit.compare(a, kit.readPixels(modern.gl));
				wrapped.uploader.dispose();
			}
		}
	} finally {
		clock.restore();
	}

	return {
		ok: true,
		page: 'entities',
		renderer: rendererName,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: frames.map(f => f.records),
		scene: { counts: COUNTS, features, assets: assets.counts },
		residency: { ...residency.stats, decodes: source.decodes.size },
		glErrors: { legacy: lgl.getError(), modern: modern.gl.getError() },
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
