// @vitest-environment node
/**
 * Invariantes que tienen que seguir siendo ciertas cuando el esquema crezca.
 *
 * Se consultan al catálogo de Postgres, no al texto del SQL: si alguien añade
 * una tabla en una migración futura sin RLS o sin tenant, esto falla aquí y no
 * en producción.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDatabase, migrationFiles, readMigration } from './harness.ts'

type Row = Record<string, unknown>

let db: PGlite

/** `tenants` es la tabla ancla del tenant: su PK ES el organization_id. */
const TENANT_ANCHOR = ['tenants']

/**
 * Catalogos de referencia GLOBALES del producto: no son datos de tenant, asi
 * que no llevan organization_id/company_id ni PK uuid. `currencies` es ISO 4217:
 * un hecho del mundo, no una preferencia de cliente, y su clave natural es el
 * codigo de 3 letras; `integration_providers` es el catalogo de conectores del
 * producto —que exista un adaptador para SAP R/3 es una capacidad del producto,
 * no un dato de cliente— y su clave natural es el codigo del conector.
 * `app_capabilities` (P02-SaaS) entra por lo mismo: es el registro tecnico de
 * modulos del producto, con la clave natural del modulo. Lo que una sociedad
 * tenga CONTRATADO no vive ahi, vive en `tenant_entitlements`, que si lleva
 * tenant y si esta en este test.
 *
 * La exencion es NOMINAL a proposito (lista de tablas, no un patron): el dia que
 * alguien meta aqui una tabla de negocio, el aislamiento se rompe en silencio.
 * Requisito para entrar: sin columnas de tenant, RLS activada, y sin GRANT de
 * escritura a anon/authenticated.
 */
const REFERENCE_CATALOG = ['app_capabilities', 'currencies', 'integration_providers']

/**
 * PLANO DE COBRO. Los dos contadores de IA (migracion 20260910100000).
 *
 * Se saltan dos invariantes, y las dos por la misma razon: no son tablas que
 * alguien consulte, son un contador.
 *
 * **Sin PK uuid.** Su clave ES su unicidad: `(organizacion, sociedad, periodo)`
 * en `ai_usage` y `(organizacion, sociedad)` en `ai_quotas`. Ponerles un uuid
 * de sobra permitiria DOS filas para el mismo mes de la misma sociedad, que es
 * exactamente el error que la clave compuesta impide: dos contadores paralelos
 * y una cuota que sirve el doble.
 *
 * **Sin policy.** RLS activada y forzada, y ni una puerta para `authenticated`.
 * Aqui «sin policy» no es un olvido, es el cierre: se llega por
 * `ebim.ai_entitlement()`, que es `security definer` y solo habla de TU
 * sociedad. Un SELECT directo sobre el contador no anade nada que el medidor no
 * diga y si anade superficie sobre el plano de cobro. Es el mismo diseno que
 * GMAO tiene en produccion para `platform.ai_usage`.
 *
 * La exencion es NOMINAL a proposito, igual que la de arriba: el dia que
 * alguien meta aqui una tabla que si tiene lectores, el hueco se ve.
 *
 * `ai_tickets` (fase 01 de IA) es la misma clase de tabla: une un consumo con
 * su traza y solo la tocan `ebim.ai_consume` / `ebim.ai_record`. Un lector
 * directo permitiria ver cuando consumio cada persona sin pasar por la traza.
 */
const BILLING_PLANE = ['ai_quotas', 'ai_usage', 'ai_tickets']

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function rows(query: string): Promise<Row[]> {
  return (await db.query<Row>(query)).rows
}

