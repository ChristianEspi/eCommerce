import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makePlatformContext,
  makeSession,
} from '@/test/supabaseMock'
import { NAV_ITEMS, visibleNavItems } from '@/features/admin/navigation'

/**
 * Gating por capacidad en la UI (P02-SaaS).
 *
 * Lo que estas pruebas protegen NO es la seguridad —esa vive en las policies y
 * se prueba contra Postgres en `supabase/tests/capabilities.test.ts`— sino tres
 * cosas que solo se rompen en la pantalla:
 *
 *  1. que un módulo no contratado se explique en vez de aparecer vacío;
 *  2. que un fallo de autorización del SERVIDOR no se disfrace de «no lo
 *     tienes», que es como un 403 real se vuelve invisible durante semanas;
 *  3. que un flag encendido en la UI no encienda nada que no esté contratado.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { TenantProvider } = await import('@/features/tenant/TenantProvider')
const { CapabilitiesProvider } = await import('./CapabilitiesProvider')
const { CapabilityGate, CapabilityFeature } = await import('./CapabilityGate')

function backend(rpc?: Record<string, () => unknown>) {
  return createFakeSupabase({
    session: makeSession(),
    ...(rpc ? { rpc } : {}),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role: 'admin', status: 'active' },
      ],
      stores: [
        {
          id: STORE_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          slug: 'mi-negocio',
          name: 'Mi Negocio',
          status: 'active',
          currency: 'PEN',
        },
      ],
    },
  })
}

function renderGate(node: React.ReactNode) {
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>{node}</CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
}

describe('CapabilityGate', () => {
  it('deja pasar un módulo baseline: viene con el producto', async () => {
    holder.client = backend()
    renderGate(
      <CapabilityGate capability="catalog">
        <p>contenido del catálogo</p>
      </CapabilityGate>,
    )
    expect(await screen.findByText('contenido del catálogo')).toBeInTheDocument()
  })

  it('un módulo no contratado se EXPLICA, no se deja en blanco', async () => {
    holder.client = backend()
    renderGate(
      <CapabilityGate capability="pricing.lists">
        <p>listas de precio</p>
      </CapabilityGate>,
    )

    expect(await screen.findByText('Este módulo no está en tu plan')).toBeInTheDocument()
    expect(screen.queryByText('listas de precio')).not.toBeInTheDocument()
    // Es un estado, no un error: nada falló.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Y dice qué se pierde, en palabras del producto.
    expect(screen.getByText(/Listas de precio por canal, segmento, cliente/)).toBeInTheDocument()
  })

  it('lo contratado se abre sin más', async () => {
    holder.client = backend({
      effective_capabilities: () =>
        makePlatformContext({ entitlements: ['ecommerce.pricing.lists'], source: 'hub' }),
    })
    renderGate(
      <CapabilityGate capability="pricing.lists">
        <p>listas de precio</p>
      </CapabilityGate>,
    )
    expect(await screen.findByText('listas de precio')).toBeInTheDocument()
  })

  /**
   * El caso que justifica que el gate tenga cuatro estados y no dos. Un 403 de
   * la base al leer capacidades NO es «no lo tienes»: es un fallo que hay que
   * ver y reintentar.
   */
  it('un error de autorización del servidor se pinta como error, no como «no contratado»', async () => {
    holder.client = backend({
      effective_capabilities: () => {
        // Lo que devuelve la base cuando la policy deniega: el mismo shape que
        // PostgREST, con su SQLSTATE.
        throw { message: 'SIN_PERMISO: la sociedad no pertenece a este usuario', code: '42501' }
      },
    })

    renderGate(
      <CapabilityGate capability="catalog">
        <p>contenido del catálogo</p>
      </CapabilityGate>,
    )

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Este módulo no está en tu plan')).not.toBeInTheDocument()
    expect(screen.queryByText('contenido del catálogo')).not.toBeInTheDocument()
  })

  it('el fallback del llamante reemplaza al estado por defecto', async () => {
    holder.client = backend()
    renderGate(
      <CapabilityGate capability="payments" fallback={<p>pide una demo</p>}>
        <p>pasarela</p>
      </CapabilityGate>,
    )
    expect(await screen.findByText('pide una demo')).toBeInTheDocument()
  })
})

