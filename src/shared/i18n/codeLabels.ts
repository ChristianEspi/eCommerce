import type { MessageKey } from './messages'

type Translate = (key: MessageKey) => string

/**
 * Códigos de máquina → texto para personas (2026-11-17).
 *
 * La base habla en códigos estables —`payment.intent_opened`,
 * `customer.updated`, `STOCK_INSUFICIENTE`— y así tienen que seguir: se agrupan,
 * se filtran y viajan a webhooks. Pero en pantalla un operador no tiene por qué
 * leerlos. Aquí está la única traducción, para que ningún panel se invente la
 * suya ni enseñe el código crudo.
 *
 * Tres escalones, del más preciso al más genérico:
 *
 *   1. el código exacto tiene texto propio (`activity.payment.captured`);
 *   2. se compone «acción + entidad»: `customer.updated` → «Cambio en cliente»,
 *      sin tener que escribir cada combinación de las tablas auditadas;
 *   3. último recurso: el código legible (sin puntos ni guiones bajos). Nunca
 *      se ve un `payment.intent_opened` tal cual.
 */

function lookup(t: Translate, key: string): string | null {
  const out = t(key as MessageKey)
  return out === key ? null : out
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `order_schedule.run_ready` → «order schedule run ready». */
function readable(code: string): string {
  return code.replace(/[._]+/g, ' ').trim().toLowerCase()
}

/** Un evento, operación o acción con forma `entidad.acción`. */
export function eventLabel(t: Translate, code: string | null | undefined): string {
  if (!code) return '—'
  const exact = lookup(t, `activity.${code}`)
  if (exact) return exact

  const cut = code.lastIndexOf('.')
  if (cut > 0) {
    const entity = lookup(t, `activity.entity.${code.slice(0, cut)}`)
    const action = code.slice(cut + 1)
    const template = lookup(t, `activity.action.${action}`)
    if (entity && template) return capitalize(template.replace('{entity}', entity))
    if (entity) return `${capitalize(entity)} · ${readable(action)}`
  }
  return capitalize(readable(code))
}

/**
 * Un código de error o de incidente (`STOCK_INSUFICIENTE`, `CLQ51`). Los de la
 * base ya están en español, así que el escalón genérico («Stock insuficiente»)
 * se lee bien; los que tienen texto propio lo usan.
 */
export function codeLabel(t: Translate, code: string | null | undefined): string {
  if (!code) return '—'
  const exact = lookup(t, `code.${code}`)
  if (exact) return exact
  // Un código de proveedor (letras y dígitos, sin palabras) se deja como está:
  // es el que se le dicta al soporte del proveedor.
  if (!/[_\s]/.test(code) && /\d/.test(code)) return code
  return capitalize(readable(code))
}

/**
 * Un valor de un vocabulario cerrado: estados de cola o de circuito, dominios,
 * tipos de actor, de proveedor, funciones de IA. `code.<grupo>.<valor>` y, si
 * no hay texto, el valor legible.
 */
export type TermGroup = 'status' | 'domain' | 'actor' | 'providerKind' | 'aiFeature' | 'kind' | 'stage'

export function termLabel(t: Translate, group: TermGroup, value: string | null | undefined): string {
  if (!value) return '—'
  return lookup(t, `code.${group}.${value}`) ?? capitalize(readable(value))
}

/**
 * Un texto libre que la base arma con códigos dentro («checkout_failed ·
 * STOCK_INSUFICIENTE», «etapa reserve_inventory»): cada código se traduce en
 * su sitio y el resto se deja como está.
 */
export function summaryLabel(t: Translate, text: string | null | undefined): string {
  if (!text) return '—'
  return text.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b[a-z]+(?:_[a-z]+)+\b/g, (code) => {
    if (code === code.toUpperCase()) return codeLabel(t, code)
    for (const group of ['stage', 'kind', 'status', 'domain'] as const) {
      const found = lookup(t, `code.${group}.${code}`)
      if (found) return found.toLowerCase() === found ? found : found.charAt(0).toLowerCase() + found.slice(1)
    }
    return readable(code)
  }).replace(/^./, (c) => c.toUpperCase())
}

/** Un tipo de entidad (`payment_intent`, `shipment`) como sustantivo con mayúscula. */
export function entityLabel(t: Translate, type: string | null | undefined): string {
  if (!type) return '—'
  return capitalize(lookup(t, `activity.entity.${type}`) ?? readable(type))
}

/** Un rol de miembro (`owner`, `orders`). */
export function roleLabel(t: Translate, role: string | null | undefined): string {
  if (!role) return '—'
  return lookup(t, `settings.members.role.${role}`) ?? capitalize(readable(role))
}
