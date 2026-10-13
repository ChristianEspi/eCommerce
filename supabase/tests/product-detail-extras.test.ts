// @vitest-environment node
/**
 * La ficha completa · `product_detail_for_slug`, destacados y cuotas, contra
 * Postgres REAL (2026-10-13).
 *
 * Lo que no puede fallar:
 *
 *  · **solo lo publicado** de la tienda activa del slug: un borrador o un
 *    producto de otro tenant responden NULL, igual que uno inexistente;
 *  · **el stock por tienda es un ESTADO**, nunca la cantidad;
 *  · solo tiendas físicas (`kind = 'store'`) de la sociedad de la tienda;
 *  · las especificaciones son los atributos que NO son eje de variante;
 *  · la base rechaza destacados y cuotas mal formados, venga de donde venga.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA = ''
let storeB = ''
let limpiador = ''
let borrador = ''
let ajeno = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}
async function anon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => (await db.query<T>(query, params)).rows)
}
const ownerA = () =>
  claimsFor(TENANT_A, {
    sub: TENANT_A.ownerId,
    email: 'owner@a.com',
    companies: [{ id: TENANT_A.companyId, role: 'owner' }],
  })
async function comoOwnerA(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'authenticated', ownerA(), async () => (await db.query<Row>(query, params)).rows)
}

async function producto(
  tenant: typeof TENANT_A,
  store: string,
  sku: string,
  status = 'published',
): Promise<string> {
  const [row] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $4, '21.90', 'PEN', 0, $5::public.product_status,
             case when $5 = 'published' then now() end)
     returning id`,
    [tenant.organizationId, tenant.companyId, store, sku, status],
  )
  return String(row?.id)
}

async function tienda(tenant: typeof TENANT_A, code: string, name: string, kind = 'store'): Promise<string> {
  const [row] = await svc<{ id: string }>(
    `insert into public.warehouses (organization_id, company_id, code, name, kind, city, priority)
     values ($1, $2, $3, $4, $5::public.warehouse_kind, 'Lima', 10) returning id`,
    [tenant.organizationId, tenant.companyId, code, name, kind],
  )
  return String(row?.id)
}

async function stock(warehouse: string, store: string, product: string, qty: number): Promise<void> {
  await svc(
    `insert into public.inventory_levels (organization_id, company_id, warehouse_id, store_id, product_id, on_hand_qty)
     values ($1, $2, $3, $4, $5, $6)`,
    [TENANT_A.organizationId, TENANT_A.companyId, warehouse, store, product, qty],
  )
}

async function detalle(productId: string, slug = TENANT_A.storeSlug): Promise<Row | null> {
  const [row] = await anon<{ d: Row | null }>(`select public.product_detail_for_slug($1, $2::uuid) as d`, [
    slug,
    productId,
  ])
  return row?.d ?? null
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
  storeA = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  storeB = String((await svc(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug]))[0]?.id)

  limpiador = await producto(TENANT_A, storeA, 'LIMP-38')
  borrador = await producto(TENANT_A, storeA, 'LIMP-BORRADOR', 'draft')
  ajeno = await producto(TENANT_B, storeB, 'AJENO-1')

  await svc(`update public.products set highlights = $2 where id = $1`, [
    limpiador,
    ['Elimina el 99.9% de bacterias', 'Rinde hasta 120 lavados'],
  ])

  // Especificaciones: dos atributos de ficha y un eje de variante que NO sale.
  const [uso] = await svc<{ id: string }>(
    `insert into public.attributes (organization_id, company_id, code, name, data_type, position)
     values ($1, $2, 'uso', 'Uso', 'text', 2) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const [contenido] = await svc<{ id: string }>(
    `insert into public.attributes (organization_id, company_id, code, name, data_type, unit, position)
     values ($1, $2, 'contenido', 'Contenido', 'number', 'L', 1) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  await svc(
    `insert into public.product_attribute_values (organization_id, company_id, store_id, product_id, attribute_id, value_text)
     values ($1, $2, $3, $4, $5, 'Pisos y superficies lavables')`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, limpiador, uso?.id],
  )
  await svc(
    `insert into public.product_attribute_values (organization_id, company_id, store_id, product_id, attribute_id, value_number)
     values ($1, $2, $3, $4, $5, 3.8)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, limpiador, contenido?.id],
  )

  // Tres tiendas físicas con estados distintos y un almacén que no es tienda.
  const surco = await tienda(TENANT_A, 'T-SURCO', 'Surco')
  const miraflores = await tienda(TENANT_A, 'T-MIRA', 'Miraflores')
  await tienda(TENANT_A, 'T-SM', 'San Miguel')
  const central = await tienda(TENANT_A, 'ALM-C', 'Central', 'warehouse')
  await stock(surco, storeA, limpiador, 24)
  await stock(miraflores, storeA, limpiador, 3)
  await stock(central, storeA, limpiador, 900)
  // Una tienda física de OTRA sociedad no aparece.
  await svc(
    `insert into public.warehouses (organization_id, company_id, code, name, kind) values ($1, $2, 'T-B', 'Tienda B', 'store')`,
    [TENANT_B.organizationId, TENANT_B.companyId],
  )

  // Entrega: un reparto con umbral de gratuidad y un recojo con un punto.
  const [envio] = await svc<{ id: string }>(
    `insert into public.delivery_methods
       (organization_id, company_id, store_id, code, strategy, display_name, lead_time_min_days, lead_time_max_days, is_active)
     values ($1, $2, $3, 'ext-envio', 'ship', 'Envío', 1, 2, true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(
    `insert into public.delivery_rates
       (organization_id, company_id, store_id, delivery_method_id, currency, base_amount, free_over_subtotal)
     values ($1, $2, $3, $4, 'PEN', 10, 99)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, envio?.id],
  )
  await svc(
    `insert into public.delivery_methods
       (organization_id, company_id, store_id, code, strategy, display_name, lead_time_min_days, lead_time_max_days, is_active)
     values ($1, $2, $3, 'ext-recojo', 'pickup', 'Recojo', 0, 0, true)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(
    `insert into public.pickup_points (organization_id, company_id, store_id, code, name, is_active)
     values ($1, $2, $3, 'surco', 'Surco', true)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('product_detail_for_slug', () => {
  it('SKU, destacados y especificaciones (sin ejes), en el orden del comercio', async () => {
    const d = await detalle(limpiador)
    expect(d?.sku).toBe('LIMP-38')
    expect(d?.highlights).toEqual(['Elimina el 99.9% de bacterias', 'Rinde hasta 120 lavados'])
    expect(d?.specs).toEqual([
      { label: 'Contenido', type: 'number', value: '3.8 L' },
      { label: 'Uso', type: 'text', value: 'Pisos y superficies lavables' },
    ])
  })

  it('la disponibilidad por tienda física es un estado, nunca una cantidad', async () => {
    const d = await detalle(limpiador)
    expect(d?.stores).toEqual([
      { name: 'Miraflores', city: 'Lima', status: 'low' },
      { name: 'San Miguel', city: 'Lima', status: 'out' },
      { name: 'Surco', city: 'Lima', status: 'available' },
    ])
    expect(JSON.stringify(d?.stores)).not.toMatch(/24|900/)
  })

  it('resume la entrega sin tarifas: plazos, gratis desde y puntos de recojo', async () => {
    const d = await detalle(limpiador)
    const delivery = d?.delivery as Record<string, Record<string, unknown>>
    expect(delivery.ship).toMatchObject({ min_days: 1, free_over: 99 })
    expect(delivery.pickup).toEqual({ min_days: 0, points: 1 })
  })

  it('un borrador, uno de otro tenant o uno inexistente responden igual: NULL', async () => {
    expect(await detalle(borrador)).toBeNull()
    expect(await detalle(ajeno)).toBeNull()
    expect(await detalle('00000000-0000-4000-8000-000000000999')).toBeNull()
  })
})

describe('lo que la base no deja guardar', () => {
  it('destacados: el owner los guarda en su producto; en el de otra sociedad, no toca nada', async () => {
    const propios = await comoOwnerA(`update public.products set highlights = $2 where id = $1 returning id`, [
      limpiador,
      ['Elimina el 99.9% de bacterias', 'Rinde hasta 120 lavados'],
    ])
    expect(propios).toHaveLength(1)
    const ajenos = await comoOwnerA(`update public.products set highlights = $2 where id = $1 returning id`, [
      ajeno,
      ['Intruso'],
    ])
    expect(ajenos).toHaveLength(0)
  })

  it('destacados: máximo 6, cada uno de 1 a 120 caracteres', async () => {
    const guardar = (lista: string[]) =>
      svc(`update public.products set highlights = $2 where id = $1`, [limpiador, lista])
    expect(await expectFailure(() => guardar(Array.from({ length: 7 }, (_, i) => `Punto ${i}`)))).toMatch(
      /products_highlights_check/,
    )
    expect(await expectFailure(() => guardar(['  ']))).toMatch(/products_highlights_check/)
    expect(await expectFailure(() => guardar(['x'.repeat(121)]))).toMatch(/products_highlights_check/)
  })

  it('cuotas: el owner las guarda y la vitrina las lee; mal formadas, no', async () => {
    const guardar = (valor: unknown) =>
      comoOwnerA(`update public.store_settings set installments = $1::jsonb where store_id = $2 returning store_id`, [
        JSON.stringify(valor),
        storeA,
      ])
    await guardar({ count: 3, provider: 'Tarjeta Andes', min_amount: 20 })
    const [fila] = await anon(`select installments from public.public_stores where slug = $1`, [TENANT_A.storeSlug])
    expect(fila?.installments).toEqual({ count: 3, provider: 'Tarjeta Andes', min_amount: 20 })

    for (const malo of [{ count: 1 }, { count: 40 }, { count: 2.5 }, { count: 3, extra: true }, { provider: 'X' }]) {
      expect(await expectFailure(() => guardar(malo))).toMatch(/store_settings_installments_check/)
    }
  })
})
