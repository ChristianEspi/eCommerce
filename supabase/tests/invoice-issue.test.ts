// @vitest-environment node
/**
 * Cierre · D1 — el productor de `invoice.issue`, contra Postgres real.
 *
 * El transporte ya existía (outbox, worker, disyuntor, monitor) y el catálogo
 * declaraba `invoice.issue`; lo que faltaba era quien lo encolara. Aquí se
 * compra que el productor:
 *
 *  · encola UNA vez por comprobante, sobre la cola de siempre, y repetir la
 *    solicitud no duplica el mensaje;
 *  · sin proveedor fiscal NO falla: queda `pending_configuration`, visible en la
 *    vista de estado y como incidente de operación, y se encola cuando el tenant
 *    lo configura;
 *  · lleva un payload canónico versionado cuya forma es la que declara
 *    TypeScript;
 *  · toma el tenant de la FILA del comprobante y nunca de quien llama;
 *  · solo lo pide owner/admin con la capacidad `invoicing`, y un tenant no ve
 *    ni toca lo del otro.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  TENANT_A,
  TENANT_B,
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
} from './harness.ts'
import {
  INVOICE_ISSUE_LINE_KEYS,
  INVOICE_ISSUE_PAYLOAD_KEYS,
  INVOICE_ISSUE_SCHEMA_VERSION,
} from '../../src/domain/ports/invoicing.ts'

type Row = Record<string, unknown>
type Tenant = typeof TENANT_A

const ENTITLEMENT = 'ecommerce.invoicing'
const VIEWER = '0a000000-0000-4000-8000-0000000017f1'
const ORDERS_USER = '0a000000-0000-4000-8000-0000000017f2'

let db: PGlite
let provider = ''
const stores = new Map<string, string>()
const channels = new Map<string, string>()
let seq = 0

/** Superusuario de la prueba: fixtures, sin RLS. */
async function sql<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(query, params)).rows
}

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function asUser<T = Row>(
  tenant: Tenant,
  query: string,
  params: unknown[] = [],
  overrides: Parameters<typeof claimsFor>[1] = {},
): Promise<T[]> {
  return asRole(db, 'authenticated', claimsFor(tenant, overrides), async () =>
    (await db.query<T>(query, params)).rows,
  )
}

async function request(tenant: Tenant, invoiceId: string, overrides = {}): Promise<Row> {
  const [row] = await asUser<{ r: Row }>(
    tenant,
    `select public.invoice_request_issue($1) as r`,
    [invoiceId],
    overrides,
  )
  return row?.r as Row
}

