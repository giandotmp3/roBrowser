/**
 * World parity page: the REAL legacy map renderers (Renderer/Map/Ground, Water, Models,
 * AnimatedModels, GridSelector, Altitude, OccluderFade; unmodified, with the real
 * Utils/WebGL.js, Utils/Texture.js and SpriteRenderer depth state) draw a synthetic map
 * into canvas A in MapRenderer.onRender's order; gpu-webgl2's WebGL2Backend receives the
 * same MAP_* payloads through `acceptMapMessage` and draws them with `drawFrame` (R-CTX-010
 * steps) into canvas B. Pixels are compared on every captured frame. Results land on
 * `window.__parity` for smoke/run-parity.mjs (`--page=world`).
 *
 * Declared divergences (fixed legacy bugs), each compared twice:
 * - R-MAP-010 water alpha: legacy squares the opacity (0.64). Parity frames feed
 *   gpu-webgl2 a `world`/`water` record with alpha 0.64 (the record path, legacy
 *   compensated); a check renders the fixed default (0.8) and asserts that only water
 *   pixels change, each by the predicted 0.8·W + 0.2·D blend.
 * - R-MAP-013 animated RSM and the lightmap preference: with the preference off, legacy
 *   still applies N·L to animated models. The lightmap-off frame runs legacy with
 *   light.opacity 0 (the animated weighting becomes 1.0, the fix's full diffuse; ground
 *   and static models never read the opacity); a check shows the uncompensated
 *   difference is confined to animated-model pixels.
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
import { WebGL2Backend } from '../src/WebGL2Backend.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
/** Legacy water alpha: uOpacity applied twice (R-MAP-010), as the shader's float32 product. */
const LEGACY_WATER_ALPHA = Math.fround(Math.fround(0.8) * Math.fround(0.8));
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
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

