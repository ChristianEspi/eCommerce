import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import { Alert, Box, Button } from '@mui/material'
import type { ReactNode } from 'react'
import { canRetryMotivo, renderAnalystText, type MarkerContext } from '@/features/admin/dashboard/aiAnalyst'
import type { AiErrorKind } from '@/features/ai/result'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { AppIcon, type AppIconTone } from '@/shared/ui/AppIcon'
import type { OrderAiSeverity } from './ordersAi'

/**
 * Piezas comunes de la IA de pedidos (detalle y listado).
 *
 * La severidad se dice con texto + icono, nunca solo con color (WCAG 1.4.1).
 */
const SEVERITY_TONE: Record<OrderAiSeverity, AppIconTone> = { high: 'danger', medium: 'warning', low: 'info' }

const SEVERITY_ICON: Record<OrderAiSeverity, ReactNode> = {
  high: <ErrorOutlineRoundedIcon fontSize="small" />,
  medium: <ReportProblemOutlinedIcon fontSize="small" />,
  low: <InfoOutlinedIcon fontSize="small" />,
}

export function SeverityIcon({ severity }: { severity: OrderAiSeverity }) {
  const { t } = useI18n()
  return (
    <AppIcon tone={SEVERITY_TONE[severity]} size="sm" label={t(`aiOrders.severity.${severity}` as MessageKey)}>
      {SEVERITY_ICON[severity]}
    </AppIcon>
  )
}

/** Texto del modelo: los marcadores se sustituyen por la cifra/etiqueta de la base. */
export function MarkerText({ text, context }: { text: string; context: MarkerContext }) {
  const { t, locale } = useI18n()
  const parts = renderAnalystText(text, context, locale, { days: t('aiOrders.unit.days') })
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <Box key={i} component="strong" className={part.type === 'metric' ? 'tnum' : undefined} sx={{ fontWeight: 800 }}>
            {part.text}
          </Box>
        ),
      )}
    </>
  )
}

/** Por qué no hay interpretación, con reintento solo si tiene sentido. */
export function MotivoNotice({ motivo, onRetry }: { motivo: AiErrorKind; onRetry?: () => void }) {
  const { t } = useI18n()
  const info = motivo === 'sin_proveedor' || motivo === 'sin_contratar' || motivo === 'modulo_no_contratado'
  const key: MessageKey =
    motivo === 'vacia' || motivo === 'bloqueada' ? `aiOrders.motivo.${motivo}` : (`ai.motivo.${motivo}` as MessageKey)
  return (
    <Alert
      severity={info ? 'info' : 'warning'}
      action={
        onRetry && canRetryMotivo(motivo) ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : undefined
      }
    >
      {t(key)}
    </Alert>
  )
}
