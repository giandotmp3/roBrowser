/**
 * Renderer/Effects/StrEffect.js
 *
 * Rendering Str File object
 *
 * This file is part of ROBrowser, (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */

import _vertexShader from './StrEffect.vs?raw';
import _fragmentShader from './StrEffect.fs?raw';
import WebGL from 'Utils/WebGL.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';

const mat4 = glMatrix.mat4;

/**
 * Look up table D3DX => OPENGL
 */
const D3DBLEND = {};

/**
 * @var {WebGLProgram}
 */
let _program = null;

/**
 * @var {WebGLBuffer}
 */
let _buffer = null;

/**
 * @var {float[16]} buffer
 */
const _bufferData = new Float32Array(4 * 4);

/**
 * @var mat4 matrix to generate rotation
 */
const _matrix = mat4.create();

/**
 * @var {number} last angle
 */
let _lastAngle = -1;

// Pixel to world conversion for attachment offsets
const PIXEL_TO_WORLD_Z = 1.0 / 5.0;

/**
 * STR quad pivot in sprite pixels (pos - pivot is the billboard offset).
 */
const STR_PIVOT = Object.freeze([320, 320]);

/**
 * Backend-neutral factor names of the D3DBLEND codes (same table as D3DBLEND).
 */
const D3DBLEND_FACTOR = Object.freeze({
	1: 'ZERO',
	2: 'ONE',
	3: 'SRC_COLOR',
	4: 'ONE_MINUS_SRC_COLOR',
	5: 'SRC_ALPHA',
	6: 'ONE_MINUS_SRC_ALPHA',
	7: 'DST_ALPHA',
	8: 'ONE_MINUS_DST_ALPHA',
	9: 'DST_COLOR',
	10: 'ONE_MINUS_DST_COLOR',
	11: 'SRC_ALPHA_SATURATE',
	14: 'CONSTANT_COLOR',
	15: 'ONE_MINUS_CONSTANT_ALPHA'
});

/**
 * @var {object} cached blend states by [src][dst] code (allocation-free per draw)
 */
const _blendStates = {};

/**
 * Unified blend state of a D3D src/dst code pair, or null when a code is not in
 * the table (the GL call then receives an invalid enum and keeps its blend state).
 *
 * @param {number} src D3DBLEND code
 * @param {number} dst D3DBLEND code
 * @returns {object|null} { src, dst } factor names
 */
function strBlendState(src, dst) {
	const bySrc = _blendStates[src] || (_blendStates[src] = {});
	if (!(dst in bySrc)) {
		bySrc[dst] =
			src in D3DBLEND_FACTOR && dst in D3DBLEND_FACTOR
				? Object.freeze({ src: D3DBLEND_FACTOR[src], dst: D3DBLEND_FACTOR[dst] })
				: null;
	}
	return bySrc[dst];
}

/**
 * Create an empty STR layer draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records). Geometry stays in sprite pixels.
 *
 * params:
 *  - xy: keyframe quad corners (x0..x3, y0..y3), before scale
 *  - scale: attachment size scale (1 when not attached)
 *  - angle: degrees
 *  - offset: pos - pivot (+ attachment offset), sprite pixels
 *  - yLower: world units the quad is lowered (0.5, 0 for attachments)
 *  - pivot, clipZBias: constants of the billboard
 *  - aniframe: interpolated texture frame
 *  - srcBlend, dstBlend: raw D3DBLEND codes
 *
 * @returns {object} record
 */
function createStrDrawRecord() {
	return {
		kind: 'effect',
		family: 'str',
		texture: null,
		position: null,
		color: new Float32Array(4),
		blend: null,
		depthTest: true,
		depthWrite: false,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			xy: new Float32Array(8),
			scale: 1,
			angle: 0,
			offset: new Float32Array(2),
			yLower: 0.5,
			pivot: STR_PIVOT,
			clipZBias: -0.1,
			aniframe: 0,
			srcBlend: 0,
			dstBlend: 0
		}
	};
}

