/**
 * GR2 parity page for gpu-webgpu (port of gpu-webgl2/smoke/gr2.js, same scene, assets, frames
 * and checks): the REAL legacy GR2 renderer (Renderer/GR2/GR2ModelRenderer.js with the real
 * GR2Loader, gr2Pack, gr2World, actorAction, gr2Banks and granny-ro-js `poseAt`; unmodified)
 * draws synthetic skinned models (gr2/assets.js: the repository has no .gr2 file) into a WebGL2
 * canvas; gpu-webgpu's WebGpuBackend draws the same instances from `world`/`gr2` records in the
 * R-CTX-010 GR2 step (`drawFrame`, one scene pass, then the blit) into a WebGPU canvas, read back
 * with `capture()`.
 *
 * Records: legacy GR2 draws straight to GL, so this page captures them by observing the legacy
 * context while GR2ModelRenderer.render runs (no src/ change): per instance, the `uBones`
 * palette it uploads and the `uAlpha` it sets; the instance (and so its type path, world matrix
 * and emblem image) is identified by the `uModelViewMat` it uploads (= view · instance world,
 * bit-exact). The record carries the bone palette, the world matrix, the alpha and the emblem
 * handle; gpu-webgpu computes everything else (normal matrix, view-space light, R-GR2-001 light
 * profile, R-GR2-002 state, R-GR2-006 emblem texture) itself.
 *
 * Every frame is drawn twice on the WebGPU side: by the production backend, and by a second one
 * in ANGLE's raster orientation (y-flipped projection, rows read top-down, `-angle-orientation`;
 * see NATIVE_AA_GATE_PCT). Device loss is a real `device.destroy()` on the production backend
 * (instead of gpu-webgl2's WEBGL_lose_context): GR2 types and emblems re-upload on miss and the
 * next frame must still match legacy. Results land on `window.__parity` for
 * smoke/run-parity.mjs (`--page=gr2`).
 */
import GR2ModelRenderer from 'Renderer/GR2/GR2ModelRenderer.js';
import GR2Loader from 'Loaders/GR2Loader.js';
import Texture from 'Utils/Texture.js';
import glMatrix from 'Utils/gl-matrix.js';
import { client, terrain } from './entities/stubs.js';
import { buildGr2Files, MODEL_PATHS } from './gr2/assets.js';
import { CAMERA, CAPTURES, ENTITIES, EVENTS, FOG, LIGHT, SKY, SPAWNS, TICK_MS } from './gr2/scene.js';
import { cameraMatrices, createPageKit } from './common.js';
import { WebGpuBackend } from '../src/WebGpuBackend.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const MAP = 'synthetic';
/**
 * Declared gate of the native-orientation MSAA frames (smoke/README.md "Gates for gr2"). ANGLE
 * draws a WebGL default framebuffer upside down, which mirrors the 4× sample pattern: every
 * GR2 edge that is neither horizontal nor vertical resolves different coverage. The same frames
 * in ANGLE's raster orientation (`-angle-orientation`) keep the page gate (`--max-diff-pct`).
 * Without MSAA the native frames keep the page gate too.
 */
const NATIVE_AA_GATE_PCT = 1.0;

const kit = createPageKit({
	width: WIDTH,
	height: HEIGHT,
	antialias: ANTIALIAS,
	tolerance: TOLERANCE,
	clearColor: SKY.skyColor
});

/** Legacy entity ACTION enum (the names GR2 reads through gr2ActionFor). */
const ACTION = Object.freeze({
	IDLE: 0,
	WALK: 1,
	SIT: 2,
	PICKUP: 3,
	READYFIGHT: 4,
	ATTACK: 5,
	HURT: 6,
	DIE: 8,
	ATTACK1: 10,
	ATTACK2: 11,
	ATTACK3: 12
});

/** The fields of a legacy Entity that GR2ModelRenderer reads. */
class GR2Entity {
	static TYPE_MOB = 5;
	static TYPE_NPC = 6;
}

/** Wait until `done()` holds (device rebuild). */
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
	const dirMat4 = mat4.create();
	mat4.rotateY(dirMat4, dirMat4, (light.longitude * Math.PI) / 180);
	mat4.rotateX(dirMat4, dirMat4, (light.latitude * Math.PI) / 180);
	const dirVec = mat4.multiplyVec3([0, 1, 0], dirMat4);
	light.direction[0] = -dirVec[0];
	light.direction[1] = -dirVec[1];
	light.direction[2] = -dirVec[2];
	return light;
}

