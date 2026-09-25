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
 * La foto de una categoría, en el cajón del backoffice.
 *
 * ## Lo que se fija aquí
 *
 *  1. **La foto es OPCIONAL y su ausencia no molesta.** El cajón se puede
 *     guardar sin tocarla y lo que se ve mientras no hay foto es el icono de la
 *     categoría, no un rectángulo gris que sugiere que falta algo.
 *  2. **La ruta es de la TIENDA**, en su carpeta `categories/`: es lo que
 *     distingue una foto de categoría del logo de la tienda dentro del mismo
 *     bucket, y lo que el CHECK `categories_image_ref` exige.
 *  3. **El alt aparece con la foto y se va con ella.** Un `alt` sin imagen es un
 *     dato huérfano, y un campo siempre visible invita a rellenarlo antes de que
 *     haya nada que describir.
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
const { CategoryDrawer } = await import('./CategoryDrawer')
const { resetCategoryMediaProbe } = await import('./api/categories')
const { MAX_CATEGORY_IMAGE_BYTES, buildCategoryImagePath, validateCategoryImage } = await import(
  './api/categoryMedia'
)
const { categoryToForm } = await import('./types')

const CATEGORIA = '77777777-7777-4777-8777-777777777711'
const PREFIJO = `${ORG}/${STORE_A}/categories`
const RUTA = `${PREFIJO}/abrigos.webp`

function categoria(overrides: Record<string, unknown> = {}) {
  return {
    id: CATEGORIA,
    organization_id: ORG,
    company_id: COMPANY_A,
    store_id: STORE_A,
    parent_id: null,
    slug: 'abrigos',
    name: 'Abrigos',
    position: 1,
    is_active: true,
    image_url: null,
    image_alt: null,
    ...overrides,
  }
}

function backend(overrides: Record<string, unknown> = {}): FakeSupabase {
  return createFakeSupabase({
    session: makeSession(),
    rpc: {
      effective_capabilities: () => makePlatformContext({ entitlements: [], source: 'hub' }),
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
      categories: [categoria(overrides)],
    },
  })
}

function pintar(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  holder.client = fake
  const fila = categoria(overrides)
  return renderWithProviders(
    <TenantProvider>
      <CapabilitiesProvider>
        <CategoryDrawer
          open
          category={fila as never}
          categories={[fila as never]}
          organizationId={ORG}
          companyId={COMPANY_A}
          storeId={STORE_A}
          canWrite
          onClose={() => {}}
        />
      </CapabilitiesProvider>
    </TenantProvider>,
    { session: fake.state.session },
  )
}

function archivo(nombre = 'foto.png', type = 'image/png', size = 1024): File {
  const file = new File(['x'], nombre, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const subidos = (fake: FakeSupabase) => Object.keys(fake.state.storage['store-assets'] ?? {})

beforeEach(() => {
  holder.client = null
  resetCategoryMediaProbe()
})

// ---------------------------------------------------------------------------
// La ruta y el validador
// ---------------------------------------------------------------------------

describe('la ruta del objeto', () => {
  it('es de la TIENDA, en su carpeta de categorías', () => {
    const ruta = buildCategoryImagePath({
      organizationId: ORG,
      storeId: STORE_A,
      mimeType: 'image/webp',
    })

    expect(ruta.startsWith(`${PREFIJO}/`)).toBe(true)
    expect(ruta.endsWith('.webp')).toBe(true)
    // `categories/` y no `branding/`: es lo que permite mirar el bucket y saber
    // qué es cada cosa, y borrar las fotos de una temporada sin tocar el logo.
    expect(ruta.split('/')[2]).toBe('categories')
  })

  it('la extensión sale del MIME, no del nombre del archivo', () => {
    const ruta = buildCategoryImagePath({
      organizationId: ORG,
      storeId: STORE_A,
      mimeType: 'image/png',
    })
    expect(ruta.endsWith('.png')).toBe(true)
  })

  it('un MIME fuera de la lista no produce ruta', () => {
    expect(() =>
      buildCategoryImagePath({
        organizationId: ORG,
        storeId: STORE_A,
        mimeType: 'image/svg+xml',
      }),
    ).toThrow()
  })
})

describe('el validador del archivo', () => {
  it('rechaza el SVG y el HTML disfrazado', () => {
    for (const type of ['image/svg+xml', 'text/html', 'application/pdf']) {
      expect(validateCategoryImage({ type, size: 1024 }), type).toEqual({
        ok: false,
        key: 'catalog.categories.image.errorType',
      })
    }
  })

  it('acepta los cuatro formatos y rechaza el vacío y el de más de 2 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
      expect(validateCategoryImage({ type, size: 1024 }), type).toEqual({ ok: true })
    }
    expect(validateCategoryImage({ type: 'image/png', size: 0 })).toEqual({
      ok: false,
      key: 'catalog.categories.image.errorSize',
    })
    expect(validateCategoryImage({ type: 'image/png', size: MAX_CATEGORY_IMAGE_BYTES })).toEqual({
      ok: true,
    })
    expect(
      validateCategoryImage({ type: 'image/png', size: MAX_CATEGORY_IMAGE_BYTES + 1 }),
    ).toEqual({ ok: false, key: 'catalog.categories.image.errorSize' })
  })
})

describe('los valores de partida del formulario', () => {
  it('una categoría sin foto empieza sin ruta y con el alt vacío', () => {
    const valores = categoryToForm(categoria() as never)
    expect(valores.image_url).toBeNull()
    expect(valores.image_alt).toBe('')
  })

  it('una con foto trae las dos', () => {
    const valores = categoryToForm(
      categoria({ image_url: RUTA, image_alt: 'Un abrigo' }) as never,
    )
    expect(valores.image_url).toBe(RUTA)
    expect(valores.image_alt).toBe('Un abrigo')
  })
})

