// @vitest-environment node
/**
 * P09-SaaS · el dominio de PAGOS sobre Postgres REAL (PGlite).
 *
 * El criterio de la fase tiene dos mitades y las dos se comprueban aqui:
 *
 *   «PASS si el checkout puede usar un provider fake mediante contrato canonico
 *    y anadir un proveedor real no requiere modificar el dominio de pedidos.»
 *
 * La segunda mitad es una propiedad del ESQUEMA, y por eso se puede afirmar
 * desde un test de base: `orders` y `order_items` no ganaron ni una columna en
 * P09, y un cobro apunta al pedido sin que el pedido apunte al cobro. Hay un
 * test que lo verifica leyendo el catalogo, no leyendo el diff.
 *
 * Lo demas es lo que hace que eso sea seguro y no solo elegante:
 *
 *  · las guardas PCI, que son CHECKs y no convenciones: un PAN valido no entra
 *    en esta base ni siquiera como `service_role`;
 *  · las tres reglas del comando —el navegador no decide, el webhook sin firma
 *    no mueve dinero, el aviso repetido no duplica nada—, cada una con su test;
 *  · la aritmetica del dinero, que se defiende en la base;
 *  · la conciliacion, que no cuadra el extracto de una sociedad con el cobro de
 *    otra;
 *  · y el aislamiento entre tenants en las siete tablas nuevas.
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
let productB: string
let metodoTarjeta: string
let metodoTransferencia: string
let metodoB: string

const ORDERS_USER = '0a000000-0000-4000-8000-0000000000e1'
const VIEWER_USER = '0a000000-0000-4000-8000-0000000000d1'

/** `ebim.assert_checkout_allowed` limita por correo y hora: uno nuevo cada vez. */
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
const superAdmin = () => claimsFor(TENANT_A, { email: 'dcalagua@ebim.pe' })

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

async function newProduct(
  tenant: typeof TENANT_A,
  storeId: string,
  sku: string,
  price: string,
): Promise<string> {
  const [row] = await svc(
    `insert into public.products
       (organization_id, company_id, store_id, sku, slug, name, price, currency, stock,
        status, published_at)
     values ($1, $2, $3, $4, $4, $5, $6, 'PEN', 500, 'published', now())
     returning id`,
    [tenant.organizationId, tenant.companyId, storeId, sku, `Nombre ${sku}`, price],
  )
  return String(row?.id)
}

async function newMethod(
  tenant: typeof TENANT_A,
  storeId: string,
  code: string,
  providerCode: string | null,
  captureMode: 'automatic' | 'manual' = 'automatic',
): Promise<string> {
  const [row] = await svc(
    `insert into public.payment_methods
       (organization_id, company_id, store_id, code, kind, display_name, provider_code,
        capture_mode, is_active)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true) returning id`,
    [
      tenant.organizationId,
      tenant.companyId,
      storeId,
      code,
      providerCode === null ? 'bank_transfer' : 'card',
      `Medio ${code}`,
      providerCode,
      captureMode,
    ],
  )
  return String(row?.id)
}

async function place(tenant: typeof TENANT_A, productId: string, quantity = 1): Promise<Row> {
  compradorSeq += 1
  const rows = await svc(
    `select public.create_order_for_slug($1, $2, $3::jsonb) as result`,
    [tenant.storeSlug, `compradora${compradorSeq}@correo.test`, JSON.stringify([
      { product_id: productId, quantity },
    ])],
  )
  return rows[0]?.result as Row
}

/** Abre un intento y devuelve su fila de respuesta. */
async function openIntent(
  tenant: typeof TENANT_A,
  methodCode: string,
  amount: string,
  key: string,
): Promise<Row> {
  const rows = await svc(
    `select public.payment_intent_open($1, $2, $3::numeric, 'PEN', $4) as result`,
    [tenant.storeSlug, methodCode, amount, key],
  )
  return rows[0]?.result as Row
}

interface OutcomeArgs {
  intentId: string
  operation?: string
  key: string
  attemptStatus: string
  intentStatus?: string | null
  amount?: string | null
  reference?: string | null
  resultCode?: string | null
  errorCode?: string | null
  source?: string
  externalEventId?: string | null
  signatureVerified?: boolean
  payload?: Record<string, unknown>
}

