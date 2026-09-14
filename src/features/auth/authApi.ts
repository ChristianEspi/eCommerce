import { internalPathOr } from '@/domain/href'
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

/**
 * Alta de un CONSUMIDOR desde la vitrina (N02).
 *
 * Crea una cuenta de acceso y nada más: ni tenant, ni sociedad, ni membresía de
 * backoffice, ni cuenta de empresa. No hay trigger sobre `auth.users` que lo
 * haga (lo comprueba `consumer-signup.test.ts`) y aquí no se llama a nada más.
 *
 * `user_metadata` lleva SOLO nombre y teléfono, que la persona puede editar
 * después y que ninguna regla lee para autorizar. Nunca organización, sociedad
 * ni rol: esos viven en `app_metadata`, que solo escribe el servidor.
 *
 * `emailRedirectTo` apunta a una ruta INTERNA validada (la tienda de la que
 * vino), con el origen de esta misma app: el enlace del correo no puede
 * mandar a otro dominio aunque alguien fabrique el `returnTo`.
 *
 * Devuelve si hace falta confirmar el correo: sin sesión en la respuesta, el
 * proyecto exige confirmación y todavía no se ha entrado.
 */
export async function signUpConsumer(input: {
  email: string
  password: string
  fullName: string
  phone: string
  returnTo: string
}): Promise<{ needsConfirmation: boolean }> {
  const data: Record<string, string> = { full_name: input.fullName.trim() }
  if (input.phone.trim() !== '') data.phone = input.phone.trim()
  const destino = internalPathOr(input.returnTo, '/')
  const { data: result, error } = await client().auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      data,
      ...(typeof window === 'undefined' ? {} : { emailRedirectTo: `${window.location.origin}${destino}` }),
    },
  })
  if (error) throw new AuthActionError(mapAuthError(error), error)
  return { needsConfirmation: !result.session }
}

/** Ruta a la que apunta el enlace del correo de recuperación. */
export const RESET_PATH = '/nueva-clave'

/**
 * Pide el correo de recuperación. No distingue entre correo existente y no
 * existente ni aquí ni en la pantalla: responder "ese correo no existe" es
 * regalar un enumerador de cuentas.
 *
 * `returnTo` (N02): a dónde volver DESPUÉS de fijar la clave nueva, por ejemplo
 * la cuenta de una tienda. Solo viaja si es una ruta interna; si no, el enlace
 * es el de siempre y la vuelta es `/app`.
 */
export async function requestPasswordReset(email: string, returnTo: string | null = null): Promise<void> {
  const vuelta = returnTo === null ? null : internalPathOr(returnTo, '')
  const query = vuelta ? `?returnTo=${encodeURIComponent(vuelta)}` : ''
  const redirectTo =
    typeof window === 'undefined' ? undefined : `${window.location.origin}${RESET_PATH}${query}`
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
