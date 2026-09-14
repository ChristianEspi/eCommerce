// @vitest-environment node
/**
 * Cierre P0 · A3 — cotización → pedido, y solicitud de cotización, sobre
 * Postgres real y con el checkout de producción (`runCheckout` + `createDbPorts`).
 *
 * Lo que se vigila:
 *
 *  · aceptar NO crea el pedido: convierte el precio en un acuerdo del motor y
 *    devuelve las líneas. El pedido sale del checkout de siempre, con todas sus
 *    reglas, y aun así cobra el precio cotizado;
 *  · aceptar dos veces es UNA conversión, y el precio sirve a UN pedido;
 *  · el precio de 10 unidades no vale para comprar 3;
 *  · una cotización vencida, ajena, en borrador o en otra moneda falla sin dejar
 *    nada escrito.
 *
 * El tenant tiene `trade.quotes` y NO `pricing.lists`, a propósito: una
 * cotización aceptada no puede quedarse sin aplicar por el módulo de listas.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import { runCheckout } from '../functions/_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'

type Row = Record<string, unknown>

const COMPRADOR = '0a300000-0000-4000-8000-00000000c301'
const LECTOR = '0a300000-0000-4000-8000-00000000c302'
const OTRO_CLIENTE = '0a300000-0000-4000-8000-00000000c303'

let db: PGlite
let storeA = ''
let jabon = ''
let champu = ''
let clienteA = ''
let cuentaA = ''
let clienteOtro = ''

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

async function comoComprador<T = Row>(sub: string, query: string, params: unknown[] = []): Promise<T> {
  const rows = await asRole(db, 'authenticated', shopper(sub), async () =>
    (await db.query<{ r: T }>(query, params)).rows,
  )
  return rows[0]?.r as T
}

function pgCaller(role: 'authenticated' | 'service_role', sub: string | null): RpcCaller {
  return async (fn, args) =>
    asRole(db, role, sub ? shopper(sub) : null, async () => {
      const keys = Object.keys(args)
      const values = keys.map((key) => {
        const value = args[key]
        return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
      })
      const call = keys.map((key, index) => `${key} => $${index + 1}`).join(', ')
      const { rows } = await db.query<{ r: unknown }>(`select public.${fn}(${call}) as r`, values)
      return rows[0]?.r ?? null
    })
}

let n = 0
async function comprar(sub: string, items: Array<{ product_id: string; quantity: number }>) {
  n += 1
  await svc(`delete from public.checkout_attempts`)
  const input = await parseCheckoutBody({
    store_slug: TENANT_A.storeSlug,
    idempotency_key: `a3-cot-${n}-${'q'.repeat(24)}`,
    customer_email: 'compras@empresa.test',
    customer_name: 'Compras Empresa',
    customer_phone: '+51 999 000 555',
    shipping_address: { address: 'Av. Industrial 450', city: 'Lima', country: 'PE' },
    items,
  })
  const result = await runCheckout(
    createDbPorts({
      service: pgCaller('service_role', null),
      caller: pgCaller('authenticated', sub),
      hasSession: true,
    }),
    input,
  )
  const lines = await svc<{ product_id: string; unit_price: string; price_source: string }>(
    `select product_id, unit_price::text, price_source from public.order_items where order_id = $1`,
    [result.order.orderId],
  )
  return { orderId: result.order.orderId, lines }
}

function precioDe(lines: Array<{ product_id: string; unit_price: string }>, productId: string) {
  return lines.find((l) => l.product_id === productId)?.unit_price
}

async function vincular(userId: string, accountId: string, role: 'buyer' | 'viewer') {
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, $6::public.business_role, 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, accountId, userId, `${userId}@compras.test`, role],
  )
}

async function cuentaDe(code: string) {
  const customer = await id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', $3, $3, $4) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code, `${code.toLowerCase()}@cliente.test`],
  )
  const account = await id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, $4, $4) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, customer, code],
  )
  return { customer, account }
}

let cotSeq = 0
/**
 * El vendedor cotiza: borrador con sus líneas y después enviada. Es lo que hace
 * hoy el backoffice, escrito directo contra las tablas.
 */
