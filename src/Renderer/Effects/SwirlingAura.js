/**
 * Renderer/Effects/SwirlingAura.js
 *
 * Swirling aura band effect
 * Based on original inspiration game Level99()
 *
 * From original inspiration game:
 * - Three bands with different parameters:
 *   GI[0]: RotStart=0°, max_height=15, distance=3.9, rise_angle=55°
 *   GI[1]: RotStart=90°, max_height=13, distance=4.1, rise_angle=50°
 *   GI[2]: RotStart=180°, max_height=11, distance=4.3, rise_angle=45°
 * - Spin speed: RotStart += (ec + 3) per frame (3°, 4°, 5° per band)
 * - 21 divisions, 315° arc
 * - Height profile: height[i] = max_height * sin(SinLimit) * sin(process°)
 *   where SinLimit = 90° + (i - 10) * 9°
 * - Render: base ring at distance, top offset by rotated height
 */

import _vertexShader from './SwirlingAura.vs?raw';
import _fragmentShader from './SwirlingAura.fs?raw';
import WebGL from 'Utils/WebGL.js';
import glMatrix from 'Utils/gl-matrix.js';
import Client from 'Core/Client.js';
import Altitude from 'Renderer/Map/Altitude.js';
import SpriteRenderer from 'Renderer/SpriteRenderer.js';

const mat4 = glMatrix.mat4;

/**
 * @var {WebGLProgram}
 */
let _program;

/**
 * @var {mat4}
 */
const _modelMatrix = mat4.create();

/**
 * Constants from original inspiration game
 */
const E_DIVISION = 21; // Number of divisions (0-20)
const FULL_DISPLAY_ANGLE = 315; // 315° arc
const DEG_TO_RAD = Math.PI / 180;
const STRIDE = 5; // x, y, z, u, v
const VERTICES_PER_BAND = E_DIVISION * 2;

/**
 * Additive blend of the aura families (R-EFX-014), set once per pass in beforeRender.
 */
const BLEND_ADDITIVE = Object.freeze({ src: 'SRC_ALPHA', dst: 'ONE' });

/**
 * @var {boolean} scene fog state uploaded by the last beforeRender
 */
let _fogUse = false;

/**
 * Create an empty SwirlingAura draw record (backend-neutral EffectDraw shape, see
 * modernized/webgpu-reimagined/render-records).
 *
 * One record per band: an indexed strip, additive, depth test on and depth write off
 * (SpriteRenderer.runWithDepth(true, false, false)).
 *
 * position: model translation as uploaded (legacy GL space: x + 0.5, −ground height, y + 0.5).
 * params:
 *  - band: band index (0..2)
 *  - rotStart: band rotation start in degrees
 *  - vertices: E_DIVISION·2 vertices (x, y, z, u, v), base then top per division, in model space
 *  - indexCount: shared index buffer length
 *  - zIndex: 0.01 + band · 0.001
 *
 * @returns {object} record
 */
function createSwirlingAuraDrawRecord() {
	return {
		kind: 'effect',
		family: 'swirlingAura',
		pass: 'before',
		texture: null,
		position: null,
		color: null,
		blend: BLEND_ADDITIVE,
		depthTest: true,
		depthWrite: false,
		depthCorrection: false,
		fog: false,
		strAttachment: false,
		params: {
			band: 0,
			rotStart: 0,
			vertices: null,
			indexCount: 0,
			zIndex: 0
		}
	};
}

/**
 * Snapshot one SwirlingAura band draw into a record (the band's mesh must be filled).
 *
 * @param {object} record to fill
 * @param {SwirlingAura} effect
 * @param {number} ec band index
 * @param {Array} translation model translation of this render
 * @param {boolean} keep true when the record outlives the draw (arrays copied)
 * @returns {object} record
 */
