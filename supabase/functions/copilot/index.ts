/**
 * copilot — EBIM Copilot global del backoffice (fase 11 de EBIM_AI_SEQUENCE).
 *
 * Una pregunta = una unidad de cuota de la funcionalidad `copilot`:
 *
 *  1. JWT + `assertNotSuiteOperator`; tenant y rol SIEMPRE del token.
 *  2. `ai_copilot_tools()` (RLS de quien pregunta): qué herramientas de solo
 *     lectura puede usar según su rol y los módulos contratados.
 *  3. `ejecutarIA` (proveedor → cuota → llamada → revisión → traza) con un
 *     `llamar` que orquesta: plan del modelo (herramientas y parámetros
 *     TIPADOS de lista cerrada) → revisión del plan → ejecución de cada
 *     herramienta con el `userClient` (funciones SQL SECURITY INVOKER +
 *     STABLE con su propio guard de rol, módulo, tienda y topes) → respuesta
 *     del modelo con marcadores `{{T1.clave}}` → candados.
 *
 * ## Lo que NO puede hacer
 *
 * Ninguna herramienta escribe; el modelo no recibe SQL, credenciales, ids ni
 * `service_role`; una herramienta denegada no aporta datos, solo su estado.
 * Los enlaces de la respuesta solo abren pantallas, donde la persona actúa con
 * los controles de siempre (PROPONER → CONFIRMAR → VALIDAR → EJECUTAR queda
 * para cuando existan escrituras).
 *
 * ## Se degrada, no se rompe
 *
 * Sin clave, sin contratar, sin cuota, rol sin permiso, tiempo agotado o
 * respuesta inválida ⇒ 200 con `data: null` y `motivo` tipado.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, optionalUuid, rejectUnknownFields, requireEnum } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { AI_TIER_MODELS, sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import { sanitizeTextForModel } from '../_shared/observability/redact.ts'
import {
  COPILOT_FEATURE,
  ESQUEMA_RESPUESTA,
  MAX_PREGUNTA,
  SISTEMA_PLAN,
  SISTEMA_RESPUESTA,
  estadoDeErrorSql,
  herramientasDisponibles,
  leerContexto,
  leerHistorial,
  llamadaSql,
  orquestarCopilot,
  revisarCopilot,
  type CopilotRespuesta,
  type Orquestado,
  type PlanModelo,
  type RespuestaModeloCopilot,
} from '../_shared/aiCopilot.ts'

const ALLOWED_FIELDS = ['question', 'locale', 'store_id', 'context', 'history'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'copilot',
  },
  async ({ request, body, trace, logger }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const storeId = optionalUuid(body, 'store_id')
    const bruta = optionalText(body, 'question', MAX_PREGUNTA)
    if (!bruta) throw badRequest('PREGUNTA_REQUERIDA', 'Falta `question`')
    const contexto = leerContexto(body.context)
    if (!contexto) throw badRequest('CAMPO_INVALIDO', '`context` no tiene la forma esperada')
    const historial = leerHistorial(body.history)
    if (!historial) throw badRequest('CAMPO_INVALIDO', '`history` no tiene la forma esperada')
    // La pregunta se sanea ANTES de todo: pegar un token o un correo no lo
    // manda al proveedor, y el texto literal de búsqueda se valida contra esto.
    const pregunta = sanitizeTextForModel(bruta, MAX_PREGUNTA) ?? ''

    const client = userClient(request, trace)

    // Qué herramientas existen para ESTA persona. Sin tenant o sin membresía
    // es 403 antes de gastar nada.
    const { data: rawTools, error } = await client.rpc('ai_copilot_tools')
    if (error) throw fromDatabaseError(error)
    const disponibles = herramientasDisponibles(rawTools)

    const medidor = medidorDeUsuario(client)
    const resultado = await ejecutarIA<Orquestado, CopilotRespuesta>(
      {
        feature: COPILOT_FEATURE,
        prompt: `copilot · ${contexto.screen} · ${contexto.entity?.type ?? '-'} · ${locale} · ${pregunta}`,
        revisar: revisarCopilot,
      },
      {
        hayProveedor: hayProveedorIA,
        consumir: medidor.consumir,
        registrar: medidor.registrar,
        llamar: () =>
          orquestarCopilot(
            { pregunta, locale, contexto, historial, disponibles, storeId },
            {
              planificar: (user, schema) =>
                pedirJson<PlanModelo>({
                  feature: COPILOT_FEATURE,
                  system: sistemaConFrontera(SISTEMA_PLAN),
                  user,
                  schema,
                  // Elegir herramientas es corto: no necesita el techo de la respuesta.
                  maxTokens: 1024,
                  // Fase 12 (coste): el plan es una clasificación acotada por un
                  // esquema cuyo enum ya es la lista cerrada, y `revisarPlan` lo
                  // vuelve a comprobar todo. No necesita la clase análisis (Opus);
                  // basta redacción (Sonnet). Override: EBIM_AI_MODEL_COPILOT_PLAN.
                  model: Deno.env.get('EBIM_AI_MODEL_COPILOT_PLAN')?.trim() || AI_TIER_MODELS.redaccion,
                  timeoutMs: 15000,
                }),
              herramienta: async (llamada) => {
                const { rpc, args } = llamadaSql(llamada, storeId)
                const arranque = Date.now()
                const { data, error: fallo } = await client.rpc(rpc, args)
                const denegado = fallo ? estadoDeErrorSql(fallo) : null
                // Auditoría de cada herramienta: nombre, estado y duración.
                // Nunca los argumentos (pueden llevar texto de la persona).
                logger.info('copilot.tool', {
                  tool: llamada.tool,
                  status: denegado ?? (data === null || data === undefined ? 'not_found' : 'ok'),
                  ms: Date.now() - arranque,
                })
                return denegado ? { ok: false, status: denegado } : { ok: true, raw: data }
              },
              responder: (user) =>
                pedirJson<RespuestaModeloCopilot>({
                  feature: COPILOT_FEATURE,
                  system: sistemaConFrontera(SISTEMA_RESPUESTA),
                  user,
                  schema: ESQUEMA_RESPUESTA,
                }),
            },
          ),
      },
    )
    return { status: 200, body: { data: cuerpoIA(resultado) } }
  },
)

Deno.serve(handler)
