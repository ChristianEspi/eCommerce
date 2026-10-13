/**
 * Acceso a base de datos del receptor `lifecycle.v1`: SOLO las RPC de la
 * migración `20261013100000_tenant_lifecycle` (service_role) y el registro de
 * `jti` de un solo uso que ya usa entitlements (`platform_entitlements_use_jti`:
 * un `jti` es de un solo uso en TODO el canal M2M, sea cual sea la ruta).
 *
 * Mismo cliente mínimo `{ rpc }` que provisioning y entitlements: la lógica se
 * prueba sin red y `platform-provisioning/index.ts` es el único lugar que
 * conoce la service-role.
 */
import type { RpcClient } from '../platformProvisioning/repository.ts'
import type { LifecycleCommand, LifecycleReason, LifecycleState } from './contract.ts'

export interface LifecycleMeta {
  correlationId: string
  m2mSubject: string
  m2mJti: string
  actorId: string | null
  actorRole: string | null
}

export interface LifecycleApplyResult {
  httpStatus: number
  body: Record<string, unknown>
}

export interface LifecycleAppliedState {
  appliedVersion: number | null
  state: LifecycleState
  reason: LifecycleReason | null
  appliedAt: string | null
}

export interface LifecycleRepository {
  /** `true` = primer uso del `jti`; `false` = reutilizado. */
  useJti(issuer: string, jti: string, expiresAt: string): Promise<boolean>
  apply(controlPlaneTenantId: string, command: LifecycleCommand, meta: LifecycleMeta): Promise<LifecycleApplyResult>
  /** null = tenant sin provisioning local. */
  getApplied(controlPlaneTenantId: string): Promise<LifecycleAppliedState | null>
}

export class LifecycleRepositoryError extends Error {}

export function createLifecycleRpcRepository(client: RpcClient): LifecycleRepository {
  return {
    async useJti(issuer, jti, expiresAt) {
      const { data, error } = await client.rpc('platform_entitlements_use_jti', {
        p_issuer: issuer,
        p_jti: jti,
        p_expires_at: expiresAt,
      })
      if (error || typeof data !== 'boolean') throw new LifecycleRepositoryError(error?.message ?? 'empty result')
      return data
    },
    async apply(controlPlaneTenantId, command, meta) {
      const { data, error } = await client.rpc('platform_apply_lifecycle', {
        p_control_plane_tenant_id: controlPlaneTenantId,
        p_command: command,
        p_meta: meta,
      })
      // El mensaje de Postgres NO sale hacia MasterAdmin (describiría el esquema).
      const result = data as LifecycleApplyResult | null
      if (error || !result || typeof result.httpStatus !== 'number' || typeof result.body !== 'object') {
        throw new LifecycleRepositoryError(error?.message ?? 'empty result')
      }
      return result
    },
    async getApplied(controlPlaneTenantId) {
      const { data, error } = await client.rpc('platform_get_lifecycle', {
        p_control_plane_tenant_id: controlPlaneTenantId,
      })
      if (error) throw new LifecycleRepositoryError(error.message)
      return (data as LifecycleAppliedState | null) ?? null
    },
  }
}
