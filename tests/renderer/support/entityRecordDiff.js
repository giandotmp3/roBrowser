/**
 * Record-diff driver for the wider entity scenes (RecordDiff.entityScenes.test.js): runs a legacy
 * scene (legacyPcScene.runLegacyScene), and inside every legacy entity.render -- after
 * animations.process / walkProcess / entitiesWalkProcess, right before renderEntity -- snapshots the
 * live legacy entity and runs render-records' EntityRender.renderRecords mixin on it with the same
 * frame context legacy reads (tick, camera, ground seams, Session.Playing). Both record streams are
 * then diffed field by field.
 *
 * Why at render time: legacy moves a walking entity inside render() (walkProcess,
 * EntityRender.js:84-85), so position, direction and walk.dist are only final there. Walking is
 * game state (EntityWalk), not a render rule; the composer is handed the post-walkProcess state.
 *
 * Import only from a test file that has mocked the legacy seams onto `legacySceneMocks.js`.
 */
import {
	BLEND_ADDITIVE,
	EntityRender,
	RecordStream,
	addAttachment,
	createAttachment,
	removeAttachment
} from '../../../modernized/webgpu-reimagined/render-records/src/index.js';
import { runLegacyScene } from './legacyPcScene.js';
import { snapshotLegacyEntity } from './legacyEntitySnapshot.js';
import { mocks } from './legacySceneMocks.js';

export const EPSILON = 1e-5;
const VECTOR_FIELDS = ['position', 'offset', 'size', 'color'];
const NUMBER_FIELDS = ['xSize', 'ySize', 'angle', 'shadowFactor', 'zIndex', 'depthBias'];
const EXACT_FIELDS = ['kind', 'textureClass', 'depthTest', 'depthWrite', 'depthCorrection', 'ignoreDepthMinCap'];
const IDENTITY_FIELDS = ['texture', 'palette'];

/** Native records name the blend 'normal' / 'additive' (SpriteRenderer.js:91). */
export const blendName = blend => (blend === BLEND_ADDITIVE ? 'additive' : 'normal');

/**
 * Field-by-field diff of one frame. Returns mismatches as {frame, index, field, legacy, modern};
 * a different record count is reported once as field 'count'.
 */
export function diffFrame(frame, legacy, modern) {
	const out = [];
	const push = (index, field, l, m) => out.push({ frame, index, field, legacy: l, modern: m });
	if (legacy.length !== modern.length) {
		push(-1, 'count', legacy.length, modern.length);
	}
	for (let i = 0; i < Math.min(legacy.length, modern.length); ++i) {
		const l = legacy[i];
		const m = modern[i];
		for (const field of [...EXACT_FIELDS, ...IDENTITY_FIELDS]) {
			if (l[field] !== m[field]) {
				push(i, field, l[field], m[field]);
			}
		}
		for (const field of NUMBER_FIELDS) {
			if (!(Math.abs(l[field] - m[field]) <= EPSILON)) {
				push(i, field, l[field], m[field]);
			}
		}
		for (const field of VECTOR_FIELDS) {
			const lv = Array.from(l[field]);
			const mv = Array.from(m[field]);
			if (lv.length !== mv.length || lv.some((v, k) => !(Math.abs(v - mv[k]) <= EPSILON))) {
				push(i, field, lv, mv);
			}
		}
		if (l.blend !== blendName(m.blend)) {
			push(i, 'blend', l.blend, blendName(m.blend));
		}
	}
	return out;
}

/**
 * Mirror the legacy entity's AttachmentManager add / remove calls (EntityAttachments.js:50-155)
 * into a render-records attachment list. Only the calls are mirrored: normalisation, lifetime and
 * removal at the end are render-records' own (createAttachment / addAttachment / renderRecords).
 * The sprite is resolved through legacy Client.loadFile, as legacy's add does. STR attachments
 * (R-SPR-032) are left out.
 * @param {object} live legacy entity
 * @param {object[]} list render-records attachment list (mutated)
 */
export function mirrorAttachments(live, list) {
	const manager = live.attachments;
	const add = manager.add.bind(manager);
	const remove = manager.remove.bind(manager);
	manager.add = def => {
		const raw = { ...def };
		add(def);
		const attachment = createAttachment(raw, Date.now());
		if (attachment) {
			const spr = mocks.client.loadFile(attachment.spr) ?? null;
			const act = mocks.client.loadFile(attachment.act) ?? null;
			addAttachment(list, { ...attachment, view: { spr, act } });
		}
	};
	manager.remove = uid => {
		remove(uid);
		removeAttachment(list, uid);
	};
}

