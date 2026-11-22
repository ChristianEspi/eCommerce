import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { checkIntakeFile, intakeMotivoKey, preselected, type IntakeLine } from './intake'

/**
 * «Con IA» del pedido rápido, en pantalla (2026-11-19).
 *
 * Lo que se fija:
 *  · lo dudoso NO empieza marcado: la persona decide;
 *  · a quien llama solo le llegan SKU y cantidad de lo marcado;
 *  · sin IA disponible se dice, y no se inventa nada que revisar.
 */

const holder = vi.hoisted(() => ({ result: null as unknown }))

vi.mock('./intake', async (importOriginal) => {
  const real = await importOriginal<typeof import('./intake')>()
  return { ...real, readIntake: vi.fn(async () => holder.result) }
})

const { IntakePanel } = await import('./IntakePanel')

const product = (sku: string, name: string) => ({
  product_id: `1111111${sku.length}-1111-4111-8111-11111111111${sku.length}`,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  sku,
  kind: 'simple' as const,
  brand_name: null,
  in_stock: true,
})

const line = (over: Partial<IntakeLine>): IntakeLine => ({
  indice: 0,
  presentaciones: [],
  texto: 'Donecil 10 mg',
  cantidad: 3,
  cantidad_supuesta: false,
  unidad: 'caja',
  sku_leido: null,
  legible: true,
  confianza: 'probable',
  sku_propuesto: 'DON-10',
  coincidencia: product('DON-10', 'Donecil 10 mg x 30'),
  alternativas: [],
  ...over,
})

beforeEach(() => {
  holder.result = null
})

describe('preselección y archivo', () => {
  it('solo se marca sola una línea con código o coincidencia clara', () => {
    expect(preselected(line({}))).toBe(true)
    expect(preselected(line({ confianza: 'codigo' }))).toBe(true)
    expect(preselected(line({ confianza: 'dudosa' }))).toBe(false)
    expect(preselected(line({ confianza: 'variante', sku_propuesto: null }))).toBe(false)
  })

  it('el navegador mira tipo y tamaño antes de subir', () => {
    expect(checkIntakeFile({ type: 'image/png', size: 10 })).toBeNull()
    expect(checkIntakeFile({ type: 'image/svg+xml', size: 10 })).toBe('TIPO_NO_ADMITIDO')
    expect(checkIntakeFile({ type: 'image/png', size: 5 * 1024 * 1024 })).toBe('ARCHIVO_DEMASIADO_GRANDE')
    expect(checkIntakeFile({ type: 'application/pdf', size: 0 })).toBe('ARCHIVO_VACIO')
  })

  it('sin créditos no se disfraza de «no disponible»', () => {
    expect(intakeMotivoKey('sin_cuota')).toBe('store.intake.noCredits')
    expect(intakeMotivoKey('rate_limit')).toBe('store.intake.busy')
    expect(intakeMotivoKey('timeout')).toBe('store.intake.busy')
    expect(intakeMotivoKey('sin_proveedor')).toBe('store.intake.unavailable')
  })
})

describe('IntakePanel', () => {
  it('lo dudoso empieza sin marcar y solo lo marcado pasa, con SKU y cantidad', async () => {
    holder.result = {
      data: {
        lineas: [
          line({ indice: 0 }),
          line({
            indice: 1,
            texto: 'doxiplus',
            confianza: 'dudosa',
            sku_propuesto: 'DOX-100',
            coincidencia: product('DOX-100', 'Doxiplus 100 mg'),
            cantidad: 1,
          }),
        ],
        notas: null,
      },
      motivo: null,
      interactionId: 'x',
    }
    const onAccept = vi.fn()
    renderWithProviders(<IntakePanel storeSlug="botica" onAccept={onAccept} />)

    await userEvent.type(screen.getByRole('textbox', { name: /escribe tu pedido/i }), '3 donecil y un doxiplus')
    await userEvent.click(screen.getByRole('button', { name: /leer pedido/i }))

    const accept = await screen.findByRole('button', { name: /pasar 1 líneas al pedido/i })
    expect(screen.getByText('Revisar')).toBeInTheDocument()
    await userEvent.click(accept)
    expect(onAccept).toHaveBeenCalledWith([{ sku: 'DON-10', quantity: 3 }])
  })

  it('sin créditos lo dice tal cual y no enseña revisión', async () => {
    holder.result = { data: null, motivo: 'sin_cuota', interactionId: null }
    renderWithProviders(<IntakePanel storeSlug="botica" onAccept={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox', { name: /escribe tu pedido/i }), '2 jabones')
    await userEvent.click(screen.getByRole('button', { name: /leer pedido/i }))
    await waitFor(() => expect(screen.getByText(/se acabaron los créditos de ia/i)).toBeInTheDocument())
    expect(screen.queryByText(/revisa lo que leímos/i)).not.toBeInTheDocument()
  })
})
