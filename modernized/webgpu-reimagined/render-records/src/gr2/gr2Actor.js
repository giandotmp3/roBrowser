/**
 * The GR2 actor action clock (R-GR2-003), CPU only: the C3dGrannyGameActor state machine
 * legacy Renderer/GR2/actorAction.js transcribes, the entity action → GR2 action mapping
 * (gr2Pack.gr2ActionFor) and the external animation bank table (gr2Banks.js).
 *
 * The model clock is action-relative: every action change (and every re-issue of the same
 * action) restarts the clip at t = 0. A missing animation yields the bind pose
 * (animIndex −1).
 */

/** GR2 action name → animation slot. */
export const GR2_ACTIONS = Object.freeze({
	stand: 0,
	move: 1,
	attack: 2,
	dead: 3,
	damage: 4
});

/** A fresh actor in the standby state. */
export const createGr2Actor = () => ({ name: 'stand', startT: 0, loop: false });

/**
 * Hard cut: restart the action clock at `tNow` and clear the loop latch. Unknown names are
 * ignored.
 * @param {{name: string, startT: number, loop: boolean}} actor
 * @param {string} name
 * @param {number} tNow  ms
 */
export function setGr2Action(actor, name, tNow) {
	if (GR2_ACTIONS[name] === undefined) {
		return;
	}
	actor.name = name;
	actor.startT = tNow;
	actor.loop = false;
}

/**
 * The pose to sample this frame → `{ animIndex, t }` (t in seconds, clip-relative).
 * Evaluated every frame; mutates the actor when a one-shot reverts to standby.
 * - stand: the standby clip looped (or the bind pose for an NPC, standbyIdx < 0);
 * - attack: plays once, then reverts to standby;
 * - dead: holds its last frame;
 * - damage / move: play once then revert (move loops while `actor.loop`); a missing bank
 *   reverts to standby and draws the bind pose this frame.
 * @param {{name: string, startT: number, loop: boolean}} actor
 * @param {{parsed?: {animations?: ReadonlyArray<{duration?: number}|undefined|null>}}} model
 * @param {number} tNow  ms
 * @param {number} standbyIdx
 * @returns {{animIndex: number, t: number}}
 */
export function gr2ActorPose(actor, model, tNow, standbyIdx) {
	const anims = (model.parsed && model.parsed.animations) || [];
	const elapsed = (tNow - actor.startT) / 1000;

	if (actor.name === 'stand') {
		if (standbyIdx < 0) {
			return { animIndex: -1, t: 0 };
		}
		const standbyDur = anims[standbyIdx] ? anims[standbyIdx].duration || 1 : 1;
		return { animIndex: standbyIdx, t: elapsed % standbyDur };
	}

	const idx = GR2_ACTIONS[actor.name];
	const present = anims[idx] != null;

	if (actor.name === 'attack') {
		if (!present) {
			return { animIndex: -1, t: 0 };
		}
		const dur = anims[idx].duration || 1;
		if (elapsed >= dur) {
			setGr2Action(actor, 'stand', tNow);
			return gr2ActorPose(actor, model, tNow, standbyIdx);
		}
		return { animIndex: idx, t: elapsed };
	}

	if (actor.name === 'dead') {
		if (!present) {
			return { animIndex: -1, t: 0 };
		}
		const dur = anims[idx].duration || 1;
		return { animIndex: idx, t: Math.min(elapsed, dur) };
	}

	if (!present) {
		setGr2Action(actor, 'stand', tNow);
		return { animIndex: -1, t: 0 };
	}
	const dur = anims[idx].duration || 1;
	if (actor.loop) {
		return { animIndex: idx, t: elapsed % dur };
	}
	if (elapsed >= dur) {
		setGr2Action(actor, 'stand', tNow);
		return gr2ActorPose(actor, model, tNow, standbyIdx);
	}
	return { animIndex: idx, t: elapsed };
}

/**
 * Entity action → GR2 action name, read through the entity's own ACTION enum (mob and NPC
 * enums differ). Anything unmapped is 'stand'.
 * @param {number} action
 * @param {Record<string, number>} ACTION
 */
export function gr2ActionName(action, ACTION) {
	if (action === ACTION.DIE) {
		return 'dead';
	}
	if (action === ACTION.HURT) {
		return 'damage';
	}
	if (
		action === ACTION.ATTACK ||
		action === ACTION.ATTACK1 ||
		action === ACTION.ATTACK2 ||
		action === ACTION.ATTACK3
	) {
		return 'attack';
	}
	if (action === ACTION.WALK) {
		return 'move';
	}
	return 'stand';
}

/** setId (the `_<N>.gr2` suffix) → the external banks that model ships. */
const GR2_BANKS = Object.freeze({
	2: ['dead', 'damage'],
	7: ['attack', 'damage', 'dead', 'move'],
	8: ['attack', 'damage', 'dead', 'move'],
	9: ['attack', 'damage', 'dead', 'move']
});

/**
 * The external animation bank files of a model (data/model/3dmob_bone/<setId>_<name>.gr2).
 * @param {string} path
 * @returns {{name: string, path: string}[]}
 */
export function gr2BankPaths(path) {
	const match = path.match(/_(\d+)\.gr2$/i);
	const setId = match ? match[1] : null;
	const names = (setId !== null && GR2_BANKS[setId]) || [];
	return names.map(name => ({ name, path: `data/model/3dmob_bone/${setId}_${name}.gr2` }));
}
