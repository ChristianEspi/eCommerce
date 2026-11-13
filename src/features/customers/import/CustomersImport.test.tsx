import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { MESSAGES } from '@/shared/i18n/messages.all'
import type { MessageKey } from '@/shared/i18n/messages'
import { buildGuide } from '@/shared/lib/excel'
import type { CustomerImportResult } from './api'

const api = vi.hoisted(() => ({ importCustomers: vi.fn(), importAccountUsers: vi.fn() }))
const workbook = vi.hoisted(() => ({ readWorkbook: vi.fn() }))
const writer = vi.hoisted(() => ({ downloadWorkbook: vi.fn() }))
const accounts = vi.hoisted(() => ({ mutateAsync: vi.fn() }))

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), ...api }))
vi.mock('@/features/catalog/import/excel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/catalog/import/excel')>()),
  ...workbook,
}))
vi.mock('@/shared/lib/excel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/excel')>()),
  ...writer,
}))
vi.mock('@/features/auth/createAccount', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/createAccount')>()),
  useCreateAccount: () => accounts,
}))

import { CustomersImportButton, type CustomersImportTarget } from './CustomersImportDialog'
import { CUSTOMERS_SHEET, accountUsersSheet, templateBook } from './columns'

const t = (key: MessageKey) => MESSAGES.es[key] ?? key

function result(partial: Partial<CustomerImportResult>): CustomerImportResult {
  return { dry_run: true, applied: false, total: 0, created: 0, updated: 0, errors: 0, rows: [], ...partial }
}

async function openAndUpload(target: CustomersImportTarget, buttonName: string, dialogName: string) {
  const user = userEvent.setup()
  renderWithProviders(
    <CustomersImportButton
      target={target}
      {...(target.kind === 'accountUsers' ? { label: 'customersImport.action.users' as const } : {})}
    />,
  )
  await user.click(screen.getByRole('button', { name: buttonName }))
  const dialog = await screen.findByRole('dialog', { name: dialogName })
  await user.upload(within(dialog).getByLabelText('Elegir archivo .xlsx'), new File(['x'], 'datos.xlsx'))
  return { user, dialog }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importar clientes desde Excel', () => {
  beforeEach(() => {
    // La plantilla trae la «Guía» PRIMERO: la hoja de datos se encuentra por nombre.
    workbook.readWorkbook.mockResolvedValue([
      { sheet: 'Guía', data: [['Plantilla de clientes'], [], ['Hoja', 'Columna']] },
      {
        sheet: 'Clientes',
        data: [
          ['Código', 'Tipo', 'Nombre', 'Documento', 'Segmento', 'Código en ERP', 'Color favorito'],
          ['CLI-1', 'Empresa', 'Botica Central', '20123456789', 'Mayoristas', 'C001', 'azul'],
          ['CLI-2', 'Persona', 'Ana Ruiz', '45678912', null, null, null],
        ],
      },
    ])
  })

  it('simula con las claves técnicas, explica cada error y no deja aplicar', async () => {
    api.importCustomers.mockResolvedValueOnce(
      result({
        total: 2,
        created: 1,
        errors: 1,
        rows: [
          { sheet: 'customers', row: 2, key: 'CLI-1', status: 'error', reason: 'SEGMENTO_NO_ENCONTRADO', field: 'segment', value: 'Mayoristas' },
          { sheet: 'customers', row: 3, key: 'CLI-2', status: 'created' },
        ],
      }),
    )

    const { dialog } = await openAndUpload({ kind: 'customers' }, 'Importar', 'Importar clientes')

    await within(dialog).findByText(/Ese segmento no existe.* · Segmento · «Mayoristas»/)
    expect(api.importCustomers).toHaveBeenCalledWith(
      [
        { row: 2, code: 'CLI-1', kind: 'Empresa', name: 'Botica Central', tax_id: '20123456789', segment: 'Mayoristas', erp_code: 'C001' },
        { row: 3, code: 'CLI-2', kind: 'Persona', name: 'Ana Ruiz', tax_id: '45678912' },
      ],
      true,
    )
    expect(within(dialog).getByText(/Color favorito/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Aplicar importación' })).toBeDisabled()
  })

  it('sin errores aplica las mismas filas', async () => {
    const ok = result({ total: 2, created: 2, rows: [] })
    api.importCustomers.mockResolvedValueOnce(ok).mockResolvedValueOnce({ ...ok, dry_run: false, applied: true })

    const { user, dialog } = await openAndUpload({ kind: 'customers' }, 'Importar', 'Importar clientes')
    await within(dialog).findByText(/Hasta que pulses/)
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar importación' }))

    await within(dialog).findByText('Importación aplicada.')
    const [first, second] = api.importCustomers.mock.calls
    expect(second?.[1]).toBe(false)
    expect(second?.[0]).toEqual(first?.[0])
  })

  it('una hoja sin la columna Código no llega al servidor', async () => {
    workbook.readWorkbook.mockResolvedValueOnce([{ sheet: 'Clientes', data: [['Nombre'], ['Ana']] }])
    const { dialog } = await openAndUpload({ kind: 'customers' }, 'Importar', 'Importar clientes')
    await within(dialog).findByText(/faltan columnas obligatorias: Código/)
    expect(api.importCustomers).not.toHaveBeenCalled()
  })

  it('la plantilla lleva la guía con cada columna explicada', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CustomersImportButton target={{ kind: 'customers' }} />)
    await user.click(screen.getByRole('button', { name: 'Importar' }))
    await user.click(await screen.findByRole('button', { name: 'Descargar plantilla' }))
    await waitFor(() => expect(writer.downloadWorkbook).toHaveBeenCalledTimes(1))

    const [book] = writer.downloadWorkbook.mock.calls[0] ?? []
    expect(book.fileName).toBe('plantilla-clientes')
    expect(book.template).toBe(true)
    expect(book.sheets[0].columns.map((column: { header: string }) => column.header)).toEqual(
      CUSTOMERS_SHEET.columns.map((column) => column.header),
    )
  })
})

