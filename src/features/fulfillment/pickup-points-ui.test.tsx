import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { geocodeAddress } from '@/shared/lib/geo'
import type { PickupPoint } from './types'

/**
 * Tiendas de recojo en el backoffice (2026-11-15): el distrito ordena por
 * cercanía en la vitrina y el almacén dice si la tienda tiene el pedido.
 */
const holder = vi.hoisted(() => ({
  save: { mutateAsync: vi.fn(async () => undefined), isPending: false },
  remove: { mutateAsync: vi.fn(async () => undefined), isPending: false },
}))

const PUNTOS: PickupPoint[] = [
  {
    id: 'p-miraflores',
    store_id: 's1',
    code: 'miraflores',
    name: 'Botica Miraflores',
    address: { address: 'Av. Larco 1200', district: 'Miraflores', city: 'Lima', opening: 'L-S 9-21' },
    zone_id: null,
    warehouse_id: 'w1',
    contact_phone: null,
    is_active: true,
    position: 1,
    latitude: -12.1255,
    longitude: -77.03,
  },
  {
    id: 'p-sanisidro',
    store_id: 's1',
    code: 'san-isidro',
    name: 'Botica San Isidro',
    address: { line1: 'Av. Camino Real 456', city: 'Lima' },
    zone_id: null,
    warehouse_id: null,
    contact_phone: null,
    is_active: true,
    position: 2,
    latitude: null,
    longitude: null,
  },
]

vi.mock('./hooks', () => ({
  usePickupPoints: () => ({ data: PUNTOS, isPending: false, isError: false }),
  useWarehouses: () => ({ data: [{ id: 'w1', code: 'ALM-MIR', name: 'Almacén Miraflores' }] }),
  useSavePickupPoint: () => holder.save,
  useDeletePickupPoint: () => holder.remove,
}))

vi.mock('@/features/tenant/tenant-context', () => ({
  useTenant: () => ({
    tenant: { organization_id: 'o1' },
    activeCompanyId: 'c1',
    activeStore: { id: 's1', name: 'Química Suiza' },
    can: () => true,
  }),
}))

const { PickupPointsSection } = await import('./PickupPointsSection')

beforeEach(() => {
  holder.save.mutateAsync.mockClear()
})

describe('tiendas de recojo', () => {
  it('lista el distrito y el almacén, y avisa de la que no tiene distrito', () => {
    renderWithProviders(<PickupPointsSection />)
    const filaMiraflores = screen.getByRole('row', { name: /Botica Miraflores/ })
    expect(within(filaMiraflores).getByText('Miraflores')).toBeInTheDocument()
    expect(within(filaMiraflores).getByText('Almacén Miraflores')).toBeInTheDocument()

    const filaSanIsidro = screen.getByRole('row', { name: /Botica San Isidro/ })
    expect(within(filaSanIsidro).getByText('Sin distrito')).toBeInTheDocument()
    expect(within(filaSanIsidro).getByText('Sin almacén propio')).toBeInTheDocument()
    // La calle sembrada como `line1` se lee igual.
    expect(within(filaSanIsidro).getByText('Av. Camino Real 456')).toBeInTheDocument()
  })

  it('poner el distrito guarda la dirección sin perder lo que el formulario no edita', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PickupPointsSection />)
    await user.click(screen.getByRole('button', { name: 'Editar: Botica San Isidro' }))
    await user.type(screen.getByLabelText('Distrito'), 'San Isidro')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(holder.save.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p-sanisidro',
        address: 'Av. Camino Real 456',
        district: 'San Isidro',
        city: 'Lima',
        baseAddress: { line1: 'Av. Camino Real 456', city: 'Lima' },
      }),
    )
  })
})

describe('el punto de la tienda en el mapa', () => {
  it('avisa de la tienda sin ubicación', () => {
    renderWithProviders(<PickupPointsSection />)
    const fila = screen.getByRole('row', { name: /Botica San Isidro/ })
    expect(within(fila).getByText('Sin ubicación')).toBeInTheDocument()
  })

  it('«Ubicar la dirección en el mapa» busca la dirección escrita y guarda el punto', async () => {
    vi.mocked(geocodeAddress).mockResolvedValueOnce({ lat: -12.0972, lng: -77.0365 })
    const user = userEvent.setup()
    renderWithProviders(<PickupPointsSection />)
    await user.click(screen.getByRole('button', { name: 'Editar: Botica San Isidro' }))
    await user.click(screen.getByRole('button', { name: 'Ubicar la dirección en el mapa' }))
    expect(vi.mocked(geocodeAddress)).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'Av. Camino Real 456', city: 'Lima', country: 'PE' }),
    )
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(holder.save.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-sanisidro', latitude: -12.0972, longitude: -77.0365 }),
    )
  })

  it('tocar el mapa también fija el punto', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PickupPointsSection />)
    await user.click(screen.getByRole('button', { name: 'Editar: Botica San Isidro' }))
    await user.click(screen.getByRole('button', { name: 'Marcar el punto en el mapa' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(holder.save.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: -12.1255, longitude: -77.03 }),
    )
  })
})
