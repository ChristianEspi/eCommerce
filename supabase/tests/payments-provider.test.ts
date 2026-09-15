// @vitest-environment node
/**
 * P09-SaaS · el contrato canonico de pasarela, con puertos falsos.
 *
 * Aqui no hay base de datos: se comprueba la parte del dominio que decide
 * ANTES de escribir nada —que capacidades declara un conector, que sale de un
 * `timeout`, que se hace con un aviso mal firmado— y que el gancho del checkout
 * llama a los comandos con los argumentos correctos.
 *
 * Los cinco casos que el encargo pide por su nombre están todos:
 * **exito, rechazo, tiempo agotado, webhook repetido y devolucion**, mas el
 * aislamiento entre tenants, que se comprueba contra Postgres en
 * `payments.test.ts` porque es ahi donde vive la garantia.
 */
import { describe, expect, it } from 'vitest'
import { createPaymentGateway } from '../functions/_shared/payments/gateway.ts'
import {
  PaymentCapabilityError,
  attemptStatusFor,
  intentStatusFor,
  requireOperation,
  supports,
  type PaymentProvider,
} from '../functions/_shared/payments/provider.ts'
import {
  UnknownPaymentProviderError,
  deployedPaymentProviders,
  hasPaymentProvider,
  registerPaymentProvider,
  resolvePaymentProvider,
} from '../functions/_shared/payments/registry.ts'
import { createSandboxProvider } from '../functions/_shared/payments/sandbox.ts'
import {
  hmacSha256Hex,
  timingSafeEqual,
  verifyHmacSignature,
} from '../functions/_shared/payments/signature.ts'
import {
  ingestPaymentWebhook,
  type WebhookPorts,
} from '../functions/_shared/payments/webhook.ts'

type Call = { fn: string; args: Record<string, unknown> }

const INTENT = '11111111-1111-4111-8111-111111111111'
const ORDER = '22222222-2222-4222-8222-222222222222'

/**
 * Un `RpcCaller` que anota lo que le piden y contesta lo que se le diga. Es lo
 * que permite afirmar «el comando recibio `signature_verified = true`» sin
 * levantar una base entera.
 */
function fakeRpc(responses: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const caller = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ fn, args })
    const canned = responses[fn]
    if (typeof canned === 'function') return (canned as (a: Record<string, unknown>) => unknown)(args)
    return canned ?? {}
  }
  return { calls, caller, of: (fn: string) => calls.filter((c) => c.fn === fn) }
}

const openedIntent = (overrides: Record<string, unknown> = {}) => ({
  intent_id: INTENT,
  status: 'open',
  amount: '100.00',
  currency: 'PEN',
  capture_mode: 'automatic',
  provider_code: 'sandbox',
  method_code: 'tarjeta',
  order_id: null,
  replay: false,
  ...overrides,
})

const request = (overrides: Record<string, unknown> = {}) => ({
  amount: '100.00',
  currency: 'PEN',
  idempotencyKey: 'k'.repeat(32),
  customerEmail: 'ana@compradora.com',
  storeSlug: 'tienda-a',
  methodCode: 'tarjeta' as string | null,
  ...overrides,
})

// ===========================================================================
describe('el conector de pruebas es determinista', () => {
  const sandbox = createSandboxProvider()

  it('la misma entrada da SIEMPRE la misma salida', async () => {
    const input = {
      intentId: INTENT,
      amount: '100.00',
      currency: 'PEN',
      idempotencyKey: 'k'.repeat(32),
      customerEmail: 'ana@compradora.com',
    }
    const primera = await sandbox.authorize?.(input)
    const segunda = await sandbox.authorize?.(input)
    expect(primera).toEqual(segunda)
    // Sin reloj y sin azar: la referencia se deriva del intento.
    expect(primera?.providerReference).toBe(`sbx-auth-${INTENT}`)
  })

  it('los centimos eligen el resultado, como en cualquier entorno de pruebas', async () => {
    const auth = (amount: string) =>
      sandbox.authorize?.({
        intentId: INTENT,
        amount,
        currency: 'PEN',
        idempotencyKey: 'k'.repeat(32),
        customerEmail: 'ana@compradora.com',
      })

    expect((await auth('100.00'))?.status).toBe('captured')
    expect((await auth('100.01'))?.status).toBe('declined')
    expect((await auth('100.02'))?.status).toBe('timeout')
    expect((await auth('100.03'))?.status).toBe('requires_action')
  })

  it('en modo manual autoriza y NO captura: son dos pasos distintos', async () => {
    const manual = createSandboxProvider({ captureMode: 'manual' })
    const resultado = await manual.authorize?.({
      intentId: INTENT,
      amount: '100.00',
      currency: 'PEN',
      idempotencyKey: 'k'.repeat(32),
      customerEmail: 'ana@compradora.com',
    })
    expect(resultado?.status).toBe('authorized')
  })

  it('un rechazo no inventa referencia del proveedor', async () => {
    const resultado = await sandbox.authorize?.({
      intentId: INTENT,
      amount: '100.01',
      currency: 'PEN',
      idempotencyKey: 'k'.repeat(32),
      customerEmail: 'ana@compradora.com',
    })
    expect(resultado?.providerReference).toBeNull()
    expect(resultado?.errorCode).toBe('SBX51')
  })
})

