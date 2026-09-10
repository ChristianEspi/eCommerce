import type { ComponentProps, ReactNode } from 'react'
import type { MessageKey } from '@/shared/i18n/messages'
import type { BrandRow } from '../components/BrandRow'
import type { ContentBlocks } from '../components/ContentBlocks'
import type { PromoCarousel } from '../components/PromoCarousel'
import type { HomeSectionId } from '../theme/types'
import type { PublicProduct, PublicStore } from '../types'

/**
 * Lo que una sección de la portada necesita para pintarse.
 *
 * ## La regla que sostiene este archivo
 *
 * **Los datos llegan ya resueltos.** `StoreHomePage` sigue siendo la dueña de
 * los hooks, de las consultas y del estado de la URL; el compositor y las
 * secciones solo reciben el resultado.
 *
 * No es una preferencia de estilo. Si cada sección pidiera lo suyo, la portada
 * pasaría de tres consultas a una por sección, las mismas tres se repetirían
 * con claves distintas y el reparto que impide que un producto salga en cuatro
 * sitios a la vez dejaría de ser posible — porque nadie tendría la lista
 * completa para repartir.
 *
 * Por eso los tipos de las listas se toman de los componentes que las
 * consumen (`ComponentProps`) en vez de reescribirse aquí: un tipo copiado a
 * mano se desincroniza del componente y nadie se entera hasta que algo se
 * pinta vacío.
 */
export interface HomeSectionData {
  readonly store: PublicStore
  readonly storeSlug: string
  /**
   * La traducción, pasada como dato y no leída con un hook.
   *
   * Las secciones son FUNCIONES, no componentes: así el compositor puede
   * llamarlas, ver si devuelven algo y decidir sin montar nada. Una función no
   * puede usar `useI18n`, y convertir las trece en componentes solo para eso
   * añadiría trece nodos al árbol sin ganar nada.
   */
  readonly t: (key: MessageKey) => string

  /**
   * El reparto de productos que hace `StoreHomePage`, sección a sección.
   *
   * Ya viene sin repetidos: el hero coge primero y cada lista siguiente se
   * queda con lo que nadie usó. Cambiar eso aquí volvería a poner el mismo
   * frasco en cuatro sitios de la misma pantalla.
   */
  readonly hero: readonly PublicProduct[]
  readonly ofertas: readonly PublicProduct[]
  readonly destacados: readonly PublicProduct[]
  readonly novedades: readonly PublicProduct[]
  readonly masVendido: readonly PublicProduct[]

  /** Miniaturas ya firmadas. Firmarlas por sección multiplicaría las llamadas. */
  readonly thumbsOfertas: Record<string, string>
  readonly thumbsCatalogo: Record<string, string>
  readonly thumbsNovedades: Record<string, string>

  readonly blocks: ComponentProps<typeof ContentBlocks>['blocks']
  readonly assets: ComponentProps<typeof ContentBlocks>['assets']
  readonly images: ComponentProps<typeof ContentBlocks>['images']
  /** El CMS trae su propio `hero`: es él quien lleva el `<h1>`. */
  readonly hasCmsHero: boolean
  /** El CMS trae cubierta (hero o carrusel con diapositivas). */
  readonly cmsTraePortada: boolean
  /** El comercio ya compuso filas de producto: no se le repiten. */
  readonly cmsTraeProductos: boolean

  readonly promociones: ComponentProps<typeof PromoCarousel>['promotions']
  readonly promoAssets: ComponentProps<typeof PromoCarousel>['assets']

  readonly brands: ComponentProps<typeof BrandRow>['brands']
  readonly brandSelected: string | null

  readonly favorites: ReadonlySet<string>
  readonly cargandoNovedades: boolean
  readonly cargandoCatalogo: boolean

  readonly onToggleFavorite: (productId: string) => void
  readonly onQuickView: (slug: string) => void
  readonly onPrefetch: (slug: string) => void
  readonly onSelectBrand: (code: string | null) => void

  /**
   * ¿Está `featured` encendida como sección propia?
   *
   * Hoy `offers` pinta lo rebajado Y lo destacado en la misma banda. Si el
   * comercio separa lo destacado, la banda se queda solo con las ofertas — si
   * no, saldría dos veces. Es la única coordinación entre secciones, y vive
   * aquí en vez de en un `useContext` porque una sección que consulta a otra
   * por su cuenta es una dependencia que no se ve al leer el registro.
   */
  readonly destacadosAparte: boolean
}

/**
 * Cómo se pinta una sección.
 *
 * Devolver `null` es una respuesta VÁLIDA y es la que da una sección sin datos
 * —o sin implementación todavía—. Una sección declarada que no tiene qué pintar
 * desaparece; no deja un hueco ni rompe la portada.
 */
export type HomeSectionRenderer = (
  data: HomeSectionData,
  /** El tope que la tienda configuró, si esta sección admite uno. */
  maxItems?: number,
) => ReactNode

export type HomeSectionRegistry = Readonly<Record<HomeSectionId, HomeSectionRenderer>>
