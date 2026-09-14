// @vitest-environment node
/**
 * Cierre P0 · A1 — el crédito BLOQUEADO impide comprar, sobre Postgres real.
 *
 * Se prueba en las dos capas y con el checkout de producción
 * (`runCheckout` + `createDbPorts`), igual que la orden de compra obligatoria:
 *
 *  · el PIPELINE se detiene en la etapa 2, antes de precio, reserva y pago, y
 *    por eso la prueba que importa no es el código de error sino que NO QUEDE
 *    NADA: ni pedido, ni reserva de stock, ni intento de pago;
 *  · la BASE lo impide aunque nadie avise antes, llame quien llame a
 *    `create_order` o inserte directamente en `orders`.
 *
 * `watch` no bloquea: es una señal para quien cobra, no una prohibición.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import { CheckoutStageError, isRetryableCode, statusForCode } from '../functions/_shared/checkout/errors.ts'
import { runCheckout } from '../functions/_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'

type Row = Record<string, unknown>

const COMPRADOR_BLOQUEADO = '0a100000-0000-4000-8000-00000000a101'
const COMPRADOR_VIGILADO = '0a100000-0000-4000-8000-00000000a102'
const COMPRADOR_AL_DIA = '0a100000-0000-4000-8000-00000000a103'

let db: PGlite
let storeA = ''
let jabon = ''
let cuentaBloqueada = ''
let cuentaVigilada = ''
let cuentaAlDia = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function id(query: string, params: unknown[]): Promise<string> {
  const [row] = await svc<{ id: string }>(query, params)
  return String(row?.id)
}

function shopper(sub: string) {
  return { sub, email: `${sub}@compras.test`, org_id: '', companies: [], active_company: '' }
}

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

let n = 0
function cuerpo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  n += 1
  return {
    store_slug: TENANT_A.storeSlug,
    idempotency_key: `a1-credito-${n}-${'c'.repeat(24)}`,
    customer_email: 'compras@empresa.test',
    customer_name: 'Compras Empresa',
    customer_phone: '+51 999 000 444',
    shipping_address: { address: 'Av. Industrial 450', city: 'Lima', country: 'PE' },
    items: [{ product_id: jabon, quantity: 1 }],
    ...extra,
  }
}

async function comprar(sub: string | null, body: Record<string, unknown>) {
  await svc(`delete from public.checkout_attempts`)
  const input = await parseCheckoutBody(body)
  return runCheckout(
    createDbPorts({
      service: pgCaller('service_role', null),
      caller: pgCaller('authenticated', sub),
      hasSession: sub !== null,
    }),
    input,
  )
}

async function fallo(run: () => Promise<unknown>): Promise<CheckoutStageError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof CheckoutStageError) return error
    throw error
  }
  throw new Error('Se esperaba un CheckoutStageError')
}

async function cuentaDe(code: string, userId: string, estado: 'ok' | 'watch' | 'blocked') {
  const customer = await id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', $3, $3, $4) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code, `${code.toLowerCase()}@cliente.test`],
  )
  const account = await id(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, code, name, credit_limit, credit_status)
     values ($1, $2, $3, $4, $4, '5000.00', $5::public.credit_status) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, customer, code, estado],
  )
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, account, userId, `${userId}@compras.test`],
  )
  return account
}

/** Lo que una compra deja escrito. Tiene que seguir igual tras un rechazo. */
async function huella() {
  const [row] = await svc<{ pedidos: number; lineas: number; reservas: number; pagos: number }>(
    `select (select count(*)::int from public.orders)                 as pedidos,
            (select count(*)::int from public.order_items)            as lineas,
            (select count(*)::int from public.inventory_reservations) as reservas,
            (select count(*)::int from public.payment_intents)        as pagos`,
  )
  return row
}

