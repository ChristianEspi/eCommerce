/**
 * Acceso a base de datos: SOLO las tres RPC de la migración
 * `20260924120000_masteradmin_generic_provisioning`.
 *
 * Recibe un cliente mínimo `{ rpc }` en vez de importar supabase-js: la lógica
 * se prueba sin red e `index.ts` es el único lugar que conoce la service-role.
 */
import type { CreateTenantCommand, CreateTenantContext } from './contract.ts'

export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export interface ProvisioningMeta {
  idempotencyKey: string
  requestHash: string
  correlationId: string
  m2mSubject: string
  m2mJti: string
  actorId: string | null
  actorRole: string | null
}

/** Vista estándar que devuelve `platform_provisioning.view`. */
export interface ProvisioningRecord {
  provisioningId: string
  status: string
  controlPlaneTenantId: string
  externalTenantId: string | null
  externalOrganizationId: string | null
  externalCompanyId: string | null
  resources: Record<string, unknown>
  adminProvisioningStatus: string
  deploymentMode: string
  rawReference: string | null
  requestHash: string
  createdAt: string
  completedAt: string | null
}

export type ProvisionOutcome =
  | { outcome: 'CREATED' | 'REPLAYED'; provisioning: ProvisioningRecord }
  | { outcome: 'CONFLICT'; errorCode: string; provisioningId?: string | null }

export interface AuditEntry {
  operation: 'CREATE_TENANT' | 'GET_TENANT_STATUS'
  result: 'FOUND' | 'REJECTED' | 'CONFLICT' | 'ERROR'
  errorCode?: string | null
  httpStatus: number
  provisioningId?: string | null
  controlPlaneTenantId?: string | null
  idempotencyKey?: string | null
  correlationId: string
  m2mSubject: string
  m2mJti: string
  actorId: string | null
  actorRole: string | null
}

export interface ProvisioningRepository {
  provisionTenant(
    command: CreateTenantCommand,
    context: CreateTenantContext,
    meta: ProvisioningMeta,
  ): Promise<ProvisionOutcome>
  getProvisioning(controlPlaneTenantId: string): Promise<ProvisioningRecord | null>
  recordAudit(entry: AuditEntry): Promise<void>
}

export class RepositoryError extends Error {}

export function createRpcRepository(client: RpcClient): ProvisioningRepository {
  return {
    async provisionTenant(command, context, meta) {
      // El contexto viaja DENTRO del payload guardado pero fuera del hash.
      const { data, error } = await client.rpc('platform_provision_tenant', {
        p_payload: { ...command, context },
        p_meta: meta,
      })
      // El mensaje de Postgres NO sale hacia MasterAdmin (describiría el esquema).
      if (error || !data) throw new RepositoryError(error?.message ?? 'empty result')
      return data as ProvisionOutcome
    },
    async getProvisioning(controlPlaneTenantId) {
      const { data, error } = await client.rpc('platform_get_provisioning', {
        p_control_plane_tenant_id: controlPlaneTenantId,
      })
      if (error) throw new RepositoryError(error.message)
      return (data as ProvisioningRecord | null) ?? null
    },
    async recordAudit(entry) {
      const { error } = await client.rpc('platform_record_provisioning_audit', { p_entry: entry })
      if (error) throw new RepositoryError(error.message)
    },
  }
}
