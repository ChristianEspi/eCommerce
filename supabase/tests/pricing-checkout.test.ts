// @vitest-environment node
/**
 * P04-SaaS · El motor de precios visto desde los tres sitios que lo usan.
 *
 * La propiedad que se defiende aqui es una sola y es la que decide si el motor
 * sirve para algo: **lo que la vitrina muestra, lo que el carrito cotiza y lo
 * que el pedido cobra son el mismo numero**, porque salen de la misma funcion.
 * Tres implementaciones que "deberian coincidir" son tres implementaciones que
 * un dia no coinciden, y el dia que no coinciden lo descubre un comprador.
 *
 * Se comprueba ademas lo que el navegador NO puede hacer: declarar un precio,
 * declarar una lista, declararse cliente de un acuerdo ajeno o pedir por un
 * canal que no es el suyo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite

const COMPRADOR_ACTIVO = 'aa000000-0000-4000-8000-0000000000b1'
const COMPRADOR_INVITADO = 'aa000000-0000-4000-8000-0000000000b2'
const COMPRADOR_REVOCADO = 'aa000000-0000-4000-8000-0000000000b3'
const FORASTERO = 'aa000000-0000-4000-8000-0000000000b9'

const STORE_A_SLUG = 'tienda-a'
const STORE_B_SLUG = 'tienda-b'
const PRICING = 'ecommerce.pricing.lists'
const CUSTOMER_X = '0a000000-0000-4000-8000-0000000000f1'

let storeA: string
let channelB2c: string
let jabon: string
let camiseta: string
let camisetaRoja: string
let camisetaAzul: string
let uomUnit: string
let uomBox: string
let segmentoMayorista: string
let clienteAcme: string
let cuentaAcme: string

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

interface ItemInput {
  product_id: string
  quantity: number
  variant_id?: string
  uom_code?: string
}

async function checkout(items: ItemInput[], email = 'ana@compradora.com'): Promise<Row> {
  const rows = await svc(
    `select public.create_order_for_slug(
        $1, $2, $3::jsonb, 'Ana Compradora', '+51 999 111 222',
        '{"address": "Av. Primavera 120"}'::jsonb, null) as result`,
    [STORE_A_SLUG, email, JSON.stringify(items)],
  )
  return rows[0]?.result as Row
}

async function quotePublic(items: ItemInput[], slug = STORE_A_SLUG): Promise<Row> {
  const rows = await asRole(db, 'anon', null, () =>
    sql(`select public.price_quote_for_slug($1, $2::jsonb) as result`, [
      slug,
      JSON.stringify(items),
    ]),
  )
  return rows[0]?.result as Row
}

/**
 * La MISMA llamada publica, pero firmada por alguien.
 *
 * Se le pasa solo el `sub`: es lo unico que la vitrina puede aportar y lo unico
 * que `ebim.pricing_actor` mira. Que el segmento no viaje por ningun lado es la
 * propiedad, no un detalle de la fixtura.
 */
async function quoteConSesion(userId: string, items: ItemInput[]): Promise<Row> {
  const rows = await asRole(db, 'authenticated', { sub: userId } as never, () =>
    sql(`select public.price_quote_for_slug($1, $2::jsonb) as result`, [
      STORE_A_SLUG,
      JSON.stringify(items),
    ]),
  )
  return rows[0]?.result as Row
}

/** El unitario de la primera linea, en texto: el centimo importa. */
function unitario(quote: Row): string {
  return String((((quote.lines as Row[]) ?? [])[0] ?? {}).unit_price)
}

async function createList(input: {
  code: string
  currency?: string
  priority?: number
  scope: 'store' | 'channel' | 'segment' | 'customer'
  target?: string | null
}): Promise<string> {
  const listId = await id(
    `insert into public.price_lists
       (organization_id, company_id, store_id, code, name, currency, priority, valid_from)
     values ($1, $2, $3, $4, $4, $5, $6, now() - interval '1 day')
     returning id`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, storeA, input.code,
      input.currency ?? 'PEN', input.priority ?? 0,
    ],
  )
  await svc(
    `insert into public.price_list_assignments
       (organization_id, company_id, store_id, price_list_id, scope, channel_id, segment_id, customer_id)
     values ($1, $2, $3, $4, $5::public.price_scope, $6, $7, $8)`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, storeA, listId, input.scope,
      input.scope === 'channel' ? input.target : null,
      input.scope === 'segment' ? input.target : null,
      input.scope === 'customer' ? input.target : null,
    ],
  )
  return listId
}

