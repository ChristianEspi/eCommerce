/**
 * Ejemplos de RESPUESTA de la guía pública `/api` (2026-11-21).
 *
 * Las rutas, permisos, parámetros y cuerpos de entrada NO se escriben aquí:
 * salen de `API_ROUTES`, la misma tabla con la que el gateway despacha. Lo
 * único que la tabla no tiene es una respuesta de ejemplo, y por eso vive en
 * este mapa, indexado por `operationId`. Un test exige un ejemplo por cada
 * ruta: una ruta nueva sin documentar rompe la suite en vez de aparecer muda.
 *
 * Las formas son las que devuelven las funciones de la base
 * (`20261124190000_api_full_fields_read.sql`); los valores son ilustrativos.
 */

export const TOKEN_OPERATION_ID = 'issueToken'

export const TOKEN_REQUEST_EXAMPLE = {
  grant_type: 'client_credentials',
  client_id: 'ec_00000000000000000000000000000000',
  client_secret: 'tu-secret',
  scope: 'product.read stock.read order.read',
}

// 2026-11-24 · El pedido sale COMPLETO, en el listado, en el detalle y en el webhook.
const ORDER_FULL = {
  number: 'EC-20261121-00061',
  status: 'paid',
  payment_status: 'paid',
  fulfillment_status: 'in_progress',
  approval_status: 'not_required',
  source: 'storefront',
  store: 'miquimica',
  currency: 'PEN',
  tax_inclusive: true,
  subtotal: '208.31',
  tax_total: '37.49',
  shipping_total: '0.00',
  discount_total: '0.00',
  total: '245.80',
  purchase_order_number: 'OC-2026-0042',
  notes: 'Entrega en almacén central',
  correlation_id: 'c0f4…',
  placed_at: '2026-11-21T03:46:47Z',
  paid_at: '2026-11-21T03:47:02Z',
  fulfilled_at: null,
  cancelled_at: null,
  created_at: '2026-11-21T03:46:47Z',
  updated_at: '2026-11-21T09:10:00Z',
  customer: {
    email: 'compras@cliente.pe',
    name: 'Ana Compras',
    phone: '+51999999999',
    code: 'CLI-900',
    kind: 'company',
    legal_name: 'Botica Central S.A.C.',
    tax_id: '20123456789',
    tax_id_type: 'ruc',
    external_ids: { erp: 'C000900' },
  },
  business_account: { code: 'BA-900', name: 'Botica Central', payment_terms_days: 30, credit_status: 'ok' },
  shipping_address: { address: 'Av. Argentina 123', city: 'Lima', region: 'Lima', country: 'PE' },
  billing_address: {
    legal_name: 'Botica Central S.A.C.',
    tax_id: '20123456789',
    id_type: 'ruc',
    document_type: 'invoice',
    address: 'Jr. Lampa 456',
    city: 'Lima',
    country: 'PE',
  },
  approval: { status: 'not_required', decided_at: null, decided_by: null, reason: null },
  items: [
    {
      sku: 'QS-514574',
      product_sku: 'QS-514574',
      variant_sku: null,
      name: 'Bloqueador Solar FPS 50 150 ml',
      variant_label: null,
      variant_attributes: null,
      quantity: 2,
      uom_code: null,
      uom_factor: 1,
      base_quantity: 2,
      unit_price: '111.29',
      discount_amount: '0.00',
      amount_after_discount: '222.58',
      tax_category: 'IGV',
      tax_rate: 0.18,
      tax_amount: '33.95',
      tax_inclusive: true,
      line_total: '222.58',
      price_list: 'mayorista',
      price_source: 'price_list',
      discounts: [],
      components: null,
    },
  ],
  payments: [
    {
      amount: '245.80',
      amount_refunded: '0.00',
      currency: 'PEN',
      status: 'captured',
      provider: 'culqi',
      reference: 'chr_live_…',
      captured_at: '2026-11-21T03:47:02Z',
      settlement_reference: null,
      settled_at: null,
    },
  ],
  refunds: [],
  fulfillments: [
    {
      sequence: 1,
      state: 'shipped',
      method_code: 'courier',
      method_name: 'Envío a domicilio',
      strategy: 'ship',
      provider: null,
      warehouse: 'ALM-01',
      window_date: null,
      window_starts: null,
      window_ends: null,
      promised_from: '2026-11-22',
      promised_to: '2026-11-24',
      shipping_cost: '0.00',
      weight: 0.36,
      address: { address: 'Av. Argentina 123', city: 'Lima', country: 'PE' },
      contact_name: 'Ana Compras',
      contact_phone: '+51999999999',
      shipped_at: '2026-11-21T09:10:00Z',
      delivered_at: null,
      cancelled_at: null,
      cancel_reason: null,
      items: [{ sku: 'QS-514574', quantity: 2 }],
      shipments: [
        {
          state: 'in_transit',
          provider: null,
          service: 'olva',
          tracking_number: 'GR-T001-00012345',
          tracking_url: 'https://tracking.olva.pe/GR-T001-00012345',
          cost: null,
          weight: null,
          estimated_delivery: '2026-11-24',
          shipped_at: '2026-11-21T09:10:00Z',
          delivered_at: null,
        },
      ],
    },
  ],
  external_refs: [{ system: 'erp', type: 'sales_order', id: '4500012345', url: null, notes: null }],
}

