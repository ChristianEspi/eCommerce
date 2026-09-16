// @vitest-environment node
/**
 * Tiendas en autoservicio sobre Postgres REAL (PGlite) — Stores + Product Master, fase 02.
 *
 * Lo que queda fijado: una sociedad existente crea su segunda tienda sin volver
 * a pasar por `bootstrap_tenant`; el tenant sale del JWT y no hay parámetro para
 * declararlo; solo owner/admin; la tienda nace coherente (ajustes 1:1, canal por
 * defecto, `draft`); las colisiones de slug y dominio tienen código propio; y
 * nadie mueve una tienda a otra sociedad ni administra la de otro tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
type Tenant = typeof TENANT_A

let db: PGlite
let storeA1: string
let storeB1: string

const USERS = {
  admin: '0a000000-0000-4000-8000-0000000000e1',
  catalog: '0a000000-0000-4000-8000-0000000000e2',
  orders: '0a000000-0000-4000-8000-0000000000e3',
  viewer: '0a000000-0000-4000-8000-0000000000e4',
} as const

/** Una sociedad de A a la que el owner NO pertenece. */
const FOREIGN_COMPANY = '0a000000-0000-4000-8000-0000000000c9'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

const svc = (query: string, params: unknown[] = []) => asRole(db, 'service_role', null, () => sql(query, params))

function member(role: keyof typeof USERS): JwtClaims {
  return claimsFor(TENANT_A, {
    sub: USERS[role],
    email: `${role}@tenant-a.com`,
    companies: [{ id: TENANT_A.companyId, role }],
  })
}

async function as<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []): Promise<T> {
  const rows = await asRole(db, 'authenticated', claims, () => sql(query, params))
  return rows[0]?.r as T
}

const createStore = (claims: JwtClaims, slug: string, name = 'Tienda nueva', currency = 'PEN', domain: string | null = null) =>
  as<Row>(claims, 'select public.create_store($1, $2, $3, $4) as r', [slug, name, currency, domain])

