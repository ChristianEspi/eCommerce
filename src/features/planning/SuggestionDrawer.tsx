import {
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { ErrorState } from '@/shared/ui/states'
import { useSuggestionItems } from './hooks'
import type { Suggestion } from './types'

/**
 * El detalle de una sugerencia: solo LECTURA.
 *
 * Editar una línea aquí sería reescribir lo que el modelo propuso, y entonces
 * `model_code` dejaría de decir de dónde salió la cifra — que es justo para lo
 * que se guarda. Lo que se hace con una sugerencia es aceptarla o descartarla
 * entera; si hace falta pedir otra cosa, se pide otra cosa, y la sugerencia
 * queda como el registro de lo que se propuso.
 */
export function SuggestionDrawer({
  open,
  suggestion,
  onClose,
}: {
  open: boolean
  suggestion: Suggestion | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const items = useSuggestionItems(suggestion?.id ?? null)
  const lineas = items.data ?? []

  return (
    <FormDrawer
      open={open}
      title={suggestion?.customer_name ?? t('planning.suggestions.title')}
      subtitle={suggestion ? `${suggestion.model_code} · ${suggestion.generated_at.slice(0, 10)}` : undefined}
      onClose={onClose}
      width={620}
      actions={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <Stack spacing={2}>
        <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
          {t('planning.suggestions.readOnly')}
        </Typography>

        {items.isPending && <TableSkeleton columns={4} />}
        {items.isError && <ErrorState error={items.error} onRetry={() => void items.refetch()} />}

        {!items.isPending && !items.isError && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('planning.field.product')}</TableCell>
                <TableCell align="right">{t('planning.field.quantity')}</TableCell>
                {/* Cierre · item 11: lo disponible cuando se calculó, para que un
                    «limitado a N disponibles» siga siendo comprobable. */}
                <TableCell align="right">{t('planning.field.onHand')}</TableCell>
                <TableCell>{t('planning.field.reason')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lineas.map((linea) => (
                <TableRow key={linea.id} hover>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Typography sx={{ fontSize: 13 }}>{linea.product_name ?? '—'}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>
                        {linea.product_sku ?? ''}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>
                    {linea.suggested_quantity}
                  </TableCell>
                  <TableCell align="right">{linea.on_hand_quantity ?? '—'}</TableCell>
                  <TableCell sx={{ color: 'var(--muted)', fontSize: 12 }}>{linea.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>
    </FormDrawer>
  )
}
