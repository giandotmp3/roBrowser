/**
 * test-harness public API (REIMAGINED_ARCHITECTURE §2.1: Recorder, SeededRng, FakeClock, GoldenSet).
 */
export { SeededRng } from './determinism/SeededRng.js';
export { FakeClock, FAKE_EPOCH_MS } from './determinism/FakeClock.js';
export { installDeterminism, createDeterministicPorts } from './determinism/installDeterminism.js';
export {
	Blend,
	BlendFactor,
	RecordKind,
	MAP_PASSES,
	spriteDraw,
	effectDraw,
	worldDraw,
	damageDraw,
	passMarker,
	normalizeRecord
} from './records/RecordTypes.js';
export { Recorder } from './records/Recorder.js';
export { diffRecords, formatDiff, toRuns } from './records/diffRecords.js';
export { installLegacyRecordShim } from './legacy/LegacyRecordShim.js';
export { SceneScript, SceneOp, scene } from './scenes/SceneScript.js';
export * as fixtures from './scenes/fixtures.js';
export { NotImplementedSubject, resolveSubject, resolveReference } from './subject/SubjectPort.js';
export * as queries from './subject/queries.js';
export { RULES, getRule, FLAGGED_RULE_IDS } from './rules/catalog.js';
export { IMPLEMENTED, isPending, PENDING_RULE_IDS } from './rules/pending.js';
export { GOLDENS, Backend, goldenMatrix, goldenPath } from './golden/GoldenSet.js';
export { compareImages } from './golden/perceptual.js';
export { NotImplementedError, HarnessContractError } from './errors.js';
