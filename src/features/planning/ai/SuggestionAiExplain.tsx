import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect } from 'react'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { MarkerText, MotivoNotice } from '@/features/orders/ai/parts'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useSuggestionInsight } from './usePlanningAi'

/**
 * «Explicar con IA» en el cajón «Generar sugerido» (fase 05).
 *
 * La cantidad de cada línea es la de `suggest_order_v2` y se pinta desde el
 * bloque `system` (CÁLCULO DEL SISTEMA). La IA solo añade, al lado, POR QUÉ
 * salió esa cantidad (INTERPRETACIÓN IA). No guarda nada: guardar sigue siendo
 * el botón del cajón.
 */
export function SuggestionAiExplain({
  storeId,
  customerId,
  days,
}: {
  storeId: string
  customerId: string
  days: number
}) {
  const { t, locale } = useI18n()
  const { availability } = useAiFeature('planning')
  const insight = useSuggestionInsight(locale)

  // Otro cliente u otra ventana ⇒ la explicación anterior ya no corresponde.
  const { reset } = insight
  useEffect(() => {
    reset()
  }, [storeId, customerId, days, reset])

  if (availability === 'forbidden' || availability === 'loading') return null

  const run = () => {
    if (availability !== 'available' || insight.isPending) return
    insight.mutate({ storeId, customerId, days })
  }
  const result = insight.data?.result
  const data = result?.data ?? null
  const system = insight.data?.system ?? null
  const porProducto = new Map((data?.lines ?? []).map((l) => [l.ref, l.explanation]))

  return (
    <Stack spacing={1.25} component="section" aria-labelledby="ai-suggestion-title">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Typography id="ai-suggestion-title" component="h3" sx={{ fontSize: 13, fontWeight: 800 }}>
          {t('aiPlanning.suggestion.title')}
        </Typography>
        {availability === 'available' && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AutoAwesomeRoundedIcon fontSize="small" />}
            disabled={insight.isPending}
            onClick={run}
          >
            {t('aiPlanning.suggestion.explain')}
          </Button>
        )}
      </Stack>
      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('aiPlanning.suggestion.help')}</Typography>
      {availability === 'not_entitled' && <MotivoNotice motivo="sin_contratar" />}
      {availability === 'quota_exhausted' && <MotivoNotice motivo="sin_cuota" />}

      <Box aria-live="polite" aria-busy={insight.isPending}>
        {insight.isPending && <Skeleton variant="rounded" height={96} />}
        {!insight.isPending && insight.isError && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={run}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('aiPlanning.networkError')}
          </Alert>
        )}
        {!insight.isPending && !insight.isError && result?.motivo && <MotivoNotice motivo={result.motivo} onRetry={run} />}
        {!insight.isPending && !insight.isError && result && data && system && (
          <Card variant="outlined">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {data.overview && (
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.55 }}>
                  <MarkerText text={data.overview} context={data} />
                </Typography>
              )}
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('planning.field.product')}</TableCell>
                      <TableCell align="right">{t('aiPlanning.suggestion.systemQty')}</TableCell>
                      <TableCell>{t('aiPlanning.suggestion.aiWhy')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {system.lines.map((line) => {
                      const why = porProducto.get(line.ref)
                      return (
                        <TableRow key={line.ref}>
                          <TableCell>
                            <Typography sx={{ fontSize: 13 }}>{line.name}</Typography>
                            <Typography sx={{ fontSize: 11, color: 'var(--muted)' }}>{line.sku ?? ''}</Typography>
                          </TableCell>
                          {/* La cifra es del MOTOR, nunca del texto del modelo. */}
                          <TableCell align="right" className="tnum" sx={{ fontWeight: 800 }}>
                            {line.suggested_quantity}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12.5 }}>
                            {why ? <MarkerText text={why} context={data} /> : <Box component="span" sx={{ color: 'var(--muted)' }}>—</Box>}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </Box>
              {data.caveats && (
                <Alert severity="info">
                  <MarkerText text={data.caveats} context={data} />
                </Alert>
              )}
              {data.discarded > 0 && (
                <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t('aiOrders.discarded').replace('{n}', String(data.discarded))}
                </Typography>
              )}
              <AiFeedbackButtons interactionId={result.interactionId} />
            </CardContent>
          </Card>
        )}
      </Box>
      <Typography sx={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('aiPlanning.suggestion.disclaimer')}</Typography>
    </Stack>
  )
}
