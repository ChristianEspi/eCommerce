// @vitest-environment node
/**
 * Capacidades, entitlements y flags sobre Postgres REAL (P02-SaaS).
 *
 * El gating de la UI no es seguridad. Lo que hace que apagar un módulo
 * signifique algo es lo que se comprueba aquí: que la base deniegue aunque
 * quien llame hable PostgREST directo con su propio token, y que un
 * administrador del tenant no pueda concederse un módulo que nadie le vendió.
 *
 * También ata las DOS copias de la regla de composición —la de SQL
 * (`ebim.company_is_entitled`) y la de TypeScript (`resolveCapabilities`)—
 * comparándolas escenario por escenario. Dos copias no se separan el día que se
 * escriben: se separan el día que una cambia.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  BASELINE_CAPABILITY_IDS,
  CAPABILITIES,
  CAPABILITY_IDS,
  resolveCapabilities,
} from '../../src/domain/capabilities.ts'
import {
  APP_CAPABILITIES_TABLE,
  EFFECTIVE_CAPABILITIES_RPC,
  TENANT_ENTITLEMENTS_TABLE,
  TENANT_FEATURE_FLAGS_TABLE,
  TENANT_PLATFORM_CONTEXT_TABLE,
} from '../../src/shared/lib/db-schema.ts'
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
let storeA: string

const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d7'

const WHITE_LABEL = 'ecommerce.content.white_label'
const INTEGRATIONS = 'ecommerce.integrations.enterprise'

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

/** Escribe el contexto por la ÚNICA puerta que existe: la del servidor. */
async function sync(
  tenant: typeof TENANT_A,
  entitlements: string[],
  options: { appActive?: boolean; plan?: string | null; source?: 'hub' | 'provisioning' } = {},
): Promise<void> {
  await svc(`select public.sync_platform_context($1, $2, $3, $4, $5::public.entitlement_source, $6)`, [
    tenant.organizationId,
    tenant.companyId,
    options.appActive ?? true,
    entitlements,
    options.source ?? 'hub',
    options.plan ?? null,
  ])
}

async function capabilityInDb(tenant: typeof TENANT_A, code: string): Promise<boolean> {
  const [row] = await svc<{ ok: boolean }>(
    `select ebim.company_is_entitled($1, $2, $3) as ok`,
    [tenant.organizationId, tenant.companyId, code],
  )
  return Boolean(row?.ok)
}

