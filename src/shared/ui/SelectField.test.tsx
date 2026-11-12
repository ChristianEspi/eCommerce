import { MenuItem } from '@mui/material'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { SEARCH_FROM_OPTIONS, SelectField } from './SelectField'

const PRODUCTOS = [
  ['a', 'FX-001 · Taladro percutor'],
  ['b', 'FX-002 · Martillo de bola'],
  ['c', 'FX-003 · Llave inglesa'],
  ['d', 'FX-004 · Destornillador eléctrico'],
  ['e', 'FX-005 · Sierra circular'],
  ['f', 'FX-006 · Cinta métrica'],
  ['g', 'FX-007 · Nivel de burbuja'],
  ['h', 'FX-008 · Alicate universal'],
] as const

function Campo({ opciones = PRODUCTOS }: { opciones?: ReadonlyArray<readonly [string, string]> }) {
  const [value, setValue] = useState('')
  return (
    <SelectField label="Producto" value={value} onChange={(event) => setValue(event.target.value)}>
      {opciones.map(([id, label]) => (
        <MenuItem key={id} value={id}>
          {label}
        </MenuItem>
      ))}
    </SelectField>
  )
}

const visibles = () =>
  within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .filter((option) => option.style.display !== 'none' && option.tagName === 'LI' && option.dataset.value)

describe('SelectField', () => {
  it('con una lista larga, filtra sin distinguir tildes ni mayúsculas y elige', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Campo />)

    await user.click(screen.getByRole('combobox', { name: 'Producto' }))
    const buscador = screen.getByRole('textbox', { name: 'Buscar en la lista…' })
    expect(buscador).toHaveFocus()
    expect(visibles()).toHaveLength(PRODUCTOS.length)

    await user.type(buscador, 'METRICA')
    expect(visibles().map((o) => o.textContent)).toEqual(['FX-006 · Cinta métrica'])

    await user.click(screen.getByRole('option', { name: 'FX-006 · Cinta métrica' }))
    expect(screen.getByRole('combobox', { name: 'Producto' })).toHaveTextContent('FX-006 · Cinta métrica')
  })

  it('busca también por SKU y avisa cuando nada coincide', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Campo />)

    await user.click(screen.getByRole('combobox', { name: 'Producto' }))
    const buscador = screen.getByRole('textbox', { name: 'Buscar en la lista…' })
    await user.type(buscador, 'fx-002')
    expect(visibles().map((o) => o.textContent)).toEqual(['FX-002 · Martillo de bola'])

    await user.clear(buscador)
    await user.type(buscador, 'zzz')
    expect(visibles()).toHaveLength(0)
    expect(screen.getByText('Ninguna opción coincide')).toBeInTheDocument()
  })

  it('con pocas opciones no pone buscador', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Campo opciones={PRODUCTOS.slice(0, SEARCH_FROM_OPTIONS - 1)} />)

    await user.click(screen.getByRole('combobox', { name: 'Producto' }))
    expect(screen.queryByRole('textbox', { name: 'Buscar en la lista…' })).not.toBeInTheDocument()
  })
})
