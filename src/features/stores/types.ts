import { z } from 'zod'

/**
 * Tiendas de la sociedad activa, tal como las administra el backoffice.
 *
 * Es más que `StoreSummary` (el selector): trae dominio y fechas, que el
 * selector no necesita y el listado sí.
 */
export const STORE_STATUSES = ['draft', 'active', 'suspended'] as const
export type StoreStatus = (typeof STORE_STATUSES)[number]

export const managedStoreSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  company_id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(STORE_STATUSES),
  currency: z.string().length(3),
  domain: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type ManagedStore = z.infer<typeof managedStoreSchema>

/** La misma regla que el CHECK `stores_slug_format` y `create_store`. */
export const STORE_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/

/** La misma regla que `ebim.store_domain_or_fail`. */
export const STORE_DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export const storeFormSchema = z.object({
  name: z.string().trim().min(1, 'storesAdmin.error.nameRequired').max(200, 'storesAdmin.error.nameLong'),
  slug: z.string().trim().toLowerCase().regex(STORE_SLUG_RE, 'storesAdmin.error.slugFormat'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'storesAdmin.error.currency'),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === '' || (value.length <= 253 && STORE_DOMAIN_RE.test(value)), 'storesAdmin.error.domainFormat'),
})
export type StoreFormValues = z.infer<typeof storeFormSchema>

export function emptyStoreForm(currency = 'PEN'): StoreFormValues {
  return { name: '', slug: '', currency, domain: '' }
}

export function storeToForm(store: ManagedStore): StoreFormValues {
  return { name: store.name, slug: store.slug, currency: store.currency, domain: store.domain ?? '' }
}
