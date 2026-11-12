// @vitest-environment node
/**
 * Conector de lectura, lado red (`_shared/connectors/pull.ts`), sin red.
 *
 *  - pide las páginas del contrato con limit, updated_since y cursor;
 *  - cada tipo de autenticación manda lo que tiene que mandar, y la
 *    credencial no aparece en ningún mensaje;
 *  - la ruta no puede cambiar el servidor; nada privado, nada sin https;
 *  - 3xx, 401, formato roto, cursor que se repite y topes acaban en `failed`
 *    con su código — nunca en una excepción que deje la ejecución abierta;
 *  - la marca de agua es la mayor que devolvió la base, y solo si no falló.
 */
import { describe, expect, it } from 'vitest'
import {
  PullError,
  assertPublicHttps,
  buildPageUrl,
  runFeed,
  type ClaimedFeed,
  type HttpRequest,
  type HttpResponse,
  type PullPorts,
} from '../functions/_shared/connectors/pull.ts'

const SECRET = 'clave-que-no-debe-salir'

function claim(over: Partial<ClaimedFeed['source']> = {}, feed: Partial<ClaimedFeed['feed']> = {}): ClaimedFeed {
  return {
    run_id: 'run-1',
    feed: { id: 'feed-1', resource: 'stock', path: '/ebim/v1/stock', page_size: 2, watermark: null, ...feed },
    source: {
      id: 'src-1',
      base_url: 'https://erp.cliente.test/api',
      auth_type: 'api_key',
      auth_header: 'X-API-Key',
      auth_username: null,
      oauth_token_url: null,
      oauth_scope: null,
      timeout_seconds: 10,
      has_secret: true,
      ...over,
    },
  }
}

