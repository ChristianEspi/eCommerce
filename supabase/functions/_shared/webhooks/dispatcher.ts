/**
 * El TRABAJADOR que vacía la cola de webhooks. Puro, con puertos.
 *
 * Hasta P13 el marco de integraciones tenía todo menos esto: «`ops_health` mide
 * la profundidad de las colas; quién las vacía sigue siendo trabajo de P14»
 * (`docs/STATE.md`). Este archivo es ese consumidor, y es el primero real del
 * outbox en todo el repositorio.
 *
 * ## Lo que NO decide
 *
 * Ni cuándo reintentar, ni cuántas veces, ni cuándo abrir el disyuntor. Eso lo
 * decide la base: `integration_claim` reparte sin entregar dos veces
 * (`for update skip locked`) y respeta el circuito del destino;
 * `integration_succeed` / `integration_fail` calculan el backoff con jitter y
 * mueven el mensaje a la cola muerta cuando se agotan los intentos. El
 * trabajador solo hace la llamada HTTP y cuenta qué pasó. Es deliberado: un
 * trabajador se cae a mitad, se despliega dos veces o se invoca desde otro
 * sitio; una transacción de Postgres, no.
 *
 * ## Lo que sí decide, y por qué
 *
 *  · **Tiempo máximo por entrega.** Sin él, un endpoint que acepta la conexión
 *    y no responde nunca retiene el mensaje `in_flight` hasta que el rescate de
 *    huérfanos lo suelte cinco minutos después, y con la concurrencia limitada
 *    eso es un endpoint bloqueando la cola de todos.
 *  · **Qué se guarda del fallo.** Un código HTTP y una frase nuestra. NUNCA el
 *    cuerpo de la respuesta: lo escribe un tercero y acaba trayendo dentro
 *    datos de otros clientes suyos, y ese texto se pinta en el monitor.
 *  · **En qué espacio se busca el secreto.** Solo en el de la sociedad del
 *    mensaje (`webhookSecretEnvName`): el tenant nombra la variable, pero no
 *    puede nombrar una de la plataforma ni de otra sociedad.
 *  · **Que un secreto ausente no se reintente en vano.** Si el endpoint no
 *    tiene resuelto su secreto, la entrega falla igual —el mensaje no puede
 *    salir sin firmar— pero se dice con un código propio, porque reintentarlo
 *    seis veces con backoff no lo va a arreglar: lo arregla el operador.
 */
import { signWebhook } from './signature.ts'
import {
  DELIVERY_ID_HEADER,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  SIGNATURE_HEADER,
} from './signature.ts'

export interface OutboxMessage {
  readonly id: string
  readonly organization_id: string
  readonly company_id: string
  readonly provider_code: string
  readonly operation: string
  readonly target: string
  readonly payload: Record<string, unknown>
  readonly attempts: number
  readonly correlation_id: string | null
}

export interface WebhookTarget {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly api_version: string
  readonly secret_ref: string
}

export interface DispatcherPorts {
  /** Reclama mensajes. Es `integration_claim`: reparte sin entregar dos veces. */
  claim(providerCode: string, worker: string, limit: number): Promise<OutboxMessage[]>
  /** El endpoint al que va este mensaje, o `null` si ya no existe. */
  resolveTarget(targetId: string): Promise<WebhookTarget | null>
  /**
   * Resuelve un nombre de variable contra el vault del despliegue. Recibe el
   * nombre YA encerrado por `webhookSecretEnvName`, nunca el `secret_ref` crudo.
   */
  resolveSecret(envName: string): string | null
  /** La llamada HTTP. Puerto para poder probar el ciclo sin red. */
  send(input: {
    url: string
    body: string
    headers: Record<string, string>
    timeoutMs: number
  }): Promise<{ status: number }>
  succeed(outboxId: string, latencyMs: number, statusCode: number): Promise<void>
  fail(outboxId: string, error: string, statusCode: number | null): Promise<void>
  now(): number
}

export interface DispatchOptions {
  readonly worker: string
  readonly batchSize?: number
  readonly timeoutMs?: number
}

export interface DispatchReport {
  readonly claimed: number
  readonly delivered: number
  readonly failed: number
  readonly results: ReadonlyArray<{
    readonly outboxId: string
    readonly ok: boolean
    readonly status: number | null
    readonly code?: string
  }>
}

export const WEBHOOK_PROVIDER_CODE = 'webhook'

