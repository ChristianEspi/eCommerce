import { zodResolver } from '@hookform/resolvers/zod'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import {
  Alert,
  Box,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useCustomerOptions } from '@/features/customers/hooks'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { EntityPicker, type PickerOption } from '@/shared/ui/EntityPicker'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { RowActions } from '@/shared/ui/RowActions'
import { StatusChip } from '@/shared/ui/StatusChip'
import { useFeedback } from '@/shared/ui/feedback-context'
import { Field } from '@/shared/ui/Field'
import type { TradeScope } from './api'
import { TradeError } from './errors'
import {
  useAddQuoteItem,
  useQuoteItems,
  useRemoveQuoteItem,
  useSaveQuote,
  useSetQuoteStatus,
  useTradeProductSearch,
} from './hooks'
import {
  emptyQuoteForm,
  suggestQuoteNumber,
  isQuoteEditable,
  lineTotal,
  nextStatuses,
  quoteFormSchema,
  type Quote,
  type QuoteFormValues,
  type QuoteStatus,
} from './types'

/**
 * La cotización: cabecera, líneas y estado.
 *
 * ## Un documento que el cliente ya vio no se edita por detrás
 *
 * `draft` y `sent` admiten cambios —el vendedor se equivocó y reenvía—, pero
 * `accepted`, `rejected` y `expired` están cerrados: dos triggers lo impiden y
 * aquí los campos se deshabilitan por la misma razón. Cambiar el precio de algo
 * que el cliente aceptó es lo que destruye la confianza en un precio dado.
 *
 * ## El estado avanza y no retrocede
 *
 * Los botones salen de `nextStatuses`, que calca `ebim.quote_status_guard`. La
 * pantalla no autoriza —eso lo hace el trigger—, solo evita ofrecer un botón que
 * va a terminar en error. De `sent` no se vuelve a borrador.
 *
 * ## El precio se escribe, no se calcula aquí
 *
 * Esta pantalla NO es un motor de precios: `ebim.build_quote` dice cuánto cuesta
 * un carrito hoy y esta frontera crea el documento. Lo único que se calcula es
 * el total de la línea, en céntimos enteros, y la suma de la cabecera.
 */
