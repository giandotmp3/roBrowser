/**
 * C-14 GR2 pass on gpu-webgl2: residency (types, emblems), the pipeline's per-instance
 * GL sequence and the R-GR2-001/002/006 GPU-side rules, against the recording fake GL.
 */
import { describe, expect, it } from 'vitest';
import { WebGL2Backend } from '../../src/WebGL2Backend.js';
import { GL } from '../../src/pipeline/glEnums.js';
import { SHADERS } from '../../src/shaders/index.js';
import { GR2_ALPHA_REF } from '../../src/constants.js';
import {
	emblemTexels,
	gr2Basename,
	gr2LightUniforms,
	gr2Profile,
	gr2Route,
	interleaveGr2Mesh,
	keyGr2Magenta
} from '../../src/gr2/gr2.js';
import { GR2_BONES_BINDING } from '../../src/gr2/Gr2Pipeline.js';
import { createFakeCanvas, createFakeGl, createFakePorts } from '../support/fakeGl.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function mesh({ texFile = 'body.bmp', emblem = false } = {}) {
	return {
		vcount: 3,
		indices: new Uint16Array([0, 1, 2]),
		bind: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
		uv: new Float32Array([0, 0, 1, 0, 0, 1]),
		bidx: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
		bw: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
		texFile,
		emblem
	};
}

const TYPES = {
	'data/model/3dmob/guildflag90_1.gr2': {
		meshes: [mesh(), mesh({ texFile: '', emblem: true })],
		textures: [{ name: 'body.bmp', width: 2, height: 1, pixels: new Uint8Array([255, 0, 255, 255, 9, 9, 9, 255]) }]
	},
	'data/model/3dmob/empelium90_0.gr2': {
		meshes: [mesh(), mesh({ texFile: 'missing.bmp' })],
		textures: [{ name: 'body.bmp', width: 1, height: 1, pixels: null }]
	}
};

function setup({ emblems = {} } = {}) {
	const gl = createFakeGl();
	const canvas = createFakeCanvas({ contexts: { webgl2: gl } });
	const requests = [];
	const gr2 = {
		type: path => {
			requests.push(path);
			return TYPES[path] ?? null;
		},
		emblem: handle => emblems[handle] ?? null
	};
	const fakeCanvas = () => ({
		getContext: () => ({
			drawImage() {},
			getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(0xff) })
		})
	});
	const backend = new WebGL2Backend({ ...createFakePorts(), canvas, gr2, createCanvas: fakeCanvas }).init();
	return { gl, canvas, backend, requests };
}

function record(type, { alpha = 1, bones = new Float32Array(32), emblem = null } = {}) {
	return {
		kind: 'world',
		part: 'gr2',
		alpha,
		matrices: bones,
		blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
		depthTest: true,
		depthWrite: true,
		params: { type: `data/model/3dmob/${type}.gr2`, world: IDENTITY, emblem }
	};
}

const view = { modelView: IDENTITY, projection: IDENTITY, fog: { use: false, near: 0, far: 1, color: [0, 0, 0] } };
const frameOf = records => ({ passes: { gr2Models: records }, view, world: {} });

