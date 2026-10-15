/**
 * World parity page for gpu-webgpu (port of gpu-webgl2/smoke/world.js, same scene, assets,
 * 13 frames and declared checks): the REAL legacy map renderers (Renderer/Map/Ground, Water,
 * Models, AnimatedModels, GridSelector, Altitude, OccluderFade; unmodified, with the real
 * Utils/WebGL.js, Utils/Texture.js and SpriteRenderer depth state) draw a synthetic map into a
 * WebGL2 canvas in MapRenderer.onRender's order; gpu-webgpu's WebGpuBackend receives the same
 * MAP_* payloads through `acceptMapMessage` and draws them with `drawFrame` (the R-CTX-010
 * world steps in one scene pass, then the blit) into a WebGPU canvas, read back with
 * `capture()`. Pixels are compared on every captured frame. Results land on `window.__parity`
 * for smoke/run-parity.mjs (`--page=world`).
 *
 * Declared divergences (fixed legacy bugs), each compared twice, as in gpu-webgl2:
 * - R-MAP-010 water alpha: legacy squares the opacity (0.64). Parity frames feed gpu-webgpu a
 *   `world`/`water` record with alpha 0.64 (the record path, legacy compensated); a check
 *   renders the fixed default (0.8) and asserts that only water pixels change, each by the
 *   predicted 0.8·W + 0.2·D blend.
 * - R-MAP-013 animated RSM and the lightmap preference: with the preference off, legacy still
 *   applies N·L to animated models. The lightmap-off frame runs legacy with light.opacity 0
 *   (the animated weighting becomes 1.0, the fix's full diffuse); a check shows the
 *   uncompensated difference is confined to animated-model pixels.
 * - #69 animated RSM before a node's first key: legacy interpolates with t = −∞ (NaN
 *   matrices: the node and its descendants draw nothing until the key, every loop); the
 *   rebuild holds the first key. On ticks whose keyframe position is inside such a window
 *   (the 'spin' root's first position key), legacy runs with a copy of that first key at
 *   frame 0, which makes it hold the key (lerp a + t·0 = a; outside the window the bracket
 *   and every value are unchanged). A check at a pre-key tick renders legacy as is and
 *   asserts it equals gpu-webgpu with exactly those nodes' matrices NaN, while the
 *   compensated legacy equals gpu-webgpu (both within the page gate, depth ties aside) and
 *   the held nodes do draw.
 *
 * Occlusion queries (R-MAP-019): legacy polls its GL query on the next frame (results become
 * available on a later task); the page waits for gpu-webgpu's query read-back
 * (`world.whenQueriesRead()`) before the next frame, so both collect the result one frame
 * later and the fade strengths can be compared tick by tick.
 */
import Ground from 'Renderer/Map/Ground.js';
import Water from 'Renderer/Map/Water.js';
import Models from 'Renderer/Map/Models.js';
import AnimatedModels from 'Renderer/Map/AnimatedModels.js';
import GridSelector from 'Renderer/Map/GridSelector.js';
import Altitude from 'Renderer/Map/Altitude.js';
import OccluderFade from 'Renderer/Map/OccluderFade.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import MapPreferences from 'Preferences/Map.js';
import Texture from 'Utils/Texture.js';
import glMatrix from 'Utils/gl-matrix.js';
import Camera from './cameraStub.js';
import { files, graphics } from './entities/stubs.js';
import { buildWorldAssets, WATER } from './world/assets.js';
import { CAMERA, CAPTURES, FOG, GRID, OCCLUDER_CAMERA, SKY, START_TICK, TICK_MS } from './world/scene.js';
import { cameraMatrices, createPageKit } from './common.js';
import { WebGpuBackend } from '../src/WebGpuBackend.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
/** Legacy water alpha: uOpacity applied twice (R-MAP-010), as the shader's float32 product. */
const LEGACY_WATER_ALPHA = Math.fround(Math.fround(0.8) * Math.fround(0.8));
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const MAP = 'synthetic';
/**
 * Declared gates of the native-orientation frames (smoke/README.md "Gates for world"). ANGLE
 * draws a WebGL default framebuffer upside down; without MSAA that changes nothing here (the
 * same depth-tie pixels in both orientations, the page gate holds), with MSAA it mirrors the 4×
 * sample pattern, so every edge that is neither horizontal nor vertical resolves different
 * coverage, and the world covers the whole frame with such edges (ground tiles, water, models).
 * Every frame is therefore drawn a second time in ANGLE's raster orientation (y-flipped
 * projection, rows read top-down, `-angle-orientation`, on a second backend), which keeps the
 * page's gate (`--max-diff-pct`).
 */
const NATIVE_GATE_PCT = 0.05;
const NATIVE_AA_GATE_PCT = 3.0;
/**
 * Page parameter `?skip=ground,grid,models,animated,water` leaves those passes out on both
 * sides (diagnosis).
 */
const SKIP = new Set((params.get('skip') ?? '').split(',').filter(Boolean));

const kit = createPageKit({
	width: WIDTH,
	height: HEIGHT,
	antialias: ANTIALIAS,
	tolerance: TOLERANCE,
	clearColor: SKY.skyColor
});

