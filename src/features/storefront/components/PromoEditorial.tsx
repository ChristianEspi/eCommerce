import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import { offerBadge, vigenciaTexto } from '../offer'
import { promotionHref, type StorePromotion } from '../promotions'
import { PromoBackgroundVideo } from './PromoBackgroundVideo'

/**
 * Las campañas como BANNER EDITORIAL (tema Premium · lámina 33 del diseño).
 *
 * Premium vende por contemplación, y el carrusel de siempre —una caja con un
 * icono de etiqueta y 900 px de tarjeta en blanco al lado— se leía como un
 * aviso, no como una campaña. Aquí la campaña ocupa el ancho entero y tiene
 * dos formas, según lo que el comercio haya subido:
 *
 *  · **Con foto:** el texto sobre el acento profundo a la izquierda y la foto a
 *    sangre a la derecha. La cifra del descuento va grande y ligera.
 *  · **Sin foto:** fondo suave del acento y la cifra hace de imagen. Nunca una
 *    caja vacía con un icono.
 *
 * Con varias campañas se pasa a mano con «02 / 03», una barra de avance y dos
 * flechas. No avanza sola: en una portada que se mira despacio, que el texto
 * cambie mientras se lee es justo lo que no se quiere.
 *
 * El COLOR es el de la tienda (`--accent-deep`, `--accent-soft`): el tema solo
 * pone la forma.
 */
