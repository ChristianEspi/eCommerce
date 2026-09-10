import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publicStoreSchema } from './types'
import { DEFAULT_HOME_LAYOUT, THEME_PRESETS } from './theme/presets'
import { resolveStoreTheme } from './theme/resolve'

/**
 * La tienda pública y su tema: de la fila cruda a lo que se pinta.
 *
 * Lo que se fija aquí es una sola promesa, dicha de muchas maneras: **nada de
 * lo que venga en estos tres campos puede dejar la vitrina sin tienda.** Ni que
 * falten, ni que traigan un tema que esta versión no conoce, ni que traigan un
 * JSON escrito a mano.
 *
 * No es una precaución teórica. Es lo que pasa durante un despliegue en el que
 * la app sale antes que la migración, y también lo que pasaría si alguien
 * editara la fila con el cliente de servicio.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { fetchPublicStore, resetStorefrontThemeProbe, THEME_COLUMNS } = await import('./api')

/** Fila mínima que `publicStoreSchema` acepta: lo de antes del Theme Engine. */
const FILA_ANTIGUA = {
  store_id: '11111111-1111-4111-8111-111111111111',
  slug: 'botica',
  name: 'Botica',
  currency: 'PEN',
  accent_color: '#5AA97F',
}

// ---------------------------------------------------------------------------
// El esquema no se rompe con lo que no conoce
// ---------------------------------------------------------------------------

describe('una respuesta anterior al Theme Engine', () => {
  it('parsea sin los tres campos nuevos', () => {
    const tienda = publicStoreSchema.parse(FILA_ANTIGUA)

    expect(tienda.slug).toBe('botica')
    expect(tienda.theme_preset).toBeUndefined()
  })

  it('se resuelve como la tienda universal que era', () => {
    const tema = resolveStoreTheme(publicStoreSchema.parse(FILA_ANTIGUA))

    expect(tema.preset).toBe('universal')
    expect(tema.definition).toEqual(THEME_PRESETS.universal)
    // La compatibilidad, dicha en un solo sitio: lo que ve hoy una tienda que
    // nunca configuró nada es lo que verá después de esta fase.
    expect(tema.layout).toEqual(DEFAULT_HOME_LAYOUT)
  })
})

describe('cada preset llega entero', () => {
  it.each(['universal', 'retail', 'premium', 'catalog'] as const)('%s', (preset) => {
    const tienda = publicStoreSchema.parse({ ...FILA_ANTIGUA, theme_preset: preset })

    const tema = resolveStoreTheme(tienda)

    expect(tema.preset).toBe(preset)
    expect(tema.definition).toEqual(THEME_PRESETS[preset])
  })
})

