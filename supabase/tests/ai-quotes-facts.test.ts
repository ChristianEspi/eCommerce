// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * Cotizaciones y surtidos con IA sobre Postgres real (fase 07):
 * `ai_quote_resolve`, `quote_draft_preview`, `quote_create_from_draft` y
 * `ai_assortment_facts`.
 *
 * Lo que tiene que cumplirse:
 *  1. Texto → entidades REALES; con duda, candidatos y nunca una elección.
 *  2. El precio lo pone el motor (`price_quote`): el navegador no manda
 *     importes y el guardado vuelve a preciar.
 *  3. Surtido autorizado, publicación y variante se respetan; lo bloqueado
 *     no se guarda.
 *  4. Roles de `quotes` + `trade.quotes`; cartera del vendedor; A nunca ve a B.
 *  5. Sugerencias solo sobre productos publicados, autorizados y sin rotura.
 */

let db: PGlite
let STORE = ''
let STORE_B = ''
let CLIENTE = ''
let CLIENTE_2 = ''
let CLIENTE_SURTIDO = ''
let CLIENTE_B = ''
let REP = ''
let PARACETAMOL = ''
let PARACETAMOL_1G = ''
let IBUPROFENO = ''
let VITAMINA = ''
let JARABE = ''
let AGOTADO = ''
let CAMISETA = ''
let CAMISETA_ROJA = ''
let BORRADOR = ''
let PRODUCTO_B = ''
let seq = 0

const VIEWER = '0a000000-0000-4000-8000-00000000f701'
const SALES_REP = '0a000000-0000-4000-8000-00000000f702'
const ORDERS = '0a000000-0000-4000-8000-00000000f703'
const CATALOG = '0a000000-0000-4000-8000-00000000f704'

type Json = Record<string, unknown>

async function svc<T = Json>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

async function como<T>(claims: ReturnType<typeof claimsFor>, query: string, params: unknown[] = []) {
  return asRole(db, 'authenticated', claims, async () => {
    const rows = await svc<{ r: T }>(query, params)
    return rows[0]!.r
  })
}

const dueno = () => claimsFor(TENANT_A)
const conRol = (userId: string) => ({ ...claimsFor(TENANT_A), sub: userId })

async function contratar(tenant: typeof TENANT_A, capability: string, activo = true) {
  await svc(
    `insert into public.tenant_entitlements
       (organization_id, company_id, entitlement_code, is_active, source)
     values ($1, $2, $3, $4, 'hub')
     on conflict (organization_id, company_id, entitlement_code) do update set is_active = $4`,
    [tenant.organizationId, tenant.companyId, `ecommerce.${capability}`, activo],
  )
}

async function nuevoProducto(
  sku: string,
  name: string,
  opts: { stock?: number; kind?: string; status?: string; tenant?: typeof TENANT_A; store?: string; price?: string } = {},
) {
  const tenant = opts.tenant ?? TENANT_A
  const status = opts.status ?? 'published'
  const rows = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at, kind)
     values ($1, $2, $3, $4, lower($4), $5, $6, 'PEN', $7, $8::public.product_status,
             case when $8 = 'published' then now() end, $9::public.product_kind)
     returning id`,
    [tenant.organizationId, tenant.companyId, opts.store ?? STORE, sku, name, opts.price ?? '10.00', opts.stock ?? 50, status, opts.kind ?? 'simple'],
  )
  return rows[0]!.id
}

async function nuevoCliente(code: string, name: string, email: string, tenant = TENANT_A) {
  const rows = await svc<{ id: string }>(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', $3, $4, $5) returning id`,
    [tenant.organizationId, tenant.companyId, code, name, email],
  )
  return rows[0]!.id
}

