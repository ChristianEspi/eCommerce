import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { tryGetStorefrontClient } from '@/shared/lib/supabase'
import {
  PUBLIC_BRANDS_VIEW,
  PUBLIC_CATEGORIES_VIEW,
  PUBLIC_PRODUCTS_VIEW,
  STORE_NAVIGATION_PUBLIC_RPC,
} from '@/shared/lib/db-schema'

/**
 * Qué se ve de esta tienda desde fuera (Storefront V2 · P13).
 *
 * ## Qué pregunta este módulo, y por qué esa y no otra
 *
 * No «¿está bien configurada la tienda?» —eso depende del negocio de cada uno y
 * no lo sabe este código— sino **«¿qué le falta a lo que ya se publica para que
 * se vea como una tienda?»**. Es una pregunta contestable con datos: un producto
 * publicado sin foto se ve como un recuadro gris en la vitrina, y eso es un
 * hecho, no una opinión.
 *
 * ## Se pregunta con el cliente ANÓNIMO, a propósito
 *
 * El mismo con el que navega un comprador. Así lo que se mide es exactamente lo
 * que se ve desde la calle, no lo que hay en la base: un producto en borrador no
 * cuenta porque nadie lo ve, y una categoría sin publicar tampoco. Y de paso, el
 * panel no puede enseñar de más — no tiene con qué.
 *
 * Cruzar tenants es imposible por construcción: las vistas públicas filtran por
 * `store_id` y solo devuelven lo publicado de tiendas activas.
 *
 * ## Lo que NO hace
 *
 * No puntúa de 0 a 100. Una nota es una opinión con aspecto de medida: nadie
 * sabe qué pesa cada cosa ni por qué subir la foto de una marca vale tres puntos
 * y no siete. Aquí cada señal dice **su cuenta real** —«18 de 24 productos
 * publicados tienen foto»— y el resumen es cuántas señales están al día.
 *
 * No bloquea nada, y no declara nada obligatorio. Una tienda puede vender
 * perfectamente sin logotipo de marca en sus fabricantes.
 */

/** El estado de una señal. Dos, y no tres: «casi» no ayuda a decidir nada. */
export type ReadinessState = 'ok' | 'todo'

export interface ReadinessSignal {
  readonly id:
    | 'logo'
    | 'hero'
    | 'contact'
    | 'description'
    | 'product-images'
    | 'category-images'
    | 'brand-logos'
    | 'pages'
  readonly state: ReadinessState
  /** Cuántos cumplen y sobre cuántos, cuando la señal cuenta cosas. */
  readonly done: number
  readonly total: number
}

/** Lo que el formulario ya sabe sin preguntar a nadie. */
export interface ReadinessStoreFields {
  readonly logo_url: string | null
  readonly banner_url: string | null
  readonly support_email: string | null
  readonly contact_phone: string | null
  readonly contact_address: string | null
  /**
   * Identidad V3 (P01), que cambia lo que se puede considerar un hueco.
   *
   * `brand_lockup` dice si el comercio quiere logotipo o su nombre escrito;
   * `store_description` es el resumen que usan el pie, la información del
   * negocio y el respaldo de SEO. Los dos son opcionales porque esta pantalla
   * se usa también con tiendas anteriores a V3, donde las columnas no existían.
   */
  readonly brand_lockup?: string | null
  readonly store_description?: string | null
  /**
   * La bajada del hero, que hasta V3 ERA la descripción publicable de la
   * tienda. Sirve de respaldo de compatibilidad, igual que en la vitrina
   * (`resolveStoreDescription`): a una tienda de V2 no se le pide escribir algo
   * que ya tenía escrito en otro sitio.
   */
  readonly hero_subtitle?: string | null
}

/** Lo que hay que contar contra la base. */
export interface ReadinessCounts {
  readonly products: number
  readonly productsWithImage: number
  readonly rootCategories: number
  readonly rootCategoriesWithImage: number
  readonly brands: number
  readonly brandsWithLogo: number
  readonly pages: number
}

