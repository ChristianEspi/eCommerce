/**
 * promotions-assistant — Promociones con IA (fase 09 de EBIM_AI_SEQUENCE).
 *
 * Dos modos, los dos de SOLO LECTURA:
 *  - `rules` (sin IA ni cuota): el CÁLCULO DEL SISTEMA — reglas de la
 *            promoción tal cual, condiciones declaradas y candidatos por regla.
 *  - `copy`  (`brief?`, `tone?`): BORRADOR de nombre, descripción, titular,
 *            copy, CTA y términos resumidos + candidatos priorizados.
 *
 * Lo que ve el modelo: solo `ai_promotion_facts` (SECURITY INVOKER, RLS de
 * quien llama, roles de `promotions` + módulo `promotions`) y la instrucción
 * de la persona, delimitados como dato no confiable. El tenant sale del JWT.
 *
 * Lo que NO puede hacer: proponer descuentos, cambiar reglas, activar ni
 * guardar la promoción. No hay ningún camino de escritura; las reglas siguen
 * en el motor determinista.
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, rejectUnknownFields, requireEnum, requireUuid } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  ESQUEMA_PROMOCION,
  PROMO_MAX_BRIEF,
  PROMO_TONOS,
  SISTEMA_PROMOCION,
  datosDePromocion,
  hechosDePromocion,
  resumenPromocion,
  revisarPromocion,
  sistemaDePromocion,
  type BorradorPromocion,
  type RespuestaModeloPromocion,
} from '../_shared/aiPromotions.ts'

const FEATURE = 'promotions'
const ALLOWED_FIELDS = ['mode', 'promotion_id', 'locale', 'brief', 'tone'] as const
const MODES = ['rules', 'copy'] as const
const LOCALES = ['es', 'en'] as const

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'promotions-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const mode = requireEnum(body, 'mode', MODES)
    const promotionId = requireUuid(body, 'promotion_id')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const brief = optionalText(body, 'brief', PROMO_MAX_BRIEF)
    const tone = body.tone === undefined ? 'neutral' : requireEnum(body, 'tone', PROMO_TONOS)
    if (mode !== 'copy' && (brief || body.tone !== undefined)) {
      throw badRequest('CAMPO_NO_PERMITIDO', '`brief` y `tone` solo valen en el modo `copy`')
    }

    const client = userClient(request, trace)
    // RLS + guard de rol y módulo en SQL: sin la funcionalidad es 403 antes de
    // gastar nada; una promoción invisible (ajena) es 404.
    const { data: raw, error } = await client.rpc('ai_promotion_facts', { p_promotion_id: promotionId })
    if (error) throw fromDatabaseError(error)
    const hechos = hechosDePromocion(raw)
    if (!hechos) throw notFound('NO_ENCONTRADO', 'La promocion no existe o no es visible')

    const system = sistemaDePromocion(hechos)
    if (mode === 'rules') {
      return { status: 200, body: { data: { data: null, motivo: null, interaction_id: null, system } } }
    }

    const medidor = medidorDeUsuario(client)
    const resultado = await ejecutarIA<RespuestaModeloPromocion, BorradorPromocion>(
      {
        feature: FEATURE,
        prompt: resumenPromocion(hechos, locale, tone),
        revisar: (data) => {
          const r = revisarPromocion(data, hechos, brief)
          return r.ok
            ? { ok: true, value: r.value, reply: r.value.texts.headline ?? r.value.texts.name ?? null }
            : { ok: false, motivo: r.motivo }
        },
      },
      {
        hayProveedor: hayProveedorIA,
        consumir: medidor.consumir,
        registrar: medidor.registrar,
        llamar: () =>
          pedirJson<RespuestaModeloPromocion>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_PROMOCION),
            user: datosDePromocion(hechos, locale, tone, brief),
            schema: ESQUEMA_PROMOCION,
          }),
      },
    )
    return { status: 200, body: { data: { ...cuerpoIA(resultado), system } } }
  },
)

Deno.serve(handler)
