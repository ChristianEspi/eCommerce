// @vitest-environment node
/**
 * N05 · La orden de compra obligatoria, sobre Postgres real.
 *
 * La autoridad es la base (`create_order`, con la fila de la cuenta delante);
 * el pipeline avisa antes de cobrar. Se prueba con el checkout de producción
 * (`runCheckout` + `createDbPorts`) y directamente contra `create_order`, para
 * que la regla no dependa de quién llame.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import { CheckoutStageError } from '../functions/_shared/checkout/errors.ts'
import { runCheckout } from '../functions/_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'

type Row = Record<string, unknown>

const EMPRESA_CON_OC = '0f400000-0000-4000-8000-00000000f001'
const COMERCIO_SIN_OC = '0f400000-0000-4000-8000-00000000f002'
const CONSUMIDOR = '0f400000-0000-4000-8000-00000000f003'
const NUL = String.fromCharCode(0)

let db: PGlite
let storeA = ''
let jabon = ''
let cuentaConOc = ''

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
function cuerpo(extra: Record<string, unknown> = {}, key?: string): Record<string, unknown> {
  n += 1
  return {
    store_slug: TENANT_A.storeSlug,
    idempotency_key: key ?? `n05-oc-${n}-${'z'.repeat(24)}`,
    customer_email: 'compras@empresa.test',
    customer_name: 'Compras Empresa',
    customer_phone: '+51 999 000 333',
    shipping_address: { address: 'Av. Industrial 450', city: 'Lima', country: 'PE' },
    items: [{ product_id: jabon, quantity: 1 }],
    ...extra,
  }
}

async function comprar(sub: string | null, body: Record<string, unknown>) {
  await svc(`delete from public.checkout_attempts`)
  const input = await parseCheckoutBody(body)
  const result = await runCheckout(
    createDbPorts({
      service: pgCaller('service_role', null),
      caller: pgCaller('authenticated', sub),
      hasSession: sub !== null,
    }),
    input,
  )
  const [order] = await svc<{ purchase_order_number: string | null; business_account_id: string | null }>(
    `select purchase_order_number, business_account_id from public.orders where id = $1`,
    [result.order.orderId],
  )
  return { result, order }
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

async function cuentaDe(code: string, userId: string, poRequired: boolean) {
  const customer = await id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', $3, $3, $4) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code, `${code.toLowerCase()}@cliente.test`],
  )
  const account = await id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name, purchase_order_required)
     values ($1, $2, $3, $4, $4, $5) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, customer, code, poRequired],
  )
  await svc(
    `insert into public.business_account_users (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, account, userId, `${userId}@compras.test`],
  )
  return account
}

async function pedidos(): Promise<number> {
  const [row] = await svc<{ n: number }>(`select count(*)::int as n from public.orders`)
  return row?.n ?? 0
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
     values ($1, $2, $3, 'N05-JABON', 'n05-jabon', 'Jabón', '10.00', 'PEN', 1000, 'published', now()) returning id`,
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
  cuentaConOc = await cuentaDe('CORP-OC', EMPRESA_CON_OC, true)
  await cuentaDe('BODEGA', COMERCIO_SIN_OC, false)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('cuenta que EXIGE orden de compra', () => {
  it('sin OC: el checkout se detiene antes de cobrar, con código estable, y no hay pedido', async () => {
    const antes = await pedidos()
    const error = await fallo(() => comprar(EMPRESA_CON_OC, cuerpo()))
    expect(error.code).toBe('ORDEN_COMPRA_REQUERIDA')
    expect(error.stage).toBe('authorize_payment')
    expect(await pedidos()).toBe(antes)
  })

  it('una OC en blanco cuenta como ninguna', async () => {
    const error = await fallo(() => comprar(EMPRESA_CON_OC, cuerpo({ purchase_order_number: '   ' })))
    expect(error.code).toBe('ORDEN_COMPRA_REQUERIDA')
  })

  it('la BASE lo exige aunque nadie avise antes: create_order directo sin OC', async () => {
    const message = await expectFailure(() =>
      svc(
        `select public.create_order(
           p_store_id => $1, p_customer_email => 'x@empresa.test',
           p_items => $2::jsonb, p_business_account_id => $3)`,
        [storeA, JSON.stringify([{ product_id: jabon, quantity: 1 }]), cuentaConOc],
      ),
    )
    expect(message).toMatch(/ORDEN_COMPRA_REQUERIDA/)
  })

  it('con OC: pedido creado, OC guardada normalizada y devuelta en la respuesta', async () => {
    const { result, order } = await comprar(EMPRESA_CON_OC, cuerpo({ purchase_order_number: '  OC-2026   00125 ' }))
    expect(order).toEqual({ purchase_order_number: 'OC-2026 00125', business_account_id: cuentaConOc })
    expect(result.order.purchaseOrderNumber).toBe('OC-2026 00125')
  })

  it('el portal B2B la enseña en el detalle del pedido', async () => {
    const { result } = await comprar(EMPRESA_CON_OC, cuerpo({ purchase_order_number: 'OC-PORTAL-7' }))
    const [row] = await asRole(db, 'authenticated', shopper(EMPRESA_CON_OC), async () =>
      (await db.query<{ d: Row }>(`select public.my_business_order_detail($1) as d`, [result.order.orderId])).rows,
    )
    expect(row?.d.purchase_order_number).toBe('OC-PORTAL-7')
  })

  it('más de 60 caracteres o con caracteres de control: ORDEN_COMPRA_INVALIDA en el borde y en la base', async () => {
    await expect(parseCheckoutBody(cuerpo({ purchase_order_number: 'X'.repeat(61) }))).rejects.toMatchObject({
      code: 'ORDEN_COMPRA_INVALIDA',
    })
    await expect(parseCheckoutBody(cuerpo({ purchase_order_number: `OC${NUL}-1` }))).rejects.toMatchObject({
      code: 'ORDEN_COMPRA_INVALIDA',
    })
    const message = await expectFailure(() =>
      svc(
        `select public.create_order(p_store_id => $1, p_customer_email => 'x@empresa.test',
           p_items => $2::jsonb, p_business_account_id => $3, p_purchase_order_number => $4)`,
        [storeA, JSON.stringify([{ product_id: jabon, quantity: 1 }]), cuentaConOc, 'X'.repeat(61)],
      ),
    )
    expect(message).toMatch(/ORDEN_COMPRA_INVALIDA/)
  })

  it('una vez creado el pedido, su OC no se reescribe', async () => {
    const { result } = await comprar(EMPRESA_CON_OC, cuerpo({ purchase_order_number: 'OC-ORIGINAL' }))
    const message = await expectFailure(() =>
      svc(`update public.orders set purchase_order_number = 'OC-CAMBIADA' where id = $1`, [result.order.orderId]),
    )
    expect(message).toMatch(/ORDER_SNAPSHOT_INMUTABLE/)
  })
})

describe('sin exigencia, nada cambia', () => {
  it('cuenta sin OC obligatoria: compra sin OC como siempre', async () => {
    const { order } = await comprar(COMERCIO_SIN_OC, cuerpo())
    expect(order?.purchase_order_number).toBeNull()
  })

  it('consumidor con sesión e invitado: compran sin OC', async () => {
    expect((await comprar(CONSUMIDOR, cuerpo())).order?.purchase_order_number).toBeNull()
    expect((await comprar(null, cuerpo())).order?.purchase_order_number).toBeNull()
  })
})

describe('la OC no se cuela donde no va', () => {
  it('dentro de una línea: CAMPO_NO_PERMITIDO en el borde y en la base', async () => {
    await expect(
      parseCheckoutBody(cuerpo({ items: [{ product_id: jabon, quantity: 1, purchase_order_number: 'OC-1' }] })),
    ).rejects.toMatchObject({ code: 'CAMPO_NO_PERMITIDO' })
    const message = await expectFailure(() =>
      svc(`select public.create_order(p_store_id => $1, p_customer_email => 'x@empresa.test', p_items => $2::jsonb)`, [
        storeA,
        JSON.stringify([{ product_id: jabon, quantity: 1, purchase_order_number: 'OC-1' }]),
      ]),
    )
    expect(message).toMatch(/CAMPO_NO_PERMITIDO/)
  })

  it('misma clave de idempotencia con OTRA OC: conflicto, no el mismo pedido', async () => {
    const key = `n05-idem-${'k'.repeat(30)}`
    const primero = await comprar(EMPRESA_CON_OC, cuerpo({ purchase_order_number: 'OC-A' }, key))
    expect(primero.order?.purchase_order_number).toBe('OC-A')
    const error = await fallo(() => comprar(EMPRESA_CON_OC, cuerpo({ purchase_order_number: 'OC-B' }, key)))
    expect(error.code).toBe('IDEMPOTENCIA_EN_CONFLICTO')
    // La misma OC con la misma clave es un reintento: el MISMO pedido.
    const reintento = await comprar(EMPRESA_CON_OC, cuerpo({ purchase_order_number: 'OC-A' }, key))
    expect(reintento.result.order.orderId).toBe(primero.result.order.orderId)
  })

  it('el cuerpo del checkout sigue rechazando la identidad comercial', async () => {
    for (const campo of ['business_account_id', 'customer_id', 'segment_id', 'price_list_id', 'audience']) {
      await expect(parseCheckoutBody(cuerpo({ purchase_order_number: 'OC-1', [campo]: 'x' }))).rejects.toMatchObject({
        code: 'CAMPO_NO_PERMITIDO',
      })
    }
  })
})

describe('el borde responde con un código de dominio, no con un 500', () => {
  it('ORDEN_COMPRA_REQUERIDA y ORDEN_COMPRA_INVALIDA son 422', async () => {
    const { statusForCode } = await import('../functions/_shared/checkout/errors.ts')
    expect(statusForCode('ORDEN_COMPRA_REQUERIDA')).toBe(422)
    expect(statusForCode('ORDEN_COMPRA_INVALIDA')).toBe(422)
  })
})
