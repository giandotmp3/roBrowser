/**
 * Legacy ↔ gpu-webgl2 sprite pixel parity, headless Chromium (WebGL2 on
 * SwiftShader). Serves smoke/<page>.html with Vite, reads `window.__parity`,
 * prints the stats and writes legacy/modern/diff PNGs.
 *
 *   node smoke/run-parity.mjs [--page=parity|entities|effects|effects2] [--aa] [--tol=2] [--max-diff-pct=0] [--out=dir]
 *
 * Pages: `parity` (phase 3a, synthetic SpriteDraw records through the legacy
 * SpriteRenderer API), `entities` (phase 3b, the real legacy entity path's
 * captured record stream, ~200 entities), `effects` (the real legacy STR, 3D
 * and 2D effect classes' captured record stream) and `effects2` (the real legacy
 * mesh effect classes: cylinder, quadhorn, RSM, auras, spheres, tiles, rings, target
 * markers, rain puddles, waterfall).
 *
 * Needs `vite` and `playwright` resolvable from this package (devDependencies,
 * or the repo root node_modules for vite) and a Chromium for Playwright
 * (PLAYWRIGHT_BROWSERS_PATH). Exit code 1 when a frame has more than
 * --max-diff-pct % of pixels over the tolerance, or the page failed.
 */
/* global console, process, Buffer, window */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
	process.argv.slice(2).map(a => {
		const [k, v] = a.replace(/^--/, '').split('=');
		return [k, v ?? '1'];
	})
);
const tolerance = Number(args.tol ?? 2);
const maxOverPct = Number(args['max-diff-pct'] ?? 0);
const outDir = path.resolve(args.out ?? path.join(here, '.out'));
const pageName = args.page ?? 'parity';
if (!['parity', 'entities', 'effects', 'effects2'].includes(pageName)) {
	console.error(`unknown --page=${pageName}`);
	process.exit(2);
}

const { createServer } = await import('vite');
const { chromium } = await import('playwright');

const server = await createServer({ configFile: path.join(here, 'vite.config.js'), server: { port: 0 } });
let browser;
let failed = false;
try {
	await server.listen();
	const base = server.resolvedUrls.local[0];
	browser = await chromium.launch({
		args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
	});
	const page = await browser.newPage();
	const logs = [];
	page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
	page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
	const query = `?tol=${tolerance}${args.aa ? '&aa=1' : ''}`;
	await page.goto(`${base}smoke/${pageName}.html${query}`);
	await page.waitForFunction(() => window.__parity !== undefined, null, { timeout: 300000 });
	const result = await page.evaluate(() => window.__parity);

	if (!result.ok) {
		console.error(result.error);
		console.error(logs.join('\n'));
		failed = true;
	} else {
		fs.mkdirSync(outDir, { recursive: true });
		console.log(`renderer: ${result.renderer}`);
		console.log(
			`page ${pageName}: canvas ${result.size.join('x')}, antialias ${result.antialias}, ${result.records} records, tolerance ${result.tolerance}`
		);
		if (result.scene) {
			console.log(
				`scene: ${JSON.stringify(result.scene.counts)} entities, assets ${JSON.stringify(result.scene.assets)}`
			);
			console.log(`features: ${JSON.stringify(result.scene.features)}`);
			console.log(`residency (upload on miss): ${JSON.stringify(result.residency)}`);
		}
		console.log(`gl errors: legacy ${result.glErrors.legacy}, gpu-webgl2 ${result.glErrors.modern}`);
		for (const frame of result.frames) {
			console.log(`\nframe ${frame.name}`);
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
			const runs = frame.runs.length > 60 ? `${frame.runs.slice(0, 60).join(' ')} …` : frame.runs.join(' ');
			console.log(
				`  draw calls: legacy ${frame.legacyDrawCalls} drawArrays, gpu-webgl2 ${frame.modernDrawCalls} drawArraysInstanced (${(frame.legacyDrawCalls / Math.max(1, frame.modernDrawCalls)).toFixed(2)}x; runs: ${runs})`
			);
			for (const [kind, url] of Object.entries(frame.images)) {
				const file = path.join(outDir, `${frame.name}-${kind}${args.aa ? '-aa' : ''}.png`);
				fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
			}
			if (frame.breaks) {
				console.log(`  run breaks by changed state: ${JSON.stringify(frame.breaks)}`);
			}
			if (frame.overTolerancePct > maxOverPct) {
				failed = true;
			}
		}
		const { control } = result;
		console.log(
			`\nsensitivity control (one record nudged 0.01 units): ${control.differing} pixels differ, max ${control.maxDiff}`
		);
		if (control.differing === 0) {
			console.error('control frame shows no difference: the comparison is not sensitive');
			failed = true;
		}
		const { control64 } = result;
		if (control64) {
			console.log(
				`#64 control (index 255 wrapped to entry 0 on one side): ${control64.differing} pixels differ, max ${control64.maxDiff}`
			);
			if (control64.differing === 0) {
				console.error('#64 control shows no difference: the scene does not exercise palette index 255');
				failed = true;
			}
		}
		for (const check of result.checks ?? []) {
			console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
			if (!check.ok) {
				failed = true;
			}
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
console.log(failed ? '\nPARITY: FAIL' : '\nPARITY: PASS');
process.exit(failed ? 1 : 0);
