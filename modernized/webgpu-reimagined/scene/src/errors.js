/**
 * Thrown by scaffolded stubs whose behaviour-contract rules are not yet implemented.
 * Acceptance tests for those rules are marked `it.fails` and tagged with the rule IDs.
 */
export class NotImplementedError extends Error {
	/**
	 * @param {string} what
	 * @param {string[]} [ruleIds]
	 */
	constructor(what, ruleIds = []) {
		super(`${what} is not implemented yet${ruleIds.length ? ` (${ruleIds.join(', ')})` : ''}`);
		this.name = 'NotImplementedError';
		this.ruleIds = ruleIds;
	}
}

/**
 * @param {string} what
 * @param {...string} ruleIds
 * @returns {never}
 */
export const notImplemented = (what, ...ruleIds) => {
	throw new NotImplementedError(what, ruleIds);
};
