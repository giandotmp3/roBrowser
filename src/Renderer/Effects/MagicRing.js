/**
 * Renderer/Effects/MagicRing.js
 *
 * Generate a Magic Ring under caster
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */

import WebGL from 'Utils/WebGL.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';
import _vertexShader from './MagicRing.vs?raw';
import _fragmentShader from './MagicRing.fs?raw';

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
 * @var {number}
 */
let _verticeCount = 0;

/**
 * Generate a generic MagicRing
 *
 * @returns {Float32Array} buffer array
 */
function generateMagicRing() {
	let i, a, b;
	const total = 20;
	const bottom = [];
	const top = [];
	const mesh = [];

	for (i = 0; i <= total; i++) {
		a = (i + 0.0) / total;
		b = (i + 0.5) / total;

		bottom[i] = [Math.sin(a * Math.PI * 2), Math.cos(a * Math.PI * 2), 0, a, 1];
		top[i] = [Math.sin(b * Math.PI * 2), Math.cos(b * Math.PI * 2), 1, b, 0];
	}

	for (i = 0; i <= total; i++) {
		mesh.push.apply(mesh, bottom[i + 0]);
		mesh.push.apply(mesh, top[i + 0]);
		mesh.push.apply(mesh, bottom[i + 1]);

		mesh.push.apply(mesh, top[i + 0]);
		mesh.push.apply(mesh, bottom[i + 1]);
		mesh.push.apply(mesh, top[i + 1]);
	}

	return new Float32Array(mesh);
}

/**
 * Normal alpha blending: the effect sets no blend function and draws with the pass default.
 */
const RING_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });

/**
 * @var {boolean} scene fog state uploaded by the last beforeRender
 */
let _fogUse = false;

/**
 * Create an empty MagicRing draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * The ring sets no blend function (normal alpha) and no depth state (the after-entities
 * pass state: depth test and write on). Its shader forces alpha 0.7.
 *
 * params:
 *  - topSize, bottomSize, height: uTopSize / uBottomSize / uHeight
 *  - rotation: the frame's uRotationMat (uploaded once per frame by beforeRender)
 *  - vertexCount
 *
 * @returns {object} record
 */
function createMagicRingDrawRecord() {
	return {
		kind: 'effect',
		family: 'magic-ring',
		pass: 'after',
		texture: null,
		position: null,
		color: [1, 1, 1, 0.7],
		blend: RING_BLEND,
		depthTest: true,
		depthWrite: true,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			topSize: 0,
			bottomSize: 0,
			height: 0,
			rotation: null,
			vertexCount: 0
		}
	};
}

/**
 * Snapshot one MagicRing draw into a record.
 *
 * @param {object} record to fill
 * @param {MagicRing} effect
 * @param {boolean} keep true when the record outlives the draw (position and matrix copied)
 * @returns {object} record
 */
function fillMagicRingDrawRecord(record, effect, keep) {
	const params = record.params;

	record.pass = (effect.renderBeforeEntities ?? MagicRing.renderBeforeEntities) ? 'before' : 'after';
	record.texture = effect.texture;
	record.position = keep ? Array.from(effect.target.position) : effect.target.position;
	record.fog = _fogUse;

	params.topSize = effect.topSize;
	params.bottomSize = effect.bottomSize;
	params.height = effect.height;
	params.rotation = keep ? mat4.clone(_matrix) : _matrix;
	params.vertexCount = _verticeCount;

	return record;
}

/**
 * Send one MagicRing record to the GPU and draw it.
 *
 * @param {object} gl webgl context
 * @param {object} record MagicRing draw record
 */
function drawMagicRingRecord(gl, record) {
	const uniform = _program.uniform;
	const attribute = _program.attribute;
	const params = record.params;

	gl.bindTexture(gl.TEXTURE_2D, record.texture);

	// Enable all attributes
	gl.enableVertexAttribArray(attribute.aPosition);
	gl.enableVertexAttribArray(attribute.aTextureCoord);

	gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);

	gl.vertexAttribPointer(attribute.aPosition, 3, gl.FLOAT, false, 4 * 5, 0);
	gl.vertexAttribPointer(attribute.aTextureCoord, 2, gl.FLOAT, false, 4 * 5, 3 * 4);

	gl.uniform3fv(uniform.uPosition, record.position);
	gl.uniform1f(uniform.uBottomSize, params.bottomSize);
	gl.uniform1f(uniform.uTopSize, params.topSize);
	gl.uniform1f(uniform.uHeight, params.height);

	gl.drawArrays(gl.TRIANGLES, 0, params.vertexCount);
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createMagicRingDrawRecord();

/**
 * MagicRing constructor
 *
 * @param {Array} position
 * @param {number} top size of the MagicRing
 * @param {number} bottom size of the MagicRing
 * @param {number} height of the MagicRing
 * @param {string} texture name
 * @param {number} game tick
 */
class MagicRing {
	constructor(target, topSize, bottomSize, height, textureName, endTick) {
		this.target = target;
		this.topSize = topSize;
		this.bottomSize = bottomSize;
		this.textureName = textureName;
		this.height = height;
		this.endTick = endTick;
	}

	/**
	 * Preparing for render
	 *
	 * @param {object} webgl context
	 */
	init(gl) {
		Client.loadFile(`data/texture/effect/${this.textureName}.tga`, buffer => {
			WebGL.texture(gl, buffer, texture => {
				this.texture = texture;
				this.ready = true;
			});
		});
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
		const record = fillMagicRingDrawRecord(observed ? createMagicRingDrawRecord() : _scratchRecord, this, observed);
		_recordSinks.forEach(sink => sink(record));
		drawMagicRingRecord(gl, record);

		this.needCleanUp = this.endTick < tick;
		if (!this.target.cast.display) {
			this.needCleanUp = true;
		}
	}

	/**
	 * Observe every MagicRing draw as a backend-neutral record. Each observed draw gets a
	 * fresh record object, so sinks may keep it.
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
		const vertices = generateMagicRing();
		_verticeCount = vertices.length / 5;

		_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);
		_buffer = gl.createBuffer();
		this.ready = true;
		this.renderBeforeEntities = false;

		gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
	}

	/**
	 * Destroy objects
	 *
	 * @param {object} webgl context
	 */
	static free(gl) {
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
		gl.uniform1i(uniform.uDiffuse, 0);
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
 * Export
 */
export default MagicRing;
