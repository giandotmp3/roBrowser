/**
 * Effect parity page for gpu-webgpu (port of gpu-webgl2/smoke/effects.js): the REAL
 * legacy effect classes (Renderer/Effects/StrEffect.js, ThreeDEffect.js, TwoDEffect.js,
 * all unmodified; SpriteRenderer.js, Utils/WebGL.js and Utils/Texture.js real too)
 * play the same scripted scene into a WebGL2 canvas, one pass per class per tick, as
 * EffectManager.render does. On the captured ticks every draw is captured from each
 * class's `addRecordSink`; gpu-webgpu then draws those records into a WebGPU canvas
 * (RunRenderer: STR layers through the instanced STR pipeline, 2D/3D through the
 * instanced sprite pipeline, one render pass, stream order; textures uploaded on miss
 * from the same images and SPR frames; offscreen target + blit). Pixels are compared.
 * Results land on `window.__parity` for smoke/run-parity.mjs (`--page=effects`).
 *
 * Declared divergence, R-EFX-010 (fixed): legacy never fogs STR layers. The parity
 * frames therefore compare with the rebuild's STR fog off (`fog` frames included:
 * there 2D/3D are fogged on both sides). The fog frame is also drawn with the STR
 * fog on and asserted to differ from legacy only inside the STR footprint, and an
 * isolated STR is checked against the CPU-expected fog mix.
 */
import WebGL from 'Utils/WebGL.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import StrEffect from 'Renderer/Effects/StrEffect.js';
import ThreeDEffect from 'Renderer/Effects/ThreeDEffect.js';
import TwoDEffect from 'Renderer/Effects/TwoDEffect.js';
import Camera from './cameraStub.js';
import { files, renderer } from './entities/stubs.js';
import { rng } from './entities/assets.js';
import { buildEffectAssets } from './effects/assets.js';
import {
	CAMERA,
	CAPTURES,
	FOG,
	FOG_CHECK_SPAWN,
	SPAWNS_2D,
	SPAWNS_3D,
	START_TICK,
	TICK_MS,
	spawnSprite,
	spawnStr,
	strFiles
} from './effects/scene.js';
import { cameraMatrices, createPageKit } from './common.js';
import { createWebGpuSide } from './webgpuKit.js';
import { SpriteResidency } from '../src/residency/SpriteResidency.js';
import { TextureArrayPools } from '../src/residency/TextureArrayPools.js';
import { decodeImageTexture } from '../src/residency/imageTexture.js';
import { RunRenderer } from '../src/batching/RunRenderer.js';
import { fromLegacyEffectRecord } from '../src/effects/legacyRecord.js';

const params = new URLSearchParams(location.search);
const WIDTH = Number(params.get('w') ?? 640);
const HEIGHT = Number(params.get('h') ?? 480);
const ANTIALIAS = params.get('aa') === '1';
const TOLERANCE = Number(params.get('tol') ?? 2);
const CLEAR = [0.12, 0.14, 0.12, 1];
/**
 * With MSAA, the native-orientation frames carry this declared gate (smoke/README.md
 * "Gate for smoke:parity:effects:aa"): ANGLE draws a WebGL default framebuffer upside
 * down, which mirrors the 4× sample pattern relative to the scene, so diagonal edges
 * (STR quads are rotated) resolve different coverage. The same frames drawn in ANGLE's
 * raster orientation (y-flipped projection, rows read top-down) keep the page's gate.
 */
const NATIVE_AA_GATE_PCT = 0.75;

const kit = createPageKit({
	width: WIDTH,
	height: HEIGHT,
	antialias: ANTIALIAS,
	tolerance: TOLERANCE,
	clearColor: CLEAR
});

/** EffectManager pass order of this page: sprite program → STR program → sprite program. */
const ONLY = params.get('only');
const CLASSES = [ThreeDEffect, StrEffect, TwoDEffect].filter(
	C => !ONLY || { '3d': ThreeDEffect, str: StrEffect, '2d': TwoDEffect }[ONLY] === C
);

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

