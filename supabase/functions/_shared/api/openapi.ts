/**
 * El documento OpenAPI, GENERADO desde la tabla de rutas.
 *
 * No hay un `openapi.json` en el repositorio y es deliberado. Una especificación
 * escrita a mano describe la API del día que se escribió: se actualiza cuando
 * alguien se acuerda, y nadie se acuerda. Generándola desde `API_ROUTES` —la
 * MISMA tabla que despacha las peticiones— no puede describir una ruta que no
 * existe ni omitir una que sí; y hay un test que compara las dos listas por si
 * algún día alguien intenta despachar fuera de la tabla.
 *
 * Se sirve en `GET /v1/openapi.json`, sin token: saber QUÉ ofrece la API no es
 * un secreto, y pedir credenciales para leer la documentación es la forma más
 * segura de que un socio integre a base de prueba y error.
 */
import { API_ERROR_CODES, API_ERROR_STATUS, API_SCOPES, API_VERSION, IDEMPOTENCY_HEADER, CORRELATION_HEADER } from './contract.ts'
import { API_ROUTES, type ApiParam, type ApiRoute } from './routes.ts'
import { CATALOG_SCHEMAS } from './catalogSchemas.ts'

const TYPE_BY_KIND: Record<ApiParam['kind'], Record<string, unknown>> = {
  string: { type: 'string' },
  integer: { type: 'integer' },
  timestamp: { type: 'string', format: 'date-time' },
  boolean: { type: 'boolean' },
}

const schemaRef = (name: string): Record<string, unknown> => ({ $ref: `#/components/schemas/${name}` })

function parameterOf(param: ApiParam, location: 'path' | 'query'): Record<string, unknown> {
  return {
    name: param.name,
    in: location,
    required: location === 'path' ? true : Boolean(param.required),
    description: param.description,
    schema: TYPE_BY_KIND[param.kind],
  }
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  }
}

function operationOf(route: ApiRoute): Record<string, unknown> {
  const parameters = [
    ...(route.pathParams ?? []).map((param) => parameterOf(param, 'path')),
    ...(route.query ?? []).map((param) => parameterOf(param, 'query')),
  ]

  if (route.requiresIdempotencyKey) {
    parameters.push({
      name: IDEMPOTENCY_HEADER,
      in: 'header',
      required: true,
      description:
        'Clave de idempotencia. Repetir la misma clave con el mismo cuerpo devuelve la primera respuesta; con otro cuerpo, 409.',
      schema: { type: 'string', minLength: 8, maxLength: 200 },
    })
  }

  parameters.push({
    name: CORRELATION_HEADER,
    in: 'header',
    required: false,
    description:
      'Hilo del incidente. Si se envía, se conserva y vuelve en la respuesta; si no, el servidor abre uno y lo devuelve.',
    schema: { type: 'string' },
  })

  const operation: Record<string, unknown> = {
    operationId: route.operationId,
    summary: route.summary,
    security: [{ bearerAuth: [route.scope] }],
    parameters,
    responses: {
      '200': { description: 'Correcto' },
      '400': errorResponse('Petición inválida'),
      '401': errorResponse('Token ausente, inválido o caducado'),
      '403': errorResponse('El token no incluye el permiso necesario'),
      '404': errorResponse('El recurso no existe en esta sociedad'),
      '429': errorResponse('Límite de tasa superado'),
    },
  }

  if (route.method === 'POST') {
    const responses = operation.responses as Record<string, unknown>
    if (route.successStatus === 200) {
      delete responses['200']
      responses['200'] = route.responseSchema
        ? {
            description: 'Correcto',
            content: { 'application/json': { schema: schemaRef(route.responseSchema) } },
          }
        : { description: 'Correcto' }
    } else {
      delete responses['200']
      responses['201'] = { description: 'Creado' }
    }
    if (route.batchReport) {
      responses['413'] = errorResponse('Lote demasiado grande; envíalo en partes')
      responses['422'] = {
        description: 'Una o más filas no pasan la validación; no se escribió nada',
        content: {
          'application/json': {
            schema: route.responseSchema ? schemaRef(route.responseSchema) : { type: 'object' },
          },
        },
      }
    }
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: route.requestSchema ? schemaRef(route.requestSchema) : { type: 'object' },
          ...(route.requestExample ? { example: route.requestExample } : {}),
        },
      },
    }
    ;(operation.responses as Record<string, unknown>)['409'] = errorResponse(
      'La clave de idempotencia ya se usó con otro contenido, o la operación sigue en curso',
    )
  }

  return operation
}

export function buildOpenApiDocument(serverUrl = '/'): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const route of API_ROUTES) {
    const entry = paths[route.path] ?? (paths[route.path] = {})
    entry[route.method.toLowerCase()] = operationOf(route)
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'eCommerce by EBIM · API de socio',
      version: API_VERSION,
      description:
        'API server-to-server para sistemas de terceros. Autenticación OAuth 2.0 con el grant ' +
        '`client_credentials`; los permisos son las operaciones canónicas del dominio. ' +
        'Los importes viajan como cadena decimal, nunca como número de coma flotante. ' +
        'El transporte es HTTPS y lo termina la plataforma.',
    },
    servers: [{ url: serverUrl }],
    paths: {
      '/v1/oauth/token': {
        post: {
          operationId: 'issueToken',
          summary: 'Emite un token de acceso a partir de `client_id` y `client_secret`.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['grant_type', 'client_id', 'client_secret'],
                  properties: {
                    grant_type: { type: 'string', enum: ['client_credentials'] },
                    client_id: { type: 'string' },
                    client_secret: { type: 'string' },
                    scope: {
                      type: 'string',
                      description:
                        'Permisos pedidos, separados por espacios. Se emite la intersección con lo concedido; pedir de más no amplía nada.',
                    },
                  },
                },
                example: {
                  grant_type: 'client_credentials',
                  client_id: 'ec_00000000000000000000000000000000',
                  client_secret: '…',
                  scope: 'order.read stock.read',
                },
              },
            },
          },
          responses: {
            '200': { description: 'Token emitido' },
            '400': errorResponse('Petición inválida'),
            '401': errorResponse('Credencial inválida'),
          },
        },
      },
      ...paths,
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
      },
      schemas: {
        ...CATALOG_SCHEMAS,
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'status'],
              properties: {
                code: { type: 'string', enum: [...API_ERROR_CODES] },
                message: { type: 'string' },
                status: {
                  type: 'integer',
                  enum: [...new Set(Object.values(API_ERROR_STATUS))].sort((a, b) => a - b),
                },
                correlation_id: { type: 'string' },
                request_id: { type: 'string' },
              },
            },
          },
        },
      },
    },
    'x-scopes': [...API_SCOPES],
  }
}