describe('RLS', () => {
  it('todas las tablas de public tienen RLS activada y forzada', async () => {
    const result = await rows(`
      select c.relname as table_name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `)
    expect(result.length).toBeGreaterThanOrEqual(9)
    for (const row of result) {
      expect(`${row.table_name}: enabled=${row.enabled} forced=${row.forced}`).toBe(
        `${row.table_name}: enabled=true forced=true`,
      )
    }
  })

  it('ninguna tabla queda sin policy (default deny sin puerta de entrada)', async () => {
    const result = await rows(`
      select c.relname as table_name, count(p.polname)::int as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      group by c.relname
      order by c.relname
    `)
    for (const row of result) {
      // El plano de cobro se cierra a propósito: se llega por función, no por
      // policy. Ver `BILLING_PLANE`.
      if (BILLING_PLANE.includes(String(row.table_name))) {
        expect(`${row.table_name}:${row.policies}`).toMatch(/:0$/)
        continue
      }
      expect(`${row.table_name}:${row.policies}`).not.toMatch(/:0$/)
    }
  })

  it('ninguna policy es permisiva para PUBLIC (todos los roles a la vez)', async () => {
    const result = await rows(`
      select c.relname as table_name, p.polname as policy_name
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and p.polroles = '{0}'
    `)
    expect(result).toEqual([])
  })
})

describe('jerarquia organization -> company -> datos (contrato §3)', () => {
  it('toda tabla de negocio lleva organization_id y company_id', async () => {
    const result = await rows(`
      select c.relname as table_name,
             bool_or(a.attname = 'organization_id') as has_org,
             bool_or(a.attname = 'company_id')      as has_company
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
      group by c.relname
      order by c.relname
    `)

    for (const row of result) {
      const table = String(row.table_name)
      if (TENANT_ANCHOR.includes(table) || REFERENCE_CATALOG.includes(table)) continue
      expect(`${table}: org=${row.has_org} company=${row.has_company}`).toBe(
        `${table}: org=true company=true`,
      )
    }
  })

  // La exencion de REFERENCE_CATALOG solo es legitima si la tabla es de verdad
  // un catalogo global de solo lectura. Sin este test, la lista es una puerta
  // trasera al aislamiento: bastaria con anadir un nombre para saltarse el RLS.
  it('los catalogos exentos son globales y de solo lectura', async () => {
    for (const table of REFERENCE_CATALOG) {
      const tenantCols = await rows(`
        select a.attname as column_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where n.nspname = 'public' and c.relname = '${table}'
          and a.attname in ('organization_id', 'company_id')
      `)
      expect(`${table} columnas de tenant: ${tenantCols.length}`).toBe(`${table} columnas de tenant: 0`)

      const rls = await rows(`
        select c.relrowsecurity as enabled
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = '${table}'
      `)
      expect(`${table} rls: ${rls[0]?.enabled}`).toBe(`${table} rls: true`)

      const writes = await rows(`
        select grantee, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public' and table_name = '${table}'
          and grantee in ('anon', 'authenticated', 'PUBLIC')
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      `)
      expect(`${table} grants de escritura: ${writes.length}`).toBe(`${table} grants de escritura: 0`)
    }
  })

  it('organization_id y company_id son NOT NULL en toda tabla de negocio', async () => {
    const result = await rows(`
      select c.relname as table_name, a.attname as column_name, a.attnotnull as not_null
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
        and a.attname in ('organization_id', 'company_id')
    `)
    for (const row of result) {
      expect(`${row.table_name}.${row.column_name}=${row.not_null}`).toMatch(/=true$/)
    }
  })

  it('no existe ninguna variante de nombre de tenant (tenant_id, org_id, ...)', async () => {
    const result = await rows(`
      select c.relname as table_name, a.attname as column_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
        and a.attname in ('tenant_id', 'org_id', 'orgid', 'organisation_id', 'companyid')
    `)
    expect(result).toEqual([])
  })

  it('el par (organization_id, company_id) esta indexado en cada tabla de negocio', async () => {
    const result = await rows(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
        )
        and not exists (
          select 1
          from pg_index i
          join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
          where i.indrelid = c.oid and a.attname = 'organization_id'
        )
    `)
    expect(result).toEqual([])
  })
})

describe('dinero y tipos', () => {
  it('no existe ninguna columna de importe en float/real/double/money', async () => {
    const result = await rows(`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and data_type in ('real', 'double precision', 'money')
    `)
    expect(result).toEqual([])
  })

  it('toda clave primaria de negocio es uuid', async () => {
    const result = await rows(`
      select c.relname as table_name, a.attname as column_name, t.typname as type_name
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
      join pg_type t on t.oid = a.atttypid
      where i.indisprimary and n.nspname = 'public' and c.relkind = 'r'
    `)
    expect(result.length).toBeGreaterThan(0)
    for (const row of result) {
      if (REFERENCE_CATALOG.includes(String(row.table_name))) continue
      // Contadores: su clave compuesta ES la garantía de que no hay dos filas
      // para el mismo periodo. Ver `BILLING_PLANE`.
      if (BILLING_PLANE.includes(String(row.table_name))) continue
      expect(`${row.table_name}.${row.column_name}:${row.type_name}`).toMatch(/:uuid$/)
    }
  })

  it('toda tabla de negocio tiene created_at', async () => {
    const result = await rows(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'created_at' and not a.attisdropped
        )
    `)
    expect(result).toEqual([])
  })
})