const PRODUCT_FULL = {
  sku: 'QS-514574',
  name: 'Bloqueador Solar FPS 50 150 ml',
  slug: 'bloqueador-solar-fps-50-150-ml',
  kind: 'simple',
  status: 'published',
  currency: 'PEN',
  price: '111.29',
  compare_at_price: null,
  published_at: '2026-11-18T10:00:00Z',
  description: 'Protección muy alta para piel sensible.',
  highlights: ['Protección UVA/UVB', 'Resistente al agua'],
  gtin: '4005800077937',
  shipping_weight: 0.18,
  custom_fields: { codigo_qs: '514574' },
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-24T14:58:10Z',
  brand: { code: 'EUCERIN', name: 'Eucerin' },
  family: null,
  category: { slug: 'proteccion-solar', name: 'Protección solar' },
  tax_category: 'IGV',
  attributes: [{ code: 'fps', name: 'FPS', unit: null, value: 50 }],
  variants: [],
  units: [
    { code: 'UND', name: 'Unidad', factor: 1, is_base: true, is_sellable: true, price: null, barcode: null },
    { code: 'CJ12', name: 'Caja x 12', factor: 12, is_base: false, is_sellable: true, price: '1290.00', barcode: null },
  ],
  images: [{ path: 'org/company/products/qs-514574.webp', alt: 'Bloqueador', position: 0, is_primary: true, variant_sku: null }],
}

const CUSTOMER_FULL = {
  id: '0b1c…',
  kind: 'company',
  code: 'CLI-900',
  name: 'Botica Central',
  legal_name: 'Botica Central S.A.C.',
  tax_id: '20123456789',
  tax_id_type: 'ruc',
  email: 'compras@botica.pe',
  phone: '014445555',
  segment: 'mayorista',
  business_type: 'botica',
  tier: 'a',
  visit_frequency: 'weekly',
  geo: { lat: -12.05, lng: -77.04 },
  notes: null,
  is_active: true,
  created_at: '2026-11-18T22:43:45Z',
  updated_at: '2026-11-24T14:58:10Z',
  external_ids: { erp: 'C000900' },
  addresses: [
    {
      external_ref: 'D-01',
      label: 'Almacén central',
      recipient: null,
      phone: null,
      line1: 'Av. Argentina 123',
      line2: null,
      city: 'Lima',
      region: 'Lima',
      postal_code: null,
      country: 'PE',
      is_shipping: true,
      is_billing: false,
      is_default_shipping: true,
      is_default_billing: false,
      verification: 'unverified',
      is_active: true,
    },
  ],
  contacts: [{ name: 'Ana Compras', email: 'ana@botica.pe', phone: null, role_title: 'Compras', is_primary: true, is_active: true }],
  business_account: {
    code: 'BA-900',
    name: 'Botica Central',
    is_active: true,
    requires_approval: false,
    approval_threshold: null,
    purchase_order_required: true,
    credit_limit: '15000.00',
    payment_terms_days: 30,
    credit_status: 'ok',
    credit_watch_after_days: null,
    credit_block_after_days: null,
    notes: null,
  },
}

