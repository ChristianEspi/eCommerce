import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Radio,
  Stack,
  Typography,
} from '@mui/material'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatDistance, type LatLng } from '@/shared/lib/geo'
import { Field } from '@/shared/ui/Field'
import { MapView } from '@/shared/ui/map/MapView'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TS } from '@/theme/tokens'
import type { StorePickupPoint } from '../delivery'

/**
 * Recojo en tienda: el distrito del comprador y las tiendas, la más cercana
 * primero (2026-11-15).
 *
 * El orden lo decide el SERVIDOR (`ebim.delivery_options`): con stock primero,
 * luego la más cercana (por km si el comprador compartió su ubicación; si no,
 * por distrito), luego el orden de la tienda. Aquí solo se pinta y se elige,
 * en la lista o tocando la tienda en el mapa (OpenStreetMap, 2026-11-15).
 *
 * Una tienda sin el carrito se ve —saber que existe y qué le falta es
 * información— pero no se puede elegir; el servidor tampoco la aceptaría
 * (`PUNTO_SIN_STOCK`).
 */
export function PickupStorePicker({
  district,
  onDistrictChange,
  points,
  loading,
  failed,
  unavailableReason,
  selectedId,
  onSelect,
  error,
  buyerPoint,
  onUseMyLocation,
  locating,
  messageKey,
}: {
  district: string
  onDistrictChange: (value: string) => void
  points: readonly StorePickupPoint[]
  loading: boolean
  failed: boolean
  /** Motivo del servidor si el recojo no se puede ofrecer (`SIN_STOCK_EN_TIENDAS`…). */
  unavailableReason: string | null
  selectedId: string
  onSelect: (point: StorePickupPoint) => void
  error: string | null
  /** Dónde está el comprador, si pulsó «Usar mi ubicación». */
  buyerPoint: LatLng | null
  onUseMyLocation: () => void
  locating: boolean
  messageKey: MessageKey | null
}) {
  const { t, locale } = useI18n()
  const enMapa = points.filter((punto) => punto.location)

  return (
    <Stack sx={{ gap: 1.5 }}>
      <Field
        label={t('store.pickup.district')}
        rule="text"
        maxLength={80}
        value={district}
        onChange={(evento) => onDistrictChange(evento.target.value)}
        helperText={t('store.pickup.districtHint')}
        autoComplete="address-level3"
      />
      <Box>
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
      </Box>
      {messageKey && <Alert severity="info">{t(messageKey)}</Alert>}
      {enMapa.length > 0 && (
        <MapView
          ariaLabel={t('store.map.pickupLabel')}
          height={240}
          zoom={13}
          pin={buyerPoint ? { position: buyerPoint, label: t('store.map.you') } : undefined}
          places={enMapa.map((punto) => ({
            id: punto.pickup_point_id,
            position: { lat: punto.location!.lat, lng: punto.location!.lng },
            label: punto.name,
            selected: punto.pickup_point_id === selectedId,
            disabled: punto.stock?.state === 'unavailable',
          }))}
          onPlaceSelect={(id) => {
            const punto = points.find((p) => p.pickup_point_id === id)
            if (punto && punto.stock?.state !== 'unavailable') onSelect(punto)
          }}
        />
      )}

      <Typography id="tiendas-recojo" component="h3" sx={{ fontSize: TS.label, fontWeight: 700, color: 'var(--muted)' }}>
        {t('store.pickup.title')}
      </Typography>

      {loading && points.length === 0 && (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography sx={{ fontSize: TS.label }}>{t('store.pickup.loading')}</Typography>
        </Stack>
      )}
      {failed && <Alert severity="error">{t('store.pickup.failed')}</Alert>}
      {!loading && !failed && unavailableReason === 'SIN_STOCK_EN_TIENDAS' && (
        <Alert severity="warning">{t('store.pickup.noStock')}</Alert>
      )}
      {!loading && !failed && points.length === 0 && unavailableReason !== 'SIN_STOCK_EN_TIENDAS' && (
        <Alert severity="info">{t('store.pickup.none')}</Alert>
      )}

      <Stack role="radiogroup" aria-labelledby="tiendas-recojo" sx={{ gap: 1 }}>
        {points.map((point) => {
          const sinStock = point.stock?.state === 'unavailable'
          const elegida = point.pickup_point_id === selectedId
          const calle = textoDe(point.address.address) ?? textoDe(point.address.line1)
          const lugar = [point.district, textoDe(point.address.city)].filter(Boolean).join(', ')
          const cerca: MessageKey | null =
            point.proximity === 'district'
              ? 'store.pickup.near.district'
              : point.proximity === 'city'
                ? 'store.pickup.near.city'
                : point.proximity === 'region'
                  ? 'store.pickup.near.region'
                  : null
          return (
            <Box
              key={point.pickup_point_id}
              component="label"
              data-pickup-point={point.code}
              sx={{
                display: 'flex',
                gap: 1,
                p: 1.5,
                borderRadius: 'var(--sf-radius-sm, 10px)',
                border: '1px solid',
                borderColor: elegida ? 'var(--accent)' : 'var(--border)',
                bgcolor: elegida ? 'var(--accent-soft, transparent)' : 'transparent',
                cursor: sinStock ? 'not-allowed' : 'pointer',
                opacity: sinStock ? 0.6 : 1,
              }}
            >
              <Radio
                checked={elegida}
                disabled={sinStock}
                onChange={() => onSelect(point)}
                inputProps={{ 'aria-label': point.name }}
                sx={{ p: 0.5, alignSelf: 'flex-start' }}
              />
              <Stack sx={{ gap: 0.5, minWidth: 0, flex: 1 }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <StorefrontRoundedIcon fontSize="small" sx={{ color: 'var(--muted)' }} aria-hidden />
                  <Typography sx={{ fontWeight: 700 }}>{point.name}</Typography>
                  {cerca && <StatusChip tone="info" label={t(cerca)} />}
                  {typeof point.distance_km === 'number' && (
                    <StatusChip
                      label={t('store.pickup.distance').replace('{distance}', formatDistance(point.distance_km, locale))}
                    />
                  )}
                </Stack>
                {(calle || lugar) && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {[calle, lugar].filter(Boolean).join(' · ')}
                  </Typography>
                )}
                {point.contact_phone && (
                  <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                    {t('store.pickup.phone')}: {point.contact_phone}
                  </Typography>
                )}
                {point.stock?.state === 'available' && (
                  <Box><StatusChip tone="success" label={t('store.pickup.stock.available')} /></Box>
                )}
                {sinStock && (
                  <Box>
                    <StatusChip
                      tone="error"
                      label={t('store.pickup.stock.unavailable').replace('{items}', (point.stock?.missing ?? []).join(', '))}
                    />
                  </Box>
                )}
              </Stack>
            </Box>
          )
        })}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  )
}

function textoDe(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null
}
