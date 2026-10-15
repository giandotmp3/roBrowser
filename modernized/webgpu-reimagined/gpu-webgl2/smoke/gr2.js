/**
 * GR2 parity page: the REAL legacy GR2 renderer (Renderer/GR2/GR2ModelRenderer.js with
 * the real GR2Loader, gr2Pack, gr2World, actorAction, gr2Banks and granny-ro-js
 * `poseAt`; unmodified) draws synthetic skinned models (gr2/assets.js: the repository
 * has no .gr2 file) into canvas A; gpu-webgl2's WebGL2Backend draws the same instances
 * from `world`/`gr2` records in the R-CTX-010 GR2 step into canvas B.
 *
 * Records: legacy GR2 draws straight to GL and emits no records, so this page captures
 * them by observing the legacy context while GR2ModelRenderer.render runs (no src/
 * change): per instance, the `uBones` palette it uploads and the `uAlpha` it sets; the
 * instance (and so its type path, world matrix and emblem image) is identified by the
 * `uModelViewMat` it uploads (= view · instance world, bit-exact). The record carries
 * the bone palette, the world matrix, the alpha and the emblem handle; gpu-webgl2
 * computes everything else (normal matrix, view-space light, R-GR2-001 light profile,
 * R-GR2-002 state, R-GR2-006 emblem texture) itself.
 */
