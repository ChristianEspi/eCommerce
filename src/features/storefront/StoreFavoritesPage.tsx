import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import { Box, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/shared/i18n/i18n-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import { fetchPublicProductsByIds } from './api'
import { ProductGrid, ProductGridSkeleton } from './components/ProductGrid'
import { useSignedThumbnails, useStorefront } from './hooks'
import { useFavorites } from './useFavorites'

/**
 * Lo que el comprador guardó.
 *
 * Hasta ahora se podía pulsar el corazón y no había dónde ver el resultado: la
 * lista existía en el navegador y en la base, pero no en la pantalla. Un botón
 * de guardar sin sitio donde mirar lo guardado es un botón que no hace nada, y
 * así es exactamente como se sentía.
 *
 * ## Sin sesión también
 *
 * La página no exige cuenta. Sin sesión los favoritos viven en `localStorage`
 * —es lo que `useFavorites` ya resolvía— y esta lista los pinta igual; lo único
 * que cambia es el aviso de que solo están en este navegador. Pedir cuenta para
 * ver una lista que ya está guardada sería inventar una puerta.
 *
 * ## Los ids mandan el orden
 *
 * `fetchPublicProductsByIds` respeta el orden que se le da, y aquí se le da el
 * de guardado. Una lista de favoritos que se recoloca en cada recarga se siente
 * rota aunque tenga los mismos productos.
 */
export function StoreFavoritesPage() {
  const { store, storeSlug } = useStorefront()
  return <FavoritesView storeId={store.store_id} storeSlug={storeSlug} headingComponent="h1" />
}

/**
 * La lista de favoritos, sin depender del `<Outlet>` de la vitrina.
 *
 * La usan la página `/favoritos` —con su `h1`— y la pestaña «Mis favoritos» de la
 * cuenta del consumidor, que ya tiene el `h1` de la cuenta encima y por eso
 * pide un `h2`. Es la misma lista y el mismo hook: dos copias acabarían
 * enseñando cosas distintas del mismo corazón.
 */
export function FavoritesView({
  storeId,
  storeSlug,
  headingComponent,
}: {
  storeId: string
  storeSlug: string
  headingComponent: 'h1' | 'h2'
}) {
  const { t } = useI18n()
  const favorites = useFavorites(storeId)
  const ids = [...favorites.ids]

  const query = useQuery({
    queryKey: ['storefront', 'favorites', storeId, ids],
    queryFn: () => fetchPublicProductsByIds(storeId, ids),
    // Hasta que los favoritos se han leído (servidor o navegador) no se
    // pregunta: con la lista a medias se pediría dos veces y la primera
    // pintaría menos productos de los que hay.
    enabled: favorites.ready,
  })

  const products = query.data ?? []
  const thumbnails = useSignedThumbnails(products.map((product) => product.primary_image_path))

  return (
    <Stack sx={{ gap: 2.5 }}>
      <Box>
        <Typography
          component={headingComponent}
          sx={{ fontSize: headingComponent === 'h1' ? TS.hero : 17, fontWeight: 800, letterSpacing: '-0.5px' }}
        >
          {t('store.favorites.title')}
        </Typography>
        <Typography sx={{ color: 'var(--muted)', fontSize: TS.body, mt: 0.5 }}>
          {/* El aviso solo cuando toca: quien tiene sesión no necesita que le
              recuerden que sus favoritos viajan con ella. */}
          {favorites.persisted ? t('store.favorites.synced') : t('store.favorites.localOnly')}
        </Typography>
      </Box>

      {!favorites.ready || query.isPending ? (
        <ProductGridSkeleton count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : products.length === 0 ? (
        <EmptyState
          title={t('store.favorites.empty')}
          description={t('store.favorites.emptyBody')}
          icon={<FavoriteBorderRoundedIcon fontSize="small" />}
        />
      ) : (
        <ProductGrid
          products={products}
          storeSlug={storeSlug}
          thumbnails={thumbnails}
          favorites={favorites.ids}
          onToggleFavorite={(productId) => void favorites.toggle(productId)}
        />
      )}
    </Stack>
  )
}
