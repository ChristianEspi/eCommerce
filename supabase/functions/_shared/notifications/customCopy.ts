/**
 * Textos de correo editables por tienda (2026-11-20, «opción A»).
 *
 * El admin de cada tienda cambia asunto, título y mensaje de los avisos al
 * comprador desde Configuración → Correo. Este módulo es PURO y lo usan los
 * dos lados: la vista previa del backoffice y el correo que de verdad sale
 * (`templates.ts`). Así lo que se ve al editar es lo que llega.
 *
 * ## Variables: lista cerrada
 *
 * Cada aviso declara sus variables (`{{pedido}}`, `{{total}}`…) y de qué dato
 * de la cola sale cada una. No hay expresiones ni acceso a campos libres: un
 * texto no puede sacar nada que el aviso no traiga ya. Una variable que no está
 * en la lista se rechaza al guardar y, si aun así llegara, sale vacía.
 *
 * ## Todo se escapa
 *
 * El texto lo escribe una persona y los valores vienen de datos: los dos se
 * escapan antes de ir al HTML. El formato es mínimo y seguro: párrafos por
 * línea en blanco y salto de línea simple. Nada de HTML del usuario.
 */
import { escapeHtml } from './templates.ts'

export type CopyLocale = 'es' | 'en'

export interface CustomCopy {
  readonly subject: string
  readonly title: string
  readonly body: string
}

interface VariableDef {
  /** Lo que se escribe entre llaves. */
  readonly key: string
  readonly label: Record<CopyLocale, string>
  readonly sample: string
  readonly value: (params: Readonly<Record<string, unknown>>, now: Date) => string
}

