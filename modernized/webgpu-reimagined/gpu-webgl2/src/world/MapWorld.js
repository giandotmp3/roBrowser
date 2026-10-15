import { GL } from '../pipeline/glEnums.js';
import { createProgram } from '../pipeline/glProgram.js';
import { SHADERS } from '../shaders/index.js';
import { OCCLUDER_DEFAULTS, OCCLUDER_QUERY, WATER_FRAMES } from '../constants.js';
import { nextPot } from '../residency/imageKey.js';
import { padLayer } from '../residency/TextureArrayPools.js';
import { AnimatedRsm, ANIMATED_VERTEX_FLOATS } from './animatedRsm.js';
import { LayerSet } from './LayerSet.js';
import { mapLight } from './lighting.js';
import { occluderFadeActive } from './occluderFade.js';
import { waterAlpha, waterFrameIndex, waveOffset } from './water.js';
import { invert } from './glm32.js';
import {
	composeGridTexture,
	composeGroundAtlas,
	createImageDecoder,
	defaultCreateCanvas,
	potTexels
} from './worldImages.js';

/** Static RSM vertex: position 3, normal 3, uv 2, alpha 1 (spec §3.2 MAP_MODELS). */
const MODEL_VERTEX_FLOATS = 9;
/** Ground vertex: position 3, normal 3, uv 2, lightmap uv 2, tile-colour uv 2 (MAP_GROUND). */
const GROUND_VERTEX_FLOATS = 12;
/** Water vertex: position 3, uv 2 (MAP_GROUND waterMesh). */
const WATER_VERTEX_FLOATS = 5;
/** Animated RSM palette: texels per row (256 matrices). */
const PALETTE_WIDTH = 1024;

/** Occluder fade shader modes (uOccluderFadeMode, R-MAP-020). */
export const OCCLUDER_MODE = Object.freeze({ OFF: 0, DITHER: 1, ALPHA_OPAQUE: 2, ALPHA_BLEND: 3, QUERY: 4 });
/** Occlusion query slots (R-MAP-019): one per model renderer. */
const QUERY_SLOT = Object.freeze({ MODELS: 0, ANIMATED: 1 });

const NORMAL_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
const OPAQUE_STATE = Object.freeze({ blend: NORMAL_BLEND, depthTest: true, depthWrite: true });
const TRANSLUCENT_STATE = Object.freeze({ blend: NORMAL_BLEND, depthTest: true, depthWrite: false });
const QUERY_STATE = Object.freeze({ blend: NORMAL_BLEND, depthTest: false, depthWrite: false });

const LIGHT_UNIFORMS = ['uLightDirection', 'uLightOpacity', 'uLightAmbient', 'uLightDiffuse', 'uLightEnv'];
const FOG_UNIFORMS = ['uFogUse', 'uFogNear', 'uFogFar', 'uFogColor'];
const VIEW_UNIFORMS = ['uModelViewMat', 'uProjectionMat'];
const OCCLUDER_UNIFORMS = [
	'uOccluderFadeMode',
	'uOccluderFadeEye',
	'uOccluderFadeFocus',
	'uOccluderFadeRadius',
	'uOccluderFadeOpacity',
	'uOccluderFadeStrength'
];

/**
 * @typedef {Object} WorldView  Camera and fog of the frame (the record passes' view)
 * @property {ArrayLike<number>} modelView
 * @property {ArrayLike<number>} projection
 * @property {{use: boolean, near: number, far: number, color: ArrayLike<number>}} [fog]  `use` = pref && map entry
 *
 * @typedef {Object} WorldFrame  Per-frame world inputs (scene side)
 * @property {number} [tick]                 Game tick (ms): water wave/frame, animated RSM, occluder Δt
 * @property {boolean} [lightmap]            MapPreferences.lightmap (R-MAP-002/012/013), default true
 * @property {0|1|2} [smoothlight]           MapPreferences.smoothlight (R-MAP-002), default 0
 * @property {boolean} [performanceMode]     R-MAP-016 animated RSM cadence
 * @property {Partial<{direction: ArrayLike<number>, diffuse: ArrayLike<number>, ambient: ArrayLike<number>, env: ArrayLike<number>, opacity: number}>} [light]
 *   Overrides of the map light (night mode, R-CTX-013)
 * @property {{x: number, y: number}[]} [grid]  Grid-selector cells, in draw order (R-MAP-021; scene picks)
 * @property {{mode?: string, opacity?: number, radius?: number, firstPerson?: boolean, focus?: ArrayLike<number>}} [occluder]
 *   R-MAP-018…020 settings and the camera focus
 */

/**
 * The per-map GPU scene of gpu-webgl2 (MapScene, spec §2.1): consumes the MAP_*
 * worker payloads (spec §3.2, shapes unchanged) and draws the world passes of
 * R-CTX-010 — ground (C-03), grid selector, occluder-fade begin, static RSM batch,
 * animated RSM (C-05), water (C-04) and the faded model pass (C-06) — with the legacy
 * shader arithmetic (shaders/world, ground.frag, water.frag, models.frag).
 *
 * Everything hangs off the instance (no module singletons). The CPU payloads and the
 * decoded images are retained so a context restore rebuilds the map without the
 * worker (R-CTX-007 fix).
 */