const VACIO: ReadinessCounts = {
  products: 0,
  productsWithImage: 0,
  rootCategories: 0,
  rootCategoriesWithImage: 0,
  brands: 0,
  brandsWithLogo: 0,
  pages: 0,
}

const lleno = (valor: string | null | undefined) => (valor ?? '').trim() !== ''

/**
 * Las señales, a partir de lo que hay en el formulario y de lo que se contó.
 *
 * Función pura y exportada: es donde vive la regla de cada señal, y probarla no
 * debería exigir montar una pantalla ni una base.
 *
 * **Una señal que no tiene nada que medir está al día.** Una tienda sin marcas
 * no tiene marcas sin logotipo, y marcarla en rojo sería pedirle que invente
 * marcas para aprobar un examen.
 */
export function readinessSignals(
  store: ReadinessStoreFields,
  counts: ReadinessCounts,
): readonly ReadinessSignal[] {
  const todas = (hechos: number, total: number): ReadinessState =>
    total === 0 || hechos === total ? 'ok' : 'todo'

  const contacto = [store.support_email, store.contact_phone, store.contact_address].filter(lleno)

  /**
   * El logotipo solo falta si la tienda lo USA (V3 · P11).
   *
   * Desde P01 el comercio elige su lockup: `logo_name`, `logo` o `name`. Quien
   * eligió `name` quiere su nombre escrito —es una decisión de marca, no un
   * descuido— y pedirle un logotipo era pedirle que rellene un hueco que él
   * mismo cerró. Con las otras dos, el logotipo sí es lo que se espera ver.
   */
  const usaLogotipo = (store.brand_lockup ?? 'logo_name') !== 'name'
  const logoListo = usaLogotipo ? lleno(store.logo_url) : true

  /**
   * Y la portada tiene RESPALDOS desde P04.
   *
   * Sin banner, el hero no se queda en blanco: usa la foto de un producto
   * rebajado, la de una familia o el degradado de la suite con el lema del
   * comercio. Así que «no hay banner» solo es un hueco cuando además no hay
   * ninguna foto de producto publicada — ahí sí la portada se queda sin imagen.
   */
  const heroListo =
    lleno(store.banner_url) || (counts.products > 0 && counts.productsWithImage > 0)

  return [
    {
      id: 'logo',
      state: logoListo ? 'ok' : 'todo',
      done: logoListo ? 1 : 0,
      total: 1,
    },
    {
      id: 'hero',
      state: heroListo ? 'ok' : 'todo',
      done: heroListo ? 1 : 0,
      total: 1,
    },
    {
      // Uno basta: con un correo, un teléfono o una dirección ya se puede
      // llegar al comercio. Exigir los tres sería inventar una obligación.
      id: 'contact',
      state: contacto.length > 0 ? 'ok' : 'todo',
      done: contacto.length,
      total: 3,
    },
    {
      /**
       * El resumen estable del comercio (V3 · P01).
       *
       * Lo usan el pie, la información del negocio y el respaldo de SEO cuando
       * no hay descripción de página. Sin él, un buscador y el previo de un
       * chat se quedan con el nombre a secas.
       *
       * Vale la bajada del hero como respaldo de compatibilidad —es lo que la
       * vitrina usaba antes de que existiera el campo, y a lo que sigue cayendo
       * al leerlo— para no pedirle a una tienda de V2 que escriba algo que ya
       * tenía escrito en otro sitio.
       */
      id: 'description',
      state: lleno(store.store_description) || lleno(store.hero_subtitle) ? 'ok' : 'todo',
      done: lleno(store.store_description) || lleno(store.hero_subtitle) ? 1 : 0,
      total: 1,
    },
    {
      id: 'product-images',
      state: todas(counts.productsWithImage, counts.products),
      done: counts.productsWithImage,
      total: counts.products,
    },
    {
      id: 'category-images',
      state: todas(counts.rootCategoriesWithImage, counts.rootCategories),
      done: counts.rootCategoriesWithImage,
      total: counts.rootCategories,
    },
    {
      id: 'brand-logos',
      state: todas(counts.brandsWithLogo, counts.brands),
      done: counts.brandsWithLogo,
      total: counts.brands,
    },
    {
      // Sin número mínimo: cuántas páginas necesita una tienda lo decide el
      // comercio y su país, no esta pantalla. Lo que se mira es si hay alguna
      // forma de llegar a algo escrito.
      id: 'pages',
      state: counts.pages > 0 ? 'ok' : 'todo',
      done: counts.pages,
      total: Math.max(counts.pages, 1),
    },
  ]
}