describe('importar usuarios B2B', () => {
  beforeEach(() => {
    workbook.readWorkbook.mockResolvedValue([
      {
        sheet: 'Usuarios',
        data: [
          ['Correo', 'Rol', 'Límite de gasto'],
          ['ya@cliente.pe', 'Comprador', 1500],
          ['nueva@cliente.pe', 'Aprobador', null],
        ],
      },
    ])
  })

  it('desde la cuenta: manda su id y ofrece crear los usuarios que faltan', async () => {
    const missing = result({
      total: 2,
      created: 1,
      errors: 1,
      rows: [
        { sheet: 'account_users', row: 2, key: 'B2B-4 · ya@cliente.pe', status: 'created' },
        { sheet: 'account_users', row: 3, key: 'B2B-4 · nueva@cliente.pe', status: 'error', reason: 'SIN_CUENTA', field: 'email', value: 'nueva@cliente.pe' },
      ],
    })
    api.importAccountUsers.mockResolvedValueOnce(missing).mockResolvedValueOnce(result({ total: 2, created: 2 }))
    accounts.mutateAsync.mockResolvedValueOnce({ email: 'nueva@cliente.pe', user_id: null, temporary_password: 'Clave-123' })

    const { user, dialog } = await openAndUpload(
      { kind: 'accountUsers', account: { id: 'acc-1', name: 'Botica Aliada SAC' } },
      'Importar usuarios',
      'Importar usuarios de Botica Aliada SAC',
    )

    await within(dialog).findByText(/Ese correo todavía no tiene usuario · Correo · «nueva@cliente.pe»/)
    expect(api.importAccountUsers).toHaveBeenCalledWith(
      'acc-1',
      [
        { row: 2, email: 'ya@cliente.pe', role: 'Comprador', spending_limit: 1500 },
        { row: 3, email: 'nueva@cliente.pe', role: 'Aprobador' },
      ],
      true,
    )

    await user.click(within(dialog).getByRole('button', { name: 'Crear los usuarios que faltan (1)' }))

    // La contraseña se enseña una vez y se vuelve a revisar el archivo.
    await within(dialog).findByText('nueva@cliente.pe · Clave-123')
    expect(accounts.mutateAsync).toHaveBeenCalledWith('nueva@cliente.pe')
    await waitFor(() => expect(api.importAccountUsers).toHaveBeenCalledTimes(2))
    await within(dialog).findByText(/Hasta que pulses/)
    expect(within(dialog).getByRole('button', { name: 'Aplicar importación' })).toBeEnabled()
  })

  it('desde la pestaña: la hoja exige la columna Cuenta B2B', async () => {
    const { dialog } = await openAndUpload(
      { kind: 'accountUsers', account: null },
      'Importar usuarios',
      'Importar usuarios de cuentas B2B',
    )
    await within(dialog).findByText(/faltan columnas obligatorias: Cuenta B2B/)
    expect(api.importAccountUsers).not.toHaveBeenCalled()
  })
})

describe('plantillas', () => {
  it('cada columna de cada plantilla tiene su explicación en la guía', () => {
    for (const spec of [CUSTOMERS_SHEET, accountUsersSheet(true), accountUsersSheet(false)]) {
      const book = templateBook(spec, t)
      const sheet = book.sheets[0]!
      expect(sheet.columns.map((column) => column.header)).toEqual(spec.columns.map((column) => column.header))
      for (const column of sheet.columns) expect(column.description.length).toBeGreaterThan(10)
      // Los ejemplos rellenan cada fila con tantas celdas como columnas.
      for (const row of sheet.rows) expect(row).toHaveLength(sheet.columns.length)
      expect(buildGuide(book, t).rows.length).toBeGreaterThan(sheet.columns.length)
    }
  })

  it('la hoja de usuarios desde la ficha no pide la cuenta', () => {
    expect(accountUsersSheet(false).columns.map((column) => column.key)).not.toContain('account_code')
    expect(accountUsersSheet(true).columns[0]?.key).toBe('account_code')
  })
})
