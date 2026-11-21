import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { codeFromDbError } from '@/shared/lib/appError'
import { EMAIL_TEMPLATE_RESET_RPC, EMAIL_TEMPLATE_SAVE_RPC, EMAIL_TEMPLATES_TABLE } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'

/**
 * Textos de correo de la tienda (2026-11-20). Lectura de lo guardado y los dos
 * comandos (`email_template_save` / `email_template_reset`), que comprueban
 * tienda, rol, largo y variables en la base. El motor que arma el correo es
 * `supabase/functions/_shared/notifications/customCopy.ts`, el mismo del envío.
 */
const rowSchema = z.object({
  kind: z.string(),
  locale: z.enum(['es', 'en']),
  subject: z.string(),
  title: z.string(),
  body: z.string(),
  updated_at: z.string(),
})
export type EmailTemplateRow = z.infer<typeof rowSchema>

export interface EmailTemplateInput {
  readonly kind: string
  readonly locale: 'es' | 'en'
  readonly subject: string
  readonly title: string
  readonly body: string
}

function client() {
  const c = tryGetSupabaseClient()
  if (!c) throw new Error('CONFIG_INCOMPLETA')
  return c
}

export async function fetchEmailTemplates(storeId: string): Promise<EmailTemplateRow[]> {
  const { data, error } = await client()
    .from(EMAIL_TEMPLATES_TABLE)
    .select('kind, locale, subject, title, body, updated_at')
    .eq('store_id', storeId)
  if (error) throw new Error(codeFromDbError(error))
  return z.array(rowSchema).parse(data ?? [])
}

export async function saveEmailTemplate(storeId: string, input: EmailTemplateInput): Promise<void> {
  const { error } = await client().rpc(EMAIL_TEMPLATE_SAVE_RPC, {
    p_store_id: storeId,
    p_kind: input.kind,
    p_locale: input.locale,
    p_subject: input.subject,
    p_title: input.title,
    p_body: input.body,
  })
  if (error) throw new Error(codeFromDbError(error))
}

export async function resetEmailTemplate(storeId: string, kind: string, locale: 'es' | 'en'): Promise<void> {
  const { error } = await client().rpc(EMAIL_TEMPLATE_RESET_RPC, {
    p_store_id: storeId,
    p_kind: kind,
    p_locale: locale,
  })
  if (error) throw new Error(codeFromDbError(error))
}

const keyOf = (storeId: string | null) => ['notifications', 'email-templates', storeId] as const

export function useEmailTemplates(storeId: string | null) {
  return useQuery({
    queryKey: keyOf(storeId),
    enabled: Boolean(storeId),
    queryFn: () => fetchEmailTemplates(storeId as string),
  })
}

export function useSaveEmailTemplate(storeId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EmailTemplateInput) => saveEmailTemplate(storeId as string, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keyOf(storeId) }),
  })
}

export function useResetEmailTemplate(storeId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { kind: string; locale: 'es' | 'en' }) =>
      resetEmailTemplate(storeId as string, input.kind, input.locale),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keyOf(storeId) }),
  })
}
