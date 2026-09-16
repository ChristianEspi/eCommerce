import type { PublicVariant } from './types'

/**
 * Elegir una variante por sus ejes: «Color: Rojo Azul» · «Talla: S M L».
 *
 * Reglas PURAS, sin React: son las que deciden qué botón queda marcado, cuál se
 * tacha y a qué variante se salta al pulsar uno. El precio y la existencia NO se
 * deciden aquí: vienen ya resueltos de la vista pública, y la base los vuelve a
 * comprobar al crear el pedido.
 */

export interface AxisValue {
  readonly code: string
  readonly label: string
  readonly position: number
}

export interface VariantAxis {
  readonly code: string
  readonly name: string
  readonly position: number
  readonly values: readonly AxisValue[]
}

/** Eje → valor elegido, por CÓDIGO. */
export type Selection = Readonly<Record<string, string>>

export function selectionOf(variant: PublicVariant): Selection {
  return Object.fromEntries(variant.options.map((option) => [option.code, option.value_code]))
}

function sameSelection(a: Selection, b: Selection): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

const disponible = (variant: PublicVariant) => variant.in_stock !== false

/**
 * Los ejes del producto, en orden, o `null` si con ellos NO se puede elegir.
 *
 * `null` no es un error: es la señal para caer a elegir por nombre. Pasa cuando
 * ninguna variante declara ejes, cuando alguna no tiene valor en todos (una
 * variante sin talla no se alcanza pulsando tallas) o cuando dos comparten la
 * misma combinación (pulsar «M» no diría cuál de las dos). En cualquiera de los
 * tres casos, un selector por eje escondería variantes que sí se venden.
 */
export function variantAxes(variants: readonly PublicVariant[]): VariantAxis[] | null {
  if (variants.length === 0) return null

  const ejes = new Map<string, { code: string; name: string; position: number; values: AxisValue[] }>()
  for (const variant of variants) {
    for (const option of variant.options) {
      let eje = ejes.get(option.code)
      if (!eje) {
        eje = { code: option.code, name: option.name, position: option.position, values: [] }
        ejes.set(option.code, eje)
      }
      if (!eje.values.some((value) => value.code === option.value_code)) {
        eje.values.push({ code: option.value_code, label: option.label, position: option.value_position })
      }
    }
  }
  if (ejes.size === 0) return null

  const codigos = [...ejes.keys()]
  const combinaciones = new Set<string>()
  for (const variant of variants) {
    const propia = selectionOf(variant)
    if (variant.options.length !== codigos.length) return null
    if (codigos.some((codigo) => propia[codigo] === undefined)) return null
    const clave = codigos.map((codigo) => `${codigo}=${propia[codigo]}`).join('|')
    if (combinaciones.has(clave)) return null
    combinaciones.add(clave)
  }

  // `sort` es estable: a igual posición declarada, los valores quedan en el orden
  // en que aparecen recorriendo las variantes, que ya llegan por su posición.
  // Es lo que deja «XS S M L XL» bien aunque nadie haya numerado las tallas.
  return [...ejes.values()]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((eje) => ({ ...eje, values: [...eje.values].sort((a, b) => a.position - b.position) }))
}

/**
 * Cómo se pinta un valor respecto de lo que ya está elegido.
 *
 *  · `available` — con el resto de la selección, hay variante y tiene stock.
 *  · `elsewhere` — este valor se vende, pero no combinado con lo elegido
 *    (agotado o inexistente). Se puede pulsar: moverá la selección.
 *  · `soldOut`   — ninguna variante con este valor tiene stock. No se pulsa.
 */
export type ValueState = 'available' | 'elsewhere' | 'soldOut'

export function valueState(
  variants: readonly PublicVariant[],
  current: PublicVariant | null,
  axisCode: string,
  valueCode: string,
): ValueState {
  const conValor = variants.filter((variant) => selectionOf(variant)[axisCode] === valueCode)
  if (!conValor.some(disponible)) return 'soldOut'
  if (!current) return 'available'

  const deseada = { ...selectionOf(current), [axisCode]: valueCode }
  const exacta = conValor.find((variant) => sameSelection(selectionOf(variant), deseada))
  return exacta && disponible(exacta) ? 'available' : 'elsewhere'
}

/**
 * La variante que queda al pulsar `valueCode` en el eje `axisCode`.
 *
 * Si la combinación exacta existe, es ESA aunque esté agotada: lo que el
 * comprador pulsó no se cambia a sus espaldas, y el botón de compra ya se
 * deshabilita solo. Solo cuando la combinación no existe hay que mover otro eje,
 * y entonces se busca la que más conserva de lo elegido, con stock primero.
 */
export function chooseValue(
  variants: readonly PublicVariant[],
  current: PublicVariant | null,
  axisCode: string,
  valueCode: string,
): PublicVariant | null {
  const conValor = variants.filter((variant) => selectionOf(variant)[axisCode] === valueCode)
  if (conValor.length === 0) return null

  const deseada: Selection = { ...(current ? selectionOf(current) : {}), [axisCode]: valueCode }
  const exacta = conValor.find((variant) => sameSelection(selectionOf(variant), deseada))
  if (exacta) return exacta

  const coincidencias = (variant: PublicVariant) => {
    const propia = selectionOf(variant)
    return Object.entries(deseada).filter(([codigo, valor]) => propia[codigo] === valor).length
  }
  return (
    [...conValor].sort(
      (a, b) =>
        Number(disponible(b)) - Number(disponible(a)) ||
        coincidencias(b) - coincidencias(a) ||
        Number(b.is_default) - Number(a.is_default) ||
        a.position - b.position,
    )[0] ?? null
  )
}

/**
 * El nombre de la variante sin el del producto delante.
 *
 * Los catálogos importados nombran la variante repitiendo el producto
 * («Botín Alameda de cuero, Verde oliva · 37»), y en un botón al lado del
 * título eso es ruido: se enseña «37». Si al quitarlo no queda nada, o el
 * nombre no empieza por el del producto, se deja entero.
 */
export function shortVariantLabel(variantName: string, productName: string): string {
  const nombre = variantName.trim()
  const producto = productName.trim()
  if (producto && nombre.toLocaleLowerCase().startsWith(producto.toLocaleLowerCase())) {
    const resto = nombre
      .slice(producto.length)
      .replace(/^[\s·•\-–—,:|/]+/u, '')
      .trim()
    if (resto) return resto
  }
  return nombre
}
