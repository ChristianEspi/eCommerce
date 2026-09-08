import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const { SettingsPage } = await import('./SettingsPage')
const { validateAssetFile } = await import('./settings/types')

function backend(role: 'admin' | 'viewer' = 'admin', settings = defaultSettings()): FakeSupabase {
  return createFakeSupabase({
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
      store_settings: settings,
    },
  })
}

function defaultSettings() {
  return [
    {
      store_id: STORE_A,
      organization_id: ORG,
      company_id: COMPANY_A,
      accent_color: '#056769',
      logo_url: null,
      banner_url: null,
      white_label: false,
      default_locale: 'es',
      support_email: 'hola@mi-negocio.test',
      hero_title: null,
      hero_subtitle: 'Muebles que duran',
      contact_phone: '+51 999 111 222',
      contact_address: 'Av. Primavera 120',
    },
  ]
}

/**
 * El `CapabilitiesProvider` va aqui porque la pestana de Marca pregunta si la
 * sociedad tiene `content.white_label` (P02-SaaS). Por defecto el doble sirve
 * un contexto sin nada contratado, que es el caso normal: la marca blanca es
 * un addon premium (contrato §4.3), no algo que venga de serie.
 */
function renderPage() {
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <SettingsPage />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: makeSession() },
  )
}

function file(name: string, type: string, size = 1024): File {
  const blob = new File(['x'], name, { type })
  Object.defineProperty(blob, 'size', { value: size })
  return blob
}

beforeEach(() => {
  holder.client = backend()
  // `SectionTabs` guarda la pestaña abierta en el `#hash` (deep-link de suite).
  // En jsdom ese hash sobrevive de un test al siguiente, así que se limpia.
  window.history.replaceState(null, '', '/app/settings')
})

describe('SettingsPage — datos de la tienda', () => {
  it('carga el nombre comercial, la descripcion y el contacto que hay en la base', async () => {
    renderPage()

    expect(await screen.findByDisplayValue('Mi Negocio')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Muebles que duran')).toBeInTheDocument()
    expect(screen.getByDisplayValue('hola@mi-negocio.test')).toBeInTheDocument()
    expect(screen.getByDisplayValue('+51 999 111 222')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Av. Primavera 120')).toBeInTheDocument()
  })

  /**
   * El valor de estos campos lo escribe react-hook-form directamente en el DOM,
   * sin pasar por el `onChange` de React, asi que MUI no se enteraba de que el
   * campo estaba lleno y dejaba la etiqueta a media altura ENCIMA del valor
   * («Telefono» montado sobre el numero). La unica senal observable de que esta
   * arreglado es que la etiqueta lleve su clase de encogida.
   */
  it('la etiqueta no se monta sobre el valor que puso el formulario', async () => {
    renderPage()

    const phone = await screen.findByDisplayValue('+51 999 111 222')
    const label = phone.closest('.MuiFormControl-root')?.querySelector('label')
    expect(label?.textContent).toBe('Teléfono')
    expect(label?.className).toContain('MuiInputLabel-shrink')
  })

  it('guarda el nombre en `stores` y el resto en `store_settings`', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    const name = await screen.findByDisplayValue('Mi Negocio')
    await user.clear(name)
    await user.type(name, 'Casa Nórdica')

    const description = screen.getByDisplayValue('Muebles que duran')
    await user.clear(description)
    await user.type(description, 'Fabricación propia')

    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      expect(client.state.tables.stores?.[0]?.name).toBe('Casa Nórdica')
    })
    expect(client.state.tables.store_settings?.[0]?.hero_subtitle).toBe('Fabricación propia')
  })

  it('un campo vacio se guarda como NULL, no como cadena vacia', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    await user.clear(await screen.findByDisplayValue('+51 999 111 222'))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      expect(client.state.tables.store_settings?.[0]?.contact_phone).toBeNull()
    })
  })

  it('un correo con formato invalido se detiene en el cliente', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    const email = await screen.findByDisplayValue('hola@mi-negocio.test')
    await user.clear(email)
    await user.type(email, 'no-es-un-correo')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/no parece válido/i)).toBeInTheDocument()
    expect(client.state.tables.stores?.[0]?.name).toBe('Mi Negocio')
  })
})

describe('SettingsPage — marca', () => {
  it('el color primario se guarda en `accent_color`', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    await screen.findByDisplayValue('Mi Negocio')
    await user.click(screen.getByRole('tab', { name: 'Marca' }))

    const hex = await screen.findByLabelText('Color en hexadecimal')
    await user.clear(hex)
    await user.type(hex, '#AA3311')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      expect(client.state.tables.store_settings?.[0]?.accent_color).toBe('#aa3311')
    })
  })

  it('un color que no es #RRGGBB no llega a la base', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    await screen.findByDisplayValue('Mi Negocio')
    await user.click(screen.getByRole('tab', { name: 'Marca' }))

    const hex = await screen.findByLabelText('Color en hexadecimal')
    await user.clear(hex)
    await user.type(hex, 'rojo')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/#RRGGBB/)).toBeInTheDocument()
    expect(client.state.tables.store_settings?.[0]?.accent_color).toBe('#056769')
  })

  it('el logo sube a `store-assets` con la ruta del tenant y se guarda la RUTA', async () => {
    const user = userEvent.setup()
    const client = holder.client as FakeSupabase
    renderPage()

    await screen.findByDisplayValue('Mi Negocio')
    await user.click(screen.getByRole('tab', { name: 'Marca' }))
    await user.upload(await screen.findByLabelText('Logo'), file('logo.png', 'image/png'))

    await waitFor(() => {
      expect(Object.keys(client.state.storage['store-assets'] ?? {})).toHaveLength(1)
    })

    const [path] = Object.keys(client.state.storage['store-assets'] ?? {})
    expect(path).toMatch(new RegExp(`^${ORG}/${STORE_A}/branding/logo-[0-9a-f-]+\\.png$`))

    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => {
      expect(client.state.tables.store_settings?.[0]?.logo_url).toBe(path)
    })
  })

  /**
   * El SVG se prueba contra el validador y contra el `accept` del input, no
   * subiéndolo por el DOM: `user.upload` respeta `accept` y descarta el archivo
   * antes de que el componente lo vea, así que ese camino daría un verde vacío.
   */
  it('un SVG no se acepta: es un documento que puede llevar script', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByDisplayValue('Mi Negocio')
    await user.click(screen.getByRole('tab', { name: 'Marca' }))

    const input = await screen.findByLabelText('Banner de portada')
    expect(input.getAttribute('accept')).not.toContain('svg')
    expect(validateAssetFile({ type: 'image/svg+xml', size: 1024 })).toEqual({
      ok: false,
      key: 'settings.error.assetType',
    })
  })

  it('una imagen por encima de 2 MB tampoco entra', () => {
    expect(validateAssetFile({ type: 'image/png', size: 3 * 1024 * 1024 })).toEqual({
      ok: false,
      key: 'settings.error.assetSize',
    })
  })
})

describe('SettingsPage — permisos', () => {
  it('un rol sin `store.manage` no ve el formulario ni la barra de guardar', async () => {
    holder.client = backend('viewer')
    renderPage()

    expect(await screen.findByText(/Solo el propietario/i)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Mi Negocio')).not.toBeInTheDocument()
  })

  it('la apariencia sigue siendo de cada usuario, sin selector de paleta', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('tab', { name: 'Apariencia' }))
    expect(screen.getByRole('button', { name: 'Tema oscuro' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Color primario')).not.toBeInTheDocument()
  })
})
