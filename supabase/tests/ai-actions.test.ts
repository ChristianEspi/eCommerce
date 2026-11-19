// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Acciones propuestas por la IA con aprobación (2026-11-19).
 *
 * Lo que se fija:
 *  · sin escritura directa: las propuestas solo nacen y se deciden por comando;
 *  · los datos se validan EN LA BASE contra la sociedad (tienda, productos,
 *    reseña) y se guardan reescritos con lo validado;
 *  · aprobar ejecuta el comando de siempre y deja quién y cuándo;
 *  · un fallo del comando deja la propuesta `failed` con su código, sin
 *    escritura a medias;
 *  · otra sociedad no ve ni decide nada.
 */

let db: PGlite
let storeA = ''
let storeB = ''
let prodA = ''
let prodA2 = ''
let prodB = ''
let reviewA = ''

const CATALOGO = '0c000000-0000-4000-8000-00000000a001'
const LECTOR = '0c000000-0000-4000-8000-00000000a002'
const COMPRADOR = '0c000000-0000-4000-8000-00000000a003'

type Row = Record<string, unknown>

async function svc<T = Row>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

async function as<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []) {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}

async function fallo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    return String((error as Error).message)
  }
  throw new Error('se esperaba un error')
}

const owner = claimsFor(TENANT_A)
const ownerB = claimsFor(TENANT_B)
const staff = (sub: string, role: string) =>
  claimsFor(TENANT_A, { sub, email: `${sub}@tenant-a.com`, companies: [{ id: TENANT_A.companyId, role }] })

async function producto(tenant: typeof TENANT_A, store: string, sku: string) {
  const [row] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $4, '20.00', 'PEN', 50, 'published', now())
     returning id`,
    [tenant.organizationId, tenant.companyId, store, sku],
  )
  return String(row?.id)
}

async function proponer(claims: JwtClaims, kind: string, store: string | null, payload: unknown, title = 'Liquidar lo que vence') {
  const [row] = await as<{ r: Row }>(
    claims,
    `select public.ai_action_propose($1, $2::uuid, $3, 'Rota poco y vence pronto', $4::jsonb, 'promotions') as r`,
    [kind, store, title, JSON.stringify(payload)],
  )
  return row?.r as Row
}

async function decidir(claims: JwtClaims, id: string, decision: string) {
  const [row] = await as<{ r: Row }>(claims, `select public.ai_action_decide($1::uuid, $2) as r`, [id, decision])
  return row?.r as Row
}

const promo = () => ({
  name: 'Liquidación de temporada',
  description: 'Precios especiales por tiempo limitado.',
  value_percent: 15,
  valid_to: new Date(Date.now() + 7 * 86400_000).toISOString(),
  product_ids: [prodA, prodA2],
})

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
    await svc(
      `insert into public.tenant_entitlements (organization_id, company_id, entitlement_code, is_active, source)
       values ($1, $2, 'ecommerce.promotions', true, 'hub')
       on conflict (organization_id, company_id, entitlement_code) do update set is_active = true`,
      [tenant.organizationId, tenant.companyId],
    )
  }
  await svc(`update public.stores set status = 'active'`)
  storeA = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  storeB = String((await svc(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug]))[0]?.id)
  prodA = await producto(TENANT_A, storeA, 'ACC-A1')
  prodA2 = await producto(TENANT_A, storeA, 'ACC-A2')
  prodB = await producto(TENANT_B, storeB, 'ACC-B1')
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'catalogo@tenant-a.com', 'catalog'), ($1, $2, $4, 'lector@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, CATALOGO, LECTOR],
  )
  const [r] = await svc<{ id: string }>(
    `insert into public.product_reviews (organization_id, company_id, store_id, product_id, user_id, rating, body)
     values ($1, $2, $3, $4, $5, 5, 'Muy bueno, llegó rápido') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, prodA, COMPRADOR],
  )
  reviewA = String(r?.id)
})

afterAll(async () => {
  await db?.close()
})

describe('sin escritura directa', () => {
  it('nadie inserta ni edita propuestas por PostgREST', async () => {
    expect(
      await fallo(() =>
        as(owner, `insert into public.ai_action_proposals (organization_id, company_id, kind, title, payload, proposed_by)
                   values ($1, $2, 'review.moderate', 'x x x', '{}', $3)`, [TENANT_A.organizationId, TENANT_A.companyId, TENANT_A.ownerId]),
      ),
    ).toMatch(/permission denied/i)
  })
})

