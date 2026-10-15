import { describe, expect, it } from 'vitest';
import { createFakeGpu } from '../support/fakeGpu.js';
import {
	POST_ORDER,
	POST_PIPELINES,
	POST_UNIFORM_BYTES,
	POST_UNIFORM_STRIDE,
	PostChain,
	buildPostPasses,
	postTargetSizes
} from '../../src/index.js';
import { SHADERS } from '../../src/shaders/index.js';

const CANVAS = { width: 322, height: 242 };
const ALL = {
	bloom: true,
	blur: true,
	fxaaEnabled: true,
	casEnabled: true,
	cartoonEnabled: true,
	vibranceEnabled: true
};
const ALL_STATE = { illusion: true, blind: true, zoomFinal: 90 };

/** Fake GPUCommandEncoder: records each render pass and what was set on it. */
function fakeEncoder() {
	const passes = [];
	return {
		passes,
		beginRenderPass(desc) {
			const pass = { desc, pipeline: null, group: null, draws: [] };
			passes.push(pass);
			return {
				setPipeline: p => (pass.pipeline = p),
				setBindGroup: (i, g) => (pass.group = g),
				draw: n => pass.draws.push(n),
				end: () => (pass.ended = true)
			};
		}
	};
}

async function makeChain() {
	const fake = createFakeGpu();
	const chain = await new PostChain({ device: fake.device, format: 'bgra8unorm' }).init();
	const scene = fake.device.createTexture({ label: 'scene', size: CANVAS, format: 'rgba8unorm' });
	return { fake, chain, scene };
}