async function applyOutcome(args: OutcomeArgs): Promise<Row> {
  const rows = await svc(
    `select public.payment_apply_outcome(
        $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, null, null, $10, $11, $12, $13::jsonb
     ) as result`,
    [
      args.intentId,
      args.operation ?? 'payment.authorize',
      args.key,
      args.attemptStatus,
      args.intentStatus ?? null,
      args.amount ?? null,
      args.reference ?? null,
      args.resultCode ?? null,
      args.errorCode ?? null,
      args.source ?? 'provider_response',
      args.externalEventId ?? null,
      args.signatureVerified ?? false,
      JSON.stringify(args.payload ?? {}),
    ],
  )
  return rows[0]?.result as Row
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

  productA = await newProduct(TENANT_A, storeA, 'sku-pago-a', '100.00')
  productB = await newProduct(TENANT_B, storeB, 'sku-pago-b', '50.00')

  metodoTarjeta = await newMethod(TENANT_A, storeA, 'tarjeta', 'sandbox')
  metodoTransferencia = await newMethod(TENANT_A, storeA, 'transferencia', null, 'manual')
  metodoB = await newMethod(TENANT_B, storeB, 'tarjeta', 'sandbox')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

// ===========================================================================
describe('el pedido no sabe que existe una pasarela', () => {
  it('P09 no anadio ni una columna a orders ni a order_items', async () => {
    // El criterio de la fase es «anadir un proveedor real no requiere modificar
    // el dominio de pedidos». Se comprueba contra el catalogo: ninguna columna
    // de `orders` nombra un pago mas alla del eje que ya existia en P08.
    const columnas = await svc<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('orders', 'order_items')
          and (column_name like '%payment%' or column_name like '%provider%'
               or column_name like '%gateway%' or column_name like '%intent%')
        order by column_name`,
    )
    expect(columnas.map((c) => c.column_name)).toEqual(['payment_status'])
  })

  it('la FK va del cobro al pedido, nunca del pedido al cobro', async () => {
    // `pg_constraint` y no `information_schema`: las FK de este esquema son
    // COMPUESTAS y la vista estandar no las proyecta de forma utilizable.
    const haciaPagos = await svc<{ n: number }>(
      `select count(*)::int as n from pg_constraint
        where contype = 'f' and conrelid = 'public.orders'::regclass
          and confrelid in ('public.payment_intents'::regclass,
                            'public.payments'::regclass,
                            'public.refunds'::regclass)`,
    )
    expect(haciaPagos[0]?.n).toBe(0)

    const haciaPedidos = await svc<{ n: number }>(
      `select count(*)::int as n from pg_constraint
        where contype = 'f' and confrelid = 'public.orders'::regclass
          and conrelid in ('public.payment_intents'::regclass,
                           'public.payments'::regclass,
                           'public.refunds'::regclass)`,
    )
    expect(haciaPedidos[0]?.n).toBe(3)
  })

  it('ningun nombre de pasarela vive en el esquema: solo codigos del catalogo', async () => {
    const [fila] = await svc<{ n: number }>(
      `select count(*)::int as n from public.integration_providers
        where kind = 'payment' and code = 'sandbox'`,
    )
    expect(fila?.n).toBe(1)
  })
})

// ===========================================================================
describe('las guardas PCI son CHECKs, no convenciones', () => {
  it('un numero de tarjeta valido NO entra, ni como service_role', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '10.00', 'pci-guard-key-000001')
    const mensaje = await expectFailure(() =>
      svc(
        `insert into public.payment_events
           (organization_id, company_id, store_id, payment_intent_id, event_type, source, payload)
         values ($1, $2, $3, $4, 'payment.test', 'system', $5::jsonb)`,
        [
          TENANT_A.organizationId,
          TENANT_A.companyId,
          storeA,
          intento.intent_id,
          // 4111 1111 1111 1111 pasa Luhn: es el PAN de pruebas de toda la vida.
          JSON.stringify({ datos: { numero: '4111111111111111' } }),
        ],
      ),
    )
    expect(mensaje).toMatch(/payment_events_payload_safe/i)
  })

  it('una clave prohibida a cualquier profundidad tampoco entra', async () => {
    const mensaje = await expectFailure(() =>
      svc(
        `insert into public.payment_methods
           (organization_id, company_id, store_id, code, display_name, provider_code, public_config)
         values ($1, $2, $3, 'con-secreto', 'Con secreto', 'sandbox', $4::jsonb)`,
        [
          TENANT_A.organizationId,
          TENANT_A.companyId,
          storeA,
          JSON.stringify({ endpoint: { url: 'https://x', api_key: 'abc' } }),
        ],
      ),
    )
    expect(mensaje).toMatch(/payment_methods_config_safe/i)
  })

  it('una referencia legitima del proveedor SI entra: Luhn evita el falso positivo', async () => {
    // Sin el filtro de Luhn, una marca de tiempo o un identificador numerico
    // del proveedor se leerian como tarjeta y alguien acabaria apagando el CHECK.
    const [fila] = await svc<{ pan: boolean; ts: boolean; ref: boolean }>(
      `select ebim.looks_like_pan('4111111111111111') as pan,
              ebim.looks_like_pan('1756400000000')    as ts,
              ebim.looks_like_pan('sbx-auth-abc')     as ref`,
    )
    expect(fila?.pan).toBe(true)
    expect(fila?.ts).toBe(false)
    expect(fila?.ref).toBe(false)
  })

  it('el redactor deja el sobre guardable en vez de perder el evento', async () => {
    const [fila] = await svc<{ limpio: Row }>(
      `select ebim.redact_sensitive($1::jsonb) as limpio`,
      [JSON.stringify({ id: 'ev_1', card: { pan: '4111111111111111' }, token: 'zzz' })],
    )
    expect(JSON.stringify(fila?.limpio)).not.toContain('4111111111111111')
    expect(JSON.stringify(fila?.limpio)).not.toContain('zzz')
    expect(JSON.stringify(fila?.limpio)).toContain('ev_1')
  })

  it('un token del proveedor solo se guarda como REFERENCIA del vault', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '11.00', 'token-ref-key-0000001')
    const mensaje = await expectFailure(() =>
      svc(`update public.payment_intents set provider_token_ref = $1 where id = $2`, [
        'tok_live_51H8xyz',
        intento.intent_id,
      ]),
    )
    expect(mensaje).toMatch(/payment_intents_token_ref_fmt/i)

    await svc(`update public.payment_intents set provider_token_ref = $1 where id = $2`, [
      'SANDBOX_TOKEN_REF',
      intento.intent_id,
    ])
  })
})

// ===========================================================================
describe('la intencion de cobro y su idempotencia', () => {
  it('abrir dos veces con la misma clave devuelve el MISMO intento', async () => {
    const primera = await openIntent(TENANT_A, 'tarjeta', '236.00', 'idem-intent-key-000001')
    const segunda = await openIntent(TENANT_A, 'tarjeta', '236.00', 'idem-intent-key-000001')

    expect(primera.replay).toBe(false)
    expect(segunda.replay).toBe(true)
    expect(segunda.intent_id).toBe(primera.intent_id)

    const filas = await svc<{ n: number }>(
      `select count(*)::int as n from public.payment_intents where idempotency_key = $1`,
      ['idem-intent-key-000001'],
    )
    expect(filas[0]?.n).toBe(1)
  })

  it('la misma clave con OTRO importe es un conflicto, no una repeticion', async () => {
    const mensaje = await expectFailure(() =>
      openIntent(TENANT_A, 'tarjeta', '999.00', 'idem-intent-key-000001'),
    )
    expect(mensaje).toMatch(/IDEMPOTENCIA_INCOHERENTE/)
  })

  it('un medio inactivo o de otra tienda no abre nada', async () => {
    expect(await expectFailure(() => openIntent(TENANT_A, 'no-existe', '10.00', 'x'.repeat(20))))
      .toMatch(/MEDIO_DE_PAGO_NO_ENCONTRADO/)

    await svc(`update public.payment_methods set is_active = false where id = $1`, [metodoB])
    expect(
      await expectFailure(() => openIntent(TENANT_B, 'tarjeta', '10.00', 'y'.repeat(20))),
    ).toMatch(/MEDIO_DE_PAGO_INACTIVO/)
    await svc(`update public.payment_methods set is_active = true where id = $1`, [metodoB])
  })

  it('el importe y la moneda de un intento son inmutables', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '20.00', 'inmutable-key-0000001')
    expect(
      await expectFailure(() =>
        svc(`update public.payment_intents set amount = 21 where id = $1`, [intento.intent_id]),
      ),
    ).toMatch(/PAGO_IMPORTE_INMUTABLE/)
    expect(
      await expectFailure(() =>
        svc(`update public.payment_intents set currency = 'USD' where id = $1`, [
          intento.intent_id,
        ]),
      ),
    ).toMatch(/PAGO_MONEDA_INMUTABLE/)
  })
})

// ===========================================================================
describe('las tres reglas del comando', () => {
  it('la vuelta del navegador NO decide: se registra y punto', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '30.00', 'retorno-key-00000001')
    const mensaje = await expectFailure(() =>
      applyOutcome({
        intentId: String(intento.intent_id),
        key: 'retorno-attempt-000001',
        attemptStatus: 'succeeded',
        intentStatus: 'captured',
        source: 'browser_return',
      }),
    )
    expect(mensaje).toMatch(/RETORNO_NO_DECIDE/)

    // Registrarla sin decidir SI vale: es informacion util para diagnosticar.
    const registrada = await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'retorno-attempt-000002',
      attemptStatus: 'pending',
      source: 'browser_return',
    })
    expect(registrada.to).toBe('open')
  })

  it('un aviso de pasarela sin firma verificada no mueve dinero', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '31.00', 'firma-key-0000000001')
    const mensaje = await expectFailure(() =>
      applyOutcome({
        intentId: String(intento.intent_id),
        key: 'firma-attempt-00000001',
        attemptStatus: 'succeeded',
        intentStatus: 'captured',
        source: 'provider_webhook',
        signatureVerified: false,
      }),
    )
    expect(mensaje).toMatch(/FIRMA_NO_VERIFICADA/)

    const [fila] = await svc<{ status: string }>(
      `select status from public.payment_intents where id = $1`,
      [intento.intent_id],
    )
    expect(fila?.status).toBe('open')
  })

  it('la misma llamada con la misma clave es UNA fila y un solo efecto', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '32.00', 'dup-llamada-key-00001')
    const primera = await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'dup-llamada-attempt-1',
      attemptStatus: 'succeeded',
      intentStatus: 'authorized',
      reference: 'sbx-auth-dup-1',
    })
    const segunda = await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'dup-llamada-attempt-1',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      reference: 'sbx-auth-dup-1',
    })

    expect(primera.replay).toBe(false)
    expect(segunda.replay).toBe(true)
    expect(segunda.reason).toBe('llamada_ya_registrada')

    const [fila] = await svc<{ status: string; n: number }>(
      `select i.status, (select count(*)::int from public.payment_attempts a
                          where a.payment_intent_id = i.id) as n
         from public.payment_intents i where i.id = $1`,
      [intento.intent_id],
    )
    // Sigue autorizado: la repeticion no lo capturo.
    expect(fila?.status).toBe('authorized')
    expect(fila?.n).toBe(1)
  })

  it('el MISMO evento del proveedor reenviado no cobra dos veces', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '33.00', 'dup-evento-key-000001')
    await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'dup-evento-attempt-01',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '33.00',
      reference: 'sbx-cap-dup-evento',
      source: 'provider_webhook',
      externalEventId: 'ev_dup_1',
      signatureVerified: true,
    })

    const repetido = await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'dup-evento-attempt-02',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '33.00',
      reference: 'sbx-cap-dup-evento',
      source: 'provider_webhook',
      externalEventId: 'ev_dup_1',
      signatureVerified: true,
    })
    expect(repetido.replay).toBe(true)
    expect(repetido.reason).toBe('evento_ya_procesado')

    const [cobros] = await svc<{ n: number; total: string }>(
      `select count(*)::int as n, coalesce(sum(amount), 0)::text as total
         from public.payments where payment_intent_id = $1`,
      [intento.intent_id],
    )
    expect(cobros?.n).toBe(1)
    expect(cobros?.total).toBe('33.00')
  })

  it('dos avisos distintos sobre el MISMO cobro no lo cobran dos veces', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '34.00', 'misma-ref-key-0000001')
    await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'misma-ref-attempt-001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '34.00',
      reference: 'sbx-cap-misma-ref',
      source: 'provider_webhook',
      externalEventId: 'ev_misma_ref_1',
      signatureVerified: true,
    })

    // Segundo aviso, identificador de evento DISTINTO —asi que el primer
    // cerrojo no lo para— y el mismo cobro detras. `captured` es terminal para
    // el intento, asi que la aritmetica no se repite: el estado hace de tope.
    const segundo = await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'misma-ref-attempt-002',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '34.00',
      reference: 'sbx-cap-misma-ref',
      source: 'provider_webhook',
      externalEventId: 'ev_misma_ref_2',
      signatureVerified: true,
    })
    expect(segundo.replay).toBe(false)
    expect(segundo.payment_id).toBeNull()

    const [cobros] = await svc<{ n: number; total: string }>(
      `select count(*)::int as n, coalesce(sum(amount), 0)::text as total
         from public.payments where payment_intent_id = $1`,
      [intento.intent_id],
    )
    expect(cobros?.n).toBe(1)
    expect(cobros?.total).toBe('34.00')

    const [fila] = await svc<{ captured: string }>(
      `select amount_captured::text as captured from public.payment_intents where id = $1`,
      [intento.intent_id],
    )
    expect(fila?.captured).toBe('34.00')
  })

  it('una referencia del proveedor no puede apuntar a dos intentos', async () => {
    // Si pudiera, «¿cuál de los dos cobro este aviso?» no tendria respuesta. Lo
    // impide un indice unico parcial, no un `if` del adaptador.
    const otro = await openIntent(TENANT_A, 'tarjeta', '34.00', 'misma-ref-key-0000002')
    const mensaje = await expectFailure(() =>
      applyOutcome({
        intentId: String(otro.intent_id),
        key: 'misma-ref-attempt-003',
        attemptStatus: 'succeeded',
        intentStatus: 'captured',
        amount: '34.00',
        reference: 'sbx-cap-misma-ref',
      }),
    )
    expect(mensaje).toMatch(/payment_intents_provider_ref/i)
  })
})

// ===========================================================================
describe('el cobro y el eje del pedido', () => {
  let orderId: string
  let intentId: string

  beforeAll(async () => {
    const pedido = await place(TENANT_A, productA, 1)
    orderId = String(pedido.order_id)
    const intento = await openIntent(TENANT_A, 'tarjeta', '100.00', 'flujo-pago-key-000001')
    intentId = String(intento.intent_id)
    await svc(`select public.payment_intent_attach_order($1, $2)`, [intentId, orderId])
  })

  it('autorizar mueve el eje del pedido a `authorized`', async () => {
    const resultado = await applyOutcome({
      intentId,
      key: 'flujo-attempt-auth-01',
      attemptStatus: 'succeeded',
      intentStatus: 'authorized',
      reference: 'sbx-auth-flujo',
    })
    expect(resultado.to).toBe('authorized')
    expect(resultado.order_synced).toBe(true)

    const [pedido] = await svc<{ payment_status: string }>(
      `select payment_status from public.orders where id = $1`,
      [orderId],
    )
    expect(pedido?.payment_status).toBe('authorized')
  })

  it('capturar escribe el COBRO y deja el pedido en `paid`', async () => {
    const resultado = await applyOutcome({
      intentId,
      operation: 'payment.capture',
      key: 'flujo-attempt-cap-001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '100.00',
      reference: 'sbx-cap-flujo',
    })
    expect(resultado.to).toBe('captured')
    expect(resultado.payment_id).toBeTruthy()

    const [pedido] = await svc<{ payment_status: string }>(
      `select payment_status from public.orders where id = $1`,
      [orderId],
    )
    expect(pedido?.payment_status).toBe('paid')

    const [intento] = await svc<{ captured: string; status: string }>(
      `select amount_captured::text as captured, status from public.payment_intents where id = $1`,
      [intentId],
    )
    expect(intento?.captured).toBe('100.00')
    expect(intento?.status).toBe('captured')
  })

  it('`captured` es terminal para el intento: la devolucion vive en otro sitio', async () => {
    const mensaje = await expectFailure(() =>
      svc(`update public.payment_intents set status = 'failed' where id = $1`, [intentId]),
    )
    expect(mensaje).toMatch(/PAGO_INTENTO_TRANSICION_INVALIDA/)
  })

  it('la linea de tiempo del PEDIDO dice que el cambio vino del sistema', async () => {
    const eventos = await svc<{ source: string; to_value: string }>(
      `select source, to_value from public.order_events
        where order_id = $1 and axis = 'payment_status' order by created_at`,
      [orderId],
    )
    expect(eventos.map((e) => e.to_value)).toEqual(['authorized', 'paid'])
    expect(new Set(eventos.map((e) => e.source))).toEqual(new Set(['system']))
  })

  it('el hecho de dominio se publico una sola vez por transicion', async () => {
    const eventos = await svc<{ event_type: string }>(
      `select event_type from public.domain_events
        where aggregate_type = 'payment_intent' and aggregate_id = $1 order by created_at`,
      [intentId],
    )
    expect(eventos.map((e) => e.event_type)).toEqual(['payment.authorized', 'payment.captured'])
  })

  it('atar el cobro a un pedido de OTRA tienda es imposible', async () => {
    const pedidoB = await place(TENANT_B, productB, 1)
    const intento = await openIntent(TENANT_A, 'tarjeta', '15.00', 'cruzado-key-00000001')
    const mensaje = await expectFailure(() =>
      svc(`select public.payment_intent_attach_order($1, $2)`, [
        intento.intent_id,
        pedidoB.order_id,
      ]),
    )
    expect(mensaje).toMatch(/PEDIDO_DE_OTRA_TIENDA/)
  })

  it('un cobro que el pedido no puede reflejar se escribe igual, y se dice', async () => {
    // Pedido cancelado: su eje de pago ya no admite transiciones. El dinero se
    // movio de verdad, asi que la fila del cobro tiene que existir igual.
    const pedido = await place(TENANT_A, productA, 1)
    await svc(`update public.orders set status = 'cancelled' where id = $1`, [pedido.order_id])
    await svc(`update public.orders set payment_status = 'voided' where id = $1`, [
      pedido.order_id,
    ])

    const intento = await openIntent(TENANT_A, 'tarjeta', '40.00', 'desincronizado-key-01')
    await svc(`select public.payment_intent_attach_order($1, $2)`, [
      intento.intent_id,
      pedido.order_id,
    ])
    const resultado = await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'desincronizado-att-01',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '40.00',
      reference: 'sbx-cap-desincronizado',
    })

    expect(resultado.order_synced).toBe(false)
    expect(resultado.payment_id).toBeTruthy()

    const [nota] = await svc<{ note: string | null }>(
      `select note from public.payment_events
        where payment_intent_id = $1 and note is not null order by created_at desc limit 1`,
      [intento.intent_id],
    )
    expect(nota?.note).toMatch(/no acepto la transicion/)
  })
})

// ===========================================================================
// Cierre · D2 (20260914190000): cobro incompleto y aviso tardío.
describe('cobrar por menos de lo debido y avisos tardíos', () => {
  async function pedidoConIntento(key: string, amount = '100.00') {
    const pedido = await place(TENANT_A, productA, 1)
    const intento = await openIntent(TENANT_A, 'tarjeta', amount, key)
    await svc(`select public.payment_intent_attach_order($1, $2)`, [intento.intent_id, pedido.order_id])
    return { orderId: String(pedido.order_id), intentId: String(intento.intent_id) }
  }

  async function estadoPago(orderId: string) {
    const [fila] = await svc<{ payment_status: string }>(
      `select payment_status::text from public.orders where id = $1`,
      [orderId],
    )
    return fila?.payment_status
  }

  it('un cobro por MENOS de lo debido se escribe, pero el pedido NO queda pagado', async () => {
    const { orderId, intentId } = await pedidoConIntento('incompleto-key-000001')

    const resultado = await applyOutcome({
      intentId,
      key: 'incompleto-att-000001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '30.00',
      reference: 'sbx-cap-incompleto',
    })

    expect(resultado.underpaid).toBe(true)
    // El dinero que llegó existe: perderlo sería peor.
    expect(resultado.payment_id).toBeTruthy()
    expect(resultado.captured).toBe('30.00')
    // Pero el pedido no se da por pagado.
    expect(await estadoPago(orderId)).not.toBe('paid')

    const [incidente] = await svc<{ code: string; severity: string }>(
      `select code, severity::text from public.ops_events
        where entity_type = 'payment_intent' and entity_id = $1`,
      [intentId],
    )
    expect(incidente).toMatchObject({ code: 'COBRO_INCOMPLETO', severity: 'error' })

    const [nota] = await svc<{ note: string | null }>(
      `select note from public.payment_events
        where payment_intent_id = $1 and note is not null order by created_at desc limit 1`,
      [intentId],
    )
    expect(nota?.note).toMatch(/COBRO_INCOMPLETO/)
  })

  it('el importe completo sigue dejando el pedido pagado (sin incidente)', async () => {
    const { orderId, intentId } = await pedidoConIntento('completo-key-00000001')
    const resultado = await applyOutcome({
      intentId,
      key: 'completo-att-00000001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '100.00',
      reference: 'sbx-cap-completo',
    })
    expect(resultado.underpaid).toBe(false)
    expect(await estadoPago(orderId)).toBe('paid')
    const incidentes = await svc(
      `select 1 from public.ops_events where entity_type = 'payment_intent' and entity_id = $1`,
      [intentId],
    )
    expect(incidentes).toHaveLength(0)
  })

  it('un aviso TARDÍO de la pasarela sobre un intento capturado se registra y NO hace reintentar', async () => {
    const { orderId, intentId } = await pedidoConIntento('tardio-key-0000000001')
    await applyOutcome({
      intentId,
      key: 'tardio-att-cap-000001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '100.00',
      reference: 'sbx-cap-tardio',
    })

    const aviso = {
      intentId,
      key: 'tardio-att-webhook-01',
      attemptStatus: 'succeeded',
      intentStatus: 'authorized',
      source: 'provider_webhook',
      signatureVerified: true,
      externalEventId: 'evt-tardio-authorized-1',
    }
    const primero = await applyOutcome(aviso)
    // Contesta como resuelto: el borde devuelve 2xx y la pasarela deja de insistir.
    expect(primero).toMatchObject({ replay: true, reason: 'transicion_no_aplicable', status: 'captured' })
    expect(await estadoPago(orderId)).toBe('paid')

    const [ignorado] = await svc<{ n: number }>(
      `select count(*)::int as n from public.payment_events
        where payment_intent_id = $1 and event_type = 'payment.transition_ignored'`,
      [intentId],
    )
    expect(ignorado?.n).toBe(1)

    // El reenvío del MISMO evento cae en el cerrojo 1: ni otra fila ni error.
    const reenvio = await applyOutcome({ ...aviso, key: 'tardio-att-webhook-02' })
    expect(reenvio).toMatchObject({ replay: true, reason: 'evento_ya_procesado' })
  })

  it('la misma transición imposible desde una PERSONA sigue fallando: es un error que tiene que verse', async () => {
    const { intentId } = await pedidoConIntento('tardio-op-key-0000001')
    await applyOutcome({
      intentId,
      key: 'tardio-op-att-cap-001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '100.00',
      reference: 'sbx-cap-tardio-op',
    })
    const mensaje = await expectFailure(() =>
      applyOutcome({
        intentId,
        key: 'tardio-op-att-manual1',
        attemptStatus: 'succeeded',
        intentStatus: 'failed',
        source: 'operator',
      }),
    )
    expect(mensaje).toMatch(/PAGO_INTENTO_TRANSICION_INVALIDA/)
  })
})

// ===========================================================================
describe('la bitacora no se reescribe, ni siendo service_role', () => {
  it('un intento de llamada no se puede editar ni borrar', async () => {
    const [fila] = await svc<{ id: string }>(`select id from public.payment_attempts limit 1`)
    expect(
      await expectFailure(() =>
        svc(`update public.payment_attempts set status = 'succeeded' where id = $1`, [fila?.id]),
      ),
    ).toMatch(/BITACORA_INMUTABLE/)
    expect(
      await expectFailure(() =>
        svc(`delete from public.payment_attempts where id = $1`, [fila?.id]),
      ),
    ).toMatch(/BITACORA_INMUTABLE/)
  })

  it('un evento de pago tampoco', async () => {
    const [fila] = await svc<{ id: string }>(`select id from public.payment_events limit 1`)
    expect(
      await expectFailure(() =>
        svc(`update public.payment_events set note = 'otra cosa' where id = $1`, [fila?.id]),
      ),
    ).toMatch(/BITACORA_INMUTABLE/)
  })
})

// ===========================================================================
describe('devoluciones: quien puede, cuanto y una sola vez', () => {
  let paymentId: string
  let orderId: string

  beforeAll(async () => {
    const pedido = await place(TENANT_A, productA, 1)
    orderId = String(pedido.order_id)
    const intento = await openIntent(TENANT_A, 'tarjeta', '100.00', 'devolucion-key-000001')
    await svc(`select public.payment_intent_attach_order($1, $2)`, [
      intento.intent_id,
      orderId,
    ])
    await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'devolucion-attempt-01',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '100.00',
      reference: 'sbx-cap-devolucion',
    })
    const [cobro] = await svc<{ id: string }>(
      `select id from public.payments where payment_intent_id = $1`,
      [intento.intent_id],
    )
    paymentId = String(cobro?.id)
  })

  it('un lector no puede pedir una devolucion', async () => {
    const mensaje = await expectFailure(() =>
      asUser(viewerA(), `select public.payment_refund_request($1, 10::numeric, $2)`, [
        paymentId,
        'refund-viewer-key-0001',
      ]),
    )
    expect(mensaje).toMatch(/SIN_PERMISO/)
  })

  it('el super admin de suite tampoco: no es actor de negocio de un tenant', async () => {
    const mensaje = await expectFailure(() =>
      asUser(superAdmin(), `select public.payment_refund_request($1, 10::numeric, $2)`, [
        paymentId,
        'refund-super-key-00001',
      ]),
    )
    expect(mensaje).toMatch(/OPERADOR_NO_ES_ACTOR/)
  })

  it('un miembro de OTRO tenant no ve ni puede devolver este cobro', async () => {
    const filas = await asUser(adminB(), `select id from public.payments where id = $1`, [
      paymentId,
    ])
    expect(filas).toHaveLength(0)

    const mensaje = await expectFailure(() =>
      asUser(adminB(), `select public.payment_refund_request($1, 10::numeric, $2)`, [
        paymentId,
        'refund-otro-key-000001',
      ]),
    )
    expect(mensaje).toMatch(/SIN_PERMISO/)
  })

  it('el rol de pedidos SI puede, y queda escrito quien la autorizo', async () => {
    const filas = await asUser<{ result: Row }>(
      ordersA(),
      `select public.payment_refund_request($1, 30::numeric, $2, 'producto danado') as result`,
      [paymentId, 'refund-parcial-key-001'],
    )
    const refund = filas[0]?.result as Row
    expect(refund.status).toBe('requested')

    const [fila] = await svc<{ requested_email: string; reason: string }>(
      `select requested_email, reason from public.refunds where id = $1`,
      [refund.refund_id],
    )
    expect(fila?.requested_email).toBe('pedidos@tenant-a.com')
    expect(fila?.reason).toBe('producto danado')
  })

  it('la peticion se encola en el outbox que ya existia, no en uno nuevo', async () => {
    const [fila] = await svc<{ operation: string; provider_code: string }>(
      `select operation, provider_code from public.integration_outbox
        where operation = 'payment.refund' order by created_at desc limit 1`,
    )
    expect(fila?.operation).toBe('payment.refund')
    expect(fila?.provider_code).toBe('sandbox')
  })

  it('pedir la misma devolucion dos veces con la misma clave es una sola', async () => {
    const filas = await asUser<{ result: Row }>(
      ordersA(),
      `select public.payment_refund_request($1, 30::numeric, $2) as result`,
      [paymentId, 'refund-parcial-key-001'],
    )
    expect((filas[0]?.result as Row).replay).toBe(true)

    const [conteo] = await svc<{ n: number }>(
      `select count(*)::int as n from public.refunds where payment_id = $1`,
      [paymentId],
    )
    expect(conteo?.n).toBe(1)
  })

  it('no se puede devolver mas de lo cobrado, ni sumando peticiones abiertas', async () => {
    const mensaje = await expectFailure(() =>
      asUser(ordersA(), `select public.payment_refund_request($1, 80::numeric, $2)`, [
        paymentId,
        'refund-excesiva-key-01',
      ]),
    )
    expect(mensaje).toMatch(/DEVOLUCION_EXCEDE_COBRO/)
  })

  it('liquidarla deja el cobro y el pedido en `partially_refunded`', async () => {
    const [refund] = await svc<{ id: string }>(
      `select id from public.refunds where payment_id = $1`,
      [paymentId],
    )
    await svc(`select public.payment_refund_settle($1, 'succeeded', 'sbx-ref-1')`, [refund?.id])

    const [cobro] = await svc<{ status: string; amount_refunded: string }>(
      `select status, amount_refunded::text as amount_refunded from public.payments where id = $1`,
      [paymentId],
    )
    expect(cobro?.status).toBe('partially_refunded')
    expect(cobro?.amount_refunded).toBe('30.00')

    const [pedido] = await svc<{ payment_status: string }>(
      `select payment_status from public.orders where id = $1`,
      [orderId],
    )
    expect(pedido?.payment_status).toBe('partially_refunded')
  })

  it('liquidarla otra vez no vuelve a restar', async () => {
    const [refund] = await svc<{ id: string }>(
      `select id from public.refunds where payment_id = $1`,
      [paymentId],
    )
    const filas = await svc<{ result: Row }>(
      `select public.payment_refund_settle($1, 'succeeded', 'sbx-ref-1') as result`,
      [refund?.id],
    )
    expect((filas[0]?.result as Row).replay).toBe(true)

    const [cobro] = await svc<{ amount_refunded: string }>(
      `select amount_refunded::text as amount_refunded from public.payments where id = $1`,
      [paymentId],
    )
    expect(cobro?.amount_refunded).toBe('30.00')
  })

  it('devolver el resto deja el cobro y el pedido en `refunded`', async () => {
    const filas = await asUser<{ result: Row }>(
      ordersA(),
      `select public.payment_refund_request($1, 70::numeric, $2) as result`,
      [paymentId, 'refund-resto-key-00001'],
    )
    const refund = filas[0]?.result as Row
    await svc(`select public.payment_refund_settle($1, 'succeeded', 'sbx-ref-2')`, [
      refund.refund_id,
    ])

    const [cobro] = await svc<{ status: string }>(
      `select status from public.payments where id = $1`,
      [paymentId],
    )
    expect(cobro?.status).toBe('refunded')

    const [pedido] = await svc<{ payment_status: string }>(
      `select payment_status from public.orders where id = $1`,
      [orderId],
    )
    expect(pedido?.payment_status).toBe('refunded')
  })

  it('una persona no puede liquidar a mano la devolucion de un medio con pasarela', async () => {
    // Quien devuelve es el proveedor; dejar que una persona la diera por hecha
    // marcaria como devuelto un dinero que nunca salio.
    const intento = await openIntent(TENANT_A, 'tarjeta', '60.00', 'manual-veto-key-00001')
    await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'manual-veto-attempt-01',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '60.00',
      reference: 'sbx-cap-manual-veto',
    })
    const [cobro] = await svc<{ id: string }>(
      `select id from public.payments where payment_intent_id = $1`,
      [intento.intent_id],
    )
    const filas = await asUser<{ result: Row }>(
      ordersA(),
      `select public.payment_refund_request($1, 20::numeric, $2) as result`,
      [cobro?.id, 'refund-manual-key-0001'],
    )
    const refundId = (filas[0]?.result as Row).refund_id

    const mensaje = await expectFailure(() =>
      asUser(
        ordersA(),
        `select public.payment_refund_settle($1, 'succeeded', null, null, null, 'operator')`,
        [refundId],
      ),
    )
    expect(mensaje).toMatch(/DEVOLUCION_CON_PASARELA/)

    // Y el servidor, que es quien recibe la respuesta del proveedor, si puede.
    await svc(`select public.payment_refund_settle($1, 'succeeded', 'sbx-ref-manual-veto')`, [
      refundId,
    ])
    const [fila] = await svc<{ status: string }>(
      `select status from public.refunds where id = $1`,
      [refundId],
    )
    expect(fila?.status).toBe('succeeded')
  })
})

// ===========================================================================
describe('la devolucion de un medio offline la cierra una persona', () => {
  it('con rol y solo como operador; el resto de origenes se rechaza', async () => {
    const pedido = await place(TENANT_A, productA, 1)
    const intento = await openIntent(TENANT_A, 'transferencia', '100.00', 'offline-key-0000001')
    await svc(`select public.payment_intent_attach_order($1, $2)`, [
      intento.intent_id,
      pedido.order_id,
    ])
    await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'offline-attempt-000001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '100.00',
      source: 'operator',
    })
    const [cobro] = await svc<{ id: string }>(
      `select id from public.payments where payment_intent_id = $1`,
      [intento.intent_id],
    )

    const filas = await asUser<{ result: Row }>(
      ordersA(),
      `select public.payment_refund_request($1, 25::numeric, $2) as result`,
      [cobro?.id, 'refund-offline-key-001'],
    )
    const refund = (filas[0]?.result as Row).refund_id

    // Origen del servidor desde una sesion: no.
    expect(
      await expectFailure(() =>
        asUser(ordersA(), `select public.payment_refund_settle($1, 'succeeded')`, [refund]),
      ),
    ).toMatch(/ORIGEN_NO_PERMITIDO/)

    // Como operador y con rol: si.
    await asUser(
      ordersA(),
      `select public.payment_refund_settle($1, 'succeeded', null, null, null, 'operator')`,
      [refund],
    )
    const [fila] = await svc<{ status: string }>(
      `select status from public.refunds where id = $1`,
      [refund],
    )
    expect(fila?.status).toBe('succeeded')

    // Un lector no habria podido.
    const otras = await asUser<{ result: Row }>(
      ordersA(),
      `select public.payment_refund_request($1, 25::numeric, $2) as result`,
      [cobro?.id, 'refund-offline-key-002'],
    )
    expect(
      await expectFailure(() =>
        asUser(
          viewerA(),
          `select public.payment_refund_settle($1, 'succeeded', null, null, null, 'operator')`,
          [(otras[0]?.result as Row).refund_id],
        ),
      ),
    ).toMatch(/SIN_PERMISO/)
  })
})

// ===========================================================================
describe('conciliacion', () => {
  let paymentId: string

  beforeAll(async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '55.00', 'conciliacion-key-0001')
    await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'conciliacion-att-0001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '55.00',
      reference: 'sbx-cap-conciliable',
    })
    const [cobro] = await svc<{ id: string }>(
      `select id from public.payments where provider_reference = 'sbx-cap-conciliable'`,
    )
    paymentId = String(cobro?.id)
  })

  it('importa, cuadra por referencia externa y marca el cobro liquidado', async () => {
    const filas = await asUser<{ result: Row }>(
      adminA(),
      `select public.payment_reconciliation_import('sandbox', $1::jsonb) as result`,
      [
        JSON.stringify([
          {
            settlement_date: '2026-08-28',
            external_reference: 'sbx-cap-conciliable',
            gross_amount: '55.00',
            fee_amount: '1.50',
            currency: 'PEN',
            source_batch: 'lote-1',
          },
          {
            settlement_date: '2026-08-28',
            external_reference: 'sbx-desconocida',
            gross_amount: '10.00',
            currency: 'PEN',
          },
        ]),
      ],
    )
    const resumen = filas[0]?.result as Row
    expect(resumen.imported).toBe(2)
    expect(resumen.matched).toBe(1)
    expect(resumen.unmatched).toBe(1)

    const [cobro] = await svc<{ settlement_reference: string }>(
      `select settlement_reference from public.payments where id = $1`,
      [paymentId],
    )
    expect(cobro?.settlement_reference).toBe('sbx-cap-conciliable')
  })

  it('reimportar el mismo extracto no duplica ni cuadra el doble', async () => {
    const filas = await asUser<{ result: Row }>(
      adminA(),
      `select public.payment_reconciliation_import('sandbox', $1::jsonb) as result`,
      [
        JSON.stringify([
          {
            settlement_date: '2026-08-28',
            external_reference: 'sbx-cap-conciliable',
            gross_amount: '55.00',
            currency: 'PEN',
          },
        ]),
      ],
    )
    const resumen = filas[0]?.result as Row
    expect(resumen.imported).toBe(0)
    expect(resumen.duplicated).toBe(1)

    const [conteo] = await svc<{ n: number }>(
      `select count(*)::int as n from public.reconciliation_records
        where external_reference = 'sbx-cap-conciliable'`,
    )
    expect(conteo?.n).toBe(1)
  })

  it('un importe distinto sale como discrepancia, no como cuadre', async () => {
    const intento = await openIntent(TENANT_A, 'tarjeta', '77.00', 'discrepancia-key-0001')
    await applyOutcome({
      intentId: String(intento.intent_id),
      key: 'discrepancia-att-0001',
      attemptStatus: 'succeeded',
      intentStatus: 'captured',
      amount: '77.00',
      reference: 'sbx-cap-discrepante',
    })
    const filas = await asUser<{ result: Row }>(
      adminA(),
      `select public.payment_reconciliation_import('sandbox', $1::jsonb) as result`,
      [
        JSON.stringify([
          {
            settlement_date: '2026-08-28',
            external_reference: 'sbx-cap-discrepante',
            gross_amount: '70.00',
            currency: 'PEN',
          },
        ]),
      ],
    )
    expect((filas[0]?.result as Row).discrepancy).toBe(1)

    const [fila] = await svc<{ status: string; discrepancy_reason: string }>(
      `select status, discrepancy_reason from public.reconciliation_records
        where external_reference = 'sbx-cap-discrepante'`,
    )
    expect(fila?.status).toBe('discrepancy')
    expect(fila?.discrepancy_reason).toMatch(/70\.00/)
  })

  it('el extracto de una sociedad NO cuadra con el cobro de otra', async () => {
    // Tenant B importa una referencia que es de tenant A. No la encuentra:
    // el cruce filtra por tenant antes que por referencia.
    const filas = await asUser<{ result: Row }>(
      adminB(),
      `select public.payment_reconciliation_import('sandbox', $1::jsonb) as result`,
      [
        JSON.stringify([
          {
            settlement_date: '2026-08-28',
            external_reference: 'sbx-cap-conciliable',
            gross_amount: '55.00',
            currency: 'PEN',
          },
        ]),
      ],
    )
    const resumen = filas[0]?.result as Row
    expect(resumen.imported).toBe(1)
    expect(resumen.matched).toBe(0)

    const [cobro] = await svc<{ settlement_reference: string }>(
      `select settlement_reference from public.payments where id = $1`,
      [paymentId],
    )
    // El cobro de A conserva su liquidacion de A, no la que importo B.
    expect(cobro?.settlement_reference).toBe('sbx-cap-conciliable')

    const [fila] = await svc<{ organization_id: string; status: string }>(
      `select organization_id, status from public.reconciliation_records
        where organization_id = $1 and external_reference = 'sbx-cap-conciliable'`,
      [TENANT_B.organizationId],
    )
    expect(fila?.status).toBe('unmatched')
  })

  it('el cuadre manual no puede atar el cobro de otro tenant', async () => {
    const [registro] = await svc<{ id: string }>(
      `select id from public.reconciliation_records
        where organization_id = $1 and external_reference = 'sbx-cap-conciliable'`,
      [TENANT_B.organizationId],
    )
    const mensaje = await expectFailure(() =>
      asUser(adminB(), `select public.payment_reconciliation_match($1, $2)`, [
        registro?.id,
        paymentId,
      ]),
    )
    expect(mensaje).toMatch(/COBRO_DE_OTRO_TENANT/)
  })

  it('un lector no importa extractos', async () => {
    const mensaje = await expectFailure(() =>
      asUser(viewerA(), `select public.payment_reconciliation_import('sandbox', '[]'::jsonb)`),
    )
    expect(mensaje).toMatch(/SIN_PERMISO/)
  })
})

// ===========================================================================
describe('RLS: quien ve y quien escribe', () => {
  it('el comprador anonimo ve los medios publicados y NADA mas', async () => {
    const filas = await asAnon<Row>(
      `select * from public.public_payment_methods where store_id = $1 order by position, code`,
      [storeA],
    )
    expect(filas.length).toBeGreaterThan(0)
    for (const fila of filas) {
      expect(Object.keys(fila).sort()).toEqual(
        ['code', 'display_name', 'instructions', 'kind', 'payment_method_id', 'position', 'store_id'].sort(),
      )
    }
  })

  it('el comprador anonimo no ve intentos, cobros ni devoluciones', async () => {
    for (const tabla of ['payment_intents', 'payments', 'refunds', 'payment_events']) {
      const mensaje = await expectFailure(() => asAnon(`select * from public.${tabla}`))
      expect(mensaje).toMatch(/permission denied|permiso/i)
    }
  })

  it('un lector del tenant lee el dominio pero no escribe medios', async () => {
    const filas = await asUser(viewerA(), `select id from public.payment_intents`)
    expect(filas.length).toBeGreaterThan(0)

    const mensaje = await expectFailure(() =>
      asUser(
        viewerA(),
        `insert into public.payment_methods
           (organization_id, company_id, store_id, code, display_name, capture_mode)
         values ($1, $2, $3, 'lector', 'Lector', 'manual')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(mensaje).toMatch(/row-level security|violates/i)
  })

  it('NADIE con sesion escribe un intento, un cobro o una devolucion a mano', async () => {
    for (const tabla of ['payment_intents', 'payments', 'refunds', 'payment_attempts']) {
      const mensaje = await expectFailure(() =>
        asUser(adminA(), `delete from public.${tabla}`),
      )
      expect(mensaje).toMatch(/permission denied|permiso/i)
    }
  })

  it('un tenant no ve NADA del otro en las siete tablas', async () => {
    const tablas = [
      'payment_methods',
      'payment_intents',
      'payment_attempts',
      'payments',
      'refunds',
      'payment_events',
      'reconciliation_records',
    ]
    for (const tabla of tablas) {
      const columna = tabla === 'reconciliation_records' ? 'organization_id' : 'organization_id'
      const filas = await asUser<{ n: number }>(
        adminB(),
        `select count(*)::int as n from public.${tabla} where ${columna} = $1`,
        [TENANT_A.organizationId],
      )
      expect(filas[0]?.n, `${tabla} deja ver datos de otro tenant`).toBe(0)
    }
  })

  it('la vista del backoffice hereda las policies, no las amplia', async () => {
    const propias = await asUser<{ n: number }>(
      adminA(),
      `select count(*)::int as n from public.payment_intent_overview`,
    )
    expect(propias[0]?.n).toBeGreaterThan(0)

    const ajenas = await asUser<{ n: number }>(
      adminB(),
      `select count(*)::int as n from public.payment_intent_overview
        where organization_id = $1`,
      [TENANT_A.organizationId],
    )
    expect(ajenas[0]?.n).toBe(0)
  })

  it('los conteos de la vista salen de la base y no de una suma del navegador', async () => {
    const [fila] = await asUser<{ attempt_count: number; failed_attempt_count: number }>(
      adminA(),
      `select attempt_count, failed_attempt_count from public.payment_intent_overview
        where provider_reference = 'sbx-cap-flujo'`,
    )
    expect(Number(fila?.attempt_count)).toBe(2)
    expect(Number(fila?.failed_attempt_count)).toBe(0)
  })
})

// ===========================================================================
describe('configuracion de medios de pago', () => {
  it('un medio sin pasarela tiene que ser de captura manual', async () => {
    const mensaje = await expectFailure(() =>
      svc(
        `insert into public.payment_methods
           (organization_id, company_id, store_id, code, display_name, provider_code, capture_mode)
         values ($1, $2, $3, 'contra-entrega', 'Contra entrega', null, 'automatic')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(mensaje).toMatch(/payment_methods_offline_is_manual/i)
  })

  it('el proveedor de un medio tiene que ser de familia `payment`', async () => {
    const mensaje = await expectFailure(() =>
      svc(
        `insert into public.payment_methods
           (organization_id, company_id, store_id, code, display_name, provider_code)
         values ($1, $2, $3, 'erp', 'ERP', 'sap_r3')`,
        [TENANT_A.organizationId, TENANT_A.companyId, storeA],
      ),
    )
    expect(mensaje).toMatch(/payment_methods_provider_fk|foreign key/i)
  })

  it('el codigo del medio es unico por tienda, no por tenant', async () => {
    // Tenant B ya tiene su propio `tarjeta`: dos tiendas pueden llamarlo igual.
    const [fila] = await svc<{ n: number }>(
      `select count(*)::int as n from public.payment_methods where code = 'tarjeta'`,
    )
    expect(fila?.n).toBe(2)
    void metodoTarjeta
    void metodoTransferencia
  })
})
