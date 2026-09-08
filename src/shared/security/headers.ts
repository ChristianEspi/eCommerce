/**
 * Cabeceras de seguridad de la aplicación servida (P16-SaaS).
 *
 * ## Por qué esto es código y no una nota en un runbook
 *
 * La CSP de esta aplicación no se puede escribir a mano una vez y olvidarla:
 * depende de **dos cosas que cambian por despliegue**.
 *
 *  1. El origen del proyecto Supabase (`VITE_SUPABASE_URL`). Sin él en
 *     `connect-src`, la vitrina no puede pedir catálogo y la aplicación queda
 *     en blanco. Escrito a mano en un `_headers` versionado sería el origen de
 *     OTRO despliegue.
 *  2. El resumen del script en línea del `index.html` —el anti-flash que fija
 *     modo, acento y densidad antes del primer pintado—. Cualquier cambio en
 *     esas quince líneas cambia el `sha256`, y una CSP con el resumen viejo
 *     bloquea el script: el usuario ve el tema equivocado durante un instante en
 *     cada carga.
 *
 * Por eso el fichero de cabeceras se **genera** en el build (`vite.config.ts`,
 * plugin `ebim-security-headers`) a partir de este módulo, que es puro y por
 * tanto comprobable sin levantar un navegador.
 *
 * ## Lo que NO se puede cerrar, y se dice
 *
 * `style-src` lleva `'unsafe-inline'`. No es un descuido: Emotion —el motor de
 * estilos de MUI— inyecta reglas en etiquetas `<style>` en tiempo de ejecución,
 * y sin `'unsafe-inline'` la aplicación se queda sin ni un estilo. Las
 * alternativas reales son un nonce por respuesta (exige servidor que renderice
 * el HTML; esta es una SPA de ficheros estáticos) o migrar el motor de estilos.
 * Está declarado como PARCIAL en `docs/SECURITY_BASELINE.md` con su condición
 * de salida, en vez de escribir una CSP que aparente ser más estricta de lo que
 * es. El riesgo que deja abierto es CSS, no ejecución: `script-src` **no** lleva
 * `'unsafe-inline'`.
 */