// ===========================================================================
describe('las capacidades se declaran, no se adivinan', () => {
  it('un conector que no devuelve lo dice, y pedirlo es un error de dominio', () => {
    const soloCobra: PaymentProvider = {
      code: 'solo-cobra',
      capabilities: {
        authorize: true,
        capture: false,
        cancel: false,
        refund: false,
        status: false,
        webhook: false,
      },
      authorize: () =>
        Promise.resolve({
          status: 'captured',
          providerReference: 'x',
          resultCode: null,
          errorCode: null,
          errorDetail: null,
          redirectUrl: null,
          amount: '1.00',
        }),
    }

    expect(supports(soloCobra, 'authorize')).toBe(true)
    expect(supports(soloCobra, 'refund')).toBe(false)
    expect(() => requireOperation(soloCobra, 'refund', soloCobra.refund)).toThrow(
      PaymentCapabilityError,
    )
  })

  it('declarar una capacidad sin implementarla tambien es un error, y sale aqui', () => {
    const miente: PaymentProvider = {
      code: 'miente',
      capabilities: {
        authorize: false,
        capture: false,
        cancel: false,
        refund: true,
        status: false,
        webhook: false,
      },
    }
    expect(supports(miente, 'refund')).toBe(false)
    expect(() => requireOperation(miente, 'refund', miente.refund)).toThrow(
      /no implementa la operacion/,
    )
  })

  it('un tiempo agotado NO se traduce a fallo: deja el intento en vuelo', () => {
    expect(intentStatusFor('timeout')).toBe('processing')
    expect(attemptStatusFor('timeout')).toBe('timeout')
    // Y un rechazo si es terminal.
    expect(intentStatusFor('declined')).toBe('failed')
    expect(attemptStatusFor('declined')).toBe('declined')
  })
})

// ===========================================================================
describe('el registro de adaptadores', () => {
  it('un conector sin adaptador desplegado no es un «no soportado»', () => {
    expect(() => resolvePaymentProvider('bcp')).toThrow(UnknownPaymentProviderError)
    expect(() => resolvePaymentProvider('bcp')).toThrow(/CONECTOR_NO_DESPLEGADO|no hay adaptador/i)
  })

  it('anadir una pasarela es registrar un adaptador, y nada mas', () => {
    expect(hasPaymentProvider('pasarela-de-prueba')).toBe(false)
    registerPaymentProvider('pasarela-de-prueba', () => ({
      code: 'pasarela-de-prueba',
      capabilities: {
        authorize: true,
        capture: false,
        cancel: false,
        refund: false,
        status: false,
        webhook: false,
      },
      authorize: () =>
        Promise.resolve({
          status: 'captured',
          providerReference: 'ref',
          resultCode: 'OK',
          errorCode: null,
          errorDetail: null,
          redirectUrl: null,
          amount: '1.00',
        }),
    }))
    expect(hasPaymentProvider('pasarela-de-prueba')).toBe(true)
    expect(deployedPaymentProviders()).toContain('sandbox')
  })
})

