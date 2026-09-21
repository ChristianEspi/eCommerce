/**
 * La puerta de la API empresarial: pura, con PUERTOS, sin SDK ni `Deno`.
 *
 * Todo lo que decide esta función se puede probar sin levantar nada, y esa es
 * la razón de que esté separada de `functions/api/index.ts`: la parte difícil
 * de una API de socio no es hablar HTTP, es el orden en que se comprueban las
 * cosas. Ese orden es una decisión de seguridad y aquí está escrito una vez:
 *
 *   1. versión de la ruta   → una `/v2` inventada no llega a tocar la base;
 *   2. token y scope        → antes de mirar el cuerpo, para que un cuerpo mal
 *                             formado de alguien sin credencial no dé pistas;
 *   3. límite de tasa       → después de autenticar, porque el contador es POR
 *                             credencial; contarlo antes permitiría agotar el
 *                             cupo de un socio desde fuera con su `client_id`;
 *   4. idempotencia         → reservar la clave ANTES de operar;
 *   5. la operación         → una función de la base, que deriva el tenant;
 *   6. cerrar               → guardar la respuesta idempotente y el estado.
 *
 * Ningún paso deriva el tenant. No hay un solo sitio en este archivo donde se
 * lea `organization_id` o `company_id`: los devuelve la base a partir de la
 * fila de la credencial. Es la regla 6 del contrato de ejecución en su forma
 * más fuerte —no existe el parámetro— y `src/architecture.test.ts` no puede
 * verlo porque esto no está bajo `src/`, así que lo comprueba
 * `supabase/tests/enterprise-api.test.ts` contra Postgres real.
 */
import {
  ApiError,
  API_VERSION,
  CORRELATION_HEADER,
  IDEMPOTENCY_HEADER,
  RATE_LIMIT_HEADER,
  RATE_REMAINING_HEADER,
  REQUEST_HEADER,
  toApiError,
  type ApiErrorBody,
} from './contract.ts'
import { buildOpenApiDocument } from './openapi.ts'
import { API_ROUTES, matchRoute, type ApiParam, type ApiRoute } from './routes.ts'

export interface ApiTrace {
  readonly correlationId: string
  readonly requestId: string
}

export interface ApiAuthContext {
  readonly api_client_id: string
  readonly client_id: string
  readonly scopes: readonly string[]
  readonly rate_limit_per_minute: number
}

export interface GatewayPorts {
  /** sha256 hexadecimal. El token NUNCA viaja a la base en claro. */
  hash(value: string): Promise<string>
  issueToken(input: {
    clientId: string
    secret: string
    scopes: string[] | null
  }): Promise<Record<string, unknown>>
  authenticate(tokenHash: string, scope: string): Promise<ApiAuthContext>
  rateLimit(input: {
    apiClientId: string
    method: string
    route: string
  }): Promise<{ request_id: string; limit: number; remaining: number }>
  completeRequest(requestId: string, status: number): Promise<void>
  idempotencyBegin(input: {
    apiClientId: string
    key: string
    requestHash: string
  }): Promise<{ status: string; http_status?: number; response?: unknown }>
  idempotencyFinish(input: {
    apiClientId: string
    key: string
    status: number
    response: unknown
  }): Promise<void>
  /** Llama a la función de la base que sirve el recurso. */
  callResource(rpc: string, args: Record<string, unknown>): Promise<unknown>
}

export interface GatewayResult {
  readonly status: number
  readonly body: unknown
  readonly headers: Record<string, string>
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,200}$/
const CLIENT_ID_RE = /^ec_[a-f0-9]{32}$/

function errorBody(error: ApiError, trace: ApiTrace): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      status: error.status,
      correlation_id: trace.correlationId,
      request_id: trace.requestId,
    },
  }
}

function bearerToken(headers: Headers): string {
  const raw = headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim())
  const token = match?.[1]?.trim()
  if (!token) throw new ApiError('NO_AUTENTICADO', 'Falta la cabecera Authorization: Bearer')
  return token
}

