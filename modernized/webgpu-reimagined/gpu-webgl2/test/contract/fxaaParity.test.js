import { describe, expect, it } from 'vitest';
import * as webgl2 from '../../src/post/fxaa.js';
import { fxaaUniforms as webgl2Uniforms } from '../../src/post/PostChain.js';
// Contract only: the sibling backend's CPU reference is read here to prove the two stay identical.
import * as webgpu from '../../../gpu-webgpu/src/post/fxaa.js';
import { fxaaUniforms as webgpuUniforms } from '../../../gpu-webgpu/src/post/postChain.js';
import { diagonalImage, dotImage, eachPixel, lcg, noiseImage, stepImage } from '../support/fxaaImages.js';

const SUBPIX = [0, 0.25, 0.5, 0.75, 1];
const THRESHOLDS = [0.063, 0.125, 0.166, 0.25, 0.333];
const IMAGES = [stepImage(), diagonalImage(), dotImage(), ...[1, 2, 3, 4, 5].map(seed => noiseImage(seed))];

describe('R-PP-006 FXAA backend parity (HITL round 2)', () => {
	it('both backends upload the same FXAA parameters', () => {
		for (const fxaaSubpix of SUBPIX) {
			for (const fxaaEdgeThreshold of THRESHOLDS) {
				const a = webgl2Uniforms({ fxaaSubpix, fxaaEdgeThreshold });
				const b = webgpuUniforms({ fxaaSubpix, fxaaEdgeThreshold });
				const { subpixUsed, ...rest } = a;
				expect(subpixUsed).toBe(true);
				expect(rest).toEqual(b);
			}
		}
	});

	it('fxaaSubpixH agrees on a grid of 3x3 neighbourhoods', () => {
		const r = lcg(42);
		for (let i = 0; i < 500; i++) {
			const l = { m: r(), n: r(), s: r(), w: r(), e: r(), nw: r(), ne: r(), sw: r(), se: r() };
			for (const subpix of SUBPIX) {
				expect(webgl2.fxaaSubpixH(l, subpix)).toBe(webgpu.fxaaSubpixH(l, subpix));
			}
			expect(webgl2.fxaaAcrossOffset(l)).toEqual(webgpu.fxaaAcrossOffset(l));
		}
	});

	it('fxaaReference agrees pixel for pixel over images x subpix x edge threshold', () => {
		for (const img of IMAGES) {
			for (const fxaaSubpix of SUBPIX) {
				for (const fxaaEdgeThreshold of THRESHOLDS) {
					const a = eachPixel(img, s => webgl2.fxaaReference(s, webgl2Uniforms({ fxaaSubpix, fxaaEdgeThreshold })));
					const b = eachPixel(img, s => webgpu.fxaaReference(s, webgpuUniforms({ fxaaSubpix, fxaaEdgeThreshold })));
					expect(a).toEqual(b);
				}
			}
		}
	});
});
