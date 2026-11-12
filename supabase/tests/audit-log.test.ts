// @vitest-environment node
/**
 * P13-SaaS · La bitacora transversal, contra Postgres REAL.
 *
 * Lo que se prueba aqui es lo que hace que una auditoria sea PRUEBA y no una
 * lista de buenas intenciones:
 *
 *  · **append-only de verdad** — ni UPDATE ni DELETE, ni siquiera con
 *    `service_role`;
 *  · **el actor no es un parametro** — sale del JWT, igual que el tenant, y por
 *    eso nadie puede firmar en nombre de otro;
 *  · **no se puede rodear** — el registro lo hace un TRIGGER, asi que una
 *    escritura directa con `service_role` queda igual de registrada que una que
 *    pasa por un comando;
 *  · **sin secretos** — el codigo de una tarjeta regalo no llega a la bitacora
 *    ni redactado por accidente, y un correo se redacta;
 *  · **solo el diff** — un UPDATE registra lo que cambio y nada mas, y uno que
 *    no cambio nada no registra nada;
 *  · **autorizacion fuerte** — la lee `owner` y `admin`, no cualquier miembro;
 *  · **aislamiento** — un tenant no ve la bitacora del otro;
 *  · **el hilo** — el correlation id de la peticion queda cosido al registro.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>
type Json = Record<string, unknown>

let db: PGlite

const STORE_A_SLUG = 'tienda-a'
const STORE_B_SLUG = 'tienda-b'

let storeA: string
let storeB: string

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

async function svc(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'service_role', null, () => sql(query, params))
}

async function member(
  query: string,
  params: unknown[] = [],
  tenant = TENANT_A,
  overrides: Record<string, unknown> = {},
): Promise<Row[]> {
  return asRole(db, 'authenticated', claimsFor(tenant, overrides), () => sql(query, params))
}

async function id(query: string, params: unknown[] = []): Promise<string> {
  const rows = await svc(query, params)
  return String(rows[0]?.id)
}

async function entries(action?: string, tenant = TENANT_A): Promise<Row[]> {
  return sql(
    `select * from public.audit_log
      where organization_id = $1 and ($2::text is null or action = $2)
      order by occurred_at, created_at`,
    [tenant.organizationId, action ?? null],
  )
}

/** Igual que en analitica: la bitacora solo se puede vaciar apagando su guarda. */
async function resetAudit(): Promise<void> {
  await sql(`alter table public.audit_log disable trigger audit_log_append_only`)
  await sql(`delete from public.audit_log`)
  await sql(`alter table public.audit_log enable trigger audit_log_append_only`)
}

beforeAll(async () => {
  db = await createTestDatabase()

  for (const [tenant, storeSlug] of [
    [TENANT_A, STORE_A_SLUG],
    [TENANT_B, STORE_B_SLUG],
  ] as const) {
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, 'Tienda', 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, tenant.slug,
      tenant.adminEmail, tenant.ownerId, storeSlug,
    ])
  }
  await svc(`update public.stores set status = 'active'`)

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === STORE_A_SLUG)?.id)
  storeB = String(stores.find((s) => s.slug === STORE_B_SLUG)?.id)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await resetAudit()
})

// ---------------------------------------------------------------------------

describe('el alta de un tenant ya deja rastro', () => {
  it('crear la tienda, la membresia y los ajustes queda registrado', async () => {
    // `bootstrap_tenant` es de P02 y no se ha tocado ni una linea. Aun asi
    // queda auditado, porque quien registra es el trigger y no el comando.
    await svc(`select public.bootstrap_tenant($1, $2, 'otro', 'otro', $3, $4, 'tienda-c', 'T', 'PEN')`, [
      '0c000000-0000-4000-8000-000000000003',
      '0c000000-0000-4000-8000-0000000000c3',
      'admin@otro.com',
      '0c000000-0000-4000-8000-0000000000a3',
    ])
    const rows = await sql(
      `select action from public.audit_log
        where organization_id = '0c000000-0000-4000-8000-000000000003'
        order by action`,
    )
    const acciones = rows.map((r) => r.action)
    expect(acciones).toContain('store.created')
    expect(acciones).toContain('store_settings.created')
    expect(acciones).toContain('tenant_member.created')
  })
})

