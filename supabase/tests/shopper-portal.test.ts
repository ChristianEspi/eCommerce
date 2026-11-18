// @vitest-environment node
/**
 * Portal del comprador sobre Postgres real.
 *
 * Lo que se prueba no es que la pantalla pinte: es que un comprador vea SU
 * deuda y no la del vecino, que un cupon dirigido a otra cuenta no aparezca en
 * su lista, y que sin vinculo no haya nada. Un estado de cuenta filtrado dice
 * cuanto debe una botica a su proveedor; un cupon filtrado se gasta.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, asRole, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>

/** Dos compradores de dos empresas distintas del MISMO tenant. */
const COMPRADOR_A = '0d000000-0000-4000-8000-00000000a001'
const COMPRADOR_B = '0d000000-0000-4000-8000-00000000b001'

let db: PGlite
let storeId = ''
let cuentaA = ''
let cuentaB = ''
let cuponDirigido = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

function claims(sub: string) {
  return {
    sub,
    email: `${sub}@comprador.test`,
    org_id: '',
    companies: [],
    active_company: '',
  } as never
}

async function asShopper<T>(sub: string, run: () => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', claims(sub), run)
}

async function statement(sub: string): Promise<Array<Record<string, unknown>>> {
  return asShopper(sub, async () => {
    const result = await db.query<{ s: Array<Record<string, unknown>> }>(
      'select public.my_account_statement() as s',
    )
    return result.rows[0]!.s
  })
}

async function coupons(sub: string): Promise<Array<Record<string, unknown>>> {
  return asShopper(sub, async () => {
    const result = await db.query<{ c: Array<Record<string, unknown>> }>(
      'select public.my_coupons($1) as c',
      [storeId],
    )
    return result.rows[0]!.c
  })
}