async function run() {
	const gpu = await createWebGpuSide({ width: WIDTH, height: HEIGHT, antialias: ANTIALIAS, clearColor: CLEAR });
	if (gpu.noAdapter) {
		return { ok: false, noAdapter: true, error: `no WebGPU adapter: ${gpu.reason}` };
	}
	const legacy = kit.makeCanvas('legacy effects (WebGL2)');
	const legacyDraws = kit.countDraws(legacy.gl);
	const lgl = legacy.gl;
	const debug = lgl.getExtension('WEBGL_debug_renderer_info');
	const legacyRenderer = debug ? lgl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';

	// Image texels through a scratch WebGL2 unpack, as legacy uploads them (decodeImageTexture).
	const unpackGl = document.createElement('canvas').getContext('webgl2');
	const assets = await buildEffectAssets(lgl, { unpackGl });
	const nameOfUrl = new Map([...assets.urls].map(([name, url]) => [url, name]));
	let pendingTextures = 0;
	/** @type {Map<string, WebGLTexture>} image name → a legacy texture of it */
	const legacyImages = new Map();
	const realTexture = WebGL.texture;
	WebGL.texture = (gl, url, callback, ...rest) => {
		pendingTextures++;
		realTexture(
			gl,
			url,
			(texture, ...args) => {
				pendingTextures--;
				assets.registerImageTexture(texture, nameOfUrl.get(url));
				legacyImages.set(nameOfUrl.get(url), texture);
				callback(texture, ...args);
			},
			...rest
		);
	};

	// Legacy Memory: STR files (materials loaded as Core/Client.js does), effect images, SPR/ACT.
	for (const [path, data] of assets.files) {
		files.set(path, data);
	}
	for (const [name, url] of assets.urls) {
		files.set(`data/texture/${name}`, url);
	}
	for (const [path, data] of Object.entries(strFiles())) {
		for (const layer of data.layers) {
			layer.materials = new Array(layer.texcnt);
			layer.textures.forEach((name, j) => {
				if (name) {
					WebGL.texture(lgl, assets.urls.get(name), texture => {
						layer.materials[j] = texture;
					});
				}
			});
		}
		files.set(path, data);
	}

	const view = cameraMatrices(CAMERA, WIDTH, HEIGHT);
	Camera.zoom = CAMERA.distance;
	Camera.direction = 0;
	Camera.angle = [CAMERA.pitch, CAMERA.yaw];
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
	for (const Class of CLASSES) {
		Class.init(lgl);
	}

	// Spawn (seeded: 3D/2D constructors draw random spreads), then load the instance textures.
	const savedRandom = Math.random;
	Math.random = rng(0xeffec7);
	let live;
	try {
		live = [...spawnSprite(ThreeDEffect, SPAWNS_3D), ...spawnStr(StrEffect), ...spawnSprite(TwoDEffect, SPAWNS_2D)];
	} finally {
		Math.random = savedRandom;
	}
	for (const { effect } of live) {
		effect.init(lgl);
	}
	await until(() => pendingTextures === 0, 'legacy textures');
	const texelCheck = compareImageTexels(lgl, legacyImages, assets);

	// gpu-webgpu side: one residency (upload on miss from the same images and frames) and the run renderer.
	const residency = new SpriteResidency({
		uploader: new TextureArrayPools({ device: gpu.device }),
		now: () => performance.now(),
		source: assets.source
	});
	const runs = await new RunRenderer({ device: gpu.device, residency, sampleCount: gpu.sampleCount }).init();
	const shaderMessages = [
		...(await runs.sprites.module.getCompilationInfo()).messages.map(
			m => `sprite.wgsl ${m.type} ${m.lineNum}:${m.linePos} ${m.message}`
		),
		...(await runs.str.module.getCompilationInfo()).messages.map(
			m => `str.wgsl ${m.type} ${m.lineNum}:${m.linePos} ${m.message}`
		)
	];
	const toModern = (native, fog) =>
		fromLegacyEffectRecord(native, {
			textureHandle: assets.textureHandle,
			paletteHandle: assets.paletteHandle,
			sceneFog: fog ? { use: fog.use && fog.exist } : null
		});
	const fogUniform = fog => ({ use: fog.use && fog.exist, near: fog.near, far: fog.far, color: fog.color });
	// ANGLE's raster orientation: clip y negated (F·P, F = diag(1, −1, 1, 1)), the frame lands
	// upside down and is read back top-down. Depth (z, w) and so fog are unchanged.
	const flippedProjection = Float32Array.from(view.projection, (v, i) => (i % 4 === 1 ? -v : v));
	/**
	 * Draw a record stream (every pipeline it needs compiled first: no normal-alpha fallback).
	 * `flipY`: in ANGLE's raster orientation (MSAA diagnosis, see NATIVE_AA_GATE_PCT).
	 */
	const drawModern = async (records, fog, clearColor = CLEAR, { flipY = false } = {}) => {
		await runs.warm(records);
		const { pixels, result } = await gpu.render(
			pass => {
				residency.beginFrame();
				return runs.encode(pass, records, {
					modelView: view.modelView,
					projection: flipY ? flippedProjection : view.projection,
					zoom: Camera.zoom,
					fog: fogUniform(fog)
				});
			},
			{ clearColor, rowsTopDown: flipY }
		);
		return { pixels, stats: result };
	};

	/** One legacy frame: a pass per class, as EffectManager.render (removal after the draw). */
	const renderLegacy = (effects, tick, fog) => {
		kit.clear(lgl);
		for (const Class of CLASSES) {
			Class.beforeRender(lgl, view.modelView, view.projection, fog, tick);
			for (const entry of effects) {
				if (entry.effect instanceof Class && !entry.removed) {
					entry.effect.render(lgl, tick);
					if (entry.effect.needCleanUp) {
						entry.removed = true;
					}
				}
			}
			Class.afterRender(lgl);
		}
		lgl.finish();
	};
	const capture = fn => {
		const native = [];
		const stops = CLASSES.map(Class => Class.addRecordSink(r => native.push(r)));
		try {
			fn();
		} finally {
			stops.forEach(stop => stop());
		}
		return native;
	};

	const frames = [];
	const checks = [texelCheck];
	let control = null;
	let skipped = 0;
	const last = CAPTURES[CAPTURES.length - 1].at;
	for (let tick = START_TICK; tick <= last; tick += TICK_MS) {
		renderer.tick = tick;
		live.forEach(entry => entry.move?.(tick));
		const shot = CAPTURES.find(c => c.at === tick);
		const fog = { ...FOG, use: Boolean(shot?.fog) };
		if (!shot) {
			renderLegacy(live, tick, fog);
			continue;
		}
		legacyDraws.drawArrays = 0;
		const native = capture(() => renderLegacy(live, tick, fog));
		const legacyDrawCalls = legacyDraws.drawArrays;
		const a = kit.readPixels(lgl);
		const legacyPng = legacy.canvas.toDataURL('image/png');

		// Parity: the rebuild's STR fog off (legacy never fogs STR, R-EFX-010).
		const records = native.map(r => toModern(r, null));
		const { pixels: b, stats } = await drawModern(records, fog);
		const batches = runs.lastBatches.map(r => r.count);
		const uploads = runs.lastUploads;
		skipped += stats.skipped;
		const families = { str: 0, '3d': 0, '2d': 0 };
		records.forEach(r => families[r.family]++);
		const images = { legacy: legacyPng, modern: gpu.toPng(b), diff: kit.diffImage(a, b) };

		if (shot.fog) {
			// R-EFX-010 fix: with the STR fog on, the frame differs, and only inside the STR footprint:
			// every pixel an STR fragment reaches (STR records alone, colour 1, overwrite blend, no
			// depth test, fogged toward white over black, so even a near-black texel shows).
			const { pixels: fogged } = await drawModern(
				native.map(r => toModern(r, fog)),
				fog
			);
			images.strFog = gpu.toPng(fogged);
			const { pixels: footprint } = await drawModern(
				records
					.filter(r => r.family === 'str')
					.map(r => ({
						...r,
						color: [1, 1, 1, 1],
						blend: { src: 'ONE', dst: 'ZERO' },
						depthTest: false,
						fog: true
					})),
				{ ...fog, color: [1, 1, 1] },
				[0, 0, 0, 1]
			);
			// Against legacy (must differ), and against the STR-fog-off gpu-webgpu frame `b`: what the
			// fog changes must lie inside the footprint. (gpu-webgl2 compares with legacy directly; here
			// the cross-API parity residual of `b` would also count outside the footprint.)
			let differing = 0;
			let changed = 0;
			let outside = 0;
			let inside = 0;
			for (let i = 0; i < a.length; i += 4) {
				const covered = footprint[i] || footprint[i + 1] || footprint[i + 2];
				if (covered) {
					inside++;
				}
				if (a[i] !== fogged[i] || a[i + 1] !== fogged[i + 1] || a[i + 2] !== fogged[i + 2]) {
					differing++;
				}
				if (b[i] !== fogged[i] || b[i + 1] !== fogged[i + 1] || b[i + 2] !== fogged[i + 2]) {
					changed++;
					if (!covered) {
						outside++;
					}
				}
			}
			checks.push({
				name: `${shot.name}: R-EFX-010 STR fog (declared divergence) differs from legacy, and changes only STR pixels`,
				ok: differing > 0 && changed > 0 && outside === 0,
				detail: `${differing} px differ from legacy; the STR fog changes ${changed} px, ${outside} outside the STR footprint (${inside} px)`
			});
		}

		frames.push({
			name: shot.name,
			...kit.compare(a, b),
			records: records.length,
			detail: `${records.length} records (str ${families.str}, 3d ${families['3d']}, 2d ${families['2d']}; ${records.filter(r => r.params.palette).length} indexed), ${live.filter(e => !e.removed).length} live effects, ${uploads} uploads on miss, resident ${residency.residentCount} textures / ${residency.paletteCount} palettes`,
			legacyDrawCalls,
			modernDrawCalls: stats.drawCalls,
			fallbacks: stats.fallbacks,
			runs: stats.runs,
			batches,
			images,
			...(ANTIALIAS ? { gatePct: NATIVE_AA_GATE_PCT } : {})
		});
		if (ANTIALIAS) {
			// The same records in ANGLE's raster orientation: the sample pattern now matches legacy's.
			const { pixels: flipped, stats: flippedStats } = await drawModern(records, fog, CLEAR, { flipY: true });
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

		if (!control) {
			// Sensitivity controls: nudge the last STR layer, then the last 3D/2D record, by
			// 0.01 world units in the gpu-webgpu stream only. The comparison must see each.
			const nudge = async family => {
				const visible = r => r.family === family && r.color[3] > 0.5 && r.blend.dst === 'ONE_MINUS_SRC_ALPHA';
				const target = records.findLastIndex(visible);
				const nudged = records.map((r, i) =>
					i === target ? { ...r, position: [r.position[0] + 0.01, r.position[1], r.position[2]] } : r
				);
				return kit.compare(a, (await drawModern(nudged, fog)).pixels);
			};
			control = {
				str: await nudge('str'),
				sprite: await nudge(records.some(r => r.family === '3d') ? '3d' : '2d')
			};
		}
	}

	// CPU-expected fog mix on an isolated STR (R-EFX-010 fix). The STR billboard is
	// screen-aligned, so its depth z/w, hence the fog factor, is one constant per quad.
	{
		const fog = { ...FOG, use: true };
		const tick = 2000;
		const [entry] = spawnStr(StrEffect, [FOG_CHECK_SPAWN]);
		const native = capture(() => renderLegacy([entry], tick, fog));
		const a = kit.readPixels(lgl);
		// With MSAA, in ANGLE's raster orientation: the fog check quad's triangles overlap (keyframe
		// corners 0, 1, 3, 2 against the strip uv), so its interior holds diagonal triangle edges whose
		// MSAA coverage depends on the orientation (NATIVE_AA_GATE_PCT), not on the fog.
		const { pixels: b } = await drawModern(
			native.map(r => toModern(r, fog)),
			fog,
			CLEAR,
			{ flipY: ANTIALIAS }
		);
		const f = strFogFactor(FOG_CHECK_SPAWN.position, view, fog);
		const fogColor = fog.color.map(c => c * 255);
		const background = CLEAR.map(c => Math.round(c * 255));
		const isCovered = i => a[i] !== background[0] || a[i + 1] !== background[1] || a[i + 2] !== background[2];
		let checked = 0;
		let maxError = 0;
		let maxAt = null;
		let changed = 0;
		for (let y = 2; y < HEIGHT - 2; y++) {
			for (let x = 2; x < WIDTH - 2; x++) {
				const i = (y * WIDTH + x) * 4;
				// Interior pixels only (no partially covered or MSAA-resolved edge pixel on either side:
				// with MSAA the two sides cover edge pixels differently, see NATIVE_AA_GATE_PCT).
				let interior = true;
				for (let dy = -2; dy <= 2 && interior; dy++) {
					for (let dx = -2; dx <= 2 && interior; dx++) {
						interior = isCovered(((y + dy) * WIDTH + (x + dx)) * 4);
					}
				}
				if (!interior) {
					continue;
				}
				checked++;
				for (let c = 0; c < 3; c++) {
					const expected = a[i + c] * (1 - f) + fogColor[c] * f;
					const error = Math.abs(b[i + c] - expected);
					if (error > maxError) {
						maxError = error;
						maxAt = [x, y];
					}
				}
				if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
					changed++;
				}
			}
		}
		checks.push({
			name: 'R-EFX-010 STR fog vs the CPU-expected mix (isolated STR, legacy colour mixed toward the fog colour)',
			ok: checked > 1000 && changed > 0.9 * checked && maxError <= 2,
			detail: `${ANTIALIAS ? 'ANGLE raster orientation, ' : ''}fog factor ${f.toFixed(4)}, ${checked} interior px, ${changed} changed by the fog, max error ${maxError.toFixed(2)} levels${maxAt ? ` at (${maxAt.join(', ')})` : ''}`
		});
	}

	checks.push({
		name: 'every record drawn by a gpu-webgpu program (no skipped batch, no normal-alpha fallback)',
		ok: skipped === 0 && frames.every(f => f.fallbacks === 0),
		detail: `${skipped} skipped batches, ${frames.reduce((n, f) => n + f.fallbacks, 0)} fallbacks`
	});
	checks.push(
		...Object.entries(control).map(([name, stats]) => ({
			name: `sensitivity control (${name} record nudged 0.01 units)`,
			ok: stats.differing > 0,
			detail: `${stats.differing} px differ, max ${stats.maxDiff}`
		}))
	);
	WebGL.texture = realTexture;

	await gpu.device.queue.onSubmittedWorkDone();
	return {
		ok: true,
		page: 'effects',
		adapter: gpu.adapter,
		fallbackAdapter: gpu.fallbackAdapter,
		legacyRenderer,
		canvasFormat: gpu.format,
		size: [WIDTH, HEIGHT],
		antialias: ANTIALIAS,
		tolerance: TOLERANCE,
		records: frames.map(f => f.records),
		assets: assets.counts,
		residency: { ...residency.stats, decodes: assets.source.decodes.size },
		glError: lgl.getError(),
		gpuErrors: gpu.errors,
		shaderMessages,
		pipelines: runs.sprites.pipelines.readyCount + runs.str.pipelines.readyCount,
		control: control.str.differing < control.sprite.differing ? control.str : control.sprite,
		checks,
		frames
	};
}

