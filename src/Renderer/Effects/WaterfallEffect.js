/**
 * Renderer/Effects/WaterfallEffect.js
 *
 * Rendering Waterfall effect
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @author Alison Serafim
 */

import WebGL from 'Utils/WebGL.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';
import _vertexShader from './WaterfallEffect.vs?raw';
import _fragmentShader from './WaterfallEffect.fs?raw';
import _particleVertexShader from './WaterfallParticle.vs?raw';
import _particleFragmentShader from './WaterfallParticle.fs?raw';

const mat4 = glMatrix.mat4;
const _matrix = mat4.create();

// Client units are 1/5 of a world unit.
const UNIT = 1 / 5;
const LAYER_COUNT = 4;
const SEGMENT_COUNT = 5;
const TEXTURE_COUNT = 3;
const SEGMENT_HEIGHT = 40 * UNIT;
const EFFECT_TICK_MS = 24;
const OPACITY = 80 / 255;

// Spray puffs cycle through 38 client units at 0.05 units per tick.
const PARTICLE_TEXTURE = 'data/texture/effect/freeze_a_small.bmp';
const PARTICLE_CYCLE_MS = (38 / 0.05) * EFFECT_TICK_MS;
const PARTICLE_SIZE = 6 * Math.SQRT1_2 * UNIT;
const PARTICLE_COLOR = [0.65, 1.0, 0.75];
const PARTICLE_FLOATS = 4;
const PARTICLE_CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

let _program;
let _particleProgram;
const _textureCache = new Map();

/**
 * Backend-neutral blend states: the curtain uses normal alpha, the spray is additive.
 */
const BLEND_NORMAL = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });
const BLEND_ADDITIVE = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE' });

/**
 * @var {boolean} scene fog state uploaded by the last beforeRender
 */
let _fogUse = false;

/**
 * Create an empty waterfall curtain draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records). One per layer segment: 4 layers × 5
 * segments a frame, drawn with the curtain program (normal alpha, depth test on, depth
 * write off, scene fog, uOpacity 80/255 as color alpha).
 *
 * params:
 *  - modelMatrix: uModelMat (RSW position, optional quarter turn)
 *  - vertices: 4 × (x, y, z, u, v) triangle-strip quad
 *  - layer, segment: indices in the curtain
 *  - vertexCount: 4
 *
 * @returns {object} record
 */
function createCurtainRecord() {
	return {
		kind: 'effect',
		family: 'waterfall',
		pass: 'after',
		texture: null,
		position: null,
		color: [1, 1, 1, OPACITY],
		blend: BLEND_NORMAL,
		depthTest: true,
		depthWrite: false,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			modelMatrix: null,
			vertices: new Float32Array(20),
			layer: 0,
			segment: 0,
			vertexCount: 4
		}
	};
}

/**
 * Create an empty spray draw record: one instanced draw of camera-facing puddles
 * (additive, particle program). color carries uColor (alpha is computed per particle).
 *
 * params:
 *  - modelMatrix: uModelMat
 *  - time: uTime, elapsed / cycle length
 *  - size: uSize
 *  - seeds: per-instance (x offset, z offset, phase, drift angle)
 *  - instanceCount
 *  - vertexCount: 4
 *
 * @returns {object} record
 */
function createSprayRecord() {
	return {
		kind: 'effect',
		family: 'waterfallSpray',
		pass: 'after',
		texture: null,
		position: null,
		color: [PARTICLE_COLOR[0], PARTICLE_COLOR[1], PARTICLE_COLOR[2], 1],
		blend: BLEND_ADDITIVE,
		depthTest: true,
		depthWrite: false,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			modelMatrix: null,
			time: 0,
			size: PARTICLE_SIZE,
			seeds: null,
			instanceCount: 0,
			vertexCount: 4
		}
	};
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {Array<object>} reused records when nobody observes (20 curtain + 1 spray)
 */
const _scratchRecords = [
	...Array.from({ length: LAYER_COUNT * SEGMENT_COUNT }, createCurtainRecord),
	createSprayRecord()
];

function textureFiles(textureSet) {
	const files = [];
	for (let index = 1; index <= TEXTURE_COUNT; index++) {
		files.push(`data/texture/effect/waterfall${textureSet}${index}.tga`);
	}
	files.push(PARTICLE_TEXTURE);
	return files;
}

