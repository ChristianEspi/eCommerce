// @vitest-environment node
/**
 * P06-SaaS · Inventario multi-almacen, ATP y reservas, contra Postgres REAL.
 *
 * Lo que se compra aqui son las seis propiedades de las que depende que este
 * dominio sirva para vender de verdad:
 *
 *  · **no se puede sobrevender** — ni por una carrera, ni por un `update` mal
 *    escrito: el reparto decide dentro de la sentencia que escribe, y detras
 *    hay un CHECK que aborta la transaccion;
 *  · **consultar no es reservar** — el ATP es una foto y la reserva es lo unico
 *    que compromete, con caducidad obligatoria e idempotencia por referencia;
 *  · **el AISLAMIENTO se sostiene** en las seis tablas nuevas y tampoco se cuela
 *    por las funciones: la tienda de otro no se puede consultar, ni abastecer,
 *    ni reservar;
 *  · **"no se sabe" no es "no hay"** — un ERP con la cifra caducada no vacia la
 *    tienda ni promete lo que no puede cumplir;
 *  · **la transicion no rompe nada** — sin almacenes, todo se comporta
 *    exactamente igual que antes de esta fase, sobre `products.stock`;
 *  · **el libro mayor es libro mayor** — inmutable, idempotente por referencia
 *    externa y con el saldo resultante de cada asiento.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
} from './harness.ts'
import {
  ALERT_KINDS,
  INVENTORY_SOURCES,
  MOVEMENT_KINDS,
  RESERVATION_STATUSES,
  STALENESS_POLICIES,
  WAREHOUSE_KINDS,
} from '../../src/features/inventory/types.ts'

type Row = Record<string, unknown>

let db: PGlite

const STORE_A_SLUG = 'tienda-a'
const STORE_B_SLUG = 'tienda-b'
const MULTIWAREHOUSE = 'ecommerce.inventory.multiwarehouse'

let storeA: string
let storeB: string
let jabon: string
let camiseta: string
let camisetaRoja: string
let kit: string
let productoB: string
let uomUnit: string
let uomBox: string

let lima: string
let arequipa: string
let erp: string
let almacenB: string

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

async function svc(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'service_role', null, () => sql(query, params))
}

async function id(query: string, params: unknown[] = []): Promise<string> {
  const rows = await svc(query, params)
  return String(rows[0]?.id)
}

async function asMember(tenant: typeof TENANT_A, run: (tx: PGlite) => Promise<Row[]>) {
  return asRole(db, 'authenticated', claimsFor(tenant), run)
}

interface ItemInput {
  product_id: string
  quantity: number
  variant_id?: string
  uom_code?: string
}

async function checkout(
  slug: string,
  items: ItemInput[],
  options: { email?: string; token?: string } = {},
): Promise<Row> {
  const rows = await svc(
    `select public.create_order_for_slug(
        $1, $2, $3::jsonb, 'Ana Compradora', '+51 999 111 222',
        '{"address": "Av. Primavera 120"}'::jsonb, null, $4) as result`,
    [slug, options.email ?? 'ana@compradora.com', JSON.stringify(items), options.token ?? null],
  )
  return rows[0]?.result as Row
}

async function atp(store: string, product: string, variant: string | null = null): Promise<Row> {
  const [row] = await svc(`select ebim.atp($1, $2, $3) as result`, [store, product, variant])
  return row?.result as Row
}

async function level(warehouse: string, product: string, variant: string | null = null): Promise<Row> {
  const [row] = await svc(
    `select id, on_hand_qty::float8 as on_hand, reserved_qty::float8 as reserved,
            available_qty::float8 as available, safety_stock::float8 as safety
       from public.inventory_levels
      where warehouse_id = $1 and product_id = $2 and variant_id is not distinct from $3`,
    [warehouse, product, variant],
  )
  return row as Row
}

/** Alta de existencia por la puerta del backoffice, como la usaria un operador. */
async function receive(
  warehouse: string,
  product: string,
  quantity: number,
  variant: string | null = null,
): Promise<void> {
  await asMember(TENANT_A, (tx) =>
    tx
      .query(`select public.adjust_inventory($1, $2, $3, $4, 'receipt', 'alta de prueba', null)`, [
        warehouse,
        product,
        variant,
        quantity,
      ])
      .then((r) => r.rows as Row[]),
  )
}

async function setStock(warehouse: string, product: string, quantity: number, variant: string | null = null) {
  await svc(`select public.sync_inventory_level($1, $2, $3, $4, null, 'fixture')`, [
    warehouse,
    product,
    variant,
    quantity,
  ])
}

beforeAll(async () => {
  db = await createTestDatabase()

  for (const [tenant, storeSlug] of [
    [TENANT_A, STORE_A_SLUG],
    [TENANT_B, STORE_B_SLUG],
  ] as const) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.slug,
      tenant.adminEmail, tenant.ownerId, storeSlug,
    ])

    // El alta deja el PAQUETE DE ARRANQUE (20260926100000): módulos, IA y cuota.
    // Aquí se retira porque estos casos prueban el candado de módulo, y un
    // candado no se puede probar sobre una sociedad que ya lo tiene todo.
    await svc(
      `with entitlements as (
         delete from public.tenant_entitlements where organization_id = $1 returning 1
       ), contexto as (
         delete from public.tenant_platform_context where organization_id = $1 returning 1
       )
       delete from public.ai_quotas where organization_id = $1`,
      [tenant.organizationId],
    )
  }
  await svc(`update public.stores set status = 'active'`)
  await svc(`update public.store_settings set tax_rate = 0`)

  // Solo el tenant A contrata el modulo. El B es el control de que, sin el, la
  // tienda sigue vendiendo exactamente como antes de esta fase.
  await svc(
    `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
    [TENANT_A.organizationId, TENANT_A.companyId, [MULTIWAREHOUSE]],
  )

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === STORE_A_SLUG)?.id)
  storeB = String(stores.find((s) => s.slug === STORE_B_SLUG)?.id)

  const insertProduct = `
    insert into public.products
      (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status,
       published_at, kind)
    values ($1, $2, $3, $4, $5, $6, $7, 'PEN', $8, 'published', now(), $9::public.product_kind)
    returning id`

  jabon = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-JABON', 'jabon', 'Jabón',
    '10.00', 100, 'simple',
  ])
  camiseta = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-CAMISETA', 'camiseta', 'Camiseta',
    '60.00', 0, 'variant',
  ])
  kit = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-KIT', 'kit', 'Pack bienvenida',
    '80.00', 0, 'bundle',
  ])
  productoB = await id(insertProduct, [
    TENANT_B.organizationId, TENANT_B.companyId, storeB, 'B-LAMPARA', 'lampara', 'Lámpara',
    '55.00', 4, 'simple',
  ])

  camisetaRoja = await id(
    `insert into public.product_variants
       (organization_id, company_id, store_id, product_id, sku, name, price, stock, is_active, is_default)
     values ($1, $2, $3, $4, 'A-CAM-ROJA', 'Roja', null, 10, true, true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, camiseta],
  )

  uomUnit = await id(
    `insert into public.units_of_measure (organization_id, company_id, code, name)
     values ($1, $2, 'UND', 'Unidad') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  uomBox = await id(
    `insert into public.units_of_measure (organization_id, company_id, code, name)
     values ($1, $2, 'CAJA', 'Caja x 12') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  await svc(
    `insert into public.product_uoms
       (organization_id, company_id, store_id, product_id, uom_id, factor, is_base, is_sellable)
     values ($1, $2, $3, $4, $5, 1, true, true),
            ($1, $2, $3, $4, $6, 12, false, true)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, jabon, uomUnit, uomBox],
  )

  await svc(
    `insert into public.bundle_items
       (organization_id, company_id, store_id, bundle_product_id,
        component_product_id, component_kind, component_variant_id, quantity)
     values ($1, $2, $3, $4, $5, 'simple', null, 2),
            ($1, $2, $3, $4, $6, 'variant', $7, 1)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, kit, jabon, camiseta, camisetaRoja],
  )

  const insertWarehouse = `
    insert into public.warehouses
      (organization_id, company_id, code, name, kind, source, priority, allows_backorder,
       stale_after, stale_policy)
    values ($1, $2, $3, $4, $5::public.warehouse_kind, $6::public.inventory_source, $7, $8,
            $9::interval, $10::public.stock_staleness_policy)
    returning id`

  lima = await id(insertWarehouse, [
    TENANT_A.organizationId, TENANT_A.companyId, 'LIMA', 'CD Lima', 'warehouse', 'local',
    10, false, null, 'unknown',
  ])
  arequipa = await id(insertWarehouse, [
    TENANT_A.organizationId, TENANT_A.companyId, 'AQP', 'CD Arequipa', 'warehouse', 'local',
    20, false, null, 'unknown',
  ])
  erp = await id(insertWarehouse, [
    TENANT_A.organizationId, TENANT_A.companyId, 'ERP', 'Almacén del ERP', 'virtual', 'erp',
    30, false, '1 hour', 'unknown',
  ])
  // El almacen del ERP arranca INACTIVO: la mayoria de los tests hablan de dos
  // almacenes locales, y se enciende solo en el bloque de degradacion.
  await svc(`update public.warehouses set is_active = false where id = $1`, [erp])

  almacenB = await id(insertWarehouse, [
    TENANT_B.organizationId, TENANT_B.companyId, 'B-CD', 'CD del tenant B', 'warehouse', 'local',
    10, false, null, 'unknown',
  ])
}, 240_000)

