/**
 * shopping-chat — asistente de compra CONVERSACIONAL de la vitrina (2026-11-22).
 *
 * El comprador con sesión conversa: busca, pregunta por sus pedidos y su
 * crédito, repite un pedido con cambios, dicta uno nuevo o pide alternativas
 * por principio activo. La lógica vive en `_shared/commerceChat.ts`; aquí solo
 * van los puertos (base y modelo) y los candados del borde.
 *
 *  1. Sesión obligatoria y freno por comprador (`ai_chat_check`, 60/h): las
 *     herramientas leen SUS pedidos y SU crédito, y un chat anónimo sería la
 *     forma barata de gastar la cuota de la tienda.
 *  2. Plan del modelo (esquema de lista cerrada) → herramienta con la sesión del
 *     comprador (RLS y `security definer` con su propio guard) → redacción con
 *     candados (sin dinero, sin contacto, sin afirmaciones de salud).
 *  3. Ninguna herramienta escribe. El carrito propuesto lo confirma la persona y
 *     lo valida el verificador del pedido rápido en la vitrina.
 *
 * Se degrada, no se rompe: sin IA, sin cuota o con respuesta bloqueada se
 * devuelven los DATOS igual (si los hubo) y `respuesta: null`.
 */
import { assertNoTenantInPayload } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { AppError, badRequest, fromDatabaseError, unauthorized } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { rejectUnknownFields, requireEnum, requireSlug } from '../_shared/validation.ts'
import { anonClient, serviceClient, userClient } from '../_runtime/clients.ts'
import { errorCode } from '../_shared/observability/logger.ts'
import { sanitizeTextForModel } from '../_shared/observability/redact.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'
import { medidorDeTienda } from '../_runtime/aiMeter.ts'
import { AI_TIER_MODELS, delimitarDatos, sistemaConFrontera } from '../_shared/aiCore.ts'
import { ejecutarIA } from '../_shared/aiPipeline.ts'
import { respuestaVitrinaSinSalud } from '../_shared/ai.ts'
import { historialParaModelo, revisarRespuesta, type Respuesta, type Turno } from '../_shared/commerceAgent.ts'
import {
  ESQUEMA_PLAN_CHAT,
  ESQUEMA_RESPUESTA_CHAT,
  SISTEMA_PLAN_CHAT,
  SISTEMA_RESPUESTA_CHAT,
  ejecutarChat,
  leerMiCarrito,
  leerReposicion,
  leerSeguimiento,
  numerosDePedido,
  taparNumeros,
  validarPlanChat,
  type CreditoComprador,
  type FichaProducto,
  type LineaDePedido,
  type PedidoResumen,
  type PlanChat,
  type PlanChatCrudo,
  type PuertosChat,
} from '../_shared/commerceChat.ts'
import {
  INTAKE_MAX_PRESENTACIONES,
  agruparPresentaciones,
  leerResolucion,
  type FilaVariante,
  type HitCatalogo,
  type ResultadoBusqueda,
} from '../_shared/aiIntake.ts'

const FEATURE = 'assistant'
const ALLOWED_FIELDS = ['store_slug', 'locale', 'messages'] as const
const LOCALES = ['es', 'en'] as const
const MAX_MENSAJES = 8
const MAX_TEXTO = 400
const CANDIDATOS = 8
const TIMEOUT_MS = 15000

function leerMensajes(raw: unknown): Turno[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MENSAJES) {
    throw badRequest('CAMPO_INVALIDO', `\`messages\` debe ser una lista de 1 a ${MAX_MENSAJES} turnos`)
  }
  const turnos: Turno[] = []
  for (const item of raw) {
    const m = item as { role?: unknown; text?: unknown } | null
    if (!m || typeof m !== 'object' || Object.keys(m).some((k) => k !== 'role' && k !== 'text')) {
      throw badRequest('CAMPO_NO_PERMITIDO', 'Cada turno lleva solo role y text')
    }
    const rol = m.role === 'user' ? 'cliente' : m.role === 'assistant' ? 'tienda' : null
    const texto = typeof m.text === 'string' ? m.text.trim().slice(0, MAX_TEXTO) : ''
    if (!rol || texto.length === 0) throw badRequest('CAMPO_INVALIDO', 'Turno sin rol o sin texto')
    // Saneado ANTES del proveedor: un correo o un token pegado no viaja.
    turnos.push({ rol, texto: sanitizeTextForModel(texto, MAX_TEXTO) ?? '' })
  }
  if (turnos[turnos.length - 1].rol !== 'cliente') {
    throw badRequest('CAMPO_INVALIDO', 'El último turno debe ser del cliente')
  }
  return turnos
}