describe('proponer: validación en la base', () => {
  it('una campaña válida nace pendiente con los datos reescritos', async () => {
    const r = await proponer(owner, 'promotion.create_draft', storeA, promo())
    expect(r.status).toBe('pending')
    const [fila] = await svc<{ payload: Row; status: string; proposed_by: string }>(
      `select payload, status, proposed_by from public.ai_action_proposals where id = $1`,
      [r.id],
    )
    expect(fila?.payload).toMatchObject({ name: 'Liquidación de temporada', value_percent: 15 })
    expect(fila?.proposed_by).toBe(TENANT_A.ownerId)
  })

  it('rechaza campos desconocidos, porcentajes absurdos y productos de otra tienda', async () => {
    expect(await fallo(() => proponer(owner, 'promotion.create_draft', storeA, { ...promo(), status: 'active' }))).toMatch(/CAMPO_NO_PERMITIDO/)
    expect(await fallo(() => proponer(owner, 'promotion.create_draft', storeA, { ...promo(), value_percent: 95 }))).toMatch(/PORCENTAJE_INVALIDO/)
    expect(await fallo(() => proponer(owner, 'promotion.create_draft', storeA, { ...promo(), product_ids: [prodB] }))).toMatch(/PRODUCTO_AJENO/)
    expect(await fallo(() => proponer(owner, 'promotion.create_draft', storeB, promo()))).toMatch(/TIENDA_NO_DISPONIBLE/)
  })

  it('el rol manda: catálogo no propone campañas; lector no propone nada', async () => {
    expect(await fallo(() => proponer(staff(CATALOGO, 'catalog'), 'promotion.create_draft', storeA, promo()))).toMatch(/SIN_PERMISO/)
    expect(
      await fallo(() => proponer(staff(LECTOR, 'viewer'), 'review.moderate', null, { review_id: reviewA, decision: 'publish' })),
    ).toMatch(/SIN_PERMISO/)
  })

  it('un tipo fuera de la lista cerrada no existe', async () => {
    expect(await fallo(() => proponer(owner, 'order.approve', storeA, {}))).toMatch(/ACCION_DESCONOCIDA/)
  })
})

describe('decidir', () => {
  it('aprobar una campaña la crea en BORRADOR con sus productos y deja quién aprobó', async () => {
    const r = await proponer(owner, 'promotion.create_draft', storeA, promo())
    const d = await decidir(owner, String(r.id), 'approve')
    expect(d.status).toBe('executed')
    const promoId = (d.result as Row).promotion_id
    const [p] = await svc<{ status: string; kind: string; value_percent: string }>(
      `select status, kind, value_percent::text from public.promotions where id = $1`,
      [promoId],
    )
    expect(p).toMatchObject({ status: 'draft', kind: 'percentage' })
    expect(Number(p?.value_percent)).toBe(15)
    const scopes = await svc(`select product_id from public.promotion_scopes where promotion_id = $1`, [promoId])
    expect(scopes).toHaveLength(2)
    const [fila] = await svc<{ decided_by: string }>(`select decided_by from public.ai_action_proposals where id = $1`, [r.id])
    expect(fila?.decided_by).toBe(TENANT_A.ownerId)
  })

  it('una propuesta decidida no se vuelve a decidir', async () => {
    const r = await proponer(owner, 'promotion.create_draft', storeA, promo())
    await decidir(owner, String(r.id), 'reject')
    expect(await fallo(() => decidir(owner, String(r.id), 'approve'))).toMatch(/PROPUESTA_YA_DECIDIDA/)
  })

  it('moderar una reseña: catálogo propone y aprueba con el comando de siempre', async () => {
    const cat = staff(CATALOGO, 'catalog')
    const r = await proponer(cat, 'review.moderate', null, { review_id: reviewA, decision: 'publish' }, 'Publicar reseña positiva')
    const d = await decidir(cat, String(r.id), 'approve')
    expect(d.status).toBe('executed')
    const [rev] = await svc<{ status: string; moderated_by: string }>(
      `select status, moderated_by from public.product_reviews where id = $1`,
      [reviewA],
    )
    expect(rev).toMatchObject({ status: 'published', moderated_by: CATALOGO })
  })

  it('si el comando falla al aprobar, queda `failed` con el código y sin escritura a medias', async () => {
    // La reseña ya está publicada: proponerla de nuevo lo impide la validación,
    // así que se fabrica la carrera a mano: propuesta válida y luego el estado cambia.
    const [rev2] = await svc<{ id: string }>(
      `insert into public.product_reviews (organization_id, company_id, store_id, product_id, user_id, rating, body)
       values ($1, $2, $3, $4, $5, 2, 'No me gustó el empaque') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, prodA2, COMPRADOR],
    )
    const r = await proponer(owner, 'review.moderate', null, { review_id: rev2?.id, decision: 'publish' }, 'Publicar reseña')
    await as(owner, `select public.moderate_product_review($1::uuid, 'publish', null)`, [rev2?.id])
    const d = await decidir(owner, String(r.id), 'approve')
    expect(d).toMatchObject({ status: 'failed', error_code: 'SIN_CAMBIOS' })
  })
})

describe('aislamiento', () => {
  it('otra sociedad no ve ni decide propuestas ajenas', async () => {
    const r = await proponer(owner, 'promotion.create_draft', storeA, promo())
    const vistas = await as(ownerB, `select id from public.ai_action_proposals`)
    expect(vistas).toHaveLength(0)
    expect(await fallo(() => decidir(ownerB, String(r.id), 'approve'))).toMatch(/PROPUESTA_NO_ENCONTRADA/)
  })

  it('un lector de la misma sociedad tampoco ve las de campañas', async () => {
    const vistas = await as(staff(LECTOR, 'viewer'), `select id from public.ai_action_proposals`)
    expect(vistas).toHaveLength(0)
  })
})
