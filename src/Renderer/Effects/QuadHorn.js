/**
 * Renderer/Effects/QuadHorn.js
 *
 * Generate Ice Wall effect like.
 *
 * @author MrUnzO
 */

import WebGL from 'Utils/WebGL.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';
import _vertexShader from './QuadHorn.vs?raw';
import _fragmentShader from './QuadHorn.fs?raw';

let _program;
const mat4 = glMatrix.mat4;

const blendMode = {};

const vertices = [
	0.0, 1.0, 0.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0,

	0.0, 1.0, 0.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0,

	0.0, 1.0, 0.0, 1.0, -1.0, -1.0, -1.0, -1.0, -1.0,

	0.0, 1.0, 0.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0
];

const texCoords = [
	0, 0, 1, 0, 1, 1,

	0, 0, 1, 1, 0, 1,

	1, 0, 1, 1, 0, 1,

	1, 0, 0, 1, 0, 0
];

const rand = (min, max) => parseFloat(Math.min(min + Math.random() * (max - min), max).toFixed(3));

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
 * Normal alpha blending (blendMode out of range).
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
function quadHornBlendState(mode) {
	if (!(mode > 0 && mode < 16)) {
		return BLEND_NORMAL;
	}
	if (!(mode in _blendStates)) {
		_blendStates[mode] = mode in BLEND_FACTOR ? Object.freeze({ src: 'SRC_ALPHA', dst: BLEND_FACTOR[mode] }) : null;
	}
	return _blendStates[mode];
}

/**
 * Vertex count of the four-faced horn (4 triangles).
 */
const VERTEX_COUNT = 12;

/**
 * @var {boolean} scene fog state uploaded by the last beforeRender
 */
let _fogUse = false;

/**
 * @var {mat4} rotation matrices rebuilt per draw from the record angles
 */
const _xRotationMatrix = mat4.create();
const _yRotationMatrix = mat4.create();
const _zRotationMatrix = mat4.create();

/**
 * Create an empty QuadHorn draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * QuadHorn sets no depth state: it draws with the state of the pass it runs in
 * (the before-entities pass: depth test and depth write on).
 *
 * params:
 *  - step: running intro animation ('grow' 1, 'move' 2, 'rise' 3, 'emerge' 4) or null
 *  - height, offsetZ: animated uHeight / uOffsetZ of the intro step
 *  - sinkOffsetZ: uOffsetZ of the animationOut sink after endTick (overrides offsetZ), or null
 *  - offsetX, offsetY, bottomSize
 *  - rotateX, rotateY, rotateZ: degrees (the Z matrix adds 180)
 *  - blendMode: GL-order code after `|| 1`
 *  - vertexCount
 *
 * @returns {object} record
 */
function createQuadHornDrawRecord() {
	return {
		kind: 'effect',
		family: 'quadhorn',
		pass: 'before',
		texture: null,
		position: null,
		color: null,
		blend: BLEND_NORMAL,
		depthTest: true,
		depthWrite: true,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			step: null,
			height: 0,
			offsetZ: 0,
			sinkOffsetZ: null,
			offsetX: 0,
			offsetY: 0,
			bottomSize: 0,
			rotateX: 0,
			rotateY: 0,
			rotateZ: 0,
			blendMode: 1,
			vertexCount: VERTEX_COUNT
		}
	};
}

/**
 * Snapshot one QuadHorn draw into a record. Advances the effect's animation, fade and
 * cleanup state like the legacy render did.
 *
 * @param {object} record to fill
 * @param {QuadHorn} effect
 * @param {number} tick game tick
 * @param {boolean} keep true when the record outlives the draw (position and color copied)
 * @returns {object} record
 */
