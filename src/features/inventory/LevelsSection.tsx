import { usePagedRows } from '@/shared/ui/usePagedRows'
import { TablePager } from '@/shared/ui/TablePager'
import { FilterBar } from '@/shared/ui/FilterBar'
import { StatusChip } from '@/shared/ui/StatusChip'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
  Button,
  Card,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTenant } from '@/features/tenant/tenant-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { FormDrawer } from '@/shared/ui/FormDrawer'
import { SearchField } from '@/shared/ui/SearchField'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { TableSkeleton } from '@/shared/ui/TableSkeleton'
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { InventoryError } from './errors'
import {
  useAdjustInventory,
  useLevels,
  useSetInventoryPolicy,
  useStockProductSearch,
  useStockVariants,
  useStoreWarehouses,
  useWarehouses,
} from './hooks'
import {
  MANUAL_MOVEMENT_KINDS,
  formatQuantity,
  movementFormSchema,
  policyFormSchema,
  requiredSign,
  type LevelRow,
  type MovementFormValues,
  type PolicyFormValues,
} from './types'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * Existencias por almacén.
 *
 * Cuatro columnas de cantidad y ninguna es decorativa: **físico** es lo que hay
 * en la estantería, **comprometido** lo que ya tiene dueño aunque siga ahí,
 * **disponible** la resta de los dos, y **colchón** lo que no se vende aunque
 * esté. Un operador que solo ve una cifra no puede explicar por qué la tienda
 * dice «agotado» con el almacén lleno, que es la llamada que este dominio
 * existe para que no ocurra.
 *
 * No hay campo para escribir el físico. Las entradas y las correcciones son
 * MOVIMIENTOS con motivo, porque una existencia que se puede sobrescribir es
 * una existencia sin historia.
 */
