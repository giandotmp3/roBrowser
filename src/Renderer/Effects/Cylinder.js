/**
 * Renderer/Effects/Cylinder.js
 *
 * Generate cone/cylinder/circle
 *
 * @author Vincent Thibault
 */

import WebGL from 'Utils/WebGL.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';
import Camera from 'Renderer/Camera.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import _vertexShader from './Cylinder.vs?raw';
import _fragmentShader from './Cylinder.fs?raw';

/**
 * @var {WebGLProgram}
 */
let _program;

const blendMode = {};

/**
 * @var {mat4}
 */
const mat4 = glMatrix.mat4;

/**
 * Backend-neutral factor names of the GL-order blendMode table (same order as blendMode).
 */
const BLEND_FACTOR = Object.freeze({
	1: 'ZERO',
	2: 'ONE',
	3: 'SRC_COLOR',
	4: 'ONE_MINUS_SRC_COLOR',
	5: 'DST_COLOR',
	6: 'ONE_MINUS_DST_COLOR',
	7: 'SRC_ALPHA',
	8: 'ONE_MINUS_SRC_ALPHA',
	9: 'DST_ALPHA',
	10: 'ONE_MINUS_DST_ALPHA',
	11: 'CONSTANT_COLOR',
	12: 'ONE_MINUS_CONSTANT_COLOR',
	13: 'CONSTANT_ALPHA',
	14: 'ONE_MINUS_CONSTANT_ALPHA',
	15: 'SRC_ALPHA_SATURATE'
});

/**
 * Normal alpha blending (blendMode 0, unset or out of range).
 */
const BLEND_NORMAL = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });

/**
 * @var {object} cached blend states by blendMode (allocation-free per draw)
 */
const _blendStates = {};

/**
 * Unified blend state of a blendMode (source is always SRC_ALPHA), or null for an
 * in-range code missing from the table (the GL call then receives undefined).
 *
 * @param {number} mode effect blendMode
 * @returns {object|null} { src, dst } factor names
 */
function cylinderBlendState(mode) {
	if (!(mode > 0 && mode < 16)) {
		return BLEND_NORMAL;
	}
	if (!(mode in _blendStates)) {
		_blendStates[mode] = mode in BLEND_FACTOR ? Object.freeze({ src: 'SRC_ALPHA', dst: BLEND_FACTOR[mode] }) : null;
	}
	return _blendStates[mode];
}

/**
 * @var {boolean} scene fog state uploaded by the last beforeRender
 */
let _fogUse = false;

/**
 * Animation mode of an effect (legacy loose comparison: '1' == 1), 0 when none.
 *
 * @param {*} animation effect animation
 * @returns {number} 0..5
 */
function animationMode(animation) {
	for (let mode = 1; mode <= 5; mode++) {
		if (animation == mode) {
			return mode;
		}
	}
	return 0;
}

/**
 * Create an empty cylinder draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * params:
 *  - topSize, bottomSize, height: animated shape (uTopSize, uBottomSize, uHeight)
 *  - baseTopSize, baseBottomSize, baseHeight: EffectTable shape before animation
 *  - animation (0..5), elapsed (tick - startTick), duration (endTick - startTick)
 *  - zIndex: clip-space z bias
 *  - rotate, rotation: whether the rotation matrix applies, and the matrix
 *  - totalCircleSides, circleSides, repeatTextureX: mesh key; vertexCount
 *  - textureRepeat: texture wrap S set to REPEAT (repeatTextureX > 1)
 *  - blendMode: raw GL-order code
 *
 * @returns {object} record
 */
