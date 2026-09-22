// @vitest-environment node
/**
 * P13-SaaS · La observabilidad del BORDE.
 *
 * Es TypeScript puro —igual que el orquestador de checkout de P07 y el contrato
 * de pasarelas de P09— asi que se prueba entero sin levantar nada: el hilo, la
 * redaccion, el log estructurado y los sinks.
 *
 * Lo que se defiende aqui:
 *
 *  · **el hilo se respeta si viene y se abre si no** — y viaja en la RESPUESTA,
 *    incluida la de error, que es lo que permite que alguien lo cite al abrir
 *    una incidencia;
 *  · **nada sale sin redactar** — el destino de estos registros es la salida
 *    estandar del proveedor de hosting, fuera de esta base y de sus policies;
 *  · **las dos copias de la lista de claves prohibidas no se separan** —
 *    TypeScript no puede consultar Postgres para decidir si algo se puede
 *    escribir en un log, asi que la lista esta duplicada y este test es lo que
 *    la mantiene sincronizada (misma tecnica que `CHECKOUT_STAGES` en P07);
 *  · **un sink roto no tumba la peticion** que estaba registrando.
 */
import { describe, expect, it } from 'vitest'
import { serveJson } from '../functions/_shared/http.ts'
import {
  CORRELATION_HEADER,
  REQUEST_HEADER,
  PII_KEYS,
  SENSITIVE_KEYS,
  consoleSink,
  createLogger,
  incidentSink,
  looksLikeEmail,
  looksLikePan,
  memorySink,
  newTraceId,
  redact,
  redactText,
  resolveTrace,
  traceHeaders,
  type IncidentReport,
  type LogRecord,
  type LogSink,
} from '../functions/_shared/observability/index.ts'
import { readMigration } from './harness.ts'