function fillQuadHornDrawRecord(record, effect, tick, keep) {
	const params = record.params;
	const deltaStart = (tick - effect.startTick) / 1000.0;
	const deltaEnd = (tick - effect.endTick) / 1000.0;
	let step = null;
	let height = effect.height;
	let offsetZ = effect.offsetZ;
	let sinkOffsetZ = null;

	if (effect.animation === 1 && !effect._endAnimation) {
		//Grow up
		step = 'grow';
		const lerpHeight = deltaStart / (effect.animationSpeed / 1000);
		if (lerpHeight > effect.height) {
			effect._endAnimation = true;
		} else {
			height = lerpHeight;
		}
	} else if (effect.animation === 2 && !effect._endAnimation) {
		//Move up
		step = 'move';
		const lerpZOffset = deltaStart / (effect.animationSpeed / 1000);
		if (lerpZOffset > effect.offsetZ) {
			effect._endAnimation = true;
		} else {
			offsetZ = lerpZOffset;
		}
	} else if (effect.animation === 4 && !effect._endAnimation) {
		//Emerge from riseDistance below offsetZ, decelerating to a stop over animationSpeed ms
		step = 'emerge';
		const progress = Math.min(deltaStart / (effect.animationSpeed / 1000), 1.0);
		const eased = 1.0 - (1.0 - progress) * (1.0 - progress);
		if (progress >= 1.0) {
			effect._endAnimation = true;
		}
		offsetZ = effect.offsetZ - effect.riseDistance * (1.0 - eased);
	} else if (effect.animation === 3 && !effect._endAnimation) {
		//Move up and over the ground a bit to make it feel more attack power
		step = 'rise';
		const lerpZOffset = deltaStart / (effect.animationSpeed / 1000);
		if (lerpZOffset > effect.height / 2) {
			effect._endAnimation = true;
		} else {
			offsetZ = lerpZOffset;
		}
	}

	if (effect.fadeOut > 0 && effect.endTick > 0) {
		const remaining = effect.endTick - tick;
		effect.color[3] = effect.baseAlpha * Math.max(0, Math.min(1, remaining / effect.fadeOut));
	}

	if (effect.endTick > 0 && effect.endTick < tick) {
		if (effect.animationOut && effect._endAnimation) {
			const lerpZOffset = -((deltaEnd / (effect.animationSpeed / 1000)) * effect.height);
			if (lerpZOffset < -(effect.height + effect.offsetZ)) {
				effect.needCleanUp = effect.endTick < tick;
			}
			sinkOffsetZ = lerpZOffset;
		} else {
			effect.needCleanUp = effect.endTick < tick;
		}
	}

	record.pass = (effect.renderBeforeEntities ?? QuadHorn.renderBeforeEntities) ? 'before' : 'after';
	record.texture = effect.texture;
	record.position = keep ? Array.from(effect.position) : effect.position;
	record.color = keep ? effect.color.slice() : effect.color;
	record.blend = quadHornBlendState(effect.blendMode);
	record.fog = _fogUse;

	params.step = step;
	params.height = height;
	params.offsetZ = offsetZ;
	params.sinkOffsetZ = sinkOffsetZ;
	params.offsetX = effect.offsetX;
	params.offsetY = effect.offsetY;
	params.bottomSize = effect.bottomSize;
	params.rotateX = effect.rotateX;
	params.rotateY = effect.rotateY;
	params.rotateZ = effect.rotateZ;
	params.blendMode = effect.blendMode;

	return record;
}

/**
 * Send one QuadHorn record to the GPU and draw it (legacy upload order: the intro
 * step decides whether uOffsetZ or uHeight goes first).
 *
 * @param {object} gl webgl context
 * @param {object} record QuadHorn draw record
 * @param {WebGLBuffer} vertexBuffer the effect's positions
 * @param {WebGLBuffer} texCoordBuffer the effect's texture coordinates
 */
