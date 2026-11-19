import { StatusChip } from '@/shared/ui/StatusChip'
import { Button, Card, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { eventLabel, termLabel } from '@/shared/i18n/codeLabels'
import { formatDateTime } from '@/shared/lib/format'
import { ErrorState, EmptyState, UnauthorizedState } from '@/shared/ui/states'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { ReasonDialog } from './ReasonDialog'
import { isForbidden } from './errors'
import { useIntegrationHealth, useResetCircuit } from './hooks'

/**
 * Salud de las integraciones del tenant. Y SOLO del tenant.
 *
 * `integration_health` no acepta ningún identificador de organización ni de
 * sociedad: los deriva del JWT, así que no existe el parámetro que habría que
 * validar para que no se pudiera mirar la cola de otro.
 *
 * ## Lo que se enseña, y por qué justo esto
 *
 * Cuatro cifras por proveedor —pendiente, en vuelo, muerto y la EDAD de lo más
 * viejo— más el último éxito. La edad es la que decide: una cola de doscientos
 * mensajes que se vacía sola está sana; una de tres parada desde ayer, no. Sin
 * ella, el número de pendientes se lee mal en las dos direcciones.
 *
 * Y los DISYUNTORES abiertos aparte, arriba, porque son la única cosa de esta
 * pantalla que explica por qué una cola no avanza aunque nadie esté fallando
 * ahora mismo: el circuito está abierto y no se está intentando.
 */

function ageLabel(seconds: number | null, none: string): string {
  if (seconds === null) return none
  if (seconds < 60) return `${Math.round(seconds)} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}

export function HealthSection() {
  const { t, locale } = useI18n()
  const health = useIntegrationHealth()
  const reset = useResetCircuit()
  const [circuitId, setCircuitId] = useState<string | null>(null)

  if (isForbidden(health.error)) {
    return (
      <UnauthorizedState
        title={t('integrations.error.forbidden')}
        description={t('integrations.forbiddenBody')}
      />
    )
  }
  if (health.isError) {
    return <ErrorState error={health.error} onRetry={() => void health.refetch()} />
  }
  if (health.isPending) return <TableSkeleton columns={5} />

  const data = health.data

  return (
    <Stack sx={{ gap: 2 }}>
      <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
        <Card sx={{ p: 2, flex: '1 1 200px' }}>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
            {t('integrations.health.endpoints')}
          </Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 800 }}>
            {data.webhooks.endpoints_active}/{data.webhooks.endpoints}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('integrations.health.deliveries24h')}: {data.webhooks.deliveries_24h}
          </Typography>
        </Card>
        <Card sx={{ p: 2, flex: '1 1 200px' }}>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
            {t('integrations.health.apiClients')}
          </Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 800 }}>
            {data.api.clients_active}/{data.api.clients}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('integrations.health.requests24h')}: {data.api.requests_24h} ·{' '}
            {t('integrations.health.errors24h')}: {data.api.errors_24h}
          </Typography>
        </Card>
        <Card sx={{ p: 2, flex: '1 1 200px' }}>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
            {t('integrations.health.openCircuits')}
          </Typography>
          <Typography sx={{ fontSize: 24, fontWeight: 800 }}>{data.circuits.length}</Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
            {t('integrations.health.generatedAt').replace(
              '{at}',
              formatDateTime(data.generated_at, locale),
            )}
          </Typography>
        </Card>
      </Stack>

      {data.circuits.length > 0 && (
        <Card>
          <Typography sx={{ p: 2, pb: 0, fontWeight: 700 }}>
            {t('integrations.health.openCircuits')}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('integrations.queue.provider')}</TableCell>
                <TableCell>{t('integrations.queue.operation')}</TableCell>
                <TableCell>{t('integrations.queue.target')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.circuits.map((circuit) => (
                <TableRow key={circuit.id}>
                  <TableCell>{circuit.provider_code}</TableCell>
                  <TableCell>{eventLabel(t, circuit.operation)}</TableCell>
                  <TableCell>{circuit.target_label}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={circuit.state === 'open' ? 'error' : 'warning'}
                      label={`${termLabel(t, 'status', circuit.state)} · ${circuit.consecutive_fail}/${circuit.threshold}`}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setCircuitId(circuit.id)}>
                      {t('integrations.circuit.reset')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card>
        {data.providers.length === 0 ? (
          <EmptyState
            title={t('integrations.health.noProviders')}
            description={t('integrations.health.noProvidersBody')}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('integrations.queue.provider')}</TableCell>
                <TableCell align="right">{t('integrations.health.pending')}</TableCell>
                <TableCell align="right">{t('integrations.health.dead')}</TableCell>
                <TableCell>{t('integrations.health.oldest')}</TableCell>
                <TableCell>{t('integrations.health.lastSuccess')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.providers.map((provider) => (
                <TableRow key={provider.provider_code}>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                      {provider.provider_name}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                      {termLabel(t, 'providerKind', provider.provider_kind)}
                      {!provider.is_active && ` · ${t('integrations.health.inactive')}`}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {provider.pending}
                    {provider.in_flight > 0 && ` (+${provider.in_flight})`}
                  </TableCell>
                  <TableCell align="right">
                    {provider.dead > 0 ? (
                      <StatusChip tone="error" label={String(provider.dead)} />
                    ) : (
                      provider.dead
                    )}
                  </TableCell>
                  <TableCell>
                    {ageLabel(provider.oldest_pending_seconds, t('integrations.health.none'))}
                  </TableCell>
                  <TableCell>
                    {provider.last_success_at
                      ? formatDateTime(provider.last_success_at, locale)
                      : t('integrations.health.none')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ReasonDialog
        open={circuitId !== null}
        title={t('integrations.circuit.resetTitle')}
        body={t('integrations.circuit.resetBody')}
        confirmLabel={t('integrations.circuit.reset')}
        pending={reset.isPending}
        onCancel={() => setCircuitId(null)}
        onConfirm={(reason) => {
          if (!circuitId) return
          reset.mutate({ id: circuitId, reason }, { onSuccess: () => setCircuitId(null) })
        }}
      />
    </Stack>
  )
}
