// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asRole, claimsFor, createTestDatabase, TENANT_A, TENANT_B, type JwtClaims } from './harness'

/**
 * Textos de correo por tienda (2026-11-20).
 *
 *  · solo owner/admin de la sociedad guardan, leen y restauran;
 *  · una variable fuera de la lista del aviso se rechaza en la base;
 *  · otra sociedad no ve ni escribe nada (aislamiento tenant);
 *  · sin INSERT/UPDATE/DELETE directos: todo pasa por las RPC.
 */

let db: PGlite
let storeA = ''
let storeB = ''

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

const ownerA = claimsFor(TENANT_A)
const ownerB = claimsFor(TENANT_B)
const staffA = (sub: string, role: string) =>
  claimsFor(TENANT_A, { sub, email: `${sub}@tenant-a.com`, companies: [{ id: TENANT_A.companyId, role }] })
const CATALOGO = '0e000000-0000-4000-8000-00000000c001'

const guardar = (claims: JwtClaims, store: string, body = 'Hola {{cliente}}, tu pedido {{pedido}} por {{total}} llegó.') =>
  as(claims, `select public.email_template_save($1::uuid, 'order.confirmed', 'es', 'Pedido {{pedido}}', 'Gracias', $2)`, [
    store,
    body,
  ])

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
  storeA = String((await svc(`select id from public.stores where slug = $1`, [TENANT_A.storeSlug]))[0]?.id)
  storeB = String((await svc(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug]))[0]?.id)
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, 'cat@tenant-a.com', 'catalog')`,
    [TENANT_A.organizationId, TENANT_A.companyId, CATALOGO],
  )
})

afterAll(async () => {
  await db?.close()
})

describe('guardar y leer', () => {
  it('el owner guarda y lee su texto; queda en la auditoría', async () => {
    await guardar(ownerA, storeA)
    const filas = await as(ownerA, `select kind, locale, subject, title, body from public.email_templates`)
    expect(filas).toEqual([
      {
        kind: 'order.confirmed',
        locale: 'es',
        subject: 'Pedido {{pedido}}',
        title: 'Gracias',
        body: 'Hola {{cliente}}, tu pedido {{pedido}} por {{total}} llegó.',
      },
    ])
    const audit = await svc(`select action from public.audit_log where action like 'email_template.%'`)
    expect(audit.map((a) => a.action)).toContain('email_template.saved')
  })

  it('guardar otra vez reemplaza, no duplica', async () => {
    await guardar(ownerA, storeA, 'Texto nuevo {{pedido}}')
    const filas = await as(ownerA, `select body from public.email_templates`)
    expect(filas).toEqual([{ body: 'Texto nuevo {{pedido}}' }])
  })

  it('restaurar borra el texto propio', async () => {
    await as(ownerA, `select public.email_template_reset($1::uuid, 'order.confirmed', 'es')`, [storeA])
    expect(await as(ownerA, `select 1 from public.email_templates`)).toEqual([])
    await guardar(ownerA, storeA)
  })
})

describe('validación', () => {
  it('variable fuera de la lista del aviso: rechazada', async () => {
    expect(await fallo(() => guardar(ownerA, storeA, 'Hola {{password}}'))).toMatch(/VARIABLE_DESCONOCIDA/)
    // `motivo` solo existe en el rechazo.
    expect(await fallo(() => guardar(ownerA, storeA, 'Motivo: {{motivo}}'))).toMatch(/VARIABLE_DESCONOCIDA/)
    await as(
      ownerA,
      `select public.email_template_save($1::uuid, 'order.rejected', 'es', 'No', 'No', 'Motivo: {{motivo}}')`,
      [storeA],
    )
  })

  it('aviso no editable, vacío o demasiado largo: rechazado', async () => {
    expect(
      await fallo(() => as(ownerA, `select public.email_template_save($1::uuid, 'auth.recovery', 'es', 'a', 'b', 'c')`, [storeA])),
    ).toMatch(/AVISO_NO_EDITABLE/)
    expect(await fallo(() => guardar(ownerA, storeA, '   '))).toMatch(/email_templates_body/)
    expect(await fallo(() => guardar(ownerA, storeA, 'x'.repeat(2001)))).toMatch(/email_templates_body/)
  })
})

describe('permisos y aislamiento tenant', () => {
  it('un rol sin administración no guarda ni ve', async () => {
    expect(await fallo(() => guardar(staffA(CATALOGO, 'catalog'), storeA))).toMatch(/SIN_PERMISO/)
    expect(await as(staffA(CATALOGO, 'catalog'), `select 1 from public.email_templates`)).toEqual([])
  })

  it('otra sociedad no ve los textos de A ni escribe en su tienda', async () => {
    expect(await as(ownerB, `select 1 from public.email_templates`)).toEqual([])
    expect(await fallo(() => guardar(ownerB, storeA))).toMatch(/TIENDA_NO_DISPONIBLE/)
    expect(
      await fallo(() => as(ownerB, `select public.email_template_reset($1::uuid, 'order.confirmed', 'es')`, [storeA])),
    ).toMatch(/TIENDA_NO_DISPONIBLE/)
    // B en su propia tienda sí, y A no lo ve.
    await guardar(ownerB, storeB)
    expect((await as(ownerA, `select store_id from public.email_templates`)).every((f) => f.store_id === storeA)).toBe(true)
  })

  it('sin escritura directa: ni el owner inserta, cambia o borra la tabla', async () => {
    expect(
      await fallo(() =>
        as(
          ownerA,
          `insert into public.email_templates (store_id, organization_id, company_id, kind, subject, title, body)
           values ($1, $2, $3, 'order.shipped', 'a', 'b', 'c')`,
          [storeA, TENANT_A.organizationId, TENANT_A.companyId],
        ),
      ),
    ).toMatch(/permission denied/)
    expect(await fallo(() => as(ownerA, `update public.email_templates set body = 'x'`))).toMatch(/permission denied/)
    expect(await fallo(() => as(ownerA, `delete from public.email_templates`))).toMatch(/permission denied/)
  })

  it('anon no ejecuta las RPC', async () => {
    const r = await asRole(db, 'anon', ownerA, async () => fallo(() => db.query(`select public.email_template_reset($1::uuid, 'order.confirmed', 'es')`, [storeA])))
    expect(r).toMatch(/permission denied/)
  })
})