async function pedido(email: string, diasAtras: number, items: { product: string; qty: number }[]) {
  seq += 1
  const o = await svc<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, fulfillment_status, currency,
        subtotal, tax_total, grand_total, customer_email, channel_id, placed_at, created_at)
     values ($1, $2, $3, $4, 'fulfilled', 'paid', 'fulfilled', 'PEN', 10, 0, 10, $5,
             (select c.id from public.channels c where c.store_id = $3 and c.is_default),
             now() - make_interval(days => $6), now() - make_interval(days => $6))
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, STORE, `AI7-${seq}`, email, diasAtras],
  )
  for (const it of items) {
    await svc(
      `insert into public.order_items
         (organization_id, company_id, store_id, order_id, product_id, sku, name, quantity, unit_price)
       values ($1, $2, $3, $4, $5, 'SKU', 'Producto', $6, '10.00')`,
      [TENANT_A.organizationId, TENANT_A.companyId, STORE, o[0]!.id, it.product, it.qty],
    )
  }
}

const resolver = (
  claims: ReturnType<typeof claimsFor>,
  args: { customer?: string | null; query?: string | null; lines?: unknown[] },
  store = STORE,
) =>
  como<Json | null>(claims, `select public.ai_quote_resolve($1, $2, $3, $4::jsonb) as r`, [
    store,
    args.customer ?? null,
    args.query ?? null,
    JSON.stringify(args.lines ?? []),
  ])

const preview = (claims: ReturnType<typeof claimsFor>, customer: string, lines: unknown[], store = STORE) =>
  como<Json | null>(claims, `select public.quote_draft_preview($1, $2, $3::jsonb) as r`, [store, customer, JSON.stringify(lines)])

const crear = (
  claims: ReturnType<typeof claimsFor>,
  customer: string,
  lines: unknown[],
  opts: { number?: string; validUntil?: string; key?: string | null } = {},
) =>
  como<Json>(
    claims,
    `select public.quote_create_from_draft($1, $2, $3, $4::date, 'Entrega en almacén', $5::jsonb, $6) as r`,
    [STORE, customer, opts.number ?? `COT-${++seq}`, opts.validUntil ?? new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10), JSON.stringify(lines), opts.key ?? null],
  )

