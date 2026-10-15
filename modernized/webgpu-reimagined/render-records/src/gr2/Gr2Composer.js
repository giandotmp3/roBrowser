import { BLEND_NORMAL } from '../records/blend.js';
import { createWorldDraw } from '../records/WorldDraw.js';
import { GR2_CULL_MARGIN, GR2_MAX_BONES, GR2_POSE_HZ, poseCacheKey } from './GR2Pose.js';
import { createGr2Actor, gr2ActionName, gr2ActorPose, setGr2Action } from './gr2Actor.js';
import { gr2InstanceWorld, gr2LightFor } from './gr2World.js';

/**
 * @typedef {Object} Gr2EntityState  What the GR2 pass reads from an entity, one frame late
 *   (R-GR2-003: GR2 runs before the entity pass, so it sees the previous frame's state)
 * @property {ArrayLike<number>} position     [cellX, cellY, cellHeight] (height negated)
 * @property {number} direction               0..7
 * @property {number} action                  entity action
 * @property {Record<string, number>} ACTION  the entity's action enum (mob and NPC differ)
 * @property {number} animTick                bumped on every setAction (re-issue restarts the clip)
 * @property {number} effectAlpha             effectColor[3]
 * @property {boolean} [culled]               EntityManager view-area cull
 * @property {unknown} [emblem]               live guild emblem image handle, or null
 * @property {number} [removeTick]            removal start (Date.now ms), 0 when not removing
 * @property {number} [removeDelay]
 */

/**
 * @typedef {Object} Gr2Record  WorldDraw-shaped GR2 instance draw (the gpu-* backends' input)
 * @property {'world'} kind
 * @property {'gr2'} part
 * @property {number} alpha                 0..1; < 1 blends (R-GR2-005)
 * @property {Float32Array} matrices        bone palette: boneCount column-major mat4 (R-GR2-003)
 * @property {import('../records/blend.js').BlendState} blend  normal alpha, applied only while fading
 * @property {true} depthTest
 * @property {true} depthWrite
 * @property {{type: string, world: Float32Array, emblem: unknown, light: {diffuse: ArrayLike<number>, ambient: ArrayLike<number>}}} params
 */

/**
 * R-GR2-003: pose time bucket (40 Hz) of a clip-relative time in seconds, as the pose cache
 * keys it (nearest bucket).
 * @param {number} tSeconds
 */
export const gr2PoseBucket = tSeconds => Math.round(tSeconds * GR2_POSE_HZ);

/**
 * R-GR2-004 frustum cull of a clip-space ground anchor: behind the camera (w ≤ 0) or
 * beyond the [−1, 1] NDC box padded by 0.2 on x or y.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 */
export function gr2CullClip(x, y, w) {
	if (w <= 0) {
		return true;
	}
	const m = (1 + GR2_CULL_MARGIN) * w;
	return x < -m || x > m || y < -m || y > m;
}

/** Ground anchor (world x = cellX, up = −height, z = cellY) to clip space (float64). */
function anchorClip(pos, mv, p) {
	const x = pos[0];
	const y = -pos[2];
	const z = pos[1];
	const vx = mv[0] * x + mv[4] * y + mv[8] * z + mv[12];
	const vy = mv[1] * x + mv[5] * y + mv[9] * z + mv[13];
	const vz = mv[2] * x + mv[6] * y + mv[10] * z + mv[14];
	const vw = mv[3] * x + mv[7] * y + mv[11] * z + mv[15];
	return [
		p[0] * vx + p[4] * vy + p[8] * vz + p[12] * vw,
		p[1] * vx + p[5] * vy + p[9] * vz + p[13] * vw,
		p[3] * vx + p[7] * vy + p[11] * vz + p[15] * vw
	];
}

/** granny skinning matrices → one contiguous palette (boneCount mat4). */
function flattenPalette(pose, boneCount) {
	const out = new Float32Array(boneCount * 16);
	for (let i = 0; i < boneCount; i++) {
		out.set(pose.skinningMatrices[i], i * 16);
	}
	return out;
}

