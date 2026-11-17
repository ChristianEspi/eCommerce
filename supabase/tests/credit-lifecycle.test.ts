// @vitest-environment node
/**
 * Crédito y cobranza de punta a punta (QAS, 2026-11-17), con el checkout de
 * producción (`runCheckout` + `createDbPorts`) sobre Postgres real.
 *
 *   comprar a crédito → nace la deuda · la línea alcanza o se rechaza ·
 *   cobrar la salda y paga el pedido · «Marcar pagado» la salda · cancelar la
 *   anula y libera la línea · el cobro es una sola transacción con guardas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import { CheckoutStageError } from '../functions/_shared/checkout/errors.ts'
import { runCheckout } from '../functions/_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'

type Row = Record<string, unknown>

const COMPRADOR = '0a200000-0000-4000-8000-00000000c201'
const LECTOR = '0a200000-0000-4000-8000-00000000c2d1'

let db: PGlite
let storeA = ''
let jabon = ''
let cuenta = ''
let cliente = ''

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
async function comprar(metodo: string, cantidad = 1) {
  n += 1
  await svc(`delete from public.checkout_attempts`)
  const input = await parseCheckoutBody({
    store_slug: TENANT_A.storeSlug,
    idempotency_key: `credito-ciclo-${n}-${'d'.repeat(24)}`,
    customer_email: `${COMPRADOR}@compras.test`,
    customer_name: 'Compras Clínica',
    customer_phone: '+51 999 000 555',
    shipping_address: { address: 'Av. Salud 100', city: 'Lima', country: 'PE' },
    items: [{ product_id: jabon, quantity: cantidad }],
    payment_method_code: metodo,
  })
  return runCheckout(
    createDbPorts({
      service: pgCaller('service_role', null),
      caller: pgCaller('authenticated', COMPRADOR),
      hasSession: true,
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

async function documentoDe(orderId: string) {
  const [row] = await svc<{
    id: string
    number: string
    amount: string
    balance: string
    terms: number
    voided: boolean
    reason: string | null
  }>(
    `select d.id, d.document_number as number, d.amount::text, d.balance::text,
            (d.due_at - d.issued_at) as terms, d.voided_at is not null as voided, d.void_reason as reason
       from public.ar_documents d where d.order_id = $1 order by d.created_at desc limit 1`,
    [orderId],
  )
  return row
}

async function linea() {
  const { rows } = await db.query<{ r: { used: number; available: number } }>(
    `select ebim.credit_line($1) as r`,
    [cuenta],
  )
  return rows[0]?.r
}

async function pedido(orderId: string) {
  const [row] = await svc<{ number: string; payment: string }>(
    `select order_number as number, payment_status::text as payment from public.orders where id = $1`,
    [orderId],
  )
  return row
}

async function cobrar(claims: ReturnType<typeof claimsFor>, docId: string, amount: string, applied = amount) {
  return asRole(db, 'authenticated', claims, async () =>
    (
      await db.query<{ r: Row }>(
        `select public.ar_register_receipt($1, null, current_date, $2::numeric, 'transferencia', 'OP-1', $3::jsonb) as r`,
        [cliente, amount, JSON.stringify([{ document_id: docId, amount: applied }])],
      )
    ).rows[0]?.r,
  )
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
  storeA = await id(`update public.stores set status = 'active' where slug = $1 returning id`, [TENANT_A.storeSlug])
  await svc(`update public.store_settings set tax_rate = 0`)
  jabon = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'CR-JABON', 'cr-jabon', 'Jabón', '10.00', 'PEN', 1000, 'published', now()) returning id`,
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
  await svc(
    `insert into public.payment_methods
       (organization_id, company_id, store_id, code, kind, display_name, provider_code, capture_mode, is_active)
     values ($1, $2, $3, 'credito', 'credit', 'Crédito empresa', null, 'manual', true),
            ($1, $2, $3, 'yape', 'wallet', 'Yape', null, 'manual', true)
     on conflict (store_id, code) do update
       set kind = excluded.kind, provider_code = null, capture_mode = 'manual', is_active = true`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  cliente = await id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', 'CLINICA', 'Clínica', 'clinica@cliente.test') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  cuenta = await id(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, code, name, credit_limit, payment_terms_days)
     values ($1, $2, $3, 'CLINICA', 'Clínica', '50.00', 30) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, cliente],
  )
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, cuenta, COMPRADOR, `${COMPRADOR}@compras.test`],
  )
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, LECTOR],
  )
}, 180_000)

afterAll(async () => {
  await db?.close()
})

const admin = () => claimsFor(TENANT_A)
const lector = () =>
  claimsFor(TENANT_A, {
    sub: LECTOR,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })

describe('comprar a crédito', () => {
  let orderId = ''

  it('deja la deuda escrita: número del pedido, plazo de la cuenta y el total', async () => {
    const result = await comprar('credito')
    orderId = result.order.orderId
    const doc = await documentoDe(orderId)
    const p = await pedido(orderId)
    expect(doc).toMatchObject({ number: p?.number, amount: '10.00', balance: '10.00', terms: 30, voided: false })
    expect(await linea()).toMatchObject({ used: 10, available: 40 })
  })

  it('si la línea no alcanza, CREDITO_EXCEDIDO y no hay pedido', async () => {
    const [antes] = await svc<{ n: number }>(`select count(*)::int as n from public.orders`)
    const error = await fallo(() => comprar('credito', 5))
    expect(error.code).toBe('CREDITO_EXCEDIDO')
    expect(error.status).toBe(403)
    const [despues] = await svc<{ n: number }>(`select count(*)::int as n from public.orders`)
    expect(despues?.n).toBe(antes?.n)
  })

  it('pagar con Yape no mira la línea ni crea deuda', async () => {
    const result = await comprar('yape', 6)
    expect(await documentoDe(result.order.orderId)).toBeUndefined()
  })

  it('cobrar el total salda el documento y deja el pedido pagado', async () => {
    const doc = await documentoDe(orderId)
    const r = await cobrar(admin(), String(doc?.id), '10.00')
    expect(r).toMatchObject({ applied: '10.00', unapplied: '0.00' })
    expect((await documentoDe(orderId))?.balance).toBe('0.00')
    expect((await pedido(orderId))?.payment).toBe('paid')
    const [intento] = await svc<{ status: string }>(
      `select status::text from public.payment_intents where order_id = $1`,
      [orderId],
    )
    expect(intento?.status).toBe('captured')
    expect(await linea()).toMatchObject({ used: 0, available: 50 })
  })
})

describe('el pedido manda sobre la deuda', () => {
  it('«Marcar pagado» en Pedidos salda el documento con un recibo automático', async () => {
    const { order } = await comprar('credito')
    await asRole(db, 'authenticated', admin(), async () =>
      db.query(`select public.order_transition($1, 'payment_status', 'paid', 'Pagó por depósito')`, [
        order.orderId,
      ]),
    )
    expect((await documentoDe(order.orderId))?.balance).toBe('0.00')
    const [recibo] = await svc<{ number: string }>(
      `select receipt_number as number from public.ar_receipts where receipt_number like 'PED-%'`,
    )
    expect(recibo?.number).toMatch(/^PED-/)
  })

  it('cancelar anula el documento, libera la línea y ya no admite cobros', async () => {
    const { order } = await comprar('credito', 3)
    expect(await linea()).toMatchObject({ used: 30 })
    await svc(`update public.orders set status = 'cancelled' where id = $1`, [order.orderId])
    const doc = await documentoDe(order.orderId)
    expect(doc).toMatchObject({ voided: true, balance: '0.00', reason: 'Pedido cancelado' })
    expect(await linea()).toMatchObject({ used: 0, available: 50 })
    expect(await expectFailure(() => cobrar(admin(), String(doc?.id), '5.00'))).toMatch(/DOCUMENTO_ANULADO/)
  })
})

describe('registrar un cobro', () => {
  let docId = ''

  beforeAll(async () => {
    const { order } = await comprar('credito', 2)
    docId = String((await documentoDe(order.orderId))?.id)
  })

  it('un lector no puede', async () => {
    expect(await expectFailure(() => cobrar(lector(), docId, '5.00'))).toMatch(/SIN_PERMISO/)
  })

  it('no se aplica más de lo que se debe', async () => {
    expect(await expectFailure(() => cobrar(admin(), docId, '50.00', '25.00'))).toMatch(/COBRO_EXCEDE_DEUDA/)
  })

  it('no se aplica más de lo que se cobró', async () => {
    expect(await expectFailure(() => cobrar(admin(), docId, '5.00', '15.00'))).toMatch(/APLICADO_EXCEDE_COBRO/)
  })

  it('un cobro parcial deja el saldo y el pedido sigue pendiente; nada a medias si falla', async () => {
    const [antes] = await svc<{ n: number }>(`select count(*)::int as n from public.ar_receipts`)
    await expectFailure(() => cobrar(admin(), docId, '5.00', '15.00'))
    const [despues] = await svc<{ n: number }>(`select count(*)::int as n from public.ar_receipts`)
    expect(despues?.n).toBe(antes?.n)

    await cobrar(admin(), docId, '8.00')
    const [doc] = await svc<{ balance: string }>(`select balance::text from public.ar_documents where id = $1`, [docId])
    expect(doc?.balance).toBe('12.00')
  })
})

describe('comprobante desde un pedido', () => {
  it('nace con sus líneas y los totales cuadran; no se duplica', async () => {
    const { order } = await comprar('yape', 2)
    const numero = String((await pedido(order.orderId))?.number)
    const crear = () =>
      asRole(db, 'authenticated', admin(), async () =>
        (await db.query<{ r: Row }>(`select public.invoice_create_for_order($1) as r`, [numero])).rows[0]?.r,
      )
    const r = await crear()
    expect(r?.lines).toBe(1)
    const [inv] = await svc<{ series: string; net: string; gross: string; status: string }>(
      `select series, net_total::text as net, gross_total::text as gross, status::text
         from public.invoices where id = $1`,
      [r?.invoice_id],
    )
    expect(inv).toMatchObject({ series: 'B001', net: '20.00', gross: '20.00', status: 'pending' })
    expect(await expectFailure(crear)).toMatch(/COMPROBANTE_YA_EXISTE/)
  })

  it('un lector no puede generarlo', async () => {
    expect(
      await expectFailure(() =>
        asRole(db, 'authenticated', lector(), async () =>
          db.query(`select public.invoice_create_for_order('EC-NO-EXISTE')`),
        ),
      ),
    ).toMatch(/PEDIDO_NO_ENCONTRADO|SIN_PERMISO/)
  })
})

describe('lo que quedaba suelto', () => {
  async function estadoCuenta() {
    const [row] = await svc<{ status: string; auto: boolean }>(
      `select credit_status::text as status, credit_status_auto as auto from public.business_accounts where id = $1`,
      [cuenta],
    )
    return row
  }

  it('«Tu cuenta» del comprador da el mismo disponible que el checkout', async () => {
    // Un Yape pendiente NO es deuda a crédito.
    await comprar('yape', 1)
    const r = await asRole(db, 'authenticated', shopper(COMPRADOR), async () =>
      (await db.query<{ r: Row[] }>(`select public.my_account_statement() as r`)).rows[0]?.r,
    )
    const mia = (r ?? []).find((a) => a.account_id === cuenta)
    const l = await linea()
    expect(Number(mia?.credit_available)).toBe(Number(l?.available))
    expect((mia?.documents as Row[]).every((d) => typeof d.order_number === 'string')).toBe(true)
  })

  it('la mora pasa sola a vigilancia y a bloqueo, y vuelve al cobrar', async () => {
    await svc(`update public.business_accounts set credit_status = 'ok', credit_status_manual_until = null,
                 credit_status_auto = false where id = $1`, [cuenta])
    const { order } = await comprar('credito', 1)
    const doc = await documentoDe(order.orderId)
    await svc(`update public.ar_documents set issued_at = current_date - 60, due_at = current_date - 20 where id = $1`, [doc?.id])
    expect(await estadoCuenta()).toMatchObject({ status: 'watch', auto: true })
    await svc(`update public.ar_documents set issued_at = current_date - 90, due_at = current_date - 40 where id = $1`, [doc?.id])
    expect(await estadoCuenta()).toMatchObject({ status: 'blocked', auto: true })

    // Bloqueada: no compra.
    expect((await fallo(() => comprar('credito', 1))).code).toBe('CREDITO_BLOQUEADO')

    // Cobra todo lo abierto y vuelve sola.
    const abiertos = await svc<{ id: string; balance: string }>(
      `select id, balance::text from public.ar_documents where business_account_id = $1 and voided_at is null and balance > 0`,
      [cuenta],
    )
    for (const a of abiertos) await cobrar(admin(), a.id, a.balance)
    expect(await estadoCuenta()).toMatchObject({ status: 'ok', auto: false })
  })

  it('un cambio a mano se respeta: el sistema no lo pisa', async () => {
    await svc(`update public.business_accounts set credit_status = 'blocked' where id = $1`, [cuenta])
    const { rows } = await db.query<{ s: string }>(`select ebim.credit_refresh_status($1)::text as s`, [cuenta])
    expect(rows[0]?.s).toBe('blocked')
    await svc(`update public.business_accounts set credit_status = 'ok' where id = $1`, [cuenta])
  })

  it('cancelar con algo cobrado anula la deuda y dice cuánto devolver', async () => {
    const { order } = await comprar('credito', 2)
    const doc = await documentoDe(order.orderId)
    await cobrar(admin(), String(doc?.id), '5.00')
    await svc(`update public.orders set status = 'cancelled' where id = $1`, [order.orderId])
    const despues = await documentoDe(order.orderId)
    expect(despues?.reason).toMatch(/devolver 5\.00 PEN/)
    const [ev] = await svc<{ code: string }>(
      `select code from public.ops_events where code = 'COBRO_A_DEVOLVER' order by occurred_at desc limit 1`,
    )
    expect(ev?.code).toBe('COBRO_A_DEVOLVER')
  })

  it('el comprobante nace solo con la deuda a crédito y se anula si se cancela', async () => {
    const { order } = await comprar('credito', 1)
    const [inv] = await svc<{ status: string }>(`select status::text from public.invoices where order_id = $1`, [order.orderId])
    const evs = await svc(`select code, message from public.ops_events where code = 'COMPROBANTE_NO_GENERADO'`)
    expect(evs).toEqual([])
    expect(inv?.status).toBe('pending')
    await svc(`update public.orders set status = 'cancelled' where id = $1`, [order.orderId])
    const [despues] = await svc<{ status: string }>(`select status::text from public.invoices where order_id = $1`, [order.orderId])
    expect(despues?.status).toBe('cancelled')
  })
})
