import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  COMPANY_A,
  ORG,
  STORE_A,
  USER,
  createFakeSupabase,
  makePlatformContext,
  makeSession,
  type FakeSupabase,
} from '@/test/supabaseMock'

/**
 * El logo de una marca en el PIM.
 *
 * ## Lo que este archivo defiende
 *
 * `brands.logo_url` existía en la base desde el primer día del PIM y no servía
 * para nada: el `select` no la pedía, el formulario no la enseñaba y el `insert`
 * no la escribía. Aquí se fija la cadena completa —elegir archivo, subirlo a la
 * ruta de la SOCIEDAD, guardar la ruta— y las dos cosas que no pueden pasar:
 *
 *  1. **que la familia herede el campo.** Una familia de producto clasifica y no
 *     se enseña al comprador: no tiene columna donde guardar un logo, así que
 *     ofrecerlo produce un `insert` contra una columna que no existe;
 *  2. **que el logo se suba a la carpeta de una tienda.** Una marca es de la
 *     sociedad; colgarla de una tienda la duplica o la deja huérfana cuando esa
 *     tienda cierre.
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
const { CatalogEntrySection } = await import('./CatalogEntrySection')
const { MAX_BRAND_LOGO_BYTES, buildBrandLogoPath, validateBrandLogo } = await import(
  '../api/brandLogos'
)

const BRAND_ID = '99999999-9999-4999-8999-99999999aa11'
const FAMILY_ID = '99999999-9999-4999-8999-99999999aa22'
const PREFIJO = `${ORG}/company/${COMPANY_A}/brands`
const RUTA = `${PREFIJO}/logo-existente.webp`

function backend(brandOverrides: Record<string, unknown> = {}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: {
      // Sin esto el contexto de tenant no resuelve y `can('catalog.write')` es
      // falso: la pantalla se pinta en modo lectura y no habría nada que subir.
      effective_capabilities: () =>
        makePlatformContext({ entitlements: ['ecommerce.catalog.advanced'], source: 'hub' }),
    },
    tables: {
      tenants: [{ organization_id: ORG, slug: 'mi-negocio', name: 'Mi Negocio', status: 'active' }],
      tenant_members: [
        {
          organization_id: ORG,
          company_id: COMPANY_A,
          user_id: USER,
          role: 'admin',
          status: 'active',
        },
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
      brands: [
        {
          id: BRAND_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'aurora',
          name: 'Aurora Boreal',
          description: null,
          is_active: true,
          logo_url: null,
          ...brandOverrides,
        },
      ],
      product_families: [
        {
          id: FAMILY_ID,
          organization_id: ORG,
          company_id: COMPANY_A,
          code: 'calzado',
          name: 'Calzado',
          description: null,
          is_active: true,
        },
      ],
    },
  })
}

function pintar(fake: FakeSupabase, kind: 'brands' | 'families' = 'brands') {
  holder.client = fake
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CatalogEntrySection kind={kind} />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

/** Un archivo de mentira con el tipo y el tamaño que importan. */
function archivo(nombre = 'logo.png', type = 'image/png', size = 1024): File {
  const file = new File(['x'], nombre, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

/** Lo que hay en el bucket de branding ahora mismo. */
const subidos = (fake: FakeSupabase) => Object.keys(fake.state.storage['store-assets'] ?? {})

async function abrirCajonDe(nombre: string, user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: new RegExp(`Editar: ${nombre}`) }))
  return screen.findByRole('dialog')
}

beforeEach(() => {
  holder.client = null
})

// ---------------------------------------------------------------------------
// La tabla
// ---------------------------------------------------------------------------