/** Comprobante `pending` completo: dos líneas que suman la cabecera. */
async function invoice(
  tenant: Tenant,
  options: { lines?: boolean; mismatch?: boolean; status?: string } = {},
): Promise<string> {
  seq += 1
  const store = stores.get(tenant.organizationId)
  const [order] = await sql<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, currency,
        subtotal, tax_total, grand_total, customer_email, channel_id)
     values ($1, $2, $3, $4, 'paid', 'PEN', 100, 18, 118, 'cliente@test.com', $5)
     returning id`,
    [tenant.organizationId, tenant.companyId, store, `EC-INV-${seq}`, channels.get(tenant.organizationId)],
  )
  const [inv] = await sql<{ id: string }>(
    `insert into public.invoices
       (organization_id, company_id, store_id, order_id, series, status, currency,
        customer_name, customer_tax_id, net_total, tax_total, gross_total)
     values ($1, $2, $3, $4, 'F001', 'pending', 'PEN', 'Cliente SAC', '20123456789', 100, 18, 118)
     returning id`,
    [tenant.organizationId, tenant.companyId, store, order?.id],
  )
  const id = String(inv?.id)
  if (options.lines !== false) {
    await sql(
      `insert into public.invoice_items
         (organization_id, company_id, invoice_id, description, quantity, unit_price,
          net_amount, tax_rate, tax_amount, position)
       values ($1, $2, $3, 'Jabón', 2, 30, 60, 0.18, 10.80, 1),
              ($1, $2, $3, 'Champú', 1, $4, $4, 0.18, 7.20, 2)`,
      [tenant.organizationId, tenant.companyId, id, options.mismatch ? 39 : 40],
    )
  }
  if (options.status) {
    await sql(`update public.invoices set status = $2::public.invoice_status, number = $3 where id = $1`, [
      id,
      options.status,
      `F001-${seq}`,
    ])
  }
  return id
}

async function configureProvider(tenant: Tenant, code = provider, active = true) {
  await sql(
    `insert into public.tenant_integrations (organization_id, company_id, provider_code, is_active)
     values ($1, $2, $3, $4)
     on conflict (organization_id, company_id, provider_code) do update set is_active = excluded.is_active`,
    [tenant.organizationId, tenant.companyId, code, active],
  )
}

beforeAll(async () => {
  db = await createTestDatabase()
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
      tenant.organizationId,
      tenant.companyId,
      tenant.slug,
      `Cuenta ${tenant.slug}`,
      tenant.adminEmail,
      tenant.ownerId,
      tenant.storeSlug,
      `Tienda ${tenant.slug}`,
    ])
    const [store] = await sql<{ id: string }>(
      `select id from public.stores where organization_id = $1`,
      [tenant.organizationId],
    )
    stores.set(tenant.organizationId, String(store?.id))
    const [channel] = await sql<{ id: string }>(
      `select id from public.channels where store_id = $1 and is_default`,
      [store?.id],
    )
    channels.set(tenant.organizationId, String(channel?.id))
  }
  await sql(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'lector@tenant-a.com', 'viewer'),
            ($1, $2, $4, 'pedidos@tenant-a.com', 'orders')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VIEWER, ORDERS_USER],
  )
  // El proveedor sale del CATÁLOGO, no de una constante de la prueba.
  const [row] = await sql<{ code: string }>(
    `select code from public.integration_providers
      where kind = 'invoicing' and 'invoice.issue' = any (capabilities) and is_active
      order by code limit 1`,
  )
  provider = String(row?.code)
  expect(provider).not.toBe('undefined')
}, 240_000)

beforeEach(async () => {
  await sql(`delete from public.tenant_integrations where provider_code in
               (select code from public.integration_providers where kind = 'invoicing')`)
  await sql(`delete from public.integration_messages`)
  await sql(`delete from public.integration_outbox`)
  await sql(`delete from public.integration_circuit`)
  await sql(`delete from public.ops_events`)
  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(
      `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
      [tenant.organizationId, tenant.companyId, [ENTITLEMENT]],
    )
  }
})

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('sin proveedor fiscal: no falla, queda a la vista', () => {
  it('la solicitud queda pending_configuration y el comprobante sigue intacto', async () => {
    const inv = await invoice(TENANT_A)
    const result = await request(TENANT_A, inv)

    expect(result).toMatchObject({
      invoice_id: inv,
      state: 'pending_configuration',
      blocked_code: 'FACTURADOR_NO_CONFIGURADO',
      outbox_id: null,
      replay: false,
    })
    // Nada en la cola: no hay a quién mandarlo.
    const outbox = await sql(`select id from public.integration_outbox where operation = 'invoice.issue'`)
    expect(outbox).toHaveLength(0)
    // El documento no se tocó ni se rompió.
    const [doc] = await sql(`select status from public.invoices where id = $1`, [inv])
    expect(doc?.status).toBe('pending')
  })

  it('se ve en la vista de estado, en la bitácora del comprobante y como incidente', async () => {
    const inv = await invoice(TENANT_A)
    await request(TENANT_A, inv)

    const [status] = await asUser(
      TENANT_A,
      `select issue_state, blocked_code, request_count from public.invoice_issue_status
        where invoice_id = $1`,
      [inv],
    )
    expect(status).toMatchObject({
      issue_state: 'pending_configuration',
      blocked_code: 'FACTURADOR_NO_CONFIGURADO',
      request_count: 1,
    })

    const events = await sql(`select detail from public.invoice_events where invoice_id = $1`, [inv])
    expect(events.map((e) => e.detail)).toContain('FACTURADOR_NO_CONFIGURADO')

    const incidents = await asUser(
      TENANT_A,
      `select kind::text as kind, severity::text as severity, code, operation, resolved_at
         from public.ops_events where entity_id = $1`,
      [inv],
    )
    expect(incidents).toEqual([
      {
        kind: 'integration_failed',
        severity: 'warning',
        code: 'FACTURADOR_NO_CONFIGURADO',
        operation: 'invoice.issue',
        resolved_at: null,
      },
    ])
  })

  it('pedirlo otra vez sin proveedor no abre otro incidente ni otra solicitud', async () => {
    const inv = await invoice(TENANT_A)
    await request(TENANT_A, inv)
    const again = await request(TENANT_A, inv)
    expect(again).toMatchObject({ state: 'pending_configuration', replay: true })

    const requests = await sql(
      `select request_count from public.invoice_issue_requests where invoice_id = $1`,
      [inv],
    )
    expect(requests).toEqual([{ request_count: 2 }])
    const incidents = await sql(`select id from public.ops_events where entity_id = $1`, [inv])
    expect(incidents).toHaveLength(1)
  })

  it('un proveedor configurado pero INACTIVO sigue sin contar', async () => {
    await configureProvider(TENANT_A, provider, false)
    const inv = await invoice(TENANT_A)
    expect(await request(TENANT_A, inv)).toMatchObject({
      state: 'pending_configuration',
      blocked_code: 'FACTURADOR_NO_CONFIGURADO',
    })
  })

  it('con dos proveedores activos no se elige uno a ciegas', async () => {
    await sql(
      `insert into public.integration_providers (code, kind, name, capabilities)
       values ('fiscal_prueba', 'invoicing', 'Fiscal de prueba', '{invoice.issue}')
       on conflict (code) do nothing`,
    )
    await configureProvider(TENANT_B)
    await configureProvider(TENANT_B, 'fiscal_prueba')
    const inv = await invoice(TENANT_B)
    expect(await request(TENANT_B, inv)).toMatchObject({
      state: 'pending_configuration',
      blocked_code: 'FACTURADOR_AMBIGUO',
      outbox_id: null,
    })
    await sql(`delete from public.tenant_integrations where provider_code = 'fiscal_prueba'`)
    await sql(`delete from public.integration_providers where code = 'fiscal_prueba'`)
  })

  it('al configurar el proveedor, volver a pedirlo encola y cierra el incidente', async () => {
    const inv = await invoice(TENANT_A)
    await request(TENANT_A, inv)
    await configureProvider(TENANT_A)

    const result = await request(TENANT_A, inv)
    expect(result).toMatchObject({
      state: 'enqueued',
      provider_code: provider,
      outbox_status: 'pending',
      replay: false,
    })
    expect(result.outbox_id).toBeTruthy()

    const [incident] = await sql<{ resolved_at: unknown; resolved_by: string }>(
      `select resolved_at, resolved_by from public.ops_events where entity_id = $1`,
      [inv],
    )
    expect(incident?.resolved_at).not.toBeNull()
    expect(incident?.resolved_by).toBe(TENANT_A.ownerId)

    const [status] = await asUser(
      TENANT_A,
      `select issue_state, blocked_code, request_count from public.invoice_issue_status
        where invoice_id = $1`,
      [inv],
    )
    expect(status).toMatchObject({ issue_state: 'pending', blocked_code: null, request_count: 2 })
  })
})

