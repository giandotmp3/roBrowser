/**
 * Legacy (WebGL2) ↔ gpu-webgpu sprite pixel parity, headless Chromium with
 * WebGPU and WebGL2 both on SwiftShader. Serves smoke/<page>.html with Vite,
 * reads `window.__parity`, prints the stats and writes legacy/modern/diff PNGs.
 *
 *   node smoke/run-parity.mjs [--page=parity|entities|post|effects|backend] [--aa] [--tol=2] [--max-diff-pct=0] [--out=dir] [--flags="--a --b"]
 *
 * Pages: `parity` (synthetic SpriteDraw records through the legacy SpriteRenderer
 * API, 40 records), `entities` (the real legacy entity path's captured record
 * stream, ~200 entities, replayed with upload-on-miss residency) and `post` (the
 * legacy PostProcess chain vs gpu-webgpu's PostChain on one synthetic scene image,
 * per configuration; the gate applies to each configuration, or its declared `gatePct`)
 * and `effects` (the real legacy STR, 3D and 2D effect classes' captured record stream,
 * drawn by RunRenderer; plus the page's `checks`: texels, R-EFX-010 fog, controls) and
 * `backend` (WebGpuBackend.drawFrame end to end: entities + effects + post chain vs legacy
 * EntityManager / effect classes / PostProcess, read back with capture(); plus a real device
 * loss, `device.destroy()`, after which the next frame must match again).
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
if (!['parity', 'entities', 'post', 'effects', 'backend'].includes(pageName)) {
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

/** Prints the `post` page results, writes its PNGs, returns the exit code. */
function reportPost(result, logs) {
	let code = 0;
	fs.mkdirSync(outDir, { recursive: true });
	console.log(`WebGPU adapter: ${result.adapter}${result.fallbackAdapter ? ' (fallback adapter)' : ''}`);
	console.log(`legacy WebGL2 renderer: ${result.legacyRenderer}`);
	console.log(
		`R-PP-004 bloom guard: legacy detectBadWebGL = ${result.legacyBadWebGL}; gpu-webgpu bloomSupported = ${result.bloomAllowedProduction} (production), ${result.bloomAllowed} (smoke, allowSoftwareAdapter)`
	);
	console.log(
		`page post: canvas ${result.size.join('x')} (${result.canvasFormat}), ${result.pipelines} pipelines, tolerance ${result.tolerance}, gate ${maxOverPct} %`
	);
	console.log(
		`gl error: ${result.glError}; WebGPU errors: ${result.gpuErrors.length ? result.gpuErrors.join(' | ') : 'none'}`
	);
	if (result.gpuErrors.length || result.glError) {
		code = 1;
	}
	for (const c of result.configs) {
		const gate = c.gatePct ?? maxOverPct;
		const verdict = c.overTolerancePct > gate ? 'FAIL' : 'ok';
		console.log(`\nconfig ${c.name} [${verdict}, gate ${gate} %] vs ${c.gatedAgainst}`);
		console.log(`  passes: ${c.passes.join('  ')} (legacy module draws ${c.legacyModuleDraws})`);
		console.log(
			`  max diff ${c.maxDiff}; differing ${c.differing} (${c.differingPct.toFixed(4)} %); over tol ${c.overTolerance} (${c.overTolerancePct.toFixed(4)} %); histogram ${c.histogram.join(', ')}`
		);
		if (c.vsLegacy) {
			console.log(
				`  (informational) vs legacy: max diff ${c.vsLegacy.maxDiff}, over tol ${c.vsLegacy.overTolerance} (${c.vsLegacy.overTolerancePct.toFixed(4)} %)`
			);
		}
		const slug = c.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
		for (const [kind, url] of Object.entries(c.images)) {
			fs.writeFileSync(path.join(outDir, `post-${slug}-${kind}.png`), Buffer.from(url.split(',')[1], 'base64'));
		}
		if (c.overTolerancePct > gate) {
			code = 1;
		}
	}
	console.log(
		`\nsensitivity control (WebGPU bloom intensity 0.5 vs legacy 0.55): ${result.control.differing} pixels differ, max ${result.control.maxDiff}`
	);
	if (result.control.differing === 0) {
		console.error('control shows no difference: the comparison is not sensitive');
		code = 1;
	}
	console.log(`images: ${outDir}`);
	const warnings = logs.filter(l => !l.startsWith('[debug]') && !l.includes('GPU stall due to ReadPixels'));
	if (warnings.length) {
		console.log(`\nbrowser console:\n${warnings.join('\n')}`);
	}
	return code;
}

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
	const query = `?tol=${tolerance}${args.aa ? '&aa=1' : ''}${args.isolate ? '&isolate=1' : ''}${args.only ? `&only=${args.only}` : ''}`;
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
	} else if (pageName === 'post') {
		exitCode = reportPost(result, logs);
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
		if (result.assets) {
			console.log(
				`assets: ${JSON.stringify(result.assets)}; residency (upload on miss): ${JSON.stringify(result.residency)}`
			);
		}
		if (result.shaderMessages.length) {
			console.log(`WGSL compilation messages:\n  ${result.shaderMessages.join('\n  ')}`);
		}
		if (result.gpuErrors.length || result.glError) {
			exitCode = 1;
		}
		for (const frame of result.frames) {
			const gate = frame.gatePct ?? maxOverPct;
			console.log(`\nframe ${frame.name}${frame.gatePct !== undefined ? ` (declared gate ${gate} %)` : ''}`);
			if (frame.detail !== undefined) {
				console.log(`  ${frame.detail}`);
			}
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
			const batches =
				frame.batches.length > 60 ? `${frame.batches.slice(0, 60).join(' ')} …` : frame.batches.join(' ');
			console.log(
				`  draw calls: legacy ${frame.legacyDrawCalls} drawArrays, gpu-webgpu ${frame.modernDrawCalls} instanced draws (${(frame.legacyDrawCalls / Math.max(1, frame.modernDrawCalls)).toFixed(2)}x), ${frame.fallbacks} fallbacks, ${frame.runs} render-records runs (batch sizes: ${batches})`
			);
			if (frame.breaks) {
				console.log(`  state changes between records: ${JSON.stringify(frame.breaks.changes)}`);
				console.log(`  of which split a batch: ${JSON.stringify(frame.breaks.batch)}`);
			}
			for (const [kind, url] of Object.entries(frame.images)) {
				const file = path.join(outDir, `${frame.name}-${kind}${args.aa ? '-aa' : ''}.png`);
				fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
			}
			if (frame.overTolerancePct > gate) {
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
		if (control64) {
			console.log(
				`#64 control (index 255 wrapped to entry 0 on one side): ${control64.differing} pixels differ, max ${control64.maxDiff}`
			);
			if (control64.differing === 0) {
				console.error('#64 control shows no difference: the scene does not exercise palette index 255');
				exitCode = 1;
			}
		}
		for (const check of result.checks ?? []) {
			console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
			if (!check.ok) {
				exitCode = 1;
			}
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
