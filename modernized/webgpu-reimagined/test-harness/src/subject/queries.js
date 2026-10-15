/**
 * Observation queries used by the acceptance tests. Pure functions over RunResult /
 * FrameObservation (see SubjectPort.js).
 */
import { RecordKind } from '../records/RecordTypes.js';

export const lastFrame = run => {
	if (!run?.frames?.length) {
		throw new Error('run produced no frames');
	}
	return run.frames[run.frames.length - 1];
};

const matches = (rec, filter = {}) =>
	Object.entries(filter).every(([k, v]) => {
		if (k === 'gid') {
			return rec.owner?.gid === v;
		}
		if (typeof v === 'function') {
			return v(rec[k]);
		}
		return rec[k] === v;
	});

const ofKind = kind => (frame, filter) => frame.records.filter(r => r.kind === kind && matches(r, filter));

export const sprites = ofKind(RecordKind.SPRITE);
export const effects = ofKind(RecordKind.EFFECT);
export const worlds = ofKind(RecordKind.WORLD);
export const damages = ofKind(RecordKind.DAMAGE);

export const world = (frame, layer) => worlds(frame, { layer })[0];

/** Pass names in the order they appear in the frame. */
export const passOrder = frame => frame.records.filter(r => r.kind === RecordKind.PASS).map(r => r.name);

/** Records emitted between pass marker `name` and the next pass marker. */
export function inPass(frame, name) {
	const out = [];
	let inside = false;
	for (const r of frame.records) {
		if (r.kind === RecordKind.PASS) {
			inside = r.name === name;
			continue;
		}
		if (inside) {
			out.push(r);
		}
	}
	return out;
}

/** Index (in stream order) of the first record matching a predicate; -1 if none. */
export const indexOf = (frame, pred) => frame.records.findIndex(pred);

/** Sprite layers of one entity, in draw order. */
export const layersOf = (frame, gid) => sprites(frame, { gid });

export const overlaysOf = (frame, gid) => frame.overlays.filter(o => o.gid === gid);

/** Approximate equality helper for numeric arrays. */
export const near = (a, b, eps = 1e-4) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
