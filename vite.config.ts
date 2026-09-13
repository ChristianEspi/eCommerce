import { defineConfig, type Plugin } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import {
  contentSecurityPolicy,
  originOf,
  renderHeadersFile,
  securityHeaders,
} from './src/shared/security/headers'

/**
 * `preconnect` al proyecto Supabase (P15-SaaS).
 *
 * La vitrina no puede pintar catálogo hasta que la PRIMERA consulta vuelve, y
 * esa consulta empieza por abrir la conexión: DNS + TCP + TLS contra un origen
 * distinto al del documento. Adelantar ese apretón de manos mientras el
 * navegador todavía está descargando el JavaScript quita del camino crítico
 * unos 100-300 ms en una conexión móvil, sin descargar ni un byte de más.
 *
 * Se inyecta desde el plugin y no a mano en `index.html` porque la URL es
 * distinta en cada despliegue: escrita a mano acabaría siendo un `preconnect` a
 * un proyecto que no es (peor que ninguno, porque abre una conexión inútil), y
 * `%VITE_SUPABASE_URL%` sin definir dejaría un `href` literal roto en el HTML.
 * Sin variable, no hay etiqueta.
 */
function preconnectSupabase(url: string | undefined): Plugin {
  return {
    name: 'ebim-preconnect-supabase',
    transformIndexHtml() {
      if (!url) return []
      let origin: string
      try {
        origin = new URL(url).origin
      } catch {
        return []
      }
      return [
        { tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head-prepend' },
        { tag: 'link', attrs: { rel: 'dns-prefetch', href: origin }, injectTo: 'head-prepend' },
      ]
    },
  }
}

/** Salto de línea + sangría del `<head>`, para que el HTML generado se lea. */
const INDENT = `${String.fromCharCode(10)}    `

/**
 * Cabeceras de seguridad y CSP (P16-SaaS).
 *
 * Genera `dist/_headers` —el formato que leen igual Netlify y Cloudflare
 * Pages— y, además, inyecta la misma política como `<meta http-equiv>` en el
 * `index.html`.
 *
 * **Las dos, y no una.** La cabecera es la buena: es la única forma de aplicar
 * `frame-ancestors` y la única que cubre las respuestas que no son el
 * documento. La etiqueta existe porque un `_headers` **depende del hosting**:
 * si mañana el despliegue se mueve a un bucket que no lo lee, la aplicación se
 * queda sin CSP y nadie se entera. Con la etiqueta dentro del artefacto, la
 * protección de `script-src` viaja con él.
 *
 * **Sin `VITE_SUPABASE_URL` no se emite nada.** Un `connect-src` sin el origen
 * del proyecto deja la aplicación sin backend: mejor no publicar política que
 * publicar una que rompe. Es el mismo criterio que el `preconnect` de arriba
 * —«sin variable, no hay etiqueta»— y queda anotado en el log del build.
 */
function securityHeadersPlugin(env: Record<string, string>): Plugin {
  const supabaseOrigin = originOf(env.VITE_SUPABASE_URL)
  const hubOrigin = originOf(env.VITE_EBIM_HUB_URL)

  /**
   * Los origenes de Culqi, y SOLO si hay clave publica configurada.
   *
   * La clave es el interruptor de la pasarela en el navegador: sin ella no se
   * carga su script ni se abre su iframe, asi que abrirle la politica seria
   * pagar el riesgo sin usar la funcion. Un despliegue sin Culqi conserva
   * `script-src 'self'` y `frame-src 'none'` intactos.
   *
   * Son tres cosas y cada una tiene su motivo: `checkout.culqi.com` sirve el
   * script y el iframe donde se teclea la tarjeta —ese aislamiento es lo que
   * mantiene el numero fuera de esta aplicacion— y `api.culqi.com` es a donde
   * el propio script envia los datos para devolver el token.
   */
  const paymentGatewayOrigins = env.VITE_CULQI_PUBLIC_KEY
    ? ['https://checkout.culqi.com', 'https://api.culqi.com', 'https://3ds.culqi.com']
    : []
  const inlineScriptHashes: string[] = []
  let outDir = 'dist'

  return {
    name: 'ebim-security-headers',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    transformIndexHtml: {
      // `post`: hay que resumir el HTML FINAL. Si otro plugin toca el script en
      // línea después de calcular el resumen, la CSP bloquea justo lo que
      // quería permitir.
      order: 'post',
      handler(html) {
        inlineScriptHashes.length = 0
        for (const match of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
          const body = match[1] ?? ''
          if (body.trim().length === 0) continue
          inlineScriptHashes.push(
            `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`,
          )
        }
        if (!supabaseOrigin) return html

        const policy = contentSecurityPolicy({
          supabaseOrigin,
          hubOrigin,
          inlineScriptHashes,
          paymentGatewayOrigins,
          includeFrameAncestors: false,
        })

        // La etiqueta va JUSTO DESPUÉS de `<meta charset>`, no la primera. Son
        // dos reglas que se pisan: la declaración de codificación tiene que
        // caber en los primeros 1024 bytes del documento —si no, el navegador
        // adivina el juego de caracteres, que es su propio problema de
        // seguridad— y una CSP en etiqueta solo cubre lo que viene DESPUÉS de
        // ella. Este es el único hueco que cumple las dos: detrás del charset y
        // delante del script anti-flash, que es el primer script del documento.
        const meta =
          '<meta http-equiv="Content-Security-Policy" content="' +
          policy.replace(/"/g, '&quot;') +
          '">'
        const charset = /<meta[^>]+charset[^>]*>/i.exec(html)
        if (!charset) {
          console.warn('`index.html` sin `<meta charset>`: la CSP va al principio del head.')
          return html.replace(/<head>/i, '<head>' + INDENT + meta)
        }
        const at = charset.index + charset[0].length
        return html.slice(0, at) + INDENT + meta + html.slice(at)
      },
    },
    closeBundle() {
      if (!supabaseOrigin) {
        console.warn(
          'VITE_SUPABASE_URL no definida: no se genera `_headers` ni la CSP. ' +
            'El despliegue quedaria sin cabeceras de seguridad.',
        )
        return
      }
      const file = resolve(outDir, '_headers')
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(
        file,
        // Los MISMOS orígenes de pasarela que la etiqueta `<meta>`. Si este
        // fichero se quedara sin ellos, la política del despliegue bloquearía lo
        // que la de desarrollo permite, y el fallo solo saldría en producción.
        renderHeadersFile(
          securityHeaders({
            supabaseOrigin,
            hubOrigin,
            inlineScriptHashes,
            paymentGatewayOrigins,
          }),
        ),
        'utf8',
      )
    },
  }
}

/**
 * Reparto de dependencias en chunks estables (P15-SaaS).
 *
 * Antes de esta fase todo lo compartido caía en un único `index-*.js` de
 * 970,90 kB (283,38 kB gzip). El problema no era solo el tamaño: era que
 * **cualquier** cambio de una línea de la aplicación cambiaba el hash de ese
 * archivo y el visitante volvía a descargarse React, MUI y `supabase-js`
 * enteros. Separarlos no reduce los bytes de la PRIMERA visita —se descargan
 * igual, pero en paralelo— y sí los de todas las demás.
 *
 * Solo se declaran librerías que ya estaban en el grafo de entrada. Meter aquí
 * una que hoy es perezosa (`zod` lo es: entra por rutas `lazy`) la volvería
 * ansiosa y haría más lenta la vitrina, que es justo lo contrario de la fase.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  // `@mui/material` NO se agrupa. Rollup ya lo reparte solo, y de la forma
  // correcta: `TextField`, `Autocomplete`, `Modal`, `Tabs` y `TablePagination`
  // salen en chunks propios porque solo los alcanzan rutas perezosas. Juntarlo
  // todo en un `vendor-mui` mezcla lo ansioso con lo perezoso y arrastra los
  // cinco al primer pintado: medido, +8,5 kB gzip para quien solo abre la
  // vitrina. Lo mismo vale para `zod`, que hoy entra por rutas perezosas.
  if (/[\\/]node_modules[\\/]@emotion[\\/]/.test(id)) return 'vendor-emotion'
  if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'vendor-supabase'
  if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'vendor-query'
  if (/[\\/]node_modules[\\/](react-router|react-router-dom|@remix-run)[\\/]/.test(id)) {
    return 'vendor-router'
  }
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'

  return undefined
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react(), preconnectSupabase(env.VITE_SUPABASE_URL), securityHeadersPlugin(env)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      // El manifiesto es lo que hace medible el presupuesto de rendimiento:
      // `npm run bundle:report` lo lee para calcular los bytes REALES de cada
      // recorrido (entrada + cierre de imports estáticos de su ruta), en vez de
      // mirar el chunk más grande y suponer. Ver `docs/performance-budget.md`.
      manifest: true,
      rollupOptions: {
        output: { manualChunks: (id) => vendorChunk(id) },
      },
      // El aviso por defecto (500 kB) ya no dice nada útil una vez repartido el
      // proveedor: el techo real que vigilamos es el de `docs/performance-budget.md`.
      chunkSizeWarningLimit: 400,
    },
    test: {
      globals: true,
      // jsdom con el `Request` de Node reconciliado con su `AbortSignal` (N08):
      // ver `src/test/jsdom-environment.ts`.
      environment: './src/test/jsdom-environment.ts',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Los flujos completos (login -> alta -> panel) recorren el router real con
      // rutas `React.lazy`. Con la suite entera en paralelo, resolver esos
      // imports en una maquina cargada pasa de los 5 s por defecto y el test
      // fallaria por lento, no por roto. El margen no oculta nada: una asercion
      // que no se cumple sigue fallando igual.
      testTimeout: 30_000,
      // Y el mismo margen para los HOOKS. El `beforeAll` de los bancos de prueba
      // de base aplica las 93 migraciones sobre una Postgres en WASM; con la
      // suite entera en paralelo eso pasa de los 10 s por defecto y el archivo
      // falla antes de ejecutar una sola asercion — un falso negativo que depende
      // del hardware, no del codigo. Subirlo no oculta nada: un hook que de
      // verdad se cuelgue sigue fallando, solo que treinta segundos despues.
      hookTimeout: 30_000,
    },
  }
})
