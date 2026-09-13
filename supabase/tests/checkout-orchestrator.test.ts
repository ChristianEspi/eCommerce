// @vitest-environment node
/**
 * El orquestador del checkout, con puertos falsos.
 *
 * Aquí no hay base de datos y es a propósito: lo que se prueba es la **máquina**
 * —el orden de las etapas, la idempotencia, las compensaciones y qué error sale
 * de cada sitio—, y esa lógica tiene que poder ejercitarse sin levantar
 * Postgres. Lo que sí toca la base se prueba en `checkout-pipeline.test.ts`
 * contra el esquema real; las dos mitades juntas cubren la fase.
 *
 * Cada test declara solo el puerto que le importa y hereda el resto de un
 * conjunto que funciona. Es la forma de que «fallar al reservar» sea un test de
 * tres líneas y no una fixtura de treinta.
 */
import { describe, expect, it, vi } from 'vitest'

import { CheckoutStageError } from '../functions/_shared/checkout/errors.ts'
import { CHECKOUT_STAGES, type CheckoutStage } from '../functions/_shared/checkout/stages.ts'
import { runCheckout, type CheckoutInput } from '../functions/_shared/checkout/pipeline.ts'
import {
  alwaysDeliverable,
  noGiftCardRelease,
  noGiftCards,
  noPaymentGateway,
  noPaymentVoid,
  noPromotions,
} from '../functions/_shared/checkout/hooks.ts'
import type { CheckoutPorts, PlacedOrder, Quote } from '../functions/_shared/checkout/ports.ts'
import { requestHash } from '../functions/_shared/checkout/request.ts'

const INTENT = '11111111-1111-4111-8111-111111111111'
const PRODUCT = '22222222-2222-4222-8222-222222222222'
const ORDER = '33333333-3333-4333-8333-333333333333'

const QUOTE: Quote = {
  currency: 'PEN',
  channelCode: 'b2c',
  taxInclusive: false,
  lines: [
    {
      productId: PRODUCT,
      variantId: null,
      uomCode: null,
      name: 'Silla',
      quantity: 2,
      unitPrice: '100.00',
      netAmount: '200.00',
      taxRate: '0.18',
      source: 'catalog',
      priceListCode: null,
      scope: null,
    },
  ],
  subtotal: '200.00',
  taxTotal: '36.00',
  grandTotal: '236.00',
}

/** Una cuenta B2B cualquiera. No identifica a nadie: solo la resuelve el puerto. */
const ACCOUNT = '55555555-5555-4555-8555-555555555555'

const ORDER_RESULT: PlacedOrder = {
  orderId: ORDER,
  orderNumber: 'EC-20260828-00001',
  accessToken: 'a'.repeat(64),
  status: 'pending',
  approvalStatus: 'not_required',
  sourceChannel: 'storefront',
  currency: 'PEN',
  subtotal: '200.00',
  taxTotal: '36.00',
  shippingTotal: '0.00',
  grandTotal: '236.00',
  items: [],
  delivery: null,
  replay: false,
}

function input(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    storeSlug: 'tienda-a',
    idempotencyKey: 'k'.repeat(32),
    requestHash: 'f'.repeat(64),
    cartToken: 'c'.repeat(64),
    customerName: 'Ana Compradora',
    customerEmail: 'ana@compradora.com',
    customerPhone: '+51 999 111 222',
    shippingAddress: { address: 'Av. Primavera 120' },
    billingAddress: null,
    notes: null,
    items: [{ product_id: PRODUCT, quantity: 2 }],
    // P09: la tienda de este banco de pruebas no cobra en linea salvo que el
    // caso lo diga. `null` es el mismo camino que tenia P07 y sigue valiendo.
    paymentMethodCode: null,
    // P10: sin codigos tecleados. Es el carrito de la mayoria de las compras, y
    // el camino que tiene que seguir dando exactamente los mismos importes.
    couponCodes: [],
    giftCardCodes: [],
    // P12: sin eleccion de entrega. Es el camino del tenant que no configuro
    // zonas ni metodos, y tiene que seguir dando exactamente los mismos
    // importes que antes de esta fase.
    delivery: null,
    ...overrides,
  }
}

/** Registro de lo que el pipeline fue haciendo, en orden. */
interface Recorder {
  stages: CheckoutStage[]
  released: string[]
  voided: number
  /** P10: cuantas tarjetas regalo se devolvieron al deshacer. */
  giftCardsReleased: number
  failures: Array<{ stage: CheckoutStage; code: string; detail: string }>
}