// ===========================================================================
describe('la firma de un webhook', () => {
  it('valida sobre el cuerpo CRUDO y rechaza el reserializado', async () => {
    // Cuerpo con el espaciado que manda la pasarela. `JSON.parse` +
    // `JSON.stringify` lo normaliza y el resumen cambia.
    const cuerpo = '{ "b": 2, "a": 1 }'
    const firma = await hmacSha256Hex('secreto', cuerpo)

    expect(await verifyHmacSignature({ rawBody: cuerpo, signature: firma, secret: 'secreto' }))
      .toBe(true)
    // El mismo JSON reserializado: la firma legitima ya no vale. Por eso se
    // verifica antes de parsear y nunca despues de volver a serializar.
    const reserializado = JSON.stringify(JSON.parse(cuerpo))
    expect(reserializado).not.toBe(cuerpo)
    expect(
      await verifyHmacSignature({ rawBody: reserializado, signature: firma, secret: 'secreto' }),
    ).toBe(false)
  })

  it('sin secreto o sin firma es `false`, no una excepcion', async () => {
    expect(await verifyHmacSignature({ rawBody: '{}', signature: null, secret: 'x' })).toBe(false)
    expect(await verifyHmacSignature({ rawBody: '{}', signature: 'a'.repeat(64), secret: null }))
      .toBe(false)
  })

  it('acepta el prefijo `sha256=` y descarta lo que no es hexadecimal', async () => {
    const firma = await hmacSha256Hex('secreto', '{}')
    expect(
      await verifyHmacSignature({ rawBody: '{}', signature: `sha256=${firma}`, secret: 'secreto' }),
    ).toBe(true)
    expect(await verifyHmacSignature({ rawBody: '{}', signature: 'no-hex', secret: 'secreto' }))
      .toBe(false)
  })

  it('la comparacion no se rinde en el primer byte distinto', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'ab')).toBe(false)
  })
})

