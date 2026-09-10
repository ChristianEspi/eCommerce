import { Box, Stack, Typography } from '@mui/material'
import { useT } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'
import type { PublicStore } from '../types'

/**
 * Banner de portada, configurable por el tenant desde `store_settings`.
 *
 * Los tres campos son opcionales y cada uno tiene su fallback:
 *   · sin `banner_url` → degradado de tokens (`--hero-grad`), que ya lleva el
 *     acento del tenant; nunca una foto de archivo ni una marca ajena.
 *   · sin `hero_title` → el nombre de la tienda.
 *   · sin `hero_subtitle` → una frase neutra de suite.
 *
 * El peso visual lo dan capas de color y tipografía, NO colores nuevos: el
 * acento sigue siendo 100 % del tenant (contrato §4.4). Sobre el degradado se
 * superpone un halo radial con el mismo acento y una viñeta inferior; sobre una
 * foto, un degradado vertical en vez de un velo plano, que oscurece donde está
 * el texto y deja respirar la parte alta de la imagen.
 *
 * Sin animación de entrada: es lo primero que se ve y un fundido solo retrasa
 * la lectura (y molesta con `prefers-reduced-motion`).
 */
export function StoreHero({ store }: { store: PublicStore }) {
  const t = useT()
  const title = store.hero_title?.trim() || store.name
  const subtitle = store.hero_subtitle?.trim() || t('store.hero.fallbackSubtitle')
  const hasImage = Boolean(store.banner_url)

  return (
    <Box
      component="section"
      aria-label={title}
      sx={{
        position: 'relative',
        borderRadius: 'var(--sf-radius)',
        overflow: 'hidden',
        background: hasImage ? 'var(--neutral-soft)' : 'var(--hero-grad)',
        minHeight: { xs: 'var(--sf-hero-min)', md: 'var(--sf-hero-min-md)' },
        display: 'flex',
        boxShadow: 'var(--sf-shadow)',
      }}
    >
      {hasImage ? (
        <>
          <Box
            component="img"
            src={store.banner_url ?? undefined}
            alt=""
            aria-hidden
            // Lo primero que se ve de la portada, y por tanto el candidato a
            // LCP: se pide con prioridad alta y sin `lazy`. Las miniaturas del
            // catálogo, que van debajo, sí son perezosas.
            loading="eager"
            fetchPriority="high"
            decoding="async"
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          {/* Degradado vertical en vez de velo plano: garantiza el contraste AA
              donde va el texto sin apagar la foto entera. No controlamos qué
              imagen sube el tenant, así que el suelo es opaco de verdad. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.78) 100%)',
            }}
          />
        </>
      ) : (
        /* Halo del acento del tenant sobre el degradado de suite. Da profundidad
           sin introducir un solo color que no sea suyo. */
        <>
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(120% 90% at 85% 15%, color-mix(in srgb, var(--accent) 55%, transparent) 0%, transparent 60%)',
              mixBlendMode: 'screen',
              opacity: 0.85,
            }}
          />
          {/* Texto blanco tambien sin foto: negro sobre el verde del degradado
              era el peor contraste de la portada. El velo garantiza el suelo
              con cualquier acento del tenant. */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(6,20,16,0.25) 0%, rgba(6,20,16,0.55) 60%, rgba(6,20,16,0.72) 100%)',
            }}
          />
        </>
      )}

      <Stack
        sx={{
          position: 'relative',
          justifyContent: 'flex-end',
          gap: 1.25,
          p: { xs: 'var(--sf-hero-pad)', md: 'var(--sf-hero-pad-md)' },
          maxWidth: 680,
          color: '#FFFFFF',
        }}
      >
        <Typography
          sx={{
            fontSize: TS.label,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            opacity: 0.75,
          }}
        >
          {store.name}
        </Typography>
        <Typography
          component="h1"
          sx={{
            // Escala fluida: llena la portada en escritorio sin desbordar en
            // móvil, que es donde compra el canal B2C.
            fontSize: { xs: 'var(--sf-hero-title)', md: 'var(--sf-hero-title-md)' },
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            textWrap: 'balance',
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            fontSize: { xs: TS.bodyStrong, md: 17 },
            lineHeight: 1.55,
            maxWidth: 560,
            opacity: 0.92,
          }}
        >
          {subtitle}
        </Typography>
      </Stack>
    </Box>
  )
}
