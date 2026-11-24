import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { parseSheet } from './parse'
import { KITS_SHEET } from './columns'
import type { ImportResult } from './api'

/**
 * Kits por Excel en pantalla (2026-11-24): con la hoja «Kits», productos y kits
 * viajan JUNTOS a `import_catalog_with_kits`; sin ella, todo sigue como antes.
 */

const api = vi.hoisted(() => ({
  importProducts: vi.fn(),
  importProductsWithKits: vi.fn(),
}))
const excel = vi.hoisted(() => ({ readWorkbook: vi.fn(), downloadTemplate: vi.fn() }))

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), ...api }))
vi.mock('./excel', async (importOriginal) => ({ ...(await importOriginal<typeof import('./excel')>()), ...excel }))
vi.mock('../pim/hooks', () => ({
  useAttributes: () => ({ data: [], isPending: false }),
  useAttributeValues: () => ({ data: [], isPending: false }),
}))

import { CapabilitiesCtx, type CapabilitiesContextValue } from '@/features/capabilities/capabilities-context'
import { CatalogImportAction } from './CatalogImportAction'

const ADVANCED: CapabilitiesContextValue = { status: 'ready', context: null, has: () => true, error: null, refetch: () => {} }

const ok = (): ImportResult => ({ dry_run: true, applied: false, total: 3, created: 3, updated: 0, errors: 0, rows: [] })

async function subir() {
  const user = userEvent.setup()
  renderWithProviders(
    <CapabilitiesCtx.Provider value={ADVANCED}>
      <CatalogImportAction kind="products" storeId="store-1" />
    </CapabilitiesCtx.Provider>,
  )
  await user.click(screen.getByRole('button', { name: 'Importar' }))
  const dialog = await screen.findByRole('dialog')
  await user.upload(within(dialog).getByLabelText('Elegir archivo .xlsx'), new File(['x'], 'catalogo.xlsx'))
  return dialog
}

beforeEach(() => {
  vi.clearAllMocks()
  api.importProductsWithKits.mockResolvedValue(ok())
  api.importProducts.mockResolvedValue(ok())
})

describe('hoja «Kits»', () => {
  it('se lee con sus columnas y cantidad numérica', () => {
    const parsed = parseSheet(
      [
        ['SKU del kit *', 'Nombre del kit', 'Precio del kit', 'SKU del componente *', 'Cantidad *'],
        ['KIT-1', 'Kit', 20, 'JABON', 2],
      ],
      KITS_SHEET,
    )
    expect(parsed.issue).toBeNull()
    expect(parsed.rows).toEqual([{ row: 2, kit_sku: 'KIT-1', kit_name: 'Kit', price: 20, component_sku: 'JABON', quantity: 2 }])
  })

  it('con hoja de kits, productos y kits van juntos a simular', async () => {
    excel.readWorkbook.mockResolvedValue([
      { sheet: 'Productos', data: [['SKU *', 'Nombre *', 'Precio *'], ['JABON', 'Jabón', 5]] },
      { sheet: 'Kits', data: [['SKU del kit *', 'Nombre del kit', 'Precio del kit', 'SKU del componente *', 'Cantidad *'], ['KIT-1', 'Kit', 20, 'JABON', 2]] },
    ])
    const dialog = await subir()
    await waitFor(() => expect(api.importProductsWithKits).toHaveBeenCalledTimes(1))
    expect(api.importProductsWithKits).toHaveBeenCalledWith(
      'store-1',
      [{ row: 2, sku: 'JABON', name: 'Jabón', price: 5 }],
      [{ row: 2, kit_sku: 'KIT-1', kit_name: 'Kit', price: 20, component_sku: 'JABON', quantity: 2 }],
      true,
    )
    expect(api.importProducts).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/en la hoja «Kits»/)).toBeInTheDocument()
  })

  it('sin hoja de kits, la importación de productos de siempre', async () => {
    excel.readWorkbook.mockResolvedValue([{ sheet: 'Productos', data: [['SKU *', 'Nombre *', 'Precio *'], ['JABON', 'Jabón', 5]] }])
    await subir()
    await waitFor(() => expect(api.importProducts).toHaveBeenCalledTimes(1))
    expect(api.importProductsWithKits).not.toHaveBeenCalled()
  })
})
