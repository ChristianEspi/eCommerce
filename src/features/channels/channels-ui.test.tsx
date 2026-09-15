import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'
import { mapChannelCode } from './errors'

/**
 * Canales de venta en pantalla (cierre · item 7).
 *
 * Lo que se comprueba montando el árbol:
 *
 *  · la lista dice, por canal, si exige sesión y CUÁNTO catálogo tiene
 *    declarado («todo el catálogo» cuando no hay filas);
 *  · un solo buscador general filtra por código, nombre o tipo;
 *  · crear un canal B2B manda la sesión que le corresponde sin preguntarla;
 *  · cambiar el canal por defecto pasa por la RPC, con SOLO el id;
 *  · las acciones que dejarían la tienda pública sin puerta salen apagadas y
 *    con el motivo en la etiqueta;
 *  · un error de la base se traduce, no se pinta crudo.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { TenantProvider } = await import('@/features/tenant/TenantProvider')
const { CapabilitiesProvider } = await import('@/features/capabilities/CapabilitiesProvider')
const { ChannelsPage } = await import('./ChannelsPage')

const PUBLICO = '66666666-6666-4666-8666-666666666601'
const WEB = '66666666-6666-4666-8666-666666666602'
const MAYORISTA = '66666666-6666-4666-8666-666666666603'
const INTERNO = '66666666-6666-4666-8666-666666666604'

function canal(id: string, code: string, name: string, kind: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG,
    company_id: COMPANY_A,
    store_id: STORE_A,
    code,
    name,
    kind,
    is_default: false,
    requires_auth: kind !== 'b2c',
    is_active: true,
    ...extra,
  }
}

function backend(
  options: { role?: string; setDefault?: (args: Record<string, unknown>) => unknown } = {},
): FakeSupabase {
  const { role = 'admin' } = options
  const fake: FakeSupabase = createFakeSupabase({
    session: makeSession(),
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        { organization_id: ORG, company_id: COMPANY_A, user_id: USER, role, status: 'active' },
      ],
      stores: [
        {
          id: STORE_A,
          organization_id: ORG,
          company_id: COMPANY_A,
          slug: 'mi-negocio',
          name: 'Mi Negocio',
          status: 'active',
          currency: 'PEN',
        },
      ],
      channels: [
        canal(PUBLICO, 'b2c', 'Tienda pública', 'b2c', { is_default: true }),
        canal(WEB, 'web-2', 'Web secundaria', 'b2c'),
        canal(MAYORISTA, 'mayorista', 'Mayorista', 'b2b'),
        canal(INTERNO, 'interno', 'Colaboradores', 'internal', { is_active: false }),
      ],
    },
    rpc: {
      channel_catalog_summary: () => [
        { channel_id: PUBLICO, product_count: 0 },
        { channel_id: WEB, product_count: 0 },
        { channel_id: MAYORISTA, product_count: '3' },
        { channel_id: INTERNO, product_count: 1 },
      ],
      channel_set_default:
        options.setDefault ??
        ((args) => {
          // El doble hace lo que hace la base: quita la marca y la pone, junto.
          for (const row of fake.state.tables.channels ?? []) {
            row.is_default = row.id === args.p_channel_id
          }
          return { channel_id: args.p_channel_id, previous_default_id: PUBLICO, changed: true }
        }),
    },
  })
  return fake
}

function pintar(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <ChannelsPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

function filaCon(texto: string): HTMLElement {
  const fila = screen.getAllByRole('row').find((row) => row.textContent?.includes(texto))
  if (!fila) throw new Error(`No hay una fila con «${texto}»`)
  return fila
}
describe('la lista de canales', () => {
  it('dice el acceso y cuánto catálogo tiene cada canal', async () => {
    pintar(backend())
    await screen.findByText('Mayorista')

    const publico = filaCon('Tienda pública')
    expect(within(publico).getByText('Pública')).toBeInTheDocument()
    expect(within(publico).getByText('Todo el catálogo')).toBeInTheDocument()
    expect(within(publico).getByText('Por defecto')).toBeInTheDocument()

    const mayorista = filaCon('Mayorista')
    expect(within(mayorista).getByText('Con sesión')).toBeInTheDocument()
    expect(within(mayorista).getByText('3 productos')).toBeInTheDocument()
    expect(within(filaCon('Colaboradores')).getByText('1 producto')).toBeInTheDocument()
  })

  it('un solo buscador filtra por código, nombre o tipo', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('Mayorista')

    await user.type(screen.getByRole('searchbox', { name: 'Buscar por código, nombre o tipo' }), 'interno')

    expect(screen.getByText('Colaboradores')).toBeInTheDocument()
    expect(screen.queryByText('Mayorista')).not.toBeInTheDocument()
  })
})

describe('las guardas en el canal por defecto', () => {
  it('no se ofrece desactivar el de defecto, y la etiqueta dice por qué', async () => {
    pintar(backend())
    await screen.findByText('Mayorista')

    const boton = within(filaCon('Tienda pública')).getByRole('button', {
      name: 'El canal por defecto no se puede desactivar: elige otro por defecto primero: Tienda pública',
    })
    expect(boton).toBeDisabled()
  })

  it('un canal cerrado o inactivo no se ofrece como defecto, con su motivo', async () => {
    pintar(backend())
    await screen.findByText('Mayorista')

    expect(
      within(filaCon('Mayorista')).getByRole('button', {
        name: 'Solo un canal B2C puede ser el de defecto: Mayorista',
      }),
    ).toBeDisabled()
    expect(
      within(filaCon('Colaboradores')).getByRole('button', {
        name: 'Actívalo antes de usarlo por defecto: Colaboradores',
      }),
    ).toBeDisabled()
  })

  it('cambiar el defecto pide confirmación y manda SOLO el id a la RPC', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('Mayorista')

    await user.click(
      within(filaCon('Web secundaria')).getByRole('button', { name: 'Usar por defecto: Web secundaria' }),
    )
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('Usar «Web secundaria» por defecto')).toBeInTheDocument()
    await user.click(within(dialogo).getByRole('button', { name: 'Usar por defecto' }))

    await vi.waitFor(() =>
      expect(fake.state.rpcCalls.filter((c) => c.name === 'channel_set_default')).toHaveLength(1),
    )
    // Ni tenant ni tienda en el payload: quién puede y sobre qué tienda lo
    // decide la base con el token de la sesión.
    const llamada = fake.state.rpcCalls.find((c) => c.name === 'channel_set_default')
    expect(llamada?.args).toEqual({ p_channel_id: WEB })

    await vi.waitFor(() =>
      expect(within(filaCon('Web secundaria')).getByText('Por defecto')).toBeInTheDocument(),
    )
  })

  it('un error de la base se traduce, no se pinta crudo', async () => {
    const user = userEvent.setup()
    const fake = backend({
      setDefault: () => {
        throw { message: 'CANAL_INACTIVO: un canal inactivo no puede ser el canal por defecto', code: '22023' }
      },
    })
    pintar(fake)
    await screen.findByText('Mayorista')

    await user.click(
      within(filaCon('Web secundaria')).getByRole('button', { name: 'Usar por defecto: Web secundaria' }),
    )
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Usar por defecto' }))

    expect(
      await screen.findByText('Un canal inactivo no puede ser el de defecto. Actívalo primero.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/CANAL_INACTIVO/)).not.toBeInTheDocument()
  })
})
describe('alta y edición', () => {
  it('un canal B2B nace exigiendo sesión sin que nadie la marque', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('Mayorista')

    await user.click(screen.getByRole('button', { name: 'Nuevo canal' }))
    await user.type(await screen.findByLabelText(/Código/), 'distribuidores')
    await user.type(screen.getByLabelText(/Nombre/), 'Distribuidores')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await vi.waitFor(() => expect(fake.state.tables.channels).toHaveLength(5))
    const nuevo = fake.state.tables.channels?.find((row) => row.code === 'distribuidores')
    expect(nuevo).toMatchObject({
      organization_id: ORG,
      company_id: COMPANY_A,
      store_id: STORE_A,
      kind: 'b2b',
      requires_auth: true,
      is_active: true,
    })
    // La marca de defecto no viaja en un alta: solo la mueve la RPC.
    expect(nuevo).not.toHaveProperty('is_default')
  })

  it('editar cambia el nombre', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('Mayorista')

    await user.click(within(filaCon('Mayorista')).getByRole('button', { name: 'Editar: Mayorista' }))
    const nombre = await screen.findByLabelText(/Nombre/)
    await user.clear(nombre)
    await user.type(nombre, 'Mayoristas Lima')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await vi.waitFor(() =>
      expect(fake.state.tables.channels?.find((row) => row.id === MAYORISTA)?.name).toBe('Mayoristas Lima'),
    )
  })

  it('un código con mayúsculas se corrige antes de llegar a la base', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('Mayorista')

    await user.click(screen.getByRole('button', { name: 'Nuevo canal' }))
    await user.type(await screen.findByLabelText(/Código/), 'Mal Código')
    await user.type(screen.getByLabelText(/Nombre/), 'X')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(
      await screen.findByText('Usa minúsculas, números, guion o guion bajo (hasta 41 caracteres).'),
    ).toBeInTheDocument()
    expect(fake.state.tables.channels).toHaveLength(4)
  })

  it('en el canal por defecto, activo está bloqueado y se explica', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('Mayorista')

    await user.click(
      within(filaCon('Tienda pública')).getByRole('button', { name: 'Editar: Tienda pública' }),
    )
    expect(await screen.findByRole('checkbox', { name: 'Activo' })).toBeDisabled()
    expect(
      screen.getByText(
        'Es el canal por defecto: no se puede desactivar ni pasar a un tipo con sesión. Elige otro por defecto primero.',
      ),
    ).toBeInTheDocument()
  })

  it('un rol sin permiso lee, pero no puede crear ni cambiar el defecto', async () => {
    pintar(backend({ role: 'viewer' }))
    await screen.findByText('Mayorista')

    expect(screen.getByRole('button', { name: 'Nuevo canal' })).toBeDisabled()
    expect(
      within(filaCon('Web secundaria')).getByRole('button', { name: 'Usar por defecto: Web secundaria' }),
    ).toBeDisabled()
  })
})

describe('traducción de los códigos de canal', () => {
  it('cada guarda de la base tiene su texto, y lo desconocido cae al genérico', () => {
    expect(mapChannelCode('CANAL_POR_DEFECTO_NO_DESACTIVABLE')).toBe('channels.error.defaultInactive')
    expect(mapChannelCode('CANAL_POR_DEFECTO_PUBLICO')).toBe('channels.error.defaultPublic')
    expect(mapChannelCode('CANAL_POR_DEFECTO_NO_BORRABLE')).toBe('channels.error.defaultDelete')
    expect(mapChannelCode('CANAL_DEFECTO_SOLO_POR_FUNCION')).toBe('channels.error.defaultOnlyAction')
    expect(mapChannelCode('CANAL_NO_ENCONTRADO')).toBe('channels.error.notFound')
    expect(mapChannelCode('23505')).toBe('channels.error.duplicate')
    expect(mapChannelCode('42501')).toBe('channels.error.forbidden')
    expect(mapChannelCode('ALGO_RARO')).toBe('channels.error.generic')
  })
})