/**
 * `rule(id, title, fn)` — one acceptance test per behaviour-contract rule.
 *
 * - The test name always starts with the rule ID, so reports and grep map 1:1 to the spec.
 * - Flagged rules are suffixed with the legacy rule they diverge from (spec §6).
 * - Pending rules (src/rules/pending.js) run as `it.fails`: expected-failure until the
 *   owning subject lands. A pending test that unexpectedly passes turns the suite red so the
 *   ID gets promoted to IMPLEMENTED.
 */
import { it } from 'vitest';
import { getRule } from '../../src/rules/catalog.js';
import { isPending, pendingReason } from '../../src/rules/pending.js';
import { resolveSubject } from '../../src/subject/SubjectPort.js';
import { createDeterministicPorts } from '../../src/determinism/installDeterminism.js';

let _subject;
const subject = async () => {
	_subject ??= await resolveSubject({ ports: createDeterministicPorts().ports });
	return _subject;
};

/**
 * @param {string} id rule ID from AI_NATIVE_SPEC §5
 * @param {string} title short restatement of the rule
 * @param {(s: import('../../src/subject/SubjectPort.js').Subject) => Promise<void>} fn
 */
export function rule(id, title, fn) {
	const meta = getRule(id);
	const flag = meta.flagged ? ` [FLAG: asserts fixed behaviour, diverges from legacy ${id}]` : '';
	const name = `${id}: ${title}${flag}`;
	const body = async () => fn(await subject());
	if (isPending(id)) {
		it.fails(`${name} [expected-failure: ${pendingReason(id)}]`, body);
	} else {
		it(name, body);
	}
}
