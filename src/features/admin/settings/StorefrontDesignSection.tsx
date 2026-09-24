import { Alert, Box, Stack, Typography } from '@mui/material'
import type { UseFormReturn } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import {
  THEME_PRESET_IDS,
  type StorefrontStyle,
  type ThemePreset,
} from '@/features/storefront/theme/types'
import { THEME_PRESETS } from '@/features/storefront/theme/presets'
import { AdvancedStyleSettings } from './AdvancedStyleSettings'
import { themeColumnsReady } from './api'
import { HomeLayoutEditor } from './HomeLayoutEditor'
import { StoreReadiness } from './StoreReadiness'
import { StorefrontPreview } from './StorefrontPreview'
import { ThemeMiniPreview } from './ThemeMiniPreview'
import type { StoreFormValues } from './types'

/**
 * «Diseño de tienda»: el taller donde se compone la vitrina (Storefront V2 · P10).
 *
 * ## Qué era hasta P10
 *
 * Un formulario largo con la vista previa **al final**. Se elegía el tema
 * arriba, se bajaba por siete desplegables y el editor de secciones, y se
 * llegaba a la vista previa varias pantallas después — cuando ya no se veía lo
 * que se había tocado. Cambiar el tema y ver el efecto exigía subir, cambiar,
 * bajar, mirar y volver a subir.
 *
 * Eso no es un problema de estética. Configurar una tienda es un lazo de prueba
 * y error: se cambia algo, se mira, se decide. Si el lazo no cabe en una
 * pantalla, se rompe, y lo que pasa entonces es que nadie prueba nada — se elige
 * un tema a ciegas y no se vuelve.
 *
 * ## El taller
 *
 * Dos columnas en escritorio: la **configuración a la izquierda**, que se
 * desplaza, y la **vista previa a la derecha, fija**. Se toca cualquier cosa y
 * se ve al lado sin mover la pantalla. En tableta y teléfono vuelve a ser una
 * columna —una vista previa fija en 390 px de ancho no deja sitio para
 * configurar nada— y la vista previa pasa al final, que es donde estaba.
 *
 * ## Las tres decisiones, en su orden
 *
 *  1. **El tema** — una decisión, no siete. Un comercio sabe si vende por
 *     repetición o por contemplación; no sabe —ni tiene por qué— si su tienda
 *     quiere `contentWidth: xl` con `imageRatio: portrait`.
 *  2. **Los ajustes finos** — plegados y agrupados, para la excepción.
 *  3. **El orden de la portada** — qué secciones y en qué orden.
 *
 * ## Lo que NO dicen los textos de las tarjetas
 *
 * No dicen «para farmacias» ni «para moda». Los ejemplos ayudan a elegir y las
 * restricciones estorban: en cuanto un tema dice «solo moda», el comercio de
 * muebles que lo quería deja de mirarlo. Los cuatro sirven para cualquier rubro,
 * y quien decide es quien vende.
 *
 * ## Y lo que no se expone nunca
 *
 * Ni un campo libre, ni el JSON, ni nada que no esté en el contrato de P01.
 * Cada control es una lista cerrada con una opción más —la de heredar— que es
 * la que devuelve el valor al preset sin dejar un dato pisado a medias.
 */

const ETIQUETA_TEMA: Record<ThemePreset, MessageKey> = {
  universal: 'settings.design.theme.universal',
  retail: 'settings.design.theme.retail',
  premium: 'settings.design.theme.premium',
  catalog: 'settings.design.theme.catalog',
}

const AYUDA_TEMA: Record<ThemePreset, MessageKey> = {
  universal: 'settings.design.theme.universalHelp',
  retail: 'settings.design.theme.retailHelp',
  premium: 'settings.design.theme.premiumHelp',
  catalog: 'settings.design.theme.catalogHelp',
}

/**
 * El texto de cada valor del contrato, para el resumen de la tarjeta (P12).
 *
 * El resumen se arma de la DEFINICIÓN del preset, no de una frase escrita a
 * mano: el día que `retail` pase de cinco columnas a seis, la tarjeta lo dice
 * sin que nadie la toque. Una descripción redactada se queda vieja en silencio.
 */
const ETIQUETA_VALOR: Record<string, MessageKey> = {
  standard: 'settings.design.value.standard',
  compact: 'settings.design.value.compact',
  product: 'settings.design.value.product',
  statement: 'settings.design.value.statement',
  comfortable: 'settings.design.value.comfortable',
  tiles: 'settings.design.value.tiles',
  pills: 'settings.design.value.pills',
  square: 'settings.design.value.square',
  portrait: 'settings.design.value.portrait',
  landscape: 'settings.design.value.landscape',
  spacious: 'settings.design.value.spacious',
  // Storefront V3 · P02
  brand: 'settings.design.value.brand',
  editorial: 'settings.design.value.editorial',
  mosaic: 'settings.design.value.mosaic',
  cover: 'settings.design.value.cover',
  contain: 'settings.design.value.contain',
  lg: 'settings.design.value.lg',
  xl: 'settings.design.value.xl',
}

/** El valor que significa «no lo piso, lo hereda del tema». */
const HEREDAR = ''