import GR2ModelRenderer from 'Renderer/GR2/GR2ModelRenderer.js';
import GR2Loader from 'Loaders/GR2Loader.js';
import Texture from 'Utils/Texture.js';
import glMatrix from 'Utils/gl-matrix.js';
import { client, terrain } from './entities/stubs.js';
import { buildGr2Files, MODEL_PATHS } from './gr2/assets.js';
import { CAMERA, CAPTURES, ENTITIES, EVENTS, FOG, LIGHT, SKY, SPAWNS, TICK_MS } from './gr2/scene.js';
import { cameraMatrices, createPageKit } from './common.js';
import { WebGL2Backend } from '../src/WebGL2Backend.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

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
 * drawn down to 24×24 by the renderer.
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
	const legacy = kit.makeCanvas('legacy GR2');
	const modern = kit.makeCanvas('gpu-webgl2 GR2');
	const lgl = legacy.gl;
	const mgl = modern.gl;
	const debug = mgl.getExtension('WEBGL_debug_renderer_info');
	const rendererName = debug ? mgl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
	const draws = gl => {
		const counts = { drawElements: 0 };
		const original = gl.drawElements.bind(gl);
		gl.drawElements = (...args) => {
			counts.drawElements++;
			return original(...args);
		};
		return counts;
	};
	const legacyDraws = draws(lgl);
	const modernDraws = draws(mgl);

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
	const drawElements = lgl.drawElements;
	lgl.drawElements = (...args) => {
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

	// --- gpu-webgl2: the backend with a GR2 source port (the real GR2Loader decode, C-16)
	const typeData = new Map();
	const backend = new WebGL2Backend({
		canvas: modern.canvas,
		overlay: { show() {}, hide() {} },
		assets: { purge() {} },
		settings: { get: () => undefined, set() {} },
		scene: { runStep() {}, currentMap: () => 'synthetic', rebuildMap() {} },
		now: () => performance.now(),
		gr2: {
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
		}
	}).init();

	const view = cameraMatrices(CAMERA, WIDTH, HEIGHT);
	const { mat4 } = glMatrix;
	const scratch = mat4.create();

	/** One legacy GR2 pass (MapRenderer step 11) into canvas A; returns the captured records. */
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

	/** One gpu-webgl2 frame: the records in the gr2Models step, into canvas B. */
	const renderModern = (records, fogOn, { lightOverride } = {}) => {
		mgl.viewport(0, 0, WIDTH, HEIGHT);
		modernDraws.drawElements = 0;
		backend.drawFrame({
			passes: { gr2Models: records },
			view: {
				modelView: view.modelView,
				projection: view.projection,
				zoom: 30,
				fog: { use: fogOn, near: FOG.near, far: FOG.far, color: FOG.color }
			},
			world: { sky: SKY, light: { ...light, ...(lightOverride ?? {}) } }
		});
		mgl.finish();
		return kit.readPixels(mgl);
	};

	const frames = [];
	const checks = [];
	let control = null;
	let poseControl = null;
	let lastShots = null;
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
		const b = renderModern(records, shot.fog);
		const stats = kit.compare(a, b);
		palettes.push({ records: records.length, palettes: backend.gr2.lastPalettes });
		frames.push({
			name: shot.name,
			detail: `tick ${tick}, fog ${shot.fog}, ${records.length} GR2 records (${shots.map(s => `${s.id}${s.record.alpha < 1 ? `@${s.record.alpha}` : ''}`).join(' ')}), ${backend.gr2.lastPalettes} distinct palettes`,
			...stats,
			records: records.length,
			legacyDrawCalls,
			modernDrawCalls: modernDraws.drawElements,
			runs: [],
			images: {
				legacy: legacy.canvas.toDataURL('image/png'),
				modern: modern.canvas.toDataURL('image/png'),
				diff: kit.diffImage(a, b)
			}
		});
		checks.push({
			name: `${shot.name}: same draw calls (one drawElements per drawn submesh per instance)`,
			ok:
				legacyDrawCalls === modernDraws.drawElements &&
				legacyDrawCalls === shots.reduce((n, s) => n + s.draws, 0),
			detail: `legacy ${legacyDrawCalls}, gpu-webgl2 ${modernDraws.drawElements}`
		});
		if (!control) {
			// Sensitivity: the light direction nudged by 0.01 must change pixels.
			const nudged = light.direction.map((c, i) => (i === 0 ? c + 0.01 : c));
			control = kit.compare(a, renderModern(records, shot.fog, { lightOverride: { direction: nudged } }));
			// Skinning matters: the knight drawn with its bind-pose palette must differ.
			const knight = shots.find(s => s.id === 'knight');
			const bind = new Float32Array(knight.record.matrices.length);
			for (let k = 0; k < bind.length; k += 16) {
				bind[k] = bind[k + 5] = bind[k + 10] = bind[k + 15] = 1;
			}
			const swapped = records.map(r => (r === knight.record ? { ...r, matrices: bind } : r));
			poseControl = kit.compare(a, renderModern(swapped, shot.fog));
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
	checks.push({
		name: 'residency: each GR2 type uploaded once on miss',
		ok:
			backend.gr2Residency.stats.typeUploads === Object.keys(MODEL_PATHS).length &&
			backend.gr2Residency.types.size === backend.gr2Residency.stats.typeUploads,
		detail: JSON.stringify(backend.gr2Residency.stats)
	});

	// Context loss: lose and restore the gpu-webgl2 context; GR2 types and emblems are
	// re-uploaded on miss and the next frame must still match legacy.
	const lose = mgl.getExtension('WEBGL_lose_context');
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
		await new Promise(resolve => setTimeout(resolve, 0));
		lose.restoreContext();
		await restored;
		await new Promise(resolve => setTimeout(resolve, 0));
		const tick = last + TICK_MS;
		const shots = renderLegacy(tick, false);
		const a = kit.readPixels(lgl);
		const legacyDrawCalls = legacyDraws.drawElements;
		const b = renderModern(
			shots.map(s => s.record),
			false
		);
		restoreStats = kit.compare(a, b);
		frames.push({
			name: 'gr2-after-context-restore',
			detail: `tick ${tick}: after WEBGL_lose_context lose + restore (GR2 types and emblems re-uploaded on miss)`,
			...restoreStats,
			records: shots.length,
			legacyDrawCalls,
			modernDrawCalls: modernDraws.drawElements,
			runs: [],
			images: {
				legacy: legacy.canvas.toDataURL('image/png'),
				modern: modern.canvas.toDataURL('image/png'),
				diff: kit.diffImage(a, b)
			}
		});
	}
	checks.push({
		name: 'context loss + restore re-uploads the GR2 resources (R-CTX-006/007)',
		ok: Boolean(restoreStats) && backend.gr2Residency.stats.typeUploads === 2 * Object.keys(MODEL_PATHS).length,
		detail: restoreStats
			? `${restoreStats.differing} px differ after restore; ${JSON.stringify(backend.gr2Residency.stats)}`
			: 'WEBGL_lose_context unavailable'
	});

	const glErrors = { legacy: lgl.getError(), modern: mgl.getError() };
	checks.push({
		name: 'no GL errors on either context',
		ok: glErrors.legacy === 0 && glErrors.modern === 0,
		detail: `legacy ${glErrors.legacy}, gpu-webgl2 ${glErrors.modern}`
	});

	return {
		ok: true,
		page: 'gr2',
		renderer: rendererName,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: frames.map(f => f.records),
		glErrors,
		control,
		checks,
		frames
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
