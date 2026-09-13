import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, type FakeSupabase } from '@/test/supabaseMock'

/**
 * La barra «para quién se compra» (H05-H06).
 *
 * Lo que se fija: que el consumidor no ve nada; que comercio y empresa se
 * distinguen por las banderas de proceso y no por un nombre; que «convenio» o
 * «condiciones» solo se prometen si el servidor lo dice; que la pregunta lleva
 * el slug y nada más; y que un fallo no rompe la tienda.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { CommerceContextBar } = await import('./CommerceContextBar')

const BASE = {
  account_name: 'Bodega Esperanza',
  account_code: 'BOD',
  customer_name: 'Bodega Esperanza',
  requires_approval: false,
  purchase_order_required: false,
  has_spending_limit: false,
  has_credit_terms: false,
  locations_count: 0,
  has_commercial_pricing: true,
  accounts_in_store: 1,
}

function pintar(respuesta: (() => unknown) | null, session = makeSession({ withTenantClaims: false })) {
  const fake: FakeSupabase = createFakeSupabase({
    session,
    rpc: respuesta ? { my_commerce_context: respuesta } : {},
  })
  holder.client = fake
  const view = renderWithProviders(<CommerceContextBar storeSlug="tienda-a" />, { session })
  return { fake, view }
}

beforeEach(() => {
  holder.client = null
})

describe('CommerceContextBar', () => {
  it('sin sesión no pregunta ni pinta', async () => {
    const fake = createFakeSupabase({ rpc: { my_commerce_context: () => BASE } })
    holder.client = fake
    const { container } = renderWithProviders(<CommerceContextBar storeSlug="tienda-a" />, { session: null })
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
    expect(fake.state.rpcCalls).toEqual([])
  })

  it('consumidor con sesión: el servidor no devuelve cuenta y no se pinta nada', async () => {
    const { fake, view } = pintar(() => null)
    await waitFor(() => expect(fake.state.rpcCalls.map((c) => c.name)).toContain('my_commerce_context'))
    expect(view.container).toBeEmptyDOMElement()
  })

  it('comercio: «Cuenta comercial», su nombre y condiciones activas', async () => {
    const { fake } = pintar(() => BASE)

    const region = await screen.findByRole('complementary', { name: 'Contexto de compra' })
    expect(region).toHaveAttribute('data-commerce-audience', 'trade')
    expect(screen.getByText('Cuenta comercial')).toBeInTheDocument()
    expect(screen.getByText('Bodega Esperanza')).toBeInTheDocument()
    expect(screen.getByText('Condiciones comerciales activas')).toBeInTheDocument()
    expect(screen.queryByText(/Enterprise|Comprando para/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver cuenta' })).toHaveAttribute('href', '/s/tienda-a/account')

    // La pregunta lleva el slug de la tienda y NADA más; y no se cotiza nada.
    expect(fake.state.rpcCalls).toEqual([{ name: 'my_commerce_context', args: { p_store_slug: 'tienda-a' } }])
  })

  it('empresa sin convenio vigente: «Comprando para», sin prometer convenio', async () => {
    pintar(() => ({ ...BASE, account_name: 'Corporación Andina SAC', requires_approval: true, has_commercial_pricing: false }))

    const region = await screen.findByRole('complementary', { name: 'Contexto de compra' })
    expect(region).toHaveAttribute('data-commerce-audience', 'enterprise')
    expect(screen.getByText('Comprando para')).toBeInTheDocument()
    expect(screen.queryByText('Precio convenio activo')).not.toBeInTheDocument()
    expect(screen.queryByText('Condiciones comerciales activas')).not.toBeInTheDocument()
  })

  it('empresa con convenio vigente: «Precio convenio activo»', async () => {
    pintar(() => ({ ...BASE, account_name: 'Corporación Andina SAC', has_credit_terms: true }))
    expect(await screen.findByText('Precio convenio activo')).toBeInTheDocument()
  })

  it('un nombre larguísimo no rompe la barra: se recorta y conserva el nombre completo', async () => {
    const largo = 'Distribuidora Comercial e Industrial de Productos Farmacéuticos y Afines del Sur Andino SAC'
    pintar(() => ({ ...BASE, account_name: largo }))
    const nombre = await screen.findByText(largo)
    expect(nombre).toHaveAttribute('title', largo)
  })

  it('si la consulta falla, la tienda sigue y la barra no aparece', async () => {
    const { fake, view } = pintar(() => {
      throw Object.assign(new Error('Could not find the function public.my_commerce_context'), { code: 'PGRST202' })
    })
    await waitFor(() => expect(fake.state.rpcCalls.length).toBeGreaterThan(0))
    expect(view.container).toBeEmptyDOMElement()
  })
})
