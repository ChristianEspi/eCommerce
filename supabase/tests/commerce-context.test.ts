// @vitest-environment node
/**
 * El contexto comercial de la sesión (H05-H06), sobre Postgres real.
 *
 * Lo que no puede fallar:
 *  - nombra la MISMA cuenta que usa el motor de precios (`ebim.pricing_actor`),
 *    incluso con varias cuentas: si no, la vitrina diría «comprando para A» y
 *    cobraría con el acuerdo de B;
 *  - «condiciones comerciales activas» solo cuando hay una lista activa y
 *    vigente asignada a su cliente o a su segmento, no por tener cuenta;
 *  - consumidor, invitado, revocado y cuenta de otro tenant: nada;
 *  - no devuelve ni un precio ni un id o código de lista, y no recibe identidad.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

const COMERCIANTE = '0d100000-0000-4000-8000-00000000a001'
const CORPORATIVO = '0d100000-0000-4000-8000-00000000a002'
const CONSUMIDOR = '0d100000-0000-4000-8000-00000000a003'
const INVITADO = '0d100000-0000-4000-8000-00000000a004'
const DOS_CUENTAS = '0d100000-0000-4000-8000-00000000a005'

let db: PGlite
let storeA = ''
let segmento = ''
let clienteCorp = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function id(query: string, params: unknown[]): Promise<string> {
  const [row] = await svc<{ id: string }>(query, params)
  return String(row?.id)
}

async function contexto(sub: string, slug = TENANT_A.storeSlug): Promise<Row | null> {
  const claims = { sub, email: `${sub}@test.test`, org_id: '', companies: [], active_company: '' }
  const [row] = await asRole(db, 'authenticated', claims, async () =>
    (await db.query<{ c: Row | null }>(`select public.my_commerce_context($1) as c`, [slug])).rows,
  )
  return row?.c ?? null
}

async function bootstrap(tenant: typeof TENANT_A): Promise<string> {
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    tenant.organizationId,
    tenant.companyId,
    tenant.slug,
    tenant.adminEmail,
    tenant.ownerId,
    tenant.storeSlug,
  ])
  return id(`update public.stores set status = 'active' where slug = $1 returning id`, [tenant.storeSlug])
}

async function cliente(code: string, name: string, segmentId: string | null): Promise<string> {
  return id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email, segment_id)
     values ($1, $2, 'company', $3, $4, $5, $6) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code, name, `${code.toLowerCase()}@cliente.test`, segmentId],
  )
}

async function cuenta(customerId: string, code: string, name: string, extra = ''): Promise<string> {
  return id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, $4, $5) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, customerId, code, name],
  ).then(async (accountId) => {
    if (extra) await svc(`update public.business_accounts set ${extra} where id = $1`, [accountId])
    return accountId
  })
}

async function vincular(accountId: string, userId: string, status = 'active', limit: string | null = null) {
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status, spending_limit)
     values ($1, $2, $3, $4, $5, 'buyer', $6::public.member_status, $7)`,
    [TENANT_A.organizationId, TENANT_A.companyId, accountId, userId, `${userId}@test.test`, status, limit],
  )
}

async function lista(code: string, scope: 'segment' | 'customer', target: string, validTo: string | null = null) {
  const listId = await id(
    `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency, valid_from, valid_to)
     values ($1, $2, $3, $4, $4, 'PEN', now() - interval '10 days', $5::timestamptz) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, code, validTo],
  )
  await svc(
    `insert into public.price_list_assignments
       (organization_id, company_id, store_id, price_list_id, scope, segment_id, customer_id)
     values ($1, $2, $3, $4, $5::public.price_scope, $6, $7)`,
    [
      TENANT_A.organizationId, TENANT_A.companyId, storeA, listId, scope,
      scope === 'segment' ? target : null,
      scope === 'customer' ? target : null,
    ],
  )
  return listId
}

beforeAll(async () => {
  db = await createTestDatabase()
  storeA = await bootstrap(TENANT_A)
  await bootstrap(TENANT_B)

  segmento = await id(
    `insert into public.customer_segments (organization_id, company_id, code, name)
     values ($1, $2, 'minorista', 'Minorista') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )

  // Un comercio que revende: sin aprobación, sin orden de compra, sin crédito.
  const bodega = await cliente('BOD-1', 'Bodega Esperanza', segmento)
  const cuentaBodega = await cuenta(bodega, 'BOD', 'Bodega Esperanza')
  await vincular(cuentaBodega, COMERCIANTE)
  await vincular(cuentaBodega, INVITADO, 'invited')
  await lista('minorista', 'segment', segmento)

  // Una empresa con procesos: aprobación, crédito, dos sedes y tope por persona.
  clienteCorp = await cliente('CORP-1', 'Corporación Andina SAC', null)
  const cuentaCorp = await cuenta(
    clienteCorp,
    'CORP',
    'Corporación Andina SAC',
    `requires_approval = true, credit_limit = 5000, payment_terms_days = 30`,
  )
  await vincular(cuentaCorp, CORPORATIVO, 'active', '1500.00')
  for (const [code, name] of [['LIM', 'Sede Lima'], ['ARE', 'Sede Arequipa']]) {
    await svc(
      `insert into public.business_locations (organization_id, company_id, business_account_id, customer_id, code, name)
       values ($1, $2, $3, $4, $5, $6)`,
      [TENANT_A.organizationId, TENANT_A.companyId, cuentaCorp, clienteCorp, code, name],
    )
  }
  // Su convenio CADUCÓ: tener cuenta no es tener condiciones activas.
  await lista('convenio-viejo', 'customer', clienteCorp, new Date(Date.now() - 86_400_000).toISOString())

  // Alguien con dos cuentas en la misma sociedad: la más antigua es la Bodega.
  await vincular(cuentaBodega, DOS_CUENTAS)
  await vincular(cuentaCorp, DOS_CUENTAS)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('quién compra, para pintarlo', () => {
  it('el comercio: su cuenta, sin controles corporativos y con condiciones activas', async () => {
    expect(await contexto(COMERCIANTE)).toEqual({
      account_name: 'Bodega Esperanza',
      account_code: 'BOD',
      customer_name: 'Bodega Esperanza',
      requires_approval: false,
      purchase_order_required: false,
      has_spending_limit: false,
      has_credit_terms: false,
      locations_count: 0,
      has_commercial_pricing: true,
      accounts_in_store: 1,
    })
  })

  it('la empresa: sus controles, y SIN condiciones activas si el convenio caducó', async () => {
    expect(await contexto(CORPORATIVO)).toMatchObject({
      account_name: 'Corporación Andina SAC',
      requires_approval: true,
      has_spending_limit: true,
      has_credit_terms: true,
      locations_count: 2,
      has_commercial_pricing: false,
    })
  })

  it('en cuanto hay un convenio vigente, lo dice', async () => {
    const listId = await lista('convenio-2026', 'customer', clienteCorp)
    try {
      expect(await contexto(CORPORATIVO)).toMatchObject({ has_commercial_pricing: true })
    } finally {
      await svc(`delete from public.price_lists where id = $1`, [listId])
    }
  })

  it('una lista desactivada no cuenta como condición activa', async () => {
    await svc(`update public.price_lists set is_active = false where code = 'minorista'`)
    try {
      expect(await contexto(COMERCIANTE)).toMatchObject({ has_commercial_pricing: false })
    } finally {
      await svc(`update public.price_lists set is_active = true where code = 'minorista'`)
    }
  })

  it('con dos cuentas nombra la MISMA que usa el motor de precios', async () => {
    const ctx = await contexto(DOS_CUENTAS)
    expect(ctx).toMatchObject({ account_name: 'Bodega Esperanza', accounts_in_store: 2 })

    const claims = { sub: DOS_CUENTAS, email: 'x@test.test', org_id: '', companies: [], active_company: '' }
    const [actor] = await asRole(db, 'authenticated', claims, async () => {
      await db.exec('reset role; set role service_role;')
      return (
        await db.query<{ name: string }>(`select (ebim.pricing_actor($1, $2)).name as name`, [
          TENANT_A.organizationId,
          TENANT_A.companyId,
        ])
      ).rows
    })
    expect(actor?.name).toBe(ctx?.customer_name)
  })
})

describe('a quién no se le pinta nada', () => {
  it('consumidor sin vínculo', async () => {
    expect(await contexto(CONSUMIDOR)).toBeNull()
  })

  it('invitado todavía sin activar', async () => {
    expect(await contexto(INVITADO)).toBeNull()
  })

  it('una cuenta de A no se pinta en la tienda de B', async () => {
    expect(await contexto(COMERCIANTE, TENANT_B.storeSlug)).toBeNull()
  })

  it('una tienda que no existe o no está activa', async () => {
    expect(await contexto(COMERCIANTE, 'no-existe')).toBeNull()
  })

  it('`anon` no puede ejecutarla', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, async () =>
        (await db.query(`select public.my_commerce_context($1)`, [TENANT_A.storeSlug])).rows,
      ),
    )
    expect(message).toMatch(/permission denied/i)
  })
})

describe('no revela precios ni acepta identidad', () => {
  it('ni un precio, ni un id, ni un código de lista en la respuesta', async () => {
    const ctx = (await contexto(COMERCIANTE)) ?? {}
    for (const clave of Object.keys(ctx)) {
      expect(clave).not.toMatch(/price_list|list_id|list_code|unit_price|segment_id|customer_id|organization_id|company_id/)
    }
    expect(JSON.stringify(ctx)).not.toContain('minorista')
  })

  it('la firma solo lleva el slug de la tienda', async () => {
    const [row] = await svc<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'my_commerce_context'`,
    )
    expect(row?.args).toBe('p_store_slug text')
  })
})
