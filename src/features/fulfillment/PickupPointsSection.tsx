import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import {
  Alert,
  Button,
  Card,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { geocodeAddress } from '@/shared/lib/geo'
import { MapView } from '@/shared/ui/map/MapView'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { ConfirmDeleteDialog } from '@/shared/ui/ConfirmDeleteDialog'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { RowActions } from '@/shared/ui/RowActions'
import { SelectField } from '@/shared/ui/SelectField'
import { StatusChip } from '@/shared/ui/StatusChip'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { FulfillmentError } from './errors'
import { useDeletePickupPoint, usePickupPoints, useSavePickupPoint, useWarehouses } from './hooks'
import type { PickupPoint, PickupPointFormValues } from './types'

const EMPTY: PickupPointFormValues = {
  code: '',
  name: '',
  address: '',
  district: '',
  city: '',
  region: '',
  warehouseId: '',
  contactPhone: '',
  isActive: false,
  position: 100,
  latitude: null,
  longitude: null,
}

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor : '')

function toForm(point: PickupPoint): PickupPointFormValues {
  return {
    id: point.id,
    code: point.code,
    name: point.name,
    address: texto(point.address.address) || texto(point.address.line1),
    district: texto(point.address.district),
    city: texto(point.address.city),
    region: texto(point.address.region),
    warehouseId: point.warehouse_id ?? '',
    contactPhone: point.contact_phone ?? '',
    isActive: point.is_active,
    position: point.position,
    baseAddress: point.address,
    latitude: point.latitude,
    longitude: point.longitude,
  }
}

/**
 * Las tiendas donde el comprador recoge su pedido (2026-11-15).
 *
 * Hasta hoy solo se daban de alta por script. El DISTRITO es lo que permite a
 * la vitrina ordenarlas por cercanía («En tu distrito») y el ALMACÉN, decir si
 * esa tienda tiene el pedido: sin almacén propio la tienda se ofrece sin
 * prometer stock. Nacen apagadas, como un método: publicar una tienda de
 * recojo es una decisión.
 */
