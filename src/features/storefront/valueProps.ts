import type { MessageKey } from '@/shared/i18n/messages'

/**
 * Las propuestas de valor de la vitrina: el contrato, sin JSX.
 *
 * ## Qué problema resuelve este archivo
 *
 * La franja bajo la portada tenía cuatro servicios escritos a mano en el
 * componente, y dos eran afirmaciones de un rubro: «Atención farmacéutica» y
 * «Retiro en tienda». Cualquier tienda —una zapatería, una ferretería— las
 * anunciaba. No era un problema de redacción: la plataforma estaba afirmando
 * cosas del negocio de otro.
 *
 * ## Las tres capas, y por qué la tercera no existe
 *
 *  1. **PLATAFORMA** (`PLATFORM_VALUE_PROPS`) — lo que el código puede afirmar
 *     de CUALQUIER tienda porque lo hace él: el checkout ofrece métodos de
 *     entrega y el pago se procesa en el servidor. Son las que se ven cuando el
 *     comercio no ha configurado nada, y son deliberadamente pocas: una franja
 *     con cuatro promesas que nadie ha hecho es peor que una con dos ciertas.
 *  2. **COMERCIO** (`value_props` de `store_settings`) — lo que solo el
 *     comercio sabe. Si una botica quiere anunciar atención farmacéutica, la
 *     escribe ella y sale solo en su tienda; si una zapatería quiere anunciar
 *     cambio de talla, igual. El mismo mecanismo, sin una línea de código por
 *     rubro.
 *  3. **RUBRO** — no existe. No hay campo «a qué te dedicas» y no se añade: en
 *     cuanto existiera, alguien ramificaría por él y la quinta industria
 *     pediría la quinta copia.
 *
 * ## Por qué el icono es lista cerrada y el texto no
 *
 * Son cosas distintas. El icono nombra un glifo que este repositorio dibuja: si
 * se admitiera cualquier cadena, habría que decidir qué hacer con un nombre que
 * no existe, y la respuesta razonable —no pintar nada— deja un hueco. El texto
 * es CONTENIDO, y ninguna lista cerrada puede contener «Envíos a todo el país
 * en 48 h».
 *
 * Lo que hace que el texto libre no sea un agujero es el resto del contrato:
 * tope de longitud, sin caracteres de control, y se pinta como TEXTO —React
 * escapa—. Aquí no se filtra `<script>` porque no hay sitio donde pudiera
 * ejecutarse; filtrar daría una falsa sensación de que sí lo habría.
 *
 * ## Y por qué nada de aquí lanza
 *
 * Es el mismo borde que el Theme Engine: una fila anterior al despliegue de la
 * migración, o un JSON escrito a mano, no puede dejar la portada en blanco. Lo
 * desconocido se descarta entrada a entrada y se sigue.
 */

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

/**
 * Los iconos disponibles, y no hay más.
 *
 * **Ninguno es de un rubro.** `expertise` no es «farmacéutico» y
 * `certification` no es «registro sanitario»: son las formas genéricas de
 * «alguien que sabe te atiende» y «hay papeles que lo respaldan», y el TEXTO
 * que las acompaña lo escribe cada comercio. Esa es exactamente la línea que
 * permite que una botica anuncie lo suyo sin que el código sepa que es botica.
 */
export const VALUE_PROP_ICON_KEYS = [
  'delivery',
  'pickup',
  'payment',
  'support',
  'returns',
  'warranty',
  'installments',
  'quality',
  'assortment',
  'expertise',
  'schedule',
  'certification',
] as const
export type ValuePropIconKey = (typeof VALUE_PROP_ICON_KEYS)[number]

/**
 * Los topes, en un solo sitio.
 *
 * Replican los CHECK de la migración `20260923100000` uno a uno. La validación
 * que MANDA sigue siendo la de Postgres; esto existe para que el formulario
 * avise antes de pulsar Guardar en vez de después.
 */
export const VALUE_PROPS_LIMITS = { max: 4, titleMax: 40, bodyMax: 90 } as const

/** Una propuesta tal y como se guarda. `body` ausente = se explica sola. */
export interface StoreValueProp {
  readonly iconKey: ValuePropIconKey
  readonly title: string
  readonly body?: string
  readonly enabled: boolean
}

