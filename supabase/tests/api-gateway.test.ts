// @vitest-environment node
/**
 * P14-SaaS · la PUERTA de la API de socio y la firma de los webhooks, con
 * puertos falsos y sin base de datos.
 *
 * Aquí no hay Postgres: se comprueba la parte que decide ANTES de tocar nada
 * —el orden de las comprobaciones, la forma del error, la idempotencia, la
 * documentación generada— y la criptografía de la firma, que no depende de
 * ninguna fila.
 *
 * El orden de las comprobaciones es una decisión de SEGURIDAD y por eso tiene
 * casos propios: versión → token y scope → límite de tasa → idempotencia →
 * operación. Contar el límite antes de autenticar dejaría agotar el cupo de un
 * socio desde fuera con solo conocer su `client_id`.
 *
 * ## La Definition of Done de la fase se comprueba en parte AQUÍ
 *
 *   «PASS si añadir SAP/ERP/pago/logística/mensajería como providers no
 *    requiere modificar el core.»
 *
 * El último bloque conecta un operador inventado —un conector que no existe en
 * ninguna parte del repositorio— y lo hace pasar por el trabajador entero:
 * firma, entrega, reintento y cola muerta. Si algún día hiciera falta tocar el
 * despachador para dar de alta un destino, ese test dejaría de compilar o de
 * pasar.
 */
import { describe, expect, it } from 'vitest'
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  API_VERSION,
  ApiError,
  toApiError,
} from '../functions/_shared/api/contract.ts'
import { API_ROUTES, matchRoute } from '../functions/_shared/api/routes.ts'
import { buildOpenApiDocument } from '../functions/_shared/api/openapi.ts'
import {
  handleApiRequest,
  stableStringify,
  type ApiAuthContext,
  type GatewayPorts,
} from '../functions/_shared/api/gateway.ts'
import { sha256Hex } from '../functions/_shared/checkout/request.ts'
import {
  signWebhook,
  verifyWebhookSignature,
  SIGNATURE_HEADER,
  EVENT_ID_HEADER,
} from '../functions/_shared/webhooks/signature.ts'
import {
  dispatchWebhooks,
  webhookSecretEnvName,
  WEBHOOK_PROVIDER_CODE,
  type DispatcherPorts,
  type OutboxMessage,
} from '../functions/_shared/webhooks/dispatcher.ts'

const TRACE = { correlationId: 'ec-hilo-de-prueba', requestId: 'req-de-prueba' }

const AUTH: ApiAuthContext = {
  api_client_id: '9f000000-0000-4000-8000-000000000001',
  client_id: `ec_${'a'.repeat(32)}`,
  scopes: ['order.read', 'order.create'],
  rate_limit_per_minute: 120,
}

interface Recorded {
  resources: Array<{ rpc: string; args: Record<string, unknown> }>
  completed: Array<{ requestId: string; status: number }>
  finished: Array<{ key: string; status: number }>
}

function makePorts(
  overrides: Partial<GatewayPorts> = {},
): { ports: GatewayPorts; log: Recorded } {
  const log: Recorded = { resources: [], completed: [], finished: [] }
  const ports: GatewayPorts = {
    hash: (value) => sha256Hex(value),
    issueToken: async () => ({ access_token: 't', token_type: 'Bearer', expires_in: 3600 }),
    authenticate: async () => AUTH,
    rateLimit: async () => ({ request_id: 'req-1', limit: 120, remaining: 119 }),
    completeRequest: async (requestId, status) => {
      log.completed.push({ requestId, status })
    },
    idempotencyBegin: async () => ({ status: 'nuevo' }),
    idempotencyFinish: async ({ key, status }) => {
      log.finished.push({ key, status })
    },
    callResource: async (rpc, args) => {
      log.resources.push({ rpc, args })
      return { data: [], next_cursor: null }
    },
    ...overrides,
  }
  return { ports, log }
}

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Request {
  return new Request(`https://api.test${path}`, {
    method: init.method ?? 'GET',
    headers: init.headers ?? { authorization: 'Bearer token-de-prueba' },
    ...(init.body === undefined ? {} : { body: init.body }),
  })
}