function ports(
  overrides: Partial<CheckoutPorts> = {},
): { ports: CheckoutPorts; log: Recorder } {
  const log: Recorder = {
    stages: [], released: [], voided: 0, giftCardsReleased: 0, failures: [],
  }

  const base: CheckoutPorts = {
    begin: () =>
      Promise.resolve({ intentId: INTENT, replay: false, attempt: 1, result: null }),
    markStage: (_id, stage) => {
      log.stages.push(stage)
      return Promise.resolve()
    },
    failIntent: (_id, stage, code, detail) => {
      log.failures.push({ stage, code, detail })
      return Promise.resolve()
    },
    resolveContext: (storeSlug) =>
      Promise.resolve({
        storeSlug,
        storeName: 'Tienda A',
        currency: 'PEN',
        channelCode: 'b2c',
        channelKind: 'b2c',
        requiresAuth: false,
        requiresAccount: false,
        taxInclusive: false,
      }),
    resolveAccount: () =>
      Promise.resolve({
        hasSession: false,
        userId: null,
        accountId: null,
        role: null,
        spendingLimit: null,
      }),
    verifyBuyer: () => Promise.resolve(null),
    resolvePrices: () => Promise.resolve(QUOTE),
    // Sin cuenta B2B el pipeline no llega a preguntar; el puerto existe igual
    // porque un puerto opcional obliga a cada llamante a acordarse.
    resolveApproval: () =>
      Promise.resolve({ required: false, reason: null, purchaseOrderRequired: false }),
    resolvePriceDrift: () => Promise.resolve({ changed: [] }),
    resolvePromotions: noPromotions,
    reserveInventory: () =>
      Promise.resolve({
        reservationId: 'res-1',
        token: 'r'.repeat(64),
        expiresAt: '2026-08-28T00:15:00Z',
        created: true,
      }),
    validateDelivery: alwaysDeliverable,
    applyGiftCards: noGiftCards,
    authorizePayment: noPaymentGateway,
    placeOrder: () => Promise.resolve(ORDER_RESULT),
    releaseReservation: (_slug, token) => {
      log.released.push(token)
      return Promise.resolve()
    },
    voidPayment: () => {
      log.voided += 1
      return noPaymentVoid({
        status: 'not_required',
        providerCode: null,
        providerReference: null,
        providerMessage: null,
      })
    },
    releaseGiftCards: (release) => {
      log.giftCardsReleased += release.tender.redemptions.length
      return noGiftCardRelease(release)
    },
    ...overrides,
  }

  return { ports: base, log }
}

async function expectStageFailure(
  run: () => Promise<unknown>,
): Promise<CheckoutStageError> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(CheckoutStageError)
    return error as CheckoutStageError
  }
  throw new Error('Se esperaba un fallo del pipeline y la operacion tuvo exito')
}

describe('el camino feliz', () => {
  it('recorre las once etapas en el orden declarado', async () => {
    const { ports: p, log } = ports()

    const result = await runCheckout(p, input())

    expect(result.ok).toBe(true)
    expect(result.order.orderNumber).toBe('EC-20260828-00001')
    expect(result.stagesRun).toEqual([...CHECKOUT_STAGES])

    // Las etapas se MARCAN hasta el pedido, y ni una más: `checkout_place_order`
    // cierra el intento como `succeeded` dentro de la misma transacción, y
    // `checkout_mark_stage` solo admite intentos `running`. Marcar después
    // devolvía `INTENTO_NO_VIGENTE` sobre un pedido ya creado.
    const marcadas = log.stages.filter((stage, index) => log.stages.indexOf(stage) === index)
    expect(marcadas).toEqual([...CHECKOUT_STAGES].slice(0, CHECKOUT_STAGES.indexOf('create_order') + 1))
    expect(marcadas).not.toContain('publish_events')
    expect(marcadas).not.toContain('notify')
  })

  it('no marca etapas sobre un intento ya cerrado: el pedido existe y la respuesta es ok', async () => {
    // El falso se comporta como la BASE: en cuanto el pedido existe, el intento
    // deja de estar `running` y marcar una etapa revienta. Sin esto, la suite
    // daba verde sobre un checkout que en producción devolvía 409 con el pedido
    // ya creado.
    let pedidoCreado = false
    const { ports: base } = ports()
    const p: CheckoutPorts = {
      ...base,
      placeOrder: async (args) => {
        const placed = await base.placeOrder(args)
        pedidoCreado = true
        return placed
      },
      markStage: (id, stage, token) => {
        if (pedidoCreado) {
          return Promise.reject(new Error('INTENTO_NO_VIGENTE: ese intento de compra ya se cerro'))
        }
        return base.markStage(id, stage, token)
      },
    }

    const result = await runCheckout(p, input())

    expect(result.ok).toBe(true)
    expect(result.order.orderNumber).toBe('EC-20260828-00001')
    expect(result.stagesRun).toContain('notify')
  })

  it('el token de la reserva se anota en el intento antes de crear el pedido', async () => {
    const marks: Array<[CheckoutStage, string | undefined]> = []
    const { ports: p } = ports({
      markStage: (_id, stage, token) => {
        marks.push([stage, token])
        return Promise.resolve()
      },
    })

    await runCheckout(p, input())

    // Sin esta anotación, un proceso que muriera aquí dejaría existencia
    // apartada que nadie sabría soltar hasta que caducara sola.
    expect(marks).toContainEqual(['reserve_inventory', 'r'.repeat(64)])
  })

  it('sin pasarela el cobro no se inventa: queda como «no requerido»', async () => {
    const { ports: p } = ports()
    const result = await runCheckout(p, input())
    expect(result.payment?.status).toBe('not_required')
  })
})

