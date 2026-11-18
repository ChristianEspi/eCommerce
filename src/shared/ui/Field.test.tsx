import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { DocumentField } from './DocumentField'
import { Field } from './Field'
import type { DocType } from '@/shared/lib/fieldRules'

function Controlado({ rule }: { rule: 'dni' | 'money' }) {
  const [value, setValue] = useState('')
  return <Field label="Campo" rule={rule} value={value} onChange={(e) => setValue(e.target.value)} />
}

describe('Field', () => {
  it('filtra lo que se teclea y respeta el máximo', async () => {
    renderWithProviders(<Controlado rule="dni" />)
    const input = screen.getByLabelText('Campo')
    await userEvent.type(input, '12ab345678999')
    expect(input).toHaveValue('12345678')
    expect(input).toHaveAttribute('maxlength', '8')
    expect(input).toHaveAttribute('inputmode', 'numeric')
  })

  it('un importe se queda con dos decimales', async () => {
    renderWithProviders(<Controlado rule="money" />)
    const input = screen.getByLabelText('Campo')
    await userEvent.type(input, '12,3456')
    expect(input).toHaveValue('12.34')
  })

  it('la ayuda es un botón con tooltip', async () => {
    renderWithProviders(<Field label="RUC" help="Once dígitos de SUNAT" />)
    const boton = screen.getByRole('button', { name: 'Ayuda: RUC' })
    await userEvent.hover(boton)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Once dígitos de SUNAT')
  })
})

function Documento() {
  const [type, setType] = useState<DocType | ''>('ruc')
  const [value, setValue] = useState('')
  return (
    <DocumentField
      docType={type}
      onDocTypeChange={setType}
      numberProps={{ value, onChange: (e) => setValue(e.target.value) }}
    />
  )
}

describe('DocumentField', () => {
  it('el número sigue al tipo elegido', async () => {
    renderWithProviders(<Documento />)
    const numero = screen.getByLabelText('Número de documento')
    await userEvent.type(numero, '201000472189999')
    expect(numero).toHaveValue('20100047218')
    expect(numero).toHaveAttribute('maxlength', '11')
  })
})
