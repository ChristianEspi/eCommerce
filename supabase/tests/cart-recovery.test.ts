// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  asRole,
  claimsFor,
  createTestDatabase,
  expectFailure,
  TENANT_A,
  TENANT_B,
  type JwtClaims,
} from './harness'
/**
 * Recuperación de carritos abandonados (cierre, ítem 8).
 *
 * Diseño en `supabase/migrations/20260914160000_cart_recovery.sql`. Lo que se
 * fija aquí, en orden de lo que más caro sale romper:
 *
 *  1. **A quién se escribe**: solo a un comprador con sesión, con líneas, dentro
 *     de la ventana y en una tienda que lo encendió. Al invitado, nunca.
 *  2. **Cuándo NO**: convertido, fusionado, vaciado, compra posterior, baja.
 *     Y se vuelve a mirar en el MOMENTO DE ENVIAR, no solo al encolar.
 *  3. **Una vez por episodio**: correr el trabajo dos veces no duplica.
 *  4. **La baja**: el secreto del correo solo da de baja a su destinatario.
 *  5. **Tenant y rol**: el trabajo es de servidor; los números, de owner/admin
 *     de ESA sociedad.
 */

type Row = Record<string, unknown>

let db: PGlite
let storeA = ''
let channelA = ''
let productA = ''
let storeB = ''
let channelB = ''
let productB = ''
let seq = 0
async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(query, params)).rows
}
async function asService<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, () => svc<T>(query, params))
}
async function asAnon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, () => svc<T>(query, params))
}
async function asUser<T = Row>(claims: JwtClaims, query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'authenticated', claims, () => svc<T>(query, params))
}

const comprador = (sub: string, email: string) => ({ sub, email }) as unknown as JwtClaims

type Tenant = typeof TENANT_A

function ctx(tenant: Tenant) {
  return tenant === TENANT_A
    ? { store: storeA, channel: channelA, product: productA }
    : { store: storeB, channel: channelB, product: productB }
}

async function nuevoUsuario(email?: string): Promise<{ id: string; email: string }> {
  seq += 1
  const correo = email ?? `comprador${seq}@cliente.com`
  const filas = await svc<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [correo],
  )
  return { id: String(filas[0]?.id), email: correo }
}

async function carrito(input: {
  user?: string | null
  tenant?: Tenant
  horas?: number
  lineas?: boolean
  status?: 'active' | 'abandoned'
}): Promise<string> {
  const tenant = input.tenant ?? TENANT_A
  const c = ctx(tenant)
  const filas = await svc<{ id: string }>(
    `insert into public.carts
       (organization_id, company_id, store_id, channel_id, user_id, currency, status, last_activity_at)
     values ($1, $2, $3, $4, $5, 'PEN', $6::public.cart_status, now() - make_interval(hours => $7))
     returning id`,
    [
      tenant.organizationId, tenant.companyId, c.store, c.channel,
      input.user ?? null, input.status ?? 'active', input.horas ?? 5,
    ],
  )
  const id = String(filas[0]?.id)
  if (input.lineas ?? true) {
    await svc(
      `insert into public.cart_items (organization_id, company_id, store_id, cart_id, product_id, quantity)
       values ($1, $2, $3, $4, $5, 2)`,
      [tenant.organizationId, tenant.companyId, c.store, id, c.product],
    )
  }
  return id
}

async function pedido(
  email: string,
  input: { tenant?: Tenant; horas?: number; status?: string } = {},
): Promise<string> {
  const tenant = input.tenant ?? TENANT_A
  const c = ctx(tenant)
  seq += 1
  const filas = await svc<{ id: string }>(
    `insert into public.orders (
       organization_id, company_id, store_id, channel_id, order_number,
       customer_email, currency, subtotal, tax_total, grand_total, status, placed_at)
     values ($1, $2, $3, $4, $5, $6, 'PEN', 100, 0, 100, $7::public.order_status,
             now() - make_interval(hours => $8))
     returning id`,
    [
      tenant.organizationId, tenant.companyId, c.store, c.channel,
      `CR-${String(seq).padStart(5, '0')}`, email, input.status ?? 'pending', input.horas ?? 0,
    ],
  )
  return String(filas[0]?.id)
}

