import { describe, it, expect } from 'vitest';
import { makeScene } from '../support/fakes.js';
import { ViewerScene } from '../../src/domain/ViewerScene.js';

/**
 * Interface contract (AI_NATIVE_SPEC §3.1): the scene keeps the legacy public API exactly.
 */
describe('§3.1 inbound facade surface owned by scene', () => {
	const { scene } = makeScene();

	it.each([
		['Renderer', ['init', 'render', 'stop', 'resize']],
		['MapRenderer', ['setMap', 'onLoad', 'free', 'onWorkerMessage']],
		['EntityManager', ['add', 'remove', 'get', 'getByCID', 'forEach', 'getClosestEntity', 'getLowestHpEntity', 'getOverEntity', 'setOverEntity', 'getFocusEntity', 'free']],
		['EffectManager', ['spam', 'spamSkill', 'remove', 'startOrRestartWeather', 'free']],
		['Damage', ['add', 'free']],
		['Camera', ['setTarget', 'init', 'rotate', 'setZoom', 'setQuake']],
		['ScreenEffectManager', ['setNight', 'parseStatus', 'cleanStatusEffect', 'clean']],
		['SignboardManager', ['add']],
		['ItemObject', ['add', 'remove']]
	])('%s exposes %j', (name, methods) => {
		for (const m of methods) {
			expect(typeof scene[name][m], `${name}.${m}`).toBe('function');
		}
	});

	it('Renderer exposes tick/width/height/contextLost; MapRenderer exposes scene.state fields', () => {
		expect(typeof scene.Renderer.tick).toBe('number');
		expect(typeof scene.Renderer.width).toBe('number');
		expect(typeof scene.Renderer.height).toBe('number');
		expect(scene.Renderer.contextLost).toBe(false);
		for (const k of ['currentMap', 'loading', 'fog', 'light', 'altitude']) {
			expect(scene.MapRenderer).toHaveProperty(k);
		}
	});

	it('Camera exposes zoomFinal, angleFinal, modelView, direction (camera.matrices)', () => {
		expect(scene.Camera.zoomFinal).toBeTypeOf('number');
		expect(scene.Camera.angleFinal).toHaveLength(2);
		expect(scene.Camera.modelView).toHaveLength(16);
		expect(scene.Camera.direction).toBeTypeOf('number');
	});

	it('EffectManager.remove accepts a constructor or its class-name alias (architecture M6)', () => {
		const { scene: s, calls } = makeScene();
		class StrEffect {}
		s.EffectManager.remove(StrEffect, 10, 5);
		s.EffectManager.remove('StrEffect', 10, 5);
		s.EffectManager.remove(null, 10);
		expect(calls.filter((c) => c[0] === 'effects.remove')).toEqual([
			['effects.remove', 'StrEffect', 10, 5],
			['effects.remove', 'StrEffect', 10, 5],
			['effects.remove', null, 10, undefined]
		]);
	});

	it('ItemObject.add registers an ITEM entity with the entity manager', () => {
		const { scene: s } = makeScene();
		s.ItemObject.add(55, 501, true, 1, 3, 4, 0);
		expect(s.EntityManager.get(55)).toMatchObject({ kind: 'ITEM', position: [3, 4, 0] });
		s.ItemObject.remove(55);
		expect(s.EntityManager.get(55)).toBeNull();
	});
});

describe('C-18 map-less ViewerScene', () => {
	it('[C-18] items can be added/removed without a map', () => {
		const v = new ViewerScene({ records: { emitFrame: () => {} } });
		const item = v.add({ kind: 'rsm', ref: {} });
		expect(v.items).toHaveLength(1);
		v.remove(item);
		expect(v.items).toHaveLength(0);
	});

	it.fails('[C-18][pending] render() emits a backend-neutral frame through the records port', () => {
		const frames = [];
		const v = new ViewerScene({ records: { emitFrame: (f) => frames.push(f) } });
		v.render(0);
		expect(frames).toHaveLength(1);
	});
});
