// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B } from './harness'

/**
 * `public.my_stores` — en qué tiendas compra quien pregunta.
 *
 * La regla que define esta función: **el vínculo lo pone el servidor**. No
 * acepta ni un argumento, igual que `my_business_accounts`, así que no existe
 * la clase de error que consiste en pedir «las tiendas de la cuenta X» para ver
 * dónde compra otro.
 *
 * El comprador NO es miembro del tenant: su sesión no trae `org_id` ni
 * `active_company`. Por eso estas pruebas usan un JWT sin jerarquía, que es
 * exactamente el que llega desde la vitrina.
 */

let db: PGlite

const COMPRADOR = '99999999-9999-4999-8999-999999999901'
const AJENO = '99999999-9999-4999-8999-999999999902'

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

/**
 * Sesión de COMPRADOR: hay `sub`, no hay jerarquía del hub.
 *
 * Es el token que produce quien se registró en la tienda, y el que hacía que
 * `/app` enseñara un cartel sin salida.
 */
function claimsComprador(userId: string) {
  return { ...claimsFor(TENANT_A), sub: userId, org_id: '', companies: [], active_company: '' }
}

async function comoComprador(userId: string) {
  return asRole(db, 'authenticated', claimsComprador(userId) as never, async () => {
    const rows = await svc<{ r: unknown }>(`select public.my_stores() as r`)
    return rows[0]?.r as Array<{ slug: string; name: string }>
  })
}

/** Cliente + cuenta B2B + persona vinculada, en la sociedad que se le diga. */
async function vincular(tenant: typeof TENANT_A, userId: string, code: string) {
  const cliente = await svc<{ id: string }>(
    `insert into public.customers (organization_id, company_id, kind, code, name)
     values ($1, $2, 'company', $3, $3) returning id`,
    [tenant.organizationId, tenant.companyId, code],
  )
  const cuenta = await svc<{ id: string }>(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, customer_kind, code, name)
     values ($1, $2, $3, 'company', $4, $4) returning id`,
    [tenant.organizationId, tenant.companyId, cliente[0]?.id, code],
  )
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, 'buyer', 'active')`,
    [tenant.organizationId, tenant.companyId, cuenta[0]?.id, userId, `${code}@compras.demo`],
  )
  return cuenta[0]?.id as string
}

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
  }
  await svc(`update public.stores set status = 'active'`)
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.business_account_users`)
  await svc(`delete from public.business_accounts`)
  await svc(`delete from public.customers`)
  await svc(`update public.stores set status = 'active'`)
})

describe('a qué tienda pertenece el comprador', () => {
  it('devuelve la tienda de SU sociedad', async () => {
    await vincular(TENANT_A, COMPRADOR, 'BOT01')

    const tiendas = await comoComprador(COMPRADOR)

    expect(tiendas).toEqual([{ slug: TENANT_A.storeSlug, name: expect.any(String) }])
  })

  it('NUNCA devuelve la tienda de otra sociedad', async () => {
    // El fallo que esto impide es el que hacía falta arreglar: mandar al
    // comprador de una empresa a la vitrina de otra.
    await vincular(TENANT_A, COMPRADOR, 'BOT01')
    await vincular(TENANT_B, AJENO, 'BOT02')

    const mias = await comoComprador(COMPRADOR)

    expect(mias.map((t) => t.slug)).toEqual([TENANT_A.storeSlug])
    expect(mias.map((t) => t.slug)).not.toContain(TENANT_B.storeSlug)
  })

  it('sin vínculo no devuelve ninguna', async () => {
    // Un empleado mal configurado del hub cae aquí: no es comprador de nadie,
    // y la lista vacía es lo que impide mandarlo a una vitrina cualquiera.
    expect(await comoComprador(COMPRADOR)).toEqual([])
  })

  it('un vínculo revocado deja de contar', async () => {
    await vincular(TENANT_A, COMPRADOR, 'BOT01')
    await svc(`update public.business_account_users set status = 'revoked'`)

    expect(await comoComprador(COMPRADOR)).toEqual([])
  })

  it('una tienda en borrador no es sitio al que mandar a comprar', async () => {
    await vincular(TENANT_A, COMPRADOR, 'BOT01')
    await svc(`update public.stores set status = 'draft'`)

    expect(await comoComprador(COMPRADOR)).toEqual([])
  })

  it('dos cuentas de la misma sociedad no duplican su tienda', async () => {
    await vincular(TENANT_A, COMPRADOR, 'BOT01')
    await vincular(TENANT_A, COMPRADOR, 'BOT02')

    expect(await comoComprador(COMPRADOR)).toHaveLength(1)
  })

  it('anónimo no puede ni preguntarlo', async () => {
    const puede = await svc<{ p: boolean }>(
      `select has_function_privilege('anon', 'public.my_stores()', 'EXECUTE') as p`,
    )
    expect(puede[0]?.p).toBe(false)
  })
})
