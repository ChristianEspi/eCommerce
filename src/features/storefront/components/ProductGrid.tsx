import { Box, Card, Skeleton, Stack } from '@mui/material'
import { useSessionContext } from '@/features/auth/session-context'
import { useCatalogCommercialPrices } from '../commerce/catalogPrices'
import { useCommerceContext } from '../commerce/context'
import { usePurchasedProducts } from '../commerce/purchased'
import type { PublicProduct } from '../types'
import { ProductCard } from './ProductCard'
import { ProductListRow } from './ProductListRow'
import { useI18n } from '@/shared/i18n/i18n-context'

/** Cómo se pinta el resultado: tarjetas para mirar, filas para despachar. */
export type CatalogView = 'grid' | 'list'

/**
 * Rejilla del catálogo, mobile-first de verdad: **dos columnas ya en el móvil**
 * (que es como se ven las tiendas en el teléfono) y hasta cuatro en escritorio.
 * `auto-rows: 1fr` iguala la altura de las tarjetas sin medir nada en JS.
 *
 * Las columnas y el aire salen de variables que pone el tema. Fuera de la
 * vitrina esas variables no existen, y por eso llevan RESERVA: 2/3/4 y 12/20
 * px, que es exactamente lo que la rejilla hacía antes del Theme Engine. Una
 * rejilla que se quedara sin columnas por una variable ausente sería una lista
 * de una columna, y eso no se ve en ninguna prueba de unidad.
 */
const GRID_SX = {
  display: 'grid',
  gap: { xs: 'var(--sf-grid-gap, 12px)', md: 'var(--sf-grid-gap-md, 20px)' },
  gridTemplateColumns: {
    xs: 'repeat(var(--sf-grid-xs, 2), minmax(0, 1fr))',
    sm: 'repeat(var(--sf-grid-sm, 3), minmax(0, 1fr))',
    lg: 'repeat(var(--sf-grid-lg, 4), minmax(0, 1fr))',
  },
  gridAutoRows: '1fr',
} as const

export function ProductGrid({
  products,
  storeSlug,
  thumbnails,
  onPrefetch,
  onQuickView,
  favorites,
  onToggleFavorite,
  view = 'grid',
}: {
  products: PublicProduct[]
  storeSlug: string
  thumbnails: Record<string, string>
  /** Se llama al apuntar o enfocar una tarjeta. Opcional a propósito: los
      relacionados de la ficha no lo pasan, porque ahí el siguiente clic es
      mucho menos probable que en la rejilla del catálogo. */
  onPrefetch?: (slug: string) => void
  /** Abre la vista rapida. Sin esto la tarjeta navega a la ficha, que es
      su comportamiento por defecto y el que conserva sin JavaScript. */
  onQuickView?: (slug: string) => void
  /** Ids guardados. La rejilla los recibe YA cargados: una consulta, no una por
      tarjeta. */
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (productId: string) => void
  /** `list` para quien compra por referencia. Por defecto, la rejilla. */
  view?: CatalogView
}) {
  // UNA cotización para toda la rejilla, y solo si la sesión tiene condiciones
  // comerciales (N03). Invitado y consumidor: ninguna.
  const { t } = useI18n()
  const commercial = useCatalogCommercialPrices(storeSlug, products)
  // Comprador empresa o comercio: pide cantidad antes de agregar. La consulta
  // es la misma que usa la barra de la cuenta, así que no cuesta otra lectura.
  const { status } = useSessionContext()
  const { audience } = useCommerceContext(storeSlug, status === 'authenticated')
  const b2b = audience !== 'consumer'
  // «Ya comprado», también UNA consulta para toda la rejilla y solo para empresa.
  const purchased = usePurchasedProducts(storeSlug)

  if (view === 'list') {
    return (
      <Box
        component="ul"
        data-catalog-view="list"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          bgcolor: 'var(--card)',
          borderRadius: 'var(--sf-radius)',
          border: '1px solid var(--sf-line)',
          boxShadow: 'var(--sf-shadow)',
          overflow: 'hidden',
        }}
      >
        {/* Los rótulos de columna: solo los enciende el estilo que pinta la lista
            como tabla (catálogo). Decorativos para el lector de pantalla: cada
            fila ya nombra su producto, su precio y su botón. */}
        <Box component="li" aria-hidden className="sf-list-head" sx={{ display: 'none' }}>
          <span>{t('store.list.product')}</span>
          <span>{t('store.list.stock')}</span>
          <span>{t('store.list.price')}</span>
          <span>{t('store.list.quantity')}</span>
        </Box>
        {products.map((product) => (
          <ProductListRow
            key={product.product_id}
            product={product}
            storeSlug={storeSlug}
            commercialPrice={commercial.get(product.product_id) ?? null}
            b2b={b2b}
            purchased={purchased.has(product.product_id)}
            favorite={favorites?.has(product.product_id) ?? false}
            imageUrl={product.primary_image_path ? (thumbnails[product.primary_image_path] ?? null) : null}
            {...(onQuickView ? { onQuickView } : {})}
            {...(onToggleFavorite ? { onToggleFavorite } : {})}
            {...(onPrefetch ? { onPrefetch } : {})}
          />
        ))}
      </Box>
    )
  }

  return (
    <Box sx={GRID_SX}>
      {products.map((product) => (
        <ProductCard
          key={product.product_id}
          product={product}
          storeSlug={storeSlug}
          commercialPrice={commercial.get(product.product_id) ?? null}
          b2b={b2b}
          purchased={purchased.has(product.product_id)}
          {...(onQuickView ? { onQuickView } : {})}
          {...(onToggleFavorite ? { onToggleFavorite } : {})}
          favorite={favorites?.has(product.product_id) ?? false}
          imageUrl={
            product.primary_image_path ? (thumbnails[product.primary_image_path] ?? null) : null
          }
          onPrefetch={onPrefetch}
        />
      ))}
    </Box>
  )
}

/**
 * Esqueleto con la MISMA rejilla que el catálogo real: si el esqueleto tuviera
 * otra forma, la página daría un salto al llegar los datos.
 */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <Box sx={GRID_SX} aria-hidden data-testid="catalog-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <Card
          key={index}
          sx={{
            p: 1.5,
            borderRadius: 'var(--sf-radius)',
            border: '1px solid var(--sf-line)',
            boxShadow: 'var(--sf-shadow)',
          }}
        >
          <Skeleton
            variant="rectangular"
            sx={{ aspectRatio: '1 / 1', borderRadius: 'var(--sf-radius-sm)' }}
          />
          <Stack sx={{ gap: 0.5, mt: 1 }}>
            <Skeleton width="45%" height={12} />
            <Skeleton width="90%" height={18} />
            <Skeleton width="35%" height={18} />
          </Stack>
        </Card>
      ))}
    </Box>
  )
}
