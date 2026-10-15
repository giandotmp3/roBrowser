/**
 * Mesh-family effect parity page for gpu-webgpu (port of gpu-webgl2/smoke/effects2.js, same
 * scene and assets): the REAL legacy effect classes (Renderer/Effects/
 * Cylinder, QuadHorn, RsmEffect, GroundAura, SwirlingAura, Level99Bubble, SpiritSphere,
 * WarlockSphere, Tiles, LPEffect, SpiderWeb, FlatColorTile, PropertyGround, MagicRing,
 * LockOnTarget, MagicTarget, RainWeather puddles, WaterfallEffect; all unmodified, with
 * the real Utils/WebGL.js and Utils/Texture.js) play a scripted scene into a WebGL2 canvas,
 * one pass per class per tick, as EffectManager.render does. On the captured ticks every
 * draw is captured from each class's `addRecordSink`; gpu-webgpu then draws those records
 * into a WebGPU canvas (RunRenderer → MeshEffectPipeline, one render pass, stream order;
 * textures uploaded on miss from the same images through the matching C-16 decodes;
 * offscreen target + blit). Pixels are compared. Results land on `window.__parity` for
 * smoke/run-parity.mjs (`--page=effects2`).
 *
 * Every frame is also drawn in ANGLE's raster orientation (see NATIVE_GATE_PCT and
 * smoke/README.md "Gates for effects2").
 *
 * What the native records lack is added in gpu-webgpu's legacy record adapter only
 * (fromLegacyEffectRecord): the magic-target ground plane (Altitude.generatePlane, the
 * stub below) and the puddles' camera position.
 */
import WebGL from 'Utils/WebGL.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import Cylinder from 'Renderer/Effects/Cylinder.js';
import QuadHorn from 'Renderer/Effects/QuadHorn.js';
import RsmEffect from 'Renderer/Effects/RsmEffect.js';
import GroundAura from 'Renderer/Effects/GroundAura.js';
import SwirlingAura from 'Renderer/Effects/SwirlingAura.js';
import Level99Bubble from 'Renderer/Effects/Level99Bubble.js';
import SpiritSphere from 'Renderer/Effects/SpiritSphere.js';
import WarlockSphere from 'Renderer/Effects/WarlockSphere.js';
import * as Tiles from 'Renderer/Effects/Tiles.js';
import LPEffect from 'Renderer/Effects/LPEffect.js';
import SpiderWeb from 'Renderer/Effects/SpiderWeb.js';
import FlatColorTile from 'Renderer/Effects/FlatColorTile.js';
import PropertyGround from 'Renderer/Effects/PropertyGround.js';
import MagicRing from 'Renderer/Effects/MagicRing.js';
import LockOnTarget from 'Renderer/Effects/LockOnTarget.js';
import MagicTarget from 'Renderer/Effects/MagicTarget.js';
import RainWeather from 'Renderer/Effects/RainWeather.js';
import WaterfallEffect from 'Renderer/Effects/WaterfallEffect.js';
import Camera from './cameraStub.js';
import { client, files, mapRenderer, modelLoader, renderer, session, stubs, terrain } from './entities/stubs.js';
import { rng } from './entities/assets.js';
import { FakeModel } from '../../../../tests/renderer/support/rsmEffectScene.js';
import { IMAGES, TILE_SIZES, buildEffect2Assets } from './effects2/assets.js';
import * as scene from './effects2/scene.js';
import { cameraMatrices, createPageKit } from './common.js';
import { createWebGpuSide } from './webgpuKit.js';
import { SpriteResidency } from '../src/residency/SpriteResidency.js';
import { TextureArrayPools } from '../src/residency/TextureArrayPools.js';
import { RunRenderer } from '../src/batching/RunRenderer.js';
import { fromLegacyEffectRecord } from '../src/effects/legacyRecord.js';
import { MESH_EFFECT_PROGRAM } from '../src/effects/mesh/meshFamilies.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
/** Page parameter `?only=<program>` keeps one mesh program's records (diagnosis). */
const ONLY = params.get('only');
const CLEAR = [0.12, 0.14, 0.12, 1];
const DIR = 'data/texture/';
/**
 * Declared gates of the native-orientation frames (smoke/README.md "Gates for effects2").
 * ANGLE draws a WebGL default framebuffer upside down. Without MSAA that flips the
 * rasterizer's top-left fill rule for edges through pixel centres (the waterfall curtains'
 * shared horizontal edges, the magic-target plane cells); with MSAA it also mirrors the 4×
 * sample pattern, so every edge that is neither horizontal nor vertical (rotated tiles, rings,
 * cylinders, planes) resolves different coverage. Every frame is therefore drawn a second
 * time in ANGLE's raster orientation (y-flipped projection, rows read top-down,
 * `-angle-orientation`), which keeps the page's gate (`--max-diff-pct`).
 */