/**
 * Convierte los parámetros declarados en argumentos de la función de la base.
 *
 * Solo se pasa lo que la ruta DECLARA. Un parámetro no declarado se ignora en
 * silencio en vez de reenviarse: la alternativa —pasar la query entera— haría
 * que añadir un argumento a una función de la base abriera un filtro público
 * sin que nadie lo decidiera.
 */
function argsFor(route: ApiRoute, params: Record<string, string>, url: URL): Record<string, unknown> {
  const args: Record<string, unknown> = {}

  const read = (param: ApiParam, raw: string | null): void => {
    if (raw === null || raw.trim() === '') {
      if (param.required) {
        throw new ApiError('PETICION_INVALIDA', `Falta el parámetro ${param.name}`)
      }
      return
    }
    if (param.kind === 'integer') {
      const value = Number.parseInt(raw, 10)
      if (!Number.isFinite(value)) {
        throw new ApiError('PETICION_INVALIDA', `El parámetro ${param.name} tiene que ser un entero`)
      }
      args[param.arg] = value
      return
    }
    if (param.kind === 'boolean') {
      if (raw !== 'true' && raw !== 'false') {
        throw new ApiError('PETICION_INVALIDA', `El parámetro ${param.name} es true o false`)
      }
      args[param.arg] = raw === 'true'
      return
    }
    if (param.kind === 'timestamp') {
      if (Number.isNaN(Date.parse(raw))) {
        throw new ApiError('PETICION_INVALIDA', `El parámetro ${param.name} no es una fecha válida`)
      }
      args[param.arg] = raw
      return
    }
    args[param.arg] = raw
  }

  for (const param of route.pathParams ?? []) read(param, params[param.name] ?? null)
  for (const param of route.query ?? []) read(param, url.searchParams.get(param.name))
  return args
}

const DEFAULT_MAX_BODY_BYTES = 512_000

async function readJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new ApiError('PETICION_INVALIDA', 'Se espera application/json')
  }
  const raw = await request.text()
  if (raw.length > maxBytes) {
    // Una ruta que declara su propio tope es un lote: pasarse se dice con 413
    // para que el socio parta el envío en vez de reintentarlo tal cual.
    if (maxBytes !== DEFAULT_MAX_BODY_BYTES) {
      throw new ApiError('LOTE_DEMASIADO_GRANDE', `El lote supera ${maxBytes} bytes; envíalo en partes`)
    }
    throw new ApiError('PETICION_INVALIDA', 'El cuerpo de la petición es demasiado grande')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw === '' ? '{}' : raw)
  } catch {
    throw new ApiError('PETICION_INVALIDA', 'El cuerpo no es JSON válido')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('PETICION_INVALIDA', 'El cuerpo tiene que ser un objeto JSON')
  }
  return parsed as Record<string, unknown>
}

/**
 * El grant `client_credentials`. Va por su propia rama porque es la única ruta
 * sin token: pedirle un token a quien viene a pedir un token es un bucle.
 */
async function handleToken(
  request: Request,
  ports: GatewayPorts,
): Promise<{ status: number; body: unknown }> {
  const body = await readJsonBody(request)
  const grant = String(body.grant_type ?? '')
  if (grant !== 'client_credentials') {
    throw new ApiError('PETICION_INVALIDA', 'grant_type tiene que ser client_credentials')
  }

  const clientId = String(body.client_id ?? '').trim()
  const secret = String(body.client_secret ?? '').trim()
  if (!CLIENT_ID_RE.test(clientId) || secret.length < 16) {
    // Mismo error para forma inválida y para credencial que no existe: la
    // diferencia le diría a quien prueba si un `client_id` es real.
    throw new ApiError('CREDENCIAL_INVALIDA', 'Cliente o secreto no válidos')
  }

  const scopeText = typeof body.scope === 'string' ? body.scope.trim() : ''
  const scopes = scopeText === '' ? null : scopeText.split(/\s+/).filter(Boolean)

  return { status: 200, body: await ports.issueToken({ clientId, secret, scopes }) }
}

