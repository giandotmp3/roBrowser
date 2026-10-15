import { describe, expect, it, vi } from 'vitest';

// Legacy SpiritSphere / WarlockSphere effects driven against a logging fake GL: every call
// and its arguments are captured so the exact draw sequence is pinned across refactors.
const log = vi.hoisted(() => []);
const camera = vi.hoisted(() => ({ angle: [240, 0], zoom: 1 }));

vi.mock('Utils/WebGL.js', async () => (await import('./support/legacyEffectMocks.js')).webglMock);
vi.mock('Utils/Texture.js', async () => (await import('./support/legacyEffectMocks.js')).textureMock);
vi.mock('Core/Client.js', async () => (await import('./support/legacyEffectMocks.js')).clientMock);
vi.mock('Core/Configs.js', () => ({ default: { get: key => key === 'enableMipmap' } }));
vi.mock('Renderer/Camera.js', () => ({ default: camera }));
vi.mock('Renderer/SpriteRenderer.js', () => ({
	default: {
		runWithDepth: (depthTest, depthMask, depthCorrection, fn) => {
			log.push(`@runWithDepth ${depthTest} ${depthMask} ${depthCorrection}`);
			fn();
		}
	}
}));

import { createLoggingGl, fogAt, renderClassFrame } from './support/legacyEffectMocks.js';
import {
	SPHERE_TICKS,
	SPIRIT_SPAWNS,
	WARLOCK_SPAWNS,
	makeSphereOwner,
	moveSphereOwner,
	sphereCameraAt,
	spawnSpheres
} from './support/sphereScene.js';

const gl = createLoggingGl(log);

const KINDS = {
	spirit: { path: 'Renderer/Effects/SpiritSphere.js', spawns: SPIRIT_SPAWNS },
	warlock: { path: 'Renderer/Effects/WarlockSphere.js', spawns: WARLOCK_SPAWNS }
};

/**
 * Scripted ticks over every spawn on a fresh module instance, framed like
 * EffectManager.render.
 * @param {'spirit'|'warlock'} kind
 * @param {function} [onModule] called with the fresh constructor before the run
 */
async function script(kind, onModule) {
	vi.resetModules();
	const Ctor = (await import(KINDS[kind].path)).default;
	onModule?.(Ctor);
	gl.resetIds();
	const owners = KINDS[kind].spawns.map((_s, k) => makeSphereOwner(k));
	const live = spawnSpheres(Ctor, kind, KINDS[kind].spawns, owners);
	SPHERE_TICKS.forEach((tick, i) => {
		owners.forEach((owner, k) => moveSphereOwner(owner, k, tick));
		Object.assign(camera, sphereCameraAt(tick));
		renderClassFrame(gl, Ctor, live, tick, fogAt(i), ({ name, effect }, t, drawn) => {
			log.push(`@state ${name} ${t} ${drawn} ${effect.initialAlpha}`);
		});
	});
	Ctor.free(gl);
	return Ctor;
}

describe.each(['spirit', 'warlock'])('%s sphere GL draw path', kind => {
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
		const colors = log.filter(l => l.startsWith('uniform4fv uni:uColor '));
		expect(records.map(r => `uniform4fv uni:uColor [${r.color.join(',')}]`)).toEqual(colors);
		const sizes = log.filter(l => l.startsWith('uniform1f uni:uSize '));
		expect(records.map(r => `uniform1f uni:uSize ${r.params.size}`)).toEqual(sizes);
		for (const r of records) {
			// R-EFX-014 additive; spirit spheres test depth, warlock spheres write it untested
			expect(r).toMatchObject({
				kind: 'effect',
				family: `${kind}-sphere`,
				pass: 'after',
				blend: { src: 'SRC_ALPHA', dst: 'ONE' },
				depthTest: kind === 'spirit',
				depthWrite: kind === 'warlock',
				depthCorrection: false,
				fog: false,
				texture: { id: 'data/texture/effect/thunder_center.bmp' }
			});
		}
		// every size branch is drawn
		expect(new Set(records.map(r => r.params.layer))).toEqual(new Set(['outer', 'middle', 'core', 'glow']));
	});

	it('stops emitting after unsubscribe', async () => {
		const records = [];
		await script(kind, Ctor => Ctor.addRecordSink(r => records.push(r))());
		expect(records).toHaveLength(0);
	});
});
