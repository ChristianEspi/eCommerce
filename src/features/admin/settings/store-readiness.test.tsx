import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { createFakeSupabase } from '@/test/supabaseMock'
import type { ReadinessStoreFields } from './readiness'

/**
 * El panel «Cómo se ve tu tienda», contra datos reales (Storefront V2 · P13).
 *
 * ## Qué protege
 *
 * Tres cosas, y la tercera es la que importa:
 *
 *  1. que las cuentas salgan de la base y no de un número escrito a mano;
 *  2. que una tienda sin nada configurado se explique sin romperse;
 *  3. que lo que se cuenta sea **lo de esta tienda**. El panel pregunta con el
 *     cliente anónimo, el mismo de un comprador, así que mide lo que se ve desde
 *     la calle; si un día alguien le quitara el filtro por tienda, el número de
 *     productos de un tenant aparecería en la pantalla de otro.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/shared/lib/supabase', () => ({
  tryGetSupabaseClient: () => holder.client,
  getSupabaseClient: () => holder.client,
  tryGetStorefrontClient: () => holder.client,
  tryGetStorefrontRpcClient: () => holder.client,
  getStorefrontClient: () => holder.client,
}))

const { StoreReadiness } = await import('./StoreReadiness')

const TIENDA = 'aaaa1111-1111-4111-8111-111111111111'
const OTRA = 'bbbb2222-2222-4222-8222-222222222222'

const SIN_NADA: ReadinessStoreFields = {
  logo_url: null,
  banner_url: null,
  support_email: null,
  contact_phone: null,
  contact_address: null,
}

interface Semilla {
  productos?: Array<{ store_id?: string; primary_image_path: string | null }>
  categorias?: Array<{ store_id?: string; parent_id?: string | null; image_url: string | null }>
  marcas?: Array<{ store_id?: string; logo_url: string | null }>
  paginas?: Array<{ slug: string; title: string }>
}

function backend(semilla: Semilla = {}) {
  return createFakeSupabase({
    tables: {
      public_products: (semilla.productos ?? []).map((p, i) => ({
        product_id: `cccc${i}111-1111-4111-8111-111111111111`,
        store_id: p.store_id ?? TIENDA,
        primary_image_path: p.primary_image_path,
      })),
      public_categories: (semilla.categorias ?? []).map((c, i) => ({
        category_id: `dddd${i}111-1111-4111-8111-111111111111`,
        store_id: c.store_id ?? TIENDA,
        parent_id: c.parent_id ?? null,
        image_url: c.image_url,
      })),
      public_brands: (semilla.marcas ?? []).map((m, i) => ({
        brand_id: `eeee${i}111-1111-4111-8111-111111111111`,
        store_id: m.store_id ?? TIENDA,
        logo_url: m.logo_url,
      })),
    },
    rpc: { store_navigation_for_slug: () => semilla.paginas ?? [] },
  })
}

async function pintar(semilla: Semilla = {}, tienda: Partial<ReadinessStoreFields> = {}) {
  holder.client = backend(semilla)
  renderWithProviders(
    <StoreReadiness storeId={TIENDA} storeSlug="botica" store={{ ...SIN_NADA, ...tienda }} />,
    { route: '/app/settings' },
  )
  return screen.getByRole('region', { name: 'Cómo se ve tu tienda' })
}

const linea = (id: string) => document.querySelector(`[data-readiness="${id}"]`) as HTMLElement

beforeEach(() => {
  holder.client = null
})

describe('las cuentas salen de la tienda publicada', () => {
  it('cuenta cuántos productos publicados tienen foto', async () => {
    await pintar({
      productos: [
        { primary_image_path: 'a.jpg' },
        { primary_image_path: 'b.jpg' },
        { primary_image_path: null },
      ],
    })

    await vi.waitFor(() => {
      expect(within(linea('product-images')).getByText('2 de 3')).toBeInTheDocument()
    })
    expect(linea('product-images')).toHaveAttribute('data-state', 'todo')
  })

  it('con todas las fotos, la línea queda completa', async () => {
    await pintar({ productos: [{ primary_image_path: 'a.jpg' }] })

    await vi.waitFor(() => {
      expect(linea('product-images')).toHaveAttribute('data-state', 'ok')
    })
  })

  it('solo cuenta las familias RAÍZ, que son las que pinta la portada', async () => {
    await pintar({
      categorias: [
        { image_url: 'f1.jpg' },
        { image_url: null },
        // Una subcategoría sin foto no cuenta: no se pinta como puerta.
        { parent_id: 'dddd0111-1111-4111-8111-111111111111', image_url: null },
      ],
    })

    await vi.waitFor(() => {
      expect(within(linea('category-images')).getByText('1 de 2')).toBeInTheDocument()
    })
  })

  it('cuenta las marcas con logotipo', async () => {
    await pintar({ marcas: [{ logo_url: 'm.png' }, { logo_url: null }] })

    await vi.waitFor(() => {
      expect(within(linea('brand-logos')).getByText('1 de 2')).toBeInTheDocument()
    })
  })

  it('las páginas publicadas cuentan como publicadas', async () => {
    await pintar({ paginas: [{ slug: 'terminos', title: 'Términos' }] })

    await vi.waitFor(() => {
      expect(linea('pages')).toHaveAttribute('data-state', 'ok')
    })
  })

  it('NO cuenta lo de otra tienda', async () => {
    // La prueba de aislamiento del panel: si alguien quitara el filtro por
    // tienda, aquí saldrían cuatro productos en vez de uno.
    await pintar({
      productos: [
        { primary_image_path: 'mia.jpg' },
        { store_id: OTRA, primary_image_path: 'ajena1.jpg' },
        { store_id: OTRA, primary_image_path: 'ajena2.jpg' },
        { store_id: OTRA, primary_image_path: null },
      ],
      marcas: [{ store_id: OTRA, logo_url: null }],
    })

    await vi.waitFor(() => {
      expect(linea('product-images')).toHaveAttribute('data-state', 'ok')
    })
    // Y la marca sin logotipo de la otra tienda no ensucia esta línea.
    expect(linea('brand-logos')).toHaveAttribute('data-state', 'ok')
  })
})

describe('una tienda sin nada se explica, no se rompe', () => {
  it('se pintan las siete líneas y ninguna es un error', async () => {
    const panel = await pintar()

    expect(within(panel).getAllByRole('listitem')).toHaveLength(7)
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lo que no tiene nada que medir sale al día, no en rojo', async () => {
    await pintar()

    await vi.waitFor(() => {
      expect(linea('brand-logos')).toHaveAttribute('data-state', 'ok')
    })
    expect(linea('category-images')).toHaveAttribute('data-state', 'ok')
  })

  it('cada línea dice qué pasa en la vitrina, no que sea obligatorio', async () => {
    const panel = await pintar()

    // Lo que dice cada señal es la CONSECUENCIA: «un producto publicado sin
    // foto se ve como un recuadro gris», no «sube las fotos».
    expect(panel.textContent).toContain('recuadro gris')

    // Se revisan las líneas, no la cabecera: la cabecera sí usa la palabra
    // «obligatorio», y la usa para decir que nada lo es.
    for (const item of within(panel).getAllByRole('listitem')) {
      const texto = item.textContent ?? ''
      for (const imperativo of ['obligatorio', 'requerido', 'debes', 'tienes que']) {
        expect(texto.toLowerCase()).not.toContain(imperativo)
      }
    }
  })

  it('y el panel dice que no bloquea nada', async () => {
    const panel = await pintar()

    expect(panel.textContent).toContain('no bloquea nada')
  })
})

describe('el resumen es una cuenta, no una nota', () => {
  it('cuenta cuántas señales están al día, sobre siete', async () => {
    await pintar({}, { logo_url: 'logo.png', support_email: 'hola@botica.pe' })

    // Logotipo, contacto y las tres que no tienen nada que medir: cinco de
    // siete. Quedan la imagen de portada y las páginas. Se puede recontar
    // mirando la lista, que es lo que una nota no permite.
    await vi.waitFor(() => {
      expect(screen.getByText('5 de 7 al día')).toBeInTheDocument()
    })
  })

  it('no aparece ninguna puntuación sobre 100 ni un porcentaje global', async () => {
    // Una nota es una opinión con aspecto de medida: nadie sabe qué pesa cada
    // cosa ni por qué la foto de una marca vale tres puntos y no siete.
    const panel = await pintar({ productos: [{ primary_image_path: null }] })

    await vi.waitFor(() => {
      expect(within(linea('product-images')).getByText('0 de 1')).toBeInTheDocument()
    })
    expect(panel.textContent).not.toMatch(/\/\s*100|\d+\s*%|puntos/)
  })

  it('el estado va en TEXTO y no solo en color', async () => {
    // Un icono verde y uno gris no se distinguen con daltonismo.
    await pintar({}, { logo_url: 'logo.png' })

    expect(within(linea('logo')).getByText('Completo')).toBeInTheDocument()
    expect(within(linea('hero')).getByText('Por mejorar')).toBeInTheDocument()
  })
})
