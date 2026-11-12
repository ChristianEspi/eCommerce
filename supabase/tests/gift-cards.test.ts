// @vitest-environment node
/**
 * P10-SaaS · Tarjetas regalo, contra Postgres REAL.
 *
 * Lo que se prueba aquí es lo que hace que un saldo al portador sea defendible:
 *
 *  · **el saldo no se escribe, se mueve** — ni un GRANT de escritura para
 *    nadie, y cada movimiento deja su asiento con el saldo resultante;
 *  · **el código es un secreto de verdad** — sale de la base UNA vez, en la
 *    respuesta de la emisión, y después ninguna consulta lo devuelve;
 *  · **caducar no depende de que nadie pase a marcarlo** — una tarjeta vencida
 *    no paga aunque siga en estado `active`;
 *  · **el canje es idempotente** — el mismo reintento del checkout no gasta el
 *    saldo dos veces;
 *  · y **el aislamiento**: el código de otra tienda simplemente no existe.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TENANT_A, TENANT_B, asRole, claimsFor, createTestDatabase, expectFailure } from './harness.ts'

type Row = Record<string, unknown>
type Json = Record<string, unknown>

let db: PGlite

const STORE_A_SLUG = 'tienda-a'
const STORE_B_SLUG = 'tienda-b'
const PROMOS = 'ecommerce.promotions'

let storeA: string

async function sql(query: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(query, params)).rows
}

async function svc(query: string, params: unknown[] = []): Promise<Row[]> {
  return asRole(db, 'service_role', null, () => sql(query, params))
}

/** Emitir corre con la SESIÓN: la autorización de la función mira rol y capacidad. */
async function issue(
  amount: string,
  options: { expiresAt?: string | null; email?: string | null; store?: string; tenant?: typeof TENANT_A } = {},
): Promise<Json> {
  const tenant = options.tenant ?? TENANT_A
  const rows = await asRole(db, 'authenticated', claimsFor(tenant), () =>
    sql(`select public.gift_card_issue($1, $2, $3::timestamptz, $4, null) as c`, [
      options.store ?? storeA,
      amount,
      options.expiresAt ?? null,
      options.email ?? null,
    ]),
  )
  return rows[0]?.c as Json
}

async function redeem(
  code: string,
  amount: string,
  reference: string,
  slug = STORE_A_SLUG,
): Promise<Json> {
  const rows = await svc(
    `select public.gift_card_redeem($1, $2, $3, $4, null) as r`,
    [slug, code, amount, reference],
  )
  return rows[0]?.r as Json
}

async function balance(id: string): Promise<string> {
  const [row] = await svc(`select balance::text, status from public.gift_cards where id = $1`, [id])
  return String(row?.balance)
}

async function statusOf(id: string): Promise<string> {
  const [row] = await svc(`select status from public.gift_cards where id = $1`, [id])
  return String(row?.status)
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
    await svc(
      `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
      [tenant.organizationId, tenant.companyId, [PROMOS]],
    )
  }
  await svc(`update public.stores set status = 'active'`)

  const stores = await svc(`select id, slug from public.stores order by slug`)
  storeA = String(stores.find((s) => s.slug === STORE_A_SLUG)?.id)
}, 180_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.gift_card_transactions`)
  await svc(`delete from public.gift_cards`)
})

