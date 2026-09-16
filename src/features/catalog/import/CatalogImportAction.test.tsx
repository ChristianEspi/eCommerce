import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import type { ImportResult } from './api'

const api = vi.hoisted(() => ({
  importCategories: vi.fn(),
  importProducts: vi.fn(),
  importVocabulary: vi.fn(),
}))
const excel = vi.hoisted(() => ({
  readWorkbook: vi.fn(),
  downloadTemplate: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  ...api,
}))
vi.mock('./excel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./excel')>()),
  ...excel,
}))

import { CapabilitiesCtx, type CapabilitiesContextValue } from '@/features/capabilities/capabilities-context'
import { CatalogImportAction } from './CatalogImportAction'
import { WorkbookReadError } from './excel'

const STORE = 'store-1'

/** Sociedad sin catálogo avanzado: las categorías no lo necesitan. */
const CAPABILITIES: CapabilitiesContextValue = {
  status: 'ready',
  context: null,
  has: () => false,
  error: null,
  refetch: () => {},
}

function renderAction() {
  return renderWithProviders(
    <CapabilitiesCtx.Provider value={CAPABILITIES}>
      <CatalogImportAction kind="categories" storeId={STORE} />
    </CapabilitiesCtx.Provider>,
  )
}

function result(partial: Partial<ImportResult>): ImportResult {
  return { dry_run: true, applied: false, total: 0, created: 0, updated: 0, errors: 0, rows: [], ...partial }
}

async function openAndUpload() {
  const user = userEvent.setup()
  renderAction()
  await user.click(screen.getByRole('button', { name: 'Importar' }))
  const dialog = await screen.findByRole('dialog', { name: 'Importar categorías' })
  const input = within(dialog).getByLabelText('Elegir archivo .xlsx')
  await user.upload(input, new File(['x'], 'categorias.xlsx'))
  return { user, dialog }
}

beforeEach(() => {
  vi.clearAllMocks()
  excel.readWorkbook.mockResolvedValue([
    {
      sheet: 'Categorías',
      data: [
        ['Slug', 'Nombre *', 'Slug de la madre'],
        ['mujer', 'Mujer', null],
        ['mujer-vestidos', 'Vestidos', 'mujr'],
      ],
    },
  ])
})

describe('importar categorías desde Excel', () => {
  it('simula al subir, enseña cada error con su columna y no deja aplicar', async () => {
    api.importCategories.mockResolvedValueOnce(
      result({
        total: 2, created: 1, errors: 1,
        rows: [
          { sheet: 'categories', row: 2, key: 'mujer', status: 'created' },
          { sheet: 'categories', row: 3, key: 'mujer-vestidos', status: 'error', reason: 'PADRE_NO_ENCONTRADO', field: 'parent_slug' },
        ],
      }),
    )

    const { dialog } = await openAndUpload()

    await within(dialog).findByText('La categoría madre no existe · Slug de la madre')
    expect(api.importCategories).toHaveBeenCalledWith(
      STORE,
      [
        { row: 2, slug: 'mujer', name: 'Mujer' },
        { row: 3, slug: 'mujer-vestidos', name: 'Vestidos', parent_slug: 'mujr' },
      ],
      true,
    )
    expect(within(dialog).getByText(/Hay filas con error/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Aplicar importación' })).toBeDisabled()
  })

  it('sin errores aplica las mismas filas y confirma', async () => {
    const ok = result({
      total: 2, created: 2,
      rows: [
        { sheet: 'categories', row: 2, key: 'mujer', status: 'created' },
        { sheet: 'categories', row: 3, key: 'mujer-vestidos', status: 'created' },
      ],
    })
    api.importCategories.mockResolvedValueOnce(ok).mockResolvedValueOnce({ ...ok, dry_run: false, applied: true })

    const { user, dialog } = await openAndUpload()
    await within(dialog).findByText(/Hasta que pulses/)
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar importación' }))

    await within(dialog).findByText('Importación aplicada.')
    const [, second] = api.importCategories.mock.calls
    expect(second?.[2]).toBe(false)
    expect(second?.[1]).toEqual(api.importCategories.mock.calls[0]?.[1])
    expect(within(dialog).queryByRole('button', { name: 'Aplicar importación' })).not.toBeInTheDocument()
  })

  it('una hoja sin la columna clave no llega al servidor', async () => {
    excel.readWorkbook.mockResolvedValueOnce([{ sheet: 'Hoja1', data: [['Posición'], [1]] }])

    const { dialog } = await openAndUpload()

    await within(dialog).findByText(/faltan columnas obligatorias: Slug \/ Nombre/)
    expect(api.importCategories).not.toHaveBeenCalled()
  })

  it('un archivo que no es .xlsx lo dice claro', async () => {
    excel.readWorkbook.mockRejectedValueOnce(new WorkbookReadError())

    const { dialog } = await openAndUpload()

    await within(dialog).findByText(/Guárdalo como libro de Excel/)
    expect(api.importCategories).not.toHaveBeenCalled()
  })

  it('la plantilla se descarga con sus columnas', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(screen.getByRole('button', { name: 'Importar' }))
    await user.click(await screen.findByRole('button', { name: 'Descargar plantilla' }))

    await waitFor(() => expect(excel.downloadTemplate).toHaveBeenCalledTimes(1))
    const [fileName, sheets] = excel.downloadTemplate.mock.calls[0] ?? []
    expect(fileName).toBe('plantilla-categorias.xlsx')
    expect(sheets.map((sheet: { name: string }) => sheet.name)).toEqual(['Categorías', 'Instrucciones'])
  })
})