describe('la tabla de marcas', () => {
  it('enseña el monograma cuando la marca no tiene logo', async () => {
    pintar(backend())

    // Dos letras y no un rectángulo gris: el backoffice enseña EXACTAMENTE lo
    // que verá el comprador, que también cae al monograma.
    expect(await screen.findByText('Aurora Boreal')).toBeInTheDocument()
    expect(screen.getByText('AB')).toBeInTheDocument()
  })

  it('enseña la imagen cuando sí lo tiene, firmada y sin recortar', async () => {
    pintar(backend({ logo_url: RUTA }))
    await screen.findByText('Aurora Boreal')

    const imagen = await waitFor(() => {
      const nodo = document.querySelector('img')
      expect(nodo).not.toBeNull()
      return nodo as HTMLImageElement
    })

    expect(imagen.getAttribute('src')).toBe(`https://firmado.test/${RUTA}`)
    // `contain`: un logo apaisado recortado a cuadrado es un trozo de letra.
    expect(imagen).toHaveStyle({ objectFit: 'contain' })
    // Perezosa: la tabla de marcas no compite con nada por el ancho de banda.
    expect(imagen.getAttribute('loading')).toBe('lazy')
  })

  it('firma TODOS los logos de la página en una sola petición', async () => {
    const fake = backend({ logo_url: RUTA })
    // Dos marcas más con logo: si se firmara una por fila, habría tres
    // llamadas. Cuarenta marcas serían cuarenta viajes.
    fake.state.tables.brands?.push(
      {
        id: '99999999-9999-4999-8999-99999999aa33',
        organization_id: ORG,
        company_id: COMPANY_A,
        code: 'sur',
        name: 'Marca Sur',
        description: null,
        is_active: true,
        logo_url: `${PREFIJO}/sur.webp`,
      },
      {
        id: '99999999-9999-4999-8999-99999999aa44',
        organization_id: ORG,
        company_id: COMPANY_A,
        code: 'norte',
        name: 'Marca Norte',
        description: null,
        is_active: true,
        logo_url: `${PREFIJO}/norte.webp`,
      },
    )

    pintar(fake)
    await screen.findByText('Marca Norte')
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(3))
  })

  it('la familia NO tiene columna de logo: no hay dónde pintarlo', async () => {
    pintar(backend(), 'families')

    await screen.findByText('Calzado')
    expect(screen.queryByText('Logo')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// La ruta y el validador, como funciones
// ---------------------------------------------------------------------------

describe('la ruta del objeto', () => {
  it('es de la SOCIEDAD y su extensión sale del MIME, no del nombre', () => {
    const ruta = buildBrandLogoPath({
      organizationId: ORG,
      companyId: COMPANY_A,
      // Un `.jpg` que en realidad es un PNG no se convierte en JPG por llamarse
      // así: la extensión la decide el tipo declarado.
      mimeType: 'image/png',
    })

    expect(ruta.startsWith(`${PREFIJO}/`)).toBe(true)
    expect(ruta.endsWith('.png')).toBe(true)
    // El segundo segmento es el literal `company`, y es lo que separa esta
    // familia de rutas de la de tienda dentro del mismo bucket.
    expect(ruta.split('/')[1]).toBe('company')
    // Y no lleva ninguna tienda: una marca no es de una tienda.
    expect(ruta).not.toContain(STORE_A)
  })

  it('dos subidas nunca escriben el mismo objeto', () => {
    const uno = buildBrandLogoPath({
      organizationId: ORG,
      companyId: COMPANY_A,
      mimeType: 'image/png',
    })
    const otro = buildBrandLogoPath({
      organizationId: ORG,
      companyId: COMPANY_A,
      mimeType: 'image/png',
    })
    // El nombre es un uuid nuevo: el del usuario podría traer acentos, espacios
    // o el nombre de un archivo que ya existe.
    expect(uno).not.toBe(otro)
  })

  it('un MIME que no está en la lista no produce ruta', () => {
    expect(() =>
      buildBrandLogoPath({ organizationId: ORG, companyId: COMPANY_A, mimeType: 'image/svg+xml' }),
    ).toThrow()
  })
})

describe('el validador del archivo', () => {
  it('rechaza el SVG: es un documento que puede llevar script', () => {
    // Lo sube el tenant y lo sirve el dominio de la vitrina, y este repositorio
    // no tiene sanitizador de SVG aprobado.
    expect(validateBrandLogo({ type: 'image/svg+xml', size: 1024 })).toEqual({
      ok: false,
      key: 'pim.brands.logo.errorType',
    })
    expect(validateBrandLogo({ type: 'text/html', size: 1024 })).toEqual({
      ok: false,
      key: 'pim.brands.logo.errorType',
    })
  })

  it('acepta los cuatro formatos de imagen del bucket', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
      expect(validateBrandLogo({ type, size: 1024 }), type).toEqual({ ok: true })
    }
  })

  it('rechaza el archivo vacío y el que pasa de 2 MB', () => {
    // Cero bytes es un archivo que no llegó.
    expect(validateBrandLogo({ type: 'image/png', size: 0 })).toEqual({
      ok: false,
      key: 'pim.brands.logo.errorSize',
    })
    expect(validateBrandLogo({ type: 'image/png', size: MAX_BRAND_LOGO_BYTES })).toEqual({
      ok: true,
    })
    expect(validateBrandLogo({ type: 'image/png', size: MAX_BRAND_LOGO_BYTES + 1 })).toEqual({
      ok: false,
      key: 'pim.brands.logo.errorSize',
    })
  })
})

// ---------------------------------------------------------------------------
// El cajón
// ---------------------------------------------------------------------------

describe('el cajón de una marca', () => {
  it('guarda la ruta del logo que se acaba de subir', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)

    const cajon = await abrirCajonDe('Aurora Boreal', user)
    await user.upload(within(cajon).getByLabelText('Subir logo'), archivo())

    // La ruta es de la SOCIEDAD, no de una tienda. Si aquí apareciera un
    // `store_id`, el logo colgaría de una tienda que mañana puede cerrarse
    // llevándose el logo de las demás.
    expect(subidos(fake)).toHaveLength(1)
    expect(subidos(fake)[0]?.startsWith(`${PREFIJO}/`)).toBe(true)
    expect(subidos(fake)[0]).not.toContain(STORE_A)

    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const fila = fake.state.tables.brands?.[0] as Record<string, unknown>
      expect(fila.logo_url).toBe(subidos(fake)[0])
    })
  })

  it('el archivo se sube al elegirlo y la fila solo al guardar', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)

    const cajon = await abrirCajonDe('Aurora Boreal', user)
    await user.upload(within(cajon).getByLabelText('Subir logo'), archivo())

    // Se sube ANTES de guardar a propósito: si alguien sube y cancela, queda un
    // objeto huérfano —que no rompe ninguna pantalla—. Al revés, la fila
    // apuntaría a un objeto que no existe, y eso sí se ve.
    expect(subidos(fake)).toHaveLength(1)
    expect((fake.state.tables.brands?.[0] as Record<string, unknown>).logo_url).toBeNull()
  })

  it('el selector del sistema no ofrece SVG', async () => {
    const user = userEvent.setup()
    pintar(backend())

    const cajon = await abrirCajonDe('Aurora Boreal', user)
    const accept = within(cajon).getByLabelText('Subir logo').getAttribute('accept') ?? ''

    // Es la primera de dos barreras; la otra es el validador, que cubre lo que
    // llegue por arrastrar y soltar o por un navegador que ignore `accept`.
    expect(accept.split(',')).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    expect(accept).not.toContain('svg')
  })

  it('avisa y no sube cuando el archivo pesa demasiado', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)

    const cajon = await abrirCajonDe('Aurora Boreal', user)
    await user.upload(
      within(cajon).getByLabelText('Subir logo'),
      archivo('grande.png', 'image/png', 3 * 1024 * 1024),
    )

    expect(subidos(fake)).toHaveLength(0)
    expect(await screen.findByText(/m[áa]s de 2 MB/i)).toBeInTheDocument()
  })

  it('quitar el logo suelta la referencia', async () => {
    const user = userEvent.setup()
    const fake = backend({ logo_url: RUTA })
    pintar(fake)

    const cajon = await abrirCajonDe('Aurora Boreal', user)
    await user.click(within(cajon).getByRole('button', { name: 'Quitar logo' }))
    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const fila = fake.state.tables.brands?.[0] as Record<string, unknown>
      expect(fila.logo_url).toBeNull()
    })
    // El objeto NO se borra del bucket: si se cancelara la edición, la marca
    // seguiría apuntando a él. Un huérfano no rompe ninguna pantalla.
    expect(subidos(fake)).toHaveLength(0)
  })

  it('crear una marca sin logo escribe null, no una cadena vacía', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)
    await screen.findByText('Aurora Boreal')

    await user.click(screen.getByRole('button', { name: 'Nueva marca' }))
    const cajon = await screen.findByRole('dialog')
    await user.type(within(cajon).getByLabelText('Nombre'), 'Boreal Sur')
    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.tables.brands).toHaveLength(2))
    const creada = fake.state.tables.brands?.[1] as Record<string, unknown>
    expect(creada.logo_url).toBeNull()
    // El tenant sigue saliendo del JWT, nunca de un campo.
    expect(creada.organization_id).toBe(ORG)
    expect(creada.company_id).toBe(COMPANY_A)
  })
})

describe('el cajón de una familia', () => {
  it('no ofrece subir logo', async () => {
    const user = userEvent.setup()
    pintar(backend(), 'families')

    const cajon = await abrirCajonDe('Calzado', user)
    expect(within(cajon).queryByRole('button', { name: /logo/i })).not.toBeInTheDocument()
    expect(within(cajon).queryByLabelText('Subir logo')).not.toBeInTheDocument()
  })

  it('y al crearla NO envía logo_url: la columna no existe en su tabla', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake, 'families')
    await screen.findByText('Calzado')

    await user.click(screen.getByRole('button', { name: 'Nueva familia' }))
    const cajon = await screen.findByRole('dialog')
    await user.type(within(cajon).getByLabelText('Nombre'), 'Bebidas')
    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(fake.state.tables.product_families).toHaveLength(2))
    const creada = fake.state.tables.product_families?.[1] as Record<string, unknown>
    expect(creada.name).toBe('Bebidas')
    expect(creada).not.toHaveProperty('logo_url')
  })
})