export const readinessKey = (storeId: string) => ['admin', 'readiness', storeId] as const

/**
 * Las cuentas, contra las vistas públicas.
 *
 * Los productos se cuentan con `count: 'exact'` y `head: true`: dos cuentas del
 * servidor en vez de traerse el catálogo entero al navegador para contarlo aquí.
 * Un catálogo de veinte mil referencias en una pantalla de configuración sería
 * una descarga de varios megabytes por abrir una pestaña.
 *
 * Las categorías y las marcas sí se traen —son decenas, no miles— porque de
 * ellas hace falta mirar una columna y, en el caso de las familias, filtrar por
 * las raíces.
 */
export async function fetchReadinessCounts(
  storeId: string,
  storeSlug: string,
): Promise<ReadinessCounts> {
  const supabase = tryGetStorefrontClient()
  if (!supabase) return VACIO

  const [productos, conFoto, categorias, marcas, paginas] = await Promise.all([
    supabase
      .from(PUBLIC_PRODUCTS_VIEW)
      .select('product_id', { count: 'exact', head: true })
      .eq('store_id', storeId),
    supabase
      .from(PUBLIC_PRODUCTS_VIEW)
      .select('product_id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .not('primary_image_path', 'is', null),
    supabase
      .from(PUBLIC_CATEGORIES_VIEW)
      .select('category_id, parent_id, image_url')
      .eq('store_id', storeId),
    supabase.from(PUBLIC_BRANDS_VIEW).select('brand_id, logo_url').eq('store_id', storeId),
    supabase.rpc(STORE_NAVIGATION_PUBLIC_RPC, { p_store_slug: storeSlug }),
  ])

  const raices = (categorias.data ?? []).filter(
    (fila) => (fila as { parent_id: string | null }).parent_id === null,
  )
  const conImagen = raices.filter((fila) => lleno((fila as { image_url: string | null }).image_url))
  const listaMarcas = marcas.data ?? []
  const conLogo = listaMarcas.filter((fila) => lleno((fila as { logo_url: string | null }).logo_url))

  return {
    products: productos.count ?? 0,
    productsWithImage: conFoto.count ?? 0,
    rootCategories: raices.length,
    rootCategoriesWithImage: conImagen.length,
    brands: listaMarcas.length,
    brandsWithLogo: conLogo.length,
    pages: Array.isArray(paginas.data) ? paginas.data.length : 0,
  }
}

/**
 * Las cuentas, ya en un hook.
 *
 * `retry: false` y cuentas a cero cuando algo falla: este panel es informativo,
 * y una pantalla de configuración que se rompe entera porque no se pudo contar
 * una columna es peor que un panel que dice «0 de 0».
 */
export function useReadinessCounts(
  storeId: string | null,
  storeSlug: string | null,
): UseQueryResult<ReadinessCounts> {
  return useQuery({
    queryKey: readinessKey(storeId ?? ''),
    queryFn: () => fetchReadinessCounts(storeId as string, storeSlug as string),
    enabled: Boolean(storeId && storeSlug),
    staleTime: 60_000,
    retry: false,
  })
}