async function encender(tenant: Tenant = TENANT_A, delay = 4, maxDays = 7) {
  await svc(
    `update public.store_settings
        set cart_recovery_enabled = true, cart_recovery_delay_hours = $2, cart_recovery_max_age_days = $3
      where store_id = $1`,
    [ctx(tenant).store, delay, maxDays],
  )
}

async function encolar(limit = 100): Promise<{ queued: number; suppressed: number }> {
  const filas = await asService<{ r: { queued: number; suppressed: number } }>(
    `select ebim.enqueue_cart_recovery($1) as r`,
    [limit],
  )
  return filas[0]!.r
}

type Correo = {
  id: string
  kind: string
  to_address: string
  status: string
  params: Record<string, unknown>
  last_error: string | null
}

async function correos(filtro = 'true'): Promise<Correo[]> {
  return svc<Correo>(
    `select id, kind, to_address, status, params, last_error from public.notification_emails
      where kind = 'cart.recovery' and ${filtro} order by created_at`,
  )
}

type Registro = {
  cart_id: string
  user_id: string
  status: string
  suppressed_reason: string | null
  email_id: string | null
}

async function registros(cartId?: string): Promise<Registro[]> {
  return svc<Registro>(
    `select cart_id, user_id, status, suppressed_reason, email_id
       from public.cart_recovery_reminders
      where ($1::uuid is null or cart_id = $1::uuid)
      order by created_at`,
    [cartId ?? null],
  )
}

