// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
  TENANT_A,
  TENANT_B,
} from './harness'

/**
 * Sugerido v2 (`history_seasonal_v2`), contra Postgres real (cierre · item 11).
 *
 * Lo que tiene que ser cierto, y por eso se prueba aquí y no en pantalla:
 *
 *  · la cifra se EXPLICA: cada línea trae su motivo en castellano y los números
 *    con los que se calculó (ventanas, ritmos, factor de temporada, ATP);
 *  · no propone lo que no se puede vender: despublicado, fuera del surtido del
 *    cliente — ni siquiera cuando cae al modelo simple;
 *  · la temporada solo se aplica con un año de datos: sin ellos, factor 1;
 *  · el ATP recorta lo que se sabe y marca lo que falta, sin inventar ceros;
 *  · si v2 no tiene líneas, responde v1 marcado `historic_v1`;
 *  · la autorización es la de v1: security invoker, `anon` fuera, RLS manda.
 */

let db: PGlite
let STORE = ''
let CANAL = ''
let seq = 0

type Row = Record<string, unknown>

async function svc(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

async function comoDueno(tenant: typeof TENANT_A, query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'authenticated', claimsFor(tenant), async () => (await db.query<Row>(query, params)).rows)
}

async function producto(sku: string, opts: { stock?: number; status?: string } = {}): Promise<string> {
  const status = opts.status ?? 'published'
  const rows = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $4, '10.00', 'PEN', $5, $6::public.product_status,
             case when $6 = 'published' then now() else null end)
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, STORE, sku, opts.stock ?? 100, status],
  )
  return rows[0]?.id as string
}

