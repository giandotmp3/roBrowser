import { SHADERS } from '../shaders/index.js';

const STAGE_FRAGMENT = 0x2;

/**
 * Resolve → swapchain blit (architecture §2.2): full-screen triangle sampling
 * the single-sample rgba8unorm scene texture with a NEAREST sampler, so a
 * same-size blit copies texels exactly (and swizzles to the canvas format).
 */
export class Blit {
	/**
	 * @param {{device: GPUDevice, format: GPUTextureFormat}} deps  format: the canvas format
	 */
	constructor({ device, format }) {
		this.device = device;
		this.format = format;
		this.pipeline = null;
		this.sampler = null;
		this.layout = null;
		/** @type {WeakMap<object, GPUBindGroup>} */
		this._groups = new WeakMap();
	}

	async init() {
		const { device } = this;
		const module = device.createShaderModule({ label: 'blit.wgsl', code: SHADERS.blit });
		this.layout = device.createBindGroupLayout({
			label: 'blit group 0',
			entries: [
				{ binding: 0, visibility: STAGE_FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 1, visibility: STAGE_FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } }
			]
		});
		this.sampler = device.createSampler({ label: 'blit-nearest', magFilter: 'nearest', minFilter: 'nearest' });
		this.pipeline = await device.createRenderPipelineAsync({
			label: 'blit',
			layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
			vertex: { module, entryPoint: 'vs_main' },
			fragment: { module, entryPoint: 'fs_main', targets: [{ format: this.format }] },
			primitive: { topology: 'triangle-list' }
		});
		return this;
	}

	/**
	 * @param {GPUCommandEncoder} encoder
	 * @param {GPUTexture} source  Single-sample scene texture (OffscreenTarget.resolve)
	 * @param {GPUTextureView} destination  e.g. context.getCurrentTexture().createView()
	 */
	encode(encoder, source, destination) {
		let group = this._groups.get(source);
		if (!group) {
			group = this.device.createBindGroup({
				layout: this.layout,
				entries: [
					{ binding: 0, resource: this.sampler },
					{ binding: 1, resource: source.createView() }
				]
			});
			this._groups.set(source, group);
		}
		const pass = encoder.beginRenderPass({
			label: 'blit',
			colorAttachments: [
				{ view: destination, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }
			]
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, group);
		pass.draw(3);
		pass.end();
	}
}
