/**
 * reviews-assistant — Reseñas con IA (fase 09 de EBIM_AI_SEQUENCE).
 *
 * Tres modos, los tres de SOLO LECTURA:
 *  - `signals` (sin IA ni cuota): el CÁLCULO DEL SISTEMA — conteos por estado
 *              y por estrellas, media, productos con más negativas y marcas por
 *              regla de la tienda (o de un producto con `product_id`).
 *  - `analyze` (+ `question` opcional): INTERPRETACIÓN IA agregada — resumen,
 *              tono, temas con evidencia y reseñas que conviene revisar.
 *  - `reply`   (`review_id`, `tone`, `notes?`): BORRADOR de respuesta a una
 *              reseña. Nunca se envía ni se publica.
 *
 * Texto de clientes = DATO NO CONFIABLE: título y cuerpo viajan delimitados,
 * el sistema lo declara y la revisión no deja pasar nada que ejecute, cite
 * contactos o afirme una moderación. Lo que ve el modelo: solo
 * `ai_reviews_facts` (SECURITY INVOKER, RLS de quien llama, roles de `reviews`
 * + módulo `catalog`). El tenant sale del JWT.
 *
 * Lo que NO puede hacer: publicar, rechazar, ocultar, borrar ni responder. La
 * moderación sigue siendo `moderate_product_review`, pulsada por una persona.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, optionalUuid, rejectUnknownFields, requireEnum, requireUuid } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_RESENAS,
  ESQUEMA_RESPUESTA_RESENA,
  MAX_NOTAS_RESENA,
  MAX_PREGUNTA_RESENAS,
  REPLY_TONES,
  SISTEMA_RESENAS,
  SISTEMA_RESPUESTA_RESENA,
  contextoDeResenas,
  datosDeResenas,
  datosDeRespuesta,
  hayQueAnalizar,
  hechosDeResena,
  hechosDeResenas,
  revisarAnalisis,
  revisarRespuestaResena,
  sistemaDeResenas,
  type AnalisisModelo,
  type AnalisisRevisado,
  type RespuestaResenaModelo,
  type RespuestaResenaRevisada,
} from '../_shared/aiReviews.ts'

const FEATURE = 'reviews'
const ALLOWED_FIELDS = ['mode', 'store_id', 'product_id', 'review_id', 'locale', 'question', 'notes', 'tone'] as const
const MODES = ['signals', 'analyze', 'reply'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'reviews-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const storeId = requireUuid(body, 'store_id')
    const productId = optionalUuid(body, 'product_id')
    const reviewId = optionalUuid(body, 'review_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const question = optionalText(body, 'question', MAX_PREGUNTA_RESENAS)
    const notes = optionalText(body, 'notes', MAX_NOTAS_RESENA)
    const tone = body.tone === undefined ? 'formal' : requireEnum(body, 'tone', REPLY_TONES)
    if (mode !== 'analyze' && question) throw badRequest('CAMPO_NO_PERMITIDO', '`question` solo vale en el modo `analyze`')
    if (mode !== 'reply' && (notes || body.tone !== undefined || reviewId)) {
      throw badRequest('CAMPO_NO_PERMITIDO', '`review_id`, `notes` y `tone` solo valen en el modo `reply`')
    }
    if (mode === 'reply' && !reviewId) throw badRequest('CAMPO_REQUERIDO', 'La respuesta necesita `review_id`')
    if (mode === 'reply' && productId) throw badRequest('CAMPO_NO_PERMITIDO', 'La respuesta se identifica por `review_id`')

    const client = userClient(request, trace)
    // RLS + guard de rol y módulo en SQL: sin la funcionalidad es 403 antes de
    // gastar nada; una tienda ajena es 403 y una reseña o producto invisibles, 404.
    const { data: raw, error } = await client.rpc('ai_reviews_facts', {
      p_store_id: storeId,
      p_product_id: productId,
      p_review_id: reviewId,
    })
    if (error) throw fromDatabaseError(error)
    if (raw === null || raw === undefined) throw notFound('NO_ENCONTRADO', 'La resena o el producto no existen o no son visibles')

    const medidor = medidorDeUsuario(client)
    const puertos = { hayProveedor: hayProveedorIA, consumir: medidor.consumir, registrar: medidor.registrar }

    if (mode === 'reply') {
      const resena = hechosDeResena(raw)
      if (!resena) throw notFound('NO_ENCONTRADO', 'La resena no existe o no es visible')
      const resultado = await ejecutarIA<RespuestaResenaModelo, RespuestaResenaRevisada>(
        {
          feature: FEATURE,
          prompt: `resenas · respuesta · ${locale} · ${tone} · ${resena.rating}`,
          revisar: (data) => {
            const r = revisarRespuestaResena(data, resena, notes)
            return r.ok ? { ok: true, value: r.value, reply: r.value.subject } : { ok: false, motivo: r.motivo }
          },
        },
        {
          ...puertos,
          llamar: () =>
            pedirJson<RespuestaResenaModelo>({
              feature: FEATURE,
              system: sistemaConFrontera(SISTEMA_RESPUESTA_RESENA),
              user: datosDeRespuesta(resena, locale, tone, notes),
              schema: ESQUEMA_RESPUESTA_RESENA,
            }),
        },
      )
      return { status: 200, body: { data: cuerpoIA(resultado) } }
    }

    const hechos = hechosDeResenas(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'No hay datos de resenas visibles')
    const system = sistemaDeResenas(hechos)
    const sinIA = (motivo: 'vacia' | null) => ({
      status: 200,
      body: { data: { data: null, motivo, interaction_id: null, system } },
    })
    if (mode === 'signals') return sinIA(null)
    // Sin reseñas en la ventana no hay nada que resumir y no se gasta.
    if (!hayQueAnalizar(hechos)) return sinIA('vacia')

    type ConContexto = AnalisisRevisado & ReturnType<typeof contextoDeResenas>
    const resultado = await ejecutarIA<AnalisisModelo, ConContexto>(
      {
        feature: FEATURE,
        prompt: `resenas · ${hechos.scope} · ${locale}${question ? ` · ${question}` : ''}`,
        revisar: (data) => {
          const r = revisarAnalisis(data, hechos, Boolean(question))
          if (!r.ok) return { ok: false, motivo: r.motivo }
          return { ok: true, value: { ...r.value, ...contextoDeResenas(hechos) }, reply: r.value.answer || r.value.overview }
        },
      },
      {
        ...puertos,
        llamar: () =>
          pedirJson<AnalisisModelo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_RESENAS),
            user: datosDeResenas(hechos, locale, question),
            schema: ESQUEMA_RESENAS,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
