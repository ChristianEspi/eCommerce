import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { COMPANY_A, ORG, STORE_A, createFakeSupabase, type FakeSupabase } from '@/test/supabaseMock'

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,

  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { ProductImagesPanel } = await import('./ProductImagesPanel')
const { PRODUCT_IMAGES_BUCKET } = await import('./api/images')

const PRODUCT = '88888888-8888-4888-8888-888888888888'
const IMAGE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const IMAGE_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

const path = (name: string) => `${ORG}/${STORE_A}/${PRODUCT}/${name}`

function backend(images = seededImages()): FakeSupabase {
  const fake = createFakeSupabase({
    tables: { product_images: images },
    storage: {
      [PRODUCT_IMAGES_BUCKET]: Object.fromEntries(
        images.map((image) => [
          image.storage_path,
          { size: 1024, contentType: 'image/jpeg' } as const,
        ]),
      ),
    },
  })

  fake.state.rpc.set_primary_product_image = (args) => {
    for (const row of fake.state.tables.product_images ?? []) {
      row.is_primary = row.id === args.p_image_id
    }
    return null
  }
  fake.state.rpc.reorder_product_images = (args) => {
    const ids = args.p_image_ids as string[]
    for (const row of fake.state.tables.product_images ?? []) {
      row.position = ids.indexOf(String(row.id))
    }
    return null
  }

  return fake
}

function seededImages() {
  return [
    {
      id: IMAGE_1,
      product_id: PRODUCT,
      store_id: STORE_A,
      storage_path: path('uno.jpg'),
      alt: null,
      position: 0,
      is_primary: true,
    },
    {
      id: IMAGE_2,
      product_id: PRODUCT,
      store_id: STORE_A,
      storage_path: path('dos.jpg'),
      alt: null,
      position: 1,
      is_primary: false,
    },
  ]
}

function renderPanel(fake: FakeSupabase, productId: string | null = PRODUCT) {
  holder.client = fake
  return renderWithProviders(
    <ProductImagesPanel
      organizationId={ORG}
      companyId={COMPANY_A}
      storeId={STORE_A}
      productId={productId}
      canWrite
    />,
  )
}

const png = (name: string, size = 2048) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' })

beforeEach(() => {
  holder.client = null
})

