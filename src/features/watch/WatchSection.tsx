import { watchActionHref } from './links'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import LocalShippingRoundedIcon from '@mui/icons-material/LocalShippingRounded'
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useMemo, useState, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { AiFeedbackButtons } from '@/features/ai/AiFeedbackButtons'
import { useAiFeature } from '@/features/ai/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon } from '@/shared/ui/AppIcon'
import { T } from '@/theme/tokens'
import type { WatchFinding } from './api'
import { watchText } from './watchText'
import { useDismissWatch, useWatch, useWatchAnalysis } from './useWatch'

/** Cuántos avisos se ven sin pedirlo: los demás van tras «Ver N más». */
const VISIBLES = 4

const MODULE_ICON: Record<string, ReactNode> = {
  orders: <ReceiptLongRoundedIcon />,
  inventory: <Inventory2RoundedIcon />,
  fulfillment: <LocalShippingRoundedIcon />,
  credit: <AccountBalanceWalletRoundedIcon />,
  catalog: <VisibilityOffRoundedIcon />,
  integrations: <HubRoundedIcon />,
  ops: <MonitorHeartRoundedIcon />,
}

/**
 * Una fila de «qué hacer ahora»: qué pasa, cuánto, y el botón que lleva a
 * arreglarlo con el verbo de la tarea («Cobrar», «Despachar»), no un genérico.
 *
 * El botón NO resuelve nada: navega a la pantalla donde se resuelve. Resuelto
 * lo dirá el dato cuando cambie, igual que en las tarjetas del cajón.
 */
function WatchRow({ finding, why, last }: { finding: WatchFinding; why: string | null; last: boolean }) {
  const { t } = useI18n()
  const dismiss = useDismissWatch()
  const { title, body } = watchText(finding, t)
  const critica = finding.severity === 'critica'
  const color = critica ? 'var(--red)' : 'var(--amber)'
  const cta = t(`watch.cta.${finding.key}` as MessageKey)

  return (
    <Stack
      component="li"
      direction="row"
      spacing={1.5}
      sx={{ alignItems: 'center', py: 1.25, borderBottom: last ? 'none' : '1px solid var(--border)' }}
    >
      <Box
        aria-hidden
        sx={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: 0.67,
          display: 'grid',
          placeItems: 'center',
          bgcolor: critica ? 'var(--red-soft)' : 'var(--amber-soft)',
          color,
          '& .MuiSvgIcon-root': { fontSize: 18 },
        }}
      >
        {MODULE_ICON[finding.module] ?? <MonitorHeartRoundedIcon />}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.3 }} noWrap>
            {title}
          </Typography>
          {/* La severidad ESCRITA: el color del icono acompaña, no informa solo. */}
          <Typography sx={{ fontSize: 11, fontWeight: 800, color, flexShrink: 0 }}>
            {t(`watch.severity.${finding.severity}` as MessageKey)}
          </Typography>
        </Stack>
        <Typography sx={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }} noWrap title={body}>
          {body}
        </Typography>
        {why && (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start', mt: 0.5 }}>
            <AutoAwesomeRoundedIcon sx={{ fontSize: 13, color: 'var(--accent-deep)', mt: '2px' }} />
            <Typography sx={{ fontSize: 12, color: 'var(--accent-deep)', lineHeight: 1.45 }}>{why}</Typography>
          </Stack>
        )}
      </Box>

      <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0 }}>
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
        <Button
          component={RouterLink}
          to={watchActionHref(finding)}
          size="small"
          variant={critica ? 'contained' : 'outlined'}
          aria-label={`${cta}: ${title}`}
          sx={{ px: 1.5, minWidth: 0, whiteSpace: 'nowrap' }}
        >
          {cta}
        </Button>
      </Stack>
    </Stack>
  )
}

/**
 * EBIM Crew: el vigilante de la tienda, dentro del Resumen.
 *
 * La lista sale de reglas de SQL y está ahí desde que se abre la pantalla, sin
 * gastar una consulta de IA. El botón «Ejecutar análisis» es lo único que llama
 * al modelo, y solo para ORDENAR los avisos y decir por qué: las cifras siguen
 * siendo las de la base y ninguna acción se ejecuta sola.
 *
 * Caben cuatro; el resto va tras «Ver N más». Con `onSeeMore` ese botón abre el
 * centro de vigilancia completo (el Resumen lo usa así: la tarjeta tiene alto
 * de fila y no puede crecer con N avisos); sin él, despliega la lista aquí.
 *
 * Se calla del todo cuando no hay nada que mirar: un bloque fijo que casi
 * siempre dice «todo bien» enseña a ignorarlo, y el día que diga algo tampoco
 * se leerá.
 */