async function cotizar(opts: {
  customerId?: string
  accountId?: string | null
  validDays?: number
  issuedDaysAgo?: number
  currency?: string
  status?: 'sent' | 'draft'
  lines?: Array<{ product: string; quantity: string; price: string }>
}) {
  cotSeq += 1
  const lines = opts.lines ?? [
    { product: jabon, quantity: '10', price: '7.00' },
    { product: champu, quantity: '5', price: '15.00' },
  ]
  const quote = await id(
    `insert into public.quotes
       (organization_id, company_id, store_id, customer_id, business_account_id,
        quote_number, status, currency, issued_at, valid_until)
     values ($1, $2, $3, $4, $5, $6, 'draft', $7,
             current_date - $8::int, current_date - $8::int + $9::int)
     returning id`,
    [
      TENANT_A.organizationId,
      TENANT_A.companyId,
      storeA,
      opts.customerId ?? clienteA,
      opts.accountId === undefined ? cuentaA : opts.accountId,
      `COT-A3-${cotSeq}`,
      opts.currency ?? 'PEN',
      opts.issuedDaysAgo ?? 0,
      opts.validDays ?? 5,
    ],
  )
  let pos = 0
  for (const line of lines) {
    await svc(
      `insert into public.quote_items
         (organization_id, company_id, quote_id, product_id, quantity, unit_price, line_total, position)
       values ($1, $2, $3, $4, $5::numeric, $6::numeric, round($5::numeric * $6::numeric, 2), $7)`,
      [TENANT_A.organizationId, TENANT_A.companyId, quote, line.product, line.quantity, line.price, pos++],
    )
  }
  if ((opts.status ?? 'sent') === 'sent') {
    await svc(`update public.quotes set status = 'sent' where id = $1`, [quote])
  }
  return quote
}

async function listasDe(quoteId: string) {
  return svc<{ id: string; is_active: boolean }>(
    `select id, is_active from public.price_lists where source_quote_id = $1`,
    [quoteId],
  )
}