beforeAll(async () => {
  db = await createTestDatabase()
  await asRole(db, 'service_role', null, async () => {
    for (const t of [TENANT_A, TENANT_B]) {
      await db.query(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
        t.organizationId,
        t.companyId,
        t.slug,
        `Cuenta ${t.slug}`,
        t.adminEmail,
        t.ownerId,
        t.storeSlug,
        `Tienda ${t.slug}`,
      ])
    }
    await db.query(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, $3, 'lector@tenant-a.com', 'viewer')`,
      [TENANT_A.organizationId, TENANT_A.companyId, VIEWER_USER],
    )
  })
  const [store] = await svc<{ id: string }>(`select id from public.stores where slug = $1`, [
    TENANT_A.storeSlug,
  ])
  storeA = String(store?.id)
}, 180_000)

beforeEach(async () => {
  await svc(`delete from public.tenant_entitlements`)
  await svc(`delete from public.tenant_platform_context`)
  await svc(`delete from public.tenant_feature_flags`)
  await svc(`delete from public.tenant_integrations`)
  await svc(`update public.store_settings set white_label = false`)
})

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('el esquema es el que el codigo cree que es', () => {
  /**
   * Sustituye al `satisfies TableName` de `db-schema.ts`, que no se puede poner
   * hasta que la migracion 160000 este aplicada en el proyecto enlazado y se
   * regeneren los tipos. Esta comprobacion es ademas MAS fuerte: no depende de
   * que alguien recuerde regenerar.
   */
  it('las tablas y la funcion que nombra `db-schema.ts` existen', async () => {
    const tables = await svc<{ name: string }>(
      `select c.relname as name from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    )
    const names = tables.map((t) => t.name)
    for (const table of [
      APP_CAPABILITIES_TABLE,
      TENANT_PLATFORM_CONTEXT_TABLE,
      TENANT_ENTITLEMENTS_TABLE,
      TENANT_FEATURE_FLAGS_TABLE,
    ]) {
      expect(names).toContain(table)
    }

    const [fn] = await svc<{ n: number }>(
      `select count(*)::int as n from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [EFFECTIVE_CAPABILITIES_RPC],
    )
    expect(fn?.n).toBe(1)
  })

  /**
   * El registro vive en dos sitios: la tabla sembrada (que usan las policies) y
   * `src/domain/capabilities.ts` (que usa la UI). Si se separan, la pantalla
   * ofrece un modulo que la base no reconoce, o al reves.
   */
  it('la semilla de `app_capabilities` es exactamente el registro de TypeScript', async () => {
    const rows = await svc<{
      code: string
      boundary: string
      is_baseline: boolean
      entitlement_code: string | null
      state: string
      legacy_until_synced: boolean
    }>(`select code, boundary, is_baseline, entitlement_code, state, legacy_until_synced
          from public.app_capabilities order by code`)

    expect(rows.map((r) => r.code)).toEqual([...CAPABILITY_IDS].sort())

    const declared = new Map(CAPABILITIES.map((c) => [c.id, c]))
    for (const row of rows) {
      const item = declared.get(row.code as never)
      expect(`${row.code} existe en TypeScript`).toBe(`${row.code} existe en TypeScript`)
      expect({
        boundary: row.boundary,
        baseline: row.is_baseline,
        entitlement: row.entitlement_code,
        state: row.state,
        legacy: row.legacy_until_synced,
      }).toEqual({
        boundary: item?.boundary,
        baseline: item?.entitlement === null,
        entitlement: item?.entitlement ?? null,
        state: item?.state,
        legacy: item?.legacyUntilSynced === true,
      })
    }
  })

  it('la lista baseline de la base es la de TypeScript', async () => {
    const [row] = await svc<{ codes: string[] }>(`select ebim.baseline_capabilities() as codes`)
    expect([...(row?.codes ?? [])].sort()).toEqual([...BASELINE_CAPABILITY_IDS].sort())
  })
})

describe('la resolucion de SQL y la de TypeScript dicen lo mismo', () => {
  const ESCENARIOS: Array<{
    nombre: string
    entitlements: string[]
    flags: Record<string, boolean>
    appActive: boolean
    /** `false` = no se llama a `sync`: la sociedad queda sin fila de contexto. */
    synced?: false
  }> = [
    { nombre: 'tenant recien creado', entitlements: [], flags: {}, appActive: true },
    // D3 (20260914180000): el fallback legado, en las dos copias de la regla.
    {
      nombre: 'nunca sincronizado (fallback legado)',
      entitlements: [],
      flags: {},
      appActive: true,
      synced: false,
    },
    {
      nombre: 'nunca sincronizado, con un corte tecnico sobre un modulo legado',
      entitlements: [],
      flags: { payments: false },
      appActive: true,
      synced: false,
    },
    { nombre: 'un addon', entitlements: [WHITE_LABEL], flags: {}, appActive: true },
    {
      nombre: 'dos addons y un corte',
      entitlements: [WHITE_LABEL, INTEGRATIONS],
      flags: { 'integrations.enterprise': false },
      appActive: true,
    },
    {
      nombre: 'flag encendido sin addon (no concede)',
      entitlements: [],
      flags: { payments: true, 'content.cms': true },
      appActive: true,
    },
    {
      nombre: 'flag apagado sobre baseline (no apaga)',
      entitlements: [],
      flags: { catalog: false, orders: false },
      appActive: true,
    },
    { nombre: 'app no contratada', entitlements: [WHITE_LABEL], flags: {}, appActive: false },
    {
      nombre: 'addon de otra app de la suite',
      entitlements: ['gmao.licitaciones'],
      flags: {},
      appActive: true,
    },
  ]

  for (const escenario of ESCENARIOS) {
    it(escenario.nombre, async () => {
      if (escenario.synced !== false) {
        await sync(TENANT_A, escenario.entitlements, { appActive: escenario.appActive })
      }
      for (const [key, value] of Object.entries(escenario.flags)) {
        await svc(
          `insert into public.tenant_feature_flags
             (organization_id, company_id, flag_key, is_enabled)
           values ($1, $2, $3, $4)`,
          [TENANT_A.organizationId, TENANT_A.companyId, key, value],
        )
      }

      const esperado = resolveCapabilities({
        appActive: escenario.appActive,
        entitlements: escenario.entitlements,
        flags: escenario.flags,
        synced: escenario.synced !== false,
      }).capabilities

      const enBase: string[] = []
      for (const code of CAPABILITY_IDS) {
        if (await capabilityInDb(TENANT_A, code)) enBase.push(code)
      }
      expect(enBase.sort()).toEqual([...esperado].sort())
    })
  }
})

describe('nadie se concede un modulo a si mismo', () => {
  /**
   * Dos capas, no una repetida: no hay GRANT de escritura para `authenticated`
   * Y no hay una sola policy de INSERT/UPDATE/DELETE. Aunque alguien concediera
   * el GRANT por error, la RLS seguiria denegando.
   */
  it('un `owner` no puede escribir entitlements ni contexto', async () => {
    const intentos: Array<[string, unknown[]]> = [
      [
        `insert into public.tenant_entitlements
           (organization_id, company_id, entitlement_code, is_active, source)
         values ($1, $2, $3, true, 'hub')`,
        [TENANT_A.organizationId, TENANT_A.companyId, WHITE_LABEL],
      ],
      [`update public.tenant_entitlements set is_active = true`, []],
      [`delete from public.tenant_entitlements`, []],
      [
        `insert into public.tenant_platform_context
           (organization_id, company_id, app_active, source)
         values ($1, $2, true, 'hub')`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ],
      [`update public.tenant_platform_context set app_active = true`, []],
    ]

    for (const [query, params] of intentos) {
      const message = await expectFailure(() =>
        asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
          await db.query(query, params)
        }),
      )
      expect(`${query.slice(0, 24)}: ${message}`).toMatch(/permission denied|denied|violates/i)
    }
  })

  it('ni el backoffice ni anon pueden ejecutar la funcion de sincronizacion', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const message = await expectFailure(() =>
        asRole(db, role, role === 'authenticated' ? claimsFor(TENANT_A) : null, async () => {
          await db.query(
            `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
            [TENANT_A.organizationId, TENANT_A.companyId, [WHITE_LABEL]],
          )
        }),
      )
      expect(`${role}: ${message}`).toMatch(/permission denied|denied/i)
    }
  })

  it('un tenant no ve los entitlements del otro', async () => {
    await sync(TENANT_A, [WHITE_LABEL])
    await sync(TENANT_B, [INTEGRATIONS])

    const visto = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const result = await db.query<{ entitlement_code: string; organization_id: string }>(
        `select entitlement_code, organization_id from public.tenant_entitlements`,
      )
      return result.rows
    })

    expect(visto.map((r) => r.entitlement_code)).toEqual([WHITE_LABEL])
    expect(visto.every((r) => r.organization_id === TENANT_A.organizationId)).toBe(true)
  })

  it('anon no toca ninguna de las cuatro tablas', async () => {
    for (const tabla of [
      'app_capabilities',
      'tenant_platform_context',
      'tenant_entitlements',
      'tenant_feature_flags',
    ]) {
      const message = await expectFailure(() =>
        asRole(db, 'anon', null, async () => {
          await db.query(`select 1 from public.${tabla}`)
        }),
      )
      expect(`${tabla}: ${message}`).toMatch(/permission denied|denied/i)
    }
  })
})