function createCylinderDrawRecord() {
	return {
		kind: 'effect',
		family: 'cylinder',
		pass: 'after',
		texture: null,
		position: [0, 0, 0],
		color: new Float32Array(4),
		blend: BLEND_NORMAL,
		depthTest: true,
		depthWrite: false,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			topSize: 0,
			bottomSize: 0,
			height: 0,
			baseTopSize: 0,
			baseBottomSize: 0,
			baseHeight: 0,
			animation: 0,
			elapsed: 0,
			duration: 0,
			zIndex: 0,
			rotate: false,
			rotation: mat4.create(),
			totalCircleSides: 0,
			circleSides: 0,
			repeatTextureX: 1,
			vertexCount: 0,
			textureRepeat: false,
			blendMode: 0
		}
	};
}

/**
 * Snapshot one cylinder draw into a record. Updates the effect's alpha like the
 * legacy render did.
 *
 * @param {object} record to fill
 * @param {Cylinder} effect
 * @param {number} tick game tick
 * @returns {object} record
 */
function fillCylinderDrawRecord(record, effect, tick) {
	const params = record.params;
	const renderCount = tick - effect.startTick;
	const duration = effect.endTick - effect.startTick;
	const animation = animationMode(effect.animation);
	let height = effect.height;
	let topSize = effect.topSize;
	let bottomSize = effect.bottomSize;

	if (animation === 1) {
		if (duration > 1000) {
			if (renderCount <= 1000) {
				height = (renderCount / 1000) * effect.height;
			}
		} else {
			height = (renderCount / duration) * effect.height;
		}
	} else if (animation === 2) {
		if (duration > 1000) {
			if (renderCount <= 1000) {
				topSize = (renderCount / 1000) * effect.topSize;
			}
		} else {
			topSize = (renderCount / duration) * effect.topSize;
		}
	} else if (animation === 3) {
		bottomSize = (1 - renderCount / duration) * effect.bottomSize;
		topSize = (1 - renderCount / duration) * effect.topSize;
		if (renderCount < duration / 2) {
			height = (renderCount * effect.height) / (duration / 2);
		} else if (renderCount > duration / 2) {
			height = ((duration - renderCount) * effect.height) / (duration / 2);
		}
	} else if (animation === 4) {
		bottomSize = (renderCount / duration) * effect.bottomSize;
		if (bottomSize < 0) {
			bottomSize = 0;
		}
		topSize = (renderCount / duration) * effect.topSize;
		if (topSize < 0) {
			topSize = 0;
		}
	} else if (animation === 5) {
		if (renderCount < duration / 2) {
			height = ((renderCount * 2) / duration) * effect.height;
		} else {
			height = ((duration - renderCount) * effect.height) / (duration / 2);
		}
	}

	effect.color[3] = effect.alphaMax;

	if (effect.fade) {
		if (renderCount < duration / 4) {
			effect.color[3] = (renderCount * effect.alphaMax) / (duration / 4);
		} else if (renderCount > duration / 2 + duration / 4) {
			effect.color[3] = ((duration - renderCount) * effect.alphaMax) / (duration / 4);
		}
	}

	const position = record.position;
	position[0] = effect.position[0];
	position[1] = effect.position[1];
	position[2] = effect.position[2];

	const matrix = params.rotation;
	params.rotate = !!(
		effect.rotate ||
		effect.angleX ||
		effect.angleY ||
		effect.angleZ ||
		effect.rotateWithCamera ||
		effect.fixedPerspective
	);
	mat4.identity(matrix);

	if (params.rotate) {
		if (effect.rotate) {
			mat4.rotateY(matrix, matrix, (tick / 4 / 180) * Math.PI);
		}

		if (effect.angleX) {
			mat4.rotateX(matrix, matrix, (effect.angleX / 180) * Math.PI);
		}
		if (effect.angleY) {
			mat4.rotateY(matrix, matrix, (effect.angleY / 180) * Math.PI);
		}
		if (effect.angleZ) {
			mat4.rotateZ(matrix, matrix, (effect.angleZ / 180) * Math.PI);
		}

		if (effect.rotateWithCamera || effect.fixedPerspective) {
			let magic = effect.posY;

			if (effect.fixedPerspective) {
				const vcRad = ((Camera.angle[0] - 180) * Math.PI) / 180;
				if (effect.posZ) {
					position[2] += effect.posZ * Math.cos(vcRad) - effect.posY * Math.sin(vcRad);
					magic = effect.posY * Math.sin(vcRad) + effect.posZ * Math.sin(vcRad);
				}
				mat4.rotateX(matrix, matrix, vcRad);
			}

			const hcRad = (Camera.angle[1] * Math.PI) / 180;
			if (effect.posX || effect.posY) {
				position[0] += effect.posX * Math.cos(hcRad) - magic * Math.sin(hcRad);
				position[1] += magic * Math.cos(hcRad) + effect.posX * Math.sin(hcRad);
			}
			mat4.rotateY(matrix, matrix, hcRad);
		} else {
			position[0] += effect.posX;
			position[1] += effect.posY;
			position[2] += effect.posZ;
		}
	} else {
		position[0] += effect.posX;
		position[1] += effect.posY;
		position[2] += effect.posZ;
	}

	record.pass = (effect.renderBeforeEntities ?? Cylinder.renderBeforeEntities) ? 'before' : 'after';
	record.texture = effect.texture;
	record.color.set(effect.color);
	record.blend = cylinderBlendState(effect.blendMode);
	record.fog = _fogUse;

	params.topSize = topSize;
	params.bottomSize = bottomSize;
	params.height = height;
	params.baseTopSize = effect.topSize;
	params.baseBottomSize = effect.bottomSize;
	params.baseHeight = effect.height;
	params.animation = animation;
	params.elapsed = renderCount;
	params.duration = duration;
	params.zIndex = effect.zIndex;
	params.totalCircleSides = effect.totalCircleSides;
	params.circleSides = effect.circleSides;
	params.repeatTextureX = effect.repeatTextureX;
	params.vertexCount = effect.verticeCount;
	params.textureRepeat = effect.repeatTextureX > 1;
	params.blendMode = effect.blendMode;

	return record;
}

