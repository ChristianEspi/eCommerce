import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import type { MessageKey } from '@/shared/i18n/messages'
import { UiError } from '@/shared/lib/appError'
import { MY_TENANT_LIFECYCLE_RPC } from '@/shared/lib/db-schema'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import { useTenant } from './tenant-context'

/**
 * Estado operativo del tenant que ordena EBIM MasterAdmin (`lifecycle.v1`).
 *
 * Solo UX: alimenta el aviso fijo «Cuenta suspendida». Quien bloquea de verdad
 * es el guardián de la base (`ebim.enforce_tenant_lifecycle`), que rechaza
 * TODA escritura de un tenant suspendido con `TENANT_SUSPENDED` aunque la
 * pantalla no se haya enterado todavía.
 */
export const TENANT_LIFECYCLE_STATES = ['ACTIVE', 'SUSPENDED'] as const
export const TENANT_LIFECYCLE_REASONS = ['NON_PAYMENT', 'MANUAL', 'TERMINATED'] as const

const lifecycleSchema = z.object({
  state: z.enum(TENANT_LIFECYCLE_STATES),
  reason: z.enum(TENANT_LIFECYCLE_REASONS).nullable(),
  applied_at: z.string().nullable(),
})

export type TenantLifecycle = z.infer<typeof lifecycleSchema>
export type TenantLifecycleReason = (typeof TENANT_LIFECYCLE_REASONS)[number]

/** El texto del aviso según la causa. Con impago: «regularice el pago con su proveedor». */
export function suspensionMessageKey(reason: TenantLifecycleReason | null): MessageKey {
  switch (reason) {
    case 'NON_PAYMENT':
      return 'tenantLifecycle.suspended.nonPayment'
    case 'TERMINATED':
      return 'tenantLifecycle.suspended.terminated'
    default:
      return 'tenantLifecycle.suspended.manual'
  }
}

export class TenantLifecycleError extends UiError {
  constructor(code: string) {
    super({ boundary: 'tenancy', key: 'common.error.body', code })
    this.name = 'TenantLifecycleError'
  }
}

/** NULL = sin sesión de tenant (la base no responde por quien no es miembro). */
export async function fetchTenantLifecycle(): Promise<TenantLifecycle | null> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) return null
  const { data, error } = await supabase.rpc(MY_TENANT_LIFECYCLE_RPC)
  if (error) throw new TenantLifecycleError(error.code ?? 'ERROR_INTERNO')
  if (data === null || data === undefined) return null
  return lifecycleSchema.parse(data)
}

export const tenantLifecycleKey = (companyId: string | null) => ['tenant-lifecycle', companyId] as const

/**
 * Se refresca cada cinco minutos y al volver a la pestaña: MasterAdmin entrega
 * el cambio en ≤ 5 min, así que el aviso aparece (y se va al reactivar) sin
 * recargar la página.
 */
export function useTenantLifecycle() {
  const { activeCompanyId } = useTenant()
  return useQuery({
    queryKey: tenantLifecycleKey(activeCompanyId ?? null),
    queryFn: fetchTenantLifecycle,
    enabled: Boolean(activeCompanyId),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
}
