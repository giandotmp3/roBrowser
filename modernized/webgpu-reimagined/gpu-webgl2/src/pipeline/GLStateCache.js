import { GL } from './glEnums.js';
import { toGlBlend, usesBlendConstant } from './blendMap.js';

/** GL's default blend colour; legacy never sets another (D3D 14/15, GL-order 11…14). */
export const LEGACY_BLEND_CONSTANT = Object.freeze([0, 0, 0, 0]);

/**
 * Tracks GL state so a run only issues the calls whose state actually
 * changes, and always returns to the R-CTX-002 default after a pass.
 */
export class GLStateCache {
	/** @param {WebGL2RenderingContext} gl */
	constructor(gl) {
		this.gl = gl;
		this.reset();
	}

	/** Forget cached values (after context restore). */
	reset() {
		this._blend = null;
		this._depthTest = null;
		this._depthWrite = null;
	}

	/**
	 * Apply one run's pipeline state.
	 * @param {{blend: import('../ports.js').BlendState, depthTest: boolean, depthWrite: boolean, blendConstant?: [number, number, number, number]}} state
	 */
	apply(state) {
		const { gl } = this;
		const { src, dst } = toGlBlend(state.blend);
		const blendId = `${src}|${dst}`;
		if (this._blend !== blendId) {
			gl.blendFunc(src, dst);
			this._blend = blendId;
		}
		if (usesBlendConstant(state.blend)) {
			// Legacy never calls gl.blendColor: the constant is the GL default (0, 0, 0, 0).
			const [r, g, b, a] = state.blendConstant ?? LEGACY_BLEND_CONSTANT;
			gl.blendColor(r, g, b, a);
		}
		if (this._depthTest !== state.depthTest) {
			if (state.depthTest) {
				gl.enable(GL.DEPTH_TEST);
			} else {
				gl.disable(GL.DEPTH_TEST);
			}
			this._depthTest = state.depthTest;
		}
		if (this._depthWrite !== state.depthWrite) {
			gl.depthMask(state.depthWrite);
			this._depthWrite = state.depthWrite;
		}
	}

	/** R-CTX-002: every pass that changed blend restores the default afterwards. */
	restoreDefault() {
		this.apply({ blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' }, depthTest: true, depthWrite: true });
	}
}
