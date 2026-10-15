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

const { BodyState, HealthState, EffectState, OPT3 } = StatusConst;

/** Legacy bodyState value → render-records EntityStatus.body (EntityState.js:229-283). */
const BODY_STATE_NAMES = new Map([
	[BodyState.STONE, 'STONE'],
	[BodyState.STONEWAIT, 'STONE_WAIT'],
	[BodyState.FREEZE, 'FREEZE'],
	[BodyState.SLEEP, 'SLEEP'],
	[BodyState.STUN, 'STUN']
]);

/** Names of the bits set in a legacy bitmask, by a {NAME: bit} table. */
const bitNames = (value, table) =>
	Object.entries(table)
		.filter(([, bit]) => bit && value & bit)
		.map(([name]) => name);

/**
 * The legacy entity's status by name (render-records EntityStatus): what MapEngine set through
 * bodyState / healthState / effectState / opt3 (EntityState.js), plus the local player's
 * intravision (Session.Entity, EntityState.js:442-467) and the transient flash colour.
 */
function legacyStatus(entity, session) {
	const effect = entity._effectState ?? 0;
	const health = entity._healthState ?? 0;
	const invisibility = bitNames(effect, {
		INVISIBLE: EffectState.INVISIBLE,
		HIDE: EffectState.HIDE,
		CLOAK: EffectState.CLOAK,
		CHASEWALK: EffectState.CHASEWALK
	});
	if (entity.Camouflage) {
		invisibility.push('CAMOUFLAGE');
	}
	if (entity.Stealthfield) {
		invisibility.push('STEALTHFIELD');
	}
	if (entity.Shadowform) {
		invisibility.push('SHADOWFORM');
	}
	return {
		body: BODY_STATE_NAMES.get(entity._bodyState) ?? 'NONE',
		health: {
			curse: !!(health & HealthState.CURSE),
			poison: !!(health & HealthState.POISON),
			silence: !!(health & HealthState.SILENCE)
		},
		invisibility,
		intravision: !!session?.Entity?.intravision,
		// OPT3 names are the R-SPR-022 names (QUICKEN, BERSERK, MARIONETTE, ...)
		virtue: bitNames(entity._virtue ?? 0, OPT3),
		flash: Array.from(entity._flashColor)
	};
}

/**
 * @param {object} entity legacy Entity
 * @param {object} deps
 * @param {function} deps.loadFile legacy Client.loadFile (synchronous once cached)
 * @param {function} [deps.isSuperNovice] legacy DB.isSuperNovice
 * @param {number} deps.spawnTick when the entity was spawned (Date.now() at construction)
 * @param {boolean} [deps.composeStatus] hand render-records the entity's status (bodyState,
 *        healthState, effectState, opt3, intravision) instead of legacy's computed effectColor and
 *        opt3 flags, so R-SPR-018…023 are composed by render-records and diffed, not copied
 * @param {object} [deps.session] legacy Engine/SessionStorage (intravision of the local player)
 * @returns {object} entity snapshot for EntityRender.renderRecords
 */
export function snapshotLegacyEntity(
	entity,
	{ loadFile, isSuperNovice = () => false, spawnTick, composeStatus = false, session = null }
) {
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

	const snapshot = {
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
	if (composeStatus) {
		delete snapshot.effectColor;
		delete snapshot.opt3;
		snapshot.status = legacyStatus(entity, session);
	}
	return snapshot;
}
