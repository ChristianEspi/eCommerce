import { describe, expect, it } from 'vitest'
import {
  CATEGORY_VARIANTS,
  HEADER_VARIANTS,
  PRODUCT_CARD_VARIANTS,
  PRODUCT_MEDIA_FITS,
  THEME_PRESET_IDS,
} from './types'
// Los dos envoltorios de `presets`, que ya llevan el mapa de temas dentro: es
// como los consume la vitrina, y probar la versión de tres argumentos dejaría
// sin cubrir justo el punto donde se elige el preset.
import {
  THEME_PRESETS,
  normalizeStorefrontStyle,
  sanitizeStorefrontStyle,
} from './presets'
import { storefrontStyleOverridesSchema } from './schema'

/**
 * El contrato de tema V3 (Storefront V3 · P02).
 *
 * ## Qué protege este archivo
 *
 * Dos cosas distintas, y la segunda es la que da sentido a la fase.
 *
 * **Que el contrato siga siendo cerrado.** Tres valores nuevos y una clave nueva
 * son tres sitios más por donde podría entrar una cadena arbitraria a la vitrina
 * de un tenant. Lo que se comprueba es que no: lo que no está nombrado no entra,
 * ni por el saneador, ni por el esquema del formulario, ni por la lista blanca
 * de la base (esa, en `supabase/tests/storefront-theme.test.ts`).
 *
 * **Que los cuatro temas tengan personalidades REALES.** Hasta V3, Premium se
 * distinguía de Universal en las medidas: el mismo árbol con más aire y
 * proporción vertical. El pack V3 rechaza eso explícitamente como rediseño, así
 * que aquí se fija que cada preset resuelve una COMBINACIÓN única y que Premium
 * es el que estrena las tres composiciones nuevas.
 */

describe('el contrato creció donde tenía que crecer', () => {
  it('la cabecera tiene tres composiciones, con la de marca', () => {
    expect([...HEADER_VARIANTS]).toEqual(['standard', 'compact', 'brand'])
  })

  it('la tarjeta tiene tres, con la editorial', () => {
    expect([...PRODUCT_CARD_VARIANTS]).toEqual(['comfortable', 'compact', 'editorial'])
  })

  it('las familias tienen tres, con el mosaico', () => {
    expect([...CATEGORY_VARIANTS]).toEqual(['tiles', 'pills', 'mosaic'])
  })

  it('el encaje de la foto es una clave del contrato, no un valor cableado', () => {
    // Hasta V3 `ProductCard` traía `fit="contain"` escrito dentro: correcto para
    // un catálogo de referencias y equivocado para una tienda de moda, sin forma
    // de tener las dos sin un `if` por tema dentro de la tarjeta.
    expect([...PRODUCT_MEDIA_FITS]).toEqual(['cover', 'contain'])
  })

  it('los valores de V2 siguen siendo válidos: ninguna tienda deja de validar', () => {
    const deV2 = {
      headerVariant: 'standard',
      heroVariant: 'statement',
      productCardVariant: 'comfortable',
      categoryVariant: 'tiles',
      contentWidth: 'xl',
      imageRatio: 'portrait',
      sectionSpacing: 'spacious',
    }

    expect(sanitizeStorefrontStyle(deV2)).toEqual(deV2)
    expect(storefrontStyleOverridesSchema.safeParse(deV2).success).toBe(true)
  })
})

describe('lo nuevo entra por la puerta, y nada más entra', () => {
  it('el saneador acepta los valores nuevos', () => {
    const v3 = {
      headerVariant: 'brand',
      productCardVariant: 'editorial',
      categoryVariant: 'mosaic',
      productMediaFit: 'cover',
    }
    expect(sanitizeStorefrontStyle(v3)).toEqual(v3)
  })

  it('y el esquema del formulario también', () => {
    expect(
      storefrontStyleOverridesSchema.safeParse({
        headerVariant: 'brand',
        productCardVariant: 'editorial',
        categoryVariant: 'mosaic',
        productMediaFit: 'contain',
      }).success,
    ).toBe(true)
  })

  it('un encaje inventado NO llega a la vitrina como CSS', () => {
    // El fallo que esta clave podría haber introducido: `object-fit` se
    // alimenta de una variable de CSS, así que un valor libre aquí sería CSS
    // arbitrario del tenant en la hoja de la tienda.
    expect(sanitizeStorefrontStyle({ productMediaFit: 'fill' })).toEqual({})
    expect(sanitizeStorefrontStyle({ productMediaFit: 'none; background: url(x)' })).toEqual({})
    expect(
      storefrontStyleOverridesSchema.safeParse({ productMediaFit: 'scale-down' }).success,
    ).toBe(false)
  })

  it('un valor inventado en las tres listas nuevas cae al del preset', () => {
    const estilo = normalizeStorefrontStyle(
      { headerVariant: 'mega', productCardVariant: 'gigante', categoryVariant: 'carrusel' },
      'universal',
    )

    expect(estilo.headerVariant).toBe(THEME_PRESETS.universal.headerVariant)
    expect(estilo.productCardVariant).toBe(THEME_PRESETS.universal.productCardVariant)
    expect(estilo.categoryVariant).toBe(THEME_PRESETS.universal.categoryVariant)
  })

  it('el estilo normalizado trae SIEMPRE el encaje, aunque la tienda no lo diga', () => {
    // Si faltara, la tarjeta se quedaría sin `--sf-media-fit` y caería a su
    // reserva en silencio — que es justo el acoplamiento que se quitó.
    for (const preset of THEME_PRESET_IDS) {
      expect(normalizeStorefrontStyle(undefined, preset).productMediaFit).toBe(
        THEME_PRESETS[preset].productMediaFit,
      )
    }
  })

  it('sigue aceptando objetos PARCIALES: lo que no se dice se hereda', () => {
    expect(sanitizeStorefrontStyle({ productMediaFit: 'cover' })).toEqual({
      productMediaFit: 'cover',
    })
  })
})

