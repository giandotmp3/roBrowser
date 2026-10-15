/**
 * Renderer/Effects/LockOnTarget.js
 *
 * Rendering casting on ground (rotating plane)
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */

import WebGL from 'Utils/WebGL.js';
import Texture from 'Utils/Texture.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';
import Configs from 'Core/Configs.js';
import _vertexShader from './LockOnTarget.vs?raw';
import _fragmentShader from './LockOnTarget.fs?raw';

// Load dependencies
/**
 * @var {WebGLTexture}
 */
let _texture;

/**
 * @var {WebGLProgram}
 */
let _program;

/**
 * @var {WebGLBuffer}
 */
let _buffer;

/**
 * @var {mat4}
 */
const mat4 = glMatrix.mat4;

/**
 * @var {mat4} rotation matrix
 */
const _matrix = mat4.create();

/**
 * Normal alpha blending: the marker sets no blend function and draws with the pass default.
 */
const LOCK_ON_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });

/**
 * Vertex count of the marker quad (2 triangles).
 */
const VERTEX_COUNT = 6;

/**
 * @var {boolean} scene fog state uploaded by the last beforeRender
 */
let _fogUse = false;

/**
 * Create an empty LockOnTarget draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * The marker sets no blend function (normal alpha) and no depth state (the
 * before-entities pass state: depth test and write on). The texture is pre-rotated 45°.
 *
 * color: [1, shade, shade, 1] (the shader multiplies green and blue by uColor = shade)
 *
 * params:
 *  - shade: uColor, (20 − floor(elapsed / 20) % 20) / 20 (a red blink every 400 ms)
 *  - size: uSize, (6 − clamp(elapsed / 50, 1, 5)) · 3 (shrinks from 15 to 3 over 250 ms)
 *  - rotation: the frame's uRotationMat (uploaded once per frame by beforeRender)
 *  - vertexCount
 *
 * @returns {object} record
 */
function createLockOnDrawRecord() {
	return {
		kind: 'effect',
		family: 'lock-on',
		pass: 'before',
		texture: null,
		position: null,
		color: [1, 1, 1, 1],
		blend: LOCK_ON_BLEND,
		depthTest: true,
		depthWrite: true,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			shade: 1,
			size: 0,
			rotation: null,
			vertexCount: VERTEX_COUNT
		}
	};
}

/**
 * Snapshot one LockOnTarget draw into a record.
 *
 * @param {object} record to fill
 * @param {LockOnTarget} effect
 * @param {number} tick game tick
 * @param {boolean} keep true when the record outlives the draw (position and matrix copied)
 * @returns {object} record
 */
function fillLockOnDrawRecord(record, effect, tick, keep) {
	const params = record.params;
	let time = tick - effect.startTick;
	let color = 20 - (Math.floor(time / 20) % 20);
	color /= 20;

	// Animation
	time /= 50;
	time = Math.max(time, 1);
	time = Math.min(time, 5);

	record.pass = (effect.renderBeforeEntities ?? LockOnTarget.renderBeforeEntities) ? 'before' : 'after';
	record.texture = _texture;
	record.position = keep ? Array.from(effect.target.position) : effect.target.position;
	record.color[1] = color;
	record.color[2] = color;
	record.fog = _fogUse;

	params.shade = color;
	params.size = (6 - time) * 3;
	params.rotation = keep ? mat4.clone(_matrix) : _matrix;

	return record;
}

/**
 * Send one LockOnTarget record to the GPU and draw it.
 *
 * @param {object} gl webgl context
 * @param {object} record LockOnTarget draw record
 */
