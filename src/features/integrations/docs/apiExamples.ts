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
 * (`20260828170400_enterprise_api_resources.sql`); los valores son ilustrativos.
 */

export const TOKEN_OPERATION_ID = 'issueToken'

export const TOKEN_REQUEST_EXAMPLE = {
  grant_type: 'client_credentials',
  client_id: 'ec_00000000000000000000000000000000',
  client_secret: 'tu-secret',
  scope: 'product.read stock.read order.read',
}

const ORDER_SUMMARY = {
  number: 'EC-20261121-00061',
  status: 'paid',
  payment_status: 'paid',
  fulfillment_status: 'in_progress',
  source: 'storefront',
  currency: 'PEN',
  subtotal: '208.31',
  tax_total: '37.49',
  shipping_total: '0.00',
  discount_total: '0.00',
  total: '245.80',
  placed_at: '2026-11-21T03:46:47Z',
  store: 'miquimica',
  customer: { email: 'compras@cliente.pe', name: 'Cliente SAC', phone: '+51999999999' },
}

const ORDER_FULL = {
  ...ORDER_SUMMARY,
  items: [
    { sku: 'QS-514574', name: 'Bloqueador Solar FPS 50 150 ml', quantity: 2, unit_price: '111.29', line_total: '222.58' },
  ],
}

export const RESPONSE_EXAMPLES: Record<string, unknown> = {
  [TOKEN_OPERATION_ID]: {
    access_token: '…',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'product.read stock.read order.read',
  },
  listOrders: { data: [ORDER_SUMMARY], next_cursor: null },
  getOrder: ORDER_FULL,
  createOrder: { ...ORDER_FULL, status: 'pending', payment_status: 'pending', source: 'api' },
  listProducts: {
    data: [
      {
        sku: 'QS-514574',
        name: 'Bloqueador Solar FPS 50 150 ml',
        slug: 'bloqueador-solar-fps-50-150-ml',
        kind: 'simple',
        status: 'published',
        currency: 'PEN',
        price: '111.29',
      },
    ],
    next_cursor: 'QS-514574',
  },
  readStock: { sku: 'QS-514574', available: 181, in_stock: true, as_of: '2026-11-21T10:15:00Z' },
  listCustomers: {
    data: [
      {
        id: '0b1c…',
        kind: 'business',
        code: 'B2B-QA-01',
        name: 'Cliente SAC',
        legal_name: 'Cliente Sociedad Anónima Cerrada',
        email: 'compras@cliente.pe',
        phone: '+51999999999',
        tax_id: '20123456789',
        is_active: true,
        created_at: '2026-11-18T22:43:45Z',
      },
    ],
    next_cursor: null,
  },
  upsertCatalogProducts: {
    dry_run: false,
    applied: true,
    summary: { received: 1, created: 1, updated: 0, unchanged: 0, rejected: 0 },
    items: [
      {
        index: 0,
        sku: 'PRUEBA-API-001',
        status: 'created',
        product_id: '2c428293-f73a-4354-87a7-5b997b03127c',
        publications: [{ store: 'miquimica', status: 'created' }],
        errors: [],
      },
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
