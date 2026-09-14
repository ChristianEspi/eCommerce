#!/usr/bin/env node
/**
 * Smoke READ-ONLY de un despliegue de la vitrina (Release Candidate, R05).
 *
 * ## Qué hace, y sobre todo qué NO hace
 *
 * Solo peticiones **GET** al alojamiento. Ni login, ni alta, ni carrito, ni
 * checkout, ni una llamada a Supabase: nada que cree o cambie una fila. Sirve
 * para validar QAS (o cualquier despliegue) sin dejar rastro.
 *
 * Comprueba:
 *
 *  1. `/` responde 200 con el shell del SPA (`<div id="root">` y el script de
 *     entrada del build).
 *  2. `/s/:slug` responde 200 con ESE MISMO shell.
 *  3. Rutas profundas (`/s/:slug/cart`, `/login` y la que se configure) también:
 *     si el alojamiento no tiene la reescritura de SPA, Amplify responde 404 (o
 *     un XML de acceso denegado) y recargar con F5 rompe la tienda. Es el fallo
 *     que ya se vio en QAS, y aquí sale con nombre propio.
 *  4. Los recursos esenciales del shell (scripts y hojas de estilo del build,
 *     favicon) responden 200 con un tipo coherente.
 *  5. Ninguna respuesta 5xx.
 *  6. (aviso, no fallo) `index.html` sin caché, como pide `customHttp.yml`.
 *
 * ## Variables
 *
 *  · `QAS_BASE_URL`   — p. ej. `https://qas.example.com`. Sin ella: `NOT_RUN`.
 *  · `QAS_STORE_SLUG` — slug de la tienda (por defecto `miquimica`).
 *  · `QAS_DEEP_LINK`  — ruta pública adicional, p. ej. `/s/miquimica/product/alcohol-en-gel-70`.
 *
 * Sin `QAS_BASE_URL` el resultado es `QAS_READ_ONLY_SMOKE = NOT_RUN` con código
 * 0: que no haya entorno configurado no es un fallo del código.
 *
 * Salida: `QAS_READ_ONLY_SMOKE = PASS | FAIL | NOT_RUN`. Código 1 solo con FAIL.
 */
import { fileURLToPath } from 'node:url'
import { resolve as resolvePath } from 'node:path'

const TIMEOUT_MS = 15_000

/** Lo que identifica al shell del SPA de este repositorio en cualquier ruta. */
function isSpaShell(html) {
  return /<div id="root">\s*<\/div>/.test(html) && /<script[^>]+type="module"[^>]+src="[^"]+"/.test(html)
}

/** Scripts y hojas de estilo del build referenciados por el shell (mismo origen). */
export function essentialAssets(html) {
  const assets = new Set()
  for (const match of html.matchAll(/<script[^>]+src="(\/[^"]+)"/g)) assets.add(match[1])
  for (const match of html.matchAll(/<link[^>]+rel="(?:stylesheet|modulepreload)"[^>]+href="(\/[^"]+)"/g)) assets.add(match[1])
  for (const match of html.matchAll(/<link[^>]+href="(\/[^"]+)"[^>]+rel="(?:stylesheet|modulepreload)"/g)) assets.add(match[1])
  for (const match of html.matchAll(/<link[^>]+rel="icon"[^>]+href="(\/[^"]+)"/g)) assets.add(match[1])
  return [...assets]
}

function assertSafeBase(baseUrl) {
  const url = new URL(baseUrl)
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !local) {
    throw new Error(`QAS_BASE_URL tiene que ser https (o localhost): ${url.protocol}`)
  }
  return url
}

/**
 * Ejecuta el smoke. `fetchImpl` se inyecta para poder probarlo sin red.
 * Devuelve `{ status: 'PASS'|'FAIL'|'NOT_RUN', checks: [...] }`.
 */