export function StorefrontDesignSection({
  form,
  busy = false,
  storeId = null,
  storeSlug = null,
}: {
  form: UseFormReturn<StoreFormValues>
  busy?: boolean
  /**
   * La tienda, para el panel de calidad visual (Storefront V2 · P13).
   *
   * Opcionales porque esta sección se monta también sin tienda activa —una
   * cuenta recién creada— y entonces no hay nada que medir. Sin ellos el panel
   * no se pinta: un panel de calidad con siete líneas a cero no informa de
   * nada, asusta.
   */
  storeId?: string | null
  storeSlug?: string | null
}) {
  const { t } = useI18n()
  const preset = form.watch('theme_preset')
  const estilo = form.watch('storefront_style')

  /**
   * El estilo EFECTIVO: lo que el tema dice, con lo pisado encima (V3 · P12).
   *
   * El formulario guarda solo lo que el comercio apartó del tema —eso es lo que
   * permite que mejorar un tema llegue a quien no lo tocó—, así que para
   * resolver lo que `auto` significa hoy hace falta la mezcla. Es la misma que
   * hace el motor al leer la fila.
   */
  const estiloEfectivo = { ...THEME_PRESETS[preset], ...estilo }

  /**
   * La base puede ir por detrás del código.
   *
   * Entre que se publica esta pantalla y se aplica su migración hay una ventana
   * —a veces de minutos, a veces de días— en la que las tres columnas no
   * existen. Enseñar los controles ahí sería peor que no enseñarlos: alguien
   * elegiría su tema, pulsaría Guardar y no pasaría nada. Un formulario que no
   * guarda es una mentira más cara que una sección que avisa.
   */
  if (!themeColumnsReady()) {
    return (
      <Alert severity="info" icon={false}>
        {t('settings.design.unavailable')}
      </Alert>
    )
  }

  function elegirTema(nuevo: ThemePreset) {
    form.setValue('theme_preset', nuevo, { shouldDirty: true })
  }

  function pisar(clave: keyof StorefrontStyle, valor: string) {
    const siguiente = { ...estilo }
    if (valor === HEREDAR) delete siguiente[clave]
    else Object.assign(siguiente, { [clave]: valor })
    form.setValue('storefront_style', siguiente, { shouldDirty: true })
  }

  return (
    <Box
      data-testid="design-workspace"
      sx={{
        display: 'grid',
        gap: { xs: 2.5, lg: 3 },
        alignItems: 'start',
        /**
         * Dos columnas desde `lg`, y ni una antes.
         *
         * El panel de configuración necesita unos 380 px para que un desplegable
         * con «Usar tema: Comodidad» no parta el texto en dos líneas, y la vista
         * previa necesita lo que le quede. Por debajo de `lg` no hay sitio para
         * las dos: se apilan, que es como estaba y sigue funcionando.
         *
         * En pantallas muy anchas el panel crece hasta 520 px en vez de dejar
         * que se estire la vista previa hasta 1600: un marco de escritorio mide
         * 1280 px lógicos y el resto sería gris.
         */
        gridTemplateColumns: {
          xs: '1fr',
          lg: 'minmax(380px, 420px) minmax(0, 1fr)',
          xl: 'minmax(440px, 520px) minmax(0, 1fr)',
        },
      }}
    >
      <Stack
        component="section"
        aria-label={t('settings.design.workspace.config')}
        spacing={2.5}
        sx={{ minWidth: 0 }}
      >
        <Stack spacing={1}>
          <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
            {t('settings.design.theme.title')}
          </Typography>
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
            {t('settings.design.theme.help')}
          </Typography>

          {/* `radiogroup` y no cuatro botones: son cuatro opciones EXCLUYENTES, y
              un lector de pantalla necesita saber que elegir una descarta las
              otras tres. Con botones sueltos anunciaría cuatro acciones. */}
          <Box
            role="radiogroup"
            aria-label={t('settings.design.theme.title')}
            sx={{
              display: 'grid',
              gap: 1.5,
              // Dos columnas también en el panel del taller: cuatro tarjetas en
              // fila dentro de 420 px dejarían el título en tres líneas.
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            }}
          >
            {THEME_PRESET_IDS.map((id) => {
              const elegido = preset === id
              return (
                <Box
                  key={id}
                  role="radio"
                  tabIndex={0}
                  aria-checked={elegido}
                  aria-disabled={busy || undefined}
                  onClick={() => !busy && elegirTema(id)}
                  onKeyDown={(event) => {
                    if (busy) return
                    // Espacio y Enter: los dos gestos con los que se activa un
                    // control de este tipo. Solo uno deja fuera a media gente.
                    if (event.key === ' ' || event.key === 'Enter') {
                      event.preventDefault()
                      elegirTema(id)
                    }
                  }}
                  sx={{
                    cursor: busy ? 'default' : 'pointer',
                    p: 1.5,
                    borderRadius: `${R.lg}px`,
                    border: '2px solid',
                    borderColor: elegido ? 'var(--accent)' : 'var(--border)',
                    bgcolor: elegido ? 'var(--accent-soft)' : 'var(--card)',
                    opacity: busy ? 0.6 : 1,
                    '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
                  }}
                >
                  {/* La miniatura va PRIMERO: elegir un tema es una decisión
                      visual, y hasta P12 se tomaba leyendo cuatro frases. Se
                      dibuja con la definición del preset, así que no se
                      desincroniza de la tienda. */}
                  <ThemeMiniPreview preset={id} />

                  <Typography
                    sx={{
                      fontSize: TS.bodyStrong,
                      fontWeight: 800,
                      mt: 1,
                      color: elegido ? 'var(--accent-deep)' : 'var(--text)',
                    }}
                  >
                    {t(ETIQUETA_TEMA[id])}
                  </Typography>
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.5 }}>
                    {t(AYUDA_TEMA[id])}
                  </Typography>
                  {/* Y las diferencias en datos, para quien no puede ver la
                      miniatura y para quien quiere el número exacto. */}
                  <Typography
                    sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.5, fontWeight: 700 }}
                  >
                    {resumen(id, t)}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        </Stack>

        <AdvancedStyleSettings
          preset={preset}
          style={estilo}
          busy={busy}
          onChange={pisar}
          onReset={() => form.setValue('storefront_style', {}, { shouldDirty: true })}
        />

        {/* El tema efectivo baja al editor: el panel de presentación por
            sección necesita saber qué significa `auto` hoy para poder
            escribirlo en el desplegable (V3 · P12). */}
        <HomeLayoutEditor form={form} busy={busy} preset={preset} style={estiloEfectivo} />

        {storeId && storeSlug && (
          <StoreReadiness
            storeId={storeId}
            storeSlug={storeSlug}
            store={{
              logo_url: form.watch('logo_url'),
              banner_url: form.watch('banner_url'),
              support_email: form.watch('support_email'),
              contact_phone: form.watch('contact_phone'),
              contact_address: form.watch('contact_address'),
              /**
               * Identidad V3 (P11): sin estos tres, dos señales preguntarían
               * mal.
               *
               * Con `brand_lockup` en `name`, el logotipo no es un hueco — el
               * comercio eligió su nombre escrito como marca. Y la descripción
               * es una señal nueva, con la bajada del hero como respaldo de
               * compatibilidad para las tiendas anteriores a V3.
               */
              brand_lockup: form.watch('brand_lockup'),
              store_description: form.watch('store_description'),
              hero_subtitle: form.watch('hero_subtitle'),
            }}
          />
        )}
      </Stack>

      {/**
       * La vista previa, fija mientras se configura.
       *
       * `position: sticky` solo desde `lg`, que es donde hay dos columnas: en
       * una sola, fijar la vista previa la dejaría tapando el formulario.
       *
       * El `top` deja pasar la cabecera de la página y las pestañas; la altura
       * máxima descuenta eso y la barra de Guardar, que flota abajo. Sin ese
       * descuento, la vista previa se mete debajo de la barra y las últimas
       * secciones de la tienda quedan detrás de dos botones.
       *
       * Lee el formulario SIN guardar: se cambia el tema a la izquierda y se ve
       * aquí antes de decidir. La tienda pública no se entera hasta pulsar
       * Guardar.
       */}
      <Box
        component="section"
        aria-label={t('settings.design.preview.title')}
        sx={{
          minWidth: 0,
          position: { xs: 'static', lg: 'sticky' },
          top: { lg: 16 },
          maxHeight: { lg: 'calc(100vh - 120px)' },
          overflowY: { lg: 'auto' },
          // Aire a la derecha del contenido desplazable, para que la barra de
          // desplazamiento no se coma el borde del marco.
          pr: { lg: 0.5 },
        }}
      >
        <StorefrontPreview
          storeName={form.watch('name') || form.watch('business_display_name')}
          themePreset={preset}
          style={estilo}
          layout={form.watch('home_layout')}
          /**
           * La identidad del comercio, sin guardar (V3 · P13).
           *
           * Es lo que le da paridad a la cabecera: el lockup elegido, el
           * logotipo —o su ausencia, que cambia lo que se pinta— y los avisos
           * escritos. Los tres se editan en Marca y se MIRAN aquí, que es la
           * división que P12 dejó escrita.
           */
          identity={{
            logoUrl: form.watch('logo_url'),
            brandLockup: form.watch('brand_lockup'),
            announcements: form.watch('announcement_messages'),
          }}
        />
      </Box>
    </Box>
  )
}

/**
 * Las diferencias del tema, en una línea y sacadas de su definición.
 *
 * Columnas, tarjeta y portada: las tres que de verdad cambian cómo se ve una
 * tienda. Salen de `THEME_PRESETS`, así que cambiar un preset cambia esta línea.
 */
function resumen(preset: ThemePreset, t: (key: MessageKey) => string): string {
  const d = THEME_PRESETS[preset]
  return [
    t('settings.design.theme.columns').replace('{n}', String(d.gridColumns.lg)),
    t(ETIQUETA_VALOR[d.productCardVariant] ?? 'settings.design.style.inherit'),
    t(ETIQUETA_VALOR[d.heroVariant] ?? 'settings.design.style.inherit'),
  ].join(' · ')
}
