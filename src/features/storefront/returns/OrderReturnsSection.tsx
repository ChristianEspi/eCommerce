import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { Field } from '@/shared/ui/Field'
import { TS } from '@/theme/tokens'
import { fetchReturnOptions, requestReturn, type OrderRef } from './api'
import { SelectField } from '@/shared/ui/SelectField'

/**
 * «Solicitar devolución» en la página del pedido.
 *
 * Solo aparece cuando el pedido ya se entregó (antes, lo que procede es
 * cancelar) y quedan unidades por devolver. Lo que ya se pidió se lista con su
 * RMA y su estado, para que el comprador no la pida dos veces.
 */
export function OrderReturnsSection({ storeSlug, orderNumber, token }: OrderRef) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const key = ['storefront', 'return-options', storeSlug, orderNumber, token] as const
  const options = useQuery({
    queryKey: key,
    queryFn: () => fetchReturnOptions({ storeSlug, orderNumber, token }),
    enabled: Boolean(storeSlug && orderNumber && token),
    retry: false,
  })

  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const send = useMutation({
    mutationFn: () =>
      requestReturn({
        storeSlug,
        orderNumber,
        token,
        reasonCode: reason,
        note,
        items: Object.entries(chosen)
          .filter(([, qty]) => qty > 0)
          .map(([order_item_id, quantity]) => ({ order_item_id, quantity })),
      }),
    onSuccess: (result) => {
      setDone(result.rma_number)
      setOpen(false)
      setChosen({})
      setNote('')
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const data = options.data
  if (!data) return null
  const devolvibles = data.items.filter((item) => item.available > 0)
  const puedePedir = data.returnable && devolvibles.length > 0 && data.reasons.length > 0
  if (!puedePedir && data.requests.length === 0 && !done) return null

  const lineas = Object.values(chosen).filter((qty) => qty > 0).length
  const listo = lineas > 0 && reason !== ''

  return (
    <Card sx={{ p: { xs: 2, md: 3 } }} data-order-returns>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography component="h2" sx={{ fontSize: TS.cardTitle, fontWeight: 800 }}>
          {t('store.returns.title')}
        </Typography>
        {puedePedir && !open && (
          <Button variant="outlined" onClick={() => setOpen(true)}>
            {t('store.returns.start')}
          </Button>
        )}
      </Stack>

      {done && (
        <Alert severity="success" sx={{ mt: 1.5 }}>
          {t('store.returns.sent').replace('{rma}', done)}
        </Alert>
      )}

      {data.requests.length > 0 && (
        <Stack component="ul" sx={{ listStyle: 'none', m: 0, mt: 1.5, p: 0, gap: 0.75 }}>
          {data.requests.map((request) => (
            <Stack component="li" key={request.rma_number} direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 700 }}>{request.rma_number}</Typography>
              <Chip size="small" label={t(`store.returns.state.${request.state}` as MessageKey)} />
              {request.reason_label && (
                <Typography sx={{ color: 'var(--muted)', fontSize: TS.body }}>{request.reason_label}</Typography>
              )}
            </Stack>
          ))}
        </Stack>
      )}

      {open && (
        <Box
          component="form"
          aria-label={t('store.returns.start')}
          sx={{ mt: 2 }}
          onSubmit={(event) => {
            event.preventDefault()
            if (listo) send.mutate()
          }}
        >
          <Stack sx={{ gap: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>{t('store.returns.which')}</Typography>
            {devolvibles.map((item) => {
              const qty = chosen[item.order_item_id] ?? 0
              return (
                <Stack key={item.order_item_id} direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                  <FormControlLabel
                    sx={{ flex: '1 1 220px', m: 0 }}
                    control={
                      <Checkbox
                        checked={qty > 0}
                        onChange={(event) =>
                          setChosen((prev) => ({ ...prev, [item.order_item_id]: event.target.checked ? 1 : 0 }))
                        }
                      />
                    }
                    label={`${item.name}${item.variant_label ? ` · ${item.variant_label}` : ''}`}
                  />
                  {qty > 0 && item.available > 1 && (
                    <SelectField
                      size="small"
                      label={t('store.returns.quantity')}
                      value={qty}
                      onChange={(event) =>
                        setChosen((prev) => ({ ...prev, [item.order_item_id]: Number(event.target.value) }))
                      }
                    >
                      {Array.from({ length: item.available }, (_, i) => i + 1).map((n) => (
                        <MenuItem key={n} value={n}>
                          {n}
                        </MenuItem>
                      ))}
                    </SelectField>
                  )}
                </Stack>
              )
            })}

            <Typography sx={{ fontWeight: 700 }}>{t('store.returns.why')}</Typography>
            <RadioGroup value={reason} onChange={(event) => setReason(event.target.value)}>
              {data.reasons.map((r) => (
                <FormControlLabel key={r.code} value={r.code} control={<Radio />} label={r.label} />
              ))}
            </RadioGroup>

            <Field
              label={t('store.returns.note')}
              rule="longText"
              maxLength={2000}
              multiline
              minRows={2}
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 2000))}
            />

            {send.isError && <Alert severity="error">{t('store.returns.error')}</Alert>}

            <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
              <Button onClick={() => setOpen(false)} disabled={send.isPending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="contained" disabled={!listo || send.isPending}>
                {send.isPending ? t('common.saving') : t('store.returns.submit')}
              </Button>
            </Stack>
          </Stack>
        </Box>
      )}
    </Card>
  )
}