export async function runQasSmoke({
  baseUrl = process.env.QAS_BASE_URL,
  slug = process.env.QAS_STORE_SLUG || 'miquimica',
  deepLink = process.env.QAS_DEEP_LINK,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!baseUrl) {
    return { status: 'NOT_RUN', checks: [], reason: 'QAS_BASE_URL no definida: no hay despliegue que comprobar' }
  }
  const base = assertSafeBase(baseUrl)
  const checks = []
  const add = (name, ok, detail, level = 'error') => checks.push({ name, ok, detail, level })

  /** SOLO GET. Es la única forma de llamar a la red en este archivo. */
  async function get(path) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetchImpl(new URL(path, base).toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/javascript,text/css,*/*' },
      })
      const body = await response.text()
      return { status: response.status, headers: response.headers, body }
    } catch (error) {
      return { status: 0, headers: new Headers(), body: '', error: String(error?.message ?? error) }
    } finally {
      clearTimeout(timer)
    }
  }

  const root = await get('/')
  const rootOk = root.status === 200 && isSpaShell(root.body)
  add('GET / → shell del SPA', rootOk, root.error ?? `HTTP ${root.status}${rootOk ? '' : ' sin shell del SPA'}`)

  const rutas = [`/s/${slug}`, `/s/${slug}/cart`, '/login', ...(deepLink ? [deepLink] : [])]
  for (const ruta of rutas) {
    const res = await get(ruta)
    const shell = res.status === 200 && isSpaShell(res.body)
    const motivo = res.error
      ? res.error
      : res.status === 404 || res.status === 403
        ? `HTTP ${res.status}: el alojamiento no reescribe las rutas del SPA a /index.html`
        : res.status !== 200
          ? `HTTP ${res.status}`
          : shell
            ? 'HTTP 200 con el shell del SPA'
            : 'HTTP 200 pero no es el shell del SPA'
    add(`GET ${ruta} → shell del SPA`, shell, motivo)
  }

  const assets = rootOk ? essentialAssets(root.body) : []
  add('El shell referencia recursos del build', !rootOk || assets.some((a) => a.startsWith('/assets/')), `${assets.length} recursos`)
  for (const asset of assets) {
    const res = await get(asset)
    const type = res.headers.get('content-type') ?? ''
    const expected = asset.endsWith('.js')
      ? /javascript/.test(type)
      : asset.endsWith('.css')
        ? /css/.test(type)
        : true
    // Un SPA mal reescrito sirve index.html para un .js que no existe: 200 con text/html.
    const ok = res.status === 200 && expected && !isSpaShell(res.body)
    add(`GET ${asset}`, ok, res.error ?? `HTTP ${res.status} ${type}`)
  }

  const cache = root.headers.get('cache-control') ?? ''
  add(
    'index.html sin caché (customHttp.yml)',
    /no-store|no-cache|max-age=0/.test(cache),
    cache ? `Cache-Control: ${cache}` : 'sin Cache-Control',
    'warning',
  )

  const serverErrors = checks.filter((c) => /HTTP 5\d\d/.test(c.detail))
  add('Ninguna respuesta 5xx', serverErrors.length === 0, serverErrors.length === 0 ? 'ninguna' : `${serverErrors.length} con 5xx`)

  const failed = checks.some((c) => !c.ok && c.level === 'error')
  return { status: failed ? 'FAIL' : 'PASS', checks }
}

function print(result) {
  console.log('\nSmoke READ-ONLY del despliegue\n')
  if (result.status === 'NOT_RUN') {
    console.log(`  ${result.reason}`)
  }
  for (const check of result.checks) {
    const estado = check.ok ? 'OK' : check.level === 'warning' ? 'AVISO' : 'FALLA'
    console.log(`  ${estado.padEnd(6)} ${check.name.padEnd(48)} ${check.detail}`)
  }
  const fallos = result.checks.filter((c) => !c.ok && c.level === 'error')
  if (fallos.length > 0) {
    console.log('\n  Motivos:')
    for (const fallo of fallos) console.log(`    - ${fallo.name}: ${fallo.detail}`)
  }
  console.log(`\nQAS_READ_ONLY_SMOKE = ${result.status}\n`)
}

if (process.argv[1] && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url))) {
  try {
    const result = await runQasSmoke()
    print(result)
    process.exit(result.status === 'FAIL' ? 1 : 0)
  } catch (error) {
    console.error(`[qas-smoke] ${error.message}`)
    console.log('\nQAS_READ_ONLY_SMOKE = FAIL\n')
    process.exit(1)
  }
}
