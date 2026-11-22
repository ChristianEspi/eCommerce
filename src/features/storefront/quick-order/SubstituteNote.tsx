import { Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import { TS } from '@/theme/tokens'

/**
 * 2026-11-22 · La tienda no tiene lo pedido y las alternativas de la fila son
 * por COMPONENTE principal. Se dice, para que nadie las tome por el mismo
 * producto, y se pide confirmar antes de comprar.
 */
export function SubstituteNote({ componente }: { componente: string }) {
  const { t } = useI18n()
  return (
    <Typography data-substitute sx={{ fontSize: TS.label, color: 'var(--muted)', mb: 0.75 }}>
      {t('store.intake.review.substitute').replace('{component}', componente)}
    </Typography>
  )
}
