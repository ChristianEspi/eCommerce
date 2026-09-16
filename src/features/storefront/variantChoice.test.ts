import { describe, expect, it } from 'vitest'
import { publicVariantSchema, type PublicVariant } from './types'
import {
  chooseValue,
  selectionOf,
  shortVariantLabel,
  valueState,
  variantAxes,
} from './variantChoice'

const PRODUCTO = '00000000-0000-4000-8000-000000000001'
const TIENDA = '00000000-0000-4000-8000-000000000002'

let secuencia = 0

/** Una variante con sus ejes: `v('Rojo', 'M')` → color=rojo, talla=m. */
function v(
  color: string | null,
  talla: string | null,
  extra: Partial<Pick<PublicVariant, 'in_stock' | 'is_default' | 'price'>> = {},
): PublicVariant {
  secuencia += 1
  const options = [
    ...(color
      ? [{ code: 'color', name: 'Color', position: 1, value_code: color.toLowerCase(), label: color, value_position: 0 }]
      : []),
    ...(talla
      ? [{ code: 'talla', name: 'Talla', position: 2, value_code: talla.toLowerCase(), label: talla, value_position: 0 }]
      : []),
  ]
  return publicVariantSchema.parse({
    variant_id: `00000000-0000-4000-8000-${String(secuencia).padStart(12, '0')}`,
    product_id: PRODUCTO,
    store_id: TIENDA,
    name: [color, talla].filter(Boolean).join(' · ') || `Variante ${secuencia}`,
    position: secuencia,
    is_default: extra.is_default ?? false,
    in_stock: extra.in_stock ?? true,
    price: extra.price ?? '60.00',
    compare_at_price: null,
    currency: 'PEN',
    options,
  })
}

describe('los ejes del producto', () => {
  it('agrupa por eje, en el orden declarado, y los valores en el de las variantes', () => {
    const variantes = [v('Rojo', 'S'), v('Rojo', 'M'), v('Azul', 'S'), v('Azul', 'M')]
    const ejes = variantAxes(variantes)
    expect(ejes?.map((eje) => `${eje.name}: ${eje.values.map((x) => x.label).join(' ')}`)).toEqual([
      'Color: Rojo Azul',
      'Talla: S M',
    ])
  })

  it('una respuesta anterior a la migración (sin `options`) se lee como variantes sin ejes', () => {
    const vieja = publicVariantSchema.parse({
      variant_id: '00000000-0000-4000-8000-0000000000aa',
      product_id: PRODUCTO,
      store_id: TIENDA,
      name: 'Roja',
      position: 0,
      is_default: true,
      in_stock: true,
      price: '60.00',
      compare_at_price: null,
      currency: 'PEN',
    })
    expect(vieja.options).toEqual([])
    expect(variantAxes([vieja])).toBeNull()
  })

  it('sin ejes, o con una variante a la que le falta uno, NO hay selector por eje', () => {
    expect(variantAxes([v(null, null), v(null, null)])).toBeNull()
    // La variante sin talla no se alcanzaría pulsando tallas.
    expect(variantAxes([v('Rojo', 'M'), v('Azul', null)])).toBeNull()
  })

  it('dos variantes con la misma combinación tampoco: pulsar «M» no diría cuál', () => {
    expect(variantAxes([v('Rojo', 'M'), v('Rojo', 'M')])).toBeNull()
  })
})

describe('qué se tacha y qué se puede pulsar', () => {
  const rojoS = v('Rojo', 'S')
  const rojoM = v('Rojo', 'M', { in_stock: false })
  const azulS = v('Azul', 'S')
  const azulM = v('Azul', 'M')
  const variantes = [rojoS, rojoM, azulS, azulM]

  it('con stock en la combinación, disponible', () => {
    expect(valueState(variantes, rojoS, 'talla', 's')).toBe('available')
    expect(valueState(variantes, rojoS, 'color', 'azul')).toBe('available')
  })

  it('agotado solo con lo elegido: se avisa, pero se puede pulsar', () => {
    // Rojo·M está agotado, Azul·M no: «M» se vende, solo que no en rojo.
    expect(valueState(variantes, rojoS, 'talla', 'm')).toBe('elsewhere')
  })

  it('sin stock en ninguna combinación: no se puede pulsar', () => {
    const soloTalla = [v(null, '37'), v(null, '38', { in_stock: false })]
    expect(valueState(soloTalla, soloTalla[0] ?? null, 'talla', '38')).toBe('soldOut')
  })
})

describe('a qué variante se salta al pulsar', () => {
  it('a la combinación exacta, conservando el otro eje', () => {
    const rojoS = v('Rojo', 'S')
    const rojoM = v('Rojo', 'M')
    const azulS = v('Azul', 'S')
    expect(chooseValue([rojoS, rojoM, azulS], rojoS, 'talla', 'm')).toBe(rojoM)
    expect(chooseValue([rojoS, rojoM, azulS], rojoS, 'color', 'azul')).toBe(azulS)
  })

  it('a la exacta AUNQUE esté agotada: no se cambia la talla a espaldas del comprador', () => {
    const rojoS = v('Rojo', 'S')
    const rojoM = v('Rojo', 'M', { in_stock: false })
    const azulM = v('Azul', 'M')
    expect(chooseValue([rojoS, rojoM, azulM], rojoS, 'talla', 'm')).toBe(rojoM)
  })

  it('si la combinación no existe, a la que más conserva, con stock primero', () => {
    // Verde solo viene en L. Desde Rojo·M, pulsar Verde tiene que mover la talla.
    const rojoM = v('Rojo', 'M')
    const verdeL = v('Verde', 'L')
    const verdeXl = v('Verde', 'XL', { in_stock: false })
    expect(chooseValue([rojoM, verdeXl, verdeL], rojoM, 'color', 'verde')).toBe(verdeL)
  })

  it('la selección se lee por código, no por etiqueta', () => {
    expect(selectionOf(v('Rojo', 'M'))).toEqual({ color: 'rojo', talla: 'm' })
  })
})

describe('el nombre corto de la variante', () => {
  it('quita el nombre del producto que los catálogos importados repiten delante', () => {
    expect(
      shortVariantLabel('Botín Alameda de cuero, Verde oliva · 37', 'Botín Alameda de cuero, Verde oliva'),
    ).toBe('37')
    expect(shortVariantLabel('Camiseta - Roja', 'camiseta')).toBe('Roja')
  })

  it('si no empieza por el producto, o no queda nada, lo deja entero', () => {
    expect(shortVariantLabel('Roja', 'Camiseta')).toBe('Roja')
    expect(shortVariantLabel('Camiseta', 'Camiseta')).toBe('Camiseta')
  })
})
