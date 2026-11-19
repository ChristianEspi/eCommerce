// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'
import { renderEmail } from '../functions/_shared/notifications/templates.ts'

/**
 * IA proactiva (2026-11-19): agenda del vendedor y resumen diario.
 *
 *  · la agenda sale del ritmo PROPIO de cada cliente, sin modelo;
 *  · un vendedor solo ve su cartera; dueño y administración, todos;
 *  · el resumen se activa por tienda, solo con rol de administración, y sale
 *    una vez al día a dueño y administración con cifras de la base.
 */

let db: PGlite
let store = ''
let seq = 0

const VENDEDOR = '0d000000-0000-4000-8000-00000000b001'
const OTRO_VENDEDOR = '0d000000-0000-4000-8000-00000000b002'

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
const staff = (sub: string, role: string) =>
  claimsFor(TENANT_A, { sub, email: `${sub}@tenant-a.com`, companies: [{ id: TENANT_A.companyId, role }] })

async function cliente(code: string) {
  const [c] = await svc<{ id: string }>(
    `insert into public.customers (organization_id, company_id, kind, code, name, email, phone, tax_id)
     values ($1, $2, 'company', $3, $4, $5, '999888777', '20123456789') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code, `Cliente ${code}`, `${code.toLowerCase()}@cli.pe`],
  )
  const [a] = await svc<{ id: string }>(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, $4, $5) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, c?.id, `CTA-${code}`, `Cuenta ${code}`],
  )
  return { customer: String(c?.id), account: String(a?.id) }
}

async function pedido(account: string, diasAtras: number) {
  seq += 1
  await svc(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, fulfillment_status, currency,
        subtotal, tax_total, grand_total, customer_email, channel_id, business_account_id, placed_at, created_at)
     values ($1, $2, $3, $4, 'fulfilled', 'paid', 'fulfilled', 'PEN', 100, 0, 100, 'x@cli.pe',
             (select c.id from public.channels c where c.store_id = $3 and c.is_default), $5,
             now() - make_interval(days => $6), now() - make_interval(days => $6))`,
    [TENANT_A.organizationId, TENANT_A.companyId, store, `PRO-${seq}`, account, diasAtras],
  )
}

let atrasado = { customer: '', account: '' }
let alDia = { customer: '', account: '' }

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
  store = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'v1@tenant-a.com', 'sales_rep'), ($1, $2, $4, 'v2@tenant-a.com', 'sales_rep')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VENDEDOR, OTRO_VENDEDOR],
  )

  // Compra cada ~10 días y lleva 30 sin pedir: atrasado.
  atrasado = await cliente('ATR')
  for (const d of [60, 50, 40, 30]) await pedido(atrasado.account, d)
  // Compra cada ~10 días y pidió hace 5: al día.
  alDia = await cliente('DIA')
  for (const d of [35, 25, 15, 5]) await pedido(alDia.account, d)
  // Dos pedidos: sin ritmo, no entra aunque lleve mucho.
  const pocos = await cliente('POC')
  for (const d of [90, 80]) await pedido(pocos.account, d)

  const [rep] = await svc<{ id: string }>(
    `insert into public.sales_reps (organization_id, company_id, user_id, employee_code, full_name)
     values ($1, $2, $3, 'V-01', 'Vendedor Uno') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, VENDEDOR],
  )
  await svc(
    `insert into public.sales_rep_customers (organization_id, company_id, sales_rep_id, customer_id)
     values ($1, $2, $3, $4)`,
    [TENANT_A.organizationId, TENANT_A.companyId, rep?.id, atrasado.customer],
  )
})

afterAll(async () => {
  await db?.close()
})

async function agenda(claims: JwtClaims) {
  const [r] = await as<{ r: Row[] }>(claims, `select public.sales_due_customers() as r`)
  return (r?.r ?? []) as Row[]
}

describe('agenda: clientes que ya deberían haber pedido', () => {
  it('sale el atrasado por SU ritmo; ni el que está al día ni el que no tiene ritmo', async () => {
    const filas = await agenda(owner)
    expect(filas.map((f) => f.customer_id)).toEqual([atrasado.customer])
    expect(Number(filas[0]?.typical_days)).toBe(10)
    expect(Number(filas[0]?.overdue_days)).toBeGreaterThanOrEqual(19)
  })

  it('un vendedor solo ve su cartera', async () => {
    expect((await agenda(staff(VENDEDOR, 'sales_rep'))).map((f) => f.customer_id)).toEqual([atrasado.customer])
    expect(await agenda(staff(OTRO_VENDEDOR, 'sales_rep'))).toEqual([])
  })

  it('otra sociedad no ve nada, y catálogo no tiene agenda', async () => {
    expect(await agenda(claimsFor(TENANT_B))).toEqual([])
    expect(await fallo(() => agenda(staff('0d000000-0000-4000-8000-00000000b003', 'catalog')))).toMatch(/SIN_PERMISO/)
  })
})

describe('resumen diario', () => {
  it('solo administración lo configura, y la hora es válida', async () => {
    expect(
      await fallo(() => as(staff(VENDEDOR, 'sales_rep'), `select public.ai_digest_configure($1::uuid, true, 8)`, [store])),
    ).toMatch(/SIN_PERMISO/)
    expect(await fallo(() => as(owner, `select public.ai_digest_configure($1::uuid, true, 30)`, [store]))).toMatch(/HORA_INVALIDA/)
    expect(await fallo(() => as(claimsFor(TENANT_B), `select public.ai_digest_configure($1::uuid, true, 8)`, [store]))).toMatch(
      /TIENDA_NO_DISPONIBLE/,
    )
  })

  it('activo y con su hora alcanzada, encola UNA vez al día para dueño y administración', async () => {
    await as(owner, `select public.ai_digest_configure($1::uuid, true, 0)`, [store])
    await svc(
      `insert into public.tenant_entitlements (organization_id, company_id, entitlement_code, is_active, source)
       values ($1, $2, 'ecommerce.analytics.basic', true, 'hub')
       on conflict (organization_id, company_id, entitlement_code) do update set is_active = true`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await svc(`delete from public.notification_emails where kind = 'ai.daily_digest'`)
    const [primera] = await svc<{ n: number }>(`select ebim.enqueue_ai_digests(50) as n`)
    expect(primera?.n).toBe(1)
    const correos = await svc<{ to_address: string; params: Row }>(
      `select to_address, params from public.notification_emails where kind = 'ai.daily_digest'`,
    )
    expect(correos.map((c) => c.to_address)).toEqual([TENANT_A.adminEmail.toLowerCase()])
    expect(correos[0]?.params).toMatchObject({ due_customers: '1', path: '/app' })

    const [segunda] = await svc<{ n: number }>(`select ebim.enqueue_ai_digests(50) as n`)
    expect(segunda?.n).toBe(0)
  })

  it('el correo se renderiza con las cifras escapadas y botón al panel', () => {
    const r = renderEmail(
      'ai.daily_digest',
      'es',
      { store_name: 'Botica <b>', orders_yesterday: '3', sales_yesterday: '120.50', currency: 'PEN', pending_approval: '1', pending_ai_actions: '2', due_customers: '4', path: '/app' },
      'https://qas.example.com',
    )
    expect(r?.subject).toContain('Botica <b>')
    expect(r?.html).toContain('120.50 PEN')
    expect(r?.html).toContain('Botica &lt;b&gt;')
    expect(r?.html).toContain('https://qas.example.com/app')
  })
})
