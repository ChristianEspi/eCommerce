/**
 * content-assistant — CMS con IA (fase 09 de EBIM_AI_SEQUENCE).
 *
 * Un solo modo, de SOLO LECTURA: devuelve un BORRADOR para el formulario del
 * CMS según la tarea:
 *  - `banner`    título, subtítulo, CTA y texto alternativo de un bloque;
 *  - `landing`   título, subtítulo, cuerpo y CTA;
 *  - `seo`       título SEO y meta descripción de una página;
 *  - `translate` los campos actuales al otro idioma (ES↔EN).
 *
 * Lo que ve el modelo: lo que la persona está escribiendo en el formulario
 * (campos actuales + instrucción), el tipo de bloque o de página y el nombre
 * de la tienda, todo delimitado como dato no confiable. Si llega `page_id` o
 * `block_id`, se comprueba con el JWT (RLS) que existe y es de la sociedad
 * antes de gastar nada. El tenant sale del JWT.
 *
 * Lo que NO puede hacer: guardar, publicar ni programar. No hay ningún camino
 * de escritura: el front pone el borrador en el formulario y la persona guarda
 * con el botón de siempre (y publica con el estado de siempre).
 */
import { assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { optionalText, optionalUuid, rejectUnknownFields, requireEnum } from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeUsuario } from '../_runtime/aiMeter.ts'
import { sistemaConFrontera } from '../_shared/aiCore.ts'
import { cuerpoIA, ejecutarIA } from '../_shared/aiPipeline.ts'
import {
  CMS_BLOCK_TYPES,
  CMS_FIELDS,
  CMS_LIMITES_ENTRADA,
  CMS_LOCALES,
  CMS_MAX_BRIEF,
  CMS_TARGETS,
  CMS_TASKS,
  CMS_TONOS,
  ESQUEMA_CMS,
  SISTEMA_CMS,
  TAREAS_DE_DESTINO,
  camposPedidos,
  datosDeCms,
  resumenCms,
  revisarCms,
  type BorradorCms,
  type CmsField,
  type PeticionCms,
  type RespuestaModeloCms,
} from '../_shared/aiContent.ts'

const FEATURE = 'content'
const ALLOWED_FIELDS = [
  'task',
  'target',
  'page_id',
  'block_id',
  'block_type',
  'fields',
  'brief',
  'tone',
  'locale',
  'target_locale',
] as const

function leerCampos(valor: unknown): Partial<Record<CmsField, string>> {
  if (valor === undefined || valor === null) return {}
  if (typeof valor !== 'object' || Array.isArray(valor)) {
    throw badRequest('CAMPO_INVALIDO', '`fields` debe ser un objeto')
  }
  const obj = valor as Record<string, unknown>
  rejectUnknownFields(obj, CMS_FIELDS)
  const salida: Partial<Record<CmsField, string>> = {}
  for (const f of CMS_FIELDS) {
    const v = optionalText(obj, f, CMS_LIMITES_ENTRADA[f])
    if (v) salida[f] = v
  }
  return salida
}

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'content-assistant',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)

    rejectUnknownFields(body, ALLOWED_FIELDS)
    const task = requireEnum(body, 'task', CMS_TASKS)
    const target = requireEnum(body, 'target', CMS_TARGETS)
    const pageId = optionalUuid(body, 'page_id')
    const blockId = optionalUuid(body, 'block_id')
    const blockType = body.block_type === undefined ? null : requireEnum(body, 'block_type', CMS_BLOCK_TYPES)
    const fields = leerCampos(body.fields)
    const brief = optionalText(body, 'brief', CMS_MAX_BRIEF)
    const tone = body.tone === undefined ? 'neutral' : requireEnum(body, 'tone', CMS_TONOS)
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', CMS_LOCALES)
    const targetLocale = body.target_locale === undefined ? null : requireEnum(body, 'target_locale', CMS_LOCALES)

    if (!TAREAS_DE_DESTINO[target].includes(task)) {
      throw badRequest('CAMPO_INVALIDO', `La tarea \`${task}\` no aplica a \`${target}\``)
    }
    if (target === 'page' && (blockId || blockType)) {
      throw badRequest('CAMPO_NO_PERMITIDO', '`block_id` y `block_type` solo valen para un bloque')
    }
    if (target === 'block' && pageId && blockId) {
      throw badRequest('CAMPO_NO_PERMITIDO', 'Un bloque se identifica por `block_id`')
    }
    if (task === 'translate') {
      if (!targetLocale || targetLocale === locale) {
        throw badRequest('CAMPO_INVALIDO', 'Traducir necesita `target_locale` distinto de `locale`')
      }
    } else if (targetLocale) {
      throw badRequest('CAMPO_NO_PERMITIDO', '`target_locale` solo vale para traducir')
    }

    const client = userClient(request, trace)
    let pageKind: string | null = null
    let storeId: string | null = null
    let tipo = blockType
    // Existencia con el JWT (RLS): una página o un bloque ajenos son 404 antes
    // de gastar nada. No se leen sus textos: los que valen son los del
    // formulario, que es lo que la persona está editando.
    if (blockId) {
      const { data, error } = await client
        .from('content_blocks')
        .select('id, block_type, store_id')
        .eq('id', blockId)
        .maybeSingle()
      if (error) throw fromDatabaseError(error)
      if (!data) throw notFound('NO_ENCONTRADO', 'El bloque no existe o no es visible')
      tipo = (data.block_type as typeof blockType) ?? tipo
      storeId = data.store_id as string
    } else if (pageId) {
      const { data, error } = await client
        .from('content_pages')
        .select('id, kind, store_id')
        .eq('id', pageId)
        .maybeSingle()
      if (error) throw fromDatabaseError(error)
      if (!data) throw notFound('NO_ENCONTRADO', 'La pagina no existe o no es visible')
      pageKind = data.kind as string
      storeId = data.store_id as string
    }
    let storeName: string | null = null
    if (storeId) {
      const { data } = await client.from('stores').select('name').eq('id', storeId).maybeSingle()
      storeName = typeof data?.name === 'string' ? data.name.slice(0, 120) : null
    }

    const peticion: PeticionCms = {
      task,
      target,
      blockType: target === 'block' ? tipo : null,
      fields,
      brief,
      tone,
      locale,
      targetLocale,
      contexto: { pageKind, storeName },
    }

    // Sin nada que traducir, o sin instrucción ni texto de partida: no hay de
    // dónde redactar sin inventar, y no se gasta.
    const vacio = { status: 200, body: { data: { data: null, motivo: 'vacia', interaction_id: null } } }
    if (task === 'translate' && camposPedidos(peticion).length === 0) return vacio
    if (task !== 'translate' && !brief && Object.keys(fields).length === 0) return vacio

    const medidor = medidorDeUsuario(client)
    const resultado = await ejecutarIA<RespuestaModeloCms, BorradorCms>(
      {
        feature: FEATURE,
        prompt: resumenCms(peticion),
        revisar: (data) => {
          const r = revisarCms(data, peticion)
          return r.ok
            ? { ok: true, value: r.value, reply: Object.values(r.value.fields)[0] ?? null }
            : { ok: false, motivo: r.motivo }
        },
      },
      {
        hayProveedor: hayProveedorIA,
        consumir: medidor.consumir,
        registrar: medidor.registrar,
        llamar: () =>
          pedirJson<RespuestaModeloCms>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_CMS),
            user: datosDeCms(peticion),
            schema: ESQUEMA_CMS,
          }),
      },
    )
    return { status: 200, body: { data: cuerpoIA(resultado) } }
  },
)

Deno.serve(handler)
