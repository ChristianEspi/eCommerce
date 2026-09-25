import { AppError } from '@/domain/errors'
import { codeFromDbError } from '@/shared/lib/appError'
import { tryGetSupabaseClient } from '@/shared/lib/supabase'
import type { AppRole } from '@/shared/lib/roles'
import { CLAIM_PROVISIONED_TENANT_RPC } from '@/shared/lib/db-schema'
import {
  STORES_TABLE,
  TENANTS_TABLE,
  TENANT_MEMBERS_TABLE,
  membershipSchema,
  storeSummarySchema,
  tenantSummarySchema,
  type Membership,
  type StoreSummary,
  type TenantContext,
  type TenantSummary,
  type Workspace,
} from './types'

export const WORKSPACE_KEY_ROOT = ['workspace'] as const
export const workspaceKey = (organizationId: string) =>
  [...WORKSPACE_KEY_ROOT, organizationId] as const

export class BackendNotConfiguredError extends AppError {
  constructor() {
    super({
      boundary: 'tenancy',
      code: 'CONFIG_INCOMPLETA',
      message: 'El proyecto Supabase de eCommerce todavía no está configurado.',
    })
    this.name = 'BackendNotConfiguredError'
  }
}

/**
 * Carga el espacio de trabajo del usuario.
 *
 * Ninguna de las tres consultas lleva un filtro de tenant: `tenants`,
 * `tenant_members` y `stores` están bajo RLS y devuelven exactamente lo que el
 * JWT autoriza. El único `eq` es `user_id`, y no es un filtro de seguridad sino
 * de alcance: la policy de `tenant_members` deja ver a los compañeros de la
 * misma sociedad, y aquí solo interesan las membresías propias.
 */
export async function fetchWorkspace(userId: string): Promise<Workspace> {
  const supabase = tryGetSupabaseClient()
  if (!supabase) throw new BackendNotConfiguredError()

  const workspace = await loadWorkspace(supabase, userId)
  if (workspace.memberships.length > 0) return workspace

  // Sin membresia puede ser el administrador que EBIM MasterAdmin dejo
  // PREPROVISIONED: el tenant existe y le espera a el. El reclamo no lleva
  // argumentos —la base cruza organizacion, sociedad y correo del JWT con lo
  // aprovisionado— y responde `claimed: false` a cualquier otro. Si falla, se
  // sigue como antes: onboarding.
  const { data, error } = await supabase.rpc(CLAIM_PROVISIONED_TENANT_RPC)
  const claimed =
    !error && typeof data === 'object' && data !== null && (data as { claimed?: unknown }).claimed === true
  return claimed ? loadWorkspace(supabase, userId) : workspace
}

async function loadWorkspace(
  supabase: NonNullable<ReturnType<typeof tryGetSupabaseClient>>,
  userId: string,
): Promise<Workspace> {
  const [tenantsRes, membersRes, storesRes] = await Promise.all([
    supabase.from(TENANTS_TABLE).select('organization_id, slug, name, status'),
    supabase
      .from(TENANT_MEMBERS_TABLE)
      .select('organization_id, company_id, user_id, role, status')
      .eq('user_id', userId)
      .eq('status', 'active'),
    supabase.from(STORES_TABLE).select('id, organization_id, company_id, slug, name, status, currency'),
  ])

  const failure = tenantsRes.error ?? membersRes.error ?? storesRes.error
  // El código, nunca el `message`: un error de PostgREST lleva dentro nombres
  // de tabla y de policy, y el espacio de trabajo se carga en cada arranque.
  if (failure) throw new AppError({ boundary: 'tenancy', code: codeFromDbError(failure) })

  const tenants: TenantSummary[] = tenantSummarySchema.array().parse(tenantsRes.data ?? [])
  const memberships: Membership[] = membershipSchema.array().parse(membersRes.data ?? [])
  const stores: StoreSummary[] = storeSummarySchema.array().parse(storesRes.data ?? [])

  return { tenant: tenants[0] ?? null, memberships, stores }
}

export type TenantStatus = 'loading' | 'error' | 'unauthorized' | 'onboarding' | 'ready'

