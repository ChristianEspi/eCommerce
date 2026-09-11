import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  USER,
  createFakeSupabase,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * Quién entra al backoffice.
 *
 * Lo que se fija aquí son los tres candados que la base ya exigía y que hasta
 * ahora no tenían pantalla que los respetara: `owner` no se toca desde la app,
 * nadie se quita el acceso a sí mismo, y quitar el acceso REVOCA en vez de
 * borrar — quién tuvo acceso y hasta cuándo es justo lo que hace falta el día
 * que se audita algo.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { MembersSection } = await import('./MembersSection')

const OTRO = '55555555-5555-4555-8555-555555555555'
const DUENIO = '66666666-6666-4666-8666-666666666666'
const M_OWNER = '11111111-1111-4111-8111-111111111111'
const M_YO = '22222222-2222-4222-8222-222222222222'
const M_OTRO = '33333333-3333-4333-8333-333333333333'

function backend(): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenant_members: [
        {
          id: M_OWNER,
          organization_id: ORG,
          company_id: COMPANY_A,
          user_id: DUENIO,
          email: 'duenio@negocio.com',
          role: 'owner',
          status: 'active',
          created_at: '2026-08-01T00:00:00.000Z',
        },
        {
          id: M_YO,
          organization_id: ORG,
          company_id: COMPANY_A,
          user_id: USER,
          email: 'yo@negocio.com',
          role: 'admin',
          status: 'active',
          created_at: '2026-08-02T00:00:00.000Z',
        },
        {
          id: M_OTRO,
          organization_id: ORG,
          company_id: COMPANY_A,
          user_id: OTRO,
          email: 'otro@negocio.com',
          role: 'viewer',
          status: 'active',
          created_at: '2026-08-03T00:00:00.000Z',
        },
      ],
    },
  })
}

function pintar(fake: FakeSupabase, canManage = true) {
  holder.client = fake
  return renderWithProviders(
    <MembersSection
      organizationId={ORG}
      companyId={COMPANY_A}
      canManage={canManage}
      currentUserId={USER}
    />,
    { session: fake.state.session },
  )
}

beforeEach(() => {
  holder.client = null
})

describe('quien entra al backoffice', () => {
  it('lista a todos con su rol y su estado', async () => {
    pintar(backend())

    expect(await screen.findByText('duenio@negocio.com')).toBeInTheDocument()
    expect(screen.getByText('yo@negocio.com')).toBeInTheDocument()
    expect(screen.getByText('otro@negocio.com')).toBeInTheDocument()
    expect(screen.getAllByText('Activo')).toHaveLength(3)
  })

  /**
   * `owner` nace con el tenant y cambiarlo es una operación de servidor
   * (contrato §3.2). La base lo rechaza igual; aquí ni se ofrece, porque un
   * control que va a fallar es un control que miente.
   */
  it('al propietario no se le cambia el rol ni se le quita el acceso', async () => {
    pintar(backend())
    const fila = (await screen.findByText('duenio@negocio.com')).closest('tr') as HTMLElement

    expect(fila.querySelector('[role="combobox"]')).toBeNull()
    expect(fila.textContent).toContain('Propietario')
    expect(fila.querySelector('button')).toBeNull()
  })

  it('uno no puede quitarse el acceso a si mismo', async () => {
    pintar(backend())
    const fila = (await screen.findByText('yo@negocio.com')).closest('tr') as HTMLElement

    expect(fila.querySelector('button')).toBeNull()
  })

  it('quitar el acceso REVOCA, no borra: la fila se queda para poder auditarla', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('otro@negocio.com')

    await user.click(screen.getByRole('button', { name: 'Quitar acceso' }))

    const filas = fake.state.tables.tenant_members as Array<Record<string, unknown>>
    await waitFor(() => {
      expect(filas.find((f) => f.id === M_OTRO)?.status).toBe('revoked')
    })
    // Sigue habiendo tres: quién tuvo acceso y hasta cuándo no se borra.
    expect(filas).toHaveLength(3)
  })

  it('sin permiso de administrar, la pantalla solo se lee', async () => {
    pintar(backend(), false)
    await screen.findByText('otro@negocio.com')

    expect(screen.queryByRole('button', { name: 'Dar acceso' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quitar acceso' })).not.toBeInTheDocument()
  })

  /**
   * El alta pide el identificador, y lo dice.
   *
   * Es lo primero que se intenta: escribir un correo nuevo y esperar que llegue
   * una invitación. Esta pantalla administra la MEMBRESÍA, no la identidad, y
   * callarlo dejaría a alguien rellenando un formulario que no hace lo que cree.
   */
  it('el alta avisa de que no crea cuentas y solo pide el correo', async () => {
    /**
     * Antes esta prueba escribía un identificador de usuario y comprobaba que se
     * validara su forma. Ese campo ya no existe: era un uuid que no se enseña en
     * ninguna pantalla, así que la única manera de rellenarlo era entrar al
     * panel de la base de datos. Lo que se comprueba ahora es que el correo
     * basta, y que un correo mal escrito no llega al servidor.
     */
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('otro@negocio.com')

    await user.click(screen.getByRole('button', { name: 'Dar acceso' }))
    expect(await screen.findByText(/no crea cuentas/i)).toBeInTheDocument()

    // Ya no hay dónde pegar un identificador.
    expect(screen.queryByLabelText('Identificador de usuario')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Correo'), 'sin-arroba')
    await user.click(screen.getByRole('button', { name: 'Añadir' }))

    expect(await screen.findByText('Escribe un correo válido.')).toBeInTheDocument()
    // Y no se ha escrito nada.
    expect(fake.state.tables.tenant_members).toHaveLength(3)
  })
})
