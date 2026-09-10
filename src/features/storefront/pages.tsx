import LoginRoundedIcon from '@mui/icons-material/LoginRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import { Box, Button, Card, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { BrandLockup } from '@/shared/ui/BrandLockup'
import { TS } from '@/theme/tokens'
import { useDefaultStoreSlug } from './default-store'

/**
 * Pantallas sueltas fuera de la vitrina de una tienda.
 *
 * El catálogo y la ficha viven en `StoreHomePage.tsx` y `StoreProductPage.tsx`
 * (P05); el carrito, el checkout y la confirmación en `StoreCartPage.tsx`,
 * `StoreCheckoutPage.tsx` y `StoreOrderPage.tsx` (P06). Aquí queda solo la
 * portada del dominio raíz.
 */

/**
 * Portada del dominio raíz.
 *
 * Era un cartel con la propuesta de valor y **una línea de texto con las rutas**
 * —`/login · /app · /s/:storeSlug`—, que es una nota para quien programa, no
 * una salida para quien llega: hay que seleccionarla, saber que es una URL y
 * escribirla a mano. Ahora las dos cosas que se pueden hacer desde aquí son dos
 * botones.
 *
 * ## De qué tienda es el segundo botón
 *
 * En un SaaS multitenant la raíz no tiene por qué conocer ninguna tienda: cada
 * una vive en su slug. Por eso el destino sale, en este orden, de
 * `VITE_STOREFRONT_SLUG` —el despliegue lo declara— o de la base, cuando el
 * proyecto tiene EXACTAMENTE una tienda activa, que es el caso de una demo o de
 * un cliente único.
 *
 * Con varias tiendas el botón no aparece, y no se listan: la lista de tiendas
 * activas de un SaaS es la lista de clientes, y la portada pública no es sitio
 * para publicarla.
 */
export function LandingPage() {
  const { t } = useI18n()

  // La regla de «a qué tienda» vive en `default-store.ts`: la comparte con el
  // guard del backoffice, que la necesita para no dejar a un comprador atrapado
  // en un cartel sin salida.
  const { slug, name: storeName } = useDefaultStoreSlug()

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: { xs: 2, md: 6 } }}>
      <Card sx={{ width: '100%', maxWidth: 560, p: { xs: 3, md: 5 } }}>
        <Stack sx={{ alignItems: 'center', gap: 2.5, textAlign: 'center' }}>
          <BrandLockup size={40} />

          <Box>
            <Typography component="h1" sx={{ fontSize: TS.hero, fontWeight: 800, letterSpacing: '-0.6px' }}>
              {t('landing.title')}
            </Typography>
            <Typography sx={{ color: 'var(--muted)', fontSize: TS.bodyStrong, mt: 1, lineHeight: 1.6 }}>
              {t('auth.valueProp')}
            </Typography>
          </Box>

          {/* Entrar es el primario: quien llega a la raíz de una app de gestión
              viene a trabajar. La vitrina es la salida del comprador que se
              perdió, y por eso va en secundario. */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ width: '100%', justifyContent: 'center', pt: 0.5 }}
          >
            <Button
              variant="contained"
              component={Link}
              to="/login"
              size="large"
              startIcon={<LoginRoundedIcon />}
            >
              {t('landing.enter')}
            </Button>

            {slug && (
              <Button
                variant="outlined"
                component={Link}
                to={`/s/${slug}`}
                size="large"
                startIcon={<StorefrontRoundedIcon />}
              >
                {storeName
                  ? t('landing.visitNamed').replace('{store}', storeName)
                  : t('landing.visit')}
              </Button>
            )}
          </Stack>

          <Typography sx={{ color: 'var(--muted)', fontSize: TS.label, mt: 0.5 }}>
            {t('landing.hint')}
          </Typography>
        </Stack>
      </Card>
    </Box>
  )
}
