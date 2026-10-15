import { GL } from './glEnums.js';

/**
 * Compile and link a GLSL 300 es program. Throws with the info log on failure
 * (R-CTX-005 treats a throw during render as a frame error).
 * @param {WebGL2RenderingContext} gl
 * @param {string} vertexSource
 * @param {string} fragmentSource
 * @returns {WebGLProgram}
 */
export function createProgram(gl, vertexSource, fragmentSource) {
	const compile = (type, source) => {
		const shader = gl.createShader(type);
		// `#version` must be the first token: drop a BOM or leading whitespace.
		gl.shaderSource(shader, source.replace(/^\uFEFF?\s*/, ''));
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, GL.COMPILE_STATUS)) {
			const log = gl.getShaderInfoLog(shader);
			gl.deleteShader(shader);
			throw new Error(`${type === GL.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log}`);
		}
		return shader;
	};
	const program = gl.createProgram();
	const vs = compile(GL.VERTEX_SHADER, vertexSource);
	const fs = compile(GL.FRAGMENT_SHADER, fragmentSource);
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(program, GL.LINK_STATUS)) {
		throw new Error(`program link: ${gl.getProgramInfoLog(program)}`);
	}
	return program;
}
