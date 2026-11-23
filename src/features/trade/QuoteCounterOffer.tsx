import {
  Alert,
  Box,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { Field } from '@/shared/ui/Field'
import { useFeedback } from '@/shared/ui/feedback-context'
import { updateQuoteItemPrice } from './api'
import { leerNotaCompetencia, proponerContraoferta, type ReglaContrapropuesta } from './counterOffer'
import { TRADE_KEY } from './hooks'
import type { Quote, QuoteItem } from './types'

const REGLA: Record<ReglaContrapropuesta, MessageKey> = {
  igualar: 'trade.counter.rule.match',
  tope: 'trade.counter.rule.floor',
  ya_mejor: 'trade.counter.rule.better',
  sin_dato: 'trade.counter.rule.none',
}

/**
 * «Contrapropuesta» en una solicitud de «Mejora esta cotización»: los precios
 * que le ofrecen al cliente (leídos por la IA en la vitrina) frente a los
 * nuestros, y el precio de respuesta según el descuento máximo que fija el
 * vendedor. Se aplica solo al pulsar; después se envía como cualquier cotización.
 */
export function QuoteCounterOffer({ quote, items }: { quote: Quote; items: readonly QuoteItem[] }) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const queryClient = useQueryClient()
  const [descuento, setDescuento] = useState('10')
  const competencia = useMemo(() => leerNotaCompetencia(quote.notes), [quote.notes])

  const pct = Number(descuento)
  const pctValido = descuento !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 90
  const filas = useMemo(
    () => (competencia && pctValido ? proponerContraoferta(items, competencia, pct) : []),
    [competencia, items, pct, pctValido],
  )
  const cambios = filas.filter((f) => f.propuesta !== f.actual)

  const aplicar = useMutation({
    mutationFn: async () => {
      for (const f of cambios) {
        const item = items.find((i) => i.id === f.itemId)
        if (!item) continue
        await updateQuoteItemPrice({
          id: item.id,
          quoteId: quote.id,
          quantity: item.quantity,
          unitPrice: f.propuesta.toFixed(2),
          taxRate: item.tax_rate,
        })
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TRADE_KEY })
      notify(t('trade.counter.applied'), 'success')
    },
    onError: () => notify(t('trade.counter.failed'), 'error'),
  })

  if (!competencia) return null
  const dinero = (n: number | null) => (n === null ? '—' : formatMoney(n, quote.currency, locale))

  return (
    <Box sx={{ mt: 2.5, p: 1.5, border: '1px solid var(--border)', borderRadius: 2 }} data-quote-counter>
      <Typography sx={{ fontWeight: 800 }}>{t('trade.counter.title')}</Typography>
      <Typography variant="body2" sx={{ color: 'var(--muted)', mb: 1.5 }}>
        {t('trade.counter.intro')}
      </Typography>
      <Box sx={{ width: { xs: '100%', sm: 200 }, mb: 1.5 }}>
        <Field
          size="small"
          rule="decimal"
          label={t('trade.counter.maxDiscount')}
          value={descuento}
          onChange={(e) => setDescuento(e.target.value)}
          error={!pctValido}
          helperText={!pctValido ? t('trade.counter.maxDiscountHelp') : undefined}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Box>
      {competencia.length !== items.length && <Alert severity="warning" sx={{ mb: 1 }}>{t('trade.counter.mismatch')}</Alert>}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('trade.field.product')}</TableCell>
              <TableCell align="right">{t('trade.counter.ours')}</TableCell>
              <TableCell align="right">{t('trade.counter.theirs')}</TableCell>
              <TableCell align="right">{t('trade.counter.proposal')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filas.map((f) => (
              <TableRow key={f.itemId} data-counter-row={f.itemId}>
                <TableCell>
                  {f.producto}
                  <Typography variant="caption" sx={{ display: 'block', color: 'var(--muted)' }}>
                    {t(REGLA[f.regla])}
                  </Typography>
                </TableCell>
                <TableCell align="right">{dinero(f.actual)}</TableCell>
                <TableCell align="right">{dinero(f.competencia)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 800 }}>{dinero(f.propuesta)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1.5 }}>
        <Button variant="contained" disabled={cambios.length === 0 || aplicar.isPending} onClick={() => aplicar.mutate()}>
          {aplicar.isPending ? t('trade.counter.applying') : t('trade.counter.apply').replace('{count}', String(cambios.length))}
        </Button>
      </Stack>
    </Box>
  )
}
