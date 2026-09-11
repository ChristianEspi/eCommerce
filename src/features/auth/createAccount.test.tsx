import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  FunctionsHttpErrorLike,
  ORG,
  USER,
  createFakeSupabase,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * Crear la cuenta de quien todavía no la tiene, desde la pantalla que la echa
 * en falta.
 *
 * ## El callejón que se cierra
 *
 * Dar acceso a alguien exigía que ya tuviera cuenta, y no había ningún sitio
 * donde pasara a tenerla: esta aplicación no tiene pantalla de registro, y el
 * alta directa de Supabase deja la cuenta sin sesión esperando un correo de
 * confirmación que todavía no se envía. La pantalla decía «esa persona no tiene
 * cuenta» y ahí se acababa el camino. Ahora el mismo aviso trae el botón.
 *
 * ## Lo que se fija aquí
 *
 * Tres cosas, y ninguna es «el botón existe»:
 *
 *  1. El ofrecimiento aparece **solo** cuando el servidor ha dicho que falta la
 *     cuenta. Ofrecerlo siempre invitaría a crear cuentas por si acaso.
 *  2. Crear la cuenta arrastra el paso que se estaba pidiendo: quien pulsa no
 *     quería una cuenta suelta, quería dar acceso.
 *  3. La contraseña se enseña **una vez** y el diálogo no se cierra solo: no se
 *     guarda en ninguna parte, así que un clic fuera la perdería para siempre.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { MembersSection } = await import('@/features/admin/settings/MembersSection')

const PASSWORD = 'Kp7dRmXq2vTbNh4y'
const NUEVO = '77777777-7777-4777-8777-777777777777'

/**
 * Un backend donde `add_tenant_member` falla mientras el correo no tenga cuenta,
 * y empieza a funcionar en cuanto la tiene. Es la secuencia real: el mismo
 * intento que fallaba es el que después tiene que salir bien.
 */
function backend(options: { alCrear?: () => never } = {}): FakeSupabase {
  const conCuenta = new Set<string>()

  return createFakeSupabase({
    session: makeSession(),
    tables: {
      tenant_members: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          organization_id: ORG,
          company_id: COMPANY_A,
          user_id: USER,
          email: 'yo@negocio.com',
          role: 'admin',
          status: 'active',
          created_at: '2026-08-02T00:00:00.000Z',
        },
      ],
    },
    rpc: {
      add_tenant_member: (args) => {
        const email = String(args.p_email)
        if (!conCuenta.has(email)) {
          throw { message: `SIN_CUENTA: no hay ninguna cuenta con ese correo` }
        }
        return '88888888-8888-4888-8888-888888888888'
      },
    },
    functions: {
      'create-user': (body) => {
        if (options.alCrear) options.alCrear()
        const email = String(body.email)
        conCuenta.add(email)
        return { email, user_id: NUEVO, temporary_password: PASSWORD }
      },
    },
  })
}

function pintar(fake: FakeSupabase) {
  holder.client = fake
  return renderWithProviders(
    <MembersSection
      organizationId={ORG}
      companyId={COMPANY_A}
      canManage
      currentUserId={USER}
    />,
    { session: fake.state.session },
  )
}

async function intentarDarAcceso(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.click(screen.getByRole('button', { name: 'Dar acceso' }))
  await user.type(screen.getByLabelText('Correo'), email)
  await user.click(screen.getByRole('button', { name: 'Añadir' }))
}

beforeEach(() => {
  holder.client = null
})

describe('cuando ese correo todavía no tiene cuenta', () => {
  it('el aviso trae el botón que la crea, en vez de ser una pared', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('yo@negocio.com')

    await intentarDarAcceso(user, 'nueva@negocio.com')

    expect(await screen.findByText(/todavía no tiene una cuenta/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear la cuenta' })).toBeInTheDocument()
  })

  /**
   * Ofrecerlo siempre invitaría a crear cuentas por si acaso, que es lo
   * contrario de lo que hace falta: la cuenta se crea cuando consta que no
   * existe, y quien lo dice es el servidor.
   */
  it('y no se ofrece sin que el servidor lo haya dicho', async () => {
    const user = userEvent.setup()
    pintar(backend())
    await screen.findByText('yo@negocio.com')

    await user.click(screen.getByRole('button', { name: 'Dar acceso' }))
    expect(screen.queryByRole('button', { name: 'Crear la cuenta' })).not.toBeInTheDocument()

    // Un correo mal escrito tampoco lo ofrece: no ha llegado a preguntarse.
    await user.type(screen.getByLabelText('Correo'), 'sin-arroba')
    await user.click(screen.getByRole('button', { name: 'Añadir' }))
    expect(await screen.findByText('Escribe un correo válido.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear la cuenta' })).not.toBeInTheDocument()
  })

  /**
   * Quien pulsa «crear la cuenta» no quería una cuenta suelta: quería dar
   * acceso y se topó con que la persona no existía. Dejarlo a medias obligaría
   * a repetir el formulario entero con el rol otra vez.
   */
  it('crearla concede además el acceso que se estaba pidiendo', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('yo@negocio.com')
    await intentarDarAcceso(user, 'nueva@negocio.com')
    await screen.findByRole('button', { name: 'Crear la cuenta' })

    await user.click(screen.getByRole('button', { name: 'Crear la cuenta' }))

    await waitFor(() => {
      expect(fake.state.rpcCalls.filter((c) => c.name === 'add_tenant_member')).toHaveLength(2)
    })
    const ultima = fake.state.rpcCalls.at(-1)
    expect(ultima?.args).toEqual({ p_email: 'nueva@negocio.com', p_role: 'viewer' })
  })

  /**
   * Ni la organización ni la sociedad viajan en la llamada: las toma el
   * servidor del token. Es la regla del proyecto, y la función de borde rechaza
   * el cuerpo entero si aparece una.
   */
  it('la llamada lleva el correo y nada más', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('yo@negocio.com')
    await intentarDarAcceso(user, '  Nueva@Negocio.com  ')
    await screen.findByRole('button', { name: 'Crear la cuenta' })

    await user.click(screen.getByRole('button', { name: 'Crear la cuenta' }))

    await waitFor(() => expect(fake.state.invocations).toHaveLength(1))
    expect(fake.state.invocations[0]).toEqual({
      name: 'create-user',
      body: { email: 'nueva@negocio.com' },
    })
  })
})

