import { excelDate, excelNumber, type ExcelBook, type Translate } from '@/shared/lib/excel'
import { APPROVAL_LABEL, FULFILLMENT_LABEL, PAYMENT_LABEL, SOURCE_LABEL, STATUS_LABEL } from './status'
import type { Order } from './types'

function address(value: { address?: string | null; reference?: string | null } | null): string | null {
  if (!value) return null
  return [value.address, value.reference].filter(Boolean).join(' — ') || null
}

/**
 * Exporta LO FILTRADO a Excel, no la página que se está viendo.
 *
 * Desde que el listado pagina (P08), exportar las filas en pantalla daría 25
 * líneas y nadie lo notaría hasta abrir el archivo. La consulta la repite
 * `fetchOrdersForExport` con los mismos filtros y sin `range`.
 *
 * **Tenant y permisos.** El tenant lo pone la RLS —la consulta no lleva
 * `organization_id`— y el permiso lo comprueba la pantalla antes de llamar: la
 * exportación de pedidos exige `orders.read`, que es lo mismo que hace falta
 * para ver el listado. Un rol que no puede ver un pedido tampoco puede
 * llevárselo en un archivo.
 *
 * **Importes como número** (antes texto en el CSV): en una hoja que se suma y
 * se filtra, «236.00» como texto no suma. Sin símbolo de moneda en la celda:
 * la moneda va en su columna.
 */
type OrderColumn =
  | 'number' | 'date' | 'source' | 'status' | 'payment' | 'fulfillment' | 'approval'
  | 'customer' | 'email' | 'phone' | 'currency' | 'subtotal' | 'discount' | 'tax'
  | 'shipping' | 'total' | 'shippingAddress' | 'billingAddress' | 'account' | 'taxId'

export function ordersBook(orders: readonly Order[], t: Translate, fileName: string): ExcelBook {
  const col = (id: OrderColumn, format: 'text' | 'money' | 'datetime', width?: number) => ({
    header: t(`exports.orders.col.${id}`),
    description: t(`exports.orders.desc.${id}`),
    format,
    ...(width ? { width } : {}),
  })
  return {
    fileName,
    guide: { title: t('exports.orders.title'), paragraphs: [t('exports.orders.intro')] },
    sheets: [
      {
        name: t('exports.orders.sheet'),
        columns: [
          col('number', 'text', 22),
          col('date', 'datetime', 18),
          col('source', 'text'),
          col('status', 'text'),
          col('payment', 'text'),
          col('fulfillment', 'text'),
          col('approval', 'text'),
          col('customer', 'text', 28),
          col('email', 'text', 30),
          col('phone', 'text'),
          col('currency', 'text', 10),
          col('subtotal', 'money'),
          col('discount', 'money'),
          col('tax', 'money'),
          col('shipping', 'money'),
          col('total', 'money'),
          col('shippingAddress', 'text', 40),
          col('billingAddress', 'text', 40),
          col('account', 'text', 28),
          col('taxId', 'text'),
        ],
        rows: orders.map((order) => [
          order.order_number,
          excelDate(order.placed_at),
          t(SOURCE_LABEL[order.source_channel]),
          t(STATUS_LABEL[order.status]),
          t(PAYMENT_LABEL[order.payment_status]),
          t(FULFILLMENT_LABEL[order.fulfillment_status]),
          // «No requiere» en cada fila de consumidor sería ruido: vacío.
          order.approval_status && order.approval_status !== 'not_required'
            ? t(APPROVAL_LABEL[order.approval_status])
            : null,
          order.customer_name ?? null,
          order.customer_email,
          order.customer_phone ?? null,
          order.currency,
          excelNumber(order.subtotal),
          excelNumber(order.discount_total),
          excelNumber(order.tax_total),
          excelNumber(order.shipping_total),
          excelNumber(order.grand_total),
          address(order.shipping_address),
          address(order.billing_address),
          order.customer_snapshot?.account_name ?? null,
          order.customer_snapshot?.tax_id ?? null,
        ]),
      },
    ],
  }
}
