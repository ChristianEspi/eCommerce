import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import {
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useRef, useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import { isUiError } from '@/shared/lib/appError'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { BrandLoader } from '@/shared/ui/BrandLoader'
import { useFeedback } from '@/shared/ui/feedback-context'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { TS } from '@/theme/tokens'
import type { MyOrder } from '../portal'
import { useDecideMyApproval, useMyPendingApprovals } from './approvals'
import { MyOrderDrawer } from './MyOrderDrawer'

/**
 * Bandeja de aprobaciones del comprador B2B (cierre, item 2).
 *
 * Quien firma las compras de su empresa —`admin` o `approver` de la cuenta— no
 * es miembro del tenant y no tiene backoffice: hasta ahora el comando existía
 * (`order_approval_decide`) y no había pantalla desde la que usarlo.
 *
 * ## Qué se enseña y qué no
 *
 * Lo mínimo para decidir sin abrir nada: número, fecha, cuenta, quién compró,
 * orden de compra y total. El detalle completo está a un clic, en el MISMO
 * panel de «Mis pedidos». Las filas sin `can_decide` (el servidor lo resuelve
 * por fila) se leen pero no ofrecen botones: quien compra para dos empresas
 * puede aprobar en una y solo mirar en la otra.
 *
 * ## Doble clic
 *
 * Dos defensas y no una. El botón se deshabilita mientras la mutación está en
 * vuelo, pero entre el primer clic y el repintado cabe un segundo evento; el
 * `ref` corta ese hueco. Y si aun así llegaran dos, el servidor ya es
 * idempotente ante la misma decisión (migración 20260914110000).
 */
export function MyApprovalsSection({ storeSlug, storeId = null }: { storeSlug: string; storeId?: string | null }) {
  const { t, locale } = useI18n()
  const { notify } = useFeedback()
  const query = useMyPendingApprovals(true)
  const decide = useDecideMyApproval()
  const enVuelo = useRef(false)

  const [rechazando, setRechazando] = useState<MyOrder | null>(null)
  const [motivo, setMotivo] = useState('')
  const [abierto, setAbierto] = useState<MyOrder | null>(null)

  async function decidir(order: MyOrder, approve: boolean, reason: string | null) {
    if (enVuelo.current) return
    enVuelo.current = true
    try {
      const result = await decide.mutateAsync({ orderId: order.order_id, approve, reason })
      notify(
        result?.already_decided
          ? t('account.approvals.alreadyDecided')
          : t(approve ? 'account.approvals.approved' : 'account.approvals.rejected').replace(
              '{order}',
              order.order_number,
            ),
        'success',
      )
      if (!approve) {
        setRechazando(null)
        setMotivo('')
      }
    } catch (error) {
      notify(t(isUiError(error) ? error.key : 'account.approvals.error.generic'), 'error')
    } finally {
      enVuelo.current = false
    }
  }

  if (query.isPending) return <BrandLoader />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const pedidos = query.data ?? []
  if (pedidos.length === 0) {
    return (
      <EmptyState
        title={t('account.approvals.empty')}
        description={t('account.approvals.emptyBody')}
        icon={<FactCheckRoundedIcon fontSize="small" />}
      />
    )
  }

  const ocupado = decide.isPending
  const motivoVacio = motivo.trim() === ''

  return (
    <Stack sx={{ gap: 1.5 }}>
      <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t('account.approvals.intro')}</Typography>

      {pedidos.map((order) => (
        <Card
          key={order.order_id}
          component="article"
          aria-label={order.order_number}
          sx={{ borderRadius: 'var(--sf-radius)', border: '1px solid var(--sf-line)', p: { xs: 1.5, sm: 2 } }}
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5, justifyContent: 'space-between' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: TS.body, fontWeight: 800 }}>{order.order_number}</Typography>
              <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                {[formatDate(new Date(order.placed_at), locale), order.account_name].filter(Boolean).join(' · ')}
              </Typography>
              {order.buyer_email && (
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                  {t('account.approvals.buyer')}: {order.buyer_email}
                </Typography>
              )}
              {order.purchase_order_number && (
                <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>
                  {t('store.checkout.purchaseOrder')}: <strong>{order.purchase_order_number}</strong>
                </Typography>
              )}
            </Box>
            <Typography
              className="tnum"
              sx={{ fontSize: TS.bodyStrong, fontWeight: 800, whiteSpace: 'nowrap', textAlign: { sm: 'right' } }}
            >
              {formatMoney(Number(order.grand_total), order.currency, locale)}
            </Typography>
          </Stack>

          <Stack direction="row" sx={{ gap: 1, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {order.can_decide && (
              <>
                <Button
                  variant="contained"
                  size="small"
                  disabled={ocupado}
                  onClick={() => void decidir(order, true, null)}
                >
                  {t('account.approvals.approve')}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  disabled={ocupado}
                  onClick={() => {
                    setMotivo('')
                    setRechazando(order)
                  }}
                >
                  {t('account.approvals.reject')}
                </Button>
              </>
            )}
            <Button variant="text" size="small" onClick={() => setAbierto(order)} sx={{ ml: { sm: 'auto' } }}>
              {t('account.orders.detail')}
            </Button>
          </Stack>
        </Card>
      ))}

      {/* Rechazar pide motivo: el pedido se cancela y el comprador tiene que
          saber qué corregir. `sf-scope` en el papel por la misma razón que el
          panel de detalle: el diálogo se monta en un portal fuera de la piel. */}
      <Dialog
        open={rechazando !== null}
        onClose={() => (ocupado ? undefined : setRechazando(null))}
        fullWidth
        maxWidth="xs"
        slotProps={{ paper: { className: 'sf-scope' } }}
      >
        <DialogTitle>
          {t('account.approvals.rejectTitle').replace('{order}', rechazando?.order_number ?? '')}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)', mb: 1.5 }}>
            {t('account.approvals.rejectBody')}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            required
            label={t('account.approvals.reason')}
            helperText={motivoVacio ? t('account.approvals.reasonRequired') : ' '}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRechazando(null)} disabled={ocupado}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={ocupado || motivoVacio}
            onClick={() => rechazando && void decidir(rechazando, false, motivo)}
          >
            {t('account.approvals.confirmReject')}
          </Button>
        </DialogActions>
      </Dialog>

      <MyOrderDrawer
        orderId={abierto?.order_id ?? null}
        orderNumber={abierto?.order_number ?? null}
        onClose={() => setAbierto(null)}
        storeSlug={storeSlug}
        storeId={storeId}
      />
    </Stack>
  )
}