/**
 * GR2 instance composer (C-14, R-GR2-001 lighting, R-GR2-003…005): turns the live GR2
 * instances into `world`/`gr2` records in legacy draw order (instance insertion order).
 *
 * Per instance and frame, like legacy GR2ModelRenderer.render:
 * 1. skipped while its model loads (or is missing);
 * 2. entity-backed: the entity state is synced (a position or facing change rebuilds the
 *    world matrix; a mob's GR2 action restarts its clock on any change or re-issue and
 *    prioritises that action's bank; NPCs stay on the bind pose);
 * 3. culled by the entity cull flag, then by its ground anchor (0.2 NDC margin): a culled
 *    instance neither poses nor draws;
 * 4. posed at 40 Hz through a pose cache keyed (path, anim, bucket) that persists while
 *    the bucket is unchanged (the cached palette is the one sampled first in that bucket,
 *    possibly on an earlier frame); same-type same-phase instances share one palette;
 * 5. alpha = effectColor[3] (× the removal fade only when its toggle is on; both off by
 *    default), clamped; no shadow blob.
 *
 * `poseAt(parsed, animIndex, t)` (granny-ro-js) and the clock are injected.
 */
export class Gr2Composer {
	/**
	 * @param {{
	 *   models: import('./Gr2ModelSource.js').Gr2ModelSource,
	 *   poseAt: (parsed: object, animIndex: number, t: number) => {skinningMatrices: ArrayLike<number>[]},
	 *   now?: () => number,
	 *   fade?: {death: boolean, vanish: boolean}
	 * }} deps
	 */
	constructor({ models, poseAt, now = () => Date.now(), fade = { death: false, vanish: false } }) {
		this.models = models;
		this.poseAt = poseAt;
		this.now = now;
		/** R-GR2-005 removal-fade toggles (off = the instance pops). */
		this.fade = fade;
		/** @type {object[]} */
		this.instances = [];
		this._poseCache = new Map();
		/** Instances skipped because their skeleton exceeds the 48-bone palette. */
		this.overBoneLimit = 0;
	}

	/**
	 * An entity-backed instance (mob: animated standby; NPC: bind pose, never action-driven).
	 * @param {{path: string, npc: boolean, position: ArrayLike<number>, direction: number}} spec
	 */
	attach({ path, npc, position, direction }) {
		this.models.acquire(path);
		const inst = {
			path,
			entity: true,
			world: null,
			actor: createGr2Actor(),
			dir: direction,
			pos: [position[0], position[1], position[2]],
			standbyIdx: npc ? -1 : 0,
			lastAction: 'stand',
			lastTick: 0,
			emblem: null
		};
		this.instances.push(inst);
		return inst;
	}

	/**
	 * A dev instance with no entity (no action sync, no emblem, alpha 1).
	 * @param {string} path
	 * @param {{pos: ArrayLike<number>, dir?: number, action?: string, standbyIdx?: number}} opts
	 *   pos[2] is the cell height
	 */
	spawn(path, { pos, dir = 0, action, standbyIdx = 0 }) {
		this.models.acquire(path);
		const actor = createGr2Actor();
		if (action && action !== 'stand') {
			setGr2Action(actor, action, 0);
			if (action === 'move') {
				actor.loop = true;
			}
		}
		const inst = {
			path,
			entity: false,
			world: null,
			actor,
			dir,
			pos: [pos[0], pos[1], pos[2]],
			standbyIdx,
			lastAction: 'stand',
			lastTick: 0,
			emblem: null
		};
		this.instances.push(inst);
		return inst;
	}

	/** @param {object} inst */
	detach(inst) {
		const at = this.instances.indexOf(inst);
		if (at !== -1) {
			this.instances.splice(at, 1);
		}
		this.models.release(inst.path);
	}

