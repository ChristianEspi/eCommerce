import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import {
  themeCssVars,
  themeDataAttributes,
} from '@/features/storefront/theme/theme-context'
import { resolveStoreTheme } from '@/features/storefront/theme/resolve'
import type { HomeLayout, HomeSectionId, StorefrontStyle } from '@/features/storefront/theme/types'
import '@/features/storefront/storefront.css'

/**
 * Vista previa del tema, antes de guardar.
 *
 * ## Por qué esto NO es un dibujo
 *
 * La tentación evidente es maquetar cuatro miniaturas bonitas, una por tema.
 * Sería más rápido y estaría mal el mismo día que alguien cambie un valor de un
 * preset: la vista previa seguiría enseñando lo de antes, y un comercio elegiría
 * su tienda mirando algo que ya no existe.
 *
 * Así que esto consume **las mismas piezas que la vitrina**:
 *
 *  · `resolveStoreTheme` resuelve el tema exactamente igual que en producción,
 *    con los mismos valores por defecto y las mismas reservas;
 *  · `themeCssVars` y `themeDataAttributes` producen las mismas variables y los
 *    mismos atributos que cuelgan de `.sf-scope` en la tienda real;
 *  · `storefront.css` se importa tal cual, así que las reglas por tema —radios,
 *    aire, alturas, columnas— se aplican aquí por el mismo camino.
 *
 * Lo que se pinta dentro son piezas finas —una barra, una portada, una rejilla—
 * que leen esas mismas variables. No son los componentes de producción porque
 * esos necesitan carrito, sesión y consultas de catálogo, y montar todo eso en
 * una pantalla de configuración traería peticiones que aquí no pintan nada.
 * Lo que importa es que la GEOMETRÍA no se duplica: sale del motor.
 *
 * ## Y lo que no hace
 *
 * No guarda. No pide datos con más permisos de los que ya tiene la pantalla. No
 * usa productos reales: el contenido de ejemplo está rotulado como tal, porque
 * el trabajo de esta vista es enseñar la DISPOSICIÓN, no adivinar el catálogo.
 */

const MARCOS = [
  { id: 'desktop', ancho: 1280, etiqueta: 'settings.design.preview.desktop' },
  { id: 'tablet', ancho: 768, etiqueta: 'settings.design.preview.tablet' },
  { id: 'mobile', ancho: 390, etiqueta: 'settings.design.preview.mobile' },
] as const satisfies ReadonlyArray<{ id: string; ancho: number; etiqueta: MessageKey }>

type MarcoId = (typeof MARCOS)[number]['id']

const NOMBRE_SECCION: Record<HomeSectionId, MessageKey> = {
  hero: 'settings.design.section.hero',
  services: 'settings.design.section.services',
  offers: 'settings.design.section.offers',
  cms: 'settings.design.section.cms',
  promotions: 'settings.design.section.promotions',
  categories: 'settings.design.section.categories',
  brands: 'settings.design.section.brands',
  'new-arrivals': 'settings.design.section.newArrivals',
  'best-sellers': 'settings.design.section.bestSellers',
  featured: 'settings.design.section.featured',
  trust: 'settings.design.section.trust',
  'business-info': 'settings.design.section.businessInfo',
  newsletter: 'settings.design.section.newsletter',
}

/** Las que pintan una rejilla de producto, que es lo que hace visible la densidad. */
const CON_PRODUCTOS: ReadonlySet<HomeSectionId> = new Set<HomeSectionId>([
  'offers',
  'new-arrivals',
  'best-sellers',
  'featured',
])

