import { watchActionHref } from './links'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded'
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { Fragment, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import type { WatchFinding, WatchResult } from './api'
import { useDismissWatch, useRestoreWatch } from './useWatch'
import { watchText } from './watchText'

/**
 * Las tarjetas del centro de vigilancia, en la forma del EBIM Crew de la suite:
 * una franja de color por severidad, el punto con su nombre, el módulo que lo
 * levantó, el título, dos líneas de contexto y dos acciones abajo a la derecha.
 *
 * Las mismas tarjetas se usan en el cajón lateral y en el bloque del dashboard:
 * dos sitios que enseñan cosas distintas son dos sitios que un día se
 * contradicen.
 *
 * ✕ silencia el aviso con la cifra que tenía. ✓ lleva a la pantalla donde se
 * arregla — no lo marca como resuelto, porque resuelto lo dirá el dato cuando
 * cambie, no un botón.
 */

export function WatchCard({
  finding,
  onNavigate,
  muted = false,
  why = null,
  hideModule = false,
}: {
  finding: WatchFinding
  onNavigate?: () => void
  /** En una lista agrupada por módulo, el grupo ya lo nombra. */
  hideModule?: boolean
  muted?: boolean
  /** Por qué va aquí, según el análisis de IA. Sin análisis, no hay línea. */
  why?: string | null
}) {
  const { t } = useI18n()
  const dismiss = useDismissWatch()
  const restore = useRestoreWatch()
  const { title, body } = watchText(finding, t)
  const critica = finding.severity === 'critica'
  const color = critica ? 'var(--red)' : 'var(--amber)'
  const tinte = critica ? 'var(--red-soft)' : 'var(--amber-soft)'

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${color}`,
        bgcolor: 'var(--card)',
        px: 1.5,
        py: 1.25,
        opacity: muted ? 0.6 : 1,
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.6 }}>
        {/* La severidad como píldora teñida: se distingue de un vistazo en una
            rejilla, que es donde de verdad se compara. */}
        <Box
          sx={{
            px: 0.75,
            py: 0.1,
            borderRadius: 999,
            bgcolor: tinte,
            color,
            fontSize: 11.5,
            fontWeight: 800,
            letterSpacing: 0.2,
          }}
        >
          {t(`watch.severity.${finding.severity}` as MessageKey)}
        </Box>
        {!hideModule && (
          <Stack direction="row" spacing={0.3} sx={{ alignItems: 'center', color: 'var(--muted)' }}>
            <PlaceRoundedIcon sx={{ fontSize: 12.5 }} />
            <Typography sx={{ fontSize: 11.5 }}>
              {t(`watch.module.${finding.module}` as MessageKey)}
            </Typography>
          </Stack>
        )}
      </Stack>

      <Typography sx={{ fontWeight: 800, fontSize: 14, lineHeight: 1.3, mb: 0.3 }}>{title}</Typography>
      <Typography
        sx={{
          fontSize: 12.5,
          color: 'var(--muted)',
          lineHeight: 1.45,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {body}
      </Typography>
      {finding.samples.length > 0 && (
        <Typography
          className="tnum"
          sx={{ fontSize: 11.5, color: 'var(--muted)', mt: 0.4, opacity: 0.9 }}
          noWrap
        >
          {finding.samples.map((sample) => sample.label).join(' · ')}
        </Typography>
      )}

      {why && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start', mt: 0.75 }}>
          <AutoAwesomeRoundedIcon sx={{ fontSize: 13, color: 'var(--accent-deep)', mt: '2px' }} />
          <Typography sx={{ fontSize: 12.5, color: 'var(--accent-deep)', lineHeight: 1.45 }}>{why}</Typography>
        </Stack>
      )}

      <Stack direction="row" spacing={0.25} sx={{ justifyContent: 'flex-end', mt: 'auto', pt: 0.5 }}>
        {muted ? (
          <Tooltip title={t('watch.restore')}>
            <span>
              <IconButton
                size="small"
                aria-label={`${t('watch.restore')}: ${title}`}
                disabled={restore.isPending}
                onClick={() => restore.mutate(finding.key)}
              >
                <UndoRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : (
          <Tooltip title={t('watch.dismiss')}>
            <span>
              <IconButton
                size="small"
                aria-label={`${t('watch.dismiss')}: ${title}`}
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate({ key: finding.key, fingerprint: finding.fingerprint })}
                sx={{ color: 'var(--muted)' }}
              >
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={t('watch.open')}>
          <IconButton
            size="small"
            component={RouterLink}
            to={watchActionHref(finding)}
            onClick={onNavigate}
            aria-label={`${t('watch.open')}: ${title}`}
            sx={{ color: 'var(--accent-deep)' }}
          >
            <CheckRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  )
}

/** Agrupa por módulo respetando el orden de llegada: el primer grupo es el del primer aviso. */
function byModule(items: readonly WatchFinding[]): Array<[string, WatchFinding[]]> {
  const groups = new Map<string, WatchFinding[]>()
  for (const item of items) groups.set(item.module, [...(groups.get(item.module) ?? []), item])
  return [...groups.entries()]
}

export type WatchSeverityFilter = 'all' | WatchFinding['severity']

export function WatchList({
  query,
  onNavigate,
  severity = 'all',
  grouped = false,
}: {
  query: {
    data: WatchResult | undefined
    isPending: boolean
    isError: boolean
    refetch: () => unknown
  }
  onNavigate?: () => void
  /** Filtra la vista; los silenciados se siguen contando igual. */
  severity?: WatchSeverityFilter
  /**
   * Con N avisos, una rejilla plana obliga a leerlos todos para encontrar los
   * de Inventario. Agrupados, el módulo se nombra una vez en su cabecera.
   */
  grouped?: boolean
}) {
  const { t } = useI18n()
  const [verSilenciados, setVerSilenciados] = useState(false)
  const all = query.data?.items ?? []
  const items = severity === 'all' ? all : all.filter((item) => item.severity === severity)
  const dismissed = query.data?.dismissed ?? []

  if (query.isPending) return <LoadingState label={t('common.loading')} />
  if (query.isError) {
    return <ErrorState description={t('watch.error')} onRetry={() => void query.refetch()} />
  }

  return (
    <Box
      aria-live="polite"
      sx={{
        display: 'grid',
        gap: 1.25,
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
        alignItems: 'stretch',
      }}
    >
      {all.length === 0 && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <EmptyState
            title={t('watch.empty.title')}
            description={t('watch.empty.body')}
            icon={<MonitorHeartRoundedIcon fontSize="small" />}
          />
        </Box>
      )}
      {all.length > 0 && items.length === 0 && (
        <Typography sx={{ gridColumn: '1 / -1', fontSize: 13, color: 'var(--muted)', py: 2, textAlign: 'center' }}>
          {t('watch.tab.empty')}
        </Typography>
      )}
      {grouped
        ? byModule(items).map(([module, group]) => (
            <Fragment key={module}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ gridColumn: '1 / -1', alignItems: 'center', pt: 1, color: 'var(--muted)' }}
              >
                <Typography
                  component="h3"
                  sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}
                >
                  {t(`watch.module.${module}` as MessageKey)}
                </Typography>
                <Box aria-hidden sx={{ flex: 1, height: '1px', bgcolor: 'var(--border)' }} />
                <Typography className="tnum" aria-hidden sx={{ fontSize: 11, fontWeight: 800 }}>
                  {group.length}
                </Typography>
              </Stack>
              {group.map((finding) => (
                <WatchCard key={finding.key} finding={finding} onNavigate={onNavigate} hideModule />
              ))}
            </Fragment>
          ))
        : items.map((finding) => <WatchCard key={finding.key} finding={finding} onNavigate={onNavigate} />)}

      {/* Lo silenciado se DICE, no se esconde: un panel en calma porque alguien
          tapó tres avisos es un panel que miente. */}
      {dismissed.length > 0 && (
        <Button
          // Ocupa su propia fila de la rejilla para no partir la cuadrícula.
          sx={{ gridColumn: '1 / -1', justifySelf: 'start' }}
          size="small"
          variant="text"
          onClick={() => setVerSilenciados((v) => !v)}
        >
          {(verSilenciados ? t('watch.hideDismissed') : t('watch.showDismissed')).replace(
            '{n}',
            String(dismissed.length),
          )}
        </Button>
      )}
      {verSilenciados &&
        dismissed.map((finding) => (
          <WatchCard key={`muted-${finding.key}`} finding={finding} onNavigate={onNavigate} muted />
        ))}
    </Box>
  )
}