export class MapWorld {
	/**
	 * @param {{
	 *   gl: WebGL2RenderingContext,
	 *   state: import('../pipeline/GLStateCache.js').GLStateCache,
	 *   images?: import('./worldImages.js').ImageDecoderPort,
	 *   files?: import('./worldImages.js').FilePort,
	 *   createCanvas?: import('./worldImages.js').CreateCanvas,
	 *   mipmaps?: boolean
	 * }} deps
	 */
	constructor({ gl, state, images, files, createCanvas = defaultCreateCanvas, mipmaps = false }) {
		this.gl = gl;
		this.state = state;
		this.createCanvas = createCanvas;
		this.images = images ?? createImageDecoder({ createCanvas });
		this.files = files ?? { load: () => Promise.resolve(null) };
		this.mipmaps = mipmaps;
		this._programs = null;
		this._pending = new Set();
		this._reset();
	}

	/** Forget every map resource (GL handles and retained payloads). */
	_reset() {
		/** @type {ReturnType<typeof mapLight>|null} */
		this.light = null;
		this.water = null;
		this.ground = null;
		this.altitude = null;
		this.models = null;
		/** @type {AnimatedRsm[]} */
		this.animated = [];
		this.animatedGpu = null;
		this.grid = null;
		this.occluder = {
			strength: 0,
			lastTick: 0,
			eye: new Float32Array(3),
			queries: [null, null],
			pending: [false, false],
			hit: [false, false],
			settings: {
				mode: OCCLUDER_DEFAULTS.mode,
				opacity: OCCLUDER_DEFAULTS.opacity,
				radius: OCCLUDER_DEFAULTS.radius
			},
			focus: new Float32Array(3),
			active: false
		};
		/** Draw calls issued by the last draw* call (diagnostics). */
		this.lastDrawCalls = 0;
		this._generation = (this._generation ?? 0) + 1;
	}

	/** Resolves once every upload started so far has finished. */
	whenReady() {
		return Promise.all([...this._pending]).then(() => undefined);
	}

	/** @param {Promise<any>} promise */
	_track(promise) {
		const tracked = promise.finally(() => this._pending.delete(tracked));
		this._pending.add(tracked);
		return tracked;
	}

	// ---------------------------------------------------------------- C-17 payloads

	/**
	 * One MAP_* worker message (spec §3.2). Image sources decode asynchronously; the
	 * returned promise settles once this message's GPU uploads are done.
	 * @param {{type: string, payload: any}} msg
	 * @returns {Promise<void>}
	 */
	accept({ type, payload }) {
		switch (type) {
			case 'MAP_WORLD':
				return this._track(this._acceptWorld(payload));
			case 'MAP_GROUND':
				return this._track(this._acceptGround(payload));
			case 'MAP_ALTITUDE':
				return this._track(this._acceptAltitude(payload));
			case 'MAP_MODELS':
				return this._track(this._acceptModels(payload));
			case 'MAP_ANIMATED_MODEL':
				return this._track(this._acceptAnimated(payload));
			default:
				return Promise.resolve();
		}
	}

	/** New map (or `MapRenderer.free`): release the current one. */
	free() {
		this._deleteGl();
		this._reset();
	}

	/** R-CTX-006: every GL object died with the context; keep the CPU side. */
	contextLost() {
		this._programs = null;
		for (const part of [this.ground, this.water, this.models, this.animatedGpu, this.grid]) {
			if (part) {
				part.gl = null;
			}
		}
		this.models?.layers.forget();
		this.animatedGpu?.layers.forget();
		this.occluder.queries = [null, null];
		this.occluder.pending = [false, false];
	}

	/** R-CTX-007 (fix): re-upload the current map from the retained payloads and images. */
	rebuild() {
		this._programs = null;
		if (this.ground) {
			this._uploadGround();
		}
		if (this.water) {
			this._uploadWater();
		}
		if (this.models) {
			this._uploadModels();
		}
		if (this.animated.length) {
			this._uploadAnimated();
		}
		if (this.grid) {
			this._uploadGrid();
		}
	}

	async _acceptWorld(payload) {
		this.light = mapLight(payload.light);
		this.water = { params: payload.water, images: null, mesh: null, vertCount: 0, gl: null };
		if (this.ground) {
			this._attachWaterMesh();
		}
		await this._decodeWater();
	}

	async _decodeWater() {
		const water = this.water;
		const sources = water.params.images ?? [];
		const generation = this._generation;
		const keyed = await Promise.all(Array.from({ length: WATER_FRAMES }, (_, i) => this.images.decode(sources[i])));
		if (generation !== this._generation || water !== this.water) {
			return;
		}
		water.keyed = keyed;
		if (water.vertCount) {
			this._uploadWater();
		}
	}

	_attachWaterMesh() {
		this.water.mesh = this.ground.payload.waterMesh;
		this.water.vertCount = this.ground.payload.waterVertCount;
		if (this.water.keyed && this.water.vertCount) {
			this._uploadWater();
		}
	}

	async _acceptGround(payload) {
		this.ground = { payload, keyed: null, gl: null };
		if (this.water) {
			this._attachWaterMesh();
		}
		const ground = this.ground;
		const generation = this._generation;
		const keyed = await Promise.all(payload.textures.map(source => this.images.decode(source)));
		if (generation !== this._generation || ground !== this.ground) {
			return;
		}
		ground.keyed = keyed;
		this._uploadGround();
	}

