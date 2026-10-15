/**
 * Scene-side entity classification used by picking/culling/overlays.
 * The legacy numeric Entity.TYPE_* map onto these in the compatibility layer.
 * @typedef {'PC'|'MOB'|'NPC'|'ITEM'|'EFFECT'|'FALCON'|'WUG'|'HOM'|'MERC'|'ELEM'|'PET'|'ABR'|'BIONIC'|'WARP'|'UNKNOWN'} EntityKind
 */
export const EntityKind = Object.freeze({
	PC: 'PC',
	MOB: 'MOB',
	NPC: 'NPC',
	ITEM: 'ITEM',
	EFFECT: 'EFFECT',
	FALCON: 'FALCON',
	WUG: 'WUG',
	HOM: 'HOM',
	MERC: 'MERC',
	ELEM: 'ELEM',
	PET: 'PET',
	ABR: 'ABR',
	BIONIC: 'BIONIC',
	WARP: 'WARP',
	UNKNOWN: 'UNKNOWN'
});

/**
 * Minimal scene view of an Entity (the mixin-composed legacy object satisfies this shape).
 * @typedef {object} SceneEntity
 * @property {number} GID
 * @property {number} [CID]
 * @property {EntityKind} kind
 * @property {number[]} position         [x, y, z] world cells
 * @property {boolean} [dead]
 * @property {boolean} [removing]
 * @property {boolean} [invisible]
 * @property {number} [job]
 * @property {number} [depth]            clip-space w from last frame
 * @property {{x0:number,x1:number,y0:number,y1:number}|null} [pickRect]  screen px
 * @property {Record<string, {style:{display:string}}>} [overlays]
 */
