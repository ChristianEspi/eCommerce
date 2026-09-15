// @vitest-environment node
/**
 * P12-SaaS · DEVOLUCIONES sobre Postgres REAL (PGlite).
 *
 * La mitad del criterio de la fase que dice «el ciclo de entrega/devolucion
 * conserva trazabilidad», y las reglas 8 y 9 del encargo:
 *
 *  · solicitud, motivos, aprobacion/rechazo, estado, items con cantidades y
 *    evidencia opcional SEGURA;
 *  · la integracion financiera pasa por un PUERTO —un hecho canonico en el
 *    outbox— y no por una nota de credito de ningun ERP concreto.
 *
 * Y las dos propiedades que hacen que eso no se pueda romper por accidente:
 * no se devuelve mas de lo que se compro, y la reposicion al almacen es
 * idempotente porque el asiento lleva referencia externa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
let storeA: string
let storeB: string
let productA: string
let warehouseA: string

const ORDERS_USER = '0a000000-0000-4000-8000-0000000000e1'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d1'

let compradorSeq = 0

async function svc<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'service_role', null, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

async function asUser<T = Row>(
  claims: ReturnType<typeof claimsFor>,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asRole(db, 'authenticated', claims, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

async function asAnon<T = Row>(query: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, 'anon', null, async () => {
    const result = await db.query<T>(query, params)
    return result.rows
  })
}

const adminA = () => claimsFor(TENANT_A)
const adminB = () => claimsFor(TENANT_B)
const ordersA = () =>
  claimsFor(TENANT_A, {
    sub: ORDERS_USER,
    email: 'pedidos@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'orders' }],
  })
const viewerA = () =>
  claimsFor(TENANT_A, {
    sub: VIEWER_USER,
    email: 'lector@tenant-a.com',
    companies: [{ id: TENANT_A.companyId, role: 'viewer' }],
  })

async function bootstrap(tenant: typeof TENANT_A): Promise<string> {
  await svc(`select public.bootstrap_tenant($1, $2, $3, $3, $4, $5, $6, 'Tienda', 'PEN')`, [
    tenant.organizationId,
    tenant.companyId,
    tenant.slug,
    tenant.adminEmail,
    tenant.ownerId,
    tenant.storeSlug,
  ])
  const [store] = await svc(`select id from public.stores where slug = $1`, [tenant.storeSlug])
  const storeId = String(store?.id)
  await svc(`update public.stores set status = 'active' where id = $1`, [storeId])
  return storeId
}

interface PlacedOrder {
  orderId: string
  orderNumber: string
  token: string
  itemId: string
}

async function place(quantity = 3, tenant = TENANT_A, product = () => productA): Promise<PlacedOrder> {
  compradorSeq += 1
  const rows = await svc(
    `select public.create_order_for_slug($1, $2, $3::jsonb) as result`,
    [
      tenant.storeSlug,
      `compradora${compradorSeq}@correo.test`,
      JSON.stringify([{ product_id: product(), quantity }]),
    ],
  )
  const result = rows[0]?.result as Row
  const orderId = String(result.order_id)
  const [item] = await svc(`select id from public.order_items where order_id = $1`, [orderId])
  return {
    orderId,
    orderNumber: String(result.order_number),
    token: String(result.access_token),
    itemId: String(item?.id),
  }
}

beforeAll(async () => {
  db = await createTestDatabase()

  storeA = await bootstrap(TENANT_A)
  storeB = await bootstrap(TENANT_B)

  await svc(
    `insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
     values ($1, $2, $3, 'pedidos@tenant-a.com', 'orders', 'active'),
            ($1, $2, $4, 'lector@tenant-a.com',  'viewer', 'active')`,
    [TENANT_A.organizationId, TENANT_A.companyId, ORDERS_USER, VIEWER_USER],
  )

  const [product] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock,
        status, published_at)
     values ($1, $2, $3, 'sku-a', 'sku-a', 'Silla', 100.00, 'PEN', 500, 'published', now())
     returning id`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
  productA = String(product?.id)

  await svc(
    `insert into public.return_reasons
       (organization_id, company_id, store_id, code, label, requires_evidence, restock_default)
     values ($1, $2, $3, 'no-me-gusto', 'No era lo que esperaba', false, true),
            ($1, $2, $3, 'roto', 'Llego dañado', true, false)`,
    [TENANT_A.organizationId, TENANT_A.companyId, storeA],
  )
}, 180_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------

describe('la puerta del comprador anonimo', () => {
  it('el vocabulario de motivos es publico; el resto del dominio no', async () => {
    const motivos = await asAnon(
      `select code, label from public.return_reasons order by position, code`,
    )
    expect(motivos.map((r) => r.code)).toEqual(['no-me-gusto', 'roto'])

    const message = await expectFailure(() =>
      asAnon(`select rma_number from public.return_requests`),
    )
    expect(message).toMatch(/permission denied/i)
  })

  it('pide su devolucion con el token del pedido', async () => {
    const order = await place()
    const [row] = await asAnon(
      `select public.return_request_for_slug($1, $2, $3, 'no-me-gusto', $4::jsonb, $5) as result`,
      [
        TENANT_A.storeSlug,
        order.orderNumber,
        order.token,
        JSON.stringify([{ order_item_id: order.itemId, quantity: 1 }]),
        'Me queda grande',
      ],
    )
    const result = row?.result as Row
    expect(String(result.rma_number)).toMatch(/^RMA-\d{8}-\d{5}$/)
    expect(result.state).toBe('requested')
  })

  it('sin el token no hay devolucion, y no se distingue de "no existe"', async () => {
    const order = await place()
    const message = await expectFailure(() =>
      asAnon(
        `select public.return_request_for_slug($1, $2, $3, 'no-me-gusto', $4::jsonb) as result`,
        [
          TENANT_A.storeSlug,
          order.orderNumber,
          'f'.repeat(64),
          JSON.stringify([{ order_item_id: order.itemId, quantity: 1 }]),
        ],
      ),
    )
    expect(message).toMatch(/PEDIDO_NO_ENCONTRADO/)
  })

  it('un motivo que la tienda no tiene no se puede usar', async () => {
    const order = await place()
    const message = await expectFailure(() =>
      asAnon(
        `select public.return_request_for_slug($1, $2, $3, 'porque-si', $4::jsonb) as result`,
        [
          TENANT_A.storeSlug,
          order.orderNumber,
          order.token,
          JSON.stringify([{ order_item_id: order.itemId, quantity: 1 }]),
        ],
      ),
    )
    expect(message).toMatch(/MOTIVO_NO_VALIDO/)
  })

  it('una linea de OTRO pedido no entra en la devolucion', async () => {
    const mio = await place()
    const ajeno = await place()
    const message = await expectFailure(() =>
      asAnon(
        `select public.return_request_for_slug($1, $2, $3, 'no-me-gusto', $4::jsonb) as result`,
        [
          TENANT_A.storeSlug,
          mio.orderNumber,
          mio.token,
          JSON.stringify([{ order_item_id: ajeno.itemId, quantity: 1 }]),
        ],
      ),
    )
    expect(message).toMatch(/LINEAS_NO_VALIDAS/)
  })

  it('consulta el estado de sus devoluciones sin ver nada interno', async () => {
    const order = await place()
    await asAnon(
      `select public.return_request_for_slug($1, $2, $3, 'no-me-gusto', $4::jsonb) as result`,
      [
        TENANT_A.storeSlug,
        order.orderNumber,
        order.token,
        JSON.stringify([{ order_item_id: order.itemId, quantity: 1 }]),
      ],
    )
    const [row] = await asAnon(`select public.returns_by_token($1, $2, $3) as result`, [
      TENANT_A.storeSlug,
      order.orderNumber,
      order.token,
    ])
    const list = row?.result as Row[]
    expect(list).toHaveLength(1)
    expect(list[0]?.state).toBe('requested')
    // Ni la nota interna, ni quien decidio, ni la evidencia.
    expect(Object.keys(list[0] ?? {})).not.toContain('decision_note')
    expect(Object.keys(list[0] ?? {})).not.toContain('decided_email')
  })
})

describe('cantidades', () => {
  it('no se devuelve mas de lo que se compro', async () => {
    const order = await place(2)
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.return_open($1, 'no-me-gusto', $2::jsonb) as result`, [
        order.orderId,
        JSON.stringify([{ order_item_id: order.itemId, quantity: 3 }]),
      ]),
    )
    expect(message).toMatch(/DEVOLUCION_CANTIDAD_EXCEDIDA/)
  })

  it('dos solicitudes que juntas se pasan tampoco caben', async () => {
    const order = await place(2)
    await asUser(ordersA(), `select public.return_open($1, 'no-me-gusto', $2::jsonb) as result`, [
      order.orderId,
      JSON.stringify([{ order_item_id: order.itemId, quantity: 2 }]),
    ])
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.return_open($1, 'no-me-gusto', $2::jsonb) as result`, [
        order.orderId,
        JSON.stringify([{ order_item_id: order.itemId, quantity: 1 }]),
      ]),
    )
    expect(message).toMatch(/DEVOLUCION_CANTIDAD_EXCEDIDA/)
  })

  it('una solicitud RECHAZADA devuelve sus unidades al saldo devolvible', async () => {
    const order = await place(2)
    const [first] = await asUser(
      ordersA(),
      `select public.return_open($1, 'no-me-gusto', $2::jsonb) as result`,
      [order.orderId, JSON.stringify([{ order_item_id: order.itemId, quantity: 2 }])],
    )
    const returnId = String((first?.result as Row).return_request_id)

    await asUser(ordersA(), `select public.return_decide($1, 'reject', $2) as result`, [
      returnId,
      'Fuera de plazo',
    ])

    // Ahora si cabe otra vez: la anterior ya no cuenta.
    const [second] = await asUser(
      ordersA(),
      `select public.return_open($1, 'no-me-gusto', $2::jsonb) as result`,
      [order.orderId, JSON.stringify([{ order_item_id: order.itemId, quantity: 2 }])],
    )
    expect((second?.result as Row).state).toBe('requested')
  })
})

describe('la decision', () => {
  let returnId: string

  beforeAll(async () => {
    const order = await place(2)
    const [row] = await asUser(
      ordersA(),
      `select public.return_open($1, 'no-me-gusto', $2::jsonb) as result`,
      [order.orderId, JSON.stringify([{ order_item_id: order.itemId, quantity: 1 }])],
    )
    returnId = String((row?.result as Row).return_request_id)
  })

  it('rechazar EXIGE motivo', async () => {
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.return_decide($1, 'reject') as result`, [returnId]),
    )
    expect(message).toMatch(/MOTIVO_REQUERIDO/)
  })

  it('una decision que no es aprobar ni rechazar no existe', async () => {
    const message = await expectFailure(() =>
      asUser(ordersA(), `select public.return_decide($1, 'quiza', 'x') as result`, [returnId]),
    )
    expect(message).toMatch(/DECISION_NO_VALIDA/)
  })

  it('un rol sin permiso de pedidos no decide', async () => {
    const message = await expectFailure(() =>
      asUser(viewerA(), `select public.return_decide($1, 'approve') as result`, [returnId]),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('aprobar deja quien lo hizo y cuando', async () => {
    await asUser(ordersA(), `select public.return_decide($1, 'approve', 'Procede') as result`, [
      returnId,
    ])
    const [req] = await svc(`select * from public.return_requests where id = $1`, [returnId])
    expect(req?.state).toBe('approved')
    expect(req?.decided_email).toBe('pedidos@tenant-a.com')
    expect(req?.decided_at).toBeTruthy()
  })

  it('un salto que la maquina no permite se rechaza', async () => {
    // `approved` no puede volver a `requested`.
    const message = await expectFailure(() =>
      svc(`update public.return_requests set state = 'requested' where id = $1`, [returnId]),
    )
    expect(message).toMatch(/DEVOLUCION_TRANSICION_INVALIDA/)
  })

  it('el RMA y el pedido de una devolucion no se reescriben', async () => {
    const message = await expectFailure(() =>
      svc(`update public.return_requests set rma_number = 'RMA-OTRO' where id = $1`, [returnId]),
    )
    expect(message).toMatch(/DEVOLUCION_IDENTIDAD_INMUTABLE/)
  })

  it('la bitacora de la devolucion no se edita ni se borra', async () => {
    const message = await expectFailure(() =>
      svc(`update public.return_events set note = 'otra cosa' where return_request_id = $1`, [
        returnId,
      ]),
    )
    expect(message).toMatch(/BITACORA_INMUTABLE/)
  })
})

describe('el ciclo completo: recibir, inspeccionar, reponer y cerrar', () => {
  let order: PlacedOrder
  let returnId: string
  let lineId: string

  beforeAll(async () => {
    // El almacen se crea AQUI y no en el arranque a proposito: en cuanto la
    // sociedad declara uno, `create_order` deja de consumir `products.stock` y
    // pasa a consumir existencia POR ALMACEN (P06). Por eso hay que sembrar los
    // niveles inmediatamente despues; sin ese paso, el siguiente pedido fallaria
    // con `STOCK_INSUFICIENTE` y no seria un fallo de esta fase.
    const [w] = await svc(
      `insert into public.warehouses (organization_id, company_id, code, name, is_default)
       values ($1, $2, 'ALM-1', 'Almacen principal', true) returning id`,
      [TENANT_A.organizationId, TENANT_A.companyId],
    )
    warehouseA = String(w?.id)
    // Sembrar niveles exige el modulo de multialmacen contratado (P06). Se
    // activa aqui y no en el arranque por la misma razon que el almacen: hasta
    // este bloque, la tienda vende con `products.stock` como cualquier tenant
    // sin el addon.
    //
    // Cierre D3 (20260914180000): en cuanto el hub SINCRONIZA la sociedad, el
    // fallback legado de `fulfillment` desaparece y manda la lista. Una
    // sociedad sincronizada que procesa devoluciones tiene que tener el addon,
    // así que se declara aquí junto al de multialmacén.
    await svc(
      `select public.sync_platform_context($1, $2, true, $3, 'hub'::public.entitlement_source, null)`,
      [
        TENANT_A.organizationId,
        TENANT_A.companyId,
        ['ecommerce.inventory.multiwarehouse', 'ecommerce.fulfillment'],
      ],
    )
    await asUser(adminA(), `select public.seed_inventory_from_catalog($1, $2) as result`, [
      warehouseA,
      storeA,
    ])

    order = await place(2)
    const [row] = await asUser(
      ordersA(),
      `select public.return_open($1, 'no-me-gusto', $2::jsonb) as result`,
      [order.orderId, JSON.stringify([{ order_item_id: order.itemId, quantity: 2 }])],
    )
    returnId = String((row?.result as Row).return_request_id)
    const [line] = await svc(`select id from public.return_items where return_request_id = $1`, [
      returnId,
    ])
    lineId = String(line?.id)

    await asUser(ordersA(), `select public.return_decide($1, 'approve') as result`, [returnId])
  })

  it('recibir anota cuantas llegaron de verdad', async () => {
    await asUser(ordersA(), `select public.return_receive($1, $2::jsonb) as result`, [
      returnId,
      JSON.stringify([{ return_item_id: lineId, received_quantity: 1 }]),
    ])
    const [line] = await svc(`select * from public.return_items where id = $1`, [lineId])
    expect(line?.received_quantity).toBe(1)
    const [req] = await svc(`select state from public.return_requests where id = $1`, [returnId])
    expect(req?.state).toBe('received')
  })

  it('inspeccionar repone al almacen lo que llego vendible', async () => {
    await asUser(
      ordersA(),
      `select public.return_inspect($1, $2::jsonb, $3::numeric) as result`,
      [
        returnId,
        JSON.stringify([
          { return_item_id: lineId, condition: 'sellable', restock: true, refund_amount: '100.00' },
        ]),
        '100.00',
      ],
    )

    const [movement] = await svc(
      `select kind, quantity, external_ref from public.inventory_movements
        where warehouse_id = $1 and kind = 'return'`,
      [warehouseA],
    )
    expect(movement?.kind).toBe('return')
    expect(Number(movement?.quantity)).toBe(1)
    expect(String(movement?.external_ref)).toContain(lineId)

    const [req] = await svc(`select state, refund_amount from public.return_requests where id = $1`, [
      returnId,
    ])
    expect(req?.state).toBe('inspected')
    expect(req?.refund_amount).toBe('100.00')
  })

  it('inspeccionar dos veces NO repone el doble', async () => {
    await asUser(
      ordersA(),
      `select public.return_inspect($1, $2::jsonb) as result`,
      [
        returnId,
        JSON.stringify([
          { return_item_id: lineId, condition: 'sellable', restock: true, refund_amount: '100.00' },
        ]),
      ],
    )
    const [count] = await svc(
      `select count(*)::int as total from public.inventory_movements
        where warehouse_id = $1 and kind = 'return'`,
      [warehouseA],
    )
    expect(count?.total).toBe(1)
  })

  it('una unidad que no llego NO se puede marcar para reponer', async () => {
    const otro = await place(1)
    const [row] = await asUser(
      ordersA(),
      `select public.return_open($1, 'roto', $2::jsonb) as result`,
      [otro.orderId, JSON.stringify([{ order_item_id: otro.itemId, quantity: 1 }])],
    )
    const id = String((row?.result as Row).return_request_id)
    const [line] = await svc(`select id from public.return_items where return_request_id = $1`, [id])

    await asUser(ordersA(), `select public.return_decide($1, 'approve') as result`, [id])
    await asUser(ordersA(), `select public.return_receive($1) as result`, [id])
    await asUser(ordersA(), `select public.return_inspect($1, $2::jsonb) as result`, [
      id,
      JSON.stringify([{ return_item_id: line?.id, condition: 'missing', restock: true }]),
    ])

    const [saved] = await svc(`select condition, restock from public.return_items where id = $1`, [
      line?.id,
    ])
    expect(saved?.condition).toBe('missing')
    // Pedir reponer lo que no llego no repone: la base lo ignora en vez de
    // sumar existencia que nadie tiene.
    expect(saved?.restock).toBe(false)
  })

  it('cerrar publica el HECHO financiero, sin nombrar ningun ERP', async () => {
    await asUser(ordersA(), `select public.return_complete($1, 'refund') as result`, [returnId])

    const [event] = await svc(
      `select event_type, payload from public.domain_events
        where aggregate_id = $1 and event_type = 'return.completed'`,
      [returnId],
    )
    expect(event?.event_type).toBe('return.completed')
    const payload = event?.payload as Row
    expect(payload.refund_amount).toBe('100.00')
    expect(payload.resolution).toBe('refund')
    expect(payload.currency).toBe('PEN')
    expect(Array.isArray(payload.lines)).toBe(true)

    // Ni nota de credito, ni documento, ni sistema externo: el hecho es
    // canonico y quien lo convierta en algo es un consumidor del outbox.
    const texto = JSON.stringify(payload).toLowerCase()
    expect(texto).not.toContain('credit_note')
    expect(texto).not.toContain('nota_credito')
  })

  it('cerrar deja rastro en la linea de tiempo del PEDIDO', async () => {
    const rows = await svc(
      `select event_type from public.order_events where order_id = $1`,
      [order.orderId],
    )
    const types = rows.map((r) => String(r.event_type))
    expect(types).toContain('return.requested')
    expect(types).toContain('return.inspected')
    expect(types).toContain('return.completed')
  })

  it('completar NO abona nada por su cuenta', async () => {
    // Devolver dinero es un acto autorizado de otro dominio (P09) con su propia
    // pantalla. Que aprobar una devolucion abonara una tarjeta sola es
    // exactamente lo que esta fase decide NO hacer.
    const [count] = await svc(`select count(*)::int as total from public.refunds`)
    expect(count?.total).toBe(0)
  })
})

describe('evidencia', () => {
  let returnId: string

  beforeAll(async () => {
    const order = await place(1)
    const [row] = await asUser(
      ordersA(),
      `select public.return_open($1, 'roto', $2::jsonb) as result`,
      [order.orderId, JSON.stringify([{ order_item_id: order.itemId, quantity: 1 }])],
    )
    returnId = String((row?.result as Row).return_request_id)
  })

  it('el bucket es privado y anon no puede leerlo', async () => {
    const [bucket] = await svc(
      `select public from storage.buckets where id = 'return-evidence'`,
    )
    expect(bucket?.public).toBe(false)

    const policies = await svc(`
      select p.polname as name
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_roles r on r.oid = any (p.polroles)
      where n.nspname = 'storage' and c.relname = 'objects' and r.rolname = 'anon'
        and p.polname like '%return%'
    `)
    expect(policies).toEqual([])
  })

  it('adjunta una foto con la ruta del tenant', async () => {
    const path = `${TENANT_A.organizationId}/${storeA}/${returnId}/foto.jpg`
    const [row] = await asUser(
      ordersA(),
      `select public.return_evidence_attach($1, $2, 'image/jpeg', 120000, 'Caja rota') as result`,
      [returnId, path],
    )
    expect((row?.result as Row).evidence_id).toBeTruthy()
  })

  it('una ruta que no empieza por el tenant se rechaza', async () => {
    const message = await expectFailure(() =>
      asUser(
        ordersA(),
        `select public.return_evidence_attach($1, $2, 'image/png', 1000) as result`,
        [returnId, `${TENANT_B.organizationId}/${storeB}/${returnId}/robada.png`],
      ),
    )
    expect(message).toMatch(/EVIDENCIA_RUTA_INVALIDA/)
  })

  it('un tipo de archivo que no es imagen ni PDF se rechaza', async () => {
    const message = await expectFailure(() =>
      asUser(
        ordersA(),
        `select public.return_evidence_attach($1, $2, 'application/x-msdownload', 1000) as result`,
        [returnId, `${TENANT_A.organizationId}/${storeA}/${returnId}/virus.exe`],
      ),
    )
    expect(message).toMatch(/return_evidence_type/)
  })
})

describe('aislamiento entre tenants', () => {
  const TABLAS = [
    'return_reasons',
    'return_requests',
    'return_items',
    'return_events',
    'return_evidence',
  ]

  it('un miembro de B no ve ni una fila de A', async () => {
    for (const tabla of TABLAS) {
      const rows = await asUser(adminB(), `select count(*)::int as total from public.${tabla}`)
      expect(`${tabla}: ${rows[0]?.total}`).toBe(`${tabla}: 0`)
    }
  })

  it('un miembro de A si ve lo suyo', async () => {
    const rows = await asUser(adminA(), `select count(*)::int as total from public.return_requests`)
    expect(Number(rows[0]?.total)).toBeGreaterThan(0)
  })

  it('B no puede decidir sobre una devolucion de A', async () => {
    const [req] = await svc(`select id from public.return_requests limit 1`)
    const message = await expectFailure(() =>
      asUser(adminB(), `select public.return_decide($1, 'approve') as result`, [req?.id]),
    )
    expect(message).toMatch(/SIN_PERMISO/)
  })

  it('la vista de la cola respeta las policies del dominio', async () => {
    const deA = await asUser(adminA(), `select count(*)::int as total from public.return_overview`)
    const deB = await asUser(adminB(), `select count(*)::int as total from public.return_overview`)
    expect(Number(deA[0]?.total)).toBeGreaterThan(0)
    expect(deB[0]?.total).toBe(0)
  })
})