function jsonPost(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return request(path, {
    method: 'POST',
    headers: {
      authorization: 'Bearer token-de-prueba',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------

describe('la tabla de rutas', () => {
  it('resuelve marcadores y distingue «no existe» de «asi no»', () => {
    const ok = matchRoute('GET', '/v1/orders/EC-000123')
    expect(ok.match?.route.operationId).toBe('getOrder')
    expect(ok.match?.params.number).toBe('EC-000123')

    const noExiste = matchRoute('GET', '/v1/facturas')
    expect(noExiste.match).toBeNull()
    expect(noExiste.methodMismatch).toBe(false)

    // El camino existe, el método no: son 404 y 405, y confundirlos le dice a
    // quien integra que el recurso no existe cuando lo está pidiendo mal.
    const asiNo = matchRoute('DELETE', '/v1/orders')
    expect(asiNo.match).toBeNull()
    expect(asiNo.methodMismatch).toBe(true)
  })

  it('ninguna ruta declara dos veces el mismo operationId', () => {
    const ids = API_ROUTES.map((route) => route.operationId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('toda escritura exige clave de idempotencia', () => {
    const sinClave = API_ROUTES.filter(
      (route) => route.method === 'POST' && !route.requiresIdempotencyKey,
    )
    expect(sinClave).toEqual([])
  })
})

describe('la documentacion se GENERA de la tabla de rutas', () => {
  const document = buildOpenApiDocument('https://api.test')
  const paths = document.paths as Record<string, Record<string, unknown>>

  it('describe exactamente las rutas que se sirven, ni una mas ni una menos', () => {
    const documented = new Set(
      Object.entries(paths)
        .filter(([path]) => path !== '/v1/oauth/token')
        .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method} ${path}`)),
    )
    const served = new Set(API_ROUTES.map((r) => `${r.method.toLowerCase()} ${r.path}`))
    expect([...documented].sort()).toEqual([...served].sort())
  })

  it('cada operacion declara el scope que de verdad exige', () => {
    for (const route of API_ROUTES) {
      const operation = paths[route.path]?.[route.method.toLowerCase()] as Record<string, unknown>
      expect(operation.security).toEqual([{ bearerAuth: [route.scope] }])
    }
  })

  it('el endpoint de token no pide token', () => {
    const token = paths['/v1/oauth/token']?.post as Record<string, unknown>
    expect(token.security).toEqual([])
  })

  it('los codigos de error del contrato estan en el esquema publicado', () => {
    const publicado = JSON.parse(JSON.stringify(document)) as {
      components: { schemas: { Error: { properties: { error: { properties: { code: { enum: string[] } } } } } } }
    }
    expect(publicado.components.schemas.Error.properties.error.properties.code.enum).toEqual([
      ...API_ERROR_CODES,
    ])
  })
})

describe('la puerta: version y forma', () => {
  it('sirve la documentacion sin token', async () => {
    const { ports } = makePorts()
    const result = await handleApiRequest(
      new Request('https://api.test/v1/openapi.json'),
      ports,
      TRACE,
    )
    expect(result.status).toBe(200)
    expect((result.body as Record<string, unknown>).openapi).toBe('3.1.0')
  })

  it('una version que no se sirve se dice con su propio codigo', async () => {
    const { ports } = makePorts()
    const result = await handleApiRequest(request('/v2/orders'), ports, TRACE)
    expect(result.status).toBe(400)
    expect((result.body as { error: { code: string } }).error.code).toBe('VERSION_NO_SOPORTADA')
  })

  it('una ruta que no existe es 404 y una mal pedida es 405', async () => {
    const { ports } = makePorts()
    const noExiste = await handleApiRequest(request('/v1/facturas'), ports, TRACE)
    expect(noExiste.status).toBe(404)

    const asiNo = await handleApiRequest(
      request('/v1/orders', { method: 'DELETE' }),
      ports,
      TRACE,
    )
    expect(asiNo.status).toBe(405)
  })

  /**
   * La función puede desplegarse bajo cualquier prefijo; lo que importa es el
   * camino a partir de `/v1`. Sin esto, un cambio de despliegue rompería todas
   * las rutas a la vez.
   */
  it('funciona bajo el prefijo de despliegue de la plataforma', async () => {
    const { ports, log } = makePorts()
    const result = await handleApiRequest(
      new Request('https://proyecto.functions.test/functions/v1/api/v1/orders', {
        headers: { authorization: 'Bearer token-de-prueba' },
      }),
      ports,
      TRACE,
    )
    expect(result.status).toBe(200)
    expect(log.resources[0]?.rpc).toBe('api_orders_list')
  })

  it('el HILO vuelve en toda respuesta, incluida la de error', async () => {
    const { ports } = makePorts()
    const ok = await handleApiRequest(request('/v1/orders'), ports, TRACE)
    const ko = await handleApiRequest(request('/v1/facturas'), ports, TRACE)

    for (const result of [ok, ko]) {
      expect(result.headers['x-correlation-id']).toBe(TRACE.correlationId)
      expect(result.headers['x-request-id']).toBe(TRACE.requestId)
    }
    expect((ko.body as { error: { correlation_id: string } }).error.correlation_id).toBe(
      TRACE.correlationId,
    )
  })
})

describe('la puerta: autenticacion y permisos', () => {
  it('sin cabecera Authorization no se llega a la base', async () => {
    const { ports, log } = makePorts()
    const result = await handleApiRequest(
      new Request('https://api.test/v1/orders'),
      ports,
      TRACE,
    )
    expect(result.status).toBe(401)
    expect((result.body as { error: { code: string } }).error.code).toBe('NO_AUTENTICADO')
    expect(log.resources).toEqual([])
  })

  /** El token no viaja a la base: viaja su sha256. */
  it('lo que se le pasa a la base es el HASH del token, nunca el token', async () => {
    let seen = ''
    const { ports } = makePorts({
      authenticate: async (tokenHash) => {
        seen = tokenHash
        return AUTH
      },
    })
    await handleApiRequest(request('/v1/orders'), ports, TRACE)
    expect(seen).toBe(await sha256Hex('token-de-prueba'))
    expect(seen).not.toContain('token-de-prueba')
  })

  it('un scope que falta es 403 y no llega al recurso', async () => {
    const { ports, log } = makePorts({
      authenticate: async () => {
        throw new Error('SCOPE_INSUFICIENTE: la credencial no incluye order.read')
      },
    })
    const result = await handleApiRequest(request('/v1/orders'), ports, TRACE)
    expect(result.status).toBe(403)
    expect((result.body as { error: { code: string } }).error.code).toBe('SCOPE_INSUFICIENTE')
    expect(log.resources).toEqual([])
  })

  /**
   * El límite se cuenta DESPUÉS de autenticar. Si se contara antes, cualquiera
   * que conociera un `client_id` podría agotar el cupo del socio desde fuera.
   */
  it('el limite de tasa se cuenta despues de autenticar, no antes', async () => {
    const orden: string[] = []
    const { ports } = makePorts({
      authenticate: async () => {
        orden.push('auth')
        return AUTH
      },
      rateLimit: async () => {
        orden.push('rate')
        return { request_id: 'req-1', limit: 120, remaining: 119 }
      },
    })
    await handleApiRequest(request('/v1/orders'), ports, TRACE)
    expect(orden).toEqual(['auth', 'rate'])
  })

  it('pasarse del limite es 429', async () => {
    const { ports } = makePorts({
      rateLimit: async () => {
        throw new Error('LIMITE_DE_TASA: esta credencial supero 120 peticiones por minuto')
      },
    })
    const result = await handleApiRequest(request('/v1/orders'), ports, TRACE)
    expect(result.status).toBe(429)
  })

  it('la respuesta dice cuanto queda de cupo', async () => {
    const { ports } = makePorts()
    const result = await handleApiRequest(request('/v1/orders'), ports, TRACE)
    expect(result.headers['x-ratelimit-limit']).toBe('120')
    expect(result.headers['x-ratelimit-remaining']).toBe('119')
  })
})

describe('la puerta: parametros', () => {
  it('solo se reenvia lo que la ruta DECLARA', async () => {
    const { ports, log } = makePorts()
    await handleApiRequest(
      request('/v1/orders?limit=10&status=pending&p_secreto=1&organization_id=x'),
      ports,
      TRACE,
    )
    expect(log.resources[0]?.args).toEqual({
      p_api_client_id: AUTH.api_client_id,
      p_limit: 10,
      p_status: 'pending',
    })
  })

  /** El tenant no puede llegar por la query: no está declarado, así que se cae. */
  it('un intento de declarar el tenant en la query no llega a la base', async () => {
    const { ports, log } = makePorts()
    await handleApiRequest(request('/v1/orders?company_id=otro-tenant'), ports, TRACE)
    expect(JSON.stringify(log.resources[0]?.args)).not.toContain('company_id')
  })

  it('un entero mal escrito es 400 y no llega al recurso', async () => {
    const { ports, log } = makePorts()
    const result = await handleApiRequest(request('/v1/orders?limit=muchos'), ports, TRACE)
    expect(result.status).toBe(400)
    expect(log.resources).toEqual([])
  })

  it('el marcador de ruta llega como argumento', async () => {
    const { ports, log } = makePorts()
    await handleApiRequest(request('/v1/stock/SKU-001'), ports, TRACE)
    expect(log.resources[0]).toEqual({
      rpc: 'api_stock_read',
      args: { p_api_client_id: AUTH.api_client_id, p_sku: 'SKU-001' },
    })
  })
})

describe('la puerta: idempotencia de las escrituras', () => {
  const body = { customer: { email: 'socio@test.com' }, items: [{ sku: 'A', quantity: 1 }] }

  it('sin clave de idempotencia no se crea nada', async () => {
    const { ports, log } = makePorts()
    const result = await handleApiRequest(jsonPost('/v1/orders', body), ports, TRACE)
    expect(result.status).toBe(400)
    expect(log.resources).toEqual([])
  })

  it('con clave nueva se opera y se guarda la respuesta', async () => {
    const { ports, log } = makePorts()
    const result = await handleApiRequest(
      jsonPost('/v1/orders', body, { 'idempotency-key': 'pedido-0001' }),
      ports,
      TRACE,
    )
    expect(result.status).toBe(201)
    expect(log.resources[0]?.rpc).toBe('api_order_create')
    expect(log.finished).toEqual([{ key: 'pedido-0001', status: 201 }])
  })

  /**
   * La propiedad que hace inofensivo el reintento automático de cualquier
   * cliente HTTP: la segunda llamada NO vuelve a operar.
   */
  it('repetir la clave devuelve la PRIMERA respuesta y no vuelve a operar', async () => {
    const { ports, log } = makePorts({
      idempotencyBegin: async () => ({
        status: 'repetido',
        http_status: 201,
        response: { number: 'EC-000001' },
      }),
    })
    const result = await handleApiRequest(
      jsonPost('/v1/orders', body, { 'idempotency-key': 'pedido-0001' }),
      ports,
      TRACE,
    )
    expect(result.status).toBe(201)
    expect(result.body).toEqual({ number: 'EC-000001' })
    expect(result.headers['idempotent-replay']).toBe('true')
    expect(log.resources).toEqual([])
  })

  it('la misma clave todavia en curso es 409, no una segunda operacion', async () => {
    const { ports, log } = makePorts({
      idempotencyBegin: async () => ({ status: 'en_curso' }),
    })
    const result = await handleApiRequest(
      jsonPost('/v1/orders', body, { 'idempotency-key': 'pedido-0001' }),
      ports,
      TRACE,
    )
    expect(result.status).toBe(409)
    expect((result.body as { error: { code: string } }).error.code).toBe('IDEMPOTENCIA_EN_CURSO')
    expect(log.resources).toEqual([])
  })

  it('la misma clave con otro contenido es 409 explicito', async () => {
    const { ports } = makePorts({
      idempotencyBegin: async () => {
        throw new Error('IDEMPOTENCIA_CONFLICTO: esa clave ya se uso con otro contenido')
      },
    })
    const result = await handleApiRequest(
      jsonPost('/v1/orders', body, { 'idempotency-key': 'pedido-0001' }),
      ports,
      TRACE,
    )
    expect(result.status).toBe(409)
  })

  /**
   * La huella se calcula sobre el cuerpo REORDENADO: dos envíos con las mismas
   * claves en otro orden son la misma petición, y tratarlos como distintas
   * devolvería un 409 a un cliente que no hizo nada mal.
   */
  it('el orden de las claves del cuerpo no cambia la huella', () => {
    const uno = stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })
    const dos = stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 })
    expect(uno).toBe(dos)
  })
})

describe('los errores nunca filtran internos', () => {
  it('un error crudo de la base sale como ERROR_INTERNO y sin su texto', async () => {
    const { ports } = makePorts({
      callResource: async () => {
        throw new Error(
          'permission denied for table orders; policy "orders_select_member" on relation public.orders',
        )
      },
    })
    const result = await handleApiRequest(request('/v1/orders'), ports, TRACE)
    expect(result.status).toBe(500)
    const payload = JSON.stringify(result.body)
    expect(payload).not.toContain('orders_select_member')
    expect(payload).not.toContain('policy')
    expect((result.body as { error: { code: string } }).error.code).toBe('ERROR_INTERNO')
  })

  it('la puerta NUNCA lanza: cualquier cosa sale como respuesta', async () => {
    const { ports } = makePorts({
      authenticate: async () => {
        throw { extraño: true }
      },
    })
    const result = await handleApiRequest(request('/v1/orders'), ports, TRACE)
    expect(result.status).toBe(500)
  })

  it('el estado de la peticion se cierra tambien cuando falla', async () => {
    const { ports, log } = makePorts({
      callResource: async () => {
        throw new Error('ERROR_INTERNO: lo que sea')
      },
    })
    await handleApiRequest(request('/v1/orders'), ports, TRACE)
    expect(log.completed).toEqual([{ requestId: 'req-1', status: 500 }])
  })

  it('cada codigo canonico tiene un estado, y ninguno se queda sin traducir', () => {
    for (const code of API_ERROR_CODES) {
      expect(typeof API_ERROR_STATUS[code]).toBe('number')
    }
    expect(toApiError(new ApiError('LIMITE_DE_TASA', 'x')).status).toBe(429)
    expect(toApiError(new Error('CODIGO_QUE_NADIE_MAPEA: detalle')).code).toBe('ERROR_INTERNO')
  })
})

describe('el endpoint de token', () => {
  it('exige el grant correcto', async () => {
    const { ports } = makePorts()
    const result = await handleApiRequest(
      jsonPost('/v1/oauth/token', { grant_type: 'password' }),
      ports,
      TRACE,
    )
    expect(result.status).toBe(400)
  })

  it('un client_id con forma invalida da el MISMO error que uno inexistente', async () => {
    const { ports } = makePorts()
    const result = await handleApiRequest(
      jsonPost('/v1/oauth/token', {
        grant_type: 'client_credentials',
        client_id: 'no-tiene-forma',
        client_secret: 'x'.repeat(64),
      }),
      ports,
      TRACE,
    )
    expect((result.body as { error: { code: string } }).error.code).toBe('CREDENCIAL_INVALIDA')
  })

  it('los scopes pedidos viajan separados por espacios, como manda OAuth', async () => {
    let seen: string[] | null = ['sin-llamar']
    const { ports } = makePorts({
      issueToken: async ({ scopes }) => {
        seen = scopes
        return { access_token: 't' }
      },
    })
    await handleApiRequest(
      jsonPost('/v1/oauth/token', {
        grant_type: 'client_credentials',
        client_id: `ec_${'a'.repeat(32)}`,
        client_secret: 'x'.repeat(64),
        scope: 'order.read  stock.read',
      }),
      ports,
      TRACE,
    )
    expect(seen).toEqual(['order.read', 'stock.read'])
  })
})

// ---------------------------------------------------------------------------

describe('la firma de los webhooks', () => {
  const secret = 'secreto-del-endpoint'
  const body = JSON.stringify({ event_id: 'abc', data: { total: '100.00' } })

  it('lo que firmamos, el receptor lo verifica', async () => {
    const signed = await signWebhook({ secret, rawBody: body })
    expect(signed.header).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/)
    expect(
      await verifyWebhookSignature({ secret, header: signed.header, rawBody: body }),
    ).toBe(true)
  })

  it('otro secreto no valida', async () => {
    const signed = await signWebhook({ secret, rawBody: body })
    expect(
      await verifyWebhookSignature({ secret: 'otro', header: signed.header, rawBody: body }),
    ).toBe(false)
  })

  it('un cuerpo tocado no valida, aunque cambie un solo caracter', async () => {
    const signed = await signWebhook({ secret, rawBody: body })
    const tocado = body.replace('100.00', '100.01')
    expect(
      await verifyWebhookSignature({ secret, header: signed.header, rawBody: tocado }),
    ).toBe(false)
  })

  /**
   * El instante va DENTRO de lo firmado. Sin él, una firma válida lo es para
   * siempre y quien capture una entrega puede reproducirla contra el sistema
   * del cliente meses después.
   */
  it('una entrega vieja no se puede reproducir contra el receptor', async () => {
    const hace = Math.floor(Date.now() / 1000) - 3600
    const signed = await signWebhook({ secret, rawBody: body, timestampSeconds: hace })

    expect(await verifyWebhookSignature({ secret, header: signed.header, rawBody: body })).toBe(
      false,
    )
    // Dentro de la ventana, la misma firma sí vale.
    expect(
      await verifyWebhookSignature({
        secret,
        header: signed.header,
        rawBody: body,
        nowSeconds: hace + 10,
      }),
    ).toBe(true)
  })

  it('mover el reloj de la cabecera invalida la firma', async () => {
    const signed = await signWebhook({ secret, rawBody: body })
    const falsificada = signed.header.replace(/^t=\d+/, `t=${Math.floor(Date.now() / 1000) + 1}`)
    expect(
      await verifyWebhookSignature({ secret, header: falsificada, rawBody: body }),
    ).toBe(false)
  })

  it('sin secreto o sin cabecera no valida, y no revienta', async () => {
    expect(await verifyWebhookSignature({ secret: null, header: 'x', rawBody: body })).toBe(false)
    expect(await verifyWebhookSignature({ secret, header: null, rawBody: body })).toBe(false)
    expect(await verifyWebhookSignature({ secret, header: 'basura', rawBody: body })).toBe(false)
  })
})

describe('el trabajador que vacia la cola', () => {
  const endpoint = {
    id: '8f000000-0000-4000-8000-000000000001',
    name: 'erp-pedidos',
    url: 'https://erp.cliente.test/hooks',
    api_version: 'v1',
    secret_ref: 'EBIM_WEBHOOK_SECRET_ERP',
  }

  function message(overrides: Partial<OutboxMessage> = {}): OutboxMessage {
    return {
      id: '7f000000-0000-4000-8000-000000000001',
      organization_id: '0a000000-0000-4000-8000-000000000001',
      company_id: '0a000000-0000-4000-8000-0000000000c1',
      provider_code: WEBHOOK_PROVIDER_CODE,
      operation: 'event.publish',
      target: endpoint.id,
      payload: { event_id: 'evt-1', event_type: 'order.created', delivery_id: 'del-1', data: {} },
      attempts: 1,
      correlation_id: 'ec-hilo-de-prueba',
      ...overrides,
    }
  }

  interface Sent {
    url: string
    body: string
    headers: Record<string, string>
  }

  function makeDispatcher(
    options: {
      messages?: OutboxMessage[]
      status?: number
      secret?: string | null
      target?: typeof endpoint | null
      throwOnSend?: boolean
    } = {},
  ) {
    const sent: Sent[] = []
    const succeeded: Array<{ id: string; status: number }> = []
    const failed: Array<{ id: string; error: string; status: number | null }> = []

    const ports: DispatcherPorts = {
      now: () => 1_000,
      claim: async () => options.messages ?? [message()],
      resolveTarget: async () => (options.target === undefined ? endpoint : options.target),
      resolveSecret: () => (options.secret === undefined ? 'secreto' : options.secret),
      send: async (input) => {
        if (options.throwOnSend) throw new DOMException('Aborted', 'AbortError')
        sent.push({ url: input.url, body: input.body, headers: input.headers })
        return { status: options.status ?? 200 }
      },
      succeed: async (id, _latency, status) => {
        succeeded.push({ id, status })
      },
      fail: async (id, error, status) => {
        failed.push({ id, error, status })
      },
    }
    return { ports, sent, succeeded, failed }
  }

  it('entrega firmado, con la identidad del evento en las cabeceras', async () => {
    const { ports, sent } = makeDispatcher()
    const report = await dispatchWebhooks(ports, { worker: 'w1' })

    expect(report).toMatchObject({ claimed: 1, delivered: 1, failed: 0 })
    expect(sent[0]?.url).toBe(endpoint.url)
    expect(sent[0]?.headers[EVENT_ID_HEADER]).toBe('evt-1')
    expect(sent[0]?.headers['x-correlation-id']).toBe('ec-hilo-de-prueba')

    const verified = await verifyWebhookSignature({
      secret: 'secreto',
      header: sent[0]?.headers[SIGNATURE_HEADER] ?? null,
      rawBody: sent[0]?.body ?? '',
    })
    expect(verified).toBe(true)
  })

  it('un 2xx es entrega; cualquier otra cosa, no', async () => {
    for (const [status, entregado] of [
      [200, true],
      [204, true],
      [302, false],
      [401, false],
      [500, false],
    ] as const) {
      const { ports, succeeded, failed } = makeDispatcher({ status })
      await dispatchWebhooks(ports, { worker: 'w1' })
      expect(`${status}: ${succeeded.length}`).toBe(`${status}: ${entregado ? 1 : 0}`)
      expect(`${status}: ${failed.length}`).toBe(`${status}: ${entregado ? 0 : 1}`)
    }
  })

  it('el codigo del destino se apunta para poder diagnosticar', async () => {
    const { ports, failed } = makeDispatcher({ status: 401 })
    await dispatchWebhooks(ports, { worker: 'w1' })
    expect(failed[0]?.status).toBe(401)
    expect(failed[0]?.error).toMatch(/401/)
  })

  it('un secreto sin resolver falla con su propio codigo: reintentar no lo arregla', async () => {
    const { ports, failed, sent } = makeDispatcher({ secret: null })
    await dispatchWebhooks(ports, { worker: 'w1' })
    expect(sent).toEqual([])
    expect(failed[0]?.error).toMatch(/SECRETO_NO_CONFIGURADO/)
    expect(failed[0]?.error).toMatch(/EBIM_WEBHOOK_SECRET_ERP/)
  })

  /**
   * Cierre · D2. `secret_ref` lo escribe el administrador del tenant: resuelto
   * tal cual, podía nombrar `SUPABASE_SERVICE_ROLE_KEY` o el secreto de otra
   * sociedad y el trabajador firmaba con él hacia la URL que ese tenant eligió.
   */
  it('el secreto se busca SOLO en el espacio de la sociedad del mensaje', async () => {
    const pedidos: string[] = []
    const { ports, sent } = makeDispatcher({
      target: { ...endpoint, secret_ref: 'SUPABASE_SERVICE_ROLE_KEY' },
    })
    ports.resolveSecret = (name) => {
      pedidos.push(name)
      return name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'clave-de-plataforma' : null
    }
    await dispatchWebhooks(ports, { worker: 'w1' })

    // Nunca se pide la variable de la plataforma: se pide la del espacio de la
    // sociedad, que no existe, y no sale nada firmado.
    expect(pedidos).toEqual(['EBIM_WH_0A0000000000400080000000000000C1_SUPABASE_SERVICE_ROLE_KEY'])
    expect(sent).toEqual([])
  })

  it('dos sociedades con el mismo secret_ref resuelven variables distintas', () => {
    const a = webhookSecretEnvName('0a000000-0000-4000-8000-0000000000c1', 'EBIM_WEBHOOK_SECRET_ERP')
    const b = webhookSecretEnvName('0b000000-0000-4000-8000-0000000000c2', 'EBIM_WEBHOOK_SECRET_ERP')
    expect(a).toBe('EBIM_WH_0A0000000000400080000000000000C1_EBIM_WEBHOOK_SECRET_ERP')
    expect(b).not.toBe(a)
    // Sin forma válida no hay nombre que resolver.
    expect(webhookSecretEnvName('no-es-un-uuid', 'EBIM_WEBHOOK_SECRET_ERP')).toBeNull()
    expect(webhookSecretEnvName('0a000000-0000-4000-8000-0000000000c1', 'x; rm')).toBeNull()
  })

  it('un destino que ya no existe falla sin intentar la entrega', async () => {
    const { ports, failed, sent } = makeDispatcher({ target: null })
    await dispatchWebhooks(ports, { worker: 'w1' })
    expect(sent).toEqual([])
    expect(failed[0]?.error).toMatch(/ENDPOINT_NO_EXISTE/)
  })

  /**
   * El mensaje de una excepción de red puede llevar dentro la URL entera con su
   * cadena de consulta, y esto se pinta en el monitor. Lo que se guarda es
   * NUESTRO texto.
   */
  it('lo que se guarda de un fallo de red es texto nuestro, no el del error', async () => {
    const { ports, failed } = makeDispatcher({ throwOnSend: true })
    await dispatchWebhooks(ports, { worker: 'w1' })
    expect(failed[0]?.error).toBe('No se pudo entregar (AbortError)')
    expect(failed[0]?.status).toBeNull()
  })

  /**
   * La Definition of Done: conectar un destino nuevo es una FILA, no un cambio
   * en el despachador. Este caso usa un operador que no existe en ninguna parte
   * del repositorio y recorre el ciclo entero con él.
   */
  it('conectar un destino nuevo es una fila, no tocar el core', async () => {
    const nuevo = {
      id: '8f000000-0000-4000-8000-0000000000ff',
      name: 'mensajeria-inventada',
      url: 'https://api.mensajeria-inventada.test/ebim',
      api_version: 'v1',
      secret_ref: 'EBIM_WEBHOOK_SECRET_INVENTADA',
    }
    const sent: Sent[] = []
    const ports: DispatcherPorts = {
      now: () => 1_000,
      claim: async () => [message({ target: nuevo.id })],
      resolveTarget: async (targetId) => (targetId === nuevo.id ? nuevo : null),
      resolveSecret: () => 'secreto-de-la-inventada',
      send: async (input) => {
        sent.push({ url: input.url, body: input.body, headers: input.headers })
        return { status: 202 }
      },
      succeed: async () => {},
      fail: async () => {},
    }

    const report = await dispatchWebhooks(ports, { worker: 'w1' })
    expect(report.delivered).toBe(1)
    expect(sent[0]?.url).toBe(nuevo.url)
    expect(sent[0]?.headers['User-Agent']).toContain('v1')
  })

  it('el tamaño del lote y el tiempo maximo estan acotados', async () => {
    let pedido = 0
    let timeout = 0
    const ports: DispatcherPorts = {
      now: () => 1_000,
      claim: async (_code, _worker, limit) => {
        pedido = limit
        return [message()]
      },
      resolveTarget: async () => endpoint,
      resolveSecret: () => 'secreto',
      send: async (input) => {
        timeout = input.timeoutMs
        return { status: 200 }
      },
      succeed: async () => {},
      fail: async () => {},
    }
    await dispatchWebhooks(ports, { worker: 'w1', batchSize: 5000, timeoutMs: 10 })
    expect(pedido).toBe(50)
    expect(timeout).toBe(1_000)
  })

  it('reclama la cola del conector de webhooks y no la de otro', async () => {
    let code = ''
    const ports: DispatcherPorts = {
      now: () => 1_000,
      claim: async (providerCode) => {
        code = providerCode
        return []
      },
      resolveTarget: async () => endpoint,
      resolveSecret: () => 'secreto',
      send: async () => ({ status: 200 }),
      succeed: async () => {},
      fail: async () => {},
    }
    await dispatchWebhooks(ports, { worker: 'w1' })
    expect(code).toBe(WEBHOOK_PROVIDER_CODE)
  })
})

describe('la version del contrato', () => {
  it('es la que sirven las rutas y la que documenta el OpenAPI', () => {
    const document = buildOpenApiDocument()
    expect((document.info as Record<string, unknown>).version).toBe(API_VERSION)
  })
})
