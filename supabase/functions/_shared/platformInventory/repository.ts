/**
 * Acceso a base de datos de `tenant-inventory.v1`: SOLO las RPC de la migración
 * `20261116110000_tenant_inventory_and_link` (service_role), la bitácora de
 * provisioning y el registro de `jti` de un solo uso que comparten entitlements
 * y lifecycle (un `jti` es de un solo uso en TODO el canal M2M).
 *
 * Mismo cliente mínimo `{ rpc }` que los demás canales: la lógica se prueba sin
 * red y `platform-provisioning/index.ts` es el único lugar con la service-role.
 */
import type { RpcClient } from '../platformProvisioning/repository.ts'
import type { InventoryStatus } from './contract.ts'

export interface InventoryItem {
  externalTenantId: string
  externalOrganizationId: string | null
  externalCompanyId: string | null
  controlPlaneTenantId: string | null
  code: string | null
  name: string | null
  status: InventoryStatus
}

export interface InventoryPage {
  items: InventoryItem[]
  hasMore: boolean
}

export interface LinkMeta {
  requestId: string
  correlationId: string
  m2mSubject: string
  m2mJti: string
  actorId: string | null
  actorRole: string | null
}

export interface LinkResult {
  httpStatus: number
  body: Record<string, unknown>
}

export interface LinkAuditEntry {
  operation: 'LINK_TENANT'
  result: 'REJECTED' | 'ERROR'
  errorCode: string
  httpStatus: number
  controlPlaneTenantId: string | null
  idempotencyKey: string | null
  correlationId: string
  m2mSubject: string
  m2mJti: string
  actorId: string | null
  actorRole: string | null
}

export interface InventoryRepository {
  /** `true` = primer uso del `jti`; `false` = reutilizado. */
  useJti(issuer: string, jti: string, expiresAt: string): Promise<boolean>
  list(after: string | null, limit: number): Promise<InventoryPage>
  link(controlPlaneTenantId: string, externalTenantId: string, fallbackCompanyId: string, meta: LinkMeta): Promise<LinkResult>
  recordAudit(entry: LinkAuditEntry): Promise<void>
}

export class InventoryRepositoryError extends Error {}

export function createInventoryRpcRepository(client: RpcClient): InventoryRepository {
  return {
    async useJti(issuer, jti, expiresAt) {
      const { data, error } = await client.rpc('platform_entitlements_use_jti', {
        p_issuer: issuer,
        p_jti: jti,
        p_expires_at: expiresAt,
      })
      if (error || typeof data !== 'boolean') throw new InventoryRepositoryError(error?.message ?? 'empty result')
      return data
    },
    async list(after, limit) {
      const { data, error } = await client.rpc('platform_list_tenants', { p_after: after, p_limit: limit })
      const page = data as InventoryPage | null
      // El mensaje de Postgres NO sale hacia MasterAdmin (describiría el esquema).
      if (error || !page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean') {
        throw new InventoryRepositoryError(error?.message ?? 'empty result')
      }
      return page
    },
    async link(controlPlaneTenantId, externalTenantId, fallbackCompanyId, meta) {
      const { data, error } = await client.rpc('platform_link_tenant', {
        p_control_plane_tenant_id: controlPlaneTenantId,
        p_external_tenant_id: externalTenantId,
        p_fallback_company: fallbackCompanyId,
        p_meta: meta,
      })
      const result = data as LinkResult | null
      if (error || !result || typeof result.httpStatus !== 'number' || typeof result.body !== 'object') {
        throw new InventoryRepositoryError(error?.message ?? 'empty result')
      }
      return result
    },
    async recordAudit(entry) {
      const { error } = await client.rpc('platform_record_provisioning_audit', { p_entry: entry })
      if (error) throw new InventoryRepositoryError(error.message)
    },
  }
}