async function reclamar(): Promise<Array<{ id: string; kind: string; params: Record<string, unknown> }>> {
  return asService(`select id, kind, params from public.notification_email_claim(50)`)
}
beforeAll(async () => {
  db = await createTestDatabase()

  for (const tenant of [TENANT_A, TENANT_B]) {
    await svc(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [
      tenant.ownerId, tenant.adminEmail,
    ])
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
      tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
    ])
  }
  await svc(`update public.stores set status = 'active'`)

  const stores = await svc<{ id: string; organization_id: string }>(
    `select id, organization_id from public.stores`,
  )
  storeA = String(stores.find((s) => s.organization_id === TENANT_A.organizationId)?.id)
  storeB = String(stores.find((s) => s.organization_id === TENANT_B.organizationId)?.id)
  const channels = await svc<{ id: string; store_id: string }>(
    `select id, store_id from public.channels where is_default`,
  )
  channelA = String(channels.find((c) => c.store_id === storeA)?.id)
  channelB = String(channels.find((c) => c.store_id === storeB)?.id)

  const insertarProducto = async (tenant: Tenant, store: string) => {
    const filas = await svc<{ id: string }>(
      `insert into public.products
         (organization_id, company_id, store_id, sku, slug, name, price, currency, stock, status, published_at)
       values ($1, $2, $3, 'CR-SILLA', 'silla', 'Silla', '100.00', 'PEN', 50, 'published', now())
       returning id`,
      [tenant.organizationId, tenant.companyId, store],
    )
    return String(filas[0]?.id)
  }
  productA = await insertarProducto(TENANT_A, storeA)
  productB = await insertarProducto(TENANT_B, storeB)
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.cart_recovery_reminders`)
  await svc(`delete from public.cart_recovery_opt_outs`)
  await svc(`delete from public.notification_emails`)
  await svc(`delete from public.carts`)
  await svc(
    `update public.store_settings
        set cart_recovery_enabled = false, cart_recovery_delay_hours = 4, cart_recovery_max_age_days = 7`,
  )
  await svc(`update public.stores set status = 'active'`)
})

// ---------------------------------------------------------------------------
// 1. Elegibilidad
// ---------------------------------------------------------------------------

describe('a quién se le escribe', () => {
  it('con el ajuste APAGADO (el valor por defecto) no se encola nada', async () => {
    const u = await nuevoUsuario()
    await carrito({ user: u.id })

    const [ajuste] = await svc<{ cart_recovery_enabled: boolean }>(
      `select cart_recovery_enabled from public.store_settings where store_id = $1`, [storeA],
    )
    expect(ajuste?.cart_recovery_enabled).toBe(false)
    expect(await encolar()).toEqual({ queued: 0, suppressed: 0 })
    expect(await correos()).toEqual([])
    expect(await registros()).toEqual([])
  })

  it('un comprador con sesión, con líneas y quieto 5 h recibe UN correo cart.recovery', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })

    expect(await encolar()).toEqual({ queued: 1, suppressed: 0 })

    const lista = await correos()
    expect(lista).toHaveLength(1)
    const correo = lista[0]!
    expect(correo.to_address).toBe(u.email)
    expect(correo.status).toBe('pending')
    expect(correo.params.store_slug).toBe(TENANT_A.storeSlug)
    expect(correo.params.line_count).toBe(1)
    expect(String(correo.params.unsubscribe_token)).toMatch(/^[0-9a-f]{64}$/)
    // Sin precios ni productos: el correo enlaza, no copia.
    expect(Object.keys(correo.params).sort()).toEqual(
      ['line_count', 'store_name', 'store_slug', 'unsubscribe_token'].sort(),
    )

    const [registro] = await registros(cart)
    expect(registro).toMatchObject({ status: 'queued', suppressed_reason: null, email_id: correo.id, user_id: u.id })
  })

  it('un carrito ya marcado `abandoned` también es elegible', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id, status: 'abandoned' })
    expect((await encolar()).queued).toBe(1)
  })

  it('dentro de la ventana de espera todavía no', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id, horas: 1 })
    expect(await encolar()).toEqual({ queued: 0, suppressed: 0 })
  })

  it('la ventana es la de la tienda', async () => {
    await encender(TENANT_A, 12)
    const u = await nuevoUsuario()
    await carrito({ user: u.id, horas: 5 })
    expect((await encolar()).queued).toBe(0)
  })

  it('pasada la edad máxima, ya no', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id, horas: 24 * 8 })
    expect(await encolar()).toEqual({ queued: 0, suppressed: 0 })
  })

  it('al invitado NUNCA: no hay contacto ni consentimiento', async () => {
    await encender()
    await carrito({ user: null })
    expect(await encolar()).toEqual({ queued: 0, suppressed: 0 })
    expect(await registros()).toEqual([])
  })

  it('un carrito sin líneas no es un abandono', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id, lineas: false })
    expect(await encolar()).toEqual({ queued: 0, suppressed: 0 })
  })

  it('una tienda inactiva no escribe aunque tenga el ajuste encendido', async () => {
    await encender()
    await svc(`update public.stores set status = 'draft' where id = $1`, [storeA])
    const u = await nuevoUsuario()
    await carrito({ user: u.id })
    expect((await encolar()).queued).toBe(0)
  })

  it('una dirección de la suite no es destinataria de negocio', async () => {
    await encender()
    const u = await nuevoUsuario(`suite${Date.now()}@ebim.pe`)
    const cart = await carrito({ user: u.id })
    expect((await encolar()).queued).toBe(0)
    expect(await correos()).toEqual([])
    expect((await registros(cart))[0]?.suppressed_reason).toBe('no_contact')
  })

  it('el lote respeta el límite', async () => {
    await encender()
    for (let i = 0; i < 3; i += 1) await carrito({ user: (await nuevoUsuario()).id })
    expect((await encolar(2)).queued).toBe(2)
    expect((await encolar(2)).queued).toBe(1)
  })
})
// ---------------------------------------------------------------------------
// 2. Idempotencia
// ---------------------------------------------------------------------------

describe('una vez por episodio de abandono', () => {
  it('correr el trabajo dos veces encola UN correo', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })

    expect((await encolar()).queued).toBe(1)
    expect(await encolar()).toEqual({ queued: 0, suppressed: 0 })
    expect(await correos()).toHaveLength(1)
    expect(await registros(cart)).toHaveLength(1)
  })

  it('si el carrito se mueve y vuelve a quedarse quieto, es un episodio nuevo', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id, horas: 30 })
    expect((await encolar()).queued).toBe(1)

    await svc(`update public.carts set last_activity_at = now() - interval '6 hours' where id = $1`, [cart])
    expect((await encolar()).queued).toBe(1)
    expect(await correos()).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 3. Supresión al encolar
// ---------------------------------------------------------------------------

describe('cuándo NO se escribe', () => {
  it('un carrito convertido en pedido no se recuerda', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })
    const order = await pedido(u.email, { horas: 6 })
    await svc(`update public.carts set status = 'converted', order_id = $2 where id = $1`, [cart, order])

    expect((await encolar()).queued).toBe(0)
    expect(await correos()).toEqual([])
  })

  it('un carrito fusionado tampoco', async () => {
    await encender()
    const u = await nuevoUsuario()
    const otro = await nuevoUsuario()
    const destino = await carrito({ user: otro.id, horas: 1 })
    const origen = await carrito({ user: u.id, horas: 5, status: 'abandoned' })
    await svc(`update public.carts set status = 'merged', merged_into = $2 where id = $1`, [origen, destino])

    expect(await encolar()).toEqual({ queued: 0, suppressed: 0 })
    expect(await correos()).toEqual([])
  })

  it('si compró en la tienda DESPUÉS de la última actividad, se suprime con motivo', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id, horas: 5 })
    await pedido(u.email, { horas: 1 })

    expect(await encolar()).toEqual({ queued: 0, suppressed: 1 })
    expect(await correos()).toEqual([])
    expect((await registros(cart))[0]).toMatchObject({ status: 'suppressed', suppressed_reason: 'ordered' })
  })

  it('un pedido ANTERIOR al carrito no lo suprime, y uno cancelado tampoco', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id, horas: 5 })
    await pedido(u.email, { horas: 10 })
    await pedido(u.email, { horas: 1, status: 'cancelled' })
    expect((await encolar()).queued).toBe(1)
  })

  it('un pedido con el mismo correo en OTRA tienda no suprime', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id, horas: 5 })
    await pedido(u.email, { horas: 1, tenant: TENANT_B })
    expect((await encolar()).queued).toBe(1)
  })

  it('el vínculo verificado del checkout también cuenta como compra', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id, horas: 5 })
    const order = await pedido('otro-correo@cliente.com', { horas: 1 })
    await asService(`select public.checkout_link_order_buyer($1, $2)`, [order, u.id])

    expect((await encolar()).queued).toBe(0)
    expect((await registros(cart))[0]?.suppressed_reason).toBe('ordered')
  })

  it('quien se dio de baja no recibe nada', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })
    await asUser(comprador(u.id, u.email), `select public.set_my_cart_reminders($1, false)`, [TENANT_A.storeSlug])

    expect(await encolar()).toEqual({ queued: 0, suppressed: 1 })
    expect((await registros(cart))[0]?.suppressed_reason).toBe('opted_out')
  })

  it('si tiene un carrito más reciente en la tienda, el viejo no se recuerda', async () => {
    await encender()
    const u = await nuevoUsuario()
    const viejo = await carrito({ user: u.id, horas: 30, status: 'abandoned' })
    await carrito({ user: u.id, horas: 5 })

    expect(await encolar()).toEqual({ queued: 1, suppressed: 1 })
    expect((await registros(viejo))[0]?.suppressed_reason).toBe('superseded')
  })
})
// ---------------------------------------------------------------------------
// 4. La comprobación en el momento de enviar
// ---------------------------------------------------------------------------

describe('se vuelve a mirar al ENVIAR', () => {
  it('una compra entre el encolado y el envío suprime el correo', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })
    await encolar()

    await pedido(u.email)
    const reclamados = await reclamar()

    expect(reclamados.filter((r) => r.kind === 'cart.recovery')).toEqual([])
    const [correo] = await correos()
    expect(correo).toMatchObject({ status: 'expired', last_error: 'SUPRIMIDO' })
    expect(correo?.params).not.toHaveProperty('unsubscribe_token')
    expect((await registros(cart))[0]).toMatchObject({ status: 'suppressed', suppressed_reason: 'ordered' })
  })

  it('un carrito que se convirtió o se vació después de encolar tampoco sale', async () => {
    await encender()
    const u1 = await nuevoUsuario()
    const u2 = await nuevoUsuario()
    const convertido = await carrito({ user: u1.id })
    const vaciado = await carrito({ user: u2.id })
    await encolar()

    const order = await pedido('tercero@cliente.com', { horas: 10 })
    await svc(`update public.carts set status = 'converted', order_id = $2 where id = $1`, [convertido, order])
    await svc(`delete from public.cart_items where cart_id = $1`, [vaciado])

    expect((await reclamar()).filter((r) => r.kind === 'cart.recovery')).toEqual([])
    expect((await registros(convertido))[0]?.suppressed_reason).toBe('converted')
    expect((await registros(vaciado))[0]?.suppressed_reason).toBe('emptied')
  })

  it('si el comprador volvió a la tienda, el recordatorio de ese episodio no sale', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })
    await encolar()
    await svc(`update public.carts set last_activity_at = now() where id = $1`, [cart])

    expect((await reclamar()).filter((r) => r.kind === 'cart.recovery')).toEqual([])
    expect((await registros(cart))[0]?.suppressed_reason).toBe('activity')
  })

  it('si la tienda apaga el ajuste, lo encolado no sale', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })
    await encolar()
    await svc(`update public.store_settings set cart_recovery_enabled = false where store_id = $1`, [storeA])

    expect((await reclamar()).filter((r) => r.kind === 'cart.recovery')).toEqual([])
    expect((await registros(cart))[0]?.suppressed_reason).toBe('disabled')
  })

  it('lo que sigue valiendo se reclama, y al terminar se borra el secreto de la cola', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id })
    await encolar()

    const reclamados = (await reclamar()).filter((r) => r.kind === 'cart.recovery')
    expect(reclamados).toHaveLength(1)
    expect(String(reclamados[0]!.params.unsubscribe_token)).toMatch(/^[0-9a-f]{64}$/)

    await asService(`select public.notification_email_complete($1, 'ref-1')`, [reclamados[0]!.id])
    const [correo] = await correos()
    expect(correo?.status).toBe('sent')
    expect(correo?.params).not.toHaveProperty('unsubscribe_token')
    expect(correo?.params.store_slug).toBe(TENANT_A.storeSlug)
  })

  it('si la guarda falla, no sale ningún recordatorio y el resto sí', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })
    await encolar()
    await pedido(u.email)
    await svc(
      `insert into public.notification_emails (organization_id, company_id, kind, to_address, dedupe_key)
       values ($1, $2, 'mail.test', 'otro@cliente.com', $3)`,
      [TENANT_A.organizationId, TENANT_A.companyId, `prueba:${Date.now()}`],
    )

    // Se rompe a propósito la escritura de la supresión para que la guarda falle.
    await svc(`alter table public.cart_recovery_reminders add constraint romper check (false) not valid`)
    let reclamados: Array<{ kind: string }> = []
    try {
      reclamados = await reclamar()
    } finally {
      await svc(`alter table public.cart_recovery_reminders drop constraint romper`)
    }

    expect(reclamados.map((r) => r.kind)).toEqual(['mail.test'])
    expect((await correos())[0]?.status).toBe('pending')
    expect((await registros(cart))[0]?.status).toBe('queued')
  })
})
// ---------------------------------------------------------------------------
// 5. La baja
// ---------------------------------------------------------------------------

describe('la baja de un clic', () => {
  async function tokenDe(email: string): Promise<string> {
    const lista = await correos(`to_address = '${email}'`)
    return String(lista[0]?.params.unsubscribe_token)
  }

  it('el secreto del correo da de baja a SU destinatario en SU tienda, sin sesión', async () => {
    await encender()
    const u = await nuevoUsuario()
    const otro = await nuevoUsuario()
    await carrito({ user: u.id })
    const cartOtro = await carrito({ user: otro.id })
    await encolar()

    const token = await tokenDe(u.email)
    const [r] = await asAnon<{ r: { unsubscribed: boolean } }>(
      `select public.cart_recovery_unsubscribe($1) as r`, [token],
    )
    expect(r?.r).toEqual({ unsubscribed: true })

    const bajas = await svc<{ user_id: string; store_id: string; source: string }>(
      `select user_id, store_id, source from public.cart_recovery_opt_outs`,
    )
    expect(bajas).toEqual([{ user_id: u.id, store_id: storeA, source: 'email_link' }])

    // Lo suyo que estaba en la cola se suprime al momento; lo del otro, no.
    expect((await correos(`to_address = '${u.email}'`))[0]?.status).toBe('expired')
    expect((await registros(cartOtro))[0]?.status).toBe('queued')
    expect((await correos(`to_address = '${otro.email}'`))[0]?.status).toBe('pending')
  })

  it('repetir la baja no falla ni duplica', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id })
    await encolar()
    const token = await tokenDe(u.email)
    await asAnon(`select public.cart_recovery_unsubscribe($1)`, [token])
    const [r] = await asAnon<{ r: { unsubscribed: boolean } }>(
      `select public.cart_recovery_unsubscribe($1) as r`, [token],
    )
    expect(r?.r.unsubscribed).toBe(true)
    expect(await svc(`select 1 from public.cart_recovery_opt_outs`)).toHaveLength(1)
  })

  it('un secreto inventado, mal formado o vacío no da de baja a nadie', async () => {
    await encender()
    const u = await nuevoUsuario()
    await carrito({ user: u.id })
    await encolar()

    for (const token of ['a'.repeat(64), 'no-es-un-secreto', '', `${'0'.repeat(63)}g`]) {
      const [r] = await asAnon<{ r: { unsubscribed: boolean } }>(
        `select public.cart_recovery_unsubscribe($1) as r`, [token],
      )
      expect(r?.r).toEqual({ unsubscribed: false })
    }
    expect(await svc(`select 1 from public.cart_recovery_opt_outs`)).toEqual([])
  })

  it('el secreto no se guarda en claro: la base solo tiene su sha256', async () => {
    await encender()
    const u = await nuevoUsuario()
    const cart = await carrito({ user: u.id })
    await encolar()
    const token = await tokenDe(u.email)

    const [fila] = await svc<{ unsubscribe_token_hash: string }>(
      `select unsubscribe_token_hash from public.cart_recovery_reminders where cart_id = $1`, [cart],
    )
    expect(fila?.unsubscribe_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(fila?.unsubscribe_token_hash).not.toBe(token)

    // Y quien administra no puede leer ni el hash.
    const error = await expectFailure(() =>
      asUser(claimsFor(TENANT_A), `select unsubscribe_token_hash from public.cart_recovery_reminders`),
    )
    expect(error).toMatch(/permission denied/i)
  })

  it('anon no puede leer ni escribir las tablas directamente', async () => {
    for (const tabla of ['cart_recovery_reminders', 'cart_recovery_opt_outs']) {
      expect(await expectFailure(() => asAnon(`select * from public.${tabla}`))).toMatch(/permission denied/i)
    }
    const u = await nuevoUsuario()
    const error = await expectFailure(() =>
      asUser(
        comprador(u.id, u.email),
        `insert into public.cart_recovery_opt_outs (organization_id, company_id, store_id, user_id, source)
         values ($1, $2, $3, $4, 'account')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA, u.id],
      ),
    )
    expect(error).toMatch(/permission denied/i)
  })
})

