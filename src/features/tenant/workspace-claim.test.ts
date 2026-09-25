/**
 * El administrador que EBIM MasterAdmin dejó PREPROVISIONED entra por primera
 * vez: `fetchWorkspace` reclama el tenant (RPC sin argumentos) y vuelve a
 * cargar. Quien ya es miembro no paga la llamada, y un reclamo que no procede
 * o falla deja todo como antes (onboarding).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPANY_A, ORG, USER, createFakeSupabase } from '@/test/supabaseMock'
import { CLAIM_PROVISIONED_TENANT_RPC } from '@/shared/lib/db-schema'
import { fetchWorkspace } from './workspace'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
}))

const tenant = { organization_id: ORG, slug: 'negocio', name: 'Negocio', status: 'active' }
const ownerRow = {
  organization_id: ORG,
  company_id: COMPANY_A,
  user_id: USER,
  role: 'owner',
  status: 'active',
}

type Fake = ReturnType<typeof createFakeSupabase>

function fake(options: { members: unknown[]; claim?: (fake: Fake) => unknown }): Fake {
  const client: Fake = createFakeSupabase({
    tables: { tenants: [tenant], tenant_members: options.members as never[], stores: [] },
    rpc: options.claim ? { [CLAIM_PROVISIONED_TENANT_RPC]: () => options.claim?.(client) } : {},
  })
  holder.client = client
  return client
}

describe('fetchWorkspace · reclamo del owner PREPROVISIONED', () => {
  beforeEach(() => {
    holder.client = null
  })

  it('un miembro no llama al reclamo', async () => {
    const client = fake({ members: [ownerRow], claim: () => ({ claimed: true }) })
    const workspace = await fetchWorkspace(USER)
    expect(workspace.memberships).toHaveLength(1)
    expect(client.state.rpcCalls.map((c) => c.name)).not.toContain(CLAIM_PROVISIONED_TENANT_RPC)
  })

  it('sin membresía reclama SIN argumentos y, si procede, recarga con la membresía nueva', async () => {
    const client = fake({
      members: [],
      claim: (c) => {
        // La base crea la membresía owner en la misma llamada.
        c.state.tables.tenant_members = [ownerRow]
        return { claimed: true, organization_id: ORG, company_id: COMPANY_A }
      },
    })
    const workspace = await fetchWorkspace(USER)
    const call = client.state.rpcCalls.find((c) => c.name === CLAIM_PROVISIONED_TENANT_RPC)
    expect(call).toBeDefined()
    expect(call?.args ?? {}).toEqual({})
    expect(workspace.memberships).toEqual([ownerRow])
  })

  it('claimed=false deja el espacio vacío (onboarding)', async () => {
    fake({ members: [], claim: () => ({ claimed: false }) })
    const workspace = await fetchWorkspace(USER)
    expect(workspace.memberships).toEqual([])
  })

  it('si el reclamo falla, se sigue como antes', async () => {
    fake({ members: [] })
    const workspace = await fetchWorkspace(USER)
    expect(workspace.memberships).toEqual([])
    expect(workspace.tenant).toEqual(tenant)
  })
})
