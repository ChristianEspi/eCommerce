import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { UseFormReturn } from 'react-hook-form'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import {
  CATEGORY_VARIANTS,
  CONTENT_WIDTHS,
  HEADER_VARIANTS,
  HERO_VARIANTS,
  IMAGE_RATIOS,
  PRODUCT_CARD_VARIANTS,
  SECTION_SPACINGS,
  THEME_PRESET_IDS,
  type StorefrontStyle,
  type ThemePreset,
} from '@/features/storefront/theme/types'
import { themeColumnsReady } from './api'
import { HomeLayoutEditor } from './HomeLayoutEditor'
import { StorefrontPreview } from './StorefrontPreview'
import type { StoreFormValues } from './types'

/**
 * «Diseño de tienda»: el tema de la vitrina y lo que se le puede pisar.
 *
 * ## Por qué son cuatro tarjetas y no una lista de opciones sueltas
 *
 * Porque lo que se elige aquí es una DECISIÓN, no siete. Un comercio sabe si
 * vende por repetición o por contemplación; no sabe —ni tiene por qué— si su
 * tienda quiere `contentWidth: xl` con `imageRatio: portrait`. El tema resuelve
 * las siete de golpe con una combinación que se sostiene, y los ajustes de
 * abajo existen para la excepción, no para el caso normal.
 *
 * ## Lo que NO dicen los textos de las tarjetas
 *
 * No dicen «para farmacias» ni «para moda». Los ejemplos ayudan a elegir y las
 * restricciones estorban: en cuanto un tema dice «solo moda», el comercio de
 * muebles que lo quería deja de mirarlo. Los cuatro sirven para cualquier
 * rubro, y quien decide es quien vende.
 *
 * ## Y lo que no se expone nunca
 *
 * Ni un campo libre, ni el JSON, ni nada que no esté en el contrato de P01.
 * Cada control es una lista cerrada con una opción más —«heredar del tema»—
 * que es la que devuelve el valor al preset sin dejar un dato pisado a medias.
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
 * Los siete ajustes, con su lista y su etiqueta.
 *
 * La lista sale del contrato (`theme/types.ts`), no de una copia: añadir un
 * valor allí lo hace aparecer aquí, y eso es lo que impide que el formulario se
 * quede ofreciendo seis opciones cuando ya hay siete.
 */
const AJUSTES = [
  { clave: 'headerVariant', valores: HEADER_VARIANTS, etiqueta: 'settings.design.field.header' },
  { clave: 'heroVariant', valores: HERO_VARIANTS, etiqueta: 'settings.design.field.hero' },
  { clave: 'productCardVariant', valores: PRODUCT_CARD_VARIANTS, etiqueta: 'settings.design.field.card' },
  { clave: 'categoryVariant', valores: CATEGORY_VARIANTS, etiqueta: 'settings.design.field.categories' },
  { clave: 'contentWidth', valores: CONTENT_WIDTHS, etiqueta: 'settings.design.field.width' },
  { clave: 'imageRatio', valores: IMAGE_RATIOS, etiqueta: 'settings.design.field.ratio' },
  { clave: 'sectionSpacing', valores: SECTION_SPACINGS, etiqueta: 'settings.design.field.spacing' },
] as const satisfies ReadonlyArray<{
  clave: keyof StorefrontStyle
  valores: readonly string[]
  etiqueta: MessageKey
}>

/** Cada valor de cada lista tiene su texto. Se nombran todos, sin plantillas. */
const ETIQUETA_VALOR: Record<string, MessageKey> = {
  standard: 'settings.design.value.standard',
  compact: 'settings.design.value.compact',
  product: 'settings.design.value.product',
  statement: 'settings.design.value.statement',
  comfortable: 'settings.design.value.comfortable',
  tiles: 'settings.design.value.tiles',
  pills: 'settings.design.value.pills',
  lg: 'settings.design.value.lg',
  xl: 'settings.design.value.xl',
  square: 'settings.design.value.square',
  portrait: 'settings.design.value.portrait',
  landscape: 'settings.design.value.landscape',
  spacious: 'settings.design.value.spacious',
}

/** El valor que significa «no lo piso, lo hereda del tema». */
const HEREDAR = ''

export function StorefrontDesignSection({
  form,
  busy = false,
}: {
  form: UseFormReturn<StoreFormValues>
  busy?: boolean
}) {
  const { t } = useI18n()
  const preset = form.watch('theme_preset')
  const estilo = form.watch('storefront_style')

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

  const pisados = Object.keys(estilo ?? {}).length

  return (
    <Stack spacing={2.5}>
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
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
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
                  p: 2,
                  borderRadius: `${R.lg}px`,
                  border: '2px solid',
                  borderColor: elegido ? 'var(--accent)' : 'var(--border)',
                  bgcolor: elegido ? 'var(--accent-soft)' : 'var(--card)',
                  opacity: busy ? 0.6 : 1,
                  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
                }}
              >
                <Typography
                  sx={{
                    fontSize: TS.bodyStrong,
                    fontWeight: 800,
                    color: elegido ? 'var(--accent-deep)' : 'var(--text)',
                  }}
                >
                  {t(ETIQUETA_TEMA[id])}
                </Typography>
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mt: 0.5 }}>
                  {t(AYUDA_TEMA[id])}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Stack>

      <Stack spacing={1}>
        <Stack
          direction="row"
          sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}
        >
          <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
            {t('settings.design.style.title')}
          </Typography>
          <Button
            type="button"
            size="small"
            disabled={busy || pisados === 0}
            onClick={() => form.setValue('storefront_style', {}, { shouldDirty: true })}
          >
            {t('settings.design.style.reset')}
          </Button>
        </Stack>
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
          {t('settings.design.style.help')}
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
          }}
        >
          {AJUSTES.map((ajuste) => (
            <TextField
              key={ajuste.clave}
              select
              fullWidth
              size="small"
              label={t(ajuste.etiqueta)}
              disabled={busy}
              value={estilo?.[ajuste.clave] ?? HEREDAR}
              onChange={(event) => pisar(ajuste.clave, event.target.value)}
            >
              <MenuItem value={HEREDAR}>{t('settings.design.style.inherit')}</MenuItem>
              {ajuste.valores.map((valor) => (
                <MenuItem key={valor} value={valor}>
                  {t(ETIQUETA_VALOR[valor] ?? 'settings.design.style.inherit')}
                </MenuItem>
              ))}
            </TextField>
          ))}
        </Box>
      </Stack>

      <HomeLayoutEditor form={form} busy={busy} />

      {/* La vista previa va al final y lee el formulario SIN guardar: se cambia
          el tema arriba y se ve aquí antes de decidir. La tienda pública no se
          entera hasta pulsar Guardar. */}
      <StorefrontPreview
        storeName={form.watch('name') || form.watch('business_display_name')}
        themePreset={preset}
        style={estilo}
        layout={form.watch('home_layout')}
      />
    </Stack>
  )
}
