import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  CART_RECOVERY_CONFIGURE_RPC,
  CART_RECOVERY_OVERVIEW_RPC,
  CART_RECOVERY_UNSUBSCRIBE_RPC,
  MY_CART_REMINDERS_RPC,
  SET_MY_CART_REMINDERS_RPC,
} from '@/shared/lib/db-schema'
import { getSupabaseClient, tryGetStorefrontClient } from '@/shared/lib/supabase'

/**
 * Recuperación de carritos abandonados, en el navegador (cierre, ítem 8).
 *
 * Toda la decisión —a quién se escribe, cuándo no, cuántas veces— vive en la
 * base (`20260914160000_cart_recovery.sql`). Aquí solo hay tres puertas:
 *
 *  · Configuración (owner/admin): encender, ajustar la ventana y ver los números.
 *    La tienda es alcance de pantalla; el permiso lo decide la base con el JWT.
 *  · «Tu cuenta» (sesión): recibir o no recordatorios de ESTA tienda.
 *  · La baja de un clic (sin sesión): el secreto que trae el correo.
 *
 * Ninguna manda un usuario ni un tenant.
 */

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const countsSchema = z.object({
  queued: z.number(),
  sent: z.number(),
  failed: z.number(),
  expired: z.number(),
  suppressed: z.number(),
})

const overviewSchema = z.object({
  enabled: z.boolean(),
  delay_hours: z.number().int(),
  max_age_days: z.number().int(),
  window_days: z.number().int(),
  counts: countsSchema,
  opted_out: z.number(),
})

export type CartRecoveryOverview = z.infer<typeof overviewSchema>

/** Los límites de la base, repetidos para avisar en el campo y no tras un 400. */
export const DELAY_HOURS_RANGE = { min: 1, max: 72 } as const
export const MAX_AGE_DAYS_RANGE = { min: 1, max: 30 } as const

export function isValidWindow(delayHours: number, maxAgeDays: number): boolean {
  return (
    Number.isInteger(delayHours) &&
    Number.isInteger(maxAgeDays) &&
    delayHours >= DELAY_HOURS_RANGE.min &&
    delayHours <= DELAY_HOURS_RANGE.max &&
    maxAgeDays >= MAX_AGE_DAYS_RANGE.min &&
    maxAgeDays <= MAX_AGE_DAYS_RANGE.max &&
    maxAgeDays * 24 > delayHours
  )
}

export const cartRecoveryKey = (storeId: string | null) => ['cart-recovery', storeId] as const

export function useCartRecoveryOverview(storeId: string | null) {
  return useQuery({
    queryKey: cartRecoveryKey(storeId),
    enabled: Boolean(storeId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc(CART_RECOVERY_OVERVIEW_RPC, { p_store_id: storeId })
      if (error) throw error
      return overviewSchema.parse(data)
    },
  })
}

export interface CartRecoverySettingsInput {
  readonly enabled: boolean
  readonly delayHours: number
  readonly maxAgeDays: number
}

export function useConfigureCartRecovery(storeId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CartRecoverySettingsInput) => {
      const { data, error } = await getSupabaseClient().rpc(CART_RECOVERY_CONFIGURE_RPC, {
        p_store_id: storeId,
        p_enabled: input.enabled,
        p_delay_hours: input.delayHours,
        p_max_age_days: input.maxAgeDays,
      })
      if (error) throw error
      return overviewSchema.parse(data)
    },
    onSuccess: (overview) => queryClient.setQueryData(cartRecoveryKey(storeId), overview),
  })
}

// ---------------------------------------------------------------------------
// «Tu cuenta»
// ---------------------------------------------------------------------------

const preferenceSchema = z.object({
  store_enabled: z.boolean(),
  receive: z.boolean(),
})

export type CartReminderPreference = z.infer<typeof preferenceSchema>

export const cartReminderKey = (storeSlug: string | null) => ['cart-reminders', storeSlug] as const

export function useCartReminderPreference(storeSlug: string | null, enabled: boolean) {
  return useQuery({
    queryKey: cartReminderKey(storeSlug),
    enabled: enabled && Boolean(storeSlug),
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc(MY_CART_REMINDERS_RPC, { p_store_slug: storeSlug })
      if (error) throw error
      return preferenceSchema.parse(data)
    },
  })
}

export function useSetCartReminderPreference(storeSlug: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (receive: boolean) => {
      const { data, error } = await getSupabaseClient().rpc(SET_MY_CART_REMINDERS_RPC, {
        p_store_slug: storeSlug,
        p_receive: receive,
      })
      if (error) throw error
      return preferenceSchema.parse(data)
    },
    onSuccess: (preference) => queryClient.setQueryData(cartReminderKey(storeSlug), preference),
  })
}

// ---------------------------------------------------------------------------
// Baja de un clic
// ---------------------------------------------------------------------------

/** Mismo formato que exige la base: 64 hexadecimales en minúscula. */
export function isUnsubscribeToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

export async function unsubscribeCartReminders(token: string): Promise<boolean> {
  const client = tryGetStorefrontClient()
  if (!client) throw new Error('CONFIG_INCOMPLETA')
  const { data, error } = await client.rpc(CART_RECOVERY_UNSUBSCRIBE_RPC, { p_token: token })
  if (error) throw error
  return z.object({ unsubscribed: z.boolean() }).parse(data).unsubscribed
}