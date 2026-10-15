/**
 * Record-diff driver for the singleton weather effects drawn through SpriteRenderer
 * (SnowWeather, SakuraWeatherEffect, CloudWeatherEffect, PokJukWeatherEffect,
 * RainWeather's after-entities pass).
 *
 * Legacy runs the way ScreenEffectManager drives it (bind3DContext → renderAll → unbind);
 * its native records come from SpriteRenderer.addRecordSink. The render-records instance
 * is driven by the same events, with the singleton bookkeeping of the legacy statics
 * mirrored here (startOrRestart revives a live instance on the same map, a map change
 * drops it, the instance is dropped once finished): that bookkeeping is scene glue, not
 * a render rule.
 *
 * Frame events: start, stop, noEntity, mapChange, plus test-specific ones handled by
 * `onEvent`.
 */
import { IDENTITY, PROJECTION, cameraAngleAt, diffSpriteFrame, fogAt, playerAt } from './weatherScene.js';

export const WEATHER_MAP = 'weather_map.rsw';

/**
 * Frames: dense from `start` to `stopAt`, then sparser through the fade-out tail, a revive
 * and a second stop, then a short instance cut by a map change.
 *
 * @param {Object} opts
 * @returns {{tick: number, events: string[]}[]}
 */
export function emitterFrames({ start = 1000, stopAt, step = i => (i % 2 ? 110 : 190), reviveAt, stop2At, endAt, tailStep = 600 }) {
	const frames = [{ tick: start, events: ['start'] }];
	let tick = start;
	for (let i = 1; tick < stopAt; i++) {
		tick += step(i);
		const events = [];
		if (i === 4) {
			events.push('noEntity');
		}
		if (i === 9) {
			events.push('start');
		}
		frames.push({ tick, events });
	}
	frames[frames.length - 1].events.push('stop');
	let revived = false;
	let stopped = false;
	while (tick < endAt) {
		tick += tailStep;
		const events = [];
		if (!revived && tick >= reviveAt) {
			revived = true;
			events.push('start');
		} else if (!stopped && tick >= stop2At) {
			stopped = true;
			events.push('stop');
		}
		frames.push({ tick, events });
	}
	tick += 500;
	frames.push({ tick, events: ['start'] });
	frames.push({ tick: tick + 150, events: [] });
	frames.push({ tick: tick + 300, events: ['mapChange'] });
	frames.push({ tick: tick + 450, events: ['start'] });
	frames.push({ tick: tick + 600, events: [] });
	return frames;
}

/**
 * @param {Object} opts
 * @param {Object} opts.Legacy legacy weather class (static startOrRestart / renderAll / stop)
 * @param {Object} opts.SpriteRenderer legacy SpriteRenderer
 * @param {Object} opts.gl fake GL
 * @param {Object} opts.mocks { session, map, renderer, camera } mock state objects
 * @param {Array} opts.frames
 * @param {function} opts.params (tick, frameIndex) => startOrRestart Params
 * @param {function} opts.create (tick, params) => render-records instance
 * @param {function} [opts.reuse] (modern, params) => boolean: may startOrRestart revive it
 * @param {function} opts.frameCtx (tick, player) => render-records frame ctx
 * @param {function} [opts.beforeLegacyFrame] (frameIndex, tick) => inherited state for PokJuk
 * @param {function} [opts.textureKey] legacy texture → key
 * @param {function} [opts.onEvent] (event, frameIndex, tick, modern)
 * @param {function} [opts.legacyStop] (Legacy, tick) stop call
 * @returns {{mismatches: string[], records: number, framesDrawn: number, modernLog: object[]}}
 */
export function runEmitterDiff({
	Legacy,
	SpriteRenderer,
	gl,
	mocks,
	frames,
	params,
	create,
	reuse = () => true,
	frameCtx,
	beforeLegacyFrame,
	textureKey,
	onEvent,
	legacyStop = (L, tick) => L.stop(-1, tick)
}) {
	SpriteRenderer.init(gl);
	mocks.map.currentMap = WEATHER_MAP;
	let modern = null;
	let modernMap = '';
	let legacy = [];
	const stopSink = SpriteRenderer.addRecordSink(r => legacy.push(r));
	const mismatches = [];
	let records = 0;
	let framesDrawn = 0;
	try {
		frames.forEach(({ tick, events }, i) => {
			mocks.renderer.tick = tick;
			const player = playerAt(tick);
			mocks.session.Entity = events.includes('noEntity') ? null : { position: new Float32Array(player) };
			mocks.camera.angle = cameraAngleAt(tick);
			const fog = fogAt(i);
			for (const event of events) {
				if (event === 'start') {
					const p = params(tick, i);
					Legacy.startOrRestart(p);
					if (modernMap !== mocks.map.currentMap) {
						modern = null;
						modernMap = mocks.map.currentMap;
					}
					if (modern && !modern.finished && reuse(modern, p)) {
						modern.restart(p.Inst.startTick || tick);
					} else {
						modern = create(tick, p);
						modernMap = mocks.map.currentMap;
					}
				} else if (event === 'stop') {
					legacyStop(Legacy, tick);
					if (modern) {
						modern.stop(tick);
					}
				} else if (event === 'mapChange') {
					mocks.map.currentMap = mocks.map.currentMap === WEATHER_MAP ? 'other_map.rsw' : WEATHER_MAP;
				}
				if (onEvent) {
					onEvent(event, i, tick, modern);
				}
			}

			const inherited = beforeLegacyFrame ? beforeLegacyFrame(i, tick) : undefined;
			legacy = [];
			SpriteRenderer.bind3DContext(gl, IDENTITY, PROJECTION, fog);
			if (inherited) {
				Object.assign(SpriteRenderer, {
					angle: inherited.angle,
					shadow: inherited.shadowFactor,
					zIndex: inherited.zIndex,
					depth: inherited.depthBias
				});
				SpriteRenderer.offset.set(inherited.offset);
				SpriteRenderer.image.palette = inherited.palette;
				SpriteRenderer.image.size.set(inherited.paletteSize);
			}
			Legacy.renderAll(gl, IDENTITY, PROJECTION, fog, tick);
			SpriteRenderer.unbind(gl);

			let mine = [];
			if (modern && modernMap !== mocks.map.currentMap) {
				modern = null;
			}
			if (modern) {
				mine = modern.frame(tick, frameCtx(tick, mocks.session.Entity ? player : null, inherited, i));
				if (modern.finished) {
					modern = null;
				}
			}
			records += legacy.length;
			if (legacy.length) {
				framesDrawn++;
			}
			mismatches.push(...diffSpriteFrame(`frame ${i} @${tick}`, legacy, mine, textureKey));
		});
	} finally {
		stopSink();
	}
	return { mismatches, records, framesDrawn };
}