const surtido = (claims: ReturnType<typeof claimsFor>, customer: string, store = STORE) =>
  como<Json | null>(claims, `select public.ai_assortment_facts($1, $2) as r`, [store, customer])

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      tenant.slug,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
    ])
    await contratar(tenant, 'trade.quotes')
    await contratar(tenant, 'trade.assortments')
    await contratar(tenant, 'sales.force')
  }
  STORE = (await svc<{ id: string }>(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]!.id
  STORE_B = (await svc<{ id: string }>(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug]))[0]!.id

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer'),
            ($1, $2, $4, 'vendedor@tenant-a.com', 'sales_rep'),
            ($1, $2, $5, 'pedidos@tenant-a.com', 'orders'),
            ($1, $2, $6, 'catalogo@tenant-a.com', 'catalog')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VIEWER, SALES_REP, ORDERS, CATALOG],
  )

  const cat = (
    await svc<{ id: string }>(
      `insert into public.categories (organization_id, company_id, store_id, slug, name)
       values ($1, $2, $3, 'analgesicos', 'Analgésicos') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, STORE],
    )
  )[0]!.id

  PARACETAMOL = await nuevoProducto('PARA-500', 'Paracetamol 500 mg caja')
  PARACETAMOL_1G = await nuevoProducto('PARA-1G', 'Paracetamol 1 g caja')
  IBUPROFENO = await nuevoProducto('IBU-400', 'Ibuprofeno 400 mg')
  VITAMINA = await nuevoProducto('VIT-C', 'Vitamina C efervescente')
  JARABE = await nuevoProducto('JAR-TOS', 'Jarabe para la tos')
  AGOTADO = await nuevoProducto('GEL-FRIO', 'Gel frío analgésico', { stock: 0 })
  BORRADOR = await nuevoProducto('NUEVO-X', 'Paracetamol infantil', { status: 'draft' })
  CAMISETA = await nuevoProducto('CAM-01', 'Camiseta promocional', { kind: 'variant' })
  CAMISETA_ROJA = (
    await svc<{ id: string }>(
      `insert into public.product_variants
         (organization_id, company_id, store_id, product_id, sku, name, price, stock, is_active, is_default)
       values ($1, $2, $3, $4, 'CAM-01-R', 'Roja', null, 10, true, true) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, STORE, CAMISETA],
    )
  )[0]!.id
  PRODUCTO_B = await nuevoProducto('PARA-500', 'Paracetamol 500 mg caja', { tenant: TENANT_B, store: STORE_B })
  await svc(`update public.store_products set category_id = $1 where product_id = any($2::uuid[])`, [
    cat,
    [PARACETAMOL, IBUPROFENO, AGOTADO, JARABE],
  ])

  CLIENTE = await nuevoCliente('BSJ-01', 'Bodega San Juan', 'compras@bsj.pe')
  CLIENTE_2 = await nuevoCliente('BSJ-02', 'Bodega San Juan Norte', 'norte@bsj.pe')
  CLIENTE_SURTIDO = await nuevoCliente('FARM-9', 'Farmacia Central', 'central@farm.pe')
  CLIENTE_B = await nuevoCliente('BSJ-01', 'Bodega San Juan', 'compras@bsj.pe', TENANT_B)

  REP = (
    await svc<{ id: string }>(
      `insert into public.sales_reps (organization_id, company_id, user_id, employee_code, full_name)
       values ($1, $2, $3, 'V-07', 'Vendedor Siete') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, SALES_REP],
    )
  )[0]!.id
  await svc(
    `insert into public.sales_rep_customers (organization_id, company_id, sales_rep_id, customer_id)
     values ($1, $2, $3, $4)`,
    [TENANT_A.organizationId, TENANT_A.companyId, REP, CLIENTE],
  )

  // Surtido de lista BLANCA para Farmacia Central: solo paracetamol 500.
  const lista = (
    await svc<{ id: string }>(
      `insert into public.assortments (organization_id, company_id, store_id, code, name, is_allow_list)
       values ($1, $2, $3, 'FARM', 'Farmacias', true) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, STORE],
    )
  )[0]!.id
  await svc(
    `insert into public.assortment_items (organization_id, company_id, assortment_id, product_id)
     values ($1, $2, $3, $4)`,
    [TENANT_A.organizationId, TENANT_A.companyId, lista, PARACETAMOL],
  )
  await svc(
    `insert into public.assortment_assignments (organization_id, company_id, store_id, assortment_id, scope, customer_id)
     values ($1, $2, $3, $4, 'customer', $5)`,
    [TENANT_A.organizationId, TENANT_A.companyId, STORE, lista, CLIENTE_SURTIDO],
  )

  // Historial de Bodega San Juan: paracetamol cada ~30 días, el último hace 40
  // (le toca reponer); ibuprofeno una vez.
  await pedido('compras@bsj.pe', 100, [{ product: PARACETAMOL, qty: 5 }])
  await pedido('compras@bsj.pe', 70, [{ product: PARACETAMOL, qty: 5 }])
  await pedido('compras@bsj.pe', 40, [{ product: PARACETAMOL, qty: 5 }, { product: IBUPROFENO, qty: 2 }])
  // Otros clientes: con paracetamol compran vitamina (x2) y el gel agotado (x2).
  await pedido('otro1@x.pe', 20, [{ product: PARACETAMOL, qty: 1 }, { product: VITAMINA, qty: 1 }, { product: AGOTADO, qty: 1 }])
  await pedido('otro2@x.pe', 10, [{ product: PARACETAMOL, qty: 1 }, { product: VITAMINA, qty: 1 }, { product: AGOTADO, qty: 1 }])
  // El jarabe (misma categoría) se vende en la tienda.
  await pedido('otro3@x.pe', 5, [{ product: JARABE, qty: 1 }])
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('ai_quote_resolve — texto a entidades reales', () => {
  it('cliente por código exacto y producto por SKU exacto ⇒ resuelto', async () => {
    const r = (await resolver(dueno(), { query: 'bsj-01', lines: [{ query: 'PARA-500', quantity: 20 }] }))!
    const c = r.customer as Json
    expect(c.status).toBe('resolved')
    expect(c.selected_customer_id).toBe(CLIENTE)
    const [l] = r.lines as Json[]
    expect(l).toMatchObject({ status: 'resolved', selected_product_id: PARACETAMOL, quantity: 20 })
    expect(((l!.candidates as Json[])[0] as Json).match).toBe('sku')
  })

  it('nombre parcial con varios clientes ⇒ ambiguo con candidatos, sin elegir', async () => {
    const r = (await resolver(dueno(), { query: 'San Juan', lines: [{ query: 'paracetamol', quantity: 3 }] }))!
    const c = r.customer as Json
    expect(c.status).toBe('ambiguous')
    expect(c.selected_customer_id).toBeNull()
    expect((c.candidates as Json[]).map((x) => x.customer_id).sort()).toEqual([CLIENTE, CLIENTE_2].sort())
    const [l] = r.lines as Json[]
    expect(l!.status).toBe('ambiguous')
    expect(l!.selected_product_id).toBeNull()
    // Solo lo publicado: el borrador «Paracetamol infantil» no es candidato.
    const ids = (l!.candidates as Json[]).map((x) => x.product_id)
    expect(ids).toEqual(expect.arrayContaining([PARACETAMOL, PARACETAMOL_1G]))
    expect(ids).not.toContain(BORRADOR)
  })

  it('nombre exacto entre parecidos ⇒ ese; texto sin coincidencias ⇒ not_found', async () => {
    const r = (await resolver(dueno(), { query: 'Bodega San Juan', lines: [{ query: 'aspirina' }] }))!
    expect((r.customer as Json).selected_customer_id).toBe(CLIENTE)
    const [l] = r.lines as Json[]
    expect(l).toMatchObject({ status: 'not_found', quantity: null })
  })

  it('surtido autorizado: fuera de la lista blanca ⇒ out_of_assortment; dentro ⇒ resuelto', async () => {
    const r = (await resolver(dueno(), {
      customer: CLIENTE_SURTIDO,
      lines: [{ query: 'ibuprofeno', quantity: 1 }, { query: 'paracetamol 500', quantity: 1 }],
    }))!
    expect(r.assortment).toMatchObject({ configured: true, is_allow_list: true })
    const [ibu, para] = r.lines as Json[]
    expect(ibu!.status).toBe('out_of_assortment')
    expect(((ibu!.candidates as Json[])[0] as Json).in_assortment).toBe(false)
    expect(para).toMatchObject({ status: 'resolved', selected_product_id: PARACETAMOL })
  })

  it('SKU de una variante ⇒ el producto con la variante marcada', async () => {
    const r = (await resolver(dueno(), { lines: [{ query: 'CAM-01-R', quantity: 2 }] }))!
    const [l] = r.lines as Json[]
    const cand = (l!.candidates as Json[])[0] as Json
    expect(cand).toMatchObject({ product_id: CAMISETA, kind: 'variant', matched_variant_id: CAMISETA_ROJA })
    expect((r.customer as Json).status).toBe('missing')
  })

  it('campos no permitidos o demasiadas líneas ⇒ error, no «sin filtro»', async () => {
    expect(await expectFailure(() => resolver(dueno(), { lines: [{ query: 'x', price: '1.00' }] }))).toMatch(/CAMPO_NO_PERMITIDO/)
    const muchas = Array.from({ length: 21 }, (_, i) => ({ query: `p${i}` }))
    expect(await expectFailure(() => resolver(dueno(), { lines: muchas }))).toMatch(/FILTRO_INVALIDO/)
  })

  it('cartera: el vendedor solo ve sus clientes; uno ajeno elegido ⇒ NULL', async () => {
    const r = (await resolver(conRol(SALES_REP), { query: 'San Juan' }))!
    const c = r.customer as Json
    expect(c.status).toBe('resolved')
    expect((c.candidates as Json[]).map((x) => x.customer_id)).toEqual([CLIENTE])
    expect(await resolver(conRol(SALES_REP), { customer: CLIENTE_2 })).toBeNull()
  })

  it('roles y módulo: viewer/catalog ⇒ SIN_PERMISO; sin trade.quotes ⇒ MODULO_NO_CONTRATADO; anon no ejecuta', async () => {
    expect(await expectFailure(() => resolver(conRol(VIEWER), { query: 'x' }))).toMatch(/SIN_PERMISO/)
    expect(await expectFailure(() => resolver(conRol(CATALOG), { query: 'x' }))).toMatch(/SIN_PERMISO/)
    expect(await resolver(conRol(ORDERS), { query: 'x' })).not.toBeNull()
    await contratar(TENANT_A, 'trade.quotes', false)
    try {
      expect(await expectFailure(() => resolver(dueno(), { query: 'x' }))).toMatch(/MODULO_NO_CONTRATADO/)
    } finally {
      await contratar(TENANT_A, 'trade.quotes')
    }
    expect(
      await expectFailure(() => asRole(db, 'anon', null, () => svc(`select public.ai_quote_resolve($1)`, [STORE]))),
    ).toMatch(/permission denied/)
  })

  it('A nunca ve a B: tienda de B ⇒ SIN_PERMISO; cliente de B ⇒ NULL; B solo encuentra lo suyo', async () => {
    expect(await expectFailure(() => resolver(dueno(), { query: 'x' }, STORE_B))).toMatch(/SIN_PERMISO/)
    expect(await resolver(dueno(), { customer: CLIENTE_B })).toBeNull()
    const b = (await resolver(claimsFor(TENANT_B), { query: 'BSJ-01', lines: [{ query: 'PARA-500' }] }, STORE_B))!
    expect((b.customer as Json).selected_customer_id).toBe(CLIENTE_B)
    expect(((b.lines as Json[])[0] as Json).selected_product_id).toBe(PRODUCTO_B)
  })
})