export function PickupPointsSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore, can } = useTenant()
  const canWrite = can('tenant.manage')
  const scope =
    tenant && activeCompanyId && activeStore
      ? { organizationId: tenant.organization_id, companyId: activeCompanyId, storeId: activeStore.id }
      : null

  const points = usePickupPoints(activeStore?.id ?? null)
  const warehouses = useWarehouses()
  const save = useSavePickupPoint(scope)
  const remove = useDeletePickupPoint()

  const [drawer, setDrawer] = useState<{ open: boolean; point: PickupPoint | null }>({ open: false, point: null })
  const [values, setValues] = useState<PickupPointFormValues>(EMPTY)
  const [deleting, setDeleting] = useState<PickupPoint | null>(null)
  const [ubicando, setUbicando] = useState(false)
  const [sinResultado, setSinResultado] = useState(false)

  /** Buscar en el mapa la dirección escrita en el formulario (OpenStreetMap). */
  async function ubicar() {
    setUbicando(true)
    setSinResultado(false)
    try {
      const punto = await geocodeAddress({
        address: values.address,
        district: values.district,
        city: values.city,
        region: values.region,
        country: 'PE',
      })
      if (punto) setValues((v) => ({ ...v, latitude: punto.lat, longitude: punto.lng }))
      else setSinResultado(true)
    } finally {
      setUbicando(false)
    }
  }

  useEffect(() => {
    if (!drawer.open) return
    setValues(drawer.point ? toForm(drawer.point) : EMPTY)
    setSinResultado(false)
  }, [drawer])

  function report(error: unknown) {
    const key: MessageKey = error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic'
    notify(t(key), 'error')
  }

  async function submit() {
    try {
      await save.mutateAsync(values)
      notify(t('fulfillment.pickup.saved'), 'success')
      setDrawer({ open: false, point: null })
    } catch (error) {
      report(error)
    }
  }

  const list = points.data ?? []
  const almacenes = warehouses.data ?? []
  const nombreAlmacen = (id: string | null) => almacenes.find((w) => w.id === id)?.name ?? null

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle1">{t('fulfillment.pickup.title')}</Typography>
        <Button
          variant="contained"
          size="small"
          disabled={!canWrite || !activeStore}
          onClick={() => setDrawer({ open: true, point: null })}
        >
          {t('fulfillment.pickup.new')}
        </Button>
      </Stack>
      <Typography sx={{ color: 'var(--muted)' }}>{t('fulfillment.pickup.help')}</Typography>

      <Card>
        {points.isPending && <TableSkeleton columns={5} />}
        {points.isError && <ErrorState error={points.error} onRetry={() => void points.refetch()} />}
        {!points.isPending && !points.isError && list.length === 0 && (
          <EmptyState
            title={t('fulfillment.pickup.empty')}
            description={t('fulfillment.pickup.emptyBody')}
            icon={<StorefrontRoundedIcon fontSize="small" />}
          />
        )}
        {!points.isPending && !points.isError && list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('fulfillment.field.methodName')}</TableCell>
                <TableCell>{t('fulfillment.pickup.district')}</TableCell>
                <TableCell>{t('fulfillment.pickup.address')}</TableCell>
                <TableCell>{t('fulfillment.pickup.warehouse')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((point) => {
                const distrito = texto(point.address.district)
                return (
                  <TableRow key={point.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{point.name}</TableCell>
                    <TableCell>
                      {distrito || <StatusChip tone="warning" label={t('fulfillment.pickup.noDistrict')} />}
                    </TableCell>
                    <TableCell>
                      {texto(point.address.address) || texto(point.address.line1)}
                      {point.latitude === null && (
                        <>
                          {' '}
                          <StatusChip tone="warning" label={t('fulfillment.pickup.noLocation')} />
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      {nombreAlmacen(point.warehouse_id) ?? (
                        <StatusChip label={t('fulfillment.pickup.noWarehouse')} />
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        tone={point.is_active ? 'success' : 'default'}
                        label={t(point.is_active ? 'payments.state.active' : 'payments.state.inactive')}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <RowActions
                        actions={[
                          {
                            id: '0',
                            icon: <EditRoundedIcon fontSize="small" />,
                            label: `${t('common.edit')}: ${point.name}`,
                            tone: 'neutral',
                            disabled: !canWrite,
                            onClick: () => setDrawer({ open: true, point }),
                          },
                          {
                            id: '1',
                            icon: <DeleteRoundedIcon fontSize="small" />,
                            label: `${t('common.delete')}: ${point.name}`,
                            tone: 'danger',
                            disabled: !canWrite,
                            onClick: () => setDeleting(point),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title={t('fulfillment.pickup.deleteTitle')}
        entityName={deleting?.name ?? ''}
        usage={[]}
        isLoadingUsage={false}
        onDelete={async () => {
          if (!deleting) return
          try {
            await remove.mutateAsync(deleting.id)
            notify(t('fulfillment.pickup.deleted'), 'success')
            setDeleting(null)
          } catch (error) {
            report(error)
          }
        }}
        onClose={() => setDeleting(null)}
        isBusy={remove.isPending}
      />

      <FormDrawer
        open={drawer.open}
        title={drawer.point ? t('fulfillment.pickup.edit') : t('fulfillment.pickup.new')}
        subtitle={activeStore?.name}
        busy={save.isPending}
        onClose={() => setDrawer({ open: false, point: null })}
        actions={
          <>
            <Button onClick={() => setDrawer({ open: false, point: null })}>{t('common.cancel')}</Button>
            <Button variant="contained" disabled={save.isPending} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <TextField
            label={t('fulfillment.field.code')}
            value={values.code}
            disabled={Boolean(values.id)}
            onChange={(e) => setValues((v) => ({ ...v, code: e.target.value }))}
            helperText={t('fulfillment.field.codeHelp')}
          />
          <TextField
            label={t('fulfillment.field.methodName')}
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          />
          <TextField
            label={t('fulfillment.pickup.address')}
            value={values.address}
            onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))}
          />
          <TextField
            label={t('fulfillment.pickup.district')}
            value={values.district}
            onChange={(e) => setValues((v) => ({ ...v, district: e.target.value }))}
            helperText={t('fulfillment.pickup.districtHelp')}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth
              label={t('fulfillment.pickup.city')}
              value={values.city}
              onChange={(e) => setValues((v) => ({ ...v, city: e.target.value }))}
            />
            <TextField
              fullWidth
              label={t('fulfillment.pickup.region')}
              value={values.region}
              onChange={(e) => setValues((v) => ({ ...v, region: e.target.value }))}
            />
          </Stack>
          <Stack spacing={1}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 700 }}>{t('fulfillment.pickup.location')}</Typography>
              <Stack direction="row" sx={{ gap: 1 }}>
                {values.latitude !== null && (
                  <Button size="small" onClick={() => setValues((v) => ({ ...v, latitude: null, longitude: null }))}>
                    {t('fulfillment.pickup.clearLocation')}
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<TravelExploreRoundedIcon fontSize="small" />}
                  disabled={ubicando || values.address.trim() === ''}
                  onClick={() => void ubicar()}
                >
                  {t('fulfillment.pickup.locate')}
                </Button>
              </Stack>
            </Stack>
            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
              {t('fulfillment.pickup.locationHelp')}
            </Typography>
            {sinResultado && <Alert severity="info">{t('fulfillment.pickup.locateFailed')}</Alert>}
            <MapView
              ariaLabel={t('fulfillment.pickup.location')}
              height={220}
              pin={{
                position:
                  values.latitude !== null && values.longitude !== null
                    ? { lat: values.latitude, lng: values.longitude }
                    : null,
                draggable: true,
                onMove: (punto) => setValues((v) => ({ ...v, latitude: punto.lat, longitude: punto.lng })),
                label: values.name,
              }}
            />
          </Stack>
          <SelectField
            label={t('fulfillment.pickup.warehouse')}
            value={values.warehouseId}
            onChange={(e) => setValues((v) => ({ ...v, warehouseId: String(e.target.value) }))}
            helperText={t('fulfillment.pickup.warehouseHelp')}
          >
            <MenuItem value="">{t('fulfillment.pickup.noWarehouse')}</MenuItem>
            {almacenes.map((w) => (
              <MenuItem key={w.id} value={w.id}>
                {w.name}
              </MenuItem>
            ))}
          </SelectField>
          <TextField
            label={t('fulfillment.pickup.phone')}
            value={values.contactPhone}
            onChange={(e) => setValues((v) => ({ ...v, contactPhone: e.target.value }))}
          />
          <TextField
            label={t('fulfillment.pickup.position')}
            type="number"
            value={values.position}
            onChange={(e) => setValues((v) => ({ ...v, position: Number(e.target.value) || 0 }))}
          />
          <FormControlLabel
            control={
              <Switch
                checked={values.isActive}
                onChange={(e) => setValues((v) => ({ ...v, isActive: e.target.checked }))}
              />
            }
            label={t('fulfillment.pickup.active')}
          />
        </Stack>
      </FormDrawer>
    </Stack>
  )
}