function loadTextures(gl, textureSet, effect) {
	let cache = _textureCache.get(textureSet);
	if (!cache) {
		const files = textureFiles(textureSet);
		cache = {
			textures: new Array(files.length),
			waiters: new Set(),
			ready: false,
			active: true
		};
		_textureCache.set(textureSet, cache);

		files.forEach((file, index) => {
			Client.loadFile(file, buffer => {
				WebGL.texture(gl, buffer, texture => {
					if (!cache.active) {
						gl.deleteTexture(texture);
						return;
					}

					cache.textures[index] = texture;
					if (cache.textures.filter(Boolean).length === files.length) {
						cache.ready = true;
						cache.waiters.forEach(waiter => {
							waiter.textures = cache.textures;
							waiter.ready = true;
						});
						cache.waiters.clear();
					}
				});
			});
		});
	}

	if (cache.ready) {
		effect.textures = cache.textures;
		effect.ready = true;
	} else {
		cache.waiters.add(effect);
	}

	return cache;
}

function getStyle(variant) {
	const small = variant.includes('small');
	const dark = variant.includes('dark');
	return {
		width: (small ? 18 : 36) * UNIT,
		particleCount: small ? 320 : 640,
		particleSpread: (small ? 12 : 22) * UNIT,
		textureSet: dark ? 3 : 1
	};
}

function buildParticleSeeds(count, spread) {
	const seeds = new Float32Array(count * PARTICLE_FLOATS);
	for (let i = 0; i < count; i++) {
		seeds[i * PARTICLE_FLOATS] = (Math.random() * 2 - 1) * spread;
		seeds[i * PARTICLE_FLOATS + 1] = (Math.random() * 2 - 1) * 5 * UNIT;
		seeds[i * PARTICLE_FLOATS + 2] = Math.random();
		seeds[i * PARTICLE_FLOATS + 3] = Math.random() * Math.PI * 2;
	}
	return seeds;
}

function setVertex(vertices, index, x, y, z, u, v) {
	const offset = index * 5;
	vertices[offset] = x;
	vertices[offset + 1] = y;
	vertices[offset + 2] = z;
	vertices[offset + 3] = u;
	vertices[offset + 4] = v;
}

/**
 * Snapshot one frame of a waterfall into records: 20 curtain quads (layer by layer,
 * segment by segment) then the spray.
 *
 * @param {WaterfallEffect} effect
 * @param {number} tick game tick
 * @param {boolean} keep true when the records outlive the draw (fresh objects, copies)
 * @returns {Array<object>} records
 */
function fillWaterfallRecords(effect, tick, keep) {
	const records = keep
		? [...Array.from({ length: LAYER_COUNT * SEGMENT_COUNT }, createCurtainRecord), createSprayRecord()]
		: _scratchRecords;

	mat4.identity(_matrix);
	// Map effect positions carry the sprite offsets applied by MapRenderer (-0.5 x/z, +1 altitude);
	// revert them so the mesh sits exactly on the RSW position like models do.
	mat4.translate(_matrix, _matrix, [effect.position[0] + 0.5, 1 - effect.position[2], effect.position[1] + 0.5]);
	if (effect.vertical) {
		mat4.rotateY(_matrix, _matrix, Math.PI / 2);
	}
	const modelMatrix = keep ? mat4.clone(_matrix) : _matrix;
	const position = keep ? Array.from(effect.position) : effect.position;

	const elapsed = tick - effect.startTick;
	const process = Math.floor(elapsed / EFFECT_TICK_MS);

	let index = 0;
	for (let layer = 0; layer < LAYER_COUNT; layer++) {
		const speed = 80 - layer * 13;
		const scroll = ((process % speed) * SEGMENT_HEIGHT) / speed;
		const crop = scroll / SEGMENT_HEIGHT;
		const phase = Math.floor((process % (TEXTURE_COUNT * speed)) / speed);
		const halfWidth = (effect.width + layer * UNIT) / 2;
		const depth = (layer - 1) * UNIT;

		for (let segment = 0; segment < SEGMENT_COUNT; segment++) {
			const top = scroll - segment * SEGMENT_HEIGHT;
			const bottom = top - SEGMENT_HEIGHT;
			let visibleTop = top;
			let visibleBottom = bottom;
			let vTop = 0;
			let vBottom = 1;

			if (segment === 0) {
				visibleTop = top + (bottom - top) * crop;
				vTop = crop;
			} else if (segment === SEGMENT_COUNT - 1) {
				visibleBottom = top + (bottom - top) * crop;
				vBottom = crop;
			}

			const record = records[index++];
			const vertices = record.params.vertices;
			setVertex(vertices, 0, -halfWidth, -visibleBottom, depth, 0, vBottom);
			setVertex(vertices, 1, halfWidth, -visibleBottom, depth, 1, vBottom);
			setVertex(vertices, 2, -halfWidth, -visibleTop, depth, 0, vTop);
			setVertex(vertices, 3, halfWidth, -visibleTop, depth, 1, vTop);
			record.texture = effect.textures[(segment + phase) % TEXTURE_COUNT];
			record.position = position;
			record.fog = _fogUse;
			record.params.modelMatrix = modelMatrix;
			record.params.layer = layer;
			record.params.segment = segment;
		}
	}

	const spray = records[index];
	spray.texture = effect.textures[TEXTURE_COUNT];
	spray.position = position;
	spray.fog = _fogUse;
	spray.params.modelMatrix = modelMatrix;
	spray.params.time = elapsed / PARTICLE_CYCLE_MS;
	spray.params.seeds = effect.seeds;
	spray.params.instanceCount = effect.particleCount;

	return records;
}