describe('quote_draft_preview — el precio y la disponibilidad los dice el sistema', () => {
  it('precio del motor por línea, totales, disponibilidad', async () => {
    const r = (await preview(dueno(), CLIENTE, [
      { product_id: PARACETAMOL, quantity: 3 },
      { product_id: AGOTADO, quantity: 2 },
    ]))!
    expect(r.ready).toBe(true)
    expect(r.currency).toBe('PEN')
    const [a, b] = r.lines as Json[]
    expect(a).toMatchObject({ unit_price: '10.00', line_total: '30.00', blocked: null, in_assortment: true })
    expect((a!.availability as Json).in_stock).toBe(true)
    // Agotado: se informa, no bloquea (una cotización no es una reserva).
    expect(b!.blocked).toBeNull()
    expect((b!.availability as Json).in_stock).toBe(false)
    expect(r.subtotal).toBe('50.00')
    expect(r.grand_total).toBe('50.00')
  })

  it('bloqueos del sistema: fuera de surtido, variante requerida, no publicado', async () => {
    const surt = (await preview(dueno(), CLIENTE_SURTIDO, [{ product_id: IBUPROFENO, quantity: 1 }]))!
    expect(((surt.lines as Json[])[0] as Json).blocked).toBe('FUERA_DE_SURTIDO')
    expect(surt.ready).toBe(false)
    expect(surt.grand_total).toBeNull()

    const r = (await preview(dueno(), CLIENTE, [
      { product_id: CAMISETA, quantity: 1 },
      { product_id: BORRADOR, quantity: 1 },
      { product_id: CAMISETA, variant_id: CAMISETA_ROJA, quantity: 2 },
    ]))!
    const [sinVar, borrador, conVar] = r.lines as Json[]
    expect(sinVar!.blocked).toBe('VARIANTE_REQUERIDA')
    expect(borrador!.blocked).toBe('PRODUCTO_NO_DISPONIBLE')
    expect(conVar).toMatchObject({ blocked: null, unit_price: '10.00', line_total: '20.00' })
    expect(r.blocked).toBe(2)
  })

  it('el navegador no manda importes: precio en la línea ⇒ CAMPO_NO_PERMITIDO; duplicado ⇒ LINEA_DUPLICADA', async () => {
    expect(
      await expectFailure(() => preview(dueno(), CLIENTE, [{ product_id: PARACETAMOL, quantity: 1, unit_price: '0.01' }])),
    ).toMatch(/CAMPO_NO_PERMITIDO/)
    expect(
      await expectFailure(() =>
        preview(dueno(), CLIENTE, [
          { product_id: PARACETAMOL, quantity: 1 },
          { product_id: PARACETAMOL, quantity: 2 },
        ]),
      ),
    ).toMatch(/LINEA_DUPLICADA/)
    expect(await expectFailure(() => preview(dueno(), CLIENTE, [{ product_id: PARACETAMOL, quantity: 0 }]))).toMatch(/CANTIDAD_INVALIDA/)
  })

  it('cartera y tenant: cliente ajeno ⇒ NULL', async () => {
    expect(await preview(conRol(SALES_REP), CLIENTE_2, [{ product_id: PARACETAMOL, quantity: 1 }])).toBeNull()
    expect(await preview(dueno(), CLIENTE_B, [{ product_id: PARACETAMOL, quantity: 1 }])).toBeNull()
  })
})