describe('los cuatro temas tienen personalidad propia', () => {
  it('Premium estrena las tres composiciones nuevas', () => {
    // Hasta V3 declaraba `standard` / `comfortable` / `tiles`: las mismas piezas
    // que Universal con más aire. Se distinguía en las medidas, no en la forma.
    const premium = THEME_PRESETS.premium
    expect(premium.headerVariant).toBe('brand')
    expect(premium.productCardVariant).toBe('editorial')
    expect(premium.categoryVariant).toBe('mosaic')
    expect(premium.heroVariant).toBe('statement')
  })

  it('Premium es el único con `cover`, y por eso existe la clave', () => {
    // Es el tema que se elige cuando la fotografía ES el argumento de venta.
    // En los demás, recortar se come lo que identifica la referencia.
    expect(THEME_PRESETS.premium.productMediaFit).toBe('cover')
    expect(THEME_PRESETS.universal.productMediaFit).toBe('contain')
    expect(THEME_PRESETS.retail.productMediaFit).toBe('contain')
    expect(THEME_PRESETS.catalog.productMediaFit).toBe('contain')
  })

  it('Universal conserva EXACTAMENTE lo que veía antes de V3', () => {
    // La compatibilidad que el propio prompt de la fase exige: quien nunca
    // eligió tema no puede cambiar de aspecto por un despliegue. Y `contain` es
    // lo que la tarjeta aplicaba cableado a todas las tiendas.
    expect(THEME_PRESETS.universal).toMatchObject({
      headerVariant: 'standard',
      heroVariant: 'product',
      productCardVariant: 'comfortable',
      categoryVariant: 'tiles',
      contentWidth: 'lg',
      imageRatio: 'square',
      sectionSpacing: 'comfortable',
      productMediaFit: 'contain',
    })
  })

  it('Catalog sigue siendo el productivo y Retail el denso', () => {
    expect(THEME_PRESETS.catalog).toMatchObject({
      headerVariant: 'compact',
      categoryVariant: 'pills',
      contentWidth: 'xl',
    })
    expect(THEME_PRESETS.catalog.gridColumns.lg).toBe(6)
    expect(THEME_PRESETS.retail.gridColumns.lg).toBe(5)
  })

  it('ninguna combinación se repite: cuatro temas, cuatro personalidades', () => {
    // Cuatro presets que resolvieran lo mismo serían cuatro nombres.
    const huellas = THEME_PRESET_IDS.map((id) => {
      const d = THEME_PRESETS[id]
      return [
        d.headerVariant,
        d.heroVariant,
        d.productCardVariant,
        d.categoryVariant,
        d.contentWidth,
        d.imageRatio,
        d.sectionSpacing,
        d.productMediaFit,
        d.gridColumns.lg,
      ].join('|')
    })

    expect(new Set(huellas).size).toBe(THEME_PRESET_IDS.length)
  })

  it('cada composición nueva la usa al menos un preset', () => {
    // Un contrato con opciones que ningún tema usa es un contrato que declara
    // trabajo que nadie hizo.
    const usados = THEME_PRESET_IDS.map((id) => THEME_PRESETS[id])
    expect(usados.some((d) => d.headerVariant === 'brand')).toBe(true)
    expect(usados.some((d) => d.productCardVariant === 'editorial')).toBe(true)
    expect(usados.some((d) => d.categoryVariant === 'mosaic')).toBe(true)
    expect(usados.some((d) => d.productMediaFit === 'cover')).toBe(true)
    expect(usados.some((d) => d.productMediaFit === 'contain')).toBe(true)
  })
})