	async _acceptAltitude(payload) {
		this.altitude = { cells: payload.cells, width: payload.width, height: payload.height };
		const generation = this._generation;
		const source = await this.files.load('data/texture/grid.tga');
		const keyed = source ? await this.images.decode(source) : null;
		if (generation !== this._generation || !keyed) {
			return;
		}
		this.grid = { keyed, gl: null };
		this._uploadGrid();
	}

	async _acceptModels(payload) {
		this.models = { payload, keyed: null, layers: null, gl: null, runs: [] };
		const models = this.models;
		const generation = this._generation;
		const keyed = await Promise.all(payload.infos.map(info => this.images.decode(info.texture)));
		if (generation !== this._generation || models !== this.models) {
			return;
		}
		models.keyed = keyed;
		this._uploadModels();
	}

	async _acceptAnimated(payload) {
		if (!payload || !payload.nodes || payload.nodes.length === 0) {
			return;
		}
		const base = this.animated.reduce((n, m) => n + m.matrixCount, 0);
		const model = new AnimatedRsm(payload, base);
		model.update(0, false, true);
		this.animated.push(model);
		const generation = this._generation;
		model.keyed = await Promise.all(
			model.textures.map(async name => {
				const source = await this.files.load(`data\\texture\\${name}`);
				return source ? this.images.decode(source) : null;
			})
		);
		if (generation !== this._generation) {
			return;
		}
		this._uploadAnimated();
	}

	// ---------------------------------------------------------------- GPU uploads

	_program() {
		if (this._programs) {
			return this._programs;
		}
		const { gl } = this;
		const make = (vs, fs, names) => {
			const program = createProgram(gl, vs, fs);
			const u = {};
			for (const name of names) {
				u[name] = gl.getUniformLocation(program, name);
			}
			return { program, u };
		};
		this._programs = {
			ground: make(SHADERS.groundVert, SHADERS.groundFrag, [
				...VIEW_UNIFORMS,
				...LIGHT_UNIFORMS,
				...FOG_UNIFORMS,
				'uLightmapUse',
				'uSmoothLight',
				'uDiffuse',
				'uLightmap',
				'uTileColor'
			]),
			water: make(SHADERS.waterVert, SHADERS.waterFrag, [
				...VIEW_UNIFORMS,
				...FOG_UNIFORMS,
				'uWaveHeight',
				'uWavePitch',
				'uWaterOffset',
				'uOpacity',
				'uWater',
				'uLayer',
				'uScale'
			]),
			models: make(SHADERS.modelsVert, SHADERS.modelsFrag, [
				...VIEW_UNIFORMS,
				...LIGHT_UNIFORMS,
				...FOG_UNIFORMS,
				...OCCLUDER_UNIFORMS,
				'uLightmapUse',
				'uDiffuse'
			]),
			animated: make(SHADERS.animatedModelsVert, SHADERS.modelsFrag, [
				...VIEW_UNIFORMS,
				...LIGHT_UNIFORMS,
				...FOG_UNIFORMS,
				...OCCLUDER_UNIFORMS,
				'uLightmapUse',
				'uDiffuse',
				'uMatrixTexture',
				'uPaletteWidth'
			]),
			grid: make(SHADERS.gridVert, SHADERS.gridFrag, [...VIEW_UNIFORMS, ...FOG_UNIFORMS, 'uDiffuse'])
		};
		return this._programs;
	}

	/**
	 * A VAO over `buffers`: [{data, attributes: [[location, size, offsetFloats]], stride}].
	 * @param {{data: Float32Array, stride: number, attributes: number[][]}[]} buffers
	 */
	_vao(buffers) {
		const { gl } = this;
		const vao = gl.createVertexArray();
		const handles = [];
		gl.bindVertexArray(vao);
		for (const { data, stride, attributes } of buffers) {
			const buffer = gl.createBuffer();
			handles.push(buffer);
			gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
			gl.bufferData(GL.ARRAY_BUFFER, data, GL.STATIC_DRAW);
			for (const [location, size, offset] of attributes) {
				gl.enableVertexAttribArray(location);
				gl.vertexAttribPointer(location, size, GL.FLOAT, false, stride * 4, offset * 4);
			}
		}
		gl.bindVertexArray(null);
		gl.bindBuffer(GL.ARRAY_BUFFER, null);
		return { vao, buffers: handles };
	}

