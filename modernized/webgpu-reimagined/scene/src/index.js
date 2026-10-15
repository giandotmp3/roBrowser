/**
 * scene module — public entry point.
 *
 * Owns (REIMAGINED_ARCHITECTURE.md §2.1): C-01 API + scheduling, C-02 camera, C-12 picking,
 * C-13 overlays, C-15 culling, C-18 viewer scene; rules R-CTX-003/004/008/011/013, R-CAM-*,
 * R-PICK-*, R-UI-001…005, R-MAP-023, R-PERF-001/002, R-PP-011 (mirroring fix).
 */
import { Scheduler } from './domain/Scheduler.js';
import { Camera } from './domain/Camera.js';
import { ScreenEffects } from './domain/ScreenEffects.js';
import { createRendererFacade } from './api/Renderer.js';
import { createMapRendererFacade } from './api/MapRenderer.js';
import { createEntityManagerFacade } from './api/EntityManager.js';
import { createEffectManagerFacade } from './api/EffectManager.js';
import { createDamageFacade } from './api/Damage.js';
import { createScreenEffectManagerFacade } from './api/ScreenEffectManager.js';
import { createSignboardManagerFacade } from './api/SignboardManager.js';
import { createItemObjectFacade } from './api/ItemObject.js';
import { createCameraFacade } from './api/CameraFacade.js';

export { FrameClock } from './domain/FrameClock.js';
export { Scheduler } from './domain/Scheduler.js';
export { Camera } from './domain/Camera.js';
export { Altitude } from './domain/Altitude.js';
export { ScreenEffects, NightTransition, envColor } from './domain/ScreenEffects.js';
export { ViewerScene } from './domain/ViewerScene.js';
export { EntityKind } from './domain/EntityTypes.js';
export * as Picking from './domain/Picking.js';
export * as Overlays from './domain/Overlays.js';
export * as Culling from './domain/Culling.js';
export * as Cursor from './domain/Cursor.js';
export * as MapName from './domain/MapName.js';
export * as Viewport from './domain/Viewport.js';
export { lifeBarLayout } from './domain/LifeBar.js';
export { NotImplementedError } from './errors.js';
export * from './ports.js';

/**
 * Compose the scene and its legacy-compatible facades. No globals: every dependency is injected.
 *
 * @param {object} deps
 * @param {import('./ports.js').Clock} deps.clock
 * @param {import('./ports.js').Rng} deps.rng
 * @param {import('./ports.js').SessionPort} deps.session
 * @param {import('./ports.js').GraphicsSettingsPort} deps.settings
 * @param {import('./ports.js').EventsPort} deps.events
 * @param {import('./ports.js').CursorPort} deps.cursor
 * @param {import('./ports.js').FrameRequester} deps.frames
 * @param {import('./ports.js').MapLoaderPort} deps.loader
 * @param {import('./api/Renderer.js').BackendPort} deps.backend
 * @param {import('./api/EffectManager.js').EffectSystemPort} deps.effects  render-records EffectSystem
 * @param {{ add: Function, free: Function }} deps.damage                 render-records DamageNumbers
 * @param {() => { cssWidth: number, cssHeight: number, dpr: number, quality: number }} deps.readWindow
 * @param {object} [deps.cameraPrefs]
 * @param {object} [deps.cameraConfig]
 */
export const createScene = (deps) => {
	const scheduler = new Scheduler({
		clock: deps.clock,
		session: deps.session,
		settings: deps.settings,
		events: deps.events,
		cursor: deps.cursor,
		frames: deps.frames,
		onRenderError: deps.onRenderError
	});
	const camera = new Camera({ rng: deps.rng, prefs: deps.cameraPrefs, config: deps.cameraConfig });
	const screenEffects = new ScreenEffects();

	const EntityManager = createEntityManagerFacade({ session: deps.session, settings: deps.settings });
	const EffectManager = createEffectManagerFacade({ effects: deps.effects });
	const Damage = createDamageFacade({ damage: deps.damage });
	const MapRenderer = createMapRendererFacade({
		loader: deps.loader,
		entities: EntityManager,
		damage: Damage,
		effects: EffectManager,
		backend: deps.backend
	});

	return {
		scheduler,
		camera,
		screenEffects,
		Renderer: createRendererFacade({ scheduler, backend: deps.backend, camera, readWindow: deps.readWindow }),
		MapRenderer,
		EntityManager,
		EffectManager,
		Damage,
		Camera: createCameraFacade({ camera }),
		ScreenEffectManager: createScreenEffectManagerFacade({ screenEffects, scheduler }),
		SignboardManager: createSignboardManagerFacade({ getAltitude: () => MapRenderer.altitude }),
		ItemObject: createItemObjectFacade({ entities: EntityManager })
	};
};
