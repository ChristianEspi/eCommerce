/**
 * Transporte hacia Anthropic. Vive en `_runtime` y no en `_shared` porque
 * importa el SDK con especificador `npm:` y solo tiene sentido dentro de Deno.
 *
 * Lo que se puede razonar sin red —qué se le deja devolver al modelo, cómo se
 * filtra, cómo se clasifica un fallo, qué modelo le toca a cada uso— está en
 * `_shared/ai.ts` y `_shared/aiCore.ts` y se prueba allí. Aquí solo queda ir y
 * volver.
 *
 * ## Por qué el SDK y no `fetch`
 *
 * El SDK trae errores tipados por clase, reintentos y tiempo de espera, y
 * **salidas estructuradas**, que retiran el apaño de recortar el JSON entre la
 * primera llave y la última.
 *
 * ## La clave nunca sale de aquí
 *
 * `EBIM_AI_API_KEY` se lee de los secretos de la función. No entra en el bundle
 * del front ni viaja al navegador, igual que `service_role`. Tampoco se escribe
 * en ningún log: los errores del SDK se reducen a `{status, timeout}` antes de
 * salir de este archivo.
 *
 * ## Se degrada con motivo tipado (fase 01)
 *
 * `pedirJson` devuelve `data: null` ante cualquier duda, pero ya no con un
 * `catch` ciego: distingue sin clave, tiempo agotado, límite del proveedor,
 * fallo del proveedor, rechazo (`stop_reason: refusal`), truncado
 * (`max_tokens`) y respuesta que no cumple el esquema (validada también aquí,
 * no solo en la API).
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0'
import { AI_DEFAULT_MODEL, AI_DEFAULT_TIMEOUT_MS, AI_USAGE_CERO, normalizarUso, type AiUsage } from '../_shared/ai.ts'
import {
  aceptaEsfuerzo,
  clasificarFallo,
  clasificarParada,
  esModeloPermitido,
  especDe,
  esquemaParaProveedor,
  resolverModelo,
  validarEsquema,
  type AiErrorKind,
  type AiFeature,
  type EsquemaIA,
} from '../_shared/aiCore.ts'

export interface RespuestaIA<T> {
  /** `null` cuando hubo que degradarse. Quien llama decide qué enseñar. */
  data: T | null
  usage: AiUsage
  model: string
  latencyMs: number
  /** Por qué se degradó, para la traza. `null` si fue bien. */
  motivo: AiErrorKind | null
}

export interface PeticionIA {
  /** Reglas constantes de la aplicación. Nunca datos de la petición. */
  system: string
  /** Turno de usuario. Los datos van delimitados (`delimitarDatos`). */
  user: string
  /** Esquema de la respuesta: se manda a la API y se valida al volver. */
  schema: EsquemaIA
  /** Funcionalidad: decide modelo, `max_tokens` y tiempo si no se fijan. */
  feature?: AiFeature
  model?: string
  maxTokens?: number
  timeoutMs?: number
  /** Reintentos del SDK (solo 408/409/429/5xx/conexión). Por defecto 1. */
  maxRetries?: number
}

const leerEntorno = (clave: string) => Deno.env.get(clave)

/** Hay proveedor configurado. Se consulta antes de gastar cuota. */
export function hayProveedorIA(): boolean {
  return Boolean(Deno.env.get('EBIM_AI_API_KEY'))
}

/** El modelo que usará una petición, sin llamar a nadie. */
export function modeloPara(peticion: Pick<PeticionIA, 'feature' | 'model'>): string {
  if (esModeloPermitido(peticion.model)) return peticion.model
  if (peticion.feature) return resolverModelo(peticion.feature, leerEntorno)
  const global = Deno.env.get('EBIM_AI_MODEL')?.trim()
  return esModeloPermitido(global) ? global : AI_DEFAULT_MODEL
}

/** Traduce el error del SDK a un tipo, sin arrastrar mensajes ni cabeceras. */
function tipoDeFallo(error: unknown): AiErrorKind {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return clasificarFallo({ timeout: true })
  if (error instanceof Anthropic.APIConnectionError) return clasificarFallo({ conexion: true })
  if (error instanceof Anthropic.APIError) return clasificarFallo({ status: error.status ?? null })
  return 'proveedor'
}

/**
 * Pide una respuesta que cumpla el esquema.
 *
 * Modelo: lo que pida quien llama (si está en la lista cerrada), luego la
 * política de la funcionalidad (`EBIM_AI_MODEL_<FEATURE>` → `EBIM_AI_MODEL` →
 * clase de tarea), y por último el de por defecto.
 */
export async function pedirJson<T>(peticion: PeticionIA): Promise<RespuestaIA<T>> {
  const clave = Deno.env.get('EBIM_AI_API_KEY')
  const model = modeloPara(peticion)
  const spec = peticion.feature ? especDe(peticion.feature) : null
  const arranque = Date.now()

  if (!clave) {
    return { data: null, usage: AI_USAGE_CERO, model, latencyMs: 0, motivo: 'sin_proveedor' }
  }

  const cliente = new Anthropic({
    apiKey: clave,
    timeout: peticion.timeoutMs ?? spec?.timeoutMs ?? AI_DEFAULT_TIMEOUT_MS,
    // Un reintento y no los dos de por defecto: quien espera es una persona, y
    // el SDK ya solo reintenta lo transitorio (408/409/429/5xx/conexión).
    maxRetries: peticion.maxRetries ?? 1,
  })

  try {
    const respuesta = await cliente.messages.create({
      model,
      max_tokens: peticion.maxTokens ?? spec?.maxTokens ?? 512,
      system: peticion.system,
      messages: [{ role: 'user', content: peticion.user }],
      // Esto es lo que sustituye al recorte entre llaves: la API devuelve algo
      // que YA cumple el esquema, o falla de forma visible. `effort: low` en la
      // familia 5 (Haiku 4.5 lo rechaza): tareas acotadas, coste contenido.
      output_config: {
        format: { type: 'json_schema', schema: esquemaParaProveedor(peticion.schema) },
        ...(aceptaEsfuerzo(model) ? { effort: 'low' as const } : {}),
      },
    })

    const usage = normalizarUso(respuesta.usage)
    const latencyMs = Date.now() - arranque

    const parada = clasificarParada(respuesta.stop_reason)
    if (parada) return { data: null, usage, model, latencyMs, motivo: parada }

    const bloque = respuesta.content.find((b) => b.type === 'text')
    const texto = bloque && bloque.type === 'text' ? bloque.text : ''
    if (!texto) return { data: null, usage, model, latencyMs, motivo: 'esquema' }

    let crudo: unknown
    try {
      // `JSON.parse` y no coincidencia de cadenas: el escapado de la respuesta
      // varía entre modelos y compararlo a mano se rompe con un acento.
      crudo = JSON.parse(texto)
    } catch {
      return { data: null, usage, model, latencyMs, motivo: 'esquema' }
    }

    // Segunda comprobación, aquí: longitudes, enums y listas que la API no
    // restringe, y cualquier deriva entre SDK, modelo y esquema.
    const validado = validarEsquema<T>(peticion.schema, crudo)
    if (!validado.ok) return { data: null, usage, model, latencyMs, motivo: 'esquema' }
    return { data: validado.value, usage, model, latencyMs, motivo: null }
  } catch (error) {
    return {
      data: null,
      usage: AI_USAGE_CERO,
      model,
      latencyMs: Date.now() - arranque,
      motivo: tipoDeFallo(error),
    }
  }
}
