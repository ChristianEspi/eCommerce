import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOME_LAYOUT,
  DEFAULT_THEME_PRESET,
  HOME_SECTION_IDS,
  MAX_ITEMS_LIMITS,
  THEME_PRESETS,
  normalizeHomeLayout,
  normalizeStorefrontStyle,
  normalizeThemePreset,
} from './presets'

/**
 * Los contratos del Theme Engine.
 *
 * Todo lo que se prueba aquí entra por la puerta menos fiable que tiene la
 * vitrina: una respuesta pública de la base, que puede venir de una versión
 * anterior al despliegue, de una fila escrita a mano o de un editor que guardó
 * algo raro. La regla es una y no admite matices: **lo que no se entiende cae a
 * un valor seguro y la tienda sigue en pie**. Una vitrina en blanco porque un
 * JSON traía una clave de más no es un fallo de validación, es una tienda
 * cerrada.
 *
 * Por eso ninguna de estas funciones lanza. Normalizan.
 */

describe('el preset', () => {
  it('acepta los cuatro y solo los cuatro', () => {
    for (const preset of ['universal', 'retail', 'premium', 'catalog'] as const) {
      expect(normalizeThemePreset(preset)).toBe(preset)
    }
    expect(Object.keys(THEME_PRESETS).sort()).toEqual([
      'catalog',
      'premium',
      'retail',
      'universal',
    ])
  })

  it('universal es el suelo: lo desconocido, lo ausente y lo que no es texto caen ahí', () => {
    expect(DEFAULT_THEME_PRESET).toBe('universal')
    for (const basura of ['pharmacy', 'fashion', '', null, undefined, 42, {}, [], true]) {
      expect(normalizeThemePreset(basura)).toBe('universal')
    }
  })

  /**
   * Sin normalizar mayúsculas ni espacios a propósito.
   *
   * El valor lo escribe la base contra una lista cerrada, no una persona. Si
   * llega `'Retail'` es que algo escribió fuera del contrato, y adivinar la
   * intención esconde el defecto en vez de enseñarlo.
   */
  it('no adivina: `Retail` no es `retail`', () => {
    expect(normalizeThemePreset('Retail')).toBe('universal')
    expect(normalizeThemePreset(' retail ')).toBe('universal')
  })
})

describe('los presets como datos', () => {
  it('los cuatro resuelven todas las variantes, sin huecos', () => {
    for (const [nombre, definicion] of Object.entries(THEME_PRESETS)) {
      expect(definicion.id, nombre).toBe(nombre)
      expect(definicion.headerVariant, nombre).toBeTruthy()
      expect(definicion.heroVariant, nombre).toBeTruthy()
      expect(definicion.productCardVariant, nombre).toBeTruthy()
      expect(definicion.categoryVariant, nombre).toBeTruthy()
      expect(definicion.contentWidth, nombre).toBeTruthy()
      expect(definicion.imageRatio, nombre).toBeTruthy()
      expect(definicion.sectionSpacing, nombre).toBeTruthy()
      expect(definicion.gridColumns.xs, nombre).toBeGreaterThan(0)
      expect(definicion.gridColumns.sm, nombre).toBeGreaterThan(0)
      expect(definicion.gridColumns.lg, nombre).toBeGreaterThan(0)
    }
  })

  /**
   * `universal` tiene que ser lo que la vitrina ya hacía.
   *
   * Es la mitad del contrato de compatibilidad: una tienda que nunca eligió
   * tema debe verse exactamente igual después de esta fase. Los valores de aquí
   * salen de los componentes actuales —`ProductGrid` reparte 2/3/4, la vitrina
   * va en `Container maxWidth="lg"`, `ProductMedia` viene con `1 / 1`— y
   * cambiarlos sin querer es cambiarle la tienda a todo el mundo.
   */
  it('universal reproduce el aspecto actual de la vitrina', () => {
    const universal = THEME_PRESETS.universal
    expect(universal.contentWidth).toBe('lg')
    expect(universal.imageRatio).toBe('square')
    expect(universal.productCardVariant).toBe('comfortable')
    expect(universal.gridColumns).toEqual({ xs: 2, sm: 3, lg: 4 })
  })

  it('los cuatro se distinguen entre si: un preset que no cambia nada no es un preset', () => {
    const firmas = Object.values(THEME_PRESETS).map((d) =>
      JSON.stringify({ ...d, id: null }),
    )
    expect(new Set(firmas).size).toBe(4)
  })
})