describe('el actor sale del JWT y no de un parametro', () => {
  it('un administrador que enciende un interruptor firma con su correo y su rol', async () => {
    await member(
      `insert into public.tenant_feature_flags
         (organization_id, company_id, flag_key, is_enabled)
       values ($1, $2, 'payments', false)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )

    const rows = await entries('feature_flag.created')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.actor_email).toBe(TENANT_A.adminEmail)
    expect(rows[0]?.actor_id).toBe(TENANT_A.ownerId)
    expect(rows[0]?.actor_kind).toBe('user')
    // El rol sale de `tenant_members`, no del claim: la membresia REAL manda
    // sobre lo que el token diga de si mismo, y `bootstrap_tenant` dio de alta
    // a este usuario como `owner`.
    expect(rows[0]?.actor_role).toBe('owner')
    expect(rows[0]?.entity_label).toBe('payments')
    expect(rows[0]?.cross_tenant).toBe(false)
  })

  it('el servidor sin sesion queda como `service`, no como una persona inventada', async () => {
    await svc(
      `insert into public.tenant_feature_flags
         (organization_id, company_id, flag_key, is_enabled)
       values ($1, $2, 'promotions', false)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const rows = await entries('feature_flag.created')
    expect(rows[0]?.actor_kind).toBe('service')
    expect(rows[0]?.actor_email).toBeNull()
  })

  it('no existe ninguna funcion que acepte el actor: `ebim.audit` lo deriva', async () => {
    const args = await sql(`
      select pg_get_function_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'ebim' and p.proname = 'audit'
    `)
    expect(String(args[0]?.args)).not.toMatch(/p_actor_(id|email)/)
  })
})

describe('el registro no se puede rodear ni reescribir', () => {
  it('una escritura DIRECTA con service_role queda registrada igual', async () => {
    await svc(`update public.stores set name = 'Tienda renombrada' where id = $1`, [storeA])
    const rows = await entries('store.updated')
    expect(rows).toHaveLength(1)
    const changes = (rows[0]?.changes as Json).changed as Json
    expect(Object.keys(changes)).toEqual(['name'])
    expect((changes.name as Json).to).toBe('Tienda renombrada')
  })

  it('un UPDATE que no cambia nada no registra nada', async () => {
    const before = (await entries()).length
    await svc(`update public.stores set name = name where id = $1`, [storeA])
    expect((await entries()).length).toBe(before)
  })

  it('`updated_at` no cuenta como cambio', async () => {
    await svc(`update public.stores set name = 'Otro nombre' where id = $1`, [storeA])
    const rows = await entries('store.updated')
    const changes = (rows[0]?.changes as Json).changed as Json
    expect(Object.keys(changes)).not.toContain('updated_at')
  })

  /**
   * Dos capas, y las dos se comprueban por separado.
   *
   * `service_role` ni siquiera llega al trigger: no tiene GRANT de UPDATE ni de
   * DELETE, asi que se detiene en el permiso. El trigger es la segunda capa, la
   * que aguanta cuando el permiso esta —el propietario de la tabla— y es la
   * unica que un `grant` mal puesto no puede desactivar.
   */
  it('service_role no tiene ni permiso para intentarlo', async () => {
    await svc(`update public.stores set name = 'Y otro mas' where id = $1`, [storeA])
    const update = await expectFailure(() =>
      svc(`update public.audit_log set action = 'store.created'`),
    )
    expect(update).toMatch(/permission denied/i)
    const remove = await expectFailure(() => svc(`delete from public.audit_log`))
    expect(remove).toMatch(/permission denied/i)
  })

  it('y quien SI tiene permiso choca con el trigger', async () => {
    await svc(`update public.stores set name = 'Y uno mas' where id = $1`, [storeA])
    const update = await expectFailure(() =>
      sql(`update public.audit_log set action = 'store.created'`),
    )
    expect(update).toMatch(/BITACORA_INMUTABLE/)
    const remove = await expectFailure(() => sql(`delete from public.audit_log`))
    expect(remove).toMatch(/BITACORA_INMUTABLE/)
  })

  it('la bitacora no tiene FK: sobrevive al borrado de lo que registra', async () => {
    const fks = await sql(`
      select conname from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'audit_log' and c.contype = 'f'
    `)
    expect(fks).toEqual([])

    // Se comprueba de verdad: se crea un cliente, se borra y su registro sigue.
    const cliente = await id(
      `insert into public.customers (organization_id, company_id, kind, code, name)
       values ($1, $2, 'person', 'C-PRUEBA', 'Cliente de prueba') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await svc(`delete from public.customers where id = $1`, [cliente])

    const creado = await entries('customer.created')
    const borrado = await entries('customer.deleted')
    expect(creado).toHaveLength(1)
    expect(borrado).toHaveLength(1)
    expect(creado[0]?.entity_id).toBe(cliente)
  })
})

describe('ni secretos ni datos personales en el payload', () => {
  it('el codigo de una tarjeta regalo NO entra en la bitacora', async () => {
    // El codigo lo genera `ebim.new_gift_card_code()`, que `service_role` no
    // puede ejecutar (P10: el saldo se mueve por comando). Se escribe uno
    // literal, que es lo que hace el comando por dentro.
    const CODIGO = 'GCTESTCODE0001'
    const tarjeta = await id(
      `insert into public.gift_cards
         (organization_id, company_id, store_id, code, currency, initial_amount, balance, expires_at)
       values ($1, $2, $3, $4, 'PEN', '100.00', '100.00', now() + interval '1 year')
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, CODIGO],
    )
    const codigo = String(
      (await sql(`select code from public.gift_cards where id = $1`, [tarjeta]))[0]?.code,
    )
    expect(codigo).toBe(CODIGO)

    const rows = await entries('gift_card.created')
    expect(rows).toHaveLength(1)
    const registro = JSON.stringify(rows[0]?.changes)
    expect(registro).not.toContain(codigo)
    expect(registro).toContain('[redactado]')
    // Los cuatro ultimos SI: son lo unico que P10 deja ensenar y es lo que
    // permite reconocer la tarjeta al atender una queja.
    expect(registro).toContain(codigo.slice(-4))
  })

  it('el correo de un cliente se redacta', async () => {
    await svc(
      `insert into public.customers (organization_id, company_id, kind, code, name, email)
       values ($1, $2, 'person', 'C-ANA', 'Ana', 'ana@example.com')`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const rows = await entries('customer.created')
    const registro = JSON.stringify(rows[0]?.changes)
    expect(registro).not.toContain('ana@example.com')
    expect(registro).toContain('[redactado]')
  })

  it('un CHECK lo impone aunque alguien escriba directo en la bitacora', async () => {
    const message = await expectFailure(() =>
      svc(
        `insert into public.audit_log
           (organization_id, company_id, actor_kind, action, entity_type, metadata)
         values ($1, $2, 'service', 'store.updated', 'store',
                 '{"api_key": "sk-real-secreto"}'::jsonb)`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      ),
    )
    expect(message).toMatch(/audit_log_metadata_clean/)
  })

  it('el correo del ACTOR si se guarda: sin el no hay auditoria', async () => {
    await member(
      `insert into public.tenant_feature_flags
         (organization_id, company_id, flag_key, is_enabled)
       values ($1, $2, 'content', false)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const rows = await entries('feature_flag.created')
    expect(rows[0]?.actor_email).toBe(TENANT_A.adminEmail)
  })
})

describe('quien puede leerla', () => {
  beforeEach(async () => {
    await svc(`update public.stores set name = 'Para leer' where id = $1`, [storeA])
  })

  it('un administrador la ve', async () => {
    const rows = await member(`select count(*)::int as n from public.audit_log`)
    expect(Number(rows[0]?.n)).toBeGreaterThan(0)
  })

  it('un `viewer` NO la ve, aunque sea miembro del mismo tenant', async () => {
    const rows = await member(
      `select count(*)::int as n from public.audit_log`,
      [],
      TENANT_A,
      { companies: [{ id: TENANT_A.companyId, role: 'viewer' }] },
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })

  it('el administrador del otro tenant tampoco', async () => {
    const rows = await member(`select count(*)::int as n from public.audit_log`, [], TENANT_B)
    expect(Number(rows[0]?.n)).toBe(0)
  })

  it('y nadie con sesion puede escribir en ella', async () => {
    const grants = await sql(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'audit_log'
         and grantee in ('authenticated', 'anon')
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    `)
    expect(grants).toEqual([])
  })
})

describe('el hilo y el soporte cruzado', () => {
  it('el correlation id de la peticion queda cosido al registro', async () => {
    await sql(`select set_config('ebim.correlation_id', 'ec-auditoria-0001', false)`)
    try {
      await svc(`update public.stores set name = 'Con hilo' where id = $1`, [storeA])
    } finally {
      await sql(`select set_config('ebim.correlation_id', '', false)`)
    }
    const rows = await entries('store.updated')
    expect(rows[0]?.correlation_id).toBe('ec-auditoria-0001')
  })

  it('un hilo con forma invalida no entra: se descarta, no se guarda a medias', async () => {
    await sql(`select set_config('ebim.correlation_id', 'corto', false)`)
    try {
      await svc(`update public.stores set name = 'Hilo malo' where id = $1`, [storeA])
    } finally {
      await sql(`select set_config('ebim.correlation_id', '', false)`)
    }
    const rows = await entries('store.updated')
    expect(rows[0]?.correlation_id).toBeNull()
  })

  it('actuar sobre otro tenant con un JWT propio queda MARCADO', async () => {
    // `service_role` es la unica via que existe hoy para escribir en un tenant
    // ajeno, y solo desde el servidor. Se simula con los claims de A escribiendo
    // en B: la marca `cross_tenant` es lo que haria visible ese camino el dia
    // que existiera.
    await asRole(db, 'service_role', claimsFor(TENANT_A), () =>
      sql(`update public.stores set name = 'Tocada desde fuera' where id = $1`, [storeB]),
    )
    const rows = await entries('store.updated', TENANT_B)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.cross_tenant).toBe(true)
    expect(rows[0]?.actor_email).toBe(TENANT_A.adminEmail)
  })

  it('y el trabajo NORMAL del tenant no queda marcado', async () => {
    await member(
      `insert into public.tenant_feature_flags
         (organization_id, company_id, flag_key, is_enabled)
       values ($1, $2, 'fulfillment', false)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    const rows = await entries('feature_flag.created')
    expect(rows[0]?.cross_tenant).toBe(false)
  })
})

describe('la puerta del borde', () => {
  it('`audit_record` registra una operacion que no deja fila', async () => {
    const recorded = await svc(
      `select public.audit_record($1, $2, 'analytics.exported', 'analytics', null,
                                  'ventas-30d', $3, '{"rows": 120}'::jsonb) as id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA],
    )
    expect(recorded[0]?.id).toBeTruthy()

    const rows = await entries('analytics.exported')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.entity_label).toBe('ventas-30d')
    expect((rows[0]?.metadata as Json).rows).toBe(120)
  })

  it('el navegador NO puede llamarla', async () => {
    const message = await expectFailure(() =>
      member(`select public.audit_record($1, $2, 'analytics.exported', 'analytics')`, [
        TENANT_A.organizationId, TENANT_A.companyId,
      ]),
    )
    expect(message).toMatch(/permission denied|permiso/i)
  })
})

