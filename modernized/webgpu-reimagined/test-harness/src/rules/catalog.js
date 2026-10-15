/**
 * Behaviour-contract catalog: the 143 rules of AI_NATIVE_SPEC §5, with owning module
 * (REIMAGINED_ARCHITECTURE §2.1) and how the harness verifies them.
 *
 *   verify: 'record' — asserted on the ordered record stream / frame observation
 *           'cpu'    — asserted on a CPU contract function (subject.cpu)
 *           'gpu'    — asserted with the shared-shader fragment probe (subject.fragment)
 *
 * Flagged rules (`!`) default to FIX (spec §6, HITL #1). Their tests assert the corrected
 * behaviour and cite the legacy rule ID they diverge from.
 */

// id | owner | verify | title       ('!' prefix = flagged legacy bug, fixed in the rebuild)
const TABLE = `
R-CTX-001|gpu|record|Device acquired with fixed attributes; no device means no render
R-CTX-002|gpu|record|Default depth/blend state, restored after every pass that changes it
R-CTX-003|scene|record|Frame-rate cap, boundary snapping, uncapped <=0, 60 outside the game
R-CTX-004|scene|record|Order of work in each frame
R-CTX-005|gpu|record|A render error turns bloom off; device loss exits the loop
R-CTX-006|gpu|record|Device loss: stop, purge, overlay, ignore resize
R-CTX-007|gpu|record|Device restore: hide overlay, default state, PP re-init, resize, resume
R-CTX-008|scene|record|Resize debounce, quality scaling, DPR and projection
R-CTX-009|gpu|record|Clear colour from the map sky table
R-CTX-010|gpu|record|Order of the map render passes
R-CTX-011|scene|record|Map name normalisation and same-map teleport
R-CTX-012|gpu|record|Global light env colour and direction
R-CTX-013|scene|record|Night-mode transition
R-CAM-001|scene|record|Zoom limits
R-CAM-002|scene|record|Initial camera
R-CAM-003|scene|record|Pitch limits
R-CAM-004|scene|record|Yaw limits and rewrap
R-CAM-005|scene|record|Double right-click resets
R-CAM-006|scene|record|Smoothing
R-CAM-007|scene|record|View matrix
R-CAM-008|scene|record|Camera direction index
R-CAM-009|scene|record|First- and third-person modes
R-CAM-010|scene|record|Screen quake
R-CAM-011|scene|record|Zoom is saved after 3 s
R-MAP-001|gpu|gpu|Ground shading
R-MAP-002|gpu|gpu|Lightmap quality preference
R-MAP-003|gpu|gpu|Ground alpha cutout
R-MAP-004|gpu|gpu|Fog formula
R-MAP-005|gpu|cpu|Ground texture atlas
R-MAP-006|gpu|cpu|Lightmap atlas
R-MAP-007|gpu|cpu|Tile colour is BGRA
R-MAP-008|gpu|record|Water wave
R-MAP-009|gpu|record|Water texture animation
!R-MAP-010|gpu|gpu|Water opacity applied once (fixed)
R-MAP-011|gpu|record|Water geometry and depth
R-MAP-012|gpu|gpu|Static RSM model shading
!R-MAP-013|gpu|gpu|Animated RSM honours the lightmap preference (fixed)
R-MAP-014|gpu|cpu|RSM instance transform
R-MAP-015|gpu|cpu|RSM normals
R-MAP-016|render-records|record|Animated RSM timing
R-MAP-017|render-records|cpu|Animated RSM node hierarchy
R-MAP-018|gpu|record|Occluder fade enablement
R-MAP-019|gpu|record|Occluder detection
R-MAP-020|gpu|gpu|Occluder fade shape and modes
R-MAP-021|gpu|record|Grid selector
R-MAP-022|gpu|record|Sky clouds
R-MAP-023|scene|cpu|Cell height interpolation
R-MAP-024|gpu|cpu|Magenta colour key on images
R-SPR-001|render-records|record|Sprite direction
R-SPR-002|render-records|gpu|Spherical billboard
R-SPR-003|render-records|record|Sprite pixel scale
R-SPR-004|render-records|record|Entity lift
R-SPR-005|render-records|gpu|Billboard depth correction
R-SPR-006|render-records|record|z-index bias within an entity
R-SPR-007|render-records|record|Player and mercenary layer order
R-SPR-008|render-records|record|Duplicate headgear suppression
R-SPR-009|render-records|record|Robe z-correction
R-SPR-010|render-records|record|Cart offsets
R-SPR-011|render-records|record|Shadow
R-SPR-012|render-records|record|Ground shadow darkens sprites
R-SPR-013|render-records|record|Depth write by entity type
R-SPR-014|render-records|gpu|Palette sprites
R-SPR-015|render-records|record|Palette selection
R-SPR-016|render-records|cpu|RGBA sprite frames
R-SPR-017|render-records|record|Final sprite colour
R-SPR-018|render-records|record|effectColor composition
R-SPR-019|render-records|record|Body state tints
R-SPR-020|render-records|record|Health state tints
R-SPR-021|render-records|record|Invisibility states
R-SPR-022|render-records|record|Buff (virtue) tints
R-SPR-023|render-records|record|Additive bodies
R-SPR-024|render-records|record|Assumptio halo
R-SPR-025|render-records|record|After-image trails
R-SPR-026|render-records|record|Removal fade
R-SPR-027|render-records|record|Animation frame selection
R-SPR-028|render-records|record|Walk cadence follows distance
R-SPR-029|render-records|record|Head turning (lookTo)
R-SPR-030|render-records|record|Entity draw order
R-SPR-031|render-records|record|Sprite attachments
R-SPR-032|render-records|record|STR attachments scale with the entity
R-SPR-033|render-records|record|Dropped item falls
R-SPR-034|preview2d|cpu|2D preview path (UI)
R-EFX-001|render-records|record|Effect toggles
R-EFX-002|render-records|record|Duplicated effect instances
R-EFX-003|render-records|record|Effect timing
R-EFX-004|render-records|record|Effect repeat
R-EFX-005|render-records|record|Effect distance culling
R-EFX-006|render-records|record|Before- and after-entity passes
R-EFX-007|render-records|record|STR keyframes
R-EFX-008|gpu|record|STR blending
R-EFX-009|gpu|record|STR billboard
!R-EFX-010|gpu|record|STR effects are fogged like everything else (fixed)
!R-EFX-011|render-records|record|2D/3D/cylinder/QuadHorn blend normalised into one enum (fixed)
R-EFX-012|render-records|record|Alpha envelope for 2D and 3D effects
R-EFX-013|gpu|record|Overlay flag
R-EFX-014|gpu|record|Additive effect families
R-EFX-015|render-records|record|Level-99 aura
R-EFX-016|render-records|record|Map-flag weather
R-EFX-017|render-records|record|Weather parameters
R-EFX-018|gpu|record|Poison screen tint
R-DMG-001|render-records|record|Lifetime and colour
R-DMG-002|render-records|record|Normal hit motion
R-DMG-003|render-records|record|Heal motion
!R-DMG-004|render-records|record|Miss and Lucky live exactly as long as visible, 800 ms (fixed)
R-DMG-005|render-records|record|Combo title
R-DMG-006|render-records|record|Critical background
R-DMG-007|render-records|record|Number texture
R-DMG-008|render-records|record|Damage skins
!R-DMG-009|render-records|record|Damage depth bias does not leak (fixed)
R-PP-001|gpu|record|Module order
R-PP-002|gpu|record|Scene target
R-PP-003|gpu|record|Performance-mode resolution
R-PP-004|gpu|gpu|Bloom
R-PP-005|gpu|gpu|Peripheral blur
!R-PP-006|gpu|gpu|FXAA honours fxaaSubpix (fixed)
!R-PP-007|gpu|gpu|CAS sharpening can be set to 0 (fixed)
R-PP-008|gpu|gpu|Cartoon
!R-PP-009|gpu|gpu|Vibrance can be set to 0 (fixed)
R-PP-010|gpu|gpu|Blind status
!R-PP-011|scene|record|Illusion flip mirrors picking and all overlays (fixed)
R-PP-012|gpu|record|Post-process defaults
R-PICK-001|scene|record|Ground ray-march
R-PICK-002|scene|record|Mouse world state and walk cursor
R-PICK-003|scene|record|Entity hit rectangle
R-PICK-004|scene|record|Pick priority
R-PICK-005|scene|record|Pick exclusions
R-PICK-006|scene|record|Hover events
R-PICK-007|scene|record|GR2 pick area
R-UI-001|scene|record|Overlay anchors
!R-UI-002|scene|record|Life bar; AP and hunger bars do not overlap (fixed)
R-UI-003|scene|record|Culled entities hide their overlays
R-UI-004|scene|record|Signboards
R-UI-005|scene|record|Game cursor
R-PERF-001|scene|record|Entity view-area culling
R-PERF-002|scene|record|Summary of performance-mode reductions
R-PERF-003|gpu|record|Mipmaps are opt-in
R-PERF-004|gpu|record|Model batching
R-GR2-001|gpu|record|Model roster and lighting
R-GR2-002|gpu|gpu|Hard alpha test
R-GR2-003|render-records|record|Pose timing
R-GR2-004|render-records|record|Facing and culling
R-GR2-005|render-records|record|No removal fade by default
R-GR2-006|gpu|cpu|Guild flag emblem
`;

/** @type {ReadonlyArray<{ id: string, family: string, owner: string, verify: string, title: string, flagged: boolean }>} */
export const RULES = Object.freeze(
	TABLE.trim()
		.split('\n')
		.map(line => {
			const [rawId, owner, verify, title] = line.split('|');
			const flagged = rawId.startsWith('!');
			const id = flagged ? rawId.slice(1) : rawId;
			return Object.freeze({ id, family: id.split('-')[1], owner, verify, title, flagged });
		})
);

const BY_ID = new Map(RULES.map(r => [r.id, r]));

export const getRule = id => {
	const r = BY_ID.get(id);
	if (!r) {
		throw new Error(`unknown behaviour rule ${id}`);
	}
	return r;
};

export const FLAGGED_RULE_IDS = Object.freeze(RULES.filter(r => r.flagged).map(r => r.id));