describe('quote_create_from_draft — ejecutar tras la confirmación', () => {
  it('crea la cotización en draft con los precios del motor, idempotente por clave', async () => {
    const key = 'ai-quote-test-0001'
    const r = await crear(dueno(), CLIENTE, [{ product_id: PARACETAMOL, quantity: 4 }], { number: 'COT-AI-1', key })
    expect(r).toMatchObject({ status: 'draft', grand_total: '40.00', already_created: false })
    const [q] = await svc<{ status: string; grand_total: string; sales_rep_id: string | null; notes: string }>(
      `select status, grand_total::text, sales_rep_id, notes from public.quotes where id = $1`,
      [r.quote_id],
    )
    expect(q).toMatchObject({ status: 'draft', grand_total: '40.00', sales_rep_id: null, notes: 'Entrega en almacén' })
    const items = await svc<{ unit_price: string; line_total: string; tax_amount: string }>(
      `select unit_price::text, line_total::text, tax_amount::text from public.quote_items where quote_id = $1`,
      [r.quote_id],
    )
    expect(items).toEqual([{ unit_price: '10.00', line_total: '40.00', tax_amount: '0.00' }])

    const otra = await crear(dueno(), CLIENTE, [{ product_id: PARACETAMOL, quantity: 4 }], { number: 'COT-AI-1b', key })
    expect(otra).toMatchObject({ quote_id: r.quote_id, already_created: true })
    expect((await svc(`select 1 from public.quotes where request_key = $1`, [key])).length).toBe(1)
  })

  it('una línea bloqueada no se guarda (y no queda nada a medias)', async () => {
    const antes = (await svc<{ n: number }>(`select count(*)::int as n from public.quotes`))[0]!.n
    expect(
      await expectFailure(() => crear(dueno(), CLIENTE_SURTIDO, [{ product_id: IBUPROFENO, quantity: 1 }])),
    ).toMatch(/LINEA_BLOQUEADA: FUERA_DE_SURTIDO/)
    expect(await expectFailure(() => crear(dueno(), CLIENTE, [{ product_id: PARACETAMOL, quantity: 1 }], { validUntil: '2000-01-01' }))).toMatch(/CAMPO_INVALIDO/)
    expect((await svc<{ n: number }>(`select count(*)::int as n from public.quotes`))[0]!.n).toBe(antes)
  })

  it('el vendedor cotiza SU cliente con su firma; ajeno ⇒ NO_ENCONTRADO; viewer ⇒ SIN_PERMISO', async () => {
    const r = await crear(conRol(SALES_REP), CLIENTE, [{ product_id: IBUPROFENO, quantity: 1 }])
    const [q] = await svc<{ sales_rep_id: string }>(`select sales_rep_id from public.quotes where id = $1`, [r.quote_id])
    expect(q!.sales_rep_id).toBe(REP)
    expect(await expectFailure(() => crear(conRol(SALES_REP), CLIENTE_2, [{ product_id: IBUPROFENO, quantity: 1 }]))).toMatch(/NO_ENCONTRADO/)
    expect(await expectFailure(() => crear(conRol(VIEWER), CLIENTE, [{ product_id: IBUPROFENO, quantity: 1 }]))).toMatch(/SIN_PERMISO/)
  })
})

