/** Shared scene builders for acceptance tests (synthetic fixtures only). */
import { scene } from '../../src/scenes/SceneScript.js';
import { flatMap, pc } from '../../src/scenes/fixtures.js';

export const LOCAL_GID = 110_000_001;
export const VIEW = Object.freeze({ width: 640, height: 480, dpr: 1, quality: 100 });

/** In-game scene: flat map, local PC at (20,20), camera on the PC. */
export function inGame(name, { map = flatMap(), local = {}, prefs = null, config = null } = {}) {
	const s = scene(name).viewport(VIEW);
	if (config) {
		s.config(config);
	}
	if (prefs) {
		s.preferences(prefs);
	}
	return s
		.session({ playing: true, localGid: LOCAL_GID })
		.map(map.name, map)
		.entity(pc({ gid: LOCAL_GID, position: [20, 20, 0], ...local }))
		.camera('setTarget', LOCAL_GID);
}

export const run = (s, script) => s.run(script.build());