describe('flags tecnicos: del tenant, y solo restan', () => {
  it('un administrador enciende y apaga los suyos', async () => {
    await sync(TENANT_A, [INTEGRATIONS])
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      await db.query(
        `insert into public.tenant_feature_flags
           (organization_id, company_id, flag_key, is_enabled)
         values ($1, $2, 'integrations.enterprise', false)`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      )
    })
    expect(await capabilityInDb(TENANT_A, 'integrations.enterprise')).toBe(false)
  })

  it('un `viewer` no escribe flags', async () => {
    const claims = claimsFor(TENANT_A, {
      sub: VIEWER_USER,
      email: 'lector@tenant-a.com',
      companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
    })
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claims, async () => {
        await db.query(
          `insert into public.tenant_feature_flags
             (organization_id, company_id, flag_key, is_enabled)
           values ($1, $2, 'payments', true)`,
          [TENANT_A.organizationId, TENANT_A.companyId],
        )
      }),
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('un administrador no escribe flags del tenant de al lado', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
        await db.query(
          `insert into public.tenant_feature_flags
             (organization_id, company_id, flag_key, is_enabled)
           values ($1, $2, 'payments', true)`,
          [TENANT_B.organizationId, TENANT_B.companyId],
        )
      }),
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  /** La propiedad que impide que los ajustes del tenant sean una caja. */
  it('un flag encendido no concede nada', async () => {
    await sync(TENANT_A, [])
    await svc(
      `insert into public.tenant_feature_flags
         (organization_id, company_id, flag_key, is_enabled)
       values ($1, $2, 'payments', true)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    expect(await capabilityInDb(TENANT_A, 'payments')).toBe(false)
  })
})

describe('enforcement en el servidor: marca blanca (contrato §4.3)', () => {
  it('sin el addon, encender la marca blanca se DENIEGA en la base', async () => {
    await sync(TENANT_A, [])
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
        await db.query(`update public.store_settings set white_label = true where store_id = $1`, [
          storeA,
        ])
      }),
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('con el addon activo, se puede encender — sin tocar una linea de codigo', async () => {
    await sync(TENANT_A, [WHITE_LABEL])
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      await db.query(`update public.store_settings set white_label = true where store_id = $1`, [
        storeA,
      ])
    })
    const [row] = await svc<{ white_label: boolean }>(
      `select white_label from public.store_settings where store_id = $1`,
      [storeA],
    )
    expect(row?.white_label).toBe(true)
  })

  it('editar el resto de la marca sigue funcionando sin el addon', async () => {
    await sync(TENANT_A, [])
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      await db.query(`update public.store_settings set accent_color = '#123456' where store_id = $1`, [
        storeA,
      ])
    })
    const [row] = await svc<{ accent_color: string }>(
      `select accent_color from public.store_settings where store_id = $1`,
      [storeA],
    )
    expect(row?.accent_color).toBe('#123456')
  })

  /**
   * Retirar el addon apaga el EFECTO, no solo el boton. Sin esto, una cuenta
   * que deja de pagar conserva la vitrina sin la firma de la suite para
   * siempre, porque la policy solo impide encenderlo.
   */
  it('retirar el addon apaga la marca blanca ya encendida', async () => {
    await sync(TENANT_A, [WHITE_LABEL])
    await svc(`update public.store_settings set white_label = true where store_id = $1`, [storeA])

    await sync(TENANT_A, [])

    const [row] = await svc<{ white_label: boolean }>(
      `select white_label from public.store_settings where store_id = $1`,
      [storeA],
    )
    expect(row?.white_label).toBe(false)
  })

  it('retirar el addon de un tenant no toca la tienda del otro', async () => {
    await sync(TENANT_A, [WHITE_LABEL])
    await sync(TENANT_B, [WHITE_LABEL])
    await svc(`update public.store_settings set white_label = true`)

    await sync(TENANT_A, [])

    const rows = await svc<{ organization_id: string; white_label: boolean }>(
      `select organization_id, white_label from public.store_settings`,
    )
    const b = rows.find((r) => r.organization_id === TENANT_B.organizationId)
    expect(b?.white_label).toBe(true)
  })
})

describe('enforcement en el servidor: integraciones enterprise', () => {
  it('sin el addon, habilitar un conector se DENIEGA en la base', async () => {
    await sync(TENANT_A, [])
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
        await db.query(
          `insert into public.tenant_integrations
             (organization_id, company_id, provider_code, is_active)
           values ($1, $2, 'sap_r3', true)`,
          [TENANT_A.organizationId, TENANT_A.companyId],
        )
      }),
    )
    expect(message).toMatch(/row-level security|violates/i)
  })

  it('con el addon activo, el mismo INSERT pasa', async () => {
    await sync(TENANT_A, [INTEGRATIONS])
    await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      await db.query(
        `insert into public.tenant_integrations
           (organization_id, company_id, provider_code, is_active)
         values ($1, $2, 'sap_r3', true)`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      )
    })
    const [row] = await svc<{ n: number }>(
      `select count(*)::int as n from public.tenant_integrations where organization_id = $1`,
      [TENANT_A.organizationId],
    )
    expect(row?.n).toBe(1)
  })

  /**
   * El catalogo de conectores se sigue LEYENDO sin el addon: saber que existe
   * el conector es justo lo que hace que alguien lo contrate.
   */
  it('el catalogo de proveedores se lee igual sin el addon', async () => {
    await sync(TENANT_A, [])
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const result = await db.query(`select code from public.integration_providers`)
      return result.rows
    })
    expect(rows.length).toBeGreaterThan(0)
  })

  it('un corte tecnico apaga el modulo aunque el addon siga contratado', async () => {
    await sync(TENANT_A, [INTEGRATIONS])
    await svc(
      `insert into public.tenant_feature_flags
         (organization_id, company_id, flag_key, is_enabled)
       values ($1, $2, 'integrations.enterprise', false)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
        await db.query(
          `insert into public.tenant_integrations
             (organization_id, company_id, provider_code, is_active)
           values ($1, $2, 'bcp', true)`,
          [TENANT_A.organizationId, TENANT_A.companyId],
        )
      }),
    )
    expect(message).toMatch(/row-level security|violates/i)
  })
})

