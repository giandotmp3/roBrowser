/**
 * Renderer/Effects/PropertyGround.js
 *
 * Generate cone and PropertyGround
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */

import WebGL from 'Utils/WebGL.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';
import _vertexShader from './PropertyGround.vs?raw';
import _fragmentShader from './PropertyGround.fs?raw';

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

const _rotationMatrices = (function () {
	const matrices = [];
	for (let i = 0; i < 16; i++) {
		matrices.push(mat4.create());
	}
	return matrices;
})();

/**
 * @var {number}
 */
let _verticeCount = 0;

/**
 * Generate a generic PropertyGround
 *
 * @returns {Float32Array} buffer array
 */
function generatePropertyGround() {
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
const GROUND_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });

/**
 * @var {boolean} scene fog state uploaded by the last beforeRender
 */
let _fogUse = false;

/**
 * Create an empty PropertyGround draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * The effect sets no blend function (normal alpha) and no depth state (the
 * after-entities pass state: depth test and write on). Its shader forces alpha 0.42.
 *
 * params:
 *  - sizeMult: max(0.5, sin(tick / 360π + sizeRandomize))
 *  - topSize, bottomSize: uTopSize / uBottomSize (already multiplied by sizeMult), height: uHeight
 *  - slot: rotation slot (spawn number % 16), rotation: its uRotationMat
 *  - vertexCount
 *
 * @returns {object} record
 */
function createPropertyGroundDrawRecord() {
	return {
		kind: 'effect',
		family: 'property-ground',
		pass: 'after',
		texture: null,
		position: null,
		color: [1, 1, 1, 0.42],
		blend: GROUND_BLEND,
		depthTest: true,
		depthWrite: true,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			sizeMult: 1,
			topSize: 0,
			bottomSize: 0,
			height: 0,
			slot: 0,
			rotation: null,
			vertexCount: 0
		}
	};
}

/**
 * Snapshot one PropertyGround draw into a record.
 *
 * @param {object} record to fill
 * @param {PropertyGround} effect
 * @param {number} tick game tick
 * @param {boolean} keep true when the record outlives the draw (position and matrix copied)
 * @returns {object} record
 */
function fillPropertyGroundDrawRecord(record, effect, tick, keep) {
	const params = record.params;
	let sizeMult = Math.sin(tick / (360 * Math.PI) + effect.sizeRandomize);
	if (sizeMult < 0.5) {
		sizeMult = 0.5;
	}

	record.pass = (effect.renderBeforeEntities ?? PropertyGround.renderBeforeEntities) ? 'before' : 'after';
	record.texture = effect.texture;
	record.position = keep ? Array.from(effect.position) : effect.position;
	record.fog = _fogUse;

	params.sizeMult = sizeMult;
	params.topSize = effect.topSize * sizeMult;
	params.bottomSize = effect.bottomSize * sizeMult;
	params.height = effect.height;
	params.slot = effect.ix;
	params.rotation = keep ? mat4.clone(_rotationMatrices[effect.ix]) : _rotationMatrices[effect.ix];
	params.vertexCount = _verticeCount;

	return record;
}

/**
 * Send one PropertyGround record to the GPU and draw it.
 *
 * @param {object} gl webgl context
 * @param {object} record PropertyGround draw record
 */
function drawPropertyGroundRecord(gl, record) {
	const uniform = _program.uniform;
	const attribute = _program.attribute;
	const params = record.params;

	gl.uniformMatrix4fv(uniform.uRotationMat, false, params.rotation);

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
const _scratchRecord = createPropertyGroundDrawRecord();

/**
 * PropertyGround constructor
 *
 * @param {Array} position
 * @param {number} top size of the PropertyGround
 * @param {number} bottom size of the PropertyGround
 * @param {number} height of the PropertyGround
 * @param {string} texture name
 * @param {number} game tick
 */
let _num = 0;
class PropertyGround {
	constructor(position, topSize, bottomSize, height, textureName, tick) {
		this.position = position;
		this.topSize = topSize;
		this.bottomSize = bottomSize;
		this.textureName = textureName;
		this.height = height;
		this.tick = tick;
		this.sizeRandomize = 0 + Math.random() * 10;
		this.ix = _num++ % _rotationMatrices.length;
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
		const record = fillPropertyGroundDrawRecord(
			observed ? createPropertyGroundDrawRecord() : _scratchRecord,
			this,
			tick,
			observed
		);
		_recordSinks.forEach(sink => sink(record));
		drawPropertyGroundRecord(gl, record);
	}

	/**
	 * Observe every PropertyGround draw as a backend-neutral record. Each observed draw
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
		const vertices = generatePropertyGround();
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

		let _matrix, offset;
		for (let i = 0, _len = _rotationMatrices.length; i < _len; i++) {
			_matrix = _rotationMatrices[i];
			mat4.identity(_matrix);
			offset = (i * 2 * Math.PI) / _rotationMatrices.length;
			mat4.rotateY(_matrix, _matrix, offset + (tick / 8 / 180) * Math.PI);
		}

		gl.useProgram(_program);

		// Bind matrix
		gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
		gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection);

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
export default PropertyGround;
