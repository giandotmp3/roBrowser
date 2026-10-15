/**
 * Playwright config for the perceptual smoke goldens (architecture §2.2 test-harness).
 *
 * One pinned software adapter: Chromium WebGPU on SwiftShader, used for BOTH backends so
 * golden differences come from the renderer, not the GPU. Bloom goldens are WebGPU-only
 * (legacy disables bloom on SwiftShader, R-PP-004).
 *
 * The page under test is supplied by the environment (never hard-coded):
 *   HARNESS_SMOKE_URL=${HARNESS_SMOKE_URL}
 */
export default {
	testDir: './smoke',
	testMatch: '**/*.spec.js',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	use: {
		browserName: 'chromium',
		viewport: { width: 640, height: 480 },
		deviceScaleFactor: 1,
		launchOptions: {
			args: [
				'--enable-unsafe-webgpu',
				'--enable-features=Vulkan',
				'--use-angle=swiftshader',
				'--use-webgpu-adapter=swiftshader',
				'--disable-gpu-driver-bug-workarounds'
			]
		}
	}
};
