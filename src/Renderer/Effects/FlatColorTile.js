import WebGL from 'Utils/WebGL.js';
import _vertexShader from './FlatColorTile.vs?raw';
import _fragmentShader from './FlatColorTile.fs?raw';

const _cache = {};

/**
 * Vertex count of one tile quad (2 triangles).
 */
const VERTEX_COUNT = 6;

/**
 * Normal alpha blending: the tile sets no blend function and draws with the pass default.
 */
const TILE_BLEND = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' });

/**
 * @var {Set<function>} record observers (every FlatColorTile class)
 */
const _recordSinks = new Set();

/**
 * Create an empty flat colour tile draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * Untextured, unfogged; sets no blend function (normal alpha) and no depth state (the
 * before-entities pass state: depth test and write on).
 *
 * params:
 *  - size: uSize (always 0.5)
 *  - vertexCount
 *
 * @returns {object} record
 */
function createFlatColorTileDrawRecord() {
	return {
		kind: 'effect',
		family: 'flat-color-tile',
		pass: 'before',
		texture: null,
		position: null,
		color: null,
		blend: TILE_BLEND,
		depthTest: true,
		depthWrite: true,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			size: 0.5,
			vertexCount: VERTEX_COUNT
		}
	};
}

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createFlatColorTileDrawRecord();

/**
 * Send one flat colour tile record to the GPU and draw it.
 *
 * @param {object} gl webgl context
 * @param {object} record draw record
 * @param {object} program the class program
 * @param {WebGLBuffer} buffer the class quad
 */
function drawFlatColorTileRecord(gl, record, program, buffer) {
	gl.uniform3fv(program.uniform.uPosition, record.position);
	gl.uniform1f(program.uniform.uSize, record.params.size);
	gl.uniform4fv(program.uniform.uColor, record.color);

	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.drawArrays(gl.TRIANGLES, 0, record.params.vertexCount);
}

/**
 * Observe every FlatColorTile draw (all colours) as a backend-neutral record. Each
 * observed draw gets a fresh record object, so sinks may keep it.
 *
 * @param {function} sink called with each draw record
 * @returns {function} unsubscribe
 */
function addRecordSink(sink) {
	_recordSinks.add(sink);
	return () => _recordSinks.delete(sink);
}

createFlatColorTile.addRecordSink = addRecordSink;

export default createFlatColorTile;

/**
 * Get (or create and cache by name) the FlatColorTile class of a colour.
 *
 * @param {string} name cache key (a cached class keeps its first colour)
 * @param {object} spec { r, g, b, a = 0.5 } in 0..1
 * @returns {Function} FlatColorTile class
 */
function createFlatColorTile(name, spec) {
	let _program, _buffer;
	if (_cache[name]) {
		return _cache[name];
	}
	if (spec.a === undefined) {
		spec.a = 0.5;
	}

	[spec.r, spec.g, spec.b, spec.a].forEach(function (value) {
		if (value === undefined) {
			throw new Error('FlatColorTile: need to pass r, g, b, a');
		}
		if (value > 1.0 || value < 0.0) {
			throw new Error('FlatColorTile: r, g, b, a need to be 0.0-1.0');
		}
	});

	class FlatColorTile {
		constructor(pos, startTick) {
			this.position = pos;
		}

		init(gl) {
			this.ready = true;
		}

		free(gl) {
			this.ready = false;
		}

		static addRecordSink(sink) {
			return addRecordSink(sink);
		}

		render(gl, tick) {
			if (_program === undefined) {
				return;
			} // temporal hotfix to avoid crash
			// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
			const observed = _recordSinks.size > 0;
			const record = observed ? createFlatColorTileDrawRecord() : _scratchRecord;
			record.pass = (this.renderBeforeEntities ?? FlatColorTile.renderBeforeEntities) ? 'before' : 'after';
			record.position = observed ? Array.from(this.position) : this.position;
			record.color = [spec.r, spec.g, spec.b, spec.a];
			_recordSinks.forEach(sink => sink(record));
			drawFlatColorTileRecord(gl, record, _program, _buffer);
		}

		static init(gl) {
			_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);
			_buffer = gl.createBuffer();

			gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				new Float32Array([
					-1.0, -1.0, 0.0, 0.0, +1.0, -1.0, 1.0, 0.0, +1.0, +1.0, 1.0, 1.0, +1.0, +1.0, 1.0, 1.0, -1.0, +1.0,
					0.0, 1.0, -1.0, -1.0, 0.0, 0.0
				]),
				gl.STATIC_DRAW
			);
			FlatColorTile.ready = true;
		}

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

		static beforeRender(gl, modelView, projection, fog, tick) {
			const uniform = _program.uniform;
			const attribute = _program.attribute;

			gl.useProgram(_program);

			gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
			gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection);

			gl.enableVertexAttribArray(attribute.aPosition);

			gl.bindBuffer(gl.ARRAY_BUFFER, _buffer);

			gl.vertexAttribPointer(attribute.aPosition, 2, gl.FLOAT, false, 4 * 4, 0);
		}

		static afterRender(gl) {
			gl.disableVertexAttribArray(_program.attribute.aPosition);
		}
	}

	FlatColorTile._uid = name;
	FlatColorTile.renderBeforeEntities = true;
	_cache[name] = FlatColorTile;

	return FlatColorTile;
}
