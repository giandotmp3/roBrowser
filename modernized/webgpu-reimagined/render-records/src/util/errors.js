/**
 * Thrown by API stubs whose behaviour-contract rule is not implemented yet.
 * The acceptance test for that rule is marked expected-failure (`it.fails`)
 * and tagged with the same rule ID.
 */
export class NotImplementedError extends Error {
	/**
	 * @param {string} ruleId Behaviour-contract rule ID, e.g. 'R-SPR-007'
	 * @param {string} what Short description of the missing piece
	 */
	constructor(ruleId, what) {
		super(`[${ruleId}] not implemented: ${what}`);
		this.name = 'NotImplementedError';
		this.ruleId = ruleId;
	}
}

/**
 * @param {string} ruleId
 * @param {string} what
 * @returns {never}
 */
export function notImplemented(ruleId, what) {
	throw new NotImplementedError(ruleId, what);
}
