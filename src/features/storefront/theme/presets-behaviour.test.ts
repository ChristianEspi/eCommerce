import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HOME_LAYOUT, THEME_PRESETS } from './presets'
import { THEME_PRESET_IDS } from './types'

/**
 * Las reglas que los cuatro temas no pueden romper.
 *
 * Este archivo no mira componentes: mira el CONTRATO y la hoja de estilos de la
 * vitrina. Es donde se comprueban las cosas que ninguna prueba de render puede
 * ver porque no son de una pantalla concreta, sino de cómo está construido el
 * tema entero.
 *
 * Las tres que más valen:
 *
 *  1. **`universal` no tiene reglas propias.** Es el suelo: lo que se ve sin
 *     ningún atributo es lo que la vitrina ya hacía. En cuanto exista una regla
 *     `[data-store-theme='universal']`, «por defecto» habrá dejado de significar
 *     «como antes» y las tiendas que nunca eligieron tema habrán cambiado.
 *  2. **Ningún tema toca el color.** El acento es 100 % del tenant (contrato
 *     §4.4) y el modo claro/oscuro es de `AppearanceProvider`. Un tema que
 *     redefiniera `--accent` le quitaría al comercio su color, y uno que
 *     redefiniera `--card` rompería el modo oscuro sin que se note en claro.
 *  3. **Ningún tema mete movimiento.** El movimiento de la vitrina se apaga
 *     entero con `prefers-reduced-motion`, y esa promesa solo se sostiene si las
 *     animaciones viven donde ya se apagan.
 */

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'storefront.css'),
  'utf8',
)

function cuerpos(re: RegExp): string[] {
  const bloques: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(CSS)) !== null) bloques.push(match[1] ?? '')
  return bloques
}

/** Todo lo que cuelga de un atributo de tema, incluidos los descendientes. */
function bloquesDeTema(): string[] {
  return cuerpos(/\.sf-scope\[data-store-[^\]]+\][^{]*\{([^}]*)\}/g)
}

/**
 * Solo lo que se declara SOBRE la propia frontera.
 *
 * La distinción importa: ahí es donde un tema competiría con las reglas de modo
 * claro/oscuro, que declaran sobre ese mismo elemento y con más peso. Una regla
 * que apunta a un descendiente —la cabecera, por ejemplo— no compite con nadie.
 */
function bloquesDeLaFrontera(): string[] {
  return cuerpos(/\.sf-scope\[data-store-[^\]]+\]\s*\{([^}]*)\}/g)
}

// ---------------------------------------------------------------------------
// P09 · Universal es la línea base
// ---------------------------------------------------------------------------

describe('universal es el suelo, no un tema más', () => {
  it('no tiene ni una regla propia en la hoja', () => {
    expect(CSS).not.toContain("data-store-theme='universal'")
    expect(CSS).not.toContain('data-store-theme="universal"')
  })

  it('sus valores son los de la vitrina anterior al Theme Engine', () => {
    // Los mismos números que había cableados: `Container` en `lg`,
    // `ProductMedia` en `1 / 1` y `ProductGrid` repartiendo 2/3/4.
    expect(THEME_PRESETS.universal).toMatchObject({
      contentWidth: 'lg',
      imageRatio: 'square',
      sectionSpacing: 'comfortable',
      headerVariant: 'standard',
      productCardVariant: 'comfortable',
      gridColumns: { xs: 2, sm: 3, lg: 4 },
    })
  })

  it('el orden por defecto no enciende nada que no existiera', () => {
    const encendidas = DEFAULT_HOME_LAYOUT.sections
      .filter((s) => s.enabled)
      .map((s) => s.id)

    // `categories`, `featured`, `business-info` y `newsletter` quedan apagadas:
    // las dos primeras porque hoy se pintan en otro sitio, las dos últimas
    // porque todavía no tienen qué pintar.
    expect(encendidas).not.toContain('categories')
    expect(encendidas).not.toContain('featured')
    expect(encendidas).not.toContain('business-info')
    expect(encendidas).not.toContain('newsletter')
  })
})

// ---------------------------------------------------------------------------
// Lo que ningún tema puede hacer
// ---------------------------------------------------------------------------

describe('ningún tema le quita el color al comercio', () => {
  /**
   * Los tres últimos no son colores de marca y aun así están vetados, por un
   * motivo de CASCADA: se redefinen por modo claro/oscuro con selectores de más
   * peso, así que un tema que los pisara solo se notaría con el modo del
   * sistema sin elegir. El modo manda en profundidad; el tema, en geometría.
   */
  const COLORES_AJENOS = ['--accent:', '--accent-deep:', '--accent-soft:', '--text:', '--muted:', '--card:', '--bg:']

  it.each(COLORES_AJENOS)('no redefine %s en ninguna regla de tema', (variable) => {
    for (const bloque of bloquesDeTema()) {
      expect(bloque).not.toContain(variable)
    }
  })

  const PROFUNDIDAD = ['--sf-line:', '--sf-shadow:', '--sf-shadow-hover:', '--sf-media-bg:']

  it.each(PROFUNDIDAD)('no pisa %s sobre la propia frontera', (variable) => {
    for (const bloque of bloquesDeLaFrontera()) {
      expect(bloque).not.toContain(variable)
    }
  })

  it('hay bloques de tema de verdad que comprobar', () => {
    // Si esta hoja dejara de tener reglas de tema, las de arriba pasarían
    // vacías y no probarían nada.
    expect(bloquesDeTema().length).toBeGreaterThan(3)
  })
})

describe('ningún tema mete movimiento nuevo', () => {
  it('no declara transiciones ni animaciones', () => {
    for (const bloque of bloquesDeTema()) {
      expect(bloque).not.toMatch(/\btransition\b|\banimation\b/)
    }
  })
})

// ---------------------------------------------------------------------------
// Densidad y móvil
// ---------------------------------------------------------------------------

describe('la densidad nunca llega al teléfono', () => {
  it.each(THEME_PRESET_IDS)('%s reparte dos columnas en móvil', (preset) => {
    // Es el riesgo real de un tema denso: seis columnas están muy bien en un
    // escritorio y a 320 px son seis tarjetas de 45 px con el nombre cortado.
    expect(THEME_PRESETS[preset].gridColumns.xs).toBe(2)
  })

  it.each(THEME_PRESET_IDS)('%s crece de forma monótona', (preset) => {
    const { xs, sm, lg } = THEME_PRESETS[preset].gridColumns
    expect(sm).toBeGreaterThanOrEqual(xs)
    expect(lg).toBeGreaterThanOrEqual(sm)
  })

  it('el catálogo denso es el que más reparte, y el editorial el que menos', () => {
    expect(THEME_PRESETS.catalog.gridColumns.lg).toBeGreaterThan(
      THEME_PRESETS.universal.gridColumns.lg,
    )
    expect(THEME_PRESETS.premium.gridColumns.lg).toBeLessThan(
      THEME_PRESETS.universal.gridColumns.lg,
    )
  })
})
