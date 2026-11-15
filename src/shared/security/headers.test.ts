// @vitest-environment node
/**
 * La CSP y las cabeceras del artefacto desplegado (P16-SaaS).
 *
 * Se prueba el módulo puro y, además, dos hechos del REPOSITORIO que la
 * política da por ciertos y que nadie más vigila:
 *
 *  · que `index.html` tiene exactamente UN script en línea. El plugin resume lo
 *    que encuentre, así que un segundo script en línea quedaría permitido en
 *    silencio; con este test, añadirlo es un acto deliberado.
 *  · que ese script no trae `src`, porque el que sí lo trae no se resume y la
 *    CSP tiene que permitirlo por otra vía (`'self'`).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { contentSecurityPolicy, originOf, renderHeadersFile, securityHeaders } from './headers'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const SUPABASE = 'https://proyecto.supabase.co'
const HUB = 'https://hub.supabase.co'
const HASH = 'sha256-Ab+/0123456789abcdefghijklmnopqrstuvwxyzAB='

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split('; ').map((chunk) => {
      const [name, ...values] = chunk.split(' ')
      return [name ?? '', values]
    }),
  )
}

describe('originOf', () => {
  it('devuelve el origen y descarta la ruta', () => {
    expect(originOf('https://proyecto.supabase.co/rest/v1?x=1')).toBe(SUPABASE)
  })

  it.each([undefined, null, '', 'no-es-una-url', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'devuelve null para %s',
    (value) => {
      expect(originOf(value as string | undefined)).toBeNull()
    },
  )
})

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy({
    supabaseOrigin: SUPABASE,
    hubOrigin: HUB,
    inlineScriptHashes: [HASH],
  })
  const parsed = directives(policy)

  /**
   * `default-src 'none'` y no `'self'`. Con `'self'`, un tipo de recurso que
   * nadie se acuerde de declarar queda permitido desde el propio origen, y la
   * lista de tipos crece con cada versión del estándar.
   */
  it('la base es `none`, no `self`', () => {
    expect(parsed.get('default-src')).toEqual(["'none'"])
  })

  it('`script-src` NO lleva `unsafe-inline` ni `unsafe-eval`', () => {
    const scripts = parsed.get('script-src')?.join(' ') ?? ''
    expect(scripts).not.toContain('unsafe-inline')
    expect(scripts).not.toContain('unsafe-eval')
    expect(scripts).toContain("'self'")
  })

  it('el script en línea entra por su resumen, entre comillas', () => {
    expect(parsed.get('script-src')).toContain(`'${HASH}'`)
  })

  /**
   * La única concesión, y está declarada: Emotion —el motor de estilos de MUI—
   * inyecta `<style>` en tiempo de ejecución. Sin esto la aplicación se queda
   * sin ni un estilo. El test la fija para que sea un cambio consciente, no una
   * deriva.
   */
  it('`style-src` lleva `unsafe-inline`, y es la ÚNICA directiva que lo lleva', () => {
    expect(parsed.get('style-src')).toContain("'unsafe-inline'")
    const conUnsafe = [...parsed.entries()]
      .filter(([, values]) => values.some((v) => v.includes('unsafe')))
      .map(([name]) => name)
    expect(conUnsafe).toEqual(['style-src'])
  })

  it('el proyecto Supabase entra en `connect-src`, y también su websocket', () => {
    const connect = parsed.get('connect-src') ?? []
    expect(connect).toContain(SUPABASE)
    expect(connect).toContain('wss://proyecto.supabase.co')
  })

  it('el hub entra cuando está configurado y desaparece cuando no', () => {
    expect(parsed.get('connect-src')).toContain(HUB)
    const sinHub = directives(
      contentSecurityPolicy({ supabaseOrigin: SUPABASE, hubOrigin: null, inlineScriptHashes: [] }),
    )
    expect(sinHub.get('connect-src')).not.toContain(HUB)
  })

  it('no repite el origen cuando el hub y el proyecto son el mismo', () => {
    const same = directives(
      contentSecurityPolicy({
        supabaseOrigin: SUPABASE,
        hubOrigin: SUPABASE,
        inlineScriptHashes: [],
      }),
    )
    expect(same.get('connect-src')).toEqual([
      "'self'",
      SUPABASE,
      'wss://proyecto.supabase.co',
      'https://nominatim.openstreetmap.org',
    ])
  })

  it('el mapa abre SOLO sus dos orígenes: teselas como imagen y Nominatim como petición', () => {
    expect(parsed.get('img-src')).toContain('https://tile.openstreetmap.org')
    expect(parsed.get('connect-src')).toContain('https://nominatim.openstreetmap.org')
    expect(parsed.get('script-src')?.some((origen) => origen.includes('openstreetmap'))).toBe(false)
    expect(parsed.get('img-src')).not.toContain('https:')
  })

  it('solo marcos propios (la vista previa del taller), ni objetos ni base reescribible', () => {
    expect(parsed.get('frame-src')).toEqual(["'self'"])
    expect(parsed.get('object-src')).toEqual(["'none'"])
    // Los videos de la portada: solo del Storage del proyecto (y la vista previa local).
    expect(parsed.get('media-src')).toEqual(
      parsed.get('img-src')?.filter((origen) => origen !== 'data:' && origen !== 'https://tile.openstreetmap.org'),
    )
    expect(parsed.get('media-src')).toContain(SUPABASE)
    expect(parsed.get('base-uri')).toEqual(["'self'"])
    expect(parsed.get('form-action')).toEqual(["'self'"])
  })

  /**
   * `frame-ancestors` en un `<meta http-equiv>` lo IGNORA el navegador.
   * Publicarlo ahí sería anunciar una protección que no existe.
   */
  it('`frame-ancestors` va en la cabecera y NO en la etiqueta', () => {
    expect(parsed.get('frame-ancestors')).toEqual(["'self'"])
    const paraMeta = contentSecurityPolicy({
      supabaseOrigin: SUPABASE,
      inlineScriptHashes: [],
      includeFrameAncestors: false,
    })
    expect(paraMeta).not.toContain('frame-ancestors')
    expect(paraMeta).toContain('upgrade-insecure-requests')
  })

  it('ninguna directiva abre `https:` entero', () => {
    expect(policy).not.toMatch(/(?:^|\s)https:(?:\s|;|$)/)
    expect(policy).not.toContain(" *")
  })
})