describe('idempotencia', () => {
  it('un reintento devuelve el MISMO pedido y no toca nada más', async () => {
    const reserve = vi.fn()
    const place = vi.fn()
    const { ports: p, log } = ports({
      begin: () =>
        Promise.resolve({
          intentId: INTENT,
          replay: true,
          attempt: 2,
          result: {
            order_id: ORDER,
            order_number: 'EC-20260828-00001',
            access_token: 'a'.repeat(64),
            status: 'pending',
            currency: 'PEN',
            subtotal: '200.00',
            tax_total: '36.00',
            grand_total: '236.00',
            items: [],
          },
        }),
      reserveInventory: reserve as unknown as CheckoutPorts['reserveInventory'],
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
    })

    const result = await runCheckout(p, input())

    expect(result.replay).toBe(true)
    expect(result.order.orderNumber).toBe('EC-20260828-00001')
    // Ni una etapa, ni una reserva, ni un pedido: la petición repetida no
    // vuelve a apartar existencia ni a cobrar.
    expect(log.stages).toEqual([])
    expect(reserve).not.toHaveBeenCalled()
    expect(place).not.toHaveBeenCalled()
  })

  it('dos peticiones concurrentes con la misma clave: la segunda no ejecuta', async () => {
    // Es lo que hace `checkout_begin` cuando encuentra un intento vivo.
    const { ports: p } = ports({
      begin: () =>
        Promise.reject(
          new Error('CHECKOUT_EN_CURSO: ese intento de compra todavia se esta procesando'),
        ),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))
    expect(error.code).toBe('CHECKOUT_EN_CURSO')
    expect(error.status).toBe(409)
    // Este SÍ se puede reintentar: el otro intento va a terminar.
    expect(error.retryable).toBe(true)
  })

  it('la misma clave con otra petición es un error explícito, no una compra', async () => {
    const { ports: p } = ports({
      begin: () =>
        Promise.reject(
          new Error('IDEMPOTENCIA_EN_CONFLICTO: esa clave ya se uso para una peticion distinta'),
        ),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))
    expect(error.code).toBe('IDEMPOTENCIA_EN_CONFLICTO')
    expect(error.retryable).toBe(false)
  })
})

describe('el resumen de la peticion', () => {
  it('el mismo carrito en otro orden da el MISMO resumen', async () => {
    const a = await requestHash({
      storeSlug: 'tienda-a',
      items: [
        { product_id: PRODUCT, quantity: 2 },
        { product_id: '44444444-4444-4444-8444-444444444444', quantity: 1 },
      ],
      customerEmail: 'ana@compradora.com',
      customerName: 'Ana',
      customerPhone: '+51 999',
      shippingAddress: { address: 'Av. Primavera 120' },
      billingAddress: null,
      notes: null,
    })
    const b = await requestHash({
      storeSlug: 'TIENDA-A',
      items: [
        { product_id: '44444444-4444-4444-8444-444444444444', quantity: 1 },
        { product_id: PRODUCT, quantity: 2 },
      ],
      customerEmail: 'ANA@compradora.com',
      customerName: 'Ana',
      customerPhone: '+51 999',
      shippingAddress: { address: 'Av. Primavera 120' },
      billingAddress: null,
      notes: null,
    })
    // Si esto fallara, el reintento del navegador —que reserializa— se leería
    // como una petición distinta y crearía el segundo pedido.
    expect(a).toBe(b)
  })

  it('cambiar una cantidad cambia el resumen', async () => {
    const base = {
      storeSlug: 'tienda-a',
      customerEmail: 'ana@compradora.com',
      customerName: 'Ana',
      customerPhone: '+51 999',
      shippingAddress: { address: 'Av. Primavera 120' },
      billingAddress: null,
      notes: null,
    }
    const a = await requestHash({ ...base, items: [{ product_id: PRODUCT, quantity: 2 }] })
    const b = await requestHash({ ...base, items: [{ product_id: PRODUCT, quantity: 3 }] })
    expect(a).not.toBe(b)
  })
})