/**
 * Two guild emblems through the real legacy Texture.load (image magenta key), as
 * Guild.requestGuildEmblem hands them to the entity: (a) 24×24 with a magenta
 * background, translucent texels on both sides of the 207/255 alpha ref; (b) 32×32,
 * drawn down to 24×24 by the renderer. Same as gpu-webgl2.
 */
async function buildEmblems() {
	const make = (size, seed) => {
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		const img = ctx.createImageData(size, size);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const o = (y * size + x) * 4;
				const r = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5);
				let px = [255, 0, 255, 255];
				if (r < size * 0.42) {
					px = (x + y + seed) % 5 < 2 ? [250, 210, 30, 255] : [40 + seed * 30, 60 + 6 * y, 200 - 5 * x, 255];
				}
				if (y === 3 && x > 3 && x < 20) {
					px = [255, 255, 255, x % 2 ? 200 : 232];
				}
				img.data.set(px, o);
			}
		}
		ctx.putImageData(img, 0, 0);
		return canvas.toDataURL('image/png');
	};
	const load = url =>
		new Promise(resolve =>
			Texture.load(url, function done() {
				resolve(this);
			})
		);
	return { a: await load(make(24, 1)), b: await load(make(32, 3)) };
}

async function run() {
	if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) {
		return { ok: false, noAdapter: true, error: 'no WebGPU adapter' };
	}
	const legacy = kit.makeCanvas('legacy GR2 (WebGL2)');
	const lgl = legacy.gl;
	const debug = lgl.getExtension('WEBGL_debug_renderer_info');
	const legacyRenderer = debug ? lgl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
	const legacyDraws = { drawElements: 0 };

	// --- the archive and the legacy seams (Client.getFile answers asynchronously, like the GRF)
	const files = buildGr2Files();
	client.getFile = (path, onLoad, onError) => {
		setTimeout(() => (files.has(path) ? onLoad(files.get(path)) : onError?.()), 0);
	};
	const emblems = await buildEmblems();

	// --- capture: observe the uniforms the legacy GR2 pass uploads, per instance
	const names = new Map();
	const getUniformLocation = lgl.getUniformLocation.bind(lgl);
	lgl.getUniformLocation = (program, name) => {
		const loc = getUniformLocation(program, name);
		if (loc) {
			names.set(loc, name);
		}
		return loc;
	};
	let captured = null;
	const uniformMatrix4fv = lgl.uniformMatrix4fv.bind(lgl);
	lgl.uniformMatrix4fv = (loc, transpose, data) => {
		const name = names.get(loc);
		if (captured && name === 'uModelViewMat') {
			captured.push({ mv: Float32Array.from(data), bones: null, alpha: 1, draws: 0 });
		} else if (captured && name === 'uBones[0]') {
			captured[captured.length - 1].bones = data;
		}
		return uniformMatrix4fv(loc, transpose, data);
	};
	const uniform1f = lgl.uniform1f.bind(lgl);
	lgl.uniform1f = (loc, value) => {
		if (captured && names.get(loc) === 'uAlpha') {
			captured[captured.length - 1].alpha = value;
		}
		return uniform1f(loc, value);
	};
	const drawElements = lgl.drawElements.bind(lgl);
	lgl.drawElements = (...args) => {
		legacyDraws.drawElements++;
		if (captured?.length) {
			captured[captured.length - 1].draws++;
		}
		return drawElements(...args);
	};

	// --- legacy state (MapRenderer's resting GL state) and the instances
	lgl.viewport(0, 0, WIDTH, HEIGHT);
	lgl.enable(lgl.DEPTH_TEST);
	lgl.depthFunc(lgl.LEQUAL);
	lgl.enable(lgl.BLEND);
	lgl.blendFunc(lgl.SRC_ALPHA, lgl.ONE_MINUS_SRC_ALPHA);
	const light = legacyLight(LIGHT);
	const instances = [];
	const entities = new Map();
	for (const spec of ENTITIES) {
		const [x, y] = spec.pos;
		const entity = Object.assign(new GR2Entity(), {
			gr2: MODEL_PATHS[spec.model],
			position: [x, y, terrain.cellHeight(x, y)],
			direction: spec.dir,
			objecttype: spec.mob ? GR2Entity.TYPE_MOB : GR2Entity.TYPE_NPC,
			ACTION,
			action: ACTION.IDLE,
			animation: { tick: 0 },
			effectColor: [1, 1, 1, 1],
			culled: Boolean(spec.culled),
			emblem: spec.emblem ? { emblem: emblems[spec.emblem] } : null,
			remove_tick: 0,
			remove_delay: 0
		});
		entities.set(spec.id, entity);
		instances.push({ id: spec.id, inst: GR2ModelRenderer.attach(entity), emblem: entity.emblem?.emblem ?? null });
	}
	for (const [i, spec] of SPAWNS.entries()) {
		const inst = GR2ModelRenderer.spawn(MODEL_PATHS[spec.model], {
			pos: [...spec.pos, 0],
			dir: spec.dir,
			action: spec.action
		});
		instances.push({ id: `spawn${i}`, inst, emblem: null });
	}

	// --- gpu-webgpu: two backends with a GR2 source port (the real GR2Loader decode, C-16)
	const typeData = new Map();
	const gr2Source = {
		type(path) {
			if (!typeData.has(path)) {
				if (!files.has(path)) {
					return null;
				}
				const loader = new GR2Loader(files.get(path));
				typeData.set(path, { meshes: loader.meshes, textures: loader.parsed.textures });
			}
			return typeData.get(path);
		},
		// The handle is the entity's emblem image itself.
		emblem: handle => handle ?? null
	};
	const createBackend = async ({ title, portLog }) => {
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
			gr2: gr2Source,
			sampleCount: ANTIALIAS ? 4 : 1,
			log: (message, err) => portLog.push(['log', `${message}: ${err?.stack ?? err}`])
		}).init();
	};
	const portLog = [];
	const angleLog = [];
	const backend = await createBackend({ title: 'gpu-webgpu GR2 (WebGpuBackend)', portLog });
	const angle = await createBackend({ title: 'gpu-webgpu GR2, ANGLE raster orientation', portLog: angleLog });
	const shaderMessages = [];
	for (const m of (await backend.gr2._gpu.module.getCompilationInfo()).messages) {
		shaderMessages.push(`gr2.wgsl ${m.type} ${m.lineNum}:${m.linePos} ${m.message}`);
	}

	const view = cameraMatrices(CAMERA, WIDTH, HEIGHT);
	const { mat4 } = glMatrix;
	const scratch = mat4.create();

	/** One legacy GR2 pass (MapRenderer step 11) into the WebGL2 canvas; returns the captured records. */
	const renderLegacy = (tick, fogOn) => {
		kit.clear(lgl);
		const fog = { use: fogOn, exist: true, near: FOG.near, far: FOG.far, color: new Float32Array(FOG.color) };
		captured = [];
		legacyDraws.drawElements = 0;
		GR2ModelRenderer.render(lgl, view.modelView, view.projection, IDENTITY3, fog, light, tick);
		lgl.finish();
		const shots = captured;
		captured = null;
		return shots.map(shot => {
			const owner = instances.find(({ inst }) => {
				if (!inst.world) {
					return false;
				}
				mat4.multiply(scratch, view.modelView, inst.world);
				return scratch.every((v, k) => v === shot.mv[k]);
			});
			if (!owner) {
				throw new Error('captured GR2 draw matches no instance');
			}
			return {
				id: owner.id,
				draws: shot.draws,
				record: {
					kind: 'world',
					part: 'gr2',
					alpha: shot.alpha,
					matrices: shot.bones,
					blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
					depthTest: true,
					depthWrite: true,
					params: { type: owner.inst.path, world: owner.inst.world, emblem: owner.emblem }
				}
			};
		});
	};

	/**
	 * One gpu-webgpu frame: the records in the gr2Models step, through drawFrame, read back with
	 * capture() (bottom-up rows). `target`: `angle` draws in ANGLE's raster orientation (y-flipped
	 * projection: the frame lands upside down, its top-down rows are legacy's bottom-up ones).
	 */
	const renderModern = async (records, fogOn, { lightOverride, target = backend } = {}) => {
		const flipY = target === angle;
		const projection = flipY
			? Float32Array.from(view.projection, (v, i) => (i % 4 === 1 ? -v : v))
			: view.projection;
		const image = target.capture();
		const stats = target.drawFrame(
			{ gr2Models: records },
			{
				view: {
					modelView: view.modelView,
					projection,
					zoom: 30,
					fog: { use: fogOn, near: FOG.near, far: FOG.far, color: FOG.color }
				},
				world: { sky: SKY, light: { ...light, ...(lightOverride ?? {}) } }
			}
		);
		if (!stats.drawn) {
			throw new Error(`drawFrame did not draw: ${stats.reason ?? stats.error?.stack ?? stats.error}`);
		}
		const img = await image;
		return { pixels: flipY ? img.data : bottomUp(img.data, img.width, img.height), stats };
	};

	const frameOf = (name, detail, a, b, stats, legacyDrawCalls, extra = {}) => ({
		name,
		detail,
		...kit.compare(a, b),
		records: stats.gr2.records,
		legacyDrawCalls,
		modernDrawCalls: stats.drawCalls,
		fallbacks: stats.fallbacks,
		runs: stats.runs,
		batches: [],
		...extra
	});

	const frames = [];
	const checks = [];
	let control = null;
	let poseControl = null;
	let lastShots = null;
	let unsupported = 0;
	const seenIds = new Set();
	const palettes = [];
	const last = CAPTURES[CAPTURES.length - 1].at;
	for (let tick = 0; tick <= last; tick += TICK_MS) {
		for (const event of EVENTS.filter(e => e.at === tick)) {
			const entity = entities.get(event.id);
			if (event.action) {
				entity.action = ACTION[event.action];
				entity.animation.tick = tick; // a re-issued action bumps the animation tick
			}
			if (event.alpha !== undefined) {
				entity.effectColor[3] = event.alpha;
			}
		}
		const shot = CAPTURES.find(c => c.at === tick);
		const phase = CAPTURES.filter(c => c.at <= tick).pop() ?? CAPTURES[0];
		const shots = renderLegacy(tick, Boolean(phase.fog));
		// Banks and decodes arrive asynchronously (Client.getFile, GR2Loader.ready).
		await new Promise(resolve => setTimeout(resolve, tick < 400 ? 5 : 0));
		if (!shot) {
			continue;
		}
		const records = shots.map(s => s.record);
		shots.forEach(s => seenIds.add(s.id));
		const a = kit.readPixels(lgl);
		const legacyDrawCalls = legacyDraws.drawElements;
		const { pixels: b, stats } = await renderModern(records, shot.fog);
		const { pixels: c, stats: angleStats } = await renderModern(records, shot.fog, { target: angle });
		unsupported += stats.unsupportedRecords + angleStats.unsupportedRecords;
		palettes.push({ records: records.length, palettes: stats.gr2.palettes });
		const ids = shots.map(s => `${s.id}${s.record.alpha < 1 ? `@${s.record.alpha}` : ''}`).join(' ');
		frames.push(
			frameOf(
				shot.name,
				`tick ${tick}, fog ${shot.fog}, ${records.length} GR2 records (${ids}), ${stats.gr2.palettes} distinct palettes, ${stats.gr2.drawCalls} drawIndexed`,
				a,
				b,
				stats,
				legacyDrawCalls,
				{
					images: {
						legacy: legacy.canvas.toDataURL('image/png'),
						modern: toPng(b),
						diff: kit.diffImage(a, b)
					},
					...(ANTIALIAS ? { gatePct: NATIVE_AA_GATE_PCT } : {})
				}
			)
		);
		frames.push(
			frameOf(
				`${shot.name}-angle-orientation`,
				'same frame, y-flipped projection, rows read top-down (ANGLE raster orientation)',
				a,
				c,
				angleStats,
				legacyDrawCalls,
				{ images: { modern: toPng(c), diff: kit.diffImage(a, c) } }
			)
		);
		checks.push({
			name: `${shot.name}: same draw calls (one drawIndexed per drawn submesh per instance)`,
			ok:
				legacyDrawCalls === stats.gr2.drawCalls &&
				legacyDrawCalls === angleStats.gr2.drawCalls &&
				legacyDrawCalls === shots.reduce((n, s) => n + s.draws, 0),
			detail: `legacy ${legacyDrawCalls} drawElements, gpu-webgpu ${stats.gr2.drawCalls} drawIndexed`
		});
		if (!control) {
			// Sensitivity: the light direction nudged by 0.01 must change pixels.
			const nudged = light.direction.map((v, i) => (i === 0 ? v + 0.01 : v));
			control = kit.compare(
				a,
				(await renderModern(records, shot.fog, { lightOverride: { direction: nudged } })).pixels
			);
			// Skinning matters: the knight drawn with its bind-pose palette must differ.
			const knight = shots.find(s => s.id === 'knight');
			const bind = new Float32Array(knight.record.matrices.length);
			for (let k = 0; k < bind.length; k += 16) {
				bind[k] = bind[k + 5] = bind[k + 10] = bind[k + 15] = 1;
			}
			const swapped = records.map(r => (r === knight.record ? { ...r, matrices: bind } : r));
			poseControl = kit.compare(a, (await renderModern(swapped, shot.fog)).pixels);
		}
		lastShots = shots;
	}

	checks.push({
		name: 'pose control: the knight with a bind-pose palette differs (skinning is exercised)',
		ok: poseControl.differing > 0,
		detail: `${poseControl.differing} px differ, max ${poseControl.maxDiff}`
	});
	const expectedIds = [...ENTITIES.filter(e => !e.culled && e.id !== 'offscreen').map(e => e.id), 'spawn0', 'spawn1'];
	checks.push({
		name: 'R-GR2-004: culled entity and off-screen instance never draw; every other instance does',
		ok: !seenIds.has('culled') && !seenIds.has('offscreen') && expectedIds.every(id => seenIds.has(id)),
		detail: `drawn: ${[...seenIds].join(' ')}`
	});
	checks.push({
		name: 'R-GR2-003: instances sharing a 40 Hz pose share one palette upload',
		ok: palettes.every(p => p.palettes < p.records),
		detail: palettes.map(p => `${p.records} records → ${p.palettes} palettes`).join(', ')
	});
	const emblemDraws = lastShots.filter(s => s.id.startsWith('flag')).map(s => s.draws);
	const bareFlag = lastShots.find(s => s.id === 'spawn0');
	checks.push({
		name: 'R-GR2-006: flags with an emblem draw 3 submeshes, the emblem-less dev flag 2',
		ok: emblemDraws.every(n => n === 3) && bareFlag?.draws === 2 && backend.gr2Residency.emblems.size === 2,
		detail: `entity flags ${emblemDraws.join('/')}, dev flag ${bareFlag?.draws}, resident emblems ${backend.gr2Residency.emblems.size}`
	});
	const typeCount = Object.keys(MODEL_PATHS).length;
	checks.push({
		name: 'residency: each GR2 type uploaded once on miss',
		ok:
			backend.gr2Residency.stats.typeUploads === typeCount &&
			backend.gr2Residency.types.size === backend.gr2Residency.stats.typeUploads,
		detail: JSON.stringify(backend.gr2Residency.stats)
	});

	// Device loss: destroy the backend's device; it must rebuild on a new device, GR2 types and
	// emblems re-upload on miss, and the next frame must match legacy.
	const loss = await loseDevice(backend, portLog);
	checks.push(...loss.checks);
	{
		const tick = last + TICK_MS;
		const shots = renderLegacy(tick, false);
		const a = kit.readPixels(lgl);
		const legacyDrawCalls = legacyDraws.drawElements;
		const { pixels: b, stats } = await renderModern(
			shots.map(s => s.record),
			false
		);
		unsupported += stats.unsupportedRecords;
		frames.push(
			frameOf(
				'gr2-after-device-loss',
				`tick ${tick}: after device.destroy() and the rebuild (GR2 types and emblems re-uploaded on miss); ${stats.gr2.drawCalls} drawIndexed`,
				a,
				b,
				stats,
				legacyDrawCalls,
				{
					images: {
						legacy: legacy.canvas.toDataURL('image/png'),
						modern: toPng(b),
						diff: kit.diffImage(a, b)
					},
					...(ANTIALIAS ? { gatePct: NATIVE_AA_GATE_PCT } : {})
				}
			)
		);
		checks.push({
			name: 'device loss re-uploads the GR2 resources on the new device (R-CTX-006/007)',
			ok:
				backend.gr2Residency.stats.typeUploads === 2 * typeCount &&
				backend.gr2Residency.device === backend.device &&
				backend.gr2Residency.emblems.size === 2 &&
				stats.gr2.drawCalls === legacyDrawCalls,
			detail: `${JSON.stringify(backend.gr2Residency.stats)}; ${stats.gr2.drawCalls} drawIndexed (legacy ${legacyDrawCalls})`
		});
	}

	checks.push({
		name: 'GR2 records consumed (no unsupported record)',
		ok: unsupported === 0,
		detail: `${unsupported} unsupported records`
	});

	await backend.device.queue.onSubmittedWorkDone();
	const info = backend.renderDevice.adapter.info ?? {};
	const errors = [
		...backend.errors,
		...angle.errors,
		...[...portLog, ...angleLog].filter(e => e[0] === 'log').map(e => e[1])
	];
	const pipelines = backend.gr2.pipelineCount;
	backend.dispose();
	angle.dispose();
	return {
		ok: true,
		page: 'gr2',
		adapter: `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.trim(),
		fallbackAdapter: Boolean(info.isFallbackAdapter),
		legacyRenderer,
		canvasFormat: backend.format,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: frames.map(f => f.records),
		glError: lgl.getError(),
		gpuErrors: errors,
		shaderMessages,
		pipelines,
		control,
		deviceLoss: loss.summary,
		checks,
		frames
	};
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
				name: 'device loss (R-CTX-006/007): overlay, purge, rebuilt on a new device, GR2 residency emptied',
				ok:
					kind === 'webgpu' &&
					backend.device !== oldDevice &&
					backend.running &&
					backend.gr2Residency.types.size === 0 &&
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
