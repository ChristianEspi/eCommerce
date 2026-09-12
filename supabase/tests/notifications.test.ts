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
 * Notificaciones: de un hecho del negocio a quién se entera.
 *
 * Diseño y decisiones: `docs/NOTIFICATIONS_ANALYSIS.md`.
 *
 * Lo que se fija aquí, en orden de lo que más caro sale romper:
 *
 *  1. **Avisar nunca tumba el hecho.** Si el reparto falla, el pedido existe
 *     igual y queda un incidente.
 *  2. **Cada aviso le llega a quien le toca y a nadie más**: por rol en el
 *     backoffice, por vínculo en la tienda, y nunca a otra sociedad.
 *  3. **La persona solo puede marcar leído o archivado** sus propios avisos.
 *  4. **La cola de correo es de servidor**, no guarda direcciones de la suite y
 *     no envía lo caducado.
 */

let db: PGlite

const ADMIN = '0a000000-0000-4000-8000-0000000000d1'
const PEDIDOS = '0a000000-0000-4000-8000-0000000000d2'
const MIRONA = '0a000000-0000-4000-8000-0000000000d3'
const COMPRADORA = '0a000000-0000-4000-8000-0000000000d4'
const INVITADO_B2C = '0a000000-0000-4000-8000-0000000000d5'
const VENDEDOR = '0a000000-0000-4000-8000-0000000000d6'

let storeA = ''
let channelA = ''
let storeB = ''
let channelB = ''
let clienteA = ''
let cuentaA = ''
let orderSeq = 0

async function svc<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await db.query<T>(query, params)).rows
}

const comprador = (sub: string, email: string) => ({ sub, email }) as unknown as JwtClaims

async function crearUsuario(id: string, email: string) {
  await svc(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [id, email])
}

async function miembro(id: string, email: string, role: string) {
  await crearUsuario(id, email)
  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
     values ($1, $2, $3, $4, $5::public.app_role)`,
    [TENANT_A.organizationId, TENANT_A.companyId, id, email, role],
  )
}

async function pedido(input: {
  email?: string
  cuenta?: string | null
  tenant?: typeof TENANT_A
  aprobacion?: 'not_required' | 'pending'
} = {}): Promise<string> {
  const tenant = input.tenant ?? TENANT_A
  orderSeq += 1
  const [fila] = await svc<{ id: string }>(
    `insert into public.orders (
       organization_id, company_id, store_id, channel_id, order_number,
       customer_email, currency, subtotal, tax_total, grand_total, business_account_id,
       approval_status)
     values ($1, $2, $3, $4, $5, $6, 'PEN', 120, 0, 120, $7, $8::public.order_approval_status)
     returning id`,
    [
      tenant.organizationId, tenant.companyId,
      tenant === TENANT_A ? storeA : storeB,
      tenant === TENANT_A ? channelA : channelB,
      `NT-${String(orderSeq).padStart(5, '0')}`,
      input.email ?? 'invitado@b2c.com',
      input.cuenta ?? null,
      input.aprobacion ?? 'not_required',
    ],
  )
  return String(fila?.id)
}

async function publicar(tipo: string, orderId: string, payload: Record<string, unknown> = {},
                        tenant = TENANT_A) {
  await svc(
    `select ebim.publish_event($1, $2, $3, $4, 'order', $5, $6::jsonb, $7)`,
    [
      tenant.organizationId, tenant.companyId, tenant === TENANT_A ? storeA : storeB,
      tipo, orderId, JSON.stringify(payload), `${tipo}:${orderId}:${Math.random()}`,
    ],
  )
}

async function avisos(filtro = 'true') {
  return svc<{ recipient_user_id: string; audience: string; kind: string; params: Record<string, unknown>; link: string | null }>(
    `select recipient_user_id, audience, kind, params, link from public.notifications where ${filtro}`,
  )
}

async function correos(filtro = 'true') {
  return svc<{ kind: string; to_address: string; locale: string; params: Record<string, unknown>; status: string }>(
    `select kind, to_address, locale, params, status from public.notification_emails where ${filtro}`,
  )
}

beforeAll(async () => {
  db = await createTestDatabase()

  for (const tenant of [TENANT_A, TENANT_B]) {
    await crearUsuario(tenant.ownerId, tenant.adminEmail)
    await svc(`select public.bootstrap_tenant($1, $2, $3, $4, $5, $6, $7, $8, 'PEN')`, [
      tenant.organizationId, tenant.companyId, tenant.slug, `Cuenta ${tenant.slug}`,
      tenant.adminEmail, tenant.ownerId, tenant.storeSlug, `Tienda ${tenant.slug}`,
    ])
  }

  const stores = await svc<{ id: string; organization_id: string }>(`select id, organization_id from public.stores`)
  storeA = String(stores.find((s) => s.organization_id === TENANT_A.organizationId)?.id)
  storeB = String(stores.find((s) => s.organization_id === TENANT_B.organizationId)?.id)
  const channels = await svc<{ id: string; store_id: string }>(`select id, store_id from public.channels where is_default`)
  channelA = String(channels.find((c) => c.store_id === storeA)?.id)
  channelB = String(channels.find((c) => c.store_id === storeB)?.id)

  await miembro(ADMIN, 'admin2@tenant-a.com', 'admin')
  await miembro(PEDIDOS, 'pedidos@tenant-a.com', 'orders')
  await miembro(MIRONA, 'mirona@tenant-a.com', 'viewer')
  await crearUsuario(COMPRADORA, 'compradora@cliente.com')
  await crearUsuario(INVITADO_B2C, 'invitado@b2c.com')

  const [cliente] = await svc<{ id: string }>(
    `insert into public.customers (organization_id, company_id, kind, code, name)
     values ($1, $2, 'company', 'CLI-N', 'Policlinico Andino') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId],
  )
  clienteA = String(cliente?.id)
  const [cuenta] = await svc<{ id: string }>(
    `insert into public.business_accounts
       (organization_id, company_id, customer_id, customer_kind, code, name)
     values ($1, $2, $3, 'company', 'B2B-N', 'Policlinico Andino SAC') returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, clienteA],
  )
  cuentaA = String(cuenta?.id)
  await svc(
    `insert into public.business_account_users
       (organization_id, company_id, business_account_id, user_id, email, role, status)
     values ($1, $2, $3, $4, 'compradora@cliente.com', 'buyer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, cuentaA, COMPRADORA],
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await svc(`delete from public.notifications`)
  await svc(`delete from public.notification_emails`)
  await svc(`delete from public.ops_events`)
})

