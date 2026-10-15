/**
 * Coverage gate: every behaviour-contract rule (all 143) has exactly one acceptance test,
 * and no acceptance test cites an unknown rule.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, FLAGGED_RULE_IDS } from '../../src/rules/catalog.js';
import { PENDING_RULE_IDS, IMPLEMENTED } from '../../src/rules/pending.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'acceptance');
const cited = readdirSync(dir)
	.filter(f => f.endsWith('.test.js'))
	.flatMap(f => [...readFileSync(join(dir, f), 'utf8').matchAll(/\brule\(\s*'(R-[A-Z0-9]+-\d{3})'/g)].map(m => m[1]));

describe('rule coverage', () => {
	it('catalog has 143 unique rules (spec §5)', () => {
		expect(RULES).toHaveLength(143);
		expect(new Set(RULES.map(r => r.id)).size).toBe(143);
	});

	it('every rule has exactly one acceptance test', () => {
		const counts = new Map();
		cited.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
		const missing = RULES.map(r => r.id).filter(id => !counts.has(id));
		const dupes = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
		expect(missing).toEqual([]);
		expect(dupes).toEqual([]);
	});

	it('no acceptance test cites an unknown rule', () => {
		const known = new Set(RULES.map(r => r.id));
		expect(cited.filter(id => !known.has(id))).toEqual([]);
	});

	it('flagged rules are exactly the HITL #1 fix list (spec §6)', () => {
		expect([...FLAGGED_RULE_IDS].sort()).toEqual(
			[
				'R-MAP-010',
				'R-MAP-013',
				'R-EFX-010',
				'R-EFX-011',
				'R-DMG-004',
				'R-PP-006',
				'R-PP-007',
				'R-PP-009',
				'R-PP-011',
				'R-UI-002',
				'R-DMG-009'
			].sort()
		);
	});

	it('pending + implemented partition the catalog', () => {
		expect(PENDING_RULE_IDS.length + IMPLEMENTED.size).toBe(143);
		[...IMPLEMENTED].forEach(id => expect(RULES.some(r => r.id === id)).toBe(true));
	});
});