describe('con proveedor: un mensaje por comprobante, en la cola de siempre', () => {
  beforeEach(async () => {
    await configureProvider(TENANT_A)
    await configureProvider(TENANT_B)
  })

  it('encola invoice.issue una sola vez', async () => {
    const inv = await invoice(TENANT_A)
    const result = await request(TENANT_A, inv)

    const outbox = await sql(
      `select id, organization_id, company_id, provider_code, operation, idempotency_key, status::text as status
         from public.integration_outbox where operation = 'invoice.issue'`,
    )
    expect(outbox).toEqual([
      {
        id: result.outbox_id,
        organization_id: TENANT_A.organizationId,
        company_id: TENANT_A.companyId,
        provider_code: provider,
        operation: 'invoice.issue',
        idempotency_key: `invoice.issue:${inv}`,
        status: 'pending',
      },
    ])
    const [doc] = await sql(`select provider_code, status from public.invoices where id = $1`, [inv])
    expect(doc).toEqual({ provider_code: provider, status: 'pending' })
  })

  it('repetir la solicitud devuelve el MISMO mensaje y no duplica', async () => {
    const inv = await invoice(TENANT_A)
    const first = await request(TENANT_A, inv)
    const second = await request(TENANT_A, inv)
    // Y el camino de servidor, con la misma clave, tampoco.
    const [third] = await svc<{ r: Row }>(`select ebim.invoice_issue_enqueue($1) as r`, [inv])

    expect(second).toMatchObject({ state: 'enqueued', replay: true, outbox_id: first.outbox_id })
    expect(third?.r).toMatchObject({ replay: true, outbox_id: first.outbox_id })

    const outbox = await sql(
      `select id from public.integration_outbox where idempotency_key = $1`,
      [`invoice.issue:${inv}`],
    )
    expect(outbox).toHaveLength(1)
    const [req] = await sql(`select request_count from public.invoice_issue_requests where invoice_id = $1`, [inv])
    expect(req?.request_count).toBe(3)
  })

  it('una vez encolado, cambiar el estado del comprobante no reencola', async () => {
    const inv = await invoice(TENANT_A)
    const first = await request(TENANT_A, inv)
    await sql(`update public.invoices set status = 'issued', number = 'F001-900' where id = $1`, [inv])

    expect(await request(TENANT_A, inv)).toMatchObject({ replay: true, outbox_id: first.outbox_id })
    const outbox = await sql(`select id from public.integration_outbox where operation = 'invoice.issue'`)
    expect(outbox).toHaveLength(1)
  })

  it('dos comprobantes son dos mensajes', async () => {
    const a = await request(TENANT_A, await invoice(TENANT_A))
    const b = await request(TENANT_A, await invoice(TENANT_A))
    expect(a.outbox_id).not.toBe(b.outbox_id)
  })

  it('el payload es el canónico v1 y su forma es la de TypeScript', async () => {
    const inv = await invoice(TENANT_A)
    const result = await request(TENANT_A, inv)
    const [row] = await sql<{ payload: Record<string, unknown> }>(
      `select payload from public.integration_outbox where id = $1`,
      [result.outbox_id],
    )
    const payload = row?.payload as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual([...INVOICE_ISSUE_PAYLOAD_KEYS].sort())
    expect(payload.schema_version).toBe(INVOICE_ISSUE_SCHEMA_VERSION)
    expect(result.schema_version).toBe(INVOICE_ISSUE_SCHEMA_VERSION)
    expect(payload).toMatchObject({
      operation: 'invoice.issue',
      idempotency_key: `invoice.issue:${inv}`,
      organization_id: TENANT_A.organizationId,
      company_id: TENANT_A.companyId,
      store_id: stores.get(TENANT_A.organizationId),
      invoice_id: inv,
      series: 'F001',
      currency: 'PEN',
      customer: { name: 'Cliente SAC', tax_id: '20123456789' },
      // Importes como TEXTO: un float en el cable descuadra la factura.
      totals: { net: '100.00', tax: '18.00', gross: '118.00' },
    })
    expect(String(payload.issued_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

    const lines = payload.lines as Record<string, unknown>[]
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual([...INVOICE_ISSUE_LINE_KEYS].sort())
    }
    expect(lines.map((l) => l.description)).toEqual(['Jabón', 'Champú'])
    expect(lines[0]).toMatchObject({ net_amount: '60.00', tax_rate: '0.1800', tax_amount: '10.80' })
  })

  it('el worker de siempre lo reclama y su fallo se ve en el estado del comprobante', async () => {
    const inv = await invoice(TENANT_A)
    const result = await request(TENANT_A, inv)

    const claimed = await svc<{ id: string }>(`select id from public.integration_claim($1, 'w-test', 10)`, [
      provider,
    ])
    expect(claimed.map((c) => c.id)).toEqual([result.outbox_id])
    await svc(`select public.integration_fail($1, 'el emisor no contesta', 503)`, [result.outbox_id])

    const [status] = await asUser(
      TENANT_A,
      `select issue_state, attempts, last_error from public.invoice_issue_status where invoice_id = $1`,
      [inv],
    )
    expect(status).toMatchObject({ issue_state: 'pending', attempts: 1 })
    expect(String(status?.last_error)).toMatch(/no contesta/)

    const [health] = await asUser<{ h: { providers: Row[] } }>(TENANT_A, `select public.integration_health() as h`)
    const fila = health?.h.providers.find((p) => p.provider_code === provider)
    expect(fila).toMatchObject({ pending: 1, failed_24h: 1 })
  })
})

describe('el documento tiene que estar completo', () => {
  beforeEach(async () => {
    await configureProvider(TENANT_A)
  })

  it('sin líneas no se emite', async () => {
    const inv = await invoice(TENANT_A, { lines: false })
    expect(await expectFailure(() => request(TENANT_A, inv))).toMatch(/COMPROBANTE_SIN_LINEAS/)
  })

  it('líneas que no suman la cabecera no se emiten', async () => {
    const inv = await invoice(TENANT_A, { mismatch: true })
    expect(await expectFailure(() => request(TENANT_A, inv))).toMatch(/COMPROBANTE_DESCUADRADO/)
  })

  it('lo que ya no está pendiente no se emite por primera vez', async () => {
    const inv = await invoice(TENANT_A, { status: 'issued' })
    expect(await expectFailure(() => request(TENANT_A, inv))).toMatch(/COMPROBANTE_NO_EMITIBLE/)
  })

  it('un fallo de validación no deja nada a medias', async () => {
    const inv = await invoice(TENANT_A, { lines: false })
    await expectFailure(() => request(TENANT_A, inv))
    expect(await sql(`select id from public.invoice_issue_requests where invoice_id = $1`, [inv])).toEqual([])
    expect(await sql(`select id from public.integration_outbox where operation = 'invoice.issue'`)).toEqual([])
  })
})

describe('tenant: de la fila, nunca de quien llama', () => {
  beforeEach(async () => {
    await configureProvider(TENANT_A)
    await configureProvider(TENANT_B)
  })

  it('el comando no acepta ningún parámetro de tenant', async () => {
    const rows = await sql<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'invoice_request_issue'`,
    )
    expect(rows).toEqual([{ args: 'p_invoice_id uuid' }])
  })

  it('el tenant B no puede pedir la emisión de un comprobante de A: «no existe»', async () => {
    const inv = await invoice(TENANT_A)
    expect(await expectFailure(() => request(TENANT_B, inv))).toMatch(/COMPROBANTE_NO_ENCONTRADO/)
    expect(await sql(`select id from public.integration_outbox where operation = 'invoice.issue'`)).toEqual([])
  })

  it('un JWT que declara la organización de A sin membresía tampoco', async () => {
    const inv = await invoice(TENANT_A)
    const message = await expectFailure(() =>
      request(TENANT_B, inv, {
        org_id: TENANT_A.organizationId,
        companies: [{ id: TENANT_A.companyId, role: 'owner' }],
        active_company: TENANT_A.companyId,
      }),
    )
    expect(message).toMatch(/COMPROBANTE_NO_ENCONTRADO/)
  })

  it('el mensaje se ata a la sociedad del comprobante', async () => {
    const invB = await invoice(TENANT_B)
    const result = await request(TENANT_B, invB)
    const [row] = await sql(
      `select organization_id, company_id, payload->>'organization_id' as p_org,
              payload->>'company_id' as p_company
         from public.integration_outbox where id = $1`,
      [result.outbox_id],
    )
    expect(row).toEqual({
      organization_id: TENANT_B.organizationId,
      company_id: TENANT_B.companyId,
      p_org: TENANT_B.organizationId,
      p_company: TENANT_B.companyId,
    })
  })

  it('B no ve la solicitud, el estado ni el mensaje de A', async () => {
    const inv = await invoice(TENANT_A)
    await request(TENANT_A, inv)

    // B tiene sus propias solicitudes de otros casos; lo que no puede es ver
    // ninguna fila de la sociedad de A.
    expect(
      await asUser(TENANT_B, `select id from public.invoice_issue_requests where organization_id = $1 or invoice_id = $2`, [
        TENANT_A.organizationId,
        inv,
      ]),
    ).toEqual([])
    expect(await asUser(TENANT_B, `select invoice_id from public.invoice_issue_status where invoice_id = $1`, [inv])).toEqual([])
    expect(
      await asUser(TENANT_B, `select id from public.integration_outbox where idempotency_key = $1`, [
        `invoice.issue:${inv}`,
      ]),
    ).toEqual([])
    // A sí lo ve.
    expect(
      await asUser(TENANT_A, `select id from public.invoice_issue_requests where invoice_id = $1`, [inv]),
    ).toHaveLength(1)
  })

  it('nadie escribe la solicitud desde el cliente, ni siquiera su owner', async () => {
    const inv = await invoice(TENANT_A)
    await request(TENANT_A, inv)
    const update = await expectFailure(() =>
      asUser(TENANT_A, `update public.invoice_issue_requests set state = 'pending_configuration', blocked_code = 'X_Y_Z'`),
    )
    expect(update).toMatch(/permission denied/i)
    const insert = await expectFailure(() =>
      asUser(
        TENANT_A,
        `insert into public.invoice_issue_requests
           (organization_id, company_id, invoice_id, state, blocked_code, idempotency_key, schema_version)
         values ($1, $2, $3, 'pending_configuration', 'FALSO', 'invoice.issue:x', 1)`,
        [TENANT_A.organizationId, TENANT_A.companyId, inv],
      ),
    )
    expect(insert).toMatch(/permission denied/i)
  })
})

describe('quién puede pedirlo', () => {
  beforeEach(async () => {
    await configureProvider(TENANT_A)
  })

  it('un lector no emite', async () => {
    const inv = await invoice(TENANT_A)
    const message = await expectFailure(() =>
      request(TENANT_A, inv, {
        sub: VIEWER,
        email: 'lector@tenant-a.com',
        companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
      }),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('el rol de pedidos ve el estado pero no emite', async () => {
    const inv = await invoice(TENANT_A)
    const claims = {
      sub: ORDERS_USER,
      email: 'pedidos@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'orders' }],
    }
    expect(await expectFailure(() => request(TENANT_A, inv, claims))).toMatch(/SIN_PERMISO/)
    const rows = await asUser(
      TENANT_A,
      `select issue_state from public.invoice_issue_status where invoice_id = $1`,
      [inv],
      claims,
    )
    expect(rows).toEqual([{ issue_state: 'not_requested' }])
  })

  it('sin la capacidad de facturación no se emite', async () => {
    await svc(
      `select public.sync_platform_context($1, $2, true, '{}'::text[], 'hub'::public.entitlement_source, null)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const inv = await invoice(TENANT_A)
    expect(await expectFailure(() => request(TENANT_A, inv))).toMatch(/MODULO_NO_CONTRATADO/)
  })

  it('anon no alcanza el comando y nadie del cliente alcanza el núcleo', async () => {
    const rows = await sql<{ fn: string; role: string; ok: boolean }>(
      `select p.proname as fn, r.rolname as role, has_function_privilege(r.oid, p.oid, 'EXECUTE') as ok
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join pg_roles r
        where ((n.nspname = 'public' and p.proname = 'invoice_request_issue')
            or (n.nspname = 'ebim' and p.proname = 'invoice_issue_enqueue'))
          and r.rolname in ('anon', 'authenticated')
        order by 1, 2`,
    )
    expect(rows).toEqual([
      { fn: 'invoice_issue_enqueue', role: 'anon', ok: false },
      { fn: 'invoice_issue_enqueue', role: 'authenticated', ok: false },
      { fn: 'invoice_request_issue', role: 'anon', ok: false },
      { fn: 'invoice_request_issue', role: 'authenticated', ok: true },
    ])
  })
})
