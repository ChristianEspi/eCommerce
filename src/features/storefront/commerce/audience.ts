/**
 * A qué público le habla la vitrina en esta sesión — SOLO para pintar.
 *
 * ## Lo que esto NO es
 *
 * No es un resolvedor de canal, no elige lista de precios y no decide qué
 * cuenta compra. El precio lo resuelve `ebim.build_quote` con la identidad del
 * JWT (`ebim.pricing_actor`), y el pedido lo firma `create_order`: ninguno de
 * los dos puede recibir lo que devuelve este módulo, porque no tienen parámetro
 * donde escribirlo. Hay un test que impide que el camino del precio o del
 * checkout lo importe (`audience.test.ts`).
 *
 * ## De qué se deriva
 *
 * De señales que el SERVIDOR ya autorizó para quien tiene la sesión: si hay una
 * cuenta de empresa activa en la sociedad de esta tienda y cómo está
 * configurada. Nada de nombres de cliente, de industria ni de tenant: la
 * clasificación tiene que valer igual para una botica, una zapatería o una
 * ferretería.
 *
 *  · sin cuenta de empresa activa           → `consumer`
 *  · cuenta con controles de compra
 *    corporativa (aprobación, orden de
 *    compra obligatoria, tope por persona,
 *    crédito con plazo o varias sedes)      → `enterprise`
 *  · cuenta sin ninguno de esos controles    → `trade`
 *
 * La frontera trade/enterprise es de PROCESO, no de tamaño: un comercio que
 * compra para revender y paga al contado no necesita que nadie le firme la
 * compra; una empresa que exige orden de compra, sí.
 */

export type CommerceAudience = 'consumer' | 'trade' | 'enterprise'

/** Lo que el servidor dice de la cuenta con la que compra la sesión. */
export interface BuyerAccountSignals {
  readonly requiresApproval: boolean
  readonly purchaseOrderRequired: boolean
  readonly hasSpendingLimit: boolean
  readonly hasCreditTerms: boolean
  readonly locationsCount: number
}

export function deriveCommerceAudience(account: BuyerAccountSignals | null): CommerceAudience {
  if (account === null) return 'consumer'

  const corporateControls =
    account.requiresApproval ||
    account.purchaseOrderRequired ||
    account.hasSpendingLimit ||
    account.hasCreditTerms ||
    account.locationsCount > 1

  return corporateControls ? 'enterprise' : 'trade'
}