describe('el estilo de la tienda', () => {
  it('sin nada guardado, hereda del preset', () => {
    expect(normalizeStorefrontStyle(undefined, 'premium')).toEqual({
      headerVariant: THEME_PRESETS.premium.headerVariant,
      heroVariant: THEME_PRESETS.premium.heroVariant,
      productCardVariant: THEME_PRESETS.premium.productCardVariant,
      categoryVariant: THEME_PRESETS.premium.categoryVariant,
      contentWidth: THEME_PRESETS.premium.contentWidth,
      imageRatio: THEME_PRESETS.premium.imageRatio,
      sectionSpacing: THEME_PRESETS.premium.sectionSpacing,
    })
  })

  it('un override valido gana al preset; el resto sigue heredando', () => {
    const estilo = normalizeStorefrontStyle({ imageRatio: 'portrait' }, 'retail')
    expect(estilo.imageRatio).toBe('portrait')
    expect(estilo.contentWidth).toBe(THEME_PRESETS.retail.contentWidth)
  })

  it('un valor fuera de la lista cae al del preset, no rompe el objeto entero', () => {
    const estilo = normalizeStorefrontStyle(
      { imageRatio: 'cinemascope', contentWidth: 'xl' },
      'universal',
    )
    expect(estilo.imageRatio).toBe(THEME_PRESETS.universal.imageRatio)
    expect(estilo.contentWidth).toBe('xl')
  })

  /**
   * Nada de CSS, HTML, JavaScript ni URLs.
   *
   * No hace falta detectarlos ni sanearlos: la lista de claves es cerrada y la
   * de valores también, así que cualquier cosa que no esté en ellas se cae por
   * no estar. Es más seguro que cualquier filtro, porque no depende de haber
   * previsto el ataque.
   */
  it('ignora claves desconocidas, incluidas las peligrosas', () => {
    const estilo = normalizeStorefrontStyle(
      {
        css: 'body{display:none}',
        html: '<script>alert(1)</script>',
        onClick: 'alert(1)',
        backgroundUrl: 'https://evil.test/x.png',
        __proto__: { contaminado: true },
        contentWidth: 'xl',
      },
      'universal',
    )

    expect(estilo).not.toHaveProperty('css')
    expect(estilo).not.toHaveProperty('html')
    expect(estilo).not.toHaveProperty('onClick')
    expect(estilo).not.toHaveProperty('backgroundUrl')
    expect(estilo).not.toHaveProperty('contaminado')
    expect(Object.keys(estilo).sort()).toEqual([
      'categoryVariant',
      'contentWidth',
      'headerVariant',
      'heroVariant',
      'imageRatio',
      'productCardVariant',
      'sectionSpacing',
    ])
    // Y lo valido del mismo objeto se conserva: una clave sucia no invalida
    // la configuracion entera.
    expect(estilo.contentWidth).toBe('xl')
  })

  it('lo que no es un objeto cae entero al preset', () => {
    for (const basura of [null, 'texto', 42, [], true]) {
      expect(normalizeStorefrontStyle(basura, 'catalog')).toEqual(
        normalizeStorefrontStyle({}, 'catalog'),
      )
    }
  })
})