// ---------------------------------------------------------------------------
// El cajón
// ---------------------------------------------------------------------------

describe('el cajón de una categoría', () => {
  it('sin foto enseña el icono de la categoría, no un hueco gris', async () => {
    pintar(backend())

    const cajon = await screen.findByRole('dialog')
    expect(within(cajon).getByText('Fotografía')).toBeInTheDocument()
    expect(cajon.querySelector('img')).toBeNull()
    // Y no pide el alt: sin foto no hay nada que describir.
    expect(within(cajon).queryByLabelText('Texto alternativo')).not.toBeInTheDocument()
  })

  it('con foto la enseña recortada y pide el alt', async () => {
    pintar(backend({ image_url: RUTA }), { image_url: RUTA })

    const cajon = await screen.findByRole('dialog')
    const imagen = await waitFor(() => {
      const nodo = cajon.querySelector('img')
      expect(nodo).not.toBeNull()
      return nodo as HTMLImageElement
    })

    expect(imagen.getAttribute('src')).toBe(`https://firmado.test/${RUTA}`)
    // `cover`: el hueco tiene la proporción de la puerta real, así que se ve el
    // recorte antes de guardar en vez de descubrirlo en la tienda.
    expect(imagen).toHaveStyle({ objectFit: 'cover' })
    expect(within(cajon).getByLabelText('Texto alternativo')).toBeInTheDocument()
  })

  it('sube el archivo a la carpeta de la tienda y guarda la ruta', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)

    const cajon = await screen.findByRole('dialog')
    await user.upload(within(cajon).getByLabelText('Subir fotografía'), archivo())

    expect(subidos(fake)).toHaveLength(1)
    expect(subidos(fake)[0]?.startsWith(`${PREFIJO}/`)).toBe(true)

    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const fila = fake.state.tables.categories?.[0] as Record<string, unknown>
      expect(fila.image_url).toBe(subidos(fake)[0])
    })
  })

  it('el archivo sube al elegirlo y la fila solo al guardar', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)

    const cajon = await screen.findByRole('dialog')
    await user.upload(within(cajon).getByLabelText('Subir fotografía'), archivo())

    expect(subidos(fake)).toHaveLength(1)
    expect((fake.state.tables.categories?.[0] as Record<string, unknown>).image_url).toBeNull()
  })

  it('el alt vacío se guarda como NULL, no como cadena vacía', async () => {
    const user = userEvent.setup()
    const fake = backend({ image_url: RUTA })
    pintar(fake, { image_url: RUTA })

    const cajon = await screen.findByRole('dialog')
    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const fila = fake.state.tables.categories?.[0] as Record<string, unknown>
      // El CHECK exige 1..160 si la clave viene: «sin alt» y «alt en blanco»
      // son la misma cosa dicha de dos formas, y solo una se puede guardar.
      expect(fila.image_alt).toBeNull()
    })
  })

  it('el alt escrito se guarda recortado', async () => {
    const user = userEvent.setup()
    const fake = backend({ image_url: RUTA })
    pintar(fake, { image_url: RUTA })

    const cajon = await screen.findByRole('dialog')
    await user.type(within(cajon).getByLabelText('Texto alternativo'), '  Un abrigo de lana  ')
    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const fila = fake.state.tables.categories?.[0] as Record<string, unknown>
      expect(fila.image_alt).toBe('Un abrigo de lana')
    })
  })

  it('quitar la foto suelta también el alt: no se queda un dato huérfano', async () => {
    const user = userEvent.setup()
    const fake = backend({ image_url: RUTA, image_alt: 'Un abrigo' })
    pintar(fake, { image_url: RUTA, image_alt: 'Un abrigo' })

    const cajon = await screen.findByRole('dialog')
    await user.click(within(cajon).getByRole('button', { name: 'Quitar fotografía' }))

    expect(within(cajon).queryByLabelText('Texto alternativo')).not.toBeInTheDocument()

    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => {
      const fila = fake.state.tables.categories?.[0] as Record<string, unknown>
      expect(fila.image_url).toBeNull()
      expect(fila.image_alt).toBeNull()
    })
  })

  it('el alt no admite más de lo que la base acepta', async () => {
    const user = userEvent.setup()
    const fake = backend({ image_url: RUTA })
    pintar(fake, { image_url: RUTA })

    const cajon = await screen.findByRole('dialog')
    const campo = within(cajon).getByLabelText('Texto alternativo') as HTMLInputElement
    await user.type(campo, 'a'.repeat(200))

    expect(campo.value).toHaveLength(160)
  })

  it('avisa y no sube cuando la imagen pesa demasiado', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)

    const cajon = await screen.findByRole('dialog')
    await user.upload(
      within(cajon).getByLabelText('Subir fotografía'),
      archivo('grande.png', 'image/png', 3 * 1024 * 1024),
    )

    expect(subidos(fake)).toHaveLength(0)
    expect(await screen.findByText(/m[áa]s de 2 MB/i)).toBeInTheDocument()
  })

  it('guardar sin tocar la foto conserva el resto del formulario', async () => {
    const user = userEvent.setup()
    const fake = backend()
    pintar(fake)

    const cajon = await screen.findByRole('dialog')
    await user.clear(within(cajon).getByLabelText('Nombre'))
    await user.type(within(cajon).getByLabelText('Nombre'), 'Abrigos de invierno')
    await user.click(within(cajon).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const fila = fake.state.tables.categories?.[0] as Record<string, unknown>
      expect(fila.name).toBe('Abrigos de invierno')
      expect(fila.image_url).toBeNull()
    })
  })
})