describe('C-11 post pass graph (buildPostPasses)', () => {
	it('R-PP-001: all modules run in legacy order; Bloom is prefilter + composite; ping-pong, last writes the swapchain', () => {
		const { passes } = buildPostPasses(ALL, ALL_STATE, CANVAS);
		expect(passes.map(p => p.name)).toEqual(['Bloom.prefilter', ...POST_ORDER.filter(m => m !== 'Upsampling')]);
		expect(passes.map(p => [p.input, p.output])).toEqual([
			['scene', 'bloom'],
			['scene', 'pingA'],
			['pingA', 'pingB'],
			['pingB', 'pingA'],
			['pingA', 'pingB'],
			['pingB', 'pingA'],
			['pingA', 'pingB'],
			['pingB', 'pingA'],
			['pingA', 'swapchain']
		]);
		expect(passes[1].input2).toBe('bloom');
		expect(passes.map(p => p.slot)).toEqual(passes.map((_, i) => i));
		for (const p of passes) {
			expect(p.input).not.toBe(p.output);
			expect(POST_PIPELINES[p.pipeline]).toBeDefined();
		}
	});

	it('R-PP-001: only active modules run, still in legacy order', () => {
		const g = buildPostPasses({ vibranceEnabled: true, casEnabled: true }, { blind: true }, CANVAS);
		expect(g.passes.map(p => p.name)).toEqual(['CAS', 'Vibrance', 'Blind']);
		expect(g.passes.map(p => p.output)).toEqual(['pingA', 'pingB', 'swapchain']);
		const flip = buildPostPasses({}, { illusion: true }, CANVAS);
		expect(flip.passes.map(p => `${p.name}:${p.input}→${p.output}`)).toEqual(['VerticalFlip:scene→swapchain']);
		expect(buildPostPasses({ bloom: true }, { bloomAllowed: false }, CANVAS).passes.map(p => p.name)).toEqual([
			'Copy'
		]);
	});

	it('R-PP-002: no active module → one Copy pass from the scene straight to the swapchain', () => {
		const g = buildPostPasses({}, {}, CANVAS);
		expect(g.plan.directBlit).toBe(true);
		expect(g.passes).toHaveLength(1);
		expect(g.passes[0]).toMatchObject({ name: 'Copy', input: 'scene', output: 'swapchain', size: CANVAS });
	});

	it('R-PP-003: performance mode → floor(0.75×) scene and ping-pong, Upsampling last at canvas size', () => {
		const g = buildPostPasses({ performanceMode: true, fxaaEnabled: true }, {}, CANVAS);
		expect(g.sizes.scene).toEqual({ width: 241, height: 181 });
		expect(g.passes.map(p => `${p.name}→${p.output}@${p.size.width}x${p.size.height}`)).toEqual([
			'FXAA→pingA@241x181',
			'Upsampling→swapchain@322x242'
		]);
	});

	it('R-PP-004: bloom target = floor(scene × 0.25), or floor(floor(canvas × 0.75) × 0.125) in performance mode', () => {
		expect(postTargetSizes({ ...CANVAS }).bloom).toEqual({ width: 80, height: 60 });
		expect(postTargetSizes({ ...CANVAS, performanceMode: true }).bloom).toEqual({ width: 30, height: 22 });
		const g = buildPostPasses({ bloom: true, performanceMode: true }, {}, CANVAS);
		expect(g.passes.map(p => `${p.name}:${p.input}${p.input2 ? `+${p.input2}` : ''}→${p.output}`)).toEqual([
			'Bloom.prefilter:scene→bloom',
			'Bloom:scene+bloom→pingA',
			'Upsampling:pingA→swapchain'
		]);
		expect(g.passes[0].size).toEqual({ width: 30, height: 22 });
	});

	it('uniforms are the legacy uploads: canvas texel steps (also in performance mode), negative y for WebGPU uv', () => {
		const perf = buildPostPasses({ ...ALL, performanceMode: true, blurIntensity: 6 }, ALL_STATE, CANVAS).passes;
		const u = name => Array.from(perf.find(p => p.name === name).uniforms);
		const f = x => Math.fround(x);
		// Bloom: 4 texels of its internal target, threshold 0.88, soft knee 0.45, intensity 0.5.
		expect(u('Bloom.prefilter').slice(0, 5)).toEqual([f(4 / 30), f(-4 / 22), f(0.88), f(0.45), 0.5]);
		// Blur: blurIntensity / canvas, radius blurArea / 100, falloff 0.5.
		expect(u('Blur').slice(0, 4)).toEqual([f(6 / 322), f(-6 / 242), f(0.14), 0.5]);
		expect(u('FXAA').slice(0, 4)).toEqual([f(1 / 322), f(-1 / 242), 0.125, 0]);
		expect(u('CAS').slice(0, 4)).toEqual([f(1 / 322), f(-1 / 242), 0, 1]);
		expect(u('Cartoon').slice(0, 4)).toEqual([f(1 / 322), f(-1 / 242), 1.5, 1.5]);
		expect(u('Vibrance').slice(0, 4)).toEqual([1, 1, 1, f(0.15)]);
		// Blind: aspect (w / h, 1); radius 0.2 + (63 − 90) / 1000, falloff 0.5 + (63 − 90) / 1000.
		expect(u('Blind').slice(0, 4)).toEqual([f(322 / 242), 1, f(0.2 - 0.027), f(0.5 - 0.027)]);
		for (const p of perf) {
			expect(p.uniforms.byteLength).toBe(POST_UNIFORM_BYTES);
		}
	});

	it('R-PP-006/007/009 fixes and the kept legacy fallbacks reach the uniforms', () => {
		const u = (settings, name) =>
			Array.from(buildPostPasses(settings, {}, CANVAS).passes.find(p => p.name === name).uniforms);
		expect(u({ fxaaEnabled: true, fxaaSubpix: 0.5 }, 'FXAA')[7]).toBe(0.5); // R-PP-006 fix: subpix used
		expect(u({ fxaaEnabled: true, fxaaEdgeThreshold: 0 }, 'FXAA')[2]).toBe(0.125); // legacy `|| 0.125` kept
		expect(u({ casEnabled: true, casSharpening: 0 }, 'CAS')[3]).toBe(0); // R-PP-007 fix
		expect(u({ casEnabled: true, casContrast: 0.6 }, 'CAS')[2]).toBe(Math.fround(0.6));
		expect(u({ vibranceEnabled: true, vibrance: 0 }, 'Vibrance')[3]).toBe(0); // R-PP-009 fix
		expect(u({ cartoonEnabled: true, cartoonPower: 0, cartoonEdgeSlope: 0 }, 'Cartoon').slice(2, 4)).toEqual([
			1.5, 1.5
		]); // R-PP-008 `|| 1.5` kept
	});
});

