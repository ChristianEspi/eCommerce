/**
 * Núcleo conversacional de comercio (2026-11-19). TypeScript PURO, sin canal.
 *
 * ## Para qué existe, y para qué todavía no
 *
 * Es la lógica que comparten los canales conversacionales que vendrán —WhatsApp
 * y los agentes de compra externos vía MCP— y que hoy NO están conectados: los
 * dos son canales nuevos de la suite y van primero al buzón de la plataforma
 * (`docs/propuestas/2026-11-19-*.md`). Aquí queda lo que no depende del canal:
 *
 *  1. **Herramientas de LISTA CERRADA**, solo de lectura y sobre lo público de
 *     una tienda: buscar productos, ver un producto, ver el estado de un pedido
 *     con su número y su token (el mismo dato que el enlace de seguimiento).
 *  2. **Un turno**: el modelo PLANIFICA (elige una herramienta y sus argumentos,
 *     con esquema), el sistema la EJECUTA contra la base, y el modelo REDACTA
 *     la respuesta sobre el resultado. Precios, stock y estados nunca los
 *     escribe el modelo: el canal los pinta desde `datos`, que sale de la base.
 *  3. **Las mismas herramientas en formato MCP** (`herramientasMcp`), para que
 *     el futuro servidor MCP no invente una segunda definición.
 *
 * Los efectos (base y modelo) llegan como PUERTOS: así el orden y los candados
 * se prueban sin red (`supabase/tests/commerce-agent.test.ts`).
 */
import type { EsquemaIA } from './aiCore.ts'

// ---------------------------------------------------------------------------
// 1 · Herramientas
// ---------------------------------------------------------------------------

export const HERRAMIENTAS = ['buscar_productos', 'ver_producto', 'estado_pedido', 'responder'] as const
export type Herramienta = (typeof HERRAMIENTAS)[number]

export interface ArgsBuscar {
  readonly consulta: string
  readonly solo_con_stock: boolean
}
export interface ArgsProducto {
  readonly product_id: string
}
export interface ArgsPedido {
  readonly numero_pedido: string
  readonly token: string
}

