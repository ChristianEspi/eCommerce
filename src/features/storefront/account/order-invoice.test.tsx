import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession } from '@/test/supabaseMock'

/**
 * «Mi cuenta» › detalle del pedido › comprobante (facturación fase 4).
 * Quién puede verlo lo decide la base (`supabase/tests/invoicing-buyer.test.ts`).
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { OrderInvoiceBlock } = await import('./OrderInvoiceBlock')

const ORDER = '11111111-1111-4111-8111-111111111111'

function pintar(respuesta: () => unknown) {
  const fake = createFakeSupabase({ session: makeSession(), rpc: { my_order_invoice: respuesta } })
  holder.client = fake
  renderWithProviders(<OrderInvoiceBlock orderId={ORDER} />, { session: fake.state.session })
  return fake
}

describe('comprobante del pedido', () => {
  it('emitida con PDF: número, estado y descarga en pestaña nueva', async () => {
    pintar(() => ({
      document_type: 'receipt', series: 'B001', number: '00000123', status: 'accepted',
      pdf_url: 'https://www.nubefact.com/cpe/abc.pdf',
    }))
    expect(await screen.findByText('Boleta B001-00000123')).toBeInTheDocument()
    expect(screen.getByText('Aceptada por SUNAT')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Descargar PDF' })
    expect(link).toHaveAttribute('href', 'https://www.nubefact.com/cpe/abc.pdf')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('pendiente: sin número ni botón; un PDF que no es https no se enlaza', async () => {
    pintar(() => ({ document_type: 'invoice', series: 'F001', number: null, status: 'pending', pdf_url: 'http://x.pe/a.pdf' }))
    expect(await screen.findByText('Factura F001')).toBeInTheDocument()
    expect(screen.getByText('En preparación')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Descargar PDF' })).not.toBeInTheDocument()
  })

  it('sin comprobante o con error: no se pinta nada', async () => {
    pintar(() => null)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Boleta|Factura/)).not.toBeInTheDocument()
  })
})