/** Wait until `done()` holds (async texture loads). */
async function until(done, label, timeoutMs = 30000) {
	const start = performance.now();
	while (!done()) {
		if (performance.now() - start > timeoutMs) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
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
	const legacy = kit.makeCanvas('legacy world');
	const modern = kit.makeCanvas('gpu-webgl2 world');
	const legacyDraws = kit.countDraws(legacy.gl);
	const modernDraws = kit.countDraws(modern.gl);
	const lgl = legacy.gl;
	const debug = modern.gl.getExtension('WEBGL_debug_renderer_info');
	const rendererName = debug ? modern.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

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
	for (const model of assets.animated) {
		AnimatedModels.add(lgl, structuredClone(model));
	}

	// --- gpu-webgl2: the backend, fed the same payloads
	const backend = new WebGL2Backend({
		canvas: modern.canvas,
		overlay: { show() {}, hide() {} },
		assets: { purge() {} },
		settings: { get: () => undefined, set() {} },
		scene: { runStep() {}, currentMap: () => 'synthetic', rebuildMap() {} },
		now: () => performance.now(),
		files: { load: path => Promise.resolve(files.get(path) ?? null) }
	}).init();
	backend.beginMap(1);
	const messages = [
		['MAP_ALTITUDE', assets.altitude],
		['MAP_WORLD', assets.world],
		['MAP_GROUND', assets.ground],
		['MAP_MODELS', assets.models],
		...assets.animated.map(model => ['MAP_ANIMATED_MODEL', structuredClone(model)])
	];
	for (const [type, payload] of messages) {
		backend.acceptMapMessage({ type, payload, request: 1 });
	}
	// A stale message (another load's request) must be dropped.
	backend.acceptMapMessage({ type: 'MAP_MODELS', payload: { buffer: new Float32Array(0), infos: [] }, request: 0 });
	await backend.whenMapReady();
	const skipped = {
		ground: 'drawGround',
		grid: 'drawGrid',
		models: 'drawStaticModels',
		animated: 'drawAnimatedModels',
		water: 'drawWater'
	};
	for (const [name, method] of Object.entries(skipped)) {
		if (SKIP.has(name)) {
			backend.world[method] = () => {};
		}
	}
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
	 * One gpu-webgl2 frame through drawFrame. `water`: a world/water record's fields
	 * (alpha, textureIndex), or null for the fixed default.
	 */
	const renderModern = (f, view, { water = { alpha: LEGACY_WATER_ALPHA }, light: lightOverride } = {}) => {
		const gl = modern.gl;
		gl.viewport(0, 0, WIDTH, HEIGHT);
		const fog = { use: f.fog, near: FOG.near, far: FOG.far, color: FOG.color };
		const passes = water
			? { water: [{ kind: 'world', part: 'water', depthTest: true, depthWrite: false, ...water }] }
			: {};
		backend.drawFrame({
			passes,
			view: { modelView: view.modelView, projection: view.projection, zoom: 30, fog },
			world: {
				sky: SKY,
				tick: f.tick,
				lightmap: f.lightmap,
				smoothlight: f.smoothlight,
				grid: f.cells,
				occluder: { ...(f.occluder ?? { mode: 'off' }), opacity: 0.25, radius: 5, focus: view.focus },
				light: lightOverride
			}
		});
		gl.finish();
		return kit.readPixels(gl);
	};

	const frames = [];
	const checks = [];
	const strengths = [];
	let control = null;
	let waterCheck = null;
	let animatedCheck = null;
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
		legacyDraws.drawArrays = 0;
		legacyDraws.drawArraysInstanced = 0;
		renderLegacy(f, view);
		const legacyDrawCalls = legacyDraws.drawArrays + legacyDraws.drawArraysInstanced;
		modernDraws.drawArrays = 0;
		modernDraws.drawArraysInstanced = 0;
		const b = renderModern(f, view);
		const modernDrawCalls = modernDraws.drawArrays + modernDraws.drawArraysInstanced;
		if (phase.occluder) {
			strengths.push({ tick, legacy: OccluderFade.getStrength(), modern: backend.world.occluderStrength });
			// Occlusion query results become available on a later task.
			await new Promise(resolve => setTimeout(resolve, 0));
		}
		if (!shot) {
			continue;
		}
		const a = kit.readPixels(lgl);
		const stats = kit.compare(a, b);
		frames.push({
			name: shot.name,
			detail: `tick ${tick}, fog ${f.fog}, lightmap ${f.lightmap}, smoothlight ${f.smoothlight}, ${f.cells.length} grid cells, occluder ${f.occluder?.mode ?? 'off'} (strength legacy ${OccluderFade.getStrength().toFixed(3)} / gpu-webgl2 ${backend.world.occluderStrength.toFixed(3)})${f.legacyLightOpacity === 0 ? ', legacy light.opacity 0 (R-MAP-013 compensated)' : ''}`,
			...stats,
			records: 1,
			legacyDrawCalls,
			modernDrawCalls,
			runs: [],
			images: {
				legacy: legacy.canvas.toDataURL('image/png'),
				modern: modern.canvas.toDataURL('image/png'),
				diff: kit.diffImage(a, b)
			}
		});

		if (!control && !phase.occluder) {
			// Sensitivity control: the light direction nudged by 0.01 must change pixels.
			const nudged = backend.world.light.direction.map((c, i) => (i === 0 ? c + 0.01 : c));
			control = kit.compare(a, renderModern(f, view, { light: { direction: nudged } }));
		}
		if (shot.waterCheck) {
			waterCheck = checkWaterFix(a, f, view, renderModern);
		}
		if (shot.animatedCheck) {
			animatedCheck = checkAnimatedFix(f, view, renderLegacy, renderModern, backend, lgl);
		}
	}

	checks.push(waterCheck, animatedCheck);
	const occluderFrames = strengths.filter(s => s.legacy !== s.modern);
	checks.push({
		name: 'occluder fade strength (R-MAP-019) follows legacy on every occluder tick',
		ok:
			occluderFrames.length === 0 &&
			strengths.some(s => s.modern > 0.99) &&
			strengths.some(s => s.modern > 0 && s.modern < 1),
		detail: `${strengths.length} ticks, ${occluderFrames.length} differ; strengths ${strengths.map(s => s.modern.toFixed(2)).join(' ')}`
	});

	// Context loss: lose and restore the gpu-webgl2 context; the backend rebuilds the map from
	// the retained payloads (R-CTX-007 fix) and the next frame must still match legacy.
	const lose = modern.gl.getExtension('WEBGL_lose_context');
	let restoreStats = null;
	if (lose) {
		const restored = new Promise(resolve =>
			modern.canvas.addEventListener('webglcontextrestored', resolve, { once: true })
		);
		const lost = new Promise(resolve =>
			modern.canvas.addEventListener('webglcontextlost', resolve, { once: true })
		);
		lose.loseContext();
		await lost;
		// restoreContext is allowed once the lost event (default prevented) has dispatched.
		await new Promise(resolve => setTimeout(resolve, 0));
		lose.restoreContext();
		await restored;
		await new Promise(resolve => setTimeout(resolve, 0));
		const f = { ...frameAt(CAPTURES[0]), tick: last + TICK_MS };
		const view = viewOf(CAMERA);
		legacyDraws.drawArrays = 0;
		renderLegacy(f, view);
		const a = kit.readPixels(lgl);
		modernDraws.drawArrays = 0;
		const b = renderModern(f, view);
		restoreStats = kit.compare(a, b);
		frames.push({
			name: 'world-after-context-restore',
			detail: `tick ${f.tick}: after WEBGL_lose_context lose + restore (map rebuilt from retained payloads)`,
			...restoreStats,
			records: 1,
			legacyDrawCalls: legacyDraws.drawArrays,
			modernDrawCalls: modernDraws.drawArrays,
			runs: [],
			images: {
				legacy: legacy.canvas.toDataURL('image/png'),
				modern: modern.canvas.toDataURL('image/png'),
				diff: kit.diffImage(a, b)
			}
		});
	}
	checks.push({
		name: 'context loss + restore rebuilds the map (R-CTX-007)',
		ok: Boolean(restoreStats),
		detail: restoreStats ? `${restoreStats.differing} px differ after restore` : 'WEBGL_lose_context unavailable'
	});

	const glErrors = { legacy: lgl.getError(), modern: modern.gl.getError() };
	checks.push({
		name: 'no GL errors on either context',
		ok: glErrors.legacy === 0 && glErrors.modern === 0,
		detail: `legacy ${glErrors.legacy}, gpu-webgl2 ${glErrors.modern}`
	});
	checks.push(waterFormulaCheck());
	checks.push({
		name: 'payload content (MAP_GROUND / MAP_MODELS / MAP_ANIMATED_MODEL)',
		ok: assets.ground.waterVertCount > 0 && assets.models.infos.length > 3 && backend.world.animated.length === 2,
		detail: `${assets.ground.meshVertCount} ground vertices, ${assets.ground.waterVertCount} water vertices, ${assets.models.infos.length} model infos (${assets.models.buffer.length / 9} vertices), ${backend.world.animated.length} animated models (${backend.world.animated.map(m => m.vertexCount).join('+')} vertices, palette ${backend.world.animated.reduce((n, m) => n + m.matrixCount, 0)} matrices); stale request dropped: ${backend.world.models.payload.infos.length === assets.models.infos.length}`
	});
	Texture.load = realLoad;

	return {
		ok: true,
		page: 'world',
		renderer: rendererName,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: frames.map(() => 0),
		glErrors,
		control,
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
 * R-MAP-010 fix: the fixed frame (alpha 0.8) differs from the compensated one only on
 * water pixels, each by the predicted blend 0.8·W + 0.2·D (W: water drawn with alpha 1,
 * D: no water), and legacy is 0.64·W + 0.36·D. Linear in coverage, so MSAA edges hold too.
 */
function checkWaterFix(legacyPixels, f, view, renderModern) {
	const fixed = renderModern(f, view, { water: null });
	const opaque = renderModern(f, view, { water: { alpha: 1 } });
	const dry = renderModern(f, view, { water: { alpha: 0 } });
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
		detail: `${waterPixels} water px; ${changed} channel values differ from legacy (0.64), ${outside} outside the water; off the 0.8·W+0.2·D prediction: ${fixedOff}; legacy off 0.64·W+0.36·D: ${legacyOff}`
	};
}

/**
 * R-MAP-013 fix: with the lightmap preference off, legacy (uncompensated: light.opacity
 * kept) differs from gpu-webgl2 only on animated-model pixels.
 */
function checkAnimatedFix(f, view, renderLegacy, renderModern, backend, lgl) {
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
	const withModels = renderModern(f, view);
	const saved = backend.world.animatedGpu;
	backend.world.animatedGpu = null;
	const withoutModels = renderModern(f, view);
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
			if (!animated) {
				outside++;
			}
		}
	}
	return {
		name: 'R-MAP-013 fix: lightmap off, legacy (N·L kept) differs only on animated-model pixels',
		ok: differing > 0 && outside === 0 && animatedPixels > 0,
		detail: `${animatedPixels} animated px, ${differing} px differ from uncompensated legacy, ${outside} outside the animated models`
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

try {
	window.__parity = await run();
} catch (error) {
	window.__parity = { ok: false, error: String(error?.stack ?? error) };
}
document.getElementById('log').textContent = JSON.stringify(
	window.__parity,
	(key, value) => (key === 'images' ? '[omitted]' : value),
	2
);
