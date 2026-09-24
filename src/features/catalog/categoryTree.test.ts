import { describe, expect, it } from 'vitest'
import { categoryDescendants, categoryTree, type Category } from './types'

/**
 * El árbol de categorías en el CLIENTE.
 *
 * La jerarquía la guarda y la vigila la base; el orden de lectura y la sangría
 * son presentación, y se arman aquí sobre la lista que el backoffice ya tiene
 * cargada — decenas de filas, una pasada sobre un array, ninguna consulta más.
 *
 * Lo que se prueba es lo que se ve: que cada madre venga seguida de SU
 * descendencia, que la ruta diga dónde está cada una, y que el desplegable de
 * madre no ofrezca lo que la base va a rechazar.
 */

function cat(name: string, parent: string | null = null, position = 0): Category {
  return {
    id: name,
    store_id: 'store',
    parent_id: parent,
    slug: name,
    name,
    position,
    is_active: true,
    // La foto no entra en el árbol: la jerarquía y la sangría no dependen de
    // ella, y una categoría sin foto es el caso normal (Storefront V2 · P03).
    image_url: null,
    image_alt: null,
  }
}

describe('categoryTree', () => {
  it('devuelve cada madre seguida de su descendencia, no la lista de golpe', () => {
    const nodes = categoryTree([
      cat('nervioso', 'salud'),
      cat('salud'),
      cat('analgesicos', 'nervioso'),
      cat('piel', 'cuidado'),
      cat('cuidado'),
    ])

    expect(nodes.map((node) => node.category.name)).toEqual([
      'cuidado',
      'piel',
      'salud',
      'nervioso',
      'analgesicos',
    ])
  })

  it('la profundidad y la ruta salen del árbol, no del nombre', () => {
    const nodes = categoryTree([cat('salud'), cat('nervioso', 'salud'), cat('ibu', 'nervioso')])

    expect(nodes.map((node) => [node.category.name, node.depth, node.path])).toEqual([
      ['salud', 0, 'salud'],
      ['nervioso', 1, 'salud › nervioso'],
      ['ibu', 2, 'salud › nervioso › ibu'],
    ])
  })

  it('ordena entre HERMANAS por posición, no en toda la tienda', () => {
    const nodes = categoryTree([
      cat('b', null, 2),
      cat('a', null, 1),
      cat('b2', 'b', 1),
      cat('a2', 'a', 9),
    ])

    expect(nodes.map((node) => node.category.name)).toEqual(['a', 'a2', 'b', 'b2'])
  })

  /**
   * Una hija cuyo padre no está en la lista —lo esconde un filtro, o se acaba
   * de borrar— se trata como raíz. Dejarla fuera seria la clase de dato que
   * existe y nadie vuelve a encontrar.
   */
  it('una huérfana se enseña como raíz en vez de desaparecer', () => {
    const nodes = categoryTree([cat('huerfana', 'madre-que-no-esta')])

    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.depth).toBe(0)
  })
})

describe('categoryDescendants', () => {
  it('bloquea la propia categoría y todo lo que cuelga de ella', () => {
    const arbol = [cat('salud'), cat('nervioso', 'salud'), cat('ibu', 'nervioso'), cat('otra')]

    const blocked = categoryDescendants(arbol, 'salud')

    // Ofrecer «nervioso» como madre de «salud» seria ofrecer un ciclo: la base
    // lo rechaza con `CATEGORIA_CICLO`, y un desplegable que ofrece lo que va a
    // fallar es un desplegable que miente.
    expect([...blocked].sort()).toEqual(['ibu', 'nervioso', 'salud'])
    expect(blocked.has('otra')).toBe(false)
  })
})
