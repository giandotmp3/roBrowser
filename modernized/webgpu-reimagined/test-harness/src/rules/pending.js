/**
 * Pending-rule registry.
 *
 * A rule is pending until the subject that owns it can pass its acceptance test. Pending
 * tests run as `it.fails` (expected failure): they stay green while unimplemented and turn
 * RED the moment they start passing, which forces the rule to be moved to IMPLEMENTED here.
 *
 * Nothing is implemented yet: render-records, scene and the backends are being scaffolded
 * in parallel and no subject adapter exists. Move IDs into IMPLEMENTED as they land.
 */
import { RULES } from './catalog.js';

/** Rule IDs whose acceptance tests are expected to PASS against the configured subject. */
export const IMPLEMENTED = new Set([]);

export const isPending = id => !IMPLEMENTED.has(id);

export const pendingReason = id => {
	const r = RULES.find(x => x.id === id);
	return r ? `awaiting ${r.owner} subject (${r.verify})` : 'unknown rule';
};

export const PENDING_RULE_IDS = Object.freeze(RULES.map(r => r.id).filter(isPending));