function drawQuadHornRecord(gl, record, vertexBuffer, texCoordBuffer) {
	const uniform = _program.uniform;
	const attribute = _program.attribute;
	const params = record.params;

	gl.bindTexture(gl.TEXTURE_2D, record.texture);

	gl.enableVertexAttribArray(attribute.aPosition);
	gl.enableVertexAttribArray(attribute.aTextureCoord);
	gl.enableVertexAttribArray(attribute.aColor);

	if (params.blendMode > 0 && params.blendMode < 16) {
		gl.blendFunc(gl.SRC_ALPHA, blendMode[params.blendMode]);
	} else {
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	}

	if (params.step === null || params.step === 'grow') {
		gl.uniform1f(uniform.uHeight, params.height);
		gl.uniform1f(uniform.uOffsetZ, params.offsetZ);
	} else {
		gl.uniform1f(uniform.uOffsetZ, params.offsetZ);
		gl.uniform1f(uniform.uHeight, params.height);
	}

	if (params.sinkOffsetZ !== null) {
		gl.uniform1f(uniform.uOffsetZ, params.sinkOffsetZ);
	}

	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	gl.vertexAttribPointer(attribute.aPosition, 3, gl.FLOAT, false, 0, 0);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.vertexAttribPointer(attribute.aTextureCoord, 2, gl.FLOAT, false, 0, 0);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	gl.uniform3fv(uniform.uPosition, record.position);

	gl.uniform1f(uniform.uBottomSize, params.bottomSize);
	gl.uniform1f(uniform.uOffsetX, params.offsetX);
	gl.uniform1f(uniform.uOffsetY, params.offsetY);

	gl.uniform4fv(uniform.uColor, record.color);

	mat4.identity(_xRotationMatrix);
	mat4.rotate(_xRotationMatrix, _xRotationMatrix, (params.rotateX * Math.PI) / 180, [1, 0, 0]);
	gl.uniformMatrix4fv(uniform.uXRotationMat, false, _xRotationMatrix);

	mat4.identity(_yRotationMatrix);
	mat4.rotate(_yRotationMatrix, _yRotationMatrix, (params.rotateY * Math.PI) / 180, [0, 1, 0]);
	gl.uniformMatrix4fv(uniform.uYRotationMat, false, _yRotationMatrix);

	mat4.identity(_zRotationMatrix);
	mat4.rotate(_zRotationMatrix, _zRotationMatrix, ((180 + params.rotateZ) * Math.PI) / 180, [0, 0, 1]);
	gl.uniformMatrix4fv(uniform.uZRotationMat, false, _zRotationMatrix);

	gl.drawArrays(gl.TRIANGLES, 0, params.vertexCount);
	gl.flush();
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createQuadHornDrawRecord();

class QuadHorn {
	constructor(effect, EF_Inst_Par, EF_Init_Par) {
		this.position = EF_Inst_Par.position;
		this.blendMode = effect.blendMode || 1;
		this.height =
			(effect.height && effect.height instanceof Array
				? rand(effect.height[0], effect.height[1])
				: effect.height) || 0.0;
		this.rotateX =
			(effect.rotateX && effect.rotateX instanceof Array
				? rand(effect.rotateX[0], effect.rotateX[1])
				: effect.rotateX) || 0.0;
		this.rotateY =
			(effect.rotateY && effect.rotateY instanceof Array
				? rand(effect.rotateY[0], effect.rotateY[1])
				: effect.rotateY) || 0.0;
		this.rotateZ =
			(effect.rotateZ && effect.rotateZ instanceof Array
				? rand(effect.rotateZ[0], effect.rotateZ[1])
				: effect.rotateZ) || 0.0;
		this.offsetX =
			(effect.offsetX && effect.offsetX instanceof Array
				? rand(effect.offsetX[0], effect.offsetX[1])
				: effect.offsetX) ?? 0.5;
		this.offsetY =
			(effect.offsetY && effect.offsetY instanceof Array
				? rand(effect.offsetY[0], effect.offsetY[1])
				: effect.offsetY) ?? 0.5;
		this.offsetZ =
			(effect.offsetZ && effect.offsetZ instanceof Array
				? rand(effect.offsetZ[0], effect.offsetZ[1])
				: effect.offsetZ) || 0.5;
		this.bottomSize =
			(effect.bottomSize && effect.bottomSize instanceof Array
				? rand(effect.bottomSize[0], effect.bottomSize[1])
				: effect.bottomSize) || 0.0;
		this.color = effect.color ? effect.color.slice() : [1.0, 1.0, 1.0, 1.0];
		this.baseAlpha = this.color[3];
		this.animation = effect.animation || 0;
		this.animationSpeed = effect.animationSpeed || 100;
		this.animationOut = effect.animationOut || false;
		this.riseDistance =
			(effect.riseDistance && effect.riseDistance instanceof Array
				? rand(effect.riseDistance[0], effect.riseDistance[1])
				: effect.riseDistance) || 0.0;
		this.fadeOut = effect.fadeOut || 0;
		this.textureFile = effect.textureFile;
		this.startTick = EF_Inst_Par.startTick;
		this.endTick = EF_Inst_Par.endTick;
		this._endAnimation = effect.animation > 0 ? false : true;
	}

	init(gl) {
		this.buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

		this.texCoordBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

		this.freed = false;
		Client.loadFile(`data/texture/${this.textureFile}`, buffer => {
			WebGL.texture(gl, buffer, texture => {
				if (this.freed) {
					gl.deleteTexture(texture);
					return;
				}
				this.texture = texture;
				this.ready = true;
			});
		});
	}

	free(gl) {
		gl.deleteBuffer(this.buffer);
		gl.deleteBuffer(this.texCoordBuffer);
		if (this.texture) {
			gl.deleteTexture(this.texture);
			this.texture = null;
		}
		this.freed = true;
		this.ready = false;
	}

	render(gl, tick) {
		// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
		const observed = _recordSinks.size > 0;
		const record = fillQuadHornDrawRecord(
			observed ? createQuadHornDrawRecord() : _scratchRecord,
			this,
			tick,
			observed
		);
		_recordSinks.forEach(sink => sink(record));
		drawQuadHornRecord(gl, record, this.buffer, this.texCoordBuffer);
	}

	/**
	 * Observe every QuadHorn draw as a backend-neutral record. Each observed draw gets
	 * a fresh record object, so sinks may keep it.
	 *
	 * @param {function} sink called with each draw record
	 * @returns {function} unsubscribe
	 */
	static addRecordSink(sink) {
		_recordSinks.add(sink);
		return () => _recordSinks.delete(sink);
	}

	static init(gl) {
		_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);

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

		this.ready = true;
		this.renderBeforeEntities = true;
	}

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

	static beforeRender(gl, modelView, projection, fog, tick) {
		const uniform = _program.uniform;

		gl.useProgram(_program);

		gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
		gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection);

		gl.uniform1i(uniform.uFogUse, fog.use && fog.exist);
		_fogUse = !!(fog.use && fog.exist);
		gl.uniform1f(uniform.uFogNear, fog.near);
		gl.uniform1f(uniform.uFogFar, fog.far);
		gl.uniform3fv(uniform.uFogColor, fog.color);

		gl.activeTexture(gl.TEXTURE0);
		gl.uniform1i(uniform.uDiffuse, 0);
	}

	static afterRender(gl) {
		gl.disableVertexAttribArray(_program.attribute.aPosition);
		gl.disableVertexAttribArray(_program.attribute.aTextureCoord);
		gl.disableVertexAttribArray(_program.attribute.aColor);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	}
}

export default QuadHorn;
