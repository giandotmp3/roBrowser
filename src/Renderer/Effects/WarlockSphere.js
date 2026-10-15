import WebGL from 'Utils/WebGL.js';
import Texture from 'Utils/Texture.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';
import Camera from 'Renderer/Camera.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import Configs from 'Core/Configs.js';
import _vertexShader from './WarlockSphere.vs?raw';
import _fragmentShader from './WarlockSphere.fs?raw';

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

const _rotationMatrices = (function () {
	const matrices = [];
	for (let i = 0; i < 5; i++) {
		matrices.push({
			posMat: mat4.create(),
			texMat: mat4.create()
		});
	}
	return matrices;
})();

const _textureMatrix = mat4.create();

const WLS = {
	FIRE: 68, // WLS_FIRE
	WIND: 69, // WLS_WIND
	WATER: 70, // WLS_WATER
	STONE: 71 // WLS_STONE
};

const SphereFiles = [];
SphereFiles[WLS.FIRE] = 'fireorb.bmp';
SphereFiles[WLS.WIND] = 'lightningorb.bmp';
SphereFiles[WLS.WATER] = 'waterorb.bmp';
SphereFiles[WLS.STONE] = 'stoneorb.bmp';

/**
 * Additive blending of the sphere family (R-EFX-014).
 */
const SPHERE_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE' });

/**
 * Depth state the spheres draw under (SpriteRenderer.runWithDepth): depth test off,
 * depth write on, depth correction off.
 */
const SPHERE_DEPTH = Object.freeze({ test: false, write: true, correction: false });

/**
 * Vertex count of one sphere quad (2 triangles).
 */
const VERTEX_COUNT = 6;

/**
 * Size, base colour (alpha before the fade-in factor) and zIndex of each sphere layer,
 * by palette (`isCoin` is never set on a warlock sphere: always 'plain'). Sphere i > 10 draws 'outer', i > 5 'middle', otherwise 'core' then 'glow'.
 */
const SPHERE_LAYERS = Object.freeze({
	outer: { coin: [0.3, 1.0, 0.9, 0.4, 0.2], plain: [0.55, 0.0, 0.0, 1.0, 0.2], zIndex: 0.0 },
	middle: { coin: [0.2, 1.0, 0.9, 0.4, 0.4], plain: [0.35, 0.0, 0.0, 1.0, 0.6], zIndex: 0.01 },
	core: { coin: [0.1, 1.0, 0.9, 0.4, 0.6], plain: [0.25, 0.0, 0.0, 1.0, 1.0], zIndex: 0.02 },
	glow: { coin: [0.05, 1.0, 1.0, 0.7, 1.0], plain: [0.15, 0.8, 0.8, 1.0, 1.0], zIndex: 0.03 }
});

const LAYERS_OUTER = Object.freeze(['outer']);
const LAYERS_MIDDLE = Object.freeze(['middle']);
const LAYERS_INNER = Object.freeze(['core', 'glow']);

/**
 * Layers drawn for sphere i (counted down from the sphere count).
 *
 * @param {number} i
 * @returns {string[]} layer names
 */
function sphereLayers(i) {
	if (i > 10) {
		return LAYERS_OUTER;
	}
	if (i > 5) {
		return LAYERS_MIDDLE;
	}
	return LAYERS_INNER;
}

/**
 * Create an empty sphere draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * params:
 *  - index: sphere number i (counted down from the sphere list length; the sphere
 *    elements are not read, every sphere uses the spirit-sphere look)
 *  - slot: i % 5, the orbit slot whose rotation matrices are used
 *  - layer: 'outer' | 'middle' | 'core' | 'glow' ('glow' reuses the core's matrices)
 *  - size: uSize, zIndex: uZIndex, cameraZoom: uCameraZoom
 *  - rotation: orbit matrix (uRotationMat), textureRotation: billboard matrix (uTextureRotMat)
 *  - vertexCount
 *
 * @returns {object} record
 */
function createSphereDrawRecord() {
	return {
		kind: 'effect',
		family: 'warlock-sphere',
		pass: 'after',
		texture: null,
		position: null,
		color: [0, 0, 0, 0],
		blend: SPHERE_BLEND,
		depthTest: SPHERE_DEPTH.test,
		depthWrite: SPHERE_DEPTH.write,
		depthCorrection: SPHERE_DEPTH.correction,
		fog: false,
		strAttachment: false,
		params: {
			index: 0,
			slot: 0,
			layer: 'core',
			size: 0,
			zIndex: 0,
			cameraZoom: 1,
			rotation: null,
			textureRotation: null,
			vertexCount: VERTEX_COUNT
		}
	};
}

/**
 * Snapshot one sphere layer draw into a record.
 *
 * @param {object} record to fill
 * @param {WarlockSphere} effect
 * @param {number} i sphere number
 * @param {string} layer
 * @param {boolean} keep true when the record outlives the draw (position and matrices copied)
 * @returns {object} record
 */
function fillSphereDrawRecord(record, effect, i, layer, keep) {
	const params = record.params;
	const spec = SPHERE_LAYERS[layer];
	const values = effect.isCoin ? spec.coin : spec.plain;
	const matrices = _rotationMatrices[i % _rotationMatrices.length];

	record.pass = (effect.renderBeforeEntities ?? WarlockSphere.renderBeforeEntities) ? 'before' : 'after';
	record.texture = _texture;
	record.position = keep ? Array.from(effect.position) : effect.position;
	record.color[0] = values[1];
	record.color[1] = values[2];
	record.color[2] = values[3];
	record.color[3] = values[4] * effect.initialAlpha;

	params.index = i;
	params.slot = i % _rotationMatrices.length;
	params.layer = layer;
	params.size = values[0];
	params.zIndex = spec.zIndex;
	params.cameraZoom = Camera.zoom;
	params.rotation = keep ? mat4.clone(matrices.posMat) : matrices.posMat;
	params.textureRotation = keep ? mat4.clone(matrices.texMat) : matrices.texMat;

	return record;
}

