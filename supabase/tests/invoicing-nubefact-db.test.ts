// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Facturación · fase 2 en la base (2026-11-20).
 *
 *  · credenciales de Nubefact POR SOCIEDAD, cifradas en Vault; el navegador ve
 *    solo una pista y nunca las lee; solo service_role las descifra;
 *  · el resultado del emisor queda en el comprobante; aceptado es final y el
 *    número no lo cambia el emisor;
 *  · un rechazo por datos cierra el mensaje sin reintento y deja el número;
 *  · la consulta de pendientes de SUNAT no repite antes de 15 minutos;
 *  · otra sociedad no ve ni toca nada.
 */

type Row = Record<string, unknown>

let db: PGlite
let storeA = ''
let channelA = ''
let seq = 0

const RUTA = 'https://api.nubefact.com/api/v1/03989d1a-6c8c-4b71-b1cd-7d37001deaa0'
const TOKEN = 'd0a80b88cde446d092025465bdb4673e103a0d881ca6479ebbab10664dbc5677'
const VENDEDOR = '0f000000-0000-4000-8000-00000000e001'

async function sql<T = Row>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}
async function as<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []) {
  return asRole(db, 'authenticated', claims, async () => (await db.query<T>(query, params)).rows)
}
async function svc<T = Row>(query: string, params: unknown[] = []) {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}
async function fallo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    return String((error as Error).message)
  }
  throw new Error('se esperaba un error')
}

const ownerA = claimsFor(TENANT_A)
const ownerB = claimsFor(TENANT_B)

const configurar = (claims: JwtClaims, store: string, token: string | null = TOKEN, active = true, ruta = RUTA) =>
  as<{ r: Row }>(claims, `select public.invoicing_nubefact_configure($1::uuid, $2, $3, $4) as r`, [store, ruta, token, active])

/** Comprobante pendiente de A, encolado a Nubefact. Devuelve ids. */
async function encolado(): Promise<{ invoice: string; outbox: string }> {
  seq += 1
  const [o] = await sql<{ id: string }>(
    `insert into public.orders
       (organization_id, company_id, store_id, order_number, status, payment_status, currency,
        subtotal, tax_total, grand_total, customer_email, customer_name, channel_id, billing_address)
     values ($1, $2, $3, $4, 'pending', 'pending', 'PEN', 100, 18, 118, 'c@cli.pe', 'Ana', $5,
             '{"document_type":"receipt","id_type":"dni","tax_id":"74705043","legal_name":"Ana Torres"}'::jsonb)
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, `NF-${seq}`, channelA],
  )
  await sql(
    `insert into public.order_items
       (organization_id, company_id, store_id, order_id, sku, name, quantity, unit_price, tax_rate, tax_amount, tax_inclusive)
     values ($1, $2, $3, $4, 'S', 'Jabón', 1, 100, 0.18, 18, false)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, o?.id],
  )
  const [inv] = await sql<{ id: string }>(`select ebim.invoice_for_order($1) as id`, [o?.id])
  const [r] = await as<{ r: Row }>(ownerA, `select public.invoice_request_issue($1) as r`, [inv?.id])
  return { invoice: String(inv?.id), outbox: String(r?.r?.outbox_id) }
}

