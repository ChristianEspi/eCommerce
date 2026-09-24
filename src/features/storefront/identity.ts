/**
 * La identidad de la tienda, con ROLES SEMÁNTICOS (Storefront V3 · P01).
 *
 * ## El problema que cierra este módulo
 *
 * `hero_subtitle` hacía dos trabajos que no se pueden hacer con un campo. Es la
 * bajada del hero —estacional: «Campaña de invierno»— y desde P09 de V2 también
 * la descripción estable del comercio que pintan el pie y los datos del
 * negocio.
 *
 * La consecuencia era concreta: un comercio estrenaba campaña y, sin querer,
 * cambiaba lo que su tienda decía de sí misma en el pie de todas sus páginas. Y
 * al revés, quien quería un resumen serio abajo se quedaba sin poder usar el
 * hero para una campaña.
 *
 * Aquí viven las cinco decisiones que separan esos roles, y **solo** esas: qué
 * texto va en cada sitio, qué enseña la cabecera, si hay selector de tema y qué
 * dice la barra de avisos. Ni una regla de negocio, ni una consulta.
 *
 * ## La regla que gobierna el archivo
 *
 * Lo que el comercio no escribió, no se inventa. La plataforma no genera un
 * aviso, no redacta una descripción y no rellena un kicker: cada uno de estos
 * campos, vacío, significa «esto no se pinta». La única excepción es el
 * respaldo de compatibilidad de la descripción, que está documentado donde
 * ocurre y existe para que una tienda que ya funcionaba no pierda su pie el día
 * del despliegue.
 */

/**
 * Qué enseña la cabecera.
 *
 * Tres valores y nada más, porque son los tres casos reales:
 *
 *  · `logo_name` — logotipo y nombre. Lo que la cabecera hacía hasta V3, y el
 *    defecto: ninguna tienda cambia de aspecto por aplicar la migración.
 *  · `logo` — solo el logotipo. Para el comercio cuyo logotipo YA lleva su
 *    nombre dentro, que es la mayoría de los logotipos comerciales: con
 *    `logo_name` el nombre sale dos veces y se lee como un error.
 *  · `name` — solo el nombre, en tipografía. Para quien no tiene logotipo, o
 *    tiene uno que no funciona a 28 px de alto.
 */
export const BRAND_LOCKUPS = ['logo_name', 'logo', 'name'] as const
export type BrandLockup = (typeof BRAND_LOCKUPS)[number]

export const DEFAULT_BRAND_LOCKUP: BrandLockup = 'logo_name'

/** Los topes, replicados del CHECK de la migración `20260923180000`. */
export const IDENTITY_LIMITS = {
  /** Cabe un resumen de tres o cuatro líneas sin empujar el aviso legal. */
  descriptionMax: 360,
  /** Una línea encima del titular. Más largo deja de ser un kicker. */
  kickerMax: 80,
  /** La barra rota entre mensajes; con tres, nadie lee el tercero. */
  announcementsMax: 2,
  announcementTextMax: 80,
} as const

/** Un aviso de la barra: texto del comercio, y nada más que texto. */
export interface StoreAnnouncement {
  readonly text: string
}

const limpiarTexto = (valor: unknown, tope: number): string => {
  if (typeof valor !== 'string') return ''
  // Los caracteres de control fuera: un `\n` guardado en una barra de una línea
  // descuadra la cabecera, y en una descripción de pie produce un salto que
  // nadie escribió a propósito. Se sustituyen por espacio y se recorta.
  // eslint-disable-next-line no-control-regex -- Es exactamente lo que se quita.
  const plano = valor.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
  return plano.slice(0, tope)
}

/**
 * ¿Es esto un aviso?
 *
 * Réplica del validador de la base, clave por clave. La comprobación de que no
 * hay más claves que `text` es la mitad del contrato: sin ella, un
 * `{"text": "…", "html": "<script>"}` pasaría por aquí y llegaría a la base,
 * que lo rechazaría con un error genérico — o peor, otra versión del cliente lo
 * pintaría.
 */