export type Plan =
  | { readonly herramienta: 'buscar_productos'; readonly args: ArgsBuscar }
  | { readonly herramienta: 'ver_producto'; readonly args: ArgsProducto }
  | { readonly herramienta: 'estado_pedido'; readonly args: ArgsPedido }
  | { readonly herramienta: 'responder'; readonly args: Record<string, never> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{64}$/i
const NUMERO_PEDIDO = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/

/** Descripciones de cada herramienta: las mismas para el modelo y para MCP. */
export const DESCRIPCION_HERRAMIENTA: Readonly<Record<Exclude<Herramienta, 'responder'>, string>> = {
  buscar_productos: 'Busca productos publicados en la tienda por nombre, tipo o necesidad.',
  ver_producto: 'Ficha pública de un producto de la tienda (presentación, disponibilidad, entrega).',
  estado_pedido: 'Estado de un pedido de la tienda con su número y el token de su enlace de seguimiento.',
}

/**
 * Valida el plan del modelo. Todo lo que no encaje es `responder`: ante la duda,
 * contestar sin herramienta antes que llamar a la base con algo inventado.
 */
export function validarPlan(crudo: { herramienta?: unknown; consulta?: unknown; solo_con_stock?: unknown; product_id?: unknown; numero_pedido?: unknown; token?: unknown }): Plan {
  switch (crudo.herramienta) {
    case 'buscar_productos': {
      const consulta = String(crudo.consulta ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (consulta.length < 2) return { herramienta: 'responder', args: {} }
      return { herramienta: 'buscar_productos', args: { consulta, solo_con_stock: crudo.solo_con_stock === true } }
    }
    case 'ver_producto': {
      const id = String(crudo.product_id ?? '')
      return UUID.test(id) ? { herramienta: 'ver_producto', args: { product_id: id } } : { herramienta: 'responder', args: {} }
    }
    case 'estado_pedido': {
      const numero = String(crudo.numero_pedido ?? '').trim()
      const token = String(crudo.token ?? '').trim().toLowerCase()
      return NUMERO_PEDIDO.test(numero) && TOKEN.test(token)
        ? { herramienta: 'estado_pedido', args: { numero_pedido: numero, token } }
        : { herramienta: 'responder', args: {} }
    }
    default:
      return { herramienta: 'responder', args: {} }
  }
}

export const SISTEMA_PLAN = [
  'Eres el asistente de una tienda online que atiende por chat. Decide UNA herramienta para responder al último mensaje del cliente:',
  '- buscar_productos: si busca o pregunta por productos. consulta = términos de búsqueda cortos.',
  '- ver_producto: si pregunta por un producto concreto que ya apareció (usa su product_id de la conversación).',
  '- estado_pedido: SOLO si el cliente dio el número de pedido y el código de seguimiento de 64 caracteres. Nunca los inventes.',
  '- responder: saludo, agradecimiento, algo que no requiere datos, o si falta información (pide lo que falta).',
  'Rellena solo los campos de la herramienta elegida; los demás, vacíos.',
].join('\n')

export const ESQUEMA_PLAN = {
  type: 'object',
  properties: {
    herramienta: { type: 'string', enum: [...HERRAMIENTAS] },
    consulta: { type: 'string', maxLength: 160 },
    solo_con_stock: { type: 'boolean' },
    product_id: { type: 'string', maxLength: 40 },
    numero_pedido: { type: 'string', maxLength: 40 },
    token: { type: 'string', maxLength: 64 },
  },
  required: ['herramienta', 'consulta', 'solo_con_stock', 'product_id', 'numero_pedido', 'token'],
  additionalProperties: false,
} as const satisfies EsquemaIA

// ---------------------------------------------------------------------------
// 2 · Ejecutar: la base, por puertos
// ---------------------------------------------------------------------------

export interface PuertosComercio {
  buscar(consulta: string, soloConStock: boolean): Promise<ReadonlyArray<Record<string, unknown>>>
  producto(productId: string): Promise<Record<string, unknown> | null>
  pedido(numero: string, token: string): Promise<Record<string, unknown> | null>
}

export interface ResultadoHerramienta {
  readonly herramienta: Herramienta
  /** Lo que el canal pinta tal cual. Sale de la base, nunca del modelo. */
  readonly datos: unknown
  /** Lo que ve el modelo para redactar: reducido, sin importes. */
  readonly paraModelo: string
  /** Productos que la respuesta puede citar (lista cerrada). */
  readonly productosPermitidos: readonly string[]
}

const MAX_RESULTADOS = 6

export async function ejecutarHerramienta(plan: Plan, puertos: PuertosComercio): Promise<ResultadoHerramienta> {
  switch (plan.herramienta) {
    case 'buscar_productos': {
      const items = (await puertos.buscar(plan.args.consulta, plan.args.solo_con_stock)).slice(0, MAX_RESULTADOS)
      const lista = items.map((it) => ({
        product_id: String(it.product_id ?? ''),
        nombre: String(it.name ?? ''),
        marca: it.brand_name ? String(it.brand_name) : undefined,
        con_stock: Boolean(it.in_stock),
      }))
      return {
        herramienta: plan.herramienta,
        datos: items,
        paraModelo: JSON.stringify(lista),
        productosPermitidos: lista.map((p) => p.product_id).filter((id) => UUID.test(id)),
      }
    }
    case 'ver_producto': {
      const p = await puertos.producto(plan.args.product_id)
      return {
        herramienta: plan.herramienta,
        datos: p,
        paraModelo: p
          ? JSON.stringify({ product_id: plan.args.product_id, nombre: p.name, marca: p.brand_name, disponible: p.in_stock })
          : '(no existe o no está publicado)',
        productosPermitidos: p ? [plan.args.product_id] : [],
      }
    }
    case 'estado_pedido': {
      const o = await puertos.pedido(plan.args.numero_pedido, plan.args.token)
      return {
        herramienta: plan.herramienta,
        datos: o,
        // Estados como CÓDIGOS: el modelo los nombra; el total lo pinta el canal.
        paraModelo: o
          ? JSON.stringify({ numero: o.order_number, estado: o.status, pago: o.payment_status, entrega: o.fulfillment_status })
          : '(no hay ningún pedido con esos datos)',
        productosPermitidos: [],
      }
    }
    case 'responder':
      return { herramienta: 'responder', datos: null, paraModelo: '(sin datos)', productosPermitidos: [] }
  }
}

// ---------------------------------------------------------------------------
// 3 · Redactar, con candados
// ---------------------------------------------------------------------------

export const SISTEMA_RESPUESTA = [
  'Eres el asistente de una tienda online que atiende por chat. Responde al cliente en su idioma, en tres frases como máximo, con lo que dicen los datos.',
  'No escribas precios, importes, descuentos, cantidades de stock, plazos ni promesas: el canal muestra esos datos aparte.',
  'Si los datos no responden la pregunta, dilo y sugiere cómo seguir. Si recomiendas productos, devuelve sus product_id SOLO de los datos.',
  'No des consejos médicos, dosis ni diagnósticos.',
].join('\n')

export const ESQUEMA_RESPUESTA = {
  type: 'object',
  properties: {
    texto: { type: 'string', maxLength: 600 },
    product_ids: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 40 } },
  },
  required: ['texto', 'product_ids'],
  additionalProperties: false,
} as const satisfies EsquemaIA

