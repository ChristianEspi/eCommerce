// @vitest-environment node
/**
 * N01 · UNA sola cuenta B2B efectiva, sobre Postgres real.
 *
 * Lo que no puede fallar: la cuenta que se muestra, la que fija el precio, la
 * que resuelve el checkout y la que queda en el pedido son SIEMPRE la misma.
 *
 * El checkout se prueba de verdad: el pipeline (`runCheckout`) con el adaptador
 * de producción (`createDbPorts`) sobre esta base, con el llamante actuando con
 * el JWT del comprador y el servicio con `service_role`, igual que en la Edge
 * Function. Ningún puerto falso decide la cuenta.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import { runCheckout } from '../functions/_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'

type Row = Record<string, unknown>

const PRICING = 'ecommerce.pricing.lists'
const WAREHOUSE = 'ecommerce.inventory.multiwarehouse'
const DOS_CUENTAS = '0f100000-0000-4000-8000-00000000d001'
const OTRA_PERSONA = '0f100000-0000-4000-8000-00000000d002'
const CONSUMIDOR = '0f100000-0000-4000-8000-00000000d003'

let db: PGlite
let storeA = ''
let jabon = ''
let cuentaA = ''
let cuentaB = ''
let cuentaAjena = ''
let cuentaOtraSociedad = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

function shopper(sub: string) {
  return { sub, email: `${sub}@compras.test`, org_id: '', companies: [], active_company: '' }
}

async function as<T = Row>(sub: string, query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'authenticated', shopper(sub), async () => (await db.query<T>(query, params)).rows)
}

async function id(query: string, params: unknown[]): Promise<string> {
  const [row] = await svc<{ id: string }>(query, params)
  return String(row?.id)
}

/** Un `RpcCaller` sobre esta base: lo mismo que hace `supabase.rpc`, con el rol dado. */
function pgCaller(role: 'authenticated' | 'service_role', sub: string | null): RpcCaller {
  return async (fn, args) =>
    asRole(db, role, sub ? shopper(sub) : null, async () => {
      const keys = Object.keys(args)
      const values = keys.map((key) => {
        const value = args[key]
        return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
      })
      const call = keys.map((key, index) => `${key} => $${index + 1}`).join(', ')
      const { rows } = await db.query<{ r: unknown }>(`select public.${fn}(${call}) as r`, values)
      return rows[0]?.r ?? null
    })
}

function ports(sub: string | null) {
  return createDbPorts({
    service: pgCaller('service_role', null),
    caller: pgCaller('authenticated', sub),
    hasSession: sub !== null,
  })
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

async function cliente(tenant: typeof TENANT_A, code: string): Promise<string> {
  return id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', $3, $3, $4) returning id`,
    [tenant.organizationId, tenant.companyId, code, `${code.toLowerCase()}@cliente.test`],
  )
}

async function cuenta(tenant: typeof TENANT_A, customerId: string, code: string, name: string, createdAt: string) {
  return id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name, created_at)
     values ($1, $2, $3, $4, $5, $6::timestamptz) returning id`,
    [tenant.organizationId, tenant.companyId, customerId, code, name, createdAt],
  )
}

async function vincular(tenant: typeof TENANT_A, accountId: string, userId: string, status = 'active') {
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, 'buyer', $6::public.member_status)`,
    [tenant.organizationId, tenant.companyId, accountId, userId, `${userId}@compras.test`, status],
  )
}

