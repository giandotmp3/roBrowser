import WebGL from 'Utils/WebGL.js';
import Texture from 'Utils/Texture.js';
import Client from 'Core/Client.js';
import Configs from 'Core/Configs.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import _vertexShader from './Tiles.vs?raw';
import _fragmentShader from './Tiles.fs?raw';

export function loadTexture(gl, texture, cb) {
	const _texture = gl.createTexture();

	Client.loadFile(texture.filename, function (buffer) {
		Texture.load(buffer, function (canvas) {
			const enableMipmap = Configs.get('enableMipmap');
			const size = texture.size;
			canvas = document.createElement('canvas');
			canvas.width = canvas.height = size;
			const ctx = canvas.getContext('2d');
			ctx.save();
			ctx.translate(canvas.width / 2, canvas.height / 2);
			ctx.rotate(Math.PI);
			ctx.translate(-canvas.width / 2, -canvas.height / 2);
			ctx.drawImage(this, 0, 0, size, size);
			ctx.restore();
			gl.bindTexture(gl.TEXTURE_2D, _texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			if (enableMipmap) {
				gl.generateMipmap(gl.TEXTURE_2D);
			}
			cb(_texture);
		});
	});
}

/**
 * Normal alpha blending: tiles set no blend function and draw with the pass default.
 */
const TILE_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });

/**
 * Vertex count of one tile quad (2 triangles).
 */
const TILE_VERTEX_COUNT = 6;

/**
 * @var {boolean} scene fog state uploaded by the last tile beforeRender
 */
let _fogUse = false;

/**
 * @var {Set<function>} record observers (FlatTexture and HoveringTexture draws)
 */
const _recordSinks = new Set();

/**
 * Create an empty tile draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * family 'flat-texture' (FlatTexture.render: depth test, write and correction off) or
 * 'hovering-texture' (sets no depth state: the before-entities pass state, depth test
 * and write on). Tiles set no blend function (normal alpha).
 *
 * params:
 *  - size: uSize (FlatTexture.render never uploads it: 0 on its program)
 *  - textureSize: the square canvas the texture is resampled into (rotated 180°)
 *  - vertexCount
 *
 * color: rgb 1, alpha = the `alpha` uniform (never uploaded by FlatTexture.render: 0)
 *
 * @param {string} family
 * @returns {object} record
 */
function createTileDrawRecord(family) {
	const flat = family === 'flat-texture';
	return {
		kind: 'effect',
		family,
		pass: 'before',
		texture: null,
		position: null,
		color: [1, 1, 1, flat ? 0 : 1],
		blend: TILE_BLEND,
		depthTest: !flat,
		depthWrite: !flat,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			size: 0,
			textureSize: 64,
			vertexCount: TILE_VERTEX_COUNT
		}
	};
}

/**
 * Fill the fields every tile record shares.
 *
 * @param {object} record to fill
 * @param {object} effect tile instance
 * @param {Array} position drawn position
 * @param {boolean} keep true when the record outlives the draw (position copied)
 * @returns {object} record
 */
function fillTileDrawRecord(record, effect, position, keep) {
	const Ctor = effect.constructor;
	record.pass = (effect.renderBeforeEntities ?? Ctor.renderBeforeEntities) ? 'before' : 'after';
	record.texture = Ctor._texture;
	record.position = keep ? Array.from(position) : position;
	record.fog = _fogUse;
	record.params.textureSize = Ctor.textureSize;
	return record;
}

/**
 * @var {object} reused records when nobody observes (no per-draw allocation)
 */
const _scratchFlatRecord = createTileDrawRecord('flat-texture');
const _scratchHoverRecord = createTileDrawRecord('hovering-texture');

/**
 * Send one FlatTexture record to the GPU and draw it (depth state from the record).
 *
 * @param {object} gl webgl context
 * @param {object} record flat-texture draw record
 * @param {object} program the class program
 * @param {WebGLBuffer} buffer the class quad
 */
function drawFlatTileRecord(gl, record, program, buffer) {
	gl.uniform3fv(program.uniform.uPosition, record.position);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

	SpriteRenderer.runWithDepth(record.depthTest, record.depthWrite, record.depthCorrection, function () {
		gl.drawArrays(gl.TRIANGLES, 0, record.params.vertexCount);
	});
}

/**
 * Send one HoveringTexture record to the GPU and draw it.
 *
 * @param {object} gl webgl context
 * @param {object} record hovering-texture draw record
 * @param {object} program the class program
 * @param {WebGLBuffer} buffer the class quad
 */
function drawHoverTileRecord(gl, record, program, buffer) {
	gl.uniform3fv(program.uniform.uPosition, record.position);
	gl.uniform1f(program.uniform.uSize, record.params.size);
	gl.uniform1f(program.uniform.alpha, record.color[3]);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.drawArrays(gl.TRIANGLES, 0, record.params.vertexCount);
}

