// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Kits por Excel (2026-11-24): hoja «Kits», una fila por componente.
 *
 *  · productos y kits en UNA transacción: un kit usa componentes que el mismo
 *    archivo crea, y simular (o un error) no deja nada escrito;
 *  · las reglas del panel: sin kits dentro de kits, variante obligatoria,
 *    cantidad > 0, sin repetir;
 *  · la receta de la hoja reemplaza la del kit.
 */

let db: PGlite
let store = ''

type Row = Record<string, unknown>

async function svc<T = Row>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}
async function as<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []) {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}

const owner = claimsFor(TENANT_A)

async function importar(products: Row[], kits: Row[], dryRun: boolean, claims = owner) {
  const [r] = await as<{ r: Row }>(claims, `select public.import_catalog_with_kits($1::uuid, $2::jsonb, $3::jsonb, $4) as r`, [
    store,
    JSON.stringify(products),
    JSON.stringify(kits),
    dryRun,
  ])
  return r?.r as Row & { rows: Row[] }
}

const PRODUCTOS = [
  { row: 2, sku: 'KC-JABON', name: 'Jabón', price: 5, status: 'publicado', stock: 50 },
  { row: 3, sku: 'KC-TOALLA', name: 'Toalla', price: 20, status: 'publicado', variant_sku: 'KC-TOALLA-M' },
  { row: 4, sku: 'KC-TOALLA', variant_sku: 'KC-TOALLA-L' },
]

const KIT = [
  { row: 2, kit_sku: 'KIT-BANO', kit_name: 'Kit de baño', price: 28, status: 'publicado', component_sku: 'KC-JABON', quantity: 2 },
  { row: 3, kit_sku: 'KIT-BANO', component_sku: 'KC-TOALLA', component_variant_sku: 'KC-TOALLA-M', quantity: 1 },
]

async function receta(sku: string) {
  return svc<{ comp: string; variante: string | null; qty: string }>(
    `select c.sku as comp, v.sku as variante, b.quantity::text as qty
       from public.bundle_items b
       join public.products k on k.id = b.bundle_product_id
       join public.products c on c.id = b.component_product_id
       left join public.product_variants v on v.id = b.component_variant_id
      where k.sku = $1 order by b.position`,
    [sku],
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ])
  }
  await svc(`update public.stores set status = 'active'`)
  store = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  await svc(
    `insert into public.tenant_entitlements (organization_id, company_id, entitlement_code, is_active, source)
     values ($1, $2, 'ecommerce.catalog.advanced', true, 'hub')
     on conflict (organization_id, company_id, entitlement_code) do update set is_active = true`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
})

afterAll(async () => {
  await db?.close()
})

describe('kits por Excel', () => {
  it('simular con productos nuevos en el mismo archivo: sin errores y sin escribir nada', async () => {
    const r = await importar(PRODUCTOS, KIT, true)
    expect(r.errors).toBe(0)
    expect(r.applied).toBe(false)
    expect(await svc(`select 1 from public.products where sku in ('KIT-BANO', 'KC-JABON')`)).toEqual([])
  })

  it('aplicar crea los productos, el kit y su receta (variante incluida)', async () => {
    const r = await importar(PRODUCTOS, KIT, false)
    expect(r).toMatchObject({ applied: true, errors: 0, kits_created: 1, kit_components: 2 })
    const [kit] = await svc<{ kind: string }>(`select kind from public.products where sku = 'KIT-BANO'`)
    expect(kit?.kind).toBe('bundle')
    expect(await receta('KIT-BANO')).toEqual([
      { comp: 'KC-JABON', variante: null, qty: expect.stringMatching(/^2(\.0+)?$/) },
      { comp: 'KC-TOALLA', variante: 'KC-TOALLA-M', qty: expect.stringMatching(/^1(\.0+)?$/) },
    ])
  })

  it('el SKU de una variante vale como componente; la receta de la hoja reemplaza la anterior', async () => {
    const r = await importar([], [{ row: 2, kit_sku: 'KIT-BANO', component_sku: 'KC-TOALLA-L', quantity: 3 }], false)
    expect(r).toMatchObject({ applied: true, errors: 0, kits_updated: 1 })
    expect(await receta('KIT-BANO')).toEqual([
      { comp: 'KC-TOALLA', variante: 'KC-TOALLA-L', qty: expect.stringMatching(/^3(\.0+)?$/) },
    ])
  })

  it('las reglas del panel, fila por fila, y un error no deja nada escrito', async () => {
    const r = await importar(
      [],
      [
        { row: 2, kit_sku: 'KIT-MALO', kit_name: 'Malo', price: 10, component_sku: 'KIT-BANO', quantity: 1 },
        { row: 3, kit_sku: 'KIT-MALO', component_sku: 'KC-TOALLA', quantity: 1 },
        { row: 4, kit_sku: 'KIT-MALO', component_sku: 'NO-EXISTE', quantity: 1 },
        { row: 5, kit_sku: 'KIT-MALO', component_sku: 'KC-JABON', quantity: 0 },
        { row: 6, kit_sku: 'KIT-MALO', component_sku: 'KC-JABON', component_variant_sku: 'X', quantity: 1 },
        { row: 7, kit_sku: 'KC-JABON', kit_name: 'Jabón kit', price: 5, component_sku: 'KC-TOALLA-M', quantity: 1 },
      ],
      false,
    )
    const reasons = Object.fromEntries(r.rows.map((x) => [x.row, x.reason]))
    expect(reasons).toMatchObject({
      2: 'KIT_DENTRO_DE_KIT',
      3: 'VARIANTE_REQUERIDA',
      4: 'COMPONENTE_NO_ENCONTRADO',
      5: 'VALOR_INVALIDO',
      6: 'VARIANTE_NO_APLICA',
      7: 'TIPO_DISTINTO',
    })
    expect(r.applied).toBe(false)
    expect(await svc(`select 1 from public.products where sku = 'KIT-MALO'`)).toEqual([])
  })

  it('el mismo componente dos veces en un kit es un error', async () => {
    const r = await importar(
      [],
      [
        { row: 2, kit_sku: 'KIT-DOS', kit_name: 'Dos', price: 9, component_sku: 'KC-JABON', quantity: 1 },
        { row: 3, kit_sku: 'KIT-DOS', component_sku: 'kc-jabon', quantity: 2 },
      ],
      true,
    )
    expect(r.rows.find((x) => x.row === 3)?.reason).toBe('COMPONENTE_REPETIDO')
  })

  it('sin catálogo avanzado no hay kits; otra sociedad no importa en esta tienda', async () => {
    await svc(
      `update public.tenant_entitlements set is_active = false
        where organization_id = $1 and company_id = $2 and entitlement_code = 'ecommerce.catalog.advanced'`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await expect(importar([], KIT, true)).rejects.toThrow(/MODULO_NO_CONTRATADO/)
    await svc(
      `update public.tenant_entitlements set is_active = true
        where organization_id = $1 and company_id = $2 and entitlement_code = 'ecommerce.catalog.advanced'`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await expect(importar([], KIT, true, claimsFor(TENANT_B))).rejects.toThrow(/SIN_PERMISO/)
  })
})
