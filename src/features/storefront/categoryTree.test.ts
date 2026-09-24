import { describe, expect, it } from 'vitest'
import { categoryBarItems, categoryTrail, rollUpCategoryCounts } from './categoryTree'
import type { PublicCategory } from './types'

/**
 * El árbol de categorías en la vitrina.
 *
 * El servidor ya devuelve los productos de una categoría y de su descendencia.
 * Lo que se prueba aquí es lo que el comprador ve: que la cifra de una madre
 * sume lo de sus hijas —si no, «Nutrición» sale con un cero al lado teniendo 81
 * productos debajo, y un cero es una puerta que nadie abre—, por dónde ha
 * llegado, y qué se le ofrece a continuación.
 */

function cat(slug: string, parent: string | null = null): PublicCategory {
  return {
    category_id: slug,
    store_id: 'store',
    parent_id: parent,
    slug,
    name: slug,
    position: 0,
    // La foto no entra en el árbol ni en los contadores: una categoría sin foto
    // es el caso normal (Storefront V2 · P03).
    image_url: null,
    image_alt: null,
  }
}

const ARBOL = [
  cat('nutricion'),
  cat('leches', 'nutricion'),
  cat('vitaminas', 'nutricion'),
  cat('cuidado'),
  cat('piel', 'cuidado'),
]

describe('rollUpCategoryCounts', () => {
  it('la madre suma lo suyo y lo de sus hijas', () => {
    const totals = rollUpCategoryCounts(
      ARBOL,
      new Map([
        ['leches', 74],
        ['vitaminas', 7],
        ['piel', 93],
      ]),
    )

    // «Nutricion» no tiene productos PROPIOS y aun asi es la puerta de 81.
    expect(totals.get('nutricion')).toBe(81)
    expect(totals.get('cuidado')).toBe(93)
    expect(totals.get('leches')).toBe(74)
  })

  /**
   * `null` es «no se sabe» y no «cero»: la vitrina lo usa cuando hay un filtro
   * puesto y el resto de cifras dejan de ser de fiar. Si no se sabe lo de una
   * hija, tampoco se sabe lo de la madre — inventar una suma parcial seria
   * peor que no dar cifra.
   */
  it('el «no se sabe» de una hija sube a la madre', () => {
    const totals = rollUpCategoryCounts(
      ARBOL,
      new Map<string, number | null>([
        ['leches', null],
        ['vitaminas', 7],
      ]),
    )

    expect(totals.get('nutricion')).toBeNull()
  })

  it('sin jerarquía cada una vale lo suyo: el árbol no es obligatorio', () => {
    const planas = [cat('a'), cat('b')]
    const totals = rollUpCategoryCounts(planas, new Map([['a', 3], ['b', 5]]))

    expect(totals.get('a')).toBe(3)
    expect(totals.get('b')).toBe(5)
  })
})

describe('categoryTrail', () => {
  it('devuelve el camino de la raíz a la categoría abierta', () => {
    expect(categoryTrail(ARBOL, 'leches').map((c) => c.slug)).toEqual(['nutricion', 'leches'])
  })

  it('una raíz es su propio camino, y sin categoría no hay camino', () => {
    expect(categoryTrail(ARBOL, 'cuidado').map((c) => c.slug)).toEqual(['cuidado'])
    expect(categoryTrail(ARBOL, null)).toEqual([])
  })
})

describe('categoryBarItems', () => {
  it('en la portada enseña las RAÍCES: son las puertas', () => {
    expect(categoryBarItems(ARBOL, null).map((c) => c.slug)).toEqual(['nutricion', 'cuidado'])
  })

  it('dentro de una madre enseña sus hijas, que es el paso siguiente', () => {
    expect(categoryBarItems(ARBOL, 'nutricion').map((c) => c.slug)).toEqual(['leches', 'vitaminas'])
  })

  /**
   * En una hoja se ofrecen las HERMANAS: cuando alguien entra en «Leches» y no
   * era lo que buscaba, lo que quiere es saltar de lado, no volver atras.
   */
  it('en una hoja enseña sus hermanas', () => {
    expect(categoryBarItems(ARBOL, 'leches').map((c) => c.slug)).toEqual(['leches', 'vitaminas'])
  })
})