export interface TenantSelection {
  status: TenantStatus
  tenant: TenantSummary | null
  memberships: Membership[]
  /** Sociedades donde el usuario tiene rol EN eCommerce, no todas las del hub. */
  companies: string[]
  activeCompanyId: string | null
  role: AppRole | null
  stores: StoreSummary[]
  activeStore: StoreSummary | null
}

const EMPTY: TenantSelection = {
  status: 'loading',
  tenant: null,
  memberships: [],
  companies: [],
  activeCompanyId: null,
  role: null,
  stores: [],
  activeStore: null,
}

/**
 * Resuelve qué tenant, sociedad y tienda están activos. Función pura: el
 * provider solo le pasa lo que ya tiene y renderiza el resultado.
 *
 * Reglas, en orden:
 *  1. sin claims completos → `unauthorized`. Un token sin `org_id` no es un
 *     usuario nuevo: es un token que no sirve para esta app.
 *  2. sin tenant o sin membresía activa → `onboarding`.
 *  3. sociedad activa = la del claim si el usuario tiene rol ahí; si no, la
 *     única que tenga; si tiene varias, la primera de forma estable. Nunca se
 *     lee de localStorage ni de la URL.
 *  4. tienda activa = la elegida en el selector si sigue siendo suya; si no,
 *     la que este navegador recuerde para esa sociedad; si no, la primera.
 *     Selección automática cuando solo hay una.
 *
 * La preferencia guardada NO manda: se busca en las tiendas que devolvió la
 * RLS, y si no está —archivada, de otra sociedad, o escrita a mano en
 * `localStorage`— se cae a la primera. El navegador propone, la RLS dispone.
 */
export function resolveTenantSelection(input: {
  claims: TenantContext | null
  workspace: Workspace | null | undefined
  isLoading: boolean
  isError: boolean
  companyOverride?: string | null
  storeOverride?: string | null
  /** Tienda recordada por sociedad. Preferencia de pantalla, no autorización. */
  storePreferences?: Readonly<Record<string, string>>
}): TenantSelection {
  const {
    claims,
    workspace,
    isLoading,
    isError,
    companyOverride,
    storeOverride,
    storePreferences,
  } = input

  if (!claims) return { ...EMPTY, status: 'unauthorized' }
  if (isError) return { ...EMPTY, status: 'error' }
  if (isLoading || !workspace) return EMPTY

  const memberships = [...workspace.memberships]
    .filter((m) => m.status === 'active' && m.organization_id === claims.organization_id)
    // La sociedad tiene que estar además en el token: una membresía viva para
    // una sociedad que el hub ya no otorga no da acceso.
    .filter((m) => claims.companies.includes(m.company_id))
    .sort((a, b) => a.company_id.localeCompare(b.company_id))

  const tenant =
    workspace.tenant && workspace.tenant.organization_id === claims.organization_id
      ? workspace.tenant
      : null

  if (!tenant || memberships.length === 0) {
    return { ...EMPTY, status: 'onboarding', tenant, memberships }
  }

  const companies = memberships.map((m) => m.company_id)
  const isMember = (id: string | null | undefined): id is string =>
    Boolean(id) && companies.includes(id as string)

  const activeCompanyId = isMember(companyOverride)
    ? companyOverride
    : isMember(claims.active_company)
      ? claims.active_company
      : (companies[0] as string)

  const role = memberships.find((m) => m.company_id === activeCompanyId)?.role ?? null

  const stores = workspace.stores
    .filter(
      (s) => s.organization_id === claims.organization_id && s.company_id === activeCompanyId,
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  // Lo elegido en esta sesión manda sobre lo recordado; lo recordado, sobre el
  // orden alfabético. Los tres pasan por la misma comprobación: estar en la
  // lista que devolvió el servidor para esta sociedad.
  const recordada = storePreferences?.[activeCompanyId]
  const activeStore =
    stores.find((s) => s.id === storeOverride) ??
    stores.find((s) => s.id === recordada) ??
    stores[0] ??
    null

  return {
    status: 'ready',
    tenant,
    memberships,
    companies,
    activeCompanyId,
    role,
    stores,
    activeStore,
  }
}