	/**
	 * TEXTURE_2D upload with LINEAR filtering (and the optional mipmaps) and the default
	 * REPEAT wrap, as legacy Ground / GridSelector upload theirs.
	 * @param {TexImageSource|{width: number, height: number, data: ArrayBufferView}} source
	 */
	_texture2d(source, { mipmaps = this.mipmaps } = {}) {
		const { gl } = this;
		const texture = gl.createTexture();
		gl.bindTexture(GL.TEXTURE_2D, texture);
		if ('data' in source && ArrayBuffer.isView(source.data)) {
			gl.texImage2D(
				GL.TEXTURE_2D,
				0,
				GL.RGBA,
				source.width,
				source.height,
				0,
				GL.RGBA,
				GL.UNSIGNED_BYTE,
				source.data
			);
		} else {
			gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, /** @type {any} */ (source));
		}
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
		if (mipmaps) {
			gl.generateMipmap(GL.TEXTURE_2D);
		}
		gl.bindTexture(GL.TEXTURE_2D, null);
		return texture;
	}

	/** R-MAP-005/006/007: mesh, lightmap atlas, tile colours, texture atlas. */
	_uploadGround() {
		const { payload, keyed } = this.ground;
		if (!keyed) {
			return;
		}
		const size = payload.lightmapSize;
		const lightmap = {
			width: nextPot(Math.round(Math.sqrt(size)) * 8),
			height: nextPot(Math.ceil(Math.sqrt(size)) * 8),
			data: payload.lightmap
		};
		this.ground.gl = {
			...this._vao([
				{
					data: payload.mesh,
					stride: GROUND_VERTEX_FLOATS,
					attributes: [
						[0, 3, 0],
						[1, 3, 3],
						[2, 2, 6],
						[3, 2, 8],
						[4, 2, 10]
					]
				}
			]),
			count: payload.meshVertCount,
			lightmap: this._texture2d(lightmap),
			// WebGL2 legacy path: NPOT, LINEAR, never mipmapped.
			tileColor: this._texture2d(
				{ width: payload.width, height: payload.height, data: payload.tileColor },
				{ mipmaps: false }
			),
			atlas: this._texture2d(composeGroundAtlas(keyed, this.createCanvas))
		};
	}

	/** R-MAP-008/009: water mesh and the 32 frames as one texture array. */
	_uploadWater() {
		const { gl } = this;
		const water = this.water;
		const frames = water.keyed.map(image => (image ? potTexels(gl, image, this.createCanvas) : null));
		const size = Math.max(1, ...frames.map(f => (f ? Math.max(f.width, f.height) : 1)));
		const texture = gl.createTexture();
		gl.bindTexture(GL.TEXTURE_2D_ARRAY, texture);
		gl.texStorage3D(GL.TEXTURE_2D_ARRAY, 1, GL.RGBA8, size, size, WATER_FRAMES);
		gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
		frames.forEach((frame, layer) => {
			if (frame) {
				const data = padLayer(frame.data, frame.width, frame.height, size, 4);
				gl.texSubImage3D(GL.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, GL.RGBA, GL.UNSIGNED_BYTE, data);
			}
		});
		gl.pixelStorei(GL.UNPACK_ALIGNMENT, 4);
		gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
		gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
		gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
		gl.texParameteri(GL.TEXTURE_2D_ARRAY, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
		gl.bindTexture(GL.TEXTURE_2D_ARRAY, null);
		water.gl = {
			...this._vao([
				{
					data: water.mesh,
					stride: WATER_VERTEX_FLOATS,
					attributes: [
						[0, 3, 0],
						[1, 2, 3]
					]
				}
			]),
			texture,
			scales: frames.map(f => (f ? [f.width / size, f.height / size] : null))
		};
	}

	/**
	 * R-MAP-012 static batch + R-PERF-004: one draw per contiguous run of the infos
	 * (legacy order kept) whose textures share a size-class array.
	 */
	_uploadModels() {
		const { gl } = this;
		const models = this.models;
		const { buffer, infos } = models.payload;
		models.layers ??= new LayerSet({ gl, mipmaps: this.mipmaps });
		if (models.layers.images.length === 0) {
			for (const image of models.keyed) {
				models.layers.add(image ? potTexels(gl, image, this.createCanvas) : null);
			}
		}
		models.layers.build();
		const vertexCount = buffer.length / MODEL_VERTEX_FLOATS;
		const layerData = new Float32Array(vertexCount * 3);
		/** @type {{key: string, first: number, count: number}[]} */
		const runs = [];
		infos.forEach((info, i) => {
			const slot = models.layers.slot(i);
			if (!slot) {
				return;
			}
			for (let v = info.vertOffset; v < info.vertOffset + info.vertCount; v++) {
				layerData.set([slot.layer, slot.scale[0], slot.scale[1]], v * 3);
			}
			const last = runs[runs.length - 1];
			if (last && last.key === slot.key && last.first + last.count === info.vertOffset) {
				last.count += info.vertCount;
			} else {
				runs.push({ key: slot.key, first: info.vertOffset, count: info.vertCount });
			}
		});
		models.runs = runs;
		models.gl = this._vao([
			{
				data: buffer,
				stride: MODEL_VERTEX_FLOATS,
				attributes: [
					[0, 3, 0],
					[1, 3, 3],
					[2, 2, 6],
					[3, 1, 8]
				]
			},
			{ data: layerData, stride: 3, attributes: [[4, 3, 0]] }
		]);
	}

	/** R-MAP-017: every animated model in one VBO, one shared RGBA32F matrix palette. */
	_uploadAnimated() {
		const { gl } = this;
		if (this.animatedGpu?.gl) {
			this._deleteVao(this.animatedGpu.gl);
			gl.deleteTexture(this.animatedGpu.gl.palette);
		}
		const layers = this.animatedGpu?.layers ?? new LayerSet({ gl, mipmaps: this.mipmaps });
		const ready = this.animated.filter(m => m.keyed);
		for (const model of ready) {
			if (model.slots === undefined) {
				model.slots = model.keyed.map(image =>
					layers.add(image ? potTexels(gl, image, this.createCanvas) : null)
				);
			}
		}
		layers.build();
		const total = ready.reduce((n, m) => n + m.vertexCount, 0);
		const vertices = new Float32Array(total * ANIMATED_VERTEX_FLOATS);
		const layerData = new Float32Array(total * 3);
		/** @type {{key: string, first: number, count: number}[]} */
		const runs = [];
		let base = 0;
		for (const model of ready) {
			vertices.set(model.vertexData, base * ANIMATED_VERTEX_FLOATS);
			for (const mesh of model.meshes) {
				const slot = layers.slot(model.slots[mesh.textureIndex] ?? -1);
				const first = base + mesh.vertOffset;
				if (!slot) {
					continue;
				}
				for (let v = first; v < first + mesh.vertCount; v++) {
					layerData.set([slot.layer, slot.scale[0], slot.scale[1]], v * 3);
				}
				const last = runs[runs.length - 1];
				if (last && last.key === slot.key && last.first + last.count === first) {
					last.count += mesh.vertCount;
				} else {
					runs.push({ key: slot.key, first, count: mesh.vertCount });
				}
			}
			base += model.vertexCount;
		}
		const matrices = this.animated.reduce((n, m) => n + m.matrixCount, 0);
		const rows = Math.max(1, Math.ceil((matrices * 4) / PALETTE_WIDTH));
		const palette = gl.createTexture();
		gl.bindTexture(GL.TEXTURE_2D, palette);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
		gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
		gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA32F, PALETTE_WIDTH, rows);
		gl.bindTexture(GL.TEXTURE_2D, null);
		this.animatedGpu = {
			layers,
			runs,
			paletteData: new Float32Array(rows * PALETTE_WIDTH * 4),
			rows,
			dirty: true,
			gl: {
				...this._vao([
					{
						data: vertices,
						stride: ANIMATED_VERTEX_FLOATS,
						attributes: [
							[0, 3, 0],
							[1, 3, 3],
							[2, 2, 6],
							[3, 1, 8],
							[5, 1, 9]
						]
					},
					{ data: layerData, stride: 3, attributes: [[4, 3, 0]] }
				]),
				palette
			}
		};
	}

	/** R-MAP-021: grid.tga at alpha 0.6, tinted, POT. */
	_uploadGrid() {
		const { gl } = this;
		const buffer = gl.createBuffer();
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);
		gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, GL.FLOAT, false, 20, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 2, GL.FLOAT, false, 20, 12);
		gl.bindVertexArray(null);
		gl.bindBuffer(GL.ARRAY_BUFFER, null);
		this.grid.gl = {
			vao,
			buffers: [buffer],
			capacity: 0,
			texture: this._texture2d(composeGridTexture(this.grid.keyed, this.createCanvas))
		};
	}

	_deleteVao(part) {
		if (!part) {
			return;
		}
		this.gl.deleteVertexArray(part.vao);
		for (const buffer of part.buffers) {
			this.gl.deleteBuffer(buffer);
		}
	}

	_deleteGl() {
		const { gl } = this;
		if (this.ground?.gl) {
			this._deleteVao(this.ground.gl);
			for (const t of [this.ground.gl.lightmap, this.ground.gl.tileColor, this.ground.gl.atlas]) {
				gl.deleteTexture(t);
			}
		}
		if (this.water?.gl) {
			this._deleteVao(this.water.gl);
			gl.deleteTexture(this.water.gl.texture);
		}
		if (this.models?.gl) {
			this._deleteVao(this.models.gl);
			this.models.layers.dispose();
		}
		if (this.animatedGpu?.gl) {
			this._deleteVao(this.animatedGpu.gl);
			gl.deleteTexture(this.animatedGpu.gl.palette);
			this.animatedGpu.layers.dispose();
		}
		if (this.grid?.gl) {
			this._deleteVao(this.grid.gl);
			gl.deleteTexture(this.grid.gl.texture);
		}
		for (const query of this.occluder.queries) {
			if (query) {
				gl.deleteQuery(query);
			}
		}
	}

	// ---------------------------------------------------------------- frame passes

	/** @param {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}} p @param {WorldView} view */
	_bindCommon(p, view, withFog = true) {
		const { gl } = this;
		gl.useProgram(p.program);
		gl.uniformMatrix4fv(p.u.uModelViewMat, false, view.modelView);
		gl.uniformMatrix4fv(p.u.uProjectionMat, false, view.projection);
		if (withFog) {
			const fog = view.fog ?? { use: false, near: 0, far: 1, color: [0, 0, 0] };
			gl.uniform1i(p.u.uFogUse, fog.use ? 1 : 0);
			gl.uniform1f(p.u.uFogNear, fog.near);
			gl.uniform1f(p.u.uFogFar, fog.far);
			gl.uniform3fv(p.u.uFogColor, fog.color);
		}
	}

	/** Map light with the frame's overrides (R-CTX-012, R-CTX-013); the GR2 pass reads it too. @param {WorldFrame} frame */
	frameLight(frame) {
		return this._light(frame);
	}

	/** Map light with the frame's overrides (R-CTX-012, R-CTX-013). @param {WorldFrame} frame */
	_light(frame) {
		const base =
			this.light ?? mapLight({ longitude: 45, latitude: 45, diffuse: [1, 1, 1], ambient: [0, 0, 0], opacity: 1 });
		return { ...base, ...(frame.light ?? {}) };
	}

	_bindLight(p, frame) {
		const { gl } = this;
		const light = this._light(frame);
		gl.uniform3fv(p.u.uLightDirection, light.direction);
		gl.uniform1f(p.u.uLightOpacity, light.opacity);
		gl.uniform3fv(p.u.uLightAmbient, light.ambient);
		gl.uniform3fv(p.u.uLightDiffuse, light.diffuse);
		gl.uniform3fv(p.u.uLightEnv, light.env);
		gl.uniform1i(p.u.uLightmapUse, frame.lightmap === false ? 0 : 1);
	}

	/**
	 * R-CTX-010 step 3, R-MAP-001…007.
	 * @param {WorldView} view
	 * @param {WorldFrame} [frame]
	 */
	drawGround(view, frame = {}) {
		this.lastDrawCalls = 0;
		const part = this.ground?.gl;
		if (!part) {
			return;
		}
		const { gl } = this;
		const p = this._program().ground;
		this.state.apply(OPAQUE_STATE);
		this._bindCommon(p, view);
		this._bindLight(p, frame);
		gl.uniform1i(p.u.uSmoothLight, frame.smoothlight ?? 0);
		gl.uniform1i(p.u.uDiffuse, 0);
		gl.uniform1i(p.u.uLightmap, 1);
		gl.uniform1i(p.u.uTileColor, 2);
		gl.activeTexture(GL.TEXTURE0);
		gl.bindTexture(GL.TEXTURE_2D, part.atlas);
		gl.activeTexture(GL.TEXTURE0 + 1);
		gl.bindTexture(GL.TEXTURE_2D, part.lightmap);
		gl.activeTexture(GL.TEXTURE0 + 2);
		gl.bindTexture(GL.TEXTURE_2D, part.tileColor);
		gl.bindVertexArray(part.vao);
		gl.drawArrays(GL.TRIANGLES, 0, part.count);
		this.lastDrawCalls++;
		gl.bindVertexArray(null);
		gl.activeTexture(GL.TEXTURE0);
	}

	/**
	 * R-CTX-010 step 5, R-MAP-021: one draw for every selector cell, in order (each
	 * cell is the legacy 4-vertex strip as two triangles: same vertices, same order).
	 * @param {WorldView} view
	 * @param {ReadonlyArray<{x: number, y: number}>} cells
	 */
	drawGrid(view, cells = []) {
		this.lastDrawCalls = 0;
		const part = this.grid?.gl;
		if (!part || cells.length === 0) {
			return;
		}
		const { gl } = this;
		const data = new Float32Array(cells.length * 30);
		cells.forEach(({ x, y }, i) => {
			const z = this.cellCorners(x, y);
			const v = [
				[x, z[0], y, 0, 0],
				[x + 1, z[1], y, 1, 0],
				[x, z[2], y + 1, 0, 1],
				[x + 1, z[3], y + 1, 1, 1]
			];
			data.set([...v[0], ...v[1], ...v[2], ...v[2], ...v[1], ...v[3]], i * 30);
		});
		const p = this._program().grid;
		this.state.apply(OPAQUE_STATE);
		this._bindCommon(p, view);
		gl.uniform1i(p.u.uDiffuse, 0);
		gl.bindVertexArray(part.vao);
		gl.bindBuffer(GL.ARRAY_BUFFER, part.buffers[0]);
		gl.bufferData(GL.ARRAY_BUFFER, data, GL.DYNAMIC_DRAW);
		gl.activeTexture(GL.TEXTURE0);
		gl.bindTexture(GL.TEXTURE_2D, part.texture);
		gl.drawArrays(GL.TRIANGLES, 0, cells.length * 6);
		this.lastDrawCalls++;
		gl.bindVertexArray(null);
		gl.bindBuffer(GL.ARRAY_BUFFER, null);
	}

	/**
	 * GAT corner heights of a cell (legacy Altitude.getCell): zero outside the map.
	 * @param {number} x
	 * @param {number} y
	 */
	cellCorners(x, y) {
		const alt = this.altitude;
		const cx = Math.floor(x);
		const cy = Math.floor(y);
		const out = new Float32Array(4);
		if (!alt || cx < 0 || cy < 0 || cx >= alt.width || cy >= alt.height) {
			return out;
		}
		const index = (cx + cy * alt.width) * 5;
		out.set(alt.cells.subarray(index, index + 4));
		return out;
	}

	/**
	 * R-CTX-010 step 7, R-MAP-018/019: collect last frame's occlusion queries and ease
	 * the fade strength; refresh the eye (inverse view) and the focus.
	 * @param {WorldView} view
	 * @param {WorldFrame} frame
	 */
	beginOccluder(view, frame = {}) {
		const occ = this.occluder;
		const settings = { ...OCCLUDER_DEFAULTS, ...(frame.occluder ?? {}) };
		occ.settings = settings;
		occ.focus.set(frame.occluder?.focus ?? [0, 0, 0]);
		const inverse = invert(new Float32Array(16), view.modelView);
		if (inverse) {
			occ.eye[0] = inverse[12];
			occ.eye[1] = inverse[13];
			occ.eye[2] = inverse[14];
		}
		const tick = frame.tick ?? 0;
		const dt = occ.lastTick ? Math.min(tick - occ.lastTick, OCCLUDER_QUERY.dtCapMs) : 0;
		occ.lastTick = tick;
		occ.active = occluderFadeActive(settings.mode, Boolean(settings.firstPerson));
		if (!occ.active) {
			occ.strength = 0;
			return;
		}
		for (let slot = 0; slot < occ.queries.length; slot++) {
			this._pollQuery(slot);
		}
		if (occ.hit[QUERY_SLOT.MODELS] || occ.hit[QUERY_SLOT.ANIMATED]) {
			occ.strength = Math.min(1, occ.strength + dt / OCCLUDER_QUERY.fadeInMs);
		} else {
			occ.strength = Math.max(0, occ.strength - dt / OCCLUDER_QUERY.fadeOutMs);
		}
	}

	_pollQuery(slot) {
		const { gl } = this;
		const occ = this.occluder;
		if (!occ.pending[slot]) {
			return;
		}
		const query = occ.queries[slot];
		if (!gl.getQueryParameter(query, GL.QUERY_RESULT_AVAILABLE)) {
			return;
		}
		occ.hit[slot] = Boolean(gl.getQueryParameter(query, GL.QUERY_RESULT));
		occ.pending[slot] = false;
	}

	/** Whether the fade shows this frame (R-MAP-018). */
	_fading() {
		return this.occluder.active && this.occluder.strength > 0.001;
	}

	_needsBlendPass() {
		return this._fading() && this.occluder.settings.mode === 'alpha';
	}

	_setOccluder(p, mode) {
		const { gl } = this;
		const occ = this.occluder;
		gl.uniform1i(p.u.uOccluderFadeMode, mode);
		if (mode === OCCLUDER_MODE.OFF) {
			return;
		}
		gl.uniform3fv(p.u.uOccluderFadeEye, occ.eye);
		gl.uniform3fv(p.u.uOccluderFadeFocus, occ.focus);
		gl.uniform1f(
			p.u.uOccluderFadeRadius,
			mode === OCCLUDER_MODE.QUERY ? OCCLUDER_QUERY.axisRadius : occ.settings.radius
		);
		gl.uniform1f(p.u.uOccluderFadeOpacity, occ.settings.opacity);
		gl.uniform1f(p.u.uOccluderFadeStrength, occ.strength);
	}

	_opaqueMode() {
		if (!this._fading()) {
			return OCCLUDER_MODE.OFF;
		}
		return this.occluder.settings.mode === 'alpha' ? OCCLUDER_MODE.ALPHA_OPAQUE : OCCLUDER_MODE.DITHER;
	}

	/**
	 * Opaque pass then the line-of-sight query pass of one model renderer (R-MAP-019/020).
	 * @param {{program: WebGLProgram, u: Record<string, WebGLUniformLocation>}} p
	 * @param {() => void} draw
	 * @param {number} slot
	 */
	_opaqueAndQuery(p, draw, slot) {
		const { gl } = this;
		const occ = this.occluder;
		this._setOccluder(p, this._opaqueMode());
		this.state.apply(OPAQUE_STATE);
		draw();
		if (!occ.active || occ.pending[slot]) {
			return;
		}
		occ.queries[slot] ??= gl.createQuery();
		this._setOccluder(p, OCCLUDER_MODE.QUERY);
		gl.colorMask(false, false, false, false);
		this.state.apply(QUERY_STATE);
		gl.beginQuery(GL.ANY_SAMPLES_PASSED_CONSERVATIVE, occ.queries[slot]);
		draw();
		gl.endQuery(GL.ANY_SAMPLES_PASSED_CONSERVATIVE);
		gl.colorMask(true, true, true, true);
		this.state.apply(OPAQUE_STATE);
		occ.pending[slot] = true;
	}

	/** @param {{key: string, first: number, count: number}[]} runs @param {LayerSet} layers */
	_drawRuns(runs, layers) {
		const { gl } = this;
		gl.activeTexture(GL.TEXTURE0);
		let bound = null;
		for (const run of runs) {
			const texture = layers.arrays.get(run.key);
			if (texture !== bound) {
				gl.bindTexture(GL.TEXTURE_2D_ARRAY, texture);
				bound = texture;
			}
			gl.drawArrays(GL.TRIANGLES, run.first, run.count);
			this.lastDrawCalls++;
		}
	}

	_bindModels(view, frame) {
		const p = this._program().models;
		this._bindCommon(p, view);
		this._bindLight(p, frame);
		this.gl.uniform1i(p.u.uDiffuse, 0);
		this.gl.bindVertexArray(this.models.gl.vao);
		return p;
	}

	/**
	 * R-CTX-010 step 8, R-MAP-012, R-PERF-004.
	 * @param {WorldView} view
	 * @param {WorldFrame} [frame]
	 */
	drawStaticModels(view, frame = {}) {
		this.lastDrawCalls = 0;
		if (!this.models?.gl) {
			return;
		}
		const p = this._bindModels(view, frame);
		this._opaqueAndQuery(p, () => this._drawRuns(this.models.runs, this.models.layers), QUERY_SLOT.MODELS);
		this.gl.bindVertexArray(null);
	}

	/** Recompute the matrices whose R-MAP-016 bucket changed and upload the palette. */
	_updatePalette(frame) {
		const gpu = this.animatedGpu;
		let dirty = gpu.dirty;
		for (const model of this.animated) {
			if (frame.matrices?.has(model)) {
				model.matrices.set(frame.matrices.get(model));
				dirty = true;
			} else if (model.update(frame.tick ?? 0, Boolean(frame.performanceMode))) {
				dirty = true;
			}
		}
		if (!dirty) {
			return;
		}
		for (const model of this.animated) {
			gpu.paletteData.set(model.matrices, model.matrixBase * 16);
		}
		const { gl } = this;
		gl.bindTexture(GL.TEXTURE_2D, gpu.gl.palette);
		gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, PALETTE_WIDTH, gpu.rows, GL.RGBA, GL.FLOAT, gpu.paletteData);
		gl.bindTexture(GL.TEXTURE_2D, null);
		gpu.dirty = false;
	}

	_bindAnimated(view, frame) {
		const { gl } = this;
		const p = this._program().animated;
		this._bindCommon(p, view);
		this._bindLight(p, frame);
		gl.uniform1i(p.u.uDiffuse, 0);
		gl.uniform1i(p.u.uMatrixTexture, 1);
		gl.uniform1i(p.u.uPaletteWidth, PALETTE_WIDTH);
		gl.activeTexture(GL.TEXTURE0 + 1);
		gl.bindTexture(GL.TEXTURE_2D, this.animatedGpu.gl.palette);
		gl.activeTexture(GL.TEXTURE0);
		gl.bindVertexArray(this.animatedGpu.gl.vao);
		return p;
	}

	/**
	 * R-CTX-010 step 9, R-MAP-013 (fixed: honours the lightmap preference), R-MAP-016/017.
	 * `frame.matrices` (Map model → Float32Array) lets animatedModel records supply the
	 * matrices instead of the local R-MAP-016/017 computation.
	 * @param {WorldView} view
	 * @param {WorldFrame & {matrices?: Map<AnimatedRsm, Float32Array>}} [frame]
	 */
	drawAnimatedModels(view, frame = {}) {
		this.lastDrawCalls = 0;
		if (!this.animatedGpu?.gl || this.animated.length === 0) {
			return;
		}
		this._updatePalette(frame);
		const p = this._bindAnimated(view, frame);
		const gpu = this.animatedGpu;
		this._opaqueAndQuery(p, () => this._drawRuns(gpu.runs, gpu.layers), QUERY_SLOT.ANIMATED);
		this.gl.bindVertexArray(null);
	}

	/**
	 * R-CTX-010 step 15, R-MAP-008…011. Fields of a `world`/`water` record (R-MAP-010
	 * alpha, R-MAP-009 frame, depth state) win over the local computation.
	 * @param {WorldView} view
	 * @param {WorldFrame} [frame]
	 * @param {Partial<import('../ports.js').WorldRecord>|null} [record]
	 */
	drawWater(view, frame = {}, record = null) {
		this.lastDrawCalls = 0;
		const water = this.water;
		if (!water?.gl || !water.vertCount) {
			return;
		}
		const { gl } = this;
		const params = water.params;
		const tick = frame.tick ?? 0;
		const layer = record?.textureIndex ?? waterFrameIndex(tick, params.animSpeed);
		const scale = water.gl.scales[layer];
		if (!scale) {
			return;
		}
		const p = this._program().water;
		this.state.apply({
			blend: record?.blend ?? NORMAL_BLEND,
			depthTest: record?.depthTest ?? true,
			depthWrite: record?.depthWrite ?? false
		});
		this._bindCommon(p, view);
		gl.uniform1f(p.u.uWaveHeight, params.waveHeight);
		gl.uniform1f(p.u.uWavePitch, params.wavePitch);
		gl.uniform1f(p.u.uWaterOffset, record?.params?.waveOffset ?? waveOffset(tick, params.waveSpeed));
		gl.uniform1f(p.u.uOpacity, record?.alpha ?? waterAlpha(params.type));
		gl.uniform1i(p.u.uWater, 0);
		gl.uniform1f(p.u.uLayer, layer);
		gl.uniform2f(p.u.uScale, scale[0], scale[1]);
		gl.activeTexture(GL.TEXTURE0);
		gl.bindTexture(GL.TEXTURE_2D_ARRAY, water.gl.texture);
		gl.bindVertexArray(water.gl.vao);
		gl.drawArrays(GL.TRIANGLES, 0, water.vertCount);
		this.lastDrawCalls++;
		gl.bindVertexArray(null);
		this.state.apply(OPAQUE_STATE);
	}

	/**
	 * R-CTX-010 step 16, R-MAP-020 alpha mode: the faded region of the static then the
	 * animated models, translucent (depth test on, write off), after the entities.
	 * @param {WorldView} view
	 * @param {WorldFrame} [frame]
	 */
	drawFaded(view, frame = {}) {
		this.lastDrawCalls = 0;
		if (!this._needsBlendPass()) {
			return;
		}
		const { gl } = this;
		if (this.models?.gl) {
			const p = this._bindModels(view, frame);
			this._setOccluder(p, OCCLUDER_MODE.ALPHA_BLEND);
			this.state.apply(TRANSLUCENT_STATE);
			this._drawRuns(this.models.runs, this.models.layers);
		}
		if (this.animatedGpu?.gl && this.animated.length) {
			const p = this._bindAnimated(view, frame);
			this._setOccluder(p, OCCLUDER_MODE.ALPHA_BLEND);
			this.state.apply(TRANSLUCENT_STATE);
			this._drawRuns(this.animatedGpu.runs, this.animatedGpu.layers);
		}
		gl.bindVertexArray(null);
		this.state.apply(OPAQUE_STATE);
	}

	/** Current occluder fade strength (diagnostics). */
	get occluderStrength() {
		return this.occluder.strength;
	}
}