function fillSwirlingAuraDrawRecord(record, effect, ec, translation, keep) {
	const params = record.params;
	const color = record.color ?? (record.color = new Array(4));

	record.pass = (effect.renderBeforeEntities ?? SwirlingAura.renderBeforeEntities) ? 'before' : 'after';
	record.texture = effect.texture;
	record.position = keep ? translation.slice() : translation;
	color[0] = effect.color.r;
	color[1] = effect.color.g;
	color[2] = effect.color.b;
	color[3] = effect.alphaB;
	record.fog = _fogUse;

	params.band = ec;
	params.rotStart = effect.bands[ec].rotStart;
	params.vertices = keep ? effect.vertices.slice() : effect.vertices;
	params.indexCount = effect.indexCount;
	params.zIndex = 0.01 + ec * 0.001;

	return record;
}

/**
 * Send one SwirlingAura band record to the GPU and draw it.
 *
 * @param {object} gl webgl context
 * @param {object} record SwirlingAura draw record
 * @param {WebGLBuffer} vertexBuffer the band's dynamic vertex buffer
 * @param {WebGLBuffer} indexBuffer the instance's shared index buffer
 */
function drawSwirlingAuraRecord(gl, record, vertexBuffer, indexBuffer) {
	const uniform = _program.uniform;
	const attribute = _program.attribute;
	const params = record.params;
	const color = record.color;

	// Upload vertex data
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, params.vertices);

	gl.vertexAttribPointer(attribute.aPosition, 3, gl.FLOAT, false, STRIDE * 4, 0);
	gl.vertexAttribPointer(attribute.aTextureCoord, 2, gl.FLOAT, false, STRIDE * 4, 3 * 4);

	// Set color and alpha
	gl.uniform4f(uniform.uColor, color[0], color[1], color[2], color[3]);
	gl.uniform1f(uniform.uZIndex, params.zIndex);

	// Draw
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.drawElements(gl.TRIANGLES, params.indexCount, gl.UNSIGNED_SHORT, 0);
}

/**
 * @var {Set<function>} record observers
 */
const _recordSinks = new Set();

/**
 * @var {object} reused record when nobody observes (no per-draw allocation)
 */
const _scratchRecord = createSwirlingAuraDrawRecord();

/**
 * SwirlingAura constructor
 *
 * Creates THREE bands as per original inspiration game:
 * - GI[0]: RotStart=0°, max_height=15, distance=3.9, rise_angle=55°
 * - GI[1]: RotStart=90°, max_height=13, distance=4.1, rise_angle=50°
 * - GI[2]: RotStart=180°, max_height=11, distance=4.3, rise_angle=45°
 */
class SwirlingAura {
	constructor(position, textureName, tick, sizeType) {
		this.position = position;
		this.textureName = textureName;
		this.tick = tick;
		this.sizeType = sizeType || 4; // 4 = blue, 7 = green

		// Scale factor: original inspiration game units to world units
		const GAME_TO_WORLD = 0.1 * 2.2; // Adjusted for visual match

		// Color based on m_size (4 = blue, 7 = green)
		if (this.sizeType === 7) {
			this.color = { r: 100 / 255, g: 255 / 255, b: 100 / 255 };
		} else {
			this.color = { r: 100 / 255, g: 100 / 255, b: 255 / 255 };
		}

		// Alpha from original inspiration game: alphaB = 120
		this.alphaB = 120 / 255;

		// Create THREE bands with different parameters
		const INNER_CIRCLE_SCALE = 0.6;
		this.bands = [];
		for (let ec = 0; ec < 3; ec++) {
			this.bands.push({
				life: 1,
				initialRotStart: ec * 90, // 0, 90, 180 degrees
				rotStart: ec * 90,
				maxHeight: (15 - 2 * ec) * GAME_TO_WORLD, // 15, 13, 11 (unchanged)
				distance: (3.9 + 0.2 * ec) * GAME_TO_WORLD * INNER_CIRCLE_SCALE, // 20% smaller
				riseAngle: (55 - 5 * ec) * DEG_TO_RAD, // 55°, 50°, 45°
				spinSpeed: ec + 3, // 3, 4, 5 degrees per 25ms tick
				height: new Float32Array(E_DIVISION) // Height profile
			});
		}

		// Angle step between divisions
		this.basicAngle = FULL_DISPLAY_ANGLE / (E_DIVISION - 1); // 315/20 = 15.75°

		// Vertex data for a single band (GC evasion uses dynamic vertex data)
		this.vertices = new Float32Array(VERTICES_PER_BAND * STRIDE);

		// Vertex buffers for each band
		this.buffers = null;
		this.indexBuffer = null;
		this.indexCount = 0;
		this.ready = false;
	}

