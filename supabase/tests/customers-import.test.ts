// @vitest-environment node
/**
 * Importación de clientes y de usuarios B2B desde Excel sobre Postgres REAL
 * (PGlite). Mismo contrato que la del catálogo: simular no escribe, una fila
 * mala no deja media carga, una celda vacía no borra, cada rechazo dice su
 * motivo y su columna, y ni el rol equivocado ni el tenant de al lado pasan.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>
type Tenant = typeof TENANT_A

interface ImportRow {
  sheet: string
  row: number
  key: string | null
  status: 'created' | 'updated' | 'error'
  reason?: string
  field?: string | null
  value?: string | null
}

interface ImportResult {
  dry_run: boolean
  applied: boolean
  total: number
  created: number
  updated: number
  errors: number
  rows: ImportRow[]
}

let db: PGlite
let cuentaA = ''
let cuentaB = ''

const ORDERS_USER = '0a000000-0000-4000-8000-0000000000f1'
const COMPRADORA = '0a000000-0000-4000-8000-0000000000f2'
const APROBADOR = '0a000000-0000-4000-8000-0000000000f3'

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

const svc = (query: string, params: unknown[] = []) => asRole(db, 'service_role', null, () => sql(query, params))

const ordersClaims = () =>
  claimsFor(TENANT_A, {
    sub: ORDERS_USER,
    email: 'pedidos@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'orders' }],
  })

async function customers(rows: unknown[], dryRun: boolean, tenant: Tenant = TENANT_A): Promise<ImportResult> {
  const result = await asRole(db, 'authenticated', claimsFor(tenant), () =>
    sql('select public.import_customers($1::jsonb, $2) as r', [JSON.stringify(rows), dryRun]),
  )
  return result[0]?.r as ImportResult
}

async function users(
  accountId: string | null,
  rows: unknown[],
  dryRun: boolean,
  tenant: Tenant = TENANT_A,
): Promise<ImportResult> {
  const result = await asRole(db, 'authenticated', claimsFor(tenant), () =>
    sql('select public.import_business_account_users($1, $2::jsonb, $3) as r', [
      accountId,
      JSON.stringify(rows),
      dryRun,
    ]),
  )
  return result[0]?.r as ImportResult
}

const errorsOf = (result: ImportResult) =>
  result.rows.filter((row) => row.status === 'error').map((row) => [row.row, row.reason, row.field ?? null])

async function customerByCode(code: string): Promise<Row | undefined> {
  const rows = await svc(
    `select c.*, s.code as segment_code,
            (select e.external_id from public.customer_external_ids e
              where e.customer_id = c.id and e.system_code = 'erp') as erp_code
       from public.customers c
       left join public.customer_segments s on s.id = c.segment_id
      where c.company_id = $1 and lower(c.code) = lower($2)`,
    [TENANT_A.companyId, code],
  )
  return rows[0]
}

beforeAll(async () => {
  db = await createTestDatabase()
  // auth.users no es de service_role: se escribe como el dueño de la base.
  await sql(`insert into auth.users (id, email) values ($1, 'compradora@cliente.com'), ($2, 'aprueba@cliente.com')`, [
    COMPRADORA,
    APROBADOR,
  ])
  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await sql(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId,
        tenant.companyId,
        tenant.slug,
        `Cuenta ${tenant.slug}`,
        tenant.adminEmail,
        tenant.ownerId,
        tenant.storeSlug,
        `Tienda ${tenant.slug}`,
      ])
    }
    await sql(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, 'pedidos@tenant-a.com', 'orders')`,
      [TENANT_A.organizationId, TENANT_A.companyId, ORDERS_USER],
    )
    await sql(
      `insert into public.customer_segments (organization_id, company_id, code, name)
       values ($1, $2, 'mayorista', 'Mayorista')`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )

    for (const [tenant, code] of [
      [TENANT_A, 'ACC-A'],
      [TENANT_B, 'ACC-B'],
    ] as const) {
      const [cliente] = await sql(
        `insert into public.customers (organization_id, company_id, kind, code, name)
         values ($1, $2, 'company', $3, 'Cliente B2B') returning id`,
        [tenant.organizationId, tenant.companyId, `CLI-${code}`],
      )
      const [cuenta] = await sql(
        `insert into public.business_accounts
           (organization_id, company_id, customer_id, customer_kind, code, name)
         values ($1, $2, $3, 'company', $4, 'Cuenta') returning id`,
        [tenant.organizationId, tenant.companyId, cliente?.id, code],
      )
      if (tenant === TENANT_A) cuentaA = String(cuenta?.id)
      else cuentaB = String(cuenta?.id)
    }
    await sql(
      `insert into public.business_locations
         (organization_id, company_id, business_account_id, customer_id, code, name)
       select organization_id, company_id, id, customer_id, 'SUR', 'Sede Sur'
         from public.business_accounts where id = $1`,
      [cuentaA],
    )
  })

  for (const [tenant, entitlements] of [
    [TENANT_A, ['ecommerce.customers.b2b']],
    [TENANT_B, []],
  ] as const) {
    await svc(
      `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
      [tenant.organizationId, tenant.companyId, entitlements],
    )
  }
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------
describe('import_customers', () => {
  it('simular no escribe; aplicar crea con segmento por nombre y el código del ERP', async () => {
    const rows = [
      {
        row: 2,
        code: 'CLI-100',
        kind: 'Empresa',
        name: 'Botica Central',
        legal_name: 'Botica Central S.A.C.',
        tax_id: '20123456789',
        email: 'Compras@Botica.pe',
        segment: 'Mayorista',
        erp_code: 'C000100',
      },
      { row: 3, code: 'CLI-101', kind: 'persona', name: 'Ana Ruiz', is_active: 'no' },
    ]

    const preview = await customers(rows, true)
    expect(preview).toMatchObject({ dry_run: true, applied: false, total: 2, created: 2, errors: 0 })
    expect(await customerByCode('CLI-100')).toBeUndefined()

    const applied = await customers(rows, false)
    expect(applied).toMatchObject({ applied: true, created: 2, updated: 0, errors: 0 })

    expect(await customerByCode('CLI-100')).toMatchObject({
      kind: 'company',
      legal_name: 'Botica Central S.A.C.',
      email: 'compras@botica.pe',
      segment_code: 'mayorista',
      erp_code: 'C000100',
      is_active: true,
    })
    expect(await customerByCode('CLI-101')).toMatchObject({ kind: 'person', is_active: false })
  })

  it('una hoja con solo código y teléfono actualiza y no borra lo demás', async () => {
    const result = await customers([{ row: 2, code: 'cli-100', phone: '987654321' }], false)
    expect(result).toMatchObject({ applied: true, created: 0, updated: 1 })
    expect(await customerByCode('CLI-100')).toMatchObject({
      name: 'Botica Central',
      phone: '987654321',
      segment_code: 'mayorista',
      erp_code: 'C000100',
    })
  })

  it('cada rechazo dice su motivo y su columna, y la carga no se aplica', async () => {
    const result = await customers(
      [
        { row: 2, code: 'CLI-200', kind: 'empresa', name: 'Buena' },
        { row: 3, code: 'CLI-201', kind: 'cooperativa', name: 'Mala' },
        { row: 4, code: 'CLI-202', kind: 'empresa', name: 'X', segment: 'vip' },
        { row: 5, code: 'CLI-200', kind: 'empresa', name: 'Repetida' },
        { row: 6, code: 'CLI 203', kind: 'empresa', name: 'Espacio' },
        { row: 7, code: 'CLI-204', name: 'Sin tipo' },
        { row: 8, code: 'CLI-205', kind: 'empresa', name: 'Correo', email: 'sin-arroba' },
        { row: 9, code: 'CLI-206', kind: 'empresa', name: 'ERP ajeno', erp_code: 'c000100' },
      ],
      false,
    )
    expect(result.applied).toBe(false)
    expect(errorsOf(result)).toEqual([
      [3, 'VALOR_INVALIDO', 'kind'],
      [4, 'SEGMENTO_NO_ENCONTRADO', 'segment'],
      [5, 'CODIGO_REPETIDO', 'code'],
      [6, 'CODIGO_CLIENTE_INVALIDO', 'code'],
      [7, 'CAMPO_REQUERIDO', 'kind'],
      [8, 'CORREO_INVALIDO', 'email'],
      [9, 'CODIGO_ERP_EN_USO', 'erp_code'],
    ])
    expect(result.rows.find((row) => row.row === 4)?.value).toBe('vip')
    expect(await customerByCode('CLI-200')).toBeUndefined()
  })

  it('el rol orders importa clientes, pero no el código del ERP', async () => {
    const result = await asRole(db, 'authenticated', ordersClaims(), () =>
      sql('select public.import_customers($1::jsonb, false) as r', [
        JSON.stringify([
          { row: 2, code: 'CLI-300', kind: 'empresa', name: 'Por pedidos' },
          { row: 3, code: 'CLI-301', kind: 'empresa', name: 'Con ERP', erp_code: 'C300' },
        ]),
      ]),
    )
    expect(errorsOf(result[0]?.r as ImportResult)).toEqual([[3, 'SIN_PERMISO_ERP', 'erp_code']])
  })

  it('el tenant de al lado no ve ni pisa los clientes de A', async () => {
    const result = await customers([{ row: 2, code: 'CLI-100', kind: 'empresa', name: 'Intrusa' }], false, TENANT_B)
    // En B el código está libre: se CREA allí, y la ficha de A queda intacta.
    expect(result).toMatchObject({ applied: true, created: 1, updated: 0 })
    expect(await customerByCode('CLI-100')).toMatchObject({ name: 'Botica Central' })
  })

  it('la hoja no decide el tenant ni columnas que no son suyas', async () => {
    expect(
      await expectFailure(() =>
        customers([{ row: 2, code: 'X', organization_id: TENANT_B.organizationId }], true),
      ),
    ).toMatch(/CAMPO_NO_PERMITIDO/)
  })
})

// ---------------------------------------------------------------------------
describe('import_business_account_users', () => {
  beforeEach(async () => {
    await svc(`delete from public.business_account_users`)
  })

  async function members(accountId: string): Promise<Row[]> {
    return svc(
      `select u.email, u.role::text as role, u.status::text as status, u.spending_limit::text as spending_limit,
              l.code as location
         from public.business_account_users u
         left join public.business_locations l on l.id = u.default_location_id
        where u.business_account_id = $1 order by u.email`,
      [accountId],
    )
  }

  it('desde la cuenta: crea ACTIVOS por defecto, con rol, límite y sucursal', async () => {
    const rows = [
      { row: 2, email: 'Compradora@Cliente.com', role: 'Comprador', spending_limit: '1500,50', location_code: 'Sede Sur' },
      { row: 3, email: 'aprueba@cliente.com', role: 'aprobador', status: 'invitado' },
    ]
    expect(await users(cuentaA, rows, true)).toMatchObject({ created: 2, errors: 0, applied: false })
    expect(await members(cuentaA)).toEqual([])

    expect(await users(cuentaA, rows, false)).toMatchObject({ applied: true, created: 2 })
    expect(await members(cuentaA)).toEqual([
      { email: 'aprueba@cliente.com', role: 'approver', status: 'invited', spending_limit: null, location: null },
      { email: 'compradora@cliente.com', role: 'buyer', status: 'active', spending_limit: '1500.50', location: 'SUR' },
    ])

    // Segunda carga: solo el estado. Lo demás se conserva.
    expect(await users(cuentaA, [{ row: 2, email: 'compradora@cliente.com', status: 'revocado' }], false)).toMatchObject({
      updated: 1,
    })
    expect((await members(cuentaA))[1]).toMatchObject({ status: 'revoked', spending_limit: '1500.50', location: 'SUR' })
  })

  it('desde la pestaña: cada fila dice su cuenta; los rechazos nombran la columna', async () => {
    const result = await users(
      null,
      [
        { row: 2, account_code: 'acc-a', email: 'compradora@cliente.com' },
        { row: 3, email: 'aprueba@cliente.com' },
        { row: 4, account_code: 'ACC-B', email: 'aprueba@cliente.com' },
        { row: 5, account_code: 'ACC-A', email: 'nadie@cliente.com' },
        { row: 6, account_code: 'ACC-A', email: 'alguien@ebim.pe' },
        { row: 7, account_code: 'ACC-A', email: 'compradora@cliente.com' },
        { row: 8, account_code: 'ACC-A', email: 'aprueba@cliente.com', role: 'jefe' },
        { row: 9, account_code: 'ACC-A', email: 'otra@cliente.com', location_code: 'NORTE' },
      ],
      false,
    )
    expect(result.applied).toBe(false)
    expect(errorsOf(result)).toEqual([
      [3, 'CAMPO_REQUERIDO', 'account_code'],
      // La cuenta de otro tenant no existe para A.
      [4, 'CUENTA_NO_ENCONTRADA', 'account_code'],
      [5, 'SIN_CUENTA', 'email'],
      [6, 'CORREO_DE_SUITE', 'email'],
      [7, 'CORREO_REPETIDO', 'email'],
      [8, 'VALOR_INVALIDO', 'role'],
      [9, 'SUCURSAL_NO_ENCONTRADA', 'location_code'],
    ])
    expect(await members(cuentaA)).toEqual([])
  })

  it('una fila de otra cuenta no entra por la puerta de esta', async () => {
    const result = await users(cuentaA, [{ row: 2, account_code: 'OTRA', email: 'compradora@cliente.com' }], true)
    expect(errorsOf(result)).toEqual([[2, 'OTRA_CUENTA', 'account_code']])
  })

  it('ni la cuenta de otro tenant, ni el rol orders, ni una sociedad sin B2B', async () => {
    expect(await expectFailure(() => users(cuentaB, [], true))).toMatch(/CUENTA_NO_ENCONTRADA/)
    expect(
      await expectFailure(() =>
        asRole(db, 'authenticated', ordersClaims(), () =>
          sql('select public.import_business_account_users(null, $1::jsonb, true)', ['[]']),
        ),
      ),
    ).toMatch(/SIN_PERMISO/)
    expect(await expectFailure(() => users(null, [], true, TENANT_B))).toMatch(/MODULO_NO_CONTRATADO/)
  })
})