/**
 * Sirve una petición de la API empresarial.
 *
 * Devuelve SIEMPRE un resultado, nunca lanza: quien la llama solo tiene que
 * convertirlo en `Response`. Un borde que tuviera que acordarse de capturar es
 * un borde que un día no se acuerda y devuelve una traza al socio.
 */
export async function handleApiRequest(
  request: Request,
  ports: GatewayPorts,
  trace: ApiTrace,
): Promise<GatewayResult> {
  const headers: Record<string, string> = {
    [CORRELATION_HEADER]: trace.correlationId,
    [REQUEST_HEADER]: trace.requestId,
  }

  const url = new URL(request.url)
  // La función puede desplegarse bajo cualquier prefijo. Lo que importa es el
  // camino a partir de `/v1`, que es donde empieza el contrato: buscarlo en vez
  // de asumir el prefijo evita que un cambio de despliegue rompa todas las
  // rutas a la vez.
  //
  // `lastIndexOf` y no `indexOf`, y no es un detalle: la plataforma sirve las
  // Edge Functions bajo `/functions/v1/<funcion>`, así que el camino real trae
  // DOS veces `/v1/` y quedarse con la primera daría `/v1/api/v1/orders`, que
  // no es ninguna ruta. Hay un caso que lo comprueba con el prefijo real.
  const marker = url.pathname.lastIndexOf(`/${API_VERSION}/`)
  const pathname =
    marker >= 0
      ? url.pathname.slice(marker)
      : url.pathname.endsWith(`/${API_VERSION}`)
        ? `/${API_VERSION}`
        : url.pathname

  let requestId: string | null = null
  let auth: ApiAuthContext | null = null

  try {
    // --- Documentación: pública y sin token -------------------------------
    if (request.method === 'GET' && pathname === `/${API_VERSION}/openapi.json`) {
      return { status: 200, body: buildOpenApiDocument(url.origin), headers }
    }

    // --- Versión ----------------------------------------------------------
    const version = pathname.split('/').filter(Boolean)[0] ?? ''
    if (!/^v[0-9]{1,3}$/.test(version)) {
      throw new ApiError('RECURSO_NO_ENCONTRADO', 'Esa ruta no existe en esta API')
    }
    if (version !== API_VERSION) {
      throw new ApiError(
        'VERSION_NO_SOPORTADA',
        `Esta API sirve ${API_VERSION}; ${version} no está disponible`,
      )
    }

    // --- Emisión de token -------------------------------------------------
    if (pathname === `/${API_VERSION}/oauth/token`) {
      if (request.method !== 'POST') throw new ApiError('METODO_NO_PERMITIDO', 'Solo POST')
      const result = await handleToken(request, ports)
      return { status: result.status, body: result.body, headers }
    }

    // --- Ruta -------------------------------------------------------------
    const { match, methodMismatch } = matchRoute(request.method, pathname)
    if (!match) {
      if (methodMismatch) {
        throw new ApiError('METODO_NO_PERMITIDO', `Método ${request.method} no permitido aquí`)
      }
      throw new ApiError('RECURSO_NO_ENCONTRADO', 'Esa ruta no existe en esta API')
    }
    const { route, params } = match

    // --- Token y scope ----------------------------------------------------
    const tokenHash = await ports.hash(bearerToken(request.headers))
    auth = await ports.authenticate(tokenHash, route.scope)

    // --- Límite de tasa ---------------------------------------------------
    const limit = await ports.rateLimit({
      apiClientId: auth.api_client_id,
      method: route.method,
      route: route.path,
    })
    requestId = limit.request_id
    headers[RATE_LIMIT_HEADER] = String(limit.limit)
    headers[RATE_REMAINING_HEADER] = String(limit.remaining)

    // --- Lectura ----------------------------------------------------------
    if (route.method === 'GET') {
      const data = await ports.callResource(route.rpc, {
        p_api_client_id: auth.api_client_id,
        ...argsFor(route, params, url),
      })
      await ports.completeRequest(requestId, 200)
      return { status: 200, body: data, headers }
    }

    // --- Escritura, con idempotencia obligatoria --------------------------
    const key = (request.headers.get(IDEMPOTENCY_HEADER) ?? '').trim()
    if (route.requiresIdempotencyKey && !IDEMPOTENCY_KEY_RE.test(key)) {
      throw new ApiError(
        'PETICION_INVALIDA',
        `Falta la cabecera ${IDEMPOTENCY_HEADER} o no tiene la forma esperada`,
      )
    }

    // Los parámetros declarados se validan ANTES de reservar la clave: un
    // `dry_run=quizas` es un 400 que no gasta la clave del socio.
    const args = argsFor(route, params, url)
    const body = await readJsonBody(request, route.maxBodyBytes)
    // La huella se calcula sobre el cuerpo REORDENADO por clave: dos envíos con
    // las mismas claves en otro orden son la misma petición, y tratarlos como
    // distintas devolvería un 409 a un cliente que no hizo nada mal. Si la
    // ruta declara parámetros, entran en la huella: la misma clave no puede
    // devolver una simulación a quien ahora pide aplicar.
    const requestHash = await ports.hash(
      stableStringify(Object.keys(args).length > 0 ? { body, query: args } : body),
    )

    const reserved = await ports.idempotencyBegin({
      apiClientId: auth.api_client_id,
      key,
      requestHash,
    })

    if (reserved.status === 'repetido') {
      const status = reserved.http_status ?? 200
      await ports.completeRequest(requestId, status)
      // La MISMA respuesta que la primera vez. Es lo que hace que un reintento
      // automático del socio sea inofensivo en vez de crear un segundo pedido.
      return { status, body: reserved.response, headers: { ...headers, 'idempotent-replay': 'true' } }
    }
    if (reserved.status === 'en_curso') {
      throw new ApiError(
        'IDEMPOTENCIA_EN_CURSO',
        'Esa operación se está procesando; vuelve a consultar en unos segundos',
      )
    }

    const data = await ports.callResource(route.rpc, {
      p_api_client_id: auth.api_client_id,
      ...args,
      p_payload: body,
    })

    const status = writeStatus(route, data)
    await ports.idempotencyFinish({
      apiClientId: auth.api_client_id,
      key,
      status,
      response: data,
    })
    await ports.completeRequest(requestId, status)
    return { status, body: data, headers }
  } catch (error) {
    const apiError = toApiError(error)
    if (requestId) {
      // Sin `await` en cascada de fallos: si guardar el estado falla, el error
      // que se devuelve sigue siendo el original y no el del registro.
      try {
        await ports.completeRequest(requestId, apiError.status)
      } catch {
        /* el registro de la petición no puede cambiar la respuesta */
      }
    }
    return { status: apiError.status, body: errorBody(apiError, trace), headers }
  }
}

/**
 * Estado de una escritura. Un lote real que no se aplicó es 422 y lleva el
 * informe: se guarda así también en la idempotencia, para que el reintento con
 * la misma clave reciba el mismo 422 y no un 200 engañoso.
 */
function writeStatus(route: ApiRoute, data: unknown): number {
  if (route.batchReport && data !== null && typeof data === 'object') {
    const report = data as { applied?: unknown; dry_run?: unknown }
    if (report.applied === false && report.dry_run === false) return 422
  }
  return route.successStatus ?? 201
}

/**
 * JSON con las claves ordenadas, en profundidad. Es lo que hace que la huella
 * de idempotencia no dependa del orden en que el cliente serializó su objeto.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(',')}}`
}

/** Las rutas que esta puerta sabe servir. Lo usa el test de contrato. */
export function servedRoutes(): readonly ApiRoute[] {
  return API_ROUTES
}
