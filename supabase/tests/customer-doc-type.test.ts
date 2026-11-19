// @vitest-environment node
/**
 * Tipo de documento del cliente sobre Postgres real (2026-11-18).
 *
 * El formulario manda el tipo; quien no lo manda (importación, integración)
 * lo recibe deducido del número. Se guarda como el dueño de la tienda —no como
 * superusuario— para que un permiso que falte en el disparador se note aquí.
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TENANT_A, asRole, claimsFor, createTestDatabase, expectFailure } from './harness'

let db: PGlite
let seq = 0

async function comoDueno<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'authenticated', claimsFor(TENANT_A), async () => (await db.query<T>(query, params)).rows)
}

async function nuevo(taxId: string | null, type: string | null = null) {
  seq += 1
  const rows = await comoDueno<{ id: string; tax_id_type: string | null }>(
    `insert into public.customers (organization_id, company_id, kind, code, name, tax_id, tax_id_type)
     values ($1, $2, 'person', $3, $4, $5, $6) returning id, tax_id_type`,
    [TENANT_A.organizationId, TENANT_A.companyId, `DOC-${seq}`, `Cliente ${seq}`, taxId, type],
  )
  return rows[0]!
}

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, () =>
    db.query(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
      TENANT_A.organizationId,
      TENANT_A.companyId,
      TENANT_A.slug,
      `Cuenta ${TENANT_A.slug}`,
      TENANT_A.adminEmail,
      TENANT_A.ownerId,
      TENANT_A.storeSlug,
      `Tienda ${TENANT_A.slug}`,
    ]),
  )
})

afterAll(async () => {
  await db.close()
})

describe('tipo de documento del cliente', () => {
  it('se respeta el que manda el formulario', async () => {
    expect((await nuevo('X1234567', 'passport')).tax_id_type).toBe('passport')
  })

  it('sin tipo, se deduce del número', async () => {
    expect((await nuevo('20100047218')).tax_id_type).toBe('ruc')
    expect((await nuevo('45678912')).tax_id_type).toBe('dni')
    expect((await nuevo('CE00012345')).tax_id_type).toBe('ce')
    expect((await nuevo(null, 'dni')).tax_id_type).toBeNull()
  })

  it('si cambia el número y el tipo ya no encaja, se vuelve a deducir; si encaja, se queda', async () => {
    const cliente = await nuevo('45678912', 'dni')
    const [cambio] = await comoDueno<{ tax_id_type: string }>(
      `update public.customers set tax_id = '20100047218' where id = $1 returning tax_id_type`,
      [cliente.id],
    )
    expect(cambio!.tax_id_type).toBe('ruc')

    const pasaporte = await nuevo('AB123456', 'passport')
    const [sigue] = await comoDueno<{ tax_id_type: string }>(
      `update public.customers set tax_id = 'AB654321' where id = $1 returning tax_id_type`,
      [pasaporte.id],
    )
    expect(sigue!.tax_id_type).toBe('passport')
  })

  it('un tipo fuera de la lista no entra', async () => {
    const message = await expectFailure(() => nuevo('123', 'licencia'))
    expect(message).toMatch(/customers_tax_id_type_check|check/i)
  })
})
