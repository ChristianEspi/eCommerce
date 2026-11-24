import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'

/**
 * «Crear a partir de esta tienda» (2026-11-24): nombre, dirección y secciones.
 * A la base viajan el id de origen, el nombre, el slug y las secciones
 * marcadas; nunca moneda ni tenant.
 */

const holder = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('./hooks', () => ({
  useCloneStore: () => ({ mutate: holder.mutate, isPending: false, isError: false, error: null, reset: vi.fn() }),
}))

const { CloneStoreDialog } = await import('./CloneStoreDialog')

const ORIGEN = {
  id: '55555555-5555-4555-8555-555555555501',
  organization_id: '11111111-1111-4111-8111-111111111111',
  company_id: '22222222-2222-4222-8222-222222222222',
  slug: 'miquimica',
  name: 'Quimica Suiza',
  status: 'active' as const,
  currency: 'PEN',
  domain: null,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
}

describe('CloneStoreDialog', () => {
  it('propone la dirección desde el nombre y manda solo lo marcado', async () => {
    renderWithProviders(<CloneStoreDialog source={ORIGEN} onClose={vi.fn()} />)

    expect(screen.getByText(/Moneda: PEN/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Botica Miraflores')
    expect(screen.getByRole('textbox', { name: /Dirección de la tienda/ })).toHaveValue('botica-miraflores')

    await userEvent.click(screen.getByRole('checkbox', { name: /Sinónimos de búsqueda/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Crear tienda' }))

    expect(holder.mutate).toHaveBeenCalledTimes(1)
    const [input] = holder.mutate.mock.calls[0] as [Record<string, unknown>]
    expect(input).toEqual({
      sourceStoreId: ORIGEN.id,
      name: 'Botica Miraflores',
      slug: 'botica-miraflores',
      sections: ['design', 'categories', 'catalog', 'payments_delivery', 'supply', 'content', 'emails'],
    })
  })

  it('sin ninguna sección marcada no se puede crear', async () => {
    renderWithProviders(<CloneStoreDialog source={ORIGEN} onClose={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Otra')
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box)
    expect(screen.getByRole('button', { name: 'Crear tienda' })).toBeDisabled()
  })
})
