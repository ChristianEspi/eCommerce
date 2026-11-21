import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession } from '@/test/supabaseMock'

/**
 * «Mi cuenta» › detalle del pedido › comprobante (facturación fase 4) y su PDF
 * en el visor de la propia tienda (2026-11-20). Quién puede verlo lo decide la
 * base (`supabase/tests/invoicing-buyer.test.ts`, `invoicing-pdf.test.ts`).
 */

const holder = vi.hoisted(() => ({ client: null as unknown, rendered: 0 }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

// jsdom no dibuja canvas: pdf.js se sustituye por un dibujo de una página.
vi.mock('@/shared/lib/pdf/renderPdf', async (original) => ({
  ...(await original<typeof import('@/shared/lib/pdf/renderPdf')>()),
  renderPdf: async () => {
    holder.rendered += 1
    return [{ canvas: document.createElement('canvas'), width: 600, height: 800 }]
  },
}))

const { OrderInvoiceBlock } = await import('./OrderInvoiceBlock')

const ORDER = '11111111-1111-4111-8111-111111111111'
const INVOICE = '22222222-2222-4222-8222-222222222222'

function pintar(respuesta: () => unknown, pdf?: () => unknown) {
  const fake = createFakeSupabase({
    session: makeSession(),
    rpc: { my_order_invoice: respuesta },
    functions: {
      'invoice-pdf': pdf ?? (() => ({ filename: 'BBB1-00000001.pdf', title: 'BBB1-00000001', content_base64: btoa('%PDF-1.4 x') })),
    },
  })
  holder.client = fake
  renderWithProviders(<OrderInvoiceBlock orderId={ORDER} />, { session: fake.state.session })
  return fake
}

describe('comprobante del pedido', () => {
  it('emitida con PDF: número, estado y «Ver comprobante» abre el visor en la tienda', async () => {
    const user = userEvent.setup()
    const fake = pintar(() => ({
      id: INVOICE, document_type: 'receipt', series: 'B001', number: '00000123', status: 'accepted',
      pdf_url: 'https://www.nubefact.com/cpe/abc.pdf',
    }))
    expect(await screen.findByText('Boleta B001-00000123')).toBeInTheDocument()
    expect(screen.getByText('Aceptada por SUNAT')).toBeInTheDocument()
    // Ya no hay enlace que saque al comprador de la tienda.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ver comprobante' }))
    const visor = await screen.findByRole('dialog')
    await waitFor(() => expect(holder.rendered).toBeGreaterThan(0))
    expect(within(visor).getByRole('button', { name: 'Descargar' })).toBeEnabled()
    // Se pide por id: la base vuelve a comprobar que es suyo.
    expect(fake.state.invocations).toContainEqual(
      expect.objectContaining({ name: 'invoice-pdf', body: { invoice_id: INVOICE } }),
    )
  })

  it('el visor arranca a tamaño real (100 %) y acerca/aleja sin volver a pedir el PDF', async () => {
    const user = userEvent.setup()
    const fake = pintar(() => ({
      id: INVOICE, document_type: 'receipt', series: 'BBB1', number: '00000001', status: 'issued',
      pdf_url: 'https://www.nubefact.com/cpe/abc.pdf',
    }))
    await user.click(await screen.findByRole('button', { name: 'Ver comprobante' }))
    const visor = await screen.findByRole('dialog')
    expect(within(visor).getByText('100 %')).toBeInTheDocument()
    await waitFor(() => expect(within(visor).getByRole('button', { name: 'Acercar' })).toBeEnabled())
    await user.click(within(visor).getByRole('button', { name: 'Acercar' }))
    expect(within(visor).getByText('125 %')).toBeInTheDocument()
    await user.click(within(visor).getByRole('button', { name: 'Alejar' }))
    await user.click(within(visor).getByRole('button', { name: 'Alejar' }))
    expect(within(visor).getByText('75 %')).toBeInTheDocument()
    expect(fake.state.invocations.filter((c) => c.name === 'invoice-pdf')).toHaveLength(1)
  })

  it('si el PDF no se puede traer, el visor lo dice', async () => {
    const user = userEvent.setup()
    pintar(
      () => ({ id: INVOICE, document_type: 'receipt', series: 'B001', number: '00000123', status: 'issued', pdf_url: 'https://www.nubefact.com/cpe/abc.pdf' }),
      () => {
        throw new Error('PDF_NO_DISPONIBLE')
      },
    )
    await user.click(await screen.findByRole('button', { name: 'Ver comprobante' }))
    expect(await screen.findByText(/No se pudo mostrar el PDF/)).toBeInTheDocument()
  })

  it('pendiente: sin número ni botón; un PDF que no es https no se ofrece', async () => {
    pintar(() => ({ id: INVOICE, document_type: 'invoice', series: 'F001', number: null, status: 'pending', pdf_url: 'http://x.pe/a.pdf' }))
    expect(await screen.findByText('Factura F001')).toBeInTheDocument()
    expect(screen.getByText('En preparación')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver comprobante' })).not.toBeInTheDocument()
  })

  it('sin comprobante: no se pinta nada', async () => {
    pintar(() => null)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Boleta|Factura/)).not.toBeInTheDocument()
  })
})