// ===========================================================================
describe('emisión', () => {
  it('emite con saldo, moneda de la tienda y su asiento de apertura', async () => {
    const card = await issue('100.00')
    expect(card.balance).toBe('100.00')
    expect(card.currency).toBe('PEN')
    expect(String(card.code)).toMatch(/^[A-Z0-9]{24}$/)

    const movements = await svc(
      `select kind, amount::text as amount, balance_after::text as balance
         from public.gift_card_transactions where gift_card_id = $1`,
      [card.gift_card_id],
    )
    expect(movements).toEqual([{ kind: 'issue', amount: '100.00', balance: '100.00' }])
  })

  it('dos tarjetas nunca comparten código', async () => {
    const uno = await issue('10.00')
    const dos = await issue('10.00')
    expect(uno.code).not.toBe(dos.code)
  })

  it('un importe de cero o negativo no se emite', async () => {
    for (const amount of ['0', '-5.00']) {
      const message = await expectFailure(() => issue(amount))
      expect(message).toMatch(/IMPORTE_INVALIDO/)
    }
  })

  it('una tarjeta que nace caducada no sirve a nadie y se rechaza', async () => {
    const message = await expectFailure(() =>
      issue('50.00', { expiresAt: new Date(Date.now() - 86_400_000).toISOString() }),
    )
    expect(message).toMatch(/CADUCIDAD_INVALIDA/)
  })

  it('un rol que no es owner ni admin no emite', async () => {
    await svc(
      `update public.tenant_members set role = 'catalog'
        where organization_id = $1 and company_id = $2`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    try {
      const message = await expectFailure(() => issue('50.00'))
      expect(message).toMatch(/SIN_PERMISO/)
    } finally {
      await svc(
        `update public.tenant_members set role = 'admin'
          where organization_id = $1 and company_id = $2`,
        [TENANT_A.organizationId, TENANT_A.companyId],
      )
    }
  })

  it('sin el módulo contratado no se emite', async () => {
    await svc(
      `select public.sync_platform_context($1, $2, true, '{}'::text[],
              'hub'::public.entitlement_source, null)`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    try {
      const message = await expectFailure(() => issue('50.00'))
      expect(message).toMatch(/MODULO_NO_CONTRATADO/)
    } finally {
      await svc(
        `select public.sync_platform_context($1, $2, true, $3,
                'hub'::public.entitlement_source, null)`,
        [TENANT_A.organizationId, TENANT_A.companyId, [PROMOS]],
      )
    }
  })
})

// ===========================================================================
describe('el código es un secreto', () => {
  it('sale de la base UNA vez y después ninguna consulta lo devuelve', async () => {
    const card = await issue('40.00')

    // Ni con la sesión más alta: el GRANT por columna no incluye `code`.
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`select code from public.gift_cards where id = $1`, [card.gift_card_id]),
      ),
    )
    expect(message).toMatch(/permission denied/i)

    // Lo que SÍ se puede leer son los cuatro últimos.
    const visible = await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select code_last4, balance::text from public.gift_cards where id = $1`, [
        card.gift_card_id,
      ]),
    )
    expect(visible[0]?.code_last4).toBe(String(card.code).slice(-4))
  })

  it('la vista del backoffice tampoco lo expone', async () => {
    await issue('40.00')
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`select code from public.gift_card_overview`),
      ),
    )
    expect(message).toMatch(/does not exist|permission denied/i)
  })

  it('`anon` no lee ni una tarjeta ni un movimiento', async () => {
    await issue('40.00')
    for (const table of ['gift_cards', 'gift_card_transactions']) {
      const message = await expectFailure(() =>
        asRole(db, 'anon', null, () => sql(`select * from public.${table}`)),
      )
      expect(`${table}: ${message}`).toMatch(/permission denied/i)
    }
  })

  it('la consulta pública devuelve SALDO y nunca código', async () => {
    const card = await issue('40.00')
    const [row] = await asRole(db, 'anon', null, () =>
      sql(`select public.gift_card_balance_for_slug($1, $2) as b`, [
        STORE_A_SLUG,
        String(card.code),
      ]),
    )
    const result = row?.b as Json
    expect(result.found).toBe(true)
    expect(result.balance).toBe('40.00')
    expect(result.code).toBeUndefined()
    expect(result.last4).toBe(String(card.code).slice(-4))
  })

  it('no distingue "no existe" de "es de otra tienda"', async () => {
    const card = await issue('40.00')
    const [ajena] = await asRole(db, 'anon', null, () =>
      sql(`select public.gift_card_balance_for_slug($1, $2) as b`, [
        STORE_B_SLUG,
        String(card.code),
      ]),
    )
    const [inventada] = await asRole(db, 'anon', null, () =>
      sql(`select public.gift_card_balance_for_slug($1, 'NOEXISTE1234') as b`, [STORE_B_SLUG]),
    )
    expect(ajena?.b).toEqual({ found: false })
    expect(inventada?.b).toEqual({ found: false })
  })
})

// ===========================================================================
describe('el saldo se mueve, no se escribe', () => {
  it('ningún rol tiene GRANT de escritura sobre el saldo', async () => {
    const card = await issue('40.00')
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`update public.gift_cards set balance = 999 where id = $1`, [card.gift_card_id]),
      ),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('el libro mayor tampoco se escribe desde el cliente', async () => {
    const card = await issue('40.00')
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(
          `insert into public.gift_card_transactions
             (organization_id, company_id, store_id, gift_card_id, kind, amount, balance_after)
           values ($1, $2, $3, $4, 'refund', 1000, 1040)`,
          [TENANT_A.organizationId, TENANT_A.companyId, storeA, card.gift_card_id],
        ),
      ),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('canjear resta y deja el asiento con el saldo resultante', async () => {
    const card = await issue('100.00')
    const result = await redeem(String(card.code), '30.00', 'ref-1')

    expect(result.applied).toBe('30.00')
    expect(result.balance).toBe('70.00')
    expect(await balance(String(card.gift_card_id))).toBe('70.00')

    const [movement] = await svc(
      `select kind, amount::text as amount, balance_after::text as balance
         from public.gift_card_transactions
        where gift_card_id = $1 and kind = 'redeem'`,
      [card.gift_card_id],
    )
    expect(movement).toEqual({ kind: 'redeem', amount: '-30.00', balance: '70.00' })
  })

  it('pedir más de lo que hay toma SOLO el saldo, no falla', async () => {
    const card = await issue('40.00')
    const result = await redeem(String(card.code), '100.00', 'ref-parcial')
    // 40 de tarjeta y 60 por la pasarela: eso no es un error, es un pago partido.
    expect(result.applied).toBe('40.00')
    expect(result.requested).toBe('100.00')
    expect(await statusOf(String(card.gift_card_id))).toBe('depleted')
  })

  it('una tarjeta agotada no vuelve a pagar', async () => {
    const card = await issue('10.00')
    await redeem(String(card.code), '10.00', 'ref-1')
    const message = await expectFailure(() => redeem(String(card.code), '5.00', 'ref-2'))
    expect(message).toMatch(/TARJETA_NO_DISPONIBLE|SALDO_INSUFICIENTE/)
  })

  it('el canje es idempotente por referencia: un reintento no gasta dos veces', async () => {
    const card = await issue('100.00')
    const primera = await redeem(String(card.code), '30.00', 'checkout-abc')
    const reintento = await redeem(String(card.code), '30.00', 'checkout-abc')

    expect(primera.replay).toBe(false)
    expect(reintento.replay).toBe(true)
    expect(await balance(String(card.gift_card_id))).toBe('70.00')

    const [count] = await svc(
      `select count(*)::int as n from public.gift_card_transactions
        where gift_card_id = $1 and kind = 'redeem'`,
      [card.gift_card_id],
    )
    expect(count?.n).toBe(1)
  })

  it('la devolución del checkout repone el saldo y también es idempotente', async () => {
    const card = await issue('100.00')
    await redeem(String(card.code), '30.00', 'checkout-abc')

    await svc(`select public.gift_card_release($1, '30.00', 'checkout-abc:release')`, [
      card.gift_card_id,
    ])
    await svc(`select public.gift_card_release($1, '30.00', 'checkout-abc:release')`, [
      card.gift_card_id,
    ])

    expect(await balance(String(card.gift_card_id))).toBe('100.00')
    expect(await statusOf(String(card.gift_card_id))).toBe('active')
  })
})

// ===========================================================================
describe('caducidad', () => {
  it('una tarjeta vencida no paga aunque nadie haya pasado a marcarla', async () => {
    const card = await issue('50.00')
    // Se fuerza la fecha con `service_role`: el comando no deja emitirla vencida.
    await svc(`update public.gift_cards set expires_at = now() - interval '1 day' where id = $1`, [
      card.gift_card_id,
    ])

    const message = await expectFailure(() => redeem(String(card.code), '10.00', 'ref-tarde'))
    expect(message).toMatch(/TARJETA_CADUCADA/)
    // Y sigue en `active`: la garantía es el comando, no el estado guardado.
    expect(await statusOf(String(card.gift_card_id))).toBe('active')
  })

  it('la consulta pública dice `expired` aunque el estado guardado sea otro', async () => {
    const card = await issue('50.00')
    await svc(`update public.gift_cards set expires_at = now() - interval '1 day' where id = $1`, [
      card.gift_card_id,
    ])
    const [row] = await asRole(db, 'anon', null, () =>
      sql(`select public.gift_card_balance_for_slug($1, $2) as b`, [
        STORE_A_SLUG,
        String(card.code),
      ]),
    )
    expect((row?.b as Json).status).toBe('expired')
  })

  it('el cierre contable pasa el saldo caducado a su asiento', async () => {
    const card = await issue('50.00')
    await svc(`update public.gift_cards set expires_at = now() - interval '1 day' where id = $1`, [
      card.gift_card_id,
    ])

    const [result] = await svc(`select public.expire_gift_cards($1) as n`, [storeA])
    expect(result?.n).toBe(1)
    expect(await balance(String(card.gift_card_id))).toBe('0.00')
    expect(await statusOf(String(card.gift_card_id))).toBe('expired')

    const [movement] = await svc(
      `select amount::text as amount from public.gift_card_transactions
        where gift_card_id = $1 and kind = 'expire'`,
      [card.gift_card_id],
    )
    expect(movement?.amount).toBe('-50.00')
  })
})

// ===========================================================================
describe('ajuste y anulación', () => {
  it('un ajuste sin motivo no es auditable y se rechaza', async () => {
    const card = await issue('50.00')
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`select public.gift_card_adjust($1, '10.00', '')`, [card.gift_card_id]),
      ),
    )
    expect(message).toMatch(/MOTIVO_REQUERIDO/)
  })

  it('un ajuste con motivo mueve el saldo y queda anotado con su actor', async () => {
    const card = await issue('50.00')
    await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.gift_card_adjust($1, '25.00', 'compensacion por incidencia')`, [
        card.gift_card_id,
      ]),
    )
    expect(await balance(String(card.gift_card_id))).toBe('75.00')

    const [movement] = await svc(
      `select kind, actor_email from public.gift_card_transactions
        where gift_card_id = $1 and kind = 'adjust'`,
      [card.gift_card_id],
    )
    expect(movement?.actor_email).toBe(TENANT_A.adminEmail)
  })

  it('un ajuste no puede dejar la tarjeta en negativo', async () => {
    const card = await issue('20.00')
    const message = await expectFailure(() =>
      asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
        sql(`select public.gift_card_adjust($1, '-50.00', 'retirada por error')`, [
          card.gift_card_id,
        ]),
      ),
    )
    expect(message).toMatch(/SALDO_INSUFICIENTE/)
  })

  it('anular retira el saldo, lo deja escrito y la tarjeta deja de pagar', async () => {
    const card = await issue('60.00')
    await asRole(db, 'authenticated', claimsFor(TENANT_A), () =>
      sql(`select public.gift_card_cancel($1, 'emitida por error')`, [card.gift_card_id]),
    )
    expect(await balance(String(card.gift_card_id))).toBe('0.00')
    expect(await statusOf(String(card.gift_card_id))).toBe('cancelled')

    const message = await expectFailure(() => redeem(String(card.code), '5.00', 'ref-post'))
    expect(message).toMatch(/TARJETA_NO_DISPONIBLE/)
  })
})

