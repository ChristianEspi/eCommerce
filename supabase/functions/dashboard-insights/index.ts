/**
 * dashboard-insights — Analista IA del dashboard (fase 02 de EBIM_AI_SEQUENCE).
 *
 * Dos modos sobre el MISMO dataset reducido:
 *  - `summary`: «Hoy deberías revisar», 3–6 insights estructurados.
 *  - `ask`: «Preguntar sobre estos datos», una pregunta (sugerida o escrita).
 *
 * ## Lo que ve el modelo
 *
 * Solo `public.ai_dashboard_facts(p_store_id)`: agregados y listas ≤5 que SQL
 * ya calculó bajo la RLS del usuario (SECURITY INVOKER, owner/admin). Nunca
 * tablas completas, correos ni `service_role`. El tenant sale del JWT; del body
 * solo llega la tienda activa, y la función SQL rechaza una tienda ajena.
 *
 * ## Lo que puede devolver
 *
 * Texto con marcadores `{{clave}}` de métricas/entidades del dataset. Ningún
 * dígito escrito por el modelo sobrevive (`revisarTexto`); rutas y acciones
 * son enums cerrados; nada se ejecuta. El front sustituye los marcadores con
 * el valor de la base.
 *
 * ## Se degrada, no se rompe
 *
 * Recorrido común `ejecutarIA`: sin clave, sin contratar, sin cuota o con el
 * proveedor caído responde 200 con `data: null` y `motivo` tipado. Los KPIs
 * deterministas del dashboard no dependen de esta función.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, optionalUuid, rejectUnknownFields, requireEnum } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_RESPUESTA,
  ESQUEMA_RESUMEN,
  MAX_PREGUNTA,
  SISTEMA_ANALISTA,
  SISTEMA_PREGUNTA,
  contextoParaFront,
  datosParaModelo,
  hechosDelDashboard,
  revisarRespuesta,
  revisarResumen,
  type RespuestaModeloPregunta,
  type RespuestaRevisada,
  type ResumenRevisado,
} from '../_shared/aiInsights.ts'

const FEATURE = 'insights'
const ALLOWED_FIELDS = ['mode', 'store_id', 'locale', 'question'] as const
const MODES = ['summary', 'ask'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'dashboard-insights',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const storeId = optionalUuid(body, 'store_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = optionalText(body, 'question', MAX_PREGUNTA)
    if (mode === 'ask' && !question) {
      throw badRequest('PREGUNTA_REQUERIDA', 'El modo `ask` exige `question`')
    }
    if (mode === 'summary' && question) {
      throw badRequest('CAMPO_NO_PERMITIDO', 'El modo `summary` no admite `question`')
    }

    const client = userClient(request, trace)

    // RLS + guard de rol en SQL. Una tienda ajena o un rol sin permiso es 403,
    // antes de gastar nada.
    const { data: raw, error } = await client.rpc('ai_dashboard_facts', { p_store_id: storeId })
    if (error) throw fromDatabaseError(error)
    const hechos = hechosDelDashboard(raw)
    // Métricas y entidades viajan al front junto a lo revisado: con ellas
    // sustituye los marcadores por la cifra de la base.
    const contexto = contextoParaFront(hechos)
    type ConContexto<V> = V & typeof contexto

    // Fase 12 (coste): sin ningún módulo con datos no hay nada que analizar.
    // Como el resto de superficies, `vacia` sin llamar al modelo ni gastar cuota.
    if (hechos.modules.length === 0) {
      return { status: 200, body: { data: { data: null, motivo: 'vacia', interaction_id: null } } }
    }

    const medidor = medidorDeUsuario(client)
    const puertosBase = {
      hayProveedor: hayProveedorIA,
      consumir: medidor.consumir,
      registrar: medidor.registrar,
    }

    if (mode === 'summary') {
      const resultado = await ejecutarIA<{ insights?: unknown }, ConContexto<ResumenRevisado>>(
        {
          feature: FEATURE,
          prompt: `dashboard · resumen · ${locale}`,
          revisar: (data) => {
            const revision = revisarResumen(data, hechos)
            if (!revision.ok) return { ok: false, motivo: revision.motivo }
            return {
              ok: true,
              value: { ...revision.value, ...contexto },
              reply: revision.value.insights.map((i) => i.title).join(' | '),
            }
          },
        },
        {
          ...puertosBase,
          llamar: () =>
            pedirJson<{ insights?: unknown }>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_ANALISTA),
              user: datosParaModelo(hechos, locale),
              schema: ESQUEMA_RESUMEN,
            }),
        },
      )
      return { status: 200, body: { data: cuerpoIA(resultado) } }
    }

    const pregunta = question as string
    const resultado = await ejecutarIA<RespuestaModeloPregunta, ConContexto<RespuestaRevisada>>(
      {
        feature: FEATURE,
        prompt: `dashboard · pregunta · ${pregunta}`,
        revisar: (data) => {
          const revision = revisarRespuesta(data, hechos)
          if (!revision.ok) return { ok: false, motivo: revision.motivo }
          return { ok: true, value: { ...revision.value, ...contexto }, reply: revision.value.answer }
        },
      },
      {
        ...puertosBase,
        llamar: () =>
          pedirJson<RespuestaModeloPregunta>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_PREGUNTA),
            user: datosParaModelo(hechos, locale, pregunta),
            schema: ESQUEMA_RESPUESTA,
          }),
      },
    )
    return { status: 200, body: { data: cuerpoIA(resultado) } }
  },
)

Deno.serve(handler)
