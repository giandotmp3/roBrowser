import WebGL from 'Utils/WebGL.js';
import { FlatTexture } from 'Renderer/Effects/Tiles.js';
import _vertexShader from './LPEffect.vs?raw';
import _fragmentShader from './LPEffect.fs?raw';

let _lpNum = 0;

/**
 * Create an empty Land Protector tile draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * The tile sets no blend function (normal alpha) and no depth state (the before-entities
 * pass state: depth test and write on). Its shader has no fog and forces alpha 0.7.
 *
 * params:
 *  - size: uSize, pulsing 0.8 + 0.05 * sin(phase + tick / 540π)
 *  - textureSize: the square canvas the texture is resampled into (rotated 180°)
 *  - vertexCount
 *
 * @returns {object} record
 */
function createDrawRecord() {
	return {
		kind: 'effect',
		family: 'lp',
		pass: 'before',
		texture: null,
		position: null,
		color: [1, 1, 1, 0.7],
		blend: Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' }),
		depthTest: true,
		depthWrite: true,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			size: 0,
			textureSize: 64,
			vertexCount: 6
		}
	};
}

/**
 * Send one Land Protector tile record to the GPU and draw it.
 *
 * @param {object} gl webgl context
 * @param {object} record draw record
 * @param {object} program the class program
 * @param {WebGLBuffer} buffer the class quad
 */
function drawRecord(gl, record, program, buffer) {
	gl.uniform3fv(program.uniform.uPosition, record.position);
	gl.uniform1f(program.uniform.uSize, record.params.size);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.drawArrays(gl.TRIANGLES, 0, record.params.vertexCount);
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createDrawRecord();

class LPEffect extends FlatTexture('data/texture/effect/aaa copy.bmp') {
	static createShaderProgram(gl) {
		return WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);
	}

	constructor() {
		super(...arguments);
		this.ix = ++_lpNum;
	}

	render(gl, tick) {
		const oddEven = this.ix % 2 === 0 ? Math.PI : 0;
		const sizeMult = Math.sin(oddEven + tick / (540 * Math.PI));
		// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
		const observed = _recordSinks.size > 0;
		const record = observed ? createDrawRecord() : _scratchRecord;
		record.pass = (this.renderBeforeEntities ?? this.constructor.renderBeforeEntities) ? 'before' : 'after';
		record.texture = this.constructor._texture;
		record.position = observed ? Array.from(this.position) : this.position;
		record.params.size = 0.8 + 0.05 * sizeMult;
		record.params.textureSize = this.constructor.textureSize;
		_recordSinks.forEach(sink => sink(record));
		drawRecord(gl, record, this.constructor._program, this.constructor._buffer);
	}

	/**
	 * Observe every LPEffect draw as a backend-neutral record. Each observed draw gets a
	 * fresh record object, so sinks may keep it.
	 *
	 * @param {function} sink called with each draw record
	 * @returns {function} unsubscribe
	 */
	static addRecordSink(sink) {
		_recordSinks.add(sink);
		return () => _recordSinks.delete(sink);
	}
}
export default LPEffect;