async function syncWith(tenant: Tenant, entitlements: string[]): Promise<void> {
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    tenant.organizationId,
    tenant.companyId,
    entitlements,
  ])
}

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await sql(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
        tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
      ])
    }
    const stores = await sql(`select id, slug from public.stores order by slug`)
    storeA1 = String(stores.find((s) => s.slug === TENANT_A.storeSlug)?.id)
    storeB1 = String(stores.find((s) => s.slug === TENANT_B.storeSlug)?.id)
    for (const role of Object.keys(USERS) as Array<keyof typeof USERS>) {
      await sql(
        `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
         values ($1, $2, $3, $4, $5, 'active')`,
        [TENANT_A.organizationId, TENANT_A.companyId, USERS[role], `${role}@tenant-a.com`, role],
      )
    }
  })
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('create_store', () => {
  it('la sociedad A crea su segunda tienda con el tenant del JWT, en draft y sin tenant nuevo', async () => {
    const tenantsBefore = Number((await svc('select count(*)::int as n from public.tenants'))[0]?.n)

    const created = await createStore(claimsFor(TENANT_A), '  Tienda-A2 ', ' Outlet A ', 'usd')

    expect(created).toMatchObject({
      organization_id: TENANT_A.organizationId,
      company_id: TENANT_A.companyId,
      slug: 'tienda-a2',
      name: 'Outlet A',
      status: 'draft',
      currency: 'USD',
      domain: null,
    })
    expect(Number((await svc('select count(*)::int as n from public.tenants'))[0]?.n)).toBe(tenantsBefore)

    const id = String(created.id)
    expect(await svc('select count(*)::int as n from public.store_settings where store_id = $1', [id])).toEqual([{ n: 1 }])
    expect(
      await svc(
        `select code, kind::text, is_default, requires_auth, is_active from public.channels where store_id = $1`,
        [id],
      ),
    ).toEqual([{ code: 'b2c', kind: 'b2c', is_default: true, requires_auth: false, is_active: true }])

    // El owner la ve con sus propios permisos: es lo que refresca el backoffice.
    const visible = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql('select slug from public.stores order by slug'),
    )
    expect(visible.map((row) => row.slug)).toEqual([TENANT_A.storeSlug, 'tienda-a2'])
  })

  it('un admin también puede; catalog, orders y viewer no, aunque llamen directo', async () => {
    await expect(createStore(member('admin'), 'tienda-admin')).resolves.toMatchObject({ slug: 'tienda-admin' })
    for (const role of ['catalog', 'orders', 'viewer'] as const) {
      expect(await expectFailure(() => createStore(member(role), `tienda-${role}`))).toMatch(/SIN_PERMISO/)
    }
    expect(await svc(`select slug from public.stores where slug in ('tienda-catalog','tienda-orders','tienda-viewer')`)).toEqual([])
  })

  it('una sociedad activa que no está en los claims no sirve para crear', async () => {
    const claims = claimsFor(TENANT_A, { active_company: FOREIGN_COMPANY })
    expect(await expectFailure(() => createStore(claims, 'tienda-ajena'))).toMatch(/SIN_CONTEXTO/)
  })

  it('el tenant B crea en B aunque conozca el uuid de A: no hay parámetro para declararlo', async () => {
    const created = await createStore(claimsFor(TENANT_B), 'tienda-b2')
    expect(created).toMatchObject({ organization_id: TENANT_B.organizationId, company_id: TENANT_B.companyId })
  })

  it('slug y dominio repetidos tienen código propio, también contra otro tenant', async () => {
    expect(await expectFailure(() => createStore(claimsFor(TENANT_A), TENANT_B.storeSlug))).toMatch(/TIENDA_SLUG_DUPLICADO/)
    expect(await expectFailure(() => createStore(claimsFor(TENANT_A), 'a'))).toMatch(/TIENDA_SLUG_INVALIDO/)
    expect(await expectFailure(() => createStore(claimsFor(TENANT_A), 'tienda-xx', 'x', 'XXX'))).toMatch(/MONEDA_NO_ADMITIDA/)
    expect(await expectFailure(() => createStore(claimsFor(TENANT_A), 'tienda-yy', '  '))).toMatch(/TIENDA_NOMBRE_INVALIDO/)

    // Sin marca blanca no hay dominio propio.
    expect(await expectFailure(() => createStore(claimsFor(TENANT_A), 'tienda-dom', 'D', 'PEN', 'tienda.example.com'))).toMatch(
      /MODULO_NO_CONTRATADO/,
    )

    await syncWith(TENANT_A, ['ecommerce.content.white_label'])
    await syncWith(TENANT_B, ['ecommerce.content.white_label'])
    await expect(createStore(claimsFor(TENANT_A), 'tienda-dom', 'D', 'PEN', 'Tienda.Example.com')).resolves.toMatchObject({
      domain: 'tienda.example.com',
    })
    expect(await expectFailure(() => createStore(claimsFor(TENANT_B), 'tienda-dom-b', 'D', 'PEN', 'tienda.example.com'))).toMatch(
      /TIENDA_DOMINIO_DUPLICADO/,
    )
    expect(await expectFailure(() => createStore(claimsFor(TENANT_A), 'tienda-dom2', 'D', 'PEN', 'no_valido'))).toMatch(
      /TIENDA_DOMINIO_INVALIDO/,
    )
  })

  it('ni anónimo ni el operador de la suite', async () => {
    expect(
      await expectFailure(() => asRole(db, 'anon', null, () => sql(`select public.create_store('x-anon', 'X', 'PEN')`))),
    ).toMatch(/permission denied/)
    const operador = claimsFor(TENANT_A, { email: 'dcalagua@ebim.pe' })
    expect(await expectFailure(() => createStore(operador, 'tienda-operador'))).toMatch(/OPERADOR_NO_ES_ACTOR/)
  })
})