export function PromoEditorial({
  promotions,
  storeSlug,
  currency,
  assets = {},
}: {
  promotions: readonly StorePromotion[]
  storeSlug: string
  currency: string
  assets?: Record<string, string>
}) {
  const { t, locale } = useI18n()
  const [actual, setActual] = useState(0)
  const total = promotions.length

  // Si el comercio retira campañas con la pestaña abierta, el índice puede
  // quedar apuntando a una que ya no existe.
  useEffect(() => {
    if (actual >= total) setActual(0)
  }, [actual, total])

  const promo = promotions[actual] ?? promotions[0]
  if (!promo) return null

  const badge = offerBadge(promo, t, locale, currency)
  const vigencia = vigenciaTexto(promo.endsAt, t, locale)
  const imagen = fuenteDe(promo.imageUrl, assets)
  const conFoto = imagen !== null
  const destino = promotionHref(promo, storeSlug)
  const ir = (paso: number) => setActual((i) => (((i + paso) % total) + total) % total)
  const dos = (n: number) => String(n).padStart(2, '0')

  // Sobre el acento profundo el texto va en blanco; sobre el suave, en tinta.
  const tinta = conFoto ? '#fff' : 'var(--text)'
  const tintaSuave = conFoto ? 'rgba(255,255,255,.82)' : 'var(--muted)'

  return (
    <Box
      component="section"
      id="ofertas"
      aria-roledescription={total > 1 ? 'carousel' : undefined}
      aria-label={t('store.promos.title')}
      data-promotions-presentation="editorial"
      data-promo-photo={conFoto ? 'yes' : 'no'}
      sx={{
        scrollMarginTop: 96,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: conFoto ? 'minmax(0, 7fr) minmax(0, 5fr)' : '1fr' },
        borderRadius: 'var(--sf-radius)',
        overflow: 'hidden',
        // Rediseño v3 · franja en tinta / superficie neutra, no un bloque del acento.
        bgcolor: conFoto ? 'var(--sf-band, var(--accent-deep))' : 'var(--sf-soft, var(--accent-soft))',
        color: tinta,
        minHeight: { md: conFoto ? 420 : 220 },
      }}
    >
      {conFoto ? (
        // 2026-10-04 · Un marco para la foto y, si lo hay, el video encima.
        <Box
          sx={{
            order: { xs: 0, md: 1 },
            position: 'relative',
            overflow: 'hidden',
            height: { xs: 220, md: '100%' },
          }}
        >
          <Box
            component="img"
            src={imagen}
            alt=""
            loading="lazy"
            decoding="async"
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {promo.videoUrl ? <PromoBackgroundVideo path={promo.videoUrl} /> : null}
        </Box>
      ) : null}

      <Stack
        sx={{
          order: { xs: 1, md: 0 },
          justifyContent: 'space-between',
          gap: { xs: 3, md: 4 },
          p: { xs: 3, md: conFoto ? 6 : 5 },
          minWidth: 0,
        }}
      >
        <Stack
          direction={{ xs: 'column', md: conFoto ? 'column' : 'row' }}
          sx={{ gap: { xs: 1.5, md: conFoto ? 1.75 : 4 }, alignItems: { md: conFoto ? 'flex-start' : 'center' } }}
        >
          <Stack sx={{ gap: 1.25, flex: 1, minWidth: 0 }}>
            {vigencia ? (
              <Typography
                sx={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: conFoto ? 'var(--accent-soft)' : 'var(--accent-deep)',
                }}
              >
                {vigencia.texto}
              </Typography>
            ) : null}
            {conFoto && badge ? <Cifra valor={badge} /> : null}
            <Typography
              component="h2"
              sx={{ fontSize: { xs: 22, md: conFoto ? 30 : 28 }, fontWeight: 500, lineHeight: 1.2, letterSpacing: '-0.01em' }}
            >
              {promo.name}
            </Typography>
            {promo.description ? (
              <Typography sx={{ fontSize: { xs: 14, md: 16 }, color: tintaSuave, maxWidth: '52ch' }}>
                {promo.description}
              </Typography>
            ) : null}
          </Stack>
          {/* Sin foto, la cifra ocupa el sitio de la imagen. */}
          {!conFoto && badge ? <Cifra valor={badge} acento /> : null}
        </Stack>

        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}
        >
          <Box
            component={Link}
            to={destino}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 2.75,
              py: 1.5,
              borderRadius: 'var(--sf-pill)',
              bgcolor: conFoto ? '#fff' : 'var(--accent-deep)',
              color: conFoto ? 'var(--accent-deep)' : '#fff',
              fontWeight: 600,
              fontSize: 15,
              textDecoration: 'none',
              '&:focus-visible': { outline: `2px solid ${conFoto ? '#fff' : 'var(--accent)'}`, outlineOffset: 3 },
            }}
          >
            {t('store.promos.see')}
            <ArrowForwardRoundedIcon aria-hidden sx={{ fontSize: 18 }} />
          </Box>

          {total > 1 ? (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
              <Typography className="tnum" aria-live="polite" sx={{ fontSize: 15, fontWeight: 600 }}>
                {`${dos(actual + 1)} / ${dos(total)}`}
              </Typography>
              <Box
                aria-hidden
                sx={{
                  width: { xs: 64, md: 120 },
                  height: 2,
                  bgcolor: conFoto ? 'rgba(255,255,255,.28)' : 'color-mix(in srgb, var(--accent-deep) 22%, transparent)',
                }}
              >
                <Box
                  sx={{
                    height: '100%',
                    width: `${((actual + 1) / total) * 100}%`,
                    bgcolor: conFoto ? '#fff' : 'var(--accent-deep)',
                    transition: 'width .3s ease',
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  }}
                />
              </Box>
              {[
                { paso: -1, label: t('store.promos.prev'), icon: <ArrowBackRoundedIcon fontSize="small" /> },
                { paso: 1, label: t('store.promos.next'), icon: <ArrowForwardRoundedIcon fontSize="small" /> },
              ].map((b) => (
                <IconButton
                  key={b.paso}
                  aria-label={b.label}
                  onClick={() => ir(b.paso)}
                  sx={{
                    width: 38,
                    height: 38,
                    color: 'inherit',
                    border: '1px solid',
                    borderColor: conFoto ? 'rgba(255,255,255,.45)' : 'color-mix(in srgb, var(--accent-deep) 35%, transparent)',
                  }}
                >
                  {b.icon}
                </IconButton>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Stack>
    </Box>
  )
}

/** La cifra del descuento, grande y ligera: «3 × 2», «−10 %». */
function Cifra({ valor, acento = false }: { valor: string; acento?: boolean }) {
  return (
    <Typography
      aria-hidden
      className="tnum"
      sx={{
        fontSize: { xs: 56, md: acento ? 96 : 104 },
        fontWeight: 300,
        lineHeight: 0.95,
        letterSpacing: '-0.03em',
        // Texto: `accent-deep`, nunca el acento puro (contraste AA).
        color: acento ? 'var(--accent-deep)' : 'inherit',
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {valor}
    </Typography>
  )
}

/** Una ruta del bucket solo sirve firmada; mientras no llega la firma, `null`. */
function fuenteDe(referencia: string | null, firmadas: Record<string, string>) {
  if (!referencia) return null
  if (/^https?:\/\//i.test(referencia)) return referencia
  return firmadas[referencia] ?? null
}
