// @vitest-environment node
/**
 * Pedido rápido y CSV · el traductor SKU → artículo, contra Postgres REAL.
 *
 * Lo que no puede fallar:
 *
 *  · **traduce, no vende** — devuelve producto y variante, y ni un precio, ni un
 *    coste, ni una existencia; no escribe carritos ni pedidos;
 *  · **la variante gana al producto**, como en `api_order_create`;
 *  · **no hay fuga entre tenants** — el SKU de otra sociedad, o un borrador, se
 *    rechazan igual que un SKU que no existe;
 *  · **el surtido de la cuenta B2B efectiva recorta**, y al consumidor no;
 *  · **el navegador no declara nada** más que `sku` y `quantity`;
 *  · **sin sesión no hay puerta**: el SKU no es público.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

const COMPRADOR_B2B = '0e100000-0000-4000-8000-00000000e001'
const CONSUMIDOR = '0e100000-0000-4000-8000-00000000e002'

let db: PGlite
let storeA = ''
let storeB = ''
let jabon = ''
let camiseta = ''
let camisetaRoja = ''
let gemeloProducto = ''
let gemeloPadre = ''
let gemeloVariante = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function id(query: string, params: unknown[]): Promise<string> {
  const [row] = await svc<{ id: string }>(query, params)
  return String(row?.id)
}

function shopper(sub: string) {
  return { sub, email: `${sub}@compras.test`, org_id: '', companies: [], active_company: '' }
}

interface Resolution {
  lines: Row[]
  accepted: number
  rejected: number
}

async function resolver(sub: string, lines: unknown, slug = TENANT_A.storeSlug): Promise<Resolution> {
  const [row] = await asRole(db, 'authenticated', shopper(sub), async () =>
    (
      await db.query<{ r: Resolution }>(`select public.resolve_order_lines_for_slug($1, $2::jsonb) as r`, [
        slug,
        JSON.stringify(lines),
      ])
    ).rows,
  )
  return row?.r as Resolution
}

async function producto(
  tenant: typeof TENANT_A,
  store: string,
  sku: string,
  options: { kind?: string; status?: string; publishedAt?: string | null } = {},
): Promise<string> {
  const { kind = 'simple', status = 'published', publishedAt = 'now' } = options
  return id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at, kind)
     values ($1, $2, $3, $4, lower($4), $4, '10.00', 'PEN', 100, $5::public.product_status,
             case when $6::text is null then null
                  when $6::text = 'now' then now()
                  else $6::timestamptz end,
             $7::public.product_kind)
     returning id`,
    [tenant.organizationId, tenant.companyId, store, sku, status, publishedAt, kind],
  )
}

async function variante(productId: string, sku: string, active = true): Promise<string> {
  return id(
    `insert into public.product_variants
       (organization_id, company_id, store_id, product_id, sku, name, price, stock, is_active, is_default)
     values ($1, $2, $3, $4, $5, $5, null, 10, $6, false) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, productId, sku, active],
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
  storeA = await id(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug])
  storeB = await id(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug])

  jabon = await producto(TENANT_A, storeA, 'QO-JABON')
  camiseta = await producto(TENANT_A, storeA, 'QO-CAMISETA', { kind: 'variant' })
  camisetaRoja = await variante(camiseta, 'QO-CAM-ROJA')
  await variante(camiseta, 'QO-CAM-VERDE', false)
  await producto(TENANT_A, storeA, 'QO-BORRADOR', { status: 'draft', publishedAt: null })
  await producto(TENANT_A, storeA, 'QO-FUTURO', { publishedAt: '2099-01-01T00:00:00Z' })
  await producto(TENANT_B, storeB, 'QO-LAMPARA')

  // «La variante gana al producto». El trigger `assert_sku_unique_in_store`
  // impide hoy que un SKU sea a la vez de un producto y de una variante; se
  // apaga SOLO para sembrar el caso, porque la regla de precedencia tiene que
  // aguantar datos anteriores al trigger o cargados por fuera de él.
  gemeloProducto = await producto(TENANT_A, storeA, 'QO-GEMELO')
  gemeloPadre = await producto(TENANT_A, storeA, 'QO-GEMELO-PADRE', { kind: 'variant' })
  await db.exec(`set session_replication_role = replica`)
  try {
    gemeloVariante = await variante(gemeloPadre, 'QO-GEMELO')
  } finally {
    await db.exec(`set session_replication_role = origin`)
  }

  // Cuenta B2B con surtido de lista blanca que SOLO contiene el jabón, y el
  // módulo de surtidos contratado.
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    ['ecommerce.trade.assortments'],
  ])
  const cliente = await id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', 'QO-CLIENTE', 'QO Cliente', 'qo@cliente.test') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  const cuenta = await id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, 'QO', 'QO Cuenta') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, cliente],
  )
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, 'b2b@compras.test', 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, cuenta, COMPRADOR_B2B],
  )
  const surtido = await id(
    `insert into public.assortments (organization_id, company_id, store_id, code, name, is_allow_list)
     values ($1, $2, $3, 'QO-BLANCA', 'QO Blanca', true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(
    `insert into public.assortment_items (organization_id, company_id, assortment_id, product_id)
     values ($1, $2, $3, $4)`,
    [TENANT_A.organizationId, TENANT_A.companyId, surtido, jabon],
  )
  await svc(
    `insert into public.assortment_assignments (organization_id, company_id, store_id, assortment_id, scope, customer_id)
     values ($1, $2, $3, $4, 'customer', $5)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, surtido, cliente],
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.public_rate_events`)
  await svc(`update public.store_settings set config = config - 'rate_limits'`)
})

describe('traduce SKU a artículo', () => {
  it('resuelve el SKU de un producto simple, sin distinguir mayúsculas ni espacios', async () => {
    const r = await resolver(CONSUMIDOR, [{ sku: '  qo-jabon ', quantity: 3 }])
    expect(r).toMatchObject({ accepted: 1, rejected: 0 })
    expect(r.lines[0]).toEqual({
      row: 1,
      sku: 'qo-jabon',
      status: 'ok',
      product_id: jabon,
      variant_id: null,
      slug: 'qo-jabon',
      name: 'QO-JABON',
      variant_name: null,
      quantity: 3,
    })
  })

  it('resuelve el SKU de una variante con su producto padre', async () => {
    const r = await resolver(CONSUMIDOR, [{ sku: 'QO-CAM-ROJA', quantity: '2' }])
    expect(r.lines[0]).toMatchObject({
      status: 'ok',
      product_id: camiseta,
      variant_id: camisetaRoja,
      variant_name: 'QO-CAM-ROJA',
      quantity: 2,
    })
  })

  it('la variante gana al producto cuando los dos comparten SKU', async () => {
    const r = await resolver(CONSUMIDOR, [{ sku: 'QO-GEMELO', quantity: 1 }])
    expect(r.lines[0]).toMatchObject({ status: 'ok', product_id: gemeloPadre, variant_id: gemeloVariante })
    expect(r.lines[0]?.product_id).not.toBe(gemeloProducto)
  })

  it('el SKU del padre de un producto con variantes pide elegir variante', async () => {
    const r = await resolver(CONSUMIDOR, [{ sku: 'QO-CAMISETA', quantity: 1 }])
    expect(r.lines[0]).toEqual({ row: 1, sku: 'QO-CAMISETA', status: 'rejected', reason: 'VARIANTE_REQUERIDA' })
  })

  it('una variante retirada no está disponible', async () => {
    const r = await resolver(CONSUMIDOR, [{ sku: 'QO-CAM-VERDE', quantity: 1 }])
    expect(r.lines[0]).toMatchObject({ status: 'rejected', reason: 'NO_DISPONIBLE' })
  })
})

describe('sin fuga: lo que no se ve en la vitrina «no existe»', () => {
  it('un SKU inventado se rechaza como no encontrado', async () => {
    const r = await resolver(CONSUMIDOR, [{ sku: 'NO-EXISTE', quantity: 1 }])
    expect(r.lines[0]).toEqual({ row: 1, sku: 'NO-EXISTE', status: 'rejected', reason: 'SKU_NO_ENCONTRADO' })
  })

  it('un borrador y una publicación futura responden igual que un SKU que no existe', async () => {
    const r = await resolver(CONSUMIDOR, [
      { sku: 'QO-BORRADOR', quantity: 1 },
      { sku: 'QO-FUTURO', quantity: 1 },
    ])
    expect(r.lines.map((l) => l.reason)).toEqual(['SKU_NO_ENCONTRADO', 'SKU_NO_ENCONTRADO'])
    for (const line of r.lines) expect(Object.keys(line).sort()).toEqual(['reason', 'row', 'sku', 'status'])
  })

  it('el SKU de OTRA sociedad no se resuelve en esta tienda, y sí en la suya', async () => {
    const enA = await resolver(CONSUMIDOR, [{ sku: 'QO-LAMPARA', quantity: 1 }])
    expect(enA.lines[0]).toMatchObject({ status: 'rejected', reason: 'SKU_NO_ENCONTRADO' })

    const enB = await resolver(CONSUMIDOR, [{ sku: 'QO-JABON', quantity: 1 }], TENANT_B.storeSlug)
    expect(enB.lines[0]).toMatchObject({ status: 'rejected', reason: 'SKU_NO_ENCONTRADO' })

    const propio = await resolver(CONSUMIDOR, [{ sku: 'QO-LAMPARA', quantity: 1 }], TENANT_B.storeSlug)
    expect(propio.lines[0]).toMatchObject({ status: 'ok' })
  })
})

describe('surtido de la cuenta B2B efectiva', () => {
  it('a la cuenta con lista blanca le recorta lo que no está en ella', async () => {
    const r = await resolver(COMPRADOR_B2B, [
      { sku: 'QO-JABON', quantity: 1 },
      { sku: 'QO-CAM-ROJA', quantity: 1 },
    ])
    expect(r.lines.map((l) => l.status)).toEqual(['ok', 'rejected'])
    expect(r.lines[1]).toMatchObject({ reason: 'FUERA_DE_SURTIDO' })
  })

  it('al consumidor, sin cuenta, no se le aplica surtido', async () => {
    const r = await resolver(CONSUMIDOR, [{ sku: 'QO-CAM-ROJA', quantity: 1 }])
    expect(r.lines[0]).toMatchObject({ status: 'ok' })
  })

  it('sin el módulo contratado, el surtido no recorta', async () => {
    await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
      TENANT_A.organizationId,
      TENANT_A.companyId,
      [],
    ])
    try {
      const r = await resolver(COMPRADOR_B2B, [{ sku: 'QO-CAM-ROJA', quantity: 1 }])
      expect(r.lines[0]).toMatchObject({ status: 'ok' })
    } finally {
      await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
        TENANT_A.organizationId,
        TENANT_A.companyId,
        ['ecommerce.trade.assortments'],
      ])
    }
  })
})

describe('filas inválidas', () => {
  it('cantidades que no son un entero positivo dentro del tope', async () => {
    const r = await resolver(CONSUMIDOR, [
      { sku: 'QO-JABON', quantity: 0 },
      { sku: 'QO-CAM-ROJA', quantity: -1 },
      { sku: 'QO-GEMELO', quantity: 1.5 },
      { sku: 'QO-A', quantity: 'abc' },
      { sku: 'QO-B', quantity: 10001 },
      { sku: 'QO-C' },
    ])
    expect(r.lines.map((l) => l.reason)).toEqual(Array(6).fill('CANTIDAD_INVALIDA'))
    expect(r).toMatchObject({ accepted: 0, rejected: 6 })
  })

  it('una fila sin SKU', async () => {
    const r = await resolver(CONSUMIDOR, [{ sku: '   ', quantity: 1 }, { quantity: 1 }])
    expect(r.lines).toEqual([
      { row: 1, sku: null, status: 'rejected', reason: 'SKU_REQUERIDO' },
      { row: 2, sku: null, status: 'rejected', reason: 'SKU_REQUERIDO' },
    ])
  })

  it('un SKU repetido se rechaza en TODAS sus apariciones, y el resto sigue', async () => {
    const r = await resolver(CONSUMIDOR, [
      { sku: 'QO-JABON', quantity: 5 },
      { sku: 'QO-CAM-ROJA', quantity: 1 },
      { sku: 'qo-jabon ', quantity: 3 },
    ])
    expect(r.lines.map((l) => [l.row, l.status, l.reason ?? null])).toEqual([
      [1, 'rejected', 'SKU_DUPLICADO'],
      [2, 'ok', null],
      [3, 'rejected', 'SKU_DUPLICADO'],
    ])
  })

  it('una lista vacía devuelve cero filas', async () => {
    expect(await resolver(CONSUMIDOR, [])).toEqual({ lines: [], accepted: 0, rejected: 0 })
  })
})

describe('lo que el navegador no puede declarar', () => {
  it.each([
    [{ sku: 'QO-JABON', quantity: 1, price: '0.01' }],
    [{ sku: 'QO-JABON', quantity: 1, organization_id: TENANT_B.organizationId }],
    [{ sku: 'QO-JABON', quantity: 1, product_id: '0e100000-0000-4000-8000-0000000000ff' }],
    [{ sku: 'QO-JABON', quantity: 1, account_id: '0e100000-0000-4000-8000-0000000000ff' }],
  ])('rechaza claves desconocidas: %j', async (line) => {
    const message = await expectFailure(() => resolver(CONSUMIDOR, [line]))
    expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('rechaza lo que no es una lista de objetos', async () => {
    expect(await expectFailure(() => resolver(CONSUMIDOR, { sku: 'QO-JABON' }))).toMatch(/LINEAS_INVALIDAS/)
    expect(await expectFailure(() => resolver(CONSUMIDOR, ['QO-JABON']))).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('más de 100 líneas se rechazan enteras', async () => {
    const lines = Array.from({ length: 101 }, (_, i) => ({ sku: `QO-${i}`, quantity: 1 }))
    expect(await expectFailure(() => resolver(CONSUMIDOR, lines))).toMatch(/LINEAS_EXCESIVAS/)
  })

  it('solo recibe el slug y las líneas', async () => {
    const rows = await svc<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'resolve_order_lines_for_slug'`,
    )
    expect(rows).toEqual([{ args: 'p_store_slug text, p_lines jsonb' }])
  })
})

describe('nunca precio, coste ni existencia', () => {
  it('ninguna fila, aceptada o rechazada, lleva una clave de importe o de stock', async () => {
    const r = await resolver(COMPRADOR_B2B, [
      { sku: 'QO-JABON', quantity: 1 },
      { sku: 'QO-CAM-ROJA', quantity: 1 },
      { sku: 'NO-EXISTE', quantity: 1 },
    ])
    const claves = new Set([...Object.keys(r), ...r.lines.flatMap((l) => Object.keys(l))])
    for (const prohibida of ['price', 'unit_price', 'compare_at_price', 'cost', 'currency', 'stock', 'in_stock', 'available', 'quantity_available']) {
      expect(claves.has(prohibida), prohibida).toBe(false)
    }
    expect(Object.keys(r.lines[0] ?? {}).sort()).toEqual(
      ['name', 'product_id', 'quantity', 'row', 'sku', 'slug', 'status', 'variant_id', 'variant_name'].sort(),
    )
  })

  it('no escribe carritos ni pedidos', async () => {
    const antes = await svc<{ carts: number; orders: number }>(
      `select (select count(*)::int from public.carts) as carts, (select count(*)::int from public.orders) as orders`,
    )
    await resolver(CONSUMIDOR, [{ sku: 'QO-JABON', quantity: 1 }])
    const despues = await svc<{ carts: number; orders: number }>(
      `select (select count(*)::int from public.carts) as carts, (select count(*)::int from public.orders) as orders`,
    )
    expect(despues).toEqual(antes)
  })
})

describe('la puerta', () => {
  it('`anon` no la ejecuta', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, async () =>
        (await db.query(`select public.resolve_order_lines_for_slug('tienda-a', '[{"sku":"QO-JABON","quantity":1}]'::jsonb)`)).rows,
      ),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('`authenticated` sin `sub` en el JWT no pasa', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', null, async () =>
        (await db.query(`select public.resolve_order_lines_for_slug('tienda-a', '[]'::jsonb)`)).rows,
      ),
    )
    expect(message).toMatch(/NO_AUTENTICADO/)
  })

  it('una tienda inexistente o inactiva no responde nada', async () => {
    expect(await expectFailure(() => resolver(CONSUMIDOR, [], 'no-existe'))).toMatch(/TIENDA_NO_DISPONIBLE/)
  })

  it('los SKU no encontrados gastan el techo por tienda; pasado, se corta', async () => {
    await svc(
      `update public.store_settings
          set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('rate_limits', jsonb_build_object('quick_order.sku_probe', 2))
        where store_id = $1`,
      [storeA],
    )
    // Lo ENCONTRADO no gasta: una hoja legítima no se come el techo.
    await resolver(CONSUMIDOR, [{ sku: 'QO-JABON', quantity: 1 }])
    await resolver(CONSUMIDOR, [{ sku: 'QO-JABON', quantity: 1 }])
    await resolver(CONSUMIDOR, [{ sku: 'QO-JABON', quantity: 1 }])

    const r = await resolver(CONSUMIDOR, [
      { sku: 'NO-1', quantity: 1 },
      { sku: 'NO-2', quantity: 1 },
    ])
    expect(r.rejected).toBe(2)

    expect(await expectFailure(() => resolver(CONSUMIDOR, [{ sku: 'QO-JABON', quantity: 1 }]))).toMatch(
      /LIMITE_DE_TASA/,
    )
    // Y es por TIENDA: la otra no lo nota.
    const otra = await resolver(CONSUMIDOR, [{ sku: 'QO-LAMPARA', quantity: 1 }], TENANT_B.storeSlug)
    expect(otra.accepted).toBe(1)
  })
})
