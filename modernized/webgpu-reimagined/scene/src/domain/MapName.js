/**
 * Map name handling (R-CTX-011).
 */

/**
 * Strip instance prefixes: "0061@tower" -> "1@tower", "003#prontera" -> "prontera".
 * @param {string} name
 */
export const normalizeMapName = (name) => name.replace(/^(\d{3})(\d@)/, '$2').replace(/^\d{3}#/, '');

/** @param {string|null|undefined} name */
export const stripMapExtension = (name) => (name ?? '').replace(/\.(gat|rsw)$/i, '');

/** True when a map change is only a same-map teleport (no reload). */
export const isSameMap = (current, next) =>
	current != null && stripMapExtension(current) === stripMapExtension(normalizeMapName(next));

/** Worker filename for a map name (.gat -> .rsw). */
export const toRswFilename = (name) => name.replace(/\.gat$/i, '.rsw');