// ===========================================================================
describe('el gancho del checkout, con puertos falsos', () => {
  it('sin medio de pago no llama a nadie: la tienda cobra por su canal', async () => {
    const rpc = fakeRpc()
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0 })
    const outcome = await gateway.authorizePayment(request({ methodCode: null }))

    expect(outcome.status).toBe('not_required')
    expect(rpc.calls).toHaveLength(0)
  })

  it('un medio offline abre el intento y deja el pedido a la espera', async () => {
    const rpc = fakeRpc({ payment_intent_open: openedIntent({ provider_code: null }) })
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0 })
    const outcome = await gateway.authorizePayment(request({ methodCode: 'transferencia' }))

    expect(outcome.status).toBe('pending')
    expect(outcome.providerCode).toBeNull()
    expect(outcome.intentId).toBe(INTENT)
    // Se abrio el intento y no se llamo a ningun comando de resultado: no hubo
    // llamada a pasarela que registrar.
    expect(rpc.of('payment_apply_outcome')).toHaveLength(0)
  })

  it('EXITO: cobra, y el intento queda escrito ANTES de hablar con la pasarela', async () => {
    const rpc = fakeRpc({
      payment_intent_open: openedIntent(),
      payment_apply_outcome: { intent_id: INTENT, status: 'captured', replay: false },
    })
    // `allowSimulation`: estas pruebas recorren el `sandbox`, que es un simulacro.
    // Sin permiso expreso la pasarela ya no lo deja cobrar (ver bloque siguiente).
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0, allowSimulation: true })
    const outcome = await gateway.authorizePayment(request())

    expect(outcome.status).toBe('captured')
    expect(outcome.providerCode).toBe('sandbox')
    expect(outcome.intentId).toBe(INTENT)
    // El orden importa: primero se anota la intencion, luego se cobra.
    expect(rpc.calls.map((c) => c.fn)).toEqual(['payment_intent_open', 'payment_apply_outcome'])

    const aplicado = rpc.of('payment_apply_outcome')[0]?.args
    expect(aplicado?.p_intent_status).toBe('captured')
    expect(aplicado?.p_attempt_status).toBe('succeeded')
    expect(aplicado?.p_source).toBe('provider_response')
    expect(aplicado?.p_operation).toBe('payment.authorize')
  })

  it('RECHAZO: sale como `declined` y el comando lo registra como tal', async () => {
    const rpc = fakeRpc({
      payment_intent_open: openedIntent({ amount: '100.01' }),
      payment_apply_outcome: { replay: false },
    })
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0, allowSimulation: true })
    const outcome = await gateway.authorizePayment(request({ amount: '100.01' }))

    expect(outcome.status).toBe('declined')
    expect(outcome.providerMessage).toBe('SBX51')
    expect(rpc.of('payment_apply_outcome')[0]?.args.p_intent_status).toBe('failed')
  })

  it('TIEMPO AGOTADO: no se dice que se rechazo, y el intento queda en vuelo', async () => {
    const rpc = fakeRpc({
      payment_intent_open: openedIntent({ amount: '100.02' }),
      payment_apply_outcome: { replay: false },
    })
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0, allowSimulation: true })

    await expect(gateway.authorizePayment(request({ amount: '100.02' }))).rejects.toThrow(
      /PAGO_NO_DISPONIBLE/,
    )
    // Y aun asi queda la fila: `processing`, que es «no se sabe».
    expect(rpc.of('payment_apply_outcome')[0]?.args.p_intent_status).toBe('processing')
    expect(rpc.of('payment_apply_outcome')[0]?.args.p_attempt_status).toBe('timeout')
  })

  it('si la pasarela revienta, queda la fila del intento fallido', async () => {
    registerPaymentProvider('revienta', () => ({
      code: 'revienta',
      capabilities: {
        authorize: true,
        capture: false,
        cancel: false,
        refund: false,
        status: false,
        webhook: false,
      },
      authorize: () => Promise.reject(new Error('ECONNRESET')),
    }))
    const rpc = fakeRpc({
      payment_intent_open: openedIntent({ provider_code: 'revienta' }),
      payment_apply_outcome: { replay: false },
    })
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0 })

    await expect(gateway.authorizePayment(request())).rejects.toThrow(/PAGO_NO_DISPONIBLE/)
    const args = rpc.of('payment_apply_outcome')[0]?.args
    expect(args?.p_attempt_status).toBe('timeout')
    expect(args?.p_error_code).toBe('CONECTOR_NO_RESPONDE')
  })

  it('3DS sale como `pending` y con a donde mandar al comprador', async () => {
    const rpc = fakeRpc({
      payment_intent_open: openedIntent({ amount: '100.03' }),
      payment_apply_outcome: { replay: false },
    })
    const gateway = createPaymentGateway({
      service: rpc.caller,
      now: () => 0,
      allowSimulation: true,
      returnUrl: (slug) => `https://ebim.test/s/${slug}/checkout/retorno`,
    })
    const outcome = await gateway.authorizePayment(request({ amount: '100.03' }))

    expect(outcome.status).toBe('pending')
    // La URL la compuso el SERVIDOR a partir del slug, no vino en la peticion.
    expect(outcome.redirectUrl).toBe('https://ebim.test/s/tienda-a/checkout/retorno')
  })

  // -------------------------------------------------------------------------
  // Cierre · D2: un simulacro no cobra donde el despliegue no lo permite.
  // -------------------------------------------------------------------------
  it('SIN permiso de simulacro, el `sandbox` no cobra: intento fallido con código y pago no disponible', async () => {
    const rpc = fakeRpc({
      payment_intent_open: openedIntent(),
      payment_apply_outcome: { replay: false },
    })
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0 })

    await expect(gateway.authorizePayment(request())).rejects.toThrow(/PAGO_NO_DISPONIBLE/)
    const args = rpc.of('payment_apply_outcome')[0]?.args
    // Queda escrito y NO como cobrado: fallido, con el motivo que lo explica.
    expect(args?.p_intent_status).toBe('failed')
    expect(args?.p_attempt_status).not.toBe('succeeded')
    expect(args?.p_error_code).toBe('SIMULACION_NO_PERMITIDA')
    expect(rpc.of('payment_apply_outcome')).toHaveLength(1)
  })

  it('una pasarela real SIN su secreto simula, y por tanto tampoco cobra sin permiso', async () => {
    const rpc = fakeRpc({
      payment_intent_open: openedIntent({ provider_code: 'culqi' }),
      payment_apply_outcome: { replay: false },
    })
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0, secretFor: () => null })

    await expect(gateway.authorizePayment(request())).rejects.toThrow(/PAGO_NO_DISPONIBLE/)
    expect(rpc.of('payment_apply_outcome')[0]?.args.p_error_code).toBe('SIMULACION_NO_PERMITIDA')
  })

  it('con su secreto, la pasarela real NO es simulacro (el permiso no le afecta)', () => {
    expect(resolvePaymentProvider('culqi', { secret: 'sk_test_x' }).simulated).toBe(false)
    expect(resolvePaymentProvider('culqi', {}).simulated).toBe(true)
    expect(resolvePaymentProvider('sandbox', {}).simulated).toBe(true)
  })

  it('la compensacion devuelve lo capturado y anula lo autorizado', async () => {
    const rpc = fakeRpc({ payment_apply_outcome: {} })
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0 })

    await gateway.voidPayment({
      status: 'captured',
      providerCode: 'sandbox',
      providerReference: 'sbx-auth-1',
      providerMessage: null,
      intentId: INTENT,
    })
    expect(rpc.of('payment_apply_outcome')[0]?.args.p_operation).toBe('payment.refund')

    await gateway.voidPayment({
      status: 'authorized',
      providerCode: 'sandbox',
      providerReference: 'sbx-auth-1',
      providerMessage: null,
      intentId: INTENT,
    })
    expect(rpc.of('payment_apply_outcome')[1]?.args.p_operation).toBe('payment.cancel')
  })

  it('no hay nada que compensar cuando no se cobro', async () => {
    const rpc = fakeRpc()
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0 })
    await gateway.voidPayment({
      status: 'not_required',
      providerCode: null,
      providerReference: null,
      providerMessage: null,
    })
    expect(rpc.calls).toHaveLength(0)
  })

  it('atar el cobro al pedido es una llamada, y solo si hubo cobro', async () => {
    const rpc = fakeRpc({ payment_intent_attach_order: {} })
    const gateway = createPaymentGateway({ service: rpc.caller, now: () => 0 })

    await gateway.attachOrder(
      { status: 'not_required', providerCode: null, providerReference: null, providerMessage: null },
      ORDER,
    )
    expect(rpc.calls).toHaveLength(0)

    await gateway.attachOrder(
      {
        status: 'captured',
        providerCode: 'sandbox',
        providerReference: 'r',
        providerMessage: null,
        intentId: INTENT,
      },
      ORDER,
    )
    expect(rpc.of('payment_intent_attach_order')[0]?.args).toEqual({
      p_intent_id: INTENT,
      p_order_id: ORDER,
    })
  })
})

