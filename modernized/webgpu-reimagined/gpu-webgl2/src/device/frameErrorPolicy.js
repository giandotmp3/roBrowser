/**
 * R-CTX-005: a render callback threw.
 * - Context lost: the loop exits.
 * - Otherwise: bloom (if on) is turned off permanently as a resource-pressure
 *   fallback, and the loop continues.
 *
 * @param {{contextLost: boolean, settings: import('../ports.js').SettingsPort}} state
 * @returns {'exit'|'continue'}
 */
export function onRenderError({ contextLost, settings }) {
	if (contextLost) {
		return 'exit';
	}
	if (settings.get('bloom')) {
		settings.set('bloom', false);
	}
	return 'continue';
}
