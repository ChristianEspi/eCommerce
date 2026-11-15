// @vitest-environment node
/**
 * Recojo en tienda: las más cercanas primero y con su stock (20261115120000).
 *
 * Lo que no puede fallar:
 *
 *  - se ven TODAS las tiendas activas, la del distrito del comprador primero;
 *  - cada tienda dice si tiene el carrito (`available`), qué le falta
 *    (`unavailable`) o que no lo sabe (`unknown`, sin almacén propio);
 *  - una tienda sin stock queda al final y, si TODAS están sin stock, la opción
 *    no se ofrece (`SIN_STOCK_EN_TIENDAS`);
 *  - elegir una tienda sin stock se rechaza en el SERVIDOR (`PUNTO_SIN_STOCK`);
 *  - el inventario de otra sociedad no cuenta para esta tienda.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  createTestDatabase,
  expectFailure,
  vaciarPagosYEntregas,
} from './harness.ts'

type Row = Record<string, unknown>
interface Punto {
  code: string
  district: string | null
  proximity: string
  stock: { state: string; missing: string[] }
}
interface Opcion {
  code: string
  available: boolean
  reason: string | null
  pickup_points: Punto[]
}

let db: PGlite
let storeA = ''
let storeB = ''
let jabon = ''
let almMiraflores = ''
let almSanMiguel = ''
let puntoMiraflores = ''
let puntoSanMiguel = ''
let puntoSurco = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function bootstrap(tenant: typeof TENANT_A): Promise<string> {
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    tenant.organizationId, tenant.companyId, tenant.slug, tenant.adminEmail, tenant.ownerId, tenant.storeSlug,
  ])
  const [store] = await svc(`select id from public.stores where slug = $1`, [tenant.storeSlug])
  await svc(`update public.stores set status = 'active' where id = $1`, [store?.id])
  return String(store?.id)
}

async function almacen(tenant: typeof TENANT_A, code: string): Promise<string> {
  const [w] = await svc(
    `insert into public.warehouses (organization_id, company_id, code, name, city, country)
     values ($1, $2, $3, $3, 'Lima', 'PE') returning id`,
    [tenant.organizationId, tenant.companyId, code],
  )
  return String(w?.id)
}

async function stock(warehouse: string, store: string, product: string, qty: number) {
  await svc(
    `insert into public.inventory_levels (organization_id, company_id, warehouse_id, store_id, product_id, on_hand_qty)
     values ($1, $2, $3, $4, $5, $6)
     on conflict do nothing`,
    [TENANT_A.organizationId, TENANT_A.companyId, warehouse, store, product, qty],
  )
}

async function punto(code: string, name: string, address: Row, warehouse: string | null, position: number) {
  const [p] = await svc(
    `insert into public.pickup_points
       (organization_id, company_id, store_id, code, name, address, warehouse_id, is_active, position)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, true, $8) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, code, name, JSON.stringify(address), warehouse, position],
  )
  return String(p?.id)
}

const lineas = (qty: number) => JSON.stringify([{ product_id: jabon, quantity: qty }])

async function recojo(comprador: Row, qty = 2): Promise<Opcion> {
  const [row] = await svc<{ r: { options: Opcion[] } }>(
    `select ebim.delivery_options($1, $2::jsonb, $3::jsonb, 100) as r`,
    [storeA, JSON.stringify(comprador), lineas(qty)],
  )
  const opcion = row?.r.options.find((o) => o.code === 'recojo')
  if (!opcion) throw new Error('sin opción de recojo')
  return opcion
}

beforeAll(async () => {
  db = await createTestDatabase()
  storeA = await bootstrap(TENANT_A)
  storeB = await bootstrap(TENANT_B)
  await vaciarPagosYEntregas(db, [storeA, storeB])

  const [p] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'jabon', 'jabon', 'Jabón líquido', '10.00', 'PEN', 0, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  jabon = String(p?.id)

  await svc(
    `insert into public.delivery_methods (organization_id, company_id, store_id, code, strategy, display_name, is_active)
     values ($1, $2, $3, 'recojo', 'pickup', 'Recojo en tienda', true)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )

  almMiraflores = await almacen(TENANT_A, 'ALM-MIRAFLORES')
  almSanMiguel = await almacen(TENANT_A, 'ALM-SANMIGUEL')
  await stock(almMiraflores, storeA, jabon, 10)
  await stock(almSanMiguel, storeA, jabon, 1)

  // La posición que fijó la tienda pone San Miguel primero: la cercanía y el
  // stock tienen que poder más que ese orden.
  puntoSanMiguel = await punto('san-miguel', 'Botica San Miguel',
    { address: 'Av. La Marina 2000', district: 'San Miguel', city: 'Lima', region: 'Lima' }, almSanMiguel, 1)
  puntoMiraflores = await punto('miraflores', 'Botica Miraflores',
    { address: 'Av. Larco 1200', district: 'Miraflores', city: 'Lima', region: 'Lima' }, almMiraflores, 2)
  puntoSurco = await punto('surco', 'Botica Surco',
    { address: 'Av. Primavera 500', district: 'Santiago de Surco', city: 'Lima', region: 'Lima' }, null, 3)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('las tiendas más cercanas primero', () => {
  it('sin dirección se ven TODAS, y la del distrito del comprador va primero', async () => {
    const sinNada = await recojo({}, 1)
    expect(sinNada.available).toBe(true)
    expect(sinNada.pickup_points.map((p) => p.code).sort()).toEqual(['miraflores', 'san-miguel', 'surco'])

    const enMiraflores = await recojo({ district: 'Miraflores' }, 1)
    expect(enMiraflores.pickup_points[0]).toMatchObject({ code: 'miraflores', proximity: 'district', district: 'Miraflores' })
  })

  it('«Surco» encuentra «Santiago de Surco»; sin tildes ni mayúsculas', async () => {
    const enSurco = await recojo({ district: 'surco' }, 1)
    expect(enSurco.pickup_points[0]).toMatchObject({ code: 'surco', proximity: 'district' })
  })

  it('el mismo departamento cuenta como cercano, otro departamento no', async () => {
    const enLima = await recojo({ city: 'Lima' }, 1)
    expect(enLima.pickup_points.every((p) => p.proximity === 'city')).toBe(true)
    const enCusco = await recojo({ district: 'Wanchaq', city: 'Cusco', region: 'Cusco' }, 1)
    expect(enCusco.pickup_points.every((p) => p.proximity === 'other')).toBe(true)
  })
})

describe('el stock de cada tienda', () => {
  it('dice si la tienda tiene el carrito, qué le falta o que no lo sabe', async () => {
    const opcion = await recojo({ district: 'San Miguel' }, 2)
    const porCodigo = Object.fromEntries(opcion.pickup_points.map((p) => [p.code, p.stock]))
    expect(porCodigo.miraflores).toEqual({ state: 'available', missing: [] })
    expect(porCodigo['san-miguel']).toEqual({ state: 'unavailable', missing: ['Jabón líquido'] })
    expect(porCodigo.surco).toEqual({ state: 'unknown', missing: [] })
  })

  it('la que no tiene stock va al final aunque sea la más cercana', async () => {
    const opcion = await recojo({ district: 'San Miguel' }, 2)
    expect(opcion.pickup_points.at(-1)?.code).toBe('san-miguel')
  })

  it('si NINGUNA tiene stock y todas lo saben, el recojo no se ofrece', async () => {
    await svc(`update public.pickup_points set is_active = false where id = $1`, [puntoSurco])
    try {
      const opcion = await recojo({ district: 'Miraflores' }, 50)
      expect(opcion).toMatchObject({ available: false, reason: 'SIN_STOCK_EN_TIENDAS' })
    } finally {
      await svc(`update public.pickup_points set is_active = true where id = $1`, [puntoSurco])
    }
  })

  it('el inventario de OTRA sociedad no cuenta', async () => {
    const [wb] = await svc(
      `insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'ALM-B', 'Almacén B') returning id`,
      [TENANT_B.organizationId, TENANT_B.companyId],
    )
    const [r] = await svc<{ s: { state: string } }>(
      `select ebim.pickup_point_stock($1, $2, $3::jsonb) as s`, [storeA, wb?.id, lineas(1)])
    expect(r?.s.state).toBe('unavailable')
  })
})

describe('elegir la tienda: el servidor manda', () => {
  const elegir = (point: string, qty: number) =>
    svc(`select ebim.quote_delivery_choice($1, 'recojo', '{}'::jsonb, $2::jsonb, 100, $3) as r`,
      [storeA, lineas(qty), point])

  it('una tienda sin stock del carrito se rechaza aunque se pida a mano', async () => {
    expect(await expectFailure(() => elegir(puntoSanMiguel, 2))).toMatch(/PUNTO_SIN_STOCK/)
  })

  it('con stock, o sin almacén propio, se acepta', async () => {
    await expect(elegir(puntoMiraflores, 2)).resolves.toHaveLength(1)
    await expect(elegir(puntoSurco, 2)).resolves.toHaveLength(1)
  })
})