describe('CapabilityFeature (control suelto)', () => {
  it('sin la capacidad enseña la nota, no el control', async () => {
    holder.client = backend()
    renderGate(
      <CapabilityFeature capability="content.white_label">
        <button type="button">activar marca blanca</button>
      </CapabilityFeature>,
    )
    expect(await screen.findByText(/Módulo no incluido en tu plan/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'activar marca blanca' })).not.toBeInTheDocument()
  })

  it('con la capacidad enseña el control', async () => {
    holder.client = backend({
      effective_capabilities: () =>
        makePlatformContext({ entitlements: ['ecommerce.content.white_label'], source: 'hub' }),
    })
    renderGate(
      <CapabilityFeature capability="content.white_label">
        <button type="button">activar marca blanca</button>
      </CapabilityFeature>,
    )
    expect(await screen.findByRole('button', { name: 'activar marca blanca' })).toBeInTheDocument()
  })

  /**
   * Un flag apagado deja el módulo contratado pero inaccesible: es un corte de
   * emergencia, y la pantalla tiene que comportarse igual que si no estuviera
   * contratado — el usuario no puede usarlo en ninguno de los dos casos.
   */
  it('un flag apagado cierra un módulo contratado', async () => {
    holder.client = backend({
      effective_capabilities: () =>
        makePlatformContext({
          entitlements: ['ecommerce.content.white_label'],
          flags: { 'content.white_label': false },
          source: 'hub',
        }),
    })
    renderGate(
      <CapabilityFeature capability="content.white_label">
        <button type="button">activar marca blanca</button>
      </CapabilityFeature>,
    )
    await waitFor(() =>
      expect(screen.getByText(/Módulo no incluido en tu plan/)).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'activar marca blanca' })).not.toBeInTheDocument()
  })
})

describe('navegación del backoffice', () => {
  const allow = () => true
  const deny = () => false

  it('esconde lo que la sociedad no tiene contratado', () => {
    const items = visibleNavItems(NAV_ITEMS, {
      can: allow,
      has: (capability) => capability !== 'catalog',
      capabilitiesReady: true,
    })
    expect(items.map((i) => i.to)).not.toContain('/app/products')
    expect(items.map((i) => i.to)).not.toContain('/app/categories')
    expect(items.map((i) => i.to)).toContain('/app/orders')
  })

  /**
   * Configuración es la salida de un tenant sin nada: nunca se esconde. Desde
   * P13-SaaS la acompañan Operación y Diagnóstico, y por el mismo motivo: quien
   * no puede ver por qué le fallan los cobros acaba llamando por teléfono. Desde
   * P14-SaaS entra también Integraciones: ver por qué no sale un mensaje hacia
   * un sistema externo es la misma clase de pregunta. Las cuatro van sin
   * capacidad y con permiso de administración; lo vendible es PUBLICAR
   * —credenciales, endpoints, suscripciones— y ese gate está en la base.
   */
  it('Configuración, Operación, Integraciones y Diagnóstico siguen estando sin ni un módulo activo', () => {
    const items = visibleNavItems(NAV_ITEMS, { can: allow, has: deny, capabilitiesReady: true })
    expect(items.map((i) => i.to)).toEqual([
      '/app/settings',
      '/app/operations',
      '/app/integrations',
      '/app/diagnostics',
    ])
  })

  it('Diagnóstico es de quien administra el espacio, no de todo el mundo', () => {
    const items = visibleNavItems(NAV_ITEMS, {
      can: (permission) => permission !== 'tenant.manage',
      has: allow,
      capabilitiesReady: true,
    })
    expect(items.map((i) => i.to)).not.toContain('/app/diagnostics')
  })

  /**
   * Mientras la respuesta viaja no se esconde nada: un menú que se vacía y se
   * rellena en cada navegación se lee como un error de la aplicación, y
   * esconder de más aquí no protege nada porque la autoridad es la RLS.
   */
  it('mientras cargan las capacidades el menú no parpadea', () => {
    const items = visibleNavItems(NAV_ITEMS, { can: allow, has: deny, capabilitiesReady: false })
    expect(items.map((i) => i.to)).toContain('/app/products')
  })
})