/**
 * Estado limpio en cada test. El limite de tasa del checkout cuenta por correo
 * y por tienda en una ventana de una hora, y aqui se hacen decenas de pedidos
 * en segundos. Las existencias se reponen para que el orden de los tests no
 * cambie el resultado de ninguno.
 */
beforeEach(async () => {
  await svc(`delete from public.checkout_attempts`)
  await svc(`delete from public.inventory_reservation_items`)
  await svc(`delete from public.inventory_reservations`)
  await svc(`delete from public.inventory_movements`)
  await svc(`delete from public.inventory_levels`)
  await svc(`delete from public.store_warehouses`)
  await svc(`delete from public.orders`)
  await svc(
    `update public.warehouses set is_active = (code not in ('ERP', 'B-CD')), allows_backorder = false`,
  )
  await svc(`update public.products set stock = 100 where id = $1`, [jabon])
  await svc(`update public.products set stock = 4   where id = $1`, [productoB])
  await svc(`update public.product_variants set stock = 10 where id = $1`, [camisetaRoja])
})

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('el esquema es el que el codigo cree que es', () => {
  it('las seis tablas del dominio existen con tenant y RLS forzada', async () => {
    const rows = await sql(`
      select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in ('warehouses','store_warehouses','inventory_levels',
                          'inventory_movements','inventory_reservations',
                          'inventory_reservation_items')
      order by c.relname
    `)
    expect(rows.map((r) => r.name)).toEqual([
      'inventory_levels',
      'inventory_movements',
      'inventory_reservation_items',
      'inventory_reservations',
      'store_warehouses',
      'warehouses',
    ])
    for (const row of rows) {
      expect(`${row.name}:${row.enabled}:${row.forced}`).toBe(`${row.name}:true:true`)
    }
  })

  it('los enums de TypeScript son copia exacta de los de Postgres', async () => {
    async function values(typeName: string): Promise<string[]> {
      const rows = await sql(
        `select e.enumlabel as label
           from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = $1 order by e.enumsortorder`,
        [typeName],
      )
      return rows.map((r) => String(r.label))
    }
    expect(await values('warehouse_kind')).toEqual([...WAREHOUSE_KINDS])
    expect(await values('inventory_source')).toEqual([...INVENTORY_SOURCES])
    expect(await values('stock_staleness_policy')).toEqual([...STALENESS_POLICIES])
    expect(await values('movement_kind')).toEqual([...MOVEMENT_KINDS])
    expect(await values('reservation_status')).toEqual([...RESERVATION_STATUSES])
  })

  it('`available_qty` es una columna GENERADA: nadie la puede escribir', async () => {
    const [row] = await sql(`
      select is_generated, generation_expression
      from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_levels'
        and column_name = 'available_qty'
    `)
    expect(row?.is_generated).toBe('ALWAYS')
    expect(String(row?.generation_expression)).toMatch(/on_hand_qty/)
  })

  it('el libro mayor y las existencias no tienen NI UNA policy de escritura', async () => {
    const rows = await sql(`
      select c.relname as table_name, p.polcmd as cmd
      from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('inventory_levels','inventory_movements',
                          'inventory_reservations','inventory_reservation_items')
        and p.polcmd <> 'r'
    `)
    expect(rows).toEqual([])
  })

  it('`anon` no tiene ni un GRANT sobre las seis tablas', async () => {
    const rows = await sql(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'
        and table_name in ('warehouses','store_warehouses','inventory_levels',
                           'inventory_movements','inventory_reservations',
                           'inventory_reservation_items')
    `)
    expect(rows).toEqual([])
  })

  it('estan los indices por SKU/almacen y por disponibilidad', async () => {
    const rows = await sql(`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'inventory_levels'
      order by indexname
    `)
    const names = rows.map((r) => String(r.indexname))
    expect(names).toContain('inventory_levels_sku_idx')
    expect(names).toContain('inventory_levels_available_idx')
    expect(names).toContain('inventory_levels_reorder_idx')
    expect(names).toContain('inventory_levels_warehouse_idx')
  })

  it('la idempotencia del libro mayor es un indice unico, no una comprobacion', async () => {
    const [row] = await sql(`
      select indexdef from pg_indexes
      where schemaname = 'public' and indexname = 'inventory_movements_external_key'
    `)
    expect(String(row?.indexdef)).toMatch(/UNIQUE/i)
    expect(String(row?.indexdef)).toMatch(/external_ref/)
  })
})

describe('el modelo hace imposibles los estados que corrompen un almacen', () => {
  it('no se puede comprometer mas de lo que hay sin backorder explicito', async () => {
    await receive(lima, jabon, 5)
    const row = await level(lima, jabon)
    const message = await expectFailure(() =>
      svc(`update public.inventory_levels set reserved_qty = 6 where id = $1`, [row.id]),
    )
    expect(message).toMatch(/inventory_levels_no_oversell/)
  })

  it('el saldo no puede bajar de cero sin backorder explicito', async () => {
    await receive(lima, jabon, 5)
    const row = await level(lima, jabon)
    const message = await expectFailure(() =>
      svc(`update public.inventory_levels set on_hand_qty = -1 where id = $1`, [row.id]),
    )
    expect(message).toMatch(/inventory_levels_no_oversell/)
  })

  it('con backorder declarado en el almacen, el negativo SI se permite', async () => {
    await svc(`update public.warehouses set allows_backorder = true where id = $1`, [lima])
    await receive(lima, jabon, 5)
    const row = await level(lima, jabon)
    await svc(`update public.inventory_levels set on_hand_qty = -3 where id = $1`, [row.id])
    expect(Number((await level(lima, jabon)).on_hand)).toBe(-3)
  })

  it('la politica de backorder del nivel no puede discrepar de la del almacen', async () => {
    await receive(lima, jabon, 5)
    const row = await level(lima, jabon)
    const message = await expectFailure(() =>
      svc(`update public.inventory_levels set allow_backorder = true where id = $1`, [row.id]),
    )
    expect(message).toMatch(/inventory_levels_backorder_fk|foreign key/i)
  })

  it('cambiar la politica en el almacen la propaga a sus existencias', async () => {
    await receive(lima, jabon, 5)
    await svc(`update public.warehouses set allows_backorder = true where id = $1`, [lima])
    const [row] = await svc(
      `select allow_backorder from public.inventory_levels where warehouse_id = $1 and product_id = $2`,
      [lima, jabon],
    )
    expect(row?.allow_backorder).toBe(true)
  })

  it('una variante de OTRO producto no se puede colgar de esta existencia', async () => {
    await receive(lima, jabon, 5)
    const row = await level(lima, jabon)
    const message = await expectFailure(() =>
      svc(`update public.inventory_levels set variant_id = $1 where id = $2`, [camisetaRoja, row.id]),
    )
    expect(message).toMatch(/inventory_levels_variant_fk|foreign key/i)
  })

  it('el mismo SKU no se repite dos veces en el mismo almacen', async () => {
    await receive(lima, jabon, 5)
    const message = await expectFailure(() =>
      svc(
        `insert into public.inventory_levels
           (organization_id, company_id, warehouse_id, store_id, product_id, variant_id)
         values ($1, $2, $3, $4, $5, null)`,
        [TENANT_A.organizationId, TENANT_A.companyId, lima, storeA, jabon],
      ),
    )
    expect(message).toMatch(/inventory_levels_unique/)
  })

  it('un kit no puede llevar existencia propia', async () => {
    const message = await expectFailure(() => receive(lima, kit, 5))
    expect(message).toMatch(/KIT_SIN_EXISTENCIA/)
  })

  it('un producto con variantes exige decir cual', async () => {
    const message = await expectFailure(() => receive(lima, camiseta, 5))
    expect(message).toMatch(/VARIANTE_REQUERIDA/)
  })

  it('una reserva sin caducidad no existe: la columna es NOT NULL', async () => {
    const [row] = await sql(`
      select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_reservations'
        and column_name = 'expires_at'
    `)
    expect(row?.is_nullable).toBe('NO')
  })
})

describe('aislamiento entre tenants', () => {
  it('el tenant B no ve ni un almacen ni una existencia del A', async () => {
    await receive(lima, jabon, 5)

    const warehouses = await asMember(TENANT_B, (tx) =>
      tx.query(`select id from public.warehouses`).then((r) => r.rows as Row[]),
    )
    expect(warehouses.map((w) => w.id)).toEqual([almacenB])

    const levels = await asMember(TENANT_B, (tx) =>
      tx.query(`select id from public.inventory_levels`).then((r) => r.rows as Row[]),
    )
    expect(levels).toEqual([])
  })

  it('el tenant A no ve el almacen del B', async () => {
    const rows = await asMember(TENANT_A, (tx) =>
      tx.query(`select code from public.warehouses order by code`).then((r) => r.rows as Row[]),
    )
    expect(rows.map((r) => r.code)).not.toContain('B-CD')
  })

  it('un almacen no puede guardar el producto de otra sociedad', async () => {
    const message = await expectFailure(() =>
      asMember(TENANT_A, (tx) =>
        tx
          .query(`select public.adjust_inventory($1, $2, null, 5, 'receipt', null, null)`, [
            lima,
            productoB,
          ])
          .then((r) => r.rows as Row[]),
      ),
    )
    expect(message).toMatch(/ALMACEN_DE_OTRA_SOCIEDAD/)
  })

  it('preguntar por la disponibilidad de la tienda de otro levanta SIN_PERMISO', async () => {
    const message = await expectFailure(() =>
      asMember(TENANT_A, (tx) =>
        tx
          .query(`select public.inventory_availability($1, $2::jsonb)`, [
            storeB,
            JSON.stringify([{ product_id: productoB, quantity: 1 }]),
          ])
          .then((r) => r.rows as Row[]),
      ),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('reservar en la tienda de otro tambien', async () => {
    const message = await expectFailure(() =>
      asMember(TENANT_A, (tx) =>
        tx
          .query(`select public.reserve_inventory($1, 'intruso', $2::jsonb, 900, 'manual')`, [
            storeB,
            JSON.stringify([{ product_id: productoB, quantity: 1 }]),
          ])
          .then((r) => r.rows as Row[]),
      ),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })
})

describe('el modulo se vende: sin entitlement no hay almacenes', () => {
  it('el tenant B no puede dar de alta un almacen', async () => {
    const message = await expectFailure(() =>
      asMember(TENANT_B, (tx) =>
        tx
          .query(
            `insert into public.warehouses (organization_id, company_id, code, name)
             values ($1, $2, 'NUEVO', 'Nuevo')`,
            [TENANT_B.organizationId, TENANT_B.companyId],
          )
          .then((r) => r.rows as Row[]),
      ),
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('y tampoco puede mover existencia', async () => {
    await svc(`update public.warehouses set is_active = true where id = $1`, [almacenB])
    const message = await expectFailure(() =>
      asMember(TENANT_B, (tx) =>
        tx
          .query(`select public.adjust_inventory($1, $2, null, 5, 'receipt', null, null)`, [
            almacenB,
            productoB,
          ])
          .then((r) => r.rows as Row[]),
      ),
    )
    expect(message).toMatch(/MODULO_NO_CONTRATADO/)
  })

  it('pero su tienda sigue vendiendo contra la existencia del catalogo', async () => {
    const result = await checkout(STORE_B_SLUG, [{ product_id: productoB, quantity: 2 }], {
      email: 'compra@tenant-b.com',
    })
    expect(result.order_number).toMatch(/^EC-/)
    const [row] = await svc(`select stock from public.products where id = $1`, [productoB])
    expect(Number(row?.stock)).toBe(2)
  })
})

describe('ATP: lo que se puede prometer', () => {
  it('sin almacenes que sirvan a la tienda, la fuente es el CATALOGO', async () => {
    await svc(`update public.warehouses set is_active = false where organization_id = $1`, [
      TENANT_A.organizationId,
    ])
    const result = await atp(storeA, jabon)
    expect(result.source).toBe('catalog')
    expect(Number(result.available)).toBe(100)
    expect(result.unknown).toBe(false)
  })

  it('con almacenes, la fuente es el almacen y la cifra sale de ahi', async () => {
    await receive(lima, jabon, 7)
    const result = await atp(storeA, jabon)
    expect(result.source).toBe('warehouse')
    expect(Number(result.available)).toBe(7)
  })

  it('suma los almacenes que sirven a la tienda', async () => {
    await receive(lima, jabon, 7)
    await receive(arequipa, jabon, 3)
    expect(Number((await atp(storeA, jabon)).available)).toBe(10)
  })

  it('lo comprometido baja el prometible y NO el fisico', async () => {
    await receive(lima, jabon, 10)
    await asMember(TENANT_A, (tx) =>
      tx
        .query(`select public.reserve_inventory($1, 'carrito-1', $2::jsonb, 900, 'manual')`, [
          storeA,
          JSON.stringify([{ product_id: jabon, quantity: 4 }]),
        ])
        .then((r) => r.rows as Row[]),
    )
    const row = await level(lima, jabon)
    expect(Number(row.on_hand)).toBe(10)
    expect(Number(row.reserved)).toBe(4)
    expect(Number((await atp(storeA, jabon)).available)).toBe(6)
  })

  it('el colchon no se promete aunque este fisicamente', async () => {
    await receive(lima, jabon, 10)
    await asMember(TENANT_A, (tx) =>
      tx
        .query(`select public.set_inventory_policy($1, $2, null, 3, 5)`, [lima, jabon])
        .then((r) => r.rows as Row[]),
    )
    expect(Number((await level(lima, jabon)).on_hand)).toBe(10)
    expect(Number((await atp(storeA, jabon)).available)).toBe(7)
  })

  it('declarar un almacen en la tienda excluye a los demas', async () => {
    await receive(lima, jabon, 7)
    await receive(arequipa, jabon, 3)
    expect(Number((await atp(storeA, jabon)).available)).toBe(10)

    await svc(
      `insert into public.store_warehouses (organization_id, company_id, store_id, warehouse_id)
       values ($1, $2, $3, $4)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, arequipa],
    )
    expect(Number((await atp(storeA, jabon)).available)).toBe(3)
  })

  it('un kit se promete por el componente que menos alcanza', async () => {
    // El kit lleva 2 jabones y 1 camiseta roja por unidad.
    await receive(lima, jabon, 10)
    await receive(lima, camiseta, 3, camisetaRoja)
    expect(Number((await atp(storeA, kit)).available)).toBe(3)

    await setStock(lima, jabon, 4)
    expect(Number((await atp(storeA, kit)).available)).toBe(2)
  })
})