/** Convenio de cliente: el jabón a `price` para ese cliente. */
async function convenio(customerId: string, code: string, price: string) {
  const listId = await id(
    `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency, valid_from)
     values ($1, $2, $3, $4, $4, 'PEN', now() - interval '1 day') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, code],
  )
  await svc(
    `insert into public.price_list_assignments
       (organization_id, company_id, store_id, price_list_id, scope, customer_id)
     values ($1, $2, $3, $4, 'customer', $5)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, listId, customerId],
  )
  await svc(
    `insert into public.price_list_items
       (organization_id, company_id, store_id, price_list_id, product_id, min_quantity, unit_price)
     values ($1, $2, $3, $4, $5, 1, $6)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, listId, jabon, price],
  )
}

async function efectiva(sub: string, slug = TENANT_A.storeSlug): Promise<Row | null> {
  const [row] = await as<{ r: Row | null }>(sub, `select public.my_effective_business_account_for_slug($1) as r`, [slug])
  return row?.r ?? null
}

async function elegibles(sub: string, slug = TENANT_A.storeSlug): Promise<Row[]> {
  const [row] = await as<{ r: Row[] }>(sub, `select public.my_store_business_accounts($1) as r`, [slug])
  return row?.r ?? []
}

async function elegir(sub: string, accountId: string, slug = TENANT_A.storeSlug): Promise<Row | null> {
  const [row] = await as<{ r: Row | null }>(sub, `select public.select_store_business_account($1, $2) as r`, [slug, accountId])
  return row?.r ?? null
}

async function contexto(sub: string): Promise<Row | null> {
  const [row] = await as<{ c: Row | null }>(sub, `select public.my_commerce_context($1) as c`, [TENANT_A.storeSlug])
  return row?.c ?? null
}

/** Nombre del cliente que `ebim.pricing_actor` ve para esta sesión. */
async function actor(sub: string): Promise<string | null> {
  const [row] = await asRole(db, 'authenticated', shopper(sub), async () => {
    await db.exec('reset role; set role service_role;')
    return (
      await db.query<{ name: string | null }>(`select (ebim.pricing_actor($1, $2)).name as name`, [
        TENANT_A.organizationId,
        TENANT_A.companyId,
      ])
    ).rows
  })
  return row?.name ?? null
}

async function precio(sub: string | null): Promise<string> {
  const run = async () =>
    (
      await db.query<{ q: Row }>(`select public.price_quote_for_slug($1, $2::jsonb) as q`, [
        TENANT_A.storeSlug,
        JSON.stringify([{ product_id: jabon, quantity: 1 }]),
      ])
    ).rows
  const [row] = sub ? await asRole(db, 'authenticated', shopper(sub), run) : await asRole(db, 'anon', null, run)
  return String(((row?.q.lines as Row[]) ?? [])[0]?.unit_price)
}

let compras = 0
async function comprar(sub: string | null) {
  compras += 1
  await svc(`delete from public.checkout_attempts`)
  const input = await parseCheckoutBody({
    store_slug: TENANT_A.storeSlug,
    idempotency_key: `n01-multicuenta-${compras}-${'x'.repeat(24)}`,
    customer_email: 'compras@empresa.test',
    customer_name: 'Compras Empresa',
    customer_phone: '+51 999 000 111',
    shipping_address: { address: 'Av. Industrial 450', city: 'Lima', country: 'PE' },
    items: [{ product_id: jabon, quantity: 2 }],
  })
  const result = await runCheckout(ports(sub), input)
  const [order] = await svc<{ business_account_id: string | null; unit_price: string }>(
    `select o.business_account_id, i.unit_price::text as unit_price
       from public.orders o join public.order_items i on i.order_id = o.id
      where o.id = $1`,
    [result.order.orderId],
  )
  return order
}

beforeAll(async () => {
  db = await createTestDatabase()
  storeA = await bootstrap(TENANT_A)
  await bootstrap(TENANT_B)
  await svc(`update public.store_settings set tax_rate = 0`)
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
      tenant.organizationId,
      tenant.companyId,
      [PRICING, WAREHOUSE],
    ])
  }

  jabon = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'N01-JABON', 'n01-jabon', 'Jabón industrial', '10.00', 'PEN', 1000, 'published', now())
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  // Con almacén: la reserva del pipeline es la de verdad.
  await svc(`insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'LIMA', 'Lima')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
  ])
  await asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
    db.query(`select public.seed_inventory_from_catalog((select id from public.warehouses where code = 'LIMA'), $1)`, [
      storeA,
    ]),
  )

  // A es la más antigua; B se eligió después. Nombres al revés del orden de
  // creación a propósito: «la primera por nombre» (la regla vieja del checkout)
  // sería B, y «la más antigua» (la del precio) sería A.
  const clienteA = await cliente(TENANT_A, 'ZETA-SAC')
  const clienteB = await cliente(TENANT_A, 'ALFA-SAC')
  cuentaA = await cuenta(TENANT_A, clienteA, 'ZETA', 'Zeta Distribuciones', '2026-01-01T00:00:00Z')
  cuentaB = await cuenta(TENANT_A, clienteB, 'ALFA', 'Alfa Corporativo', '2026-02-01T00:00:00Z')
  await convenio(clienteA, 'convenio-zeta', '8.00')
  await convenio(clienteB, 'convenio-alfa', '6.00')
  await vincular(TENANT_A, cuentaA, DOS_CUENTAS)
  await vincular(TENANT_A, cuentaB, DOS_CUENTAS)

  // La cuenta de otra persona en la misma sociedad.
  const clienteAjeno = await cliente(TENANT_A, 'AJENO-SAC')
  cuentaAjena = await cuenta(TENANT_A, clienteAjeno, 'AJENO', 'Ajeno SAC', '2026-01-15T00:00:00Z')
  await vincular(TENANT_A, cuentaAjena, OTRA_PERSONA)

  // Una cuenta de la MISMA persona, pero de otra sociedad vendedora.
  const clienteOtra = await cliente(TENANT_B, 'OTRA-SAC')
  cuentaOtraSociedad = await cuenta(TENANT_B, clienteOtra, 'OTRA', 'Aaa Otra Sociedad', '2025-01-01T00:00:00Z')
  await vincular(TENANT_B, cuentaOtraSociedad, DOS_CUENTAS)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('sin elección: fallback determinista a la más antigua de ESA sociedad', () => {
  it('1 · la efectiva es A, y el selector ofrece A y B marcando A', async () => {
    expect((await efectiva(DOS_CUENTAS))?.account_id).toBe(cuentaA)
    const lista = await elegibles(DOS_CUENTAS)
    expect(lista.map((c) => c.account_id).sort()).toEqual([cuentaA, cuentaB].sort())
    expect(lista.find((c) => c.is_effective === true)?.account_id).toBe(cuentaA)
    // Ni la cuenta de la otra sociedad ni la de otra persona.
    expect(lista.map((c) => c.account_id)).not.toContain(cuentaOtraSociedad)
    expect(lista.map((c) => c.account_id)).not.toContain(cuentaAjena)
  })

  it('precio, contexto y checkout coinciden en A', async () => {
    expect(await actor(DOS_CUENTAS)).toBe('ZETA-SAC')
    expect(await precio(DOS_CUENTAS)).toBe('8.00')
    expect(await contexto(DOS_CUENTAS)).toMatchObject({ account_name: 'Zeta Distribuciones', accounts_in_store: 2 })
    expect((await ports(DOS_CUENTAS).resolveAccount(TENANT_A.storeSlug)).accountId).toBe(cuentaA)
  })
})

