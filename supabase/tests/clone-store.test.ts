// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Crear una tienda a partir de otra (2026-11-24).
 *
 *  · copia configuración por secciones; nunca operación;
 *  · las categorías conservan el árbol con ids nuevos y las publicaciones las
 *    apuntan;
 *  · un secreto de pago no viaja: el medio que lo necesitaba nace inactivo;
 *  · solo dentro de la propia sociedad y con rol de administración de tiendas.
 */

let db: PGlite
let origen = ''
let producto = ''

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

async function clonar(claims: JwtClaims, slug: string, secciones: string[] | null = null, desde = origen) {
  const [r] = await as<{ r: Row }>(claims, `select public.clone_store($1::uuid, $2, $3, $4::text[]) as r`, [
    desde,
    slug,
    `Copia ${slug}`,
    secciones,
  ])
  return r?.r as Row
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
  origen = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)

  await svc(`update public.store_settings set accent_color = '#123456', hero_title = 'Bienvenidos' where store_id = $1`, [origen])
  const [padre] = await svc<{ id: string }>(
    `insert into public.categories (organization_id, company_id, store_id, slug, name) values ($1, $2, $3, 'salud', 'Salud') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, origen],
  )
  const [hija] = await svc<{ id: string }>(
    `insert into public.categories (organization_id, company_id, store_id, parent_id, slug, name)
     values ($1, $2, $3, $4, 'jarabes', 'Jarabes') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, origen, padre?.id],
  )
  const [p] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at, category_id)
     values ($1, $2, $3, 'CLON-1', 'clon-1', 'Jarabe Clon', '25.00', 'PEN', 10, 'published', now(), $4) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, origen, hija?.id],
  )
  producto = String(p?.id)
  // Un medio con secreto (como Culqi con su llave): no debe viajar. Esas
  // columnas solo se mueven con la marca de `payment_method_set_secret`.
  await svc(`select set_config('ebim.payment_secret_write', 'on', false)`)
  await svc(
    `update public.payment_methods set has_secret = true, secret_hint = '…abcd', is_active = true
      where store_id = $1 and code = (select code from public.payment_methods where store_id = $1 order by position limit 1)`,
    [origen],
  )
  await svc(`select set_config('ebim.payment_secret_write', '', false)`)
  const [w] = await svc<{ id: string }>(
    `insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'CLON', 'CD Clon') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  await svc(
    `insert into public.store_warehouses (organization_id, company_id, store_id, warehouse_id, priority)
     values ($1, $2, $3, $4, 1) on conflict do nothing`,
    [TENANT_A.organizationId, TENANT_A.companyId, origen, w?.id],
  )
})

afterAll(async () => {
  await db?.close()
})

describe('clonar una tienda', () => {
  it('copia diseño, árbol de categorías, publicaciones y abastecimiento; nace en borrador', async () => {
    const r = await clonar(owner, 'copia-completa')
    const nueva = String(r.id)
    expect(r.cloned_from).toBe(origen)

    const [tienda] = await svc<{ status: string; currency: string }>(`select status, currency from public.stores where id = $1`, [nueva])
    expect(tienda).toMatchObject({ status: 'draft', currency: 'PEN' })

    const [ajustes] = await svc<{ accent_color: string; hero_title: string }>(
      `select accent_color, hero_title from public.store_settings where store_id = $1`,
      [nueva],
    )
    expect(ajustes).toMatchObject({ accent_color: '#123456', hero_title: 'Bienvenidos' })

    const cats = await svc<{ slug: string; padre: string | null }>(
      `select c.slug, p.slug as padre from public.categories c left join public.categories p on p.id = c.parent_id
        where c.store_id = $1 order by c.slug`,
      [nueva],
    )
    expect(cats).toEqual([
      { slug: 'jarabes', padre: 'salud' },
      { slug: 'salud', padre: null },
    ])

    const [pub] = await svc<{ cat: string; price: string }>(
      `select c.slug as cat, sp.price::text as price from public.store_products sp
         join public.categories c on c.id = sp.category_id
        where sp.store_id = $1 and sp.product_id = $2`,
      [nueva, producto],
    )
    expect(pub?.cat).toBe('jarabes')
    expect(Number(pub?.price)).toBe(25)

    const abastece = await svc(`select 1 from public.store_warehouses where store_id = $1`, [nueva])
    expect(abastece.length).toBeGreaterThan(0)
  })

  it('un secreto de pago no viaja: el medio que lo tenía nace inactivo y sin pista', async () => {
    const r = await clonar(owner, 'copia-pagos', ['payments_delivery'])
    const conSecreto = await svc<{ has_secret: boolean; secret_hint: string | null; is_active: boolean }>(
      `select n.has_secret, n.secret_hint, n.is_active from public.payment_methods n
         join public.payment_methods o on o.code = n.code and o.store_id = $2 and o.has_secret
        where n.store_id = $1`,
      [r.id, origen],
    )
    expect(conSecreto).toEqual([{ has_secret: false, secret_hint: null, is_active: false }])
  })

  it('solo lo pedido: sin «catalog» no hay publicaciones; con slug repetido, error', async () => {
    const r = await clonar(owner, 'solo-diseno', ['design'])
    expect(await svc(`select 1 from public.store_products where store_id = $1`, [r.id])).toEqual([])
    expect(await svc(`select 1 from public.categories where store_id = $1`, [r.id])).toEqual([])
    expect(await fallo(() => clonar(owner, 'solo-diseno', ['design']))).toMatch(/SLUG|EXISTE|USO/i)
    expect(await fallo(() => clonar(owner, 'x-mala', ['pedidos']))).toMatch(/SECCION_INVALIDA/)
  })

  it('otra sociedad no puede clonar una tienda ajena', async () => {
    expect(await fallo(() => clonar(claimsFor(TENANT_B), 'robada'))).toMatch(/TIENDA_NO_ENCONTRADA/)
  })

  it('un rol sin administración de tiendas no clona', async () => {
    const catalogo = claimsFor(TENANT_A, {
      sub: '0f000000-0000-4000-8000-00000000d001',
      email: 'cat@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'catalog' }],
    })
    await svc(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, '0f000000-0000-4000-8000-00000000d001', 'cat@tenant-a.com', 'catalog') on conflict do nothing`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    expect(await fallo(() => clonar(catalogo, 'de-catalogo'))).toMatch(/SIN_PERMISO|42501|permiso/i)
  })
})
