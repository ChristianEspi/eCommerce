import ThumbDownRoundedIcon from '@mui/icons-material/ThumbDownRounded'
import ThumbUpRoundedIcon from '@mui/icons-material/ThumbUpRounded'
import {
  Alert,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { AiMeter } from './AiMeter'
import { useAiEntitlement, useAiFeedback, useAiInteractions } from './hooks'
import type { AiInteraction, AiInteractionStatus } from './types'

/**
 * La IA de esta sociedad: cuánto saldo queda y en qué se fue.
 *
 * Vive en Diagnóstico y no en Ajustes porque las dos mitades exigen lo mismo,
 * `tenant.manage`: la traza lleva dentro el texto que escribió una persona, y
 * la policy de `ai_interactions` ya solo la abre a propietario o administrador.
 * Ponerla en Ajustes habría obligado a esconder media pantalla al resto.
 *
 * ## Por qué la traza enseña los tokens
 *
 * Porque la cuota se cobra por ACCIÓN y el coste se paga por token. Son dos
 * números distintos y solo mirando los dos a la vez se ve si el precio cubre el
 * gasto. Es exactamente lo que GMAO no puede saber hoy: allí solo se cuentan
 * acciones.
 */
export function AiSection() {
  const { t } = useI18n()
  const saldo = useAiEntitlement()
  const contratada = saldo.data?.enabled === true
  const traza = useAiInteractions(contratada)

  return (
    <Stack spacing={2}>
      <AiMeter />

      {/* Sin contratar no se enseña una tabla vacía: se enseña qué falta. El
          medidar ya lo dijo arriba, así que aquí no se repite. */}
      {contratada && (
        <Card>
          <CardContent>
            <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 0.5 }}>
              {t('ai.trace.title')}
            </Typography>
            <Typography sx={{ color: 'var(--muted)', fontSize: 12.5, mb: 1.5 }}>
              {t('ai.trace.subtitle')}
            </Typography>

            {traza.isLoading ? (
              <LoadingState />
            ) : traza.isError ? (
              <ErrorState error={traza.error} onRetry={() => void traza.refetch()} />
            ) : (traza.data ?? []).length === 0 ? (
              <EmptyState title={t('ai.trace.empty')} description={t('ai.trace.emptyHint')} />
            ) : (
              <TablaTraza filas={traza.data ?? []} />
            )}
          </CardContent>
        </Card>
      )}

      {/* El aviso que evita la llamada de soporte más previsible: «he
          contratado la IA y el asistente sigue respondiendo igual». */}
      {contratada && (traza.data ?? []).every((f) => f.status === 'search') &&
        (traza.data ?? []).length > 0 && (
          <Alert severity="info">{t('ai.trace.allSearch')}</Alert>
        )}
    </Stack>
  )
}

function TablaTraza({ filas }: { filas: readonly AiInteraction[] }) {
  const { t } = useI18n()
  const opinar = useAiFeedback()

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('ai.trace.when')}</TableCell>
          <TableCell>{t('ai.trace.feature')}</TableCell>
          <TableCell>{t('ai.trace.question')}</TableCell>
          <TableCell>{t('ai.trace.status')}</TableCell>
          <TableCell align="right">{t('ai.trace.tokens')}</TableCell>
          <TableCell align="right">{t('common.actions')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {filas.map((fila) => (
          <TableRow key={fila.id} hover>
            <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted)' }}>
              {new Date(fila.created_at).toLocaleString()}
            </TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{fila.feature}</TableCell>
            <TableCell sx={{ maxWidth: 320 }}>
              <Typography noWrap sx={{ fontSize: 13 }}>
                {fila.prompt_excerpt ?? '—'}
              </Typography>
              {fila.reply_excerpt && (
                <Typography noWrap sx={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {fila.reply_excerpt}
                </Typography>
              )}
            </TableCell>
            <TableCell>
              <StatusChip label={t(etiquetaEstado(fila.status))} tone={tonoEstado(fila.status)} />
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
              {/* Entrada y salida por separado: la salida cuesta cinco veces
                  más, y sumarlas esconde cuál de las dos se disparó. */}
              {fila.input_tokens} / {fila.output_tokens}
              {fila.cache_read_tokens > 0 && (
                <Typography component="span" sx={{ fontSize: 11, color: 'var(--accent-deep)' }}>
                  {' '}
                  ·{fila.cache_read_tokens}
                </Typography>
              )}
            </TableCell>
            <TableCell align="right">
              <RowActions
                actions={[
                  {
                    id: 'up',
                    icon: <ThumbUpRoundedIcon fontSize="small" />,
                    label: `${t('ai.trace.useful')}: ${fila.feature}`,
                    tone: fila.feedback === 1 ? 'accent' : 'neutral',
                    disabled: opinar.isPending,
                    onClick: () => opinar.mutate({ id: fila.id, value: 1 }),
                  },
                  {
                    id: 'down',
                    icon: <ThumbDownRoundedIcon fontSize="small" />,
                    label: `${t('ai.trace.useless')}: ${fila.feature}`,
                    tone: fila.feedback === -1 ? 'danger' : 'neutral',
                    disabled: opinar.isPending,
                    onClick: () => opinar.mutate({ id: fila.id, value: -1 }),
                  },
                ]}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** `search` no es un fallo: es cómo responde el asistente sin proveedor. */
function tonoEstado(status: AiInteractionStatus): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'ai') return 'success'
  if (status === 'error') return 'error'
  if (status === 'blocked') return 'warning'
  return 'default'
}

function etiquetaEstado(status: AiInteractionStatus) {
  return (
    {
      ai: 'ai.trace.status.ai',
      search: 'ai.trace.status.search',
      blocked: 'ai.trace.status.blocked',
      error: 'ai.trace.status.error',
    } as const
  )[status]
}