export function WatchSection({ onSeeMore }: { onSeeMore?: () => void } = {}) {
  const { t, locale } = useI18n()
  const watch = useWatch()
  const analysis = useWatchAnalysis()
  const { availability } = useAiFeature('insights')
  const [verTodo, setVerTodo] = useState(false)

  const items = useMemo(() => watch.data?.items ?? [], [watch.data])
  const critical = watch.data?.critical ?? 0

  // Con análisis, el orden y el porqué son los del modelo; sin él, el de las
  // reglas (primero lo crítico). La lista es la MISMA en los dos casos.
  const ordenados = useMemo(() => {
    const orden = analysis.data?.data?.order
    if (!orden) return items
    const posicion = new Map(orden.map((key, index) => [key, index]))
    return [...items].sort((a, b) => (posicion.get(a.key) ?? 99) - (posicion.get(b.key) ?? 99))
  }, [items, analysis.data])

  const porque = useMemo(() => {
    const filas = analysis.data?.data?.reasons ?? []
    return new Map(filas.map((fila) => [fila.key, fila.why]))
  }, [analysis.data])

  if (watch.isPending || watch.isError || items.length === 0) return null

  const visibles = verTodo && !onSeeMore ? ordenados : ordenados.slice(0, VISIBLES)
  const ocultas = ordenados.length - visibles.length
  const motivo = analysis.data?.motivo ?? null
  const puedeAnalizar = availability !== 'forbidden' && availability !== 'loading'

  return (
    <Box
      component="section"
      aria-labelledby="watch-section-title"
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 1.25,
        border: '1px solid var(--border)',
        bgcolor: 'var(--card)',
        px: { xs: 2, md: 2.5 },
        pt: { xs: 2, md: 2.5 },
        pb: 1.5,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.25 }}>
        <AppIcon tone="accent" size="sm">
          <GroupsRoundedIcon fontSize="small" />
        </AppIcon>
        <Typography
          id="watch-section-title"
          component="h2"
          sx={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 800 }}
        >
          {t('watch.title')}
        </Typography>

        {/* El contador de la suite: cuántos avisos hay, en rojo si alguno es
            crítico. Es lo primero que se mira desde lejos. */}
        <Box
          className="tnum"
          aria-label={t('watch.open.panelWith').replace('{n}', String(items.length))}
          sx={{
            minWidth: 26,
            px: 0.9,
            py: 0.15,
            borderRadius: 999,
            textAlign: 'center',
            fontSize: 12.5,
            fontWeight: 800,
            color: '#fff',
            bgcolor: critical > 0 ? 'var(--danger)' : 'var(--warning)',
          }}
        >
          {items.length}
        </Box>

        <Tooltip title={t('common.refresh')}>
          <span>
            <IconButton
              aria-label={t('common.refresh')}
              onClick={() => void watch.refetch()}
              disabled={watch.isFetching}
              size="small"
            >
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Typography sx={{ fontSize: T.label + 1, color: 'var(--muted)', lineHeight: 1.4, mb: 0.5 }}>
        {t('watch.subtitle')} · {t('watch.deterministic')}
      </Typography>

      <Box component="ul" aria-live="polite" sx={{ listStyle: 'none', m: 0, p: 0, flex: 1 }}>
        {visibles.map((finding, index) => (
          <WatchRow
            key={finding.key}
            finding={finding}
            why={porque.get(finding.key) ?? null}
            last={index === visibles.length - 1}
          />
        ))}
      </Box>

      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
          pt: 1.25,
          mt: 0.5,
          borderTop: '1px solid var(--border)',
        }}
      >
        {ordenados.length > VISIBLES ? (
          <Button
            size="small"
            variant="text"
            endIcon={onSeeMore ? <ArrowForwardRoundedIcon /> : undefined}
            onClick={() => (onSeeMore ? onSeeMore() : setVerTodo((v) => !v))}
            sx={{ ml: -0.75 }}
          >
            {verTodo && !onSeeMore ? t('watch.seeLess') : t('watch.seeMore').replace('{n}', String(ocultas))}
          </Button>
        ) : (
          <span />
        )}

        {/* El análisis es opcional y se paga: por eso es un botón y dice lo que
            cuesta. Sin la funcionalidad contratada ni siquiera se enseña. */}
        {puedeAnalizar && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AutoAwesomeRoundedIcon fontSize="small" />}
            disabled={analysis.isPending || availability !== 'available'}
            onClick={() => analysis.mutate({ locale })}
          >
            {analysis.isPending ? t('watch.analyzing') : t('watch.analyze')}
          </Button>
        )}
      </Stack>

      {puedeAnalizar && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {analysis.data?.data && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                {analysis.data.data.headline}
              </Typography>
              {analysis.data.interactionId && <AiFeedbackButtons interactionId={analysis.data.interactionId} />}
            </Stack>
          )}
          {!analysis.data?.data && !analysis.isPending && (
            <Typography sx={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
              {t('watch.analyze.hint')}
            </Typography>
          )}
          {motivo && (
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t(`ai.motivo.${motivo}` as MessageKey)}</Typography>
          )}
          {availability === 'not_entitled' && (
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('watch.analyze.notEntitled')}</Typography>
          )}
          {availability === 'quota_exhausted' && (
            <Typography sx={{ fontSize: 12, color: 'var(--muted)' }}>{t('watch.analyze.noQuota')}</Typography>
          )}
        </Stack>
      )}
    </Box>
  )
}