/**
 * Image texels: every legacy image texture (real WebGL.texture) read back and compared
 * with the residency decode of the same image (decodeImageTexture, WebGL unpack). The
 * `getImageData` decode (no GL context, a WebGPU-only client) is counted for information.
 */
function compareImageTexels(gl, legacyImages, assets) {
	const framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	let texels = 0;
	let differing = 0;
	let differingCanvas = 0;
	for (const [name, texture] of legacyImages) {
		const image = assets.source.frame(`img:${name}`);
		const canvasDecode = decodeImageTexture(assets.images.get(name));
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		const legacyTexels = new Uint8Array(image.width * image.height * 4);
		gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, legacyTexels);
		texels += image.width * image.height;
		for (let i = 0; i < legacyTexels.length; i++) {
			if (legacyTexels[i] !== image.data[i]) {
				differing++;
			}
			if (legacyTexels[i] !== canvasDecode.data[i]) {
				differingCanvas++;
			}
		}
	}
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.deleteFramebuffer(framebuffer);
	return {
		name: 'image textures: legacy WebGL.texture texels = residency decode (magenta key, POT stretch, WebGL unpack)',
		ok: legacyImages.size > 0 && differing === 0,
		detail: `${legacyImages.size} images, ${texels} texels, ${differing} channel values differ (getImageData decode, informational: ${differingCanvas})`
	};
}

/**
 * Fog factor of an STR billboard at `position` (legacy StrEffect.vs maths, float64):
 * view = modelView · (x + 0.5, −z, y + 0.5, 1); the quad lies in the plane view.z;
 * clip.w = −view.z, clip.z = P[10]·view.z + P[14] − 0.1 (clip z bias);
 * depth = gl_FragCoord.z / gl_FragCoord.w = (0.5·clip.z / clip.w + 0.5) · clip.w.
 */
function strFogFactor(position, { modelView: m, projection: p }, fog) {
	const [x, y, z] = [position[0] + 0.5, -position[2], position[1] + 0.5];
	const viewZ = m[2] * x + m[6] * y + m[10] * z + m[14];
	// Perspective projection (common.js cameraMatrices): P[3] = P[7] = 0, so clip w depends on view z only.
	const clipW = p[11] * viewZ + p[15];
	const clipZ = p[10] * viewZ + p[14] - 0.1;
	const depth = (0.5 * (clipZ / clipW) + 0.5) * clipW;
	const t = Math.min(Math.max((depth - fog.near) / (fog.far - fog.near), 0), 1);
	return t * t * (3 - 2 * t);
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
