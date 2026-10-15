/**
 * Shared page helpers of the parity pages (parity.js, entities.js): canvases,
 * draw-call counting, read-back, the per-pixel comparison and the diff image.
 */

/**
 * @param {{width: number, height: number, antialias: boolean, tolerance: number, clearColor: number[]}} options
 */
export function createPageKit({ width, height, antialias, tolerance, clearColor }) {
	const background = clearColor.map(v => Math.round(v * 255));

	function makeCanvas(label) {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		canvas.title = label;
		document.getElementById('canvases').append(canvas);
		const gl = canvas.getContext('webgl2', {
			alpha: false,
			depth: true,
			stencil: false,
			antialias,
			premultipliedAlpha: false,
			preserveDrawingBuffer: true
		});
		if (!gl) {
			throw new Error('WebGL2 unavailable');
		}
		return { canvas, gl };
	}

	/** Count draw calls on one context without touching the renderers. */
	function countDraws(gl) {
		const counts = { drawArrays: 0, drawArraysInstanced: 0 };
		for (const name of Object.keys(counts)) {
			const original = gl[name].bind(gl);
			gl[name] = (...args) => {
				counts[name]++;
				return original(...args);
			};
		}
		return counts;
	}

	function clear(gl) {
		gl.viewport(0, 0, width, height);
		gl.clearColor(...clearColor);
		gl.clearDepth(1);
		gl.depthMask(true);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	function readPixels(gl) {
		const out = new Uint8Array(width * height * 4);
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
		return out;
	}

	function compare(a, b) {
		let maxDiff = 0;
		let differing = 0;
		let overTolerance = 0;
		let covered = 0;
		const histogram = new Array(9).fill(0); // max channel diff buckets: 0,1,2,3,4-7,8-15,16-63,64-127,128+
		for (let i = 0; i < a.length; i += 4) {
			let d = 0;
			for (let c = 0; c < 4; c++) {
				d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
			}
			if (a[i] !== background[0] || a[i + 1] !== background[1] || a[i + 2] !== background[2]) {
				covered++;
			}
			maxDiff = Math.max(maxDiff, d);
			if (d > 0) {
				differing++;
			}
			if (d > tolerance) {
				overTolerance++;
			}
			const bucket = d < 4 ? d : d < 8 ? 4 : d < 16 ? 5 : d < 64 ? 6 : d < 128 ? 7 : 8;
			histogram[bucket]++;
		}
		const pixels = a.length / 4;
		return {
			pixels,
			coveredPct: (100 * covered) / pixels,
			maxDiff,
			differing,
			differingPct: (100 * differing) / pixels,
			overTolerance,
			overTolerancePct: (100 * overTolerance) / pixels,
			histogram
		};
	}

	/** Diff image (amplified ×16, red) as a data URL, flipped to screen orientation. */
	function diffImage(a, b) {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		const img = ctx.createImageData(width, height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const s = ((height - 1 - y) * width + x) * 4;
				const d = (y * width + x) * 4;
				let m = 0;
				for (let c = 0; c < 3; c++) {
					m = Math.max(m, Math.abs(a[s + c] - b[s + c]));
				}
				img.data[d] = Math.min(255, m * 16);
				img.data[d + 1] = a[s + 1] >> 2;
				img.data[d + 2] = a[s + 2] >> 2;
				img.data[d + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		document.getElementById('canvases').append(canvas);
		return canvas.toDataURL('image/png');
	}

	return { makeCanvas, countDraws, clear, readPixels, compare, diffImage };
}

/**
 * Column-major view and projection matrices of a legacy-style camera looking at a map
 * cell: pitched `pitch`°, yawed `yaw`°, `distance` units back (Renderer.vFov-style fovy).
 * @param {{target: number[], distance: number, pitch: number, yaw: number, fovy: number}} camera
 * @param {number} width
 * @param {number} height
 */
export function cameraMatrices({ target, distance, pitch, yaw, fovy }, width, height) {
	const mul = (a, b) => {
		const out = new Float32Array(16);
		for (let c = 0; c < 4; c++) {
			for (let r = 0; r < 4; r++) {
				let s = 0;
				for (let k = 0; k < 4; k++) {
					s += a[k * 4 + r] * b[c * 4 + k];
				}
				out[c * 4 + r] = s;
			}
		}
		return out;
	};
	const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	const translate = (x, y, z) => Object.assign(ident(), { 12: x, 13: y, 14: z });
	const rotX = deg => {
		const r = (deg * Math.PI) / 180;
		return Object.assign(ident(), { 5: Math.cos(r), 6: Math.sin(r), 9: -Math.sin(r), 10: Math.cos(r) });
	};
	const rotY = deg => {
		const r = (deg * Math.PI) / 180;
		return Object.assign(ident(), { 0: Math.cos(r), 2: -Math.sin(r), 8: Math.sin(r), 10: Math.cos(r) });
	};
	const modelView = [
		translate(0, -1, -distance),
		rotX(pitch),
		rotY(yaw),
		translate(-target[0] - 0.5, 0, -target[1] - 0.5)
	].reduce(mul);
	const f = 1 / Math.tan(((fovy / 2) * Math.PI) / 180);
	const near = 1;
	const far = 1000;
	const projection = new Float32Array([
		f / (width / height),
		0,
		0,
		0,
		0,
		f,
		0,
		0,
		0,
		0,
		(far + near) / (near - far),
		-1,
		0,
		0,
		(2 * far * near) / (near - far),
		0
	]);
	return { modelView, projection };
}
