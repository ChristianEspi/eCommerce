import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { R, TS } from '@/theme/tokens'
import { THEME_PRESETS } from '@/features/storefront/theme/presets'
import {
  CATEGORY_VARIANTS,
  CONTENT_WIDTHS,
  HEADER_VARIANTS,
  HERO_VARIANTS,
  IMAGE_RATIOS,
  PRODUCT_CARD_VARIANTS,
  SECTION_SPACINGS,
  type StorefrontStyle,
  type ThemePreset,
} from '@/features/storefront/theme/types'

/**
 * Los siete ajustes que se le pueden pisar al tema (Storefront V2 · P10).
 *
 * ## Qué eran, y por qué molestaban
 *
 * Una rejilla de siete desplegables a tres columnas, todos abiertos, todos con
 * el mismo peso visual y todos diciendo «Heredar del tema». Ocupaban más
 * pantalla que la elección del tema —que es LA decisión— y ofrecían siete
 * preguntas a quien acababa de responder una. Y la respuesta que ya tenían
 * puesta no decía nada: «heredar del tema» no es un valor, es la ausencia de
 * uno. Un comercio no podía saber si su tienda tenía las tarjetas cómodas o
 * compactas sin ir a mirar la vitrina.
 *
 * ## Lo que se hizo
 *
 * **Tres grupos plegados.** Estructura, Producto y Espaciado. Se abre el que se
 * necesita, y un grupo con algo pisado se abre solo: lo que está fuera de lo
 * normal tiene que verse sin buscarlo.
 *
 * **La opción de herencia dice el valor heredado.** «Usar tema: Compacta», no
 * «Heredar del tema». El dato existe —está en el preset— y esconderlo obligaba
 * a abrir la vitrina para saber qué se estaba heredando.
 *
 * **Se cuenta lo pisado.** «2 de 7 personalizados», con la acción de volver al
 * tema al lado y cada grupo marcando cuántos lleva. Un comercio que no recuerda
 * qué tocó hace tres meses lo ve sin abrir nada.
 *
 * ## Lo que NO cambia
 *
 * El contrato. Siguen siendo las siete claves cerradas de `StorefrontStyle`,
 * con sus listas cerradas, y pisar sigue siendo escribir la clave en
 * `storefront_style` y heredar, borrarla. Esto es la misma decisión mejor
 * presentada, no una decisión nueva.
 */

const HEREDAR = ''

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

interface Ajuste {
  readonly clave: keyof StorefrontStyle
  readonly valores: readonly string[]
  readonly etiqueta: MessageKey
}

/**
 * Los tres grupos.
 *
 * Las listas salen del contrato (`theme/types.ts`), no de una copia: añadir un
 * valor allí lo hace aparecer aquí, y eso es lo que impide que el formulario se
 * quede ofreciendo seis opciones cuando ya hay siete.
 *
 * El reparto no es alfabético: responde a tres preguntas distintas. Qué piezas
 * tiene la tienda y cómo son de grandes (estructura), cómo se enseña lo que se
 * vende (producto) y cuánto aire hay entre las cosas (espaciado). `contentWidth`
 * va con el aire y no con la estructura porque lo que decide es cuánto ocupa la
 * tienda, no qué lleva dentro.
 */