function drawLockOnRecord(gl, record) {
	gl.uniform3fv(_program.uniform.uPosition, record.position);
	gl.uniform1f(_program.uniform.uSize, record.params.size);
	gl.uniform1f(_program.uniform.uColor, record.params.shade);

	gl.drawArrays(gl.TRIANGLES, 0, record.params.vertexCount);
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createLockOnDrawRecord();

/**
 * LockOnTarget constructor
 *
 * @param {Entity} target entity
 * @param {number} tick to remove it
 */
class LockOnTarget {
	constructor(target, startTick, endTick) {
		this.target = target;
		this.startTick = startTick;
		this.endTick = endTick;
	}

	/**
	 * Preparing for render
	 *
	 * @param {object} webgl context
	 */
	init(gl) {
		this.ready = true;
	}

	/**
	 * Destroying data
	 *
	 * @param {object} webgl context
	 */
	free(gl) {
		this.ready = false;
	}

	/**
	 * Rendering cast
	 *
	 * @param {object} wegl context
	 */
	render(gl, tick) {
		// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
		const observed = _recordSinks.size > 0;
		const record = fillLockOnDrawRecord(observed ? createLockOnDrawRecord() : _scratchRecord, this, tick, observed);
		_recordSinks.forEach(sink => sink(record));
		drawLockOnRecord(gl, record);

		this.needCleanUp = this.endTick < tick;
	}

	/**
	 * Observe every LockOnTarget draw as a backend-neutral record. Each observed draw
	 * gets a fresh record object, so sinks may keep it.
	 *
	 * @param {function} sink called with each draw record
	 * @returns {function} unsubscribe
	 */
	static addRecordSink(sink) {
		_recordSinks.add(sink);
		return () => _recordSinks.delete(sink);
	}

	/**
	 * Initialize effect
	 *
	 * @param {object} webgl context
	 */
	static init(gl) {
		_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);
		_buffer = gl.createBuffer();

		gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([
				-0.5, -0.5, 0.0, 0.0, +0.5, -0.5, 1.0, 0.0, +0.5, +0.5, 1.0, 1.0, +0.5, +0.5, 1.0, 1.0, -0.5, +0.5, 0.0,
				1.0, -0.5, -0.5, 0.0, 0.0
			]),
			gl.STATIC_DRAW
		);

		Client.loadFile('data/texture/effect/lockon128.tga', buffer => {
			Texture.load(buffer, function () {
				const enableMipmap = Configs.get('enableMipmap');
				const ctx = this.getContext('2d');
				ctx.save();
				ctx.translate(this.width / 2, this.height / 2);
				ctx.rotate((45 / 180) * Math.PI);
				ctx.translate(-this.width / 2, -this.height / 2);
				ctx.drawImage(this, 0, 0);
				ctx.restore();

				_texture = gl.createTexture();
				gl.bindTexture(gl.TEXTURE_2D, _texture);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				if (enableMipmap) {
					gl.generateMipmap(gl.TEXTURE_2D);
				}

				LockOnTarget.ready = true;
			});
		});
	}

	/**
	 * Destroy objects
	 *
	 * @param {object} webgl context
	 */
	static free(gl) {
		if (_texture) {
			gl.deleteTexture(_texture);
			_texture = null;
		}

		if (_program) {
			gl.deleteProgram(_program);
			_program = null;
		}

		if (_buffer) {
			gl.deleteBuffer(_buffer);
		}

		this.ready = false;
	}

	/**
	 * Before render, set up program
	 *
	 * @param {object} webgl context
	 */
	static beforeRender(gl, modelView, projection, fog, tick) {
		const uniform = _program.uniform;
		const attribute = _program.attribute;

		mat4.identity(_matrix);
		mat4.rotateY(_matrix, _matrix, (tick / 4 / 180) * Math.PI);

		gl.useProgram(_program);

		// Bind matrix
		gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
		gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection);
		gl.uniformMatrix4fv(uniform.uRotationMat, false, _matrix);

		// Fog settings
		gl.uniform1i(uniform.uFogUse, fog.use && fog.exist);
		_fogUse = !!(fog.use && fog.exist);
		gl.uniform1f(uniform.uFogNear, fog.near);
		gl.uniform1f(uniform.uFogFar, fog.far);
		gl.uniform3fv(uniform.uFogColor, fog.color);

		// Texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, _texture);
		gl.uniform1i(uniform.uDiffuse, 0);

		// Enable all attributes
		gl.enableVertexAttribArray(attribute.aPosition);
		gl.enableVertexAttribArray(attribute.aTextureCoord);

		gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);

		gl.vertexAttribPointer(attribute.aPosition, 2, gl.FLOAT, false, 4 * 4, 0);
		gl.vertexAttribPointer(attribute.aTextureCoord, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
	}

	/**
	 * After render, clean attributes
	 *
	 * @param {object} webgl context
	 */
	static afterRender(gl) {
		gl.disableVertexAttribArray(_program.attribute.aPosition);
		gl.disableVertexAttribArray(_program.attribute.aTextureCoord);
	}
}

/**
 * @var {boolean} should we render it before entities ?
 */
LockOnTarget.renderBeforeEntities = true;

/**
 * Export
 */
export default LockOnTarget;
