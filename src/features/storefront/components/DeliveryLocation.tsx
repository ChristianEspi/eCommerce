import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded'
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import type { LatLng } from '@/shared/lib/geo'
import { MapView } from '@/shared/ui/map/MapView'
import { TS } from '@/theme/tokens'

/**
 * El punto exacto de entrega (2026-11-15): un mapa con un pin que el comprador
 * puede mover o tocar, y «Usar mi ubicación actual» con el GPS.
 *
 * El pin acompaña a la dirección escrita, no la sustituye: el repartidor sigue
 * leyendo la calle y la referencia; el punto le ahorra la llamada de «¿dónde
 * es exactamente?».
 */
export function DeliveryLocation({
  point,
  onMove,
  onUseMyLocation,
  locating,
  messageKey,
}: {
  point: LatLng | null
  onMove: (point: LatLng) => void
  onUseMyLocation: () => void
  locating: boolean
  /** Aviso del último intento: permiso denegado, dirección no encontrada… */
  messageKey: MessageKey | null
}) {
  const { t } = useI18n()
  return (
    <Stack sx={{ gap: 1 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('store.map.hint')}</Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={onUseMyLocation}
          disabled={locating}
          startIcon={locating ? <CircularProgress size={14} /> : <MyLocationRoundedIcon fontSize="small" />}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          {locating ? t('store.map.locating') : t('store.map.useMyLocation')}
        </Button>
      </Stack>
      {messageKey && <Alert severity="info">{t(messageKey)}</Alert>}
      <MapView
        ariaLabel={t('store.map.label')}
        height={240}
        pin={{ position: point, draggable: true, onMove, label: t('store.map.label') }}
      />
    </Stack>
  )
}
