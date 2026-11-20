import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { iconoDe } from '../categoryIcon'
import { usePublicCategories } from '../hooks'
import type { PublicCategory } from '../types'
import { offerBadge, vigenciaTexto } from '../offer'
import { promotionHref, type StorePromotion } from '../promotions'
import type { ResolvedValueProp } from '../valueProps'
import { Countdown } from './Countdown'
import { ProductMedia } from './ProductMedia'

/**
 * Rediseño v3 · La portada de UNIVERSAL (lámina «02 — Universal · Home»).
 *
 * Tres columnas, como la primera pantalla de una gran superficie:
 *
 *  · **Departamentos** a la izquierda: las familias reales de la tienda, con su
 *    icono y una flecha. Es la barra de familias de la cabecera, puesta donde
 *    se entra por departamento.
 *  · **El banner** al centro: las campañas vigentes, una a una, con su foto,
 *    su vigencia, su texto y la puerta a sus productos.
 *  · **Dos bloques** a la derecha: «Ofertas del día» —con el reloj si una
 *    campaña termina pronto— y el primer beneficio de servicio de la tienda.
 *
 * Todo sale de datos que la portada ya tiene. Sin campañas no hay banner que
 * inventar: quien llama pasa `fallback` (el carrusel de producto de siempre).
 */
export function StoreUniversalHero({
  storeSlug,
  storeId,
  departments,
  promotions,
  promoAssets = {},
  currency,
  offerThumb,
  maxDiscount,
  clockEndsAt,
  service,
  fallback,
}: {
  storeSlug: string
  /** Para leer las subcategorías del panel (misma consulta, ya en caché, que la cabecera). */
  storeId: string
  departments: readonly { readonly category_id: string; readonly name: string; readonly slug: string }[]
  promotions: readonly StorePromotion[]
  promoAssets?: Record<string, string>
  currency: string
  /** La foto de la primera oferta, para el bloque de ofertas. */
  offerThumb: string | null
  maxDiscount: number
  clockEndsAt: string | null
  service: ResolvedValueProp | null
  fallback: ReactNode
}) {
  const { t } = useI18n()
  const { data: todas } = usePublicCategories(storeId)
  const hijasDe = (id: string) => (todas ?? []).filter((c) => c.parent_id === id)
  const [abierta, setAbierta] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement | null>(null)

  // Se cierra con Escape y al pulsar fuera: un panel que solo se cierra con su
  // propio botón es una trampa con el teclado.
  useEffect(() => {
    if (!abierta) return
    const fuera = (event: MouseEvent) => {
      if (!raiz.current?.contains(event.target as Node)) setAbierta(null)
    }
    const tecla = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAbierta(null)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierta])

  const familiaAbierta = departments.find((dep) => dep.category_id === abierta) ?? null

  return (
    <Box
      ref={raiz}
      data-hero-layout="universal"
      sx={{
        position: 'relative',
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: '1fr',
          lg: departments.length > 0 ? '220px minmax(0, 1fr) 260px' : 'minmax(0, 1fr) 260px',
        },
        alignItems: 'stretch',
      }}
    >
      {departments.length > 0 ? (
        <Box
          component="nav"
          aria-label={t('store.categories.title')}
          sx={{
            display: { xs: 'none', lg: 'block' },
            py: 1,
            bgcolor: 'var(--card)',
            border: '1px solid var(--sf-line)',
            borderRadius: 'var(--sf-radius)',
          }}
        >
          {departments.slice(0, 10).map((dep) => {
            const Icono = iconoDe(dep.name)
            // Con subcategorías, la familia ABRE su panel (lámina del menú);
            // sin ellas, es un enlace directo y no lleva flecha.
            const desplegable = hijasDe(dep.category_id).length > 0
            const activa = abierta === dep.category_id
            return (
              <Box
                key={dep.category_id}
                {...(desplegable
                  ? {
                      component: 'button',
                      type: 'button',
                      'aria-expanded': activa,
                      'aria-controls': activa ? 'sf-uni-flyout' : undefined,
                      onClick: () => setAbierta(activa ? null : dep.category_id),
                    }
                  : { component: Link, to: `/s/${storeSlug}?c=${encodeURIComponent(dep.slug)}` })}
                className="sf-uni-dep"
                data-active={activa || undefined}
                sx={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  px: 2,
                  py: 1,
                  border: 0,
                  bgcolor: activa ? 'var(--neutral-soft)' : 'transparent',
                  color: activa ? 'var(--accent-deep)' : 'var(--text)',
                  textDecoration: 'none',
                  textAlign: 'left',
                  font: 'inherit',
                  fontSize: 14,
                  fontWeight: activa ? 700 : 500,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'var(--neutral-soft)', color: 'var(--accent-deep)' },
                  '&:focus-visible': { outline: '2px solid var(--accent-deep)', outlineOffset: -2 },
                }}
              >
                <Icono sx={{ fontSize: 18, color: activa ? 'var(--accent-deep)' : 'var(--muted)' }} />
                <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dep.name}
                </Box>
                {desplegable ? (
                  <ChevronRightRoundedIcon
                    aria-hidden
                    sx={{ fontSize: 18, color: activa ? 'var(--accent-deep)' : 'var(--muted)' }}
                  />
                ) : null}
              </Box>
            )
          })}
        </Box>
      ) : null}

      {familiaAbierta ? (
        <PanelDeFamilia
          familia={familiaAbierta}
          hijas={hijasDe(familiaAbierta.category_id)}
          nietasDe={hijasDe}
          storeSlug={storeSlug}
        />
      ) : null}

      {promotions.length > 0 ? (
        <Banner promotions={promotions} assets={promoAssets} storeSlug={storeSlug} currency={currency} />
      ) : (
        <Box sx={{ minWidth: 0 }}>{fallback}</Box>
      )}

      <Stack sx={{ gap: 2, minWidth: 0 }}>
        <Box
          component={Link}
          to={`/s/${storeSlug}?ver=todo&oferta=1`}
          data-universal-deals
          sx={{
            position: 'relative',
            flex: 1,
            minHeight: 170,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 1,
            p: 2.25,
            overflow: 'hidden',
            borderRadius: 'var(--sf-radius)',
            bgcolor: 'var(--sf-deal)',
            color: 'var(--sf-deal-fg)',
            textDecoration: 'none',
          }}
        >
          <Typography sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {t('store.universal.deals')}
          </Typography>
          {offerThumb ? (
            <Box
              aria-hidden
              sx={{ position: 'absolute', right: 14, top: 40, width: 84, height: 84, mixBlendMode: 'multiply' }}
            >
              <ProductMedia url={offerThumb} alt="" ratio="1 / 1" fit="contain" />
            </Box>
          ) : null}
          <Box sx={{ position: 'relative' }}>
            {clockEndsAt ? (
              <Stack sx={{ gap: 0.5 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{t('store.feria.endsIn')}</Typography>
                <Box sx={{ fontSize: 20, fontWeight: 800 }}>
                  <Countdown endsAt={clockEndsAt} variant="inline" />
                </Box>
              </Stack>
            ) : maxDiscount > 0 ? (
              <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15 }}>
                {`${t('store.feria.upTo')} −${maxDiscount}%`}
              </Typography>
            ) : null}
            <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, mt: 0.75, fontSize: 13, fontWeight: 700 }}>
              {t('store.universal.seeDeals')}
              <ArrowForwardRoundedIcon aria-hidden sx={{ fontSize: 16 }} />
            </Stack>
          </Box>
        </Box>

        {service ? (
          <Box
            data-universal-service
            sx={{
              flex: 1,
              minHeight: 150,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 1,
              p: 2.25,
              borderRadius: 'var(--sf-radius)',
              bgcolor: 'color-mix(in srgb, var(--accent) 9%, var(--card))',
            }}
          >
            <Typography sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-deep)' }}>
              {service.title}
            </Typography>
            <Typography sx={{ fontSize: 17, fontWeight: 800, lineHeight: 1.25 }}>{service.body}</Typography>
          </Box>
        ) : null}
      </Stack>
    </Box>
  )
}

