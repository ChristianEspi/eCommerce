import type { Money, MoneyAmount, Quantity } from '../money'
import type { Provider, ProviderOperation } from './operations'

/**
 * `InvoicingProvider` — emitir el comprobante fiscal.
 *
 * Existe por la misma regla que los demás puertos de proveedor: la base ya
 * declara un implementador (`invoice.issue`, `invoice.read`) y la facturación
 * electrónica es, por definición, distinta en cada país y a menudo en cada
 * tenant. Omitirlo dejaría la única frontera regulada del sistema sin contrato.
 *
 * Lo que este contrato hace evidente, y que hoy no se puede cumplir: la línea
 * de factura necesita `taxRate` y `taxAmount` POR LÍNEA. `order_items` no los
 * guarda —solo quedan los totales del pedido—, así que un carrito con dos tipos
 * impositivos no puede reconstruir su comprobante desde la base. Es el hallazgo
 * de P00 y lo cierra P08; el puerto queda escrito de forma que no se pueda
 * implementar a medias sin que se note.
 */

export interface InvoiceLine {
  readonly description: string
  readonly quantity: Quantity
  readonly unitPrice: Money
  readonly netAmount: MoneyAmount
  /** Decimal en texto (`"0.18"`). Cero es una tasa válida, no un hueco. */
  readonly taxRate: MoneyAmount
  readonly taxAmount: MoneyAmount
}

export interface InvoiceRequest {
  readonly orderId: string
  /** Serie fiscal del tenant. Es configuración, nunca una constante del código. */
  readonly series: string
  readonly issuedAt: string
  readonly customerName: string
  readonly customerTaxId: string | null
  readonly lines: readonly InvoiceLine[]
  readonly netTotal: MoneyAmount
  readonly taxTotal: MoneyAmount
  readonly grossTotal: MoneyAmount
  readonly idempotencyKey: string
}

export type InvoiceStatus = 'issued' | 'accepted' | 'rejected' | 'cancelled' | 'pending'

export interface Invoice {
  readonly invoiceId: string
  readonly orderId: string
  readonly status: InvoiceStatus
  /** Número asignado por la autoridad o por el emisor autorizado. */
  readonly number: string | null
  /** Referencia al documento firmado. Ruta o URL, según el proveedor. */
  readonly documentRef: string | null
  readonly providerCode: string | null
}

export interface InvoicingProvider extends Provider {
  issue(request: InvoiceRequest): Promise<Invoice>
  read(invoiceId: string): Promise<Invoice | null>
}

export const INVOICING_OPERATIONS: readonly ProviderOperation[] = ['invoice.issue', 'invoice.read']

/**
 * Mensaje `invoice.issue` tal como viaja por `integration_outbox` (cable).
 *
 * Lo produce `ebim.invoice_issue_enqueue` (migración `20260914170000`) cuando
 * el backoffice pide emitir un comprobante completo. snake_case e importes como
 * texto porque es el formato de la cola, no el del dominio: el adaptador de
 * `InvoicingProvider` lo traduce a `InvoiceRequest` y comprueba
 * `schema_version` antes de leer nada más. Un cambio incompatible sube la
 * versión; nunca se reinterpreta un campo existente.
 *
 * La sociedad NO viaja en el cuerpo: es la de la fila del outbox, que escribe
 * la base. El adaptador la toma de ahí y nunca de un campo del payload.
 */
export const INVOICE_ISSUE_SCHEMA_VERSION = 2

/** Afectación al IGV de una línea (SUNAT, catálogo 07): gravado, exonerado o inafecto. */
export type TaxAffectation = 'gravado' | 'exonerado' | 'inafecto'

/** Tipo de documento del cliente (SUNAT, catálogo 06: 6, 1, 4, 7). */
export type CustomerDocType = 'ruc' | 'dni' | 'ce' | 'passport'

export interface InvoiceIssueLineV1 {
  readonly position: number
  readonly description: string
  readonly quantity: string
  readonly unit_price: MoneyAmount
  readonly net_amount: MoneyAmount
  readonly tax_rate: MoneyAmount
  readonly tax_amount: MoneyAmount
  /** v2 */
  readonly tax_affectation: TaxAffectation
  /** v2 · `shipping` es el envío; lo demás, producto. */
  readonly line_kind: 'item' | 'shipping'
}

/**
 * v2 (2026-11-20, facturación Perú fase 1, migración `20261120110000`): añade
 * el tipo de comprobante, el NÚMERO correlativo —asignado al encolar, con el
 * emisor ya elegido—, el tipo de documento y la dirección del cliente, y la
 * afectación de cada línea. El nombre del tipo se conserva por compatibilidad.
 */
export interface InvoiceIssuePayloadV1 {
  readonly schema_version: typeof INVOICE_ISSUE_SCHEMA_VERSION
  readonly operation: 'invoice.issue'
  /** `invoice.issue:<invoice_id>`: un mensaje por comprobante. */
  readonly idempotency_key: string
  readonly store_id: string
  readonly invoice_id: string
  readonly order_id: string
  readonly document_type: 'receipt' | 'invoice'
  readonly series: string
  /** Correlativo de 8 dígitos (`00000123`). */
  readonly number: string
  readonly issued_at: string
  readonly currency: string
  readonly customer: {
    readonly name: string
    readonly tax_id: string | null
    readonly doc_type: CustomerDocType | null
    readonly address: string | null
  }
  readonly totals: {
    readonly net: MoneyAmount
    readonly tax: MoneyAmount
    readonly gross: MoneyAmount
  }
  readonly lines: readonly InvoiceIssueLineV1[]
}

/** Claves de primer nivel del payload v1. La base y TypeScript no pueden separarse. */
export const INVOICE_ISSUE_PAYLOAD_KEYS = [
  'schema_version',
  'operation',
  'idempotency_key',
  'store_id',
  'invoice_id',
  'order_id',
  'document_type',
  'series',
  'number',
  'issued_at',
  'currency',
  'customer',
  'totals',
  'lines',
] as const satisfies readonly (keyof InvoiceIssuePayloadV1)[]

export const INVOICE_ISSUE_LINE_KEYS = [
  'position',
  'description',
  'quantity',
  'unit_price',
  'net_amount',
  'tax_rate',
  'tax_amount',
  'tax_affectation',
  'line_kind',
] as const satisfies readonly (keyof InvoiceIssueLineV1)[]

/**
 * Estado de emisión que expone la vista `invoice_issue_status`.
 * `pending_configuration`: se pidió y la sociedad no tiene (o tiene más de un)
 * proveedor fiscal activo. El resto son los estados del mensaje en el outbox.
 */
export type InvoiceIssueState =
  | 'not_requested'
  | 'pending_configuration'
  | 'pending'
  | 'in_flight'
  | 'succeeded'
  | 'failed'
  | 'dead'
