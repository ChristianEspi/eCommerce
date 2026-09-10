import { StatusChip } from '@/shared/ui/StatusChip'
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Alert,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CAPABILITIES, isCapabilityId, type CapabilityId } from '@/domain'
import { AiSection } from '@/features/ai/AiSection'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { APP_NAME, APP_VERSION, EBIM_APP_SLUG, supabaseHost } from '@/shared/lib/env'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SectionTabs } from '@/shared/ui/SectionTabs'
import { ErrorState, LoadingState, UnauthorizedState } from '@/shared/ui/states'
import { useFeedback } from '@/shared/ui/feedback-context'
import {
  CapabilitiesError,
  mapCapabilitiesCode,
  refreshPlatformContext,
  setFeatureFlag,
} from './api'
import { useCapabilities } from './capabilities-context'
import type { PlatformContext } from './types'

/**
 * Diagnóstico de configuración (P02-SaaS).
 *
 * Existe porque la pregunta «¿por qué este cliente no ve el módulo?» hoy solo
 * se puede responder abriendo la base de datos, y quien la hace normalmente no
 * tiene acceso a la base. Aquí se ve entero el camino: qué dice el hub, cuándo
 * lo dijo, qué addons llegaron, qué flags los tapan y qué capacidad quedó
 * efectiva.
 *
 * **Nada sensible.** Ni claves, ni tokens, ni cabeceras, ni la URL de la
 * credencial del hub. Lo que se enseña —host del proyecto, versión, sociedad
 * activa, códigos de addon— ya viaja en cada petición del navegador o es dato
 * del propio tenant. Un panel de diagnóstico que filtra un secreto es peor que
 * no tener panel.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', py: 0.75 }}>
      <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>{label}</Typography>
      <Typography component="code" sx={{ fontSize: 13, fontWeight: 700, textAlign: 'right' }}>
        {value || '—'}
      </Typography>
    </Stack>
  )
}

const SOURCE_KEY: Record<PlatformContext['source'], MessageKey> = {
  hub: 'diagnostics.source.hub',
  provisioning: 'diagnostics.source.provisioning',
  'sin-contexto': 'diagnostics.source.none',
}

function ContextSection({ context }: { context: PlatformContext }) {
  const { t, locale } = useI18n()
  const { tenant, activeStore } = useTenant()
  const queryClient = useQueryClient()
  const { notify } = useFeedback()

  const refresh = useMutation({
    mutationFn: refreshPlatformContext,
    onSuccess: () => {
      notify(t('diagnostics.refreshed'))
      void queryClient.invalidateQueries({ queryKey: ['capabilities'] })
    },
    onError: (error: unknown) => {
      const key =
        error instanceof CapabilitiesError ? error.key : mapCapabilitiesCode('ERROR_INTERNO')
      notify(t(key), 'error')
    },
  })

  const synced = context.syncedAt
    ? new Date(context.syncedAt).toLocaleString(locale === 'es' ? 'es-PE' : 'en-US')
    : null

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          {/* El origen es lo primero porque es lo que cambia el diagnóstico:
              sin contexto del hub, «no lo tienes» significa «nunca preguntamos». */}
          <Alert severity={context.source === 'hub' ? 'success' : 'info'} icon={false}>
            {t(SOURCE_KEY[context.source])}
          </Alert>

          <Stack divider={<Divider flexItem />}>
            <Row label={t('diagnostics.field.product')} value={`${APP_NAME} · ${APP_VERSION}`} />
            <Row label={t('diagnostics.field.appSlug')} value={EBIM_APP_SLUG} />
            <Row label={t('diagnostics.field.project')} value={supabaseHost()} />
            <Row label={t('diagnostics.field.organization')} value={context.organizationId} />
            <Row label={t('diagnostics.field.company')} value={context.companyId} />
            <Row
              label={t('diagnostics.field.store')}
              value={activeStore ? `${activeStore.name} · ${activeStore.slug}` : ''}
            />
            <Row label={t('diagnostics.field.tenantSlug')} value={tenant?.slug ?? ''} />
            <Row
              label={t('diagnostics.field.appActive')}
              value={context.appActive ? t('common.yes') : t('common.no')}
            />
            {/* El plan se ENSEÑA y no se USA: mapear plan → módulos aquí sería
                replicar el catálogo comercial del hub (contrato §6). */}
            <Row label={t('diagnostics.field.plan')} value={context.plan ?? ''} />
            <Row label={t('diagnostics.field.syncedAt')} value={synced ?? ''} />
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon fontSize="small" />}
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {t('diagnostics.refresh')}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

