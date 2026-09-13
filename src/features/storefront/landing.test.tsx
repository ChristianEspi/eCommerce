import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase } from '@/test/supabaseMock'

/**
 * La portada del dominio raíz.
 *
 * Tenía la propuesta de valor y una línea de texto con las rutas
 * (`/login · /app · /s/:storeSlug`): una nota para quien programa, no una salida
 * para quien llega. Lo que se prueba aquí es que las dos cosas que se pueden
 * hacer desde la raíz sean pulsables, y —lo importante— **de qué tienda** es el
 * segundo botón.
 *
 * La regla es de producto, no de estilo: con varias tiendas activas la portada
 * no elige por el visitante y, sobre todo, no las lista. La lista de tiendas
 * activas de un SaaS es la lista de clientes.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

/**
 * La configuración pública, fijada para la prueba (N08).
 *
 * `default-store.ts` pregunta a la base solo si `isSupabaseConfigured`, que se
 * lee de `VITE_SUPABASE_*` al importar. Sin `.env` era `false` y la prueba
 * fallaba por la máquina, no por el código. Aquí el backend es el falso de
 * arriba, así que se declara configurado sin secretos ni red: el resto del
 * módulo es el real.
 */
vi.mock('@/shared/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/env')>()),
  isSupabaseConfigured: true,
}))

const { LandingPage } = await import('./pages')

function render(stores: Array<{ slug: string; name: string }>) {
  holder.client = createFakeSupabase({ tables: { public_stores: stores } })
  return renderWithProviders(<LandingPage />)
}

describe('Portada del dominio raíz', () => {
  it('siempre ofrece entrar, y el enlace va al login', async () => {
    render([])

    const entrar = await screen.findByRole('link', { name: /Entrar/ })
    expect(entrar).toHaveAttribute('href', '/login')
  })

  it('con UNA tienda activa, ofrece verla por su nombre', async () => {
    render([{ slug: 'miquimica', name: 'MiQuímica' }])

    const tienda = await screen.findByRole('link', { name: /MiQuímica/ })
    expect(tienda).toHaveAttribute('href', '/s/miquimica')
  })

  it('con VARIAS, no elige una ni las lista: la lista de tiendas es la de clientes', async () => {
    render([
      { slug: 'miquimica', name: 'MiQuímica' },
      { slug: 'otra-botica', name: 'Otra Botica' },
    ])

    await screen.findByRole('link', { name: /Entrar/ })
    expect(screen.queryByRole('link', { name: /MiQuímica/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Otra Botica/ })).not.toBeInTheDocument()
  })
})