/** uids of the legacy entity's sprite attachments (STR ones left out). */
export const legacyAttachmentUids = live => live.attachments.list.filter(a => !a.isStr).map(a => a.uid);

/**
 * Run a legacy scene and the composer side by side.
 *
 * @param {object} opts runLegacyScene options (unit, frames, script, owner, ...) plus:
 * @param {number} [opts.seed]
 * @param {boolean} [opts.pinAnimationClock] pin legacy's spawn clock (discrepancy #13 fix; default true)
 * @param {boolean} [opts.composeStatus] composer derives effectColor / opt3 from the status (R-SPR-018…023)
 * @param {{shadowFactorAt: function, cellHeightAt: function}} [opts.ground] the seams the test
 *        mocked Ground.getShadowFactor / Altitude.getCellHeight with
 * @param {function} [opts.onSnapshot] (snapshot, frameIndex, live) right before renderRecords: a
 *        scene may replace state with what render-records computed itself (e.g. lookTo)
 * The composer's cross-frame state -- after-image `trails` (R-SPR-025) and the mirrored
 * `attachments` list (R-SPR-031) -- is carried from one frame's snapshot to the next.
 * @returns {{legacy: object[][], modern: object[][], states: object[], mismatches: object[], names: Map,
 *            entity: object, lastSnapshot: object|null, attachments: object[]}} `attachments[frame]`
 *            holds the legacy and render-records attachment uids after the frame
 */
export function runEntityDiff({
	seed = 0x5eed,
	pinAnimationClock = true,
	composeStatus = false,
	ground = { shadowFactorAt: () => 1, cellHeightAt: () => 0 },
	onSpawn,
	beforeFrame,
	afterFrame,
	onSnapshot,
	...scene
} = {}) {
	const legacy = [];
	const modern = [];
	const states = [];
	const attachments = [];
	const carried = { trails: {}, attachments: [] };
	let spawnTick = 0;
	let lastSnapshot = null;
	const { names, entity } = runLegacyScene(seed, {
		...scene,
		onSpawn: (spawned, clock) => {
			spawnTick = Date.now();
			if (pinAnimationClock) {
				spawned.animation.tick = spawnTick;
			}
			mirrorAttachments(spawned, carried.attachments);
			if (onSpawn) {
				onSpawn(spawned, clock);
			}
		},
		onNativeRecord: record => legacy[legacy.length - 1].push(record),
		beforeFrame: (frame, live, clock) => {
			legacy.push([]);
			modern.push([]);
			states.push(null);
			if (beforeFrame) {
				beforeFrame(frame, live, clock);
			}
		},
		onRenderState: (frame, live) => {
			const snapshot = snapshotLegacyEntity(live, {
				loadFile: mocks.client.loadFile,
				isSuperNovice: mocks.db.isSuperNovice,
				spawnTick,
				composeStatus,
				session: mocks.session
			});
			states[frame] = {
				position: [...snapshot.position],
				direction: snapshot.direction,
				action: snapshot.action,
				walkDist: snapshot.walk ? snapshot.walk.dist : 0
			};
			snapshot.trails = carried.trails;
			snapshot.attachments = carried.attachments;
			if (onSnapshot) {
				onSnapshot(snapshot, frame, live);
			}
			EntityRender.call(snapshot);
			const stream = new RecordStream();
			stream.beginFrame();
			snapshot.renderRecords(stream, {
				tick: Date.now(),
				camera: { direction: mocks.camera.direction },
				shadowFactorAt: ground.shadowFactorAt,
				cellHeightAt: ground.cellHeightAt,
				playing: mocks.session.Playing,
				prefs: mocks.graphics
			});
			modern[frame] = stream.records;
			lastSnapshot = snapshot;
		},
		afterFrame: (frame, live, clock) => {
			attachments[frame] = {
				legacy: legacyAttachmentUids(live),
				modern: carried.attachments.map(a => a.uid)
			};
			if (afterFrame) {
				afterFrame(frame, live, clock);
			}
		}
	});
	const mismatches = legacy.flatMap((records, frame) => diffFrame(frame, records, modern[frame]));
	return { legacy, modern, states, mismatches, names, entity, lastSnapshot, attachments };
}