function CapabilitiesSection({ context }: { context: PlatformContext }) {
  const { t } = useI18n()
  const { tenant, activeCompanyId, can } = useTenant()
  const queryClient = useQueryClient()
  const { notify } = useFeedback()
  const canManage = can('tenant.manage')

  const toggle = useMutation({
    mutationFn: (input: { flagKey: CapabilityId; enabled: boolean }) =>
      setFeatureFlag({
        organizationId: tenant?.organization_id ?? '',
        companyId: activeCompanyId ?? '',
        flagKey: input.flagKey,
        enabled: input.enabled,
      }),
    onSuccess: () => {
      notify(t('diagnostics.flagSaved'))
      void queryClient.invalidateQueries({ queryKey: ['capabilities'] })
    },
    onError: (error: unknown) => {
      notify(t(error instanceof CapabilitiesError ? error.key : 'capabilities.error.generic'), 'error')
    },
  })

  const effective = new Set<string>(context.capabilities)
  const entitlements = new Set(context.entitlements)
  const unknown = context.entitlements.filter(
    (code) => !CAPABILITIES.some((c) => c.entitlement === code),
  )

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={{ px: { xs: 1, sm: 2 } }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('diagnostics.table.capability')}</TableCell>
                <TableCell>{t('diagnostics.table.origin')}</TableCell>
                <TableCell>{t('diagnostics.table.state')}</TableCell>
                <TableCell align="right">{t('diagnostics.table.flag')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {CAPABILITIES.map((item) => {
                const baseline = item.entitlement === null
                const contracted = baseline || entitlements.has(item.entitlement as string)
                const active = effective.has(item.id)
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      {/* Manda el nombre en castellano; el `id` va debajo y en
                          pequeño porque sigue haciendo falta —es la clave que se
                          cruza con el catálogo de addons del hub—, pero leerlo no
                          puede ser el precio de entender la fila. */}
                      <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{item.name}</Typography>
                      <Typography
                        component="code"
                        sx={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}
                      >
                        {item.id}
                      </Typography>
                      <Typography sx={{ color: 'var(--muted)', fontSize: 12 }}>
                        {item.grants}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>
                        {baseline ? t('diagnostics.baseline') : item.entitlement}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        label={
                          active
                            ? t('diagnostics.state.active')
                            : contracted
                              ? t('diagnostics.state.flagged')
                              : t('diagnostics.state.notContracted')
                        }
                        tone={active ? 'success' : contracted ? 'warning' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {/* Lo baseline no lleva interruptor: un botón capaz de
                          dejar la tienda sin catálogo desde los ajustes del
                          propio tenant es un botón de caída, no una opción. */}
                      {baseline ? (
                        <Typography sx={{ color: 'var(--muted)', fontSize: 12 }}>—</Typography>
                      ) : (
                        <Switch
                          size="small"
                          checked={context.flags[item.id] !== false}
                          disabled={!canManage || !contracted || toggle.isPending}
                          inputProps={{ 'aria-label': `${t('diagnostics.table.flag')} ${item.name}` }}
                          onChange={(event) =>
                            toggle.mutate({ flagKey: item.id, enabled: event.target.checked })
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Un código que el hub manda y esta versión no conoce no se descarta en
          silencio: es la señal de que el catálogo del hub va por delante del
          binario desplegado, y es lo primero que hay que mirar cuando un
          cliente jura haber comprado algo que no aparece. */}
      {unknown.length > 0 && (
        <Alert severity="warning">
          {t('diagnostics.unknownEntitlements')}{' '}
          <Typography component="code" sx={{ fontSize: 12 }}>
            {unknown.join(', ')}
          </Typography>
        </Alert>
      )}

      {/* Flags que no corresponden a ninguna capacidad: interruptores internos.
          Se listan para que nadie los busque en vano en la tabla de arriba. */}
      <FlagsNotCapabilities flags={context.flags} />
    </Stack>
  )
}

function FlagsNotCapabilities({ flags }: { flags: PlatformContext['flags'] }) {
  const { t } = useI18n()
  const extra = Object.entries(flags).filter(([key]) => !isCapabilityId(key))
  if (extra.length === 0) return null
  return (
    <Card>
      <CardContent>
        <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 1 }}>
          {t('diagnostics.technicalFlags')}
        </Typography>
        <Stack>
          {extra.map(([key, value]) => (
            <Row key={key} label={key} value={String(value)} />
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}

/**
 * Solo `tenant.manage` (propietario o administrador). No es una pantalla
 * secreta —no enseña nada que el tenant no pueda saber de sí mismo— pero
 * tampoco es para el usuario de catálogo: enumera módulos que no compró y eso
 * confunde a quien no decide compras.
 */
export function DiagnosticsPage() {
  const { t } = useI18n()
  const { can } = useTenant()
  const { status, context, error, refetch } = useCapabilities()

  if (!can('tenant.manage')) {
    return (
      <>
        <PageHeader icon={<MonitorHeartRoundedIcon />} title={t('diagnostics.title')} />
        <UnauthorizedState description={t('admin.settings.unauthorized')} />
      </>
    )
  }

  return (
    <>
      <PageHeader icon={<MonitorHeartRoundedIcon />} title={t('diagnostics.title')} subtitle={t('diagnostics.subtitle')} />
      {status === 'loading' ? (
        <LoadingState />
      ) : status === 'error' || !context ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <SectionTabs
          ariaLabel={t('diagnostics.title')}
          items={[
            {
              id: 'context',
              label: t('diagnostics.tab.context'),
              content: <ContextSection context={context} />,
            },
            {
              id: 'capabilities',
              label: t('diagnostics.tab.capabilities'),
              content: <CapabilitiesSection context={context} />,
            },
            {
              // La IA vive aquí y no en Ajustes porque sus dos mitades exigen
              // `tenant.manage`, que es justo lo que esta pantalla ya pide: la
              // traza lleva dentro texto que escribió una persona.
              id: 'ai',
              label: t('diagnostics.tab.ai'),
              content: <AiSection />,
            },
          ]}
        />
      )}
    </>
  )
}