/**
 * Draw one frame of waterfall records (curtain quads then the instanced spray).
 *
 * @param {WebGLRenderingContext} gl
 * @param {Array<object>} records from fillWaterfallRecords
 * @param {WaterfallEffect} effect owner of the GL buffers
 */
function drawWaterfallRecords(gl, records, effect) {
	const uniform = _program.uniform;
	const attribute = _program.attribute;
	const curtainCount = records.length - 1;

	gl.uniformMatrix4fv(uniform.uModelMat, false, records[0].params.modelMatrix);

	gl.bindBuffer(gl.ARRAY_BUFFER, effect.buffer);
	gl.vertexAttribPointer(attribute.aPosition, 3, gl.FLOAT, false, 20, 0);
	gl.vertexAttribPointer(attribute.aTextureCoord, 2, gl.FLOAT, false, 20, 12);

	for (let i = 0; i < curtainCount; i++) {
		const record = records[i];
		gl.bufferData(gl.ARRAY_BUFFER, record.params.vertices, gl.DYNAMIC_DRAW);
		gl.bindTexture(gl.TEXTURE_2D, record.texture);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, record.params.vertexCount);
	}

	drawSprayRecord(gl, records[curtainCount], effect);
}

/**
 * Additive spray puffs rising from the pool at the base of the fall,
 * drawn as camera-facing instanced quads.
 *
 * @param {WebGLRenderingContext} gl
 * @param {object} record spray record
 * @param {WaterfallEffect} effect owner of the GL buffers
 */
function drawSprayRecord(gl, record, effect) {
	const uniform = _particleProgram.uniform;
	const attribute = _particleProgram.attribute;
	const params = record.params;

	gl.useProgram(_particleProgram);
	gl.uniformMatrix4fv(uniform.uModelMat, false, params.modelMatrix);
	gl.uniform1f(uniform.uTime, params.time);
	gl.uniform1f(uniform.uSize, params.size);
	gl.blendFunc(gl[record.blend.src], gl[record.blend.dst]);

	gl.enableVertexAttribArray(attribute.aCorner);
	gl.enableVertexAttribArray(attribute.aSeed);
	gl.bindBuffer(gl.ARRAY_BUFFER, effect.cornerBuffer);
	gl.vertexAttribPointer(attribute.aCorner, 2, gl.FLOAT, false, 0, 0);
	gl.bindBuffer(gl.ARRAY_BUFFER, effect.seedBuffer);
	gl.vertexAttribPointer(attribute.aSeed, PARTICLE_FLOATS, gl.FLOAT, false, 0, 0);
	gl.vertexAttribDivisor(attribute.aSeed, 1);

	gl.bindTexture(gl.TEXTURE_2D, record.texture);
	gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, params.vertexCount, params.instanceCount);

	gl.vertexAttribDivisor(attribute.aSeed, 0);
	gl.disableVertexAttribArray(attribute.aCorner);
	gl.disableVertexAttribArray(attribute.aSeed);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.useProgram(_program);
	gl.enableVertexAttribArray(_program.attribute.aPosition);
	gl.enableVertexAttribArray(_program.attribute.aTextureCoord);
}

/**
 * WaterfallEffect constructor
 *
 * @param {object} effect parameters
 * @param {object} EF_Inst_Par parameters
 * @param {object} EF_Init_Par parameters
 */
class WaterfallEffect {
	constructor(effect, instance, init) {
		const style = getStyle(effect.variant);
		this.position = instance.position;
		this.startTick = instance.startTick;
		this.width = style.width;
		this.particleCount = style.particleCount;
		this.particleSpread = style.particleSpread;
		this.textureSet = style.textureSet;
		this.textures = [];
		this.textureCache = null;
		this.buffer = null;
		this.cornerBuffer = null;
		this.seedBuffer = null;
		this.seeds = null;
		this.vertical = effect.vertical;
		this.ready = false;
		this.needInit = true;
	}