/**
 * Snapshot one STR layer draw into a record.
 *
 * @param {object} record to fill
 * @param {StrEffect} effect
 * @param {object} material texture
 * @param {object} animat interpolated layer state
 * @param {boolean} keep true when the record outlives the draw (position copied)
 * @returns {object} record
 */
function fillStrDrawRecord(record, effect, material, animat, keep) {
	const params = record.params;
	const owner = effect.ownerEntity;

	// Hat effects: Scale with entity size
	const sizeScale = owner ? (owner.xSize + owner.ySize) / 2 / 5 : 1.0;

	record.texture = material;
	record.position = keep && effect.position ? Array.from(effect.position) : effect.position;
	record.color.set(animat.color);
	record.blend = strBlendState(animat.srcalpha, animat.destalpha);
	record.strAttachment = !!owner;

	params.xy.set(animat.xy);
	params.scale = sizeScale;
	params.angle = animat.angle;
	params.aniframe = animat.aniframe;
	params.srcBlend = animat.srcalpha;
	params.dstBlend = animat.destalpha;

	if (owner) {
		// Attachment: center at (320,320), apply offsets, scale with entity
		params.offset[0] = animat.pos[0] - 320 + (effect.xOffset || 0) * PIXEL_TO_WORLD_Z * 35 * sizeScale;
		// flip Y offset only
		params.offset[1] = animat.pos[1] - 320 - (effect.yOffset || 0) * PIXEL_TO_WORLD_Z * 35 * sizeScale;
		params.yLower = 0.0;
	} else {
		params.offset[0] = animat.pos[0] - 320;
		params.offset[1] = animat.pos[1] - 320;
		params.yLower = 0.5;
	}

	return record;
}

/**
 * Setup geometries, send one STR layer record to the GPU and draw it.
 *
 * @param {object} gl webgl context
 * @param {object} record STR draw record
 */
function drawStrRecord(gl, record) {
	const uniform = _program.uniform;
	const attribute = _program.attribute;
	const { xy, scale, angle } = record.params;

	// Update geometries (apply size scaling only for attachments)
	_bufferData[0] = xy[0] * scale;
	_bufferData[1] = xy[4] * scale;
	_bufferData[2] = 0; //anim.uv[0];
	_bufferData[3] = 0; //anim.uv[1];

	_bufferData[4] = xy[1] * scale;
	_bufferData[5] = xy[5] * scale;
	_bufferData[6] = 1; //anim.uv[2];
	_bufferData[7] = 0; //anim.uv[3];

	_bufferData[8] = xy[3] * scale;
	_bufferData[9] = xy[7] * scale;
	_bufferData[10] = 0; //anim.uv[4];
	_bufferData[11] = 1; //anim.uv[5];

	_bufferData[12] = xy[2] * scale;
	_bufferData[13] = xy[6] * scale;
	_bufferData[14] = 1; //anim.uv[6];
	_bufferData[15] = 1; //anim.uv[7];

	if (angle !== _lastAngle) {
		mat4.identity(_matrix);
		mat4.rotateZ(_matrix, _matrix, (-angle / 180) * Math.PI);
		_lastAngle = angle;
	}

	// Send effect parameters
	gl.uniform4fv(uniform.uSpriteColor, record.color);
	gl.uniform2fv(uniform.uSpriteOffset, record.params.offset);
	gl.uniform1f(uniform.uVerticalBase, record.params.yLower);
	gl.uniform3fv(uniform.uSpritePosition, record.position);

	gl.uniformMatrix4fv(uniform.uSpriteAngle, false, _matrix);

	// Send new buffer
	gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, _bufferData);

	// Link attribute
	gl.vertexAttribPointer(attribute.aPosition, 2, gl.FLOAT, false, 4 * 4, 0 * 4);
	gl.vertexAttribPointer(attribute.aTextureCoord, 2, gl.FLOAT, false, 4 * 4, 2 * 4);

	// Send texture and data
	gl.blendFunc(D3DBLEND[record.params.srcBlend], D3DBLEND[record.params.dstBlend]);
	gl.bindTexture(gl.TEXTURE_2D, record.texture);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createStrDrawRecord();