function motivoDeGuarda(reason: unknown): AppError {
  switch (reason) {
    case 'SIN_SESION':
      return unauthorized('Inicia sesión para conversar con el asistente')
    case 'RATE_LIMITED':
      return new AppError('RATE_LIMITED', 'Demasiados mensajes en poco tiempo; prueba en unos minutos', 429)
    default:
      return badRequest('TIENDA_NO_DISPONIBLE', 'La tienda no está disponible')
  }
}

function hit(it: Record<string, unknown>): HitCatalogo {
  return {
    product_id: String(it.product_id),
    slug: String(it.slug ?? ''),
    name: String(it.name),
    sku: typeof it.sku === 'string' && it.sku ? it.sku : null,
    kind: it.kind === 'variant' || it.kind === 'bundle' ? it.kind : 'simple',
    brand_name: typeof it.brand_name === 'string' ? it.brand_name : null,
    in_stock: Boolean(it.in_stock),
  }
}

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_STOREFRONT_ORIGINS')),
    service: 'shopping-chat',
  },
  async ({ request, body, trace, logger }) => {
    assertNoTenantInPayload(body)
    rejectUnknownFields(body, ALLOWED_FIELDS)
    const storeSlug = requireSlug(body, 'store_slug')
    const locale = body.locale === undefined ? 'es' : requireEnum(body, 'locale', LOCALES)
    const turnos = leerMensajes(body.messages)

    // 1 · Sesión y freno, con el JWT del comprador.
    const usuario = userClient(request, trace)
    const { data: guarda, error: errorGuarda } = await usuario.rpc('ai_chat_check', { p_store_slug: storeSlug })
    if (errorGuarda) throw fromDatabaseError(errorGuarda)
    if ((guarda as { allowed?: unknown } | null)?.allowed !== true) {
      throw motivoDeGuarda((guarda as { reason?: unknown } | null)?.reason)
    }

    const catalogo = anonClient(trace)
    const medidor = medidorDeTienda(serviceClient(trace), storeSlug)
    const puertosIA = { hayProveedor: hayProveedorIA, consumir: medidor.consumir, registrar: medidor.registrar }
    const historial = historialParaModelo(turnos)
    const idioma = `Idioma de la respuesta: ${locale === 'en' ? 'inglés' : 'español'}.`

    // De qué pedidos viene cada detalle: de empresa o de consumidor.
    const origenPedido = new Map<string, 'empresa' | 'consumidor'>()

    const puertos: PuertosChat = {
      async buscar(consulta, soloConStock) {
        const { data, error } = await catalogo.rpc('catalog_search_for_slug', {
          p_store_slug: storeSlug,
          p_query: consulta,
          p_filters: soloConStock ? { availability: 'in_stock' } : {},
          p_sort: 'relevance',
          p_limit: CANDIDATOS,
          p_offset: 0,
        })
        if (error) {
          logger.warn('chat.search_failed', { original_code: errorCode(error) })
          return { mode: 'empty', items: [] } satisfies ResultadoBusqueda
        }
        const mode = (['fts', 'fuzzy', 'browse', 'empty'] as const).find((m) => m === data?.mode) ?? 'empty'
        const items = (Array.isArray(data?.items) ? data.items : []) as Array<Record<string, unknown>>
        return {
          mode,
          items: items.filter((it) => typeof it.product_id === 'string' && typeof it.name === 'string').map(hit),
        }
      },
      async pedidos() {
        const [empresa, consumidor] = await Promise.all([
          usuario.rpc('my_business_orders', { p_only_pending: false, p_limit: 10 }),
          usuario.rpc('my_consumer_orders', { p_store_slug: storeSlug, p_limit: 10 }),
        ])
        const filas: PedidoResumen[] = []
        for (const [res, origen] of [[empresa, 'empresa'], [consumidor, 'consumidor']] as const) {
          if (res.error) {
            logger.warn('chat.orders_failed', { origen, original_code: errorCode(res.error) })
            continue
          }
          for (const o of (Array.isArray(res.data) ? res.data : []) as Array<Record<string, unknown>>) {
            if (typeof o.order_id !== 'string' || typeof o.order_number !== 'string') continue
            if (origenPedido.has(o.order_id)) continue
            origenPedido.set(o.order_id, origen)
            filas.push({
              order_id: o.order_id,
              order_number: o.order_number,
              status: String(o.status ?? ''),
              payment_status: String(o.payment_status ?? ''),
              fulfillment_status: typeof o.fulfillment_status === 'string' ? o.fulfillment_status : null,
              placed_at: String(o.placed_at ?? ''),
              total: String(o.grand_total ?? '0'),
              currency: String(o.currency ?? 'PEN'),
            })
          }
        }
        return filas.sort((a, b) => b.placed_at.localeCompare(a.placed_at))
      },
      async detallePedido(orderId) {
        const { data, error } =
          origenPedido.get(orderId) === 'consumidor'
            ? await usuario.rpc('my_consumer_order_detail', { p_store_slug: storeSlug, p_order_id: orderId })
            : await usuario.rpc('my_business_order_detail', { p_order_id: orderId })
        if (error) throw fromDatabaseError(error)
        const items = ((data as { items?: unknown } | null)?.items ?? []) as Array<Record<string, unknown>>
        return items.flatMap((i): LineaDePedido[] => {
          const cantidad = Number(i.quantity)
          if (!Number.isInteger(cantidad) || cantidad < 1) return []
          const etiqueta = typeof i.variant_label === 'string' && i.variant_label ? ` · ${i.variant_label}` : ''
          return [{ sku: typeof i.sku === 'string' && i.sku ? i.sku : null, nombre: `${String(i.name ?? '')}${etiqueta}`, cantidad }]
        })
      },
      async reposicion() {
        const { data, error } = await usuario.rpc('my_replenishment', { p_store_slug: storeSlug, p_horizon_days: 7 })
        if (error) {
          logger.warn('chat.replenishment_failed', { original_code: errorCode(error) })
          return []
        }
        return leerReposicion(data)
      },
      async ficha(productId) {
        // Lo publicado, con el cliente ANÓNIMO (lo mismo que ve la ficha de la
        // vitrina); el precio, cotizado con la sesión del comprador, que es el
        // que le toca a él (lista B2B incluida). El alcance lo fija el slug.
        const { data: tienda } = await catalogo.from('public_stores').select('store_id').eq('slug', storeSlug).maybeSingle()
        const storeId = (tienda as { store_id?: unknown } | null)?.store_id
        if (typeof storeId !== 'string') return null
        const [producto, variantes, detalle] = await Promise.all([
          catalogo
            .from('public_products')
            .select('product_id, name, brand_name, description, currency')
            .eq('store_id', storeId)
            .eq('product_id', productId)
            .maybeSingle(),
          catalogo
            .from('public_product_variants')
            .select('variant_id, name, in_stock, currency, position')
            .eq('store_id', storeId)
            .eq('product_id', productId)
            .order('position')
            .order('name')
            .limit(INTAKE_MAX_PRESENTACIONES),
          catalogo.rpc('product_detail_for_slug', { p_store_slug: storeSlug, p_product_id: productId }),
        ])
        if (producto.error) {
          logger.warn('chat.product_failed', { original_code: errorCode(producto.error) })
          return null
        }
        const p = producto.data as Record<string, unknown> | null
        if (!p || typeof p.name !== 'string') return null
        const filas = (variantes.error ? [] : (variantes.data ?? [])) as Array<Record<string, unknown>>
        const vs = filas.filter((v) => typeof v.variant_id === 'string' && typeof v.name === 'string')

        const precios = new Map<string, string>()
        if (vs.length > 1) {
          const { data: cotizacion, error } = await usuario.rpc('price_quote_for_slug', {
            p_store_slug: storeSlug,
            p_items: vs.map((v) => ({ product_id: productId, variant_id: v.variant_id, quantity: 1 })),
          })
          if (error) logger.warn('chat.quote_failed', { original_code: errorCode(error) })
          const lineas = ((cotizacion as { lines?: unknown } | null)?.lines ?? []) as Array<Record<string, unknown>>
          for (const l of Array.isArray(lineas) ? lineas : []) {
            if (typeof l.variant_id === 'string' && typeof l.unit_price === 'string') precios.set(l.variant_id, l.unit_price)
          }
        }

        const extra = (detalle.error ? null : detalle.data) as { highlights?: unknown; specs?: unknown } | null
        const destacados = Array.isArray(extra?.highlights) ? extra.highlights.filter((h): h is string => typeof h === 'string') : []
        const especificaciones = (Array.isArray(extra?.specs) ? (extra.specs as Array<Record<string, unknown>>) : []).flatMap((e) =>
          typeof e.label === 'string' && typeof e.value === 'string' && e.value ? [{ etiqueta: e.label, valor: e.value }] : [],
        )
        const moneda = typeof p.currency === 'string' ? p.currency : 'PEN'
        return {
          product_id: productId,
          nombre: p.name,
          marca: typeof p.brand_name === 'string' ? p.brand_name : null,
          descripcion: typeof p.description === 'string' && p.description.trim() ? (sanitizeTextForModel(p.description, 1500) ?? null) : null,
          destacados,
          especificaciones,
          presentaciones: vs.map((v) => ({
            variant_id: String(v.variant_id),
            nombre: String(v.name),
            en_stock: v.in_stock === true,
            precio: precios.get(String(v.variant_id)) ?? null,
            moneda: typeof v.currency === 'string' ? v.currency : moneda,
          })),
        } satisfies FichaProducto
      },
      async carrito() {
        const { data, error } = await usuario.rpc('my_cart_summary', { p_store_slug: storeSlug })
        if (error) {
          logger.warn('chat.cart_failed', { original_code: errorCode(error) })
          return leerMiCarrito(null)
        }
        return leerMiCarrito(data)
      },
      async seguimiento(orderId) {
        const { data, error } = await usuario.rpc('my_order_tracking', { p_store_slug: storeSlug, p_order_id: orderId })
        if (error) {
          logger.warn('chat.tracking_failed', { original_code: errorCode(error) })
          return []
        }
        return leerSeguimiento(data)
      },
      async precios(productIds) {
        const salida = new Map<string, { precio: string; moneda: string }>()
        if (productIds.length === 0) return salida
        const { data, error } = await usuario.rpc('price_quote_for_slug', {
          p_store_slug: storeSlug,
          p_items: productIds.slice(0, CANDIDATOS).map((id) => ({ product_id: id, quantity: 1 })),
        })
        if (error) {
          logger.warn('chat.quote_failed', { original_code: errorCode(error) })
          return salida
        }
        const cotizacion = data as { lines?: unknown; currency?: unknown } | null
        const moneda = typeof cotizacion?.currency === 'string' ? cotizacion.currency : 'PEN'
        for (const l of (Array.isArray(cotizacion?.lines) ? cotizacion.lines : []) as Array<Record<string, unknown>>) {
          if (typeof l.product_id === 'string' && typeof l.unit_price === 'string') salida.set(l.product_id, { precio: l.unit_price, moneda })
        }
        return salida
      },
      async credito() {
        const { data, error } = await usuario.rpc('my_account_statement', { p_store_slug: storeSlug })
        if (error) {
          logger.warn('chat.statement_failed', { original_code: errorCode(error) })
          return null
        }
        const cuenta = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null
        if (!cuenta) return null
        const documentos = (Array.isArray(cuenta.documents) ? cuenta.documents : []) as Array<Record<string, unknown>>
        const pendientes = documentos
          .filter((d) => typeof d.due_at === 'string')
          .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
        const proximo = pendientes[0]
        return {
          cuenta: String(cuenta.account_name ?? ''),
          limite: cuenta.credit_limit == null ? null : String(cuenta.credit_limit),
          disponible: cuenta.credit_available == null ? null : String(cuenta.credit_available),
          saldo: String(cuenta.balance_due ?? '0'),
          vencido: String(cuenta.overdue_amount ?? '0'),
          moneda: String(documentos[0]?.currency ?? 'PEN'),
          proximo: proximo
            ? {
                order_number: String(proximo.order_number ?? ''),
                due_at: String(proximo.due_at),
                total: String(proximo.total ?? '0'),
                days_overdue: Number(proximo.days_overdue ?? 0),
              }
            : null,
        } satisfies CreditoComprador
      },
      async resolverCodigos(skus) {
        const { data, error } = await usuario.rpc('resolve_order_lines_for_slug', {
          p_store_slug: storeSlug,
          p_lines: skus.slice(0, 100).map((sku) => ({ sku, quantity: 1 })),
        })
        if (error) {
          logger.warn('chat.codes_failed', { original_code: errorCode(error) })
          return new Map()
        }
        return leerResolucion(data)
      },
      async presentaciones(productIds) {
        // Mismo criterio que order-intake: el SKU de la variante no es legible
        // con la sesión del comprador; el alcance lo fija el product_id, que
        // salió del buscador o del verificador de ESTA tienda.
        const { data, error } = await serviceClient(trace)
          .from('product_variants')
          .select('id, product_id, sku, name, position')
          .in('product_id', [...productIds])
          .eq('is_active', true)
          .order('position')
          .order('name')
          .limit(productIds.length * INTAKE_MAX_PRESENTACIONES)
        if (error) {
          logger.warn('chat.variants_failed', { original_code: errorCode(error) })
          return new Map()
        }
        return agruparPresentaciones((data ?? []) as FilaVariante[])
      },
    }

    // 2 · Plan.
    const plan = await ejecutarIA<PlanChatCrudo, PlanChat>(
      { feature: FEATURE, prompt: `chat · plan · ${turnos[turnos.length - 1].texto}`, revisar: (d) => ({ ok: true, value: validarPlanChat(d), reply: null }) },
      {
        ...puertosIA,
        llamar: () =>
          pedirJson<PlanChatCrudo>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_PLAN_CHAT),
            user: delimitarDatos('conversacion', historial),
            schema: ESQUEMA_PLAN_CHAT,
            maxTokens: 1024,
            model: Deno.env.get('EBIM_AI_MODEL_CHAT_PLAN')?.trim() || AI_TIER_MODELS.redaccion,
            timeoutMs: TIMEOUT_MS,
          }),
      },
    )
    if (!plan.data) {
      return { status: 200, body: { data: { herramienta: 'responder', datos: { tipo: 'ninguno' }, respuesta: null, product_ids: [], motivo: plan.motivo } } }
    }

    // 3 · Ejecutar con la sesión del comprador.
    const resultado = await ejecutarChat(plan.data, puertos)

    // 4 · Redactar, con candados.
    const redaccion = await ejecutarIA<{ texto?: unknown; product_ids?: unknown }, Respuesta>(
      {
        feature: FEATURE,
        prompt: `chat · ${plan.data.herramienta}`,
        revisar: (d) => {
          // Los candados se pasan con los números de pedido del resultado
          // tapados (parecen teléfonos); la frase que sale es la original.
          const original = typeof d.texto === 'string' ? d.texto : ''
          const r = revisarRespuesta({ ...d, texto: taparNumeros(original, numerosDePedido(resultado.datos)) }, resultado.productosPermitidos)
          if (!r.ok) return { ok: false, motivo: r.motivo }
          if (!respuestaVitrinaSinSalud(r.value.texto)) return { ok: false, motivo: 'bloqueada' }
          const texto = original.replace(/\s+/g, ' ').trim().slice(0, 600)
          return { ok: true, value: { ...r.value, texto }, reply: texto }
        },
      },
      {
        ...puertosIA,
        llamar: () =>
          pedirJson<{ texto?: unknown; product_ids?: unknown }>({
            feature: FEATURE,
            system: sistemaConFrontera(SISTEMA_RESPUESTA_CHAT),
            user: [
              idioma,
              delimitarDatos('conversacion', historial),
              delimitarDatos(`resultado_${plan.data!.herramienta}`, resultado.paraModelo),
            ].join('\n\n'),
            schema: ESQUEMA_RESPUESTA_CHAT,
            // El techo por defecto (512) cortaba la frase de un carrito largo y
            // la respuesta llegaba como «esquema» (sin texto).
            maxTokens: 1024,
            timeoutMs: TIMEOUT_MS,
          }),
      },
    )

    return {
      status: 200,
      body: {
        data: {
          herramienta: plan.data.herramienta,
          datos: resultado.datos,
          respuesta: redaccion.data?.texto ?? null,
          product_ids: redaccion.data?.productIds ?? [],
          motivo: redaccion.data ? null : redaccion.motivo,
        },
      },
    }
  },
)

Deno.serve(handler)
