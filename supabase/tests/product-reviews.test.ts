// @vitest-environment node
/**
 * Reseñas y valoraciones · contra Postgres REAL.
 *
 * Lo que no puede fallar:
 *
 *  · **la compra verificada no se falsifica** — el campo se rechaza si llega
 *    en la petición, y el servidor solo lo pone a `true` con un pedido real,
 *    vinculado a ESE usuario, de ESA tienda, de ESE producto y no cancelado;
 *  · **una reseña por persona y producto** — volver a enviar edita, y editar
 *    devuelve a la cola de moderación;
 *  · **lo pendiente no se ve** — ni en la lista pública ni en la media;
 *  · **moderar exige rol de catálogo** y deja rastro (quién, cuándo, bitácora);
 *  · **aislamiento entre tenants** y `anon` sin escritura;
 *  · **validación de entrada** en el servidor.
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
  type JwtClaims,
} from './harness.ts'

type Row = Record<string, unknown>

const ANA = '0e200000-0000-4000-8000-00000000a001'
const BETO = '0e200000-0000-4000-8000-00000000b001'
const CARLA = '0e200000-0000-4000-8000-00000000c001'
const DANI = '0e200000-0000-4000-8000-00000000d001'
const ELENA = '0e200000-0000-4000-8000-00000000e001'
const LECTOR = '0e200000-0000-4000-8000-0000000f0001'
const CATALOGO = '0e200000-0000-4000-8000-0000000f0002'

let db: PGlite
let storeA = ''
let jabon = ''
let crema = ''
let borrador = ''
let lampara = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

function shopper(sub: string): JwtClaims {
  return { sub, email: `${sub}@compras.test`, org_id: '', companies: [], active_company: '' }
}

async function as<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}

async function anon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => (await db.query<T>(query, params)).rows)
}

function staff(sub: string, role: string): JwtClaims {
  return claimsFor(TENANT_A, {
    sub,
    email: `${sub}@tenant-a.com`,
    companies: [{ id: TENANT_A.companyId, role }],
  })
}

async function opinar(
  sub: string,
  productId: string,
  review: unknown,
  slug = TENANT_A.storeSlug,
): Promise<Row> {
  const [row] = await as<{ r: Row }>(
    shopper(sub),
    `select public.submit_product_review($1, $2::uuid, $3::jsonb) as r`,
    [slug, productId, JSON.stringify(review)],
  )
  return row?.r as Row
}

async function publicas(productId: string, page = 1, size = 10, slug = TENANT_A.storeSlug): Promise<Row> {
  const [row] = await anon<{ r: Row }>(
    `select public.product_reviews_for_slug($1, $2::uuid, $3, $4) as r`,
    [slug, productId, page, size],
  )
  return row?.r as Row
}

async function moderar(claims: JwtClaims, reviewId: string, decision: string, reason: string | null = null) {
  const [row] = await as<{ r: Row }>(
    claims,
    `select public.moderate_product_review($1::uuid, $2, $3) as r`,
    [reviewId, decision, reason],
  )
  return row?.r as Row
}

async function producto(tenant: typeof TENANT_A, store: string, sku: string, status = 'published') {
  const [row] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $4, '12.50', 'PEN', 500, $5::public.product_status,
             case when $5 = 'published' then now() end)
     returning id`,
    [tenant.organizationId, tenant.companyId, store, sku, status],
  )
  return String(row?.id)
}

/** Un pedido como lo crea el servidor de compra, vinculado a su comprador. */
async function pedido(slug: string, productId: string, buyer: string, name = 'Ana Consumidora') {
  await svc(`delete from public.checkout_attempts`)
  const [row] = await svc<{ result: Row }>(
    `select public.create_order_for_slug(
        $1, $2, jsonb_build_array(jsonb_build_object('product_id', $3::text, 'quantity', 1)),
        $4, '+51 999 111 222',
        jsonb_build_object('address', 'Av. Primavera 120', 'city', 'Lima', 'country', 'PE'), null) as result`,
    [slug, `${buyer}@compras.test`, productId, name],
  )
  const [order] = await svc<{ id: string }>(
    `select o.id from public.orders o join public.stores s on s.id = o.store_id
      where o.order_number = $1 and s.slug = $2`,
    [row?.result.order_number, slug],
  )
  const orderId = String(order?.id)
  await svc(`select public.checkout_link_order_buyer($1, $2)`, [orderId, buyer])
  return orderId
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
  const storeB = String((await svc(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug]))[0]?.id)

  jabon = await producto(TENANT_A, storeA, 'RES-JABON')
  crema = await producto(TENANT_A, storeA, 'RES-CREMA')
  borrador = await producto(TENANT_A, storeA, 'RES-BORRADOR', 'draft')
  lampara = await producto(TENANT_B, storeB, 'RES-LAMPARA')

  // Ana compró el jabón en la tienda A.
  await pedido(TENANT_A.storeSlug, jabon, ANA, 'Ana Consumidora')
  // Beto también, pero su pedido se canceló.
  const cancelado = await pedido(TENANT_A.storeSlug, jabon, BETO, 'Beto Pérez')
  await db.exec(`set session_replication_role = replica`)
  try {
    await db.query(`update public.orders set status = 'cancelled' where id = $1`, [cancelado])
  } finally {
    await db.exec(`set session_replication_role = origin`)
  }
  // Carla compró, pero en la tienda B y otra cosa.
  await pedido(TENANT_B.storeSlug, lampara, CARLA, 'Carla Ruiz')

  for (const [user, role] of [
    [LECTOR, 'viewer'],
    [CATALOGO, 'catalog'],
  ] as const) {
    await svc(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, $4, $5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, user, `${user}@tenant-a.com`, role],
    )
  }
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.public_rate_events`)
  await svc(`update public.store_settings set config = config - 'rate_limits'`)
})
describe('la compra verificada la decide el servidor', () => {
  it('rechaza verified_purchase si llega en la petición, aunque sea false', async () => {
    for (const forged of [{ verified_purchase: true }, { verified_purchase: false }, { status: 'published' }, { user_id: DANI }]) {
      const message = await expectFailure(() =>
        opinar(DANI, jabon, { rating: 5, body: 'Me encantó, muy buen jabón.', ...forged }),
      )
      expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
    }
    const [n] = await svc<{ n: number }>(`select count(*)::int as n from public.product_reviews`)
    expect(n?.n).toBe(0)
  })

  it('con un pedido real vinculado queda verificada, y nace pendiente', async () => {
    const r = await opinar(ANA, jabon, { rating: 5, title: 'Excelente', body: 'Deja la piel suave y huele bien.' })
    expect(r).toMatchObject({ status: 'pending', verified_purchase: true, rating: 5, title: 'Excelente' })
    // Nombre derivado de su último pedido: nombre e inicial, nunca el correo.
    expect(r.display_name).toBe('Ana C.')
  })

  it('sin pedido no es verificada', async () => {
    const r = await opinar(DANI, jabon, { rating: 3, body: 'Correcto, sin más, cumple.', display_name: 'Dani Q' })
    expect(r).toMatchObject({ verified_purchase: false, display_name: 'Dani Q' })
  })

  it('un pedido cancelado no verifica', async () => {
    const r = await opinar(BETO, jabon, { rating: 1, body: 'Nunca me llegó el pedido.' })
    expect(r.verified_purchase).toBe(false)
  })

  it('un pedido de OTRA tienda no verifica', async () => {
    const r = await opinar(CARLA, jabon, { rating: 4, body: 'Lo probé en casa de una amiga.' })
    expect(r.verified_purchase).toBe(false)
  })

  it('un pedido de otro producto de la misma tienda no verifica', async () => {
    const r = await opinar(ANA, crema, { rating: 4, body: 'No la compré, pero la probé.' })
    expect(r.verified_purchase).toBe(false)
  })

  it('una columna escrita a mano no sirve: authenticated no tiene INSERT ni UPDATE', async () => {
    const insert = await expectFailure(() =>
      as(
        shopper(ELENA),
        `insert into public.product_reviews
           (organization_id, company_id, store_id, product_id, user_id, rating, body, verified_purchase)
         values ($1, $2, $3, $4, $5, 5, 'Texto inventado de reseña', true)`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, jabon, ELENA],
      ),
    )
    expect(insert).toMatch(/permission denied/i)
    const update = await expectFailure(() =>
      as(staff(TENANT_A.ownerId, 'owner'), `update public.product_reviews set verified_purchase = true`),
    )
    expect(update).toMatch(/permission denied/i)
  })
})

describe('una por persona y producto', () => {
  it('volver a enviar edita la misma fila y la devuelve a pendiente', async () => {
    const [antes] = await svc<{ id: string }>(
      `select id from public.product_reviews where user_id = $1 and product_id = $2`,
      [DANI, jabon],
    )
    await moderar(staff(CATALOGO, 'catalog'), String(antes?.id), 'publish')

    const r = await opinar(DANI, jabon, { rating: 4, body: 'Lo pensé mejor: está muy bien.', display_name: 'Dani Q' })
    expect(r).toMatchObject({ review_id: antes?.id, status: 'pending', rating: 4 })

    const [fila] = await svc<Row>(
      `select count(*)::int as n, max(moderated_at) as moderated_at, max(published_at) as published_at
         from public.product_reviews where user_id = $1 and product_id = $2`,
      [DANI, jabon],
    )
    expect(fila).toEqual({ n: 1, moderated_at: null, published_at: null })
  })

  it('my_product_review devuelve la suya en cualquier estado, y null si no hay', async () => {
    const [mia] = await as<{ r: Row | null }>(shopper(DANI), `select public.my_product_review($1, $2) as r`, [
      TENANT_A.storeSlug,
      jabon,
    ])
    expect(mia?.r).toMatchObject({ status: 'pending', display_name: 'Dani Q' })
    expect(Object.keys(mia?.r ?? {})).not.toContain('moderated_by')
    const [nada] = await as<{ r: Row | null }>(shopper(ELENA), `select public.my_product_review($1, $2) as r`, [
      TENANT_A.storeSlug,
      jabon,
    ])
    expect(nada?.r).toBeNull()
  })
})

describe('validación de entrada', () => {
  it.each([0, 6, '5', 4.5, null])('valoración %s no vale', async (rating) => {
    const message = await expectFailure(() => opinar(ELENA, jabon, { rating, body: 'Texto suficiente aquí.' }))
    expect(message).toMatch(/CALIFICACION_INVALIDA/)
  })

  it.each([
    ['corto', { rating: 4, body: 'corto' }],
    ['marcado', { rating: 4, body: '<script>alert(1)</script> muy bueno' }],
    ['título largo', { rating: 4, title: 'x'.repeat(121), body: 'Texto suficiente aquí.' }],
    ['sin texto', { rating: 4 }],
  ])('texto %s no vale', async (_nombre, review) => {
    const message = await expectFailure(() => opinar(ELENA, jabon, review))
    expect(message).toMatch(/RESENA_TEXTO_INVALIDO/)
  })

  it.each(['elena@correo.com', 'Elena 999111222', 'https://spam.test', 'E'])(
    'nombre %s no vale',
    async (display_name) => {
      const message = await expectFailure(() =>
        opinar(ELENA, jabon, { rating: 4, body: 'Texto suficiente aquí.', display_name }),
      )
      expect(message).toMatch(/NOMBRE_INVALIDO/)
    },
  )

  it('un producto que no está publicado, o de otra tienda, no se reseña', async () => {
    for (const productId of [borrador, lampara]) {
      const message = await expectFailure(() =>
        opinar(ELENA, productId, { rating: 4, body: 'Texto suficiente aquí.' }),
      )
      expect(message).toMatch(/PRODUCTO_NO_DISPONIBLE/)
    }
  })

  it('el personal de la tienda no reseña su propio catálogo', async () => {
    const message = await expectFailure(() =>
      as(staff(CATALOGO, 'catalog'), `select public.submit_product_review($1, $2, $3::jsonb)`, [
        TENANT_A.storeSlug,
        jabon,
        JSON.stringify({ rating: 5, body: 'El mejor jabón que existe.' }),
      ]),
    )
    expect(message).toMatch(/RESENA_NO_PERMITIDA/)
  })

  it('anon no puede enviar', async () => {
    const message = await expectFailure(() =>
      anon(`select public.submit_product_review($1, $2, $3::jsonb)`, [
        TENANT_A.storeSlug,
        jabon,
        JSON.stringify({ rating: 5, body: 'Texto suficiente aquí.' }),
      ]),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('el techo por tienda corta el envío', async () => {
    await svc(
      `update public.store_settings
          set config = jsonb_set(coalesce(config, '{}'::jsonb), '{rate_limits}', '{"reviews.submit": 1}'::jsonb)
        where store_id = $1`,
      [storeA],
    )
    await opinar(ELENA, crema, { rating: 5, body: 'Primera reseña de Elena.' })
    const message = await expectFailure(() => opinar(ELENA, jabon, { rating: 5, body: 'Segunda reseña de Elena.' }))
    expect(message).toMatch(/LIMITE_DE_TASA/)
  })
})
async function idDe(user: string, productId: string): Promise<string> {
  const [row] = await svc<{ id: string }>(
    `select id from public.product_reviews where user_id = $1 and product_id = $2`,
    [user, productId],
  )
  return String(row?.id)
}

describe('la lectura pública', () => {
  it('lo pendiente no se ve ni cuenta en la media', async () => {
    const r = await publicas(jabon)
    expect(r).toMatchObject({
      summary: { count: 0, average: null, distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } },
      reviews: [],
      total: 0,
    })
  })

  it('al publicar aparece, y el resumen sale solo de lo publicado', async () => {
    await moderar(staff(CATALOGO, 'catalog'), await idDe(ANA, jabon), 'publish')
    await moderar(staff(CATALOGO, 'catalog'), await idDe(BETO, jabon), 'publish')

    const r = await publicas(jabon)
    expect(r.summary).toEqual({
      count: 2,
      average: '3.00',
      distribution: { '1': 1, '2': 0, '3': 0, '4': 0, '5': 1 },
    })
    const reviews = r.reviews as Row[]
    expect(reviews.map((x) => x.display_name).sort()).toEqual(['Ana C.', 'Beto P.'])
    expect(reviews.find((x) => x.display_name === 'Ana C.')?.verified_purchase).toBe(true)
  })

  it('ni usuario, ni correo, ni tenant en cada fila pública', async () => {
    const r = await publicas(jabon)
    for (const row of r.reviews as Row[]) {
      expect(Object.keys(row).sort()).toEqual([
        'body',
        'display_name',
        'published_at',
        'rating',
        'review_id',
        'title',
        'verified_purchase',
      ])
    }
    expect(JSON.stringify(r)).not.toContain('@compras.test')
    expect(JSON.stringify(r)).not.toContain(ANA)
  })

  it('pagina', async () => {
    const primera = await publicas(jabon, 1, 1)
    const segunda = await publicas(jabon, 2, 1)
    expect(primera).toMatchObject({ page: 1, page_size: 1, total: 2 })
    expect((primera.reviews as Row[]).length).toBe(1)
    expect((segunda.reviews as Row[]).length).toBe(1)
    expect((primera.reviews as Row[])[0]?.review_id).not.toBe((segunda.reviews as Row[])[0]?.review_id)
    expect(((await publicas(jabon, 3, 1)).reviews as Row[]).length).toBe(0)
  })

  it('un producto que deja de estar publicado no enseña sus reseñas', async () => {
    await svc(`update public.products set status = 'draft' where id = $1`, [jabon])
    try {
      expect((await publicas(jabon)).summary).toMatchObject({ count: 0 })
    } finally {
      await svc(`update public.products set status = 'published' where id = $1`, [jabon])
    }
  })

  it('un producto de otra tienda por el slug de esta no enseña nada', async () => {
    expect((await publicas(lampara)).total).toBe(0)
  })
})

describe('moderación', () => {
  it('un lector de este tenant no modera', async () => {
    const id = await idDe(CARLA, jabon)
    const message = await expectFailure(() => moderar(staff(LECTOR, 'viewer'), id, 'publish'))
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('otro tenant no la encuentra, ni un comprador', async () => {
    const id = await idDe(CARLA, jabon)
    const otro = await expectFailure(() => moderar(claimsFor(TENANT_B), id, 'publish'))
    expect(otro).toMatch(/RESENA_NO_ENCONTRADA/)
    const comprador = await expectFailure(() => moderar(shopper(CARLA), id, 'publish'))
    expect(comprador).toMatch(/RESENA_NO_ENCONTRADA/)
  })

  it('rechazar exige motivo, y deja quién, cuándo y bitácora', async () => {
    const id = await idDe(CARLA, jabon)
    const sinMotivo = await expectFailure(() => moderar(staff(CATALOGO, 'catalog'), id, 'reject'))
    expect(sinMotivo).toMatch(/MOTIVO_REQUERIDO/)

    const r = await moderar(staff(CATALOGO, 'catalog'), id, 'reject', 'No habla de este producto.')
    expect(r).toMatchObject({ status: 'rejected', rejection_reason: 'No habla de este producto.' })

    const [fila] = await svc<Row>(
      `select moderated_by, moderated_at is not null as fechado from public.product_reviews where id = $1`,
      [id],
    )
    expect(fila).toEqual({ moderated_by: CATALOGO, fechado: true })

    const audit = await svc<Row>(
      `select action, actor_id from public.audit_log where entity_type = 'product_review' and entity_id = $1`,
      [id],
    )
    expect(audit).toEqual([{ action: 'product_review.rejected', actor_id: CATALOGO }])

    const repetido = await expectFailure(() => moderar(staff(CATALOGO, 'catalog'), id, 'reject', 'Otra vez.'))
    expect(repetido).toMatch(/SIN_CAMBIOS/)
    expect(((await publicas(jabon)).reviews as Row[]).map((x) => x.review_id)).not.toContain(id)
  })

  it('una decisión desconocida no se acepta', async () => {
    const id = await idDe(ANA, crema)
    const message = await expectFailure(() => moderar(staff(CATALOGO, 'catalog'), id, 'archive'))
    expect(message).toMatch(/DECISION_INVALIDA/)
  })

  it('el dueño de este tenant también publica', async () => {
    const r = await moderar(claimsFor(TENANT_A), await idDe(ANA, crema), 'publish')
    expect(r.status).toBe('published')
  })
})

describe('aislamiento de la tabla', () => {
  it('cada tenant ve su cola y ninguna ajena; el comprador y anon, nada', async () => {
    const [total] = await svc<{ n: number }>(`select count(*)::int as n from public.product_reviews`)
    const a = await as<{ n: number }>(staff(LECTOR, 'viewer'), `select count(*)::int as n from public.product_reviews`)
    const b = await as<{ n: number }>(claimsFor(TENANT_B), `select count(*)::int as n from public.product_reviews`)
    const comprador = await as<{ n: number }>(shopper(ANA), `select count(*)::int as n from public.product_reviews`)
    expect({ a: a[0]?.n, b: b[0]?.n, comprador: comprador[0]?.n }).toEqual({ a: total?.n, b: 0, comprador: 0 })
    const message = await expectFailure(() => anon(`select * from public.product_reviews`))
    expect(message).toMatch(/permission denied/i)
  })
})