	/**
	 * Update height profile for a band
	 */
	updateHeightProfile(band, process) {
		const middle = 10;
		const step = 9; // 90 / 10 = 9 degrees

		for (let i = 0; i < E_DIVISION; i++) {
			// SinLimit = 90° + (i - middle) * step
			const sinLimit = (90 + (i - middle) * step) * DEG_TO_RAD;
			const sinLimitValue = Math.sin(sinLimit);
			const maxPossible = band.maxHeight * sinLimitValue;

			if (process <= 90) {
				// Build up phase: height = max_height * sin(SinLimit) * sin(process°)
				const sinProcess = Math.sin(process * DEG_TO_RAD);
				band.height[i] = Math.max(0, Math.min(band.maxHeight * sinLimitValue * sinProcess, maxPossible));
			} else {
				band.height[i] = maxPossible;
			}
		}
	}

	/**
	 * fill mesh for a single band
	 */
	fillBandMesh(band) {
		const verts = this.vertices;
		const cosRise = Math.cos(band.riseAngle);
		const sinRise = Math.sin(band.riseAngle);
		let offset = 0;

		for (let k = 0; k < E_DIVISION; k++) {
			// Calculate angle for this division
			const angle = (band.rotStart + k * this.basicAngle) * DEG_TO_RAD;
			const cosAngle = Math.cos(angle);
			const sinAngle = Math.sin(angle);

			// Calculate base and top vertices
			const baseX = band.distance * cosAngle;
			const baseZ = band.distance * sinAngle;
			const h = band.height[k];

			// Calculate top vertex offset based on rise angle
			const Rx = cosRise * h;
			const Ry = sinRise * h;

			// Top vertex position
			const topX = baseX + Rx * cosAngle;
			const topY = -Ry;
			const topZ = baseZ + Rx * sinAngle;

			// Texture coordinate u based on division index
			const u = k / (E_DIVISION - 1);

			// Vértice Base (Inner)
			verts[offset++] = baseX;
			verts[offset++] = 0;
			verts[offset++] = baseZ;
			verts[offset++] = u;
			verts[offset++] = 1.0;

			// Vértice Top (Outer)
			verts[offset++] = topX;
			verts[offset++] = topY;
			verts[offset++] = topZ;
			verts[offset++] = u;
			verts[offset++] = 0.0;
		}
	}

	/**
	 * Generate index buffer
	 */
	generateIndices() {
		const indices = [];
		for (let k = 0; k < E_DIVISION - 1; k++) {
			const i0 = k * 2; // Base of current
			const i1 = k * 2 + 1; // Top of current
			const i2 = k * 2 + 2; // Base of next
			const i3 = k * 2 + 3; // Top of next
			// Two triangles: (i0, i1, i2) and (i1, i3, i2)
			indices.push(i0, i1, i2, i1, i3, i2);
		}
		return new Uint16Array(indices);
	}

	/**
	 * Initialize instance
	 */
	init(gl) {
		// Create vertex buffers for each band
		this.buffers = [];
		for (let i = 0; i < this.bands.length; i++) {
			const buf = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			// Allocate buffer with initial size (will be updated each frame)
			gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);
			this.buffers.push(buf);
		}

		// Create shared index buffer
		const indices = this.generateIndices();
		this.indexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
		this.indexCount = indices.length;