export function StorefrontPreview({
  storeName,
  themePreset,
  style,
  layout,
}: {
  storeName: string
  themePreset: string
  style: Partial<StorefrontStyle>
  layout: HomeLayout
}) {
  const { t } = useI18n()
  const [marco, setMarco] = useState<MarcoId>('desktop')

  // El MISMO resolvedor que la vitrina. Recibe lo que hay en el formulario sin
  // guardar, que es lo que permite ver el cambio antes de decidirlo.
  const tema = resolveStoreTheme({
    theme_preset: themePreset,
    storefront_style: style,
    home_layout: layout,
  })

  const encendidas = tema.layout.sections.filter((s) => s.enabled)
  const ancho = MARCOS.find((m) => m.id === marco)?.ancho ?? 1280

  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}
      >
        <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
          {t('settings.design.preview.title')}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={marco}
          aria-label={t('settings.design.preview.viewport')}
          onChange={(_evento, valor: MarcoId | null) => {
            // `exclusive` devuelve `null` al pulsar el que ya estaba: quedarse
            // sin marco dejaría la vista previa sin ancho.
            if (valor) setMarco(valor)
          }}
        >
          {MARCOS.map((m) => (
            <ToggleButton key={m.id} value={m.id} aria-label={t(m.etiqueta)}>
              {t(m.etiqueta)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('settings.design.preview.help')}
      </Typography>

      {/* El marco se desplaza si no cabe, en vez de encoger el contenido: un
          escritorio de 1280 px comprimido a 600 no enseña la densidad real, que
          es justo lo que se viene a mirar. */}
      <Box sx={{ overflowX: 'auto', p: 1, bgcolor: 'var(--neutral-soft)', borderRadius: `${R.lg}px` }}>
        <Box
          data-testid="preview-frame"
          data-viewport={marco}
          className="sf-scope"
          {...themeDataAttributes(tema)}
          style={{ ...themeCssVars(tema), width: ancho }}
          sx={{
            maxWidth: '100%',
            bgcolor: 'var(--card)',
            borderRadius: `${R.md}px`,
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          <PreviewHeader storeName={storeName} />

          <Box sx={{ p: 'var(--sf-main-pad-md)', display: 'grid', gap: 'var(--sf-section-gap-md)' }}>
            {encendidas.length === 0 ? (
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                {t('settings.design.preview.empty')}
              </Typography>
            ) : (
              encendidas.map((seccion) =>
                seccion.id === 'hero' ? (
                  <PreviewHero key={seccion.id} storeName={storeName} />
                ) : (
                  <PreviewSection
                    key={seccion.id}
                    titulo={t(NOMBRE_SECCION[seccion.id])}
                    productos={CON_PRODUCTOS.has(seccion.id)}
                  />
                ),
              )
            )}
          </Box>
        </Box>
      </Box>
    </Stack>
  )
}

/** La barra. Su altura sale de `--sf-header-h-md`, como en la tienda. */
function PreviewHeader({ storeName }: { storeName: string }) {
  return (
    <Box
      className="sf-header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        minHeight: 'var(--sf-header-h-md)',
        borderBottom: '1px solid var(--sf-line)',
      }}
    >
      <Typography sx={{ fontWeight: 800, fontSize: 15 }}>{storeName}</Typography>
      <Box
        sx={{
          flex: 1,
          height: 26,
          mx: 2,
          borderRadius: 'var(--sf-pill)',
          bgcolor: 'var(--sf-media-bg)',
        }}
      />
      <Box sx={{ width: 26, height: 26, borderRadius: 'var(--sf-pill)', bgcolor: 'var(--sf-media-bg)' }} />
    </Box>
  )
}

/** La portada. Su alto y el cuerpo del titular salen del tema. */
function PreviewHero({ storeName }: { storeName: string }) {
  return (
    <Box
      sx={{
        minHeight: 'var(--sf-hero-min-md)',
        borderRadius: 'var(--sf-radius)',
        background: 'var(--hero-grad)',
        display: 'flex',
        alignItems: 'flex-end',
        p: 'var(--sf-hero-pad-md)',
      }}
    >
      <Typography
        sx={{
          fontSize: 'var(--sf-hero-title-md)',
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          color: '#FFFFFF',
        }}
      >
        {storeName}
      </Typography>
    </Box>
  )
}

/**
 * Una banda. Las que enseñan producto pintan una rejilla con las columnas y el
 * aire del tema — que es lo que hace visible la diferencia entre un catálogo
 * denso y una presentación editorial.
 */
function PreviewSection({ titulo, productos }: { titulo: string; productos: boolean }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography sx={{ fontSize: 'var(--sf-heading-md)', fontWeight: 800, letterSpacing: '-0.025em' }}>
        {titulo}
      </Typography>
      {productos ? (
        <Box
          sx={{
            display: 'grid',
            gap: 'var(--sf-grid-gap-md)',
            gridTemplateColumns: 'repeat(var(--sf-grid-lg, 4), minmax(0, 1fr))',
          }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <PreviewCard key={i} />
          ))}
        </Box>
      ) : (
        <Box sx={{ height: 56, borderRadius: 'var(--sf-radius-sm)', bgcolor: 'var(--sf-media-bg)' }} />
      )}
    </Stack>
  )
}

function PreviewCard() {
  return (
    <Stack
      sx={{
        gap: 'var(--sf-card-gap)',
        p: 'var(--sf-card-pad-md)',
        borderRadius: 'var(--sf-radius)',
        border: '1px solid var(--sf-line)',
        boxShadow: 'var(--sf-shadow)',
        bgcolor: 'var(--card)',
      }}
    >
      <Box
        sx={{
          aspectRatio: 'var(--sf-image-ratio)',
          borderRadius: 'var(--sf-radius-sm)',
          bgcolor: 'var(--sf-media-bg)',
        }}
      />
      <Box sx={{ height: 'var(--sf-card-title)', borderRadius: 4, bgcolor: 'var(--sf-media-bg)' }} />
      <Box
        sx={{ height: 'var(--sf-card-price)', width: '55%', borderRadius: 4, bgcolor: 'var(--sf-media-bg)' }}
      />
    </Stack>
  )
}