describe('ai_assortment_facts — sugerencias calculadas por el sistema', () => {
  it('reposición, venta cruzada y complemento sobre productos reales', async () => {
    const r = (await surtido(dueno(), CLIENTE))!
    const cands = r.candidates as Json[]
    const por = (kind: string) => cands.filter((c) => c.kind === kind).map((c) => c.product_id)
    // Paracetamol: tres pedidos cada ~30 días y el último hace 40 ⇒ reponer.
    expect(por('replenish')).toEqual([PARACETAMOL])
    expect(cands.find((c) => c.kind === 'replenish')).toMatchObject({ orders_365d: 3, days_since_last: 40, avg_interval_days: 30 })
    // Vitamina: dos pedidos de otros clientes junto con su paracetamol.
    expect(por('cross_sell')).toEqual([VITAMINA])
    expect(cands.find((c) => c.kind === 'cross_sell')).toMatchObject({ co_orders: 2, anchor_product_id: PARACETAMOL })
    // Jarabe: su categoría, vendido en la tienda y aún no comprado.
    expect(por('complement')).toContain(JARABE)
    // El gel agotado no se sugiere: se cuenta como excluido.
    expect(cands.map((c) => c.product_id)).not.toContain(AGOTADO)
    expect((r.excluded as Json).unavailable).toBeGreaterThanOrEqual(1)
    const hist = r.history as Json[]
    expect(hist[0]).toMatchObject({ product_id: PARACETAMOL, orders_365d: 3 })
  })

  it('surtido autorizado: fuera de la lista blanca no se sugiere', async () => {
    await pedido('central@farm.pe', 30, [{ product: PARACETAMOL, qty: 1 }])
    const r = (await surtido(dueno(), CLIENTE_SURTIDO))!
    const ids = (r.candidates as Json[]).map((c) => c.product_id)
    expect(ids).not.toContain(VITAMINA)
    expect(ids).not.toContain(JARABE)
    expect((r.excluded as Json).out_of_assortment).toBeGreaterThanOrEqual(1)
    expect(r.assortment).toMatchObject({ configured: true })
  })

  it('cartera, roles y tenant', async () => {
    expect(await surtido(conRol(SALES_REP), CLIENTE)).not.toBeNull()
    expect(await surtido(conRol(SALES_REP), CLIENTE_2)).toBeNull()
    expect(await expectFailure(() => surtido(conRol(VIEWER), CLIENTE))).toMatch(/SIN_PERMISO/)
    expect(await surtido(dueno(), CLIENTE_B)).toBeNull()
    expect(await expectFailure(() => surtido(dueno(), CLIENTE, STORE_B))).toMatch(/SIN_PERMISO/)
  })
})

describe('solo lectura e INVOKER', () => {
  it('lecturas STABLE; el guardado VOLATILE; todas SECURITY INVOKER', async () => {
    const filas = await svc<{ proname: string; provolatile: string; prosecdef: boolean }>(
      `select p.proname, p.provolatile, p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'public' and p.proname in
                ('ai_quote_resolve', 'quote_draft_preview', 'quote_create_from_draft', 'ai_assortment_facts'))
           or (n.nspname = 'ebim' and p.proname in
                ('ai_quote_customer_visible', 'ai_customer_order_ids', 'ai_quote_product_candidates'))
        order by 1`,
    )
    expect(filas).toHaveLength(7)
    for (const f of filas) {
      expect(f.prosecdef, f.proname).toBe(false)
      expect(f.provolatile, f.proname).toBe(f.proname === 'quote_create_from_draft' ? 'v' : 's')
    }
  })
})
