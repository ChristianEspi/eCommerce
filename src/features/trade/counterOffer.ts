/**
 * Contrapropuesta a «Mejora esta cotización» (2026-11-22).
 *
 * El comprador subió la cotización de otro proveedor; la IA la LEYÓ en la
 * vitrina y «Pedir mejor precio» dejó en la nota de la solicitud, línea a línea,
 * el precio que le ofrecen. Aquí el SISTEMA propone el precio de respuesta con
 * una regla que el vendedor ve y controla: igualar a la competencia sin bajar
 * más de su descuento máximo. No hay coste en la base, así que el tope es ese
 * descuento sobre el precio cotizado, no un margen inventado.
 *
 * Nada se guarda solo: el vendedor revisa la tabla y pulsa «Aplicar».
 */

export interface PrecioCompetencia {
  readonly texto: string
  readonly cantidad: number
  readonly moneda: string
  readonly precio: number
}

/** «- Consiv 18 mg × 4: PEN 12.50» — el formato de `improvementNote` en la vitrina. */
const LINEA = /^-\s+(.+?)\s+×\s+(\d+(?:\.\d+)?):\s+([A-Z]{3})\s+(\d+(?:\.\d+)?)\s*$/

/** Las líneas de competencia de la nota, en orden; null si la nota no es de «Mejora esta cotización». */
export function leerNotaCompetencia(notas: string | null | undefined): PrecioCompetencia[] | null {
  if (!notas) return null
  const lineas = notas.split(/\r?\n/).flatMap((l): PrecioCompetencia[] => {
    const m = l.trim().match(LINEA)
    if (!m) return []
    const precio = Number(m[4])
    const cantidad = Number(m[2])
    return Number.isFinite(precio) && precio > 0 && cantidad > 0 ? [{ texto: m[1]!, cantidad, moneda: m[3]!, precio }] : []
  })
  return lineas.length > 0 ? lineas : null
}

export type ReglaContrapropuesta = 'igualar' | 'tope' | 'ya_mejor' | 'sin_dato'

export interface FilaContrapropuesta {
  readonly itemId: string
  readonly producto: string
  readonly cantidad: number
  readonly actual: number
  readonly competencia: number | null
  readonly propuesta: number
  readonly regla: ReglaContrapropuesta
}

function centimos(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Por línea, en el orden de la solicitud (la nota y las líneas nacen del mismo
 * listado). Si el vendedor añadió o quitó líneas y ya no cuadran, la que no se
 * puede emparejar queda «sin dato» y conserva su precio.
 */
export function proponerContraoferta(
  items: ReadonlyArray<{ readonly id: string; readonly product_name: string | null; readonly quantity: string; readonly unit_price: string; readonly position: number }>,
  competencia: readonly PrecioCompetencia[],
  descuentoMaximoPct: number,
): FilaContrapropuesta[] {
  const tope = Math.min(Math.max(descuentoMaximoPct, 0), 90) / 100
  const ordenados = [...items].sort((a, b) => a.position - b.position)
  const emparejar = ordenados.length === competencia.length
  return ordenados.map((item, i) => {
    const actual = Number(item.unit_price)
    const suya = emparejar ? competencia[i]!.precio : null
    const base = { itemId: item.id, producto: item.product_name ?? '—', cantidad: Number(item.quantity), actual, competencia: suya }
    if (suya === null || !Number.isFinite(actual) || actual <= 0) return { ...base, propuesta: actual, regla: 'sin_dato' as const }
    if (suya >= actual) return { ...base, propuesta: actual, regla: 'ya_mejor' as const }
    const piso = centimos(actual * (1 - tope))
    return suya >= piso
      ? { ...base, propuesta: centimos(suya), regla: 'igualar' as const }
      : { ...base, propuesta: piso, regla: 'tope' as const }
  })
}
