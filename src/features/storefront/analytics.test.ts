import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'

/**
 * Los tres hechos que la vitrina emite (P13-SaaS).
 *
 * Lo que se defiende aquí es lo que hace que la analítica no se convierta en un
 * problema de privacidad ni en una fuente de fallos de la tienda:
 *
 *  1. lo que viaja es un identificador OPACO de visita, sin nada dentro, y solo
 *     dura lo que dura la pestaña;
 *  2. el lote tiene techo, el mismo que impone la base;
 *  3. un fallo de la analítica NO rompe la tienda: se traga a conciencia;
 *  4. y el tenant no se declara nunca: viaja el slug de la URL, que es lo que
 *     el servidor traduce.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { sessionId, track, trackStorefrontEvents, STOREFRONT_EVENT_TYPES } = await import(
  './analytics'
)

function backend(options: { falla?: boolean } = {}): FakeSupabase {
  return createFakeSupabase({
    rpc: {
      track_events_for_slug: () => {
        if (options.falla) throw new Error('ANALYTICS_LOTE_INVALIDO: nope')
        return { recorded: 1 }
      },
    },
  })
}

beforeEach(() => {
  holder.client = null
  window.sessionStorage.clear()
})

describe('el identificador de visita', () => {
  it('es opaco, largo y estable dentro de la misma pestaña', () => {
    const primero = sessionId()
    expect(primero).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(sessionId()).toBe(primero)
  })

  it('no lleva NADA dentro: ni tienda, ni usuario, ni fecha', () => {
    const value = sessionId() as string
    expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(value).not.toContain('@')
    // Lo único que se le pide es no repetirse.
    window.sessionStorage.clear()
    expect(sessionId()).not.toBe(value)
  })

  it('vive en `sessionStorage`, no en `localStorage`', () => {
    sessionId()
    expect(window.sessionStorage.getItem('ebim.analytics.session')).toBeTruthy()
    expect(window.localStorage.getItem('ebim.analytics.session')).toBeNull()
  })
})

describe('el envío', () => {
  it('manda el slug y NUNCA el tenant', async () => {
    const fake = backend()
    holder.client = fake
    await trackStorefrontEvents('mi-tienda', [{ type: 'product_view', product_id: 'p1' }])

    const llamada = fake.state.rpcCalls.find((c) => c.name === 'track_events_for_slug')
    expect(llamada?.args).toMatchObject({ p_store_slug: 'mi-tienda' })
    expect(JSON.stringify(llamada?.args)).not.toMatch(/organization_id|company_id|store_id/)
  })

  it('recorta el lote al techo que impone la base', async () => {
    const fake = backend()
    holder.client = fake
    const lote = Array.from({ length: 30 }, () => ({ type: 'product_view' as const, product_id: 'p1' }))
    await trackStorefrontEvents('mi-tienda', lote)

    const llamada = fake.state.rpcCalls.find((c) => c.name === 'track_events_for_slug')
    expect((llamada?.args as { p_events: unknown[] }).p_events).toHaveLength(20)
  })

  it('un lote vacío no llama a nada', async () => {
    const fake = backend()
    holder.client = fake
    await trackStorefrontEvents('mi-tienda', [])
    expect(fake.state.rpcCalls).toHaveLength(0)
  })

  it('si la analítica falla, la tienda no se entera', async () => {
    holder.client = backend({ falla: true })
    // `track` es dispara-y-olvida: una vitrina que no deja comprar porque no
    // pudo registrar una visita es peor que una vitrina sin analítica.
    expect(() => track('mi-tienda', { type: 'product_view', product_id: 'p1' })).not.toThrow()
    await Promise.resolve()
  })

  it('solo existen los tres tipos que la puerta pública acepta', () => {
    // Copia de `ebim.storefront_event_types()`. Los otros seis los emite un
    // trigger del servidor y pedirlos desde aquí es un error explícito.
    expect([...STOREFRONT_EVENT_TYPES]).toEqual(['product_view', 'search', 'add_to_cart'])
  })
})
