/**
 * La TABLA DE RUTAS de la API empresarial.
 *
 * Es la única fuente: de aquí salen el despacho de peticiones (`gateway.ts`) y
 * el documento OpenAPI (`openapi.ts`). Esa es toda la razón de que exista una
 * tabla en vez de un `switch`: una documentación escrita a mano envejece —hay
 * ejemplos de sobra de APIs cuyo `swagger.json` describe la versión del año
 * pasado— y una generada a partir del despacho real no puede mentir sobre qué
 * rutas hay, qué scope piden ni qué parámetros aceptan.
 *
 * Lo que una ruta NO declara es la lógica: cada una nombra la función de la
 * base que la sirve. La autorización, la derivación del tenant y las reglas de
 * negocio viven allí, donde no se pueden rodear desplegando mal esta función.
 * El borde traduce HTTP ↔ contrato y nada más.
 */
import type { ApiScope } from './contract.ts'

export type ApiParamKind = 'string' | 'integer' | 'timestamp' | 'boolean'

export interface ApiParam {
  readonly name: string
  readonly kind: ApiParamKind
  readonly required?: boolean
  readonly description: string
  /** Nombre del argumento de la función de la base. */
  readonly arg: string
}

export interface ApiRoute {
  readonly method: 'GET' | 'POST'
  /** Con marcadores entre llaves: `/v1/orders/{number}`. */
  readonly path: string
  readonly operationId: string
  readonly summary: string
  readonly scope: ApiScope
  /** Función de la base que la sirve. */
  readonly rpc: string
  /** Parámetros de ruta, en el orden en que aparecen. */
  readonly pathParams?: readonly ApiParam[]
  readonly query?: readonly ApiParam[]
  /**
   * Las escrituras EXIGEN `Idempotency-Key`. No es opcional a propósito: un
   * cliente HTTP que reintenta solo es el caso normal, no el raro, y una API
   * que acepta un alta sin clave está pidiendo pedidos duplicados.
   */
  readonly requiresIdempotencyKey?: boolean
  readonly requestExample?: Record<string, unknown>
  /** Estado de una escritura correcta. Por defecto 201 (alta). */
  readonly successStatus?: 200 | 201
  /**
   * Operación por lotes que devuelve un informe `{ dry_run, applied, … }`. Un
   * lote real no aplicado es 422 CON el informe: el socio necesita saber qué
   * fila falló, y un error genérico no se lo dice.
   */
  readonly batchReport?: boolean
  /** Tope del cuerpo en bytes. Por defecto 512 000. */
  readonly maxBodyBytes?: number
  /** Esquemas de `components.schemas` del cuerpo y de la respuesta. */
  readonly requestSchema?: string
  readonly responseSchema?: string
}

const LIMIT: ApiParam = {
  name: 'limit',
  kind: 'integer',
  description: 'Tamaño de página (1–200, por defecto 50).',
  arg: 'p_limit',
}

const STORE: ApiParam = {
  name: 'store',
  kind: 'string',
  description:
    'Slug de la tienda. Se puede omitir si la sociedad tiene una sola; con varias es obligatorio.',
  arg: 'p_store',
}