/** Wait until `done()` holds (async texture loads, device rebuild). */
async function until(done, label, timeoutMs = 30000) {
	const start = performance.now();
	while (!done()) {
		if (performance.now() - start > timeoutMs) {
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

/** Legacy MapRenderer onWorldComplete: env colour and light direction (R-CTX-012). */
function legacyLight(data) {
	const { mat4 } = glMatrix;
	const light = { ...data, diffuse: [...data.diffuse], ambient: [...data.ambient] };
	light.env = new Float32Array([
		1 - (1 - light.diffuse[0]) * (1 - light.ambient[0]),
		1 - (1 - light.diffuse[1]) * (1 - light.ambient[1]),
		1 - (1 - light.diffuse[2]) * (1 - light.ambient[2])
	]);
	light.direction = new Float32Array(3);
	const longitude = (light.longitude * Math.PI) / 180;
	const latitude = (light.latitude * Math.PI) / 180;
	const dirMat4 = mat4.create();
	mat4.rotateY(dirMat4, dirMat4, longitude);
	mat4.rotateX(dirMat4, dirMat4, latitude);
	const dirVec = mat4.multiplyVec3([0, 1, 0], dirMat4);
	light.direction[0] = -dirVec[0];
	light.direction[1] = -dirVec[1];
	light.direction[2] = -dirVec[2];
	return light;
}

/** The camera of a frame: matrices, and the world point it looks at (occluder focus). */
function viewOf(camera) {
	const view = cameraMatrices(camera, WIDTH, HEIGHT);
	const focus = new Float32Array([camera.target[0] + 0.5, camera.focusY ?? 0, camera.target[1] + 0.5]);
	return { ...view, focus };
}

/** Grid-selector cells of a frame, as MapRenderer: the captcha range (walkable) then the hit cell. */
function gridCells(grid) {
	if (!grid) {
		return [];
	}
	const walkable = Altitude.getCellType(grid.x, grid.y) & Altitude.TYPE.WALKABLE;
	if (!walkable) {
		return [];
	}
	const range = grid.range ? Altitude.getCellsInSquareRange(grid.x, grid.y, grid.range) : [];
	return [...range, { x: grid.x, y: grid.y }];
}

async function run() {
	if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) {
		return { ok: false, noAdapter: true, error: 'no WebGPU adapter' };
	}
	const legacy = kit.makeCanvas('legacy world (WebGL2)');
	const legacyDraws = kit.countDraws(legacy.gl);
	const lgl = legacy.gl;
	const debug = lgl.getExtension('WEBGL_debug_renderer_info');
	const legacyRenderer = debug ? lgl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

	const assets = buildWorldAssets();
	for (const [path, url] of assets.files) {
		files.set(path, url);
	}

	// Legacy seams: graphics (occluder fade, cadence) and the camera (state, focus).
	Object.assign(graphics, {
		performanceMode: false,
		occluderFade: 'off',
		occluderFadeRadius: 5,
		occluderFadeOpacity: 0.25
	});
	Camera.states = { first_person: 1, third_person: 0 };
	Camera.state = Camera.states.third_person;
	Camera.focus = new Float32Array(3);

	// Count the legacy image loads (Texture.load backs WebGL.texture, the ground atlas and grid.tga).
	let pendingTextures = 0;
	const realLoad = Texture.load;
	Texture.load = function load(data, oncomplete, ...rest) {
		pendingTextures++;
		return realLoad.call(
			this,
			data,
			function done(...args) {
				try {
					return oncomplete.apply(this, args);
				} finally {
					pendingTextures--;
				}
			},
			...rest
		);
	};

	// --- legacy: MapRenderer.onWorldComplete / onGroundComplete / onAltitudeComplete / models
	lgl.viewport(0, 0, WIDTH, HEIGHT);
	lgl.enable(lgl.DEPTH_TEST);
	lgl.depthFunc(lgl.LEQUAL);
	lgl.enable(lgl.BLEND);
	lgl.blendFunc(lgl.SRC_ALPHA, lgl.ONE_MINUS_SRC_ALPHA);
	SpriteRenderer.init(lgl);
	// In MapRenderer the entity pass binds the SpriteRenderer 3D context every frame;
	// runWithDepth (water, model and occluder passes) only switches depth state once bound.
	const identity4 = glMatrix.mat4.create();
	SpriteRenderer.bind3DContext(lgl, identity4, identity4, {
		use: false,
		exist: false,
		near: 0,
		far: 1,
		color: [0, 0, 0]
	});
	SpriteRenderer.unbind(lgl);
	const light = legacyLight(assets.world.light);
	const waterData = {
		...assets.world.water,
		mesh: assets.ground.waterMesh,
		vertCount: assets.ground.waterVertCount
	};
	Ground.init(lgl, assets.ground);
	Water.init(lgl, waterData);
	Altitude.init(assets.altitude);
	GridSelector.init(lgl);
	Models.init(lgl, assets.models);
	// Legacy keeps the payloads' key arrays by reference (#69 compensation edits them).
	const legacyAnimated = assets.animated.map(model => structuredClone(model));
	for (const model of legacyAnimated) {
		AnimatedModels.add(lgl, model);
	}
	const preKeyLists = preKeyListsOf(legacyAnimated);

	// --- gpu-webgpu: two backends, each fed the same payloads: the production one, and one drawn
	// in ANGLE's raster orientation (y-flipped projection, rows read top-down; see
	// NATIVE_GATE_PCT). The canvas texels come through a scratch WebGL2 unpack (`unpackGl`), as
	// legacy's texImage2D(canvas) stores them.
	const unpackGl = document.createElement('canvas').getContext('webgl2');
	const createBackend = async ({ title, portLog }) => {
		const canvas = document.createElement('canvas');
		canvas.width = WIDTH;
		canvas.height = HEIGHT;
		canvas.title = title;
		document.getElementById('canvases').append(canvas);
		const target = await new WebGpuBackend({
			gpu: navigator.gpu,
			canvas,
			overlay: {
				show: spec => portLog.push(['overlay.show', spec]),
				hide: () => portLog.push(['overlay.hide'])
			},
			assets: { purge: extensions => portLog.push(['assets.purge', [...extensions]]) },
			settings: { get: () => undefined, set() {} },
			scene: {
				runStep() {},
				currentMap: () => MAP,
				setMap: async name => {
					portLog.push(['scene.setMap', name]);
				}
			},
			fallback: { switchToWebgl2: async reason => portLog.push(['fallback.switchToWebgl2', reason]) },
			now: () => performance.now(),
			files: { load: path => Promise.resolve(files.get(path) ?? null) },
			unpackGl,
			sampleCount: ANTIALIAS ? 4 : 1,
			log: (message, err) => portLog.push(['log', `${message}: ${err?.stack ?? err}`])
		}).init();
		target.beginMap(1);
		const messages = [
			['MAP_ALTITUDE', assets.altitude],
			['MAP_WORLD', assets.world],
			['MAP_GROUND', assets.ground],
			['MAP_MODELS', assets.models],
			...assets.animated.map(model => ['MAP_ANIMATED_MODEL', structuredClone(model)])
		];
		for (const [type, payload] of messages) {
			target.acceptMapMessage({ type, payload, request: 1 });
		}
		// A stale message (another load's request) must be dropped.
		target.acceptMapMessage({
			type: 'MAP_MODELS',
			payload: { buffer: new Float32Array(0), infos: [] },
			request: 0
		});
		await target.whenMapReady();
		return target;
	};
	const portLog = [];
	const angleLog = [];
	const backend = await createBackend({ title: 'gpu-webgpu world (WebGpuBackend)', portLog });
	const angle = await createBackend({ title: 'gpu-webgpu world, ANGLE raster orientation', portLog: angleLog });
	const shaderMessages = [];
	for (const [name, module] of Object.entries(backend.world._gpu.modules)) {
		for (const m of (await module.getCompilationInfo()).messages) {
			shaderMessages.push(`world ${name}.wgsl ${m.type} ${m.lineNum}:${m.linePos} ${m.message}`);
		}
	}
	const skipped = {
		ground: '_drawGround',
		grid: '_drawGrid',
		models: '_drawStaticModels',
		animated: '_drawAnimatedModels',
		water: '_drawWater'
	};
	const skipWorld = world => {
		for (const [name, method] of Object.entries(skipped)) {
			if (SKIP.has(name)) {
				world[method] = () => {};
			}
		}
	};
	skipWorld(backend.world);
	skipWorld(angle.world);
	await until(() => pendingTextures === 0, 'legacy textures');
	await new Promise(resolve => setTimeout(resolve, 20));

	/** One legacy frame in MapRenderer.onRender order (world passes only). */
	const renderLegacy = (f, view) => {
		kit.clear(lgl);
		MapPreferences.lightmap = f.lightmap;
		MapPreferences.smoothlight = f.smoothlight;
		graphics.occluderFade = f.occluder?.mode ?? 'off';
		Camera.focus.set(view.focus);
		const fog = { use: f.fog, exist: true, near: FOG.near, far: FOG.far, color: new Float32Array(FOG.color) };
		const frameLight = f.legacyLightOpacity === undefined ? light : { ...light, opacity: f.legacyLightOpacity };
		const { modelView, projection } = view;
		if (!SKIP.has('ground')) {
			Ground.render(lgl, modelView, projection, IDENTITY3, fog, frameLight);
		}
		for (const cell of SKIP.has('grid') ? [] : f.cells) {
			GridSelector.render(lgl, modelView, projection, fog, cell.x, cell.y);
		}
		OccluderFade.beginFrame(lgl, modelView, f.tick);
		if (!SKIP.has('models')) {
			Models.render(lgl, modelView, projection, IDENTITY3, fog, frameLight);
		}
		if (!SKIP.has('animated')) {
			AnimatedModels.render(lgl, modelView, projection, IDENTITY3, fog, frameLight, f.tick);
		}
		if (!SKIP.has('water')) {
			Water.render(lgl, modelView, projection, fog, frameLight, f.tick);
		}
		if (!SKIP.has('models')) {
			Models.renderFaded(lgl, modelView, projection, IDENTITY3, fog, frameLight);
		}
		if (!SKIP.has('animated')) {
			AnimatedModels.renderFaded(lgl, modelView, projection, IDENTITY3, fog, frameLight);
		}
		lgl.finish();
	};

	/**
	 * One gpu-webgpu frame through drawFrame, read back with capture() (bottom-up rows).
	 * `water`: a world/water record's fields (alpha, textureIndex), or null for the fixed default;
	 * `target`: `angle` draws in ANGLE's raster orientation (y-flipped projection: the frame lands
	 * upside down, its top-down rows are legacy's bottom-up ones); `animated`: `animatedModel`
	 * records (their matrices replace the models').
	 */
	const renderModern = async (
		f,
		view,
		{ water = { alpha: LEGACY_WATER_ALPHA }, light: lightOverride, target = backend, animated = null } = {}
	) => {
		const flipY = target === angle;
		const fog = { use: f.fog, near: FOG.near, far: FOG.far, color: FOG.color };
		const stream = water
			? { water: [{ kind: 'world', part: 'water', depthTest: true, depthWrite: false, ...water }] }
			: {};
		if (animated) {
			stream.animatedModels = animated;
		}
		const projection = flipY
			? Float32Array.from(view.projection, (v, i) => (i % 4 === 1 ? -v : v))
			: view.projection;
		const image = target.capture();
		const stats = target.drawFrame(stream, {
			view: { modelView: view.modelView, projection, zoom: 30, fog },
			world: {
				flipY,
				sky: SKY,
				tick: f.tick,
				lightmap: f.lightmap,
				smoothlight: f.smoothlight,
				grid: f.cells,
				occluder: { ...(f.occluder ?? { mode: 'off' }), opacity: 0.25, radius: 5, focus: view.focus },
				light: lightOverride
			}
		});
		if (!stats.drawn) {
			throw new Error(`drawFrame did not draw: ${stats.reason ?? stats.error?.stack ?? stats.error}`);
		}
		const img = await image;
		return { pixels: flipY ? img.data : bottomUp(img.data, img.width, img.height), stats };
	};
	const renderAngle = (f, view, options = {}) => renderModern(f, view, { ...options, target: angle });

	const frames = [];
	const checks = [];
	const strengths = [];
	let control = null;
	let waterCheck = null;
	let animatedCheck = null;
	let unsupported = 0;
	const last = CAPTURES[CAPTURES.length - 1].at;
	for (let tick = START_TICK; tick <= last; tick += TICK_MS) {
		const shot = CAPTURES.find(c => c.at === tick);
		const phase = CAPTURES.filter(c => c.at <= tick).pop() ?? CAPTURES[0];
		const f = {
			tick,
			fog: Boolean(phase.fog),
			lightmap: phase.lightmap ?? true,
			smoothlight: phase.smoothlight ?? 0,
			occluder: phase.occluder ?? null,
			legacyLightOpacity: phase.lightmap === false ? 0 : undefined,
			cells: gridCells(phase.grid ?? GRID)
		};
		const view = viewOf(phase.occluder ? OCCLUDER_CAMERA : CAMERA);
		f.preKey = holdFirstKeys(preKeyLists, tick, true);
		legacyDraws.drawArrays = 0;
		legacyDraws.drawArraysInstanced = 0;
		renderLegacy(f, view);
		const legacyDrawCalls = legacyDraws.drawArrays + legacyDraws.drawArraysInstanced;
		const { pixels: b, stats } = await renderModern(f, view);
		const { pixels: c, stats: angleStats } = await renderAngle(f, view);
		unsupported += stats.unsupportedRecords + angleStats.unsupportedRecords;
		if (phase.occluder) {
			strengths.push({
				tick,
				legacy: OccluderFade.getStrength(),
				modern: backend.world.occluderStrength,
				angle: angle.world.occluderStrength
			});
			// Legacy's query results become available on a later task; gpu-webgpu's read-back too.
			await Promise.all([backend.world.whenQueriesRead(), angle.world.whenQueriesRead()]);
			await new Promise(resolve => setTimeout(resolve, 0));
		}
		if (!shot) {
			continue;
		}
		const a = kit.readPixels(lgl);
		frames.push({
			name: shot.name,
			detail: `tick ${tick}, fog ${f.fog}, lightmap ${f.lightmap}, smoothlight ${f.smoothlight}, ${f.cells.length} grid cells, occluder ${f.occluder?.mode ?? 'off'} (strength legacy ${OccluderFade.getStrength().toFixed(3)} / gpu-webgpu ${backend.world.occluderStrength.toFixed(3)})${f.legacyLightOpacity === 0 ? ', legacy light.opacity 0 (R-MAP-013 compensated)' : ''}${f.preKey ? `, ${f.preKey} key list(s) before their first key: legacy holds it via a frame-0 copy (#69 compensated)` : ''}; ${stats.worldDrawCalls} world draws`,
			...kit.compare(a, b),
			records: 1,
			worldDrawCalls: stats.worldDrawCalls,
			legacyDrawCalls,
			modernDrawCalls: stats.drawCalls,
			fallbacks: stats.fallbacks,
			runs: stats.runs,
			batches: backend.runs.lastBatches.map(r => r.count),
			images: {
				legacy: legacy.canvas.toDataURL('image/png'),
				modern: toPng(b),
				diff: kit.diffImage(a, b)
			},
			gatePct: ANTIALIAS ? NATIVE_AA_GATE_PCT : NATIVE_GATE_PCT
		});
		frames.push({
			name: `${shot.name}-angle-orientation`,
			detail: 'same frame, y-flipped projection, rows read top-down (ANGLE raster orientation)',
			...kit.compare(a, c),
			records: 1,
			worldDrawCalls: angleStats.worldDrawCalls,
			legacyDrawCalls,
			modernDrawCalls: angleStats.drawCalls,
			fallbacks: angleStats.fallbacks,
			runs: angleStats.runs,
			batches: angle.runs.lastBatches.map(r => r.count),
			images: { modern: toPng(c), diff: kit.diffImage(a, c) }
		});

		if (!control && !phase.occluder) {
			// Sensitivity control: the light direction nudged by 0.01 must change pixels.
			const nudged = backend.world.light.direction.map((v, i) => (i === 0 ? v + 0.01 : v));
			control = kit.compare(a, (await renderModern(f, view, { light: { direction: nudged } })).pixels);
		}
		if (shot.waterCheck) {
			waterCheck = await checkWaterFix(a, tiePixels(a, c), f, view, renderAngle);
		}
		if (shot.animatedCheck) {
			animatedCheck = await checkAnimatedFix(tiePixels(a, c), f, view, renderLegacy, renderAngle, angle, lgl);
		}
	}

	checks.push(waterCheck, animatedCheck);
	const occluderFrames = strengths.filter(s => s.legacy !== s.modern || s.legacy !== s.angle);
	checks.push({
		name: 'occluder fade strength (R-MAP-019) follows legacy on every occluder tick',
		ok:
			occluderFrames.length === 0 &&
			strengths.some(s => s.modern > 0.99) &&
			strengths.some(s => s.modern > 0 && s.modern < 1),
		detail: `${strengths.length} ticks, ${occluderFrames.length} differ; strengths ${strengths.map(s => s.modern.toFixed(2)).join(' ')}`
	});

	// Device loss: destroy the backend's device; it must rebuild on a new device and re-upload
	// the map from the retained MAP_* payloads (R-CTX-007), and the next frame must match legacy.
	const loss = await loseDevice(backend, portLog);
	checks.push(...loss.checks);
	skipWorld(backend.world);
	{
		const f = { ...frameAt(CAPTURES[0]), tick: last + TICK_MS };
		const view = viewOf(CAMERA);
		f.preKey = holdFirstKeys(preKeyLists, f.tick, true);
		legacyDraws.drawArrays = 0;
		renderLegacy(f, view);
		const a = kit.readPixels(lgl);
		const { pixels: b, stats } = await renderModern(f, view);
		frames.push({
			name: 'world-after-device-loss',
			detail: `tick ${f.tick}: after device.destroy() and the rebuild (map re-uploaded from retained payloads)${f.preKey ? `, ${f.preKey} key list(s) before their first key (#69 compensated)` : ''}; ${stats.worldDrawCalls} world draws`,
			gatePct: ANTIALIAS ? NATIVE_AA_GATE_PCT : NATIVE_GATE_PCT,
			...kit.compare(a, b),
			records: 1,
			worldDrawCalls: stats.worldDrawCalls,
			legacyDrawCalls: legacyDraws.drawArrays,
			modernDrawCalls: stats.drawCalls,
			fallbacks: stats.fallbacks,
			runs: stats.runs,
			batches: backend.runs.lastBatches.map(r => r.count),
			images: {
				legacy: legacy.canvas.toDataURL('image/png'),
				modern: toPng(b),
				diff: kit.diffImage(a, b)
			}
		});
		checks.push({
			name: 'device loss: the first frame on the new device draws the whole map again',
			ok: stats.worldDrawCalls > 0 && stats.worldDrawCalls === frames[0]?.worldDrawCalls,
			detail: `${stats.worldDrawCalls} world draws (first frame: ${frames[0]?.worldDrawCalls})`
		});
	}
	checks.push(
		await checkPreKeyFix(
			last + TICK_MS,
			frameAt(CAPTURES[0]),
			{ renderLegacy, renderAngle, lgl, angle },
			legacyAnimated,
			preKeyLists
		)
	);
	const preKeyFrames = frames.filter(fr => fr.detail.includes('#69'));
	checks.push({
		name: '#69: every captured pre-key frame is compensated and within its gate',
		ok: preKeyFrames.length > 0 && preKeyFrames.every(fr => fr.overTolerancePct <= fr.gatePct),
		detail: preKeyFrames.map(fr => `${fr.name}: ${fr.overTolerance} px over tolerance`).join(', ')
	});

	checks.push({
		name: 'world records consumed (no unsupported record)',
		ok: unsupported === 0,
		detail: `${unsupported} unsupported records`
	});
	checks.push(waterFormulaCheck());
	checks.push({
		name: 'payload content (MAP_GROUND / MAP_MODELS / MAP_ANIMATED_MODEL)',
		ok:
			assets.ground.waterVertCount > 0 &&
			assets.models.infos.length > 3 &&
			backend.world.animated.length === 2 &&
			backend.world.paletteOverflow === 0,
		detail: `${assets.ground.meshVertCount} ground vertices, ${assets.ground.waterVertCount} water vertices, ${assets.models.infos.length} model infos (${assets.models.buffer.length / 9} vertices), ${backend.world.animated.length} animated models (${backend.world.animated.map(m => m.vertexCount).join('+')} vertices, storage palette ${backend.world.animated.reduce((n, m) => n + m.matrixCount, 0)} matrices); stale request dropped: ${backend.world.models.payload.infos.length === assets.models.infos.length}`
	});
	Texture.load = realLoad;

	await backend.device.queue.onSubmittedWorkDone();
	const info = backend.renderDevice.adapter.info ?? {};
	const errors = [...backend.errors, ...portLog.filter(e => e[0] === 'log').map(e => e[1])];
	const pipelines = backend.world._gpu.pipelines.size;
	backend.dispose();
	return {
		ok: true,
		page: 'world',
		adapter: `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.trim(),
		fallbackAdapter: Boolean(info.isFallbackAdapter),
		legacyRenderer,
		canvasFormat: backend.format,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: frames.map(() => 1),
		glError: lgl.getError(),
		gpuErrors: errors,
		shaderMessages,
		pipelines,
		control,
		deviceLoss: loss.summary,
		checks,
		frames
	};

	function frameAt(capture) {
		return {
			fog: Boolean(capture.fog),
			lightmap: capture.lightmap ?? true,
			smoothlight: capture.smoothlight ?? 0,
			occluder: null,
			cells: gridCells(capture.grid ?? GRID)
		};
	}
}

/**
 * Real device loss: destroy the backend's device mid-run (resolves `device.lost` with
 * 'destroyed'), then check R-CTX-006/007 through the recorded ports and wait for the rebuild.
 */
async function loseDevice(backend, portLog) {
	const oldDevice = backend.device;
	const mark = portLog.length;
	oldDevice.destroy();
	await until(() => backend.loss.losses > 0, 'device.lost');
	const kind = await backend.recovered();
	const names = portLog.slice(mark).map(e => e[0]);
	return {
		checks: [
			{
				name: 'device loss (R-CTX-006/007): overlay, purge, rebuilt on a new device with the map, setMap re-run',
				ok:
					kind === 'webgpu' &&
					backend.device !== oldDevice &&
					backend.running &&
					backend.world.device === backend.device &&
					Boolean(backend.world.ground?.gpu && backend.world.models?.gpu && backend.world.water?.gpu) &&
					names.includes('overlay.show') &&
					names.includes('assets.purge') &&
					names.indexOf('overlay.hide') > names.indexOf('overlay.show') &&
					names.includes('scene.setMap') &&
					!names.includes('fallback.switchToWebgl2'),
				detail: `recovered: ${kind}; ports: ${names.join(' → ')}`
			}
		],
		summary: { kind, ports: names }
	};
}

/** Legacy AnimatedModels animLen: the payload's, or (when 0) the largest key frame + 1. */
function legacyAnimLen(data) {
	if (data.animLen) {
		return data.animLen;
	}
	let max = 0;
	for (const node of data.nodes) {
		node.rotKeyframes.forEach(kf => (max = Math.max(max, kf.frame || 0)));
		node.posKeyframes.forEach(kf => (max = Math.max(max, kf.frame || 0)));
		node.scaleKeyFrames.forEach(kf => (max = Math.max(max, kf.Frame || 0)));
	}
	return max + 1;
}

/** Legacy AnimatedModels recompute bucket of keyframe position `frame` (performance mode off). */
const legacyBucket = (data, frame) => Math.floor(frame / (1000 / ((data.frameRatePerSecond || 30) / 1.14)));

const frameOfKey = kf => kf.frame;
const frameOfScale = kf => (typeof kf.Frame !== 'undefined' ? kf.Frame : kf.frame);

/**
 * #69: the key lists (two keys or more) whose first key is after frame 0, of the legacy
 * payloads (after AnimatedModels.add decoded the keys), with a frame-0 copy of that key.
 */
function preKeyListsOf(payloads) {
	const lists = [];
	payloads.forEach((data, model) => {
		const animLen = legacyAnimLen(data);
		data.nodes.forEach((node, index) => {
			for (const [field, frameOf] of [
				['rotKeyframes', frameOfKey],
				['posKeyframes', frameOfKey],
				['scaleKeyFrames', frameOfScale]
			]) {
				const keys = node[field];
				if (keys.length > 1 && frameOf(keys[0]) > 0) {
					const [first] = keys;
					const copy = typeof first.Frame !== 'undefined' ? { ...first, Frame: 0 } : { ...first, frame: 0 };
					lists.push({ model, node: index, keys, first, copy, frameOf, animLen });
				}
			}
		});
	});
	return lists;
}

/** Whether a list is before its first key at `tick` (keyframe position tick % animLen). */
const inPreKey = (list, tick) => list.frameOf(list.first) > tick % (list.animLen || 1);

/**
 * #69 compensation of legacy at `tick`: `on` puts the frame-0 copy in front of every list
 * in its pre-key window (legacy then holds the first key) and removes it elsewhere; off
 * removes every copy (legacy as is). Returns the number of lists held.
 */
function holdFirstKeys(lists, tick, on) {
	let held = 0;
	for (const list of lists) {
		const want = on && inPreKey(list, tick);
		const has = list.keys[0] === list.copy;
		if (want && !has) {
			list.keys.unshift(list.copy);
		} else if (!want && has) {
			list.keys.shift();
		}
		held += want ? 1 : 0;
	}
	return held;
}

/** Indices (first channel) of the pixels where `a` and `b` differ over the tolerance. */
function overTolerance(a, b) {
	const out = new Set();
	for (let i = 0; i < a.length; i += 4) {
		if ([0, 1, 2, 3].some(c => Math.abs(a[i + c] - b[i + c]) > TOLERANCE)) {
			out.add(i);
		}
	}
	return out;
}

/**
 * #69 fix, declared narrowly at a pre-key tick after the parity frames (camera and
 * settings of the first capture, occluder off), on the ANGLE-orientation backend (the
 * page gate holds there with and without MSAA):
 * - legacy compensated (first key held through its frame-0 copy) vs gpu-webgpu: within the
 *   page gate; the pixels over tolerance are the frame's depth ties (`tiePixels`);
 * - legacy as is vs gpu-webgpu fed an animatedModel record whose pre-key nodes (own list
 *   before its first key, or such an ancestor) have NaN matrices, every other matrix being
 *   gpu-webgpu's own: no pixel over tolerance outside the ties, so legacy draws nothing
 *   exactly where those nodes are;
 * - gpu-webgpu draws them: outside the ties, the pixels where its frame differs from the
 *   NaN one are exactly those where legacy as is differs from it.
 */
async function checkPreKeyFix(afterTick, base, { renderLegacy, renderAngle, lgl, angle }, payloads, lists) {
	const name =
		'#69 fix: before the first key gpu-webgpu holds it (legacy compensated: within the gate); legacy as is draws nothing exactly there';
	// a pre-key tick whose recompute bucket differs from the last rendered tick's (every model)
	const changes = (t0, t1) =>
		payloads.every(d => {
			const len = legacyAnimLen(d);
			return legacyBucket(d, t0 % len) !== legacyBucket(d, t1 % len);
		});
	let tick = afterTick + TICK_MS;
	while (!(lists.some(l => inPreKey(l, tick)) && changes(afterTick, tick))) {
		tick += TICK_MS;
		if (tick > afterTick + 100000) {
			return { name, ok: false, detail: 'no pre-key tick found' };
		}
	}
	let other = tick + TICK_MS;
	while (!changes(other, tick)) {
		other += TICK_MS;
	}
	const f = { ...base, tick };
	const view = viewOf(CAMERA);
	const held = lists.filter(l => inPreKey(l, tick));

	holdFirstKeys(lists, tick, true);
	renderLegacy(f, view);
	const compensated = kit.readPixels(lgl);
	const modern = (await renderAngle(f, view)).pixels;

	// legacy as is: render another bucket first so the matrices are recomputed at `tick`
	holdFirstKeys(lists, tick, false);
	renderLegacy({ ...f, tick: other }, view);
	renderLegacy(f, view);
	const legacy = kit.readPixels(lgl);

	// gpu-webgpu with the pre-key nodes' matrices NaN (records replace the model's matrices)
	const records = [];
	for (const [model, rsm] of angle.world.animated.entries()) {
		const data = payloads[model];
		const index = new Map(data.nodes.map((n, i) => [n.name, i]));
		const own = new Set(held.filter(l => l.model === model).map(l => l.node));
		const pre = i => {
			for (let n = i, guard = 0; n !== undefined && guard <= data.nodes.length; guard++) {
				if (own.has(n)) {
					return true;
				}
				const node = data.nodes[n];
				n = node.parentname === node.name ? undefined : index.get(node.parentname);
			}
			return false;
		};
		const matrices = Float32Array.from(rsm.matrices);
		const count = rsm.instances.length;
		data.nodes.forEach((_, n) => {
			if (pre(n)) {
				matrices.fill(NaN, n * count * 16, (n + 1) * count * 16);
			}
		});
		records.push({ kind: 'world', part: 'animatedModel', matrices, params: { model } });
	}
	const nanModern = (await renderAngle(f, view, { animated: records })).pixels;

	const ties = overTolerance(compensated, modern);
	const outsideTies = set => [...set].filter(i => !ties.has(i));
	const legacyOff = outsideTies(overTolerance(legacy, nanModern)).length;
	const drawn = new Set(outsideTies(overTolerance(modern, nanModern)));
	const asIs = new Set(outsideTies(overTolerance(legacy, modern)));
	const mismatch = [...drawn].filter(i => !asIs.has(i)).length + [...asIs].filter(i => !drawn.has(i)).length;
	const tiePct = (100 * ties.size) / (WIDTH * HEIGHT);
	return {
		name,
		ok: held.length > 0 && tiePct <= NATIVE_GATE_PCT && legacyOff === 0 && drawn.size > 0 && mismatch === 0,
		detail: `tick ${tick}, ANGLE orientation (${held.map(l => `${payloads[l.model].filename.split('\\').pop()} node ${l.node}`).join(', ')} before their first key, descendants following): compensated legacy vs gpu-webgpu ${ties.size} px over tolerance (${tiePct.toFixed(4)} %, depth ties); outside them: legacy as is vs gpu-webgpu with the pre-key nodes NaN ${legacyOff} px; held nodes draw ${drawn.size} px, legacy as is vs gpu-webgpu ${asIs.size} px, ${mismatch} px in only one of the two`
	};
}

/**
 * Pixels (indices of the first channel) where the compensated gpu-webgpu frame `modern` is over the
 * tolerance from `legacyPixels`: the frame's depth ties (smoke/README.md, "Gates for world"), left
 * out of the fix checks' "only here" counts below (gpu-webgl2 has none, its checks are exact).
 */
function tiePixels(legacyPixels, modern) {
	const ties = new Set();
	for (let i = 0; i < modern.length; i += 4) {
		if ([0, 1, 2].some(c => Math.abs(modern[i + c] - legacyPixels[i + c]) > TOLERANCE)) {
			ties.add(i);
		}
	}
	return ties;
}

/**
 * R-MAP-010 fix: the fixed frame (alpha 0.8) differs from the compensated one only on
 * water pixels, each by the predicted blend 0.8·W + 0.2·D (W: water drawn with alpha 1,
 * D: no water), and legacy is 0.64·W + 0.36·D. Linear in coverage, so MSAA edges hold too.
 * `ties`: the parity frame's depth-tie pixels, not counted as outside or off.
 */
async function checkWaterFix(legacyPixels, ties, f, view, renderModern) {
	const fixed = (await renderModern(f, view, { water: null })).pixels;
	const opaque = (await renderModern(f, view, { water: { alpha: 1 } })).pixels;
	const dry = (await renderModern(f, view, { water: { alpha: 0 } })).pixels;
	// Rounding: one blend (±1); with MSAA the resolve averages per-sample rounded blends (±2).
	const slack = ANTIALIAS ? 2.5 : 1.5;
	let waterPixels = 0;
	let outside = 0;
	let fixedOff = 0;
	let legacyOff = 0;
	let changed = 0;
	for (let i = 0; i < fixed.length; i += 4) {
		let isWater = false;
		for (let c = 0; c < 3; c++) {
			if (opaque[i + c] !== dry[i + c]) {
				isWater = true;
			}
		}
		if (isWater) {
			waterPixels++;
		}
		if (ties.has(i)) {
			continue;
		}
		for (let c = 0; c < 3; c++) {
			const predicted = 0.8 * opaque[i + c] + 0.2 * dry[i + c];
			const predictedLegacy = LEGACY_WATER_ALPHA * opaque[i + c] + (1 - LEGACY_WATER_ALPHA) * dry[i + c];
			if (fixed[i + c] !== legacyPixels[i + c]) {
				changed++;
				if (!isWater) {
					outside++;
				}
			}
			if (Math.abs(fixed[i + c] - predicted) > slack) {
				fixedOff++;
			}
			if (Math.abs(legacyPixels[i + c] - predictedLegacy) > slack) {
				legacyOff++;
			}
		}
	}
	return {
		name: 'R-MAP-010 fix: alpha 0.8 applied once changes only water pixels, by the predicted blend',
		ok: waterPixels > 1000 && changed > 0 && outside === 0 && fixedOff === 0 && legacyOff === 0,
		detail: `${waterPixels} water px; ${changed} channel values differ from legacy (0.64), ${outside} outside the water; off the 0.8·W+0.2·D prediction: ${fixedOff}; legacy off 0.64·W+0.36·D: ${legacyOff} (${ties.size} depth-tie px of the parity frame left out)`
	};
}

/**
 * R-MAP-013 fix: with the lightmap preference off, legacy (uncompensated: light.opacity
 * kept) differs from gpu-webgpu only on animated-model pixels. `ties`: the parity frame's
 * depth-tie pixels, not counted as outside.
 */
async function checkAnimatedFix(ties, f, view, renderLegacy, renderModern, backend, lgl) {
	const kitRead = gl => {
		const out = new Uint8Array(WIDTH * HEIGHT * 4);
		gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, out);
		return out;
	};
	SKIP.add('animated');
	renderLegacy({ ...f, legacyLightOpacity: undefined }, view);
	const legacyWithout = kitRead(lgl);
	SKIP.delete('animated');
	renderLegacy({ ...f, legacyLightOpacity: undefined }, view);
	const uncompensated = kitRead(lgl);
	const withModels = (await renderModern(f, view)).pixels;
	const saved = backend.world.animatedGpu;
	backend.world.animatedGpu = null;
	const withoutModels = (await renderModern(f, view)).pixels;
	backend.world.animatedGpu = saved;
	let differing = 0;
	let outside = 0;
	let animatedPixels = 0;
	for (let i = 0; i < withModels.length; i += 4) {
		// animated-model footprint on either side (with vs without the animated pass)
		const animated = [0, 1, 2].some(
			c => withModels[i + c] !== withoutModels[i + c] || uncompensated[i + c] !== legacyWithout[i + c]
		);
		if (animated) {
			animatedPixels++;
		}
		if ([0, 1, 2].some(c => withModels[i + c] !== uncompensated[i + c])) {
			differing++;
			if (!animated && !ties.has(i)) {
				outside++;
			}
		}
	}
	return {
		name: 'R-MAP-013 fix: lightmap off, legacy (N·L kept) differs only on animated-model pixels',
		ok: differing > 0 && outside === 0 && animatedPixels > 0,
		detail: `${animatedPixels} animated px, ${differing} px differ from uncompensated legacy, ${outside} outside the animated models (${ties.size} depth-tie px of the parity frame left out)`
	};
}

/** Water frame/wave formulas: the captured ticks give the same values in both forms. */
function waterFormulaCheck() {
	const bad = CAPTURES.filter(c => {
		const legacyFrame = c.at / (1000 / 60);
		const frame = (c.at * 60) / 1000;
		const offset = n => Math.fround(((n * WATER.waveSpeed) % 360) - 180);
		const index = n => Math.floor(n / WATER.animSpeed) % 32;
		return offset(legacyFrame) !== offset(frame) || index(legacyFrame) !== index(frame);
	});
	return {
		name: 'captured ticks: legacy tick/(1000/60) and tick·60/1000 agree (integration decision #3)',
		ok: bad.length === 0,
		detail: bad.length ? `differ at ${bad.map(c => c.at).join(', ')}` : `${CAPTURES.length} ticks agree`
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