describe('la contraseña temporal', () => {
  async function crearla(user: ReturnType<typeof userEvent.setup>, fake: FakeSupabase) {
    pintar(fake)
    await screen.findByText('yo@negocio.com')
    await intentarDarAcceso(user, 'nueva@negocio.com')
    await screen.findByRole('button', { name: 'Crear la cuenta' })
    await user.click(screen.getByRole('button', { name: 'Crear la cuenta' }))
    return screen.findByText(PASSWORD)
  }

  it('se enseña, con el aviso de que no va a volver a verse', async () => {
    const user = userEvent.setup()
    await crearla(user, backend())

    expect(screen.getByText(PASSWORD)).toBeInTheDocument()
    expect(screen.getByText(/no vas a poder volver a verla/i)).toBeInTheDocument()
  })

  /**
   * No se guarda en ninguna parte, así que un clic distraído fuera del diálogo
   * la perdería para siempre. Se sale por el botón, que dice lo que confirma.
   */
  it('el diálogo no se cierra pulsando fuera', async () => {
    const user = userEvent.setup()
    await crearla(user, backend())

    await user.keyboard('{Escape}')
    expect(screen.getByText(PASSWORD)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Listo, ya la guardé' }))
    await waitFor(() => expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument())
  })

  it('se puede copiar de un clic', async () => {
    const user = userEvent.setup()
    const escribir = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: escribir },
      configurable: true,
    })

    await crearla(user, backend())
    await user.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(escribir).toHaveBeenCalledWith(PASSWORD)
  })
})

describe('cuando el alta no sale', () => {
  /**
   * Que ya exista no es un fallo del que lo intenta: significa que esa persona
   * ya puede entrar y que dar acceso sí va a funcionar. Por eso deja de
   * ofrecerse crearla — insistir mandaría a repetir algo que ya está hecho.
   */
  it('«ya existe» se cuenta como lo que es y retira el ofrecimiento', async () => {
    const user = userEvent.setup()
    const fake = backend({
      alCrear: () => {
        throw new FunctionsHttpErrorLike(409, 'CUENTA_YA_EXISTE')
      },
    })
    pintar(fake)
    await screen.findByText('yo@negocio.com')
    await intentarDarAcceso(user, 'nueva@negocio.com')
    await screen.findByRole('button', { name: 'Crear la cuenta' })

    await user.click(screen.getByRole('button', { name: 'Crear la cuenta' }))

    expect(await screen.findByText(/ya tiene una cuenta/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear la cuenta' })).not.toBeInTheDocument()
  })

  it('sin permiso se dice quién puede, no «algo salió mal»', async () => {
    const user = userEvent.setup()
    const fake = backend({
      alCrear: () => {
        throw new FunctionsHttpErrorLike(403, 'SIN_PERMISO')
      },
    })
    pintar(fake)
    await screen.findByText('yo@negocio.com')
    await intentarDarAcceso(user, 'nueva@negocio.com')
    await screen.findByRole('button', { name: 'Crear la cuenta' })

    await user.click(screen.getByRole('button', { name: 'Crear la cuenta' }))

    expect(
      await screen.findByText(/propietario o un administrador pueden crear cuentas/i),
    ).toBeInTheDocument()
  })

  it('y si falla no se enseña ninguna contraseña', async () => {
    const user = userEvent.setup()
    const fake = backend({
      alCrear: () => {
        throw new FunctionsHttpErrorLike(502, 'ALTA_FALLIDA')
      },
    })
    pintar(fake)
    await screen.findByText('yo@negocio.com')
    await intentarDarAcceso(user, 'nueva@negocio.com')
    await screen.findByRole('button', { name: 'Crear la cuenta' })

    await user.click(screen.getByRole('button', { name: 'Crear la cuenta' }))

    expect(await screen.findByText(/No se pudo crear la cuenta/i)).toBeInTheDocument()
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument()
  })
})
