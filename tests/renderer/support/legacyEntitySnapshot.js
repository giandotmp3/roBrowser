/**
 * Build the explicit entity-state snapshot render-records' EntityRender.renderRecords consumes,
 * from a live legacy Renderer/Entity/Entity instance. Read-only: nothing on the legacy entity is
 * changed. View slots are resolved through the injected `loadFile` (legacy Client.loadFile), so
 * the snapshot holds the very spr/act/palette objects legacy draws from.
 */
import StatusConst from 'DB/Status/StatusState.js';
import { EntityType } from '../../../modernized/webgpu-reimagined/render-records/src/index.js';

/** Legacy Entity.TYPE_* (Entity.js:99-120) → render-records EntityType. */
function entityType(entity) {
	const E = entity.constructor;
	switch (entity.objecttype) {
		case E.TYPE_PC:
		case E.TYPE_DISGUISED:
			return EntityType.PC;
		case E.TYPE_MERC:
			return EntityType.MERC;
		case E.TYPE_HOM:
			return EntityType.HOM;
		case E.TYPE_FALCON:
			return EntityType.FALCON;
		case E.TYPE_NPC:
		case E.TYPE_NPC2:
			return EntityType.NPC;
		case E.TYPE_ITEM:
			return EntityType.ITEM;
		case E.TYPE_EFFECT:
			return EntityType.EFFECT;
		case E.TYPE_PET:
			return EntityType.PET;
		case E.TYPE_ELEM:
			return EntityType.ELEM;
		case E.TYPE_WUG:
			return EntityType.WUG;
		case E.TYPE_WARP:
			return EntityType.WARP;
		default:
			return EntityType.MOB;
	}
}

/** Riding mask as EntityRender.js:369-377 builds it. */
const RIDING_MASK =
	StatusConst.EffectState.RIDING |
	StatusConst.EffectState.DRAGON1 |
	StatusConst.EffectState.DRAGON2 |
	StatusConst.EffectState.DRAGON3 |
	StatusConst.EffectState.DRAGON4 |
	StatusConst.EffectState.DRAGON5 |
	StatusConst.EffectState.WUGRIDER;

/**
 * @param {object} entity legacy Entity
 * @param {object} deps
 * @param {function} deps.loadFile legacy Client.loadFile (synchronous once cached)
 * @param {function} [deps.isSuperNovice] legacy DB.isSuperNovice
 * @param {number} deps.spawnTick when the entity was spawned (Date.now() at construction)
 * @returns {object} entity snapshot for EntityRender.renderRecords
 */
export function snapshotLegacyEntity(entity, { loadFile, isSuperNovice = () => false, spawnTick }) {
	const view = files => {
		if (!files || !files.spr || !files.act) {
			return null;
		}
		return {
			spr: loadFile(files.spr) ?? null,
			act: loadFile(files.act) ?? null,
			pal: (files.pal && loadFile(files.pal)) || null,
			size: files.size
		};
	};
	const f = entity.files;
	const a = entity.animation;

	return {
		gid: entity.GID,
		type: entityType(entity),
		position: Array.from(entity.position),
		direction: entity.direction,
		headDir: entity.headDir,
		action: entity.action,
		actions: { ...entity.ACTION },
		animation: {
			// Discrepancy #13 FIX: legacy's `objecttype` re-init leaves tick 0 (Entity.js:281-284,
			// EntityAction.js:64-66); the modern clock starts at spawn instead of the epoch.
			tick: a.tick === 0 ? spawnTick : a.tick,
			frame: a.frame,
			repeat: a.repeat,
			play: a.play,
			next: a.next,
			delay: a.delay,
			speed: a.speed ?? false,
			length: a.length ?? false,
			save: a.save
		},
		job: entity.job,
		isSuperNovice: !!isSuperNovice(entity._job),
		views: {
			shadow: view(f.shadow),
			cartShadow: view(f.cart_shadow),
			cart: (f.cart ?? []).map(view),
			robe: view(f.robe),
			body: view(f.body),
			head: view(f.head),
			hatMid: view(f.accessory3),
			hatTop: view(f.accessory2),
			hatBottom: view(f.accessory),
			weapon: view(f.weapon),
			weaponTrail: view(f.weapon_trail),
			shield: view(f.shield)
		},
		weapon: entity.weapon,
		shield: entity.shield,
		robe: entity.robe,
		hats: { top: entity.accessory2, mid: entity.accessory3, bottom: entity.accessory },
		hasCart: !!entity.hasCart,
		cartNum: entity.CartNum,
		riding: !!(entity.effectState & RIDING_MASK || entity.allRidingState),
		effectColor: Array.from(entity.effectColor),
		hideShadow: !!entity.hideShadow,
		hideEntity: !!entity.hideEntity,
		gr2: !!entity.gr2,
		xSize: entity.xSize,
		ySize: entity.ySize,
		robeHeight: entity.robeHeight,
		bodyHeight: entity.bodyHeight,
		opt3: {
			berserk: !!entity.getOpt3(StatusConst.Status.BERSERK),
			marionette: !!entity.getOpt3(StatusConst.Status.MARIONETTE)
		},
		removal: entity.remove_tick ? { tick: entity.remove_tick, delay: entity.remove_delay } : null,
		walk: entity.walk ? { dist: entity.walk.dist, speed: entity.walk.speed } : null,
		attackSpeed: entity.attack_speed
	};
}
