/**
 * Un turno del núcleo conversacional (2026-11-19). PURO: modelo y base llegan
 * como puertos, así que el orden se prueba sin red.
 *
 *   planificar (IA, esquema)  →  ejecutar (base, lista cerrada)  →  redactar (IA, candados)
 *
 * Cada paso de IA pasa por `ejecutarIA` (cuota antes, traza siempre). Si
 * planificar falla, se responde sin herramienta; si redactar falla, el canal
 * recibe los DATOS igual y un texto vacío que sustituye por uno propio. Nunca
 * hay una ruta en la que un fallo del modelo deje al cliente sin nada.
 */
import { ejecutarIA, type PuertosIA, type RespuestaModelo } from './aiPipeline.ts'
import {
  ejecutarHerramienta,
  historialParaModelo,
  revisarRespuesta,
  validarPlan,
  type Plan,
  type PuertosComercio,
  type Respuesta,
  type Turno,
} from './commerceAgent.ts'

type PlanCrudo = Parameters<typeof validarPlan>[0]
type RespuestaCruda = { texto?: unknown; product_ids?: unknown }

export interface PuertosTurno {
  readonly comercio: PuertosComercio
  /** Medición y transporte (los del pipeline común), sin `llamar`. */
  readonly ia: Omit<PuertosIA<unknown>, 'llamar'>
  planificar(historial: string): Promise<RespuestaModelo<PlanCrudo>>
  redactar(historial: string, herramienta: string, datos: string): Promise<RespuestaModelo<RespuestaCruda>>
}

export interface ResultadoTurno {
  readonly plan: Plan
  readonly datos: unknown
  readonly respuesta: Respuesta | null
}

export async function atenderTurno(turnos: readonly Turno[], puertos: PuertosTurno): Promise<ResultadoTurno> {
  const historial = historialParaModelo(turnos)

  const plan = await ejecutarIA<PlanCrudo, Plan>(
    { feature: 'assistant', prompt: `chat · plan`, revisar: (data) => ({ ok: true, value: validarPlan(data), reply: null }) },
    { ...puertos.ia, llamar: () => puertos.planificar(historial) } as PuertosIA<PlanCrudo>,
  )
  const elegido: Plan = plan.data ?? { herramienta: 'responder', args: {} }

  const resultado = await ejecutarHerramienta(elegido, puertos.comercio)

  const redaccion = await ejecutarIA<RespuestaCruda, Respuesta>(
    {
      feature: 'assistant',
      prompt: `chat · ${elegido.herramienta}`,
      revisar: (data) => {
        const r = revisarRespuesta(data, resultado.productosPermitidos)
        return r.ok ? { ok: true, value: r.value, reply: r.value.texto } : { ok: false, motivo: r.motivo }
      },
    },
    {
      ...puertos.ia,
      llamar: () => puertos.redactar(historial, elegido.herramienta, resultado.paraModelo),
    } as PuertosIA<RespuestaCruda>,
  )

  return { plan: elegido, datos: resultado.datos, respuesta: redaccion.data }
}
