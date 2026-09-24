import { describe, expect, it } from 'vitest'
import {
  BRAND_PRESENTATIONS,
  CATEGORY_PRESENTATIONS,
  OFFER_PRESENTATIONS,
  PRODUCT_PRESENTATIONS,
  SECTION_PRESENTATION_RULES,
  resolveSectionPresentation,
  sanitizeSectionPresentation,
} from './presentation'
import { HOME_SECTION_IDS, THEME_PRESET_IDS } from './types'
import { THEME_PRESETS } from './presets'

/**
 * La presentación de cada sección de la portada (Storefront V3 · P06).
 *
 * ## Qué protege este archivo
 *
 * **Que siga siendo un contrato y no un maquetador.** Cada campo es una lista
 * cerrada, y las listas dependen de la SECCIÓN: `spotlight` significa algo en
 * una fila de producto y nada en el hero. Ese rechazo no es por seguridad, es
 * por significado — y es lo que evita que la portada declare ritmos que nadie
 * sabe pintar.
 *
 * **Que ninguna tienda cambie de portada al aplicar V3.** Todas tienen guardado
 * exactamente esto: nada. Así que `auto` de Universal tiene que resolver lo que
 * la portada pintaba ayer, y hay una prueba dedicada a eso.
 *
 * **Que `auto` no mire el rubro.** Resuelve por TEMA: si una farmacia elige
 * Premium, su portada será editorial, y estará bien porque lo eligió.
 */

const resolver = (
  id: (typeof HOME_SECTION_IDS)[number],
  preset: (typeof THEME_PRESET_IDS)[number] = 'universal',
  presentation?: Record<string, unknown>,
) =>
  resolveSectionPresentation({
    id,
    presentation,
    preset,
    categoryVariant: THEME_PRESETS[preset].categoryVariant,
    productCardVariant: THEME_PRESETS[preset].productCardVariant,
  })

describe('lo guardado manda, y lo que no encaja se descarta', () => {
  it('una presentación válida se respeta entera', () => {
    expect(
      resolver('featured', 'universal', { variant: 'grid', surface: 'soft', width: 'bleed' }),
    ).toEqual({ variant: 'grid', surface: 'soft', width: 'bleed' })
  })

  it('lo que falta lo pone el tema, no un hueco', () => {
    // Quien pinta recibe una decisión tomada: nunca `auto`, nunca `undefined`.
    const resuelta = resolver('featured', 'universal', { surface: 'soft' })

    expect(resuelta.surface).toBe('soft')
    expect(resuelta.variant).not.toBe('auto')
    expect(resuelta.width).toBe('contained')
  })

  it('una variante de otra familia de sección se descarta', () => {
    // `logos` es de marcas. En una fila de producto no es peligroso: no
    // significa nada, y aceptarlo sería prometer un ritmo que nadie pinta.
    expect(resolver('featured', 'universal', { variant: 'logos' }).variant).not.toBe('logos')
  })

  it('el hero y el CMS no eligen variante: ya la traen', () => {
    // El hero la tiene en el contrato del tema y el CMS en el bloque publicado.
    // Ofrecer otra aquí sería una segunda fuente de verdad para el mismo píxel.
    expect(SECTION_PRESENTATION_RULES.hero.variants).toHaveLength(0)
    expect(SECTION_PRESENTATION_RULES.cms.variants).toHaveLength(0)
    expect(resolver('hero', 'universal', { variant: 'spotlight' }).variant).toBe('fixed')
  })

  it('las familias y las marcas no admiten superficie de contraste', () => {
    // El peso del fondo se come las fotos que la sección existe para enseñar.
    expect(resolver('categories', 'universal', { surface: 'contrast' }).surface).toBe('plain')
    expect(resolver('brands', 'universal', { surface: 'contrast' }).surface).toBe('plain')
    // Donde sí tiene sentido, se respeta.
    expect(resolver('offers', 'universal', { surface: 'contrast' }).surface).toBe('contrast')
  })

  it('ni CSS, ni URL, ni columnas: no están nombradas', () => {
    const resuelta = resolver('offers', 'universal', {
      css: '.x{display:none}',
      backgroundUrl: 'https://evil.test/x.png',
      columns: 11,
      variant: 'split',
    })

    expect(resuelta).toEqual({ variant: 'split', surface: 'plain', width: 'contained' })
  })
})

