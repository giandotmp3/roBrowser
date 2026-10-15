/**
 * EffectTable entry shape (data unchanged from legacy; FUNC closures rewritten
 * to the injected-context signature, architecture §2.2 / §4).
 *
 * @typedef {Object} EffectContext  Injected into every FUNC(params, ctx)
 * @property {Object} camera     e.g. camera.setQuake(...)
 * @property {Object} altitude   getCellHeight / getCellType
 * @property {Object} screenFx   ScreenEffects facade (scene module)
 * @property {Object} effects    The EffectSystem itself (spam / remove)
 * @property {Object} audio      playPosition / stop
 * @property {Object} session    Read-only session view (Entity, Playing...)
 *
 * @typedef {Object} EffectSpec
 * @property {string} [type]            'STR' | '2D' | '3D' | 'CYLINDER' | 'RSM' | 'QuadHorn' | 'FUNC' | ...
 * @property {string} [file]            STR file
 * @property {string} [min]             STR used under /mineffect (R-EFX-001)
 * @property {number} [duplicate]       R-EFX-002
 * @property {number} [timeBetweenDupli]
 * @property {number} [delayStart]      R-EFX-003
 * @property {number} [delayOffset]
 * @property {number} [delayLate]
 * @property {number} [delayOffsetDelta]
 * @property {number} [delayLateDelta]
 * @property {number} [duration]
 * @property {number} [blendMode]       R-EFX-011
 * @property {boolean} [renderBeforeEntities]  R-EFX-006
 * @property {boolean} [fadeIn]         R-EFX-012
 * @property {boolean} [fadeOut]
 * @property {boolean} [sparkling]
 * @property {number} [sparkNumber]
 * @property {number} [alphaMax]
 * @property {(params: EffectParams, ctx: EffectContext) => void} [FUNC]
 *
 * @typedef {Object} EffectParams  Legacy EF_Init_Par
 * @property {number} effectId
 * @property {number} [ownerAID]
 * @property {[number, number, number]} [position]
 * @property {number} startTick
 * @property {boolean} [persistent]
 * @property {number} [repeatEnd]
 * @property {number} [otherAID]
 * @property {[number, number, number]} [otherPosition]
 * @property {Object} [ownerEntity]
 */

export {};