beforeAll(async () => {
  db = await createTestDatabase()
  await db.exec(`
    create schema if not exists vault;
    create table vault.secrets (
      id uuid primary key default gen_random_uuid(),
      name text unique, description text, secret text not null
    );
    create view vault.decrypted_secrets as
      select id, name, description, secret, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text default null,
      new_description text default '', new_key_id uuid default null) returns uuid
      language sql as $$ insert into vault.secrets (name, description, secret)
                         values (new_name, new_description, new_secret) returning id $$;
    create function vault.update_secret(secret_id uuid, new_secret text default null,
      new_name text default null, new_description text default null, new_key_id uuid default null)
      returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret)
                                       where id = secret_id $$;
  `)
  for (const tenant of [TENANT_A, TENANT_B]) {
    await sql(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.adminEmail, tenant.ownerId, tenant.storeSlug,
    ])
  }
  storeA = String((await sql(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  channelA = String((await sql(`select id from public.channels where store_id = $1 and is_default`, [storeA]))[0]?.id)
  await sql(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'v@tenant-a.com', 'sales_rep')`,
    [TENANT_A.organizationId, TENANT_A.companyId, VENDEDOR],
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('credenciales', () => {
  it('se guardan cifradas; la sociedad ve solo pistas; el token no va a la auditoría', async () => {
    const [r] = await configurar(ownerA, storeA)
    expect(r?.r).toMatchObject({ provider: 'nubefact', active: true, token_hint: '…5677' })
    const [ti] = await as<{ config: Row; is_active: boolean }>(
      ownerA,
      `select config, is_active from public.tenant_integrations where provider_code = 'nubefact'`,
    )
    expect(ti?.is_active).toBe(true)
    expect(JSON.stringify(ti?.config)).not.toContain(TOKEN)
    expect(ti?.config).toMatchObject({ token_hint: '…5677' })
    const audit = await sql(`select changes::text as c from public.audit_log where action = 'invoicing.provider_configured'`)
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.every((a) => !String(a.c).includes(TOKEN))).toBe(true)
  })

  it('solo service_role las descifra', async () => {
    const [r] = await svc<{ c: Row }>(`select public.invoicing_credentials_for($1, $2, 'nubefact') as c`, [
      TENANT_A.organizationId, TENANT_A.companyId,
    ])
    expect(r?.c).toEqual({ ruta: RUTA, token: TOKEN })
    expect(
      await fallo(() => as(ownerA, `select public.invoicing_credentials_for($1, $2, 'nubefact')`, [TENANT_A.organizationId, TENANT_A.companyId])),
    ).toMatch(/permission denied/)
  })

  it('cambiar solo la ruta conserva el token; desactivar deja de entregarlas', async () => {
    const otraRuta = 'https://api.nubefact.com/api/v1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await configurar(ownerA, storeA, null, true, otraRuta)
    const [r] = await svc<{ c: Row }>(`select public.invoicing_credentials_for($1, $2, 'nubefact') as c`, [
      TENANT_A.organizationId, TENANT_A.companyId,
    ])
    expect(r?.c).toEqual({ ruta: otraRuta, token: TOKEN })
    await configurar(ownerA, storeA, null, false, otraRuta)
    const [off] = await svc<{ c: Row | null }>(`select public.invoicing_credentials_for($1, $2, 'nubefact') as c`, [
      TENANT_A.organizationId, TENANT_A.companyId,
    ])
    expect(off?.c).toBeNull()
    await configurar(ownerA, storeA)
  })

  it('ruta o token inválidos, rol sin administración y otra sociedad: rechazados', async () => {
    expect(await fallo(() => configurar(ownerA, storeA, TOKEN, true, 'https://evil.com/api/v1/xxxxxxxx'))).toMatch(/RUTA_NO_VALIDA/)
    expect(await fallo(() => configurar(ownerA, storeA, 'corto'))).toMatch(/TOKEN_NO_VALIDO/)
    const vendedor = claimsFor(TENANT_A, { sub: VENDEDOR, email: 'v@tenant-a.com', companies: [{ id: TENANT_A.companyId, role: 'sales_rep' }] })
    expect(await fallo(() => configurar(vendedor, storeA))).toMatch(/SIN_PERMISO/)
    expect(await fallo(() => configurar(ownerB, storeA))).toMatch(/TIENDA_NO_DISPONIBLE/)
    expect(await as(ownerB, `select 1 from public.tenant_integrations where provider_code = 'nubefact'`)).toEqual([])
  })
})

describe('emisión y resultado', () => {
  it('con Nubefact activo, la emisión se encola a nubefact con número', async () => {
    const { invoice, outbox } = await encolado()
    const [o] = await sql(`select provider_code, payload->>'number' as n from public.integration_outbox where id = $1`, [outbox])
    expect(o).toEqual({ provider_code: 'nubefact', n: expect.stringMatching(/^\d{8}$/) })
    expect((await sql(`select provider_code from public.invoices where id = $1`, [invoice]))[0]?.provider_code).toBe('nubefact')
  })

  it('registra el resultado; aceptado es final; el emisor no cambia el número', async () => {
    const { invoice } = await encolado()
    const [{ number }] = (await sql<{ number: string }>(`select number from public.invoices where id = $1`, [invoice])) as [
      { number: string },
    ]
    await svc(`select public.invoice_record_provider_result($1, $2::jsonb)`, [
      invoice,
      JSON.stringify({ status: 'issued', number: String(Number(number)), document_ref: 'https://www.nubefact.com/cpe/x', pdf_url: 'https://www.nubefact.com/cpe/x.pdf' }),
    ])
    expect((await sql(`select status::text, pdf_url from public.invoices where id = $1`, [invoice]))[0]).toEqual({
      status: 'issued', pdf_url: 'https://www.nubefact.com/cpe/x.pdf',
    })
    await svc(`select public.invoice_record_provider_result($1, '{"status":"accepted","sunat_code":"0"}'::jsonb)`, [invoice])
    await svc(`select public.invoice_record_provider_result($1, '{"status":"rejected"}'::jsonb)`, [invoice])
    expect((await sql(`select status::text, sunat_code from public.invoices where id = $1`, [invoice]))[0]).toEqual({
      status: 'accepted', sunat_code: '0',
    })
    const otro = await encolado()
    expect(
      await fallo(() => svc(`select public.invoice_record_provider_result($1, '{"status":"issued","number":"99999"}'::jsonb)`, [otro.invoice])),
    ).toMatch(/NUMERO_DISTINTO/)
    expect(
      await fallo(() => as(ownerA, `select public.invoice_record_provider_result($1, '{"status":"accepted"}'::jsonb)`, [otro.invoice])),
    ).toMatch(/permission denied/)
  })

  it('rechazo por datos: mensaje muerto sin reintento, comprobante pendiente con su número', async () => {
    const { invoice, outbox } = await encolado()
    await svc(`update public.integration_outbox set status = 'in_flight', attempts = 1 where id = $1`, [outbox])
    await svc(`select public.invoice_issue_give_up($1, '20: formato', 400)`, [outbox])
    expect((await sql(`select status::text from public.integration_outbox where id = $1`, [outbox]))[0]?.status).toBe('dead')
    const [inv] = await sql(`select status::text, number is not null as numerado from public.invoices where id = $1`, [invoice])
    expect(inv).toEqual({ status: 'pending', numerado: true })
    const [ev] = await sql(`select detail from public.invoice_events where invoice_id = $1 order by created_at desc limit 1`, [invoice])
    expect(String(ev?.detail)).toMatch(/RECHAZADO_POR_EMISOR/)
  })

  it('pendientes de SUNAT: se ofrecen una vez y no otra vez antes de 15 minutos', async () => {
    const { invoice } = await encolado()
    await svc(`select public.invoice_record_provider_result($1, '{"status":"issued"}'::jsonb)`, [invoice])
    await sql(`update public.invoices set provider_checked_at = now() - interval '1 hour' where id = $1`, [invoice])
    const primera = await svc<{ invoice_id: string }>(`select * from public.invoice_awaiting_confirmation('nubefact', 50)`)
    expect(primera.map((r) => r.invoice_id)).toContain(invoice)
    const segunda = await svc<{ invoice_id: string }>(`select * from public.invoice_awaiting_confirmation('nubefact', 50)`)
    expect(segunda.map((r) => r.invoice_id)).not.toContain(invoice)
  })
})
