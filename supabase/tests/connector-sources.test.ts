// @vitest-environment node
/**
 * Fuentes de lectura (20261112120000) contra Postgres real.
 *
 * Lo que no puede fallar:
 *
 *  - un tenant no ve ni toca las fuentes, flujos, ejecuciones ni rechazados
 *    del otro; escribir exige owner/admin Y el módulo;
 *  - la URL es https y pública (defensa contra SSRF en la base);
 *  - la credencial va a Vault, el navegador no la puede leer y el estado del
 *    trabajador (`has_secret`, marca de agua, concesión) no se escribe a mano;
 *  - el stock solo entra en almacenes cuyo sistema de registro es el ERP, por
 *    `sync_inventory_level` (saldo absoluto, asiento `count`);
 *  - los precios van a la lista del flujo; nada se borra porque «no vino»;
 *  - lo que no entra se cuenta y se explica, y no tumba al resto;
 *  - la marca de agua solo avanza si la ejecución no falló.
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

type Row = Record<string, unknown>

let db: PGlite
const ENTITLEMENT = 'ecommerce.integrations.enterprise'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000e1'
let storeA = ''
let whErp = ''
let whLocal = ''
let jabon = ''
let camiseta = ''
let camisetaRoja = ''
let listA = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function asUser<T = Row>(
  tenant: typeof TENANT_A,
  query: string,
  params: unknown[] = [],
  overrides: Parameters<typeof claimsFor>[1] = {},
): Promise<T[]> {
  return asRole(db, 'authenticated', claimsFor(tenant, overrides), async () => {
    return (await db.query<T>(query, params)).rows
  })
}

/** Vault simulado: solo lo toca el superusuario, como en Supabase. */
async function su<T = Row>(query: string): Promise<T[]> {
  return (await db.query<T>(query)).rows
}

const asViewer = <T = Row>(query: string, params: unknown[] = []) =>
  asUser<T>(TENANT_A, query, params, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })

async function sync(tenant: typeof TENANT_A, entitlements: string[]): Promise<void> {
  await svc(
    `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
    [tenant.organizationId, tenant.companyId, entitlements],
  )
}

/** Alta por la MISMA puerta que el backoffice: sin tenant en el cuerpo. */
async function createSource(
  tenant: typeof TENANT_A = TENANT_A,
  url = 'https://erp.cliente.test/api',
): Promise<string> {
  const [row] = await asUser<{ id: string }>(
    tenant,
    `insert into public.connector_sources (name, base_url, auth_type, auth_header)
     values ('ERP central', $1, 'api_key', 'X-API-Key') returning id`,
    [url],
  )
  return String(row?.id)
}

async function createFeed(
  sourceId: string,
  resource: 'stock' | 'prices',
  extra: { list?: string | null; warehouse?: string | null } = {},
): Promise<string> {
  const [row] = await asUser<{ id: string }>(
    TENANT_A,
    `insert into public.connector_feeds (source_id, resource, path, interval_minutes, price_list_id, default_warehouse_id)
     values ($1, $2, $3, 60, $4, $5) returning id`,
    [sourceId, resource, `/ebim/v1/${resource}`, extra.list ?? null, extra.warehouse ?? null],
  )
  return String(row?.id)
}

async function claimRun(): Promise<string> {
  const [row] = await svc<{ claim: Array<{ run_id: string }> }>(
    `select public.connector_claim(5) as claim`,
  )
  const runId = row?.claim[0]?.run_id
  if (!runId) throw new Error('no se reclamó ningún flujo')
  return runId
}

beforeAll(async () => {
  db = await createTestDatabase()

  // Vault no existe en PGlite. Se simula con la misma forma que en Supabase:
  // las funciones definer lo resuelven al ejecutarse, no al crearse.
  await db.exec(`
    create schema vault;
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

  await asRole(db, 'service_role', null, async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await db.query(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
        tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
      ])
    }
    await db.query(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
      [TENANT_A.organizationId, TENANT_A.companyId, VIEWER_USER],
    )
  })
  await svc(`update public.stores set status = 'active'`)
  const [store] = await svc<{ id: string }>(`select id from public.stores where slug = $1`, [
    TENANT_A.storeSlug,
  ])
  storeA = String(store?.id)

  const product = async (sku: string, kind: string) => {
    const [r] = await svc<{ id: string }>(
      `insert into public.products
         (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at, kind)
       values ($1, $2, $3, $4, lower($4), $4, '10.00', 'PEN', 0, 'published', now(), $5::public.product_kind)
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, sku, kind],
    )
    return String(r?.id)
  }
  jabon = await product('A-JABON', 'simple')
  camiseta = await product('A-CAMISETA', 'variant')
  const [variant] = await svc<{ id: string }>(
    `insert into public.product_variants
       (organization_id, company_id, store_id, product_id, sku, name, price, stock, is_active, is_default)
     values ($1, $2, $3, $4, 'A-CAM-ROJA', 'Roja', null, 0, true, true) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA, camiseta],
  )
  camisetaRoja = String(variant?.id)

  const warehouse = async (code: string, source: 'erp' | 'local') => {
    const [r] = await svc<{ id: string }>(
      `insert into public.warehouses (organization_id, company_id, code, name, source)
       values ($1, $2, $3, $3, $4::public.inventory_source) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, code, source],
    )
    return String(r?.id)
  }
  whErp = await warehouse('CD-ERP', 'erp')
  whLocal = await warehouse('TIENDA', 'local')

  const [list] = await svc<{ id: string }>(
    `insert into public.price_lists (organization_id, company_id, store_id, code, name, currency)
     values ($1, $2, $3, 'erp', 'Lista ERP', 'PEN') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  listA = String(list?.id)
}, 180_000)