describe('el precio cambiado', () => {
  it('detiene la compra UNA vez y no aparta existencia', async () => {
    const reserve = vi.fn()
    const { ports: p, log } = ports({
      resolvePriceDrift: () =>
        Promise.resolve({
          changed: [
            { productId: PRODUCT, variantId: null, uomCode: null, was: '100.00', now: '120.00' },
          ],
        }),
      reserveInventory: reserve as unknown as CheckoutPorts['reserveInventory'],
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('PRECIO_CAMBIADO')
    expect(error.stage).toBe('resolve_prices')
    // Falla ANTES de reservar: parar en la etapa 3 no deja existencia
    // comprometida esperando a que el comprador decida.
    expect(reserve).not.toHaveBeenCalled()
    expect(log.released).toEqual([])
    expect(log.failures[0]?.stage).toBe('resolve_prices')
  })

  it('aceptado por el comprador, la compra pasa', async () => {
    const { ports: p } = ports({
      resolvePriceDrift: () =>
        Promise.resolve({
          changed: [
            { productId: PRODUCT, variantId: null, uomCode: null, was: '100.00', now: '120.00' },
          ],
        }),
    })

    const result = await runCheckout(p, input({ acceptPriceChanges: true }))
    expect(result.ok).toBe(true)
  })

  it('sin carrito de servidor no se compara nada, y no se inventa un cambio', async () => {
    const drift = vi.fn()
    const { ports: p } = ports({
      resolvePriceDrift: drift as unknown as CheckoutPorts['resolvePriceDrift'],
    })

    const result = await runCheckout(p, input({ cartToken: null }))

    expect(result.ok).toBe(true)
    expect(drift).not.toHaveBeenCalled()
  })
})

describe('lo que falla, y lo que se deshace', () => {
  it('stock insuficiente: falla en su etapa y no crea pedido', async () => {
    const place = vi.fn()
    const { ports: p, log } = ports({
      reserveInventory: () =>
        Promise.reject(new Error('STOCK_INSUFICIENTE: SKU-1 (no hay existencia suficiente)')),
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('STOCK_INSUFICIENTE')
    expect(error.stage).toBe('reserve_inventory')
    expect(error.status).toBe(409)
    expect(error.retryable).toBe(false)
    expect(place).not.toHaveBeenCalled()
    expect(log.failures[0]?.stage).toBe('reserve_inventory')
  })

  it('«no se sabe» no es «no hay»: código propio y SÍ reintentable', async () => {
    const { ports: p } = ports({
      reserveInventory: () =>
        Promise.reject(
          new Error('DISPONIBILIDAD_DESCONOCIDA: SKU-1 no se puede prometer ahora mismo'),
        ),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))
    expect(error.code).toBe('DISPONIBILIDAD_DESCONOCIDA')
    expect(error.status).toBe(503)
    expect(error.retryable).toBe(true)
  })

  /**
   * P18 · La tienda que solo vende a quien ha entrado.
   *
   * Lo que se fija aquí es DÓNDE se decide y CON QUÉ. Con `hasSession`, que
   * sale de leer el `sub` del token sin comprobar la firma, la regla sería un
   * cartel: escribir un JWT con un `sub` dentro lo hace cualquiera. Por eso el
   * pipeline pregunta a la base con el token del llamante, y por eso el caso de
   * abajo —sesión aparente, verificación vacía— tiene que fallar.
   */
  it('sin sesión, una tienda que exige cuenta rechaza antes de tocar existencia', async () => {
    const reserve = vi.fn()
    const { ports: p } = ports({
      resolveContext: (storeSlug) =>
        Promise.resolve({
          storeSlug,
          storeName: 'Botica',
          currency: 'PEN',
          channelCode: 'b2c',
          channelKind: 'b2c',
          requiresAuth: false,
          requiresAccount: true,
          taxInclusive: false,
        }),
      reserveInventory: reserve as unknown as CheckoutPorts['reserveInventory'],
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('COMPRA_EXIGE_SESION')
    expect(error.stage).toBe('validate_account')
    // Nada que compensar: se para en la etapa 2, antes de la primera con efecto.
    expect(reserve).not.toHaveBeenCalled()
  })

  it('un token que PARECE sesión pero no verifica tampoco compra', async () => {
    const { ports: p } = ports({
      resolveContext: (storeSlug) =>
        Promise.resolve({
          storeSlug,
          storeName: 'Botica',
          currency: 'PEN',
          channelCode: 'b2c',
          channelKind: 'b2c',
          requiresAuth: false,
          requiresAccount: true,
          taxInclusive: false,
        }),
      // Esto es exactamente lo que ve el orquestador ante un JWT falsificado:
      // el `sub` está, y la base no reconoce a nadie.
      resolveAccount: () =>
        Promise.resolve({
          hasSession: true,
          userId: null,
          accountId: null,
          role: null,
          spendingLimit: null,
        }),
      verifyBuyer: () => Promise.resolve(null),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('COMPRA_EXIGE_SESION')
  })

  it('con sesión verificada, la tienda que exige cuenta deja comprar', async () => {
    const { ports: p } = ports({
      resolveContext: (storeSlug) =>
        Promise.resolve({
          storeSlug,
          storeName: 'Botica',
          currency: 'PEN',
          channelCode: 'b2c',
          channelKind: 'b2c',
          requiresAuth: false,
          requiresAccount: true,
          taxInclusive: false,
        }),
      resolveAccount: () =>
        Promise.resolve({
          hasSession: true,
          userId: null,
          accountId: null,
          role: null,
          spendingLimit: null,
        }),
      verifyBuyer: () => Promise.resolve('11111111-1111-4111-8111-111111111111'),
    })

    const result = await runCheckout(p, input())
    expect(result.order.orderNumber).toBeTruthy()
  })

  it('en una tienda abierta NO se pregunta quién compra: es un viaje de más', async () => {
    const verify = vi.fn(() => Promise.resolve(null))
    const { ports: p } = ports({ verifyBuyer: verify as CheckoutPorts['verifyBuyer'] })

    await runCheckout(p, input())

    expect(verify).not.toHaveBeenCalled()
  })

  it('un canal que exige sesión se rechaza antes de tocar existencia', async () => {
    const reserve = vi.fn()
    const { ports: p } = ports({
      resolveContext: (storeSlug) =>
        Promise.resolve({
          storeSlug,
          storeName: 'Tienda interna',
          currency: 'PEN',
          channelCode: 'interno',
          channelKind: 'internal',
          requiresAuth: true,
          requiresAccount: false,
          taxInclusive: false,
        }),
      reserveInventory: reserve as unknown as CheckoutPorts['reserveInventory'],
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('CANAL_EXIGE_SESION')
    expect(error.stage).toBe('validate_account')
    expect(reserve).not.toHaveBeenCalled()
  })

  /**
   * LA compensación de la fase: si algo falla DESPUÉS de reservar, las unidades
   * vuelven al fondo común en el acto. Sin esto, cada intento fallido dejaría
   * stock apartado hasta que caducara solo, y una racha de fallos vaciaría la
   * tienda sin haber vendido nada.
   */
  it('un fallo posterior a la reserva la suelta', async () => {
    const { ports: p, log } = ports({
      placeOrder: () => Promise.reject(new Error('ERROR_INTERNO: la base no contesto')),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.stage).toBe('create_order')
    expect(log.released).toEqual(['r'.repeat(64)])
    // Y queda escrito en el intento, no solo en un log que nadie mira.
    expect(log.failures[0]?.detail).toContain('compensado: release_reservation:res-1')
  })

  it('si la propia compensación falla, el error original sigue siendo el que sale', async () => {
    const { ports: p, log } = ports({
      validateDelivery: () => Promise.reject(new Error('ERROR_INTERNO: se cayo el validador')),
      releaseReservation: () => Promise.reject(new Error('la reserva ya no existe')),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    // El fallo de la compensación NO reemplaza al error real...
    expect(error.stage).toBe('validate_delivery')
    // ...pero tampoco se pierde: queda anotado como fallido.
    expect(log.failures[0]?.detail).toContain('release_reservation:res-1:FALLIDA')
  })

  it('un cobro autorizado se anula si el pedido no llega a existir', async () => {
    let voided = 0
    const { ports: p, log } = ports({
      authorizePayment: () =>
        Promise.resolve({
          status: 'authorized',
          providerCode: 'proveedor-de-prueba',
          providerReference: 'ref-1',
          providerMessage: null,
        }),
      voidPayment: () => {
        voided += 1
        return Promise.resolve()
      },
      placeOrder: () => Promise.reject(new Error('ERROR_INTERNO: la base no contesto')),
    })

    await expectStageFailure(() => runCheckout(p, input()))

    expect(voided).toBe(1)
    // Orden INVERSO: primero se anula el cobro (lo último que se hizo), después
    // se suelta la reserva.
    expect(log.failures[0]?.detail).toContain('void_payment:ref-1')
    expect(log.released).toEqual(['r'.repeat(64)])
  })

  it('un cobro rechazado no crea pedido y suelta la reserva', async () => {
    const place = vi.fn()
    const { ports: p, log } = ports({
      authorizePayment: () =>
        Promise.resolve({
          status: 'declined',
          providerCode: 'proveedor-de-prueba',
          providerReference: null,
          providerMessage: 'fondos insuficientes',
        }),
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('PAGO_RECHAZADO')
    expect(error.status).toBe(402)
    expect(place).not.toHaveBeenCalled()
    expect(log.released).toEqual(['r'.repeat(64)])
  })

  /**
   * Cuando el pedido YA existe no hay nada que compensar: deshacerlo no es
   * «soltar una reserva», es cancelar una venta, y eso lo decide una persona.
   */
  it('creado el pedido no queda nada que compensar: ni se suelta ni se anula', async () => {
    // Antes esto se comprobaba haciendo fallar la marca de `publish_events`,
    // pero esa marca ya no existe —el intento queda cerrado dentro de la
    // transacción del pedido—, así que el fallo era imposible y la prueba
    // vigilaba un camino muerto. Lo que importa se comprueba igual: con un
    // cobro autorizado y una reserva viva, un pedido creado las deja quietas.
    const { ports: p, log } = ports({
      authorizePayment: () =>
        Promise.resolve({
          status: 'authorized' as const,
          providerCode: 'fake',
          providerReference: 'auth-1',
          providerMessage: null,
        }),
    })

    const result = await runCheckout(p, input())

    expect(result.ok).toBe(true)
    expect(log.released).toEqual([])
    expect(log.voided).toBe(0)
  })

  it('un carrito vacío ni siquiera reclama el intento', async () => {
    const begin = vi.fn()
    const { ports: p } = ports({ begin: begin as unknown as CheckoutPorts['begin'] })

    const error = await expectStageFailure(() => runCheckout(p, input({ items: [] })))

    expect(error.code).toBe('ITEMS_REQUERIDOS')
    expect(begin).not.toHaveBeenCalled()
  })

  it('lo desconocido no se marca reintentable', async () => {
    const { ports: p } = ports({
      resolvePrices: () => Promise.reject(new Error('algo raro sin codigo de negocio')),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))
    expect(error.code).toBe('ERROR_INTERNO')
    expect(error.status).toBe(500)
    expect(error.retryable).toBe(false)
  })
})

describe('la cuenta B2B y su limite', () => {
  it('un importe por encima del limite personal no compra', async () => {
    const place = vi.fn()
    const { ports: p, log } = ports({
      resolveAccount: () =>
        Promise.resolve({
          hasSession: true,
          accountId: '55555555-5555-4555-8555-555555555555',
          role: 'buyer',
          spendingLimit: '100.00',
        }),
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('LIMITE_DE_AUTORIZACION')
    expect(error.stage).toBe('authorize_payment')
    expect(place).not.toHaveBeenCalled()
    // Y la existencia vuelve: no se queda apartada por un límite administrativo.
    expect(log.released).toEqual(['r'.repeat(64)])
  })

  it('sin limite declarado, el importe no lo bloquea', async () => {
    const { ports: p } = ports({
      resolveAccount: () =>
        Promise.resolve({
          hasSession: true,
          accountId: '55555555-5555-4555-8555-555555555555',
          role: 'admin',
          spendingLimit: null,
        }),
    })

    const result = await runCheckout(p, input())
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// P08-SaaS · la autorizacion de compra
// ---------------------------------------------------------------------------
describe('la aprobacion B2B', () => {
  const withAccount = (overrides: Partial<CheckoutPorts> = {}) =>
    ports({
      resolveAccount: () =>
        Promise.resolve({
          hasSession: true,
          accountId: ACCOUNT,
          role: 'buyer',
          spendingLimit: null,
        }),
      ...overrides,
    })

  it('se pregunta con el TOTAL ya calculado, no antes', async () => {
    const ask = vi.fn(() =>
      Promise.resolve({ required: true, reason: 'account_threshold', purchaseOrderRequired: false }),
    )
    const { ports: p } = withAccount({ resolveApproval: ask })

    const result = await runCheckout(p, input())

    expect(ask).toHaveBeenCalledWith(ACCOUNT, '236.00')
    expect(result.approval).toEqual({
      required: true,
      reason: 'account_threshold',
      purchaseOrderRequired: false,
    })
  })

  it('lo que responde llega a la transaccion del pedido', async () => {
    const place = vi.fn(() => Promise.resolve(ORDER_RESULT))
    const { ports: p } = withAccount({
      resolveApproval: () =>
        Promise.resolve({ required: true, reason: 'rule', purchaseOrderRequired: true }),
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
    })

    // Desde N05 una cuenta con `purchaseOrderRequired` no llega a la
    // transacción sin orden de compra (ver el bloque de abajo): se manda una.
    await runCheckout(p, { ...input(), purchaseOrderNumber: 'OC-1' })

    const arg = (place.mock.calls as unknown as unknown[][])[0]?.[0] as {
      account: { accountId: string | null }
      approval: { required: boolean; reason: string | null } | null
    }
    expect(arg.account.accountId).toBe(ACCOUNT)
    expect(arg.approval).toMatchObject({ required: true, reason: 'rule' })
  })

  it('N05 · cuenta con OC obligatoria y sin OC: se detiene ANTES de cobrar y de crear el pedido', async () => {
    const place = vi.fn(() => Promise.resolve(ORDER_RESULT))
    const pay = vi.fn()
    const { ports: p } = withAccount({
      resolveApproval: () => Promise.resolve({ required: false, reason: null, purchaseOrderRequired: true }),
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
      authorizePayment: pay as unknown as CheckoutPorts['authorizePayment'],
    })

    await expect(runCheckout(p, input())).rejects.toMatchObject({
      code: 'ORDEN_COMPRA_REQUERIDA',
      stage: 'authorize_payment',
      status: 422,
    })
    expect(pay).not.toHaveBeenCalled()
    expect(place).not.toHaveBeenCalled()
  })

  it('N05 · con OC, la orden de compra llega tal cual a la transacción del pedido', async () => {
    const place = vi.fn(() => Promise.resolve(ORDER_RESULT))
    const { ports: p } = withAccount({
      resolveApproval: () => Promise.resolve({ required: false, reason: null, purchaseOrderRequired: true }),
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
    })

    await runCheckout(p, { ...input(), purchaseOrderNumber: 'OC-2026-00125' })

    const arg = (place.mock.calls as unknown as unknown[][])[0]?.[0] as { request: { purchaseOrderNumber?: string | null } }
    expect(arg.request.purchaseOrderNumber).toBe('OC-2026-00125')
  })

  it('un comprador SIN cuenta no entra al circuito: no se pregunta nada', async () => {
    const ask = vi.fn()
    const { ports: p } = ports({ resolveApproval: ask as unknown as CheckoutPorts['resolveApproval'] })

    const result = await runCheckout(p, input())

    expect(ask).not.toHaveBeenCalled()
    expect(result.approval).toBeNull()
  })

  it('si el portal B2B no contesta, la compra sigue: la base impone el umbral', async () => {
    const place = vi.fn(() => Promise.resolve(ORDER_RESULT))
    const { ports: p } = withAccount({
      resolveApproval: () => Promise.reject(new Error('portal caido')),
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
    })

    const result = await runCheckout(p, input())

    expect(result.ok).toBe(true)
    expect(result.approval).toBeNull()
    const arg = (place.mock.calls as unknown as unknown[][])[0]?.[0] as { approval: unknown }
    expect(arg.approval).toBeNull()
  })
})


// ===========================================================================
// P10-SaaS · promociones y tarjeta regalo en el pipeline
// ===========================================================================
describe('promociones (P10)', () => {
  /** Lo que devuelve un motor de promociones de verdad: totales ya recalculados. */
  const withDiscount = (overrides: Partial<CheckoutPorts> = {}) =>
    ports({
      resolvePromotions: () =>
        Promise.resolve({
          adjustments: [{ code: 'verano', label: 'Verano', amount: '20.00', productId: null }],
          discountTotal: '20.00',
          lines: [
            {
              lineKey: 1,
              discount: '20.00',
              adjustments: [
                { code: 'verano', label: 'Verano', amount: '20.00', productId: PRODUCT },
              ],
            },
          ],
          coupons: [{ code: 'VERANO', status: 'aplicado' }],
          skipped: [],
          totals: {
            subtotal: '200.00',
            discountTotal: '20.00',
            taxTotal: '32.40',
            grandTotal: '212.40',
          },
        }),
      ...overrides,
    })

  it('el total que llega a la pasarela es el del SERVIDOR, con el descuento dentro', async () => {
    const authorize = vi.fn(() =>
      Promise.resolve({
        status: 'authorized' as const,
        providerCode: 'sandbox',
        providerReference: 'auth-1',
        providerMessage: null,
      }),
    )
    const { ports: p } = withDiscount({
      authorizePayment: authorize as unknown as CheckoutPorts['authorizePayment'],
    })

    await runCheckout(p, input({ couponCodes: ['VERANO'] }))

    const request = (authorize.mock.calls as unknown as unknown[][])[0]?.[0] as { amount: string }
    // 200 − 20 = 180 de base, 18 % = 32.40, total 212.40. Ni el pipeline ni el
    // navegador han hecho esa cuenta: la trajo hecha el servidor.
    expect(request.amount).toBe('212.40')
  })

  it('los codigos tecleados llegan al puerto tal cual, sin importe ninguno', async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({
        adjustments: [], discountTotal: '0.00', lines: [], coupons: [], skipped: [],
        totals: { subtotal: '200.00', discountTotal: '0.00', taxTotal: '36.00', grandTotal: '236.00' },
      }),
    )
    const { ports: p } = ports({
      resolvePromotions: resolve as unknown as CheckoutPorts['resolvePromotions'],
    })

    await runCheckout(p, input({ couponCodes: ['VERANO', 'BIENVENIDA'] }))

    const arg = (resolve.mock.calls as unknown as unknown[][])[0]?.[0] as Record<string, unknown>
    expect(arg.couponCodes).toEqual(['VERANO', 'BIENVENIDA'])
    // Y nada mas del dinero: el puerto no recibe ni un importe de descuento.
    expect(Object.keys(arg).sort()).toEqual([
      'account', 'context', 'couponCodes', 'customerEmail', 'items', 'quote',
    ])
  })

  it('el desglose viaja en la respuesta, incluido lo que NO se aplico', async () => {
    const { ports: p } = withDiscount()
    const result = await runCheckout(p, input())

    expect(result.promotions?.adjustments).toHaveLength(1)
    expect(result.promotions?.coupons[0]?.status).toBe('aplicado')
    expect(result.promotions?.lines[0]?.discount).toBe('20.00')
  })

  /**
   * Esta es la comprobacion cara: el ULTIMO punto entre el calculo y el cobro
   * donde un descuadre se puede parar. Cuesta un 500; no pararlo cuesta un
   * cargo mal hecho.
   */
  it('unos totales que no cuadran entre si detienen la compra ANTES de cobrar', async () => {
    const authorize = vi.fn(() => Promise.resolve({
      status: 'authorized' as const, providerCode: null,
      providerReference: null, providerMessage: null,
    }))
    const { ports: p } = ports({
      authorizePayment: authorize as unknown as CheckoutPorts['authorizePayment'],
      resolvePromotions: () =>
        Promise.resolve({
          adjustments: [], discountTotal: '20.00', lines: [], coupons: [], skipped: [],
          // 200 + 32.40 − 20 = 212.40, y aqui dice 999.99.
          totals: {
            subtotal: '200.00', discountTotal: '20.00',
            taxTotal: '32.40', grandTotal: '999.99',
          },
        }),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('TOTALES_INCOHERENTES')
    expect(error.stage).toBe('calculate_taxes')
    expect(authorize).not.toHaveBeenCalled()
  })

  it('un descuento SIN totales detras no llega a un importe cobrado', async () => {
    const { ports: p } = ports({
      resolvePromotions: () =>
        Promise.resolve({
          adjustments: [], discountTotal: '20.00', lines: [], coupons: [], skipped: [],
        }),
    })

    const error = await expectStageFailure(() => runCheckout(p, input()))

    expect(error.code).toBe('PROMOCION_NO_SOPORTADA')
    expect(error.stage).toBe('calculate_taxes')
  })

  it('sin motor (el gancho neutro) los importes son EXACTAMENTE los de P07', async () => {
    const authorize = vi.fn(() => Promise.resolve({
      status: 'not_required' as const, providerCode: null,
      providerReference: null, providerMessage: null,
    }))
    const { ports: p } = ports({
      authorizePayment: authorize as unknown as CheckoutPorts['authorizePayment'],
    })

    const result = await runCheckout(p, input())

    expect(result.ok).toBe(true)
    const request = (authorize.mock.calls as unknown as unknown[][])[0]?.[0] as { amount: string }
    expect(request.amount).toBe('236.00')
  })
})

describe('tarjeta regalo (P10)', () => {
  const TENDER = {
    redemptions: [
      { giftCardId: 'gc-1', last4: '9821', applied: '100.00', reference: 'k:gc:0' },
    ],
    applied: '100.00',
    remaining: '136.00',
  }

  const withCard = (overrides: Partial<CheckoutPorts> = {}) =>
    ports({ applyGiftCards: () => Promise.resolve(TENDER), ...overrides })

  it('a la pasarela se le pide el RESTO, no el total', async () => {
    const authorize = vi.fn(() => Promise.resolve({
      status: 'authorized' as const, providerCode: 'sandbox',
      providerReference: 'auth-1', providerMessage: null,
    }))
    const { ports: p } = withCard({
      authorizePayment: authorize as unknown as CheckoutPorts['authorizePayment'],
    })

    const result = await runCheckout(p, input({ giftCardCodes: ['ABCD1234'] }))

    const request = (authorize.mock.calls as unknown as unknown[][])[0]?.[0] as { amount: string }
    expect(request.amount).toBe('136.00')
    expect(result.giftCards?.applied).toBe('100.00')
  })

  it('si el saldo cubre todo, no se llama a ninguna pasarela', async () => {
    const authorize = vi.fn()
    const { ports: p } = ports({
      applyGiftCards: () =>
        Promise.resolve({
          redemptions: [
            { giftCardId: 'gc-1', last4: '9821', applied: '236.00', reference: 'k:gc:0' },
          ],
          applied: '236.00',
          remaining: '0.00',
        }),
      authorizePayment: authorize as unknown as CheckoutPorts['authorizePayment'],
    })

    const result = await runCheckout(p, input({ giftCardCodes: ['ABCD1234'] }))

    // Un cargo de cero lo rechazan unas pasarelas y lo cobran todas.
    expect(authorize).not.toHaveBeenCalled()
    expect(result.payment?.status).toBe('not_required')
  })

  it('sin codigos no se pregunta por ninguna tarjeta', async () => {
    const apply = vi.fn()
    const { ports: p } = ports({
      applyGiftCards: apply as unknown as CheckoutPorts['applyGiftCards'],
    })

    await runCheckout(p, input())

    expect(apply).not.toHaveBeenCalled()
  })

  it('si el pedido falla DESPUES de canjear, el saldo se devuelve', async () => {
    const { ports: p, log } = withCard({
      placeOrder: () => Promise.reject(new Error('PEDIDO_FALLIDO: la base dijo que no')),
    })

    const error = await expectStageFailure(() =>
      runCheckout(p, input({ giftCardCodes: ['ABCD1234'] })),
    )

    // Saldo gastado sin pedido detras es dinero del comprador que se quedo el
    // comercio, y es el unico de los tres efectos que el comprador no puede
    // reclamar por su cuenta.
    expect(log.giftCardsReleased).toBe(1)
    expect(error.compensations.some((entry) => entry.startsWith('release_gift_cards'))).toBe(true)
    // Y la reserva de existencia tambien se solto, en orden inverso.
    expect(log.released).toHaveLength(1)
  })

  it('el canje llega a `placeOrder` para poder atarlo al pedido', async () => {
    const place = vi.fn(() => Promise.resolve(ORDER_RESULT))
    const { ports: p } = withCard({
      placeOrder: place as unknown as CheckoutPorts['placeOrder'],
    })

    await runCheckout(p, input({ giftCardCodes: ['ABCD1234'] }))

    const arg = (place.mock.calls as unknown as unknown[][])[0]?.[0] as {
      giftCards: { redemptions: unknown[] } | null
    }
    expect(arg.giftCards?.redemptions).toHaveLength(1)
  })
})
