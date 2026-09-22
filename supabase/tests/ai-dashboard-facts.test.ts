// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, expectFailure, TENANT_A, TENANT_B } from './harness'

/**
 * `public.ai_dashboard_facts` sobre Postgres real (fase 02, Analista IA).
 *
 * Es lo único que ve el modelo en el dashboard, así que tiene que cumplir lo
 * mismo que un KPI y algo más:
 *  1. Cuenta bajo la RLS de quien llama: A nunca ve cifras de B.
 *  2. Solo owner/admin (los roles de la funcionalidad `insights`).
 *  3. Reducido: listas de ≤5 filas y sin correos de clientes.
 *  4. Las secciones de módulos (inventario, entregas, cobranza) solo existen
 *     con el módulo contratado.
 *  5. Las variaciones las calcula SQL, no el modelo.
 */

let db: PGlite
const storeOf: Record<string, string> = {}
const VIEWER = '0a000000-0000-4000-8000-00000000f101'

type Facts = Record<string, unknown> & {
  catalog: Record<string, unknown>
  sales: Record<string, unknown>
  orders: Record<string, unknown> & { attention: Array<Record<string, unknown>> }
  inventory: (Record<string, unknown> & { low: unknown[]; idle_top: unknown[] }) | null
  fulfillment: Record<string, unknown> | null
  credit: (Record<string, unknown> & { customers: Array<Record<string, unknown>> }) | null
}

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

async function hechos(claims: ReturnType<typeof claimsFor>, storeId: string | null): Promise<Facts> {
  return asRole(db, 'authenticated', claims, async () => {
    const rows = await svc<{ f: Facts }>(`select public.ai_dashboard_facts($1) as f`, [storeId])
    return rows[0]!.f
  })
}

async function contratar(tenant: typeof TENANT_A, capability: string) {
  await svc(
    `insert into public.tenant_entitlements
       (organization_id, company_id, entitlement_code, is_active, source)
     values ($1, $2, $3, true, 'hub')
     on conflict (organization_id, company_id, entitlement_code) do update set is_active = true`,
    [tenant.organizationId, tenant.companyId, `ecommerce.${capability}`],
  )
}

async function pedido(
  tenant: typeof TENANT_A,
  numero: string,
  opts: { status?: string; total?: string; diasAtras?: number; approval?: string } = {},
) {
  await svc(
    `insert into public.orders
       (organization_id, company_id, store_id, channel_id, order_number, status, customer_email,
        currency, subtotal, grand_total, placed_at, approval_status)
     values ($1, $2, $3, (select c.id from public.channels c where c.store_id = $3 and c.is_default),
             $4, $5, 'secreto@cliente.com', 'PEN', $6, $6, now() - make_interval(days => $7),
             $8::public.order_approval_status)`,
    [
      tenant.organizationId,
      tenant.companyId,
      storeOf[tenant.slug],
      numero,
      opts.status ?? 'pending',
      opts.total ?? '100.00',
      opts.diasAtras ?? 0,
      opts.approval ?? 'not_required',
    ],
  )
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
    const rows = await svc<{ id: string }>(`select id from public.stores where slug = $1`, [
      tenant.storeSlug,
    ])
    storeOf[tenant.slug] = rows[0]!.id
  }
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VIEWER],
  )

  // A: ventas esta semana 310 (A-1..A-3 + A-APR) frente a 200 la anterior (A-4, A-5).
  await pedido(TENANT_A, 'A-1', { status: 'paid', total: '100.00', diasAtras: 1 })
  await pedido(TENANT_A, 'A-2', { status: 'paid', total: '100.00', diasAtras: 3 })
  await pedido(TENANT_A, 'A-3', { status: 'pending', total: '100.00', diasAtras: 5 })
  await pedido(TENANT_A, 'A-4', { status: 'paid', total: '100.00', diasAtras: 9 })
  await pedido(TENANT_A, 'A-5', { status: 'paid', total: '100.00', diasAtras: 10 })
  // Más pedidos viejos sin pagar que el tope de la lista (5).
  for (let i = 0; i < 6; i += 1) {
    await pedido(TENANT_A, `A-OLD-${i}`, { status: 'pending', total: '10.00', diasAtras: 20 + i })
  }
  await pedido(TENANT_A, 'A-APR', { status: 'pending', total: '10.00', diasAtras: 0, approval: 'pending' })

  // B: un único pedido enorme que A no debe ver nunca.
  await pedido(TENANT_B, 'B-1', { status: 'pending', total: '99999.00', diasAtras: 30 })
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(
    `delete from public.tenant_entitlements where entitlement_code in
       ('ecommerce.credit.management', 'ecommerce.inventory.multiwarehouse', 'ecommerce.fulfillment')`,
  )
})

