import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { useT } from '@/shared/i18n/i18n-context'
import { R } from '@/theme/tokens'

export interface UsageLine {
  label: string
  count: number
}

/**
 * Eliminación segura, estándar de suite (contrato §4.2):
 * «desactivar conserva los datos; eliminar muestra el conteo de uso real antes
 * de borrar».
 *
 * Las dos mitades importan. La acción recomendada —archivar/desactivar— es el
 * botón primario, porque en un catálogo casi siempre es lo que se quiere. Y el
 * conteo es **real**: sale de una función que cuenta bajo la RLS del usuario,
 * no de un texto genérico de "esto podría afectar a otros registros".
 */
export function ConfirmDeleteDialog({
  open,
  title,
  entityName,
  usage,
  isLoadingUsage,
  usageError,
  safeActionLabel,
  safeActionHint,
  onSafeAction,
  onDelete,
  onClose,
  isBusy = false,
  blocked = false,
}: {
  open: boolean
  title: string
  entityName: string
  usage: UsageLine[]
  isLoadingUsage: boolean
  usageError?: string | null
  /** Alternativa que conserva los datos. Si falta, solo se ofrece borrar. */
  safeActionLabel?: string
  safeActionHint?: string
  onSafeAction?: () => void
  onDelete: () => void
  onClose: () => void
  isBusy?: boolean
  /**
   * El servidor NO dejará borrar (p. ej. un producto que sigue en alguna
   * tienda). Ofrecer «Eliminar de todas formas» sería un botón que siempre
   * falla: se oculta y queda solo la alternativa segura.
   */
  blocked?: boolean
}) {
  const t = useT()
  const inUse = usage.some((line) => line.count > 0)

  return (
    <Dialog open={open} onClose={isBusy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            {t('catalog.delete.body')} <strong>{entityName}</strong>
          </DialogContentText>

          {isLoadingUsage && <Skeleton variant="rounded" height={72} />}

          {!isLoadingUsage && usageError && <Alert severity="error">{usageError}</Alert>}

          {/* Sin líneas no hay conteo que enseñar: un recuadro «Uso» vacío se
              leería como «no se usa en ningún sitio», que nadie ha comprobado. */}
          {!isLoadingUsage && !usageError && usage.length > 0 && (
            <Stack
              spacing={0.5}
              sx={{
                bgcolor: 'var(--neutral-soft)',
                borderRadius: `${R.sm}px`,
                px: 2,
                py: 1.5,
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>
                {t('catalog.delete.usage')}
              </Typography>
              {usage.map((line) => (
                <Stack key={line.label} direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 13 }}>{line.label}</Typography>
                  <Typography className="tnum" sx={{ fontSize: 13, fontWeight: 700 }}>
                    {line.count}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}

          {!isLoadingUsage && !usageError && inUse && !blocked && (
            <Alert severity="warning">{t('catalog.delete.inUse')}</Alert>
          )}

          {safeActionHint && (
            <Typography sx={{ fontSize: 13, color: 'var(--muted)' }}>{safeActionHint}</Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} disabled={isBusy}>
          {t('common.cancel')}
        </Button>
        {!blocked && (
          <Button color="error" onClick={onDelete} disabled={isBusy || isLoadingUsage}>
            {inUse ? t('catalog.delete.anyway') : t('catalog.delete.confirm')}
          </Button>
        )}
        {safeActionLabel && onSafeAction && (
          <Button variant="contained" onClick={onSafeAction} disabled={isBusy}>
            {safeActionLabel}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
