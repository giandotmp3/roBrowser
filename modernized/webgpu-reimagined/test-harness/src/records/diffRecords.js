/**
 * Record-diff oracle (architecture §2.2): compares two ordered record streams.
 *
 * Order is sacred (architecture §1): records are compared position-by-position, never
 * re-sorted. Numeric fields compare with an absolute tolerance (default 1e-5) because the
 * legacy side goes through Float32Array.
 */

/**
 * @param {object[]} expected  reference stream (legacy shim)
 * @param {object[]} actual    subject stream (render-records)
 * @param {object} [opts]
 * @param {number} [opts.epsilon=1e-5]
 * @param {string[]} [opts.ignore] dotted field paths to ignore (e.g. 'texture.id')
 * @param {(r: object) => boolean} [opts.filter] keep only matching records on both sides
 * @returns {{ equal: boolean, diffs: { index: number, path: string, expected: unknown, actual: unknown }[] }}
 */
export function diffRecords(expected, actual, { epsilon = 1e-5, ignore = [], filter } = {}) {
	const a = filter ? expected.filter(filter) : expected;
	const b = filter ? actual.filter(filter) : actual;
	const ignored = new Set(ignore);
	const diffs = [];
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) {
		if (i >= a.length || i >= b.length) {
			diffs.push({ index: i, path: '', expected: a[i], actual: b[i] });
			continue;
		}
		compare(a[i], b[i], '', i, diffs, epsilon, ignored);
	}
	return { equal: diffs.length === 0, diffs };
}

function compare(x, y, path, index, diffs, eps, ignored) {
	if (ignored.has(path)) {
		return;
	}
	if (typeof x === 'number' && typeof y === 'number') {
		if (!(Math.abs(x - y) <= eps || (Number.isNaN(x) && Number.isNaN(y)))) {
			diffs.push({ index, path, expected: x, actual: y });
		}
		return;
	}
	if (x && y && typeof x === 'object' && typeof y === 'object') {
		const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
		for (const k of keys) {
			compare(x[k], y[k], path ? `${path}.${k}` : k, index, diffs, eps, ignored);
		}
		return;
	}
	if (x !== y) {
		diffs.push({ index, path, expected: x, actual: y });
	}
}

/** Human-readable summary for assertion messages. */
export function formatDiff({ diffs }, max = 10) {
	return diffs
		.slice(0, max)
		.map(
			d =>
				`#${d.index} ${d.path || '<record>'}: expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.actual)}`
		)
		.join('\n');
}

/**
 * Split a frame stream into contiguous pipeline-state runs the way backends must
 * (architecture §1): a new run starts only when blend, depth test/write, texture class or
 * record family changes. Used to measure the draw-call win and to assert no regrouping.
 */
export function toRuns(records) {
	const runs = [];
	let prev = null;
	for (const r of records) {
		if (r.kind === 'pass') {
			prev = null;
			continue;
		}
		const key = runKey(r);
		if (prev && prev.key === key) {
			prev.records.push(r);
		} else {
			prev = { key, records: [r] };
			runs.push(prev);
		}
	}
	return runs;
}

function runKey(r) {
	const b = r.blend ? `${r.blend.src}/${r.blend.dst}` : '-';
	const d = r.depth ? `${+r.depth.test}${+r.depth.write}` : '-';
	const t = r.texture ? (r.texture.indexed ? 'r8' : 'rgba8') : '-';
	const fam = r.kind === 'effect' ? `effect:${r.family}` : r.kind;
	return `${fam}|${b}|${d}|${t}`;
}
