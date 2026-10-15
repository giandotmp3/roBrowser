import { GR2_ACTIONS, gr2BankPaths } from './gr2Actor.js';
import { gr2GroundOffset } from './gr2World.js';

/**
 * @typedef {Object} Gr2ModelData  A decoded GR2 model (C-16 decode, outside render-records)
 * @property {{animations: Array<object|undefined>}} parsed  granny-ro-js parse result (poseAt input)
 * @property {ReadonlyArray<{bind: ArrayLike<number>, vcount: number, emblem?: boolean}>} meshes
 * @property {number} boneCount
 * @property {ArrayLike<number>} [ipRow]  InitialPlacement (row-vector)
 */

/**
 * @typedef {Object} Gr2Model  A model the composer can pose (see Gr2ModelSource.get)
 * @property {string} path
 * @property {{animations: Array<object|undefined>}} parsed
 * @property {number} boneCount
 * @property {ArrayLike<number>} [ipRow]
 * @property {number} groundOffset
 * @property {boolean} hasEmblem
 */

/**
 * The GR2 model residency the composer reads (R-GR2-001/003 inputs): one entry per .gr2
 * path, refcounted; the main file is fetched on first acquire and decoded once the decoder
 * is ready; the external animation banks stream in one at a time, the current action's
 * bank first, and are grafted into the shared animation list at their action slot (a
 * missing bank keeps that action on the bind pose). A model that fails to fetch or decode
 * is missing for the session.
 *
 * The I/O and the decode are injected (Client.getFile / GR2Loader / granny-ro-js
 * `parseAnimated` in the client), so the scheduling is the only logic here; it reproduces
 * legacy GR2ModelRenderer.acquire / pumpBanks request for request.
 */
export class Gr2ModelSource {
	/**
	 * @param {{
	 *   fetchFile: (path: string, onLoad: (buffer: ArrayBuffer) => void, onError: () => void) => void,
	 *   decode: (buffer: ArrayBuffer) => Gr2ModelData,
	 *   parseBank: (buffer: ArrayBuffer) => {animations: object[]},
	 *   ready?: () => Promise<unknown>,
	 *   onError?: (path: string, error?: unknown) => void
	 * }} deps
	 */
	constructor({ fetchFile, decode, parseBank, ready = () => Promise.resolve(), onError = () => {} }) {
		this._fetch = fetchFile;
		this._decode = decode;
		this._parseBank = parseBank;
		this._ready = ready;
		this._onError = onError;
		this._readyPromise = null;
		/** @type {Map<string, object>} */
		this._entries = new Map();
		/** @type {Set<string>} */
		this._missing = new Set();
	}

	/**
	 * Take a reference on a model; the first one starts its fetch and decode.
	 * @param {string} path
	 */
	acquire(path) {
		const known = this._entries.get(path);
		if (known) {
			known.refcount++;
			return;
		}
		const banks = gr2BankPaths(path);
		const entry = {
			path,
			refcount: 1,
			model: null,
			banks,
			queue: banks.map(b => b.name),
			loading: false
		};
		this._entries.set(path, entry);
		this._readyPromise ??= this._ready();
		this._fetch(
			path,
			buffer => {
				this._readyPromise.then(() => {
					if (this._entries.get(path) !== entry) {
						return;
					}
					try {
						const data = this._decode(buffer);
						entry.model = Object.freeze({
							path,
							parsed: data.parsed,
							boneCount: data.boneCount,
							ipRow: data.ipRow,
							groundOffset: gr2GroundOffset(data.meshes, data.ipRow),
							hasEmblem: data.meshes.some(m => m.emblem)
						});
					} catch (error) {
						this._missing.add(path);
						this._onError(path, error);
					}
				});
			},
			() => {
				this._missing.add(path);
				this._onError(path);
			}
		);
	}

	/**
	 * Drop a reference (the decoded model stays until clear()).
	 * @param {string} path
	 */
	release(path) {
		const entry = this._entries.get(path);
		if (entry && entry.refcount > 0) {
			entry.refcount--;
		}
	}

	/**
	 * The decoded model, or null while it loads (or when it is missing).
	 * @param {string} path
	 * @returns {Gr2Model|null}
	 */
	get(path) {
		return this._entries.get(path)?.model ?? null;
	}

	/** @param {string} path */
	isMissing(path) {
		return this._missing.has(path);
	}

	/**
	 * Stream the next external bank of a model, `priority` (a GR2 action name) first. One
	 * bank loads at a time per model.
	 * @param {string} path
	 * @param {string} [priority]
	 */
	requestBank(path, priority) {
		const entry = this._entries.get(path);
		if (entry) {
			this._pump(entry, priority);
		}
	}

	_pump(entry, priority) {
		const queue = entry.queue;
		if (priority) {
			const at = queue.indexOf(priority);
			if (at > 0) {
				queue.splice(at, 1);
				queue.unshift(priority);
			}
		}
		if (entry.loading || queue.length === 0) {
			return;
		}
		const name = queue.shift();
		const bank = entry.banks.find(b => b.name === name);
		if (!bank) {
			return;
		}
		entry.loading = true;
		this._fetch(
			bank.path,
			buffer => {
				entry.loading = false;
				if (this._entries.get(entry.path) === entry && entry.model) {
					entry.model.parsed.animations[GR2_ACTIONS[name]] = this._parseBank(buffer).animations[0];
				}
				this._pump(entry);
			},
			() => {
				entry.loading = false;
				this._pump(entry);
			}
		);
	}

	/** Forget every model (map unload); missing paths stay missing. */
	clear() {
		this._entries.clear();
	}
}