async function addItem(input: {
  list: string
  product: string
  variant?: string | null
  uom?: string | null
  minQuantity?: number
  price: string
  compareAt?: string | null
}): Promise<void> {
  await svc(
    `insert into public.price_list_items
       (organization_id, company_id, store_id, price_list_id, product_id,
        variant_id, uom_id, min_quantity, unit_price, compare_at_price)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, storeA, input.list, input.product,
      input.variant ?? null, input.uom ?? null, input.minQuantity ?? 1,
      input.price, input.compareAt ?? null,
    ],
  )
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
  }
  await svc(`update public.stores set status = 'active'`)
  await svc(`update public.store_settings set tax_rate = 0`)
  await svc(
    `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
    [TENANT_A.organizationId, TENANT_A.companyId, [PRICING]],
  )

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === STORE_A_SLUG)?.id)

  const channels = await svc(`select id from public.channels where store_id = $1`, [storeA])
  channelB2c = String(channels[0]?.id)

  const insertProduct = `
    insert into public.products
      (organization_id, company_id, store_id, sku, slug, name, price, compare_at_price,
       currency, stock, status, published_at, kind)
    values ($1, $2, $3, $4, $5, $6, $7, $8, 'PEN', $9, $10, $11, $12::public.product_kind)
    returning id`

  jabon = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-JABON', 'jabon', 'Jabón',
    '10.00', '12.00', 1000, 'published', new Date().toISOString(), 'simple',
  ])
  camiseta = await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-CAMISETA', 'camiseta', 'Camiseta',
    '60.00', null, 0, 'published', new Date().toISOString(), 'variant',
  ])
  await id(insertProduct, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, 'A-BORRADOR', 'borrador', 'Borrador',
    '30.00', null, 5, 'draft', null, 'simple',
  ])

  const insertVariant = `
    insert into public.product_variants
      (organization_id, company_id, store_id, product_id, sku, name, price, stock, is_active, is_default)
    values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9) returning id`

  camisetaRoja = await id(insertVariant, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, camiseta, 'A-CAM-ROJA', 'Roja',
    null, 500, true,
  ])
  camisetaAzul = await id(insertVariant, [
    TENANT_A.organizationId, TENANT_A.companyId, storeA, camiseta, 'A-CAM-AZUL', 'Azul',
    '69.90', 500, false,
  ])

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
       (organization_id, company_id, store_id, product_id, uom_id, factor, is_base, is_sellable, price)
     values ($1, $2, $3, $4, $5, 1,  true,  true, null),
            ($1, $2, $3, $4, $6, 12, false, true, '100.00')`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, jabon, uomUnit, uomBox],
  )

  segmentoMayorista = await id(
    `insert into public.customer_segments (organization_id, company_id, code, name)
     values ($1, $2, 'mayorista', 'Mayorista') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )

  // Un cliente del segmento mayorista, su cuenta corporativa y tres personas:
  // una activa, una invitada y una revocada. Las tres hacen falta — el precio
  // del acuerdo NO puede depender de haber sido invitado ni sobrevivir a que te
  // echen.
  clienteAcme = await id(
    `insert into public.customers
       (organization_id, company_id, kind, code, name, email, segment_id)
     values ($1, $2, 'company', 'CLI-ACME', 'Acme', 'compras@acme.test', $3) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, segmentoMayorista],
  )
  cuentaAcme = await id(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, 'ACME', 'Acme') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, clienteAcme],
  )
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, 'compras@acme.test',  'buyer',  'active'),
            ($1, $2, $3, $5, 'nuevo@acme.test',    'buyer',  'invited'),
            ($1, $2, $3, $6, 'exempleado@acme.test','buyer', 'revoked')`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, cuentaAcme,
      COMPRADOR_ACTIVO, COMPRADOR_INVITADO, COMPRADOR_REVOCADO,
    ],
  )
}, 180_000)