describe('la preferencia desde «Tu cuenta»', () => {
  it('el comprador ve y cambia SU preferencia, y puede volver a darse de alta', async () => {
    await encender()
    const u = await nuevoUsuario()
    const yo = comprador(u.id, u.email)

    const [antes] = await asUser<{ r: unknown }>(yo, `select public.my_cart_reminders($1) as r`, [TENANT_A.storeSlug])
    expect(antes?.r).toEqual({ store_enabled: true, receive: true })

    const [baja] = await asUser<{ r: unknown }>(yo, `select public.set_my_cart_reminders($1, false) as r`, [TENANT_A.storeSlug])
    expect(baja?.r).toEqual({ store_enabled: true, receive: false })
    const propias = await asUser<{ user_id: string }>(yo, `select user_id from public.cart_recovery_opt_outs`)
    expect(propias).toEqual([{ user_id: u.id }])

    const [alta] = await asUser<{ r: unknown }>(yo, `select public.set_my_cart_reminders($1, true) as r`, [TENANT_A.storeSlug])
    expect(alta?.r).toEqual({ store_enabled: true, receive: true })
  })

  it('nadie ve las bajas de otro', async () => {
    const u = await nuevoUsuario()
    const otro = await nuevoUsuario()
    await asUser(comprador(u.id, u.email), `select public.set_my_cart_reminders($1, false)`, [TENANT_A.storeSlug])
    expect(await asUser(comprador(otro.id, otro.email), `select * from public.cart_recovery_opt_outs`)).toEqual([])
    // Tampoco quien administra la tienda: la baja es de la persona.
    expect(await asUser(claimsFor(TENANT_A), `select * from public.cart_recovery_opt_outs`)).toEqual([])
  })

  it('sin sesión no hay preferencia que leer ni cambiar', async () => {
    for (const q of [
      `select public.my_cart_reminders('${TENANT_A.storeSlug}')`,
      `select public.set_my_cart_reminders('${TENANT_A.storeSlug}', false)`,
    ]) {
      expect(await expectFailure(() => asAnon(q))).toMatch(/permission denied/i)
    }
  })
})
// ---------------------------------------------------------------------------
// 6. Servidor, tenant y rol
// ---------------------------------------------------------------------------

