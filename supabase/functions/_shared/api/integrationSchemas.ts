/**
 * Esquemas del contrato de integración v1 (`docs/integrations/CONTRATO_INTEGRACION_v1.md`)
 * para el documento OpenAPI generado: estado del pedido, clientes, stock por
 * almacén y listas de precios.
 *
 * Describen; no validan. Quien hace cumplir cada regla es la función de la base
 * que sirve la ruta (`api_order_update`, `api_customers_upsert`,
 * `api_stock_set`, `api_price_list_upsert`), y un campo que no está aquí lo
 * rechaza ella con `PETICION_INVALIDA`.
 */
const MONEY = {
  oneOf: [
    { type: 'string', pattern: '^\\d{1,12}(\\.\\d{1,2})?$' },
    { type: 'number', minimum: 0 },
  ],
  description: 'Importe. Se recomienda cadena decimal ("99.90") para no perder céntimos.',
}

export const INTEGRATION_SCHEMAS: Record<string, Record<string, unknown>> = {
  ExternalRef: {
    type: 'object',
    additionalProperties: false,
    required: ['system', 'id'],
    properties: {
      system: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9_-]{0,40}$',
        description: 'Código del sistema externo (sap, odoo, siesa…).',
      },
      type: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9_-]{0,40}$',
        default: 'order',
        description: 'Qué documento es: order, invoice, delivery_note, shipment…',
      },
      id: { type: 'string', minLength: 1, maxLength: 120 },
      url: { type: 'string', format: 'uri', maxLength: 2000 },
    },
  },
  OrderStatusUpdate: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'],
        description: 'Estado general del pedido.',
      },
      payment_status: {
        type: 'string',
        enum: ['pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed', 'voided'],
        description: 'Estado del pago.',
      },
      fulfillment_status: {
        type: 'string',
        enum: ['unfulfilled', 'in_progress', 'partially_fulfilled', 'fulfilled', 'returned', 'cancelled'],
        description: 'Estado de la entrega.',
      },
      reason: { type: 'string', maxLength: 1000, description: 'Queda en la línea de tiempo del pedido.' },
      external_refs: {
        type: 'array',
        maxItems: 10,
        items: { $ref: '#/components/schemas/ExternalRef' },
        description: 'Upsert por (system, type).',
      },
    },
  },
  CustomerBatchRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['customers'],
    properties: {
      system: {
        type: 'string',
        description: 'Código del ERP que envía el lote; acompaña a cada `external_id`. Por defecto `erp`.',
      },
      customers: {
        type: 'array',
        maxItems: 1000,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: {
            code: { type: 'string', description: 'Código del cliente en la tienda: la clave del upsert.' },
            kind: { type: 'string', enum: ['company', 'person'] },
            name: { type: 'string', description: 'Obligatorio en el alta.' },
            legal_name: { type: 'string' },
            tax_id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            segment: { type: 'string', description: 'Código de un segmento de precios ya creado.' },
            is_active: { type: 'boolean' },
            notes: { type: 'string' },
            external_id: { type: 'string', description: 'Código del cliente en el ERP.' },
          },
        },
      },
    },
  },
  StockBatchRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        maxItems: 2000,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sku', 'warehouse', 'on_hand'],
          properties: {
            sku: { type: 'string', description: 'SKU del producto o de la variante.' },
            warehouse: {
              type: 'string',
              description: 'Código del almacén. Tiene que ser un almacén con origen ERP.',
            },
            on_hand: { type: 'number', minimum: 0, description: 'Saldo físico ABSOLUTO, no un movimiento.' },
          },
        },
      },
    },
  },
  PriceListBatchRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        maxItems: 2000,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sku'],
          properties: {
            sku: { type: 'string' },
            price: { ...MONEY, description: 'Obligatorio salvo con `active: false`.' },
            compare_at_price: { ...MONEY, description: 'Precio tachado; no menor que `price`.' },
            min_quantity: { type: 'number', exclusiveMinimum: 0, default: 1, description: 'Escalón por volumen.' },
            currency: {
              type: 'string',
              pattern: '^[A-Z]{3}$',
              description: 'Opcional; si viene, tiene que ser la moneda de la lista.',
            },
            active: { type: 'boolean', default: true, description: '`false` quita este precio de la lista.' },
          },
        },
      },
    },
  },
  RowBatchReport: {
    type: 'object',
    required: ['dry_run', 'applied', 'total', 'errors', 'rows'],
    description:
      'Informe de un lote TODO O NADA. Con `applied: false` y `dry_run: false` la respuesta es 422 y no se escribió nada.',
    properties: {
      dry_run: { type: 'boolean' },
      applied: { type: 'boolean' },
      total: { type: 'integer' },
      created: { type: 'integer' },
      updated: { type: 'integer' },
      unchanged: { type: 'integer' },
      errors: { type: 'integer' },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['row', 'status'],
          properties: {
            row: { type: 'integer', description: 'Posición en el lote, desde 1.' },
            key: { type: ['string', 'null'], description: 'SKU o código de la fila.' },
            status: { type: 'string', enum: ['created', 'updated', 'unchanged', 'error'] },
            reason: { type: 'string', description: 'Código estable del error de la fila.' },
            field: { type: ['string', 'null'], description: 'Campo de la fila que falló.' },
            message: { type: 'string' },
          },
        },
      },
    },
  },
}