beforeEach(async () => {
  await svc(`delete from public.checkout_attempts`)
  await svc(`delete from public.price_list_items`)
  await svc(`delete from public.price_list_assignments`)
  await svc(`delete from public.price_lists`)
  await svc(`update public.products set stock = 1000 where id = $1`, [jabon])
  await svc(`update public.product_variants set stock = 500`)
})

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('create_order pide el precio al motor', () => {
  it('sin listas cobra exactamente lo de siempre y lo marca como catalogo', async () => {
    const result = await checkout([{ product_id: jabon, quantity: 3 }])
    expect(result.subtotal).toBe('30.00')

    const [line] = await svc(
      `select unit_price::text as unit_price, price_source, price_list_id
         from public.order_items where order_id = $1`,
      [result.order_id],
    )
    expect(line).toEqual({
      unit_price: '10.00',
      price_source: 'catalog',
      price_list_id: null,
    })
  })

  it('con una lista de tienda cobra el precio de la lista', async () => {
    const lista = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: lista, product: jabon, price: '8.00' })

    const result = await checkout([{ product_id: jabon, quantity: 3 }])
    expect(result.subtotal).toBe('24.00')

    const [line] = await svc(
      `select price_source, price_list_id from public.order_items where order_id = $1`,
      [result.order_id],
    )
    expect(line).toEqual({ price_source: 'price_list', price_list_id: lista })
  })

  it('el precio del canal por defecto gana al de la tienda', async () => {
    const tienda = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: tienda, product: jabon, price: '8.00' })
    const canal = await createList({ code: 'canal', scope: 'channel', target: channelB2c })
    await addItem({ list: canal, product: jabon, price: '7.50' })

    const result = await checkout([{ product_id: jabon, quantity: 2 }])
    expect(result.subtotal).toBe('15.00')
  })

  it('un precio de segmento NO se aplica a un comprador anonimo', async () => {
    const tienda = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: tienda, product: jabon, price: '8.00' })
    const segmento = await createList({
      code: 'mayorista', scope: 'segment', target: segmentoMayorista,
    })
    await addItem({ list: segmento, product: jabon, price: '5.00' })

    const result = await checkout([{ product_id: jabon, quantity: 1 }])
    expect(result.subtotal).toBe('8.00')
  })

  it('la escala por volumen se aplica al pedido', async () => {
    const lista = await createList({ code: 'escalas', scope: 'store' })
    await addItem({ list: lista, product: jabon, minQuantity: 1, price: '10.00' })
    await addItem({ list: lista, product: jabon, minQuantity: 100, price: '7.00' })

    const result = await checkout([{ product_id: jabon, quantity: 120 }])
    expect(result.subtotal).toBe('840.00')
  })

  it('la presentacion usa el precio de lista por su factor, y descuenta bien', async () => {
    const lista = await createList({ code: 'caja', scope: 'store' })
    await addItem({ list: lista, product: jabon, price: '8.00' })

    const result = await checkout([{ product_id: jabon, quantity: 2, uom_code: 'CAJA' }])
    // 8.00 la unidad x 12 = 96.00 la caja, x 2 cajas.
    expect(result.subtotal).toBe('192.00')

    const [row] = await svc(`select stock from public.products where id = $1`, [jabon])
    expect(Number(row?.stock)).toBe(1000 - 24)
  })

  it('un precio absoluto de la caja manda sobre el de la unidad', async () => {
    const lista = await createList({ code: 'caja-abs', scope: 'store' })
    await addItem({ list: lista, product: jabon, price: '8.00' })
    await addItem({ list: lista, product: jabon, uom: uomBox, price: '85.00' })

    const result = await checkout([{ product_id: jabon, quantity: 1, uom_code: 'CAJA' }])
    expect(result.subtotal).toBe('85.00')
  })

  it('una variante se cobra al precio de lista de SU variante', async () => {
    const lista = await createList({ code: 'variantes', scope: 'store' })
    await addItem({ list: lista, product: camiseta, price: '50.00' })
    await addItem({ list: lista, product: camiseta, variant: camisetaRoja, price: '42.00' })

    const roja = await checkout([
      { product_id: camiseta, quantity: 1, variant_id: camisetaRoja },
    ])
    expect(roja.subtotal).toBe('42.00')

    const azul = await checkout(
      [{ product_id: camiseta, quantity: 1, variant_id: camisetaAzul }],
      'otra@compradora.com',
    )
    expect(azul.subtotal).toBe('50.00')
  })

  it('el payload no puede declarar la lista de precio', async () => {
    const message = await expectFailure(() =>
      svc(
        `select public.create_order_for_slug($1, 'ana@compradora.com', $2::jsonb)`,
        [
          STORE_A_SLUG,
          JSON.stringify([{ product_id: jabon, quantity: 1, price_list_id: jabon }]),
        ],
      ),
    )
    expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('tampoco puede declararse cliente ni segmento de un acuerdo ajeno', async () => {
    for (const campo of ['customer_id', 'segment_id', 'price_source']) {
      const message = await expectFailure(() =>
        svc(
          `select public.create_order_for_slug($1, 'ana@compradora.com', $2::jsonb)`,
          [
            STORE_A_SLUG,
            JSON.stringify([{ product_id: jabon, quantity: 1, [campo]: CUSTOMER_X }]),
          ],
        ),
      )
      expect(`${campo}: ${message}`).toMatch(/CAMPO_NO_PERMITIDO/)
    }
  })

  it('el impuesto se calcula sobre el precio resuelto, no sobre el de catalogo', async () => {
    await svc(`update public.store_settings set tax_rate = 0.18 where store_id = $1`, [storeA])
    try {
      const lista = await createList({ code: 'con-igv', scope: 'store' })
      await addItem({ list: lista, product: jabon, price: '8.00' })

      const result = await checkout([{ product_id: jabon, quantity: 10 }])
      expect(result.subtotal).toBe('80.00')
      expect(result.tax_total).toBe('14.40')
      expect(result.grand_total).toBe('94.40')
    } finally {
      await svc(`update public.store_settings set tax_rate = 0 where store_id = $1`, [storeA])
    }
  })
})