/**
 * Per-instance GL state shared by its sphere draws (position, additive blend, zoom).
 *
 * @param {object} gl webgl context
 * @param {ArrayLike<number>} position owner position
 * @param {number} cameraZoom
 */
function beginSphereDraws(gl, position, cameraZoom) {
	const uniform = _program.uniform;

	gl.uniform3fv(uniform.uPosition, position);

	gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);

	gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

	gl.uniform1f(uniform.uCameraZoom, cameraZoom);
}

/**
 * Send one sphere layer record to the GPU and draw it. A 'glow' layer follows its
 * sphere's 'core' layer and keeps the matrices the core uploaded.
 *
 * @param {object} gl webgl context
 * @param {object} record sphere draw record
 */
function drawSphereRecord(gl, record) {
	const uniform = _program.uniform;
	const params = record.params;

	if (params.layer !== 'glow') {
		gl.uniformMatrix4fv(uniform.uTextureRotMat, false, params.textureRotation);
		gl.uniformMatrix4fv(uniform.uRotationMat, false, params.rotation);
	}

	gl.uniform1f(uniform.uSize, params.size);
	gl.uniform4fv(uniform.uColor, record.color);
	gl.uniform1f(uniform.uZIndex, params.zIndex);
	gl.drawArrays(gl.TRIANGLES, 0, params.vertexCount);
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createSphereDrawRecord();

class WarlockSphere {
	constructor(entity, spheres) {
		this.position = entity.position;
		this.spheres = spheres ? spheres : [];

		this.initialAlpha = 0;
	}

	init(gl) {
		this.ready = true;
	}

	free(gl) {
		this.ready = false;
	}

	static init(gl) {
		_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);
		_buffer = gl.createBuffer();

		gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([
				-1.0, -1.0, 0.0, 0.0, +1.0, -1.0, 1.0, 0.0, +1.0, +1.0, 1.0, 1.0, +1.0, +1.0, 1.0, 1.0, -1.0, +1.0, 0.0,
				1.0, -1.0, -1.0, 0.0, 0.0
			]),
			gl.STATIC_DRAW
		);

		Client.loadFile('data/texture/effect/thunder_center.bmp', buffer => {
			Texture.load(buffer, function () {
				const enableMipmap = Configs.get('enableMipmap');
				const ctx = this.getContext('2d');
				ctx.save();
				ctx.translate(this.width / 2, this.height / 2);
				// ctx.rotate( 45 / 180 * Math.PI);
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

				WarlockSphere.ready = true;
			});
		});
	}

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

	static beforeRender(gl, modelView, projection, fog, tick) {
		const uniform = _program.uniform;
		const attribute = _program.attribute;
		gl.useProgram(_program);

		let _matrix, offset;
		for (let i = 0, _len = _rotationMatrices.length; i < _len; i++) {
			const vcRad = ((Camera.angle[0] - 90) * Math.PI) / 180;
			const hcRad = (Camera.angle[1] * Math.PI) / 180;
			offset = (i * 2 * Math.PI) / _rotationMatrices.length;
			const rotRad = offset - (tick / 64 / 180) * Math.PI;

			//_matrix = _rotationMatrices[i].texMat;
			//mat4.identity(_matrix);
			const textureMatrix = mat4.create();
			mat4.rotateX(_rotationMatrices[i].texMat, textureMatrix, vcRad);
			mat4.rotateY(_rotationMatrices[i].texMat, _rotationMatrices[i].texMat, hcRad - rotRad);

			_matrix = _rotationMatrices[i].posMat;
			mat4.identity(_matrix);
			mat4.rotateY(_matrix, _matrix, rotRad);
		}

		// Bind matrix
		gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
		gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection);

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

	render(gl, tick) {
		const observed = _recordSinks.size > 0;

		beginSphereDraws(gl, this.position, Camera.zoom);

		SpriteRenderer.runWithDepth(SPHERE_DEPTH.test, SPHERE_DEPTH.write, SPHERE_DEPTH.correction, () => {
			for (let i = this.spheres.length; i > 0; i--) {
				for (const layer of sphereLayers(i)) {
					// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
					const record = fillSphereDrawRecord(
						observed ? createSphereDrawRecord() : _scratchRecord,
						this,
						i,
						layer,
						observed
					);
					_recordSinks.forEach(sink => sink(record));
					drawSphereRecord(gl, record);
				}
			}
		});

		if (this.initialAlpha < 1) {
			this.initialAlpha = Math.min(this.initialAlpha + 0.005, 1);
		}
	}

	/**
	 * Observe every sphere draw as a backend-neutral record. Each observed draw gets a
	 * fresh record object, so sinks may keep it.
	 *
	 * @param {function} sink called with each draw record
	 * @returns {function} unsubscribe
	 */
	static addRecordSink(sink) {
		_recordSinks.add(sink);
		return () => _recordSinks.delete(sink);
	}

	static afterRender(gl) {
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.disableVertexAttribArray(_program.attribute.aPosition);
		gl.disableVertexAttribArray(_program.attribute.aTextureCoord);
	}
}

WarlockSphere.renderBeforeEntities = false;
/**
 * Export
 */
export default WarlockSphere;
