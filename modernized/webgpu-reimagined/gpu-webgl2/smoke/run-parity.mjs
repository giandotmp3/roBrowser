/**
 * Legacy ↔ gpu-webgl2 sprite pixel parity, headless Chromium (WebGL2 on
 * SwiftShader). Serves smoke/parity.html with Vite, reads `window.__parity`,
 * prints the stats and writes legacy/modern/diff PNGs.
 *
 *   node smoke/run-parity.mjs [--aa] [--tol=2] [--max-diff-pct=0] [--out=dir]
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
	await page.goto(`${base}smoke/parity.html${query}`);
	await page.waitForFunction(() => window.__parity !== undefined, null, { timeout: 60000 });
	const result = await page.evaluate(() => window.__parity);

	if (!result.ok) {
		console.error(result.error);
		console.error(logs.join('\n'));
		failed = true;
	} else {
		fs.mkdirSync(outDir, { recursive: true });
		console.log(`renderer: ${result.renderer}`);
		console.log(
			`canvas ${result.size.join('x')}, antialias ${result.antialias}, ${result.records} records, tolerance ${result.tolerance}`
		);
		console.log(`gl errors: legacy ${result.glErrors.legacy}, gpu-webgl2 ${result.glErrors.modern}`);
		for (const frame of result.frames) {
			console.log(`\nframe ${frame.name}`);
			console.log(`  coverage (non-background, legacy): ${frame.coveredPct.toFixed(2)} %`);
			console.log(`  max per-channel diff: ${frame.maxDiff}`);
			console.log(
				`  pixels differing (any channel > 0): ${frame.differing} (${frame.differingPct.toFixed(4)} %)`
			);
			console.log(
				`  pixels over tolerance (> ${result.tolerance}): ${frame.overTolerance} (${frame.overTolerancePct.toFixed(4)} %)`
			);
			console.log(`  diff histogram [0,1,2,3,4-7,8-15,16-63,64-127,128+]: ${frame.histogram.join(', ')}`);
			console.log(
				`  draw calls: legacy ${frame.legacyDrawCalls} drawArrays, gpu-webgl2 ${frame.modernDrawCalls} drawArraysInstanced (runs: ${frame.runs.join(' ')})`
			);
			for (const [kind, url] of Object.entries(frame.images)) {
				const file = path.join(outDir, `${frame.name}-${kind}${args.aa ? '-aa' : ''}.png`);
				fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
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