/**
 * Nombre REAL de la variable del despliegue para el secreto de un endpoint.
 *
 * `webhook_endpoints.secret_ref` lo escribe el administrador del TENANT. Si se
 * resolviera tal cual contra el entorno de la función, ese administrador podría
 * apuntar a cualquier variable del despliegue —`SUPABASE_SERVICE_ROLE_KEY`,
 * `EBIM_WORKER_KEY`, el secreto de webhook de una pasarela o el nombre que usa
 * OTRA sociedad— y el trabajador firmaría con ella cuerpos que se entregan en
 * la URL que ese mismo administrador eligió. Además, la diferencia entre
 * «entregado» y `SECRETO_NO_CONFIGURADO` le diría qué variables existen.
 *
 * Por eso el nombre se ENCIERRA en el espacio de la sociedad dueña del mensaje:
 * `EBIM_WH_<company_id en hex, mayúsculas>_<secret_ref>`. La sociedad sale de la
 * fila del outbox —que escribe la base, no el tenant—, así que ningún
 * `secret_ref` puede nombrar una variable fuera de su propio espacio. Devuelve
 * `null` si algo no tiene la forma esperada: sin nombre no hay resolución.
 */
export function webhookSecretEnvName(companyId: string, secretRef: string): string | null {
  const company = companyId.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(company)) return null
  if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(secretRef)) return null
  return `EBIM_WH_${company.replace(/-/g, '').toUpperCase()}_${secretRef}`
}

/**
 * Un 2xx es entrega. Todo lo demás no lo es, y da igual cuál: el receptor que
 * responde 302 a un webhook no lo procesó, y seguir la redirección sería
 * entregar datos firmados a una URL que nadie registró.
 */
function isDelivered(status: number): boolean {
  return status >= 200 && status < 300
}

export async function dispatchWebhooks(
  ports: DispatcherPorts,
  options: DispatchOptions,
): Promise<DispatchReport> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 10, 50))
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 10_000, 30_000))

  const messages = await ports.claim(WEBHOOK_PROVIDER_CODE, options.worker, batchSize)
  const results: Array<{ outboxId: string; ok: boolean; status: number | null; code?: string }> = []
  let delivered = 0
  let failed = 0

  for (const message of messages) {
    const started = ports.now()
    try {
      const target = await ports.resolveTarget(message.target)
      if (!target) {
        await ports.fail(message.id, 'ENDPOINT_NO_EXISTE: el destino ya no está registrado', null)
        failed += 1
        results.push({ outboxId: message.id, ok: false, status: null, code: 'ENDPOINT_NO_EXISTE' })
        continue
      }

      const envName = webhookSecretEnvName(message.company_id, target.secret_ref)
      const secret = envName ? ports.resolveSecret(envName) : null
      if (!secret) {
        await ports.fail(
          message.id,
          `SECRETO_NO_CONFIGURADO: falta ${envName ?? target.secret_ref} en el despliegue`,
          null,
        )
        failed += 1
        results.push({
          outboxId: message.id,
          ok: false,
          status: null,
          code: 'SECRETO_NO_CONFIGURADO',
        })
        continue
      }

      const rawBody = JSON.stringify(message.payload)
      const signed = await signWebhook({ secret, rawBody })

      const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': `ebim-ecommerce-webhooks/${target.api_version}`,
        [SIGNATURE_HEADER]: signed.header,
        [EVENT_ID_HEADER]: String(message.payload.event_id ?? ''),
        [EVENT_TYPE_HEADER]: String(message.payload.event_type ?? message.operation),
        [DELIVERY_ID_HEADER]: String(message.payload.delivery_id ?? ''),
      }
      // El HILO viaja con la entrega. Un receptor que lo devuelva en su propio
      // aviso cose los dos lados del incidente; uno que no, al menos lo tiene
      // en sus logs para citarlo al abrir una incidencia.
      if (message.correlation_id) headers['x-correlation-id'] = message.correlation_id

      const response = await ports.send({ url: target.url, body: rawBody, headers, timeoutMs })
      const latency = Math.max(0, ports.now() - started)

      if (isDelivered(response.status)) {
        await ports.succeed(message.id, latency, response.status)
        delivered += 1
        results.push({ outboxId: message.id, ok: true, status: response.status })
      } else {
        await ports.fail(
          message.id,
          `El destino respondió ${response.status}`,
          response.status,
        )
        failed += 1
        results.push({ outboxId: message.id, ok: false, status: response.status })
      }
    } catch (error) {
      // Aquí solo llega lo que la RED o el tiempo agotado producen. El texto
      // es NUESTRO, con el nombre del error a lo sumo: el mensaje de una
      // excepción de red puede llevar dentro la URL entera con su cadena de
      // consulta, y esto se pinta en el monitor.
      const name = error instanceof Error ? error.name : 'Error'
      await ports.fail(message.id, `No se pudo entregar (${name})`, null)
      failed += 1
      results.push({ outboxId: message.id, ok: false, status: null, code: 'ENTREGA_FALLIDA' })
    }
  }

  return { claimed: messages.length, delivered, failed, results }
}