describe('ProductImagesPanel', () => {
  it('sin producto guardado no ofrece subir: no hay ruta donde guardar', () => {
    renderPanel(backend(), null)
    expect(screen.getByText(/Guarda el producto y podrás subir sus imágenes/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Añadir imágenes' })).not.toBeInTheDocument()
  })

  it('muestra las imagenes existentes y marca la principal', async () => {
    renderPanel(backend())
    expect(await screen.findByText('Principal')).toBeInTheDocument()
    expect(screen.getByText('uno.jpg')).toBeInTheDocument()
    expect(screen.getByText('dos.jpg')).toBeInTheDocument()
  })

  it('sin imagenes muestra el estado vacio', async () => {
    renderPanel(backend([]))
    expect(await screen.findByText('Este producto todavía no tiene imágenes')).toBeInTheDocument()
  })

  it('sube el objeto bajo {organization_id}/{store_id}/{product_id}/ y registra la fila', async () => {
    const user = userEvent.setup()
    const fake = backend([])
    renderPanel(fake)
    await screen.findByText('Este producto todavía no tiene imágenes')

    await user.upload(screen.getByLabelText('Añadir imágenes'), png('foto.png'))

    await waitFor(() => expect(fake.state.tables.product_images).toHaveLength(1))
    const row = fake.state.tables.product_images?.[0]
    const storagePath = String(row?.storage_path)

    expect(storagePath.startsWith(`${ORG}/${STORE_A}/${PRODUCT}/`)).toBe(true)
    expect(storagePath.endsWith('.png')).toBe(true)
    // El objeto y la fila apuntan exactamente a la misma ruta.
    expect(Object.keys(fake.state.storage[PRODUCT_IMAGES_BUCKET] ?? {})).toEqual([storagePath])
    // El tenant de la fila es el del contexto, y la RLS lo vuelve a comprobar.
    expect(row).toMatchObject({
      organization_id: ORG,
      company_id: COMPANY_A,
      store_id: STORE_A,
      product_id: PRODUCT,
      is_primary: false,
    })
  })

  it('admite varias imagenes de una vez y las coloca en orden', async () => {
    const user = userEvent.setup()
    const fake = backend([])
    renderPanel(fake)
    await screen.findByText('Este producto todavía no tiene imágenes')

    await user.upload(screen.getByLabelText('Añadir imágenes'), [png('a.png'), png('b.png')])

    await waitFor(() => expect(fake.state.tables.product_images).toHaveLength(2))
    expect(fake.state.tables.product_images?.map((row) => row.position)).toEqual([0, 1])
  })

  it('el selector solo declara los formatos admitidos (primer filtro, el del navegador)', () => {
    renderPanel(backend([]))
    expect(screen.getByLabelText('Añadir imágenes')).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp,image/avif',
    )
  })

  it('y si el archivo se cuela igual, se rechaza antes de tocar Storage', async () => {
    // `applyAccept: false` salta el filtro del navegador a propósito: lo que se
    // prueba aquí es la validación propia, la que queda cuando el `accept` no
    // se respeta (arrastrar y soltar, un navegador viejo, un script).
    const user = userEvent.setup({ applyAccept: false })
    const fake = backend([])
    renderPanel(fake)
    await screen.findByText('Este producto todavía no tiene imágenes')

    const html = new File(['<script>'], 'foto.jpg', { type: 'text/html' })
    await user.upload(screen.getByLabelText('Añadir imágenes'), html)

    expect(await screen.findByText(/Formato no admitido/)).toBeInTheDocument()
    expect(fake.state.tables.product_images).toHaveLength(0)
    expect(fake.state.storage[PRODUCT_IMAGES_BUCKET]).toEqual({})
  })

  it('rechaza una imagen que pasa de 5 MB', async () => {
    const user = userEvent.setup()
    const fake = backend([])
    renderPanel(fake)
    await screen.findByText('Este producto todavía no tiene imágenes')

    await user.upload(
      screen.getByLabelText('Añadir imágenes'),
      png('enorme.png', 5 * 1024 * 1024 + 1),
    )

    expect(await screen.findByText(/supera los 5 MB/)).toBeInTheDocument()
    expect(fake.state.tables.product_images).toHaveLength(0)
  })

  it('marcar como principal deja una sola principal', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPanel(fake)
    await screen.findByText('dos.jpg')

    const buttons = screen.getAllByRole('button', { name: 'Marcar como principal' })
    await user.click(buttons[buttons.length - 1]!)

    await waitFor(() =>
      expect(fake.state.tables.product_images?.filter((row) => row.is_primary)).toHaveLength(1),
    )
    expect(fake.state.tables.product_images?.find((row) => row.is_primary)?.id).toBe(IMAGE_2)
    expect(await screen.findByText('Imagen principal actualizada')).toBeInTheDocument()
  })

  it('reordenar manda la lista completa, no solo la que se movio', async () => {
    const user = userEvent.setup()
    const fake = backend()
    const calls: unknown[] = []
    const original = fake.state.rpc.reorder_product_images!
    fake.state.rpc.reorder_product_images = (args) => {
      calls.push(args.p_image_ids)
      return original(args)
    }
    renderPanel(fake)
    await screen.findByText('dos.jpg')

    await user.click(screen.getAllByRole('button', { name: 'Mover antes' })[1]!)

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual([IMAGE_2, IMAGE_1])
  })

  it('quitar una imagen borra la fila y tambien el objeto de Storage', async () => {
    const user = userEvent.setup()
    const fake = backend()
    renderPanel(fake)
    await screen.findByText('uno.jpg')

    await user.click(screen.getAllByRole('button', { name: 'Quitar imagen' })[0]!)

    await waitFor(() => expect(fake.state.tables.product_images).toHaveLength(1))
    expect(Object.keys(fake.state.storage[PRODUCT_IMAGES_BUCKET] ?? {})).toEqual([path('dos.jpg')])
    expect(await screen.findByText('Imagen eliminada')).toBeInTheDocument()
  })
})