// ===========================================================================
describe('cancelar el pedido', () => {
  /**
   * Compra real en QAS (2026-11-12): un pedido pagado en parte con tarjeta
   * regalo se cancelaba y la tarjeta seguía gastada.
   */
  it('devuelve a la tarjeta lo que el pedido gastó, una sola vez', async () => {
    const card = await issue('30.00')
    const id = String(card.gift_card_id)
    await redeem(String(card.code), '30.00', 'intento-1:gc:0')
    expect(await statusOf(id)).toBe('depleted')

    const [channel] = await svc(`select id from public.channels where store_id = $1 and is_default`, [storeA])
    const [order] = await svc(
      `insert into public.orders
         (organization_id, company_id, store_id, channel_id, order_number, status,
          currency, customer_email, subtotal, discount_total, tax_total, grand_total)
       values ($1, $2, $3, $4, 'GC-0001', 'pending', 'PEN', 'ana@compradora.com',
               '50.00', '0.00', '0.00', '50.00')
       returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, channel?.id],
    )
    await svc(`select public.gift_card_attach_order($1, 'intento-1:gc:0', $2)`, [id, order?.id])

    await svc(`update public.orders set status = 'cancelled' where id = $1`, [order?.id])
    expect(await balance(id)).toBe('30.00')
    expect(await statusOf(id)).toBe('active')

    // Cancelado es final; volver a escribirlo no devuelve otra vez.
    await svc(`update public.orders set status = 'cancelled' where id = $1`, [order?.id])
    expect(await balance(id)).toBe('30.00')

    const movimientos = await svc(
      `select kind::text, amount::text from public.gift_card_transactions
        where gift_card_id = $1 order by created_at, kind`,
      [id],
    )
    expect(movimientos.map((m) => m.kind)).toEqual(['issue', 'redeem', 'refund'])
  })
})

// ===========================================================================
describe('aislamiento', () => {
  it('el código de A no se puede canjear en la tienda de B', async () => {
    const card = await issue('50.00')
    const message = await expectFailure(() =>
      redeem(String(card.code), '10.00', 'ref-cruzada', STORE_B_SLUG),
    )
    expect(message).toMatch(/TARJETA_NO_ENCONTRADA/)
  })

  it('un miembro de B no ve ni una tarjeta de A', async () => {
    await issue('50.00')
    const rows = await asRole(db, 'authenticated', claimsFor(TENANT_B), () =>
      sql(`select id from public.gift_cards`),
    )
    expect(rows).toEqual([])
  })

  /**
   * Las cuatro puertas del SERVIDOR viven en `public` y no en `ebim`, y no es
   * una preferencia de estilo: PostgREST solo expone `public`, asi que una
   * funcion de servidor en `ebim` es una funcion que el borde no puede llamar
   * — y el canje de la etapa 8a del checkout se quedaria sin atar al pedido sin
   * que nada fallara a la vista.
   */
  it('las puertas del servidor son alcanzables por el borde y solo por el', async () => {
    const expuestas = await svc(`
      select p.proname as name,
             has_function_privilege('service_role', p.oid, 'EXECUTE')  as servidor,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as sesion,
             has_function_privilege('anon', p.oid, 'EXECUTE')          as anonimo
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('gift_card_redeem', 'gift_card_release',
                           'gift_card_attach_order', 'expire_gift_cards')
       order by p.proname
    `)
    expect(expuestas.map((row) => row.name)).toEqual([
      'expire_gift_cards', 'gift_card_attach_order', 'gift_card_redeem', 'gift_card_release',
    ])
    for (const row of expuestas) {
      expect(`${row.name}: servidor=${row.servidor} sesion=${row.sesion} anon=${row.anonimo}`).toBe(
        `${row.name}: servidor=true sesion=false anon=false`,
      )
    }
  })

  it('ni `anon` ni `authenticated` pueden canjear: el canje es del servidor', async () => {
    const card = await issue('50.00')
    for (const role of ['anon', 'authenticated'] as const) {
      const message = await expectFailure(() =>
        asRole(db, role, role === 'anon' ? null : claimsFor(TENANT_A), () =>
          sql(`select public.gift_card_redeem($1, $2, '10.00', 'x', null)`, [
            STORE_A_SLUG,
            String(card.code),
          ]),
        ),
      )
      expect(`${role}: ${message}`).toMatch(/permission denied/i)
    }
  })
})