beforeEach(async () => {
  await svc(`delete from public.connector_sources`)
  await su(`delete from vault.secrets`)
  await svc(`delete from public.price_list_items where price_list_id = $1`, [listA])
  await sync(TENANT_A, [ENTITLEMENT])
  await sync(TENANT_B, [ENTITLEMENT])
})

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('la fuente', () => {
  it('el tenant sale del JWT aunque la pantalla no lo mande', async () => {
    const id = await createSource()
    const [row] = await svc<{ organization_id: string; company_id: string }>(
      `select organization_id, company_id from public.connector_sources where id = $1`,
      [id],
    )
    expect(row).toEqual({ organization_id: TENANT_A.organizationId, company_id: TENANT_A.companyId })
  })

  it('un tenant no ve las fuentes, flujos ni ejecuciones del otro', async () => {
    const source = await createSource()
    await createFeed(source, 'stock', { warehouse: whErp })
    await claimRun()

    for (const table of ['connector_sources', 'connector_feeds', 'connector_runs']) {
      const rows = await asUser(TENANT_B, `select id from public.${table}`)
      expect(`${table}: ${rows.length}`).toBe(`${table}: 0`)
    }
  })

  it('el otro tenant tampoco puede escribir con el tenant de A', async () => {
    const message = await expectFailure(() =>
      asUser(
        TENANT_B,
        `insert into public.connector_sources (organization_id, company_id, name, base_url)
         values ($1, $2, 'colado', 'https://erp.cliente.test')`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ),
    )
    expect(message).toMatch(/row-level security/i)
  })

  it('solo https y nunca una dirección privada', async () => {
    const malas = [
      'http://erp.cliente.test/api',
      'https://localhost/api',
      'https://127.0.0.1/api',
      'https://10.1.2.3/api',
      'https://192.168.0.10/api',
      'https://169.254.169.254/latest',
      'https://172.20.0.1/api',
      'https://erp.internal/api',
    ]
    for (const url of malas) {
      const message = await expectFailure(() => createSource(TENANT_A, url))
      expect(`${url}: ${message}`).toMatch(/connector_sources_url_(https|public)/)
    }
  })

  it('cada autenticación con lo que necesita', async () => {
    const message = await expectFailure(() =>
      asUser(
        TENANT_A,
        `insert into public.connector_sources (name, base_url, auth_type)
         values ('sin usuario', 'https://erp.cliente.test', 'oauth2')`,
      ),
    )
    expect(message).toMatch(/connector_sources_auth_shape/)
  })

  it('un viewer no da de alta fuentes, y sin el módulo nadie', async () => {
    const viewer = await expectFailure(() =>
      asViewer(`insert into public.connector_sources (name, base_url) values ('x', 'https://erp.cliente.test')`),
    )
    expect(viewer).toMatch(/row-level security/i)

    await sync(TENANT_A, [])
    const sinModulo = await expectFailure(() => createSource())
    expect(sinModulo).toMatch(/row-level security/i)
  })

  it('anon no ve ninguna de las cuatro tablas', async () => {
    for (const table of ['connector_sources', 'connector_feeds', 'connector_runs', 'connector_rejects']) {
      const message = await expectFailure(() =>
        asRole(db, 'anon', null, async () => db.query(`select * from public.${table}`)),
      )
      expect(`${table}: ${message}`).toMatch(/permission denied/i)
    }
  })
})