async function estadoDe(quoteId: string) {
  const [row] = await svc<{ status: string; order_id: string | null; price_list_id: string | null }>(
    `select status::text, order_id, price_list_id from public.quotes where id = $1`,
    [quoteId],
  )
  return row
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
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    ['ecommerce.inventory.multiwarehouse', 'ecommerce.trade.quotes'],
  ])
  storeA = await id(`update public.stores set status = 'active' where slug = $1 returning id`, [TENANT_A.storeSlug])
  await svc(`update public.store_settings set tax_rate = 0`)
  jabon = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'A3-JABON', 'a3-jabon', 'Jabón', '10.00', 'PEN', 1000, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  champu = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'A3-CHAMPU', 'a3-champu', 'Champú', '20.00', 'PEN', 1000, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(`insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'LIMA', 'Lima')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
  ])
  await asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
    db.query(`select public.seed_inventory_from_catalog((select id from public.warehouses where code = 'LIMA'), $1)`, [
      storeA,
    ]),
  )

  const a = await cuentaDe('CORP-A3')
  clienteA = a.customer
  cuentaA = a.account
  await vincular(COMPRADOR, cuentaA, 'buyer')
  await vincular(LECTOR, cuentaA, 'viewer')

  const otro = await cuentaDe('CORP-OTRO')
  clienteOtro = otro.customer
  await vincular(OTRO_CLIENTE, otro.account, 'buyer')
}, 180_000)

afterAll(async () => {
  await db?.close()
})

/**
 * Cada prueba empieza sin acuerdos de cotización vivos.
 *
 * Una cotización aceptada y no comprada SIGUE aplicando su precio hasta que
 * vence o la usa un pedido: es exactamente lo que tiene que hacer. Por eso una
 * prueba que acepta sin comprar le prestaría su precio a la siguiente, y un
 * fallo así se leería como un bug del motor cuando es una prueba contaminada.
 */
afterEach(async () => {
  await svc(`update public.price_lists set is_active = false where source_quote_id is not null`)
})

describe('aceptar convierte el precio en acuerdo, no crea el pedido', () => {
  it('devuelve las líneas para el carrito y deja la cotización aceptada con su lista', async () => {
    const quote = await cotizar({})
    const pedidosAntes = await svc<{ n: number }>(`select count(*)::int as n from public.orders`)

    const r = await comoComprador<Row>(COMPRADOR, `select public.accept_quote($1) as r`, [quote])

    expect(r.already_accepted).toBe(false)
    expect(r.lines).toEqual([
      { product_id: jabon, variant_id: null, uom_code: null, quantity: 10 },
      { product_id: champu, variant_id: null, uom_code: null, quantity: 5 },
    ])
    expect((await estadoDe(quote))?.status).toBe('accepted')
    expect(await listasDe(quote)).toHaveLength(1)
    // Aceptar no es comprar: ni un pedido nuevo.
    expect(await svc<{ n: number }>(`select count(*)::int as n from public.orders`)).toEqual(pedidosAntes)
  })

  it('aceptar DOS veces es una sola conversión', async () => {
    const quote = await cotizar({})

    await comoComprador(COMPRADOR, `select public.accept_quote($1) as r`, [quote])
    const repetida = await comoComprador<Row>(COMPRADOR, `select public.accept_quote($1) as r`, [quote])

    expect(repetida.already_accepted).toBe(true)
    expect(await listasDe(quote)).toHaveLength(1)
    const eventos = await svc<{ n: number }>(
      `select count(*)::int as n from public.domain_events where event_type = 'quote.accepted' and aggregate_id = $1`,
      [quote],
    )
    expect(eventos[0]?.n).toBe(1)
  })
})

describe('el checkout de siempre cobra el precio cotizado, una vez', () => {
  it('pedido con las cantidades cotizadas: precio de la cotización y vínculo escrito', async () => {
    const quote = await cotizar({})
    await comoComprador(COMPRADOR, `select public.accept_quote($1) as r`, [quote])

    const { orderId, lines } = await comprar(COMPRADOR, [
      { product_id: jabon, quantity: 10 },
      { product_id: champu, quantity: 5 },
    ])

    // Las DOS líneas. Con el enlace cerrando la lista al insertar la primera,
    // la segunda saldría a precio de catálogo: por eso el trigger es diferido.
    expect(precioDe(lines, jabon)).toBe('7.00')
    expect(precioDe(lines, champu)).toBe('15.00')
    expect(lines.every((l) => l.price_source === 'price_list')).toBe(true)

    const estado = await estadoDe(quote)
    expect(estado?.order_id).toBe(orderId)
    expect((await listasDe(quote))[0]?.is_active).toBe(false)
  })

  it('el mismo precio no sirve a un segundo pedido', async () => {
    const quote = await cotizar({ lines: [{ product: jabon, quantity: '10', price: '6.00' }] })
    await comoComprador(COMPRADOR, `select public.accept_quote($1) as r`, [quote])
    const primero = await comprar(COMPRADOR, [{ product_id: jabon, quantity: 10 }])
    expect(precioDe(primero.lines, jabon)).toBe('6.00')

    const segundo = await comprar(COMPRADOR, [{ product_id: jabon, quantity: 10 }])

    expect(precioDe(segundo.lines, jabon)).toBe('10.00')
    expect((await estadoDe(quote))?.order_id).toBe(primero.orderId)
  })

  it('el precio de 10 unidades no vale para comprar 3, y la cotización sigue viva', async () => {
    const quote = await cotizar({ lines: [{ product: champu, quantity: '10', price: '12.00' }] })
    await comoComprador(COMPRADOR, `select public.accept_quote($1) as r`, [quote])

    const { lines } = await comprar(COMPRADOR, [{ product_id: champu, quantity: 3 }])

    expect(precioDe(lines, champu)).toBe('20.00')
    expect((await estadoDe(quote))?.order_id).toBeNull()
    expect((await listasDe(quote))[0]?.is_active).toBe(true)
  })

  it('volver a aceptar una cotización ya convertida falla', async () => {
    const quote = await cotizar({ lines: [{ product: jabon, quantity: '10', price: '5.00' }] })
    await comoComprador(COMPRADOR, `select public.accept_quote($1) as r`, [quote])
    await comprar(COMPRADOR, [{ product_id: jabon, quantity: 10 }])

    const message = await expectFailure(() =>
      comoComprador(COMPRADOR, `select public.accept_quote($1) as r`, [quote]),
    )
    expect(message).toMatch(/COTIZACION_YA_CONVERTIDA/)
  })

  it('un segundo pedido que intente enlazar la misma cotización aborta al confirmar', async () => {
    // El caso de dos checkouts concurrentes, reducido a lo que el trigger ve:
    // una línea de OTRO pedido que llega con el precio de una cotización que ya
    // tiene pedido. Aborta en vez de llevarse el precio dos veces.
    const quote = await cotizar({ lines: [{ product: jabon, quantity: '10', price: '4.00' }] })
    await comoComprador(COMPRADOR, `select public.accept_quote($1) as r`, [quote])
    await comprar(COMPRADOR, [{ product_id: jabon, quantity: 10 }])
    const otro = await comprar(COMPRADOR, [{ product_id: champu, quantity: 1 }])
    const [lista] = await listasDe(quote)

    const message = await expectFailure(() =>
      svc(
        `insert into public.order_items
           (organization_id, company_id, store_id, order_id, product_id, sku, name,
            unit_price, quantity, price_list_id, price_source)
         values ($1, $2, $3, $4, $5, 'A3-JABON', 'Jabón', 4.00, 10, $6, 'price_list')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, otro.orderId, jabon, lista?.id],
      ),
    )
    expect(message).toMatch(/COTIZACION_YA_CONVERTIDA/)
  })
})