const anim = {
	frame: 0,
	type: 0,
	aniframe: 0,
	anitype: 0,
	srcalpha: 1,
	destalpha: 1,
	mtpreset: 0,
	delay: 0.0,
	angle: 0.0,
	color: new Float32Array(4),
	pos: new Float32Array(2),
	uv: new Float32Array(8),
	xy: new Float32Array(8)
};

// Helper to copy animation state for caching
function copyAnim(src) {
	return {
		type: src.type,
		aniframe: src.aniframe,
		anitype: src.anitype,
		srcalpha: src.srcalpha,
		destalpha: src.destalpha,
		mtpreset: src.mtpreset,
		delay: src.delay,
		angle: src.angle,
		color: new Float32Array(src.color),
		pos: new Float32Array(src.pos),
		uv: new Float32Array(src.uv),
		xy: new Float32Array(src.xy)
	};
}

/**
 * Calculate effect animation base on the keyframe structure.
 *
 * @param {STRLayer} layer
 * @param {number} key index
 * @param {object} animation structure
 */
function calculateAnimation(layer, keyIndex, result) {
	let lastFrame = 0;
	let lastSource = 0;
	let fromId = -1,
		toId = -1;

	const animations = layer.animations;

	// Animations are sorted by the loader
	for (let i = 0; i < layer.anikeynum; ++i) {
		if (animations[i].frame <= keyIndex) {
			if (animations[i].type === 0) {
				fromId = i;
			}
			if (animations[i].type === 1) {
				toId = i;
			}
		}
		lastFrame = Math.max(lastFrame, animations[i].frame);

		if (animations[i].type === 0) {
			lastSource = Math.max(lastSource, animations[i].frame);
		}
	}

	// Nothing to render
	if (fromId < 0 || (toId < 0 && lastFrame < keyIndex)) {
		return false;
	}

	const from = animations[fromId];
	const to = animations[toId];
	const delta = keyIndex - from.frame;
	result.srcalpha = from.srcalpha;
	result.destalpha = from.destalpha;

	// Static frame (or frame that can't be updated)
	if (toId !== fromId + 1 || to.frame !== from.frame) {
		// No other source
		if (to && lastSource <= from.frame) {
			return false;
		}

		result.angle = from.angle;
		result.aniframe = from.aniframe;

		result.color.set(from.color);
		result.pos.set(from.pos);
		result.uv.set(from.uv);
		result.xy.set(from.xy);

		return true;
	}

	// Morph animation
	result.color[0] = from.color[0] + to.color[0] * delta;
	result.color[1] = from.color[1] + to.color[1] * delta;
	result.color[2] = from.color[2] + to.color[2] * delta;
	result.color[3] = from.color[3] + to.color[3] * delta;

	result.uv[0] = from.uv[0] + to.uv[0] * delta;
	result.uv[1] = from.uv[1] + to.uv[1] * delta;
	result.uv[2] = from.uv[2] + to.uv[2] * delta;
	result.uv[3] = from.uv[3] + to.uv[3] * delta;
	result.uv[4] = from.uv[4] + to.uv[4] * delta;
	result.uv[5] = from.uv[5] + to.uv[5] * delta;
	result.uv[6] = from.uv[6] + to.uv[6] * delta;
	result.uv[7] = from.uv[7] + to.uv[7] * delta;

	result.xy[0] = from.xy[0] + to.xy[0] * delta;
	result.xy[1] = from.xy[1] + to.xy[1] * delta;
	result.xy[2] = from.xy[2] + to.xy[2] * delta;
	result.xy[3] = from.xy[3] + to.xy[3] * delta;
	result.xy[4] = from.xy[4] + to.xy[4] * delta;
	result.xy[5] = from.xy[5] + to.xy[5] * delta;
	result.xy[6] = from.xy[6] + to.xy[6] * delta;
	result.xy[7] = from.xy[7] + to.xy[7] * delta;

	result.angle = from.angle + to.angle * delta;
	result.pos[0] = from.pos[0] + to.pos[0] * delta;
	result.pos[1] = from.pos[1] + to.pos[1] * delta;

	switch (to.anitype) {
		default: // bug fix
			result.aniframe = 0;
			break;

		case 1: // normal
			result.aniframe = from.aniframe + to.aniframe * delta;
			break;

		case 2: // Stop at end
			result.aniframe = Math.min(from.aniframe + to.delay * delta, layer.texcnt - 1);
			break;

		case 3: // Repeat
			result.aniframe = (from.aniframe + to.delay * delta) % layer.texcnt;
			break;

		case 4: // play reverse infinitly
			result.aniframe = (from.aniframe - to.delay * delta) % layer.texcnt;
			break;
	}

	return true;
}

