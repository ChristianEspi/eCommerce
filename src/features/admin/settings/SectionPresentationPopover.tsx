import { Button, MenuItem, Popover, Stack, TextField, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import {
  SECTION_PRESENTATION_RULES,
  SECTION_WIDTHS,
  resolveSectionPresentation,
} from '@/features/storefront/theme/presentation'
import type {
  HomeSectionId,
  SectionPresentation,
  StorefrontStyle,
  ThemePreset,
} from '@/features/storefront/theme/types'
import { TS } from '@/theme/tokens'
import { ETIQUETA_VALOR, HEREDAR } from './styleLabels'

/**
 * Cómo se enseña UNA sección de la portada (Storefront V3 · P12).
 *
 * ## Por qué un panel flotante y no tres desplegables en la fila
 *
 * La lista de la portada son trece filas, y cada fila ya lleva interruptor,
 * nombre, tope de productos y dos flechas. Añadirle tres desplegables más la
 * convierte en un formulario de seis controles repetido trece veces: 78
 * controles en la columna estrecha del taller, y la lista deja de poder
 * recorrerse de un vistazo — que es para lo que existe.
 *
 * El panel se abre solo cuando alguien quiere afinar esa sección. El resto del
 * tiempo, la fila es una fila.
 *
 * ## Lo que hace que esto no sea un maquetador
 *
 * **Solo se ofrece lo que esa sección admite.** Las opciones salen de
 * `SECTION_PRESENTATION_RULES`, la misma tabla que valida la base y la que lee
 * la vitrina: una banda de familias con fondo de contraste taparía las fotos de
 * las propias familias, así que ahí no se ofrece. Y una sección que no elige
 * composición —el hero, el contenido del CMS— no enseña ese desplegable en
 * lugar de enseñarlo vacío.
 *
 * **Lo heredado DICE lo que hereda.** «Automático» a secas obligaría a abrir la
 * tienda para saber qué se está heredando; aquí se resuelve con el mismo
 * `resolveSectionPresentation` de la vitrina y se escribe el valor: «Usar Fila».
 *
 * **Y se puede volver atrás.** «Quitar personalización» borra la presentación
 * de esa sección, que es distinto de elegir sus valores por defecto: sin nada
 * guardado, el día que el tema cambie de opinión la sección le sigue.
 */
export function SectionPresentationPopover({
  open,
  anchorEl,
  onClose,
  sectionId,
  sectionName,
  preset,
  style,
  presentation,
  busy = false,
  onChange,
  onClear,
}: {
  open: boolean
  anchorEl: HTMLElement | null
  onClose: () => void
  sectionId: HomeSectionId
  sectionName: string
  preset: ThemePreset
  /** El estilo efectivo: hace falta para resolver lo que `auto` significa hoy. */
  style: StorefrontStyle
  presentation: SectionPresentation | undefined
  busy?: boolean
  /** `''` devuelve esa clave al tema. */
  onChange: (clave: 'variant' | 'surface' | 'width', valor: string) => void
  onClear: () => void
}) {
  const { t } = useI18n()
  const reglas = SECTION_PRESENTATION_RULES[sectionId]

  // Lo que se vería hoy sin tocar nada: el tema ya resolvió su `auto`.
  const efectiva = resolveSectionPresentation({
    id: sectionId,
    presentation: undefined,
    preset,
    categoryVariant: style.categoryVariant,
    productCardVariant: style.productCardVariant,
  })

  const etiqueta = (valor: string): string =>
    t(ETIQUETA_VALOR[valor] ?? ('settings.design.style.inherit' as MessageKey))

  const heredado = (valor: string) =>
    t('settings.design.style.inheritValue').replace('{value}', etiqueta(valor))

  const campos: {
    clave: 'variant' | 'surface' | 'width'
    label: MessageKey
    valores: readonly string[]
    guardado: string | undefined
    efectivo: string
  }[] = [
    // La composición: solo si la sección elige. El hero y el CMS traen la suya
    // en su propio contrato, y ofrecer otra aquí serían dos verdades.
    ...(reglas.variants.length > 0
      ? [
          {
            clave: 'variant' as const,
            label: 'settings.design.presentation.variant' as MessageKey,
            valores: reglas.variants.filter((valor) => valor !== 'auto'),
            guardado: presentation?.variant,
            efectivo: efectiva.variant,
          },
        ]
      : []),
    // El fondo: solo los que esa sección admite.
    ...(reglas.surfaces.length > 1
      ? [
          {
            clave: 'surface' as const,
            label: 'settings.design.presentation.surface' as MessageKey,
            valores: reglas.surfaces,
            guardado: presentation?.surface,
            efectivo: efectiva.surface,
          },
        ]
      : []),
    {
      clave: 'width' as const,
      label: 'settings.design.presentation.width' as MessageKey,
      valores: SECTION_WIDTHS,
      guardado: presentation?.width,
      efectivo: efectiva.width,
    },
  ]

  const personalizada = Boolean(
    presentation?.variant ?? presentation?.surface ?? presentation?.width,
  )

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: { p: 2, width: 288 },
          // Marca estructural: es lo que permite comprobar en una prueba QUÉ
          // sección se está afinando, sin depender del texto del título.
          ...({ 'data-presentation-popover': sectionId } as Record<string, string>),
        },
      }}
    >
      <Stack spacing={1.5}>
        <Stack spacing={0.25}>
          <Typography sx={{ fontSize: TS.bodyStrong, fontWeight: 700 }}>
            {t('settings.design.presentation.title')}
          </Typography>
          {/* De qué sección se está hablando: el panel flota, y sin el nombre
              no hay forma de saber qué fila se está afinando. */}
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{sectionName}</Typography>
        </Stack>

        {campos.map((campo) => (
          <TextField
            key={campo.clave}
            select
            fullWidth
            size="small"
            label={t(campo.label)}
            disabled={busy}
            value={campo.guardado ?? HEREDAR}
            onChange={(evento) => onChange(campo.clave, evento.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          >
            <MenuItem value={HEREDAR}>{heredado(campo.efectivo)}</MenuItem>
            {campo.valores.map((valor) => (
              <MenuItem key={valor} value={valor}>
                {etiqueta(valor)}
              </MenuItem>
            ))}
          </TextField>
        ))}

        <Button
          type="button"
          size="small"
          disabled={busy || !personalizada}
          onClick={onClear}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('settings.design.presentation.clear')}
        </Button>
      </Stack>
    </Popover>
  )
}