async function cliente(code: string): Promise<{ customer: string; account: string }> {
  const c = await svc(
    `insert into public.customers (organization_id, company_id, kind, code, name)
     values ($1, $2, 'company', $3, $3) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code],
  )
  const a = await svc(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, customer_kind, code, name)
     values ($1, $2, $3, 'company', $4, $4) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, c[0]?.id, code],
  )
  return { customer: c[0]?.id as string, account: a[0]?.id as string }
}

/** Un pedido de la cuenta hace `diasAtras` días, con una línea. */
async function pedido(account: string, product: string, qty: number, diasAtras: number) {
  seq += 1
  const o = await svc(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, currency,
        subtotal, tax_total, grand_total, customer_email, channel_id, business_account_id, created_at)
     values ($1, $2, $3, $4, 'paid', 'PEN', 100, 18, 118, 'cliente@test.com', $5, $6,
             now() - make_interval(days => $7))
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, STORE, `EC-V2-${seq}`, CANAL, account, diasAtras],
  )
  await svc(
    `insert into public.order_items
       (organization_id, company_id, store_id, order_id, product_id, sku, name, quantity, unit_price)
     values ($1, $2, $3, $4, $5, 'SKU', 'Producto', $6, '10.00')`,
    [TENANT_A.organizationId, TENANT_A.companyId, STORE, o[0]?.id, product, qty],
  )
}

async function sugerir(customer: string, days = 30, tenant = TENANT_A): Promise<Row[]> {
  return comoDueno(tenant, `select * from public.suggest_order_v2($1, $2, $3)`, [STORE, customer, days])
}

function lineaDe(filas: Row[], product: string): Row {
  const fila = filas.find((f) => f.product_id === product)
  if (!fila) throw new Error(`No hay línea para ${product}`)
  return fila
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    TENANT_A.slug,
    TENANT_A.slug,
    TENANT_A.adminEmail,
    TENANT_A.ownerId,
    TENANT_A.storeSlug,
  ])
  await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
    TENANT_B.organizationId,
    TENANT_B.companyId,
    TENANT_B.slug,
    TENANT_B.slug,
    TENANT_B.adminEmail,
    TENANT_B.ownerId,
    TENANT_B.storeSlug,
  ])
  const tienda = await svc(`select id from public.stores where organization_id = $1`, [TENANT_A.organizationId])
  STORE = tienda[0]?.id as string
  const canal = await svc(`select id from public.channels where store_id = $1 and is_default`, [STORE])
  CANAL = canal[0]?.id as string
}, 240_000)

afterAll(async () => {
  await db?.close()
})
describe('la cifra se explica', () => {
  it('solo historial reciente: propone lo comprado y dice con qué se calculó', async () => {
    const { customer, account } = await cliente('V2-BASE')
    const p = await producto('V2-BASE-1')
    await pedido(account, p, 7, 5)
    await pedido(account, p, 4, 12)

    const l = lineaDe(await sugerir(customer), p)

    expect(l.model_code).toBe('history_seasonal_v2')
    expect(Number(l.suggested_quantity)).toBe(11)
    expect(Number(l.last_period_quantity)).toBe(11)
    expect(Number(l.on_hand_quantity)).toBe(100)
    expect(String(l.reason)).toContain('Compró 11 en los últimos 30 días')
    expect(l.inputs).toMatchObject({
      model: 'history_seasonal_v2',
      fallback: false,
      windows: { recent_days: 30, long_days: 90 },
      quantities: { recent: 11, long: 11 },
      blend: { recent: 1, long: 0 },
      seasonal: { applied: false, factor: 1, reason: 'menos_de_un_anio' },
      demand: 11,
      atp: { state: 'known', available: 100, source: 'catalog' },
      capped: false,
      shortage: false,
    })
  })

  it('con compras antes de la ventana reciente, mezcla 60/40 y lo dice', async () => {
    const { customer, account } = await cliente('V2-MEZCLA')
    const p = await producto('V2-MEZCLA-1')
    await pedido(account, p, 10, 5)
    await pedido(account, p, 20, 60)

    const l = lineaDe(await sugerir(customer), p)

    // 0,6 × 10/30 + 0,4 × 30/90 = 0,3333/día → 10 en 30 días.
    expect(Number(l.suggested_quantity)).toBe(10)
    expect(String(l.reason)).toContain('Compró 10 en los últimos 30 días y 30 en los últimos 90')
    expect(l.inputs).toMatchObject({ blend: { recent: 0.6, long: 0.4 }, quantities: { recent: 10, long: 30 } })
  })

  it('las cantidades son enteras, como exige el pipeline de pedidos', async () => {
    const { customer, account } = await cliente('V2-ENTERO')
    const p = await producto('V2-ENTERO-1')
    await pedido(account, p, 5, 3)
    await pedido(account, p, 3, 70)

    const l = lineaDe(await sugerir(customer), p)
    expect(Number.isInteger(Number(l.suggested_quantity))).toBe(true)
  })

  it('una ventana fuera de rango se rechaza con código, no con un cálculo raro', async () => {
    const { customer } = await cliente('V2-RANGO')
    const message = await expectFailure(() => sugerir(customer, 3))
    expect(message).toMatch(/CAMPO_INVALIDO/)
  })
})

describe('no propone lo que no se puede vender', () => {
  it('deja fuera lo despublicado o archivado', async () => {
    const { customer, account } = await cliente('V2-PUB')
    const vivo = await producto('V2-PUB-VIVO')
    const borrador = await producto('V2-PUB-DRAFT', { status: 'draft' })
    const archivado = await producto('V2-PUB-ARCH', { status: 'archived' })
    for (const p of [vivo, borrador, archivado]) await pedido(account, p, 6, 4)

    const filas = await sugerir(customer)
    expect(filas.map((f) => f.product_id)).toEqual([vivo])
  })

  it('respeta el surtido del cliente: fuera de la lista blanca no se sugiere', async () => {
    const { customer, account } = await cliente('V2-SURT')
    const dentro = await producto('V2-SURT-IN')
    const fuera = await producto('V2-SURT-OUT')
    await pedido(account, dentro, 5, 4)
    await pedido(account, fuera, 9, 4)

    const s = await svc(
      `insert into public.assortments (organization_id, company_id, store_id, code, name, is_allow_list)
       values ($1, $2, $3, 'SURT-V2', 'Surtido v2', true) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, STORE],
    )
    await svc(
      `insert into public.assortment_items (organization_id, company_id, assortment_id, product_id)
       values ($1, $2, $3, $4)`,
      [TENANT_A.organizationId, TENANT_A.companyId, s[0]?.id, dentro],
    )
    await svc(
      `insert into public.assortment_assignments
         (organization_id, company_id, store_id, assortment_id, scope, customer_id)
       values ($1, $2, $3, $4, 'customer', $5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, STORE, s[0]?.id, customer],
    )

    const filas = await sugerir(customer)
    expect(filas.map((f) => f.product_id)).toEqual([dentro])
    expect((filas[0]?.inputs as Row).assortment_id).toBe(s[0]?.id)
  })
})

describe('la disponibilidad (ATP)', () => {
  it('recorta a lo disponible y lo dice', async () => {
    const { customer, account } = await cliente('V2-ATP')
    const p = await producto('V2-ATP-1', { stock: 3 })
    await pedido(account, p, 11, 6)

    const l = lineaDe(await sugerir(customer), p)
    expect(Number(l.suggested_quantity)).toBe(3)
    expect(Number(l.on_hand_quantity)).toBe(3)
    expect(String(l.reason)).toContain('Limitado a 3 disponibles')
    expect(l.inputs).toMatchObject({ demand: 11, capped: true, shortage: false })
  })

  it('sin existencia la línea sale con cero y marcada, para que se vea qué falta', async () => {
    const { customer, account } = await cliente('V2-SIN')
    const p = await producto('V2-SIN-1', { stock: 0 })
    await pedido(account, p, 4, 6)

    const l = lineaDe(await sugerir(customer), p)
    expect(Number(l.suggested_quantity)).toBe(0)
    expect(String(l.reason)).toContain('Sin disponibilidad')
    expect(l.inputs).toMatchObject({ demand: 4, capped: true, shortage: true })
  })

  it('la puerta del ATP no le da a otro tenant ni un número', async () => {
    const p = await producto('V2-ATP-AJENO')
    const filas = await comoDueno(TENANT_B, `select ebim.suggest_order_atp($1, $2, null) as atp`, [STORE, p])
    expect(filas[0]?.atp).toBeNull()
  })
})
describe('la temporada, solo con datos', () => {
  it('con un año de historial y un pico en estas fechas, sube el sugerido (acotado a 2×)', async () => {
    const { customer, account } = await cliente('V2-TEMP')
    const p = await producto('V2-TEMP-1')
    await pedido(account, p, 5, 380) // primera compra: hace más de un año
    await pedido(account, p, 40, 350) // la misma ventana de 30 días, hace un año
    await pedido(account, p, 5, 200)
    await pedido(account, p, 10, 20)

    const l = lineaDe(await sugerir(customer), p)

    // Ritmo base 10/30; la ventana de hace un año (40 en 30 días) frente al
    // promedio anual (55/365) da 8,8 — acotado a 2.
    expect(Number(l.suggested_quantity)).toBe(20)
    expect(l.inputs).toMatchObject({
      seasonal: { applied: true, factor: 2, reason: 'historial_anual' },
      quantities: { same_window_last_year: 40, last_365_days: 55 },
    })
    expect(String(l.reason)).toContain('Temporada')
  })

  it('sin un año de historial no hay factor, aunque haya muchos pedidos', async () => {
    const { customer, account } = await cliente('V2-NUEVO')
    const p = await producto('V2-NUEVO-1')
    for (const dias of [300, 200, 100, 10]) await pedido(account, p, 5, dias)

    const l = lineaDe(await sugerir(customer), p)
    expect(l.inputs).toMatchObject({ seasonal: { applied: false, factor: 1, reason: 'menos_de_un_anio' } })
    expect(String(l.reason)).not.toContain('Temporada')
  })

  it('con un año pero pocos pedidos, tampoco', async () => {
    const { customer, account } = await cliente('V2-POCOS')
    const p = await producto('V2-POCOS-1')
    await pedido(account, p, 5, 400)
    await pedido(account, p, 5, 10)

    const l = lineaDe(await sugerir(customer), p)
    expect(l.inputs).toMatchObject({ seasonal: { applied: false, reason: 'pocos_pedidos' } })
  })
})

describe('el fallback a v1', () => {
  it('si v2 no deja ninguna línea, responde v1 marcado historic_v1 y lo dice', async () => {
    const { customer, account } = await cliente('V2-FALL')
    const p = await producto('V2-FALL-1')
    // Temporada baja con datos (factor 0,5) sobre un ritmo mezclado < 1: la
    // demanda v2 redondea a cero, pero v1 ve 1 unidad en los últimos 30 días.
    await pedido(account, p, 1, 400)
    await pedido(account, p, 50, 300)
    await pedido(account, p, 50, 200)
    await pedido(account, p, 1, 60)
    await pedido(account, p, 1, 10)

    const filas = await sugerir(customer)
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ product_id: p, model_code: 'historic_v1' })
    expect(Number(filas[0]?.suggested_quantity)).toBe(1)
    expect(filas[0]?.inputs).toMatchObject({ model: 'historic_v1', fallback: true, fallback_reason: 'v2_sin_lineas' })
    expect(String(filas[0]?.reason)).toContain('Modelo simple')
  })

  it('el fallback tampoco propone lo que no se puede vender', async () => {
    const { customer, account } = await cliente('V2-FALL-DRAFT')
    const borrador = await producto('V2-FALL-DRAFT-1', { status: 'draft' })
    await pedido(account, borrador, 8, 5)

    // v1 lo propondría; v2 no, y su fallback aplica las mismas reglas.
    const v1 = await comoDueno(TENANT_A, `select * from public.suggest_order($1, $2, 30)`, [STORE, customer])
    expect(v1).toHaveLength(1)
    expect(await sugerir(customer)).toEqual([])
  })
})

describe('la autorización es la de v1', () => {
  it('otro tenant no ve el historial ajeno: ni error ni filas', async () => {
    const { customer, account } = await cliente('V2-AJENO')
    const p = await producto('V2-AJENO-1')
    await pedido(account, p, 12, 5)

    expect(await sugerir(customer, 30, TENANT_B)).toEqual([])
  })

  it('anon no puede ejecutarla', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () => db.query(`select * from public.suggest_order_v2($1, $2, 30)`, [STORE, STORE])),
    )
    expect(message).toContain('permission denied')
  })

  it('las dos puertas tienen el mismo perfil: invoker, authenticated sí, anon no', async () => {
    const perfiles = await svc(
      `select p.proname as name, p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('suggest_order', 'suggest_order_v2')
        order by p.proname`,
    )
    expect(perfiles).toEqual([
      { name: 'suggest_order', definer: false, anon: false, auth: true },
      { name: 'suggest_order_v2', definer: false, anon: false, auth: true },
    ])
  })
})