describe('movimientos: trazables e idempotentes', () => {
  it('una entrada deja asiento con el saldo resultante y su motivo', async () => {
    await receive(lima, jabon, 12)
    const [row] = await svc(
      `select kind, quantity::float8 as quantity, on_hand_after::float8 as after, reason,
              reference_kind
         from public.inventory_movements where warehouse_id = $1`,
      [lima],
    )
    expect(row?.kind).toBe('receipt')
    expect(Number(row?.quantity)).toBe(12)
    expect(Number(row?.after)).toBe(12)
    expect(row?.reference_kind).toBe('manual')
  })

  it('el mismo evento externo dos veces mueve la existencia UNA vez', async () => {
    await svc(`select public.sync_inventory_level($1, $2, null, 20, 'erp-evt-1', null)`, [lima, jabon])
    await svc(`select public.sync_inventory_level($1, $2, null, 20, 'erp-evt-1', null)`, [lima, jabon])

    expect(Number((await level(lima, jabon)).on_hand)).toBe(20)
    const [count] = await svc(
      `select count(*)::int as n from public.inventory_movements where external_ref = 'erp-evt-1'`,
    )
    expect(Number(count?.n)).toBe(1)
  })

  it('el ERP manda SALDOS y el delta lo calcula la base', async () => {
    await receive(lima, jabon, 10)
    await svc(`select public.sync_inventory_level($1, $2, null, 4, 'erp-conteo', null)`, [lima, jabon])

    expect(Number((await level(lima, jabon)).on_hand)).toBe(4)
    const [row] = await svc(
      `select kind, quantity::float8 as quantity, source
         from public.inventory_movements where external_ref = 'erp-conteo'`,
    )
    expect(row?.kind).toBe('count')
    expect(Number(row?.quantity)).toBe(-6)
    expect(row?.source).toBe('erp')
  })

  it('un saldo igual al que ya habia refresca la marca de sincronizacion sin mover nada', async () => {
    await receive(lima, jabon, 10)
    await svc(
      `update public.inventory_levels set synced_at = now() - interval '5 hours'
        where warehouse_id = $1 and product_id = $2`,
      [lima, jabon],
    )
    await svc(`select public.sync_inventory_level($1, $2, null, 10, 'erp-igual', null)`, [lima, jabon])

    const [row] = await svc(
      `select (synced_at > now() - interval '1 minute') as fresh
         from public.inventory_levels where warehouse_id = $1 and product_id = $2`,
      [lima, jabon],
    )
    expect(row?.fresh).toBe(true)
    const [count] = await svc(`select count(*)::int as n from public.inventory_movements`)
    expect(Number(count?.n)).toBe(1)
  })

  it('el signo tiene que decir lo mismo que el motivo', async () => {
    const message = await expectFailure(() =>
      asMember(TENANT_A, (tx) =>
        tx
          .query(`select public.adjust_inventory($1, $2, null, -5, 'receipt', null, null)`, [
            lima,
            jabon,
          ])
          .then((r) => r.rows as Row[]),
      ),
    )
    expect(message).toMatch(/SIGNO_INCOHERENTE/)
  })

  it('la salida por venta NO se registra a mano', async () => {
    const message = await expectFailure(() =>
      asMember(TENANT_A, (tx) =>
        tx
          .query(`select public.adjust_inventory($1, $2, null, -5, 'issue', null, null)`, [lima, jabon])
          .then((r) => r.rows as Row[]),
      ),
    )
    expect(message).toMatch(/MOVIMIENTO_NO_PERMITIDO/)
  })

  it('el libro mayor no se puede editar ni borrar desde una sesion', async () => {
    await receive(lima, jabon, 5)
    const update = await expectFailure(() =>
      asMember(TENANT_A, (tx) =>
        tx.query(`update public.inventory_movements set quantity = 1`).then((r) => r.rows as Row[]),
      ),
    )
    expect(update).toMatch(/permission denied|row-level security/i)

    const remove = await expectFailure(() =>
      asMember(TENANT_A, (tx) =>
        tx.query(`delete from public.inventory_movements`).then((r) => r.rows as Row[]),
      ),
    )
    expect(remove).toMatch(/permission denied|row-level security/i)
  })
})

