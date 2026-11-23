import { describe, expect, it } from 'vitest'
import { analizarCatalogo, claveSinContenido, contenidoEnNombre, problemaDeNombre, type CleanupRow } from './cleanup'

let n = 0
const fila = (name: string, extra: Partial<CleanupRow> = {}): CleanupRow => ({
  product_id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  sku: `SKU-${n}`,
  name,
  brand_name: 'Marca',
  kind: 'simple',
  status: 'published',
  has_image: true,
  has_description: true,
  has_category: true,
  ...extra,
})

describe('limpieza del catálogo', () => {
  it('contenido y clave: los mg son dosis, no tamaño', () => {
    expect(contenidoEnNombre('Lejía Tradicional 5 L')).toBe('5 l')
    expect(contenidoEnNombre('Amoxil 500 mg Caja x 30')).toBe('x 30')
    expect(contenidoEnNombre('Consiv 18 mg')).toBeNull()
    expect(claveSinContenido('Lejía Tradicional 1 L')).toBe(claveSinContenido('Lejía Tradicional Caja x 5 L'))
    expect(claveSinContenido('Amoxil 250 mg Caja x 30')).not.toBe(claveSinContenido('Amoxil 500 mg Caja x 30'))
  })

  it('nombres raros: mayúsculas, espacios, tramos repetidos', () => {
    expect(problemaDeNombre('LEJIA TRADICIONAL')).toBe('mayusculas')
    expect(problemaDeNombre('Lejía  Tradicional')).toBe('espacios')
    expect(problemaDeNombre('Pedialyte 500 ml · Pedialyte 500 ml · Uva')).toBe('repetido')
    expect(problemaDeNombre('Pedialyte 500 ml · Uva')).toBeNull()
    expect(problemaDeNombre('IBM')).toBeNull()
  })

  it('duplicados, tamaños sueltos y huecos', () => {
    const filas = [
      fila('Jabón Líquido'),
      fila('jabon liquido'),
      fila('Jabón Líquido', { brand_name: 'Otra' }),
      fila('Lejía 1 L'),
      fila('Lejía 5 L', { has_image: false }),
      fila('Lejía 5 L', { kind: 'variant' }),
      fila('Amoxil 250 mg Caja x 30', { has_description: false }),
      fila('Amoxil 500 mg Caja x 30', { has_category: false }),
    ]
    const h = analizarCatalogo(filas)
    expect(h.duplicados.map((g) => g.productos.length)).toEqual([2, 2])
    // Las dos «Lejía 5 L» son duplicado; queda «1 L» sola: sin grupo de tamaños.
    expect(h.tamanos).toEqual([])
    const sinDuplicados = analizarCatalogo([fila('Lejía 1 L'), fila('Lejía 5 L'), fila('Lejía 5 L', { brand_name: 'Otra' })])
    expect(sinDuplicados.tamanos.map((g) => g.productos.map((p) => p.name))).toEqual([['Lejía 1 L', 'Lejía 5 L']])
    expect(h.sinFoto.map((p) => p.name)).toEqual(['Lejía 5 L'])
    expect(h.sinDescripcion.map((p) => p.name)).toEqual(['Amoxil 250 mg Caja x 30'])
    expect(h.sinCategoria.map((p) => p.name)).toEqual(['Amoxil 500 mg Caja x 30'])
  })
})
