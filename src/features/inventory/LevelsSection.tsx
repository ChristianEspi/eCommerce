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
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  useStockLevel,
  useTransferInventory,
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
  transferFormSchema,
  type TransferFormValues,
  policyFormSchema,
  requiredSign,
  type LevelRow,
  type MovementFormValues,
  type PolicyFormValues,
} from './types'
import { Field } from '@/shared/ui/Field'
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

  // `?buscar=<sku>#existencias` (2026-11-22): el análisis IA lleva al producto
  // que señala con la lista ya filtrada, no a todo el inventario.
  const [params] = useSearchParams()
  const buscarPedido = params.get('buscar')
  const [search, setSearch] = useState(buscarPedido ?? '')
  useEffect(() => {
    if (buscarPedido) setSearch(buscarPedido)
  }, [buscarPedido])
  const [warehouseId, setWarehouseId] = useState<string>('')
  const [movementOpen, setMovementOpen] = useState(false)
  const [policyFor, setPolicyFor] = useState<LevelRow | null>(null)

  const term = useDebouncedValue(search, 250)
  const warehouses = useWarehouses()
  const query = useLevels(activeStore?.id ?? null, warehouseId || null, term)
  const adjust = useAdjustInventory()
  const transfer = useTransferInventory()
  const warehousesForToast = useWarehouses(movementOpen)
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
        onTransfer={async (values) => {
          await transfer.mutateAsync(values)
          const code = (id: string) => (warehousesForToast.data ?? []).find((w) => w.id === id)?.code ?? ''
          notify(
            t('inventory.transfer.done')
              .replace('{qty}', formatQuantity(values.quantity))
              .replace('{from}', code(values.from_warehouse_id))
              .replace('{to}', code(values.to_warehouse_id)),
          )
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

/**
 * Lo que ya se sabe al abrir el ingreso desde una alerta (2026-11-23): el
 * artículo, su variante y el almacén. «Reponer» abre el formulario listo para
 * poner la cantidad, en vez de dejar al operador buscando el producto.
 */
export interface MovementPreset {
  product_id: string
  variant_id: string | null
  warehouse_id: string | null
  sku: string
  name: string
}

export function MovementDrawer({
  open,
  canWrite,
  onClose,
  onSubmit,
  onTransfer,
  preset = null,
}: {
  open: boolean
  canWrite: boolean
  onClose: () => void
  onSubmit: (values: MovementFormValues) => Promise<void>
  onTransfer: (values: TransferFormValues) => Promise<void>
  preset?: MovementPreset | null
}) {
  const { t } = useI18n()
  const { activeStore } = useTenant()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [productTerm, setProductTerm] = useState('')
  // 2026-11-18 · Dos modos en el mismo cajón: un movimiento suelto, o un
  // traslado que sale de un almacén y entra en otro en una sola operación.
  const [modo, setModo] = useState<'movement' | 'transfer'>('movement')

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

  const traslado = useForm<TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      from_warehouse_id: '',
      to_warehouse_id: '',
      product_id: '',
      variant_id: null,
      quantity: 1,
      reason: '',
    },
  })

  // El producto y la variante son los mismos en los dos modos.
  const productId = watch('product_id')
  const variantId = watch('variant_id')
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

  const origen = modo === 'movement' ? watch('warehouse_id') : traslado.watch('from_warehouse_id')
  const destino = traslado.watch('to_warehouse_id')
  // Si el producto tiene variantes, el stock es el de la variante elegida.
  const listoParaStock = Boolean(productId) && (picked?.kind !== 'variant' || Boolean(variantId))
  const stockOrigen = useStockLevel(listoParaStock ? origen || null : null, productId || null, variantId ?? null)
  const stockDestino = useStockLevel(
    listoParaStock && modo === 'transfer' ? destino || null : null,
    productId || null,
    variantId ?? null,
  )

  const codigo = (id: string) => (warehouses.data ?? []).find((w) => w.id === id)?.code ?? ''
  const cantidadMovimiento = Number(watch('quantity'))
  const cantidadTraslado = Number(traslado.watch('quantity'))

  useEffect(() => {
    if (!open) return
    setServerError(null)
    setProductTerm('')
    setPicked(
      preset
        ? {
            id: preset.product_id,
            primary: preset.name,
            secondary: preset.sku,
            kind: preset.variant_id ? 'variant' : 'simple',
          }
        : null,
    )
    setModo('movement')
    reset({
      warehouse_id: preset?.warehouse_id ?? '',
      product_id: preset?.product_id ?? '',
      variant_id: preset?.variant_id ?? null,
      kind: 'receipt',
      quantity: 1,
      reason: '',
    })
    traslado.reset({
      from_warehouse_id: '',
      to_warehouse_id: preset?.warehouse_id ?? '',
      product_id: preset?.product_id ?? '',
      variant_id: preset?.variant_id ?? null,
      quantity: 1,
      reason: '',
    })
    // `traslado` es estable; solo se reinicia al abrir (o al cambiar de alerta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset, preset])

  function elegirProducto(id: string, variant: string | null) {
    setValue('product_id', id, { shouldValidate: Boolean(id) })
    setValue('variant_id', variant)
    traslado.setValue('product_id', id, { shouldValidate: Boolean(id) })
    traslado.setValue('variant_id', variant)
  }

  /** Lo que habrá después del movimiento, con el signo que pone el motivo. */
  function despues(): number | null {
    if (!stockOrigen.data || !Number.isFinite(cantidadMovimiento) || cantidadMovimiento === 0) return null
    const signo = requiredSign(kind) === 'negative' ? -Math.abs(cantidadMovimiento) : cantidadMovimiento
    return stockOrigen.data.on_hand + signo
  }

  const guardar = async () => {
    setServerError(null)
    try {
      if (modo === 'movement') {
        await handleSubmit(async (values) => onSubmit(values))()
      } else {
        await traslado.handleSubmit(async (values) => onTransfer(values))()
      }
    } catch (error) {
      setServerError(error instanceof InventoryError ? error.key : 'inventory.error.generic')
    }
  }

  const ocupado = isSubmitting || traslado.formState.isSubmitting
  const fmt = (n: number) => formatQuantity(n)

  function StockPanel({ id, after }: { id: string; after?: number | null }) {
    const query = id === origen ? stockOrigen : stockDestino
    if (!id || !listoParaStock) return null
    if (query.isPending) return <Skeleton variant="rounded" height={58} />
    if (!query.data) return null
    const vacio = query.data.on_hand === 0 && query.data.reserved === 0
    return (
      <Box
        data-stock-panel={codigo(id)}
        sx={{ border: '1px solid var(--border)', borderRadius: 0.67, p: 1.5, bgcolor: 'var(--bg)' }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', mb: 0.5 }}>
          {t('inventory.stock.title').replace('{warehouse}', codigo(id))}
        </Typography>
        {vacio ? (
          <Typography sx={{ fontSize: 13 }}>{t('inventory.stock.none')}</Typography>
        ) : (
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography sx={{ fontSize: 13 }}>
              {t('inventory.stock.onHand')}: <b className="tnum">{fmt(query.data.on_hand)}</b>
            </Typography>
            <Typography sx={{ fontSize: 13 }}>
              {t('inventory.stock.reserved')}: <b className="tnum">{fmt(query.data.reserved)}</b>
            </Typography>
            <Typography sx={{ fontSize: 13 }}>
              {t('inventory.stock.available')}: <b className="tnum">{fmt(query.data.available)}</b>
            </Typography>
          </Stack>
        )}
        {after !== undefined && after !== null && (
          <Typography sx={{ fontSize: 12.5, mt: 0.5, color: after < 0 ? 'var(--red)' : 'var(--accent-deep)', fontWeight: 700 }}>
            {t('inventory.stock.after').replace('{qty}', fmt(after))}
          </Typography>
        )}
      </Box>
    )
  }

  const almacenes = (warehouses.data ?? []).map((warehouse) => (
    <MenuItem key={warehouse.id} value={warehouse.id}>
      {warehouse.code} · {warehouse.name}
    </MenuItem>
  ))

  const avisoNoAbastece = (chosen: string) => {
    const rows = links.data ?? []
    if (!chosen || rows.length === 0) return null
    const serves = rows.some((link) => link.warehouse_id === chosen && link.is_active)
    return serves ? null : <Alert severity="warning">{t('inventory.movement.notServing')}</Alert>
  }

  return (
    <FormDrawer
      open={open}
      title={t('inventory.levels.newMovement')}
      subtitle={modo === 'movement' ? t('inventory.levels.movementHelp') : t('inventory.transfer.help')}
      onClose={onClose}
      busy={ocupado}
      actions={
        <>
          <Button onClick={onClose} disabled={ocupado}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" disabled={!canWrite || ocupado} onClick={() => void guardar()}>
            {modo === 'movement' ? t('common.save') : t('inventory.transfer.save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          color="primary"
          value={modo}
          onChange={(_, next: 'movement' | 'transfer' | null) => {
            if (!next) return
            setServerError(null)
            setModo(next)
            // El almacén elegido pasa de un modo al otro como origen.
            if (next === 'transfer' && watch('warehouse_id')) {
              traslado.setValue('from_warehouse_id', watch('warehouse_id'))
            }
            if (next === 'movement' && traslado.watch('from_warehouse_id')) {
              setValue('warehouse_id', traslado.watch('from_warehouse_id'))
            }
          }}
        >
          <ToggleButton value="movement">{t('inventory.mode.movement')}</ToggleButton>
          <ToggleButton value="transfer">{t('inventory.mode.transfer')}</ToggleButton>
        </ToggleButtonGroup>

        {serverError && <Alert severity="error">{t(serverError)}</Alert>}

        {modo === 'movement' ? (
          <SelectField
            label={t('inventory.field.warehouse')}
            value={watch('warehouse_id')}
            onChange={(event) => setValue('warehouse_id', event.target.value)}
            error={Boolean(errors.warehouse_id)}
            helperText={errors.warehouse_id ? t(errors.warehouse_id.message as MessageKey) : undefined}
            fullWidth
          >
            {almacenes}
          </SelectField>
        ) : (
          <SelectField
            label={t('inventory.transfer.from')}
            value={traslado.watch('from_warehouse_id')}
            onChange={(event) => traslado.setValue('from_warehouse_id', event.target.value)}
            error={Boolean(traslado.formState.errors.from_warehouse_id)}
            helperText={
              traslado.formState.errors.from_warehouse_id
                ? t(traslado.formState.errors.from_warehouse_id.message as MessageKey)
                : undefined
            }
            fullWidth
          >
            {almacenes}
          </SelectField>
        )}

        {modo === 'movement' && avisoNoAbastece(watch('warehouse_id'))}

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
            elegirProducto(option.id, null)
          }}
          onClear={() => {
            setPicked(null)
            elegirProducto('', null)
          }}
          loading={products.isFetching}
          error={Boolean(errors.product_id) || Boolean(traslado.formState.errors.product_id)}
          helperText={
            errors.product_id
              ? t(errors.product_id.message as MessageKey)
              : traslado.formState.errors.product_id
                ? t(traslado.formState.errors.product_id.message as MessageKey)
                : undefined
          }
          minChars={0}
          limit={30}
        />

        {picked?.kind === 'variant' && (
          <SelectField
            label={t('inventory.field.variant')}
            value={variantId ?? ''}
            onChange={(event) => elegirProducto(productId, event.target.value || null)}
            fullWidth
          >
            {(variants.data ?? []).map((variant) => (
              <MenuItem key={variant.id} value={variant.id}>
                {variant.sku} · {variant.name}
              </MenuItem>
            ))}
          </SelectField>
        )}

        {modo === 'movement' ? (
          <>
            <StockPanel id={watch('warehouse_id')} after={despues()} />

            <SelectField
              label={t('inventory.field.movementKind')}
              value={kind}
              onChange={(event) => setValue('kind', event.target.value as MovementFormValues['kind'])}
              helperText={
                kind === 'transfer_in' || kind === 'transfer_out'
                  ? t('inventory.transfer.useTransfer')
                  : t('inventory.field.movementKindHelp')
              }
              fullWidth
            >
              {MANUAL_MOVEMENT_KINDS.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`inventory.movement.${value}` as MessageKey)}
                </MenuItem>
              ))}
            </SelectField>

            <Field
              label={t('inventory.field.quantity')}
              type="number"
              rule="signedDecimal"
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

            <Field
              label={t('inventory.field.reason')}
              rule="longText"
              maxLength={500}
              {...register('reason')}
              multiline
              minRows={2}
              fullWidth
            />
          </>
        ) : (
          <>
            <StockPanel id={traslado.watch('from_warehouse_id')} />

            <SelectField
              label={t('inventory.transfer.to')}
              value={destino}
              onChange={(event) => traslado.setValue('to_warehouse_id', event.target.value, { shouldValidate: true })}
              error={Boolean(traslado.formState.errors.to_warehouse_id)}
              helperText={
                traslado.formState.errors.to_warehouse_id
                  ? t(traslado.formState.errors.to_warehouse_id.message as MessageKey)
                  : undefined
              }
              fullWidth
            >
              {(warehouses.data ?? [])
                .filter((w) => w.id !== traslado.watch('from_warehouse_id'))
                .map((warehouse) => (
                  <MenuItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} · {warehouse.name}
                  </MenuItem>
                ))}
            </SelectField>

            {avisoNoAbastece(destino)}
            <StockPanel id={destino} />

            <Field
              label={t('inventory.field.quantity')}
              type="number"
              rule="decimal"
              inputProps={{ min: 0 }}
              {...traslado.register('quantity', { valueAsNumber: true })}
              error={Boolean(traslado.formState.errors.quantity)}
              helperText={
                traslado.formState.errors.quantity
                  ? t(traslado.formState.errors.quantity.message as MessageKey)
                  : stockOrigen.data && stockDestino.data && cantidadTraslado > 0
                    ? t('inventory.transfer.after')
                        .replace('{from}', codigo(traslado.watch('from_warehouse_id')))
                        .replace('{fromQty}', fmt(stockOrigen.data.on_hand - cantidadTraslado))
                        .replace('{to}', codigo(destino))
                        .replace('{toQty}', fmt(stockDestino.data.on_hand + cantidadTraslado))
                    : undefined
              }
              fullWidth
            />

            <Field
              label={t('inventory.field.reason')}
              rule="longText"
              maxLength={500}
              {...traslado.register('reason')}
              multiline
              minRows={2}
              fullWidth
            />
          </>
        )}
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
        <Field
          label={t('inventory.field.safety')}
          type="number"
          rule="decimal"
          help={t('help.inventory.safetyStock')}
          {...register('safety_stock', { valueAsNumber: true })}
          error={Boolean(errors.safety_stock)}
          helperText={
            errors.safety_stock
              ? t(errors.safety_stock.message as MessageKey)
              : t('inventory.field.safetyHelp')
          }
          fullWidth
        />
        <Field
          label={t('inventory.field.reorder')}
          type="number"
          rule="decimal"
          help={t('help.inventory.reorderPoint')}
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