	/** Drop every instance and the pose cache. */
	clear() {
		for (const inst of this.instances.slice()) {
			this.detach(inst);
		}
		this._poseCache = new Map();
	}

	/**
	 * Compose one frame of GR2 records (R-CTX-010 step 11).
	 * @param {{
	 *   modelView: ArrayLike<number>, projection: ArrayLike<number>,
	 *   light: {ambient?: ArrayLike<number>, diffuse?: ArrayLike<number>}|null,
	 *   tick: number,
	 *   states?: Map<object, Gr2EntityState>
	 * }} frame  `states`: the entity state of each entity-backed instance as the GR2 pass sees
	 *   it (see gr2FrameState: the previous frame's)
	 * @returns {Gr2Record[]}
	 */
	compose({ modelView, projection, light, tick, states = new Map() }) {
		const records = [];
		if (this.instances.length === 0 || !light) {
			return records;
		}
		const seen = new Map();
		for (const inst of this.instances) {
			const model = this.models.get(inst.path);
			if (!model) {
				continue;
			}
			const state = inst.entity ? states.get(inst) : null;
			if (state) {
				this._sync(inst, state, tick);
				if (model.hasEmblem) {
					inst.emblem = state.emblem || null;
				}
			}
			if (state?.culled) {
				continue;
			}
			const [cx, cy, cw] = anchorClip(inst.pos, modelView, projection);
			if (gr2CullClip(cx, cy, cw)) {
				continue;
			}
			if (!inst.world) {
				inst.world = gr2InstanceWorld(inst.dir, inst.pos, model);
			}
			const { animIndex, t } = gr2ActorPose(inst.actor, model, tick, inst.standbyIdx);
			if (model.boneCount > GR2_MAX_BONES) {
				this.overBoneLimit++;
				continue;
			}
			const key = poseCacheKey(inst.path, animIndex, gr2PoseBucket(t));
			let palette = seen.get(key) ?? this._poseCache.get(key);
			if (!palette) {
				palette = flattenPalette(
					this.poseAt(model.parsed, animIndex < 0 ? -1 : animIndex, animIndex < 0 ? 0 : t),
					model.boneCount
				);
			}
			seen.set(key, palette);
			records.push(
				createWorldDraw({
					part: 'gr2',
					alpha: state ? this._alpha(state) : 1,
					matrices: palette,
					blend: BLEND_NORMAL,
					depthTest: true,
					depthWrite: true,
					params: Object.freeze({
						type: inst.path,
						world: inst.world,
						emblem: model.hasEmblem ? inst.emblem : null,
						light: gr2LightFor(inst.path, light)
					})
				})
			);
		}
		this._poseCache = seen;
		return records;
	}

	/** Pull the entity state onto the instance (legacy syncFromEntity). */
	_sync(inst, state, tick) {
		const p = state.position;
		if (inst.pos[0] !== p[0] || inst.pos[1] !== p[1] || inst.pos[2] !== p[2] || inst.dir !== state.direction) {
			inst.pos = [p[0], p[1], p[2]];
			inst.dir = state.direction;
			inst.world = null;
		}
		if (inst.standbyIdx < 0) {
			return;
		}
		const name = gr2ActionName(state.action, state.ACTION);
		this.models.requestBank(inst.path, name);
		if (name !== inst.lastAction || state.animTick !== inst.lastTick) {
			setGr2Action(inst.actor, name, tick);
			inst.actor.loop = name === 'move';
			inst.lastAction = name;
			inst.lastTick = state.animTick;
		}
	}

	/** R-GR2-005 alpha: effectColor alpha, × the removal fade when its toggle is on. */
	_alpha(state) {
		let alpha = state.effectAlpha;
		if (state.removeTick && state.removeDelay) {
			const isDeath = state.action === state.ACTION.DIE;
			if (isDeath ? this.fade.death : this.fade.vanish) {
				alpha *= 1 - (this.now() - state.removeTick) / state.removeDelay;
			}
		}
		return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
	}
}