describe('effective_capabilities', () => {
  it('devuelve lo efectivo de la sociedad del usuario, con su origen', async () => {
    await sync(TENANT_A, [WHITE_LABEL], { plan: 'enterprise', source: 'provisioning' })

    const data = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const result = await db.query<{ ctx: Record<string, unknown> }>(
        `select public.effective_capabilities($1) as ctx`,
        [TENANT_A.companyId],
      )
      return result.rows[0]?.ctx
    })

    expect(data?.organization_id).toBe(TENANT_A.organizationId)
    expect(data?.company_id).toBe(TENANT_A.companyId)
    expect(data?.source).toBe('provisioning')
    expect(data?.plan).toBe('enterprise')
    expect(data?.app_active).toBe(true)
    expect(data?.entitlements).toEqual([WHITE_LABEL])
    expect(data?.capabilities).toEqual(
      [...BASELINE_CAPABILITY_IDS, 'content.white_label'].sort(),
    )
  })

  /**
   * Sin contexto sincronizado el origen se dice en voz alta. «Nunca hablamos
   * con el hub» y «el hub dice que no lo tienes» son incidencias distintas y
   * solo una se arregla vendiendo algo.
   *
   * D3 (20260914180000): sin sincronizar, además de lo baseline quedan las
   * capacidades con fallback legado —las tres que nacieron sin candado de
   * servidor—, para que cerrar el candado no las apague a quien ya las usaba.
   * Ninguna otra vendible entra por esta vía.
   */
  it('sin sincronizar nunca, lo dice y deja lo baseline más el fallback legado', async () => {
    const data = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const result = await db.query<{ ctx: Record<string, unknown> }>(
        `select public.effective_capabilities($1) as ctx`,
        [TENANT_A.companyId],
      )
      return result.rows[0]?.ctx
    })
    expect(data?.source).toBe('sin-contexto')
    expect(data?.entitlements).toEqual([])
    expect(data?.capabilities).toEqual(
      [...BASELINE_CAPABILITY_IDS, 'catalog.advanced', 'fulfillment', 'payments'].sort(),
    )
  })

  /** Y en cuanto el hub sincroniza —aunque sea con la lista vacía— manda la lista. */
  it('la primera sincronizacion retira el fallback legado', async () => {
    await sync(TENANT_A, [])
    const data = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
      const result = await db.query<{ ctx: Record<string, unknown> }>(
        `select public.effective_capabilities($1) as ctx`,
        [TENANT_A.companyId],
      )
      return result.rows[0]?.ctx
    })
    expect(data?.source).toBe('hub')
    expect(data?.capabilities).toEqual([...BASELINE_CAPABILITY_IDS].sort())
  })

  /**
   * `p_company_id` es ALCANCE, no autorizacion: quien decide sigue siendo el
   * JWT. Y no devuelve lista vacia —que la UI leeria como «no contrataste
   * nada»— sino un error.
   */
  it('pedir la sociedad de otro tenant levanta SIN_PERMISO, no una lista vacia', async () => {
    await sync(TENANT_B, [WHITE_LABEL])
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), async () => {
        await db.query(`select public.effective_capabilities($1)`, [TENANT_B.companyId])
      }),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('anon no la puede ejecutar', async () => {
    const message = await expectFailure(() =>
      asRole(db, 'anon', null, async () => {
        await db.query(`select public.effective_capabilities(null)`)
      }),
    )
    expect(message).toMatch(/permission denied|denied/i)
  })
})