describe('funciones SECURITY DEFINER', () => {
  it('ninguna corre con search_path mutable', async () => {
    const result = await rows(`
      select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'ebim')
        and p.prosecdef
        and (p.proconfig is null or not exists (
          select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
        ))
    `)
    expect(result).toEqual([])
  })

  it('las operaciones de servidor no son ejecutables por anon ni authenticated', async () => {
    const result = await rows(`
      select p.proname as name, r.rolname as role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) as roles(rolname)
      join pg_roles r on r.rolname = roles.rolname
      where n.nspname = 'public'
        and p.proname in ('bootstrap_tenant', 'create_order')
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    `)
    expect(result).toEqual([])
  })
})

describe('migraciones', () => {
  it('cada migracion que crea una tabla activa RLS en el mismo archivo', () => {
    const sinRls: string[] = []

    for (const file of migrationFiles()) {
      const sql = readMigration(file)
      const created = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)]
        .map((match) => match[1])
        .filter((table): table is string => Boolean(table))

      for (const table of created) {
        const enabled = new RegExp(
          `alter table public\\.${table}\\s+enable row level security`,
          'i',
        ).test(sql)
        const forced = new RegExp(
          `alter table public\\.${table}\\s+force\\s+row level security`,
          'i',
        ).test(sql)
        if (!enabled || !forced) sinRls.push(`${file}: ${table}`)
      }
    }

    expect(sinRls).toEqual([])
  })

  it('los nombres de migracion son unicos y ordenables', () => {
    const files = migrationFiles()
    expect(files).toEqual([...files].sort())
    expect(new Set(files).size).toBe(files.length)
    for (const file of files) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/)
    }
  })

  it('ninguna migracion contiene una clave de servicio literal', () => {
    for (const file of migrationFiles()) {
      expect(readMigration(file)).not.toMatch(/sb_secret_|service_role_key|eyJhbGciOi/)
    }
  })

  /**
   * Reproducibilidad: aplicar la carpeta entera sobre una base virgen tiene que
   * dar SIEMPRE el mismo esquema. Se compara la huella (tablas, columnas, tipos,
   * nulabilidad, RLS, policies, funciones) de dos bases levantadas por separado.
   * Una migración que dependa del reloj, de un `random()` o del orden de lectura
   * del directorio se separa aquí y no en el primer `db push` del operador.
   */
  it('la carpeta de migraciones es reproducible: dos bases virgenes dan el mismo esquema', async () => {
    const otra = await createTestDatabase()
    try {
      expect(await schemaFingerprint(otra)).toEqual(await schemaFingerprint(db))
    } finally {
      await otra.close()
    }
  }, 120_000)
})

/** Huella del esquema `public` + funciones `ebim`, estable y ordenada. */
async function schemaFingerprint(target: PGlite): Promise<Row[]> {
  const query = `
    select 'column' as kind,
           c.table_name || '.' || c.column_name as name,
           c.data_type || '|' || c.is_nullable || '|' || coalesce(c.column_default, '-') as detail
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    union all
    select 'rls', c.relname, c.relrowsecurity || '|' || c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
    union all
    select 'policy', p.tablename || '.' || p.policyname, p.cmd || '|' || coalesce(p.roles::text, '-')
      from pg_policies p where p.schemaname = 'public'
    union all
    select 'function', n.nspname || '.' || p.proname, p.prosecdef::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'ebim')
     order by 1, 2, 3
  `
  return (await target.query<Row>(query)).rows
}
