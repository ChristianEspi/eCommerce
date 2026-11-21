import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase, makeSession, STORE_A } from '@/test/supabaseMock'

/**
 * Configuración → Correo → Textos de los correos.
 *
 * La base valida rol, tienda y variables (`supabase/tests/email-templates.test.ts`).
 * Aquí: que se vea el texto original, que el botón inserte la variable donde
 * está el cursor, que una variable inventada impida guardar y que guardar y
 * restaurar llamen a sus RPC con la tienda.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { EmailTemplatesSection } = await import('./EmailTemplatesSection')

function pintar(rows: Array<Record<string, unknown>> = []) {
  const fake = createFakeSupabase({
    session: makeSession(),
    tables: { email_templates: rows.map((r) => ({ store_id: STORE_A, updated_at: new Date().toISOString(), ...r })) },
    rpc: { email_template_save: () => ({}), email_template_reset: () => ({}) },
  })
  holder.client = fake
  renderWithProviders(<EmailTemplatesSection storeId={STORE_A} storeName="Mi Tienda" storeSlug="mi-tienda" />, {
    session: fake.state.session,
  })
  return fake
}

describe('Textos de los correos', () => {
  it('sin personalizar muestra el texto original y no deja guardar sin cambios', async () => {
    pintar()
    expect(await screen.findByDisplayValue('Recibimos tu pedido {{pedido}}')).toBeInTheDocument()
    expect(screen.getByText('Texto original')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar texto' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Restaurar original' })).not.toBeInTheDocument()
  })

  it('insertar un dato lo pone en el campo con foco y se puede guardar', async () => {
    const user = userEvent.setup()
    const fake = pintar()
    const titulo = await screen.findByLabelText('Título')
    await user.clear(titulo)
    await user.type(titulo, 'Gracias ')
    await user.click(screen.getByText('Nombre del cliente {{cliente}}'))
    expect(titulo).toHaveValue('Gracias {{cliente}}')

    await user.click(screen.getByRole('button', { name: 'Guardar texto' }))
    await waitFor(() => expect(fake.state.rpcCalls.some((c) => c.name === 'email_template_save')).toBe(true))
    const call = fake.state.rpcCalls.find((c) => c.name === 'email_template_save')
    expect(call?.args).toMatchObject({
      p_store_id: STORE_A,
      p_kind: 'order.confirmed',
      p_locale: 'es',
      p_title: 'Gracias {{cliente}}',
    })
  })

  it('un dato inventado avisa y bloquea guardar', async () => {
    const user = userEvent.setup()
    pintar()
    const mensaje = await screen.findByLabelText('Mensaje')
    await user.clear(mensaje)
    await user.type(mensaje, 'Hola {{{{clave}}')
    expect(await screen.findByText(/no es un dato de este aviso/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar texto' })).toBeDisabled()
  })

  it('personalizado: lo carga, lo marca y permite restaurar con confirmación', async () => {
    const user = userEvent.setup()
    const fake = pintar([
      { kind: 'order.confirmed', locale: 'es', subject: 'Ya tenemos tu pedido {{pedido}}', title: 'Gracias', body: 'Hola' },
    ])
    expect(await screen.findByDisplayValue('Ya tenemos tu pedido {{pedido}}')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restaurar original' }))
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Restaurar original' }))
    await waitFor(() => expect(fake.state.rpcCalls.some((c) => c.name === 'email_template_reset')).toBe(true))
  })

  it('la vista previa usa los datos de ejemplo y el asunto resuelto', async () => {
    pintar()
    expect(await screen.findByText('Recibimos tu pedido EC-20261120-00058')).toBeInTheDocument()
  })
})
