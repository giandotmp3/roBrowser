/**
 * Recorder: collects the ordered record stream per frame.
 * Both the legacy shim and the new pipeline write into a Recorder, so both sides of the
 * record-diff oracle have the same shape.
 */
import { normalizeRecord, passMarker } from './RecordTypes.js';

export class Recorder {
	constructor() {
		/** @type {{ index: number, tick: number, records: object[] }[]} */
		this.frames = [];
		this._current = null;
	}

	beginFrame(tick) {
		if (this._current) {
			this.endFrame();
		}
		this._current = { index: this.frames.length, tick, records: [] };
	}

	pass(name) {
		this._require().records.push(passMarker(name));
	}

	push(record) {
		this._require().records.push(normalizeRecord(record));
	}

	endFrame() {
		if (this._current) {
			this.frames.push(Object.freeze({ ...this._current, records: Object.freeze(this._current.records) }));
			this._current = null;
		}
	}

	get lastFrame() {
		return this.frames[this.frames.length - 1];
	}

	_require() {
		if (!this._current) {
			this.beginFrame(0);
		}
		return this._current;
	}

	toJSON() {
		return { frames: this.frames };
	}
}
