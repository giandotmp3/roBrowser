import { RenderDevice } from './device/RenderDevice.js';
import { DeviceUnavailableError } from './errors.js';

/**
 * Backend selection entry (`GraphicsSettings.renderer = 'auto'|'webgpu'|'webgl'`,
 * architecture §4 item 2). Returns the WebGPU device when available; otherwise
 * tells the caller to use gpu-webgl2. Never renders with a partial device.
 *
 * @param {{gpu: any, canvas: any, preference?: 'auto'|'webgpu'|'webgl'}} deps
 * @returns {Promise<{backend: 'webgpu', device: RenderDevice}|{backend: 'webgl2', reason: string}>}
 */
export async function selectBackend({ gpu, canvas, preference = 'auto' }) {
	if (preference === 'webgl') {
		return { backend: 'webgl2', reason: 'preference' };
	}
	try {
		const device = await new RenderDevice({ gpu, canvas }).init();
		return { backend: 'webgpu', device };
	} catch (err) {
		if (err instanceof DeviceUnavailableError) {
			return { backend: 'webgl2', reason: err.message };
		}
		throw err;
	}
}