export function QuoteDrawer({
  open,
  quote,
  scope,
  currency,
  canWrite,
  onClose,
}: {
  open: boolean
  /** `null` = una cotización nueva. */
  quote: Quote | null
  scope: TradeScope | null
  currency: string
  canWrite: boolean
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  // Cliente y producto elegidos se guardan ENTEROS, no solo su id: el
  // desplegable tiene que seguir enseñando su nombre aunque la siguiente
  // búsqueda ya no lo traiga.
  const [clienteElegido, setClienteElegido] = useState<PickerOption | null>(null)
  const [productoElegido, setProductoElegido] = useState<PickerOption | null>(null)
  const [cantidad, setCantidad] = useState('1')
  const [precio, setPrecio] = useState('')

  const editable = quote === null || isQuoteEditable(quote.status)
  const puedeEditar = canWrite && editable

  const items = useQuoteItems(quote?.id ?? null)
  const save = useSaveQuote()
  const setStatus = useSetQuoteStatus()
  const addItem = useAddQuoteItem()
  const removeItem = useRemoveQuoteItem()

  const customers = useCustomerOptions({
    term: customerSearch,
    enabled: open,
  })
  const products = useTradeProductSearch(
    open ? (scope?.storeId ?? null) : null,
    productSearch,
  )

  const opcionesCliente = useMemo<PickerOption[]>(
    () => (customers.data ?? []).map((c) => ({ id: c.id, primary: c.name, secondary: c.code })),
    [customers.data],
  )
  const opcionesProducto = useMemo<PickerOption[]>(
    () => (products.data ?? []).map((p) => ({ id: p.id, primary: p.name, secondary: p.sku })),
    [products.data],
  )

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: emptyQuoteForm(currency),
  })

  useEffect(() => {
    if (!open) return
    reset(
      quote
        ? {
            quote_number: quote.quote_number,
            customer_id: quote.customer_id,
            currency: quote.currency,
            issued_at: quote.issued_at,
            valid_until: quote.valid_until,
            notes: quote.notes ?? '',
          }
        : { ...emptyQuoteForm(currency), quote_number: suggestQuoteNumber() },
    )
    setCustomerSearch('')
    setProductSearch('')
    setClienteElegido(null)
    setProductoElegido(null)
    setCantidad('1')
    setPrecio('')
    setServerError(null)
  }, [open, quote, currency, reset])

  const lineas = items.data ?? []

  async function submit(values: QuoteFormValues) {
    if (!scope) return
    setServerError(null)
    try {
      await save.mutateAsync({ scope, id: quote?.id ?? null, values })
      notify(t('trade.toast.quoteSaved'), 'success')
      // La nueva se cierra: sus líneas se añaden al reabrirla, que es cuando ya
      // tiene id. Editar una existente deja el cajón abierto para seguir.
      if (!quote) onClose()
    } catch (error) {
      setServerError(error instanceof TradeError ? error.key : 'trade.error.generic')
    }
  }

  async function avanzar(status: QuoteStatus) {
    if (!quote) return
    setServerError(null)
    try {
      await setStatus.mutateAsync({ id: quote.id, status })
      notify(t('trade.toast.statusChanged'), 'success')
    } catch (error) {
      setServerError(error instanceof TradeError ? error.key : 'trade.error.generic')
    }
  }

  async function añadirLinea(productId: string) {
    if (!scope || !quote) return
    setServerError(null)
    try {
      await addItem.mutateAsync({
        scope,
        quoteId: quote.id,
        values: { product_id: productId, quantity: cantidad, unit_price: precio },
        position: lineas.length,
      })
      setProductSearch('')
      setProductoElegido(null)
      setCantidad('1')
      setPrecio('')
    } catch (error) {
      setServerError(error instanceof TradeError ? error.key : 'trade.error.generic')
    }
  }

  async function quitarLinea(id: string) {
    if (!quote) return
    setServerError(null)
    try {
      await removeItem.mutateAsync({ id, quoteId: quote.id })
    } catch (error) {
      setServerError(error instanceof TradeError ? error.key : 'trade.error.generic')
    }
  }

  const cantidadValida = /^\d{1,10}(\.\d{1,3})?$/.test(cantidad) && Number(cantidad) > 0
  const precioValido = /^\d{1,12}(\.\d{1,2})?$/.test(precio)

  return (
    <FormDrawer
      open={open}
      title={quote ? quote.quote_number : t('trade.quotes.new')}
      subtitle={quote?.customer_name ?? undefined}
      onClose={onClose}
      busy={isSubmitting}
      width={720}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.close')}
          </Button>
          <Button
            type="submit"
            form="quote-form"
            variant="contained"
            disabled={isSubmitting || !puedeEditar}
          >
            {isSubmitting ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="quote-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          {/* Cerrada: se dice POR QUÉ no se puede tocar, en vez de dejar los
              campos apagados sin explicación. */}
          {quote && !editable && <Alert severity="info">{t('trade.quotes.closed')}</Alert>}

          <FieldRow>
            <Field
              fullWidth
              rule="sku"
              maxLength={60}
              help={t('help.trade.quoteNumber')}
              label={t('trade.field.number')}
              required
              disabled={!puedeEditar}
              error={Boolean(errors.quote_number)}
              helperText={
                errors.quote_number ? t(errors.quote_number.message as MessageKey) : undefined
              }
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('quote_number')}
            />
            {/* Tres letras: ancho fijo y sin encoger. Dejarla crecer hasta la
                mitad del cajón le da a «PEN» la importancia del número. */}
            <Field
              rule="currency"
              help={t('help.trade.currency')}
              label={t('trade.field.currency')}
              required
              disabled={!puedeEditar}
              error={Boolean(errors.currency)}
              helperText={errors.currency ? t(errors.currency.message as MessageKey) : undefined}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 130 }, flexShrink: 0 }}
              {...register('currency')}
            />
          </FieldRow>

          {/* Las dos fechas a mitad y mitad. Antes iban a 2/12 cada una y el
              input nativo de fecha no baja de ~140 px: se salía del panel. */}
          <FieldRow>
            <Field
              fullWidth
              type="date"
              label={t('trade.field.issuedAt')}
              disabled={!puedeEditar}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('issued_at')}
            />
            <Field
              fullWidth
              type="date"
              label={t('trade.field.validUntil')}
              disabled={!puedeEditar}
              error={Boolean(errors.valid_until)}
              helperText={
                errors.valid_until ? t(errors.valid_until.message as MessageKey) : undefined
              }
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('valid_until')}
            />
          </FieldRow>

          <Box>
              {/* El cliente se busca en el servidor y se fija con el mismo
                  buscador que usa `features/customers`; no se escribe otro. */}
              <input type="hidden" {...register('customer_id')} />
              {quote ? (
                <Field
                  fullWidth
                  label={t('trade.field.customer')}
                  value={quote.customer_name ?? quote.customer_id}
                  disabled
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              ) : (
                <EntityPicker
          minChars={0}
                  label={t('trade.field.customer')}
                  placeholder={t('trade.quotes.searchCustomer')}
                  term={customerSearch}
                  onTermChange={setCustomerSearch}
                  options={opcionesCliente}
                  loading={customers.isFetching}
                  value={clienteElegido}
                  onPick={(option) => {
                    setClienteElegido(option)
                    setValue('customer_id', option.id, { shouldValidate: true })
                  }}
                  error={Boolean(errors.customer_id)}
                  helperText={
                    errors.customer_id ? t(errors.customer_id.message as MessageKey) : undefined
                  }
                />
              )}
          </Box>

          <Field
            fullWidth
            multiline
            minRows={2}
            rule="longText"
            label={t('trade.field.notes')}
            disabled={!puedeEditar}
            error={Boolean(errors.notes)}
            helperText={errors.notes ? t(errors.notes.message as MessageKey) : undefined}
            slotProps={{ inputLabel: { shrink: true } }}
            {...register('notes')}
          />

          {/* Las líneas solo existen cuando la cotización ya tiene id: sin él no
              hay a qué colgarlas. */}
          {quote && (
            <Box>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1 }}
              >
                <Typography sx={{ fontWeight: 800 }}>{t('trade.quotes.lines')}</Typography>
                <StatusChip
                  tone={quote.status === 'accepted' ? 'success' : 'default'}
                  label={t(`trade.status.${quote.status}` as MessageKey)}
                />
              </Stack>

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('trade.field.product')}</TableCell>
                    <TableCell align="right">{t('trade.field.quantity')}</TableCell>
                    <TableCell align="right">{t('trade.field.unitPrice')}</TableCell>
                    <TableCell align="right">{t('trade.field.lineTotal')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lineas.map((linea) => (
                    <TableRow key={linea.id} hover>
                      <TableCell>{linea.product_name ?? '—'}</TableCell>
                      <TableCell align="right">{linea.quantity}</TableCell>
                      <TableCell align="right">
                        {formatMoney(Number(linea.unit_price), quote.currency, locale)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 800 }}>
                        {formatMoney(Number(linea.line_total), quote.currency, locale)}
                      </TableCell>
                      <TableCell align="right">
                        <RowActions
                          actions={[
                            {
                              id: 'del',
                              icon: <DeleteRoundedIcon fontSize="small" />,
                              label: `${t('trade.quotes.removeLine')}: ${linea.product_name ?? ''}`,
                              tone: 'danger',
                              disabled: !puedeEditar || removeItem.isPending,
                              onClick: () => void quitarLinea(linea.id),
                            },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
                <Typography sx={{ fontWeight: 800 }}>
                  {`${t('trade.field.grandTotal')}: ${formatMoney(
                    Number(quote.grand_total),
                    quote.currency,
                    locale,
                  )}`}
                </Typography>
              </Stack>

              {puedeEditar && (
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
                    {t('trade.quotes.addLine')}
                  </Typography>
                  <FieldRow>
                    <Field
                      size="small"
                      rule="decimal"
                      help={t('help.trade.quantity')}
                      label={t('trade.field.quantity')}
                      value={cantidad}
                      onChange={(event) => setCantidad(event.target.value)}
                      error={cantidad !== '' && !cantidadValida}
                      slotProps={{ inputLabel: { shrink: true } }}
                      sx={{ width: { xs: '100%', sm: 120 }, flexShrink: 0 }}
                    />
                    <Field
                      size="small"
                      rule="money"
                      label={t('trade.field.unitPrice')}
                      value={precio}
                      onChange={(event) => setPrecio(event.target.value)}
                      error={precio !== '' && !precioValido}
                      helperText={
                        cantidadValida && precioValido
                          ? `= ${formatMoney(Number(lineTotal(cantidad, precio)), quote.currency, locale)}`
                          : undefined
                      }
                      slotProps={{ inputLabel: { shrink: true } }}
                      sx={{ width: { xs: '100%', sm: 170 }, flexShrink: 0 }}
                    />
                    {/* El buscador se queda con lo que sobre: es el campo que
                        de verdad necesita ancho para leer nombres largos. */}
                    <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
                      <EntityPicker
          minChars={0}
                        label={t('trade.field.product')}
                        placeholder={t('trade.quotes.searchProduct')}
                        term={productSearch}
                        onTermChange={setProductSearch}
                        options={opcionesProducto}
                        loading={products.isFetching}
                        value={productoElegido}
                        onPick={setProductoElegido}
                      />
                    </Box>
                    <Button
                      variant="outlined"
                      // El botón se apaga hasta que haya producto y hasta que
                      // cantidad y precio valgan: añadir una línea sin precio
                      // crearía un renglón a cero que alguien tendría que
                      // descubrir leyendo el total.
                      disabled={
                        !productoElegido || !cantidadValida || !precioValido || addItem.isPending
                      }
                      onClick={() => {
                        if (productoElegido) void añadirLinea(productoElegido.id)
                      }}
                      sx={{ flexShrink: 0 }}
                    >
                      {t('trade.quotes.addToQuote')}
                    </Button>
                  </FieldRow>
                </Stack>
              )}

              {canWrite && nextStatuses(quote.status).length > 0 && (
                <Stack spacing={1} sx={{ mt: 2.5 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
                    {t('trade.quotes.advance')}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {nextStatuses(quote.status).map((status) => (
                      <Button
                        key={status}
                        size="small"
                        variant="outlined"
                        disabled={setStatus.isPending}
                        onClick={() => void avanzar(status)}
                      >
                        {t(`trade.status.${status}` as MessageKey)}
                      </Button>
                    ))}
                  </Stack>
                  <Typography sx={{ color: 'var(--muted)', fontSize: 12 }}>
                    {t('trade.quotes.advanceHint')}
                  </Typography>
                </Stack>
              )}
            </Box>
          )}
        </Stack>
      </Box>
    </FormDrawer>
  )
}