describe('el orden de la Home', () => {
  it('sin nada guardado devuelve el orden heredado', () => {
    expect(normalizeHomeLayout(undefined)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout('{}')).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('el orden por defecto es el que la vitrina ya pintaba', () => {
    expect(DEFAULT_HOME_LAYOUT.version).toBe(1)
    expect(DEFAULT_HOME_LAYOUT.sections.filter((s) => s.enabled).map((s) => s.id)).toEqual([
      'hero',
      'services',
      'offers',
      'cms',
      'promotions',
      'brands',
      'new-arrivals',
      'best-sellers',
      'trust',
    ])
  })

  it('respeta el orden guardado', () => {
    const layout = normalizeHomeLayout({
      version: 1,
      sections: [
        { id: 'brands', enabled: true },
        { id: 'hero', enabled: true },
      ],
    })
    expect(layout.sections.slice(0, 2).map((s) => s.id)).toEqual(['brands', 'hero'])
  })

  /**
   * Una sección que el editor no conocía tiene que aparecer igual.
   *
   * El layout se guarda una vez y el catálogo de secciones crece después. Si lo
   * guardado fuera la lista completa, cada sección nueva exigiría reescribir la
   * configuración de todas las tiendas, y hasta entonces sería invisible. Se
   * añaden al final con su estado por defecto: lo que el comercio ordenó se
   * respeta, y lo que no conocía no se pierde.
   */
  it('completa con las secciones que faltan, al final y con su valor por defecto', () => {
    const layout = normalizeHomeLayout({ version: 1, sections: [{ id: 'trust', enabled: true }] })
    expect(layout.sections[0]?.id).toBe('trust')
    expect(layout.sections.map((s) => s.id).sort()).toEqual([...HOME_SECTION_IDS].sort())
  })

  it('ignora los identificadores que no existen', () => {
    const layout = normalizeHomeLayout({
      version: 1,
      sections: [{ id: 'hero', enabled: true }, { id: 'banner-magico', enabled: true }],
    })
    expect(layout.sections.map((s) => s.id)).not.toContain('banner-magico')
  })

  it('un id repetido no pinta la seccion dos veces: gana la primera', () => {
    const layout = normalizeHomeLayout({
      version: 1,
      sections: [
        { id: 'hero', enabled: false },
        { id: 'hero', enabled: true },
      ],
    })
    expect(layout.sections.filter((s) => s.id === 'hero')).toHaveLength(1)
    expect(layout.sections[0]).toMatchObject({ id: 'hero', enabled: false })
  })

  it('apagar una seccion la conserva en la lista, apagada', () => {
    const layout = normalizeHomeLayout({
      version: 1,
      sections: [{ id: 'promotions', enabled: false }],
    })
    expect(layout.sections.find((s) => s.id === 'promotions')?.enabled).toBe(false)
  })

  it('`enabled` que no es booleano cae al valor por defecto de la seccion', () => {
    const layout = normalizeHomeLayout({
      version: 1,
      sections: [{ id: 'hero', enabled: 'si' }],
    })
    expect(layout.sections.find((s) => s.id === 'hero')?.enabled).toBe(true)
  })
})

describe('maxItems', () => {
  it('solo existe donde hay una coleccion que recortar', () => {
    const layout = normalizeHomeLayout({
      version: 1,
      sections: [
        { id: 'offers', enabled: true, maxItems: 6 },
        { id: 'hero', enabled: true, maxItems: 6 },
      ],
    })
    expect(layout.sections.find((s) => s.id === 'offers')?.maxItems).toBe(6)
    // El hero enseña UNA cosa: un tope ahí no significa nada.
    expect(layout.sections.find((s) => s.id === 'hero')).not.toHaveProperty('maxItems')
  })

  it('se recorta a los limites, no se rechaza la seccion entera', () => {
    const layout = normalizeHomeLayout({
      version: 1,
      sections: [
        { id: 'offers', enabled: true, maxItems: 9999 },
        { id: 'brands', enabled: true, maxItems: 0 },
      ],
    })
    expect(layout.sections.find((s) => s.id === 'offers')?.maxItems).toBe(MAX_ITEMS_LIMITS.max)
    expect(layout.sections.find((s) => s.id === 'brands')?.maxItems).toBe(MAX_ITEMS_LIMITS.min)
  })

  it('lo que no es un entero se ignora y la seccion usa su tope natural', () => {
    for (const basura of ['12', 4.5, NaN, Infinity, null, {}]) {
      const layout = normalizeHomeLayout({
        version: 1,
        sections: [{ id: 'offers', enabled: true, maxItems: basura }],
      })
      expect(layout.sections.find((s) => s.id === 'offers')).not.toHaveProperty('maxItems')
    }
  })
})
