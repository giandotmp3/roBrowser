/**
 * Legacy (WebGL2) ↔ gpu-webgpu sprite pixel parity, headless Chromium with
 * WebGPU and WebGL2 both on SwiftShader. Serves smoke/<page>.html with Vite,
 * reads `window.__parity`, prints the stats and writes legacy/modern/diff PNGs.
 *
 *   node smoke/run-parity.mjs [--page=parity|entities] [--aa] [--tol=2] [--max-diff-pct=0] [--out=dir] [--flags="--a --b"]
 *
 * Pages: `parity` (synthetic SpriteDraw records through the legacy SpriteRenderer
 * API, 40 records) and `entities` (the real legacy entity path's captured record
 * stream, ~200 entities, replayed with upload-on-miss residency).
 *
 * Needs `vite` and `playwright` resolvable from this package (devDependencies,
 * or a symlinked node_modules) and a Chromium for Playwright
 * (PLAYWRIGHT_BROWSERS_PATH; never runs `playwright install`).
 *
 * Exit codes: 0 pass, 1 parity failure or page error, 2 no WebGPU adapter.
 */
/* global console, process, Buffer, window */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
	process.argv.slice(2).map(a => {
		const [k, ...v] = a.replace(/^--/, '').split('=');
		return [k, v.length ? v.join('=') : '1'];
	})
);
const tolerance = Number(args.tol ?? 2);
const maxOverPct = Number(args['max-diff-pct'] ?? 0);
const outDir = path.resolve(args.out ?? path.join(here, '.out'));
const pageName = args.page ?? 'parity';
if (!['parity', 'entities'].includes(pageName)) {
	console.error(`unknown --page=${pageName}`);
	process.exit(1);
}

/**
 * WebGPU on SwiftShader (Dawn's Vulkan SwiftShader adapter) + WebGL2 via ANGLE SwiftShader.
 * `--enable-features=Vulkan --use-vulkan=swiftshader` is required: without it the adapter
 * exists and offscreen rendering works, but presenting a WebGPU canvas loses the device
 * ("A valid external Instance reference no longer exists").
 */
const DEFAULT_FLAGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan',
	'--use-vulkan=swiftshader',
	'--use-webgpu-adapter=swiftshader',
	'--enable-unsafe-swiftshader',
	'--use-gl=angle',
	'--use-angle=swiftshader',
	'--ignore-gpu-blocklist'
];
const flags = args.flags ? args.flags.split(/\s+/).filter(Boolean) : DEFAULT_FLAGS;

const { createServer } = await import('vite');
const { chromium } = await import('playwright');