/** Una propuesta lista para pintar: ya resuelta a texto, sin banderas. */
export interface ResolvedValueProp {
  readonly iconKey: ValuePropIconKey
  readonly title: string
  readonly body: string
}

/**
 * El texto SUGERIDO de cada icono, para cuando el comercio añade una fila.
 *
 * Son sugerencias, no afirmaciones de la plataforma: en cuanto el comercio
 * guarda una fila, la está afirmando él, y puede reescribir las dos líneas.
 * Existen porque una fila nueva con el título vacío obliga a inventarse el
 * texto desde cero, y lo que se inventa desde cero se queda sin escribir.
 *
 * Solo las tres de `PLATFORM_VALUE_PROPS` se pintan sin que nadie las haya
 * escrito, y son justo las que describen lo que hace el código.
 */
export const VALUE_PROP_COPY: Readonly<
  Record<ValuePropIconKey, { readonly title: MessageKey; readonly body: MessageKey }>
> = {
  delivery: {
    title: 'store.valueProps.copy.delivery.title',
    body: 'store.valueProps.copy.delivery.body',
  },
  pickup: {
    title: 'store.valueProps.copy.pickup.title',
    body: 'store.valueProps.copy.pickup.body',
  },
  payment: {
    title: 'store.valueProps.copy.payment.title',
    body: 'store.valueProps.copy.payment.body',
  },
  support: {
    title: 'store.valueProps.copy.support.title',
    body: 'store.valueProps.copy.support.body',
  },
  returns: {
    title: 'store.valueProps.copy.returns.title',
    body: 'store.valueProps.copy.returns.body',
  },
  warranty: {
    title: 'store.valueProps.copy.warranty.title',
    body: 'store.valueProps.copy.warranty.body',
  },
  installments: {
    title: 'store.valueProps.copy.installments.title',
    body: 'store.valueProps.copy.installments.body',
  },
  quality: {
    title: 'store.valueProps.copy.quality.title',
    body: 'store.valueProps.copy.quality.body',
  },
  assortment: {
    title: 'store.valueProps.copy.assortment.title',
    body: 'store.valueProps.copy.assortment.body',
  },
  expertise: {
    title: 'store.valueProps.copy.expertise.title',
    body: 'store.valueProps.copy.expertise.body',
  },
  schedule: {
    title: 'store.valueProps.copy.schedule.title',
    body: 'store.valueProps.copy.schedule.body',
  },
  certification: {
    title: 'store.valueProps.copy.certification.title',
    body: 'store.valueProps.copy.certification.body',
  },
}

/**
 * Lo que la plataforma puede afirmar de cualquier tienda, sin preguntar.
 *
 * Dos siempre, porque las hace el código: el checkout tiene un paso de entrega
 * donde se elige el método, y el cobro se procesa en el servidor de la tienda.
 * La tercera —atención— solo si la tienda dio un canal de contacto: anunciar
 * «escríbenos» sin correo ni teléfono es enviar a alguien a una puerta cerrada.
 *
 * NO están `pickup` ni `expertise`, y ahí está la diferencia con lo que había
 * antes: retiro en tienda es un hecho del local del comercio y asesoría
 * especializada es un hecho de su plantilla. Ninguno de los dos lo sabe el
 * código.
 */