// ===========================================================================
describe('la entrada de un aviso de pasarela', () => {
  const SECRET = 'secreto-de-pruebas'

  function ports(overrides: Partial<WebhookPorts> = {}) {
    const calls: Call[] = []
    const base: WebhookPorts = {
      findIntentByReference: () => Promise.resolve({ intentId: INTENT }),
      findRefundByReference: () => Promise.resolve({ refundId: 'r-1' }),
      applyOutcome: (args) => {
        calls.push({ fn: 'applyOutcome', args })
        return Promise.resolve({ replay: false, status: 'captured' })
      },
      settleRefund: (args) => {
        calls.push({ fn: 'settleRefund', args })
        return Promise.resolve({ replay: false, status: 'succeeded' })
      },
    }
    return { calls, ports: { ...base, ...overrides } }
  }

  async function sobre(body: Record<string, unknown>, secret = SECRET) {
    const rawBody = JSON.stringify(body)
    return { rawBody, signature: await hmacSha256Hex(secret, rawBody) }
  }

  it('un aviso bien firmado mueve el cobro, con la firma marcada como verificada', async () => {
    const { rawBody, signature } = await sobre({
      event_id: 'ev_1',
      reference: 'sbx-cap-1',
      type: 'payment.captured',
      amount: '100.00',
      currency: 'PEN',
    })
    const fake = ports()
    const resultado = await ingestPaymentWebhook({
      providerCode: 'sandbox',
      rawBody,
      signature,
      secret: SECRET,
      ports: fake.ports,
    })

    expect(resultado).toMatchObject({ accepted: true, kind: 'payment', replay: false })
    const args = fake.calls[0]?.args
    expect(args?.p_signature_verified).toBe(true)
    expect(args?.p_source).toBe('provider_webhook')
    expect(args?.p_external_event_id).toBe('ev_1')
    // La clave de idempotencia del intento ES el identificador del evento.
    expect(args?.p_idempotency_key).toBe('webhook:ev_1')
  })

  it('una firma que no valida se descarta y no toca la base', async () => {
    const { rawBody } = await sobre({
      event_id: 'ev_2',
      reference: 'sbx-cap-2',
      type: 'payment.captured',
    })
    const fake = ports()
    const resultado = await ingestPaymentWebhook({
      providerCode: 'sandbox',
      rawBody,
      signature: 'f'.repeat(64),
      secret: SECRET,
      ports: fake.ports,
    })

    expect(resultado).toEqual({ accepted: false, code: 'FIRMA_NO_VERIFICADA' })
    expect(fake.calls).toHaveLength(0)
  })

  it('WEBHOOK REPETIDO: el segundo sale como repeticion, no como segundo cobro', async () => {
    const { rawBody, signature } = await sobre({
      event_id: 'ev_3',
      reference: 'sbx-cap-3',
      type: 'payment.captured',
    })
    const visto = new Set<string>()
    const fake = ports({
      applyOutcome: (args) => {
        const key = String(args.p_external_event_id)
        if (visto.has(key)) return Promise.resolve({ replay: true, status: 'captured' })
        visto.add(key)
        return Promise.resolve({ replay: false, status: 'captured' })
      },
    })

    const primera = await ingestPaymentWebhook({
      providerCode: 'sandbox', rawBody, signature, secret: SECRET, ports: fake.ports,
    })
    const segunda = await ingestPaymentWebhook({
      providerCode: 'sandbox', rawBody, signature, secret: SECRET, ports: fake.ports,
    })

    expect(primera).toMatchObject({ accepted: true, replay: false })
    expect(segunda).toMatchObject({ accepted: true, replay: true })
  })

  it('DEVOLUCION: un aviso de reembolso liquida la devolucion, no el cobro', async () => {
    const { rawBody, signature } = await sobre({
      event_id: 'ev_4',
      reference: 'sbx-ref-4',
      type: 'payment.refunded',
    })
    const fake = ports()
    const resultado = await ingestPaymentWebhook({
      providerCode: 'sandbox', rawBody, signature, secret: SECRET, ports: fake.ports,
    })

    expect(resultado).toMatchObject({ accepted: true, kind: 'refund', refundId: 'r-1' })
    expect(fake.calls[0]?.fn).toBe('settleRefund')
    expect(fake.calls[0]?.args.p_signature_verified).toBe(true)
  })

  it('una referencia que no es de aqui no crea nada', async () => {
    const { rawBody, signature } = await sobre({
      event_id: 'ev_5',
      reference: 'sbx-cap-ajena',
      type: 'payment.captured',
    })
    const fake = ports({ findIntentByReference: () => Promise.resolve(null) })
    const resultado = await ingestPaymentWebhook({
      providerCode: 'sandbox', rawBody, signature, secret: SECRET, ports: fake.ports,
    })

    expect(resultado).toEqual({ accepted: false, code: 'REFERENCIA_DESCONOCIDA' })
    expect(fake.calls).toHaveLength(0)
  })

  it('un evento que no mueve nada se acusa: reintentarlo para siempre es peor', async () => {
    const { rawBody, signature } = await sobre({
      event_id: 'ev_6',
      reference: 'sbx-cap-6',
      type: 'payment.pending',
    })
    const fake = ports()
    const resultado = await ingestPaymentWebhook({
      providerCode: 'sandbox', rawBody, signature, secret: SECRET, ports: fake.ports,
    })

    expect(resultado).toMatchObject({ accepted: true, kind: 'ignored' })
    expect(fake.calls).toHaveLength(0)
  })

  it('un conector sin adaptador desplegado no se confunde con una firma mala', async () => {
    const { rawBody, signature } = await sobre({
      event_id: 'ev_7', reference: 'x', type: 'payment.captured',
    })
    const fake = ports()
    const resultado = await ingestPaymentWebhook({
      providerCode: 'bcp', rawBody, signature, secret: SECRET, ports: fake.ports,
    })
    expect(resultado).toEqual({ accepted: false, code: 'CONECTOR_NO_DESPLEGADO' })
  })

  it('el aviso NUNCA declara el tenant: sale de la fila que se encuentra', async () => {
    const { rawBody, signature } = await sobre({
      event_id: 'ev_8',
      reference: 'sbx-cap-8',
      type: 'payment.captured',
      organization_id: '0b000000-0000-4000-8000-000000000002',
      company_id: '0b000000-0000-4000-8000-0000000000c2',
    })
    const fake = ports()
    await ingestPaymentWebhook({
      providerCode: 'sandbox', rawBody, signature, secret: SECRET, ports: fake.ports,
    })

    const args = fake.calls[0]?.args ?? {}
    // Ni `organization_id` ni `company_id` viajan al comando: el tenant lo pone
    // la fila del intento, y el comando lo deriva de ahi.
    expect(Object.keys(args)).not.toContain('p_organization_id')
    expect(Object.keys(args)).not.toContain('p_company_id')
    expect(args.p_intent_id).toBe(INTENT)
  })
})
