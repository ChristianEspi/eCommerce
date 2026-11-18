import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import { RowActions } from '@/shared/ui/RowActions'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import WarehouseRoundedIcon from '@mui/icons-material/WarehouseRounded'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
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
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { SearchField } from '@/shared/ui/SearchField'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { InventoryError } from './errors'
import { planSupplyToggle } from './storeSupply'
import {
  useLinkStoreWarehouse,
  useSaveWarehouse,
  useSeedInventory,
  useStoreWarehouses,
  useUnlinkStoreWarehouse,
  useWarehouses,
} from './hooks'
import {
  INVENTORY_SOURCES,
  STALENESS_POLICIES,
  WAREHOUSE_KINDS,
  warehouseFormSchema,
  type Warehouse,
  type WarehouseFormValues,
} from './types'
import { Field } from '@/shared/ui/Field'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Almacenes de la sociedad y qué tienda se sirve de cuáles.
 *
 * Las dos cosas van juntas porque la pregunta que trae aquí al operador es
 * siempre la misma —«¿de dónde sale lo que vendo?»— y separarlas en dos
 * pantallas obliga a recordar el código del almacén de una a otra.
 *
 * La fila de vínculos dice explícitamente qué pasa cuando no hay ninguno: la
 * tienda se sirve de todos. Es la regla que evita que dar de alta el primer
 * almacén deje la tienda sin vender, y si no está escrita donde se configura,
 * se descubre al revés — vendiendo de un almacén que no tocaba.
 */
