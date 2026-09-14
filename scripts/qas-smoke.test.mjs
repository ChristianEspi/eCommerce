// @vitest-environment node
/**
 * El smoke READ-ONLY de QAS, probado contra alojamientos simulados (R05).
 *
 * Tres garantías: sin `QAS_BASE_URL` no corre y no falla; solo hace GET; y
 * distingue un despliegue sano de uno sin reescritura de SPA (el 404 de Amplify
 * al recargar una ruta profunda), de un recurso roto y de un 5xx.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { essentialAssets, runQasSmoke } from './qas-smoke.mjs'

const SHELL = `<!doctype html><html><head>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script type="module" crossorigin src="/assets/index-abc123.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-abc123.css">
</head><body><div id="root"></div></body></html>`

let server = null
const methods = []

async function hosting(handler) {
  methods.length = 0
  server = createServer((req, res) => {
    methods.push(req.method)
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

/** Un alojamiento de SPA bien configurado: todo lo que no es un recurso devuelve index.html. */
function sano(req, res) {
  if (req.url === '/assets/index-abc123.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' }).end('console.log(1)')
  } else if (req.url === '/assets/index-abc123.css') {
    res.writeHead(200, { 'content-type': 'text/css' }).end('body{}')
  } else if (req.url === '/favicon.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg/>')
  } else {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store, max-age=0, must-revalidate' }).end(SHELL)
  }
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  server = null
})

describe('qas-smoke', () => {
  it('sin QAS_BASE_URL no corre: NOT_RUN, no FAIL', async () => {
    const result = await runQasSmoke({ baseUrl: '' })
    expect(result.status).toBe('NOT_RUN')
  })

  it('despliegue sano: PASS, y solo peticiones GET', async () => {
    const base = await hosting(sano)
    const result = await runQasSmoke({ baseUrl: base, slug: 'miquimica', deepLink: '/s/miquimica/product/alcohol' })
    expect(result.checks.filter((c) => !c.ok)).toEqual([])
    expect(result.status).toBe('PASS')
    expect(methods.length).toBeGreaterThanOrEqual(8)
    expect(new Set(methods)).toEqual(new Set(['GET']))
  })

  it('sin reescritura de SPA (404 en rutas profundas): FAIL con el motivo', async () => {
    const base = await hosting((req, res) => {
      if (req.url === '/' || req.url === '/index.html' || req.url.startsWith('/assets/') || req.url === '/favicon.svg') {
        return sano(req, res)
      }
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404 Not Found</h1>')
    })
    const result = await runQasSmoke({ baseUrl: base, slug: 'miquimica' })
    expect(result.status).toBe('FAIL')
    const tienda = result.checks.find((c) => c.name === 'GET /s/miquimica → shell del SPA')
    expect(tienda).toMatchObject({ ok: false })
    expect(tienda.detail).toMatch(/no reescribe las rutas del SPA/)
  })

  it('un recurso del build que el alojamiento sirve como index.html cuenta como roto', async () => {
    const base = await hosting((req, res) => {
      if (req.url === '/assets/index-abc123.js') {
        return res.writeHead(200, { 'content-type': 'text/html' }).end(SHELL)
      }
      return sano(req, res)
    })
    const result = await runQasSmoke({ baseUrl: base })
    expect(result.status).toBe('FAIL')
    expect(result.checks.find((c) => c.name === 'GET /assets/index-abc123.js')?.ok).toBe(false)
  })

  it('un 5xx es FAIL', async () => {
    const base = await hosting((req, res) => {
      if (req.url === '/login') return res.writeHead(502).end('bad gateway')
      return sano(req, res)
    })
    const result = await runQasSmoke({ baseUrl: base })
    expect(result.status).toBe('FAIL')
    expect(result.checks.find((c) => c.name === 'Ninguna respuesta 5xx')?.ok).toBe(false)
  })

  it('index.html cacheado es un AVISO, no un fallo', async () => {
    const base = await hosting((req, res) => {
      if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'public, max-age=3600' }).end(SHELL)
      return sano(req, res)
    })
    const result = await runQasSmoke({ baseUrl: base })
    expect(result.status).toBe('PASS')
    expect(result.checks.find((c) => c.name.startsWith('index.html sin caché'))).toMatchObject({ ok: false, level: 'warning' })
  })

  it('rechaza http fuera de localhost', async () => {
    await expect(runQasSmoke({ baseUrl: 'http://qas.example.com' })).rejects.toThrow(/https/)
  })

  it('el script no contiene ningún método de escritura ni cliente de Supabase', () => {
    const fuente = readFileSync(new URL('./qas-smoke.mjs', import.meta.url), 'utf8')
    expect(fuente).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/)
    expect(fuente).not.toMatch(/supabase-js|createClient|\/rest\/v1|\/auth\/v1|functions\/v1/)
  })

  it('encuentra los recursos esenciales del shell real del build', () => {
    expect(essentialAssets(SHELL).sort()).toEqual(['/assets/index-abc123.css', '/assets/index-abc123.js', '/favicon.svg'])
  })
})