describe('lo que la vitrina no reconoce', () => {
  const RAROS: Array<[string, unknown]> = [
    ['un tema inventado', 'pharmacy'],
    ['mayúsculas', 'Retail'],
    ['un número', 7],
    ['nulo', null],
    ['un objeto', { id: 'retail' }],
  ]

  it.each(RAROS)('%s cae a universal sin lanzar', (_caso, valor) => {
    const tienda = publicStoreSchema.parse({ ...FILA_ANTIGUA, theme_preset: valor })

    expect(resolveStoreTheme(tienda).preset).toBe('universal')
  })

  it('un estilo con basura conserva lo bueno y descarta lo demás', () => {
    const tienda = publicStoreSchema.parse({
      ...FILA_ANTIGUA,
      theme_preset: 'retail',
      storefront_style: {
        contentWidth: 'xl',
        headerVariant: 'mega',
        css: '.sf-scope{display:none}',
      },
    })

    const { style } = resolveStoreTheme(tienda)

    expect(style.contentWidth).toBe('xl')
    expect(style.headerVariant).toBe(THEME_PRESETS.retail.headerVariant)
    expect(style).not.toHaveProperty('css')
  })

  it('un orden de Home ilegible se lee como el heredado', () => {
    const tienda = publicStoreSchema.parse({
      ...FILA_ANTIGUA,
      home_layout: 'esto no es un layout',
    })

    expect(resolveStoreTheme(tienda).layout).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('un orden parcial manda en lo que dice y hereda el resto', () => {
    const tienda = publicStoreSchema.parse({
      ...FILA_ANTIGUA,
      home_layout: { version: 1, sections: [{ id: 'trust', enabled: true }] },
    })

    const { sections } = resolveStoreTheme(tienda).layout

    expect(sections[0]?.id).toBe('trust')
    // Y sigue estando TODO: una sección que la configuración no nombró no
    // desaparece de la portada, se añade detrás con su valor por defecto.
    expect(sections).toHaveLength(DEFAULT_HOME_LAYOUT.sections.length)
  })
})

// ---------------------------------------------------------------------------
// Despliegue en marcha: la app va por delante de la migración
// ---------------------------------------------------------------------------

interface RespuestaFalsa {
  data: unknown
  error: { code?: string; message?: string } | null
}

/** Cliente de mentira que responde distinto según las columnas pedidas. */
function clienteQue(responder: (select: string) => RespuestaFalsa) {
  const selects: string[] = []
  return {
    selects,
    client: {
      from: () => ({
        select: (select: string) => {
          selects.push(select)
          const respuesta = responder(select)
          const eslabon = {
            eq: () => eslabon,
            limit: () => Promise.resolve(respuesta),
            maybeSingle: () => Promise.resolve(respuesta),
          }
          return eslabon
        },
      }),
    },
  }
}

describe('cuando la base todavía no tiene las columnas del tema', () => {
  beforeEach(() => {
    resetStorefrontThemeProbe()
  })

  it('reintenta sin ellas y la tienda se pinta igual', async () => {
    const falso = clienteQue((select) =>
      select.includes('theme_preset')
        ? {
            data: null,
            error: {
              code: '42703',
              message: 'column public_stores.theme_preset does not exist',
            },
          }
        : { data: FILA_ANTIGUA, error: null },
    )
    holder.client = falso.client

    const tienda = await fetchPublicStore('botica')

    expect(tienda.slug).toBe('botica')
    expect(resolveStoreTheme(tienda).preset).toBe('universal')
    expect(falso.selects).toHaveLength(2)
  })

  it('no vuelve a pagar la consulta fallida en la siguiente navegación', async () => {
    const falso = clienteQue((select) =>
      select.includes('theme_preset')
        ? { data: null, error: { code: '42703', message: 'column theme_preset does not exist' } }
        : { data: FILA_ANTIGUA, error: null },
    )
    holder.client = falso.client

    await fetchPublicStore('botica')
    await fetchPublicStore('botica')

    expect(falso.selects.filter((s) => s.includes('theme_preset'))).toHaveLength(1)
  })

  it('un error que NO es de columna se reporta, no se degrada en silencio', async () => {
    // La condición que evita que este mecanismo se coma cualquier fallo de
    // esquema: sin ella, un problema real de RLS se vería como «tienda sin tema».
    const falso = clienteQue(() => ({
      data: null,
      error: { code: '42501', message: 'permission denied for view public_stores' },
    }))
    holder.client = falso.client

    await expect(fetchPublicStore('botica')).rejects.toThrow()
    expect(falso.selects).toHaveLength(1)
  })

  it('pide las tres columnas cuando la base sí las tiene', async () => {
    const falso = clienteQue(() => ({
      data: { ...FILA_ANTIGUA, theme_preset: 'premium' },
      error: null,
    }))
    holder.client = falso.client

    const tienda = await fetchPublicStore('botica')

    expect(falso.selects).toHaveLength(1)
    for (const columna of THEME_COLUMNS) expect(falso.selects[0]).toContain(columna)
    expect(resolveStoreTheme(tienda).preset).toBe('premium')
  })
})