export function LevelsSection() {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const { activeStore, can } = useTenant()
  const canWrite = can('catalog.write')

  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState<string>('')
  const [movementOpen, setMovementOpen] = useState(false)
  const [policyFor, setPolicyFor] = useState<LevelRow | null>(null)

  const term = useDebouncedValue(search, 250)
  const warehouses = useWarehouses()
  const query = useLevels(activeStore?.id ?? null, warehouseId || null, term)
  const adjust = useAdjustInventory()
  const policy = useSetInventoryPolicy()

  const isEmpty = !query.isPending && !query.isError && (query.data ?? []).length === 0
  const noWarehouses = !warehouses.isPending && (warehouses.data ?? []).length === 0

  // Pagina lo que YA esta cargado: es para poder leer la tabla, no para
  // aligerar la consulta. Va ANTES de la primera guarda con retorno,
  // porque un hook detras de un `return` cambia de orden entre renders.
  // Ver `usePagedRows`.
  const pager = usePagedRows((query.data ?? []))

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'var(--muted)' }}>{t('inventory.levels.help')}</Typography>

      {noWarehouses && <Alert severity="info">{t('inventory.levels.noWarehouses')}</Alert>}

      <FilterBar
        actions={
          canWrite && !noWarehouses && (
            <Button variant="contained" onClick={() => setMovementOpen(true)}>
              {t('inventory.levels.newMovement')}
            </Button>
          )
        }
      >
        <Box sx={{ minWidth: { xs: '100%', sm: 280 } }}>
          <SearchField value={search} onChange={setSearch} placeholder={t('inventory.levels.search')} />
        </Box>
        <SelectField
          size="small"
          label={t('inventory.field.warehouse')}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{t('inventory.field.allWarehouses')}</MenuItem>
          {(warehouses.data ?? []).map((warehouse) => (
            <MenuItem key={warehouse.id} value={warehouse.id}>
              {warehouse.code} · {warehouse.name}
            </MenuItem>
          ))}
        </SelectField>
      </FilterBar>

      <Card>
        {query.isPending && <TableSkeleton columns={6} />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {isEmpty && (
          <EmptyState
            title={search ? t('inventory.noResults') : t('inventory.levels.empty')}
            description={search ? undefined : t('inventory.levels.emptyBody')}
            icon={<Inventory2RoundedIcon fontSize="small" />}
          />
        )}
        {!query.isPending && !query.isError && (query.data ?? []).length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>SKU</TableCell>
                <TableCell>{t('inventory.field.warehouse')}</TableCell>
                <TableCell align="right">{t('inventory.field.onHand')}</TableCell>
                <TableCell align="right">{t('inventory.field.reserved')}</TableCell>
                <TableCell align="right">{t('inventory.field.available')}</TableCell>
                <TableCell align="right">{t('inventory.field.safety')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pager.rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Stack>
                      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{row.sku}</Typography>
                      <Typography sx={{ color: 'var(--muted)', fontSize: 12 }}>{row.name}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{row.warehouseCode}</TableCell>
                  <TableCell align="right">{formatQuantity(row.on_hand_qty)}</TableCell>
                  <TableCell align="right">{formatQuantity(row.reserved_qty)}</TableCell>
                  <TableCell align="right">
                    <StatusChip
                      tone={
                        row.available_qty < 0
                          ? 'error'
                          : row.available_qty <= row.reorder_point
                            ? 'warning'
                            : 'success'
                      }
                      label={formatQuantity(row.available_qty)}
                    />
                  </TableCell>
                  <TableCell align="right">{formatQuantity(row.safety_stock)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      disabled={!canWrite}
                      onClick={() => setPolicyFor(row)}
                      aria-label={`${t('inventory.levels.policy')}: ${row.sku}`}
                    >
                      {t('inventory.levels.policy')}
                    </Button>
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

      <MovementDrawer
        open={movementOpen}
        canWrite={canWrite}
        onClose={() => setMovementOpen(false)}
        onSubmit={async (values) => {
          await adjust.mutateAsync(values)
          notify(t('inventory.toast.moved'))
          setMovementOpen(false)
        }}
      />

      <PolicyDrawer
        level={policyFor}
        canWrite={canWrite}
        onClose={() => setPolicyFor(null)}
        onSubmit={async (values) => {
          await policy.mutateAsync(values)
          notify(t('inventory.toast.saved'))
          setPolicyFor(null)
        }}
      />
    </Stack>
  )
}

function MovementDrawer({
  open,
  canWrite,
  onClose,
  onSubmit,
}: {
  open: boolean
  canWrite: boolean
  onClose: () => void
  onSubmit: (values: MovementFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const { activeStore } = useTenant()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [productTerm, setProductTerm] = useState('')

  const warehouses = useWarehouses(open)
  const links = useStoreWarehouses(open ? (activeStore?.id ?? null) : null)
  const debounced = useDebouncedValue(productTerm, 250)
  const products = useStockProductSearch(activeStore?.id ?? null, debounced, open)

  const {
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MovementFormValues>({
    resolver: zodResolver(movementFormSchema),
    defaultValues: {
      warehouse_id: '',
      product_id: '',
      variant_id: null,
      kind: 'receipt',
      quantity: 1,
      reason: '',
    },
  })

  const productId = watch('product_id')
  const kind = watch('kind')
  const variants = useStockVariants(productId || null)
  /**
   * Lo elegido se guarda aparte y no se busca en los resultados: al seguir
   * escribiendo, la búsqueda cambia y el producto elegido puede no estar en
   * ella, y el campo de variante desaparecía aunque la elección siguiera viva.
   */
  const [picked, setPicked] = useState<(PickerOption & { kind: string }) | null>(null)
  const productOptions = useMemo(
    () =>
      (products.data ?? []).map((product) => ({
        id: product.id,
        primary: product.name,
        secondary: product.sku,
        kind: product.kind,
      })),
    [products.data],
  )

  useEffect(() => {
    if (!open) return
    setServerError(null)
    setProductTerm('')
    setPicked(null)
    reset({
      warehouse_id: '',
      product_id: '',
      variant_id: null,
      kind: 'receipt',
      quantity: 1,
      reason: '',
    })
  }, [open, reset])

  return (
    <FormDrawer
      open={open}
      title={t('inventory.levels.newMovement')}
      subtitle={t('inventory.levels.movementHelp')}
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

        <SelectField
          label={t('inventory.field.warehouse')}
          value={watch('warehouse_id')}
          onChange={(event) => setValue('warehouse_id', event.target.value)}
          error={Boolean(errors.warehouse_id)}
          helperText={errors.warehouse_id ? t(errors.warehouse_id.message as MessageKey) : undefined}
          fullWidth
        >
          {(warehouses.data ?? []).map((warehouse) => (
            <MenuItem key={warehouse.id} value={warehouse.id}>
              {warehouse.code} · {warehouse.name}
            </MenuItem>
          ))}
        </SelectField>

        {/* Existencias (y la vitrina) solo cuentan los almacenes que abastecen a
            la tienda. Sin este aviso, una entrada en un almacén sin vincular
            «desaparecía»: quedaba guardada pero no se veía en ningún sitio. */}
        {(() => {
          const chosen = watch('warehouse_id')
          const rows = links.data ?? []
          if (!chosen || rows.length === 0) return null
          const serves = rows.some((link) => link.warehouse_id === chosen && link.is_active)
          return serves ? null : (
            <Alert severity="warning">{t('inventory.movement.notServing')}</Alert>
          )
        })()}

        {/* Un solo campo: se escribe SKU o nombre y se elige de la lista. Abre
            con los primeros por SKU, sin tener que escribir nada. */}
        <EntityPicker
          label={t('inventory.field.product')}
          placeholder={t('inventory.levels.searchProduct')}
          term={productTerm}
          onTermChange={setProductTerm}
          options={productOptions}
          value={picked}
          onPick={(option) => {
            setPicked(productOptions.find((p) => p.id === option.id) ?? null)
            setValue('product_id', option.id, { shouldValidate: true })
            setValue('variant_id', null)
          }}
          onClear={() => {
            setPicked(null)
            setValue('product_id', '')
            setValue('variant_id', null)
          }}
          loading={products.isFetching}
          error={Boolean(errors.product_id)}
          helperText={errors.product_id ? t(errors.product_id.message as MessageKey) : undefined}
          minChars={0}
          limit={30}
        />

        {picked?.kind === 'variant' && (
          <SelectField
            label={t('inventory.field.variant')}
            value={watch('variant_id') ?? ''}
            onChange={(event) => setValue('variant_id', event.target.value || null)}
            fullWidth
          >
            {(variants.data ?? []).map((variant) => (
              <MenuItem key={variant.id} value={variant.id}>
                {variant.sku} · {variant.name}
              </MenuItem>
            ))}
          </SelectField>
        )}

        <SelectField
          label={t('inventory.field.movementKind')}
          value={kind}
          onChange={(event) =>
            setValue('kind', event.target.value as MovementFormValues['kind'])
          }
          helperText={t('inventory.field.movementKindHelp')}
          fullWidth
        >
          {MANUAL_MOVEMENT_KINDS.map((value) => (
            <MenuItem key={value} value={value}>
              {t(`inventory.movement.${value}` as MessageKey)}
            </MenuItem>
          ))}
        </SelectField>

        <TextField
          label={t('inventory.field.quantity')}
          type="number"
          {...register('quantity', { valueAsNumber: true })}
          error={Boolean(errors.quantity)}
          helperText={
            errors.quantity
              ? t(errors.quantity.message as MessageKey)
              : requiredSign(kind) === 'negative'
                ? t('inventory.field.quantityNegative')
                : requiredSign(kind) === 'positive'
                  ? t('inventory.field.quantityPositive')
                  : t('inventory.field.quantityAny')
          }
          fullWidth
        />

        <TextField
          label={t('inventory.field.reason')}
          {...register('reason')}
          multiline
          minRows={2}
          fullWidth
        />
      </Stack>
    </FormDrawer>
  )
}

function PolicyDrawer({
  level,
  canWrite,
  onClose,
  onSubmit,
}: {
  level: LevelRow | null
  canWrite: boolean
  onClose: () => void
  onSubmit: (values: PolicyFormValues) => Promise<void>
}) {
  const { t } = useI18n()
  const [serverError, setServerError] = useState<MessageKey | null>(null)

  const {
    handleSubmit,
    register,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: {
      warehouse_id: '',
      product_id: '',
      variant_id: null,
      safety_stock: 0,
      reorder_point: 0,
    },
  })

  useEffect(() => {
    if (!level) return
    setServerError(null)
    reset({
      warehouse_id: level.warehouse_id,
      product_id: level.product_id,
      variant_id: level.variant_id,
      safety_stock: level.safety_stock,
      reorder_point: level.reorder_point,
    })
  }, [level, reset])

  return (
    <FormDrawer
      open={Boolean(level)}
      title={t('inventory.levels.policy')}
      subtitle={level ? `${level.sku} · ${level.warehouseCode}` : undefined}
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
        <TextField
          label={t('inventory.field.safety')}
          type="number"
          {...register('safety_stock', { valueAsNumber: true })}
          error={Boolean(errors.safety_stock)}
          helperText={
            errors.safety_stock
              ? t(errors.safety_stock.message as MessageKey)
              : t('inventory.field.safetyHelp')
          }
          fullWidth
        />
        <TextField
          label={t('inventory.field.reorder')}
          type="number"
          {...register('reorder_point', { valueAsNumber: true })}
          error={Boolean(errors.reorder_point)}
          helperText={
            errors.reorder_point
              ? t(errors.reorder_point.message as MessageKey)
              : t('inventory.field.reorderHelp')
          }
          fullWidth
        />
      </Stack>
    </FormDrawer>
  )
}
