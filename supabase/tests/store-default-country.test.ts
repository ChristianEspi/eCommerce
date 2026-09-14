// @vitest-environment node
/**
 * El país por defecto del checkout sale de la configuración de la tienda (H08).
 *
 * Lo que no puede fallar:
 *  - con zonas de entrega activas de UN solo país, ese es el defecto;
 *  - con varios países o sin zonas, no hay defecto (`null`), como antes;
 *  - una zona desactivada no cuenta;
 *  - cada tienda tiene el suyo: el de A no se filtra a B;
 *  - lo único que se publica es el código de país: `anon` sigue sin leer zonas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite
const tiendas: Record<string, string> = {}

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function anon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => (await db.query<T>(query, params)).rows)
}

async function paisPublicado(slug: string): Promise<unknown> {
  const [fila] = await anon(`select default_country from public.public_stores where slug = $1`, [slug])
  return fila?.default_country
}

async function zona(tenant: typeof TENANT_A, code: string, country: string, active = true) {
  await svc(
    `insert into public.delivery_zones (organization_id, company_id, store_id, code, name, country, is_active)
     values ($1, $2, $3, $4, $4, $5, $6)`,
    [tenant.organizationId, tenant.companyId, tiendas[tenant.storeSlug], code, country, active],
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
    const [store] = await svc<{ id: string }>(
      `update public.stores set status = 'active' where slug = $1 returning id`,
      [tenant.storeSlug],
    )
    tiendas[tenant.storeSlug] = String(store?.id)
  }
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('default_country en public_stores', () => {
  it('sin zonas de entrega no hay país por defecto', async () => {
    expect(await paisPublicado(TENANT_A.storeSlug)).toBeNull()
  })

  it('con zonas de un solo país, ese país', async () => {
    await zona(TENANT_A, 'lima', 'PE')
    await zona(TENANT_A, 'arequipa', 'PE')
    expect(await paisPublicado(TENANT_A.storeSlug)).toBe('PE')
  })

  it('el de A no se filtra a B, que no configuró nada', async () => {
    expect(await paisPublicado(TENANT_B.storeSlug)).toBeNull()
  })

  it('con dos países activos no se inventa uno', async () => {
    await zona(TENANT_A, 'santiago', 'CL')
    expect(await paisPublicado(TENANT_A.storeSlug)).toBeNull()
  })

  it('una zona desactivada no cuenta', async () => {
    await svc(`update public.delivery_zones set is_active = false where code = 'santiago'`)
    expect(await paisPublicado(TENANT_A.storeSlug)).toBe('PE')
  })

  it('cada tienda el suyo', async () => {
    await zona(TENANT_B, 'bogota', 'CO')
    expect(await paisPublicado(TENANT_B.storeSlug)).toBe('CO')
    expect(await paisPublicado(TENANT_A.storeSlug)).toBe('PE')
  })
})

describe('lo que se publica y lo que no', () => {
  it('una tienda no activa no revela su país ni por la función', async () => {
    await svc(`update public.stores set status = 'suspended' where slug = $1`, [TENANT_B.storeSlug])
    try {
      const [fila] = await anon<{ c: string | null }>(`select ebim.store_default_country($1) as c`, [
        tiendas[TENANT_B.storeSlug],
      ])
      expect(fila?.c).toBeNull()
    } finally {
      await svc(`update public.stores set status = 'active' where slug = $1`, [TENANT_B.storeSlug])
    }
  })

  it('`anon` sigue sin poder leer las zonas de entrega', async () => {
    const message = await expectFailure(() => anon(`select * from public.delivery_zones`))
    expect(message).toMatch(/permission denied/i)
  })

  it('la vista conserva sus columnas y solo gana `default_country`', async () => {
    const columnas = await svc<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'public_stores'
        order by ordinal_position`,
    )
    expect(columnas.map((c) => c.column_name)).toEqual([
      'store_id', 'slug', 'name', 'currency', 'domain', 'accent_color', 'logo_url', 'favicon_url',
      'white_label', 'default_locale', 'support_email', 'banner_url', 'hero_title', 'hero_subtitle',
      'contact_phone', 'contact_address', 'font_family', 'ui_radius', 'ui_density',
      'business_display_name', 'checkout_requires_account', 'theme_preset', 'storefront_style',
      'home_layout', 'default_country',
    ])
  })
})