const GRUPOS = [
  {
    id: 'structure',
    titulo: 'settings.design.style.group.structure',
    ajustes: [
      { clave: 'headerVariant', valores: HEADER_VARIANTS, etiqueta: 'settings.design.field.header' },
      { clave: 'heroVariant', valores: HERO_VARIANTS, etiqueta: 'settings.design.field.hero' },
      {
        clave: 'categoryVariant',
        valores: CATEGORY_VARIANTS,
        etiqueta: 'settings.design.field.categories',
      },
    ],
  },
  {
    id: 'product',
    titulo: 'settings.design.style.group.product',
    ajustes: [
      {
        clave: 'productCardVariant',
        valores: PRODUCT_CARD_VARIANTS,
        etiqueta: 'settings.design.field.card',
      },
      { clave: 'imageRatio', valores: IMAGE_RATIOS, etiqueta: 'settings.design.field.ratio' },
    ],
  },
  {
    id: 'spacing',
    titulo: 'settings.design.style.group.spacing',
    ajustes: [
      { clave: 'contentWidth', valores: CONTENT_WIDTHS, etiqueta: 'settings.design.field.width' },
      {
        clave: 'sectionSpacing',
        valores: SECTION_SPACINGS,
        etiqueta: 'settings.design.field.spacing',
      },
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string
  titulo: MessageKey
  ajustes: readonly Ajuste[]
}>

/** Las siete claves, para contar sin repetir la lista. */
export const CLAVES_DE_ESTILO: readonly (keyof StorefrontStyle)[] = GRUPOS.flatMap((grupo) =>
  grupo.ajustes.map((ajuste) => ajuste.clave),
)

export function AdvancedStyleSettings({
  preset,
  style,
  busy = false,
  onChange,
  onReset,
}: {
  preset: ThemePreset
  style: Partial<StorefrontStyle>
  busy?: boolean
  /** Pisar una clave, o devolverla al tema con `''`. */
  onChange: (clave: keyof StorefrontStyle, valor: string) => void
  onReset: () => void
}) {
  const { t } = useI18n()

  const definicion = THEME_PRESETS[preset]
  const pisados = CLAVES_DE_ESTILO.filter((clave) => style?.[clave] !== undefined)

  return (
    <Stack spacing={1}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
      >
        <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
          {t('settings.design.style.title')}
        </Typography>
        <Button
          type="button"
          size="small"
          disabled={busy || pisados.length === 0}
          onClick={onReset}
        >
          {t('settings.design.style.reset')}
        </Button>
      </Stack>

      {/* El contador, antes de los grupos. Es la respuesta a «¿qué le he tocado
          yo a esto?», y estaba en ningún sitio: había que abrir los siete
          desplegables y compararlos con el tema de memoria. */}
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
        {pisados.length === 0
          ? t('settings.design.style.noneCustom')
          : t('settings.design.style.count')
              .replace('{n}', String(pisados.length))
              .replace('{total}', String(CLAVES_DE_ESTILO.length))}
      </Typography>

      <Stack spacing={0.75}>
        {GRUPOS.map((grupo) => {
          const enElGrupo = grupo.ajustes.filter(
            (ajuste) => style?.[ajuste.clave] !== undefined,
          ).length

          return (
            <Accordion
              key={grupo.id}
              // Abierto de entrada solo si lleva algo pisado: lo que está fuera
              // de lo normal tiene que verse sin buscarlo, y lo normal no tiene
              // por qué ocupar sitio. `defaultExpanded` y no controlado — quien
              // lo abre manda, y volver a cerrárselo al teclear sería pelearse
              // con quien está configurando.
              defaultExpanded={enElGrupo > 0}
              disableGutters
              elevation={0}
              sx={{
                border: '1px solid var(--border)',
                borderRadius: `${R.md}px`,
                bgcolor: 'var(--card)',
                '&::before': { display: 'none' },
                '&.Mui-expanded': { margin: 0 },
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', gap: 1, flex: 1, minWidth: 0, pr: 1 }}
                >
                  <Typography sx={{ fontSize: TS.body, fontWeight: 700 }}>
                    {t(grupo.titulo)}
                  </Typography>
                  {enElGrupo > 0 && (
                    <Chip
                      size="small"
                      label={enElGrupo}
                      // El grupo plegado tiene que decir que lleva algo dentro:
                      // si no, esconder es esconder.
                      aria-label={t('settings.design.style.groupCount').replace(
                        '{n}',
                        String(enElGrupo),
                      )}
                      sx={{
                        height: 20,
                        fontWeight: 800,
                        bgcolor: 'var(--accent-soft)',
                        color: 'var(--accent-deep)',
                      }}
                    />
                  )}
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.5,
                    // Una columna en el panel estrecho del taller, dos cuando
                    // hay sitio. Tres nunca: al lado de la vista previa, tres
                    // desplegables por fila quedan en 90 px cada uno.
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                  }}
                >
                  {grupo.ajustes.map((ajuste) => {
                    const heredado = definicion[ajuste.clave]
                    const pisado = style?.[ajuste.clave]

                    return (
                      <TextField
                        key={ajuste.clave}
                        select
                        fullWidth
                        size="small"
                        label={t(ajuste.etiqueta)}
                        disabled={busy}
                        value={pisado ?? HEREDAR}
                        onChange={(evento) => onChange(ajuste.clave, evento.target.value)}
                        slotProps={{ inputLabel: { shrink: true } }}
                      >
                        {/* La herencia DICE lo que hereda. «Heredar del tema» a
                            secas obligaba a abrir la tienda para saber qué se
                            estaba heredando, y el dato estaba aquí al lado. */}
                        <MenuItem value={HEREDAR}>
                          {t('settings.design.style.inheritValue').replace(
                            '{value}',
                            t(ETIQUETA_VALOR[heredado] ?? 'settings.design.style.inherit'),
                          )}
                        </MenuItem>
                        {ajuste.valores.map((valor) => (
                          <MenuItem key={valor} value={valor}>
                            {t(ETIQUETA_VALOR[valor] ?? 'settings.design.style.inherit')}
                          </MenuItem>
                        ))}
                      </TextField>
                    )
                  })}
                </Box>
              </AccordionDetails>
            </Accordion>
          )
        })}
      </Stack>
    </Stack>
  )
}
