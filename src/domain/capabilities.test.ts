/**
 * Reglas de composición de capacidades (P02-SaaS).
 *
 * Estas comprobaciones son la mitad de TypeScript de un contrato de tres
 * copias: la misma composición vive en `ebim.company_is_entitled` (SQL) y se
 * comparan una contra otra en `supabase/tests/capabilities.test.ts` sobre
 * Postgres real. Aquí se fijan las reglas; allí se comprueba que la base opina
 * lo mismo.
 */
import { describe, expect, it } from 'vitest'
import {
  BASELINE_CAPABILITY_IDS,
  CAPABILITIES,
  CAPABILITY_IDS,
  ENTITLEMENT_PREFIX,
  SELLABLE_CAPABILITY_IDS,
  capability,
  entitlementFor,
  hasCapability,
  isBaselineCapability,
  isCapabilityId,
  resolveCapabilities,
} from './capabilities'
import { BOUNDARIES } from './boundaries'
import { isFlagEnabled, parseFeatureFlags } from './flags'

describe('registro de capacidades', () => {
  it('el registro y las listas de ids no pueden separarse', () => {
    expect(CAPABILITIES.map((c) => c.id).sort()).toEqual([...CAPABILITY_IDS].sort())
  })

  it('no hay ids repetidos', () => {
    expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length)
  })

  /**
   * Protege el mapa de fronteras de P01. Una capacidad que dice pertenecer a un
   * dominio inexistente es una capacidad que nadie sabe quién implementa.
   */
  it('toda capacidad pertenece a una frontera declarada', () => {
    const declared = new Set(BOUNDARIES.map((b) => b.id))
    const offenders = CAPABILITIES.filter((c) => !declared.has(c.boundary)).map((c) => c.id)
    expect(offenders).toEqual([])
  })

  /**
   * Baseline y vendible son excluyentes, igual que el CHECK
   * `app_capabilities_baseline_xor_code` de la base. Una capacidad que fuera las
   * dos cosas haría ambigua la resolución: ¿se apaga si falta el addon o no?
   */
  it('baseline y entitlement son excluyentes', () => {
    for (const item of CAPABILITIES) {
      const baseline = (BASELINE_CAPABILITY_IDS as readonly string[]).includes(item.id)
      expect(`${item.id}: baseline=${baseline} code=${item.entitlement !== null}`).toBe(
        `${item.id}: baseline=${baseline} code=${!baseline}`,
      )
    }
  })

  it('todo código de addon lleva el prefijo de la app y es único', () => {
    const codes = CAPABILITIES.map((c) => c.entitlement).filter((c): c is string => c !== null)
    expect(codes.length).toBe(SELLABLE_CAPABILITY_IDS.length)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code.startsWith(ENTITLEMENT_PREFIX)).toBe(true)
  })

  it('`capability` falla ruidosamente con un id que no existe', () => {
    expect(() => capability('inventado' as never)).toThrow(/no declarada/)
    expect(isCapabilityId('inventado')).toBe(false)
    expect(isCapabilityId('payments')).toBe(true)
  })

  it('`entitlementFor` distingue baseline de vendible', () => {
    expect(entitlementFor('catalog')).toBeNull()
    expect(isBaselineCapability('catalog')).toBe(true)
    expect(entitlementFor('payments')).toBe(`${ENTITLEMENT_PREFIX}payments`)
    expect(isBaselineCapability('payments')).toBe(false)
  })
})