describe('C-11 PostChain on a fake GPU', () => {
	it('init compiles every pass pipeline for rgba8unorm and the canvas format (prefilter: rgba8unorm only)', async () => {
		const { fake, chain } = await makeChain();
		expect(chain.pipelines.size).toBe(Object.keys(POST_PIPELINES).length * 2 - 1);
		const pipelines = fake.calls.filter(c => c[0] === 'createRenderPipelineAsync').map(c => c[1]);
		const prefilter = pipelines.filter(d => d.fragment.entryPoint === 'fs_prefilter');
		expect(prefilter.map(d => d.fragment.targets[0].format)).toEqual(['rgba8unorm']);
		for (const d of pipelines) {
			expect(d.vertex.entryPoint).toBe('vs_main');
			expect(d.primitive.topology).toBe('triangle-list');
		}
		const sampler = fake.calls.find(c => c[0] === 'createSampler')[1];
		expect(sampler).toMatchObject({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
		const layout = fake.calls.find(c => c[0] === 'createBindGroupLayout')[1];
		expect(layout.entries.map(e => e.binding)).toEqual([0, 1, 2, 3]);
	});

	it('encode: one render pass per graph pass into the right targets, swapchain pipeline only on the last', async () => {
		const { fake, chain, scene } = await makeChain();
		const graph = buildPostPasses(ALL, ALL_STATE, CANVAS);
		const encoder = fakeEncoder();
		const swapView = { swapchain: true };
		chain.encode(encoder, graph, scene, swapView);

		expect(encoder.passes).toHaveLength(graph.passes.length);
		const targetOf = view => (view === swapView ? 'swapchain' : view.texture.label.replace('post ', ''));
		expect(encoder.passes.map(p => targetOf(p.desc.colorAttachments[0].view))).toEqual(
			graph.passes.map(p => p.output)
		);
		encoder.passes.forEach((p, i) => {
			const last = i === encoder.passes.length - 1;
			expect(p.pipeline.desc.fragment.targets[0].format).toBe(last ? 'bgra8unorm' : 'rgba8unorm');
			expect(p.pipeline.desc.label).toContain(graph.passes[i].pipeline);
			expect(p.draws).toEqual([3]);
			expect(p.ended).toBe(true);
			expect(p.desc.colorAttachments[0]).toMatchObject({ loadOp: 'clear', storeOp: 'store' });
		});
		// Bloom composite binds the module input (scene) and the bloom target.
		const composite = encoder.passes[1].group.desc.entries;
		expect(composite[1].resource.texture.label).toBe('scene');
		expect(composite[3].resource.texture.label).toBe('post bloom');
		// Uniform blocks at slot · 256.
		const writes = fake.calls.filter(c => c[0] === 'queue.writeBuffer').map(c => c[1]);
		expect(writes.map(w => w[1])).toEqual(graph.passes.map((_, i) => i * POST_UNIFORM_STRIDE));
		expect(encoder.passes[3].group.desc.entries[2].resource).toMatchObject({
			offset: 3 * POST_UNIFORM_STRIDE,
			size: POST_UNIFORM_BYTES
		});
	});

	it('targets: ping-pong at the scene size, bloom at its size, created only when needed; recreated on resize', async () => {
		const { fake, chain, scene } = await makeChain();
		const created = () => fake.calls.filter(c => c[0] === 'createTexture' && c[1].label?.startsWith('post'));
		chain.encode(fakeEncoder(), buildPostPasses({ casEnabled: true }, {}, CANVAS), scene, {});
		expect(created().map(c => [c[1].label, c[1].size, c[1].format])).toEqual([
			['post pingA', { width: 322, height: 242 }, 'rgba8unorm'],
			['post pingB', { width: 322, height: 242 }, 'rgba8unorm']
		]);
		// Same sizes: nothing new.
		chain.encode(fakeEncoder(), buildPostPasses({ casEnabled: true }, {}, CANVAS), scene, {});
		expect(created()).toHaveLength(2);
		// Performance mode: new sizes, old targets destroyed, bloom created at 0.125×.
		chain.encode(fakeEncoder(), buildPostPasses({ bloom: true, performanceMode: true }, {}, CANVAS), scene, {});
		expect(fake.calls.filter(c => c[0] === 'texture.destroy')).toHaveLength(2);
		expect(created().slice(2).map(c => [c[1].label, c[1].size])).toEqual([
			['post pingA', { width: 241, height: 181 }],
			['post pingB', { width: 241, height: 181 }],
			['post bloom', { width: 30, height: 22 }]
		]);
	});

	it('bind groups are cached per slot and input; a new device (R-CTX-007 rebuild) recompiles everything', async () => {
		const { fake, chain, scene } = await makeChain();
		const graph = buildPostPasses({ casEnabled: true, vibranceEnabled: true }, {}, CANVAS);
		chain.encode(fakeEncoder(), graph, scene, {});
		const groups = () => fake.calls.filter(c => c[0] === 'createBindGroup').length;
		expect(groups()).toBe(2);
		chain.encode(fakeEncoder(), graph, scene, {});
		expect(groups()).toBe(2);

		const other = createFakeGpu();
		await chain.rebuild(other.device);
		expect(chain.device).toBe(other.device);
		expect(other.calls.filter(c => c[0] === 'createRenderPipelineAsync')).toHaveLength(chain.pipelines.size);
		expect(chain.targets).toEqual({ pingA: null, pingB: null, bloom: null });
	});
});

describe('C-11 WGSL mirrors the legacy GLSL', () => {
	it('every pass shader has the shared vertex stage and the fragment entry point its pipeline names', () => {
		for (const { shader, entryPoint } of Object.values(POST_PIPELINES)) {
			expect(SHADERS[shader]).toContain('fn vs_main');
			expect(SHADERS[shader]).toContain(`fn ${entryPoint}(`);
		}
	});

	it('operation-level markers of the legacy shaders', () => {
		expect(SHADERS.Bloom).toContain('max(soft * soft / (4.0 * knee + 1e-6), l - threshold) / max(l, 1e-6)');
		expect(SHADERS.Bloom).toContain('bloom_threshold(l, b.threshold, b.threshold * b.soft_knee)');
		expect(SHADERS.Bloom).toContain('let offset = texel_size * 0.5;');
		expect(SHADERS.Bloom).toContain('original + (bloom * b.intensity)');
		expect(SHADERS.Blur).toContain('let offset = u.texel * (effect_mask * 0.5);');
		expect(SHADERS.Blur).toContain('if (effect_mask <= 0.01)');
		expect(SHADERS.CAS).toContain('amp_rgb = inverseSqrt(amp_rgb);');
		expect(SHADERS.CAS).toContain('let peak = -3.0 * u.contrast + 8.0;');
		expect(SHADERS.CAS).toContain('mix(e, out_color, u.sharpening)');
		expect(SHADERS.Cartoon).toContain('let edge = dot(vec2f(diff1, diff2), vec2f(diff1, diff2));');
		expect(SHADERS.Cartoon).toContain('pow(abs(edge), u.edge_slope) * -u.power + color');
		expect(SHADERS.Vibrance).toContain('vec3f(0.212656, 0.715158, 0.072186)');
		expect(SHADERS.Blind).toContain('let uv = (i.uv - 0.5) * u.aspect;');
		expect(SHADERS.FXAA).toContain('dir = min(vec2f(u.span), max(vec2f(-u.span), dir * rcp_dir_min)) * u.texel;');
		expect(SHADERS.VerticalFlip).toContain('vec2f(i.uv.x, 1.0 - i.uv.y)');
	});
});
