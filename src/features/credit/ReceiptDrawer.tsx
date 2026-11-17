import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { formatMoney } from '@/shared/lib/format'
import { FieldRow, FormDrawer } from '@/shared/ui/FormDrawer'
import { useFeedback } from '@/shared/ui/feedback-context'
import { CreditError } from './errors'
import { useRegisterReceipt } from './hooks'
import {
  emptyReceiptForm,
  receiptFormSchema,
  type ArDocument,
  type ReceiptFormValues,
} from './types'

/**
 * Registrar un cobro y aplicarlo.
 *
 * ## Por qué la aplicación se elige aquí y no después
 *
 * Un cobro sin aplicar es un dinero que entró y no bajó ninguna deuda: existe
 * como caso —el cliente adelanta y ya se imputará— pero es la excepción. Pedir
 * la aplicación en el mismo gesto evita el estado intermedio en el que la deuda
 * sigue diciendo lo de antes mientras el dinero ya está en caja.
 *
 * ## La suma se comprueba antes de enviar
 *
 * La base rechaza cobrar más de lo que se debe (`COBRO_EXCEDE_DEUDA`) y esa es
 * la barrera de verdad. Aquí se avisa antes porque el error de la base llega
 * cuando el recibo YA se creó —son dos escrituras, PostgREST no da transacción—
 * y entonces hay que explicar por qué quedó un cobro sin aplicar.
 *
 * Todo importe se maneja como TEXTO. Los céntimos se suman en enteros: sumar
 * `0.1 + 0.2` en JavaScript da `0.30000000000000004`, y esa es exactamente la
 * clase de cifra que descuadra una conciliación.
 */

/** Suma importes decimales en céntimos, para no pasar por el float. */
/** Los medios con los que se suele cobrar una deuda a crédito. */
const METODOS = ['transfer', 'deposit', 'wallet', 'cash', 'check', 'other'] as const

function sumarCentimos(valores: string[]): number {
  return valores.reduce((total, valor) => total + Math.round(Number(valor) * 100), 0)
}