/**
 * Send one cylinder record to the GPU and draw it. The shape uniforms are uploaded in
 * the legacy order, including the writes the animation overrides before the draw.
 *
 * @param {object} gl webgl context
 * @param {object} record cylinder draw record
 * @param {WebGLBuffer} buffer the effect's mesh
 */
function drawCylinderRecord(gl, record, buffer) {
	const uniform = _program.uniform;
	const attribute = _program.attribute;
	const params = record.params;

	gl.bindTexture(gl.TEXTURE_2D, record.texture);

	if (params.textureRepeat) {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	}

	gl.enableVertexAttribArray(attribute.aPosition);
	gl.enableVertexAttribArray(attribute.aTextureCoord);

	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

	gl.vertexAttribPointer(attribute.aPosition, 3, gl.FLOAT, false, 4 * 5, 0);
	gl.vertexAttribPointer(attribute.aTextureCoord, 2, gl.FLOAT, false, 4 * 5, 3 * 4);

	gl.uniform1f(uniform.uBottomSize, params.baseBottomSize);
	gl.uniform1f(uniform.uZindex, params.zIndex);

	if (params.animation === 3) {
		gl.uniform1f(uniform.uHeight, params.baseHeight);
		gl.uniform1f(uniform.uBottomSize, params.bottomSize);
		gl.uniform1f(uniform.uTopSize, params.topSize);
		if (params.elapsed < params.duration / 2 || params.elapsed > params.duration / 2) {
			gl.uniform1f(uniform.uHeight, params.height);
		}
	} else if (params.animation === 4) {
		gl.uniform1f(uniform.uHeight, params.height);
		gl.uniform1f(uniform.uBottomSize, params.bottomSize);
		gl.uniform1f(uniform.uTopSize, params.topSize);
	} else {
		gl.uniform1f(uniform.uHeight, params.height);
		gl.uniform1f(uniform.uTopSize, params.topSize);
	}

	gl.uniform4fv(uniform.uSpriteRendererColor, record.color);

	if (params.blendMode > 0 && params.blendMode < 16) {
		gl.blendFunc(gl.SRC_ALPHA, blendMode[params.blendMode]);
	} else {
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	}

	if (params.rotate) {
		gl.uniform1i(uniform.uRotate, true);
		gl.uniformMatrix4fv(uniform.uRotationMat, false, params.rotation);
	} else {
		gl.uniform1i(uniform.uRotate, false);
	}

	gl.uniform3fv(uniform.uPosition, record.position);

	SpriteRenderer.runWithDepth(record.depthTest, record.depthWrite, !record.depthCorrection, () => {
		gl.drawArrays(gl.TRIANGLES, 0, params.vertexCount);
	});
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createCylinderDrawRecord();

/*
 * Sets how many sides the base "circle" of the cylinder has.
 * @var {number} Base circle side count
 */

/**
 * Generate a generic cylinder
 *
 * @returns {Float32Array} buffer array
 */
function generateCylinder(totalCircleSides, circleSides, repeatTextureX) {
	let i, a, b;
	const bottom = [];
	const top = [];
	const mesh = [];

	for (i = 0; i <= circleSides; i++) {
		a = (i + 0.0) / totalCircleSides;
		b = (i + 0.0) / totalCircleSides;

		bottom[i] = [
			Math.sin(a * Math.PI * 2),
			Math.cos(a * Math.PI * 2),
			0,
			a * (totalCircleSides / circleSides) * repeatTextureX,
			1
		];
		top[i] = [
			Math.sin(b * Math.PI * 2),
			Math.cos(b * Math.PI * 2),
			1,
			b * (totalCircleSides / circleSides) * repeatTextureX,
			0
		];
	}

	for (i = 0; i <= circleSides; i++) {
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
 * Cylinder constructor
 *
 * @param {Array} position
 * @param {Object} effect attributes
 * @param {number} Start tick
 * @param {number} End tick
 */
class Cylinder {
	constructor(effect, EF_Inst_Par, EF_Init_Par) {
		const position = EF_Inst_Par.position;
		const otherPosition = EF_Inst_Par.otherPosition;
		const direction = EF_Inst_Par.direction;
		const startTick = EF_Inst_Par.startTick;
		const endTick = EF_Inst_Par.endTick;

		this.semiCircle = effect.semiCircle ? false : true;

		this.totalCircleSides = !isNaN(effect.totalCircleSides) ? effect.totalCircleSides : 20;
		this.circleSides = !isNaN(effect.circleSides) ? effect.circleSides : this.totalCircleSides;

		this.color = new Float32Array([1.0, 1.0, 1.0, 1.0]);
		if (!isNaN(effect.red)) {
			this.color[0] = effect.red;
		}
		if (!isNaN(effect.green)) {
			this.color[1] = effect.green;
		}
		if (!isNaN(effect.blue)) {
			this.color[2] = effect.blue;
		}

		//copy position instead of reference
		this.position = position;
		this.otherPosition = otherPosition;

		this.posX = !isNaN(effect.posX) ? effect.posX : 0;
		this.posY = !isNaN(effect.posY) ? effect.posY : 0;
		this.posZ = !isNaN(effect.posZ) ? effect.posZ : 0;

		this.topSize = effect.topSize;
		this.bottomSize = effect.bottomSize;
		this.textureName = effect.textureName;
		this.height = effect.height;

		this.animation = effect.animation;
		this.fade = effect.fade;
		this.rotate = effect.rotate;

		if (effect.alphaMax > 0) {
			this.alphaMax = effect.alphaMax;
		} else {
			this.alphaMax = 1.0;
		}

		this.angleX = !isNaN(effect.angleX) ? effect.angleX : 0;
		this.angleY = !isNaN(effect.angleY) ? effect.angleY : 0;
		this.angleZ = !isNaN(effect.angleZ) ? effect.angleZ : 0;

		this.angleX += !isNaN(effect.angleXRandom) ? Math.floor(Math.random() * effect.angleXRandom) : 0;
		this.angleY += !isNaN(effect.angleYRandom) ? Math.floor(Math.random() * effect.angleYRandom) : 0;
		this.angleZ += !isNaN(effect.angleZRandom) ? Math.floor(Math.random() * effect.angleZRandom) : 0;

		this.repeatTextureX = !isNaN(effect.repeatTextureX) ? effect.repeatTextureX : 1;

		if (effect.rotateToTarget) {
			this.rotateToTarget = true;
			const x = this.otherPosition[0] - this.position[0];
			const y = this.otherPosition[1] - this.position[1];
			this.angleY += 90 - Math.atan2(y, x) * (180 / Math.PI);
		}

		if (effect.rotateWithSource) {
			this.rotateWithSource = true;
			this.angleY += 180 + direction * -45;
		}

		this.rotateWithCamera = effect.rotateWithCamera ? true : false;
		this.fixedPerspective = effect.fixedPerspective ? true : false;

		this.zIndex = !isNaN(effect.zIndex) ? effect.zIndex : 0;

		this.blendMode = effect.blendMode;
		this.startTick = startTick;
		this.endTick = endTick;

		this.repeat = effect.repeat;
	}

	/**
	 * Preparing for render
	 *
	 * @param {object} webgl context
	 */
	init(gl) {
		this.vertices = generateCylinder(this.totalCircleSides, this.circleSides, this.repeatTextureX);
		this.verticeCount = this.vertices.length / 5;

		this.buffer = gl.createBuffer();

		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW);

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
		// Legacy: the per-instance mesh buffer (this.buffer) is not deleted here.
		this.ready = false;
	}

	/**
	 * Rendering cast
	 *
	 * @param {object} wegl context
	 */
	render(gl, tick) {
		// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
		const record = fillCylinderDrawRecord(
			_recordSinks.size ? createCylinderDrawRecord() : _scratchRecord,
			this,
			tick
		);
		_recordSinks.forEach(sink => sink(record));
		drawCylinderRecord(gl, record, this.buffer);

		this.needCleanUp = this.endTick < tick;
	}

	/**
	 * Observe every cylinder draw as a backend-neutral record. Each observed draw gets
	 * a fresh record object, so sinks may keep it.
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
		blendMode[1] = gl.ZERO;
		blendMode[2] = gl.ONE;
		blendMode[3] = gl.SRC_COLOR;
		blendMode[4] = gl.ONE_MINUS_SRC_COLOR;
		blendMode[5] = gl.DST_COLOR;
		blendMode[6] = gl.ONE_MINUS_DST_COLOR;
		blendMode[7] = gl.SRC_ALPHA;
		blendMode[8] = gl.ONE_MINUS_SRC_ALPHA;
		blendMode[9] = gl.DST_ALPHA;
		blendMode[10] = gl.ONE_MINUS_DST_ALPHA;
		blendMode[11] = gl.CONSTANT_COLOR;
		blendMode[12] = gl.ONE_MINUS_CONSTANT_COLOR;
		blendMode[13] = gl.CONSTANT_ALPHA;
		blendMode[14] = gl.ONE_MINUS_CONSTANT_ALPHA;
		blendMode[15] = gl.SRC_ALPHA_SATURATE;

		_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);

		this.ready = true;
		this.renderBeforeEntities = false;
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

		if (this.buffer) {
			gl.deleteBuffer(this.buffer);
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
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	}
}

/**
 * @var {WebGLBuffer}
 */
Cylinder.buffer = null;

/**
 * @var {number}
 */
Cylinder.verticeCount = 0;

/**
 * Export
 */
export default Cylinder;
