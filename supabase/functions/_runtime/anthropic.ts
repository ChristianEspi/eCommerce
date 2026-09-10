/**
 * Transporte hacia Anthropic. Vive en `_runtime` y no en `_shared` porque
 * importa el SDK con especificador `npm:` y solo tiene sentido dentro de Deno.
 *
 * Lo que se puede razonar sin red —qué se le deja devolver al modelo, cómo se
 * filtra, cómo se normaliza el gasto— está en `_shared/ai.ts` y se prueba allí.
 * Aquí solo queda ir y volver.
 *
 * ## Por qué el SDK y no `fetch`
 *
 * Lo que había antes era un `fetch` a mano con su `AbortController`, su
 * `anthropic-version` escrita a mano y un `try/catch` ciego. El SDK trae
 * errores tipados por clase, reintentos y tiempo de espera, y —lo que de verdad
 * importaba— **salidas estructuradas**, que retiran el apaño de recortar el
 * JSON entre la primera llave y la última.
 *
 * ## La clave nunca sale de aquí
 *
 * `EBIM_AI_API_KEY` se lee de los secretos de la función. No entra en el bundle
 * del front ni viaja al navegador, igual que `service_role`.
 *
 * ## Sin clave sigue funcionando
 *
 * `pedirJson` devuelve `null` ante cualquier duda: sin clave, error del
 * proveedor, tiempo agotado o respuesta que no case con el esquema. No hay
 * ninguna ruta por la que un fallo del proveedor deje a quien llama sin
 * respuesta; se degrada al camino determinista de siempre.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0'
import {
  AI_DEFAULT_MODEL,
  AI_DEFAULT_TIMEOUT_MS,
  AI_USAGE_CERO,
  normalizarUso,
  type AiUsage,
} from '../_shared/ai.ts'

export interface RespuestaIA<T> {
  /** `null` cuando hubo que degradarse. Quien llama decide qué enseñar. */
  data: T | null
  usage: AiUsage
  model: string
  latencyMs: number
  /** Por qué se degradó, para la traza. `null` si fue bien. */
  motivo: 'sin_clave' | 'proveedor' | 'esquema' | null
}

export interface PeticionIA {
  system: string
  user: string
  /** Esquema JSON de la respuesta. Sin él no hay salidas estructuradas. */
  schema: Record<string, unknown>
  model?: string
  maxTokens?: number
  timeoutMs?: number
}

/** Hay proveedor configurado. Se consulta antes de gastar cuota. */
export function hayProveedorIA(): boolean {
  return Boolean(Deno.env.get('EBIM_AI_API_KEY'))
}

/**
 * Pide una respuesta que cumpla el esquema.
 *
 * El modelo se resuelve en este orden: lo que pida quien llama, luego
 * `EBIM_AI_MODEL`, y por último el de por defecto. Que sea configurable por
 * entorno es lo que permite subir de modelo sin desplegar código.
 */
export async function pedirJson<T>(peticion: PeticionIA): Promise<RespuestaIA<T>> {
  const clave = Deno.env.get('EBIM_AI_API_KEY')
  const model = peticion.model ?? Deno.env.get('EBIM_AI_MODEL') ?? AI_DEFAULT_MODEL
  const arranque = Date.now()

  if (!clave) {
    return { data: null, usage: AI_USAGE_CERO, model, latencyMs: 0, motivo: 'sin_clave' }
  }

  const cliente = new Anthropic({
    apiKey: clave,
    timeout: peticion.timeoutMs ?? AI_DEFAULT_TIMEOUT_MS,
    // Un reintento y no los dos de por defecto: quien espera es una persona
    // mirando una caja de búsqueda, y tres intentos de nueve segundos son
    // veintisiete segundos de pantalla parada antes de degradarse.
    maxRetries: 1,
  })

  try {
    const respuesta = await cliente.messages.create({
      model,
      max_tokens: peticion.maxTokens ?? 512,
      system: peticion.system,
      messages: [{ role: 'user', content: peticion.user }],
      // Esto es lo que sustituye al recorte entre llaves: la API devuelve algo
      // que YA cumple el esquema, o falla de forma visible.
      output_config: { format: { type: 'json_schema', schema: peticion.schema } },
    })

    const usage = normalizarUso(respuesta.usage)
    const latencyMs = Date.now() - arranque

    const bloque = respuesta.content.find((b) => b.type === 'text')
    const texto = bloque && bloque.type === 'text' ? bloque.text : ''
    if (!texto) return { data: null, usage, model, latencyMs, motivo: 'esquema' }

    try {
      // `JSON.parse` y no coincidencia de cadenas: el escapado de la respuesta
      // varía entre modelos y compararlo a mano se rompe con un acento.
      return { data: JSON.parse(texto) as T, usage, model, latencyMs, motivo: null }
    } catch {
      return { data: null, usage, model, latencyMs, motivo: 'esquema' }
    }
  } catch {
    // Tiempo agotado, red caída, cuota del proveedor o 400: da igual cuál. Todo
    // termina en el mismo sitio, que es responder sin el modelo.
    return {
      data: null,
      usage: AI_USAGE_CERO,
      model,
      latencyMs: Date.now() - arranque,
      motivo: 'proveedor',
    }
  }
}