function request(headers: Record<string, string> = {}, body: unknown = {}): Request {
  return new Request('https://ejemplo.test/fn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const trace = { correlationId: 'ec-prueba-0001', requestId: 'req-prueba-0001' }

// ---------------------------------------------------------------------------

describe('el hilo', () => {
  it('se respeta el que viene, porque es el mismo incidente', () => {
    const resolved = resolveTrace(request({ [CORRELATION_HEADER]: 'ec-de-la-vitrina-0001' }))
    expect(resolved.correlationId).toBe('ec-de-la-vitrina-0001')
  })

  it('se abre uno cuando no viene', () => {
    const resolved = resolveTrace(request())
    expect(resolved.correlationId).toMatch(/^ec-/)
    expect(resolved.correlationId.length).toBeGreaterThanOrEqual(8)
  })

  it('una cabecera con basura dentro se descarta', () => {
    // Lo que llega es texto de fuera. Un identificador con espacios, comas o
    // saltos de línea es como se falsifica una entrada de bitácora, así que la
    // forma se valida ANTES de usarlo.
    //
    // El sujeto es `resolveTrace` y no `Request`: el propio `fetch` ya rechaza
    // un salto de línea en una cabecera, pero esta función también la lee de
    // sitios que no son `fetch` —un proxy, un cliente hecho a mano—, y ahí la
    // validación es lo único que hay.
    const sucia = resolveTrace({ headers: { get: () => 'hilo con espacios, y coma' } })
    expect(sucia.correlationId).not.toContain(' ')
    expect(sucia.correlationId).toMatch(/^ec-/)

    // Y lo demasiado corto tampoco pasa: «corto» no identifica nada.
    expect(resolveTrace({ headers: { get: () => 'corto' } }).correlationId).toMatch(/^ec-/)
  })

  it('el request id NO hereda del correlation id', () => {
    const resolved = resolveTrace(request({ [CORRELATION_HEADER]: 'ec-mismo-hilo-0001' }))
    // Si heredara, dos reintentos del mismo hilo compartirian request id y
    // volveriamos a no poder separarlos.
    expect(resolved.requestId).not.toBe(resolved.correlationId)
  })

  it('dos identificadores nuevos nunca coinciden', () => {
    expect(newTraceId()).not.toBe(newTraceId())
  })

  it('la forma del identificador es la MISMA que valida la base', () => {
    // `ebim.correlation_id()` descarta lo que no encaje: si el borde generara
    // algo que la base rechaza, el hilo existiria en el log y no en las filas.
    const formatoSql = /\^\[A-Za-z0-9_\.:-\]\{8,120\}\$/
    const sql = readMigration('20260828160000_observability_correlation.sql')
    expect(formatoSql.test(sql.replace(/\\/g, '\\'))).toBe(true)
    expect(/^[A-Za-z0-9_.:-]{8,120}$/.test(newTraceId())).toBe(true)
  })
})

describe('la redaccion del borde', () => {
  it('las claves sensibles son las MISMAS que en la base (P09)', () => {
    const sql = readMigration('20260828120000_payments_core.sql')
    const cuerpo = sql.slice(
      sql.indexOf('function ebim.sensitive_json_keys'),
      sql.indexOf('function ebim.looks_like_pan'),
    )
    const enSql = [...cuerpo.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
    expect([...SENSITIVE_KEYS].sort()).toEqual([...new Set(enSql)].sort())
  })

  it('las claves de PII son las MISMAS que en la base (P13)', () => {
    const sql = readMigration('20260828160000_observability_correlation.sql')
    const cuerpo = sql.slice(
      sql.indexOf('function ebim.pii_json_keys'),
      sql.indexOf('function ebim.looks_like_email'),
    )
    const enSql = [...cuerpo.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
    expect([...PII_KEYS].sort()).toEqual([...new Set(enSql)].sort())
  })

  it('tapa una clave prohibida a cualquier profundidad', () => {
    const limpio = redact({
      order: { id: 'EC-1', customer: { email: 'a@b.com', access_token: 'secreto' } },
      items: [{ name: 'Jabón', notes: 'escribe a c@d.com' }],
    })
    const texto = JSON.stringify(limpio)
    expect(texto).not.toContain('a@b.com')
    expect(texto).not.toContain('secreto')
    expect(texto).not.toContain('c@d.com')
    // Y conserva lo que SI hace falta para diagnosticar.
    expect(texto).toContain('EC-1')
    expect(texto).toContain('Jabón')
  })

  it('reconoce un numero de tarjeta y no una marca de tiempo', () => {
    expect(looksLikePan('4242 4242 4242 4242')).toBe(true)
    // 13 digitos con pinta de PAN pero que no pasan Luhn: es un timestamp.
    expect(looksLikePan('1735689600000')).toBe(false)
    expect(looksLikePan('EC-00042')).toBe(false)
  })

  it('reconoce un correo y no un identificador con arroba', () => {
    expect(looksLikeEmail('juan@example.com')).toBe(true)
    expect(looksLikeEmail('sku@2x')).toBe(false)
  })

  it('el texto suelto se acota y se redacta', () => {
    expect(redactText('  hola  ')).toBe('hola')
    expect(redactText('avisar a x@y.com')).toBe('[redactado]')
    expect(redactText('a'.repeat(900), 100)).toHaveLength(100)
    expect(redactText('   ')).toBeNull()
  })

  it('fase 12: el texto suelto tampoco lleva dentro credenciales con forma reconocible', () => {
    const jwt = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ4In0', 'ZmlybWE'].join('.')
    const t = redactText(`401 del ERP: Authorization: Bearer ${jwt} en postgres://u:clave@db/x`)!
    expect(t).not.toContain(jwt)
    expect(t).not.toContain('clave@db')
    expect(t).toContain('401 del ERP')
  })

  it('fase 12: cabeceras y credenciales como CLAVE no llegan al log, con cualquier grafía', () => {
    const limpio = redact({ Authorization: 'Bearer x', 'X-Api-Key': 'k', cookie: 'c', jwt: 'j', status: 401 })
    expect(limpio).toEqual({
      Authorization: '[redactado]',
      'X-Api-Key': '[redactado]',
      cookie: '[redactado]',
      jwt: '[redactado]',
      status: 401,
    })
    // Contadores con «token» en el nombre NO se tapan: no son credenciales.
    expect(redact({ input_tokens: 10 })).toEqual({ input_tokens: 10 })
  })
})

describe('el log estructurado', () => {
  it('todo registro lleva el hilo, el servicio y el momento', () => {
    const sink = memorySink()
    const logger = createLogger({ service: 'checkout', trace, sinks: [sink] })
    logger.info('request.started')
    const record = sink.records[0] as LogRecord
    expect(record.correlation_id).toBe(trace.correlationId)
    expect(record.request_id).toBe(trace.requestId)
    expect(record.service).toBe('checkout')
    expect(record.level).toBe('info')
    expect(Date.parse(record.at)).not.toBeNaN()
  })

  it('no hay forma de emitir un contexto sin redactar', () => {
    const sink = memorySink()
    const logger = createLogger({ service: 'checkout', trace, sinks: [sink] })
    logger.error('checkout.failed', { customer_email: 'a@b.com', order: 'EC-9' })
    const texto = JSON.stringify(sink.records[0])
    expect(texto).not.toContain('a@b.com')
    expect(texto).toContain('EC-9')
  })

  it('`measure` emite la duracion y devuelve lo que la operacion devolvio', async () => {
    const sink = memorySink()
    const logger = createLogger({ service: 'checkout', trace, sinks: [sink] })
    const valor = await logger.measure('checkout', async () => 42)
    expect(valor).toBe(42)
    const record = sink.records.find((r) => r.event === 'operation.completed')
    expect(record?.operation).toBe('checkout')
    expect(typeof record?.duration_ms).toBe('number')
  })

  it('un fallo se registra CON su codigo y se vuelve a lanzar', async () => {
    const sink = memorySink()
    const logger = createLogger({ service: 'checkout', trace, sinks: [sink] })
    const error = Object.assign(new Error('la reserva no existe'), { code: 'STOCK_INSUFICIENTE' })

    await expect(logger.measure('checkout', () => Promise.reject(error))).rejects.toThrow()
    const record = sink.records.find((r) => r.event === 'operation.failed')
    expect(record?.code).toBe('STOCK_INSUFICIENTE')
    expect(record?.message).toBe('la reserva no existe')
  })

  it('lo lento se emite como HECHO APARTE, para que los sinks no repitan el umbral', async () => {
    const sink = memorySink()
    const logger = createLogger({ service: 'checkout', trace, sinks: [sink], slowMs: 0 })
    await logger.measure('checkout', async () => 'ok')
    expect(sink.records.map((r) => r.event)).toEqual(['operation.completed', 'operation.slow'])
  })

  it('un sink roto no tumba la peticion que estaba registrando', () => {
    const roto: LogSink = {
      name: 'roto',
      write() {
        throw new Error('el recolector no contesta')
      },
    }
    const sano = memorySink()
    const logger = createLogger({ service: 'checkout', trace, sinks: [roto, sano] })
    expect(() => logger.info('request.started')).not.toThrow()
    expect(sano.records).toHaveLength(1)
  })

  it('la consola emite UNA linea de JSON, que es lo que cualquier recolector lee', () => {
    const escrito: string[] = []
    const original = console.log
    console.log = (line: string) => void escrito.push(line)
    try {
      consoleSink().write({
        at: new Date().toISOString(),
        level: 'info',
        event: 'request.started',
        service: 'checkout',
        correlation_id: trace.correlationId,
        request_id: trace.requestId,
      })
    } finally {
      console.log = original
    }
    expect(escrito).toHaveLength(1)
    expect(() => JSON.parse(escrito[0] as string)).not.toThrow()
  })
})

describe('el puente con `ops_events`', () => {
  it('solo lo que merece atencion llega a la base', async () => {
    const partes: IncidentReport[] = []
    const logger = createLogger({
      service: 'checkout',
      trace,
      slowMs: 0,
      sinks: [incidentSink((r) => void partes.push(r), { source: 'edge:checkout', kind: 'checkout_failed' })],
    })

    logger.info('request.started')
    await logger.measure('checkout', async () => 'ok')
    await expect(
      logger.measure('checkout', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow()

    // `request.started` y `operation.completed` NO son incidentes: si lo
    // fueran, `ops_events` seria una copia del log y la pantalla de salud
    // dejaria de servir para ver lo que esta roto.
    expect(partes.map((p) => p.kind)).toEqual(['slow_operation', 'checkout_failed'])
    expect(partes[1]?.severity).toBe('error')
  })

  it('la clave de deduplicacion incluye el HILO: dos compradores son dos incidentes', async () => {
    const partes: IncidentReport[] = []
    const sink = incidentSink((r) => void partes.push(r), { source: 'edge:checkout' })
    for (const hilo of ['ec-uno-0001', 'ec-dos-0002']) {
      const logger = createLogger({
        service: 'checkout',
        trace: { correlationId: hilo, requestId: 'req-0001' },
        sinks: [sink],
      })
      await expect(
        logger.measure('checkout', () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow()
    }
    expect(partes[0]?.dedupeKey).not.toBe(partes[1]?.dedupeKey)
  })
})

describe('serveJson devuelve el hilo, siempre', () => {
  it('en la respuesta correcta', async () => {
    const sink = memorySink()
    const handler = serveJson(
      { allowedOrigins: [], service: 'prueba', sinks: [sink] },
      async () => ({ status: 200, body: { data: { ok: true } } }),
    )
    const response = await handler(request({ [CORRELATION_HEADER]: 'ec-desde-fuera-0001' }))
    expect(response.headers.get(CORRELATION_HEADER)).toBe('ec-desde-fuera-0001')
    expect(response.headers.get(REQUEST_HEADER)).toBeTruthy()
  })

  it('en la respuesta de ERROR, que es cuando de verdad hace falta', async () => {
    const sink = memorySink()
    const handler = serveJson({ allowedOrigins: [], service: 'prueba', sinks: [sink] }, async () => {
      throw Object.assign(new Error('nada'), { code: 'PGRST116' })
    })
    const response = await handler(request({ [CORRELATION_HEADER]: 'ec-fallo-0001' }))
    expect(response.status).toBe(404)
    expect(response.headers.get(CORRELATION_HEADER)).toBe('ec-fallo-0001')

    // Y el fallo queda registrado con su traduccion, no con el error crudo.
    const fallo = sink.records.find((r) => r.event === 'request.failed')
    expect(fallo?.context).toMatchObject({ code: 'NO_ENCONTRADO', status: 404 })
  })

  it('y en el preflight', async () => {
    const handler = serveJson({ allowedOrigins: [], service: 'prueba' }, async () => ({
      status: 200,
      body: {},
    }))
    const response = await handler(
      new Request('https://ejemplo.test/fn', { method: 'OPTIONS' }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get(CORRELATION_HEADER)).toBeTruthy()
  })

  it('el handler recibe el hilo para pasarselo a los clientes de Supabase', async () => {
    let visto = ''
    const handler = serveJson({ allowedOrigins: [], service: 'prueba', sinks: [] }, async (ctx) => {
      visto = ctx.trace.correlationId
      // Y las cabeceras que se le pasarian al cliente son las mismas dos.
      expect(Object.keys(traceHeaders(ctx.trace))).toEqual([CORRELATION_HEADER, REQUEST_HEADER])
      return { status: 200, body: {} }
    })
    await handler(request({ [CORRELATION_HEADER]: 'ec-al-handler-0001' }))
    expect(visto).toBe('ec-al-handler-0001')
  })
})
