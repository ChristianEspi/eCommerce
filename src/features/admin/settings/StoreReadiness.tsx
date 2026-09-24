import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import { Box, Stack, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import {
  readinessSignals,
  useReadinessCounts,
  type ReadinessSignal,
  type ReadinessStoreFields,
} from './readiness'

/**
 * «Cómo se ve tu tienda»: el panel de calidad visual (Storefront V2 · P13).
 *
 * ## Qué problema resuelve
 *
 * Una tienda puede tener el orden de la portada perfecto y verse pobre. El
 * motivo casi nunca es la configuración: son treinta productos publicados sin
 * foto, las familias sin imagen y el logotipo sin subir. Eso no se ve desde esta
 * pantalla —se ve abriendo la tienda y bajando— y el comercio, que ya sabe qué
 * vende, no lo mira con los ojos de quien llega por primera vez.
 *
 * ## Las reglas del panel
 *
 *  · **Informativo, nunca bloqueante.** No impide publicar, no avisa al guardar
 *    y no aparece en rojo. Es una lista de cosas que se pueden mejorar.
 *  · **Sin nota de 0 a 100.** Una nota es una opinión con aspecto de medida:
 *    nadie sabe qué pesa cada cosa. Aquí cada línea dice su cuenta real y el
 *    resumen es cuántas señales están al día.
 *  · **Nada es obligatorio.** Una tienda puede vender sin logotipos de marca.
 *    Lo que se dice es qué efecto tiene, no que haya que hacerlo.
 *  · **Datos reales, de lo que YA se publica.** Se pregunta con el cliente
 *    anónimo, el mismo de un comprador: lo que mide es lo que se ve desde la
 *    calle. Ver `readiness.ts`.
 */

const TITULO: Record<ReadinessSignal['id'], MessageKey> = {
  logo: 'settings.readiness.logo',
  hero: 'settings.readiness.hero',
  contact: 'settings.readiness.contact',
  'product-images': 'settings.readiness.productImages',
  'category-images': 'settings.readiness.categoryImages',
  'brand-logos': 'settings.readiness.brandLogos',
  pages: 'settings.readiness.pages',
}

/** Qué pasa en la vitrina si esa señal no está. Nunca «es obligatorio». */
const PORQUE: Record<ReadinessSignal['id'], MessageKey> = {
  logo: 'settings.readiness.logoWhy',
  hero: 'settings.readiness.heroWhy',
  contact: 'settings.readiness.contactWhy',
  'product-images': 'settings.readiness.productImagesWhy',
  'category-images': 'settings.readiness.categoryImagesWhy',
  'brand-logos': 'settings.readiness.brandLogosWhy',
  pages: 'settings.readiness.pagesWhy',
}

/** Las que cuentan cosas enseñan «hechas de totales»; las de sí o no, no. */
const CUENTA: ReadonlySet<ReadinessSignal['id']> = new Set<ReadinessSignal['id']>([
  'product-images',
  'category-images',
  'brand-logos',
])

export function StoreReadiness({
  storeId,
  storeSlug,
  store,
}: {
  storeId: string | null
  storeSlug: string | null
  store: ReadinessStoreFields
}) {
  const { t } = useI18n()
  const cuentas = useReadinessCounts(storeId, storeSlug)

  // Mientras no hay cuentas, las señales del formulario ya se pueden calcular:
  // el logotipo y el contacto no dependen de ninguna consulta. Enseñar media
  // lista es más útil que enseñar un cargador donde luego habrá siete líneas.
  const señales = readinessSignals(store, {
    products: 0,
    productsWithImage: 0,
    rootCategories: 0,
    rootCategoriesWithImage: 0,
    brands: 0,
    brandsWithLogo: 0,
    pages: 0,
    ...(cuentas.data ?? {}),
  })

  const alDia = señales.filter((s) => s.state === 'ok').length

  return (
    <Stack component="section" aria-label={t('settings.readiness.title')} spacing={1}>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
      >
        <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
          {t('settings.readiness.title')}
        </Typography>
        {/* El resumen es una CUENTA, no una nota: se puede comprobar mirando la
            lista de abajo, que es lo que una nota de 0 a 100 no permite. */}
        <Typography sx={{ fontSize: TS.label, fontWeight: 800, color: 'var(--muted)' }}>
          {t('settings.readiness.summary')
            .replace('{n}', String(alDia))
            .replace('{total}', String(señales.length))}
        </Typography>
      </Stack>

      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('settings.readiness.help')}
      </Typography>

      <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0, gap: 0.75 }}>
        {señales.map((señal) => {
          const listo = señal.state === 'ok'

          return (
            <Stack
              key={señal.id}
              component="li"
              direction="row"
              data-readiness={señal.id}
              data-state={señal.state}
              sx={{
                gap: 1,
                alignItems: 'flex-start',
                p: 1,
                borderRadius: `${R.md}px`,
                border: '1px solid var(--border)',
                bgcolor: 'var(--card)',
              }}
            >
              <Box
                aria-hidden
                sx={{ display: 'flex', mt: '2px', color: listo ? 'var(--accent)' : 'var(--muted)' }}
              >
                {listo ? (
                  <CheckCircleRoundedIcon fontSize="small" />
                ) : (
                  <RadioButtonUncheckedRoundedIcon fontSize="small" />
                )}
              </Box>

              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack
                  direction="row"
                  sx={{ gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}
                >
                  <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>
                    {t(TITULO[señal.id])}
                  </Typography>
                  {/* El estado, en texto y no solo en color: un icono verde y
                      uno gris no se distinguen con daltonismo. */}
                  <Typography
                    sx={{
                      fontSize: TS.label,
                      fontWeight: 800,
                      color: listo ? 'var(--accent-deep)' : 'var(--muted)',
                    }}
                  >
                    {listo ? t('settings.readiness.done') : t('settings.readiness.todo')}
                  </Typography>
                  {CUENTA.has(señal.id) && señal.total > 0 && (
                    <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                      {t('settings.readiness.count')
                        .replace('{n}', String(señal.done))
                        .replace('{total}', String(señal.total))}
                    </Typography>
                  )}
                </Stack>
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                  {t(PORQUE[señal.id])}
                </Typography>
              </Box>
            </Stack>
          )
        })}
      </Stack>
    </Stack>
  )
}
