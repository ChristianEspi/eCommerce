import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, STORE_A } from '@/test/supabaseMock'

/**
 * Configuración › Facturación (fase 3). La base valida y guarda en Vault
 * (`supabase/tests/invoicing-*.test.ts`). Aquí: que el token no vuelva a la
 * pantalla, que vacío signifique «conservar», que «Probar» diga qué está mal
 * y que los datos de comprobantes viajen bien convertidos.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { InvoicingSettingsSection } = await import('./InvoicingSettingsSection')

const RUTA = 'https://api.nubefact.com/api/v1/03989d1a-6c8c-4b71-b1cd-7d37001deaa0'
const TOKEN = 'd0a80b88cde446d092025465bdb4673e103a0d881ca6479ebbab10664dbc5677'

function pintar(options: { configured?: boolean; test?: () => unknown; failSettings?: string } = {}) {
  const fake = createFakeSupabase({
    session: makeSession(),
    tables: {
      invoice_settings: [],
      invoice_sequences: [{ series: 'B001', last_number: 41 }],
      tenant_integrations: options.configured
        ? [{ provider_code: 'nubefact', is_active: true, config: { ruta_hint: 'https://api.nubefact.com/api/v1/…eaa0', token_hint: '…5677' } }]
        : [],
    },
    rpc: {
      invoicing_nubefact_configure: () => ({ provider: 'nubefact' }),
      invoice_settings_configure: () => {
        if (options.failSettings) throw { message: `${options.failSettings}: no`, code: '22023' }
        return {}
      },
    },
    functions: { 'invoicing-test': options.test ?? (() => ({ ok: true, code: null })) },
  })
  holder.client = fake
  renderWithProviders(<InvoicingSettingsSection storeId={STORE_A} />, { session: fake.state.session })
  return fake
}

describe('Configuración › Facturación', () => {
  it('sin configurar: lo dice, no deja probar y guarda ruta + token', async () => {
    const user = userEvent.setup()
    const fake = pintar()
    expect(await screen.findByText('Sin configurar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Probar conexión' })).toBeDisabled()
    const guardar = screen.getByRole('button', { name: 'Guardar emisor' })
    expect(guardar).toBeDisabled()

    await user.type(screen.getByLabelText('Ruta (URL de la API)'), RUTA)
    await user.type(screen.getByLabelText('Token'), TOKEN)
    await user.click(screen.getByLabelText('Emitir con Nubefact'))
    await user.click(guardar)
    await waitFor(() => expect(fake.state.rpcCalls.some((c) => c.name === 'invoicing_nubefact_configure')).toBe(true))
    expect(fake.state.rpcCalls.find((c) => c.name === 'invoicing_nubefact_configure')?.args).toEqual({
      p_store_id: STORE_A, p_ruta: RUTA, p_token: TOKEN, p_active: true,
    })
    await waitFor(() => expect(screen.getByLabelText('Token')).toHaveValue(''))
  })

  it('configurado: muestra pistas, nunca el token, y vacío conserva el guardado', async () => {
    const user = userEvent.setup()
    const fake = pintar({ configured: true })
    expect(await screen.findByText('Activo')).toBeInTheDocument()
    expect(screen.getByText(/token …5677/)).toBeInTheDocument()
    expect(screen.getByLabelText('Token')).toHaveValue('')
    expect(document.body.textContent).not.toContain(TOKEN)

    await user.type(screen.getByLabelText('Ruta (URL de la API)'), RUTA)
    await user.click(screen.getByRole('button', { name: 'Guardar emisor' }))
    await waitFor(() =>
      expect(fake.state.rpcCalls.find((c) => c.name === 'invoicing_nubefact_configure')?.args).toMatchObject({ p_token: '' }),
    )
  })

  it('probar conexión: éxito y token rechazado, con frases', async () => {
    const user = userEvent.setup()
    pintar({ configured: true })
    await user.click(await screen.findByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByText(/Conexión correcta/)).toBeInTheDocument()
  })

  it('probar conexión: token rechazado', async () => {
    const user = userEvent.setup()
    pintar({ configured: true, test: () => ({ ok: false, code: 'NUBEFACT_10' }) })
    await user.click(await screen.findByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByText(/no aceptó el token/)).toBeInTheDocument()
  })

  it('comprobantes: correlativo actual, conversión del IGV y error que se explica', async () => {
    const user = userEvent.setup()
    const fake = pintar({ failSettings: 'CORRELATIVO_NO_RETROCEDE' })
    expect(await screen.findByText('Último número emitido: 41')).toBeInTheDocument()

    const serie = screen.getByLabelText('Serie de boletas')
    await user.clear(serie)
    await user.type(serie, 'x01')
    expect(screen.getByRole('button', { name: 'Guardar comprobantes' })).toBeDisabled()
    await user.clear(serie)
    await user.type(serie, 'b002')

    await user.type(screen.getByLabelText('Último número de boleta ya emitido (opcional)'), '10')
    await user.click(screen.getByLabelText('Emitir automáticamente al cobrar'))
    await user.click(screen.getByRole('button', { name: 'Guardar comprobantes' }))
    await waitFor(() => expect(fake.state.rpcCalls.some((c) => c.name === 'invoice_settings_configure')).toBe(true))
    expect(fake.state.rpcCalls.find((c) => c.name === 'invoice_settings_configure')?.args).toEqual({
      p_store_id: STORE_A,
      p_receipt_series: 'B002',
      p_invoice_series: 'F001',
      p_shipping_tax_rate: '0.18',
      p_zero_rate_affectation: 'exonerado',
      p_auto_issue: true,
      p_receipt_last_number: 10,
      p_invoice_last_number: null,
    })
    expect(await screen.findByText(/no puede retroceder/)).toBeInTheDocument()
  })
})