describe('app_active: si la cuenta no tiene eCommerce, no hay nada', () => {
  it('ni siquiera lo baseline', async () => {
    await sync(TENANT_A, [WHITE_LABEL], { appActive: false })
    for (const code of BASELINE_CAPABILITY_IDS) {
      expect(`${code}: ${await capabilityInDb(TENANT_A, code)}`).toBe(`${code}: false`)
    }
    expect(await capabilityInDb(TENANT_A, 'content.white_label')).toBe(false)
  })
})

describe('sincronizacion', () => {
  it('reemplaza el conjunto: lo que el hub deja de mandar se apaga', async () => {
    await sync(TENANT_A, [WHITE_LABEL, INTEGRATIONS])
    expect(await capabilityInDb(TENANT_A, 'integrations.enterprise')).toBe(true)

    await sync(TENANT_A, [WHITE_LABEL])
    expect(await capabilityInDb(TENANT_A, 'integrations.enterprise')).toBe(false)
    expect(await capabilityInDb(TENANT_A, 'content.white_label')).toBe(true)
  })

  /** Se desactiva, no se borra: quien da soporte necesita ver el historial. */
  it('un addon retirado deja rastro en vez de desaparecer', async () => {
    await sync(TENANT_A, [INTEGRATIONS])
    await sync(TENANT_A, [])
    const [row] = await svc<{ is_active: boolean }>(
      `select is_active from public.tenant_entitlements
        where organization_id = $1 and entitlement_code = $2`,
      [TENANT_A.organizationId, INTEGRATIONS],
    )
    expect(row?.is_active).toBe(false)
  })

  it('un codigo con forma invalida no entra', async () => {
    const message = await expectFailure(() => sync(TENANT_A, ['NO ES UN CODIGO']))
    expect(message).toMatch(/ENTITLEMENT_INVALIDO/)
  })

  it('sin organizacion o sociedad no sincroniza nada', async () => {
    const message = await expectFailure(() =>
      svc(
        `select public.sync_platform_context(null, $1, true, '{}'::text[], 'hub'::public.entitlement_source, null)`,
        [TENANT_A.companyId],
      ),
    )
    expect(message).toMatch(/EBIM_TENANT_REQUERIDO/)
  })
})