export const API_ROUTES: readonly ApiRoute[] = [
  {
    method: 'GET',
    path: '/v1/orders',
    operationId: 'listOrders',
    summary: 'Pedidos de la tienda, del más reciente al más antiguo.',
    scope: 'order.read',
    rpc: 'api_orders_list',
    query: [
      LIMIT,
      {
        name: 'cursor',
        kind: 'timestamp',
        description:
          'Cursor de la página siguiente: el `next_cursor` de la respuesta anterior. No se usa `offset` porque insertar filas mientras se pagina duplicaría o saltaría pedidos.',
        arg: 'p_cursor',
      },
      {
        name: 'status',
        kind: 'string',
        description: 'Filtra por estado del pedido.',
        arg: 'p_status',
      },
      STORE,
    ],
  },
  {
    method: 'GET',
    path: '/v1/orders/{number}',
    operationId: 'getOrder',
    summary: 'Un pedido por su NÚMERO, que es lo que ve el comercio y el comprador.',
    scope: 'order.read',
    rpc: 'api_order_get',
    pathParams: [
      { name: 'number', kind: 'string', required: true, description: 'Número de pedido.', arg: 'p_number' },
    ],
    query: [STORE],
  },
  {
    method: 'POST',
    path: '/v1/orders',
    operationId: 'createOrder',
    summary: 'Alta de pedido. Las líneas se identifican por SKU; el servidor resuelve el resto.',
    scope: 'order.create',
    rpc: 'api_order_create',
    requiresIdempotencyKey: true,
    requestExample: {
      store: 'mi-tienda',
      customer: { email: 'compras@cliente.test', name: 'Cliente', phone: '+51999999999' },
      items: [{ sku: 'SKU-001', quantity: 2 }],
      notes: 'Entrega en almacén central',
    },
  },
  {
    method: 'GET',
    path: '/v1/products',
    operationId: 'listProducts',
    summary: 'Catálogo de la tienda, publicado o no. Sin existencia: eso es `stock.read`.',
    scope: 'product.read',
    rpc: 'api_products_list',
    query: [
      LIMIT,
      {
        name: 'cursor',
        kind: 'string',
        description: 'Último SKU de la página anterior.',
        arg: 'p_cursor',
      },
      STORE,
    ],
  },
  {
    method: 'GET',
    path: '/v1/stock/{sku}',
    operationId: 'readStock',
    summary:
      'Disponibilidad de un SKU. Sale de la misma autoridad que usa la vitrina y el checkout, así que la API nunca contradice a la tienda.',
    scope: 'stock.read',
    rpc: 'api_stock_read',
    pathParams: [
      { name: 'sku', kind: 'string', required: true, description: 'SKU del artículo.', arg: 'p_sku' },
    ],
    query: [STORE],
  },
  {
    method: 'GET',
    path: '/v1/customers',
    operationId: 'listCustomers',
    summary: 'Ficha de clientes de la sociedad. Sin direcciones ni contactos.',
    scope: 'customer.read',
    rpc: 'api_customers_list',
    query: [
      LIMIT,
      {
        name: 'cursor',
        kind: 'timestamp',
        description: 'Cursor de la página siguiente.',
        arg: 'p_cursor',
      },
    ],
  },
  {
    method: 'POST',
    path: '/v1/catalog/products:batch',
    operationId: 'upsertCatalogProducts',
    summary:
      'Crea o actualiza productos en lote: upsert por SKU en el maestro de la sociedad, publicación por tienda y precio de variante por tienda. Todo o nada; con `dry_run=true` valida sin escribir.',
    scope: 'catalog.write',
    rpc: 'api_catalog_upsert',
    query: [
      {
        name: 'dry_run',
        kind: 'boolean',
        description: 'Simula: valida y devuelve el informe sin escribir nada.',
        arg: 'p_dry_run',
      },
    ],
    requiresIdempotencyKey: true,
    successStatus: 200,
    batchReport: true,
    maxBodyBytes: 5_000_000,
    requestSchema: 'CatalogBatchRequest',
    responseSchema: 'CatalogBatchReport',
    requestExample: {
      products: [
        {
          sku: 'QS-514574',
          gtin: '4005800077937',
          name: 'Bloqueador Solar FPS 50 150 ml',
          kind: 'simple',
          stock: 181,
          custom_fields: { codigo_qs: '514574' },
          publications: [{ store: 'mi-tienda', status: 'published', price: '111.29' }],
        },
      ],
    },
  },
]

export interface RouteMatch {
  readonly route: ApiRoute
  readonly params: Record<string, string>
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0)
}

/**
 * Resuelve una ruta.
 *
 * Devuelve `null` cuando no hay ninguna con ese camino, y `methodMismatch`
 * cuando el camino existe pero el método no: son dos respuestas distintas (404
 * y 405) y confundirlas le dice a quien integra que el recurso no existe cuando
 * lo que pasa es que lo está pidiendo mal.
 */
export function matchRoute(
  method: string,
  pathname: string,
): { match: RouteMatch | null; methodMismatch: boolean } {
  const wanted = segmentsOf(pathname)
  let methodMismatch = false

  for (const route of API_ROUTES) {
    const declared = segmentsOf(route.path)
    if (declared.length !== wanted.length) continue

    const params: Record<string, string> = {}
    let ok = true
    for (let index = 0; index < declared.length; index += 1) {
      const piece = declared[index] as string
      const actual = wanted[index] as string
      if (piece.startsWith('{') && piece.endsWith('}')) {
        const name = piece.slice(1, -1)
        if (actual.length === 0) {
          ok = false
          break
        }
        params[name] = decodeURIComponent(actual)
      } else if (piece !== actual) {
        ok = false
        break
      }
    }
    if (!ok) continue

    if (route.method !== method.toUpperCase()) {
      methodMismatch = true
      continue
    }
    return { match: { route, params }, methodMismatch: false }
  }

  return { match: null, methodMismatch }
}

/** Camino con los marcadores intactos: es lo que se guarda en `api_requests`. */
export function routeTemplate(route: ApiRoute): string {
  return route.path
}