describe('elegir B mueve TODO a B', () => {
  it('2 · seleccionar B devuelve B', async () => {
    expect((await elegir(DOS_CUENTAS, cuentaB))?.account_id).toBe(cuentaB)
    expect((await elegibles(DOS_CUENTAS)).find((c) => c.is_effective === true)?.account_id).toBe(cuentaB)
  })

  it('3 · pricing_actor pasa a B y el precio es el de su convenio', async () => {
    expect(await actor(DOS_CUENTAS)).toBe('ALFA-SAC')
    expect(await precio(DOS_CUENTAS)).toBe('6.00')
  })

  it('4 · my_commerce_context muestra B', async () => {
    expect(await contexto(DOS_CUENTAS)).toMatchObject({ account_name: 'Alfa Corporativo', customer_name: 'ALFA-SAC' })
  })

  it('5 · el checkout resuelve B', async () => {
    const account = await ports(DOS_CUENTAS).resolveAccount(TENANT_A.storeSlug)
    expect(account).toMatchObject({ accountId: cuentaB, role: 'buyer' })
  })

  it('6 · el pedido queda firmado por B y cobrado con el precio de B', async () => {
    expect(await comprar(DOS_CUENTAS)).toEqual({ business_account_id: cuentaB, unit_price: '6.00' })
  })

  it('elegir es idempotente: una sola fila de preferencia por persona y sociedad', async () => {
    await elegir(DOS_CUENTAS, cuentaB)
    const [row] = await svc<{ n: number }>(
      `select count(*)::int as n from public.buyer_account_selections where user_id = $1`,
      [DOS_CUENTAS],
    )
    expect(row?.n).toBe(1)
  })
})

