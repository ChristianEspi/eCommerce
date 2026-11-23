/**
 * 2026-11-22 · «Completar fichas con IA» (asistente de ficha en lote).
 *
 * Lo que se fija:
 *  · el lote se limita al saldo de IA y lo dice antes de gastar;
 *  · cada propuesta es la llamada de siempre (`assist`, descripción y atributos);
 *  · NADA se guarda al proponer; al guardar, solo la descripción (editada) y los
 *    atributos aceptados, por sus comandos de siempre;
 *  · lo que se desmarca no se guarda; sin cuota, se para solo.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'

const holder = vi.hoisted(() => ({
  availability: 'available' as string,
  remaining: 2 as number | null,
  fetch: vi.fn(),
  cleanupRows: vi.fn(),
  suggest: vi.fn(),
  saveDescription: vi.fn(),
  saveAttribute: vi.fn(),
}))

vi.mock('@/features/ai/hooks', () => ({
  useAiFeature: () => ({ availability: holder.availability, entitlement: { enabled: true, status: 'active', remaining: holder.remaining ?? undefined } }),
}))
vi.mock('./api/copy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/copy')>()),
  pedirSugerenciasDeFicha: holder.suggest,
}))
vi.mock('./api/products', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/products')>()),
  fetchProductsWithoutDescription: holder.fetch,
  fetchCatalogCleanupRows: holder.cleanupRows,
  updateProductDescription: holder.saveDescription,
}))
vi.mock('./pim/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pim/api')>()),
  saveProductAttribute: holder.saveAttribute,
}))

const { BulkCopyAction } = await import('./BulkCopyAction')

const ORG = '00000000-0000-4000-8000-0000000000a1'
const COMPANY = '00000000-0000-4000-8000-0000000000b1'
const STORE = '00000000-0000-4000-8000-0000000000c1'
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'
const ATTR = '44444444-4444-4444-8444-444444444444'
const OPTION = '55555555-5555-4555-8555-555555555555'

function sugerencia(description: string | null, attributes: unknown[] = []) {
  return {
    suggestions: {
      title: null,
      short_description: null,
      description,
      seo_title: null,
      seo_description: null,
      normalized_name: null,
      category: null,
      attributes,
      duplicates: [],
      tags: [],
      discarded: 0,
    },
    motivo: null,
    interactionId: null,
    system: null,
  }
}

function pintar() {
  renderWithProviders(
    <BulkCopyAction companyId={COMPANY} storeId={STORE} scope={{ organizationId: ORG, companyId: COMPANY, storeId: STORE }} />,
  )
}

beforeEach(() => {
  holder.availability = 'available'
  holder.remaining = 2
  holder.fetch.mockReset()
  holder.suggest.mockReset()
  holder.saveDescription.mockReset().mockResolvedValue(undefined)
  holder.saveAttribute.mockReset().mockResolvedValue(undefined)
  holder.fetch.mockResolvedValue({
    rows: [
      { id: P1, sku: 'LEJ-5', name: 'Lejía 5 L', brand_name: null },
      { id: P2, sku: 'JAB-1', name: 'Jabón líquido 1 L', brand_name: null },
      { id: P3, sku: 'ESC-1', name: 'Escoba', brand_name: null },
    ],
    total: 3,
  })
})

describe('BulkCopyAction', () => {
  it('limita al saldo, propone sin guardar y guarda solo lo revisado', async () => {
    holder.suggest.mockImplementation(async ({ productId }: { productId: string }) =>
      productId === P1
        ? sugerencia('Bidón de 5 L de lejía.', [
            { attribute_id: ATTR, name: 'Contenido', display: '5 L', value: { kind: 'option', option_id: OPTION }, reason: '' },
          ])
        : sugerencia('Botella de 1 L de jabón líquido.'),
    )
    pintar()
    await userEvent.click(screen.getByRole('button', { name: 'Completar fichas con IA' }))

    expect(await screen.findByText('3 productos sin descripción')).toBeInTheDocument()
    expect(screen.getByText(/Se propondrán 2 fichas; cada una usa 1 consulta de IA\. Te quedan 2\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Proponer 2 fichas' }))

    const descripcion = await screen.findByRole('textbox', { name: /descripción propuesta · lejía 5 l/i })
    expect(holder.suggest).toHaveBeenCalledTimes(2)
    expect(holder.suggest).toHaveBeenCalledWith(expect.objectContaining({ productId: P1, storeId: STORE, tasks: ['description', 'attributes'] }))
    expect(holder.saveDescription).not.toHaveBeenCalled()

    await userEvent.clear(descripcion)
    await userEvent.type(descripcion, 'Bidón de lejía de 5 L.')
    await userEvent.click(screen.getByRole('checkbox', { name: /guardar descripción · jabón líquido/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar 1 fichas' }))

    expect(await screen.findByText('Guardadas 1; con error 0.')).toBeInTheDocument()
    expect(holder.saveDescription).toHaveBeenCalledTimes(1)
    expect(holder.saveDescription).toHaveBeenCalledWith(P1, 'Bidón de lejía de 5 L.')
    expect(holder.saveAttribute).toHaveBeenCalledWith({
      productId: P1,
      attributeId: ATTR,
      scope: { organizationId: ORG, companyId: COMPANY, storeId: STORE },
      value: { kind: 'option', optionId: OPTION },
    })
  })

  it('sin cuota se para solo y lo dice', async () => {
    holder.remaining = null
    holder.suggest.mockResolvedValue({ suggestions: null, motivo: 'sin_cuota', interactionId: null, system: null })
    pintar()
    await userEvent.click(screen.getByRole('button', { name: 'Completar fichas con IA' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer 3 fichas' }))
    expect(await screen.findByText(/se acabó la cuota de ia/i)).toBeInTheDocument()
    expect(holder.suggest.mock.calls.length).toBeLessThan(3)
    expect(screen.getByRole('button', { name: 'Guardar 0 fichas' })).toBeDisabled()
  })

  it('sin permiso de rol no se enseña el botón', () => {
    holder.availability = 'forbidden'
    pintar()
    expect(screen.queryByRole('button', { name: 'Completar fichas con IA' })).not.toBeInTheDocument()
  })

  it('modo atributos: solo productos sin atributos, pide solo atributos y no toca la descripción', async () => {
    holder.cleanupRows.mockResolvedValue([
      { product_id: P1, sku: 'LEJ-5', name: 'Lejía 5 L', brand_name: null, kind: 'simple', status: 'published', has_image: true, has_description: true, has_category: true, has_attributes: false },
      { product_id: P2, sku: 'JAB-1', name: 'Jabón líquido 1 L', brand_name: null, kind: 'simple', status: 'published', has_image: true, has_description: true, has_category: true, has_attributes: true },
    ])
    holder.suggest.mockResolvedValue(
      sugerencia('No debería usarse', [{ attribute_id: ATTR, name: 'Contenido', display: '5 L', value: { kind: 'option', option_id: OPTION }, reason: '' }]),
    )
    pintar()
    await userEvent.click(screen.getByRole('button', { name: 'Completar fichas con IA' }))
    await userEvent.click(screen.getByRole('button', { name: 'Atributos (etiquetado)' }))
    expect(await screen.findByText('1 productos sin atributos')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Proponer 1 fichas' }))

    await screen.findByRole('checkbox', { name: /guardar atributos · lejía 5 l/i })
    expect(holder.suggest).toHaveBeenCalledWith(expect.objectContaining({ productId: P1, tasks: ['attributes'] }))
    expect(screen.queryByRole('textbox', { name: /descripción propuesta/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /guardar 1/i }))
    await screen.findByText(/Guardadas 1/)
    expect(holder.saveDescription).not.toHaveBeenCalled()
    expect(holder.saveAttribute).toHaveBeenCalledTimes(1)
  })
})
