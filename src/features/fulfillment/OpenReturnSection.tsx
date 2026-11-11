import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { useFeedback } from '@/shared/ui/feedback-context'
import { FulfillmentError } from './errors'
import { useOpenReturn, useReturnReasons } from './hooks'

export interface ReturnableLine {
  id: string
  name: string
  variant_label: string | null
  quantity: number
}

/**
 * «Abrir devolución» desde el pedido (2026-11-11).
 *
 * La mitad de las devoluciones llegan por teléfono o por mostrador: obligar al
 * comprador a usar la web para algo que ya está hablando con una persona es
 * como se acaba anotándolas en un cuaderno. El servidor (`return_open`) decide
 * si el operador puede y si las líneas son del pedido; aquí solo se elige qué,
 * cuánto y por qué. La devolución nace «Solicitada» y sigue en Entregas ›
 * Devoluciones.
 */
export function OpenReturnSection({
  orderId,
  storeId,
  lines,
}: {
  orderId: string
  storeId: string
  lines: ReturnableLine[]
}) {
  const { t } = useI18n()
  const { notify } = useFeedback()
  const reasons = useReturnReasons(storeId)
  const open = useOpenReturn()
  const [abierto, setAbierto] = useState(false)
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<MessageKey | null>(null)

  const activos = (reasons.data ?? []).filter((r) => r.is_active)
  const items = Object.entries(chosen)
    .filter(([, qty]) => qty > 0)
    .map(([order_item_id, quantity]) => ({ order_item_id, quantity }))
  const listo = items.length > 0 && reason !== ''

  if (!abierto) {
    return (
      <Button variant="outlined" onClick={() => setAbierto(true)} sx={{ alignSelf: 'flex-start' }}>
        {t('returns.open.start')}
      </Button>
    )
  }

  return (
    <Box
      component="form"
      aria-label={t('returns.open.start')}
      onSubmit={(event) => {
        event.preventDefault()
        if (!listo) return
        setError(null)
        open.mutate(
          { orderId, reasonCode: reason, items, note },
          {
            onSuccess: (result) => {
              notify(t('returns.open.done').replace('{rma}', result.rma_number))
              setAbierto(false)
              setChosen({})
              setReason('')
              setNote('')
            },
            onError: (caught) => setError(caught instanceof FulfillmentError ? caught.key : 'returns.open.error'),
          },
        )
      }}
    >
      <Stack spacing={2}>
        {error && <Alert severity="error">{t(error)}</Alert>}
        <Typography sx={{ fontWeight: 700 }}>{t('returns.open.which')}</Typography>
        {lines.map((line) => {
          const qty = chosen[line.id] ?? 0
          return (
            <Stack key={line.id} direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControlLabel
                sx={{ flex: '1 1 220px', m: 0 }}
                control={
                  <Checkbox
                    checked={qty > 0}
                    onChange={(event) => setChosen((prev) => ({ ...prev, [line.id]: event.target.checked ? 1 : 0 }))}
                  />
                }
                label={`${line.name}${line.variant_label ? ` · ${line.variant_label}` : ''}`}
              />
              {qty > 0 && line.quantity > 1 && (
                <TextField
                  select
                  size="small"
                  label={t('returns.open.quantity')}
                  value={qty}
                  onChange={(event) => setChosen((prev) => ({ ...prev, [line.id]: Number(event.target.value) }))}
                >
                  {Array.from({ length: line.quantity }, (_, i) => i + 1).map((n) => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>
          )
        })}
        <TextField select label={t('returns.open.reason')} value={reason} onChange={(event) => setReason(event.target.value)}>
          {activos.map((r) => (
            <MenuItem key={r.code} value={r.code}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField label={t('returns.open.note')} multiline minRows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
          <Button onClick={() => setAbierto(false)} disabled={open.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="contained" disabled={!listo || open.isPending}>
            {open.isPending ? t('common.saving') : t('returns.open.submit')}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