describe('lo que no se puede elegir', () => {
  it('7 · una cuenta propia de OTRA sociedad se rechaza y no toca la preferencia', async () => {
    const message = await expectFailure(() => elegir(DOS_CUENTAS, cuentaOtraSociedad))
    expect(message).toMatch(/CUENTA_NO_DISPONIBLE/)
    expect((await efectiva(DOS_CUENTAS))?.account_id).toBe(cuentaB)
  })

  it('8 · la cuenta de OTRA persona se rechaza y no toca la preferencia', async () => {
    const message = await expectFailure(() => elegir(DOS_CUENTAS, cuentaAjena))
    expect(message).toMatch(/CUENTA_NO_DISPONIBLE/)
    expect((await efectiva(DOS_CUENTAS))?.account_id).toBe(cuentaB)
    expect(await precio(DOS_CUENTAS)).toBe('6.00')
  })

  it('un uuid inventado da el mismo error que una cuenta ajena', async () => {
    const message = await expectFailure(() => elegir(DOS_CUENTAS, '0f100000-0000-4000-8000-0000000000ff'))
    expect(message).toMatch(/CUENTA_NO_DISPONIBLE/)
  })

  it('la otra persona tampoco puede elegir la de nadie más', async () => {
    const message = await expectFailure(() => elegir(OTRA_PERSONA, cuentaB))
    expect(message).toMatch(/CUENTA_NO_DISPONIBLE/)
    expect((await efectiva(OTRA_PERSONA))?.account_id).toBe(cuentaAjena)
  })

  it('en la tienda de la otra sociedad se elige entre SUS cuentas, sin mezclar', async () => {
    expect((await elegibles(DOS_CUENTAS, TENANT_B.storeSlug)).map((c) => c.account_id)).toEqual([cuentaOtraSociedad])
    const message = await expectFailure(() => elegir(DOS_CUENTAS, cuentaB, TENANT_B.storeSlug))
    expect(message).toMatch(/CUENTA_NO_DISPONIBLE/)
  })
})

describe('9 · una preferencia que deja de ser válida se ignora', () => {
  it('vínculo revocado → cae a A en precio, contexto, checkout y pedido', async () => {
    await svc(`update public.business_account_users set status = 'revoked' where business_account_id = $1 and user_id = $2`, [
      cuentaB,
      DOS_CUENTAS,
    ])
    try {
      expect((await efectiva(DOS_CUENTAS))?.account_id).toBe(cuentaA)
      expect(await actor(DOS_CUENTAS)).toBe('ZETA-SAC')
      expect(await precio(DOS_CUENTAS)).toBe('8.00')
      expect(await contexto(DOS_CUENTAS)).toMatchObject({ account_name: 'Zeta Distribuciones', accounts_in_store: 1 })
      expect(await comprar(DOS_CUENTAS)).toEqual({ business_account_id: cuentaA, unit_price: '8.00' })
      // Y la cuenta revocada tampoco se puede volver a elegir.
      expect(await expectFailure(() => elegir(DOS_CUENTAS, cuentaB))).toMatch(/CUENTA_NO_DISPONIBLE/)
    } finally {
      await svc(`update public.business_account_users set status = 'active' where business_account_id = $1 and user_id = $2`, [
        cuentaB,
        DOS_CUENTAS,
      ])
    }
    // Restaurado el vínculo, la elección guardada vuelve a mandar.
    expect((await efectiva(DOS_CUENTAS))?.account_id).toBe(cuentaB)
  })

  it('cuenta desactivada → cae a A', async () => {
    await svc(`update public.business_accounts set is_active = false where id = $1`, [cuentaB])
    try {
      expect((await efectiva(DOS_CUENTAS))?.account_id).toBe(cuentaA)
      expect(await precio(DOS_CUENTAS)).toBe('8.00')
    } finally {
      await svc(`update public.business_accounts set is_active = true where id = $1`, [cuentaB])
    }
  })

  it('cliente desactivado → cae a A', async () => {
    await svc(`update public.customers set is_active = false where code = 'ALFA-SAC'`)
    try {
      expect((await efectiva(DOS_CUENTAS))?.account_id).toBe(cuentaA)
      expect(await contexto(DOS_CUENTAS)).toMatchObject({ account_name: 'Zeta Distribuciones' })
    } finally {
      await svc(`update public.customers set is_active = true where code = 'ALFA-SAC'`)
    }
  })
})