describe('lo que no se acepta falla sin dejar nada escrito', () => {
  async function sinEfectos(quote: string, patron: RegExp, sub = COMPRADOR) {
    const antes = await estadoDe(quote)
    const message = await expectFailure(() => comoComprador(sub, `select public.accept_quote($1) as r`, [quote]))
    expect(message).toMatch(patron)
    expect(await estadoDe(quote)).toEqual(antes)
    expect(await listasDe(quote)).toHaveLength(0)
  }

  it('vencida', async () => {
    const quote = await cotizar({ issuedDaysAgo: 10, validDays: 3 })
    await sinEfectos(quote, /COTIZACION_VENCIDA/)
  })

  it('en borrador: el vendedor todavía no la firmó', async () => {
    const quote = await cotizar({ status: 'draft' })
    await sinEfectos(quote, /COTIZACION_NO_ACEPTABLE/)
  })

  it('en otra moneda que la de la tienda', async () => {
    const quote = await cotizar({ currency: 'USD' })
    await sinEfectos(quote, /COTIZACION_MONEDA_INCONSISTENTE/)
  })

  it('con una cantidad que no se puede pedir tal cual', async () => {
    const quote = await cotizar({ lines: [{ product: jabon, quantity: '2.5', price: '7.00' }] })
    await sinEfectos(quote, /COTIZACION_CANTIDAD_NO_ENTERA/)
  })

  it('de otro cliente: responde como si no existiera', async () => {
    const quote = await cotizar({})
    await sinEfectos(quote, /COTIZACION_NO_ENCONTRADA/, OTRO_CLIENTE)
  })

  it('quien solo mira la cuenta no compromete dinero', async () => {
    const quote = await cotizar({})
    // El lector comparte cuenta con el comprador, pero su efectiva es la misma
    // y su rol no alcanza.
    await sinEfectos(quote, /SIN_PERMISO/, LECTOR)
  })

  it('anónimo no puede ni llamar', async () => {
    for (const firma of ['public.accept_quote(uuid)', 'public.request_quote(text, jsonb, text, text)', 'public.my_quotes(text)']) {
      const [row] = await svc<{ p: boolean }>(`select has_function_privilege('anon', $1, 'EXECUTE') as p`, [firma])
      expect([firma, row?.p]).toEqual([firma, false])
    }
  })
})