describe('C-14 GR2 helpers', () => {
	it('R-GR2-001 roster uses the legacy basenames; profile from the path', () => {
		expect(gr2Basename('data\\model\\3dmob\\KGuardian90_7.gr2')).toBe('kguardian90_7');
		expect(gr2Profile('data/model/3dmob/guildflag90_1.gr2')).toBe('flag');
		expect(gr2Profile('data/model/3dmob/sguardian90_9.gr2')).toBe('emp');
		expect(gr2Profile('data/model/3dmob/dragon_5.gr2')).toBeNull();
		expect(gr2Route('data/model/3dmob/aguardian90_8.gr2').mode).toBe('gr2');
	});

	it('R-GR2-001 light uniforms: flag grey-broadcasts the map ambient (Rec.601), others are fixed', () => {
		const flag = gr2LightUniforms('a/guildflag90_1.gr2', { ambient: [1, 0, 0] });
		expect(Array.from(flag.diffuse)).toEqual(Array(3).fill(Math.fround(100 / 255)));
		expect(Array.from(flag.ambient)).toEqual(Array(3).fill(Math.fround(0.299)));
		const emp = gr2LightUniforms('a/treasurebox_2.gr2', { ambient: [1, 0, 0] });
		expect(Array.from(emp.diffuse)).toEqual(Array(3).fill(Math.fround(128 / 255)));
		expect(Array.from(emp.ambient)).toEqual(Array(3).fill(Math.fround(127 / 255)));
	});

	it('type textures: magenta keyed only when fully opaque', () => {
		const opaque = new Uint8Array([250, 5, 249, 255, 1, 2, 3, 255]);
		expect(Array.from(keyGr2Magenta(opaque))).toEqual([0, 0, 0, 0, 1, 2, 3, 255]);
		const own = new Uint8Array([250, 5, 249, 255, 1, 2, 3, 128]);
		expect(keyGr2Magenta(own)).toBe(own);
	});

	it('R-GR2-006 emblem texels: key, then A4R4G4B4 on all four channels', () => {
		const px = new Uint8Array([0x12, 0x34, 0x56, 0xcf, 255, 0, 255, 255]);
		expect(Array.from(emblemTexels(px))).toEqual([0x11, 0x33, 0x55, 0xcc, 0, 0, 0, 0]);
	});

	it('interleave: 16 floats per vertex (pos, normal, uv, bone index, bone weight)', () => {
		const buf = interleaveGr2Mesh(mesh());
		expect(buf).toHaveLength(48);
		expect(Array.from(buf.subarray(16, 32))).toEqual([1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
	});

	it('shaders: a 48-matrix std140 bone block, legacy skinning and the 207/255 alpha ref', () => {
		expect(SHADERS.gr2Vert).toContain('mat4 uBones[48];');
		expect(SHADERS.gr2Vert).toContain('vLightWeighting = (1.0 - uLightOpacity) + lightWeight * uLightOpacity;');
		expect(SHADERS.gr2Frag).toContain('float depth = gl_FragCoord.z / gl_FragCoord.w;');
	});
});

describe('C-14 GR2 pass (R-CTX-010 step 11)', () => {
	it('uploads each type once on miss, one VAO/VBO/IBO per submesh, LINEAR + CLAMP textures', () => {
		const { gl, backend, requests } = setup();
		const frame = frameOf([record('empelium90_0'), record('empelium90_0')]);
		backend.drawFrame(frame);
		backend.drawFrame(frame);
		expect(requests).toEqual(['data/model/3dmob/empelium90_0.gr2']);
		expect(gl.callsTo('createVertexArray')).toHaveLength(2);
		expect(gl.callsTo('bufferData').filter(c => c[1] === GL.ELEMENT_ARRAY_BUFFER)).toHaveLength(2);
		// missing pixels → 200 grey; unknown texFile → the 180/180/185 stand-in
		const uploads = gl.callsTo('texImage2D').map(c => Array.from(c[9]));
		expect(uploads).toEqual([
			[200, 200, 200, 255],
			[180, 180, 185, 255]
		]);
		const wraps = gl.callsTo('texParameteri').filter(c => c[2] === GL.TEXTURE_WRAP_S);
		expect(wraps.every(c => c[3] === GL.CLAMP_TO_EDGE)).toBe(true);
		// two instances × two submeshes, per frame
		expect(gl.callsTo('drawElements')).toHaveLength(8);
		expect(gl.callsTo('drawElements')[0]).toEqual(['drawElements', GL.TRIANGLES, 3, GL.UNSIGNED_SHORT, 0]);
	});

	it('shared palettes upload once; each instance binds its 48-matrix range', () => {
		const { gl, backend } = setup();
		const shared = new Float32Array(16).fill(1);
		backend.drawFrame(
			frameOf([
				record('empelium90_0', { bones: shared }),
				record('empelium90_0', { bones: new Float32Array(16) }),
				record('empelium90_0', { bones: shared })
			])
		);
		const ubo = gl.callsTo('bufferData').filter(c => c[1] === GL.UNIFORM_BUFFER);
		expect(ubo).toHaveLength(1);
		expect(ubo[0][2].length).toBe((2 * 3072) / 4);
		expect(backend.gr2.lastPalettes).toBe(2);
		const ranges = gl.callsTo('bindBufferRange').map(c => [c[2], c[4], c[5]]);
		expect(ranges).toEqual([
			[GR2_BONES_BINDING, 0, 3072],
			[GR2_BONES_BINDING, 3072, 3072],
			[GR2_BONES_BINDING, 0, 3072]
		]);
	});

	it('R-GR2-002: no blend, alpha ref 207/255; R-GR2-005: blending only for an instance with alpha < 1', () => {
		const { gl, backend } = setup();
		gl.clearCalls();
		backend.drawFrame(frameOf([record('empelium90_0'), record('empelium90_0', { alpha: 0.5 })]));
		const seq = gl.calls.filter(c => (c[0] === 'enable' || c[0] === 'disable') && c[1] === GL.BLEND).map(c => c[0]);
		expect(seq).toEqual(['disable', 'enable', 'disable', 'enable']);
		const alphaRef = gl.callsTo('uniform1f').find(c => c[1].uniform === 'uAlphaRef');
		expect(alphaRef[2]).toBe(GR2_ALPHA_REF);
		const alphas = gl
			.callsTo('uniform1f')
			.filter(c => c[1].uniform === 'uAlpha')
			.map(c => c[2]);
		expect(alphas).toEqual([1, 0.5]);
	});

	it('R-GR2-006: the emblem submesh is skipped until its emblem loads, then drawn with the emblem texture', () => {
		const emblemImage = { width: 24, height: 24 };
		const { gl, backend } = setup({ emblems: { guild7: emblemImage } });
		backend.drawFrame(frameOf([record('guildflag90_1'), record('guildflag90_1', { emblem: 'missing' })]));
		expect(gl.callsTo('drawElements')).toHaveLength(2);
		gl.clearCalls();
		backend.drawFrame(frameOf([record('guildflag90_1', { emblem: 'guild7' })]));
		expect(gl.callsTo('drawElements')).toHaveLength(2);
		const emblemUpload = gl.callsTo('texImage2D')[0];
		expect([emblemUpload[4], emblemUpload[5]]).toEqual([32, 32]);
		expect(emblemUpload[9][3]).toBe(0xff);
		expect(backend.gr2Residency.emblems.size).toBe(1);
		backend.releaseGr2Emblem('guild7');
		expect(backend.gr2Residency.emblems.size).toBe(0);
	});

	it('the flag keys its fully opaque texture (≥ 248, < 8, ≥ 248)', () => {
		const { gl, backend } = setup();
		backend.drawFrame(frameOf([record('guildflag90_1')]));
		expect(Array.from(gl.callsTo('texImage2D')[0][9])).toEqual([0, 0, 0, 0, 9, 9, 9, 255]);
	});

	it('records over 48 bones and unknown types are not drawn; other records of the step still are', () => {
		const { gl, backend } = setup();
		backend.drawFrame(
			frameOf([
				record('empelium90_0', { bones: new Float32Array(49 * 16) }),
				record('nothere'),
				record('empelium90_0')
			])
		);
		expect(gl.callsTo('drawElements')).toHaveLength(2);
	});

	it('context loss forgets the GR2 resources; the next frame re-uploads; beginMap frees them', () => {
		const { gl, canvas, backend, requests } = setup();
		const frame = frameOf([record('empelium90_0')]);
		backend.drawFrame(frame);
		canvas.fire('webglcontextlost');
		expect(backend.gr2Residency.types.size).toBe(0);
		canvas.fire('webglcontextrestored');
		backend.drawFrame(frame);
		expect(requests).toHaveLength(2);
		expect(gl.callsTo('linkProgram').length).toBeGreaterThan(1);
		backend.beginMap(2);
		expect(backend.gr2Residency.types.size).toBe(0);
		expect(gl.callsTo('deleteVertexArray')).toHaveLength(2);
	});

	it('normal matrix and view light match the legacy gl-matrix arithmetic', () => {
		const { backend } = setup();
		const mv = new Float32Array([2, 0, 0, 0, 0, 0, 3, 0, 0, -4, 0, 0, 1, 2, 3, 1]);
		const n = backend.gr2._normalMatrix(mv);
		// inverse-transpose of the upper 3x3 (columns (2,0,0), (0,0,3), (0,-4,0))
		expect(Array.from(n, v => v + 0)).toEqual([0.5, 0, 0, 0, 0, Math.fround(1 / 3), 0, -0.25, 0]);
		const l = backend.gr2._viewLight(IDENTITY, [0, 3, 4]);
		expect(Array.from(l)).toEqual([0, Math.fround(0.6), Math.fround(0.8)]);
	});
});
