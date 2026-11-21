import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { fetchInvoicePdf } from '@/shared/lib/invoicePdf'
import { PdfPreviewDialog } from '@/shared/ui/PdfPreviewDialog'
import { TS } from '@/theme/tokens'
import { fetchMyOrderInvoice, myOrderInvoiceKey, type MyOrderInvoice } from './myOrderInvoice'

/**
 * El comprobante del pedido en «Mi cuenta» (facturación fase 4, 2026-11-20).
 *
 * `my_order_invoice` solo responde a quien compró o a un miembro activo de la
 * cuenta B2B del pedido. Sin comprobante no se pinta nada: no todas las
 * tiendas facturan con el sistema. El PDF es el del emisor (Nubefact).
 */
const STATUS_KEY: Record<NonNullable<MyOrderInvoice>['status'], MessageKey> = {
  pending: 'account.invoice.status.pending',
  issued: 'account.invoice.status.issued',
  accepted: 'account.invoice.status.accepted',
  rejected: 'account.invoice.status.rejected',
  cancelled: 'account.invoice.status.cancelled',
}

export function OrderInvoiceBlock({ orderId }: { orderId: string }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: myOrderInvoiceKey(orderId),
    queryFn: () => fetchMyOrderInvoice(orderId),
    // Un fallo aquí no tapa el pedido: simplemente no se muestra el bloque.
    retry: false,
  })
  const [viendo, setViendo] = useState(false)
  const inv = query.data
  if (!inv) return null

  const label = t(inv.document_type === 'invoice' ? 'account.invoice.invoice' : 'account.invoice.receipt')
  const numero = inv.number ? `${inv.series}-${inv.number}` : inv.series

  return (
    <Box sx={{ mt: 1.25, p: 1.25, borderRadius: 2, border: '1px solid var(--sf-line)' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: TS.label, fontWeight: 700 }}>{`${label} ${numero}`}</Typography>
          <Typography sx={{ fontSize: TS.label, color: 'var(--muted)' }}>{t(STATUS_KEY[inv.status])}</Typography>
        </Box>
        {inv.pdf_url && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<PictureAsPdfRoundedIcon fontSize="small" />}
            onClick={() => setViendo(true)}
          >
            {t('account.invoice.view')}
          </Button>
        )}
      </Stack>
      {/* El PDF, dentro de la tienda: la función vuelve a comprobar que es suyo. */}
      <PdfPreviewDialog
        open={viendo}
        title={`${label} ${numero}`}
        load={() => fetchInvoicePdf(inv.id)}
        onClose={() => setViendo(false)}
      />
    </Box>
  )
}