export function WarehousesSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { tenant, activeCompanyId, activeStore, can } = useTenant()
  const canWrite = can('tenant.manage')

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ open: boolean; warehouse: Warehouse | null }>({
    open: false,
    warehouse: null,
  })

  const query = useWarehouses()
  const links = useStoreWarehouses(activeStore?.id ?? null)
  const save = useSaveWarehouse()
  const link = useLinkStoreWarehouse()
  const unlink = useUnlinkStoreWarehouse()
  const seed = useSeedInventory()

  const warehouses = useMemo(() => {
    const term = search.trim().toLowerCase()
    const all = query.data ?? []
    if (!term) return all
    return all.filter(
      (w) => w.name.toLowerCase().includes(term) || w.code.toLowerCase().includes(term),
    )
  }, [query.data, search])

  const linkedIds = useMemo(
    () => new Set((links.data ?? []).filter((l) => l.is_active).map((l) => l.warehouse_id)),
    [links.data],
  )

  const isEmpty = !query.isPending && !query.isError && warehouses.length === 0

  /**
   * El interruptor dice «abastece» y hace eso en los dos modos; la decisión
   * está en `planSupplyToggle` (ver allí por qué, y el fallo que la motivó).
   */
  async function toggleLink(warehouse: Warehouse) {
    if (!tenant || !activeCompanyId || !activeStore) return
    const all = query.data ?? []
    const plan = planSupplyToggle(warehouse.id, all, links.data ?? [])
    if (plan.kind === 'lastOne') {
      notify(t('inventory.warehouses.lastOne'), 'warning')
      return
    }

    const scope = { organizationId: tenant.organization_id, companyId: activeCompanyId }
    const vincular = async (id: string) => {
      const target = all.find((w) => w.id === id)
      if (!target) return
      await link.mutateAsync({ scope, storeId: activeStore.id, warehouseId: id, priority: target.priority })
    }

    if (plan.kind === 'unlink' || plan.kind === 'relink') await unlink.mutateAsync(plan.linkId)
    if (plan.kind === 'relink') await vincular(plan.warehouseId)
    if (plan.kind === 'link') for (const id of plan.warehouseIds) await vincular(id)
    notify(t('inventory.toast.saved'))
  }

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows(warehouses)

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('inventory.warehouses.help')}</Typography>

      {linkedIds.size === 0 && (
        <Alert severity="info">{t('inventory.warehouses.allServe')}</Alert>
      )}

      <FilterBar
        actions={
          canWrite && (
            <Button variant="contained" onClick={() => setEditing({ open: true, warehouse: null })}>
              {t('inventory.warehouses.new')}
            </Button>
          )
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField value={search} onChange={setSearch} placeholder={t('inventory.search')} />
        </Box>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={5} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('inventory.noResults') : t('inventory.warehouses.empty')}
            description={search ? undefined : t('inventory.warehouses.emptyBody')}
            icon={<WarehouseRoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && warehouses.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('inventory.field.code')}</TableCell>
                <TableCell>{t('inventory.field.name')}</TableCell>
                <TableCell>{t('inventory.field.source')}</TableCell>
                <TableCell>{t('inventory.field.serves')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((warehouse) => (
                <TableRow key={warehouse.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{warehouse.code}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <span>{warehouse.name}</span>
                      {warehouse.is_default && (
                        <StatusChip label={t('inventory.field.default')} />
                      )}
                      {warehouse.allows_backorder && (
                        <StatusChip tone="warning" label={t('inventory.field.backorder')} />
                      )}
                      {!warehouse.is_active && (
                        <StatusChip label={t('common.no')} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      tone={warehouse.source === 'erp' ? 'info' : 'default'}
                      label={t(`inventory.source.${warehouse.source}` as MessageKey)}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={linkedIds.size === 0 || linkedIds.has(warehouse.id)}
                      disabled={!canWrite || !activeStore}
                      onChange={() => void toggleLink(warehouse)}
                      inputProps={{ 'aria-label': `${t('inventory.field.serves')}: ${warehouse.code}` }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <RowActions
                      actions={[
                        {
                          id: '0',
                          icon: <TuneRoundedIcon fontSize="small" />,
                          label: `${t('inventory.warehouses.seed')}: ${warehouse.code}`,
                          tone: 'accent',
                          disabled: !(canWrite && activeStore),
                          onClick: async () => {
                            // `disabled` lo impide en la interfaz, pero eso no estrecha el
                            // tipo: sin esto, `activeStore.id` es un fallo en tiempo de
                            // ejecucion esperando a que alguien cambie el `disabled`.
                            if (!activeStore) return
                            try {
                              const seeded = await seed.mutateAsync({
                                warehouseId: warehouse.id,
                                storeId: activeStore.id,
                              })
                              notify(`${t('inventory.toast.seeded')} (${seeded})`)
                            } catch (error) {
                              notify(
                                t(error instanceof InventoryError ? error.key : 'inventory.error.generic'),
                                'error',
                              )
                            }
                          },
                        },
                        {
                          id: '1',
                          icon: <EditRoundedIcon fontSize="small" />,
                          label: `${t('common.edit')}: ${warehouse.name}`,
                          tone: 'neutral',
                          onClick: () => setEditing({ open: true, warehouse }),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
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

      <WarehouseDrawer
        open={editing.open}
        warehouse={editing.warehouse}
        canWrite={canWrite}
        onClose={() => setEditing({ open: false, warehouse: null })}
        onSubmit={async (values) => {
          if (!tenant || !activeCompanyId) return
          await save.mutateAsync({
            id: editing.warehouse?.id ?? null,
            scope: { organizationId: tenant.organization_id, companyId: activeCompanyId },
            values,
          })
          notify(t('inventory.toast.saved'))
          setEditing({ open: false, warehouse: null })
        }}
      />
    </Stack>
  )
}

function WarehouseDrawer({
  open,
  warehouse,
  canWrite,
  onClose,
  onSubmit,
}: {
  open: boolean
  warehouse: Warehouse | null
  canWrite: boolean
  onClose: () => void
  onSubmit: (values: WarehouseFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: {
      code: '',
      name: '',
      kind: 'warehouse',
      source: 'local',
      stale_policy: 'unknown',
      stale_minutes: null,
      allows_backorder: false,
      priority: 100,
      is_active: true,
      is_default: false,
      city: '',
      country: '',
    },
  })

  const source = watch('source')

  useEffect(() => {
    if (!open) return
    setServerError(null)
    reset({
      code: warehouse?.code ?? '',
      name: warehouse?.name ?? '',
      kind: warehouse?.kind ?? 'warehouse',
      source: warehouse?.source ?? 'local',
      stale_policy: warehouse?.stale_policy ?? 'unknown',
      stale_minutes: null,
      allows_backorder: warehouse?.allows_backorder ?? false,
      priority: warehouse?.priority ?? 100,
      is_active: warehouse?.is_active ?? true,
      is_default: warehouse?.is_default ?? false,
      city: warehouse?.city ?? '',
      country: warehouse?.country ?? '',
    })
  }, [open, warehouse, reset])

  return (
    <FormDrawer
      open={open}
      title={warehouse ? t('inventory.warehouses.edit') : t('inventory.warehouses.new')}
      subtitle={t('inventory.warehouses.help')}
      onClose={onClose}
      busy={isSubmitting}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={!canWrite || isSubmitting}
            onClick={handleSubmit(async (values) => {
              try {
                await onSubmit(values)
              } catch (error) {
                setServerError(error instanceof InventoryError ? error.key : 'inventory.error.generic')
              }
            })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        {serverError && <Alert severity="error">{t(serverError)}</Alert>}

        <Field
          label={t('inventory.field.code')}
          rule="code"
          maxLength={31}
          help={t('help.inventory.warehouseCode')}
          {...register('code')}
          error={Boolean(errors.code)}
          helperText={errors.code ? t(errors.code.message as MessageKey) : undefined}
          fullWidth
        />
        <Field
          label={t('inventory.field.name')}
          rule="text"
          maxLength={160}
          {...register('name')}
          error={Boolean(errors.name)}
          helperText={errors.name ? t(errors.name.message as MessageKey) : undefined}
          fullWidth
        />

        <SelectField
          label={t('inventory.field.kind')}
          value={watch('kind')}
          onChange={(event) => setValue('kind', event.target.value as WarehouseFormValues['kind'])}
          fullWidth
        >
          {WAREHOUSE_KINDS.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {t(`inventory.kind.${kind}` as MessageKey)}
            </MenuItem>
          ))}
        </SelectField>

        <SelectField
          label={t('inventory.field.source')}
          value={source}
          onChange={(event) =>
            setValue('source', event.target.value as WarehouseFormValues['source'])
          }
          helperText={t('inventory.field.sourceHelp')}
          fullWidth
        >
          {INVENTORY_SOURCES.map((value) => (
            <MenuItem key={value} value={value}>
              {t(`inventory.source.${value}` as MessageKey)}
            </MenuItem>
          ))}
        </SelectField>

        {source === 'erp' && (
          <>
            <Field
              label={t('inventory.field.staleMinutes')}
              type="number"
              rule="integer"
              help={t('help.inventory.staleMinutes')}
              {...register('stale_minutes', { setValueAs: (v) => (v === '' ? null : Number(v)) })}
              error={Boolean(errors.stale_minutes)}
              helperText={
                errors.stale_minutes
                  ? t(errors.stale_minutes.message as MessageKey)
                  : t('inventory.field.staleMinutesHelp')
              }
              fullWidth
            />
            <SelectField
              label={t('inventory.field.stalePolicy')}
              value={watch('stale_policy')}
              onChange={(event) =>
                setValue('stale_policy', event.target.value as WarehouseFormValues['stale_policy'])
              }
              helperText={t('inventory.field.stalePolicyHelp')}
              fullWidth
            >
              {STALENESS_POLICIES.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`inventory.stale.${value}` as MessageKey)}
                </MenuItem>
              ))}
            </SelectField>
          </>
        )}

        <Field
          label={t('inventory.field.priority')}
          type="number"
          rule="integer"
          maxLength={4}
          help={t('help.inventory.priority')}
          {...register('priority', { valueAsNumber: true })}
          helperText={t('inventory.field.priorityHelp')}
          fullWidth
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Field label={t('inventory.field.city')} rule="text" maxLength={120} {...register('city')} fullWidth />
          <Field
            label={t('inventory.field.country')}
            rule="country"
            help={t('help.inventory.country')}
            {...register('country')}
            error={Boolean(errors.country)}
            helperText={errors.country ? t(errors.country.message as MessageKey) : undefined}
            fullWidth
          />
        </Stack>

        <FormControlLabel
          control={
            <Switch
              checked={watch('allows_backorder')}
              onChange={(event) => setValue('allows_backorder', event.target.checked)}
            />
          }
          label={t('inventory.field.backorderLabel')}
        />
        <Typography sx={{ color: 'var(--muted)', fontSize: 13, mt: -1 }}>
          {t('inventory.field.backorderHelp')}
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={watch('is_default')}
              onChange={(event) => setValue('is_default', event.target.checked)}
            />
          }
          label={t('inventory.field.defaultLabel')}
        />
        <FormControlLabel
          control={
            <Switch
              checked={watch('is_active')}
              onChange={(event) => setValue('is_active', event.target.checked)}
            />
          }
          label={t('inventory.field.active')}
        />
      </Stack>
    </FormDrawer>
  )
}
