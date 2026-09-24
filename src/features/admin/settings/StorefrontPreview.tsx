import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import { themeCssVars, themeDataAttributes } from '@/features/storefront/theme/theme-context'
import {
  PREVIEW_VIEWPORTS,
  frameBreakpoint,
  frameCssVars,
  previewWidth,
  type PreviewViewportId,
} from '@/features/storefront/theme/preview-frame'
import { resolveStoreTheme, type ResolvedStoreTheme } from '@/features/storefront/theme/resolve'
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
 * ## El responsive, que hasta P11 era mentira
 *
 * Cambiar el ancho de una caja a 390 px no hace que las media queries
 * reaccionen: una media query mide la VENTANA, no la caja. Así que el «móvil»
 * se pintaba dentro de una ventana de escritorio y todos los valores elegidos
 * eran los de escritorio. Y la vista previa lo empeoraba a mano, usando
 * `--sf-main-pad-md`, `--sf-hero-title-md` y `--sf-grid-lg` **fijos**: el móvil
 * enseñaba el titular de 52 px y las cuatro columnas del escritorio, estrujados.
 *
 * Desde P11 cada marco resuelve sus propios puntos de corte con `--sfp-*` (ver
 * `theme/preview-frame.ts`), así que tres marcos distintos pueden convivir en la
 * misma pantalla resolviendo tres juegos de valores a la vez. Sin `@media`, sin
 * `iframe` y sin duplicar una sola medida.
 *
 * ## Y lo que no hace
 *
 * No guarda. No pide datos con más permisos de los que ya tiene la pantalla. No
 * toca la tienda real ni su caché: es una función del formulario a píxeles. No
 * usa productos reales: el contenido de ejemplo está rotulado como tal, porque
 * el trabajo de esta vista es enseñar la DISPOSICIÓN, no adivinar el catálogo.
 */

const ETIQUETA_MARCO: Record<PreviewViewportId, MessageKey> = {
  desktop: 'settings.design.preview.desktop',
  tablet: 'settings.design.preview.tablet',
  mobile: 'settings.design.preview.mobile',
}

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

type Modo = 'focus' | 'compare'

/** Lo que ocupa la comparación: el marco más ancho manda sobre el conjunto. */
const ANCHO_COMPARAR = Math.max(
  previewWidth('desktop'),
  previewWidth('tablet') + previewWidth('mobile') + 16,
)

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
  const [modo, setModo] = useState<Modo>('focus')
  const [marco, setMarco] = useState<PreviewViewportId>('desktop')
  const [ajustar, setAjustar] = useState(true)

  // El MISMO resolvedor que la vitrina. Recibe lo que hay en el formulario sin
  // guardar, que es lo que permite ver el cambio antes de decidirlo.
  const tema = resolveStoreTheme({
    theme_preset: themePreset,
    storefront_style: style,
    home_layout: layout,
  })

  const lienzo = useRef<HTMLDivElement>(null)
  const disponible = useAnchoDisponible(lienzo)

  const necesario = modo === 'compare' ? ANCHO_COMPARAR : previewWidth(marco)
  const escala = factorDeAjuste(ajustar, disponible, necesario)

  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
      >
        <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
          {t('settings.design.preview.title')}
        </Typography>

        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {/**
           * Enfoque o Comparar (Storefront V2 · P11).
           *
           * Son dos preguntas distintas y por eso son dos controles. «¿Cómo se
           * ve en el teléfono?» se responde mirando UN marco grande; «¿se ve
           * bien en los tres?» se responde viéndolos a la vez. Un solo selector
           * de cuatro posiciones —escritorio, tableta, móvil, todos— mezclaba
           * el tamaño con la forma de mirar.
           */}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={modo}
            aria-label={t('settings.design.preview.mode')}
            onChange={(_evento, valor: Modo | null) => {
              if (valor) setModo(valor)
            }}
          >
            <ToggleButton value="focus">{t('settings.design.preview.focus')}</ToggleButton>
            <ToggleButton value="compare">{t('settings.design.preview.compare')}</ToggleButton>
          </ToggleButtonGroup>

          {/* En comparación no hay nada que elegir: están los tres. */}
          {modo === 'focus' && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={marco}
              aria-label={t('settings.design.preview.viewport')}
              onChange={(_evento, valor: PreviewViewportId | null) => {
                // `exclusive` devuelve `null` al pulsar el que ya estaba:
                // quedarse sin marco dejaría la vista previa sin ancho.
                if (valor) setMarco(valor)
              }}
            >
              {PREVIEW_VIEWPORTS.map((v) => (
                <ToggleButton
                  key={v.id}
                  value={v.id}
                  aria-label={t(ETIQUETA_MARCO[v.id as PreviewViewportId])}
                >
                  {t(ETIQUETA_MARCO[v.id as PreviewViewportId])}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}

          {/**
           * Ajustar al ancho.
           *
           * `zoom` y no `transform: scale`: `zoom` participa en la maquetación,
           * así que el hueco que deja el marco encoge con él. Con `scale`, la
           * caja seguiría midiendo 1280 px de alto y dejaría un desierto debajo.
           *
           * Y nunca agranda (`min(1, …)`): un móvil de 390 px estirado a 900 no
           * es una vista previa, es una mentira cómoda.
           */}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={ajustar ? 'fit' : 'real'}
            aria-label={t('settings.design.preview.zoom')}
            onChange={(_evento, valor: string | null) => {
              if (valor) setAjustar(valor === 'fit')
            }}
          >
            <ToggleButton value="fit">{t('settings.design.preview.fit')}</ToggleButton>
            <ToggleButton value="real">{t('settings.design.preview.actual')}</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {t('settings.design.preview.help')}
      </Typography>

      {/**
       * El lienzo.
       *
       * El marco se desplaza si no cabe y no se ha pedido ajustar, en vez de
       * encogerse por su cuenta: un escritorio de 1280 px comprimido a 600 no
       * enseña la densidad real, que es justo lo que se viene a mirar.
       *
       * Y va CENTRADO (Storefront V2 · P10). Antes se pegaba a la izquierda, así
       * que en un monitor ancho el teléfono de 390 px dejaba un kilómetro de
       * gris a la derecha y parecía que la vista previa estaba rota.
       *
       * `safe center` y no `center` a secas: cuando el marco NO cabe, centrar
       * recorta por la izquierda y el principio de la tienda se vuelve
       * inalcanzable con la barra de desplazamiento. `safe` vuelve a alinear al
       * inicio justo en ese caso. El `center` de fuera es la reserva para quien
       * no lo entienda.
       */}
      <Box
        ref={lienzo}
        data-testid="preview-canvas"
        data-preview-mode={modo}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          '@supports (justify-content: safe center)': { justifyContent: 'safe center' },
          overflowX: 'auto',
          p: 1,
          bgcolor: 'var(--neutral-soft)',
          borderRadius: `${R.lg}px`,
        }}
      >
        <Box
          sx={{
            // El zoom se aplica a la BANDEJA y no a cada marco: en comparación,
            // los tres tienen que encoger lo mismo o dejarían de ser
            // comparables entre sí.
            zoom: escala,
            flex: '0 0 auto',
            display: 'grid',
            gap: 2,
            justifyItems: 'center',
          }}
        >
          {modo === 'focus' ? (
            <MarcoDeVistaPrevia
              viewport={marco}
              tema={tema}
              storeName={storeName}
              escala={escala}
            />
          ) : (
            <Comparacion tema={tema} storeName={storeName} escala={escala} />
          )}
        </Box>
      </Box>
    </Stack>
  )
}