describe('securityHeaders', () => {
  const headers = securityHeaders({
    supabaseOrigin: SUPABASE,
    hubOrigin: null,
    inlineScriptHashes: [HASH],
  })

  it('trae las ocho que exige cualquier revisión de proveedor', () => {
    expect(Object.keys(headers).sort()).toEqual([
      'Content-Security-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'Permissions-Policy',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ])
  })

  /**
   * `preload` es una decisión de dominio irreversible durante semanas. Un build
   * no la toma.
   */
  it('HSTS de un año con subdominios y SIN preload', () => {
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains')
  })

  it('la cabecera SÍ lleva `frame-ancestors`', () => {
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'self'")
  })

  it('el referente no sale de origen con la ruta: la ruta lleva el token del pedido', () => {
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })

  it('cámara, micrófono y ubicación negados a todo el mundo', () => {
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(headers['Permissions-Policy']).toContain(`${feature}=()`)
    }
  })
})

describe('renderHeadersFile', () => {
  it('sale en el formato `_headers`: patrón de ruta y cabeceras indentadas', () => {
    const file = renderHeadersFile({ 'X-Content-Type-Options': 'nosniff' })
    expect(file).toBe(['/*', '  X-Content-Type-Options: nosniff', ''].join('\n'))
  })

  it('cubre TODAS las rutas: una SPA sirve el mismo documento en cualquiera', () => {
    expect(renderHeadersFile(securityHeaders({ supabaseOrigin: SUPABASE, inlineScriptHashes: [] })))
      .toMatch(/^\/\*\n/)
  })
})

describe('el `index.html` que la política da por cierto', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter(
    (match) => (match[1] ?? '').trim().length > 0,
  )

  /**
   * El plugin resume lo que encuentre. Sin este test, un segundo script en
   * línea quedaría autorizado por la CSP sin que nadie lo decidiera.
   */
  it('hay exactamente UN script en línea, el anti-flash del tema', () => {
    expect(inline).toHaveLength(1)
    expect(inline[0]?.[1]).toContain('ecommerce-color-mode')
  })

  it('no hay manejadores de evento en línea, que la CSP no cubre por resumen', () => {
    expect(html).not.toMatch(/\son(click|load|error|mouseover)\s*=/i)
  })

  it('el `charset` está declarado: la CSP se inyecta justo detrás', () => {
    expect(html).toMatch(/<meta[^>]+charset/i)
  })
})