function fuenteDe(referencia: string | null, firmadas: Record<string, string>) {
  if (!referencia) return null
  if (/^https?:\/\//i.test(referencia)) return referencia
  return firmadas[referencia] ?? null
}

function destinoDe(promo: StorePromotion, storeSlug: string) {
  return promotionHref(promo, storeSlug)
}

/** El banner de campañas: una a la vez, con puntos para pasar. */
function Banner({
  promotions,
  assets,
  storeSlug,
  currency,
}: {
  promotions: readonly StorePromotion[]
  assets: Record<string, string>
  storeSlug: string
  currency: string
}) {
  const { t, locale } = useI18n()
  const [indice, setIndice] = useState(0)
  const promo = promotions[Math.min(indice, promotions.length - 1)]!
  const foto = fuenteDe(promo.imageUrl, assets)
  const badge = offerBadge(promo, t, locale, currency)
  const vigencia = vigenciaTexto(promo.endsAt, t, locale)
  const pastilla = [badge, vigencia?.texto].filter(Boolean).join(' · ')

  return (
    <Box
      component="section"
      aria-roledescription="carousel"
      aria-label={t('store.promos.title')}
      data-universal-banner
      sx={{
        position: 'relative',
        minHeight: { xs: 280, md: 360 },
        display: 'flex',
        alignItems: 'flex-end',
        overflow: 'hidden',
        borderRadius: 'var(--sf-radius)',
        color: '#fff',
        background: foto
          ? `linear-gradient(90deg, rgba(8,12,20,.78) 0%, rgba(8,12,20,.45) 50%, rgba(8,12,20,.1) 100%), url("${foto.replace(/"/g, '%22')}") center / cover no-repeat`
          : 'var(--sf-band)',
      }}
    >
      <Stack sx={{ position: 'relative', gap: 1.5, p: { xs: 3, md: 4.5 }, maxWidth: 560 }}>
        {pastilla ? (
          <Box
            data-universal-kicker
            sx={{
              alignSelf: 'flex-start',
              px: 1,
              py: 0.375,
              borderRadius: 1,
              bgcolor: 'var(--sf-deal)',
              color: 'var(--sf-deal-fg)',
              fontSize: 11.5,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {pastilla}
          </Box>
        ) : null}
        <Typography component="h2" sx={{ fontSize: { xs: 28, md: 40 }, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
          {promo.name}
        </Typography>
        {promo.description ? (
          <Typography sx={{ fontSize: 15, opacity: 0.88 }}>{promo.description}</Typography>
        ) : null}
        <Box
          component={Link}
          to={destinoDe(promo, storeSlug)}
          sx={{
            alignSelf: 'flex-start',
            mt: 1,
            px: 2.25,
            py: 1.125,
            borderRadius: 'var(--sf-btn-radius)',
            bgcolor: '#fff',
            color: 'var(--text)',
            fontSize: 14,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          {t('store.promos.see')}
        </Box>
      </Stack>

      {promotions.length > 1 ? (
        <Stack direction="row" sx={{ position: 'absolute', left: { xs: 24, md: 36 }, bottom: 16, gap: 0.75 }}>
          {promotions.map((p, i) => (
            <ButtonBase
              key={p.id}
              onClick={() => setIndice(i)}
              aria-label={`${i + 1} / ${promotions.length}: ${p.name}`}
              aria-current={i === indice}
              sx={{
                width: i === indice ? 22 : 8,
                height: 8,
                borderRadius: 999,
                bgcolor: i === indice ? '#fff' : 'rgba(255,255,255,.5)',
                transition: 'width .2s ease',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            />
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}

/**
 * El panel de una familia (lámina del menú, 2026-10-13).
 *
 * Se abre a la derecha de la barra lateral, ENCIMA del banner, al pulsar la
 * familia. Con subcategorías de dos niveles, una columna por subcategoría con
 * su lista y «Ver todo →» (como la lámina: Ropa · Superficies · Cocina y
 * baño); con un solo nivel, la lista de subcategorías y «Ver todo» de la
 * familia. La profundidad la decide el comercio, no este componente.
 */
function PanelDeFamilia({
  familia,
  hijas,
  nietasDe,
  storeSlug,
}: {
  familia: { readonly category_id: string; readonly name: string; readonly slug: string }
  hijas: readonly PublicCategory[]
  nietasDe: (id: string) => readonly PublicCategory[]
  storeSlug: string
}) {
  const { t } = useI18n()
  const enlace = (slug: string) => `/s/${storeSlug}?c=${encodeURIComponent(slug)}`
  const conColumnas = hijas.some((hija) => nietasDe(hija.category_id).length > 0)
  const verTodo = (slug: string, etiqueta: string) => (
    <Box
      component={Link}
      to={enlace(slug)}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        mt: 1,
        fontSize: 13,
        fontWeight: 700,
        color: 'var(--accent-deep)',
        textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {etiqueta}
      <ArrowForwardRoundedIcon aria-hidden sx={{ fontSize: 15 }} />
    </Box>
  )
  const item = (c: PublicCategory) => (
    <Box
      key={c.category_id}
      component={Link}
      to={enlace(c.slug)}
      sx={{
        display: 'block',
        py: 0.6,
        fontSize: 13.5,
        color: 'var(--muted)',
        textDecoration: 'none',
        '&:hover': { color: 'var(--accent-deep)', textDecoration: 'underline' },
      }}
    >
      {c.name}
    </Box>
  )

  return (
    <Box
      id="sf-uni-flyout"
      role="region"
      aria-label={familia.name}
      className="sf-uni-flyout"
      sx={{
        position: 'absolute',
        zIndex: 4,
        top: 0,
        bottom: 0,
        left: 'calc(220px + 16px)',
        width: conColumnas ? 'min(680px, calc(100% - 236px))' : 'min(360px, calc(100% - 236px))',
        display: { xs: 'none', lg: 'block' },
        overflowY: 'auto',
        p: 3,
        bgcolor: 'var(--card)',
        border: '1px solid var(--sf-line)',
        borderRadius: 'var(--sf-radius)',
        boxShadow: '0 18px 40px -20px rgba(16, 24, 40, .35)',
      }}
    >
      {conColumnas ? (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {hijas.map((hija) => (
            <Box key={hija.category_id}>
              <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>
                {hija.name}
              </Typography>
              {nietasDe(hija.category_id).map(item)}
              {verTodo(hija.slug, t('store.categories.seeAll'))}
            </Box>
          ))}
        </Box>
      ) : (
        <Box>
          <Typography component="h3" sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>
            {familia.name}
          </Typography>
          {hijas.map(item)}
          {verTodo(familia.slug, `${t('store.categories.seeAll')} ${familia.name}`)}
        </Box>
      )}
    </Box>
  )
}