	/**
	 * Initialize WebGL resources
	 *
	 * @param {WebGLRenderingContext} gl
	 */
	init(gl) {
		this.buffer = gl.createBuffer();
		this.cornerBuffer = gl.createBuffer();
		this.seedBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, PARTICLE_CORNERS, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuffer);
		this.seeds = buildParticleSeeds(this.particleCount, this.particleSpread);
		gl.bufferData(gl.ARRAY_BUFFER, this.seeds, gl.STATIC_DRAW);
		this.textureCache = loadTextures(gl, this.textureSet, this);
	}

	render(gl, tick) {
		// Observed frames get their own records; otherwise reuse a pool (no per-draw allocation).
		const observed = _recordSinks.size > 0;
		const records = fillWaterfallRecords(this, tick, observed);
		if (observed) {
			records.forEach(record => _recordSinks.forEach(sink => sink(record)));
		}
		drawWaterfallRecords(gl, records, this);
	}

	/**
	 * Observe every waterfall draw (curtain quads and the spray) as a backend-neutral
	 * record. Each observed draw gets a fresh record object, so sinks may keep it.
	 *
	 * @param {function} sink called with each draw record
	 * @returns {function} unsubscribe
	 */
	static addRecordSink(sink) {
		_recordSinks.add(sink);
		return () => _recordSinks.delete(sink);
	}

	/**
	 * Free WebGL resources
	 *
	 * @param {WebGLRenderingContext} gl
	 */
	free(gl) {
		if (this.textureCache) {
			this.textureCache.waiters.delete(this);
			this.textureCache = null;
		}
		[this.buffer, this.cornerBuffer, this.seedBuffer].forEach(buffer => {
			if (buffer) {
				gl.deleteBuffer(buffer);
			}
		});
		this.buffer = null;
		this.cornerBuffer = null;
		this.seedBuffer = null;
		this.seeds = null;
		this.textures = [];
		this.ready = false;
	}

	/**
	 * Called before rendering all effects of this type
	 *
	 * @param {WebGLRenderingContext} gl
	 * @param {mat4} modelView
	 * @param {mat4} projection
	 * @param {object} fog
	 * @param {number} tick
	 * @param {object} entity
	 */
	static beforeRender(gl, modelView, projection, fog) {
		const fogUse = fog.use && fog.exist;
		_fogUse = !!fogUse;

		gl.useProgram(_particleProgram);
		gl.uniformMatrix4fv(_particleProgram.uniform.uModelViewMat, false, modelView);
		gl.uniformMatrix4fv(_particleProgram.uniform.uProjectionMat, false, projection);
		gl.uniform1i(_particleProgram.uniform.uFogUse, fogUse);
		gl.uniform1f(_particleProgram.uniform.uFogNear, fog.near);
		gl.uniform1f(_particleProgram.uniform.uFogFar, fog.far);
		gl.uniform1i(_particleProgram.uniform.uTexture, 0);
		gl.uniform3fv(_particleProgram.uniform.uColor, PARTICLE_COLOR);

		const uniform = _program.uniform;
		const attribute = _program.attribute;
		gl.useProgram(_program);
		gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
		gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection);
		gl.uniform1i(uniform.uFogUse, fogUse);
		gl.uniform1f(uniform.uFogNear, fog.near);
		gl.uniform1f(uniform.uFogFar, fog.far);
		gl.uniform3fv(uniform.uFogColor, fog.color);
		gl.uniform1f(uniform.uOpacity, OPACITY);
		gl.uniform1i(uniform.uTexture, 0);
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.BLEND);
		gl.depthMask(false);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enableVertexAttribArray(attribute.aPosition);
		gl.enableVertexAttribArray(attribute.aTextureCoord);
	}

	/**
	 * Called after rendering all effects of this type
	 *
	 * @param {WebGLRenderingContext} gl
	 */
	static afterRender(gl) {
		gl.depthMask(true);
		gl.disableVertexAttribArray(_program.attribute.aPosition);
		gl.disableVertexAttribArray(_program.attribute.aTextureCoord);
	}

	/**
	 * Initialize the effect type
	 *
	 * @param {WebGLRenderingContext} gl
	 */
	static init(gl) {
		_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);
		_particleProgram = WebGL.createShaderProgram(gl, _particleVertexShader, _particleFragmentShader);
		this.ready = true;
	}

	/**
	 * Free resources for this effect type
	 *
	 * @param {WebGLRenderingContext} gl
	 */
	static free(gl) {
		_textureCache.forEach(cache => {
			cache.active = false;
			cache.textures.forEach(texture => {
				if (texture) {
					gl.deleteTexture(texture);
				}
			});
			cache.waiters.clear();
		});
		_textureCache.clear();

		if (_program) {
			gl.deleteProgram(_program);
		}
		if (_particleProgram) {
			gl.deleteProgram(_particleProgram);
		}
		_program = null;
		_particleProgram = null;
		this.ready = false;
		this.needInit = true;
	}
}
WaterfallEffect.renderBeforeEntities = false;
WaterfallEffect.needInit = true;

export default WaterfallEffect;