describe('reservas', () => {
  async function reserve(reference: string, items: ItemInput[], ttl = 900): Promise<Row> {
    const rows = await asMember(TENANT_A, (tx) =>
      tx
        .query(`select public.reserve_inventory($1, $2, $3::jsonb, $4, 'manual') as result`, [
          storeA,
          reference,
          JSON.stringify(items),
          ttl,
        ])
        .then((r) => r.rows as Row[]),
    )
    return rows[0]?.result as Row
  }

  it('comprometer no mueve mercancia, solo la aparta', async () => {
    await receive(lima, jabon, 10)
    const result = await reserve('carrito-a', [{ product_id: jabon, quantity: 4 }])

    expect(result.status).toBe('held')
    expect(String(result.token)).toHaveLength(64)
    const row = await level(lima, jabon)
    expect(Number(row.on_hand)).toBe(10)
    expect(Number(row.reserved)).toBe(4)
  })

  it('la presentacion se convierte a unidades base en el servidor', async () => {
    await receive(lima, jabon, 100)
    await reserve('carrito-caja', [{ product_id: jabon, quantity: 2, uom_code: 'CAJA' }])
    expect(Number((await level(lima, jabon)).reserved)).toBe(24)
  })

  it('reservar dos veces para el mismo carrito devuelve la MISMA reserva', async () => {
    await receive(lima, jabon, 10)
    const first = await reserve('carrito-b', [{ product_id: jabon, quantity: 3 }])
    const second = await reserve('carrito-b', [{ product_id: jabon, quantity: 3 }])

    expect(second.reservation_id).toBe(first.reservation_id)
    expect(second.created).toBe(false)
    expect(Number((await level(lima, jabon)).reserved)).toBe(3)
  })

  it('o entran todas las lineas o no entra ninguna', async () => {
    await receive(lima, jabon, 10)
    await receive(lima, camiseta, 1, camisetaRoja)

    const message = await expectFailure(() =>
      reserve('carrito-c', [
        { product_id: jabon, quantity: 2 },
        { product_id: camiseta, variant_id: camisetaRoja, quantity: 5 },
      ]),
    )
    expect(message).toMatch(/STOCK_INSUFICIENTE/)

    expect(Number((await level(lima, jabon)).reserved)).toBe(0)
    expect(Number((await level(lima, camiseta, camisetaRoja)).reserved)).toBe(0)
    const [count] = await svc(`select count(*)::int as n from public.inventory_reservations`)
    expect(Number(count?.n)).toBe(0)
  })

  it('soltar dos veces no libera el doble', async () => {
    await receive(lima, jabon, 10)
    const result = await reserve('carrito-d', [{ product_id: jabon, quantity: 4 }])

    for (let i = 0; i < 2; i += 1) {
      await asMember(TENANT_A, (tx) =>
        tx
          .query(`select public.release_inventory_reservation($1, 'prueba')`, [result.reservation_id])
          .then((r) => r.rows as Row[]),
      )
    }
    expect(Number((await level(lima, jabon)).reserved)).toBe(0)
    expect(Number((await level(lima, jabon)).on_hand)).toBe(10)
  })

  it('confirmar la reserva baja lo fisico y lo comprometido, y deja asiento', async () => {
    await receive(lima, jabon, 10)
    const result = await reserve('carrito-e', [{ product_id: jabon, quantity: 4 }])

    await asMember(TENANT_A, (tx) =>
      tx
        .query(`select public.commit_inventory_reservation($1, 'despachado')`, [result.reservation_id])
        .then((r) => r.rows as Row[]),
    )

    const row = await level(lima, jabon)
    expect(Number(row.on_hand)).toBe(6)
    expect(Number(row.reserved)).toBe(0)

    const [movement] = await svc(
      `select kind, quantity::float8 as quantity from public.inventory_movements
        where kind = 'issue'`,
    )
    expect(Number(movement?.quantity)).toBe(-4)
  })

  it('una reserva caducada se suelta sola en cuanto alguien vuelve a reservar', async () => {
    await receive(lima, jabon, 10)
    const stale = await reserve('carrito-viejo', [{ product_id: jabon, quantity: 8 }], 60)
    await svc(`update public.inventory_reservations set expires_at = now() - interval '1 minute'`)

    // Con la vieja viva no cabria; caducada, si.
    const fresh = await reserve('carrito-nuevo', [{ product_id: jabon, quantity: 9 }])
    expect(fresh.status).toBe('held')

    const [old] = await svc(`select status from public.inventory_reservations where id = $1`, [
      stale.reservation_id,
    ])
    expect(old?.status).toBe('expired')
    expect(Number((await level(lima, jabon)).reserved)).toBe(9)
  })

  it('el secreto es lo unico que reclama una reserva: un token ajeno no vale', async () => {
    await receive(lima, jabon, 10)
    await reserve('carrito-f', [{ product_id: jabon, quantity: 4 }])

    const message = await expectFailure(() =>
      svc(`select public.release_inventory_by_token($1, $2)`, [STORE_A_SLUG, 'x'.repeat(64)]),
    )
    expect(message).toMatch(/RESERVA_NO_ENCONTRADA/)
    expect(Number((await level(lima, jabon)).reserved)).toBe(4)
  })

  it('con el secreto correcto, el carrito abandonado devuelve sus unidades', async () => {
    await receive(lima, jabon, 10)
    const result = await reserve('carrito-g', [{ product_id: jabon, quantity: 4 }])

    await svc(`select public.release_inventory_by_token($1, $2)`, [STORE_A_SLUG, result.token])
    expect(Number((await level(lima, jabon)).reserved)).toBe(0)
  })
})