export const PLATFORM_VALUE_PROPS: readonly {
  readonly iconKey: ValuePropIconKey
  /** Capacidad que la tienda tiene que tener para que esta se pinte. */
  readonly requires?: 'contact'
}[] = [
  { iconKey: 'delivery' },
  { iconKey: 'payment' },
  { iconKey: 'support', requires: 'contact' },
]

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Texto de una clave: recortado, acotado y sin caracteres de control. */
function textoValido(valor: unknown, tope: number): string {
  if (typeof valor !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- Es exactamente lo que se quita.
  const limpio = valor.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
  return limpio.slice(0, tope)
}

/**
 * Lo que la tienda dijo de verdad: lo que se GUARDA y lo que edita el
 * formulario.
 *
 * Conserva el orden, descarta lo que no cumple el contrato, recorta al tope y
 * deja fuera los iconos repetidos —gana el primero, que es la posición que el
 * editor eligió—. `body` vacío se omite en vez de guardarse como cadena vacía:
 * el CHECK de la base exige 1..90 si la clave viene, y «sin apoyo» y «apoyo en
 * blanco» son la misma cosa dicha de dos formas.
 *
 * Una entrada sin título SÍ se conserva si el resto es válido: es el estado
 * normal de una fila que alguien acaba de añadir y está escribiendo, y
 * descartarla aquí la haría desaparecer de la pantalla a mitad de frase. Quien
 * impide guardarla es el formulario (`valuePropsField`), que es donde se decide
 * si lo escrito puede escribirse.
 */
export function sanitizeValueProps(valor: unknown): StoreValueProp[] {
  if (!Array.isArray(valor)) return []

  const salida: StoreValueProp[] = []
  const vistos = new Set<ValuePropIconKey>()

  for (const entrada of valor) {
    if (salida.length >= VALUE_PROPS_LIMITS.max) break
    if (!esObjetoPlano(entrada)) continue

    const iconKey = entrada.iconKey
    if (typeof iconKey !== 'string') continue
    if (!(VALUE_PROP_ICON_KEYS as readonly string[]).includes(iconKey)) continue
    if (vistos.has(iconKey as ValuePropIconKey)) continue

    const title = textoValido(entrada.title, VALUE_PROPS_LIMITS.titleMax)
    const body = textoValido(entrada.body, VALUE_PROPS_LIMITS.bodyMax)
    const enabled = typeof entrada.enabled === 'boolean' ? entrada.enabled : true

    vistos.add(iconKey as ValuePropIconKey)
    salida.push({
      iconKey: iconKey as ValuePropIconKey,
      title,
      enabled,
      ...(body === '' ? {} : { body }),
    })
  }

  return salida
}

/**
 * Lo que la tienda dijo Y quiere enseñar: lo que se PINTA.
 *
 * Además de sanear, se queda solo con lo encendido y con lo que tiene título.
 * Una propuesta sin título no se puede pintar —sería un icono suelto— y una
 * apagada es una decisión del comercio, no un dato que falte.
 */
export function normalizeValueProps(valor: unknown): StoreValueProp[] {
  return sanitizeValueProps(valor).filter((prop) => prop.enabled && prop.title !== '')
}

/**
 * La franja final: lo del comercio si configuró algo, lo de la plataforma si no.
 *
 * ## Las dos decisiones que toma, y las dos importan
 *
 * **Configurar SUSTITUYE, no completa.** Si se rellenara la lista del comercio
 * con las de plataforma hasta llegar a cuatro, quien quiso enseñar UNA cosa
 * vería tres que no escribió, y la que le importaba quedaría en un rincón.
 *
 * **«No configuró nada» y «lo configuró y lo apagó» son cosas distintas.** La
 * reserva se aplica cuando la fila está VACÍA —la tienda nunca tocó la franja—,
 * no cuando el comercio apagó lo que tenía. Apagar es una decisión suya, y
 * devolverle las de plataforma encima sería ignorarla: apagaría los
 * interruptores y la franja seguiría ahí con otro texto. Sin nada encendido, la
 * sección desaparece, como cualquier otra de la portada sin contenido.
 *
 * `t` llega como argumento en vez de leerse con un hook para que esto sea una
 * función pura y se pueda probar sin montar un proveedor de idioma.
 */
export function resolveValueProps(input: {
  readonly configured: unknown
  readonly hasContact: boolean
  readonly t: (key: MessageKey) => string
}): ResolvedValueProp[] {
  // Dos lecturas de lo mismo, y la diferencia es la que decide: `sanitize` dice
  // si la tienda tiene franja propia; `normalize`, qué parte de ella se pinta.
  const configuradas = sanitizeValueProps(input.configured)

  if (configuradas.length > 0) {
    return configuradas
      .filter((prop) => prop.enabled && prop.title !== '')
      .map((prop) => ({ iconKey: prop.iconKey, title: prop.title, body: prop.body ?? '' }))
  }

  return PLATFORM_VALUE_PROPS.filter(
    (prop) => prop.requires !== 'contact' || input.hasContact,
  ).map((prop) => ({
    iconKey: prop.iconKey,
    title: input.t(VALUE_PROP_COPY[prop.iconKey].title),
    body: input.t(VALUE_PROP_COPY[prop.iconKey].body),
  }))
}
