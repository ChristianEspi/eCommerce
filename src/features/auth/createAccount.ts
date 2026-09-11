import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import type { MessageKey } from '@/shared/i18n/messages'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { getSupabaseClient } from '@/shared/lib/supabase'

/**
 * Crear la CUENTA de acceso de una persona.
 *
 * ## Por qué esto vive en `auth` y no en las dos pantallas que lo usan
 *
 * Las pantallas de usuarios del backoffice y de compradores de una cuenta B2B
 * reparten MEMBRESÍA: qué puede hacer alguien aquí dentro. La identidad —el
 * correo y la contraseña— es otra cosa y es de la plataforma (contrato §0.1:
 * «separa DATOS, unifica IDENTIDAD»). Las dos pantallas chocaban con el mismo
 * muro, `SIN_CUENTA`, y ninguna de las dos es el sitio donde resolverlo.
 *
 * ## Y por qué hace falta
 *
 * No había ningún lugar donde una cuenta empezara a existir: esta aplicación no
 * tiene pantalla de registro, y el alta directa de Supabase deja la cuenta sin
 * sesión esperando un correo de confirmación que todavía no se envía. Se podía
 * repartir acceso solo a quien ya lo tenía, que es un sistema de permisos sin
 * primera persona.
 *
 * ## La contraseña se ve UNA vez
 *
 * El servidor la genera y la devuelve en la respuesta; no queda guardada en
 * ninguna tabla ni en ningún registro, y por eso tampoco se puede volver a
 * consultar. Quien llama tiene que enseñarla en el momento. Si se pierde, el
 * camino es el de siempre: recuperar contraseña.
 */

export const CREATE_USER_FUNCTION = 'create-user'

const cuentaCreadaSchema = z.object({
  email: z.string(),
  user_id: z.string().uuid().nullable(),
  temporary_password: z.string().min(1),
})

export type CuentaCreada = z.infer<typeof cuentaCreadaSchema>

/**
 * El motivo por el que no se pudo, ya traducido a un código estable.
 *
 * Se queda con el código y nunca con el mensaje del servidor: viene en un solo
 * idioma y puede cambiar sin aviso, y el texto que se lee en pantalla sale de
 * i18n.
 */
export class CreateAccountError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'CreateAccountError'
    this.code = code
  }
}

/**
 * El código del fallo, traducido a lo que hay que leer.
 *
 * `CUENTA_YA_EXISTE` tiene entrada propia porque no es un error del que lo
 * intenta: significa que esa persona ya puede entrar y que el paso siguiente
 * —darle acceso— sí va a funcionar. Tratarlo como un fallo genérico mandaría a
 * investigar algo que ya está resuelto.
 */
export function mapCreateAccountCode(code: string): MessageKey {
  switch (code) {
    case 'CUENTA_YA_EXISTE':
      return 'account.create.error.exists'
    case 'CORREO_DE_SUITE':
      return 'account.create.error.suite'
    case 'SIN_PERMISO':
    case 'NO_AUTENTICADO':
      return 'account.create.error.forbidden'
    case 'CAMPO_INVALIDO':
    case 'CAMPO_NO_PERMITIDO':
      return 'account.create.error.email'
    default:
      return 'account.create.error.generic'
  }
}

/**
 * Ni la organización ni la sociedad viajan en la llamada: las toma el servidor
 * del token. La regla del proyecto prohíbe que el tenant llegue por parámetro a
 * algo que alcanza el cliente, y la función de borde rechaza el cuerpo entero
 * si aparece uno.
 */
export function useCreateAccount() {
  return useMutation<CuentaCreada, CreateAccountError, string>({
    mutationFn: async (email: string) => {
      const { data, error } = await getSupabaseClient().functions.invoke<{ data: unknown }>(
        CREATE_USER_FUNCTION,
        { body: { email: email.trim().toLowerCase() } },
      )

      if (error) throw new CreateAccountError(await codeFromInvokeError(error))

      const parsed = cuentaCreadaSchema.safeParse(data?.data)
      if (!parsed.success) throw new CreateAccountError('RESPUESTA_INVALIDA')
      return parsed.data
    },
  })
}
