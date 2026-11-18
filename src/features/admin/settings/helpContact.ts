import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { matchesRule } from '@/shared/lib/fieldRules'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { SOCIAL_NETWORKS, sanitizeSocialLinks, type SocialLink } from '@/features/storefront/identity'

/**
 * Atención al cliente y datos legales de la tienda (2026-10-02).
 *
 * Seis columnas de `store_settings` (migración 20261002120000) que pinta el pie
 * de la vitrina y la hoja del Libro de Reclamaciones. Van en su propia sección
 * con su propio guardado: el formulario principal de Ajustes ya es grande y
 * estos datos no dependen de él.
 *
 * El filtro de tenant es la TIENDA (`store_id`), y la RLS de `store_settings`
 * exige owner/admin del tenant del JWT para escribir.
 */
export const HELP_COLUMNS = 'legal_name, tax_id, whatsapp_phone, help_note, business_hours, social_links'

export interface HelpContact {
  readonly legal_name: string
  readonly tax_id: string
  readonly whatsapp_phone: string
  readonly help_note: string
  readonly business_hours: string
  readonly social_links: SocialLink[]
}

const rowSchema = z.object({
  legal_name: z.string().nullable().catch(null),
  tax_id: z.string().nullable().catch(null),
  whatsapp_phone: z.string().nullable().catch(null),
  help_note: z.string().nullable().catch(null),
  business_hours: z.string().nullable().catch(null),
  social_links: z.unknown(),
})

/** Las mismas reglas que los CHECK de la base, para avisar en el campo. */
export const helpContactSchema = z.object({
  legal_name: z.string().trim().refine((v) => v === '' || (v.length >= 2 && v.length <= 160)),
  // El RUC del negocio: once dígitos con dígito verificador (más estricto que el CHECK).
  tax_id: z.string().trim().refine((v) => v === '' || matchesRule('ruc', v)),
  whatsapp_phone: z.string().trim().refine((v) => v === '' || /^\+?[0-9][0-9 ]{5,19}$/.test(v)),
  help_note: z.string().trim().max(160),
  business_hours: z.string().trim().max(240),
  social_links: z
    .array(
      z.object({
        network: z.enum(SOCIAL_NETWORKS),
        url: z.string().trim().regex(/^https:\/\/\S+$/).max(300),
      }),
    )
    .max(6)
    .refine((links) => new Set(links.map((l) => l.network)).size === links.length),
})

/**
 * El RUC ya guardado no se vuelve a exigir con dígito verificador: hay tiendas
 * de ejemplo con RUC inventados y no deben quedarse sin poder guardar el resto
 * de la sección. En cuanto se cambia, se valida entero.
 */
export function helpContactSchemaFor(savedTaxId: string | null | undefined) {
  const saved = (savedTaxId ?? '').trim()
  return helpContactSchema.extend({
    tax_id: z.string().trim().refine((v) => v === '' || v === saved || matchesRule('ruc', v)),
  })
}

const key = (storeId: string | null) => ['admin', 'help-contact', storeId] as const

export function useHelpContact(storeId: string | null) {
  return useQuery({
    queryKey: key(storeId),
    enabled: Boolean(storeId),
    queryFn: async (): Promise<HelpContact> => {
      const client = tryGetSupabaseClient()
      if (!client || !storeId) throw new Error('SIN_BACKEND')
      const { data, error } = await client.from('store_settings').select(HELP_COLUMNS).eq('store_id', storeId).maybeSingle()
      if (error) throw error
      const row = rowSchema.parse(data ?? {})
      return {
        legal_name: row.legal_name ?? '',
        tax_id: row.tax_id ?? '',
        whatsapp_phone: row.whatsapp_phone ?? '',
        help_note: row.help_note ?? '',
        business_hours: row.business_hours ?? '',
        social_links: sanitizeSocialLinks(row.social_links),
      }
    },
  })
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

export function useSaveHelpContact(storeId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: HelpContact) => {
      const client = tryGetSupabaseClient()
      if (!client || !storeId) throw new Error('SIN_BACKEND')
      const { error } = await client
        .from('store_settings')
        .update({
          legal_name: orNull(values.legal_name),
          tax_id: orNull(values.tax_id),
          whatsapp_phone: orNull(values.whatsapp_phone),
          help_note: orNull(values.help_note),
          business_hours: orNull(values.business_hours.replace(/\r\n/g, '\n')),
          social_links: values.social_links.map((l) => ({ network: l.network, url: l.url.trim() })),
        })
        .eq('store_id', storeId)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(storeId) }),
  })
}
