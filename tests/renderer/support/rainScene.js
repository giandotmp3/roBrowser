/**
 * Scripted EF_RAIN scene shared by RainWeather.records.test.js (GL snapshot) and
 * RecordDiff.rain.test.js. Drives legacy RainWeather the way ScreenEffectManager does:
 * before the entities RainWeather.renderPuddles, after them bind3DContext →
 * RainWeather.renderAll → unbind.
 *
 * The frame list moves the game tick and the wall clock (Date.now, which drives thunder)
 * separately: the clock jumps 9 s every 8th frame so thunder (5–60 s) strikes several
 * times within a short tick range, while small steps sample the flash envelope.
 *
 * Events: start / restart (startOrRestart), stop, noEntity (Session.Entity null for the
 * frame), noModelView (Camera.modelView null: drop tilt 0), mapChange.
 */
import { IDENTITY, PROJECTION, cameraAngleAt, fogAt, modelViewAt, playerAt } from './weatherScene.js';

export const RAIN_MAP = 'rain_map.rsw';
export const RAIN_SEED = 0x7a1;
const START = 1000;

function buildFrames() {
	const frames = [];
	let tick = START;
	let clock = 0;
	const push = (events = []) => frames.push({ tick, clock, events });

	// Raining: emission, fall, splashes, puddles, thunder.
	push(['start']);
	for (let i = 1; tick < 13000; i++) {
		const step = i % 2 ? 110 : 190;
		tick += step;
		clock += step + (i % 8 === 0 ? 9000 : 0);
		const events = [];
		if (i === 5) {
			events.push('noEntity');
		}
		if (i === 7) {
			events.push('noModelView');
		}
		if (i === 10) {
			events.push('restart');
		}
		push(events);
	}
	// Fade-out tail, revived once, stopped again, then cleanup.
	frames[frames.length - 1].events.push('stop');
	while (tick < 49500) {
		tick += tick < 20000 ? 700 : tick < 26000 ? 300 : 900;
		clock += tick < 20000 ? 700 : 300;
		const events = [];
		if (tick >= 20000 && !frames.some(f => f.events.includes('revive'))) {
			events.push('revive');
		}
		if (tick >= 23000 && !frames.some(f => f.events.includes('stop2'))) {
			events.push('stop2');
		}
		push(events);
	}
	// A new instance cut short by a map change.
	tick += 500;
	clock += 500;
	push(['start']);
	for (let i = 0; i < 3; i++) {
		tick += 200;
		clock += 200;
		push(i === 1 ? ['mapChange'] : []);
	}
	return frames;
}

export const RAIN_FRAMES = buildFrames();

/**
 * Run the scripted scene on the legacy modules.
 *
 * @param {object} deps
 * @param {object} deps.RainWeather legacy class
 * @param {object} deps.SpriteRenderer legacy SpriteRenderer
 * @param {object} deps.gl fake GL
 * @param {object} deps.mocks { session, map, renderer, camera } mock state objects
 * @param {object} deps.clock FakeClock driving Date.now
 * @param {function} [deps.onPass] (frameIndex, 'before'|'after') called after each pass
 * @param {function} [deps.onEvent] (frameIndex, event, tick) after legacy handled the event
 */
export function runLegacyRain({ RainWeather, SpriteRenderer, gl, mocks, clock, onPass, onEvent }) {
	SpriteRenderer.init(gl);
	mocks.map.currentMap = RAIN_MAP;
	RAIN_FRAMES.forEach((frame, i) => {
		const { tick, events } = frame;
		clock.advance(frame.clock - clock.now());
		mocks.renderer.tick = tick;
		const player = playerAt(tick);
		mocks.session.Entity = events.includes('noEntity') ? null : { position: new Float32Array(player) };
		mocks.camera.angle = cameraAngleAt(tick);
		mocks.camera.modelView = events.includes('noModelView') ? null : modelViewAt(tick);
		mocks.camera.position = [player[0], -player[2] + 20, player[1] - 20];
		const fog = fogAt(i);
		mocks.map.fog = fog;

		for (const event of events) {
			if (event === 'start' || event === 'restart' || event === 'revive') {
				if (event === 'start') {
					mocks.map.currentMap = RAIN_MAP;
				}
				RainWeather.startOrRestart({
					Inst: { effectID: 161, startTick: tick, endTick: -1 },
					Init: { ownerAID: -1 }
				});
			} else if (event === 'stop' || event === 'stop2') {
				RainWeather.stop(-1, tick);
			} else if (event === 'mapChange') {
				mocks.map.currentMap = 'other_map.rsw';
			}
			if (onEvent) {
				onEvent(i, event, tick);
			}
		}

		RainWeather.renderPuddles(gl, IDENTITY, PROJECTION, fog, tick);
		if (onPass) {
			onPass(i, 'before');
		}
		SpriteRenderer.bind3DContext(gl, IDENTITY, PROJECTION, fog);
		RainWeather.renderAll(gl, IDENTITY, PROJECTION, fog, tick);
		SpriteRenderer.unbind(gl);
		if (onPass) {
			onPass(i, 'after');
		}
	});
}
