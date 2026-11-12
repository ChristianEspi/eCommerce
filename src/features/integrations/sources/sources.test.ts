// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fuentes de lectura, lado pantalla.
 *
 *  - las reglas del formulario avisan de lo mismo que la base rechaza;
 *  - las listas del formulario son copia de los CHECK de la migración;
 *  - el alta NO manda tenant (sale del JWT) y la credencial NUNCA va en la
 *    fila: viaja aparte, una vez, a `connector_source_set_secret`.
 */

type Call = { table?: string; rpc?: string; op: string; payload: unknown }
const calls: Call[] = []

function chain(table: string) {
  const result = { data: { id: 'src-1' }, error: null }
  const builder = {
    insert(payload: unknown) {
      calls.push({ table, op: 'insert', payload })
      return builder
    },
    update(payload: unknown) {
      calls.push({ table, op: 'update', payload })
      return builder
    },
    eq: () => builder,
    select: () => builder,
    single: async () => result,
    then: (resolve: (value: typeof result) => void) => resolve(result),
  }
  return builder
}

const fakeClient = {
  from: (table: string) => chain(table),
  rpc: async (name: string, payload: unknown) => {
    calls.push({ rpc: name, op: 'rpc', payload })
    return { data: null, error: null }
  },
}

vi.mock('@/shared/lib/supabase', () => ({ tryGetSupabaseClient: () => fakeClient }))

const { saveFeed, saveSource } = await import('./api')
const { feedDraftProblem, sourceDraftProblem } = await import('./rules')
const { AUTH_TYPES, FEED_RESOURCES, isPublicHttpsUrl } = await import('./types')
type SourceDraft = import('./types').SourceDraft

const MIGRATION = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20261112120000_connector_sources.sql'),
  'utf8',
)

const draft = (over: Partial<SourceDraft> = {}): SourceDraft => ({
  name: 'ERP central',
  description: '',
  baseUrl: 'https://erp.cliente.test/api',
  authType: 'api_key',
  authHeader: 'X-ERP-Key',
  authUsername: '',
  oauthTokenUrl: 'https://',
  oauthScope: '',
  timeoutSeconds: 20,
  isActive: true,
  secret: 'clave-secreta',
  ...over,
})

beforeEach(() => {
  calls.length = 0
})

describe('reglas del formulario', () => {
  it('URL https y pública, igual que el CHECK', () => {
    expect(isPublicHttpsUrl('https://erp.cliente.test/api')).toBe(true)
    for (const url of ['http://erp.test', 'https://localhost', 'https://192.168.1.2', 'https://erp.internal']) {
      expect(isPublicHttpsUrl(url)).toBe(false)
    }
  })

  it('cada autenticación pide lo suyo', () => {
    expect(sourceDraftProblem(draft(), false)).toBeNull()
    expect(sourceDraftProblem(draft({ secret: '' }), false)).toBe('integrations.sources.validation.secret')
    expect(sourceDraftProblem(draft({ secret: '' }), true)).toBeNull()
    expect(sourceDraftProblem(draft({ authType: 'basic' }), false)).toBe('integrations.sources.validation.username')
    expect(
      sourceDraftProblem(draft({ authType: 'oauth2', authUsername: 'ebim', oauthTokenUrl: 'http://x' }), false),
    ).toBe('integrations.sources.validation.tokenUrl')
    expect(sourceDraftProblem(draft({ authType: 'none', secret: '' }), false)).toBeNull()
    expect(sourceDraftProblem(draft({ baseUrl: 'https://10.0.0.1' }), false)).toBe('integrations.sources.validation.url')
  })

  it('precios exige lista; la ruta sin espacios', () => {
    const base = {
      sourceId: 's',
      resource: 'prices' as const,
      path: '/ebim/v1/prices',
      intervalMinutes: 60,
      pageSize: 200,
      priceListId: null,
      defaultWarehouseId: null,
      isActive: true,
    }
    expect(feedDraftProblem(base)).toBe('integrations.sources.validation.priceList')
    expect(feedDraftProblem({ ...base, priceListId: 'l' })).toBeNull()
    expect(feedDraftProblem({ ...base, priceListId: 'l', path: '/con espacio' })).toBe(
      'integrations.sources.validation.path',
    )
  })

  it('las listas son copia de los CHECK de la migración', () => {
    expect(MIGRATION).toContain(
      `check (auth_type in (${AUTH_TYPES.map((type) => `'${type}'`).join(', ')}))`,
    )
    expect(MIGRATION).toContain(
      `check (resource in (${FEED_RESOURCES.map((resource) => `'${resource}'`).join(', ')}))`,
    )
  })
})

describe('guardar', () => {
  it('la fuente no lleva tenant ni credencial; la credencial va aparte', async () => {
    await saveSource(null, draft())
    const insert = calls.find((c) => c.op === 'insert')
    expect(insert?.table).toBe('connector_sources')
    const body = JSON.stringify(insert?.payload)
    expect(body).not.toMatch(/organization_id|company_id/)
    expect(body).not.toContain('clave-secreta')

    const secret = calls.find((c) => c.rpc === 'connector_source_set_secret')
    expect(secret?.payload).toEqual({ p_source_id: 'src-1', p_secret: 'clave-secreta' })
  })

  it('al editar sin escribir credencial no se toca la guardada', async () => {
    await saveSource('src-1', draft({ secret: '' }))
    expect(calls.some((c) => c.rpc === 'connector_source_set_secret')).toBe(false)
  })

  it('sin autenticación, la credencial guardada se borra', async () => {
    await saveSource('src-1', draft({ authType: 'none', secret: '' }))
    expect(calls.find((c) => c.rpc === 'connector_source_set_secret')?.payload).toEqual({
      p_source_id: 'src-1',
      p_secret: '',
    })
  })

  it('el flujo tampoco lleva tenant, y precios no manda almacén', async () => {
    await saveFeed(null, {
      sourceId: 'src-1',
      resource: 'prices',
      path: 'ebim/v1/prices',
      intervalMinutes: 60,
      pageSize: 200,
      priceListId: 'list-1',
      defaultWarehouseId: 'wh-1',
      isActive: true,
    })
    const insert = calls.find((c) => c.op === 'insert')
    expect(insert?.payload).toEqual({
      path: '/ebim/v1/prices',
      interval_minutes: 60,
      page_size: 200,
      price_list_id: 'list-1',
      default_warehouse_id: null,
      is_active: true,
      source_id: 'src-1',
      resource: 'prices',
    })
  })
})