describe('concurrencia: dos compradores no se llevan la misma unidad', () => {
  async function reserve(reference: string, quantity: number): Promise<Row> {
    const rows = await asMember(TENANT_A, (tx) =>
      tx
        .query(`select public.reserve_inventory($1, $2, $3::jsonb, 900, 'manual') as result`, [
          storeA,
          reference,
          JSON.stringify([{ product_id: jabon, quantity }]),
        ])
        .then((r) => r.rows as Row[]),
    )
    return rows[0]?.result as Row
  }

  /**
   * ESTE es el criterio de aceptacion de la fase, reproducido paso a paso: un
   * carrito aparta 3 de 5, y el checkout de OTRO comprador no puede llevarse
   * esas 3 aunque sigan fisicamente en el almacen.
   */
  it('lo reservado por un carrito no lo puede vender otro checkout', async () => {
    await receive(lima, jabon, 5)
    await reserve('carrito-uno', 3)

    const message = await expectFailure(() =>
      checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 3 }], { email: 'otro@compra.com' }),
    )
    expect(message).toMatch(/STOCK_INSUFICIENTE/)

    // Lo que NO esta reservado si se puede comprar.
    const ok = await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 2 }], {
      email: 'otro@compra.com',
    })
    expect(ok.order_number).toMatch(/^EC-/)

    const row = await level(lima, jabon)
    expect(Number(row.on_hand)).toBe(3)
    expect(Number(row.reserved)).toBe(3)
    expect(Number(row.available)).toBe(0)
  })

  it('y el dueño de la reserva SI puede, presentando su secreto', async () => {
    await receive(lima, jabon, 5)
    const held = await reserve('carrito-dos', 3)

    const order = await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 3 }], {
      email: 'dueño@compra.com',
      token: String(held.token),
    })
    expect(order.order_number).toMatch(/^EC-/)

    const row = await level(lima, jabon)
    expect(Number(row.on_hand)).toBe(2)
    expect(Number(row.reserved)).toBe(0)

    const [reservation] = await svc(
      `select status, order_id from public.inventory_reservations where id = $1`,
      [held.reservation_id],
    )
    expect(reservation?.status).toBe('committed')
    expect(reservation?.order_id).toBe(order.order_id)
  })

  it('un secreto ya usado no sirve dos veces', async () => {
    await receive(lima, jabon, 5)
    const held = await reserve('carrito-tres', 2)
    await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 2 }], {
      email: 'uno@compra.com',
      token: String(held.token),
    })

    const message = await expectFailure(() =>
      checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 2 }], {
        email: 'dos@compra.com',
        token: String(held.token),
      }),
    )
    expect(message).toMatch(/RESERVA_NO_VIGENTE/)
  })

  /**
   * La carrera clasica, reproducida de forma determinista: un llamante lee la
   * disponibilidad (5), otro consume 3, y el primero intenta tomar las 5 que
   * "habia". Si el reparto decidiera con la lectura previa, venderia 5 de 2.
   * Como decide DENTRO de la sentencia que escribe, sobre la fila ya bloqueada,
   * no puede.
   */
  it('el reparto decide sobre la fila bloqueada, no sobre una lectura anterior', async () => {
    await receive(lima, jabon, 5)
    const foto = Number((await atp(storeA, jabon)).available)
    expect(foto).toBe(5)

    await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 3 }], { email: 'rapido@compra.com' })

    const message = await expectFailure(() => reserve('carrito-tarde', foto))
    expect(message).toMatch(/STOCK_INSUFICIENTE/)
    expect(Number((await level(lima, jabon)).on_hand)).toBe(2)
  })

  it('dos pedidos seguidos nunca dejan el almacen en negativo', async () => {
    await receive(lima, jabon, 5)
    await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 3 }], { email: 'a@compra.com' })

    const message = await expectFailure(() =>
      checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 3 }], { email: 'b@compra.com' }),
    )
    expect(message).toMatch(/STOCK_INSUFICIENTE/)
    expect(Number((await level(lima, jabon)).on_hand)).toBe(2)
  })

  it('un pedido que falla a medias no deja ni una unidad movida', async () => {
    await receive(lima, jabon, 10)
    await receive(lima, camiseta, 1, camisetaRoja)

    const message = await expectFailure(() =>
      checkout(
        STORE_A_SLUG,
        [
          { product_id: jabon, quantity: 2 },
          { product_id: camiseta, variant_id: camisetaRoja, quantity: 5 },
        ],
        { email: 'medias@compra.com' },
      ),
    )
    expect(message).toMatch(/STOCK_INSUFICIENTE/)
    expect(Number((await level(lima, jabon)).on_hand)).toBe(10)
    const [count] = await svc(`select count(*)::int as n from public.orders`)
    expect(Number(count?.n)).toBe(0)
  })

  it('el CHECK es la ultima linea: ni siquiera service_role puede sobrevender a mano', async () => {
    await receive(lima, jabon, 5)
    const row = await level(lima, jabon)
    const message = await expectFailure(() =>
      svc(`update public.inventory_levels set reserved_qty = on_hand_qty + 1 where id = $1`, [row.id]),
    )
    expect(message).toMatch(/inventory_levels_no_oversell/)
  })
})