/**
 * Observe every FlatTexture / HoveringTexture draw as a backend-neutral record. Each
 * observed draw gets a fresh record object, so sinks may keep it.
 *
 * @param {function} sink called with each draw record
 * @returns {function} unsubscribe
 */
export function addRecordSink(sink) {
	_recordSinks.add(sink);
	return () => _recordSinks.delete(sink);
}

export const FlatTexture = (textureFilename, size = 64) =>
	class {
		static get renderBeforeEntities() {
			return true;
		}

		static get textureSize() {
			return size;
		}

		static addRecordSink(sink) {
			return addRecordSink(sink);
		}

		static createShaderProgram(gl) {
			return WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);
		}

		static init(gl) {
			this._program = this.createShaderProgram(gl);
			this._buffer = gl.createBuffer();
			this._texture = null;
			gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				new Float32Array([
					-1.0, -1.0, 0.0, 0.0, +1.0, -1.0, 1.0, 0.0, +1.0, +1.0, 1.0, 1.0, +1.0, +1.0, 1.0, 1.0, -1.0, +1.0,
					0.0, 1.0, -1.0, -1.0, 0.0, 0.0
				]),
				gl.STATIC_DRAW
			);
			loadTexture(
				gl,
				{
					filename: textureFilename,
					size
				},
				texture => {
					this._texture = texture;
					this.ready = true;
				}
			);
		}

		static free(gl) {
			if (this._texture) {
				gl.deleteTexture(this._texture);
				this._texture = null;
			}

			if (this._program) {
				gl.deleteProgram(this._program);
				this._program = null;
			}

			if (this._buffer) {
				gl.deleteBuffer(this._buffer);
				this._buffer = null;
			}

			this.ready = false;
		}

		static beforeRender(gl, modelView, projection, fog, tick) {
			const uniform = this._program.uniform;
			const attribute = this._program.attribute;
			gl.useProgram(this._program); // Bind matrix

			gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
			gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection); // Texture

			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this._texture);
			gl.uniform1i(uniform.uDiffuse, 0); // Enable all attributes

			gl.uniform1i(uniform.uFogUse, fog.use && fog.exist);
			_fogUse = !!(fog.use && fog.exist);
			gl.uniform1f(uniform.uFogNear, fog.near);
			gl.uniform1f(uniform.uFogFar, fog.far);
			gl.uniform3fv(uniform.uFogColor, fog.color);

			gl.enableVertexAttribArray(attribute.aPosition);
			gl.enableVertexAttribArray(attribute.aTextureCoord);
			gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
			gl.vertexAttribPointer(attribute.aPosition, 2, gl.FLOAT, false, 4 * 4, 0);
			gl.vertexAttribPointer(attribute.aTextureCoord, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
		}

		static afterRender(gl) {
			gl.disableVertexAttribArray(this._program.attribute.aPosition);
			gl.disableVertexAttribArray(this._program.attribute.aTextureCoord);
		}

		constructor(pos, startTick) {
			this.position = pos;
		}

		init() {
			this.ready = true;
		}

		free() {
			this.ready = false;
		}

		render(gl, tick) {
			// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
			const observed = _recordSinks.size > 0;
			const record = fillTileDrawRecord(
				observed ? createTileDrawRecord('flat-texture') : _scratchFlatRecord,
				this,
				this.position,
				observed
			);
			_recordSinks.forEach(sink => sink(record));
			drawFlatTileRecord(gl, record, this.constructor._program, this.constructor._buffer);
		}
	};

let _hoveringNum = 0;

export const HoveringTexture = (textureFilename, effectSize = 1, alpha = 1) =>
	class extends FlatTexture(textureFilename) {
		constructor() {
			super(...arguments);
			this.ix = ++_hoveringNum;
			this.effectSize = effectSize;
			this.alpha = alpha;
		}

		render(gl, tick) {
			const oddEven = this.ix % 2 === 0 ? Math.PI : 0;
			const heightMult = Math.sin(oddEven + tick / (540 * Math.PI));
			const position = [this.position[0], this.position[1], this.position[2] + 0.4 - 0.2 * heightMult];
			const observed = _recordSinks.size > 0;
			const record = fillTileDrawRecord(
				observed ? createTileDrawRecord('hovering-texture') : _scratchHoverRecord,
				this,
				position,
				false
			);
			record.color[3] = this.alpha;
			record.params.size = this.effectSize;
			_recordSinks.forEach(sink => sink(record));
			drawHoverTileRecord(gl, record, this.constructor._program, this.constructor._buffer);
		}
	};