function ok(body: unknown): HttpResponse {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

function harness(responses: Array<HttpResponse | ((r: HttpRequest) => HttpResponse)>) {
  const requests: HttpRequest[] = []
  const applied: Array<{ rows: unknown[]; offset: number }> = []
  const finished: unknown[][] = []
  let i = 0
  const ports: PullPorts = {
    async http(request) {
      requests.push(request)
      const next = responses[i++]
      if (!next) throw new Error('sin respuesta preparada')
      return typeof next === 'function' ? next(request) : next
    },
    secret: async () => SECRET,
    async apply(_resource, _runId, rows, offset) {
      applied.push({ rows, offset })
      const dates = rows
        .map((r) => (r as { updated_at?: string }).updated_at)
        .filter((d): d is string => typeof d === 'string')
        .sort()
      return {
        received: rows.length,
        applied: rows.length,
        unchanged: 0,
        rejected: 0,
        max_updated_at: dates.at(-1) ?? null,
      }
    },
    async finish(...args) {
      finished.push(args)
    },
  }
  return { ports, requests, applied, finished }
}

describe('la URL', () => {
  it('pega la ruta a la base con limit, updated_since y cursor', () => {
    const url = buildPageUrl('https://erp.cliente.test/api/', '/ebim/v1/stock', {
      limit: 200,
      updatedSince: '2026-11-12T10:00:00Z',
      cursor: 'abc 1',
    })
    expect(url).toBe(
      'https://erp.cliente.test/api/ebim/v1/stock?limit=200&updated_since=2026-11-12T10%3A00%3A00Z&cursor=abc+1',
    )
  })

  it('una ruta no puede mandar la petición a otro servidor', () => {
    for (const path of ['//otro.test/x', '/https://otro.test/x', '/../../x']) {
      expect(new URL(buildPageUrl('https://erp.cliente.test/api', path, { limit: 1, updatedSince: null, cursor: null })).host)
        .toBe('erp.cliente.test')
    }
  })

  it('nada sin https ni privado', () => {
    for (const url of ['http://erp.test', 'https://10.0.0.1/x', 'https://169.254.169.254', 'https://erp.internal']) {
      expect(() => assertPublicHttps(url)).toThrow(PullError)
    }
    expect(() => assertPublicHttps('https://erp.cliente.test/api')).not.toThrow()
  })
})

describe('una ejecución', () => {
  it('pagina hasta que no hay cursor, con desplazamiento y marca de agua', async () => {
    const h = harness([
      ok({ data: [{ sku: 'A', updated_at: '2026-11-12T09:00:00Z' }, { sku: 'B' }], next_cursor: 'p2' }),
      ok({ data: [{ sku: 'C', updated_at: '2026-11-12T11:00:00Z' }], next_cursor: null }),
    ])
    const report = await runFeed(claim({}, { watermark: '2026-11-01T00:00:00Z' }), h.ports)

    expect(report).toMatchObject({ status: 'succeeded', pages: 2, received: 3, applied: 3 })
    expect(h.requests.map((r) => new URL(r.url).searchParams.get('cursor'))).toEqual([null, 'p2'])
    expect(new URL(h.requests[0]!.url).searchParams.get('updated_since')).toBe('2026-11-01T00:00:00Z')
    expect(h.applied.map((a) => a.offset)).toEqual([0, 2])
    expect(h.finished).toEqual([['run-1', 'succeeded', '2026-11-12T11:00:00Z', null, null]])
  })

  it('una página vacía termina aunque traiga cursor', async () => {
    const h = harness([ok({ data: [], next_cursor: 'x' })])
    const report = await runFeed(claim(), h.ports)
    expect(report).toMatchObject({ status: 'succeeded', pages: 1, received: 0 })
    expect(h.applied).toHaveLength(0)
  })

  it('con rechazados queda parcial', async () => {
    const h = harness([ok({ data: [{ sku: 'A' }] })])
    h.ports.apply = async () => ({ received: 1, applied: 0, unchanged: 0, rejected: 1, max_updated_at: null })
    expect((await runFeed(claim(), h.ports)).status).toBe('partial')
  })
})

describe('autenticación', () => {
  it('api_key, bearer y basic', async () => {
    const api = harness([ok({ data: [] })])
    await runFeed(claim(), api.ports)
    expect(api.requests[0]?.headers['X-API-Key']).toBe(SECRET)

    const bearer = harness([ok({ data: [] })])
    await runFeed(claim({ auth_type: 'bearer', auth_header: null }), bearer.ports)
    expect(bearer.requests[0]?.headers.Authorization).toBe(`Bearer ${SECRET}`)

    const basic = harness([ok({ data: [] })])
    await runFeed(claim({ auth_type: 'basic', auth_header: null, auth_username: 'ebim' }), basic.ports)
    expect(basic.requests[0]?.headers.Authorization).toBe(`Basic ${btoa(`ebim:${SECRET}`)}`)
  })

  it('oauth2: pide el token por client_credentials y lo usa', async () => {
    const h = harness([
      (r) => {
        expect(r.method).toBe('POST')
        expect(r.url).toBe('https://auth.cliente.test/token')
        const form = new URLSearchParams(r.body)
        expect(Object.fromEntries(form)).toEqual({
          grant_type: 'client_credentials',
          client_id: 'ebim',
          client_secret: SECRET,
          scope: 'stock.read',
        })
        return ok({ access_token: 'tok-123', token_type: 'Bearer' })
      },
      ok({ data: [] }),
    ])
    const report = await runFeed(
      claim({
        auth_type: 'oauth2',
        auth_header: null,
        auth_username: 'ebim',
        oauth_token_url: 'https://auth.cliente.test/token',
        oauth_scope: 'stock.read',
      }),
      h.ports,
    )
    expect(report.status).toBe('succeeded')
    expect(h.requests[1]?.headers.Authorization).toBe('Bearer tok-123')
  })

  it('sin credencial guardada no llama a nadie', async () => {
    const h = harness([])
    h.ports.secret = async () => null
    const report = await runFeed(claim(), h.ports)
    expect(report).toMatchObject({ status: 'failed', errorCode: 'CREDENCIAL_FALTANTE' })
    expect(h.requests).toHaveLength(0)
  })
})

describe('fallos', () => {
  const casos: Array<[string, HttpResponse[], string]> = [
    ['401', [{ status: 401, contentType: null, body: '' }], 'FUENTE_NO_AUTORIZADA'],
    ['404', [{ status: 404, contentType: null, body: '' }], 'FUENTE_RUTA_NO_ENCONTRADA'],
    ['302', [{ status: 302, contentType: null, body: '' }], 'FUENTE_REDIRECCION'],
    ['500', [{ status: 500, contentType: null, body: '' }], 'FUENTE_HTTP_500'],
    ['no JSON', [{ status: 200, contentType: 'text/html', body: '<html>' }], 'FUENTE_FORMATO'],
    ['sin data', [ok({ items: [] })], 'FUENTE_FORMATO'],
    ['cursor repetido', [ok({ data: [{ sku: 'A' }], next_cursor: 'x' }), ok({ data: [{ sku: 'B' }], next_cursor: 'x' })], 'FUENTE_CURSOR_REPETIDO'],
  ]

  for (const [nombre, responses, code] of casos) {
    it(`${nombre} → failed ${code}, sin marca de agua y sin la credencial en el mensaje`, async () => {
      const h = harness(responses)
      const report = await runFeed(claim(), h.ports)
      expect(report).toMatchObject({ status: 'failed', errorCode: code })
      expect(h.finished).toHaveLength(1)
      expect(h.finished[0]?.[2]).toBeNull()
      expect(JSON.stringify(h.finished)).not.toContain(SECRET)
    })
  }

  it('un error del puerto de red se cierra igual, sin excepción', async () => {
    const h = harness([])
    h.ports.http = async () => {
      throw new PullError('FUENTE_TIEMPO_AGOTADO', 'La fuente no respondio en 10 s')
    }
    expect(await runFeed(claim(), h.ports)).toMatchObject({ status: 'failed', errorCode: 'FUENTE_TIEMPO_AGOTADO' })
  })

  it('topes: páginas → parcial y sigue después; filas → falla', async () => {
    const pages = harness([
      ok({ data: [{ sku: 'A' }], next_cursor: '2' }),
      ok({ data: [{ sku: 'B' }], next_cursor: '3' }),
    ])
    expect(await runFeed(claim(), pages.ports, { maxPages: 2, maxRows: 100, maxBytes: 1000 })).toMatchObject({
      status: 'partial',
      errorCode: 'LIMITE_PAGINAS',
      pages: 2,
    })

    const rows = harness([ok({ data: [{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }] })])
    expect(await runFeed(claim(), rows.ports, { maxPages: 5, maxRows: 2, maxBytes: 1000 })).toMatchObject({
      status: 'failed',
      errorCode: 'LIMITE_FILAS',
    })
  })
})