describe('update_store y set_store_status', () => {
  it('edita nombre y slug; NULL no toca', async () => {
    const updated = await as<Row>(claimsFor(TENANT_A), 'select public.update_store($1, $2, $3) as r', [
      storeA1,
      'Tienda A renombrada',
      null,
    ])
    expect(updated).toMatchObject({ name: 'Tienda A renombrada', slug: TENANT_A.storeSlug })
  })

  it('la tienda de otro tenant no existe para quien pregunta', async () => {
    expect(
      await expectFailure(() => as(claimsFor(TENANT_A), 'select public.update_store($1, $2) as r', [storeB1, 'Hackeada'])),
    ).toMatch(/TIENDA_NO_ENCONTRADA/)
    expect(await svc('select name from public.stores where id = $1', [storeB1])).toEqual([{ name: `Tienda ${TENANT_B.slug}` }])
  })

  it('catalog no administra tiendas', async () => {
    expect(
      await expectFailure(() => as(member('catalog'), 'select public.set_store_status($1, $2) as r', [storeA1, 'active'])),
    ).toMatch(/SIN_PERMISO/)
  })

  it('activa y suspende con un estado válido', async () => {
    expect(await as<Row>(claimsFor(TENANT_A), 'select public.set_store_status($1, $2) as r', [storeA1, 'active'])).toMatchObject({
      status: 'active',
    })
    expect(await as<Row>(claimsFor(TENANT_A), 'select public.set_store_status($1, $2) as r', [storeA1, 'suspended'])).toMatchObject({
      status: 'suspended',
    })
    expect(
      await expectFailure(() => as(claimsFor(TENANT_A), 'select public.set_store_status($1, $2) as r', [storeA1, 'borrada'])),
    ).toMatch(/TIENDA_ESTADO_INVALIDO/)
  })

  it('la moneda solo cambia sin datos en la moneda anterior', async () => {
    const empty = await createStore(claimsFor(TENANT_A), 'tienda-moneda')
    await expect(
      as<Row>(claimsFor(TENANT_A), 'select public.update_store($1, p_currency => $2) as r', [empty.id, 'USD']),
    ).resolves.toMatchObject({ currency: 'USD' })

    await svc(
      `insert into public.products (organization_id, company_id, store_id, sku, slug, name, price, currency)
       values ($1, $2, $3, 'MON-1', 'mon-1', 'Con precio', '10.00', 'USD')`,
      [TENANT_A.organizationId, TENANT_A.companyId, empty.id],
    )
    expect(
      await expectFailure(() => as(claimsFor(TENANT_A), 'select public.update_store($1, p_currency => $2) as r', [empty.id, 'PEN'])),
    ).toMatch(/TIENDA_MONEDA_EN_USO/)
  })

  it('cambiar el dominio reinicia la verificación del anterior', async () => {
    const store = await createStore(claimsFor(TENANT_A), 'tienda-verif', 'V', 'PEN', 'verif.example.com')
    await asRole(db, 'authenticated', claimsFor(TENANT_A), () => sql('select public.store_domain_claim($1)', [store.id]))
    expect(await svc('select custom_domain_status from public.store_settings where store_id = $1', [store.id])).toEqual([
      { custom_domain_status: 'pending' },
    ])

    await as(claimsFor(TENANT_A), 'select public.update_store($1, p_domain => $2) as r', [store.id, 'otro.example.com'])
    expect(
      await svc('select custom_domain_status, custom_domain_token from public.store_settings where store_id = $1', [store.id]),
    ).toEqual([{ custom_domain_status: 'none', custom_domain_token: null }])
  })

  it('una tienda no se mueve a otra sociedad ni con un UPDATE directo', async () => {
    expect(
      await expectFailure(() =>
        asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
          sql('update public.stores set company_id = $1 where id = $2', [FOREIGN_COMPANY, storeA1]),
        ),
      ),
    ).toMatch(/TIENDA_TENANT_INMUTABLE|row-level security/)
    expect(
      await expectFailure(() => svc('update public.stores set company_id = $1 where id = $2', [FOREIGN_COMPANY, storeA1])),
    ).toMatch(/TIENDA_TENANT_INMUTABLE/)
  })
})
