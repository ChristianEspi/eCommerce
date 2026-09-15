import { Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { StatusChip, type StatusTone } from '@/shared/ui/StatusChip'
import type { ProductLabel } from './api'
import type { SuggestedLine, SuggestionInputs } from './types'

/** Motivos de «sin temporada» que conoce la pantalla. Uno nuevo no se pinta. */
const SEASONAL_WHY: Record<string, MessageKey> = {
  menos_de_un_anio: 'planning.v2.seasonalWhy.menos_de_un_anio',
  pocos_pedidos: 'planning.v2.seasonalWhy.pocos_pedidos',
  sin_ventas_en_el_anio: 'planning.v2.seasonalWhy.sin_ventas_en_el_anio',
}

function redondo(n: number): string {
  return String(Math.round(n * 100) / 100)
}
type Pieza = { label: string; tone: StatusTone }

/**
 * Las piezas que sostienen la cifra, en palabras cortas: ritmo, mezcla,
 * temporada y disponibilidad. Van debajo junto al motivo y no en un cajón
 * aparte, porque son lo que permite comprobarlo sin preguntar a nadie.
 */
function piezas(inputs: SuggestionInputs, t: (key: MessageKey) => string): Pieza[] {
  const out: Pieza[] = []

  if (inputs.rates?.base !== undefined) {
    out.push({ label: t('planning.v2.inputs.rate').replace('{n}', redondo(inputs.rates.base)), tone: 'default' })
  }
  if (inputs.blend?.long !== undefined && inputs.blend.long > 0 && inputs.windows?.long_days) {
    out.push({
      label: t('planning.v2.inputs.blend').replace('{days}', String(inputs.windows.long_days)),
      tone: 'default',
    })
  }
  const why = inputs.seasonal?.reason ? SEASONAL_WHY[inputs.seasonal.reason] : undefined
  if (inputs.seasonal?.applied && inputs.seasonal.factor !== undefined) {
    out.push({ label: t('planning.v2.inputs.seasonal').replace('{n}', redondo(inputs.seasonal.factor)), tone: 'info' })
  } else if (why) {
    out.push({ label: t('planning.v2.inputs.noSeasonal').replace('{why}', t(why)), tone: 'default' })
  }
  if (inputs.shortage) {
    out.push({ label: t('planning.v2.inputs.shortage'), tone: 'error' })
  } else if (inputs.capped) {
    out.push({ label: t('planning.v2.inputs.capped'), tone: 'warning' })
  } else if (inputs.atp?.state === 'unknown') {
    out.push({ label: t('planning.v2.inputs.unknownAtp'), tone: 'default' })
  } else if (inputs.atp?.state === 'backorder') {
    out.push({ label: t('planning.v2.inputs.backorder'), tone: 'info' })
  }
  return out
}
/**
 * La propuesta, línea a línea, con su explicación.
 *
 * El motivo va al lado de la cifra: «12 unidades» no se defiende delante de un
 * cliente; «compró 12 en los últimos 30 días, limitado a 8 disponibles» sí.
 */
export function SuggestedLinesTable({
  lines,
  labels,
}: {
  lines: readonly SuggestedLine[]
  labels: ReadonlyMap<string, ProductLabel>
}) {
  const { t } = useI18n()

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('planning.field.product')}</TableCell>
          <TableCell align="right">{t('planning.field.quantity')}</TableCell>
          <TableCell align="right">{t('planning.field.onHand')}</TableCell>
          <TableCell>{t('planning.field.reason')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {lines.map((line) => {
          const producto = labels.get(line.product_id)
          const explicacion = piezas(line.inputs, t)
          return (
            <TableRow key={`${line.product_id}-${line.variant_id ?? ''}`} hover>
              <TableCell>
                <Stack spacing={0.25}>
                  <Typography sx={{ fontSize: 13 }}>{producto?.name ?? '—'}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{producto?.sku ?? ''}</Typography>
                </Stack>
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 800 }}>
                {line.suggested_quantity}
              </TableCell>
              <TableCell align="right">{line.on_hand_quantity ?? '—'}</TableCell>
              <TableCell>
                <Stack spacing={0.75}>
                  <Typography sx={{ color: 'var(--muted)', fontSize: 12 }}>{line.reason}</Typography>
                  {explicacion.length > 0 && (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      useFlexGap
                      sx={{ flexWrap: 'wrap' }}
                      role="group"
                      aria-label={t('planning.v2.inputs.title')}
                    >
                      {explicacion.map((pieza) => (
                        <StatusChip key={pieza.label} tone={pieza.tone} label={pieza.label} />
                      ))}
                    </Stack>
                  )}
                </Stack>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}