/**
 * El recorrido común de una llamada de IA. TypeScript PURO: los efectos
 * (cuota, proveedor, traza) llegan como puertos, así el ORDEN se prueba sin red,
 * sin base y sin clave (`supabase/tests/ai-core.test.ts`).
 *
 * ## El orden, que es lo que importa
 *
 *  1. ¿Hay proveedor? Si no, ni se mira la cuota: cobrar una acción para no
 *     llamar a nadie es cobrar por nada.
 *  2. Consumir cuota (`ai_consume*`): capacidad de IA + módulo + rol + saldo,
 *     en la base y en la misma transacción. Denegado ⇒ no se llama al modelo.
 *  3. Llamar al modelo con esquema, tiempo y modelo de SU funcionalidad.
 *  4. Validar: esquema runtime (lo hace el transporte) + regla de dominio de
 *     quien llama (lista cerrada, candado clínico, sin cifras…).
 *  5. Registrar SIEMPRE que se haya consumido — también al fallar: una llamada
 *     que no respondió cuesta lo mismo y es la que más interesa mirar después.
 *  6. Responder `{ data | null, motivo, interactionId }`. Nunca lanza por la IA:
 *     la pantalla se queda con su camino determinista.
 *
 * Lo que NO hace: autenticar ni leer datos. Eso lo hace la Edge Function antes,
 * con el JWT del usuario (RLS), porque los datos que ve el modelo tienen que
 * ser los que esa persona ya puede ver.
 */
import type { AiUsage } from './ai.ts'
import {
  estadoDeTraza,
  motivoDeCuota,
  type AiErrorKind,
  type AiFeature,
  type ResultadoCuota,
} from './aiCore.ts'

/** Lo que el transporte devuelve (forma de `_runtime/anthropic.ts`). */
export interface RespuestaModelo<T> {
  readonly data: T | null
  readonly usage: AiUsage
  readonly model: string
  readonly latencyMs: number
  readonly motivo: AiErrorKind | null
}

/** Veredicto del dominio sobre una respuesta ya con forma válida. */
export type Revision<R> =
  | { readonly ok: true; readonly value: R; readonly reply?: string | null }
  | { readonly ok: false; readonly motivo: 'vacia' | 'bloqueada' | 'esquema' }

export interface TrazaIA {
  readonly feature: AiFeature
  readonly status: ReturnType<typeof estadoDeTraza>
  readonly errorKind: AiErrorKind | null
  readonly model: string
  /** Extracto del pedido. La base lo recorta y redacta (`ebim.redact_text`). */
  readonly prompt: string
  readonly reply: string | null
  readonly usage: AiUsage
  readonly latencyMs: number
}

export interface PuertosIA<T> {
  hayProveedor(): boolean
  consumir(feature: AiFeature): Promise<ResultadoCuota | null>
  llamar(): Promise<RespuestaModelo<T>>
  /** Devuelve el id de la interacción, o `null` si no se pudo registrar. */
  registrar(traza: TrazaIA): Promise<string | null>
}

export interface PeticionPipeline<T, R> {
  readonly feature: AiFeature
  /** Extracto que se guarda en la traza (sin secretos; la base redacta PII). */
  readonly prompt: string
  readonly revisar: (data: T) => Revision<R>
}

export interface ResultadoIA<R> {
  readonly data: R | null
  readonly motivo: AiErrorKind | null
  /** Para el pulgar en contexto (`ai_feedback`). `null` si no hubo traza. */
  readonly interactionId: string | null
}

export async function ejecutarIA<T, R>(
  peticion: PeticionPipeline<T, R>,
  puertos: PuertosIA<T>,
): Promise<ResultadoIA<R>> {
  if (!puertos.hayProveedor()) {
    return { data: null, motivo: 'sin_proveedor', interactionId: null }
  }

  const cuota = await puertos.consumir(peticion.feature)
  const denegado = motivoDeCuota(cuota)
  if (denegado) return { data: null, motivo: denegado, interactionId: null }

  let respuesta: RespuestaModelo<T>
  try {
    respuesta = await puertos.llamar()
  } catch {
    // El transporte ya no lanza, pero un puerto de test o uno futuro podría.
    // Ya se consumió: se registra como error del proveedor.
    respuesta = {
      data: null,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      model: 'desconocido',
      latencyMs: 0,
      motivo: 'proveedor',
    }
  }

  let motivo: AiErrorKind | null = respuesta.motivo
  let valor: R | null = null
  let reply: string | null = null

  if (!motivo && respuesta.data !== null) {
    const revision = peticion.revisar(respuesta.data)
    if (revision.ok) {
      valor = revision.value
      reply = revision.reply ?? null
    } else {
      motivo = revision.motivo
    }
  } else if (!motivo) {
    motivo = 'esquema'
  }

  let interactionId: string | null = null
  try {
    interactionId = await puertos.registrar({
      feature: peticion.feature,
      status: estadoDeTraza(motivo),
      errorKind: motivo,
      model: respuesta.model,
      prompt: peticion.prompt,
      reply,
      usage: respuesta.usage,
      latencyMs: respuesta.latencyMs,
    })
  } catch {
    // Una traza que no se pudo escribir no le quita la respuesta a nadie.
    interactionId = null
  }

  return { data: motivo ? null : valor, motivo, interactionId }
}

/**
 * El cuerpo estándar que ve el front: `motivo` es el `AiErrorKind` tipado y el
 * front lo vuelve a validar con zod (`src/features/ai/result.ts`).
 */
export function cuerpoIA<R>(resultado: ResultadoIA<R>): {
  data: R | null
  motivo: AiErrorKind | null
  interaction_id: string | null
} {
  return {
    data: resultado.data,
    motivo: resultado.motivo,
    interaction_id: resultado.interactionId,
  }
}
