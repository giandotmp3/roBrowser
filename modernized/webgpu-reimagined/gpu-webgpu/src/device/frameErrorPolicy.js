/**
 * R-CTX-005: a render callback throws.
 * - device not lost: bloom is turned off permanently if it was on; loop continues.
 * - device lost: the loop exits (DeviceLossController takes over).
 *
 * @param {{deviceLost: boolean, settings: import('../ports.js').SettingsPort}} ctx
 * @returns {{action: 'continue'|'exit', bloomDisabled: boolean}}
 */
export function onRenderError({ deviceLost, settings }) {
	if (deviceLost) {
		return { action: 'exit', bloomDisabled: false };
	}
	if (settings.get('bloom')) {
		settings.set('bloom', false);
		return { action: 'continue', bloomDisabled: true };
	}
	return { action: 'continue', bloomDisabled: false };
}
