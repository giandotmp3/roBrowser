/**
 * R-SPR-030 sort key: clip w with a (GID % 100)/1000 tie-break.
 * @param {number} clipW
 * @param {number} gid
 */
export function entitySortDepth(clipW, gid) {
	return clipW + (gid % 100) / 1000;
}

/**
 * R-SPR-030 sort far → near (descending depth). Returns a new array.
 * @template {{depth: number}} T
 * @param {T[]} entries
 * @returns {T[]}
 */
export function sortFarToNear(entries) {
	return [...entries].sort((a, b) => b.depth - a.depth);
}

/**
 * R-SPR-030 re-sort cadence.
 * @param {{listChanged: boolean, frame: number, performanceMode?: boolean}} s
 */
export function shouldResort({ listChanged, frame, performanceMode = false }) {
	return listChanged || frame % (performanceMode ? 6 : 3) === 0;
}

/**
 * R-SPR-030 entity pass split: non-effect before water, effect entities after.
 * @param {{isEffect: boolean}} entity
 * @returns {'entities'|'effectEntities'}
 */
export function entityPass({ isEffect }) {
	return isEffect ? 'effectEntities' : 'entities';
}
