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
