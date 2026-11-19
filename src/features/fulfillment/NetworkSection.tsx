import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
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
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { FulfillmentError } from './errors'
import {
  useCarriers,
  useDeleteMethod,
  useDeleteRate,
  useDeleteZone,
  useDeliveryMethods,
  useDeliveryRates,
  useDeliveryZones,
  useSaveMethod,
  useSaveRate,
  useSaveZone,
} from './hooks'
import {
  DELIVERY_STRATEGIES,
  SOURCING_STRATEGIES,
  type DeliveryMethod,
  type DeliveryRate,
  type DeliveryZone,
  type MethodFormValues,
  type RateFormValues,
  type ZoneFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'
import { Field } from '@/shared/ui/Field'
import { PickupPointsSection } from './PickupPointsSection'

const EMPTY_ZONE: ZoneFormValues = {
  code: '',
  name: '',
  country: 'PE',
  regions: '',
  postalPrefixes: '',
  priority: 100,
  isActive: true,
}

const EMPTY_METHOD: MethodFormValues = {
  code: '',
  displayName: '',
  strategy: 'ship',
  description: '',
  providerCode: '',
  sourcing: 'store_priority',
  leadTimeMinDays: 1,
  leadTimeMaxDays: 3,
  requiresWindow: false,
  isActive: false,
  position: 100,
  instructions: '',
}

const EMPTY_RATE: RateFormValues = {
  deliveryMethodId: '',
  zoneId: '',
  currency: 'PEN',
  baseAmount: '0.00',
  perItemAmount: '0.00',
  perWeightAmount: '0.00',
  freeOverSubtotal: '',
  priority: 100,
  isActive: true,
}

/**
 * La red de entrega: dónde se llega, cómo y por cuánto.
 *
 * Es la ÚNICA parte del dominio logístico que se escribe desde aquí, y no es
 * casualidad: es configuración, no despacho. Las entregas, los envíos y el
 * seguimiento se leen y se mueven con comandos.
 *
 * Tres cosas que la pantalla hace cumplir porque la base también las exige, y
 * que conviene ver antes de guardar y no en el error:
 *
 *  · **Un método nace apagado.** Publicar una opción de entrega es una
 *    decisión, no el efecto secundario de crearla.
 *  · **Solo `ship` admite transportista.** Nadie transporta un recojo ni una
 *    descarga; el selector desaparece en las otras tres estrategias.
 *  · **Un método sin tarifa no es un método gratis**, es un método que no se
 *    puede ofrecer. Se avisa en la tabla en vez de dejar que el comprador lo
 *    descubra en el checkout.
 */
export function NetworkSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore, can } = useTenant()
  const canWrite = can('tenant.manage')

  const scope =
    tenant && activeCompanyId && activeStore
      ? {
          organizationId: tenant.organization_id,
          companyId: activeCompanyId,
          storeId: activeStore.id,
        }
      : null

  const zones = useDeliveryZones(activeStore?.id ?? null)
  const methods = useDeliveryMethods(activeStore?.id ?? null)
  const rates = useDeliveryRates(activeStore?.id ?? null)
  const carriers = useCarriers()

  const saveZone = useSaveZone(scope)
  const removeZone = useDeleteZone()
  const saveMethod = useSaveMethod(scope)
  const removeMethod = useDeleteMethod()
  const saveRate = useSaveRate(scope)
  const removeRate = useDeleteRate()

  const [zoneDrawer, setZoneDrawer] = useState<{ open: boolean; zone: DeliveryZone | null }>({
    open: false,
    zone: null,
  })
  const [zoneValues, setZoneValues] = useState<ZoneFormValues>(EMPTY_ZONE)
  const [methodDrawer, setMethodDrawer] = useState<{
    open: boolean
    method: DeliveryMethod | null
  }>({ open: false, method: null })
  const [methodValues, setMethodValues] = useState<MethodFormValues>(EMPTY_METHOD)
  const [rateDrawer, setRateDrawer] = useState<{ open: boolean; rate: DeliveryRate | null }>({
    open: false,
    rate: null,
  })
  const [rateValues, setRateValues] = useState<RateFormValues>(EMPTY_RATE)

  useEffect(() => {
    if (!zoneDrawer.open) return
    setZoneValues(
      zoneDrawer.zone
        ? {
            id: zoneDrawer.zone.id,
            code: zoneDrawer.zone.code,
            name: zoneDrawer.zone.name,
            country: zoneDrawer.zone.country,
            regions: zoneDrawer.zone.regions.join(', '),
            postalPrefixes: zoneDrawer.zone.postal_prefixes.join(', '),
            priority: zoneDrawer.zone.priority,
            isActive: zoneDrawer.zone.is_active,
          }
        : EMPTY_ZONE,
    )
  }, [zoneDrawer])

  useEffect(() => {
    if (!methodDrawer.open) return
    setMethodValues(
      methodDrawer.method
        ? {
            id: methodDrawer.method.id,
            code: methodDrawer.method.code,
            displayName: methodDrawer.method.display_name,
            strategy: methodDrawer.method.strategy,
            description: methodDrawer.method.description ?? '',
            providerCode: methodDrawer.method.provider_code ?? '',
            sourcing: methodDrawer.method.sourcing,
            leadTimeMinDays: methodDrawer.method.lead_time_min_days,
            leadTimeMaxDays: methodDrawer.method.lead_time_max_days,
            requiresWindow: methodDrawer.method.requires_window,
            isActive: methodDrawer.method.is_active,
            position: methodDrawer.method.position,
            instructions: methodDrawer.method.instructions ?? '',
          }
        : EMPTY_METHOD,
    )
  }, [methodDrawer])

  useEffect(() => {
    if (!rateDrawer.open) return
    setRateValues(
      rateDrawer.rate
        ? {
            id: rateDrawer.rate.id,
            deliveryMethodId: rateDrawer.rate.delivery_method_id,
            zoneId: rateDrawer.rate.zone_id ?? '',
            currency: rateDrawer.rate.currency,
            baseAmount: rateDrawer.rate.base_amount,
            perItemAmount: rateDrawer.rate.per_item_amount,
            perWeightAmount: rateDrawer.rate.per_weight_amount,
            freeOverSubtotal: rateDrawer.rate.free_over_subtotal ?? '',
            priority: rateDrawer.rate.priority,
            isActive: rateDrawer.rate.is_active,
          }
        : {
            ...EMPTY_RATE,
            deliveryMethodId: methods.data?.[0]?.id ?? '',
            currency: activeStore?.currency ?? 'PEN',
          },
    )
  }, [rateDrawer, methods.data, activeStore])

  function report(error: unknown) {
    const key: MessageKey =
      error instanceof FulfillmentError ? error.key : 'fulfillment.error.generic'
    notify(t(key), 'error')
  }

  const methodList = methods.data ?? []
  const rateList = rates.data ?? []
  const zoneList = zones.data ?? []
  const carrierAllowed = methodValues.strategy === 'ship'

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(methodList)

  return (
    <Stack spacing={4}>
      {/* ---------------- Tiendas de recojo (2026-11-15) ------------------- */}
      <PickupPointsSection />

      {/* ---------------- Métodos ------------------------------------------ */}
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle1">{t('fulfillment.methods.title')}</Typography>
          <Button
            variant="contained"
            size="small"
            disabled={!canWrite || !activeStore}
            onClick={() => setMethodDrawer({ open: true, method: null })}
          >
            {t('fulfillment.methods.new')}
          </Button>
        </Stack>
        <Typography sx={{ color: 'var(--muted)' }}>{t('fulfillment.methods.help')}</Typography>

        <Card>
          {methods.isPending && <TableSkeleton columns={5} />}
          {methods.isError && (
            <ErrorState error={methods.error} onRetry={() => void methods.refetch()} />
          )}
          {!methods.isPending && !methods.isError && methodList.length === 0 && (
            <EmptyState
              title={t('fulfillment.methods.empty')}
              description={t('fulfillment.methods.emptyBody')}
              icon={<MapRoundedIcon fontSize="small" />}
            />
          )}
          {!methods.isPending && !methods.isError && methodList.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('fulfillment.field.code')}</TableCell>
                  <TableCell>{t('fulfillment.field.methodName')}</TableCell>
                  <TableCell>{t('fulfillment.field.strategy')}</TableCell>
                  <TableCell>{t('fulfillment.field.carrier')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pager.rows.map((method) => {
                  const hasRate = rateList.some(
                    (rate) => rate.delivery_method_id === method.id && rate.is_active,
                  )
                  return (
                    <TableRow key={method.id} hover>
                      <TableCell>{method.code}</TableCell>
                      <TableCell>{method.display_name}</TableCell>
                      <TableCell>
                        {t(`fulfillment.strategy.${method.strategy}` as MessageKey)}
                      </TableCell>
                      <TableCell>
                        {method.provider_code ?? (
                          <StatusChip label={t('fulfillment.method.own')} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          <StatusChip
                            tone={method.is_active ? 'success' : 'default'}
                            label={t(
                              method.is_active
                                ? 'fulfillment.state.active'
                                : 'fulfillment.state.inactive',
                            )}
                          />
                          {/* Sin tarifa no es gratis: es imposible de ofrecer. */}
                          {method.is_active && !hasRate && method.strategy !== 'pickup' && (
                            <StatusChip
                              tone="warning"
                              label={t('fulfillment.methods.noRate')}
                            />
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <RowActions
                          actions={[
                            {
                              id: '0',
                              icon: <EditRoundedIcon fontSize="small" />,
                              label: t('common.edit'),
                              tone: 'neutral',
                              disabled: !canWrite,
                              onClick: () => setMethodDrawer({ open: true, method }),
                            },
                            {
                              id: '1',
                              icon: <DeleteRoundedIcon fontSize="small" />,
                              label: t('common.delete'),
                              tone: 'danger',
                              disabled: !canWrite,
                              onClick: async () => {
                                try {
                                  await removeMethod.mutateAsync(method.id)
                                  notify(t('fulfillment.methods.deleted'), 'success')
                                } catch (error) {
                                  report(error)
                                }
                              },
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
          {/* El paginador solo aparece cuando hay algo que paginar: un
              "0-0 de 0" bajo un estado vacio es ruido que contradice al
              propio estado vacio. */}
          {pager.total > 0 && (
            <TablePager
              page={pager.page}
              pageSize={pager.pageSize}
              total={pager.total}
              onPageChange={pager.setPage}
            />
          )}
        </Card>
      </Stack>

      {/* ---------------- Zonas -------------------------------------------- */}
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle1">{t('fulfillment.zones.title')}</Typography>
          <Button
            variant="contained"
            size="small"
            disabled={!canWrite || !activeStore}
            onClick={() => setZoneDrawer({ open: true, zone: null })}
          >
            {t('fulfillment.zones.new')}
          </Button>
        </Stack>
        <Typography sx={{ color: 'var(--muted)' }}>{t('fulfillment.zones.help')}</Typography>

        <Card>
          {zones.isPending && <TableSkeleton columns={4} />}
          {zones.isError && <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />}
          {!zones.isPending && !zones.isError && zoneList.length === 0 && (
            <EmptyState
              title={t('fulfillment.zones.empty')}
              description={t('fulfillment.zones.emptyBody')}
              icon={<MapRoundedIcon fontSize="small" />}
            />
          )}
          {!zones.isPending && !zones.isError && zoneList.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('fulfillment.field.code')}</TableCell>
                  <TableCell>{t('fulfillment.field.zoneName')}</TableCell>
                  <TableCell>{t('fulfillment.field.coverage')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {zoneList.map((zone) => (
                  <TableRow key={zone.id} hover>
                    <TableCell>{zone.code}</TableCell>
                    <TableCell>{zone.name}</TableCell>
                    <TableCell>
                      {zone.country}
                      {zone.regions.length > 0 ? ` · ${zone.regions.join(', ')}` : ''}
                      {zone.postal_prefixes.length > 0
                        ? ` · ${zone.postal_prefixes.join(', ')}`
                        : ''}
                    </TableCell>
                    <TableCell align="right">
                      <RowActions
                        actions={[
                          {
                            id: '0',
                            icon: <EditRoundedIcon fontSize="small" />,
                            label: `${t('common.edit')}: ${zone.name}`,
                            tone: 'neutral',
                            disabled: !canWrite,
                            onClick: () => setZoneDrawer({ open: true, zone }),
                          },
                          {
                            id: '1',
                            icon: <DeleteRoundedIcon fontSize="small" />,
                            label: `${t('common.delete')}: ${zone.name}`,
                            tone: 'danger',
                            disabled: !canWrite,
                            onClick: async () => {
                              try {
                                await removeZone.mutateAsync(zone.id)
                                notify(t('fulfillment.zones.deleted'), 'success')
                              } catch (error) {
                                report(error)
                              }
                            },
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </Stack>

      {/* ---------------- Tarifas ------------------------------------------ */}
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle1">{t('fulfillment.rates.title')}</Typography>
          <Button
            variant="contained"
            size="small"
            disabled={!canWrite || methodList.length === 0}
            onClick={() => setRateDrawer({ open: true, rate: null })}
          >
            {t('fulfillment.rates.new')}
          </Button>
        </Stack>
        <Typography sx={{ color: 'var(--muted)' }}>{t('fulfillment.rates.help')}</Typography>

        <Card>
          {rates.isPending && <TableSkeleton columns={5} />}
          {rates.isError && <ErrorState error={rates.error} onRetry={() => void rates.refetch()} />}
          {!rates.isPending && !rates.isError && rateList.length === 0 && (
            <EmptyState
              title={t('fulfillment.rates.empty')}
              description={t('fulfillment.rates.emptyBody')}
              icon={<MapRoundedIcon fontSize="small" />}
            />
          )}
          {!rates.isPending && !rates.isError && rateList.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('fulfillment.field.method')}</TableCell>
                  <TableCell>{t('fulfillment.field.zone')}</TableCell>
                  <TableCell align="right">{t('fulfillment.field.base')}</TableCell>
                  <TableCell align="right">{t('fulfillment.field.freeOver')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rateList.map((rate) => {
                  // La tarifa no tiene nombre propio: se la nombra por su
                  // método, que es como la busca quien la va a tocar.
                  const metodo =
                    methodList.find((m) => m.id === rate.delivery_method_id)?.display_name ??
                    rate.delivery_method_id
                  return (
                    <TableRow key={rate.id} hover>
                      <TableCell>{metodo}</TableCell>
                      <TableCell>
                        {rate.zone_id === null
                          ? t('fulfillment.field.allZones')
                          : (zoneList.find((z) => z.id === rate.zone_id)?.name ?? rate.zone_id)}
                      </TableCell>
                      <TableCell align="right">
                        {rate.currency} {rate.base_amount}
                      </TableCell>
                      <TableCell align="right">
                        {rate.free_over_subtotal === null ? '—' : rate.free_over_subtotal}
                      </TableCell>
                      <TableCell align="right">
                        <RowActions
                          actions={[
                            {
                              id: '0',
                              icon: <EditRoundedIcon fontSize="small" />,
                              label: `${t('common.edit')}: ${metodo}`,
                              tone: 'neutral',
                              disabled: !canWrite,
                              onClick: () => setRateDrawer({ open: true, rate }),
                            },
                            {
                              id: '1',
                              icon: <DeleteRoundedIcon fontSize="small" />,
                              label: `${t('common.delete')}: ${metodo}`,
                              tone: 'danger',
                              disabled: !canWrite,
                              onClick: async () => {
                                try {
                                  await removeRate.mutateAsync(rate.id)
                                  notify(t('fulfillment.rates.deleted'), 'success')
                                } catch (error) {
                                  report(error)
                                }
                              },
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
      </Stack>

      {/* ---------------- Formularios --------------------------------------- */}
      <FormDrawer
        open={methodDrawer.open}
        title={
          methodDrawer.method ? t('fulfillment.methods.edit') : t('fulfillment.methods.new')
        }
        subtitle={activeStore?.name}
        busy={saveMethod.isPending}
        onClose={() => setMethodDrawer({ open: false, method: null })}
        actions={
          <>
            <Button onClick={() => setMethodDrawer({ open: false, method: null })}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={saveMethod.isPending}
              onClick={async () => {
                try {
                  await saveMethod.mutateAsync(methodValues)
                  notify(t('fulfillment.methods.saved'), 'success')
                  setMethodDrawer({ open: false, method: null })
                } catch (error) {
                  report(error)
                }
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <Field
            rule="lowerCode"
            maxLength={41}
            help={t('help.fulfillment.methodCode')}
            label={t('fulfillment.field.code')}
            value={methodValues.code}
            disabled={Boolean(methodValues.id)}
            onChange={(event) => setMethodValues((v) => ({ ...v, code: event.target.value }))}
            helperText={t('fulfillment.field.codeHelp')}
          />
          <Field
            rule="text"
            maxLength={120}
            label={t('fulfillment.field.methodName')}
            value={methodValues.displayName}
            onChange={(event) =>
              setMethodValues((v) => ({ ...v, displayName: event.target.value }))
            }
          />
          <SelectField
            label={t('fulfillment.field.strategy')}
            value={methodValues.strategy}
            onChange={(event) =>
              setMethodValues((v) => ({
                ...v,
                strategy: event.target.value as typeof v.strategy,
                // Nadie transporta un recojo ni una descarga: la base lo exige
                // con un CHECK y aquí se limpia antes de intentarlo.
                providerCode: event.target.value === 'ship' ? v.providerCode : '',
              }))
            }
          >
            {DELIVERY_STRATEGIES.map((strategy) => (
              <MenuItem key={strategy} value={strategy}>
                {t(`fulfillment.strategy.${strategy}` as MessageKey)}
              </MenuItem>
            ))}
          </SelectField>
          {carrierAllowed ? (
            <SelectField
              label={t('fulfillment.field.carrier')}
              value={methodValues.providerCode}
              onChange={(event) =>
                setMethodValues((v) => ({ ...v, providerCode: event.target.value }))
              }
              helperText={t('fulfillment.field.carrierHelp')}
            >
              <MenuItem value="">{t('fulfillment.method.own')}</MenuItem>
              {(carriers.data ?? []).map((carrier) => (
                <MenuItem key={carrier.code} value={carrier.code}>
                  {carrier.name}
                </MenuItem>
              ))}
            </SelectField>
          ) : (
            <Alert severity="info">{t('fulfillment.field.noCarrierHelp')}</Alert>
          )}
          <SelectField
            label={t('fulfillment.field.sourcing')}
            value={methodValues.sourcing}
            onChange={(event) =>
              setMethodValues((v) => ({ ...v, sourcing: event.target.value as typeof v.sourcing }))
            }
            helperText={t('fulfillment.field.sourcingHelp')}
          >
            {SOURCING_STRATEGIES.map((entry) => (
              <MenuItem key={entry} value={entry}>
                {t(`fulfillment.sourcing.${entry}` as MessageKey)}
              </MenuItem>
            ))}
          </SelectField>
          <Stack direction="row" spacing={2}>
            <Field
              rule="integer"
              maxLength={3}
              help={t('help.fulfillment.leadDays')}
              label={t('fulfillment.field.leadMin')}
              type="number"
              value={methodValues.leadTimeMinDays}
              onChange={(event) =>
                setMethodValues((v) => ({ ...v, leadTimeMinDays: Number(event.target.value) || 0 }))
              }
            />
            <Field
              rule="integer"
              maxLength={3}
              help={t('help.fulfillment.leadDays')}
              label={t('fulfillment.field.leadMax')}
              type="number"
              value={methodValues.leadTimeMaxDays}
              onChange={(event) =>
                setMethodValues((v) => ({ ...v, leadTimeMaxDays: Number(event.target.value) || 0 }))
              }
            />
          </Stack>
          <Field
            rule="longText"
            label={t('fulfillment.field.instructions')}
            value={methodValues.instructions}
            multiline
            minRows={2}
            onChange={(event) =>
              setMethodValues((v) => ({ ...v, instructions: event.target.value }))
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={methodValues.isActive}
                onChange={(event) =>
                  setMethodValues((v) => ({ ...v, isActive: event.target.checked }))
                }
              />
            }
            label={t('fulfillment.field.active')}
          />
        </Stack>
      </FormDrawer>

      <FormDrawer
        open={zoneDrawer.open}
        title={zoneDrawer.zone ? t('fulfillment.zones.edit') : t('fulfillment.zones.new')}
        subtitle={activeStore?.name}
        busy={saveZone.isPending}
        onClose={() => setZoneDrawer({ open: false, zone: null })}
        actions={
          <>
            <Button onClick={() => setZoneDrawer({ open: false, zone: null })}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={saveZone.isPending}
              onClick={async () => {
                try {
                  await saveZone.mutateAsync(zoneValues)
                  notify(t('fulfillment.zones.saved'), 'success')
                  setZoneDrawer({ open: false, zone: null })
                } catch (error) {
                  report(error)
                }
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <Field
            rule="lowerCode"
            maxLength={41}
            help={t('help.fulfillment.zoneCode')}
            label={t('fulfillment.field.code')}
            value={zoneValues.code}
            disabled={Boolean(zoneValues.id)}
            onChange={(event) => setZoneValues((v) => ({ ...v, code: event.target.value }))}
          />
          <Field
            rule="text"
            maxLength={120}
            label={t('fulfillment.field.zoneName')}
            value={zoneValues.name}
            onChange={(event) => setZoneValues((v) => ({ ...v, name: event.target.value }))}
          />
          <Field
            rule="country"
            label={t('fulfillment.field.country')}
            value={zoneValues.country}
            onChange={(event) => setZoneValues((v) => ({ ...v, country: event.target.value }))}
            helperText={t('fulfillment.field.countryHelp')}
          />
          <Field
            rule="longText"
            label={t('fulfillment.field.regions')}
            value={zoneValues.regions}
            onChange={(event) => setZoneValues((v) => ({ ...v, regions: event.target.value }))}
            helperText={t('fulfillment.field.regionsHelp')}
          />
          <Field
            rule="longText"
            label={t('fulfillment.field.postalPrefixes')}
            value={zoneValues.postalPrefixes}
            onChange={(event) =>
              setZoneValues((v) => ({ ...v, postalPrefixes: event.target.value }))
            }
            helperText={t('fulfillment.field.postalPrefixesHelp')}
          />
          <Field
            rule="integer"
            maxLength={4}
            label={t('fulfillment.field.priority')}
            type="number"
            value={zoneValues.priority}
            onChange={(event) =>
              setZoneValues((v) => ({ ...v, priority: Number(event.target.value) || 0 }))
            }
            helperText={t('fulfillment.field.priorityHelp')}
          />
          <FormControlLabel
            control={
              <Switch
                checked={zoneValues.isActive}
                onChange={(event) =>
                  setZoneValues((v) => ({ ...v, isActive: event.target.checked }))
                }
              />
            }
            label={t('fulfillment.field.active')}
          />
        </Stack>
      </FormDrawer>

      <FormDrawer
        open={rateDrawer.open}
        title={rateDrawer.rate ? t('fulfillment.rates.edit') : t('fulfillment.rates.new')}
        subtitle={activeStore?.name}
        busy={saveRate.isPending}
        onClose={() => setRateDrawer({ open: false, rate: null })}
        actions={
          <>
            <Button onClick={() => setRateDrawer({ open: false, rate: null })}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={saveRate.isPending}
              onClick={async () => {
                try {
                  await saveRate.mutateAsync(rateValues)
                  notify(t('fulfillment.rates.saved'), 'success')
                  setRateDrawer({ open: false, rate: null })
                } catch (error) {
                  report(error)
                }
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={2}>
          <SelectField
            label={t('fulfillment.field.method')}
            value={rateValues.deliveryMethodId}
            onChange={(event) =>
              setRateValues((v) => ({ ...v, deliveryMethodId: event.target.value }))
            }
          >
            {methodList.map((method) => (
              <MenuItem key={method.id} value={method.id}>
                {method.display_name}
              </MenuItem>
            ))}
          </SelectField>
          <SelectField
            label={t('fulfillment.field.zone')}
            value={rateValues.zoneId}
            onChange={(event) => setRateValues((v) => ({ ...v, zoneId: event.target.value }))}
            helperText={t('fulfillment.field.zoneHelp')}
          >
            <MenuItem value="">{t('fulfillment.field.allZones')}</MenuItem>
            {zoneList.map((zone) => (
              <MenuItem key={zone.id} value={zone.id}>
                {zone.name}
              </MenuItem>
            ))}
          </SelectField>
          <Field
            rule="money"
            help={t('help.fulfillment.baseAmount')}
            label={t('fulfillment.field.base')}
            value={rateValues.baseAmount}
            onChange={(event) => setRateValues((v) => ({ ...v, baseAmount: event.target.value }))}
          />
          <Field
            rule="money"
            help={t('help.fulfillment.perItemAmount')}
            label={t('fulfillment.field.perItem')}
            value={rateValues.perItemAmount}
            onChange={(event) =>
              setRateValues((v) => ({ ...v, perItemAmount: event.target.value }))
            }
          />
          <Field
            rule="money"
            label={t('fulfillment.field.perWeight')}
            value={rateValues.perWeightAmount}
            onChange={(event) =>
              setRateValues((v) => ({ ...v, perWeightAmount: event.target.value }))
            }
            helperText={t('fulfillment.field.perWeightHelp')}
          />
          <Field
            rule="money"
            label={t('fulfillment.field.freeOver')}
            value={rateValues.freeOverSubtotal}
            onChange={(event) =>
              setRateValues((v) => ({ ...v, freeOverSubtotal: event.target.value }))
            }
            helperText={t('fulfillment.field.freeOverHelp')}
          />
          <Field
            rule="integer"
            maxLength={4}
            help={t('help.fulfillment.ratePriority')}
            label={t('fulfillment.field.priority')}
            type="number"
            value={rateValues.priority}
            onChange={(event) =>
              setRateValues((v) => ({ ...v, priority: Number(event.target.value) || 0 }))
            }
          />
        </Stack>
      </FormDrawer>
    </Stack>
  )
}
