import RequestQuoteRoundedIcon from '@mui/icons-material/RequestQuoteRounded'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSessionContext } from '@/features/auth/session-context'
import { useI18n } from '@/shared/i18n/i18n-context'
import { useFeedback } from '@/shared/ui/feedback-context'
import { useCommerceContext } from '../commerce/context'
import { mapQuoteRequestCode, myQuotesKey, newRequestKey, quoteErrorCode, requestQuote } from '../quotes'
import type { CartLine } from './cart'

const MAX_NOTES = 1000

/**
 * «Solicitar cotización» desde el carrito (cierre A3).
 *
 * Solo para quien compra para una EMPRESA en esta tienda: sin cuenta B2B no hay
 * a quién cotizar, y el botón no se pinta en vez de fallar al pulsarlo.
 *
 * ## Una solicitud, aunque se pulse dos veces
 *
 * La clave de solicitud se genera UNA vez al abrir el diálogo y se reutiliza en
 * cada envío de ese diálogo. Un doble clic o un reintento de red llegan con la
 * misma clave, y la base devuelve la solicitud que ya existe en vez de crear
 * otra. Cerrar y volver a abrir es una solicitud nueva, que es lo que significa.
 *
 * ## Qué se manda
 *
 * Qué y cuánto. Ni un precio: la base fija el de referencia con el motor, y el
 * definitivo lo firma el vendedor.
 */
export function RequestQuoteButton({ storeSlug, lines }: { storeSlug: string; lines: readonly CartLine[] }) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const queryClient = useQueryClient()
  const { status } = useSessionContext()
  const authenticated = status === 'authenticated'
  const { context } = useCommerceContext(storeSlug, authenticated)

  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const requestKey = useRef<string>('')

  const send = useMutation({
    mutationFn: () =>
      requestQuote({
        storeSlug,
        lines: lines.map((line) => ({
          product_id: line.product_id,
          variant_id: line.variant_id,
          quantity: line.quantity,
        })),
        notes: notes.trim() === '' ? null : notes.trim(),
        requestKey: requestKey.current,
      }),
    onSuccess: (result) => {
      setCreated(result.quote_number)
      void queryClient.invalidateQueries({ queryKey: myQuotesKey(storeSlug) })
    },
    onError: (error) => notify(t(mapQuoteRequestCode(quoteErrorCode(error))), 'error'),
  })

  if (!authenticated || context === null || lines.length === 0) return null

  function abrir() {
    requestKey.current = newRequestKey()
    setNotes('')
    setCreated(null)
    send.reset()
    setOpen(true)
  }

  const tooLong = notes.length > MAX_NOTES

  return (
    <>
      <Button fullWidth variant="outlined" startIcon={<RequestQuoteRoundedIcon />} onClick={abrir}>
        {t('store.cart.requestQuote.button')}
      </Button>

      <Dialog open={open} onClose={() => !send.isPending && setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('store.cart.requestQuote.title')}</DialogTitle>
        <DialogContent>
          {created ? (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <Typography>{t('store.cart.requestQuote.done').replace('{number}', created)}</Typography>
              <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                {t('store.cart.requestQuote.doneHint')}
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                {t('store.cart.requestQuote.body').replace('{count}', String(lines.length))}
              </Typography>
              <TextField
                label={t('store.cart.requestQuote.notes')}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                multiline
                minRows={3}
                fullWidth
                error={tooLong}
                helperText={tooLong ? t('store.cart.requestQuote.notesTooLong') : `${notes.length}/${MAX_NOTES}`}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {created ? (
            <>
              <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
              <Button variant="contained" component={Link} to={`/s/${storeSlug}/account#cotizaciones`}>
                {t('store.cart.requestQuote.seeQuotes')}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setOpen(false)} disabled={send.isPending}>
                {t('common.cancel')}
              </Button>
              <Button variant="contained" onClick={() => send.mutate()} disabled={send.isPending || tooLong}>
                {send.isPending ? t('store.cart.requestQuote.sending') : t('store.cart.requestQuote.send')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </>
  )
}