/**
 * Los tres a la vez.
 *
 * El escritorio arriba, ocupando la fila entera, y tableta y móvil debajo, uno
 * al lado del otro. No es una elección estética: 1280 + 768 + 390 son 2438 px y
 * no caben en fila ni en un monitor de 27 pulgadas, mientras que 768 + 390 sí
 * caben en la mitad de abajo del mismo sitio que ocupa el escritorio.
 *
 * Y así la comparación que de verdad se hace —¿se ve bien en tableta Y en
 * móvil?— queda con los dos marcos pegados, que es como se comparan dos cosas.
 */
function Comparacion({
  tema,
  storeName,
  escala,
}: {
  tema: ResolvedStoreTheme
  storeName: string
  escala: number
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: `${previewWidth('tablet')}px ${previewWidth('mobile')}px`,
        gridTemplateAreas: `"desktop desktop" "tablet mobile"`,
        justifyContent: 'center',
      }}
    >
      <Box sx={{ gridArea: 'desktop', justifySelf: 'center' }}>
        <MarcoDeVistaPrevia viewport="desktop" tema={tema} storeName={storeName} escala={escala} />
      </Box>
      <Box sx={{ gridArea: 'tablet' }}>
        <MarcoDeVistaPrevia viewport="tablet" tema={tema} storeName={storeName} escala={escala} />
      </Box>
      <Box sx={{ gridArea: 'mobile' }}>
        <MarcoDeVistaPrevia viewport="mobile" tema={tema} storeName={storeName} escala={escala} />
      </Box>
    </Box>
  )
}

/**
 * Un dispositivo.
 *
 * Lleva su ancho lógico ESCRITO debajo, y el porcentaje al que se está viendo
 * cuando no se ve a tamaño real. Sin eso, ajustar al ancho convertiría la vista
 * previa en «algo pequeño»: quien mira tiene que saber que está viendo 1280 px
 * al 62 %, no una tienda que cabe en 800.
 */
