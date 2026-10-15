import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSIGNED_RULES, FIXED_FLAG_RULES, PENDING_RULES } from '../support/assignedRules.js';

const here = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here)
	.filter(f => f.endsWith('.test.js') && f !== 'coverage.test.js')
	.map(f => readFileSync(join(here, f), 'utf8'))
	.join('\n');

describe('behaviour-contract coverage (gpu-webgpu)', () => {
	it('owns exactly 55 rules', () => {
		expect(ASSIGNED_RULES).toHaveLength(55);
		expect(new Set(ASSIGNED_RULES).size).toBe(55);
	});

	it.each(ASSIGNED_RULES)('%s has at least one acceptance test', ruleId => {
		expect(sources).toMatch(new RegExp(`it(\\.fails)?\\(\\s*['"\`]${ruleId}\\b`));
	});

	it.each(FIXED_FLAG_RULES)('%s test asserts the FIXED behaviour and cites the legacy rule', ruleId => {
		expect(sources).toMatch(new RegExp(`'${ruleId}: FIX \\(legacy ${ruleId}`));
	});

	it.each(PENDING_RULES)('%s has an expected-failure test tagged with its rule ID', ruleId => {
		expect(sources).toMatch(new RegExp(`it\\.fails\\(\\s*['"\`]${ruleId}\\b`));
	});
});