/**
 * StrEffect constructor
 *
 * @param {string} str effect file
 * @param {Array} effect position
 * @param {string} start tick
 * @param {string} texturePath
 * @param {Array<{filename: string, texturePath: string}>} fallbacks - tried in order when the file is missing
 */
class StrEffect {
	constructor(filename, position, startTick, texturePath, fallbacks = []) {
		this.filename = filename;
		this.startTick = startTick;
		this.position = position;
		this.texturePath = texturePath;
		this.fallbacks = fallbacks.slice();
		this.load();
	}

	/**
	 * Load the file. Clients keep the same art under different folders from one
	 * release to the next, so a missing file moves on to the next candidate;
	 * when none is left the effect is removed.
	 */
	load() {
		Client.loadFile(
			this.filename,
			null,
			() => {
				const next = this.fallbacks.shift();
				if (!next) {
					this.needCleanUp = true;
					return;
				}
				this.filename = next.filename;
				this.texturePath = next.texturePath;
				this.load();
			},
			{ texturePath: this.texturePath }
		);
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
	 * Render in 3D effect
	 *
	 * @param {object} gl
	 * @param {number} tick
	 */
	render(gl, tick) {
		let layer;
		let i, keyIndex;

		// Follow entity position for attachments
		if (this.ownerEntity && this.ownerEntity.position) {
			this.position = this.ownerEntity.position;
			this.ownerDirection = this.ownerEntity.direction;
			if (this._Params && this._Params.Inst) {
				this._Params.Inst.position = this.position;
			}
		}

		const strFile = Client.loadFile(this.filename, null, null, { texturePath: this.texturePath });

		// Not loaded yet
		if (strFile === null) {
			return;
		}

		keyIndex = ((tick - this.startTick) / 1000) * strFile.fps;

		// Loop persistent effects
		if (this.persistent && strFile && strFile.maxKey) {
			keyIndex = keyIndex % strFile.maxKey;
		}

		// Cache for blank frame handling in hat effects
		if (!this._lastValidAnim) {
			this._lastValidAnim = {};
		}

		let anyFreshFrame = false;

		for (i = 0; i < strFile.layernum; i++) {
			layer = strFile.layers[i];

			if (layer.materials.length) {
				if (calculateAnimation(layer, keyIndex, anim)) {
					if (layer.materials[anim.aniframe | 0]) {
						this.renderAnimation(gl, layer.materials[anim.aniframe | 0], anim);
						anyFreshFrame = true;
						// Cache for hat effect blank frame handling
						if (this.persistent && this.ownerEntity) {
							this._lastValidAnim[i] = {
								anim: copyAnim(anim),
								material: layer.materials[anim.aniframe | 0]
							};
						}
					}
				} else if (this.persistent && this.ownerEntity && this._lastValidAnim[i]) {
					// Use cached frame for blank frames in hat effects
					this.renderAnimation(gl, this._lastValidAnim[i].material, this._lastValidAnim[i].anim);
				}
			}
		}

		// Reset hat effect animation when in blank region to avoid gaps
		if (this.persistent && this.ownerEntity && !anyFreshFrame && strFile.maxKey > 0) {
			this.startTick = tick;
			this._lastValidAnim = {};
		}

		// animation ended
		if (keyIndex >= strFile.maxKey) {
			this.needCleanUp = true;
		}
	}

	/**
	 * Setup geometries, send data to GPU
	 *
	 * @param {object} webgl context
	 * @param {glTexture} webgl texture
	 * @param {StrAnimation} animation object
	 */
	renderAnimation(gl, material, animat) {
		// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
		if (_recordSinks.size) {
			const record = fillStrDrawRecord(createStrDrawRecord(), this, material, animat, true);
			_recordSinks.forEach(sink => sink(record));
			drawStrRecord(gl, record);
			return;
		}

		drawStrRecord(gl, fillStrDrawRecord(_scratchRecord, this, material, animat, false));
	}

	/**
	 * Observe every STR layer draw as a backend-neutral record. Each observed draw
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
	 * Initialize StrEffect
	 *
	 * @param {object} gl context
	 */
	static init(gl) {
		if (!_buffer) {
			_buffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);
			gl.bufferData(gl.ARRAY_BUFFER, _bufferData.byteLength, gl.DYNAMIC_DRAW);
		}

		if (!_program) {
			_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);
		}