function MarcoDeVistaPrevia({
  viewport,
  tema,
  storeName,
  escala,
}: {
  viewport: PreviewViewportId
  tema: ResolvedStoreTheme
  storeName: string
  escala: number
}) {
  const { t } = useI18n()
  const ancho = previewWidth(viewport)
  const encendidas = tema.layout.sections.filter((s) => s.enabled)

  return (
    <Stack sx={{ gap: 0.5, minWidth: 0 }}>
      <Box
        data-testid="preview-frame"
        data-viewport={viewport}
        // El escalón que le toca POR SU ANCHO, no por el de la ventana. Es lo
        // que permite comprobar desde una prueba que el móvil resuelve como
        // móvil aunque la ventana sea de escritorio.
        data-preview-bp={frameBreakpoint(ancho)}
        className="sf-scope"
        {...themeDataAttributes(tema)}
        style={{ ...themeCssVars(tema), ...frameCssVars(ancho), width: ancho }}
        sx={{
          // Sin encoger: dentro de un contenedor flexible, un marco de 1280 px
          // se comprimiría a lo que quedara libre y la densidad que se viene a
          // mirar sería la de otra tienda. Encoger, cuando toca, es cosa del
          // zoom del lienzo, que encoge TODO por igual y lo dice.
          flex: '0 0 auto',
          bgcolor: 'var(--card)',
          borderRadius: `${R.md}px`,
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <PreviewHeader storeName={storeName} />

        <Box sx={{ p: 'var(--sfp-main-pad)', display: 'grid', gap: 'var(--sfp-section-gap)' }}>
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

      <Typography
        data-testid="preview-label"
        sx={{ fontSize: TS.label, color: 'var(--muted)', textAlign: 'center' }}
      >
        {escala < 1
          ? t('settings.design.preview.scaled')
              .replace('{device}', t(ETIQUETA_MARCO[viewport]))
              .replace('{w}', String(ancho))
              .replace('{pct}', String(Math.round(escala * 100)))
          : t('settings.design.preview.size')
              .replace('{device}', t(ETIQUETA_MARCO[viewport]))
              .replace('{w}', String(ancho))}
      </Typography>
    </Stack>
  )
}

/**
 * Cuánto mide el lienzo, para saber si el marco cabe.
 *
 * Con `ResizeObserver` cuando lo hay, y con el `resize` de la ventana cuando no
 * —el panel cambia de ancho al cambiar la ventana, así que cubre el caso real—.
 * Devuelve `null` mientras no se haya podido medir, y entonces no se ajusta
 * nada: encoger a un factor inventado sería peor que no encoger.
 */
function useAnchoDisponible(ref: RefObject<HTMLDivElement | null>): number | null {
  const [ancho, setAncho] = useState<number | null>(null)

  useEffect(() => {
    const nodo = ref.current
    if (!nodo) return

    const medir = () => setAncho(nodo.clientWidth > 0 ? nodo.clientWidth : null)
    medir()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', medir)
      return () => window.removeEventListener('resize', medir)
    }

    const observador = new ResizeObserver(medir)
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [ref])

  return ancho
}

/** Nunca agranda, y sin medida no toca nada. El aire del lienzo son 16 px. */
function factorDeAjuste(
  ajustar: boolean,
  disponible: number | null,
  necesario: number,
): number {
  if (!ajustar || disponible === null || necesario <= 0) return 1
  return Math.min(1, Math.max(0.25, (disponible - 16) / necesario))
}

/** La barra. Su altura sale del marco, como en la tienda de su ancho. */
function PreviewHeader({ storeName }: { storeName: string }) {
  return (
    <Box
      className="sf-header"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        minHeight: 'var(--sfp-header-h)',
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
      <Box
        sx={{ width: 26, height: 26, borderRadius: 'var(--sf-pill)', bgcolor: 'var(--sf-media-bg)' }}
      />
    </Box>
  )
}

/** La portada. Su alto y el cuerpo del titular salen del tema y del marco. */
function PreviewHero({ storeName }: { storeName: string }) {
  return (
    <Box
      sx={{
        minHeight: 'var(--sfp-hero-min)',
        borderRadius: 'var(--sf-radius)',
        background: 'var(--hero-grad)',
        display: 'flex',
        alignItems: 'flex-end',
        p: 'var(--sfp-hero-pad)',
      }}
    >
      <Typography
        sx={{
          fontSize: 'var(--sfp-hero-title)',
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
 * aire que le tocan AL MARCO — que es lo que hace visible la diferencia entre
 * un catálogo denso en escritorio y el mismo catálogo en un teléfono.
 */
function PreviewSection({ titulo, productos }: { titulo: string; productos: boolean }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography
        sx={{ fontSize: 'var(--sfp-heading)', fontWeight: 800, letterSpacing: '-0.025em' }}
      >
        {titulo}
      </Typography>
      {productos ? (
        <Box
          data-testid="preview-grid"
          sx={{
            display: 'grid',
            gap: 'var(--sfp-grid-gap)',
            gridTemplateColumns: 'repeat(var(--sfp-grid-cols), minmax(0, 1fr))',
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
        p: 'var(--sfp-card-pad)',
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
        sx={{
          height: 'var(--sf-card-price)',
          width: '55%',
          borderRadius: 4,
          bgcolor: 'var(--sf-media-bg)',
        }}
      />
    </Stack>
  )
}