describe('el trabajo es de servidor', () => {
  it('ni anon ni authenticated pueden ejecutar el encolado; service_role sí', async () => {
    for (const run of [
      () => asAnon(`select ebim.enqueue_cart_recovery(10)`),
      () => asUser(claimsFor(TENANT_A), `select ebim.enqueue_cart_recovery(10)`),
    ]) {
      expect(await expectFailure(run)).toMatch(/permission denied/i)
    }
    await expect(asService(`select ebim.enqueue_cart_recovery(10)`)).resolves.toHaveLength(1)
  })

  it('las piezas internas no las alcanza el cliente', async () => {
    const filas = await svc<{ name: string; role: string }>(`
      select p.proname as name, roles.rolname as role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) as roles(rolname)
      join pg_roles r on r.rolname = roles.rolname
      where n.nspname = 'ebim'
        and p.proname in ('enqueue_cart_recovery', 'cart_recovery_block_reason',
                          'cart_recovery_suppress_reminder', 'cart_recovery_suppress_user',
                          'cart_recovery_guard_queue')
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')
    `)
    expect(filas).toEqual([])
  })

  it('reclamar la cola sigue siendo solo de service_role', async () => {
    expect(await expectFailure(() => asUser(claimsFor(TENANT_A), `select * from public.notification_email_claim(1)`)))
      .toMatch(/permission denied/i)
  })
})

