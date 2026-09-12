import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { codeFromInvokeError } from '@/shared/lib/edgeError'
import { NOTIFICATIONS_TABLE } from '@/shared/lib/db-schema'
import { getSupabaseClient } from '@/shared/lib/supabase'

/**
 * Los avisos de la persona con sesión.
 *
 * ## Nada de filtros de identidad aquí
 *
 * Ninguna consulta dice «de este usuario»: lo decide la RLS con el token. Lo
 * único que se filtra es DÓNDE se enseña —backoffice o tienda— y, en el
 * backoffice, la sociedad activa, que es alcance de pantalla y no autorización.
 *
 * ## Por qué se consulta cada minuto y no en tiempo real
 *
 * Un aviso que llega con un minuto de retraso sigue siendo útil, y una consulta
 * por minuto por pestaña abierta es un coste que se entiende. El canal en
 * tiempo real exigiría publicar la tabla y mantener una conexión por usuario,
 * y no cambia nada de lo que el aviso permite hacer.
 */

export type Audience = 'backoffice' | 'storefront'

const notificationSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  params: z.record(z.string(), z.unknown()).catch({}),
  link: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
})

export type AppNotification = z.infer<typeof notificationSchema>

export const notificationsKey = (audience: Audience, companyId: string | null) =>
  ['notifications', audience, companyId] as const

/** Los últimos 30. Más que eso no se lee en una lista desplegable. */
export const NOTIFICATIONS_LIMIT = 30

export async function fetchNotifications(
  audience: Audience,
  companyId: string | null,
): Promise<AppNotification[]> {
  let query = getSupabaseClient()
    .from(NOTIFICATIONS_TABLE)
    .select('id, kind, params, link, read_at, created_at')
    .eq('audience', audience)
    .is('archived_at', null)
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(NOTIFICATIONS_LIMIT)
  if (error) throw error
  return notificationSchema.array().parse(data ?? [])
}

export function useNotifications(audience: Audience, companyId: string | null, enabled = true) {
  return useQuery({
    queryKey: notificationsKey(audience, companyId),
    queryFn: () => fetchNotifications(audience, companyId),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useMarkNotificationsRead(audience: Audience, companyId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    /** Sin ids: todos los no leídos de esta bandeja. */
    mutationFn: async (ids?: string[]) => {
      let query = getSupabaseClient()
        .from(NOTIFICATIONS_TABLE)
        .update({ read_at: new Date().toISOString() })
        .eq('audience', audience)
        .is('read_at', null)
      if (companyId) query = query.eq('company_id', companyId)
      if (ids && ids.length > 0) query = query.in('id', ids)
      const { error } = await query
      if (error) throw error
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: notificationsKey(audience, companyId) }),
  })
}

// ---------------------------------------------------------------------------
// Estado del correo, para el botón «Probar» de Configuración
// ---------------------------------------------------------------------------

export const NOTIFICATIONS_TEST_FUNCTION = 'notifications-test'

const mailStatusSchema = z.object({
  configured: z.boolean(),
  missing: z.array(z.string()),
  sender_email: z.string().nullable(),
  sender_name: z.string().nullable(),
  sent: z.boolean(),
  code: z.string().nullable(),
})

export type MailStatus = z.infer<typeof mailStatusSchema>

export class MailStatusError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'MailStatusError'
    this.code = code
  }
}

async function invokeMailTest(send: boolean): Promise<MailStatus> {
  const { data, error } = await getSupabaseClient().functions.invoke<{ data: unknown }>(
    NOTIFICATIONS_TEST_FUNCTION,
    { body: { send } },
  )
  if (error) throw new MailStatusError(await codeFromInvokeError(error))
  const parsed = mailStatusSchema.safeParse(data?.data)
  if (!parsed.success) throw new MailStatusError('RESPUESTA_INVALIDA')
  return parsed.data
}

export function useMailStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['mail-status'],
    queryFn: () => invokeMailTest(false),
    enabled,
    retry: false,
  })
}

export function useSendTestMail() {
  const queryClient = useQueryClient()
  return useMutation<MailStatus, MailStatusError>({
    mutationFn: () => invokeMailTest(true),
    onSuccess: (status) => queryClient.setQueryData(['mail-status'], status),
  })
}
