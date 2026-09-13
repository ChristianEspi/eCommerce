import type { MessageKey } from '@/shared/i18n/messages'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Error de autenticación traducible.
 *
 * Los mensajes del SDK vienen en inglés y describen el mecanismo
 * ("Invalid login credentials"), no lo que el usuario tiene que hacer. Se
 * mapean a claves del diccionario; lo desconocido cae en un mensaje genérico en
 * vez de mostrar texto crudo del proveedor.
 */
export class AuthActionError extends Error {
  readonly key: MessageKey

  constructor(key: MessageKey, cause?: unknown) {
    super(key)
    this.name = 'AuthActionError'
    this.key = key
    if (cause instanceof Error) this.cause = cause
  }
}

/**
 * ULTIMA excepcion viva a la regla «no ramificar por el texto de un error».
 *
 * El SDK de Supabase Auth no expone hoy un codigo estable para todos estos
 * casos, asi que el texto es lo unico que hay; el `status` cubre solo el 429.
 * Lo que hace que sea aceptable es que la lectura del texto muere aqui: de esta
 * funcion sale una CLAVE de i18n y nadie aguas abajo vuelve a mirar el mensaje.
 * `src/architecture.test.ts` mantiene la lista de los tres modulos que pueden
 * hacerlo y falla si aparece un cuarto.
 *
 * Se retira cuando la identidad pase por el hub (P16) o cuando el SDK exponga
 * `error.code` de forma estable para credenciales y confirmacion de correo.
 */
export function mapAuthError(error: { message?: string; status?: number }): MessageKey {
  const message = (error.message ?? '').toLowerCase()
  if (error.status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return 'auth.error.rateLimited'
  }
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return 'auth.error.invalidCredentials'
  }
  if (message.includes('email not confirmed')) return 'auth.error.emailNotConfirmed'
  if (message.includes('password') && message.includes('should be at least')) {
    return 'auth.error.weakPassword'
  }
  if (message.includes('expired') || message.includes('invalid claim')) {
    return 'auth.error.linkExpired'
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'auth.error.network'
  }
  return 'auth.error.generic'
}

function client() {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new AuthActionError('auth.notConfigured')
  return supabase
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) throw new AuthActionError(mapAuthError(error), error)
}

/** Ruta a la que apunta el enlace del correo de recuperación. */
export const RESET_PATH = '/nueva-clave'

/**
 * Pide el correo de recuperación. No distingue entre correo existente y no
 * existente ni aquí ni en la pantalla: responder "ese correo no existe" es
 * regalar un enumerador de cuentas.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const redirectTo =
    typeof window === 'undefined' ? undefined : `${window.location.origin}${RESET_PATH}`
  const { error } = await client().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    ...(redirectTo ? { redirectTo } : {}),
  })
  if (error) throw new AuthActionError(mapAuthError(error), error)
}

/**
 * Nombre y teléfono de la propia persona, en los metadatos de su cuenta.
 *
 * Solo esos dos campos y nunca el correo: cambiar el correo es cambiar la
 * identidad con la que se entra, y eso no es un «dato de perfil». Van en
 * `user_metadata`, que el propio usuario puede escribir y que por eso ninguna
 * regla del sistema lee para autorizar — la autorización vive en
 * `app_metadata`, que solo escribe el servidor.
 */
export async function updateProfile(values: { fullName: string; phone: string }): Promise<void> {
  const { error } = await client().auth.updateUser({
    data: { full_name: values.fullName.trim(), phone: values.phone.trim() },
  })
  if (error) throw new AuthActionError(mapAuthError(error), error)
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await client().auth.updateUser({ password })
  if (error) throw new AuthActionError(mapAuthError(error), error)
}
