// @vitest-environment node
/**
 * Copilot (2026-11-22) · tendencia diaria y clientes que dejaron de comprar.
 *
 * Lo que se fija:
 *  · la tendencia trae la serie de la ventana y de la anterior, solo de la tienda
 *    y la sociedad del token, y exige el rol y el módulo de `insights`;
 *  · «dejó de comprar» = compraba en el año y lleva la ventana sin hacerlo; con
 *    texto, de ESE producto; el vendedor ve solo su cartera; otro tenant, nada;
 *  · en TS: el plan acepta las herramientas con parámetros de lista cerrada, el
 *    sistema suma la serie (no el modelo) y el borrador pasa por los candados.
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adaptarResultado,
  revisarCopilot,
  revisarPlan,
  type ContextoPlan,
  type LlamadaModelo,
  type Orquestado,
} from '../functions/_shared/aiCopilot.ts'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B } from './harness'

let db: PGlite
const store: Record<string, string> = {}
const VENDEDOR = '0a000000-0000-4000-8000-00000000fc01'
const VISOR = '0a000000-0000-4000-8000-00000000fc02'
let seq = 0

type Json = Record<string, unknown>

async function svc<T = Json>(query: string, params: unknown[] = []) {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function como<T>(claims: ReturnType<typeof claimsFor>, query: string, params: unknown[] = []) {
  return asRole(db, 'authenticated', claims, async () => (await db.query<{ r: T }>(query, params)).rows[0]!.r)
}

const conRol = (userId: string) => ({ ...claimsFor(TENANT_A), sub: userId })

async function cliente(tenant: typeof TENANT_A, code: string) {
  const [c] = await svc<{ id: string }>(
    `insert into public.customers (organization_id, company_id, kind, code, name, email, phone, tax_id)
     values ($1, $2, 'company', $3, $4, $5, '999888777', '20123456789') returning id`,
    [tenant.organizationId, tenant.companyId, code, `Cliente ${code}`, `${code.toLowerCase()}@cli.pe`],
  )
  const [a] = await svc<{ id: string }>(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, $4, $5) returning id`,
    [tenant.organizationId, tenant.companyId, c!.id, `CTA-${code}`, `Cuenta ${code}`],
  )
  return { customer: c!.id, account: a!.id }
}

async function producto(tenant: typeof TENANT_A, sku: string, nombre: string) {
  const [p] = await svc<{ id: string }>(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, $4, lower($4), $5, '10.00', 'PEN', 10, 'published', now()) returning id`,
    [tenant.organizationId, tenant.companyId, store[tenant.slug], sku, nombre],
  )
  return p!.id
}

async function pedido(tenant: typeof TENANT_A, account: string | null, diasAtras: number, total: string, item?: { product: string; sku: string; name: string }) {
  seq += 1
  const [o] = await svc<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, fulfillment_status, currency,
        subtotal, tax_total, grand_total, customer_email, channel_id, business_account_id, placed_at, created_at)
     values ($1, $2, $3, $4, 'fulfilled', 'paid', 'fulfilled', 'PEN', $5, 0, $5, 'x@cli.pe',
             (select c.id from public.channels c where c.store_id = $3 and c.is_default), $6,
             now() - make_interval(days => $7), now() - make_interval(days => $7)) returning id`,
    [tenant.organizationId, tenant.companyId, store[tenant.slug], `TL-${seq}`, total, account, diasAtras],
  )
  if (item) {
    await svc(
      `insert into public.order_items
         (organization_id, company_id, store_id, order_id, product_id, sku, name, quantity, unit_price)
       values ($1, $2, $3, $4, $5, $6, $7, 1, $8)`,
      [tenant.organizationId, tenant.companyId, store[tenant.slug], o!.id, item.product, item.sku, item.name, total],
    )
  }
}

let perdido = { customer: '', account: '' }
let activo = { customer: '', account: '' }
let dejoLejia = { customer: '', account: '' }

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
    store[tenant.slug] = (await svc<{ id: string }>(`select id from public.stores where slug = $1`, [tenant.storeSlug]))[0]!.id
  }
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'vendedor@tenant-a.com', 'sales_rep'), ($1, $2, $4, 'visor@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VENDEDOR, VISOR],
  )

  const lejia = await producto(TENANT_A, 'LEJ-5', 'Lejía 5 L')
  const jabon = await producto(TENANT_A, 'JAB-1', 'Jabón líquido')

  // Compraba hace 120 y 100 días; nada desde entonces.
  perdido = await cliente(TENANT_A, 'PER')
  await pedido(TENANT_A, perdido.account, 120, '50.00', { product: jabon, sku: 'JAB-1', name: 'Jabón líquido' })
  await pedido(TENANT_A, perdido.account, 100, '50.00', { product: jabon, sku: 'JAB-1', name: 'Jabón líquido' })
  // Compra seguido: no ha dejado de comprar.
  activo = await cliente(TENANT_A, 'ACT')
  await pedido(TENANT_A, activo.account, 5, '80.00', { product: jabon, sku: 'JAB-1', name: 'Jabón líquido' })
  // Sigue comprando, pero dejó la lejía hace 95 días.
  dejoLejia = await cliente(TENANT_A, 'LEJ')
  await pedido(TENANT_A, dejoLejia.account, 95, '30.00', { product: lejia, sku: 'LEJ-5', name: 'Lejía 5 L' })
  await pedido(TENANT_A, dejoLejia.account, 3, '30.00', { product: jabon, sku: 'JAB-1', name: 'Jabón líquido' })

  // Otro tenant con un cliente perdido: nunca debe aparecer en A.
  const otro = await cliente(TENANT_B, 'SECRETO')
  await pedido(TENANT_B, otro.account, 150, '99999.00')

  // Venta reciente para la tendencia (más los de arriba en los días 3 y 5).
  await pedido(TENANT_A, null, 1, '200.00')
  await pedido(TENANT_A, null, 10, '100.00')

  const [rep] = await svc<{ id: string }>(
    `insert into public.sales_reps (organization_id, company_id, user_id, employee_code, full_name)
     values ($1, $2, $3, 'V-01', 'Vendedor Uno') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, VENDEDOR],
  )
  await svc(
    `insert into public.sales_rep_customers (organization_id, company_id, sales_rep_id, customer_id)
     values ($1, $2, $3, $4)`,
    [TENANT_A.organizationId, TENANT_A.companyId, rep!.id, dejoLejia.customer],
  )
})

afterAll(async () => {
  await db?.close()
})

const inactivos = (claims: ReturnType<typeof claimsFor>, texto: string | null, dias: number, tienda = store[TENANT_A.slug]) =>
  como<Json>(claims, `select public.ai_copilot_lapsed_customers($1, $2, $3, 10) as r`, [tienda, texto, dias])

describe('lapsed_customers', () => {
  it('el dueño ve quién compraba y lleva la ventana sin comprar; no el activo ni otro tenant', async () => {
    const r = await inactivos(claimsFor(TENANT_A), null, 90)
    const ids = (r.customers as Json[]).map((c) => c.customer_id)
    expect(ids).toEqual([perdido.customer])
    expect(JSON.stringify(r)).not.toMatch(/SECRETO|99999/)
    expect(r.scope).toBe('all')
  })

  it('con texto: los que dejaron de comprar ESE producto, aunque sigan comprando otros', async () => {
    const r = await inactivos(claimsFor(TENANT_A), 'lejía', 90)
    expect((r.customers as Json[]).map((c) => c.customer_id)).toEqual([dejoLejia.customer])
  })

  it('los comodines del texto no amplían la búsqueda', async () => {
    const r = await inactivos(claimsFor(TENANT_A), '%', 90)
    // «%» queda en nada ⇒ sin filtro de producto: el mismo resultado que sin texto.
    expect((r.customers as Json[]).map((c) => c.customer_id)).toEqual([perdido.customer])
  })

  it('el vendedor ve solo SU cartera', async () => {
    const r = await inactivos(conRol(VENDEDOR), 'lejía', 90)
    expect(r.scope).toBe('portfolio')
    expect((r.customers as Json[]).map((c) => c.customer_id)).toEqual([dejoLejia.customer])
    const sinFiltro = await inactivos(conRol(VENDEDOR), null, 90)
    expect(sinFiltro.customers).toEqual([])
  })

  it('un rol fuera de ventas no puede; tampoco otra tienda ni una ventana fuera de lista', async () => {
    await expect(inactivos(conRol(VISOR), null, 90)).rejects.toThrow(/SIN_PERMISO/)
    await expect(inactivos(claimsFor(TENANT_A), null, 90, store[TENANT_B.slug])).rejects.toThrow(/SIN_PERMISO/)
    await expect(inactivos(claimsFor(TENANT_A), null, 45)).rejects.toThrow(/CAMPO_INVALIDO/)
  })

  it('anon no puede ejecutarla', async () => {
    await expect(
      asRole(db, 'anon', null, async () => db.query(`select public.ai_copilot_lapsed_customers($1, null, 90, 10)`, [store[TENANT_A.slug]])),
    ).rejects.toThrow(/permission denied/i)
  })
})

describe('sales_trend', () => {
  it('serie de la ventana y de la anterior, solo de su tienda', async () => {
    const r = await como<Json>(claimsFor(TENANT_A), `select public.ai_copilot_sales_trend($1, 7) as r`, [store[TENANT_A.slug]])
    const actual = r.current as Json[]
    const previo = r.previous as Json[]
    expect(actual.length).toBeGreaterThanOrEqual(7)
    // Días 1, 3 y 5 en la ventana; el del día 10 en la anterior.
    expect(actual.reduce((s, p) => s + Number(p.orders), 0)).toBe(3)
    expect(previo.reduce((s, p) => s + Number(p.orders), 0)).toBe(1)
    expect(r.currency).toBe('PEN')
    expect(JSON.stringify(r)).not.toMatch(/99999/)
  })

  it('el vendedor no tiene `insights`; otra tienda tampoco', async () => {
    await expect(como(conRol(VENDEDOR), `select public.ai_copilot_sales_trend($1, 7) as r`, [store[TENANT_A.slug]])).rejects.toThrow(/SIN_PERMISO/)
    await expect(como(claimsFor(TENANT_A), `select public.ai_copilot_sales_trend($1, 7) as r`, [store[TENANT_B.slug]])).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// TS: plan, adaptación y respuesta
// ---------------------------------------------------------------------------

const llamada = (o: Partial<LlamadaModelo>): LlamadaModelo => ({
  tool: 'none',
  order_status: 'any',
  payment_status: 'any',
  fulfillment_status: 'any',
  approval_status: 'any',
  placed_within_days: 0,
  older_than_days: 0,
  attention_only: false,
  text: '',
  product_status: 'any',
  days: 0,
  ...o,
})

const ctx = (pregunta: string): ContextoPlan => ({
  disponibles: ['sales_trend', 'lapsed_customers'],
  contexto: { screen: 'sales', entity: null } as never,
  storeId: '11111111-1111-4111-8111-111111111111',
  pregunta,
})

describe('plan de las herramientas nuevas', () => {
  it('ventanas de lista cerrada; texto solo si es literal de la pregunta', () => {
    const p = revisarPlan(
      {
        intent: 'data',
        direct_answer: '',
        calls: [llamada({ tool: 'sales_trend', days: 14 }), llamada({ tool: 'lapsed_customers', days: 45, text: 'lejía' })],
      },
      ctx('¿quién dejó de comprar lejía?'),
    )
    expect(p.calls).toEqual([
      { tool: 'sales_trend', days: 14 },
      { tool: 'lapsed_customers', text: 'lejía', days: 60 },
    ])
    expect(p.discarded).toBe(1)
    const inventado = revisarPlan(
      { intent: 'data', direct_answer: '', calls: [llamada({ tool: 'lapsed_customers', text: 'Coca Cola' })] },
      ctx('¿quién dejó de comprar?'),
    )
    expect(inventado.calls).toEqual([{ tool: 'lapsed_customers', text: null, days: 60 }])
  })
})

describe('tendencia: el sistema suma, el modelo no', () => {
  const raw = {
    days: 7,
    currency: 'PEN',
    current: [
      { day: '2026-11-20', revenue: '100.00', orders: 1 },
      { day: '2026-11-21', revenue: '200.00', orders: 2 },
    ],
    previous: [
      { day: '2026-11-13', revenue: '100.00', orders: 1 },
      { day: '2026-11-14', revenue: '100.00', orders: 1 },
    ],
    best_day: { day: '2026-11-21', revenue: '200.00' },
    zero_days: 0,
  }

  it('métricas calculadas y la serie aparte para dibujar', () => {
    const r = adaptarResultado({ tool: 'sales_trend', days: 7 }, { ok: true, raw }, 0)
    expect(r.status).toBe('ok')
    expect(r.metrics['T1.current.revenue']).toEqual({ kind: 'money', value: '300.00', currency: 'PEN' })
    expect(r.metrics['T1.revenue_delta_pct']).toEqual({ kind: 'percent', value: '50.0' })
    expect(r.chart?.current).toHaveLength(2)
  })

  it('la respuesta lleva el gráfico y un borrador que pasa los candados', () => {
    const resultado = adaptarResultado({ tool: 'sales_trend', days: 7 }, { ok: true, raw }, 0)
    const o: Orquestado = {
      plan: { intent: 'data', directAnswer: '', calls: [{ tool: 'sales_trend', days: 7 }], discarded: 0 },
      resultados: [resultado],
      respuesta: {
        answerable: true,
        answer: 'Las ventas subieron {{T1.revenue_delta_pct}} frente al periodo anterior.',
        highlights: [],
        links: [],
        follow_ups: [],
        draft: { subject: 'Novedades de la semana', body: 'Hola, esta semana vendimos {{T1.current.revenue}}. El equipo de ventas.' },
      },
    }
    const r = revisarCopilot(o)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.charts).toHaveLength(1)
    expect(r.value.draft?.body).toContain('{{T1.current.revenue}}')
  })

  it('un borrador con cifras sueltas o un correo electrónico se descarta', () => {
    const resultado = adaptarResultado({ tool: 'sales_trend', days: 7 }, { ok: true, raw }, 0)
    const base: Orquestado = {
      plan: { intent: 'data', directAnswer: '', calls: [{ tool: 'sales_trend', days: 7 }], discarded: 0 },
      resultados: [resultado],
      respuesta: {
        answerable: true,
        answer: 'Las ventas subieron.',
        highlights: [],
        links: [],
        follow_ups: [],
        draft: { subject: 'Oferta', body: 'Te damos 20 por ciento de descuento, escríbenos a ventas@tienda.pe' },
      },
    }
    const r = revisarCopilot(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.draft).toBeNull()
  })
})