const DINERO = /(?:S\/\.?|US\$|\$|USD|PEN|soles?|d[oó]lares?)\s*\d|\d+(?:[.,]\d+)?\s*(?:soles?|d[oó]lares?)/i
const CONTACTO = /[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s-]{7,}\d/

export interface Respuesta {
  readonly texto: string
  readonly productIds: readonly string[]
}

/** Sin dinero, sin contacto, y productos solo de la lista cerrada. */
export function revisarRespuesta(
  data: { texto?: unknown; product_ids?: unknown },
  permitidos: readonly string[],
): { ok: true; value: Respuesta } | { ok: false; motivo: 'vacia' | 'bloqueada' } {
  const texto = String(data.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)
  if (texto.length < 2) return { ok: false, motivo: 'vacia' }
  if (DINERO.test(texto) || CONTACTO.test(texto)) return { ok: false, motivo: 'bloqueada' }
  const set = new Set(permitidos)
  const ids = (Array.isArray(data.product_ids) ? data.product_ids : [])
    .map(String)
    .filter((id) => set.has(id))
    .slice(0, 4)
  return { ok: true, value: { texto, productIds: [...new Set(ids)] } }
}

// ---------------------------------------------------------------------------
// 4 · La conversación como dato
// ---------------------------------------------------------------------------

export interface Turno {
  readonly rol: 'cliente' | 'tienda'
  readonly texto: string
}

export const MAX_TURNOS = 6
export const MAX_TEXTO_TURNO = 400

/** Los últimos turnos, recortados: el historial es dato, no instrucciones. */
export function historialParaModelo(turnos: readonly Turno[]): string {
  return turnos
    .slice(-MAX_TURNOS)
    .map((t) => `${t.rol}: ${t.texto.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO_TURNO)}`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// 5 · MCP: las mismas herramientas, sin segunda definición
// ---------------------------------------------------------------------------

export interface HerramientaMcp {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly annotations: { readonly readOnlyHint: true; readonly openWorldHint: false }
}

/** Definiciones listas para un `tools/list` de MCP. Todas de solo lectura. */
export function herramientasMcp(): HerramientaMcp[] {
  const ro = { readOnlyHint: true as const, openWorldHint: false as const }
  return [
    {
      name: 'buscar_productos',
      description: DESCRIPCION_HERRAMIENTA.buscar_productos,
      inputSchema: {
        type: 'object',
        properties: {
          consulta: { type: 'string', minLength: 2, maxLength: 120 },
          solo_con_stock: { type: 'boolean', default: false },
        },
        required: ['consulta'],
        additionalProperties: false,
      },
      annotations: ro,
    },
    {
      name: 'ver_producto',
      description: DESCRIPCION_HERRAMIENTA.ver_producto,
      inputSchema: {
        type: 'object',
        properties: { product_id: { type: 'string', format: 'uuid' } },
        required: ['product_id'],
        additionalProperties: false,
      },
      annotations: ro,
    },
    {
      name: 'estado_pedido',
      description: DESCRIPCION_HERRAMIENTA.estado_pedido,
      inputSchema: {
        type: 'object',
        properties: {
          numero_pedido: { type: 'string', minLength: 3, maxLength: 40 },
          token: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        },
        required: ['numero_pedido', 'token'],
        additionalProperties: false,
      },
      annotations: ro,
    },
  ]
}