describe('aislamiento entre sociedades', () => {
  it('el trabajo encola cada carrito en SU sociedad y con la marca de SU tienda', async () => {
    await encender(TENANT_A)
    await encender(TENANT_B)
    const a = await nuevoUsuario()
    const b = await nuevoUsuario()
    await carrito({ user: a.id, tenant: TENANT_A })
    await carrito({ user: b.id, tenant: TENANT_B })
    await encolar()

    const filas = await svc<{ organization_id: string; to_address: string; slug: string }>(
      `select organization_id, to_address, params->>'store_slug' as slug
         from public.notification_emails where kind = 'cart.recovery' order by to_address`,
    )
    expect(filas).toEqual(
      [
        { organization_id: TENANT_A.organizationId, to_address: a.email, slug: TENANT_A.storeSlug },
        { organization_id: TENANT_B.organizationId, to_address: b.email, slug: TENANT_B.storeSlug },
      ].sort((x, y) => x.to_address.localeCompare(y.to_address)),
    )
  })

  it('una tienda encendida no hace escribir a otra apagada', async () => {
    await encender(TENANT_A)
    const b = await nuevoUsuario()
    await carrito({ user: b.id, tenant: TENANT_B })
    expect((await encolar()).queued).toBe(0)
  })

  it('el administrador ve los registros de SU sociedad y no los de otra', async () => {
    await encender(TENANT_A)
    await encender(TENANT_B)
    await carrito({ user: (await nuevoUsuario()).id, tenant: TENANT_A })
    await carrito({ user: (await nuevoUsuario()).id, tenant: TENANT_B })
    await encolar()

    const vistos = await asUser<{ organization_id: string }>(
      claimsFor(TENANT_A),
      `select organization_id from public.cart_recovery_reminders`,
    )
    expect(vistos.map((v) => v.organization_id)).toEqual([TENANT_A.organizationId])
  })

  it('el resumen y el ajuste de una tienda ajena se niegan', async () => {
    expect(await expectFailure(() =>
      asUser(claimsFor(TENANT_A), `select public.cart_recovery_overview($1)`, [storeB]),
    )).toMatch(/SIN_PERMISO/)
    expect(await expectFailure(() =>
      asUser(claimsFor(TENANT_A), `select public.cart_recovery_configure($1, true, 4, 7)`, [storeB]),
    )).toMatch(/SIN_PERMISO/)

    const [ajeno] = await svc<{ cart_recovery_enabled: boolean }>(
      `select cart_recovery_enabled from public.store_settings where store_id = $1`, [storeB],
    )
    expect(ajeno?.cart_recovery_enabled).toBe(false)
  })

  it('un comprador sin rol en la sociedad tampoco ve el resumen', async () => {
    const u = await nuevoUsuario()
    expect(await expectFailure(() =>
      asUser(comprador(u.id, u.email), `select public.cart_recovery_overview($1)`, [storeA]),
    )).toMatch(/SIN_PERMISO/)
  })
})

