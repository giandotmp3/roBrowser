/**
 * End-to-end backend page (`--page=backend`): WebGpuBackend.drawFrame drives a whole frame
 * (scene pass of the R-CTX-010 record stream through RunRenderer, post chain or blit, C-20
 * capture) and is compared with legacy rendering the same frame.
 *
 * - Legacy (WebGL2, unmodified): per frame, as MapRenderer does, `PostProcess.prepare` (binds
 *   the scene FBO when a module is active, clears colour + depth), the REAL entity path
 *   (EntityManager → Entity → EntityRender → SpriteRenderer, ~200 entities, entities page
 *   scene) then the REAL effect classes (ThreeDEffect, StrEffect, TwoDEffect, a few spawns
 *   of the effects page, moved into the entity area), then `PostProcess.render` with the
 *   real modules registered in MapRenderer order.
 * - gpu-webgpu: the captured records as one R-CTX-010 stream
 *   `{entitiesNonEffect, effectsAfterEntities}` into `backend.drawFrame(stream, frame)`;
 *   the same GraphicsSettings (the `graphics` seam stub is the backend's SettingsPort), the
 *   frame read back with `backend.capture()`.
 * - Device loss: after the blit frame, `backend.device.destroy()` (resolves `device.lost`).
 *   The backend must show the overlay, purge, rebuild on a new device, re-run setMap, and
 *   the next frame (re-uploaded on demand) must match legacy again.
 *
 * Declared divergence (effects page): R-EFX-010, STR layers are drawn with the STR fog off.
 * Results land on `window.__parity` for smoke/run-parity.mjs.
 */
import WebGL from 'Utils/WebGL.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
// EntityManager before Entity: their circular import needs that order.
import EntityManager from 'Renderer/EntityManager.js';
import Entity from 'Renderer/Entity/Entity.js';
import StrEffect from 'Renderer/Effects/StrEffect.js';
import ThreeDEffect from 'Renderer/Effects/ThreeDEffect.js';
import TwoDEffect from 'Renderer/Effects/TwoDEffect.js';
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
import StatusConst from 'DB/Status/StatusState.js';
import Camera from './cameraStub.js';
import { files, graphics, renderer } from './entities/stubs.js';
import { buildAssets, rng } from './entities/assets.js';
import { CAMERA, COUNTS, FOG, spawnScene } from './entities/scene.js';
import { buildEffectAssets } from './effects/assets.js';
import { SPAWNS_2D, SPAWNS_3D, STR_SPAWNS, spawnSprite, spawnStr, strFiles } from './effects/scene.js';
import { cameraMatrices, createPageKit } from './common.js';
import { WebGpuBackend } from '../src/WebGpuBackend.js';
import { CONTEXT_LOST_OVERLAY, PURGE_ON_LOSS_EXTENSIONS } from '../src/constants.js';
import { POST_DEFAULTS } from '../src/post/postChain.js';
import { fromLegacySpriteRecord } from '../src/sprites/legacyRecord.js';
import { fromLegacyEffectRecord } from '../src/effects/legacyRecord.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const TOLERANCE = Number(params.get('tol') ?? 2);
/** The frame's clear colour (what the sky gives, R-CTX-009). */
const CLEAR = [0.12, 0.14, 0.12, 1];
const EPOCH_MS = 1_700_000_000_000;
const FRAME_MS = 40;
const MAP = 'prt_fild08';
/** Effects page spawns are laid out around (10, 20); the entity area's centre is (51, 51). */
const EFFECT_SHIFT = [CAMERA.target[0] - 10, CAMERA.target[1] - 20];

/**
 * Declared gate of the production backend (depth24plus) on frames legacy draws through its PostProcess
 * FBO, whose depth is DEPTH_COMPONENT16 (smoke/README.md, "Backend page"): coincident sprite layers that
 * 24 bits separate tie at 16 bits, so legacy resolves them by draw order. The `-depth16` frames rerun
 * the stream at legacy's depth precision under the page gate.
 */
const FBO_DEPTH_GATE_PCT = 1.0;

/** Post modules on (GraphicsSettings): bloom, FXAA (subpix 0 = legacy, R-PP-006), vibrance. */
const POST_ON = Object.freeze({ bloom: true, fxaaEnabled: true, fxaaSubpix: 0, vibranceEnabled: true });
/**
 * Captured frames. `settings`: GraphicsSettings for the frame (both sides); `loss`: destroy the
 * backend's device after this frame and wait for the rebuild.
 */