export function ReceiptDrawer({
  open,
  documents,
  initialDocumentId = null,
  canWrite,
  onClose,
}: {
  open: boolean
  /** Los documentos abiertos del cliente elegido. */
  documents: ArDocument[]
  /** La deuda desde la que se pulsó «Cobrar»: llega marcada y con su saldo. */
  initialDocumentId?: string | null
  canWrite: boolean
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const [serverError, setServerError] = useState<MessageKey | null>(null)
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())

  const register_ = useRegisterReceipt()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: emptyReceiptForm(),
  })

  useEffect(() => {
    if (!open) return
    // Se abre desde una deuda: llega marcada y el importe propuesto es su
    // saldo, que es lo que se cobra casi siempre. Se puede cambiar.
    const inicial = documents.find((doc) => doc.id === initialDocumentId) ?? null
    reset({ ...emptyReceiptForm(), amount: inicial ? inicial.balance : '' })
    setElegidos(new Set(inicial ? [inicial.id] : []))
    setServerError(null)
    // Solo al abrir: los documentos se refrescan al cobrar y no deben pisar lo tecleado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset, initialDocumentId])

  const cliente = documents[0] ?? null
  const importe = watch('amount')

  const seleccion = useMemo(
    () => documents.filter((doc) => elegidos.has(doc.id)),
    [documents, elegidos],
  )

  const centimosDeuda = sumarCentimos(seleccion.map((doc) => doc.balance))
  const centimosCobro = /^\d{1,12}(\.\d{1,2})?$/.test(importe.trim())
    ? Math.round(Number(importe) * 100)
    : 0
  const sePasa = centimosCobro > 0 && centimosDeuda > 0 && centimosCobro > centimosDeuda

  /** Marcar todo lo que debe y proponer ese importe. */
  function cobrarTodo() {
    setElegidos(new Set(documents.map((doc) => doc.id)))
    setValue('amount', (sumarCentimos(documents.map((doc) => doc.balance)) / 100).toFixed(2), {
      shouldValidate: true,
    })
  }

  function alternar(id: string) {
    setElegidos((previo) => {
      const siguiente = new Set(previo)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function submit(values: ReceiptFormValues) {
    if (!cliente) return
    if (seleccion.length === 0) {
      setServerError('credit.error.noDocuments')
      return
    }
    if (sePasa) {
      setServerError('credit.error.overpay')
      return
    }
    setServerError(null)

    // Se reparte de más antiguo a más nuevo: es el orden del oficio y el único
    // que no exige preguntar. Lo que sobra queda sin aplicar, a la vista.
    let restante = centimosCobro
    const aplicaciones: { documentId: string; amount: string }[] = []
    for (const doc of seleccion) {
      if (restante <= 0) break
      const saldo = Math.round(Number(doc.balance) * 100)
      const aplica = Math.min(saldo, restante)
      restante -= aplica
      aplicaciones.push({ documentId: doc.id, amount: (aplica / 100).toFixed(2) })
    }

    try {
      const result = await register_.mutateAsync({
        customerId: cliente.customer_id,
        values,
        applications: aplicaciones,
      })
      notify(
        (Number(result.unapplied) > 0 ? t('credit.toast.receiptUnapplied') : t('credit.toast.receipt'))
          .replace('{number}', result.receipt_number)
          .replace('{amount}', formatMoney(Number(result.unapplied), cliente.currency, locale)),
        'success',
      )
      onClose()
    } catch (error) {
      setServerError(error instanceof CreditError ? error.key : 'credit.error.generic')
    }
  }

  return (
    <FormDrawer
      open={open}
      title={t('credit.receipt.new')}
      subtitle={cliente?.customer_name ?? undefined}
      onClose={onClose}
      busy={isSubmitting}
      width={620}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="receipt-form"
            variant="contained"
            disabled={isSubmitting || !canWrite || sePasa}
          >
            {isSubmitting ? t('common.saving') : t('credit.receipt.save')}
          </Button>
        </>
      }
    >
      <Box component="form" id="receipt-form" onSubmit={handleSubmit(submit)} noValidate>
        <Stack spacing={2.5}>
          {serverError && <Alert severity="error">{t(serverError)}</Alert>}

          <FieldRow>
            <TextField
              fullWidth
              label={t('credit.field.receiptNumber')}
              disabled={!canWrite}
              error={Boolean(errors.receipt_number)}
              helperText={
                errors.receipt_number
                  ? t(errors.receipt_number.message as MessageKey)
                  : t('credit.field.receiptNumberHint')
              }
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('receipt_number')}
            />
            {/* El importe es el dato que se comprueba contra la deuda marcada:
                ancho fijo para que no baile cuando aparece el aviso de que se
                pasa. */}
            <TextField
              label={t('credit.field.amount')}
              required
              disabled={!canWrite}
              error={Boolean(errors.amount) || sePasa}
              helperText={
                sePasa
                  ? t('credit.error.overpay')
                  : errors.amount
                    ? t(errors.amount.message as MessageKey)
                    : t('credit.field.amountHint')
              }
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: '100%', sm: 200 }, flexShrink: 0 }}
              {...register('amount')}
            />
          </FieldRow>

          <FieldRow>
            <TextField
              fullWidth
              type="date"
              label={t('credit.field.receivedAt')}
              disabled={!canWrite}
              slotProps={{ inputLabel: { shrink: true } }}
              {...register('received_at')}
            />
            <TextField
              select
              fullWidth
              label={t('credit.field.method')}
              disabled={!canWrite}
              value={watch('method')}
              onChange={(event) => setValue('method', event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            >
              {METODOS.map((metodo) => (
                <MenuItem key={metodo} value={metodo}>
                  {t(`credit.method.${metodo}` as MessageKey)}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>

          {/* La referencia va sola: un numero de operacion o de cheque es
              largo y a media fila se lee a trozos. */}
          <TextField
            fullWidth
            label={t('credit.field.reference')}
            disabled={!canWrite}
            helperText={t('credit.field.referenceHint')}
            slotProps={{ inputLabel: { shrink: true } }}
            {...register('reference')}
          />

          <Box>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontWeight: 800 }}>{t('credit.receipt.apply')}</Typography>
              {documents.length > 1 && canWrite && (
                <Button size="small" onClick={cobrarTodo}>
                  {t('credit.receipt.all')}
                </Button>
              )}
            </Stack>
            <Typography sx={{ color: 'var(--muted)', fontSize: 13, mb: 1 }}>
              {t('credit.receipt.applyHint')}
            </Typography>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>{t('credit.field.document')}</TableCell>
                  <TableCell>{t('credit.field.dueAt')}</TableCell>
                  <TableCell align="right">{t('credit.field.balance')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id} hover>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={elegidos.has(doc.id)}
                        onChange={() => alternar(doc.id)}
                        inputProps={{ 'aria-label': doc.document_number }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{doc.document_number}</TableCell>
                    <TableCell>{doc.due_at}</TableCell>
                    <TableCell align="right">
                      {formatMoney(Number(doc.balance), doc.currency, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {seleccion.length > 0 && (
              <Typography sx={{ mt: 1, fontSize: 13, fontWeight: 700 }}>
                {`${t('credit.receipt.selected')}: ${formatMoney(
                  centimosDeuda / 100,
                  cliente?.currency ?? 'PEN',
                  locale,
                )}`}
              </Typography>
            )}
          </Box>
        </Stack>
      </Box>
    </FormDrawer>
  )
}