const str = (params: Readonly<Record<string, unknown>>, key: string): string => {
  const value = params[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

const SIMBOLO: Record<string, string> = { PEN: 'S/', USD: 'US$', EUR: '€' }

/** `715.2` + `PEN` → `S/ 715.20`. */
export function formatTotal(amount: string, currency: string): string | null {
  const value = Number(amount)
  if (!amount || !Number.isFinite(value)) return null
  const cifra = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const code = currency.toUpperCase()
  return `${SIMBOLO[code] ?? code} ${cifra}`.trim()
}

/** Fecha de Lima, `dd/mm/aaaa`: el aviso sale al minuto del hecho. */
export function fechaLima(now: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now)
}

const PEDIDO: VariableDef = {
  key: 'pedido',
  label: { es: 'Número de pedido', en: 'Order number' },
  sample: 'EC-20261120-00058',
  value: (p) => str(p, 'order_number'),
}
const TOTAL: VariableDef = {
  key: 'total',
  label: { es: 'Total', en: 'Total' },
  sample: 'S/ 1,250.40',
  value: (p) => formatTotal(str(p, 'grand_total'), str(p, 'currency')) ?? '',
}
const CLIENTE: VariableDef = {
  key: 'cliente',
  label: { es: 'Nombre del cliente', en: 'Customer name' },
  sample: 'Ana Torres',
  value: (p) => str(p, 'customer_name'),
}
const TIENDA: VariableDef = {
  key: 'tienda',
  label: { es: 'Nombre de la tienda', en: 'Store name' },
  sample: 'Mi Tienda',
  value: (p) => str(p, 'store_name'),
}
const FECHA: VariableDef = {
  key: 'fecha',
  label: { es: 'Fecha', en: 'Date' },
  sample: '20/11/2026',
  value: (_p, now) => fechaLima(now),
}
const MOTIVO: VariableDef = {
  key: 'motivo',
  label: { es: 'Motivo del rechazo', en: 'Rejection reason' },
  sample: 'Excede el presupuesto del mes',
  value: (p) => str(p, 'reason'),
}

interface EditableKind {
  readonly variables: readonly VariableDef[]
  /** El texto original, con variables: lo que «Restaurar» devuelve. */
  readonly defaults: Record<CopyLocale, CustomCopy>
}

/**
 * Los avisos que la tienda puede editar: los que recibe el COMPRADOR por un
 * pedido. Los del backoffice y los de acceso (contraseña, enlaces) no: los
 * primeros son de la suite y los segundos llevan seguridad en el texto.
 */
export const EDITABLE_KINDS: Readonly<Record<string, EditableKind>> = {
  'order.confirmed': {
    variables: [PEDIDO, TOTAL, CLIENTE, TIENDA, FECHA],
    defaults: {
      es: {
        subject: 'Recibimos tu pedido {{pedido}}',
        title: 'Recibimos tu pedido',
        body: 'Tu pedido {{pedido}} por {{total}} quedó registrado. Te avisaremos cuando salga.',
      },
      en: {
        subject: 'We received your order {{pedido}}',
        title: 'We received your order',
        body: 'Your order {{pedido}} for {{total}} is confirmed. We will let you know when it ships.',
      },
    },
  },
  'order.approved': {
    variables: [PEDIDO, TOTAL, CLIENTE, TIENDA, FECHA],
    defaults: {
      es: {
        subject: 'Tu pedido {{pedido}} fue aprobado',
        title: 'Tu pedido fue aprobado',
        body: 'El pedido {{pedido}} ya tiene la aprobación que necesitaba y sigue su curso.',
      },
      en: {
        subject: 'Your order {{pedido}} was approved',
        title: 'Your order was approved',
        body: 'Order {{pedido}} has the approval it needed and is moving forward.',
      },
    },
  },
  'order.rejected': {
    variables: [PEDIDO, TOTAL, CLIENTE, TIENDA, FECHA, MOTIVO],
    defaults: {
      es: {
        subject: 'Tu pedido {{pedido}} no fue aprobado',
        title: 'Tu pedido no fue aprobado',
        body: 'El pedido {{pedido}} fue rechazado. Motivo: {{motivo}}. No se cobró nada.',
      },
      en: {
        subject: 'Your order {{pedido}} was not approved',
        title: 'Your order was not approved',
        body: 'Order {{pedido}} was rejected. Reason: {{motivo}}. Nothing was charged.',
      },
    },
  },
  'order.shipped': {
    variables: [PEDIDO, TOTAL, CLIENTE, TIENDA, FECHA],
    defaults: {
      es: {
        subject: 'Tu pedido {{pedido}} está en camino',
        title: 'Tu pedido está en camino',
        body: 'El pedido {{pedido}} ya salió.',
      },
      en: {
        subject: 'Your order {{pedido}} is on its way',
        title: 'Your order is on its way',
        body: 'Order {{pedido}} has shipped.',
      },
    },
  },
}

export const EDITABLE_KIND_LIST = Object.freeze(Object.keys(EDITABLE_KINDS))

export function isEditableKind(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(EDITABLE_KINDS, kind)
}

/** Las variables de un aviso, para los botones de insertar del editor. */
export function variablesOf(kind: string, locale: CopyLocale): Array<{ key: string; label: string; sample: string }> {
  return (EDITABLE_KINDS[kind]?.variables ?? []).map((v) => ({ key: v.key, label: v.label[locale], sample: v.sample }))
}

export function defaultCopy(kind: string, locale: CopyLocale): CustomCopy | null {
  return EDITABLE_KINDS[kind]?.defaults[locale] ?? null
}

/** Límites: los mismos que los `check` de `email_templates`. */
export const COPY_LIMITS = { subject: 150, title: 120, body: 2000 } as const

const VARIABLE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export type CopyIssue =
  | { readonly field: keyof CustomCopy; readonly code: 'VACIO' | 'MUY_LARGO' }
  | { readonly field: keyof CustomCopy; readonly code: 'VARIABLE_DESCONOCIDA'; readonly variable: string }

/** Lo que impide guardar. Vacío ⇒ se puede guardar. */
export function validateCopy(kind: string, copy: CustomCopy): CopyIssue[] {
  const conocidas = new Set((EDITABLE_KINDS[kind]?.variables ?? []).map((v) => v.key))
  const issues: CopyIssue[] = []
  for (const field of ['subject', 'title', 'body'] as const) {
    const value = copy[field] ?? ''
    if (!value.trim()) issues.push({ field, code: 'VACIO' })
    else if (value.length > COPY_LIMITS[field]) issues.push({ field, code: 'MUY_LARGO' })
    for (const match of value.matchAll(VARIABLE)) {
      const name = match[1] as string
      if (!conocidas.has(name)) issues.push({ field, code: 'VARIABLE_DESCONOCIDA', variable: name })
    }
  }
  return issues
}

function valuesFor(kind: string, params: Readonly<Record<string, unknown>>, now: Date): Map<string, string> {
  return new Map((EDITABLE_KINDS[kind]?.variables ?? []).map((v) => [v.key, v.value(params, now)]))
}

/** Valores de ejemplo, para la vista previa. */
export function sampleValues(kind: string): Map<string, string> {
  return new Map((EDITABLE_KINDS[kind]?.variables ?? []).map((v) => [v.key, v.sample]))
}

/** Texto plano (asunto): variables sustituidas, sin HTML. Desconocida ⇒ vacía. */
export function fillText(template: string, values: ReadonlyMap<string, string>): string {
  return template.replace(VARIABLE, (_m, name: string) => values.get(name) ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Mensaje a HTML seguro: se escapa todo, las variables van en negrita, una
 * línea en blanco abre párrafo y un salto simple es `<br />`.
 */
export function fillHtml(template: string, values: ReadonlyMap<string, string>): string {
  const parrafos = template
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  return parrafos
    .map((p) => {
      let html = ''
      let last = 0
      for (const match of p.matchAll(VARIABLE)) {
        const index = match.index ?? 0
        html += escapeHtml(p.slice(last, index))
        const value = values.get(match[1] as string) ?? ''
        if (value) html += `<strong>${escapeHtml(value)}</strong>`
        last = index + match[0].length
      }
      html += escapeHtml(p.slice(last))
      return html.replace(/\n/g, '<br />')
    })
    .join('</p><p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">')
}

/** Lo que `renderEmail` necesita para usar el texto de la tienda. */
export interface ResolvedCopy {
  readonly subject: string
  readonly title: string
  readonly bodyHtml: string
}

export function resolveCopy(
  kind: string,
  copy: CustomCopy,
  values: ReadonlyMap<string, string>,
): ResolvedCopy | null {
  if (!isEditableKind(kind) || validateCopy(kind, copy).length > 0) return null
  return {
    subject: fillText(copy.subject, values),
    title: fillText(copy.title, values),
    bodyHtml: fillHtml(copy.body, values),
  }
}

/** Para el envío real: los valores salen de los parámetros de la cola. */
export function resolveCopyFromParams(
  kind: string,
  copy: CustomCopy,
  params: Readonly<Record<string, unknown>>,
  now: Date,
): ResolvedCopy | null {
  return resolveCopy(kind, copy, valuesFor(kind, params, now))
}