const CAPTURES = Object.freeze([
	{ name: 'backend-t1080-post', at: 1080, fog: false, settings: POST_ON },
	{ name: 'backend-t1160-fog-post', at: 1160, fog: true, settings: POST_ON },
	{ name: 'backend-t1200-perf-bloom', at: 1200, fog: false, settings: { performanceMode: true, bloom: true } },
	{ name: 'backend-t1240-blit', at: 1240, fog: false, settings: {}, loss: true },
	{ name: 'backend-t1320-post-after-loss', at: 1320, fog: false, settings: POST_ON }
]);

const kit = createPageKit({ width: WIDTH, height: HEIGHT, antialias: false, tolerance: TOLERANCE, clearColor: CLEAR });

/** Seeded Math.random and a fake Date.now / performance.now (entities page). */
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

/** Wait (real time, the page clock is fake) until `done()` holds. */
async function until(done, label, tries = 2000) {
	for (let i = 0; !done(); i++) {
		if (i >= tries) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

/** Top-down capture rows → bottom-up (gl.readPixels order). */
function bottomUp(data, width, height) {
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		out.set(data.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
	}
	return out;
}

/** Bottom-up RGBA rows → PNG data URL (screen orientation). */
function toPng(rows) {
	const png = document.createElement('canvas');
	png.width = WIDTH;
	png.height = HEIGHT;
	const ctx = png.getContext('2d');
	const img = ctx.createImageData(WIDTH, HEIGHT);
	for (let y = 0; y < HEIGHT; y++) {
		img.data.set(rows.subarray((HEIGHT - 1 - y) * WIDTH * 4, (HEIGHT - y) * WIDTH * 4), y * WIDTH * 4);
	}
	ctx.putImageData(img, 0, 0);
	return png.toDataURL('image/png');
}

/** A few effects-page spawns that do not follow an owner, moved into the entity area. */
function spawnEffects() {
	const free = spawn =>
		!spawn.owner && !spawn.attachment && !spawn.effect?.attachedEntity && !spawn.effect?.spriteName;
	const live = [
		...spawnSprite(ThreeDEffect, SPAWNS_3D.filter(free).slice(0, 10)),
		...spawnStr(
			StrEffect,
			STR_SPAWNS.filter(free).map(s => ({ ...s, position: s.position.slice() }))
		),
		...spawnSprite(TwoDEffect, SPAWNS_2D.filter(free).slice(0, 8))
	];
	for (const { effect } of live) {
		effect.position[0] += EFFECT_SHIFT[0];
		effect.position[1] += EFFECT_SHIFT[1];
	}
	return live;
}

async function run() {
	const legacy = kit.makeCanvas('legacy entities + effects + PostProcess (WebGL2)');
	const lgl = legacy.gl;
	const legacyDraws = kit.countDraws(lgl);
	const debug = lgl.getExtension('WEBGL_debug_renderer_info');
	const legacyRenderer = debug ? lgl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

	if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) {
		return { ok: false, noAdapter: true, error: 'no WebGPU adapter' };
	}
	const settingsPort = { get: key => graphics[key], set: (key, value) => (graphics[key] = value) };

	// Legacy assets: entity sprites (Client.js uploads) and effect images / STR / SPR.
	const entityAssets = buildAssets(lgl, { pixelPerfectSprites: graphics.pixelPerfectSprites });
	for (const [path, data] of entityAssets.files) {
		files.set(path, data);
	}
	const unpackGl = document.createElement('canvas').getContext('webgl2');
	const fxAssets = await buildEffectAssets(lgl, { unpackGl });
	const nameOfUrl = new Map([...fxAssets.urls].map(([name, url]) => [url, name]));
	let pendingTextures = 0;
	const realTexture = WebGL.texture;
	WebGL.texture = (gl, url, callback, ...rest) => {
		pendingTextures++;
		realTexture(
			gl,
			url,
			(texture, ...args) => {
				pendingTextures--;
				fxAssets.registerImageTexture(texture, nameOfUrl.get(url));
				callback(texture, ...args);
			},
			...rest
		);
	};
	for (const [path, data] of fxAssets.files) {
		// Both sets build 'data/sprite/shadow': the entity one stays (the spawns that use the
		// effect one, `shadowTexture`, follow an owner and are not part of this page).
		if (!files.has(path)) {
			files.set(path, data);
		}
	}
	for (const [name, url] of fxAssets.urls) {
		files.set(`data/texture/${name}`, url);
	}
	for (const [path, data] of Object.entries(strFiles())) {
		for (const layer of data.layers) {
			layer.materials = new Array(layer.texcnt);
			layer.textures.forEach((name, j) => {
				if (name) {
					WebGL.texture(lgl, fxAssets.urls.get(name), texture => {
						layer.materials[j] = texture;
					});
				}
			});
		}
		files.set(path, data);
	}

	// One upload-on-miss source over both asset sets (handles are distinct paths).
	const entitySource = entityAssets.source();
	const frames = {
		frame: handle => entitySource.frame(handle) ?? fxAssets.source.frame(handle),
		palette: handle => entitySource.palette(handle) ?? fxAssets.source.palette(handle)
	};
	/** A WebGpuBackend on its own canvas, every port recorded into `portLog`. */
	const createBackend = async ({ title, depthFormat, portLog }) => {
		const canvas = document.createElement('canvas');
		canvas.width = WIDTH;
		canvas.height = HEIGHT;
		canvas.title = title;
		document.getElementById('canvases').append(canvas);
		return new WebGpuBackend({
			gpu: navigator.gpu,
			canvas,
			overlay: {
				show: spec => portLog.push(['overlay.show', spec]),
				hide: () => portLog.push(['overlay.hide'])
			},
			assets: { purge: extensions => portLog.push(['assets.purge', [...extensions]]) },
			settings: settingsPort,
			scene: {
				runStep: () => {},
				currentMap: () => MAP,
				setMap: async name => {
					portLog.push(['scene.setMap', name]);
				}
			},
			fallback: { switchToWebgl2: async reason => portLog.push(['fallback.switchToWebgl2', reason]) },
			now: () => performance.now(),
			frames,
			sampleCount: 1, // the legacy page canvas and the PostProcess FBO have no MSAA
			depthFormat,
			allowSoftwareAdapter: true, // integration decision #2: bloom on SwiftShader
			log: (message, err) => portLog.push(['log', `${message}: ${err?.stack ?? err}`])
		}).init();
	};
	const portLog = [];
	const backend = await createBackend({ title: 'gpu-webgpu WebGpuBackend (production)', portLog });
	// Legacy renders a post-processed scene into its PostProcess FBO, whose depth is DEPTH_COMPONENT16
	// (PostProcess.createFramebuffer); the default framebuffer has 24 bits. This second backend runs the
	// post-chain frames with a depth16unorm scene target: the gate of the backend chain itself.
	const fboDepthLog = [];
	const fboDepth = await createBackend({
		title: 'gpu-webgpu WebGpuBackend (depth16unorm, legacy PostProcess FBO depth)',
		depthFormat: 'depth16unorm',
		portLog: fboDepthLog
	});
	const shaderMessages = (
		await Promise.all([backend.runs.sprites.module, backend.runs.str.module].map(m => m.getCompilationInfo()))
	).flatMap(info => info.messages.map(m => `${m.type} ${m.lineNum}:${m.linePos} ${m.message}`));
	const info = backend.renderDevice.adapter.info ?? {};

	const view = cameraMatrices(CAMERA, WIDTH, HEIGHT);
	Camera.zoom = CAMERA.distance;
	Camera.direction = 0;
	Camera.angle = [CAMERA.pitch, CAMERA.yaw];
	Camera.modelView.set(view.modelView);
	Camera.projection.set(view.projection);
	renderer.width = WIDTH;
	renderer.height = HEIGHT;

	// Legacy post modules, MapRenderer.registerPostProcessModules order and bloom guard.
	const badWebGL = WebGL.detectBadWebGL(lgl);
	if (!badWebGL) {
		PostProcess.register(Bloom, lgl);
	}
	for (const module of [GaussianBlur, FXAA, CAS, Cartoon, Vibrance, VerticalFlip, Blind, Upsampling]) {
		PostProcess.register(module, lgl);
	}
	SpriteRenderer.init(lgl);
	const CLASSES = [ThreeDEffect, StrEffect, TwoDEffect];
	for (const Class of CLASSES) {
		Class.init(lgl);
	}

	const toSprite = native =>
		fromLegacySpriteRecord(native, {
			textureHandle: entityAssets.textureHandle,
			paletteHandle: entityAssets.paletteHandle,
			pixelPerfectSprites: graphics.pixelPerfectSprites
		});
	const toEffect = native =>
		fromLegacyEffectRecord(native, {
			textureHandle: fxAssets.textureHandle,
			paletteHandle: fxAssets.paletteHandle,
			sceneFog: null // R-EFX-010 declared divergence: legacy never fogs STR
		});

	/** One legacy frame, as MapRenderer: prepare → entities → effects (after) → post. */
	const renderLegacy = (live, t, fog, capture) => {
		// R-CTX-002 default state (post modules change it), the sky clear colour (R-CTX-009).
		lgl.enable(lgl.DEPTH_TEST);
		lgl.depthFunc(lgl.LEQUAL);
		lgl.depthMask(true);
		lgl.enable(lgl.BLEND);
		lgl.blendFunc(lgl.SRC_ALPHA, lgl.ONE_MINUS_SRC_ALPHA);
		lgl.clearColor(...CLEAR);
		PostProcess.prepare(lgl);
		const entityNative = [];
		const stopSprites = capture ? SpriteRenderer.addRecordSink(r => entityNative.push(r)) : null;
		EntityManager.render(lgl, view.modelView, view.projection, fog, false);
		stopSprites?.();
		const effectNative = [];
		const stops = capture ? CLASSES.map(Class => Class.addRecordSink(r => effectNative.push(r))) : [];
		for (const Class of CLASSES) {
			Class.beforeRender(lgl, view.modelView, view.projection, fog, t);
			for (const entry of live) {
				if (entry.effect instanceof Class && !entry.removed) {
					entry.effect.render(lgl, t);
					if (entry.effect.needCleanUp) {
						entry.removed = true;
					}
				}
			}
			Class.afterRender(lgl);
		}
		stops.forEach(stop => stop());
		PostProcess.render(lgl);
		lgl.finish();
		return { entityNative, effectNative };
	};

	const fogUniform = fog => ({ use: fog.use && fog.exist, near: fog.near, far: fog.far, color: fog.color });
	/** One backend frame read back through capture() (C-20), as bottom-up rows. */
	const drawBackend = async (stream, fog, target = backend) => {
		await target.warm(stream);
		const image = target.capture();
		const stats = target.drawFrame(stream, {
			view: { modelView: view.modelView, projection: view.projection, zoom: Camera.zoom, fog: fogUniform(fog) },
			clearColor: CLEAR
		});
		if (!stats.drawn) {
			throw new Error(`drawFrame did not draw: ${stats.reason ?? stats.error}`);
		}
		const img = await image;
		return { pixels: bottomUp(img.data, img.width, img.height), stats, size: [img.width, img.height] };
	};

	const clock = installClock(0x5eed);
	const results = [];
	const checks = [];
	let control = null;
	let features;
	let live;
	let lossInfo = null;
	try {
		({ features } = spawnScene({ Entity, EntityManager, StatusConst }));
		live = spawnEffects();
		for (const { effect } of live) {
			effect.init(lgl);
		}
		await until(() => pendingTextures === 0, 'legacy effect textures');

		const last = CAPTURES[CAPTURES.length - 1].at;
		for (let t = 0; t <= last; t += FRAME_MS) {
			clock.now = t;
			renderer.tick = t;
			const shot = CAPTURES.find(c => c.at === t);
			Object.assign(graphics, POST_DEFAULTS, { performanceMode: false }, shot?.settings);
			const fog = { ...FOG, use: Boolean(shot?.fog) };
			legacyDraws.drawArrays = 0;
			const { entityNative, effectNative } = renderLegacy(live, t, fog, Boolean(shot));
			if (!shot) {
				continue;
			}
			const legacyDrawCalls = legacyDraws.drawArrays;
			const a = kit.readPixels(lgl);
			const legacyPng = legacy.canvas.toDataURL('image/png');

			const stream = {
				entitiesNonEffect: entityNative.map(toSprite),
				effectsAfterEntities: effectNative.map(toEffect)
			};
			const records = stream.entitiesNonEffect.length + stream.effectsAfterEntities.length;
			const viaFbo = Object.values(shot.settings).some(Boolean); // legacy draws the scene into its FBO
			const { pixels: b, stats } = await drawBackend(stream, fog);
			const families = {};
			stream.effectsAfterEntities.forEach(r => (families[r.family] = (families[r.family] ?? 0) + 1));
			results.push({
				name: shot.name,
				...kit.compare(a, b),
				records,
				detail: `${stream.entitiesNonEffect.length} entity + ${stream.effectsAfterEntities.length} effect records (${JSON.stringify(families)}), post ${stats.post} (${stats.postPasses} passes, scene ${stats.sceneSize.width}x${stats.sceneSize.height}), ${stats.uploads} uploads on miss, ${stats.unsupportedRecords} unsupported, resident ${backend.residency.residentCount} textures / ${backend.residency.paletteCount} palettes`,
				legacyDrawCalls,
				modernDrawCalls: stats.drawCalls,
				fallbacks: stats.fallbacks,
				runs: stats.runs,
				batches: backend.runs.lastBatches.map(r => r.count),
				stats,
				images: { legacy: legacyPng, modern: toPng(b), diff: kit.diffImage(a, b) },
				...(viaFbo ? { gatePct: FBO_DEPTH_GATE_PCT } : {})
			});
			if (viaFbo) {
				// The same frame with the scene depth at legacy's FBO precision: the page gate applies.
				const { pixels: c, stats: s16 } = await drawBackend(stream, fog, fboDepth);
				results.push({
					name: `${shot.name}-depth16`,
					...kit.compare(a, c),
					records,
					detail: `same stream, scene target depth16unorm (legacy PostProcess FBO depth), post ${s16.post}`,
					legacyDrawCalls,
					modernDrawCalls: s16.drawCalls,
					fallbacks: s16.fallbacks,
					runs: s16.runs,
					batches: fboDepth.runs.lastBatches.map(r => r.count),
					stats: s16,
					images: { modern: toPng(c), diff: kit.diffImage(a, c) }
				});
			}
			const expectedPost = viaFbo ? 'post chain' : 'blit';
			checks.push({
				name: `${shot.name}: drawn through the ${expectedPost}, every record drawn (no unsupported record, no fallback)`,
				ok:
					(expectedPost === 'blit' ? stats.post === 'blit' : stats.post !== 'blit') &&
					stats.unsupportedRecords === 0 &&
					stats.fallbacks === 0 &&
					stats.skipped === 0,
				detail: `post ${stats.post}, ${stats.unsupportedRecords} unsupported, ${stats.fallbacks} fallbacks, ${stats.skipped} skipped batches`
			});

			if (!control) {
				// Sensitivity control: one entity record nudged 0.01 world units on the backend side only.
				const target = stream.entitiesNonEffect.findLastIndex(r => r.color[3] > 0.5);
				const nudged = {
					...stream,
					entitiesNonEffect: stream.entitiesNonEffect.map((r, i) =>
						i === target ? { ...r, position: [r.position[0] + 0.01, r.position[1], r.position[2]] } : r
					)
				};
				control = kit.compare(a, (await drawBackend(nudged, fog)).pixels);
			}

			if (shot.loss) {
				lossInfo = await loseDevice(backend, portLog);
				checks.push(...lossInfo.checks);
				// The same frame again, first on the new device: legacy parity (page gate) and the
				// pre-loss gpu-webgpu frame, pixel for pixel; every texture re-uploaded on demand.
				const { pixels: again, stats: againStats } = await drawBackend(stream, fog);
				const vsBefore = kit.compare(b, again);
				results.push({
					name: `${shot.name}-after-loss`,
					...kit.compare(a, again),
					records,
					detail: `same stream redrawn on the rebuilt device: ${againStats.uploads} uploads on miss; vs the pre-loss gpu-webgpu frame ${vsBefore.differing} px differ`,
					legacyDrawCalls,
					modernDrawCalls: againStats.drawCalls,
					fallbacks: againStats.fallbacks,
					runs: againStats.runs,
					batches: backend.runs.lastBatches.map(r => r.count),
					stats: againStats,
					images: { modern: toPng(again), diff: kit.diffImage(a, again) }
				});
				checks.push({
					name: 'device loss: the first frame on the new device re-uploads on demand and equals the pre-loss frame',
					ok: againStats.uploads > 0 && vsBefore.differing === 0,
					detail: `${againStats.uploads} uploads on miss (residency was purged); ${vsBefore.differing} px differ from the pre-loss frame (max ${vsBefore.maxDiff})`
				});
			}
		}
	} finally {
		clock.restore();
		WebGL.texture = realTexture;
	}

	checks.push({
		name: 'device loss happened and was recovered',
		ok: lossInfo?.summary.kind === 'webgpu',
		detail: JSON.stringify(lossInfo?.summary ?? null)
	});
	await backend.device.queue.onSubmittedWorkDone();
	const errors = [
		...backend.errors,
		...fboDepth.errors,
		...[...portLog, ...fboDepthLog].filter(e => e[0] === 'log').map(e => e[1])
	];
	backend.dispose();
	fboDepth.dispose();
	return {
		ok: true,
		page: 'backend',
		adapter: `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.trim(),
		fallbackAdapter: Boolean(info.isFallbackAdapter),
		legacyRenderer,
		canvasFormat: backend.format,
		size: [WIDTH, HEIGHT],
		antialias: false,
		tolerance: TOLERANCE,
		records: results.map(f => f.records),
		scene: {
			counts: COUNTS,
			features: { ...features, effects: live.length },
			assets: { ...entityAssets.counts, effectImages: fxAssets.counts.images }
		},
		residency: { ...backend.residency.stats },
		glError: lgl.getError(),
		gpuErrors: errors,
		shaderMessages,
		pipelines: backend.runs.sprites.pipelines.readyCount + backend.runs.str.pipelines.readyCount,
		control: { differing: control.differing, maxDiff: control.maxDiff },
		deviceLoss: lossInfo?.summary,
		checks,
		frames: results
	};
}

/**
 * Real device loss: destroy the backend's device mid-run (resolves `device.lost` with
 * 'destroyed'), then check R-CTX-006/007 through the recorded ports and wait for the rebuild.
 */
async function loseDevice(backend, portLog) {
	const oldDevice = backend.device;
	const mark = portLog.length;
	const before = backend.residency.residentCount;
	oldDevice.destroy();
	await until(() => backend.loss.losses > 0, 'device.lost');
	const lostWindow = backend.loss.lost ? backend.drawFrame([], {}) : null;
	const residentAfterPurge = backend.residency.residentCount;
	const kind = await backend.recovered();
	const log = portLog.slice(mark);
	const names = log.map(e => e[0]);
	const show = log.find(e => e[0] === 'overlay.show');
	const purge = log.find(e => e[0] === 'assets.purge');
	const checks = [
		{
			name: 'device loss (R-CTX-006): overlay shown, image caches purged, residency emptied, no frame while lost',
			ok:
				JSON.stringify(show?.[1]) === JSON.stringify(CONTEXT_LOST_OVERLAY) &&
				JSON.stringify(purge?.[1]) === JSON.stringify([...PURGE_ON_LOSS_EXTENSIONS]) &&
				residentAfterPurge === 0 &&
				(lostWindow === null || lostWindow.drawn === false),
			detail: `lost: ${JSON.stringify(backend.loss.lastLoss)}; resident ${before} → ${residentAfterPurge}; drawFrame while lost: ${lostWindow ? JSON.stringify(lostWindow) : 'rebuilt before it could be called'}`
		},
		{
			name: 'device loss (R-CTX-007): rebuilt on a new device, overlay hidden, setMap(currentMap) re-run, no fallback',
			ok:
				kind === 'webgpu' &&
				backend.device !== oldDevice &&
				backend.running &&
				names.includes('overlay.hide') &&
				names.indexOf('overlay.hide') > names.indexOf('overlay.show') &&
				log.some(e => e[0] === 'scene.setMap' && e[1] === MAP) &&
				!names.includes('fallback.switchToWebgl2'),
			detail: `recovered: ${kind}; ports: ${names.join(' → ')}`
		}
	];
	return { checks, summary: { kind, ports: names, residentBefore: before, residentAfterPurge } };
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
