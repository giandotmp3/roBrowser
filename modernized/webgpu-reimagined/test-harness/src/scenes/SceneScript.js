/**
 * Scripted scenes (architecture §2.2 "record-diff oracle running scripted scenes").
 *
 * A SceneScript is a frozen, JSON-serialisable list of steps plus a seed. The same script
 * runs on the legacy shim subject and on the new pipeline, so it may only use the public
 * facade vocabulary of AI_NATIVE_SPEC §3.1 (setMap, entities.add, effects.spam, damage.add,
 * camera.control, screenEffects, graphics.settings, ...) plus harness controls (advance,
 * capture, input, device events).
 */
import { HarnessContractError } from '../errors.js';

export const SceneOp = Object.freeze({
	VIEWPORT: 'viewport', // { width, height, dpr, quality }
	PREFERENCES: 'preferences', // patch over GraphicsSettings / MapPreferences / CameraPreferences
	CONFIG: 'config', // patch over Configs (enableMipmap, quality, CameraMaxZoomOut, FirstPersonCamera, ...)
	SESSION: 'session', // { playing, localGid, intravision, supportSkillMode, aura }
	PACKETVER: 'packetver', // number, e.g. 20200101
	MAP: 'map', // { name, fixture }
	WORKER: 'worker', // raw worker message (C-17)
	CAMERA: 'camera', // { method, args } — setTarget, rotate, setZoom, setQuake, ...
	ENTITY_ADD: 'entity.add',
	ENTITY_UPDATE: 'entity.update',
	ENTITY_REMOVE: 'entity.remove', // { gid, reason: 'out-of-sight'|'death'|'logout'|'teleport' }
	EFFECT_SPAM: 'effect.spam', // EF_Init_Par
	EFFECT_REMOVE: 'effect.remove',
	DAMAGE_ADD: 'damage.add', // { amount, gid, weapon, type }
	SCREEN: 'screen', // { method: 'setNight'|'parseStatus'|'cleanStatusEffect'|'clean', args }
	ITEM_ADD: 'item.add',
	SIGNBOARD_ADD: 'signboard.add',
	INPUT: 'input', // { type: 'mousemove'|'wheel'|'rightdrag'|'rightdown'|'key', ... }
	LOOP_REGISTER: 'loop.register', // { id, throws }
	DEVICE: 'device', // { event: 'lost'|'restored'|'resize' }
	ADVANCE: 'advance', // { ms, frames } — time passes, frames render, observations captured
	CAPTURE: 'capture' // { what: 'screenshot'|'pixels' }
});

const VALID = new Set(Object.values(SceneOp));

export class SceneScript {
	/** @param {{ name?: string, seed?: number }} [opts] */
	constructor({ name = 'scene', seed = 0x5eed } = {}) {
		this.name = name;
		this.seed = seed;
		this.steps = [];
	}

	step(op, args = {}) {
		if (!VALID.has(op)) {
			throw new HarnessContractError(`unknown scene op: ${op}`);
		}
		this.steps.push(Object.freeze({ op, ...structuredClone(args) }));
		return this;
	}

	viewport(v) {
		return this.step(SceneOp.VIEWPORT, v);
	}
	preferences(p) {
		return this.step(SceneOp.PREFERENCES, { patch: p });
	}
	config(c) {
		return this.step(SceneOp.CONFIG, { patch: c });
	}
	session(s) {
		return this.step(SceneOp.SESSION, s);
	}
	packetver(v) {
		return this.step(SceneOp.PACKETVER, { value: v });
	}
	map(name, fixture) {
		return this.step(SceneOp.MAP, { name, fixture });
	}
	worker(type, payload) {
		return this.step(SceneOp.WORKER, { type, payload });
	}
	camera(method, ...args) {
		return this.step(SceneOp.CAMERA, { method, args });
	}
	entity(def) {
		if (def?.gid == null) {
			throw new HarnessContractError('entity fixture needs a gid');
		}
		return this.step(SceneOp.ENTITY_ADD, { entity: def });
	}
	updateEntity(gid, patch) {
		return this.step(SceneOp.ENTITY_UPDATE, { gid, patch });
	}
	removeEntity(gid, reason = 'out-of-sight') {
		return this.step(SceneOp.ENTITY_REMOVE, { gid, reason });
	}
	effect(params) {
		return this.step(SceneOp.EFFECT_SPAM, { params });
	}
	removeEffect(ctor, ownerAID, effectId) {
		return this.step(SceneOp.EFFECT_REMOVE, { ctor, ownerAID, effectId });
	}
	damage(d) {
		return this.step(SceneOp.DAMAGE_ADD, d);
	}
	screen(method, ...args) {
		return this.step(SceneOp.SCREEN, { method, args });
	}
	item(i) {
		return this.step(SceneOp.ITEM_ADD, i);
	}
	signboard(s) {
		return this.step(SceneOp.SIGNBOARD_ADD, s);
	}
	input(e) {
		return this.step(SceneOp.INPUT, e);
	}
	loop(id, opts = {}) {
		return this.step(SceneOp.LOOP_REGISTER, { id, ...opts });
	}
	device(event, args = {}) {
		return this.step(SceneOp.DEVICE, { event, ...args });
	}
	/** Advance time by `ms`, rendering `frames` evenly spaced frames (default 1). */
	advance(ms, frames = 1) {
		return this.step(SceneOp.ADVANCE, { ms, frames });
	}
	/** Render `n` frames of `dt` ms each. */
	frames(n, dt = 1000 / 60) {
		return this.advance(n * dt, n);
	}
	capture(what = 'screenshot') {
		return this.step(SceneOp.CAPTURE, { what });
	}

	build() {
		return Object.freeze({ name: this.name, seed: this.seed, steps: Object.freeze([...this.steps]) });
	}
}

export const scene = (name, seed) => new SceneScript({ name, seed });
