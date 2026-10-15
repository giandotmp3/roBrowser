/**
 * Record-diff parity (architecture §5):
 *  - phase 1 gate: legacy scenes replay deterministically (same seed → same records);
 *  - phase 2 gate: record-diff green on all non-flagged rules (flagged fixes excluded per scene).
 *
 * Needs both adapters from the environment; skipped (not failed) until they exist:
 *   HARNESS_REFERENCE_MODULE=${HARNESS_REFERENCE_MODULE}   legacy renderer + record shim
 *   HARNESS_SUBJECT_MODULE=${HARNESS_SUBJECT_MODULE}       render-records + scene
 */
import { describe, it, expect } from 'vitest';
import { PARITY_SCENES, divergenceOptions } from '../../src/scenes/catalog.js';
import { resolveReference, resolveSubject } from '../../src/subject/SubjectPort.js';
import { createDeterministicPorts } from '../../src/determinism/installDeterminism.js';
import { diffRecords, formatDiff } from '../../src/records/diffRecords.js';

const hasRef = !!process.env.HARNESS_REFERENCE_MODULE;
const hasSubject = !!process.env.HARNESS_SUBJECT_MODULE;

describe('parity: phase 1 — legacy replays deterministically', () => {
	for (const def of PARITY_SCENES) {
		it.skipIf(!hasRef)(`${def.id} replays identically under the same seed [${def.rules.join(', ')}]`, async () => {
			const script = def.build();
			const a = await (
				await resolveReference({ ports: createDeterministicPorts({ seed: script.seed }).ports })
			).run(script);
			const b = await (
				await resolveReference({ ports: createDeterministicPorts({ seed: script.seed }).ports })
			).run(script);
			a.frames.forEach((f, i) => {
				const d = diffRecords(f.records, b.frames[i].records, { epsilon: 0 });
				expect(d.equal, formatDiff(d)).toBe(true);
			});
		});
	}
});

describe('parity: phase 2 — render-records matches legacy records (flagged fixes excluded)', () => {
	for (const def of PARITY_SCENES) {
		it.skipIf(!hasRef || !hasSubject)(`${def.id} [${def.rules.join(', ')}]`, async () => {
			const script = def.build();
			const ref = await (
				await resolveReference({ ports: createDeterministicPorts({ seed: script.seed }).ports })
			).run(script);
			const sub = await (
				await resolveSubject({ ports: createDeterministicPorts({ seed: script.seed }).ports })
			).run(script);
			expect(sub.frames.length).toBe(ref.frames.length);
			const opts = divergenceOptions(def);
			ref.frames.forEach((f, i) => {
				const d = diffRecords(f.records, sub.frames[i].records, opts);
				expect(d.equal, `frame ${i}\n${formatDiff(d)}`).toBe(true);
			});
		});
	}
});
