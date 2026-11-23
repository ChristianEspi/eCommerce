/**
 * 2026-11-22 · «Revisar catálogo»: las secciones cuentan lo detectado y «Ver»
 * lleva al producto en la lista (busca su SKU) y cierra el diálogo.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'

vi.mock('./api/products', () => ({
  fetchCatalogCleanupRows: vi.fn(async () => [
    { product_id: '00000000-0000-4000-8000-000000000001', sku: 'LEJ-1', name: 'Lejía 1 L', brand_name: null, kind: 'simple', status: 'published', has_image: true, has_description: true, has_category: true },
    { product_id: '00000000-0000-4000-8000-000000000002', sku: 'LEJ-5', name: 'Lejía 5 L', brand_name: null, kind: 'simple', status: 'published', has_image: false, has_description: true, has_category: true },
  ]),
}))

const { CatalogCleanupAction } = await import('./CatalogCleanupAction')

describe('CatalogCleanupAction', () => {
  it('cuenta por sección y «Ver» busca el producto', async () => {
    const onSearch = vi.fn()
    renderWithProviders(<CatalogCleanupAction storeId="00000000-0000-4000-8000-0000000000aa" onSearch={onSearch} />)
    await userEvent.click(screen.getByRole('button', { name: 'Revisar catálogo' }))

    expect(await screen.findByRole('tab', { name: 'Tamaños sueltos (1)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Duplicados (0)' })).toBeInTheDocument()
    expect(screen.getByText('Nada que revisar aquí')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Sin foto (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ver · Lejía 5 L' }))
    expect(onSearch).toHaveBeenCalledWith('LEJ-5')
  })
})