describe('el ajuste y los números en Configuración', () => {
  it('el propietario enciende, ajusta la ventana y ve los números', async () => {
    const [r] = await asUser<{ r: Record<string, unknown> }>(
      claimsFor(TENANT_A),
      `select public.cart_recovery_configure($1, true, 6, 10) as r`,
      [storeA],
    )
    expect(r?.r).toMatchObject({ enabled: true, delay_hours: 6, max_age_days: 10, window_days: 30 })

    const enviado = await nuevoUsuario()
    const fallido = await nuevoUsuario()
    const comprado = await nuevoUsuario()
    await carrito({ user: enviado.id, horas: 7 })
    await carrito({ user: fallido.id, horas: 7 })
    await carrito({ user: comprado.id, horas: 7 })
    await pedido(comprado.email, { horas: 1 })
    await encolar()

    const reclamados = (await reclamar()).filter((x) => x.kind === 'cart.recovery')
    expect(reclamados).toHaveLength(2)
    const destino = await svc<{ id: string; to_address: string }>(
      `select id, to_address from public.notification_emails where kind = 'cart.recovery'`,
    )
    const idDe = (email: string) => destino.find((d) => d.to_address === email)!.id
    await asService(`select public.notification_email_complete($1, 'ref')`, [idDe(enviado.email)])
    await asService(`select public.notification_email_fail($1, 'GRAPH_400', false)`, [idDe(fallido.email)])
    await asUser(comprador(fallido.id, fallido.email), `select public.set_my_cart_reminders($1, false)`, [TENANT_A.storeSlug])

    const [resumen] = await asUser<{ r: { counts: Record<string, number>; opted_out: number } }>(
      claimsFor(TENANT_A),
      `select public.cart_recovery_overview($1) as r`,
      [storeA],
    )
    expect(resumen?.r.counts).toEqual({ queued: 0, sent: 1, failed: 1, expired: 0, suppressed: 1 })
    expect(resumen?.r.opted_out).toBe(1)
  })

  it('una ventana fuera de rango se rechaza', async () => {
    for (const [delay, dias] of [[0, 7], [73, 7], [4, 0], [4, 31], [48, 2]] as const) {
      expect(await expectFailure(() =>
        asUser(claimsFor(TENANT_A), `select public.cart_recovery_configure($1, true, $2, $3)`, [storeA, delay, dias]),
      )).toMatch(/CAMPO_INVALIDO/)
    }
  })

  it('los ajustes no se escriben directamente desde el navegador', async () => {
    expect(await expectFailure(() =>
      asUser(claimsFor(TENANT_A), `update public.store_settings set cart_recovery_enabled = true where store_id = $1`, [storeA]),
    )).toMatch(/permission denied/i)
  })
})