describe('resolución de capacidades efectivas', () => {
  it('sin entitlements queda exactamente lo baseline', () => {
    const { capabilities } = resolveCapabilities({ appActive: true, entitlements: [] })
    expect(capabilities).toEqual([...BASELINE_CAPABILITY_IDS].sort())
  })

  it('un entitlement activo enciende su módulo y solo el suyo', () => {
    const { capabilities } = resolveCapabilities({
      appActive: true,
      entitlements: [`${ENTITLEMENT_PREFIX}payments`],
    })
    expect(capabilities).toContain('payments')
    expect(capabilities).not.toContain('promotions')
    expect(capabilities).toEqual([...BASELINE_CAPABILITY_IDS, 'payments'].sort())
  })

  /**
   * Si el hub dice que la cuenta no tiene esta app, no queda ni el catálogo.
   * No es un tenant con plan mínimo: es un tenant que no es cliente.
   */
  it('`app_active: false` no deja ni lo baseline', () => {
    const result = resolveCapabilities({
      appActive: false,
      entitlements: [`${ENTITLEMENT_PREFIX}payments`],
    })
    expect(result.capabilities).toEqual([])
    expect(result.entitled).toEqual([])
  })

  /** La regla que impide que los ajustes del tenant sean una caja registradora. */
  it('un flag encendido NO concede un módulo no contratado', () => {
    const result = resolveCapabilities({
      appActive: true,
      entitlements: [],
      flags: { payments: true, 'content.cms': true },
    })
    expect(result.capabilities).not.toContain('payments')
    expect(result.capabilities).not.toContain('content.cms')
    expect(result.capabilities).toEqual([...BASELINE_CAPABILITY_IDS].sort())
  })

  it('un flag apagado sí quita un módulo contratado, y lo dice', () => {
    const result = resolveCapabilities({
      appActive: true,
      entitlements: [`${ENTITLEMENT_PREFIX}payments`],
      flags: { payments: false },
    })
    expect(result.entitled).toContain('payments')
    expect(result.capabilities).not.toContain('payments')
    expect(result.disabledByFlag).toEqual(['payments'])
  })

  /** Un interruptor capaz de dejar la tienda sin catálogo es un botón de caída. */
  it('un flag no puede apagar lo baseline', () => {
    const result = resolveCapabilities({
      appActive: true,
      entitlements: [],
      flags: { catalog: false, checkout: false, orders: false },
    })
    expect(result.capabilities).toEqual([...BASELINE_CAPABILITY_IDS].sort())
    expect(result.disabledByFlag).toEqual([])
  })

  /**
   * El hub puede ir por delante del binario desplegado. Un código desconocido
   * no rompe la resolución ni se pierde: se separa para que el diagnóstico lo
   * enseñe, porque es la señal de «el cliente compró algo que esta versión no
   * sabe encender».
   */
  it('un addon que esta versión no conoce se aparta, no rompe', () => {
    const result = resolveCapabilities({
      appActive: true,
      entitlements: [`${ENTITLEMENT_PREFIX}payments`, 'gmao.licitaciones', 'ecommerce.futuro'],
    })
    expect(result.capabilities).toContain('payments')
    expect(result.unknownEntitlements).toEqual(['ecommerce.futuro', 'gmao.licitaciones'])
  })

  /**
   * Cierre D3 (20260914180000): una sociedad que el hub nunca sincronizó
   * conserva los tres módulos que nacieron sin candado de servidor. Ninguno más.
   */
  it('nunca sincronizada: el fallback legado concede exactamente los tres de ADR 017', () => {
    const legacy = CAPABILITIES.filter((c) => c.legacyUntilSynced === true).map((c) => c.id)
    expect([...legacy].sort()).toEqual(['catalog.advanced', 'fulfillment', 'payments'])

    const result = resolveCapabilities({ appActive: true, entitlements: [], synced: false })
    expect(result.capabilities).toEqual(
      [...BASELINE_CAPABILITY_IDS, 'catalog.advanced', 'fulfillment', 'payments'].sort(),
    )
  })

  it('el fallback legado respeta el corte técnico y desaparece al sincronizar', () => {
    const cut = resolveCapabilities({
      appActive: true,
      entitlements: [],
      synced: false,
      flags: { payments: false },
    })
    expect(cut.capabilities).not.toContain('payments')
    expect(cut.disabledByFlag).toEqual(['payments'])

    const synced = resolveCapabilities({ appActive: true, entitlements: [], synced: true })
    expect(synced.capabilities).toEqual([...BASELINE_CAPABILITY_IDS].sort())
  })

  it('`hasCapability` sin resolución responde que no', () => {
    expect(hasCapability(null, 'catalog')).toBe(false)
    expect(hasCapability(undefined, 'catalog')).toBe(false)
    expect(hasCapability({ capabilities: ['catalog'] }, 'catalog')).toBe(true)
    expect(hasCapability({ capabilities: ['catalog'] }, 'payments')).toBe(false)
  })
})

describe('flags técnicos', () => {
  it('un flag ausente está encendido', () => {
    expect(isFlagEnabled({}, 'lo.que.sea')).toBe(true)
    expect(isFlagEnabled(null, 'lo.que.sea')).toBe(true)
    expect(isFlagEnabled({ 'lo.que.sea': false }, 'lo.que.sea')).toBe(false)
  })

  /**
   * `"false"` en texto es `true` para JavaScript. Un flag de apagado leído al
   * revés es exactamente el fallo que un flag existe para evitar, así que lo
   * que no sea booleano se descarta en vez de convertirse.
   */
  it('lo que no es booleano no se convierte, se descarta', () => {
    expect(parseFeatureFlags({ a: false, b: 'false', c: 0, d: true })).toEqual({ a: false, d: true })
    expect(parseFeatureFlags(null)).toEqual({})
    expect(parseFeatureFlags(['a'])).toEqual({})
    expect(parseFeatureFlags('nada')).toEqual({})
  })
})