describe('la credencial', () => {
  it('va a Vault, y el navegador no la puede leer', async () => {
    const source = await createSource()
    await asUser(TENANT_A, `select public.connector_source_set_secret($1, 'clave-super-secreta')`, [source])

    const [row] = await svc<{ has_secret: boolean }>(
      `select has_secret from public.connector_sources where id = $1`,
      [source],
    )
    expect(row?.has_secret).toBe(true)

    const columnas = await svc<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'connector_sources'`,
    )
    const nombres = columnas.map((c) => c.column_name)
    for (const prohibida of ['secret', 'password', 'token', 'api_key', 'client_secret']) {
      expect(nombres).not.toContain(prohibida)
    }

    const [plain] = await svc<{ s: string }>(`select public.connector_secret($1) as s`, [source])
    expect(plain?.s).toBe('clave-super-secreta')

    const leer = await expectFailure(() =>
      asUser(TENANT_A, `select public.connector_secret($1)`, [source]),
    )
    expect(leer).toMatch(/permission denied/i)

    const puntero = await expectFailure(() =>
      asUser(TENANT_A, `select * from ebim.connector_secrets`),
    )
    expect(puntero).toMatch(/permission denied/i)
  })

  it('cambiarla no crea otra, vaciarla la borra y borrar la fuente no deja huérfanos', async () => {
    const source = await createSource()
    await asUser(TENANT_A, `select public.connector_source_set_secret($1, 'uno')`, [source])
    await asUser(TENANT_A, `select public.connector_source_set_secret($1, 'dos')`, [source])
    expect(await su(`select secret from vault.secrets`)).toEqual([{ secret: 'dos' }])

    await asUser(TENANT_A, `select public.connector_source_set_secret($1, '')`, [source])
    expect(await su(`select 1 from vault.secrets`)).toHaveLength(0)

    await asUser(TENANT_A, `select public.connector_source_set_secret($1, 'tres')`, [source])
    await asUser(TENANT_A, `delete from public.connector_sources where id = $1`, [source])
    expect(await su(`select 1 from vault.secrets`)).toHaveLength(0)
  })

  it('un viewer no la cambia, ni nadie marca has_secret a mano', async () => {
    const source = await createSource()
    const viewer = await expectFailure(() =>
      asViewer(`select public.connector_source_set_secret($1, 'x')`, [source]),
    )
    expect(viewer).toMatch(/SIN_PERMISO/)

    const columna = await expectFailure(() =>
      asUser(TENANT_A, `update public.connector_sources set has_secret = true where id = $1`, [source]),
    )
    expect(columna).toMatch(/permission denied/i)
  })
})

describe('el flujo', () => {
  it('precios exige lista; el almacén por defecto tiene que ser del ERP', async () => {
    const source = await createSource()
    const sinLista = await expectFailure(() => createFeed(source, 'prices'))
    expect(sinLista).toMatch(/connector_feeds_target/)

    const local = await expectFailure(() => createFeed(source, 'stock', { warehouse: whLocal }))
    expect(local).toMatch(/ALMACEN_NO_ERP/)
  })

  it('la marca de agua y la concesión no se escriben desde el navegador', async () => {
    const feed = await createFeed(await createSource(), 'stock', { warehouse: whErp })
    const message = await expectFailure(() =>
      asUser(TENANT_A, `update public.connector_feeds set watermark = now() where id = $1`, [feed]),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('«sincronizar ahora» con rol; desde cero borra la marca de agua', async () => {
    const feed = await createFeed(await createSource(), 'stock', { warehouse: whErp })
    await svc(
      `update public.connector_feeds set watermark = now(), next_run_at = now() + interval '1 hour' where id = $1`,
      [feed],
    )
    const viewer = await expectFailure(() => asViewer(`select public.connector_feed_run_now($1, true)`, [feed]))
    expect(viewer).toMatch(/SIN_PERMISO/)

    await asUser(TENANT_A, `select public.connector_feed_run_now($1, true)`, [feed])
    const [row] = await svc<{ watermark: string | null; due: boolean; run_requested: boolean }>(
      `select watermark, next_run_at <= now() as due, run_requested from public.connector_feeds where id = $1`,
      [feed],
    )
    expect(row).toEqual({ watermark: null, due: true, run_requested: true })
  })
})

describe('el trabajador', () => {
  it('reclama una vez: la concesión impide que dos trabajadores lo lleven a la vez', async () => {
    await createFeed(await createSource(), 'stock', { warehouse: whErp })
    const [first] = await svc<{ claim: Array<Row> }>(`select public.connector_claim(5) as claim`)
    expect(first?.claim).toHaveLength(1)
    expect(first?.claim[0]).toMatchObject({
      feed: { resource: 'stock', path: '/ebim/v1/stock' },
      source: { auth_type: 'api_key', auth_header: 'X-API-Key', has_secret: false },
    })
    expect(JSON.stringify(first?.claim)).not.toMatch(/secret"\s*:\s*"/)

    const [second] = await svc<{ claim: Array<Row> }>(`select public.connector_claim(5) as claim`)
    expect(second?.claim).toHaveLength(0)
  })

  it('sin el módulo, el flujo no se reclama', async () => {
    await createFeed(await createSource(), 'stock', { warehouse: whErp })
    await sync(TENANT_A, [])
    const [row] = await svc<{ claim: Array<Row> }>(`select public.connector_claim(5) as claim`)
    expect(row?.claim).toHaveLength(0)
  })

  it('reclamar, aplicar y cerrar es cosa del servidor', async () => {
    for (const call of [
      `select public.connector_claim(5)`,
      `select public.connector_apply_stock(gen_random_uuid(), '[]'::jsonb, 0)`,
      `select public.connector_finish(gen_random_uuid(), 'succeeded')`,
    ]) {
      const message = await expectFailure(() => asUser(TENANT_A, call))
      expect(`${call}: ${message}`).toMatch(/permission denied/i)
    }
  })
})

describe('stock', () => {
  it('saldo absoluto por SKU y código de almacén; lo inválido se explica y no frena al resto', async () => {
    await createFeed(await createSource(), 'stock', { warehouse: whErp })
    const run = await claimRun()

    const rows = [
      { sku: 'A-JABON', warehouse: 'cd-erp', on_hand: '12', updated_at: '2026-11-12T10:00:00Z' },
      { sku: 'A-CAM-ROJA', on_hand: 5, updated_at: '2026-11-12T11:00:00Z' },
      { sku: 'A-JABON', warehouse: 'TIENDA', on_hand: 3 },
      { sku: 'NO-EXISTE', on_hand: 1 },
      { sku: 'A-CAMISETA', on_hand: 1 },
      { sku: 'A-JABON', on_hand: -2 },
      { on_hand: 4 },
    ]
    const [res] = await svc<{ r: Row }>(
      `select public.connector_apply_stock($1, $2::jsonb, 0) as r`,
      [run, JSON.stringify(rows)],
    )
    expect(res?.r).toMatchObject({ received: 7, applied: 2, rejected: 5 })
    expect(new Date(String(res?.r.max_updated_at)).toISOString()).toBe('2026-11-12T11:00:00.000Z')

    const levels = await svc<{ product_id: string; variant_id: string | null; on_hand_qty: string }>(
      `select product_id, variant_id, on_hand_qty::text from public.inventory_levels
        where warehouse_id = $1 order by inventory_levels.on_hand_qty`,
      [whErp],
    )
    expect(levels).toEqual([
      { product_id: camiseta, variant_id: camisetaRoja, on_hand_qty: '5.000000' },
      { product_id: jabon, variant_id: null, on_hand_qty: '12.000000' },
    ])
    const [mov] = await svc<{ kind: string; source: string }>(
      `select kind::text, source::text from public.inventory_movements where warehouse_id = $1 limit 1`,
      [whErp],
    )
    expect(mov).toEqual({ kind: 'count', source: 'erp' })

    const rejects = await svc<{ row_index: number; reason: string }>(
      `select row_index, reason from public.connector_rejects where run_id = $1 order by row_index`,
      [run],
    )
    expect(rejects).toEqual([
      { row_index: 3, reason: 'ALMACEN_NO_ERP' },
      { row_index: 4, reason: 'SKU_NO_ENCONTRADO' },
      { row_index: 5, reason: 'VARIANTE_REQUERIDA' },
      { row_index: 6, reason: 'CANTIDAD_INVALIDA' },
      { row_index: 7, reason: 'SKU_REQUERIDO' },
    ])

    // La misma página otra vez: no mueve nada.
    const [again] = await svc<{ r: Row }>(
      `select public.connector_apply_stock($1, $2::jsonb, 7) as r`,
      [run, JSON.stringify(rows.slice(0, 2))],
    )
    expect(again?.r).toMatchObject({ applied: 0, unchanged: 2 })
  })

  it('el miembro ve la ejecución y sus rechazados; el otro tenant no', async () => {
    await createFeed(await createSource(), 'stock', { warehouse: whErp })
    const run = await claimRun()
    await svc(`select public.connector_apply_stock($1, '[{"sku":"X"}]'::jsonb, 0)`, [run])

    expect(await asViewer(`select reason from public.connector_rejects`)).toHaveLength(1)
    expect(await asUser(TENANT_B, `select reason from public.connector_rejects`)).toHaveLength(0)
  })
})

describe('precios', () => {
  it('alta, sin cambios, cambio y baja explícita; moneda distinta se rechaza', async () => {
    await createFeed(await createSource(), 'prices', { list: listA })
    const apply = async (rows: unknown[]) => {
      const run = await claimRun()
      const [res] = await svc<{ r: Row }>(
        `select public.connector_apply_prices($1, $2::jsonb, 0) as r`,
        [run, JSON.stringify(rows)],
      )
      await svc(`select public.connector_finish($1, 'succeeded')`, [run])
      await svc(`update public.connector_feeds set next_run_at = now()`)
      return res?.r
    }

    expect(
      await apply([
        { sku: 'A-JABON', price: '9.90', compare_at_price: '12.00' },
        { sku: 'A-JABON', price: 8.5, min_quantity: 10 },
        { sku: 'A-CAM-ROJA', price: '55', currency: 'PEN' },
        { sku: 'A-JABON', price: '9', currency: 'USD' },
        { sku: 'A-JABON', price: '20', compare_at_price: '10', min_quantity: 5 },
      ]),
    ).toMatchObject({ applied: 3, rejected: 2 })

    expect(await apply([{ sku: 'A-JABON', price: '9.90', compare_at_price: '12' }])).toMatchObject({
      applied: 0,
      unchanged: 1,
    })
    expect(await apply([{ sku: 'A-JABON', price: '9.50' }])).toMatchObject({ applied: 1 })

    // Un SKU que «no vino» sigue ahí; solo `active: false` lo quita.
    expect(await apply([{ sku: 'A-JABON', min_quantity: 10, active: false }])).toMatchObject({ applied: 1 })

    const items = await svc<{ product_id: string; variant_id: string | null; min_quantity: string; unit_price: string }>(
      `select product_id, variant_id, min_quantity::text, unit_price::text
         from public.price_list_items where price_list_id = $1 order by price_list_items.unit_price`,
      [listA],
    )
    expect(items).toEqual([
      { product_id: jabon, variant_id: null, min_quantity: '1.000000', unit_price: '9.50' },
      { product_id: camiseta, variant_id: camisetaRoja, min_quantity: '1.000000', unit_price: '55.00' },
    ])
  })
})

describe('cerrar la ejecución', () => {
  it('con rechazados queda parcial y la marca de agua avanza; fallida no la mueve y espera menos', async () => {
    const feed = await createFeed(await createSource(), 'stock', { warehouse: whErp })

    const run = await claimRun()
    await svc(`select public.connector_apply_stock($1, '[{"sku":"X","on_hand":1}]'::jsonb, 0)`, [run])
    await svc(`select public.connector_finish($1, 'succeeded', '2026-11-12T10:00:00Z')`, [run])

    const [ok] = await svc<{ status: string; watermark: string; minutes: number; failures: number }>(
      `select f.last_status as status, to_char(f.watermark at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as watermark,
              round(extract(epoch from f.next_run_at - now()) / 60)::int as minutes,
              f.consecutive_failures as failures
         from public.connector_feeds f where f.id = $1`,
      [feed],
    )
    expect(ok).toMatchObject({ status: 'partial', minutes: 60, failures: 0 })
    expect(ok?.watermark).toBe('2026-11-12 10:00')

    await svc(`update public.connector_feeds set next_run_at = now()`)
    const failed = await claimRun()
    await svc(
      `select public.connector_finish($1, 'failed', '2026-12-01T00:00:00Z', 'FUENTE_HTTP_500', 'caido')`,
      [failed],
    )
    const [ko] = await svc<{ status: string; watermark: string; minutes: number; failures: number; code: string }>(
      `select f.last_status as status, to_char(f.watermark at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as watermark,
              round(extract(epoch from f.next_run_at - now()) / 60)::int as minutes,
              f.consecutive_failures as failures, f.last_error_code as code
         from public.connector_feeds f where f.id = $1`,
      [feed],
    )
    expect(ko).toMatchObject({ status: 'failed', minutes: 5, failures: 1, code: 'FUENTE_HTTP_500' })
    expect(ko?.watermark).toBe('2026-11-12 10:00')
  })
})

describe('webhooks', () => {
  it('«Nuevo destino» sin tenant en el cuerpo ya no falla', async () => {
    await svc(`delete from public.webhook_endpoints`)
    const [row] = await asUser<{ organization_id: string }>(
      TENANT_A,
      `insert into public.webhook_endpoints (name, url, secret_ref)
       values ('erp', 'https://erp.cliente.test/h', 'EBIM_WEBHOOK_SECRET_ERP')
       returning organization_id`,
    )
    expect(row?.organization_id).toBe(TENANT_A.organizationId)
  })
})
