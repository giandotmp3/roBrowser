/**
 * Perceptual smoke goldens (architecture §2.2): ~12 scenes × {webgpu, webgl2} on Chromium
 * WebGPU/SwiftShader; bloom golden WebGPU-only.
 *
 * Page contract (served by the app under test at HARNESS_SMOKE_URL, never hard-coded):
 *   window.__harness.load({ scene, renderer, seed }) -> Promise<void>   scene id from GoldenSet
 *   window.__harness.settle(ms)                       -> Promise<void>  advance the FakeClock
 *   window.__harness.capture()                        -> Promise<{ width, height, data: number[] }>
 *     (in-frame capture after VerticalFlip, architecture §2.2 Capture)
 *
 * Goldens: goldens/<backend>/<id>.png. Set HARNESS_UPDATE_GOLDENS=1 to (re)write them.
 * Skipped until HARNESS_SMOKE_URL is provided (phase 3+ deliverable).
 */
import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { goldenMatrix, goldenPath } from '../src/golden/GoldenSet.js';
import { compareImages } from '../src/golden/perceptual.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_UNDER_TEST = process.env.HARNESS_SMOKE_URL;
const UPDATE = process.env.HARNESS_UPDATE_GOLDENS === '1';

/** Decode/encode PNG in the page (Canvas2D) so the harness needs no image dependency. */
async function decodePng(page, buf) {
	return page.evaluate(async b64 => {
		const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
		const bmp = await createImageBitmap(blob);
		const c = new OffscreenCanvas(bmp.width, bmp.height);
		const ctx = c.getContext('2d');
		ctx.drawImage(bmp, 0, 0);
		const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
		return { width: bmp.width, height: bmp.height, data: Array.from(data) };
	}, buf.toString('base64'));
}

async function encodePng(page, img) {
	const b64 = await page.evaluate(async ({ width, height, data }) => {
		const c = new OffscreenCanvas(width, height);
		c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
		const blob = await c.convertToBlob({ type: 'image/png' });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let s = '';
		bytes.forEach(x => (s += String.fromCharCode(x)));
		return btoa(s);
	}, img);
	return Buffer.from(b64, 'base64');
}

test.describe('smoke goldens', () => {
	test.skip(!URL_UNDER_TEST, 'HARNESS_SMOKE_URL not set (smoke goldens start at phase 3)');

	for (const { golden, backend } of goldenMatrix()) {
		test(`${golden.id} @${backend} [${golden.rules.join(', ')}]`, async ({ page }) => {
			await page.goto(URL_UNDER_TEST);
			await page.waitForFunction(() => !!window.__harness);
			if (backend === 'webgpu') {
				const adapter = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
				expect(adapter, 'pinned SwiftShader WebGPU adapter must be available').toBe(true);
			}
			await page.evaluate(args => window.__harness.load(args), {
				scene: golden.id,
				renderer: backend,
				seed: golden.seed
			});
			await page.evaluate(ms => window.__harness.settle(ms), golden.settle);
			const actual = await page.evaluate(() => window.__harness.capture());
			const file = join(ROOT, goldenPath(backend, golden.id));
			if (UPDATE) {
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(file, await encodePng(page, actual));
				return;
			}
			expect(
				existsSync(file),
				`missing golden ${goldenPath(backend, golden.id)} — run with HARNESS_UPDATE_GOLDENS=1 on the pinned adapter`
			).toBe(true);
			const expected = await decodePng(page, readFileSync(file));
			const res = compareImages(expected, actual, golden.tolerance);
			if (!res.pass) {
				writeFileSync(file.replace(/\.png$/, '.actual.png'), await encodePng(page, actual));
			}
			expect(
				res.pass,
				`${golden.id}@${backend}: ${res.reason ?? `${(res.ratio * 100).toFixed(2)}% pixels differ`}`
			).toBe(true);
		});
	}
});