// ---------------------------------------------------------------------------

describe('cotizacion del carrito publico', () => {
  it('devuelve el desglose explicable de cada linea', async () => {
    const lista = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: lista, product: jabon, price: '8.00', compareAt: '11.00' })

    const quote = await quotePublic([{ product_id: jabon, quantity: 3 }])
    const lines = quote.lines as Row[]

    expect(lines.length).toBe(1)
    expect(lines[0]).toMatchObject({
      product_id: jabon,
      name: 'Jabón',
      unit_price: '8.00',
      compare_at_price: '11.00',
      net_amount: '24.00',
      source: 'price_list',
      price_list_code: 'general',
      scope: 'store',
    })
    expect(quote.subtotal).toBe('24.00')
    expect(quote.grand_total).toBe('24.00')
    expect(quote.currency).toBe('PEN')
  })

  it('cotiza exactamente lo que despues cobra el pedido', async () => {
    await svc(`update public.store_settings set tax_rate = 0.18 where store_id = $1`, [storeA])
    try {
      const lista = await createList({ code: 'escalas', scope: 'store' })
      await addItem({ list: lista, product: jabon, minQuantity: 1, price: '9.90' })
      await addItem({ list: lista, product: jabon, minQuantity: 50, price: '7.35' })
      await addItem({ list: lista, product: camiseta, variant: camisetaAzul, price: '55.00' })

      const items: ItemInput[] = [
        { product_id: jabon, quantity: 60 },
        { product_id: camiseta, quantity: 2, variant_id: camisetaAzul },
      ]

      const quote = await quotePublic(items)
      const order = await checkout(items)

      expect(quote.subtotal).toBe(order.subtotal)
      expect(quote.tax_total).toBe(order.tax_total)
      expect(quote.grand_total).toBe(order.grand_total)
    } finally {
      await svc(`update public.store_settings set tax_rate = 0 where store_id = $1`, [storeA])
    }
  })

  it('sin listas cotiza el precio de catalogo y lo dice', async () => {
    const quote = await quotePublic([{ product_id: jabon, quantity: 2 }])
    const lines = quote.lines as Row[]
    expect(lines[0]).toMatchObject({
      unit_price: '10.00',
      compare_at_price: '12.00',
      source: 'catalog',
      price_list_code: null,
    })
  })

  it('agrupa la misma linea repetida en vez de cobrarla dos veces', async () => {
    const quote = await quotePublic([
      { product_id: jabon, quantity: 2 },
      { product_id: jabon, quantity: 3 },
    ])
    const lines = quote.lines as Row[]
    expect(lines.length).toBe(1)
    expect(lines[0]?.net_amount).toBe('50.00')
  })

  it('un precio de segmento no se filtra a la vitrina anonima', async () => {
    const segmento = await createList({
      code: 'mayorista', scope: 'segment', target: segmentoMayorista,
    })
    await addItem({ list: segmento, product: jabon, price: '4.00' })

    const quote = await quotePublic([{ product_id: jabon, quantity: 1 }])
    expect((quote.lines as Row[])[0]?.unit_price).toBe('10.00')
  })

  it('el navegador no puede declarar un precio en la cotizacion', async () => {
    const message = await expectFailure(() =>
      quotePublic([{ product_id: jabon, quantity: 1, unit_price: '0.01' } as unknown as ItemInput]),
    )
    expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('tampoco puede declarar canal, segmento ni cliente', async () => {
    for (const campo of ['channel_id', 'segment_id', 'customer_id', 'price_list_id']) {
      const message = await expectFailure(() =>
        quotePublic([
          { product_id: jabon, quantity: 1, [campo]: CUSTOMER_X } as unknown as ItemInput,
        ]),
      )
      expect(`${campo}: ${message}`).toMatch(/CAMPO_NO_PERMITIDO/)
    }
  })

  it('un producto no publicado no se cotiza', async () => {
    const [row] = await svc(`select id from public.products where sku = 'A-BORRADOR'`)
    const message = await expectFailure(() =>
      quotePublic([{ product_id: String(row?.id), quantity: 1 }]),
    )
    expect(message).toMatch(/PRODUCTO_NO_DISPONIBLE/)
  })

  it('una tienda que no existe no cotiza', async () => {
    const message = await expectFailure(() =>
      quotePublic([{ product_id: jabon, quantity: 1 }], 'tienda-inventada'),
    )
    expect(message).toMatch(/TIENDA_NO_DISPONIBLE/)
  })

  it('el maestro de variantes no se cotiza sin decir cual', async () => {
    const message = await expectFailure(() => quotePublic([{ product_id: camiseta, quantity: 1 }]))
    expect(message).toMatch(/VARIANTE_REQUERIDA/)
  })

  it('cotizar no mueve una sola unidad de existencia', async () => {
    const [before] = await svc(`select stock from public.products where id = $1`, [jabon])
    await quotePublic([{ product_id: jabon, quantity: 5 }])
    const [after] = await svc(`select stock from public.products where id = $1`, [jabon])
    expect(after?.stock).toBe(before?.stock)
  })
})