// ---------------------------------------------------------------------------
// 1. Avisar nunca tumba el hecho
// ---------------------------------------------------------------------------

describe('avisar nunca tumba el hecho que avisa', () => {
  it('si el reparto falla, el evento se guarda igual y queda un incidente', async () => {
    const id = await pedido()
    // Se rompe a propósito la tabla de avisos para que el reparto falle.
    await svc(`alter table public.notifications add constraint romper check (false) not valid`)
    try {
      await publicar('order.created', id)
    } finally {
      await svc(`alter table public.notifications drop constraint romper`)
    }

    const eventos = await svc(`select 1 from public.domain_events where aggregate_id = $1`, [id])
    const incidentes = await svc<{ code: string }>(
      `select code from public.ops_events where entity_id = $1`, [id],
    )
    expect(eventos).toHaveLength(1)
    expect(incidentes.map((i) => i.code)).toContain('AVISO_NO_REPARTIDO')
    expect(await avisos()).toEqual([])
  })

  it('un destinatario sin usuario de Auth se omite sin quitarle el aviso al resto', async () => {
    await svc(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, '0a000000-0000-4000-8000-0000000000ff', 'fantasma@tenant-a.com', 'orders')`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    try {
      await publicar('order.created', await pedido())
      const destinatarios = (await avisos(`kind = 'order.received'`)).map((a) => a.recipient_user_id)
      expect(destinatarios).toContain(PEDIDOS)
    } finally {
      await svc(`delete from public.tenant_members where email = 'fantasma@tenant-a.com'`)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. A quién le llega
// ---------------------------------------------------------------------------

describe('backoffice: por rol', () => {
  it('un pedido nuevo le llega a owner, admin y pedidos; no a solo lectura', async () => {
    const id = await pedido()
    await publicar('order.created', id)

    const filas = await avisos(`kind = 'order.received'`)
    expect(filas.map((f) => f.recipient_user_id).sort()).toEqual(
      [TENANT_A.ownerId, ADMIN, PEDIDOS].sort(),
    )
    expect(filas.every((f) => f.audience === 'backoffice')).toBe(true)
    expect(filas[0]?.link).toBe(`/app/orders?order=${id}`)
    expect(filas[0]?.params.order_number).toMatch(/^NT-/)
  })

  it('nunca le llega a otra sociedad', async () => {
    await publicar('order.created', await pedido())

    const deB = await avisos(`recipient_user_id = '${TENANT_B.ownerId}'`)
    expect(deB).toEqual([])
  })

  it('un pedido que espera aprobación avisa al personal en la campanita Y por correo', async () => {
    const id = await pedido({ email: 'compradora@cliente.com', cuenta: cuentaA })
    await publicar('order.approval_requested', id)

    expect((await avisos(`kind = 'order.approval_requested'`)).length).toBe(3)
    const envios = await correos(`kind = 'order.approval_requested'`)
    expect(envios.map((c) => c.to_address).sort()).toEqual(
      ['admin2@tenant-a.com', 'admin@tenant-a.com', 'pedidos@tenant-a.com'].sort(),
    )
  })

  it('un cobro fallido avisa; un cobro correcto no', async () => {
    const id = await pedido()
    await publicar('order.payment_status_changed', id, { to: 'paid' })
    expect(await avisos(`kind = 'order.payment_failed'`)).toEqual([])

    await publicar('order.payment_status_changed', id, { to: 'failed' })
    expect((await avisos(`kind = 'order.payment_failed'`)).length).toBe(3)
  })
})

describe('tienda: por vínculo', () => {
  it('la confirmación encola el correo al comprador con la marca de la tienda', async () => {
    const id = await pedido({ email: 'Invitado@B2C.com' })
    await publicar('notification.order_confirmation', id)

    const [envio] = await correos(`kind = 'order.confirmed'`)
    expect(envio?.to_address).toBe('invitado@b2c.com')
    expect(envio?.params.store_name).toBe('Tienda tenant-a')
    expect(envio?.locale).toBe('es')
  })

  it('y si el comprador tiene cuenta, también lo ve en «Tu cuenta»', async () => {
    const id = await pedido({ email: 'invitado@b2c.com' })
    await publicar('notification.order_confirmation', id)

    const [aviso] = await avisos(`kind = 'order.confirmed'`)
    expect(aviso?.recipient_user_id).toBe(INVITADO_B2C)
    expect(aviso?.audience).toBe('storefront')
    expect(aviso?.link).toBe(`/s/${TENANT_A.storeSlug}/account`)
  })

  it('en B2B le llega a quien compró, no a toda la empresa', async () => {
    const id = await pedido({ email: 'compradora@cliente.com', cuenta: cuentaA })
    await publicar('order.approval_requested', id)

    const [aviso] = await avisos(`kind = 'order.approval_pending'`)
    expect(aviso?.recipient_user_id).toBe(COMPRADORA)
  })

  it('aprobado o rechazado, con el motivo', async () => {
    // Nace pendiente: la regla de ejes no deja pasar de «sin aprobación» a
    // «pendiente» después de creado, y así es como llega del checkout.
    const id = await pedido({ email: 'compradora@cliente.com', cuenta: cuentaA, aprobacion: 'pending' })
    await svc(
      `update public.orders set approval_status = 'rejected', approval_reason = 'Fuera de presupuesto',
              approval_decided_at = now() where id = $1`, [id],
    )
    await publicar('order.approval_decided', id)

    const [aviso] = await avisos(`kind = 'order.rejected'`)
    expect(aviso?.recipient_user_id).toBe(COMPRADORA)
    expect(aviso?.params.reason).toBe('Fuera de presupuesto')
    expect(await correos(`kind = 'order.rejected'`)).toHaveLength(1)
  })

  it('el despacho avisa al comprador; pasar a «en preparación» todavía no', async () => {
    const id = await pedido({ email: 'invitado@b2c.com' })
    await publicar('order.fulfillment_status_changed', id, { to: 'in_progress' })
    expect(await avisos(`kind = 'order.shipped'`)).toEqual([])

    await publicar('order.fulfillment_status_changed', id, { to: 'fulfilled' })
    expect(await avisos(`kind = 'order.shipped'`)).toHaveLength(1)
    expect(await correos(`kind = 'order.shipped'`)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Hechos nuevos
// ---------------------------------------------------------------------------

describe('hechos que antes no se publicaban', () => {
  it('dar acceso al backoffice avisa a esa persona, por campanita y por correo', async () => {
    await crearUsuario('0a000000-0000-4000-8000-0000000000e7', 'nueva@tenant-a.com')
    await svc(
      `insert into public.tenant_members (organization_id, company_id, user_id, email, role)
       values ($1, $2, '0a000000-0000-4000-8000-0000000000e7', 'nueva@tenant-a.com', 'catalog')`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )

    expect(await avisos(`kind = 'member.access_granted'`)).toHaveLength(1)
    const [envio] = await correos(`kind = 'member.access_granted'`)
    expect(envio?.to_address).toBe('nueva@tenant-a.com')
  })

  it('quitar el acceso avisa SOLO por correo: ya no hay campanita que ver', async () => {
    await svc(`update public.tenant_members set status = 'revoked' where user_id = $1`, [MIRONA])
    try {
      expect(await avisos(`kind = 'member.access_revoked'`)).toEqual([])
      expect(await correos(`kind = 'member.access_revoked'`)).toHaveLength(1)
    } finally {
      await svc(`update public.tenant_members set status = 'active' where user_id = $1`, [MIRONA])
    }
  })

  it('vincular como invitado y luego activar son dos avisos distintos', async () => {
    await svc(`delete from public.business_account_users where user_id = $1`, [INVITADO_B2C])
    await svc(
      `insert into public.business_account_users
         (organization_id, company_id, business_account_id, user_id, email, role, status)
       values ($1, $2, $3, $4, 'invitado@b2c.com', 'buyer', 'invited')`,
      [TENANT_A.organizationId, TENANT_A.companyId, cuentaA, INVITADO_B2C],
    )
    const [invitado] = await avisos(`kind = 'business_account.invited'`)
    expect(invitado?.params.account_name).toBe('Policlinico Andino SAC')

    await svc(
      `update public.business_account_users set status = 'active' where user_id = $1`, [INVITADO_B2C],
    )
    expect(await avisos(`kind = 'business_account.activated'`)).toHaveLength(1)
    expect(await correos(`kind like 'business_account.%'`)).toHaveLength(2)

    await svc(`delete from public.business_account_users where user_id = $1`, [INVITADO_B2C])
  })

  it('una integración que se cae avisa a quien administra', async () => {
    await svc(
      `insert into public.integration_circuit (organization_id, company_id, provider_code, operation)
       values ($1, $2, 'erp.demo', 'order.push')`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    await svc(
      `update public.integration_circuit set state = 'open', opened_at = now()
        where provider_code = 'erp.demo'`,
    )

    const filas = await avisos(`kind = 'integration.circuit_opened'`)
    expect(filas.map((f) => f.recipient_user_id).sort()).toEqual([TENANT_A.ownerId, ADMIN].sort())
  })

  it('un sugerido ENVIADO avisa a los compradores activos de ese cliente', async () => {
    const [sugerido] = await svc<{ id: string }>(
      `insert into public.order_suggestions (organization_id, company_id, store_id, customer_id)
       values ($1, $2, $3, $4) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, clienteA],
    )
    expect(await avisos(`kind = 'suggestion.sent'`)).toEqual([])

    await svc(`update public.order_suggestions set status = 'sent' where id = $1`, [sugerido?.id])

    const [aviso] = await avisos(`kind = 'suggestion.sent'`)
    expect(aviso?.recipient_user_id).toBe(COMPRADORA)
    expect(aviso?.link).toBe(`/s/${TENANT_A.storeSlug}/account#sugeridos`)
    expect(await correos(`kind = 'suggestion.sent'`)).toHaveLength(1)
  })

  it('un sugerido generado avisa al vendedor de esa cartera', async () => {
    await crearUsuario(VENDEDOR, 'vendedor@tenant-a.com')
    const [rep] = await svc<{ id: string }>(
      `insert into public.sales_reps (organization_id, company_id, user_id, employee_code, full_name)
       values ($1, $2, $3, 'V-01', 'Vendedor Uno') returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId, VENDEDOR],
    )
    await svc(
      `insert into public.order_suggestions (organization_id, company_id, store_id, customer_id, sales_rep_id)
       values ($1, $2, $3, $4, $5)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, clienteA, rep?.id],
    )

    const [aviso] = await avisos(`kind = 'suggestion.generated'`)
    expect(aviso?.recipient_user_id).toBe(VENDEDOR)
  })
})