		// Load texture
		Client.loadFile(`data/texture/effect/${this.textureName}`, buffer => {
			WebGL.texture(gl, buffer, texture => {
				this.texture = texture;
				this.ready = true;
			});
		});
	}

	/**
	 * Free instance resources
	 */
	free(gl) {
		if (this.buffers) {
			for (let i = 0; i < this.buffers.length; i++) {
				gl.deleteBuffer(this.buffers[i]);
			}
			this.buffers = null;
		}
		if (this.indexBuffer) {
			gl.deleteBuffer(this.indexBuffer);
			this.indexBuffer = null;
		}
		this.ready = false;
	}

	/**
	 * Render all three bands
	 */
	render(gl, tick) {
		const uniform = _program.uniform;
		const attribute = _program.attribute;

		// Get ground height
		const groundZ = Altitude.getCellHeight(this.position[0], this.position[1]);
		const translation = [this.position[0] + 0.5, -groundZ, this.position[1] + 0.5];

		// Build model matrix
		mat4.identity(_modelMatrix);
		mat4.translate(_modelMatrix, _modelMatrix, translation);

		gl.uniformMatrix4fv(uniform.uModelMat, false, _modelMatrix);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);

		gl.enableVertexAttribArray(attribute.aPosition);
		gl.enableVertexAttribArray(attribute.aTextureCoord);
		const RAG_TICK_MS = 25;
		const elapsed = tick - this.tick;
		const process = elapsed / RAG_TICK_MS;

		SpriteRenderer.runWithDepth(true, false, false, () => {
			// Observed draws get their own record; otherwise reuse one (no per-draw allocation).
			const observed = _recordSinks.size > 0;
			// Render each band
			for (let ec = 0; ec < this.bands.length; ec++) {
				const band = this.bands[ec];
				if (!band.life) {
					continue;
				}

				// Update animation purely from elapsed time (Prim3DCasting)
				band.rotStart = (band.initialRotStart + process * band.spinSpeed) % 360;

				// Update height profile
				this.updateHeightProfile(band, process);

				// fill mesh for this band
				this.fillBandMesh(band);

				const record = fillSwirlingAuraDrawRecord(
					observed ? createSwirlingAuraDrawRecord() : _scratchRecord,
					this,
					ec,
					translation,
					observed
				);
				_recordSinks.forEach(sink => sink(record));
				drawSwirlingAuraRecord(gl, record, this.buffers[ec], this.indexBuffer);
			}
		});
	}

	/**
	 * Observe every SwirlingAura band draw as a backend-neutral record. Each observed draw
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
	 * Initialize static resources
	 */
	static init(gl) {
		_program = WebGL.createShaderProgram(gl, _vertexShader, _fragmentShader);

		this.ready = true;
		this.renderBeforeEntities = true;
	}

	/**
	 * Free static resources
	 */
	static free(gl) {
		if (_program) {
			gl.deleteProgram(_program);
			_program = null;
		}
		this.ready = false;
	}

	/**
	 * Before render setup
	 */
	static beforeRender(gl, modelView, projection, fog, tick) {
		const uniform = _program.uniform;
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blend

		gl.useProgram(_program);

		gl.uniformMatrix4fv(uniform.uModelViewMat, false, modelView);
		gl.uniformMatrix4fv(uniform.uProjectionMat, false, projection);

		// Fog
		gl.uniform1i(uniform.uFogUse, fog.use && fog.exist);
		_fogUse = !!(fog.use && fog.exist);
		gl.uniform1f(uniform.uFogNear, fog.near);
		gl.uniform1f(uniform.uFogFar, fog.far);
		gl.uniform3fv(uniform.uFogColor, fog.color);

		gl.activeTexture(gl.TEXTURE0);
		gl.uniform1i(uniform.uDiffuse, 0);
	}

	/**
	 * After render cleanup
	 */
	static afterRender(gl) {
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		gl.disableVertexAttribArray(_program.attribute.aPosition);
		gl.disableVertexAttribArray(_program.attribute.aTextureCoord);
	}
}
export default SwirlingAura;