beforeAll(async () => {
  db = await createTestDatabase()

  await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    TENANT_A.slug,
    `Cuenta ${TENANT_A.slug}`,
    TENANT_A.adminEmail,
    TENANT_A.ownerId,
    TENANT_A.storeSlug,
    `Tienda ${TENANT_A.slug}`,
  ])
  const [store] = await svc<{ id: string }>(
    `update public.stores set status = 'active' where slug = $1 returning id`,
    [TENANT_A.storeSlug],
  )
  storeId = store!.id

  // Dos empresas compradoras, cada una con su persona.
  for (const [nombre, sub, limite, plazo] of [
    ['Botica Norte', COMPRADOR_A, '5000.00', 30],
    ['Botica Sur', COMPRADOR_B, '1000.00', 15],
  ] as const) {
    const codigo = nombre.toLowerCase().replace(/\s+/g, '-')
    const [cliente] = await svc<{ id: string }>(
      `insert into public.customers (organization_id, company_id, kind, code, name, legal_name, email)
       values ($1, $2, 'company', $3, $4, $4, $5) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, codigo, nombre, `${sub}@empresa.test`],
    )
    const [cuenta] = await svc<{ id: string }>(
      `insert into public.business_accounts
         (organization_id, company_id, customer_id, customer_kind, code, name, is_active,
          credit_limit, payment_terms_days)
       values ($1, $2, $3, 'company', $4, $5, true, $6, $7) returning id`,
      [
        TENANT_A.organizationId,
        TENANT_A.companyId,
        cliente!.id,
        codigo,
        nombre,
        limite,
        plazo,
      ],
    )
    await svc(
      `insert into public.business_account_users
         (organization_id, company_id, business_account_id, user_id, email, role, status)
       values ($1, $2, $3, $4, $5, 'admin', 'active')`,
      [TENANT_A.organizationId, TENANT_A.companyId, cuenta!.id, sub, `${sub}@empresa.test`],
    )
    if (nombre === 'Botica Norte') cuentaA = cuenta!.id
    else cuentaB = cuenta!.id
  }

  // Un pedido pendiente y vencido para A, y uno pagado que NO debe contar.
  await svc(
    `insert into public.orders
       (organization_id, company_id, store_id, channel_id, business_account_id, order_number,
        status, payment_status, currency, customer_email, subtotal, tax_total, shipping_total,
        discount_total, grand_total, placed_at)
     values
       ($1, $2, $3, (select c.id from public.channels c where c.store_id = $3 and c.is_default),
        $4, 'A-0001', 'pending', 'pending', 'PEN', 'norte@empresa.test', 800, 0, 0, 0, 800,
        now() - interval '45 days'),
       ($1, $2, $3, (select c.id from public.channels c where c.store_id = $3 and c.is_default),
        $4, 'A-0002', 'paid', 'paid', 'PEN', 'norte@empresa.test', 300, 0, 0, 0, 300,
        now() - interval '5 days')`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeId, cuentaA],
  )
  // Y uno pendiente para B, que A no puede ver.
  await svc(
    `insert into public.orders
       (organization_id, company_id, store_id, channel_id, business_account_id, order_number,
        status, payment_status, currency, customer_email, subtotal, tax_total, shipping_total,
        discount_total, grand_total, placed_at)
     values ($1, $2, $3, (select c.id from public.channels c where c.store_id = $3 and c.is_default),
             $4, 'B-0001', 'pending', 'pending', 'PEN', 'sur@empresa.test', 999, 0, 0, 0, 999, now())`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeId, cuentaB],
  )
  // 2026-11-17 · La deuda del estado de cuenta es la deuda A CRÉDITO: los dos
  // pedidos pendientes se vendieron a crédito y tienen su documento por cobrar,
  // como los deja el checkout al atar el cobro.
  await db.query(
    `select ebim.ar_document_for_order(o.id) from public.orders o where o.order_number in ('A-0001', 'B-0001')`,
  )

  // Dos cupones: uno abierto a la tienda y otro dirigido SOLO a la cuenta B.
  const [promoAbierta] = await svc<{ id: string }>(
    `insert into public.promotions
       (organization_id, company_id, store_id, code, name, kind, status, requires_coupon,
        value_percent, valid_from, valid_to)
     values ($1, $2, $3, 'abierta', 'Diez por ciento', 'percentage', 'active', true, 10,
             now() - interval '1 day', now() + interval '30 days') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeId],
  )
  const [promoDirigida] = await svc<{ id: string }>(
    `insert into public.promotions
       (organization_id, company_id, store_id, code, name, kind, status, requires_coupon,
        value_percent, valid_from, valid_to)
     values ($1, $2, $3, 'dirigida', 'Solo Botica Sur', 'percentage', 'active', true, 20,
             now() - interval '1 day', now() + interval '30 days') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeId],
  )
  await svc(
    `insert into public.coupons
       (organization_id, company_id, store_id, promotion_id, code, is_active, valid_from, valid_to)
     values ($1, $2, $3, $4, 'ABIERTO10', true, now() - interval '1 day', now() + interval '30 days')`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeId, promoAbierta!.id],
  )
  const [cupon] = await svc<{ id: string }>(
    `insert into public.coupons
       (organization_id, company_id, store_id, promotion_id, code, is_active, valid_from, valid_to)
     values ($1, $2, $3, $4, 'SOLOSUR20', true, now() - interval '1 day', now() + interval '30 days')
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeId, promoDirigida!.id],
  )
  cuponDirigido = cupon!.id
  await svc(
    `insert into public.promotion_audiences
       (organization_id, company_id, store_id, promotion_id, audience_kind, business_account_id)
     values ($1, $2, $3, $4, 'business_account', $5)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeId, promoDirigida!.id, cuentaB],
  )
})

afterAll(async () => {
  await db.close()
})

describe('estado de cuenta', () => {
  it('suma lo pendiente, descuenta de la linea y marca lo vencido', async () => {
    const [cuenta] = await statement(COMPRADOR_A)

    expect(cuenta?.account_name).toBe('Botica Norte')
    // 800 pendientes: el pedido pagado NO entra en la deuda.
    expect(Number(cuenta?.balance_due)).toBe(800)
    expect(Number(cuenta?.credit_available)).toBe(4200)
    // Con 30 dias de plazo, un pedido de hace 45 esta vencido.
    expect(Number(cuenta?.overdue_amount)).toBe(800)
    expect(Number(cuenta?.purchased_12m)).toBe(1100)
    expect(Number(cuenta?.paid_12m)).toBe(300)
  })

  it('el documento trae su vencimiento y sus dias de atraso', async () => {
    const [cuenta] = await statement(COMPRADOR_A)
    const documentos = cuenta?.documents as Array<Record<string, unknown>>

    expect(documentos).toHaveLength(1)
    expect(documentos[0]?.order_number).toBe('A-0001')
    expect(Number(documentos[0]?.days_overdue)).toBeGreaterThanOrEqual(14)
  })

  it('cada comprador ve SOLO su cuenta', async () => {
    const deA = await statement(COMPRADOR_A)
    const deB = await statement(COMPRADOR_B)

    expect(deA.map((row) => row.account_name)).toEqual(['Botica Norte'])
    expect(deB.map((row) => row.account_name)).toEqual(['Botica Sur'])
    // Lo de B no se cuela en el saldo de A ni por asomo.
    expect(Number(deA[0]?.balance_due)).toBe(800)
    expect(Number(deB[0]?.balance_due)).toBe(999)
  })

  it('sin sesion no hay estado de cuenta', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () => db.query('select public.my_account_statement()')),
    )
    expect(message).toMatch(/permission denied|denegado/i)
  })

  it('lo pagado sin confirmar va aparte: ni es deuda ni usa la linea', async () => {
    // A-0003: pagado por transferencia, la tienda aun no lo confirma (sin
    // documento a credito). A-0004: igual pero cancelado, no cuenta.
    await svc(
      `insert into public.orders
         (organization_id, company_id, store_id, channel_id, business_account_id, order_number,
          status, payment_status, currency, customer_email, subtotal, tax_total, shipping_total,
          discount_total, grand_total, placed_at)
       values
         ($1, $2, $3, (select c.id from public.channels c where c.store_id = $3 and c.is_default),
          $4, 'A-0003', 'pending', 'pending', 'PEN', 'norte@empresa.test', 250, 0, 0, 0, 250,
          now() - interval '2 days'),
         ($1, $2, $3, (select c.id from public.channels c where c.store_id = $3 and c.is_default),
          $4, 'A-0004', 'cancelled', 'pending', 'PEN', 'norte@empresa.test', 70, 0, 0, 0, 70,
          now() - interval '1 days')`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeId, cuentaA],
    )

    const [cuenta] = await statement(COMPRADOR_A)
    const pendientes = cuenta?.pending_payments as Array<Record<string, unknown>>

    expect(pendientes.map((p) => p.order_number)).toEqual(['A-0003'])
    expect(Number(cuenta?.pending_payments_total)).toBe(250)
    // La deuda a credito (A-0001) no se repite aqui ni cambia.
    expect(Number(cuenta?.balance_due)).toBe(800)
    expect(Number(cuenta?.credit_available)).toBe(4200)

    // Y B no ve lo pendiente de A.
    const [deB] = await statement(COMPRADOR_B)
    expect(deB?.pending_payments).toEqual([])
    expect(Number(deB?.pending_payments_total)).toBe(0)
  })
})

describe('cupones', () => {
  it('el cupon dirigido a otra cuenta no aparece', async () => {
    const deA = (await coupons(COMPRADOR_A)).map((row) => row.code)
    const deB = (await coupons(COMPRADOR_B)).map((row) => row.code)

    expect(deA).toContain('ABIERTO10')
    expect(deA).not.toContain('SOLOSUR20')
    expect(deB).toContain('SOLOSUR20')
  })

  it('un cupon caducado deja de ofrecerse', async () => {
    await svc(`update public.coupons set valid_to = now() - interval '1 day' where id = $1`, [
      cuponDirigido,
    ])
    const deB = (await coupons(COMPRADOR_B)).map((row) => row.code)
    expect(deB).not.toContain('SOLOSUR20')

    await svc(`update public.coupons set valid_to = now() + interval '30 days' where id = $1`, [
      cuponDirigido,
    ])
  })

  it('sin sesion no hay cupones: un cupon es una llave', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () => db.query('select public.my_coupons($1)', [storeId])),
    )
    expect(message).toMatch(/permission denied|denegado/i)
  })
})

describe('detalle del pedido', () => {
  it('el comprador abre su pedido sin token, y no el del vecino', async () => {
    const [pedidoB] = await svc<{ id: string }>(
      `select id from public.orders where order_number = 'B-0001'`,
    )

    const propio = await asShopper(COMPRADOR_B, async () => {
      const result = await db.query<{ d: Record<string, unknown> }>(
        'select public.my_business_order_detail($1) as d',
        [pedidoB!.id],
      )
      return result.rows[0]!.d
    })
    expect(propio.order_number).toBe('B-0001')

    const message = await expectFailure(() =>
      asShopper(COMPRADOR_A, () =>
        db.query('select public.my_business_order_detail($1)', [pedidoB!.id]),
      ),
    )
    expect(message).toContain('PEDIDO_NO_ENCONTRADO')
  })
})