// ---------------------------------------------------------------------------
// 3. Lo que la persona puede hacer con sus avisos
// ---------------------------------------------------------------------------

describe('RLS de los avisos', () => {
  it('cada uno ve los suyos y ninguno ajeno', async () => {
    await publicar('order.created', await pedido())

    const propios = await asRole(db, 'authenticated', claimsFor(TENANT_A, { sub: PEDIDOS, email: 'pedidos@tenant-a.com', companies: [{ id: TENANT_A.companyId, role: 'orders' }] }),
      () => svc<{ recipient_user_id: string }>(`select recipient_user_id from public.notifications`))
    expect(propios.length).toBe(1)
    expect(propios[0]?.recipient_user_id).toBe(PEDIDOS)
  })

  it('el comprador ve sus avisos de tienda sin ser miembro de la sociedad', async () => {
    const id = await pedido({ email: 'compradora@cliente.com', cuenta: cuentaA })
    await publicar('order.approval_requested', id)

    const vistos = await asRole(db, 'authenticated', comprador(COMPRADORA, 'compradora@cliente.com'),
      () => svc(`select kind from public.notifications`))
    expect(vistos).toEqual([{ kind: 'order.approval_pending' }])
  })

  it('a quien le quitaron el acceso deja de ver los avisos del backoffice', async () => {
    await publicar('order.created', await pedido())
    const claims = claimsFor(TENANT_A, { sub: PEDIDOS, email: 'pedidos@tenant-a.com', companies: [{ id: TENANT_A.companyId, role: 'orders' }] })

    await svc(`update public.tenant_members set status = 'revoked' where user_id = $1`, [PEDIDOS])
    try {
      const vistos = await asRole(db, 'authenticated', claims, () => svc(`select 1 from public.notifications`))
      expect(vistos).toEqual([])
    } finally {
      await svc(`update public.tenant_members set status = 'active' where user_id = $1`, [PEDIDOS])
    }
  })

  it('puede marcar leído, pero no reescribir el aviso', async () => {
    await publicar('order.created', await pedido())
    const claims = claimsFor(TENANT_A, { sub: PEDIDOS, email: 'pedidos@tenant-a.com', companies: [{ id: TENANT_A.companyId, role: 'orders' }] })

    await asRole(db, 'authenticated', claims, () =>
      svc(`update public.notifications set read_at = now()`))
    const [fila] = await svc<{ read_at: string | null }>(
      `select read_at from public.notifications where recipient_user_id = $1`, [PEDIDOS],
    )
    expect(fila?.read_at).not.toBeNull()

    const error = await expectFailure(() =>
      asRole(db, 'authenticated', claims, () =>
        svc(`update public.notifications set kind = 'order.approved'`)))
    expect(error).toMatch(/permission denied/i)
  })

  it('nadie del cliente puede crear avisos', async () => {
    const error = await expectFailure(() =>
      asRole(db, 'authenticated', comprador(COMPRADORA, 'compradora@cliente.com'), () =>
        svc(
          `insert into public.notifications (organization_id, company_id, recipient_user_id, audience, kind, dedupe_key)
           values ($1, $2, $3, 'storefront', 'order.approved', 'falso')`,
          [TENANT_A.organizationId, TENANT_A.companyId, COMPRADORA],
        )))
    expect(error).toMatch(/permission denied/i)
  })
})