describe('ai_dashboard_facts — autorización', () => {
  it('un rol sin la funcionalidad insights (viewer) no obtiene el dataset', async () => {
    const claims = claimsFor(TENANT_A, { sub: VIEWER, email: 'lector@tenant-a.com' })
    const message = await expectFailure(() => hechos(claims, storeOf[TENANT_A.slug]!))
    expect(message).toContain('SIN_PERMISO')
  })

  it('pedir la tienda de otra sociedad se rechaza (no devuelve ceros)', async () => {
    const message = await expectFailure(() => hechos(claimsFor(TENANT_A), storeOf[TENANT_B.slug]!))
    expect(message).toContain('SIN_PERMISO')
  })

  it('anon no puede ejecutarla', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, () => svc(`select public.ai_dashboard_facts(null)`)),
    )
    expect(message).toMatch(/permission denied|SIN_PERMISO/i)
  })
})

describe('ai_dashboard_facts — cifras deterministas y aisladas', () => {
  it('la variación de ventas y pedidos la calcula SQL', async () => {
    const f = await hechos(claimsFor(TENANT_A), storeOf[TENANT_A.slug]!)
    expect(f.period_days).toBe(7)
    expect(f.sales.gross_current).toBe('310.00')
    expect(f.sales.gross_previous).toBe('200.00')
    expect(f.sales.gross_delta_pct).toBe('55.0')
    expect(f.sales.orders_current).toBe(4) // incluye el pendiente de aprobación de hoy
    expect(f.sales.orders_previous).toBe(2)
    expect(f.sales.currency).toBe('PEN')
  })

  it('A no ve nada de B', async () => {
    const f = await hechos(claimsFor(TENANT_A), null)
    const texto = JSON.stringify(f)
    expect(texto).not.toContain('B-1')
    expect(texto).not.toContain('99999')
    const b = await hechos(claimsFor(TENANT_B), null)
    expect(JSON.stringify(b)).not.toContain('A-1')
    expect(b.orders.pending).toBe(1)
  })

  it('fase 12: con dos sociedades en el token, el resumen es SOLO de la activa', async () => {
    // Segunda sociedad de la MISMA organización de A, con un pedido propio. La
    // RLS deja verla a quien la tiene en `companies`; el analista no.
    const A2 = {
      ...TENANT_A,
      companyId: '0a000000-0000-4000-8000-0000000000c9',
      slug: 'tenant-a2',
      storeSlug: 'tienda-a2',
    }
    // `bootstrap_tenant` da de alta ORGANIZACIONES; la segunda sociedad se
    // crea con las mismas filas que él escribe.
    await svc(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
       values ($1, $2, $3, $4, 'owner', 'active')`,
      [A2.organizationId, A2.companyId, A2.ownerId, A2.adminEmail],
    )
    await svc(
      `insert into public.stores (organization_id, company_id, slug, name, status, currency)
       values ($1, $2, $3, 'Tienda A2', 'active', 'PEN')`,
      [A2.organizationId, A2.companyId, A2.storeSlug],
    )
    storeOf[A2.slug] = (await svc<{ id: string }>(`select id from public.stores where slug = $1`, [A2.storeSlug]))[0]!.id
    await pedido(A2, 'A2-SECRETO', { status: 'pending', total: '77777.00', diasAtras: 30 })

    const dosSociedades = claimsFor(TENANT_A, {
      companies: [
        { id: TENANT_A.companyId, role: 'admin' },
        { id: A2.companyId, role: 'admin' },
      ],
    })
    // Premisa: la RLS SÍ deja ver el pedido de A2 con este token. Si no, la
    // prueba no probaría nada.
    const visibles = await asRole(db, 'authenticated', dosSociedades, () =>
      svc<{ n: number }>(`select count(*)::int as n from public.orders where order_number = 'A2-SECRETO'`),
    )
    expect(visibles[0]?.n).toBe(1)

    const f = await hechos(dosSociedades, null)
    const texto = JSON.stringify(f)
    expect(texto).not.toContain('A2-SECRETO')
    expect(f.orders.unpaid_over_3d).toBe(7)
  })

  it('pedidos que piden atención: conteos completos, lista con tope de 5 y sin correos', async () => {
    const f = await hechos(claimsFor(TENANT_A), storeOf[TENANT_A.slug]!)
    expect(f.orders.unpaid_over_3d).toBe(7) // A-3 (5 días) + 6 viejos
    expect(f.orders.awaiting_approval).toBe(1)
    expect(f.orders.attention.length).toBe(5)
    // El más antiguo primero.
    expect(f.orders.attention[0]!.order_number).toBe('A-OLD-5')
    expect(JSON.stringify(f)).not.toContain('@')
  })
})

describe('ai_dashboard_facts — secciones por módulo contratado', () => {
  it('sin módulos contratados, inventario y cobranza no existen', async () => {
    const f = await hechos(claimsFor(TENANT_A), storeOf[TENANT_A.slug]!)
    expect(f.inventory).toBeNull()
    expect(f.credit).toBeNull()
    // `fulfillment` es módulo base: su sección existe según `company_is_entitled`.
    const [base] = await svc<{ ok: boolean }>(
      `select ebim.company_is_entitled($1, $2, 'fulfillment') as ok`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    expect(f.fulfillment === null).toBe(!base!.ok)
  })

  it('con cobranza contratada, resume la deuda vencida sin correos ni documentos fiscales', async () => {
    await contratar(TENANT_A, 'credit.management')
    const [cliente] = await svc<{ id: string }>(
      `insert into public.customers (organization_id, company_id, kind, code, name, email, tax_id)
       values ($1, $2, 'company', 'C-001', 'Bodega Norte', 'pagos@bodega.pe', '20123456789') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await svc(
      `insert into public.ar_documents
         (organization_id, company_id, customer_id, document_number, currency, amount, issued_at, due_at)
       values ($1, $2, $3, 'V-1', 'PEN', 100.00, current_date - 40, current_date - 10),
              ($1, $2, $3, 'V-2', 'PEN', 200.00, current_date - 80, current_date - 45),
              ($1, $2, $3, 'V-3', 'PEN', 300.00, current_date, current_date + 20)`,
      [TENANT_A.organizationId, TENANT_A.companyId, cliente!.id],
    )

    const f = await hechos(claimsFor(TENANT_A), storeOf[TENANT_A.slug]!)
    expect(f.credit).not.toBeNull()
    expect(f.credit!.overdue_documents).toBe(2)
    expect(f.credit!.overdue_balance).toBe('300.00')
    expect(f.credit!.overdue_currency).toBe('PEN')
    expect(f.credit!.customers[0]).toMatchObject({ name: 'Bodega Norte', documents: 2, max_days_overdue: 45 })
    const texto = JSON.stringify(f)
    expect(texto).not.toContain('pagos@bodega.pe')
    expect(texto).not.toContain('20123456789')

    // B no ve la deuda de A aunque tenga el módulo.
    await contratar(TENANT_B, 'credit.management')
    const b = await hechos(claimsFor(TENANT_B), null)
    expect(b.credit!.overdue_documents).toBe(0)
  })

  it('con inventario y entregas contratados, las secciones existen y respetan el tope', async () => {
    await contratar(TENANT_A, 'inventory.multiwarehouse')
    await contratar(TENANT_A, 'fulfillment')
    const f = await hechos(claimsFor(TENANT_A), storeOf[TENANT_A.slug]!)
    expect(f.inventory).not.toBeNull()
    expect(f.inventory!.low.length).toBeLessThanOrEqual(5)
    expect(f.inventory!.idle_top.length).toBeLessThanOrEqual(5)
    expect(f.fulfillment).toMatchObject({ open: 0, overdue: 0, failed: 0 })
  })
})
