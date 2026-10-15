import { PERF } from '../constants.js';

/**
 * Entity view-area culling and performance-mode parameters (C-15, R-PERF-001/002).
 */

/**
 * R-PERF-001: decided once per frame before any pass draws.
 * @param {Iterable<import('./EntityTypes.js').SceneEntity>} entities
 * @param {{ position: number[] }|null} player
 * @param {{ performanceMode: boolean, viewArea: number }} settings
 * @returns {Set<object>} visible entities
 */
export const computeVisibleSet = (entities, player, settings) => {
	const visible = new Set();
	const all = [...entities];
	if (!settings.performanceMode || !player) {
		all.forEach((e) => visible.add(e));
		return visible;
	}
	const r2 = settings.viewArea * settings.viewArea;
	const [px, py] = player.position;
	for (const e of all) {
		const dx = e.position[0] - px;
		const dy = e.position[1] - py;
		if (dx * dx + dy * dy <= r2) {
			visible.add(e);
		}
	}
	return visible;
};

/**
 * R-PERF-002 summary of perf-mode reductions (consumed by records + gpu backends).
 * @param {{ performanceMode: boolean, viewArea: number }} settings
 */
export const perfParams = ({ performanceMode, viewArea }) =>
	performanceMode
		? {
				effectCullRadius: viewArea,
				sortEveryFrames: PERF.SORT_EVERY_FRAMES_PERF,
				trailMax: PERF.TRAIL_MAX_PERF,
				animatedRsmDivisor: PERF.ANIMATED_RSM_DIVISOR_PERF,
				bloomScale: PERF.BLOOM_SCALE_PERF,
				sceneScale: PERF.SCENE_SCALE
			}
		: {
				effectCullRadius: PERF.EFFECT_CULL_RADIUS,
				sortEveryFrames: PERF.SORT_EVERY_FRAMES,
				trailMax: PERF.TRAIL_MAX,
				animatedRsmDivisor: PERF.ANIMATED_RSM_DIVISOR,
				bloomScale: PERF.BLOOM_SCALE,
				sceneScale: 1
			};
