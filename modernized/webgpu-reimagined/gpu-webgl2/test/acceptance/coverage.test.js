import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSIGNED_RULES, PENDING_RULES } from '../support/assignedRules.js';

const here = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here)
	.filter(f => f.endsWith('.test.js') && f !== 'coverage.test.js')
	.map(f => readFileSync(join(here, f), 'utf8'))
	.join('\n');

describe('behaviour-contract coverage for gpu-webgl2', () => {
	it.each(ASSIGNED_RULES)('%s has an acceptance test', id => {
		expect(sources).toMatch(new RegExp(`describe\\('${id}\\b`));
	});
	it.each(PENDING_RULES)('%s pending test is tagged with its rule ID and marked it.fails', id => {
		expect(sources).toContain(`it.fails('[${id}]`);
	});
	it('no assigned rule is silently skipped', () => {
		expect(sources).not.toMatch(/\b(it|describe)\.skip\(/);
	});
});