describe('multi-almacen', () => {
  it('un pedido que no cabe en uno se reparte entre dos, por prioridad', async () => {
    await receive(lima, jabon, 4)
    await receive(arequipa, jabon, 6)

    await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 7 }], { email: 'reparto@compra.com' })

    expect(Number((await level(lima, jabon)).on_hand)).toBe(0)
    expect(Number((await level(arequipa, jabon)).on_hand)).toBe(3)

    const movements = await svc(
      `select w.code, m.quantity::float8 as quantity
         from public.inventory_movements m
         join public.warehouses w on w.id = m.warehouse_id
        where m.kind = 'issue' order by w.code`,
    )
    expect(movements.map((m) => `${m.code}:${m.quantity}`)).toEqual(['AQP:-3', 'LIMA:-4'])
  })

  it('el orden de reparto lo manda la prioridad de la tienda cuando la declara', async () => {
    await receive(lima, jabon, 4)
    await receive(arequipa, jabon, 6)
    await svc(
      `insert into public.store_warehouses (organization_id, company_id, store_id, warehouse_id, priority)
       values ($1, $2, $3, $4, 1), ($1, $2, $3, $5, 2)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, arequipa, lima],
    )

    await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 7 }], { email: 'orden@compra.com' })

    expect(Number((await level(arequipa, jabon)).on_hand)).toBe(0)
    expect(Number((await level(lima, jabon)).on_hand)).toBe(3)
  })

  it('un kit consume sus componentes del almacen, nunca su propia existencia', async () => {
    await receive(lima, jabon, 10)
    await receive(lima, camiseta, 3, camisetaRoja)

    await checkout(STORE_A_SLUG, [{ product_id: kit, quantity: 2 }], { email: 'kit@compra.com' })

    expect(Number((await level(lima, jabon)).on_hand)).toBe(6)
    expect(Number((await level(lima, camiseta, camisetaRoja)).on_hand)).toBe(1)

    const [row] = await svc(`select stock from public.products where id = $1`, [kit])
    expect(Number(row?.stock)).toBe(0)
  })
})

describe('degradacion: cuando el ERP no contesta', () => {
  beforeEach(async () => {
    await svc(`update public.warehouses set is_active = true where id = $1`, [erp])
    await svc(`update public.warehouses set is_active = false where id in ($1, $2)`, [lima, arequipa])
  })

  async function makeStale() {
    await svc(
      `update public.inventory_levels set synced_at = now() - interval '5 hours'
        where warehouse_id = $1`,
      [erp],
    )
  }

  it('una cifra caducada no es cero: la respuesta es "no se sabe"', async () => {
    await svc(`select public.sync_inventory_level($1, $2, null, 8, 'erp-1', null)`, [erp, jabon])
    await makeStale()

    const result = await atp(storeA, jabon)
    expect(result.unknown).toBe(true)
    expect(Number(result.available)).toBe(0)
    expect(result.source).toBe('erp')
  })

  it('el checkout se niega con un codigo propio, distinto de "no hay"', async () => {
    await svc(`select public.sync_inventory_level($1, $2, null, 8, 'erp-2', null)`, [erp, jabon])
    await makeStale()

    const message = await expectFailure(() =>
      checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 1 }], { email: 'erp@compra.com' }),
    )
    expect(message).toMatch(/DISPONIBILIDAD_DESCONOCIDA/)
  })

  it('pero la vitrina NO se vacia: el producto sigue apareciendo', async () => {
    await svc(`select public.sync_inventory_level($1, $2, null, 8, 'erp-3', null)`, [erp, jabon])
    await makeStale()

    const rows = await asRole(db, 'anon', null, (tx) =>
      tx
        .query(`select in_stock from public.public_products where product_id = $1`, [jabon])
        .then((r) => r.rows as Row[]),
    )
    expect(rows[0]?.in_stock).toBe(true)
  })

  it('con la politica de confiar en la ultima cifra, se sigue vendiendo', async () => {
    await svc(
      `update public.warehouses set stale_policy = 'trust_last_known' where id = $1`,
      [erp],
    )
    await svc(`select public.sync_inventory_level($1, $2, null, 8, 'erp-4', null)`, [erp, jabon])
    await makeStale()

    const result = await atp(storeA, jabon)
    expect(result.unknown).toBe(false)
    expect(Number(result.available)).toBe(8)

    const order = await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 1 }], {
      email: 'confia@compra.com',
    })
    expect(order.order_number).toMatch(/^EC-/)
  })

  it('un almacen local no puede declararse caducable: esta base es su verdad', async () => {
    const message = await expectFailure(() =>
      svc(`update public.warehouses set stale_after = '1 hour' where id = $1`, [lima]),
    )
    expect(message).toMatch(/warehouses_local_never_stale/)
  })
})

describe('transicion desde products.stock', () => {
  it('la carga inicial copia el catalogo al almacen y es idempotente', async () => {
    for (let i = 0; i < 2; i += 1) {
      await asMember(TENANT_A, (tx) =>
        tx
          .query(`select public.seed_inventory_from_catalog($1, $2)`, [lima, storeA])
          .then((r) => r.rows as Row[]),
      )
    }

    expect(Number((await level(lima, jabon)).on_hand)).toBe(100)
    expect(Number((await level(lima, camiseta, camisetaRoja)).on_hand)).toBe(10)

    const [count] = await svc(
      `select count(*)::int as n from public.inventory_movements where reference_kind = 'import'`,
    )
    expect(Number(count?.n)).toBe(2)
  })

  it('cargarla en un SEGUNDO almacen se niega: la existencia de la ficha es una sola', async () => {
    await asMember(TENANT_A, (tx) =>
      tx
        .query(`select public.seed_inventory_from_catalog($1, $2)`, [lima, storeA])
        .then((r) => r.rows as Row[]),
    )
    const message = await expectFailure(() =>
      asMember(TENANT_A, (tx) =>
        tx
          .query(`select public.seed_inventory_from_catalog($1, $2)`, [arequipa, storeA])
          .then((r) => r.rows as Row[]),
      ),
    )
    expect(message).toMatch(/INVENTARIO_YA_MIGRADO/)

    const [count] = await svc(
      `select count(*)::int as n from public.inventory_movements where reference_kind = 'import'`,
    )
    expect(Number(count?.n)).toBe(2)
    expect(Number((await level(lima, jabon)).on_hand)).toBe(100)
  })

  it('la columna del catalogo sigue existiendo y no la toca nadie al vender por almacen', async () => {
    await receive(lima, jabon, 10)
    await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 3 }], { email: 'mixto@compra.com' })

    const [row] = await svc(`select stock from public.products where id = $1`, [jabon])
    expect(Number(row?.stock)).toBe(100)
    expect(Number((await level(lima, jabon)).on_hand)).toBe(7)
  })

  it('sin almacenes activos, el pedido descuenta la columna exactamente como antes', async () => {
    await svc(`update public.warehouses set is_active = false where organization_id = $1`, [
      TENANT_A.organizationId,
    ])
    await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 3 }], { email: 'legacy@compra.com' })

    const [row] = await svc(`select stock from public.products where id = $1`, [jabon])
    expect(Number(row?.stock)).toBe(97)
  })
})

describe('la vitrina publica', () => {
  it('`in_stock` sale del ATP por almacen, no de la columna del catalogo', async () => {
    // El catalogo dice 100; el almacen, cero.
    await receive(lima, jabon, 0 + 1)
    await setStock(lima, jabon, 0)

    const rows = await asRole(db, 'anon', null, (tx) =>
      tx
        .query(`select in_stock from public.public_products where product_id = $1`, [jabon])
        .then((r) => r.rows as Row[]),
    )
    expect(rows[0]?.in_stock).toBe(false)

    await setStock(lima, jabon, 5)
    const after = await asRole(db, 'anon', null, (tx) =>
      tx
        .query(`select in_stock from public.public_products where product_id = $1`, [jabon])
        .then((r) => r.rows as Row[]),
    )
    expect(after[0]?.in_stock).toBe(true)
  })

  it('la puerta anonima responde por cantidad y NO devuelve la cifra', async () => {
    await receive(lima, jabon, 5)

    const rows = await asRole(db, 'anon', null, (tx) =>
      tx
        .query(`select public.availability_for_slug($1, $2::jsonb) as result`, [
          STORE_A_SLUG,
          JSON.stringify([
            { product_id: jabon, quantity: 3 },
            { product_id: jabon, quantity: 9 },
          ]),
        ])
        .then((r) => r.rows as Row[]),
    )

    const result = rows[0]?.result as Array<Record<string, unknown>>
    expect(result[0]?.in_stock).toBe(true)
    expect(result[1]?.in_stock).toBe(false)
    for (const line of result) {
      expect(Object.keys(line)).not.toContain('available')
    }
  })

  it('un producto de otra tienda no revela nada por esa puerta', async () => {
    const rows = await asRole(db, 'anon', null, (tx) =>
      tx
        .query(`select public.availability_for_slug($1, $2::jsonb) as result`, [
          STORE_A_SLUG,
          JSON.stringify([{ product_id: productoB, quantity: 1 }]),
        ])
        .then((r) => r.rows as Row[]),
    )
    const result = rows[0]?.result as Array<Record<string, unknown>>
    expect(result[0]?.in_stock).toBe(false)
    expect(result[0]?.source).toBe('catalog')
  })

  it('anon no puede ejecutar las puertas del backoffice ni las del servidor', async () => {
    const rows = await sql(`
      select p.proname as name, r.rolname as role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon')) as roles(rolname)
      join pg_roles r on r.rolname = roles.rolname
      where n.nspname = 'public'
        and p.proname in ('reserve_inventory', 'reserve_inventory_for_slug',
                          'release_inventory_reservation', 'commit_inventory_reservation',
                          'release_inventory_by_token', 'expire_inventory_reservations',
                          'adjust_inventory', 'set_inventory_policy',
                          'seed_inventory_from_catalog', 'sync_inventory_level',
                          'inventory_availability')
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    `)
    expect(rows).toEqual([])
  })

  it('`authenticated` tampoco alcanza las puertas del servidor', async () => {
    const rows = await sql(`
      select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.rolname = 'authenticated'
      where n.nspname = 'public'
        and p.proname in ('reserve_inventory_for_slug', 'release_inventory_by_token',
                          'expire_inventory_reservations', 'sync_inventory_level',
                          'create_order', 'create_order_for_slug')
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    `)
    expect(rows).toEqual([])
  })
})

describe('alertas', () => {
  it('avisa de lo que esta bajo umbral, en negativo y publicado sin existencia', async () => {
    await receive(lima, jabon, 10)
    await asMember(TENANT_A, (tx) =>
      tx
        .query(`select public.set_inventory_policy($1, $2, null, 0, 12)`, [lima, jabon])
        .then((r) => r.rows as Row[]),
    )

    const rows = await asMember(TENANT_A, (tx) =>
      tx
        .query(`select kind, sku from public.inventory_alerts where store_id = $1 order by kind`, [
          storeA,
        ])
        .then((r) => r.rows as Row[]),
    )

    const kinds = rows.map((r) => String(r.kind))
    expect(kinds).toContain('below_reorder')
    // La camiseta roja esta publicada y no tiene existencia en ningun almacen.
    expect(kinds).toContain('unmapped')
    for (const kind of kinds) expect(ALERT_KINDS).toContain(kind)
  })

  it('el tenant B no ve las alertas del A', async () => {
    await receive(lima, jabon, 1)
    const rows = await asMember(TENANT_B, (tx) =>
      tx.query(`select store_id from public.inventory_alerts`).then((r) => r.rows as Row[]),
    )
    expect(rows.every((r) => r.store_id !== storeA)).toBe(true)
  })
})

describe('el pedido sigue sin aceptar nada del navegador', () => {
  it('un item que declare `warehouse_id` tumba el pedido', async () => {
    await receive(lima, jabon, 10)
    const message = await expectFailure(() =>
      svc(
        `select public.create_order_for_slug($1, $2, $3::jsonb, 'Ana', '+51 999', '{}'::jsonb, null, null)`,
        [
          STORE_A_SLUG,
          'trampa@compra.com',
          JSON.stringify([{ product_id: jabon, quantity: 1, warehouse_id: lima }]),
        ],
      ),
    )
    expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('ni `reservation_id`, ni `level_id`, ni `stock`', async () => {
    for (const key of ['reservation_id', 'level_id', 'stock', 'available']) {
      const message = await expectFailure(() =>
        svc(
          `select public.create_order_for_slug($1, $2, $3::jsonb, 'Ana', '+51 999', '{}'::jsonb, null, null)`,
          [
            STORE_A_SLUG,
            'trampa@compra.com',
            JSON.stringify([{ product_id: jabon, quantity: 1, [key]: 1 }]),
          ],
        ),
      )
      expect(`${key}: ${message}`).toMatch(/CAMPO_NO_PERMITIDO/)
    }
  })
})

/**
 * 2026-11-11 · Cancelar devuelve la existencia (20261111120000).
 *
 * Antes, cancelar dejaba lo vendido descontado para siempre: el inventario
 * se desfasaba hacia abajo con cada anulación.
 */
describe('cancelar un pedido devuelve lo vendido al almacén', () => {
  async function cancel(orderId: unknown) {
    await svc(`update public.orders set status = 'cancelled' where id = $1`, [orderId])
  }

  it('camino de almacén: un asiento `return` por cada salida, y el saldo vuelve', async () => {
    await receive(lima, jabon, 10)
    const order = await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 3 }], { email: 'cancela1@compra.com' })
    expect(Number((await level(lima, jabon)).on_hand)).toBe(7)

    await cancel(order.order_id)

    expect(Number((await level(lima, jabon)).on_hand)).toBe(10)
    const movs = await svc(
      `select kind::text as kind, quantity::float8 as q from public.inventory_movements
        where reference_id = $1 order by created_at`,
      [order.order_id],
    )
    expect(movs.map((m) => `${m.kind}:${m.q}`)).toEqual(['issue:-3', 'return:3'])
    const [o] = await svc(`select stock_restored_at from public.orders where id = $1`, [order.order_id])
    expect(o?.stock_restored_at).not.toBeNull()
  })

  it('un kit devuelve sus componentes, no una existencia propia', async () => {
    await receive(lima, jabon, 10)
    await receive(lima, camiseta, 3, camisetaRoja)
    const order = await checkout(STORE_A_SLUG, [{ product_id: kit, quantity: 1 }], { email: 'cancela2@compra.com' })
    expect(Number((await level(lima, jabon)).on_hand)).toBe(8)
    expect(Number((await level(lima, camiseta, camisetaRoja)).on_hand)).toBe(2)

    await cancel(order.order_id)

    expect(Number((await level(lima, jabon)).on_hand)).toBe(10)
    expect(Number((await level(lima, camiseta, camisetaRoja)).on_hand)).toBe(3)
  })

  it('camino de catálogo (sin almacenes): vuelve a `products.stock`', async () => {
    await svc(`update public.warehouses set is_active = false`)
    const order = await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 4 }], { email: 'cancela3@compra.com' })
    const [antes] = await svc(`select stock from public.products where id = $1`, [jabon])
    expect(Number(antes?.stock)).toBe(96)

    await cancel(order.order_id)

    const [despues] = await svc(`select stock from public.products where id = $1`, [jabon])
    expect(Number(despues?.stock)).toBe(100)
  })

  it('si la entrega ya salió, NO repone: eso entra por Devoluciones', async () => {
    await receive(lima, jabon, 10)
    const order = await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 2 }], { email: 'cancela4@compra.com' })
    await svc(
      `insert into public.fulfillments
         (organization_id, company_id, store_id, order_id, sequence, method_code, method_name, strategy, currency, state)
       select organization_id, company_id, store_id, id, 9, 'delivery', 'Reparto', 'local_delivery', 'PEN', 'in_transit'
         from public.orders where id = $1`,
      [order.order_id],
    )

    await cancel(order.order_id)

    expect(Number((await level(lima, jabon)).on_hand)).toBe(8)
    const [o] = await svc(`select stock_restored_at from public.orders where id = $1`, [order.order_id])
    expect(o?.stock_restored_at).toBeNull()
  })
})

describe('cobrado + servido = entregado (20261111140000)', () => {
  it('cobrar y luego entregar deja el pedido en `fulfilled`', async () => {
    await receive(lima, jabon, 5)
    const order = await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 1 }], { email: 'entrega1@compra.com' })
    await svc(`update public.orders set payment_status = 'paid' where id = $1`, [order.order_id])
    await svc(`update public.orders set fulfillment_status = 'fulfilled' where id = $1`, [order.order_id])
    const [o] = await svc(`select status::text as s from public.orders where id = $1`, [order.order_id])
    expect(o?.s).toBe('fulfilled')
  })

  it('contra entrega: entregar y luego cobrar, también', async () => {
    await receive(lima, jabon, 5)
    const order = await checkout(STORE_A_SLUG, [{ product_id: jabon, quantity: 1 }], { email: 'entrega2@compra.com' })
    await svc(`update public.orders set fulfillment_status = 'fulfilled' where id = $1`, [order.order_id])
    const [antes] = await svc(`select status::text as s from public.orders where id = $1`, [order.order_id])
    expect(antes?.s).toBe('pending')
    await svc(`update public.orders set payment_status = 'paid' where id = $1`, [order.order_id])
    const [o] = await svc(`select status::text as s from public.orders where id = $1`, [order.order_id])
    expect(o?.s).toBe('fulfilled')
  })
})