// ---------------------------------------------------------------------------
// 4. La cola de correo
// ---------------------------------------------------------------------------

describe('cola de correo', () => {
  it('un mismo hecho no encola dos veces el mismo correo', async () => {
    const id = await pedido()
    const [evento] = await svc<{ id: string }>(
      `select ebim.publish_event($1, $2, $3, 'notification.order_confirmation', 'order', $4::uuid, '{}'::jsonb, 'fijo:' || $4::text) as id`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, id],
    )
    await svc(
      `select ebim.publish_event($1, $2, $3, 'notification.order_confirmation', 'order', $4::uuid, '{}'::jsonb, 'fijo:' || $4::text)`,
      [TENANT_A.organizationId, TENANT_A.companyId, storeA, id],
    )
    expect(evento?.id).toBeTruthy()
    expect(await correos(`kind = 'order.confirmed'`)).toHaveLength(1)
  })

  it('una dirección de la suite no se encola nunca', async () => {
    await publicar('notification.order_confirmation', await pedido({ email: 'operador@ebim.pe' }))
    expect(await correos()).toEqual([])
  })

  it('reclamar, enviar y cerrar; lo caducado no sale', async () => {
    await publicar('notification.order_confirmation', await pedido({ email: 'uno@b2c.com' }))
    await publicar('notification.order_confirmation', await pedido({ email: 'dos@b2c.com' }))
    await svc(
      `update public.notification_emails set expires_at = now() - interval '1 minute'
        where to_address = 'dos@b2c.com'`,
    )

    const reclamados = await asRole(db, 'service_role', null, () =>
      svc<{ id: string; to_address: string }>(`select * from public.notification_email_claim(10)`))
    expect(reclamados.map((r) => r.to_address)).toEqual(['uno@b2c.com'])

    await asRole(db, 'service_role', null, () =>
      svc(`select public.notification_email_complete($1, 'graph-ok')`, [reclamados[0]?.id]))

    const estados = await svc<{ to_address: string; status: string }>(
      `select to_address, status from public.notification_emails order by to_address`,
    )
    expect(estados).toEqual([
      { to_address: 'dos@b2c.com', status: 'expired' },
      { to_address: 'uno@b2c.com', status: 'sent' },
    ])
  })

  it('un fallo reintentable vuelve a la cola con espera; uno definitivo no', async () => {
    await publicar('notification.order_confirmation', await pedido({ email: 'tres@b2c.com' }))
    const [uno] = await asRole(db, 'service_role', null, () =>
      svc<{ id: string }>(`select * from public.notification_email_claim(1)`))
    await asRole(db, 'service_role', null, () =>
      svc(`select public.notification_email_fail($1, 'GRAPH_503', true)`, [uno?.id]))

    const [tras] = await svc<{ status: string; last_error: string; espera: boolean }>(
      `select status, last_error, next_attempt_at > now() as espera from public.notification_emails`,
    )
    expect(tras).toEqual({ status: 'pending', last_error: 'GRAPH_503', espera: true })

    await svc(`update public.notification_emails set next_attempt_at = now()`)
    const [dos] = await asRole(db, 'service_role', null, () =>
      svc<{ id: string }>(`select * from public.notification_email_claim(1)`))
    await asRole(db, 'service_role', null, () =>
      svc(`select public.notification_email_fail($1, 'DESTINATARIO_INVALIDO', false)`, [dos?.id]))
    const [fin] = await svc<{ status: string }>(`select status from public.notification_emails`)
    expect(fin?.status).toBe('failed')
  })

  it('el error guardado es un código, nunca el texto del proveedor', async () => {
    await publicar('notification.order_confirmation', await pedido({ email: 'cuatro@b2c.com' }))
    const [uno] = await asRole(db, 'service_role', null, () =>
      svc<{ id: string }>(`select * from public.notification_email_claim(1)`))
    await asRole(db, 'service_role', null, () =>
      svc(`select public.notification_email_fail($1, 'rechazado para cuatro@b2c.com', true)`, [uno?.id]))

    const [fila] = await svc<{ last_error: string }>(`select last_error from public.notification_emails`)
    expect(fila?.last_error).not.toContain('@')
  })

  it('ni anon ni un usuario pueden vaciar la cola', async () => {
    for (const rol of ['anon', 'authenticated'] as const) {
      const claims = rol === 'anon' ? null : claimsFor(TENANT_A)
      const error = await expectFailure(() =>
        asRole(db, rol, claims, () => svc(`select * from public.notification_email_claim(10)`)))
      expect(error).toMatch(/permission denied/i)
    }
  })

  it('un comprador no lee la cola; quien administra sí', async () => {
    await publicar('notification.order_confirmation', await pedido({ email: 'cinco@b2c.com' }))

    const delComprador = await asRole(db, 'authenticated', comprador(COMPRADORA, 'compradora@cliente.com'),
      () => svc(`select 1 from public.notification_emails`))
    const delAdmin = await asRole(db, 'authenticated', claimsFor(TENANT_A),
      () => svc(`select 1 from public.notification_emails`))
    expect(delComprador).toEqual([])
    expect(delAdmin).toHaveLength(1)
  })
})