const NATIVE_GATE_PCT = 0.075;
const NATIVE_AA_GATE_PCT = 2.5;

const kit = createPageKit({
	width: WIDTH,
	height: HEIGHT,
	antialias: ANTIALIAS,
	tolerance: TOLERANCE,
	clearColor: CLEAR
});

/** Wait until `done()` holds (async texture loads of the real Texture.load). */
async function until(done, label, timeoutMs = 20000) {
	const start = performance.now();
	while (!done()) {
		if (performance.now() - start > timeoutMs) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

/** Legacy Altitude.generatePlane over the stub terrain (size² cells, two triangles each). */
function generatePlane(posX, posY, size) {
	const middle = Math.floor(size / 2);
	const px = Math.floor(posX);
	const py = Math.floor(posY);
	const buffer = new Float32Array(size * size * 30);
	const h = (x, y) => -terrain.cellHeight(x, y) * 5;
	let i = 0;
	for (let x = -middle; x <= middle; ++x) {
		for (let y = -middle; y <= middle; ++y, i += 30) {
			const gx = px + x;
			const gy = py + y;
			const h0 = h(gx, gy);
			const h1 = h(gx + 1, gy) + 0.05;
			const h2 = h(gx, gy + 1) - 0.05;
			const h3 = h(gx + 1, gy + 1);
			buffer.set(
				[
					[gx, h0, gy, x + middle, y + middle],
					[gx + 1, h1, gy, x + 1 + middle, y + middle],
					[gx + 1, h3, gy + 1, x + 1 + middle, y + 1 + middle],
					[gx + 1, h3, gy + 1, x + 1 + middle, y + 1 + middle],
					[gx, h2, gy + 1, x + middle, y + 1 + middle],
					[gx, h0, gy, x + middle, y + middle]
				].flatMap(([a, b, c, u, v]) => [a, b, c, u / size, v / size]),
				i
			);
		}
	}
	return buffer;
}

async function run() {
	const gpu = await createWebGpuSide({ width: WIDTH, height: HEIGHT, antialias: ANTIALIAS, clearColor: CLEAR });
	if (gpu.noAdapter) {
		return { ok: false, noAdapter: true, error: `no WebGPU adapter: ${gpu.reason}` };
	}
	const legacy = kit.makeCanvas('legacy mesh effects (WebGL2)');
	const legacyDraws = kit.countDraws(legacy.gl);
	const lgl = legacy.gl;
	let legacyElements = 0;
	const drawElements = lgl.drawElements.bind(lgl);
	lgl.drawElements = (...args) => {
		legacyElements++;
		return drawElements(...args);
	};
	const debug = lgl.getExtension('WEBGL_debug_renderer_info');
	const legacyRenderer = debug ? lgl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

	// Image texels through a scratch WebGL2 unpack, as legacy uploads them (C-16 decodes).
	const unpackGl = document.createElement('canvas').getContext('webgl2');
	const assets = await buildEffect2Assets({ unpackGl });
	const nameOfUrl = new Map([...assets.urls].map(([name, url]) => [url, name]));

	// Legacy WebGL.texture: remember which image each texture is (img:<name> handles).
	let pendingTextures = 0;
	const realTexture = WebGL.texture;
	WebGL.texture = (gl, url, callback, ...rest) => {
		pendingTextures++;
		realTexture(
			gl,
			url,
			(texture, ...args) => {
				pendingTextures--;
				assets.handles.set(texture, `img:${nameOfUrl.get(url)}`);
				callback(texture, ...args);
			},
			...rest
		);
	};

	// Legacy seams: Memory (data URLs), RSM loader, ground plane, session, camera, map fog.
	for (const [name, url] of assets.urls) {
		files.set(`${DIR}${name}`, url);
	}
	client.getFile = (path, onLoad) => onLoad(path);
	modelLoader.create = filename => new FakeModel(filename);
	stubs['Renderer/Map/Altitude.js'].generatePlane = generatePlane;
	session.Entity = { position: new Float32Array([10, 20, 0]), lastSKID: 0, lastSkLvl: 0 };

	const view = cameraMatrices(scene.CAMERA, WIDTH, HEIGHT);
	Camera.zoom = scene.CAMERA.distance;
	Camera.direction = 0;
	Camera.angle = [...scene.CAMERA_ANGLE];
	Camera.position = [...scene.CAMERA_POSITION];
	Camera.modelView.set(view.modelView);
	Camera.projection.set(view.projection);
	renderer.width = WIDTH;
	renderer.height = HEIGHT;

	// R-CTX-002 default state on the legacy context, as Renderer.js sets it.
	lgl.enable(lgl.DEPTH_TEST);
	lgl.depthFunc(lgl.LEQUAL);
	lgl.enable(lgl.BLEND);
	lgl.blendFunc(lgl.SRC_ALPHA, lgl.ONE_MINUS_SRC_ALPHA);
	SpriteRenderer.init(lgl);

	// Spawns (seeded: constructors and renders draw Math.random). The whole legacy run is seeded.
	const savedRandom = Math.random;
	const savedAudio = window.AudioContext;
	Math.random = rng(0xe2ff3c);
	const owner = scene.makeOwner();
	const casters = [0, 1, 2].map(scene.makeCaster);
	const markerTargets = [0, 1, 2].map(scene.makeMarkerTarget);
	const sphereOwners = {
		spirit: scene.SPIRIT_SPAWNS.map((_, k) => scene.sphereOwner(k, 'spirit')),
		warlock: scene.WARLOCK_SPAWNS.map((_, k) => scene.sphereOwner(k, 'warlock'))
	};
	const cast = (Ctor, effects) => ({ Ctor, live: effects.map(effect => ({ effect })) });
	const ownerOr = spawn => (spawn.attached ? owner.position : [...spawn.position]);

	const tileClasses = scene.TILE_GROUPS.map((g, i) => ({
		...g,
		Ctor: g.make(Tiles, DIR, { LPEffect, SpiderWeb, FlatColorTile }),
		index: i
	}));

	/** EffectManager pass order of this page: before-entities classes, then after-entities ones. */
	let rain = null;
	const passes = [
		{ name: 'rain', puddles: true },
		cast(
			GroundAura,
			scene.GROUND_AURA_SPAWNS.map(s => new GroundAura(ownerOr(s), ...s.args))
		),
		cast(
			SwirlingAura,
			scene.SWIRLING_AURA_SPAWNS.map(s => new SwirlingAura(ownerOr(s), ...s.args))
		),
		cast(
			Level99Bubble,
			scene.LEVEL99_BUBBLE_SPAWNS.map(s => new Level99Bubble(ownerOr(s), ...s.args))
		),
		cast(
			QuadHorn,
			scene.QUADHORN_SPAWNS.map(
				s => new QuadHorn(s.effect, { position: ownerOr(s), startTick: s.startTick, endTick: s.endTick }, {})
			)
		),
		...tileClasses.map(t =>
			cast(
				t.Ctor,
				Array.from({ length: t.count }, (_, k) => new t.Ctor(scene.tileAt(t.index, k), 100 * k))
			)
		),
		cast(
			LockOnTarget,
			scene.LOCK_ON_SPAWNS.map(s => new LockOnTarget(markerTargets[s.target], s.startTick, s.endTick))
		),
		cast(
			MagicTarget,
			scene.MAGIC_TARGET_SPAWNS.map(s => {
				Object.assign(session.Entity, { lastSKID: 0, lastSkLvl: 0 }, s.session);
				return new MagicTarget(s.skillId, s.x, s.y, s.endTick, s.self ? session.Entity : {});
			})
		),
		cast(
			Cylinder,
			scene.CYLINDER_SPAWNS.map(s => {
				const position = s.attached ? owner.position : [...s.position];
				const base = s.attached ? owner.position : s.position;
				return new Cylinder(
					s.effect,
					{
						position,
						otherPosition: s.otherPosition ?? [base[0] - 5, base[1] + 5, base[2]],
						direction: s.attached ? owner.direction : 0,
						startTick: s.startTick,
						endTick: s.endTick
					},
					{}
				);
			})
		),
		cast(
			RsmEffect,
			scene.RSM_SPAWNS.map(
				s =>
					new RsmEffect({
						effect: { type: 'RSM', file: s.file, size: s.size },
						Inst: { position: ownerOr(s), startTick: s.startTick, endTick: -1 },
						Init: {}
					})
			)
		),
		cast(
			PropertyGround,
			scene.PROPERTY_SPAWNS.map(
				s => new PropertyGround([...s.position], s.topSize, s.bottomSize, s.height, s.texture, s.startTick)
			)
		),
		cast(
			MagicRing,
			scene.MAGIC_RING_SPAWNS.map(
				s =>
					new MagicRing(
						casters[s.caster],
						s.topSize ?? 2.45,
						s.bottomSize ?? 0.8,
						s.height ?? 2.8,
						s.texture,
						s.endTick
					)
			)
		),
		cast(
			SpiritSphere,
			scene.SPIRIT_SPAWNS.map((s, k) => {
				const effect = new SpiritSphere(sphereOwners.spirit[k], s.num, s.isCoin);
				effect.initialAlpha = s.initialAlpha;
				return effect;
			})
		),
		cast(
			WarlockSphere,
			scene.WARLOCK_SPAWNS.map((s, k) => {
				const effect = new WarlockSphere(sphereOwners.warlock[k], s.spheres);
				effect.initialAlpha = s.initialAlpha;
				return effect;
			})
		),
		cast(
			WaterfallEffect,
			scene.WATERFALL_SPAWNS.map(
				s => new WaterfallEffect(s.effect, { position: [...s.position], startTick: s.startTick }, {})
			)
		)
	];
	const PASS_PROGRAMS = new Map([
		[GroundAura, ['groundAura']],
		[SwirlingAura, ['swirlingAura']],
		[Level99Bubble, ['level99Bubble']],
		[QuadHorn, ['quadhorn']],
		[LockOnTarget, ['lockOn']],
		[MagicTarget, ['magicTarget']],
		[Cylinder, ['cylinder']],
		[RsmEffect, ['rsm']],
		[PropertyGround, ['ring']],
		[MagicRing, ['ring']],
		[SpiritSphere, ['sphere']],
		[WarlockSphere, ['sphere']],
		[WaterfallEffect, ['waterfall', 'waterfallSpray']]
	]);
	for (const pass of passes) {
		pass.programs = pass.puddles
			? ['rainPuddle']
			: (PASS_PROGRAMS.get(pass.Ctor) ??
				(pass.live[0]?.effect.constructor.name === 'FlatColorTile' ? ['colorTile'] : ['tile']));
		pass.live?.forEach(entry => {
			entry.effect.needInit = true;
		});
	}

	// Static init (EffectManager: once per class), then instance init and texture loads.
	const classes = [
		Cylinder,
		QuadHorn,
		RsmEffect,
		GroundAura,
		SwirlingAura,
		Level99Bubble,
		SpiritSphere,
		WarlockSphere,
		...tileClasses.map(t => t.Ctor),
		PropertyGround,
		MagicRing,
		LockOnTarget,
		MagicTarget,
		WaterfallEffect
	];
	for (const Ctor of classes) {
		Ctor.init(lgl);
	}
	try {
		window.AudioContext = undefined;
		rain = RainWeather.startOrRestart({
			Inst: { effectID: 161, startTick: scene.START_TICK, endTick: -1 },
			Init: { ownerAID: -1 }
		});
	} finally {
		window.AudioContext = savedAudio;
	}
	rain.puddles.push(
		...scene.PUDDLES.map(p => ({ ...p, z: terrain.cellHeight(p.x, p.y), lastUpdate: 0, _lastTick: 0 }))
	);
	for (const pass of passes) {
		for (const entry of pass.live ?? []) {
			entry.effect.init(lgl, scene.START_TICK);
			entry.effect.needInit = false;
		}
	}
	await until(
		() =>
			pendingTextures === 0 &&
			SpiritSphere.ready &&
			WarlockSphere.ready &&
			LockOnTarget.ready &&
			tileClasses.every(t => t.Ctor.ready),
		'legacy textures'
	);
	for (const t of tileClasses) {
		if (t.file && t.Ctor._texture) {
			assets.handles.set(t.Ctor._texture, `tile:${t.file}`);
		}
	}

	// gpu-webgpu side: residency with upload-on-miss from the same images, and the run renderer.
	const residency = new SpriteResidency({
		uploader: new TextureArrayPools({ device: gpu.device }),
		now: () => performance.now(),
		source: assets.source
	});
	const runs = await new RunRenderer({ device: gpu.device, residency, sampleCount: gpu.sampleCount }).init();
	const shaderMessages = [];
	for (const [id, module] of runs.meshes.modules) {
		for (const m of (await module.getCompilationInfo()).messages) {
			shaderMessages.push(`mesh ${id}.wgsl ${m.type} ${m.lineNum}:${m.linePos} ${m.message}`);
		}
	}
	const toModern = native =>
		fromLegacyEffectRecord(native, {
			textureHandle: assets.textureHandle,
			groundPlane: generatePlane,
			cameraPosition: Camera.position
		});
	const fogUniform = fog => ({ use: fog.use && fog.exist, near: fog.near, far: fog.far, color: fog.color });
	// ANGLE's raster orientation: clip y negated (F·P, F = diag(1, −1, 1, 1)), the frame lands
	// upside down and is read back top-down. Depth (z, w) and so fog are unchanged.
	const flippedProjection = Float32Array.from(view.projection, (v, i) => (i % 4 === 1 ? -v : v));
	/**
	 * Draw a record stream (every pipeline it needs compiled first: no normal-alpha fallback).
	 * `flipY`: in ANGLE's raster orientation (MSAA diagnosis, see NATIVE_AA_GATE_PCT).
	 */
	const drawModern = async (records, fog, { flipY = false } = {}) => {
		await runs.warm(records);
		const { pixels, result } = await gpu.render(
			pass => {
				residency.beginFrame();
				return runs.encode(pass, records, {
					modelView: view.modelView,
					projection: flipY ? flippedProjection : view.projection,
					zoom: Camera.zoom,
					fog: fogUniform(fog),
					cameraPosition: Camera.position
				});
			},
			{ rowsTopDown: flipY }
		);
		return { pixels, stats: result };
	};

	/** One legacy frame: a pass per class, as EffectManager.render (removal after the draw). */
	const renderLegacy = (tick, fog) => {
		kit.clear(lgl);
		mapRenderer.fog = fog;
		// MapRenderer binds the SpriteRenderer 3D context for the entity pass before the
		// effect passes; runWithDepth only switches depth state once it is bound.
		SpriteRenderer.bind3DContext(lgl, view.modelView, view.projection, fog);
		SpriteRenderer.unbind(lgl);
		for (const pass of passes) {
			if (ONLY && !pass.programs.includes(ONLY)) {
				continue;
			}
			lgl.blendFunc(lgl.SRC_ALPHA, lgl.ONE_MINUS_SRC_ALPHA);
			if (pass.puddles) {
				RainWeather.renderPuddles(lgl, view.modelView, view.projection, fog, tick);
				continue;
			}
			const { Ctor } = pass;
			Ctor.beforeRender(lgl, view.modelView, view.projection, fog, tick);
			for (const entry of pass.live) {
				if (!entry.removed && entry.effect.ready) {
					entry.effect.render(lgl, tick);
					if (entry.effect.needCleanUp) {
						entry.removed = true;
					}
				}
			}
			Ctor.afterRender(lgl);
		}
		lgl.finish();
	};
	const SINKS = [
		Cylinder,
		QuadHorn,
		RsmEffect,
		GroundAura,
		SwirlingAura,
		Level99Bubble,
		SpiritSphere,
		WarlockSphere,
		Tiles,
		LPEffect,
		SpiderWeb,
		FlatColorTile,
		PropertyGround,
		MagicRing,
		LockOnTarget,
		MagicTarget,
		RainWeather,
		WaterfallEffect
	];
	const capture = fn => {
		const native = [];
		const stops = SINKS.map(source => source.addRecordSink(r => native.push(r)));
		try {
			fn();
		} finally {
			stops.forEach(stop => stop());
		}
		return native;
	};
	// ?only=<program>: the passes that draw it, and every program those passes draw.
	const onlyPrograms = new Set(passes.filter(p => p.programs.includes(ONLY)).flatMap(p => p.programs));
	const keep = r => !ONLY || onlyPrograms.has(MESH_EFFECT_PROGRAM[r.family]);

	const frames = [];
	const checks = [];
	let skipped = 0;
	/** @type {Map<WebGLTexture, string>} legacy texture → handle, over every captured record */
	const seen = new Map();
	let controls = null;
	const last = scene.CAPTURES[scene.CAPTURES.length - 1].at;
	for (let tick = scene.START_TICK; tick <= last; tick += scene.TICK_MS) {
		renderer.tick = tick;
		scene.moveOwner(owner, tick);
		scene.updateCasters(casters, tick);
		scene.moveMarkerTargets(markerTargets, tick);
		sphereOwners.spirit.forEach((o, k) => scene.moveSphereOwner(o, k, 'spirit', tick));
		sphereOwners.warlock.forEach((o, k) => scene.moveSphereOwner(o, k, 'warlock', tick));
		const shot = scene.CAPTURES.find(c => c.at === tick);
		const fog = { ...scene.FOG, use: Boolean(shot?.fog) };
		if (!shot) {
			renderLegacy(tick, fog);
			continue;
		}
		legacyDraws.drawArrays = 0;
		legacyDraws.drawArraysInstanced = 0;
		legacyElements = 0;
		const native = capture(() => renderLegacy(tick, fog));
		const legacyDrawCalls = legacyDraws.drawArrays + legacyDraws.drawArraysInstanced + legacyElements;
		const a = kit.readPixels(lgl);
		const legacyPng = legacy.canvas.toDataURL('image/png');

		const records = native.map(toModern);
		native.forEach((r, i) => {
			if (r.texture && records[i].texture) {
				seen.set(r.texture, records[i].texture);
			}
		});
		const { pixels: b, stats: drawStats } = await drawModern(records.filter(keep), fog);
		skipped += drawStats.skipped;
		const batches = runs.lastBatches.map(r => r.count);
		const programs = countPrograms(runs.lastBatches);
		const uploads = runs.lastUploads;
		const stats = kit.compare(a, b);
		const families = {};
		records.forEach(r => {
			families[r.family] = (families[r.family] ?? 0) + 1;
		});
		frames.push({
			name: shot.name,
			...stats,
			records: records.length,
			detail: `${records.length} records ${JSON.stringify(families)}, ${uploads} uploads on miss, resident ${residency.residentCount} textures; draws per program ${JSON.stringify(programs)}`,
			legacyDrawCalls,
			modernDrawCalls: drawStats.drawCalls,
			fallbacks: drawStats.fallbacks,
			runs: drawStats.runs,
			batches,
			programs,
			images: { legacy: legacyPng, modern: gpu.toPng(b), diff: kit.diffImage(a, b) },
			gatePct: ANTIALIAS ? NATIVE_AA_GATE_PCT : NATIVE_GATE_PCT
		});
		{
			// The same records in ANGLE's raster orientation: the sample pattern now matches legacy's.
			const { pixels: flipped, stats: flippedStats } = await drawModern(records.filter(keep), fog, {
				flipY: true
			});
			skipped += flippedStats.skipped;
			frames.push({
				name: `${shot.name}-angle-orientation`,
				...kit.compare(a, flipped),
				records: records.length,
				detail: 'same records, y-flipped projection, rows read top-down (ANGLE raster orientation)',
				legacyDrawCalls,
				modernDrawCalls: flippedStats.drawCalls,
				fallbacks: flippedStats.fallbacks,
				runs: flippedStats.runs,
				batches,
				images: { modern: gpu.toPng(flipped), diff: kit.diffImage(a, flipped) }
			});
		}

		if (shot.fog) {
			// Fog control: the same frame with every record's fog flag off must differ, so the
			// fog frame really exercises the families' fog code (fogged on both sides).
			const unfogged = kit.compare(
				a,
				(
					await drawModern(
						records.filter(keep).map(r => ({ ...r, fog: false })),
						fog
					)
				).pixels
			);
			const fogged = records.filter(r => r.fog).length;
			checks.push({
				name: `${shot.name}: fog control (records drawn with fog off differ from legacy)`,
				ok: fogged > 0 && unfogged.differing > 0,
				detail: `${fogged} records fogged; with fog off ${unfogged.differing} px differ, max ${unfogged.maxDiff}`
			});
		}

		if (!controls) {
			// Sensitivity controls: nudge one instanced record (a cylinder) and one stream
			// record (an RSM object) by 0.01 world units in the gpu-webgpu stream only.
			const nudge = async family => {
				const target = records.findLastIndex(r => r.family === family && r.color[3] > 0.5);
				const nudged = records.map((r, i) =>
					i === target ? { ...r, position: [r.position[0] + 0.01, r.position[1], r.position[2]] } : r
				);
				return { family, index: target, ...kit.compare(a, (await drawModern(nudged, fog)).pixels) };
			};
			controls = [await nudge('cylinder'), await nudge('rsm'), await nudge('lp')];
		}
	}
	Math.random = savedRandom;
	checks.unshift(compareTexels(lgl, seen, assets));

	checks.push({
		name: 'every record drawn by a gpu-webgpu program (no skipped batch, no normal-alpha fallback)',
		ok: skipped === 0 && frames.every(f => f.fallbacks === 0),
		detail: `${skipped} skipped batches, ${frames.reduce((n, f) => n + f.fallbacks, 0)} fallbacks`
	});
	checks.push(
		...controls.map(c => ({
			name: `sensitivity control (${c.family} record #${c.index} nudged 0.01 units)`,
			ok: c.index >= 0 && c.differing > 0,
			detail: `${c.differing} px differ, max ${c.maxDiff}`
		}))
	);
	const covered = new Set(frames.flatMap(f => Object.keys(f.programs ?? {})));
	const expected = new Set(Object.values(MESH_EFFECT_PROGRAM));
	checks.push({
		name: 'every mesh program is drawn by the scene',
		ok: !ONLY && [...expected].every(p => covered.has(p)),
		detail: `${[...covered].sort().join(', ')}${ONLY ? ' (only)' : ''}; missing: ${
			[...expected].filter(p => !covered.has(p)).join(', ') || 'none'
		}`
	});
	WebGL.texture = realTexture;

	await gpu.device.queue.onSubmittedWorkDone();
	return {
		ok: true,
		page: 'effects2',
		adapter: gpu.adapter,
		fallbackAdapter: gpu.fallbackAdapter,
		legacyRenderer,
		canvasFormat: gpu.format,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: frames.filter(f => !f.name.endsWith('-angle-orientation')).map(f => f.records),
		assets: assets.counts,
		residency: { ...residency.stats, decodes: assets.source.decodes.size },
		glError: lgl.getError(),
		gpuErrors: gpu.errors,
		shaderMessages,
		pipelines: runs.meshes.pipelines.readyCount,
		control: controls.reduce((min, c) => (c.differing < min.differing ? c : min)),
		checks,
		frames
	};
}

/** Draw batches per mesh program of one frame (batch keys `…:mesh:<program>:…`). */
function countPrograms(lastBatches) {
	const out = {};
	for (const batch of lastBatches) {
		const program = batch.key.split(':').find((part, i, all) => all[i - 1] === 'mesh');
		if (program) {
			out[program] = (out[program] ?? 0) + 1;
		}
	}
	return out;
}

/**
 * Texels: every legacy texture the captured records reference, read back and compared
 * with the residency decode of the same handle (img/tile/self decodes, the puddle
 * generator).
 * @param {WebGL2RenderingContext} gl  legacy context
 * @param {Map<WebGLTexture, string>} seen  legacy texture → handle
 * @param {{source: {frame(handle: string): any}}} assets
 */
function compareTexels(gl, seen, assets) {
	const framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	let texels = 0;
	let differing = 0;
	const kinds = {};
	for (const [texture, handle] of seen) {
		const image = assets.source.frame(handle);
		if (!image) {
			continue;
		}
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		const legacyTexels = new Uint8Array(image.width * image.height * 4);
		gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, legacyTexels);
		texels += image.width * image.height;
		const kind = handle.slice(0, handle.indexOf(':'));
		kinds[kind] = (kinds[kind] ?? 0) + 1;
		for (let i = 0; i < legacyTexels.length; i++) {
			if (legacyTexels[i] !== image.data[i]) {
				differing++;
			}
		}
	}
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.deleteFramebuffer(framebuffer);
	const tiles = Object.keys(TILE_SIZES).length;
	return {
		name: 'textures: legacy texels = residency decode (WebGL.texture images, tile canvases, self-drawn canvases, puddle)',
		ok: differing === 0 && kinds.tile === tiles && kinds.self >= 2 && kinds.raw === 1 && kinds.img > 0,
		detail: `${JSON.stringify(kinds)} textures (${Object.keys(IMAGES).length} images), ${texels} texels, ${differing} channel values differ`
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
