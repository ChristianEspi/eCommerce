import { AppError, type AppErrorKind } from '@/domain/errors'
import type { BoundaryId } from '@/domain/boundaries'
import type { MessageKey } from '@/shared/i18n/messages'

/**
 * Lectura del CÓDIGO de un error que viene de la base, y error de UI.
 *
 * Las funciones de negocio de este proyecto levantan `CODIGO: mensaje` (P02) y
 * PostgREST devuelve el `SQLSTATE`. La UI traduce el código, nunca el mensaje:
 * el de Postgres filtra internos del esquema y el de la Edge Function viene en
 * un solo idioma.
 *
 * Este módulo es, junto a `edgeError.ts`, el ÚNICO sitio del repositorio donde
 * se interpreta texto de error. A partir de aquí todo circula como código y
 * como `kind` (`@/domain/errors`), y la prueba de arquitectura verifica que
 * ninguna feature vuelve a construir un `Error` con el mensaje crudo del
 * servidor.
 *
 * Vive en `shared` porque lo usan por igual el catálogo y los pedidos, y dos
 * copias de la misma expresión regular se separan solas (precedente P05 #45).
 */
export type PostgrestLike = { message?: string; code?: string } | null | undefined

export const INTERNAL_DB_CODE = 'ERROR_INTERNO'

/**
 * ¿El error de Postgres nombra esta restricción o tabla? Para distinguir dos
 * errores con el MISMO código (p. ej. dos `23505` o dos `23514`) sin que el
 * texto del servidor salga de este módulo: se devuelve un sí/no, no el texto.
 */
export function dbErrorMentions(error: PostgrestLike, pattern: RegExp): boolean {
  return pattern.test(error?.message ?? '')
}

export function codeFromDbError(error: PostgrestLike): string {
  const raw = (error?.message ?? '').trim()
  const business = /(?:^|[:\s])([A-Z][A-Z0-9_]{3,60}):\s/.exec(raw)?.[1]
  return business ?? error?.code ?? INTERNAL_DB_CODE
}

/**
 * Error de aplicación con su clave de i18n ya resuelta.
 *
 * Antes de P01 había cinco clases con exactamente estos dos campos
 * (`CatalogError`, `OrderError`, `CheckoutError`, `SettingsError`,
 * `BootstrapError`) y ningún antepasado común, así que nada transversal podía
 * preguntarle a un error qué clase de fallo era sin conocer las cinco listas de
 * códigos. Siguen existiendo las cinco —cada dominio traduce lo suyo, y «no
 * encontrado» no se le cuenta igual a un comprador que a un administrador— pero
 * ahora heredan de `AppError` y traen `kind` y `boundary` sin que su firma
 * cambie.
 */
export class UiError extends AppError {
  readonly key: MessageKey

  constructor(input: {
    boundary: BoundaryId
    key: MessageKey
    code: string
    kind?: AppErrorKind
    cause?: unknown
  }) {
    super({
      boundary: input.boundary,
      code: input.code,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.cause !== undefined ? { cause: input.cause } : {}),
    })
    this.name = 'UiError'
    this.key = input.key
  }
}

/** `true` si el error trae una clave de i18n que la pantalla puede pintar. */
export function isUiError(value: unknown): value is UiError {
  return value instanceof UiError
}