export const RESPONSE_EXAMPLES: Record<string, unknown> = {
  [TOKEN_OPERATION_ID]: {
    access_token: '…',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'product.read stock.read order.read',
  },
  listOrders: { data: [ORDER_FULL], next_cursor: null, server_time: '2026-11-24T15:00:00.000000Z' },
  getOrder: ORDER_FULL,
  createOrder: { ...ORDER_FULL, status: 'pending', payment_status: 'pending', source: 'api' },
  listProducts: { data: [PRODUCT_FULL], next_cursor: 'QS-514574', server_time: '2026-11-24T15:00:00.000000Z' },
  getProduct: PRODUCT_FULL,
  readStock: {
    sku: 'QS-514574',
    available: 181,
    in_stock: true,
    unknown: false,
    backorder: false,
    source: 'local',
    as_of: '2026-11-21T10:15:00Z',
    warehouses: [
      {
        code: 'ALM-ERP',
        name: 'Almacén central',
        source: 'erp',
        on_hand: 190,
        reserved: 9,
        available: 181,
        safety_stock: 0,
        reorder_point: 20,
        allow_backorder: false,
        synced_at: '2026-11-21T10:00:00Z',
      },
    ],
  },
  listCustomers: { data: [CUSTOMER_FULL], next_cursor: null, server_time: '2026-11-24T15:00:00.000000Z' },
  getCustomer: CUSTOMER_FULL,
  upsertCatalogProducts: {
    dry_run: false,
    applied: true,
    summary: { received: 1, created: 1, updated: 0, unchanged: 0, rejected: 0 },
    items: [
      {
        index: 0,
        sku: 'PRUEBA-API-001',
        status: 'created',
        product_id: '2c428293-…',
        publications: [{ store: 'miquimica', status: 'created' }],
        errors: [],
      },
    ],
  },
  // Contrato de integración v1 (2026-11-24).
  updateOrderStatus: {
    ...ORDER_FULL,
    changes: { changed: ['fulfillment_status', 'payment_status'], unchanged: [], external_refs: 2, shipment: true },
  },
  upsertCustomers: {
    dry_run: false,
    applied: true,
    total: 1,
    created: 1,
    updated: 0,
    errors: 0,
    rows: [{ row: 1, key: 'C-0001', status: 'created' }],
  },
  setStock: {
    dry_run: false,
    applied: true,
    total: 2,
    updated: 1,
    unchanged: 1,
    errors: 0,
    rows: [
      { row: 1, key: 'QS-514574', status: 'updated' },
      { row: 2, key: 'QS-514575', status: 'unchanged' },
    ],
  },
  upsertPriceListItems: {
    dry_run: false,
    applied: true,
    price_list: 'mayorista',
    total: 2,
    created: 1,
    updated: 1,
    errors: 0,
    rows: [
      { row: 1, key: 'QS-514574', status: 'updated' },
      { row: 2, key: 'QS-514574', status: 'created' },
    ],
  },
}

/** Cuerpo de ejemplo del lote: más completo que el de la tabla, para enseñar los campos. */
export const CATALOG_REQUEST_EXAMPLE = {
  products: [
    {
      sku: 'PRUEBA-API-001',
      gtin: '7750000000014',
      name: 'Producto de prueba API',
      description: 'Frasco de 150 ml.',
      kind: 'simple',
      stock: 10,
      custom_fields: { codigo_erp: '514574' },
      publications: [
        { store: 'miquimica', category_slug: 'cuidado-de-la-piel', status: 'published', price: '25.00', compare_at_price: '29.90' },
      ],
    },
  ],
}

export const WEBHOOK_BODY_EXAMPLE = {
  event_id: '9f1c…',
  event_type: 'order.created',
  delivery_id: '41aa…',
  occurred_at: '2026-11-21T03:46:48Z',
  data: { order_id: '…', order_number: 'EC-20261121-00061', status: 'paid', total: '245.80' },
}

export const WEBHOOK_SIGNATURE_SNIPPET = `// Node.js
const crypto = require('crypto')
function firmaValida(cabecera, cuerpoCrudo, secreto) {
  const partes = Object.fromEntries(cabecera.split(',').map((p) => p.split('=')))
  const esperada = crypto.createHmac('sha256', secreto)
    .update(\`\${partes.t}.\${cuerpoCrudo}\`).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(partes.v1 ?? ''))
}`

export const POSTMAN_TOKEN_SCRIPT = 'pm.environment.set("token", pm.response.json().access_token);'