// ---------------------------------------------------------------------------

describe('simulador del backoffice', () => {
  it('un miembro simula el precio de un segmento sin ser ese cliente', async () => {
    const segmento = await createList({
      code: 'mayorista', scope: 'segment', target: segmentoMayorista,
    })
    await addItem({ list: segmento, product: jabon, price: '5.00' })

    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.price_quote($1, $2::jsonb, null, $3, null, null) as result`, [
        storeA,
        JSON.stringify([{ product_id: jabon, quantity: 1 }]),
        segmentoMayorista,
      ]),
    )
    const quote = rows[0]?.result as Row
    expect((quote.lines as Row[])[0]).toMatchObject({
      unit_price: '5.00',
      scope: 'segment',
      price_list_code: 'mayorista',
    })
  })

  it('sin segmento devuelve el precio del canal por defecto', async () => {
    const segmento = await createList({
      code: 'mayorista', scope: 'segment', target: segmentoMayorista,
    })
    await addItem({ list: segmento, product: jabon, price: '5.00' })

    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.price_quote($1, $2::jsonb) as result`, [
        storeA,
        JSON.stringify([{ product_id: jabon, quantity: 1 }]),
      ]),
    )
    const quote = rows[0]?.result as Row
    expect((quote.lines as Row[])[0]?.unit_price).toBe('10.00')
  })

  it('simula tambien lo que todavia no esta publicado', async () => {
    const [borrador] = await svc(`select id from public.products where sku = 'A-BORRADOR'`)
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.price_quote($1, $2::jsonb) as result`, [
        storeA,
        JSON.stringify([{ product_id: String(borrador?.id), quantity: 1 }]),
      ]),
    )
    const quote = rows[0]?.result as Row
    expect((quote.lines as Row[])[0]?.unit_price).toBe('30.00')
  })

  it('un miembro de otro tenant no puede simular en esta tienda', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
        sql(`select public.price_quote($1, $2::jsonb) as result`, [
          storeA,
          JSON.stringify([{ product_id: jabon, quantity: 1 }]),
        ]),
      ),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('anon no puede ejecutar el simulador', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () =>
        sql(`select public.price_quote($1, $2::jsonb) as result`, [
          storeA,
          JSON.stringify([{ product_id: jabon, quantity: 1 }]),
        ]),
      ),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('un segmento de otra sociedad no se puede simular', async () => {
    const ajeno = await id(
      `insert into public.customer_segments (organization_id, company_id, code, name)
       values ($1, $2, 'ajeno', 'Ajeno') returning id`,
      [TENANT_B.organizationId, TENANT_B.companyId],
    )
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`select public.price_quote($1, $2::jsonb, null, $3, null, null) as result`, [
          storeA,
          JSON.stringify([{ product_id: jabon, quantity: 1 }]),
          ajeno,
        ]),
      ),
    )
    expect(message).toMatch(/SEGMENTO_NO_ENCONTRADO/)
  })
})

// ---------------------------------------------------------------------------

describe('la vitrina publica muestra el precio resuelto', () => {
  async function publicProduct(slug: string): Promise<Row> {
    const rows = await asRole(db, 'anon', null, () =>
      sql(
        `select price::text as price, compare_at_price::text as compare_at_price,
                price_from::text as price_from
           from public.public_products where slug = $1`,
        [slug],
      ),
    )
    return (rows[0] ?? {}) as Row
  }

  it('sin listas, el catalogo publico no cambia', async () => {
    expect(await publicProduct('jabon')).toEqual({
      price: '10.00',
      compare_at_price: '12.00',
      price_from: '10.00',
    })
  })

  it('con lista de tienda, la tarjeta ensena el precio de la lista', async () => {
    const lista = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: lista, product: jabon, price: '8.00', compareAt: '11.00' })

    expect(await publicProduct('jabon')).toEqual({
      price: '8.00',
      compare_at_price: '11.00',
      price_from: '8.00',
    })
  })

  it('el tachado del catalogo no se arrastra cuando manda la lista', async () => {
    const lista = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: lista, product: jabon, price: '8.00' })

    expect((await publicProduct('jabon')).compare_at_price).toBeNull()
  })

  it('el precio del canal publico gana al de la tienda tambien en la vitrina', async () => {
    const tienda = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: tienda, product: jabon, price: '8.00' })
    const canal = await createList({ code: 'canal', scope: 'channel', target: channelB2c })
    await addItem({ list: canal, product: jabon, price: '7.50' })

    expect((await publicProduct('jabon')).price).toBe('7.50')
  })

  it('un precio de segmento NO llega nunca a la vitrina', async () => {
    const segmento = await createList({
      code: 'mayorista', scope: 'segment', target: segmentoMayorista,
    })
    await addItem({ list: segmento, product: jabon, price: '4.00' })

    expect((await publicProduct('jabon')).price).toBe('10.00')
  })

  it('el "desde" del maestro sale del precio resuelto de sus variantes', async () => {
    const lista = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: lista, product: camiseta, variant: camisetaAzul, price: '39.00' })

    expect((await publicProduct('camiseta')).price_from).toBe('39.00')
  })

  it('la ficha de variante ensena el precio resuelto de cada una', async () => {
    const lista = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: lista, product: camiseta, variant: camisetaAzul, price: '39.00' })

    const rows = await asRole(db, 'anon', null, () =>
      sql(
        `select name, price::text as price from public.public_product_variants
          where product_id = $1 order by name`,
        [camiseta],
      ),
    )
    expect(rows).toEqual([
      { name: 'Azul', price: '39.00' },
      { name: 'Roja', price: '60.00' },
    ])
  })

  it('una escala de volumen no baja el precio de la tarjeta', async () => {
    const lista = await createList({ code: 'escalas', scope: 'store' })
    await addItem({ list: lista, product: jabon, minQuantity: 100, price: '7.00' })

    // La tarjeta ensena lo que cuesta UNA unidad, no la escala mayorista.
    expect((await publicProduct('jabon')).price).toBe('10.00')
  })

  it('la vitrina no revela CON QUE acuerdo se calculo el precio', async () => {
    const columns = await svc(`
      select column_name
      from information_schema.columns
      where table_schema = 'ebim' and table_name = 'public_unit_prices'
      order by column_name
    `)
    // Cinco columnas y ni una mas: ni el id ni el codigo de la lista. Que una
    // tienda tenga un acuerdo llamado "mayorista" es informacion comercial de
    // la sociedad, no del catalogo.
    expect(columns.map((c) => c.column_name)).toEqual([
      'compare_at_price',
      'product_id',
      'store_id',
      'unit_price',
      'variant_id',
    ])
  })

  it('anon sigue sin poder leer una sola lista de precio', async () => {
    const lista = await createList({ code: 'general', scope: 'store' })
    await addItem({ list: lista, product: jabon, price: '8.00' })

    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () => sql(`select * from public.price_lists`)),
    )
    expect(message).toMatch(/permission denied/i)
    expect(lista).toBeTruthy()
  })
})

/**
 * P19 · El precio del acuerdo llega a la vitrina.
 *
 * Habia cuatro listas, 1682 precios y siete cuentas con su segmento bien puesto,
 * y el comprador con sesion veia el precio de catalogo: TODA ruta publica
 * cotizaba con segmento y cliente nulos. El motor nunca estuvo roto — no se le
 * decia a quien le estaba cotizando.
 *
 * Lo que estos tests defienden no es solo que el precio baje. Es que baje SOLO
 * para quien tiene derecho: la identidad sale del JWT y la funcion publica no
 * tiene ni un parametro donde escribir otra.
 */
describe('el precio del acuerdo llega a quien lo firmo', () => {
  beforeEach(async () => {
    const lista = await createList({ code: 'mayorista', scope: 'segment', target: segmentoMayorista })
    await addItem({ list: lista, product: jabon, price: '7.00' })
  })

  it('el visitante anonimo ve el precio de catalogo', async () => {
    const quote = await quotePublic([{ product_id: jabon, quantity: 1 }])
    expect(unitario(quote)).toBe('10.00')
  })

  it('el comprador de la empresa ve el suyo, sin declararlo en ningun sitio', async () => {
    const quote = await quoteConSesion(COMPRADOR_ACTIVO, [{ product_id: jabon, quantity: 1 }])
    expect(unitario(quote)).toBe('7.00')
  })

  it('invitado todavia no es cliente: sigue viendo el de catalogo', async () => {
    const quote = await quoteConSesion(COMPRADOR_INVITADO, [{ product_id: jabon, quantity: 1 }])
    expect(unitario(quote)).toBe('10.00')
  })

  it('revocado deja de serlo el mismo dia', async () => {
    const quote = await quoteConSesion(COMPRADOR_REVOCADO, [{ product_id: jabon, quantity: 1 }])
    expect(unitario(quote)).toBe('10.00')
  })

  it('un usuario sin vinculo no hereda el precio de nadie', async () => {
    const quote = await quoteConSesion(FORASTERO, [{ product_id: jabon, quantity: 1 }])
    expect(unitario(quote)).toBe('10.00')
  })

  /**
   * La propiedad estructural, y la razon por la que esto no se puede falsificar:
   * la funcion publica recibe DOS argumentos —tienda e items— y ninguno es una
   * identidad. No hay que confiar en que nadie valide un parametro porque no hay
   * parametro. Si manana alguien anade uno, este test lo para.
   */
  it('la funcion publica no tiene donde recibir una identidad', async () => {
    const [row] = await svc(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'price_quote_for_slug'`,
    )
    expect(String(row?.args)).toBe('p_store_slug text, p_items jsonb')
  })

  /**
   * Y lo que de verdad se factura.
   *
   * `create_order` ya resolvia la ficha del cliente desde la cuenta y aun asi
   * pedia el precio con `null, null`. Enseñar convenio y cobrar catalogo es la
   * peor clase de fallo, porque se descubre en la factura.
   */
  it('el pedido cobra el precio del acuerdo, no el de catalogo', async () => {
    const rows = await svc(
      `select public.create_order(
          $1, 'compras@acme.test', $2::jsonb, 'Acme', '+51 999 111 222',
          '{"address": "Av. Primavera 120"}'::jsonb, null, null,
          'storefront', $3) as result`,
      [storeA, JSON.stringify([{ product_id: jabon, quantity: 1 }]), cuentaAcme],
    )
    const pedido = rows[0]?.result as Row
    const lineas = (pedido.items ?? pedido.lines) as Row[]
    expect(String(lineas[0]?.unit_price)).toBe('7.00')
  })

  it('sin cuenta corporativa, el mismo pedido cobra el de catalogo', async () => {
    const pedido = await checkout([{ product_id: jabon, quantity: 1 }])
    const lineas = (pedido.items ?? pedido.lines) as Row[]
    expect(String(lineas[0]?.unit_price)).toBe('10.00')
  })
})