describe('`auto` resuelve por tema, nunca por rubro', () => {
  it('Universal resuelve EXACTAMENTE lo que la portada hacía antes de V3', () => {
    // La prueba de compatibilidad de la fase: todas las tiendas existentes
    // tienen `auto` en todo, así que si esto cambiara, cambiaría su portada.
    expect(resolver('featured', 'universal').variant).toBe('rail')
    expect(resolver('brands', 'universal').variant).toBe('cards')
    expect(resolver('offers', 'universal').variant).toBe('band')
    for (const id of HOME_SECTION_IDS) {
      const resuelta = resolver(id, 'universal')
      expect(resuelta.surface).toBe('plain')
      expect(resuelta.width).toBe('contained')
    }
  })

  it('Premium estrena ritmo editorial', () => {
    expect(resolver('featured', 'premium').variant).toBe('spotlight')
    // Y su banda de ofertas llega a sangre, que es lo que rompe la lista de
    // bandas iguales.
    expect(resolver('offers', 'premium').width).toBe('bleed')
  })

  it('Retail favorece descubrimiento y Catalog productividad', () => {
    expect(resolver('featured', 'retail').variant).toBe('grid')
    expect(resolver('featured', 'catalog').variant).toBe('rail')
    // Catalog NO saca nada a sangre: la primera pantalla tiene que ser catálogo.
    expect(resolver('offers', 'catalog').width).toBe('contained')
  })

  it('las familias siguen al contrato del tema', () => {
    // Una segunda tabla que dijera cómo se enseñan las familias por tema serían
    // dos fuentes de verdad para el mismo píxel.
    for (const preset of THEME_PRESET_IDS) {
      expect(resolver('categories', preset).variant).toBe(THEME_PRESETS[preset].categoryVariant)
    }
  })

  it('`spotlight` no se combina con tarjetas densas', () => {
    // Una pieza grande pintada con la tarjeta de un catálogo es una
    // contradicción. Es la única vez que una clave del tema corrige a otra, y
    // está escrito donde ocurre.
    const resuelta = resolveSectionPresentation({
      id: 'featured',
      presentation: undefined,
      preset: 'premium',
      categoryVariant: 'mosaic',
      productCardVariant: 'compact',
    })
    expect(resuelta.variant).toBe('rail')
  })

  it('ningún tema resuelve una variante que nadie pinta todavía', () => {
    /**
     * La regla que evita repetir el fallo de `heroVariant` en V2: estuvo tres
     * fases declarado y sin consumidor.
     *
     * El muro de logotipos y la banda partida son de P07. Hasta entonces `auto`
     * no puede resolverlos, aunque la lista cerrada ya los acepte — un contrato
     * que dice que algo cambia y no cambia nada es peor que no tenerlo.
     */
    const pintadas = ['rail', 'grid', 'spotlight', 'cards', 'band', 'tiles', 'pills', 'mosaic']
    for (const preset of THEME_PRESET_IDS) {
      for (const id of HOME_SECTION_IDS) {
        const { variant } = resolver(id, preset)
        if (variant === 'fixed') continue
        expect(pintadas).toContain(variant)
      }
    }
  })
})

describe('el saneador guarda lo mínimo', () => {
  it('no guarda los valores por defecto: la ausencia ya significa auto', () => {
    // Guardar `{variant:'auto', surface:'plain', width:'contained'}` congelaría
    // esa sección en el ritmo de hoy, igual que guardar el estilo completo
    // congelaba el tema.
    expect(
      sanitizeSectionPresentation('featured', {
        variant: 'auto',
        surface: 'plain',
        width: 'contained',
      }),
    ).toBeUndefined()
  })

  it('guarda solo lo que se apartó del defecto', () => {
    expect(
      sanitizeSectionPresentation('featured', { variant: 'grid', surface: 'plain' }),
    ).toEqual({ variant: 'grid' })
  })

  it('descarta lo que no encaja con la sección', () => {
    expect(sanitizeSectionPresentation('hero', { variant: 'spotlight' })).toBeUndefined()
    expect(sanitizeSectionPresentation('categories', { surface: 'contrast' })).toBeUndefined()
  })

  it('lo que no es un objeto no es una presentación', () => {
    expect(sanitizeSectionPresentation('featured', 'rail')).toBeUndefined()
    expect(sanitizeSectionPresentation('featured', null)).toBeUndefined()
    expect(sanitizeSectionPresentation('featured', ['rail'])).toBeUndefined()
  })
})

describe('las listas cerradas', () => {
  it('las cuatro familias empiezan por `auto`', () => {
    // `auto` es el primero porque es el defecto, y el defecto es lo que tiene
    // guardado toda tienda que existe hoy.
    for (const lista of [
      PRODUCT_PRESENTATIONS,
      CATEGORY_PRESENTATIONS,
      BRAND_PRESENTATIONS,
      OFFER_PRESENTATIONS,
    ]) {
      expect(lista[0]).toBe('auto')
    }
  })

  it('las trece secciones tienen su regla declarada', () => {
    // Si una sección nueva no entrara aquí, su presentación se resolvería con
    // `undefined` y la portada fallaría al pintarla.
    for (const id of HOME_SECTION_IDS) {
      expect(SECTION_PRESENTATION_RULES[id]).toBeDefined()
      expect(SECTION_PRESENTATION_RULES[id].surfaces.length).toBeGreaterThan(0)
    }
  })

  it('ninguna sección nombra un rubro', () => {
    const texto = JSON.stringify(SECTION_PRESENTATION_RULES).toLowerCase()
    for (const rubro of ['farmac', 'botica', 'calzado', 'moda', 'ferreter']) {
      expect(texto).not.toContain(rubro)
    }
  })
})