describe('el comprador ve sus cotizaciones', () => {
  it('las suyas, sin los borradores del vendedor, y las vencidas como vencidas', async () => {
    const vigente = await cotizar({})
    const borrador = await cotizar({ status: 'draft' })
    const vencida = await cotizar({ issuedDaysAgo: 10, validDays: 3 })
    const ajena = await cotizar({ customerId: clienteOtro, accountId: null })

    const mias = await comoComprador<Row[]>(COMPRADOR, `select public.my_quotes($1) as r`, [TENANT_A.storeSlug])
    const porId = new Map(mias.map((q) => [q.quote_id, q]))

    expect(porId.get(vigente)?.status).toBe('sent')
    expect(porId.get(vencida)?.status).toBe('expired')
    expect(porId.has(borrador)).toBe(false)
    expect(porId.has(ajena)).toBe(false)
    expect((porId.get(vigente)?.items as Row[]).length).toBe(2)
  })
})

describe('el comprador pide una cotización', () => {
  it('crea un borrador con precio de referencia del motor, nunca del navegador', async () => {
    const r = await comoComprador<Row>(
      COMPRADOR,
      `select public.request_quote($1, $2::jsonb, $3, $4) as r`,
      [TENANT_A.storeSlug, JSON.stringify([{ product_id: jabon, quantity: 40 }]), 'Pedido trimestral', 'sol-a3-0001'],
    )

    expect(r.already_requested).toBe(false)
    const [quote] = await svc<Row>(
      `select status::text, business_account_id, currency, notes, requested_by from public.quotes where id = $1`,
      [r.quote_id],
    )
    expect(quote).toEqual({
      status: 'draft',
      business_account_id: cuentaA,
      currency: 'PEN',
      notes: 'Pedido trimestral',
      requested_by: COMPRADOR,
    })
    const [item] = await svc<Row>(`select unit_price::text, quantity::text from public.quote_items where quote_id = $1`, [
      r.quote_id,
    ])
    expect(item).toEqual({ unit_price: '10.00', quantity: '40.000' })

    const mias = await comoComprador<Row[]>(COMPRADOR, `select public.my_quotes($1) as r`, [TENANT_A.storeSlug])
    expect(mias.find((q) => q.quote_id === r.quote_id)?.status).toBe('requested')
  })

  it('la misma clave es la misma solicitud', async () => {
    const lineas = JSON.stringify([{ product_id: champu, quantity: 2 }])
    const primera = await comoComprador<Row>(COMPRADOR, `select public.request_quote($1, $2::jsonb, null, $3) as r`, [
      TENANT_A.storeSlug,
      lineas,
      'sol-a3-0002',
    ])
    const repetida = await comoComprador<Row>(COMPRADOR, `select public.request_quote($1, $2::jsonb, null, $3) as r`, [
      TENANT_A.storeSlug,
      lineas,
      'sol-a3-0002',
    ])

    expect(repetida.quote_id).toBe(primera.quote_id)
    expect(repetida.already_requested).toBe(true)
  })

  it('una clave de otra persona no abre su solicitud', async () => {
    await comoComprador(COMPRADOR, `select public.request_quote($1, $2::jsonb, null, $3) as r`, [
      TENANT_A.storeSlug,
      JSON.stringify([{ product_id: champu, quantity: 2 }]),
      'sol-a3-0003',
    ])
    const message = await expectFailure(() =>
      comoComprador(OTRO_CLIENTE, `select public.request_quote($1, $2::jsonb, null, $3) as r`, [
        TENANT_A.storeSlug,
        JSON.stringify([{ product_id: champu, quantity: 2 }]),
        'sol-a3-0003',
      ]),
    )
    expect(message).toMatch(/IDEMPOTENCIA_EN_CONFLICTO/)
  })

  it('un precio dentro de la línea se rechaza, no se ignora', async () => {
    const message = await expectFailure(() =>
      comoComprador(COMPRADOR, `select public.request_quote($1, $2::jsonb, null, $3) as r`, [
        TENANT_A.storeSlug,
        JSON.stringify([{ product_id: jabon, quantity: 1, unit_price: '0.01' }]),
        'sol-a3-0004',
      ]),
    )
    expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('quien solo mira tampoco pide cotizaciones', async () => {
    const message = await expectFailure(() =>
      comoComprador(LECTOR, `select public.request_quote($1, $2::jsonb, null, $3) as r`, [
        TENANT_A.storeSlug,
        JSON.stringify([{ product_id: jabon, quantity: 1 }]),
        'sol-a3-0005',
      ]),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })
})