function esAviso(valor: unknown): valor is { text: unknown } {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false
  const claves = Object.keys(valor)
  return claves.length === 1 && claves[0] === 'text'
}

/**
 * Los avisos que se pueden pintar, de lo que haya guardado.
 *
 * Descarta entrada a entrada en vez de rechazar la lista: una barra con un
 * aviso bueno y otro corrupto enseña el bueno. Lo que NO hace es rellenar —si
 * la lista queda vacía, no hay barra— ni reordenar: el orden guardado es el
 * orden en que rotan.
 */
export function sanitizeAnnouncements(valor: unknown): StoreAnnouncement[] {
  if (!Array.isArray(valor)) return []

  const vistos = new Set<string>()
  const salida: StoreAnnouncement[] = []

  for (const entrada of valor) {
    if (salida.length >= IDENTITY_LIMITS.announcementsMax) break
    if (!esAviso(entrada)) continue

    const text = limpiarTexto(entrada.text, IDENTITY_LIMITS.announcementTextMax)
    if (text === '') continue
    // Dos avisos iguales rotando no son una preferencia: son un guardado
    // accidentado, y la barra parece estropeada.
    if (vistos.has(text)) continue

    vistos.add(text)
    salida.push({ text })
  }

  return salida
}

/**
 * Qué enseña la cabecera, DE VERDAD.
 *
 * El valor guardado manda, salvo en un caso que no se puede pintar: `logo` o
 * `logo_name` sin logotipo dejarían un hueco donde debería estar la marca. Sin
 * logotipo, la cabecera enseña el nombre — que es lo que hay.
 *
 * No se corrige al revés: `name` con logotipo es una decisión legítima del
 * comercio, no un descuido.
 */
export function resolveBrandLockup(valor: unknown, tieneLogo: boolean): BrandLockup {
  const elegido = BRAND_LOCKUPS.includes(valor as BrandLockup)
    ? (valor as BrandLockup)
    : DEFAULT_BRAND_LOCKUP

  if (!tieneLogo) return 'name'
  return elegido
}

/**
 * El resumen estable del comercio, para el pie, los datos del negocio y la
 * reserva de SEO.
 *
 * ## El respaldo, y por qué termina solo
 *
 * Mientras `store_description` sea nulo se usa `hero_subtitle`. No es pereza:
 * es que hasta V3 ese campo ERA la descripción, y una tienda que ya funcionaba
 * no puede perder su pie el día que se aplica una migración.
 *
 * En cuanto el comercio escribe una descripción, los dos campos dejan de estar
 * acoplados para siempre — que es el motivo entero de esta fase—. Y el respaldo
 * es texto que el comercio escribió, no texto que la plataforma inventa.
 */
export function resolveStoreDescription(store: {
  readonly store_description?: string | null
  readonly hero_subtitle?: string | null
}): string {
  const propia = limpiarTexto(store.store_description, IDENTITY_LIMITS.descriptionMax)
  if (propia !== '') return propia
  return limpiarTexto(store.hero_subtitle, IDENTITY_LIMITS.descriptionMax)
}

/** La línea de encima del titular del hero. Vacía significa «no se pinta». */
export function resolveHeroKicker(valor: unknown): string {
  return limpiarTexto(valor, IDENTITY_LIMITS.kickerMax)
}

/**
 * ¿Ofrece esta tienda el selector claro/oscuro?
 *
 * **Apagado por defecto**, y es el único defecto de V3 que cambia la vitrina de
 * una tienda existente. A propósito: el selector estaba en la cabecera de toda
 * tienda sin que ningún comercio lo hubiera pedido, y en una tienda un botón de
 * tema compite por atención con el carrito. Quien lo quiera, lo enciende.
 *
 * Lo que NO cambia es el modo que ve quien llega: la vitrina sigue respetando
 * la preferencia del sistema y lo que el visitante hubiera elegido antes. Lo
 * que desaparece es el control, no el tema oscuro.
 */
export function resolveShowThemeToggle(valor: unknown): boolean {
  return valor === true
}