const server = await createServer({ configFile: path.join(here, 'vite.config.js'), server: { port: 0 } });
let browser;
let exitCode = 0;
try {
	await server.listen();
	const base = server.resolvedUrls.local[0];
	browser = await chromium.launch({ args: flags });
	const page = await browser.newPage();
	const logs = [];
	page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
	page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
	const query = `?tol=${tolerance}${args.aa ? '&aa=1' : ''}${args.isolate ? '&isolate=1' : ''}`;
	await page.goto(`${base}smoke/${pageName}.html${query}`);
	await page.waitForFunction(() => window.__parity !== undefined, null, { timeout: 300000 });
	const result = await page.evaluate(() => window.__parity);

	console.log(`chromium flags: ${flags.join(' ')}`);
	if (result.noAdapter) {
		console.error(result.error);
		exitCode = 2;
	} else if (!result.ok) {
		console.error(result.error);
		console.error(logs.join('\n'));
		exitCode = 1;
	} else {
		fs.mkdirSync(outDir, { recursive: true });
		console.log(`WebGPU adapter: ${result.adapter}${result.fallbackAdapter ? ' (fallback adapter)' : ''}`);
		console.log(`legacy WebGL2 renderer: ${result.legacyRenderer}`);
		console.log(
			`page ${pageName}: canvas ${result.size.join('x')} (${result.canvasFormat}), antialias ${result.antialias}, ${result.records} records, tolerance ${result.tolerance}`
		);
		if (result.scene) {
			console.log(
				`scene: ${JSON.stringify(result.scene.counts)} entities, assets ${JSON.stringify(result.scene.assets)}`
			);
			console.log(`features: ${JSON.stringify(result.scene.features)}`);
			console.log(`residency (upload on miss): ${JSON.stringify(result.residency)}`);
		}
		console.log(`pipelines compiled: ${result.pipelines}`);
		console.log(
			`gl error: ${result.glError}; WebGPU errors: ${result.gpuErrors.length ? result.gpuErrors.join(' | ') : 'none'}`
		);
		if (result.shaderMessages.length) {
			console.log(`sprite.wgsl compilation messages:\n  ${result.shaderMessages.join('\n  ')}`);
		}
		if (result.gpuErrors.length || result.glError) {
			exitCode = 1;
		}
		for (const frame of result.frames) {
			console.log(`\nframe ${frame.name}`);
			if (frame.entities !== undefined) {
				console.log(
					`  ${frame.entities} entities, ${frame.records} records (${frame.indexed} indexed, ${frame.additive} additive, ${frame.unmapped} unmapped), ${frame.uploads} uploads on miss, resident ${frame.resident.frames} frames / ${frame.resident.palettes} palettes`
				);
			}
			console.log(`  coverage (non-background, legacy): ${frame.coveredPct.toFixed(2)} %`);
			console.log(`  max per-channel diff: ${frame.maxDiff}`);
			console.log(
				`  pixels differing (any channel > 0): ${frame.differing} (${frame.differingPct.toFixed(4)} %)`
			);
			console.log(
				`  pixels over tolerance (> ${result.tolerance}): ${frame.overTolerance} (${frame.overTolerancePct.toFixed(4)} %)`
			);
			console.log(`  diff histogram [0,1,2,3,4-7,8-15,16-63,64-127,128+]: ${frame.histogram.join(', ')}`);
			const runs = frame.runs.length > 60 ? `${frame.runs.slice(0, 60).join(' ')} …` : frame.runs.join(' ');
			console.log(
				`  draw calls: legacy ${frame.legacyDrawCalls} drawArrays, gpu-webgpu ${frame.modernDrawCalls} instanced draws (${(frame.legacyDrawCalls / Math.max(1, frame.modernDrawCalls)).toFixed(2)}x), ${frame.fallbacks} fallbacks (runs: ${runs})`
			);
			if (frame.breaks) {
				console.log(`  run breaks by changed state: ${JSON.stringify(frame.breaks)}`);
			}
			for (const [kind, url] of Object.entries(frame.images)) {
				const file = path.join(outDir, `${frame.name}-${kind}${args.aa ? '-aa' : ''}.png`);
				fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
			}
			if (frame.overTolerancePct > maxOverPct) {
				exitCode = 1;
			}
		}
		const { control, control64 } = result;
		console.log(
			`\nsensitivity control (one record nudged 0.01 units): ${control.differing} pixels differ, max ${control.maxDiff}`
		);
		if (control.differing === 0) {
			console.error('control frame shows no difference: the comparison is not sensitive');
			exitCode = 1;
		}
		console.log(
			`#64 control (index 255 wrapped to entry 0 on one side): ${control64.differing} pixels differ, max ${control64.maxDiff}`
		);
		if (control64.differing === 0) {
			console.error('#64 control shows no difference: the scene does not exercise palette index 255');
			exitCode = 1;
		}
		for (const r of result.isolated ?? []) {
			console.log(`  record ${r.i} ${r.texture}: ${r.differing} px differ, max ${r.maxDiff}`);
		}
		console.log(`images: ${outDir}`);
		const warnings = logs.filter(l => !l.startsWith('[debug]') && !l.includes('GPU stall due to ReadPixels'));
		if (warnings.length) {
			console.log(`\nbrowser console:\n${warnings.join('\n')}`);
		}
	}
} finally {
	await browser?.close();
	await server.close();
}
console.log(exitCode === 0 ? '\nPARITY: PASS' : exitCode === 2 ? '\nPARITY: NO ADAPTER' : '\nPARITY: FAIL');
process.exit(exitCode);
