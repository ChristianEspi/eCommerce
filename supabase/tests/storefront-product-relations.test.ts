// @vitest-environment node
/**
 * Relaciones de producto en la vitrina · `product_relations_for_slug`, contra
 * Postgres REAL.
 *
 * Lo que no puede fallar:
 *
 *  · **solo lo que el comprador puede ver** — relacionados publicados, de la
 *    tienda activa que nombra el slug y visibles en su canal público; nunca un
 *    borrador, una publicación futura, un producto fuera de su canal ni uno de
 *    otro tenant;
 *  · **el orden es el que fija el comercio** (`position`), estable;
 *  · **solo ids y tipo** — ni precio, ni existencia, ni tenant;
 *  · **la puerta es anónima** y la tabla sigue cerrada para `anon`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
let storeA = ''
let storeB = ''
let silla = ''
let mesa = ''
let cojin = ''
let funda = ''
let borrador = ''
let futuro = ''
let lampara = ''
let pantalla = ''
let canalA = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function anon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => (await db.query<T>(query, params)).rows)
}

async function producto(
  tenant: typeof TENANT_A,
  store: string,
  sku: string,
  options: { status?: string; publishedAt?: string | null } = {},
): Promise<string> {
  const { status = 'published', publishedAt = 'now' } = options
  const [row] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $4, '10.00', 'PEN', 100, $5::public.product_status,
             case when $6::text is null then null
                  when $6::text = 'now' then now()
                  else $6::timestamptz end)
     returning id`,
    [tenant.organizationId, tenant.companyId, store, sku, status, publishedAt],
  )
  return String(row?.id)
}

async function relacion(
  tenant: typeof TENANT_A,
  store: string,
  from: string,
  to: string,
  kind: string,
  position: number,
): Promise<void> {
  await svc(
    `insert into public.product_relations
       (organization_id, company_id, store_id, product_id, related_product_id, relation_kind, position)
     values ($1, $2, $3, $4, $5, $6::public.product_relation_kind, $7)`,
    [tenant.organizationId, tenant.companyId, store, from, to, kind, position],
  )
}

async function relacionados(
  productId: string,
  options: { slug?: string; kinds?: string[] | null; limit?: number } = {},
): Promise<Row[]> {
  const { slug = TENANT_A.storeSlug, kinds = null, limit = 8 } = options
  return anon(
    `select * from public.product_relations_for_slug($1, $2::uuid, $3::text[], $4)`,
    [slug, productId, kinds, limit],
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
  storeA = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  storeB = String((await svc(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug]))[0]?.id)
  canalA = String(
    (await svc(`select id from public.channels where store_id = $1 and is_default`, [storeA]))[0]?.id,
  )

  silla = await producto(TENANT_A, storeA, 'REL-SILLA')
  mesa = await producto(TENANT_A, storeA, 'REL-MESA')
  cojin = await producto(TENANT_A, storeA, 'REL-COJIN')
  funda = await producto(TENANT_A, storeA, 'REL-FUNDA')
  borrador = await producto(TENANT_A, storeA, 'REL-BORRADOR', { status: 'draft', publishedAt: null })
  futuro = await producto(TENANT_A, storeA, 'REL-FUTURO', { publishedAt: '2099-01-01T00:00:00Z' })
  lampara = await producto(TENANT_B, storeB, 'REL-LAMPARA')
  pantalla = await producto(TENANT_B, storeB, 'REL-PANTALLA')

  // El orden que fija el comercio NO es el de alta: el cojín va primero.
  await relacion(TENANT_A, storeA, silla, mesa, 'related', 2)
  await relacion(TENANT_A, storeA, silla, cojin, 'accessory', 1)
  await relacion(TENANT_A, storeA, silla, funda, 'cross_sell', 3)
  await relacion(TENANT_A, storeA, silla, borrador, 'related', 0)
  await relacion(TENANT_A, storeA, silla, futuro, 'up_sell', 0)
  // Un borrador CON relaciones: no puede servir para leer su grafo.
  await relacion(TENANT_A, storeA, borrador, mesa, 'related', 0)
  await relacion(TENANT_B, storeB, lampara, pantalla, 'accessory', 0)
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('lo que devuelve', () => {
  it('ids publicados y en el orden que fija el comercio, sin borradores ni publicaciones futuras', async () => {
    const rows = await relacionados(silla)
    expect(rows).toEqual([
      { related_product_id: cojin, relation_kind: 'accessory', position: 1 },
      { related_product_id: mesa, relation_kind: 'related', position: 2 },
      { related_product_id: funda, relation_kind: 'cross_sell', position: 3 },
    ])
  })

  it('solo ids, tipo y posición: ni precio, ni existencia, ni tenant', async () => {
    const [row] = await relacionados(silla)
    expect(Object.keys(row ?? {}).sort()).toEqual(['position', 'related_product_id', 'relation_kind'])
  })

  it('filtra por tipo', async () => {
    const rows = await relacionados(silla, { kinds: ['cross_sell', 'accessory'] })
    expect(rows.map((r) => r.related_product_id)).toEqual([cojin, funda])
  })

  it('un tipo desconocido es un error, no una lista vacía', async () => {
    const message = await expectFailure(() => relacionados(silla, { kinds: ['amigos'] }))
    expect(message).toMatch(/TIPO_RELACION_INVALIDO/)
  })

  it('respeta el techo pedido y nunca pasa de 24', async () => {
    expect(await relacionados(silla, { limit: 1 })).toHaveLength(1)
    expect(await relacionados(silla, { limit: 5000 })).toHaveLength(3)
  })
})

describe('lo que NO devuelve', () => {
  it('el grafo de un producto de origen que no está publicado', async () => {
    expect(await relacionados(borrador)).toEqual([])
  })

  it('un producto de OTRA tienda preguntado por el slug de esta', async () => {
    expect(await relacionados(lampara)).toEqual([])
  })

  it('cada tienda ve sus relaciones y ninguna de la otra', async () => {
    const rows = await relacionados(lampara, { slug: TENANT_B.storeSlug })
    expect(rows.map((r) => r.related_product_id)).toEqual([pantalla])
  })

  it('nada de una tienda que no está activa', async () => {
    await svc(`update public.stores set status = 'suspended' where id = $1`, [storeB])
    try {
      const message = await expectFailure(() => relacionados(lampara, { slug: TENANT_B.storeSlug }))
      expect(message).toMatch(/TIENDA_NO_DISPONIBLE/)
    } finally {
      await svc(`update public.stores set status = 'active' where id = $1`, [storeB])
    }
  })

  it('con surtido de canal declarado, lo que no está en el canal público no se sugiere', async () => {
    await svc(
      `insert into public.product_channels (organization_id, company_id, store_id, product_id, channel_id)
       select $1, $2, $3, p, $4 from unnest($5::uuid[]) as p`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, canalA, [silla, mesa]],
    )
    try {
      const rows = await relacionados(silla)
      expect(rows.map((r) => r.related_product_id)).toEqual([mesa])
    } finally {
      await svc(`delete from public.product_channels where channel_id = $1`, [canalA])
    }
  })

  it('con surtido de canal, un origen fuera de su canal no enseña nada', async () => {
    await svc(
      `insert into public.product_channels (organization_id, company_id, store_id, product_id, channel_id)
       values ($1, $2, $3, $4, $5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, mesa, canalA],
    )
    try {
      expect(await relacionados(silla)).toEqual([])
    } finally {
      await svc(`delete from public.product_channels where channel_id = $1`, [canalA])
    }
  })

  it('una tienda sin canal público devuelve vacío en vez de lanzar', async () => {
    await svc(`update public.channels set is_active = false where id = $1`, [canalA])
    try {
      expect(await relacionados(silla)).toEqual([])
    } finally {
      await svc(`update public.channels set is_active = true where id = $1`, [canalA])
    }
  })
})

describe('la puerta', () => {
  it('la ejecutan anon y authenticated', async () => {
    const rows = await svc<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'product_relations_for_slug'`,
    )
    expect(rows).toEqual([{ anon: true, auth: true }])
  })

  it('la tabla sigue cerrada para anon', async () => {
    const message = await expectFailure(() => anon(`select * from public.product_relations`))
    expect(message).toMatch(/permission denied/i)
  })
})