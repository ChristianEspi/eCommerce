import { z } from 'zod'

/**
 * Limpieza del catálogo (2026-11-22): qué revisar en los productos de una
 * tienda. Detección por REGLAS, sin IA y sin cuota: lo mismo da lo mismo, y se
 * prueba. Nada se corrige solo; cada hallazgo lleva al producto en la lista.
 *
 *  · duplicados: mismo nombre (sin mayúsculas, tildes ni signos) y misma marca;
 *  · tamaños sueltos: mismo producto en varios tamaños cargados como productos
 *    distintos («Lejía 1 L» y «Lejía 5 L»): candidatos a variantes. Los mg son
 *    dosis y separan («Amoxil 250 mg» no es hermano de «Amoxil 500 mg»);
 *  · sin foto, sin descripción, sin categoría;
 *  · nombres: todo en mayúsculas, espacios de más o tramos repetidos
 *    («Pedialyte 500 ml · Pedialyte 500 ml · Uva»).
 */

export const cleanupRowSchema = z.object({
  product_id: z.string().uuid(),
  sku: z.string().nullable(),
  name: z.string(),
  brand_name: z.string().nullable(),
  kind: z.string(),
  status: z.string(),
  has_image: z.boolean(),
  has_description: z.boolean(),
  has_category: z.boolean(),
})
export type CleanupRow = z.infer<typeof cleanupRowSchema>

export type ProblemaNombre = 'mayusculas' | 'espacios' | 'repetido'

export interface GrupoLimpieza {
  readonly clave: string
  readonly productos: readonly CleanupRow[]
}

export interface HallazgosLimpieza {
  readonly duplicados: readonly GrupoLimpieza[]
  readonly tamanos: readonly GrupoLimpieza[]
  readonly sinFoto: readonly CleanupRow[]
  readonly sinDescripcion: readonly CleanupRow[]
  readonly sinCategoria: readonly CleanupRow[]
  readonly nombres: ReadonlyArray<{ readonly producto: CleanupRow; readonly problema: ProblemaNombre }>
}

export function normalizarNombre(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const UNIDADES =
  'un|und|unid|unids|unidades|tab|tabs|tabletas?|comp|comprimidos?|cap|caps|capsulas?|sobres?|amp|ampollas?|piezas?|pzs?|rollos?|pares|viales?|grageas?'
const NO_ES_CONTEO = '(?!\\s*(?:mg|mcg|ml|l|lt|g|gr|kg)\\b)'
/** Lo que dice cuánto trae: conteos, volúmenes y pesos. NO los mg (dosis). */
const CONTENIDO = [
  new RegExp(`\\b\\d{1,5}\\s*(?:${UNIDADES})\\b`, 'g'),
  new RegExp(`\\b(?:x|por)\\s*\\d{1,5}\\b${NO_ES_CONTEO}`, 'g'),
  new RegExp(`\\b(?:caja|frasco|blister|pack|paquete|bolsa)\\s*(?:de\\s*)?\\d{1,5}\\b${NO_ES_CONTEO}`, 'g'),
  /\b\d{1,5}(?: \d{1,3})?\s*(?:ml|l|lt|litros?)\b/g,
  /\b\d{1,5}(?: \d{1,3})?\s*(?:g|gr|grs|gramos?|kg)\b/g,
]
const ENVASE = /\b(?:caja|frasco|blister|pack|paquete|bolsa|botella|x|por|de)\b/g

/** El contenido leído del nombre («30 un», «5 l»), o null si no dice cuánto trae. */
export function contenidoEnNombre(nombre: string): string | null {
  const n = normalizarNombre(nombre)
  for (const re of CONTENIDO) {
    const m = n.match(re)
    if (m) return m[0]!.replace(/\s+/g, ' ').trim()
  }
  return null
}

/** El nombre sin el contenido: la clave de «mismo producto, otro tamaño». */
export function claveSinContenido(nombre: string): string {
  let n = normalizarNombre(nombre)
  for (const re of CONTENIDO) n = n.replace(re, ' ')
  return n.replace(ENVASE, ' ').replace(/\s+/g, ' ').trim()
}

export function problemaDeNombre(nombre: string): ProblemaNombre | null {
  const tramos = nombre.split('·').map((t) => normalizarNombre(t)).filter(Boolean)
  if (new Set(tramos).size < tramos.length) return 'repetido'
  if (nombre !== nombre.trim() || /\s{2,}/.test(nombre)) return 'espacios'
  const letras = nombre.replace(/[^\p{L}]/gu, '')
  if (letras.length >= 6 && letras === letras.toUpperCase() && letras !== letras.toLowerCase()) return 'mayusculas'
  return null
}

function agrupar(filas: readonly CleanupRow[], clave: (f: CleanupRow) => string | null): GrupoLimpieza[] {
  const grupos = new Map<string, CleanupRow[]>()
  for (const f of filas) {
    const k = clave(f)
    if (!k) continue
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  return [...grupos.entries()]
    .filter(([, productos]) => productos.length >= 2)
    .map(([k, productos]) => ({ clave: k, productos }))
    .sort((a, b) => b.productos.length - a.productos.length || a.clave.localeCompare(b.clave))
}

export function analizarCatalogo(filas: readonly CleanupRow[]): HallazgosLimpieza {
  const marca = (f: CleanupRow) => normalizarNombre(f.brand_name ?? '')
  const duplicados = agrupar(filas, (f) => {
    const n = normalizarNombre(f.name)
    return n ? `${n}|${marca(f)}` : null
  })
  const enDuplicado = new Set(duplicados.flatMap((g) => g.productos.map((p) => p.product_id)))
  const tamanos = agrupar(
    // Solo productos simples (las variantes ya están agrupadas) que dicen cuánto traen.
    filas.filter((f) => f.kind !== 'variant' && !enDuplicado.has(f.product_id) && contenidoEnNombre(f.name)),
    (f) => {
      const k = claveSinContenido(f.name)
      return k ? `${k}|${marca(f)}` : null
    },
  ).filter((g) => new Set(g.productos.map((p) => contenidoEnNombre(p.name))).size >= 2)

  return {
    duplicados,
    tamanos,
    sinFoto: filas.filter((f) => !f.has_image),
    sinDescripcion: filas.filter((f) => !f.has_description),
    sinCategoria: filas.filter((f) => !f.has_category),
    nombres: filas.flatMap((producto) => {
      const problema = problemaDeNombre(producto.name)
      return problema ? [{ producto, problema }] : []
    }),
  }
}
