// @vitest-environment node
/**
 * Cierre P1 · 4 — pedidos programados operativos, sobre Postgres real y con el
 * checkout de producción (`runCheckout` + `createDbPorts`).
 *
 * Lo que se vigila:
 *
 *  · el trabajo PREPARA y AVISA, no crea pedidos; correrlo dos veces es una
 *    sola ejecución y un solo aviso;
 *  · lo que no se puede preparar por negocio se omite y avanza; lo que falla
 *    por técnica se reintenta con espera y a los 5 intentos muere;
 *  · el comprador gestiona SOLO lo de su cuenta, por la cuenta efectiva del JWT;
 *    un lector ve pero no toca; sin el módulo no se programa;
 *  · «pasar al carrito» devuelve qué y cuánto, y el pedido sale del checkout
 *    oficial con su precio y sus reglas.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'
import { createDbPorts, type RpcCaller } from '../functions/_shared/checkout/dbPorts.ts'
import { runCheckout } from '../functions/_shared/checkout/pipeline.ts'
import { parseCheckoutBody } from '../functions/_shared/checkout/request.ts'

type Row = Record<string, unknown>

const COMPRADOR = '0a400000-0000-4000-8000-00000000d401'
const LECTOR = '0a400000-0000-4000-8000-00000000d402'
const OTRO = '0a400000-0000-4000-8000-00000000d403'
const CONSUMIDOR = '0a400000-0000-4000-8000-00000000d404'

let db: PGlite
let storeA = ''
let jabon = ''
let champu = ''
let borrador = ''

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => (await db.query<T>(query, params)).rows)
}

async function id(query: string, params: unknown[]): Promise<string> {
  const [row] = await svc<{ id: string }>(query, params)
  return String(row?.id)
}

function shopper(sub: string) {
  return { sub, email: `${sub}@compras.test`, org_id: '', companies: [], active_company: '' }
}

async function como<T = Row>(sub: string, query: string, params: unknown[] = []): Promise<T> {
  const rows = await asRole(db, 'authenticated', shopper(sub), async () =>
    (await db.query<{ r: T }>(query, params)).rows,
  )
  return rows[0]?.r as T
}

function pgCaller(role: 'authenticated' | 'service_role', sub: string | null): RpcCaller {
  return async (fn, args) =>
    asRole(db, role, sub ? shopper(sub) : null, async () => {
      const keys = Object.keys(args)
      const values = keys.map((key) => {
        const value = args[key]
        return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
      })
      const call = keys.map((key, index) => `${key} => $${index + 1}`).join(', ')
      const { rows } = await db.query<{ r: unknown }>(`select public.${fn}(${call}) as r`, values)
      return rows[0]?.r ?? null
    })
}

async function usuario(userId: string) {
  // Auth es de la plataforma: la escribe el superusuario de la prueba, no service_role.
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
    userId,
    `${userId}@compras.test`,
  ])
}

async function cuentaDe(code: string) {
  const customer = await id(
    `insert into public.customers (organization_id, company_id, kind, code, name, email)
     values ($1, $2, 'company', $3, $3, $4) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, code, `${code.toLowerCase()}@cliente.test`],
  )
  const account = await id(
    `insert into public.business_accounts (organization_id, company_id, customer_id, code, name)
     values ($1, $2, $3, $4, $4) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, customer, code],
  )
  return { customer, account }
}

async function vincular(userId: string, accountId: string, role: 'buyer' | 'viewer') {
  await usuario(userId)
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, $5, $6::public.business_role, 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, accountId, userId, `${userId}@compras.test`, role],
  )
}

let seq = 0
function clave() {
  seq += 1
  return `prog-${seq}-${'k'.repeat(20)}`
}

async function guardar(
  sub: string,
  opts: {
    templateId?: string | null
    name?: string
    lines?: unknown
    interval?: number
    nextInDays?: number
    endsInDays?: number | null
    key?: string | null
  } = {},
): Promise<Row> {
  return como<Row>(
    sub,
    `select public.save_my_order_schedule($1, $2, $3, $4::jsonb, $5, current_date + $6::int,
       case when $7::int is null then null else current_date + $7::int end, $8) as r`,
    [
      TENANT_A.storeSlug,
      opts.templateId ?? null,
      opts.name ?? 'Reposición semanal',
      opts.lines === undefined
        ? JSON.stringify([
            { product_id: jabon, quantity: 10 },
            { product_id: champu, quantity: 4 },
          ])
        : opts.lines === null
          ? null
          : JSON.stringify(opts.lines),
      opts.interval ?? 7,
      opts.nextInDays ?? 0,
      opts.endsInDays ?? null,
      opts.key === undefined ? clave() : opts.key,
    ],
  )
}

async function correr(limit = 100) {
  const [row] = await svc<{ r: Row }>(`select ebim.run_order_schedules($1) as r`, [limit])
  return row?.r as Row
}

async function ejecuciones(templateId: string) {
  return svc<{ id: string; status: string; skip_reason: string | null; attempts: number; notified_count: number }>(
    `select id, status, skip_reason, attempts, notified_count
       from public.order_schedule_runs where template_id = $1 order by run_on, created_at`,
    [templateId],
  )
}

async function entitle(caps: string[]) {
  await svc(`select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
    caps,
  ])
}

const CON_MODULO = ['ecommerce.inventory.multiwarehouse', 'ecommerce.orders.advanced']

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
  await entitle(CON_MODULO)
  storeA = await id(`update public.stores set status = 'active' where slug = $1 returning id`, [TENANT_A.storeSlug])
  await svc(`update public.stores set status = 'active' where slug = $1`, [TENANT_B.storeSlug])
  await svc(`update public.store_settings set tax_rate = 0`)
  jabon = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'B1-JABON', 'b1-jabon', 'Jabón', '10.00', 'PEN', 1000, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  champu = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
     values ($1, $2, $3, 'B1-CHAMPU', 'b1-champu', 'Champú', '20.00', 'PEN', 1000, 'published', now()) returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  borrador = await id(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status)
     values ($1, $2, $3, 'B1-BORRADOR', 'b1-borrador', 'Borrador', '5.00', 'PEN', 1000, 'draft') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  await svc(`insert into public.warehouses (organization_id, company_id, code, name) values ($1, $2, 'LIMA', 'Lima')`, [
    TENANT_A.organizationId,
    TENANT_A.companyId,
  ])
  await asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
    db.query(`select public.seed_inventory_from_catalog((select id from public.warehouses where code = 'LIMA'), $1)`, [
      storeA,
    ]),
  )

  const a = await cuentaDe('CORP-B1')
  await vincular(COMPRADOR, a.account, 'buyer')
  await vincular(LECTOR, a.account, 'viewer')
  const otro = await cuentaDe('CORP-B1-OTRO')
  await vincular(OTRO, otro.account, 'buyer')
  await usuario(CONSUMIDOR)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await entitle(CON_MODULO)
})

describe('el comprador programa', () => {
  it('crea plantilla y programación de SU cuenta, sin precio, y la ve en su lista', async () => {
    const r = await guardar(COMPRADOR, { name: 'Semanal jabón' })
    expect(r.replayed).toBe(false)
    expect((r.schedule as Row).status).toBe('active')
    expect((r.items as Row[]).map((i) => [i.product_id, i.quantity, i.available])).toEqual([
      [jabon, 10, true],
      [champu, 4, true],
    ])

    const [tpl] = await svc<{ customer_id: string; business_account_id: string; created_by: string }>(
      `select customer_id, business_account_id, created_by from public.order_templates where id = $1`,
      [r.id],
    )
    expect(tpl?.created_by).toBe(COMPRADOR)
    const [cuenta] = await svc<{ customer_id: string }>(
      `select a.customer_id from public.business_account_users u
         join public.business_accounts a on a.id = u.business_account_id where u.user_id = $1`,
      [COMPRADOR],
    )
    expect(tpl?.customer_id).toBe(cuenta?.customer_id)

    const lista = await como<Row>(COMPRADOR, `select public.my_order_schedules($1) as r`, [TENANT_A.storeSlug])
    expect(lista.can_manage).toBe(true)
    expect((lista.templates as Row[]).map((t) => t.id)).toContain(r.id)
    // Ni SKU ni precio en lo que ve el comprador.
    expect(JSON.stringify(lista)).not.toMatch(/"sku"|price/)
  })

  it('el alta repetida con la misma clave devuelve la misma plantilla', async () => {
    const key = clave()
    const a = await guardar(COMPRADOR, { key })
    const b = await guardar(COMPRADOR, { key, name: 'Otro nombre' })
    expect(b.id).toBe(a.id)
    expect(b.replayed).toBe(true)
    expect(b.name).toBe(a.name)
  })

  it('valida las líneas antes de escribir nada', async () => {
    const antes = await svc<{ n: number }>(`select count(*)::int as n from public.order_templates`)
    const casos: Array<[unknown, RegExp]> = [
      [[], /LINEAS_INVALIDAS/],
      [[{ product_id: borrador, quantity: 1 }], /PRODUCTO_NO_DISPONIBLE/],
      [[{ product_id: jabon, quantity: 0 }], /CANTIDAD_INVALIDA/],
      [[{ product_id: jabon, quantity: 1.5 }], /CANTIDAD_INVALIDA/],
      [[{ product_id: jabon, quantity: 1 }, { product_id: jabon, quantity: 2 }], /LINEA_DUPLICADA/],
      [[{ product_id: jabon, quantity: 1, unit_price: '0.01' }], /CAMPO_NO_PERMITIDO/],
      [[{ product_id: 'no-uuid', quantity: 1 }], /LINEAS_INVALIDAS/],
    ]
    for (const [lines, esperado] of casos) {
      expect(await expectFailure(() => guardar(COMPRADOR, { lines }))).toMatch(esperado)
    }
    expect(await expectFailure(() => guardar(COMPRADOR, { interval: 0 }))).toMatch(/INTERVALO_INVALIDO/)
    expect(await expectFailure(() => guardar(COMPRADOR, { nextInDays: -1 }))).toMatch(/FECHA_INVALIDA/)
    expect(await expectFailure(() => guardar(COMPRADOR, { nextInDays: 5, endsInDays: 2 }))).toMatch(/FECHA_INVALIDA/)
    expect(await svc(`select count(*)::int as n from public.order_templates`)).toEqual(antes)
  })

  it('un producto de OTRA tienda no entra', async () => {
    const [storeB] = await svc<{ id: string }>(`select id from public.stores where slug = $1`, [TENANT_B.storeSlug])
    const ajeno = await id(
      `insert into public.products
         (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
       values ($1, $2, $3, 'B1-AJENO', 'b1-ajeno', 'Ajeno', '1.00', 'PEN', 10, 'published', now()) returning id`,
      [TENANT_B.organizationId, TENANT_B.companyId, storeB?.id],
    )
    expect(await expectFailure(() => guardar(COMPRADOR, { lines: [{ product_id: ajeno, quantity: 1 }] }))).toMatch(
      /PRODUCTO_NO_DISPONIBLE/,
    )
  })

  it('pausa y reanuda; reanudar no dispara lo perdido', async () => {
    const r = await guardar(COMPRADOR, { nextInDays: 3 })
    const pausa = await como<Row>(COMPRADOR, `select public.set_my_order_schedule_status($1, $2, 'paused') as r`, [
      TENANT_A.storeSlug,
      r.id,
    ])
    expect((pausa.schedule as Row).status).toBe('paused')
    // Pausada, el trabajo no la toca aunque venza.
    await svc(`update public.order_schedules set next_run_on = current_date - 10 where template_id = $1`, [r.id])
    await correr()
    expect(await ejecuciones(r.id as string)).toEqual([])

    // Repetir la pausa no es un error.
    await como(COMPRADOR, `select public.set_my_order_schedule_status($1, $2, 'paused') as r`, [TENANT_A.storeSlug, r.id])

    const sigue = await como<Row>(COMPRADOR, `select public.set_my_order_schedule_status($1, $2, 'active') as r`, [
      TENANT_A.storeSlug,
      r.id,
    ])
    const [hoy] = await svc<{ d: string }>(`select current_date::text as d`)
    expect((sigue.schedule as Row).status).toBe('active')
    expect((sigue.schedule as Row).next_run_on).toBe(hoy?.d)
  })

  it('archivar la quita de la lista y termina la programación', async () => {
    const r = await guardar(COMPRADOR)
    await como(COMPRADOR, `select public.archive_my_order_schedule($1, $2) as r`, [TENANT_A.storeSlug, r.id])
    const lista = await como<Row>(COMPRADOR, `select public.my_order_schedules($1) as r`, [TENANT_A.storeSlug])
    expect((lista.templates as Row[]).map((t) => t.id)).not.toContain(r.id)
    const [s] = await svc<{ status: string }>(`select status::text from public.order_schedules where template_id = $1`, [r.id])
    expect(s?.status).toBe('finished')
    expect(
      await expectFailure(() =>
        como(COMPRADOR, `select public.set_my_order_schedule_status($1, $2, 'active') as r`, [TENANT_A.storeSlug, r.id]),
      ),
    ).toMatch(/PROGRAMACION_NO_ENCONTRADA/)
  })
})

describe('quién puede', () => {
  it('el lector ve pero no gestiona', async () => {
    const r = await guardar(COMPRADOR)
    const lista = await como<Row>(LECTOR, `select public.my_order_schedules($1) as r`, [TENANT_A.storeSlug])
    expect(lista.can_manage).toBe(false)
    expect((lista.templates as Row[]).map((t) => t.id)).toContain(r.id)
    expect(await expectFailure(() => guardar(LECTOR))).toMatch(/SIN_PERMISO/)
    expect(
      await expectFailure(() =>
        como(LECTOR, `select public.set_my_order_schedule_status($1, $2, 'paused') as r`, [TENANT_A.storeSlug, r.id]),
      ),
    ).toMatch(/SIN_PERMISO/)
  })

  it('otra empresa no ve ni toca, y recibe lo mismo que con un id inexistente', async () => {
    const r = await guardar(COMPRADOR)
    const lista = await como<Row>(OTRO, `select public.my_order_schedules($1) as r`, [TENANT_A.storeSlug])
    expect((lista.templates as Row[]).map((t) => t.id)).not.toContain(r.id)

    const ajena = await expectFailure(() =>
      como(OTRO, `select public.set_my_order_schedule_status($1, $2, 'paused') as r`, [TENANT_A.storeSlug, r.id]),
    )
    const inexistente = await expectFailure(() =>
      como(OTRO, `select public.set_my_order_schedule_status($1, $2, 'paused') as r`, [
        TENANT_A.storeSlug,
        '0a400000-0000-4000-8000-0000000000ff',
      ]),
    )
    expect(ajena).toMatch(/PROGRAMACION_NO_ENCONTRADA/)
    expect(inexistente).toBe(ajena)
    expect(await expectFailure(() => guardar(OTRO, { templateId: r.id as string }))).toMatch(/PROGRAMACION_NO_ENCONTRADA/)
  })

  it('el consumidor sin cuenta B2B no tiene programaciones ni puede crearlas', async () => {
    const lista = await como<Row>(CONSUMIDOR, `select public.my_order_schedules($1) as r`, [TENANT_A.storeSlug])
    expect(lista).toMatchObject({ has_account: false, templates: [] })
    expect(await expectFailure(() => guardar(CONSUMIDOR))).toMatch(/SIN_CUENTA_B2B/)
  })

  it('anon no ejecuta ninguna función del comprador ni el trabajo', async () => {
    for (const q of [
      `select public.my_order_schedules('x')`,
      `select ebim.run_order_schedules(1)`,
    ]) {
      const msg = await expectFailure(() => asRole(db, 'anon', null, async () => db.query(q)))
      expect(msg).toMatch(/permission denied/i)
    }
    const msg = await expectFailure(() =>
      asRole(db, 'authenticated', shopper(COMPRADOR), async () => db.query(`select ebim.run_order_schedules(1)`)),
    )
    expect(msg).toMatch(/permission denied/i)
  })

  it('sin el módulo no se programa', async () => {
    await entitle(['ecommerce.inventory.multiwarehouse'])
    expect(await expectFailure(() => guardar(COMPRADOR))).toMatch(/SIN_MODULO/)
    const lista = await como<Row>(COMPRADOR, `select public.my_order_schedules($1) as r`, [TENANT_A.storeSlug])
    expect(lista.entitled).toBe(false)
  })

  it('las ejecuciones son del tenant: el personal de B no ve las de A', async () => {
    const r = await guardar(COMPRADOR)
    await correr()
    const propias = await asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
      (await db.query(`select id from public.order_schedule_runs where template_id = $1`, [r.id])).rows,
    )
    const ajenas = await asRole(db, 'authenticated', claimsFor(TENANT_B), async () =>
      (await db.query(`select id from public.order_schedule_runs where template_id = $1`, [r.id])).rows,
    )
    expect(propias).toHaveLength(1)
    expect(ajenas).toHaveLength(0)
    const escribir = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), async () =>
        db.query(`update public.order_schedule_runs set status = 'taken' where template_id = $1`, [r.id]),
      ),
    )
    expect(escribir).toMatch(/permission denied/i)
  })
})

describe('el trabajo', () => {
  it('prepara, avisa y avanza; correrlo otra vez no duplica nada', async () => {
    const r = await guardar(COMPRADOR, { interval: 7 })
    const pedidosAntes = await svc<{ n: number }>(`select count(*)::int as n from public.orders`)

    await correr()
    await correr()

    const runs = await ejecuciones(r.id as string)
    expect(runs.map((x) => [x.status, x.notified_count])).toEqual([['ready', 1]])

    const avisos = await svc<{ n: number; link: string }>(
      `select count(*)::int as n, max(link) as link from public.notifications
        where recipient_user_id = $1 and kind = 'order_schedule.run_ready' and dedupe_key = $2`,
      [COMPRADOR, `order_schedule.run_ready:${runs[0]?.id}`],
    )
    expect(avisos[0]?.n).toBe(1)
    expect(avisos[0]?.link).toBe(`/s/${TENANT_A.storeSlug}/account#programados`)
    // El lector no compra: no se le avisa.
    const lector = await svc<{ n: number }>(
      `select count(*)::int as n from public.notifications where recipient_user_id = $1 and kind = 'order_schedule.run_ready'`,
      [LECTOR],
    )
    expect(lector[0]?.n).toBe(0)

    const eventos = await svc<{ n: number }>(
      `select count(*)::int as n from public.domain_events where event_type = 'order_schedule.run_ready'
          and payload ->> 'run_id' = $1`,
      [runs[0]?.id],
    )
    expect(eventos[0]?.n).toBe(1)

    const [s] = await svc<{ ok: boolean }>(
      `select next_run_on = current_date + 7 as ok from public.order_schedules where template_id = $1`,
      [r.id],
    )
    expect(s?.ok).toBe(true)
    // Preparar no es comprar.
    expect(await svc(`select count(*)::int as n from public.orders`)).toEqual(pedidosAntes)
  })

  it('una propuesta que nadie usó vence al llegar la siguiente', async () => {
    const r = await guardar(COMPRADOR, { interval: 1 })
    await correr()
    await svc(`update public.order_schedules set next_run_on = current_date + 0 where template_id = $1`, [r.id])
    await svc(`update public.order_schedule_runs set run_on = current_date - 1 where template_id = $1`, [r.id])
    await correr()
    expect((await ejecuciones(r.id as string)).map((x) => x.status)).toEqual(['expired', 'ready'])
  })

  it('omite y avanza lo que no se puede preparar por negocio', async () => {
    const r = await guardar(COMPRADOR)
    await svc(`update public.order_templates set is_active = false where id = $1`, [r.id])
    await correr()
    const runs = await ejecuciones(r.id as string)
    expect(runs.map((x) => [x.status, x.skip_reason])).toEqual([['skipped', 'template_inactive']])
    const [s] = await svc<{ ok: boolean }>(
      `select next_run_on > current_date as ok from public.order_schedules where template_id = $1`,
      [r.id],
    )
    expect(s?.ok).toBe(true)
  })

  it('sin el módulo omite y no avisa', async () => {
    const r = await guardar(COMPRADOR)
    await entitle(['ecommerce.inventory.multiwarehouse'])
    await correr()
    expect((await ejecuciones(r.id as string)).map((x) => [x.status, x.skip_reason, x.notified_count])).toEqual([
      ['skipped', 'not_entitled', 0],
    ])
  })

  it('un fallo técnico deja constancia, espera, reintenta y a los 5 intentos muere', async () => {
    const r = await guardar(COMPRADOR)
    await db.query(`
      create or replace function public.test_rompe_programacion() returns trigger language plpgsql as $$
      begin raise exception 'ROTO_A_PROPOSITO'; end $$`)
    await db.query(
      `create trigger test_rompe before update on public.order_schedules
         for each row when (old.template_id = '${r.id as string}'::uuid)
         execute function public.test_rompe_programacion()`,
    )
    try {
      const primera = await correr()
      expect(primera.failed).toBeGreaterThanOrEqual(1)
      let [run] = await ejecuciones(r.id as string)
      expect(run).toMatchObject({ status: 'failed', attempts: 1 })
      // El bloque se deshizo: ni aviso ni evento de esa ejecución.
      const avisos = await svc<{ n: number }>(
        `select count(*)::int as n from public.notifications n
           join public.order_schedule_runs r on n.dedupe_key = 'order_schedule.run_ready:' || r.id
          where r.template_id = $1`,
        [r.id],
      )
      expect(avisos[0]?.n).toBe(0)

      // Con la espera vigente, otra pasada no la reclama.
      await correr()
      ;[run] = await ejecuciones(r.id as string)
      expect(run?.attempts).toBe(1)

      for (let i = 2; i <= 5; i += 1) {
        await svc(`update public.order_schedule_runs set next_attempt_at = now() - interval '1 second' where template_id = $1`, [
          r.id,
        ])
        await correr()
      }
      ;[run] = await ejecuciones(r.id as string)
      expect(run).toMatchObject({ status: 'dead', attempts: 5 })

      // Muerta, no se vuelve a reclamar.
      await correr()
      ;[run] = await ejecuciones(r.id as string)
      expect(run?.attempts).toBe(5)
    } finally {
      await db.query(`drop trigger test_rompe on public.order_schedules`)
    }
  })
})

describe('de la propuesta al pedido, por el checkout oficial', () => {
  it('pasar al carrito devuelve qué y cuánto, es repetible y el checkout cobra el precio del motor', async () => {
    const r = await guardar(COMPRADOR)
    await correr()
    const [run] = await ejecuciones(r.id as string)

    const tomada = await como<Row>(COMPRADOR, `select public.take_my_order_schedule_run($1, $2) as r`, [
      TENANT_A.storeSlug,
      run?.id,
    ])
    expect(tomada.already_taken).toBe(false)
    expect(tomada.lines).toEqual([
      { product_id: jabon, variant_id: null, quantity: 10 },
      { product_id: champu, variant_id: null, quantity: 4 },
    ])
    const otra = await como<Row>(COMPRADOR, `select public.take_my_order_schedule_run($1, $2) as r`, [
      TENANT_A.storeSlug,
      run?.id,
    ])
    expect(otra.already_taken).toBe(true)
    expect(otra.lines).toEqual(tomada.lines)

    await svc(`delete from public.checkout_attempts`)
    const input = await parseCheckoutBody({
      store_slug: TENANT_A.storeSlug,
      idempotency_key: `b1-prog-${'q'.repeat(28)}`,
      customer_email: 'compras@empresa.test',
      customer_name: 'Compras Empresa',
      customer_phone: '+51 999 000 555',
      shipping_address: { address: 'Av. Industrial 450', city: 'Lima', country: 'PE' },
      items: (tomada.lines as Array<{ product_id: string; quantity: number }>).map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
      })),
    })
    const result = await runCheckout(
      createDbPorts({
        service: pgCaller('service_role', null),
        caller: pgCaller('authenticated', COMPRADOR),
        hasSession: true,
      }),
      input,
    )
    const lineas = await svc<{ product_id: string; unit_price: string; quantity: number }>(
      `select product_id, unit_price::text, quantity from public.order_items where order_id = $1 order by unit_price`,
      [result.order.orderId],
    )
    expect(lineas.map((l) => [l.product_id, l.unit_price, l.quantity])).toEqual([
      [jabon, '10.00', 10],
      [champu, '20.00', 4],
    ])
    const [pedido] = await svc<{ business_account_id: string | null }>(
      `select business_account_id from public.orders where id = $1`,
      [result.order.orderId],
    )
    expect(pedido?.business_account_id).not.toBeNull()
  })

  it('descartar cierra la propuesta; una descartada no se pasa al carrito', async () => {
    const r = await guardar(COMPRADOR)
    await correr()
    const [run] = await ejecuciones(r.id as string)
    await como(COMPRADOR, `select public.dismiss_my_order_schedule_run($1, $2) as r`, [TENANT_A.storeSlug, run?.id])
    await como(COMPRADOR, `select public.dismiss_my_order_schedule_run($1, $2) as r`, [TENANT_A.storeSlug, run?.id])
    expect(
      await expectFailure(() =>
        como(COMPRADOR, `select public.take_my_order_schedule_run($1, $2) as r`, [TENANT_A.storeSlug, run?.id]),
      ),
    ).toMatch(/EJECUCION_NO_DISPONIBLE/)
  })

  it('otra empresa no puede pasar al carrito una propuesta ajena', async () => {
    const r = await guardar(COMPRADOR)
    await correr()
    const [run] = await ejecuciones(r.id as string)
    const ajena = await expectFailure(() =>
      como(OTRO, `select public.take_my_order_schedule_run($1, $2) as r`, [TENANT_A.storeSlug, run?.id]),
    )
    const inexistente = await expectFailure(() =>
      como(OTRO, `select public.take_my_order_schedule_run($1, $2) as r`, [
        TENANT_A.storeSlug,
        '0a400000-0000-4000-8000-0000000000fe',
      ]),
    )
    expect(ajena).toMatch(/EJECUCION_NO_DISPONIBLE/)
    expect(inexistente).toBe(ajena)
    const [despues] = await ejecuciones(r.id as string)
    expect(despues?.status).toBe('ready')
  })
})