beforeAll(async () => {
  db = await createTestDatabase()
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    TENANT_A.slug,
    TENANT_A.adminEmail,
    TENANT_A.ownerId,
    TENANT_A.storeSlug,
  ])
  // Con multialmacén activo el pipeline RESERVA stock antes de cobrar: es lo
  // que hace que «sin efectos laterales» signifique algo en esta prueba.
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    ['ecommerce.inventory.multiwarehouse'],
  ])
  storeA = await id(`update public.stores set status = 'active' where slug = $1 returning id`, [TENANT_A.storeSlug])
  await svc(`update public.store_settings set tax_rate = 0`)
  jabon = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'A1-JABON', 'a1-jabon', 'Jabón', '10.00', 'PEN', 1000, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(`insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'LIMA', 'Lima')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
  ])
  await asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
    db.query(`select public.seed_inventory_from_catalog((select id from public.warehouses where code = 'LIMA'), $1)`, [
      storeA,
    ]),
  )
  cuentaBloqueada = await cuentaDe('CORP-BLOQ', COMPRADOR_BLOQUEADO, 'blocked')
  cuentaVigilada = await cuentaDe('CORP-VIGIL', COMPRADOR_VIGILADO, 'watch')
  cuentaAlDia = await cuentaDe('CORP-OK', COMPRADOR_AL_DIA, 'ok')
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('el pipeline se detiene ANTES de empezar', () => {
  it('cuenta bloqueada: código estable en la etapa 2, y no queda nada escrito', async () => {
    const antes = await huella()

    const error = await fallo(() => comprar(COMPRADOR_BLOQUEADO, cuerpo()))

    expect(error.code).toBe('CREDITO_BLOQUEADO')
    // La etapa, y no solo el código: es la que garantiza que precio, reserva y
    // pago no llegaron a ejecutarse.
    expect(error.stage).toBe('validate_account')
    expect(await huella()).toEqual(antes)
  })

  it('el estado viaja con la cuenta que resuelve la sesión, no con el cuerpo', async () => {
    const [row] = await asRole(db, 'authenticated', shopper(COMPRADOR_BLOQUEADO), async () =>
      (
        await db.query<{ r: Row }>(`select public.my_effective_business_account_for_slug($1) as r`, [
          TENANT_A.storeSlug,
        ])
      ).rows,
    )
    expect(row?.r.account_id).toBe(cuentaBloqueada)
    expect(row?.r.credit_status).toBe('blocked')
  })

  it('el cuerpo no puede declarar cuenta ni estado de crédito', async () => {
    for (const campo of ['business_account_id', 'credit_status', 'account_id']) {
      await expect(parseCheckoutBody(cuerpo({ [campo]: 'ok' }))).rejects.toMatchObject({
        code: 'CAMPO_NO_PERMITIDO',
      })
    }
  })
})

describe('la base lo impide aunque nadie avise antes', () => {
  it('create_order directo con la cuenta bloqueada: CREDITO_BLOQUEADO y ni una línea', async () => {
    const antes = await huella()

    const message = await expectFailure(() =>
      svc(
        `select public.create_order(
           p_store_id => $1, p_customer_email => 'directo@empresa.test',
           p_items => $2::jsonb, p_business_account_id => $3)`,
        [storeA, JSON.stringify([{ product_id: jabon, quantity: 1 }]), cuentaBloqueada],
      ),
    )

    expect(message).toMatch(/CREDITO_BLOQUEADO/)
    expect(await huella()).toEqual(antes)
  })

  it('ni siquiera un insert directo en orders con service_role', async () => {
    // Es el atajo más corto que existe: si el candado estuviera solo dentro de
    // `create_order`, este camino lo saltaría.
    const message = await expectFailure(() =>
      svc(
        `insert into public.orders
           (organization_id, company_id, store_id, business_account_id, customer_email, currency)
         values ($1, $2, $3, $4, 'atajo@empresa.test', 'PEN')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, cuentaBloqueada],
      ),
    )
    expect(message).toMatch(/CREDITO_BLOQUEADO/)
  })
})

describe('solo bloquea lo que tiene que bloquear', () => {
  it('watch es una señal, no una prohibición: compra', async () => {
    const result = await comprar(COMPRADOR_VIGILADO, cuerpo())
    const [order] = await svc<{ business_account_id: string }>(
      `select business_account_id from public.orders where id = $1`,
      [result.order.orderId],
    )
    expect(order?.business_account_id).toBe(cuentaVigilada)
  })

  it('el bloqueo es de UNA cuenta: otra de la misma sociedad compra al día', async () => {
    const result = await comprar(COMPRADOR_AL_DIA, cuerpo())
    const [order] = await svc<{ business_account_id: string }>(
      `select business_account_id from public.orders where id = $1`,
      [result.order.orderId],
    )
    expect(order?.business_account_id).toBe(cuentaAlDia)
  })

  it('consumidor e invitado no tienen cuenta que bloquear', async () => {
    const invitado = await comprar(null, cuerpo())
    expect(invitado.order.orderId).toBeTruthy()
  })

  it('al levantar el bloqueo vuelve a comprar, sin que nada quede atascado', async () => {
    await svc(`update public.business_accounts set credit_status = 'ok' where id = $1`, [cuentaBloqueada])

    const result = await comprar(COMPRADOR_BLOQUEADO, cuerpo())

    expect(result.order.orderId).toBeTruthy()
    await svc(`update public.business_accounts set credit_status = 'blocked' where id = $1`, [cuentaBloqueada])
  })

  it('bloquear DESPUÉS no toca los pedidos que ya existían', async () => {
    const result = await comprar(COMPRADOR_AL_DIA, cuerpo())
    await svc(`update public.business_accounts set credit_status = 'blocked' where id = $1`, [cuentaAlDia])

    const [order] = await svc<{ id: string }>(`select id from public.orders where id = $1`, [result.order.orderId])
    expect(order?.id).toBe(result.order.orderId)

    await svc(`update public.business_accounts set credit_status = 'ok' where id = $1`, [cuentaAlDia])
  })
})

describe('el borde responde con un código de dominio, no con un 500', () => {
  it('CREDITO_BLOQUEADO es 403 y no se reintenta', () => {
    expect(statusForCode('CREDITO_BLOQUEADO')).toBe(403)
    expect(isRetryableCode('CREDITO_BLOQUEADO')).toBe(false)
  })
})