describe('lo que NO se audita, y esta escrito', () => {
  it('`orders` no tiene trigger de auditoria: su relato es `order_events` (P08)', async () => {
    const rows = await sql(`
      select tgname from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where c.relname = 'orders' and tgname like '%audit%' and not t.tgisinternal
    `)
    expect(rows).toEqual([])
  })

  it('las dieciseis tablas auditadas son exactamente las declaradas', async () => {
    const rows = await sql(`
      select c.relname as tabla
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_proc p on p.oid = t.tgfoid
       where p.proname = 'audit_row' and not t.tgisinternal
       order by c.relname
    `)
    // P14-SaaS anade tres, y las tres son de la misma clase que las once
    // anteriores: dar de alta una credencial de API o un destino al que salen
    // datos de negocio —y cambiarle la URL o el secreto— son las acciones mas
    // sensibles de esa fase. Las fuentes de lectura (2026-11-12) anaden dos
    // de la misma clase: a que servidor se llama con una credencial y que se
    // trae de el (la credencial misma vive en Vault, no en la fila).
    expect(rows.map((r) => r.tabla)).toEqual([
      'api_clients',
      'connector_feeds',
      'connector_sources',
      'customers',
      'delivery_rates',
      'gift_cards',
      'payment_methods',
      'refunds',
      'store_settings',
      'stores',
      'tenant_entitlements',
      'tenant_feature_flags',
      'tenant_integrations',
      'tenant_members',
      'webhook_endpoints',
      'webhook_subscriptions',
    ])
  })
})