describe('10 · el consumidor sin cuenta sigue siendo consumidor', () => {
  it('nada efectivo, nada que elegir, precio público y pedido sin cuenta', async () => {
    expect(await efectiva(CONSUMIDOR)).toBeNull()
    expect(await elegibles(CONSUMIDOR)).toEqual([])
    expect(await contexto(CONSUMIDOR)).toBeNull()
    expect(await actor(CONSUMIDOR)).toBeNull()
    expect(await precio(CONSUMIDOR)).toBe('10.00')
    expect((await ports(CONSUMIDOR).resolveAccount(TENANT_A.storeSlug)).accountId).toBeNull()
    expect(await comprar(CONSUMIDOR)).toEqual({ business_account_id: null, unit_price: '10.00' })
  })

  it('el invitado anónimo tampoco', async () => {
    expect(await precio(null)).toBe('10.00')
    expect(await comprar(null)).toEqual({ business_account_id: null, unit_price: '10.00' })
  })
})

describe('superficie', () => {
  it('`anon` no ejecuta ninguna de las tres funciones', async () => {
    for (const call of [
      `select public.my_store_business_accounts('tienda-a')`,
      `select public.my_effective_business_account_for_slug('tienda-a')`,
      `select public.select_store_business_account('tienda-a', '${cuentaA}')`,
    ]) {
      const message = await expectFailure(() => asRole(db, 'anon', null, async () => (await db.query(call)).rows))
      expect(message).toMatch(/permission denied/i)
    }
  })

  it('el helper interno no lo ejecuta `authenticated`', async () => {
    const message = await expectFailure(() =>
      as(DOS_CUENTAS, `select ebim.effective_business_account($1, $2, $3)`, [
        OTRA_PERSONA,
        TENANT_A.organizationId,
        TENANT_A.companyId,
      ]),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('la preferencia no se lee ni se escribe directamente desde el cliente', async () => {
    expect(await expectFailure(() => as(DOS_CUENTAS, `select * from public.buyer_account_selections`))).toMatch(
      /permission denied/i,
    )
    expect(
      await expectFailure(() =>
        as(
          DOS_CUENTAS,
          `insert into public.buyer_account_selections (organization_id, company_id, user_id, business_account_id)
           values ($1, $2, $3, $4)`,
          [TENANT_A.organizationId, TENANT_A.companyId, DOS_CUENTAS, cuentaAjena],
        ),
      ),
    ).toMatch(/permission denied/i)
  })

  it('la clave ajena impide apuntar a una cuenta de otra sociedad incluso con service_role', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.buyer_account_selections (organization_id, company_id, user_id, business_account_id)
         values ($1, $2, $3, $4)`,
        [TENANT_A.organizationId, TENANT_A.companyId, OTRA_PERSONA, cuentaOtraSociedad],
      ),
    )
    expect(message).toMatch(/foreign key|violates/i)
  })

  it('las funciones del comprador solo reciben el slug (y la cuenta a elegir)', async () => {
    const rows = await svc<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('my_store_business_accounts', 'my_effective_business_account_for_slug', 'select_store_business_account')
        order by p.proname`,
    )
    expect(rows).toEqual([
      { name: 'my_effective_business_account_for_slug', args: 'p_store_slug text' },
      { name: 'my_store_business_accounts', args: 'p_store_slug text' },
      { name: 'select_store_business_account', args: 'p_store_slug text, p_account_id uuid' },
    ])
  })
})