		D3DBLEND[1] = gl.ZERO;
		D3DBLEND[2] = gl.ONE;
		D3DBLEND[3] = gl.SRC_COLOR;
		D3DBLEND[4] = gl.ONE_MINUS_SRC_COLOR;
		D3DBLEND[5] = gl.SRC_ALPHA;
		D3DBLEND[6] = gl.ONE_MINUS_SRC_ALPHA;
		D3DBLEND[7] = gl.DST_ALPHA;
		D3DBLEND[8] = gl.ONE_MINUS_DST_ALPHA;
		D3DBLEND[9] = gl.DST_COLOR;
		D3DBLEND[10] = gl.ONE_MINUS_DST_COLOR;
		D3DBLEND[11] = gl.SRC_ALPHA_SATURATE;
		D3DBLEND[14] = gl.CONSTANT_COLOR;
		D3DBLEND[15] = gl.ONE_MINUS_CONSTANT_ALPHA;

		this.ready = true;
	}

	/**
	 * Destroy Effect
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
			_buffer = null;
		}

		this.ready = false;
	}

	/**
	 * Bind context
	 *
	 * @param {object} gl context
	 * @param {mat4} modelview
	 * @param {mat4} projection
	 * @param {object} fog structure
	 * @param {number} tick
	 */
	static beforeRender(gl, modelView, projection, fog, tick) {
		const uniform = _program.uniform;
		const attribute = _program.attribute;

		gl.depthMask(false);
		gl.useProgram(_program);
		gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
		gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection);

		// Fog settings
		gl.uniform1f(uniform.uFogNear, fog.near * 100);
		gl.uniform1f(uniform.uFogFar, fog.far * 150);
		gl.uniform3fv(uniform.uFogColor, fog.color);

		// Textures
		gl.uniform1i(uniform.uDiffuse, 0);

		// Enable all attributes
		gl.enableVertexAttribArray(attribute.aPosition);
		gl.enableVertexAttribArray(attribute.aTextureCoord);

		gl.activeTexture(gl.TEXTURE0);
	}

	/**
	 * Unbind 3D Context
	 *
	 * @param {object} gl context
	 */
	static afterRender(gl) {
		gl.depthMask(true);

		gl.disableVertexAttribArray(_program.attribute.aPosition);
		gl.disableVertexAttribArray(_program.attribute.aTextureCoord);

		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	}
}
/**
 * Export
 */
export default StrEffect;
