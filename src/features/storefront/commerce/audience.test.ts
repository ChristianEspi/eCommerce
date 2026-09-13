import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { deriveCommerceAudience, type BuyerAccountSignals } from './audience'

/**
 * La audiencia es una etiqueta de presentación.
 *
 * Dos mitades: que clasifica bien con señales genéricas, y —la que importa— que
 * nada del camino del precio, del carrito o del checkout puede leerla. Si un
 * día alguien la importa desde la cotización, la vitrina tendría dos
 * autoridades sobre el precio y este test se pone rojo antes de que eso llegue
 * a una caja.
 */

const SIN_CONTROLES: BuyerAccountSignals = {
  requiresApproval: false,
  purchaseOrderRequired: false,
  hasSpendingLimit: false,
  hasCreditTerms: false,
  locationsCount: 1,
}

describe('deriveCommerceAudience', () => {
  it('sin cuenta de empresa es consumidor', () => {
    expect(deriveCommerceAudience(null)).toBe('consumer')
  })

  it('una cuenta sin controles de compra corporativa es comercio (trade)', () => {
    expect(deriveCommerceAudience(SIN_CONTROLES)).toBe('trade')
    expect(deriveCommerceAudience({ ...SIN_CONTROLES, locationsCount: 0 })).toBe('trade')
  })

  it.each([
    ['requiresApproval', { requiresApproval: true }],
    ['purchaseOrderRequired', { purchaseOrderRequired: true }],
    ['hasSpendingLimit', { hasSpendingLimit: true }],
    ['hasCreditTerms', { hasCreditTerms: true }],
    ['locationsCount > 1', { locationsCount: 2 }],
  ])('un solo control corporativo (%s) basta para enterprise', (_nombre, cambio) => {
    expect(deriveCommerceAudience({ ...SIN_CONTROLES, ...cambio })).toBe('enterprise')
  })

  it('es pura: no muta la entrada y repite la respuesta', () => {
    const entrada = Object.freeze({ ...SIN_CONTROLES, hasCreditTerms: true })
    expect(deriveCommerceAudience(entrada)).toBe('enterprise')
    expect(deriveCommerceAudience(entrada)).toBe('enterprise')
  })
})

describe('la audiencia no puede tocar el precio ni la cuenta efectiva', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  /**
   * El camino por el que viaja un precio o una identidad comercial: la
   * cotización del navegador, el carrito, el cuerpo del checkout y todo el
   * servidor. Ninguno puede depender de la etiqueta.
   */
  const CAMINO_DEL_PRECIO = [
    'src/features/pricing',
    'src/features/storefront/cart',
    'src/features/storefront/checkout.ts',
    'supabase/functions',
  ]

  it('ningún módulo del precio, del carrito, del checkout o del servidor la importa', () => {
    const archivos = CAMINO_DEL_PRECIO.flatMap((ruta) => {
      const full = join(ROOT, ruta)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
    expect(archivos.length).toBeGreaterThan(20)

    const infractores = archivos
      .filter((archivo) => /commerce\/audience|deriveCommerceAudience/.test(readFileSync(archivo, 'utf8')))
      .map((archivo) => relative(ROOT, archivo))
    expect(infractores).toEqual([])
  })

  it('el cuerpo del checkout no tiene dónde llevar audiencia, cuenta ni cliente', () => {
    const fuente = readFileSync(join(ROOT, 'supabase/functions/_shared/checkout/request.ts'), 'utf8')
    const permitidos = /CHECKOUT_ALLOWED_FIELDS = \[([\s\S]*?)\] as const/.exec(fuente)?.[1] ?? ''
    const campos = [...permitidos.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

    expect(campos.length).toBeGreaterThan(10)
    for (const prohibido of ['audience', 'business_account_id', 'customer_id', 'segment_id', 'price_list_id']) {
      expect(campos).not.toContain(prohibido)
    }
  })
})
