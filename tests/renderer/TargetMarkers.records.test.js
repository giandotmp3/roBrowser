import { describe, expect, it, vi } from 'vitest';

// Legacy LockOnTarget / MagicTarget effects driven against a logging fake GL: every call
// and its arguments are captured so the exact draw sequence is pinned across refactors.
const log = vi.hoisted(() => []);
const camera = vi.hoisted(() => ({
	angle: [240, 0],
	getLatitude() {
		return this.angle[0] - 180.0;
	}
}));
const session = vi.hoisted(() => ({ Entity: { lastSKID: 0, lastSkLvl: 0 } }));

vi.mock('Utils/WebGL.js', async () => (await import('./support/legacyEffectMocks.js')).webglMock);
vi.mock('Utils/Texture.js', async () => (await import('./support/legacyEffectMocks.js')).textureMock);
vi.mock('Core/Client.js', async () => (await import('./support/legacyEffectMocks.js')).clientMock);
vi.mock('Core/Configs.js', () => ({ default: { get: key => key === 'enableMipmap' } }));
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Engine/SessionStorage.js', () => ({ default: session }));
vi.mock('Renderer/Map/Altitude.js', async () => ({
	default: { generatePlane: (await import('./support/targetMarkerScene.js')).fakePlane }
}));

import { createLoggingGl, fogAt, renderClassFrame } from './support/legacyEffectMocks.js';
import {
	MARKER_TICKS,
	makeMarkerTarget,
	moveMarkerTargets,
	spawnLockOns,
	spawnMagicTargets
} from './support/targetMarkerScene.js';

const gl = createLoggingGl(log);

const KINDS = {
	lockon: { path: 'Renderer/Effects/LockOnTarget.js', family: 'lock-on' },
	magic: { path: 'Renderer/Effects/MagicTarget.js', family: 'magic-target' }
};

/**
 * Scripted ticks over every spawn on a fresh module instance, framed like
 * EffectManager.render.
 * @param {'lockon'|'magic'} kind
 * @param {function} [onModule] called with the fresh constructor before the run
 */
async function script(kind, onModule) {
	vi.resetModules();
	const Ctor = (await import(KINDS[kind].path)).default;
	onModule?.(Ctor);
	gl.resetIds();
	const targets = [0, 1].map(makeMarkerTarget);
	const live = kind === 'lockon' ? spawnLockOns(Ctor, targets) : spawnMagicTargets(Ctor, session);
	MARKER_TICKS.forEach((tick, i) => {
		moveMarkerTargets(targets, tick);
		camera.angle = [200 + (tick % 70), (tick / 7) % 360];
		renderClassFrame(gl, Ctor, live, tick, fogAt(i), ({ name, effect }, t, drawn) => {
			log.push(`@state ${name} ${t} ${drawn} ${Boolean(effect.needCleanUp)}`);
		});
	});
	Ctor.free(gl);
}

describe.each(['lockon', 'magic'])('%s marker GL draw path', kind => {
	it('issues the pinned GL call sequence (no visual change across refactors)', async () => {
		log.length = 0;
		await script(kind);
		expect(log).toMatchSnapshot();
	});

	it('emits one record per draw and observing does not change GL calls', async () => {
		log.length = 0;
		await script(kind);
		const unobserved = log.slice();

		const records = [];
		let stop;
		log.length = 0;
		await script(kind, Ctor => {
			stop = Ctor.addRecordSink(r => records.push(r));
		});
		stop();
		expect(log).toEqual(unobserved);

		const draws = log.filter(l => l.startsWith('drawArrays '));
		expect(records).toHaveLength(draws.length);
		expect(new Set(records).size).toBe(records.length);
		expect(records.map(r => `drawArrays TRIANGLES 0 ${r.params.vertexCount}`)).toEqual(draws);
		for (const r of records) {
			// no blend or depth state of their own: normal alpha, the before-entities pass state
			expect(r).toMatchObject({
				kind: 'effect',
				family: KINDS[kind].family,
				pass: 'before',
				blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
				depthTest: true,
				depthWrite: true,
				depthCorrection: false
			});
		}
		expect(records.some(r => r.fog)).toBe(true);
		if (kind === 'lockon') {
			const shades = log.filter(l => l.startsWith('uniform1f uni:uColor '));
			expect(records.map(r => `uniform1f uni:uColor ${r.color[1]}`)).toEqual(shades);
		} else {
			const lat = log.filter(l => l.startsWith('uniform1f uni:uCameraLatitude '));
			expect(records.map(r => `uniform1f uni:uCameraLatitude ${r.params.cameraLatitude}`)).toEqual(lat);
			expect(new Set(records.map(r => r.params.size))).toEqual(new Set([1, 11, 5, 3]));
		}
	});

	it('stops emitting after unsubscribe', async () => {
		const records = [];
		await script(kind, Ctor => Ctor.addRecordSink(r => records.push(r))());
		expect(records).toHaveLength(0);
	});
});