/** Origen normalizado (`https://host[:puerto]`), o `null` si no lo es. */
export function originOf(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

/** El mismo origen en `wss://`, para el canal de tiempo real de Supabase. */
function websocketOrigin(origin: string): string {
  return origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
}

export type CspInput = {
  /** Origen del proyecto Supabase de eCommerce. */
  supabaseOrigin: string | null
  /** Origen del hub EBIM, cuando esté configurado (contrato §5). */
  hubOrigin?: string | null
  /** `sha256-...` de cada script en línea del `index.html` final. */
  inlineScriptHashes: readonly string[]
  /**
   * `frame-ancestors` solo tiene sentido en una cabecera de respuesta: en un
   * `<meta http-equiv>` el navegador lo ignora. Se omite al generar la etiqueta
   * para no publicar una directiva que no se aplica.
   */
  includeFrameAncestors?: boolean
  /**
   * Los orígenes de la pasarela de pago, si el despliegue tiene una configurada.
   *
   * Una pasarela de tarjeta necesita tres permisos que la política niega por
   * defecto: cargar su script, hablar con su API y abrir su iframe —ahí es donde
   * se teclea la tarjeta, y ese aislamiento es justo lo que mantiene el número
   * fuera de esta aplicación—.
   *
   * Va como ENTRADA y no como constante para que un despliegue sin pasarela
   * conserve `script-src 'self'` y `frame-src 'none'`. Abrirlo para todos porque
   * un tenant cobra con tarjeta sería pagar el riesgo entre todos.
   */
  paymentGatewayOrigins?: readonly string[]
}

/**
 * Las fuentes de Google. Están en el `index.html` desde P00 (DM Sans es la
 * tipografía de la marca, contrato §4.2). Se declaran explícitamente en vez de
 * abrir `style-src`/`font-src` a `https:` entero.
 */
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com'
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com'

/**
 * La política, como lista ordenada de directivas.
 *
 * `default-src 'none'` y no `'self'`: con `'self'` cualquier tipo de recurso
 * que se olvide de declarar queda permitido desde el propio origen, y la lista
 * de tipos crece con cada versión del estándar. Con `'none'`, lo que no está
 * escrito abajo no carga, y eso se nota en un test y no en producción.
 */
export function contentSecurityPolicy(input: CspInput): string {
  // Sin duplicados: en DEV el hub y el proyecto de eCommerce apuntan al mismo
  // sitio, y una directiva que repite el origen es ruido en una revisión.
  const api = [
    ...new Set(
      [input.supabaseOrigin, input.hubOrigin].filter((value): value is string => Boolean(value)),
    ),
  ]
  const sockets = api.map(websocketOrigin)

  // Vacío mientras no haya pasarela configurada: sin ella, `script-src` sigue
  // siendo `'self'` y `frame-src` sigue siendo `'none'`.
  const gateway = [...new Set(input.paymentGatewayOrigins ?? [])]

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'none'"]],
    [
      'script-src',
      ["'self'", ...input.inlineScriptHashes.map((hash) => `'${hash}'`), ...gateway],
    ],
    ['style-src', ["'self'", "'unsafe-inline'", GOOGLE_FONTS_CSS]],
    ['font-src', ["'self'", GOOGLE_FONTS_FILES, 'data:']],
    // Las imágenes de producto viven en el Storage del proyecto (contrato:
    // bucket con ruta por tenant), así que el origen de Supabase basta. `blob:`
    // es la previsualización local al subir una imagen desde el backoffice.
    ['img-src', ["'self'", 'data:', 'blob:', ...api]],
    ['connect-src', ["'self'", ...api, ...sockets, ...gateway]],
    ['manifest-src', ["'self'"]],
    ['worker-src', ["'self'", 'blob:']],
    // Ni un `<iframe>`, ni un `<object>`, ni un `<embed>`. La aplicación no
    // incrusta nada de terceros; el día que incruste una pasarela, se declara
    // ese origen aquí y el cambio se ve en la revisión.
    // El iframe de la pasarela es la única excepción, y solo si hay pasarela:
    // ahí se teclea la tarjeta, y ese aislamiento es lo que mantiene el número
    // fuera de esta aplicación. Sin pasarela configurada sigue siendo `'none'`.
    ['frame-src', gateway.length > 0 ? gateway : ["'none'"]],
    ['object-src', ["'none'"]],
    // `base-uri` es el que casi nadie pone y el que convierte un XSS de DOM en
    // reescritura de TODAS las rutas relativas del documento.
    ['base-uri', ["'self'"]],
    // El formulario de login no publica a ningún sitio salvo a sí mismo.
    ['form-action', ["'self'"]],
    ['upgrade-insecure-requests', []],
  ]

  if (input.includeFrameAncestors !== false) {
    directives.splice(directives.length - 1, 0, ['frame-ancestors', ["'none'"]])
  }

  return directives
    .map(([name, values]) => (values.length === 0 ? name : `${name} ${values.join(' ')}`))
    .join('; ')
}

/**
 * Las cabeceras de respuesta del hosting estático.
 *
 * `Strict-Transport-Security` con `preload` NO se incluye: el `preload` es una
 * decisión de dominio que no se puede deshacer en semanas y no la toma un
 * build. Un año de `max-age` con subdominios sí, que es lo que exige cualquier
 * revisión de proveedor.
 */
export function securityHeaders(input: CspInput): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy({ ...input, includeFrameAncestors: true }),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    // `X-Frame-Options` es redundante con `frame-ancestors` en un navegador
    // actual y sigue siendo lo que mira media herramienta de auditoría.
    'X-Frame-Options': 'DENY',
    // Al salir a otro origen viaja el origen, no la ruta: la ruta de esta
    // aplicación lleva el slug de la tienda y, en `/order/`, el token del pedido.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': [
      'accelerometer=()',
      'camera=()',
      'display-capture=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ].join(', '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
}

/**
 * Formato `_headers` (Netlify y Cloudflare Pages lo leen igual): una línea con
 * el patrón de ruta y debajo las cabeceras indentadas.
 *
 * Se genera para TODAS las rutas (`/*`) porque una SPA sirve el mismo
 * `index.html` en cualquiera de ellas.
 */
export function renderHeadersFile(headers: Record<string, string>): string {
  const lines = ['/*']
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`  ${name}: ${value}`)
  }
  return `${lines.join('\n')}\n`
}
