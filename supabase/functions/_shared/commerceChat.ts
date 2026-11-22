/**
 * Asistente de compra CONVERSACIONAL de la vitrina (2026-11-22). TypeScript PURO.
 *
 * El buscador con IA (`shopping-assistant`) contesta una pregunta suelta. Esto
 * conversa con un comprador CON SESIÓN y actúa sobre SU cuenta:
 *
 *   «Repíteme el pedido del mes pasado, pero sin el Fanter y con el doble de Consiv»
 *   «¿Cuánto crédito me queda?» · «¿Dónde está mi pedido EC-…?»
 *   «No hay Nabila, ¿qué tienen con lo mismo?»
 *
 * ## El reparto, igual que el resto de la IA de la suite
 *
 *   planificar (IA, esquema, lista cerrada)  →  ejecutar (base, con la sesión)  →  redactar (IA, candados)
 *
 *  · El modelo ELIGE una herramienta y sus argumentos; no ve la base.
 *  · Las herramientas leen con la sesión del comprador (sus pedidos, su crédito,
 *    su surtido). Ninguna escribe: armar un carrito devuelve una PROPUESTA que
 *    la persona confirma, y el carrito la valida con el verificador del pedido
 *    rápido como si la hubiera tecleado.
 *  · El texto del modelo no lleva importes ni stock: la vitrina pinta los datos
 *    (tarjetas de producto, pedidos, crédito) desde `datos`, que sale de la base.
 *
 * Canal-agnóstico: es la base del canal de WhatsApp que espera aprobación de la
 * plataforma (`docs/propuestas/2026-11-19-canal-whatsapp-comercio.md`).
 */
import type { EsquemaIA } from './aiCore.ts'
import {
  conPresentaciones,
  palabraPrincipal,
  proponerLinea,
  propuestaPorCodigo,
  type CodigoResuelto,
  type LineaLeida,
  type LineaPropuesta,
  type Presentacion,
  type ResultadoBusqueda,
} from './aiIntake.ts'

// ---------------------------------------------------------------------------
// 1 · Herramientas y plan
// ---------------------------------------------------------------------------

export const HERRAMIENTAS_CHAT = [
  'buscar_productos',
  'mis_pedidos',
  'estado_pedido',
  'mi_credito',
  'repetir_pedido',
  'armar_pedido',
  'sustitutos',
  'responder',
] as const
export type HerramientaChat = (typeof HERRAMIENTAS_CHAT)[number]

export const MAX_ITEMS_CHAT = 20
const MAX_CANTIDAD = 9999

export interface ItemPedido {
  readonly producto: string
  /** 0 = quitarlo (solo al repetir un pedido). */
  readonly cantidad: number
}

export type PlanChat =
  | { readonly herramienta: 'buscar_productos'; readonly consulta: string; readonly soloConStock: boolean }
  | { readonly herramienta: 'mis_pedidos' }
  | { readonly herramienta: 'estado_pedido'; readonly numero: string | null }
  | { readonly herramienta: 'mi_credito' }
  | { readonly herramienta: 'repetir_pedido'; readonly numero: string | null; readonly cambios: readonly ItemPedido[] }
  | { readonly herramienta: 'armar_pedido'; readonly items: readonly ItemPedido[] }
  | { readonly herramienta: 'sustitutos'; readonly producto: string; readonly principioActivo: string }
  | { readonly herramienta: 'responder' }

export interface PlanChatCrudo {
  herramienta?: unknown
  consulta?: unknown
  solo_con_stock?: unknown
  numero_pedido?: unknown
  principio_activo?: unknown
  items?: unknown
}

const NUMERO_PEDIDO = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/

function texto(valor: unknown, max: number): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function leerItems(valor: unknown, permitirCero: boolean): ItemPedido[] {
  if (!Array.isArray(valor)) return []
  const salida: ItemPedido[] = []
  for (const crudo of valor) {
    const item = crudo as { producto?: unknown; cantidad?: unknown } | null
    const producto = texto(item?.producto, 80)
    const cantidad = Number(item?.cantidad)
    if (producto.length < 2 || !Number.isInteger(cantidad)) continue
    if (cantidad < (permitirCero ? 0 : 1) || cantidad > MAX_CANTIDAD) continue
    salida.push({ producto, cantidad })
    if (salida.length >= MAX_ITEMS_CHAT) break
  }
  return salida
}

/** Valida el plan del modelo. Todo lo que no encaja es `responder`. */
export function validarPlanChat(crudo: PlanChatCrudo): PlanChat {
  const numero = texto(crudo.numero_pedido, 40)
  const numeroValido = NUMERO_PEDIDO.test(numero) ? numero : null
  switch (crudo.herramienta) {
    case 'buscar_productos': {
      const consulta = texto(crudo.consulta, 120)
      return consulta.length >= 2
        ? { herramienta: 'buscar_productos', consulta, soloConStock: crudo.solo_con_stock === true }
        : { herramienta: 'responder' }
    }
    case 'mis_pedidos':
      return { herramienta: 'mis_pedidos' }
    case 'estado_pedido':
      return { herramienta: 'estado_pedido', numero: numeroValido }
    case 'mi_credito':
      return { herramienta: 'mi_credito' }
    case 'repetir_pedido':
      return { herramienta: 'repetir_pedido', numero: numeroValido, cambios: leerItems(crudo.items, true) }
    case 'armar_pedido': {
      const items = leerItems(crudo.items, false)
      return items.length > 0 ? { herramienta: 'armar_pedido', items } : { herramienta: 'responder' }
    }
    case 'sustitutos': {
      const producto = texto(crudo.consulta, 80)
      const principioActivo = texto(crudo.principio_activo, 80)
      return producto.length >= 2 || principioActivo.length >= 3
        ? { herramienta: 'sustitutos', producto, principioActivo }
        : { herramienta: 'responder' }
    }
    default:
      return { herramienta: 'responder' }
  }
}

export const SISTEMA_PLAN_CHAT = [
  'Eres el asistente de compra de una tienda online B2B y B2C. El cliente tiene sesión iniciada. Elige UNA herramienta para atender su ÚLTIMO mensaje, usando la conversación como contexto:',
  '- buscar_productos: busca o pregunta por productos. consulta = términos cortos de catálogo (tipo de producto, marca, principio activo). solo_con_stock si lo pide.',
  '- mis_pedidos: quiere ver sus pedidos o compras recientes.',
  '- estado_pedido: pregunta dónde está o cómo va un pedido. numero_pedido si lo dio; vacío = el más reciente.',
  '- mi_credito: pregunta por su crédito, saldo, deuda, facturas o vencimientos.',
  '- repetir_pedido: quiere volver a pedir un pedido anterior. numero_pedido si lo dio (vacío = el más reciente). items = SOLO los cambios: {producto, cantidad} con la cantidad final; cantidad 0 = quitarlo. «el doble de X» sin saber cuánto era: deja items vacío para X y dilo al redactar.',
  '- armar_pedido: dicta productos para pedir. items = {producto, cantidad} (cantidad 1 si no la dice).',
  '- sustitutos: un producto no está, no tiene stock o pide una alternativa. consulta = el producto que busca; principio_activo = su principio activo o componente principal SOLO si lo conoces con certeza (si no, vacío).',
  '- responder: saludo, agradecimiento, fuera de tema o falta información.',
  'Nunca inventes números de pedido. Rellena solo los campos de la herramienta elegida; los demás vacíos.',
].join('\n')

export const ESQUEMA_PLAN_CHAT = {
  type: 'object',
  properties: {
    herramienta: { type: 'string', enum: [...HERRAMIENTAS_CHAT] },
    consulta: { type: 'string', maxLength: 160 },
    solo_con_stock: { type: 'boolean' },
    numero_pedido: { type: 'string', maxLength: 40 },
    principio_activo: { type: 'string', maxLength: 80 },
    items: {
      type: 'array',
      maxItems: MAX_ITEMS_CHAT,
      items: {
        type: 'object',
        properties: { producto: { type: 'string', maxLength: 80 }, cantidad: { type: 'integer' } },
        required: ['producto', 'cantidad'],
        additionalProperties: false,
      },
    },
  },
  required: ['herramienta', 'consulta', 'solo_con_stock', 'numero_pedido', 'principio_activo', 'items'],
  additionalProperties: false,
} as const satisfies EsquemaIA

// ---------------------------------------------------------------------------
// 2 · Puertos y datos
// ---------------------------------------------------------------------------

export interface PedidoResumen {
  readonly order_id: string
  readonly order_number: string
  readonly status: string
  readonly payment_status: string
  readonly fulfillment_status: string | null
  readonly placed_at: string
  readonly total: string
  readonly currency: string
}

export interface LineaDePedido {
  readonly sku: string | null
  readonly nombre: string
  readonly cantidad: number
}

export interface CreditoComprador {
  readonly cuenta: string
  readonly limite: string | null
  readonly disponible: string | null
  readonly saldo: string
  readonly vencido: string
  readonly moneda: string
  readonly proximo: { readonly order_number: string; readonly due_at: string | null; readonly total: string; readonly days_overdue: number } | null
}

export interface PuertosChat {
  buscar(consulta: string, soloConStock: boolean): Promise<ResultadoBusqueda>
  pedidos(): Promise<readonly PedidoResumen[]>
  detallePedido(orderId: string): Promise<readonly LineaDePedido[]>
  credito(): Promise<CreditoComprador | null>
  resolverCodigos(skus: readonly string[]): Promise<Map<string, CodigoResuelto>>
  presentaciones(productIds: readonly string[]): Promise<Map<string, Presentacion[]>>
}

export type LineaCarrito = LineaPropuesta & { readonly presentaciones: readonly Presentacion[] }

/** Lo que la vitrina pinta. Sale de la base, nunca del modelo. */
export type DatosChat =
  | { readonly tipo: 'productos'; readonly product_ids: readonly string[]; readonly consulta: string }
  | { readonly tipo: 'pedidos'; readonly pedidos: readonly PedidoResumen[] }
  | { readonly tipo: 'pedido'; readonly pedido: PedidoResumen | null }
  | { readonly tipo: 'credito'; readonly credito: CreditoComprador | null }
  | { readonly tipo: 'carrito'; readonly origen: string | null; readonly lineas: readonly LineaCarrito[]; readonly avisos: readonly string[] }
  | { readonly tipo: 'sustitutos'; readonly producto: string; readonly principio_activo: string | null; readonly product_ids: readonly string[] }
  | { readonly tipo: 'ninguno' }

export interface ResultadoChat {
  readonly datos: DatosChat
  /** Lo que ve el modelo para redactar: reducido, SIN importes. */
  readonly paraModelo: string
  readonly productosPermitidos: readonly string[]
}

const MAX_PRODUCTOS = 6
const MAX_PEDIDOS = 5

function normalizar(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** ¿El nombre del pedido corresponde a lo que dijo el cliente? Por palabras. */
export function nombreCoincide(nombre: string, dicho: string): boolean {
  const n = normalizar(nombre)
  const palabras = normalizar(dicho).split(' ').filter((p) => p.length >= 3)
  return palabras.length > 0 && palabras.every((p) => n.includes(p))
}

/**
 * Aplica los cambios del cliente a las líneas del pedido anterior: la cantidad
 * final de lo que ya estaba (0 = quitarlo) y lo nuevo al final.
 */
export function aplicarCambios(
  lineas: readonly LineaDePedido[],
  cambios: readonly ItemPedido[],
): { lineas: Array<{ texto: string; cantidad: number; sku: string | null }>; avisos: string[] } {
  const resultado = lineas.map((l) => ({ texto: l.nombre, cantidad: l.cantidad, sku: l.sku }))
  const avisos: string[] = []
  for (const cambio of cambios) {
    const indice = resultado.findIndex((l) => nombreCoincide(l.texto, cambio.producto))
    if (indice >= 0) {
      if (cambio.cantidad === 0) resultado.splice(indice, 1)
      else resultado[indice] = { ...resultado[indice]!, cantidad: cambio.cantidad }
    } else if (cambio.cantidad > 0) {
      resultado.push({ texto: cambio.producto, cantidad: cambio.cantidad, sku: null })
    } else {
      avisos.push(`NO_ESTABA:${cambio.producto}`)
    }
  }
  return { lineas: resultado.filter((l) => l.cantidad > 0), avisos }
}

function leida(texto: string, cantidad: number, sku: string | null): LineaLeida {
  return { texto, cantidad, cantidadSupuesta: false, unidad: null, sku, legible: true }
}

/**
 * De «producto + cantidad» a líneas de carrito propuestas, con las mismas
 * reglas que la lectura de pedidos: el código manda si es nuestro; si no, el
 * texto (y luego el nombre comercial); las presentaciones se eligen en la fila.
 */
export async function proponerCarrito(
  entradas: ReadonlyArray<{ texto: string; cantidad: number; sku: string | null }>,
  puertos: PuertosChat,
): Promise<LineaCarrito[]> {
  const codigos = [...new Set(entradas.flatMap((e) => (e.sku ? [e.sku] : [])))]
  const resueltos = codigos.length > 0 ? await puertos.resolverCodigos(codigos) : new Map<string, CodigoResuelto>()

  const propuestas = await Promise.all(
    entradas.map(async (entrada, indice) => {
      const linea = leida(entrada.texto, entrada.cantidad, entrada.sku)
      const codigo = entrada.sku ? resueltos.get(entrada.sku.toLowerCase()) : undefined
      let busqueda = await puertos.buscar(entrada.texto, false)
      let porPalabra = false
      if (busqueda.items.length === 0 || busqueda.mode === 'empty') {
        const palabra = palabraPrincipal(entrada.texto)
        if (palabra) {
          const segunda = await puertos.buscar(palabra, false)
          if (segunda.mode === 'fts' && segunda.items.length > 0) {
            busqueda = segunda
            porPalabra = true
          }
        }
      }
      const porTexto = proponerLinea(indice, linea, busqueda, { codigoAjeno: true, porPalabra })
      return codigo && entrada.sku ? propuestaPorCodigo(porTexto, entrada.sku, codigo) : porTexto
    }),
  )

  const conVariantes = [...new Set(propuestas.filter(conPresentaciones).map((p) => p.coincidencia!.product_id))]
  const porProducto = conVariantes.length > 0 ? await puertos.presentaciones(conVariantes) : new Map<string, Presentacion[]>()
  return propuestas.map((p) => ({
    ...p,
    presentaciones: conPresentaciones(p) ? (porProducto.get(p.coincidencia!.product_id) ?? []) : [],
  }))
}

function resumenPedido(p: PedidoResumen) {
  return { numero: p.order_number, estado: p.status, pago: p.payment_status, entrega: p.fulfillment_status, fecha: p.placed_at.slice(0, 10) }
}

function resumenCarrito(lineas: readonly LineaCarrito[]) {
  return lineas.map((l) => ({
    texto: l.texto,
    cantidad: l.cantidad,
    producto: l.coincidencia?.name ?? null,
    estado: l.confianza,
    elegir_presentacion: l.presentaciones.length > 0 && !l.sku_propuesto,
  }))
}

// ---------------------------------------------------------------------------
// 3 · Ejecutar
// ---------------------------------------------------------------------------

export async function ejecutarChat(plan: PlanChat, puertos: PuertosChat): Promise<ResultadoChat> {
  switch (plan.herramienta) {
    case 'buscar_productos': {
      const r = await puertos.buscar(plan.consulta, plan.soloConStock)
      const items = r.mode === 'fts' || r.mode === 'fuzzy' ? r.items.slice(0, MAX_PRODUCTOS) : []
      const ids = items.map((i) => i.product_id)
      return {
        datos: { tipo: 'productos', product_ids: ids, consulta: plan.consulta },
        paraModelo: JSON.stringify({
          coincidencia: r.mode,
          productos: items.map((i) => ({ product_id: i.product_id, nombre: i.name, marca: i.brand_name, con_stock: i.in_stock })),
        }),
        productosPermitidos: ids,
      }
    }
    case 'mis_pedidos': {
      const pedidos = (await puertos.pedidos()).slice(0, MAX_PEDIDOS)
      return {
        datos: { tipo: 'pedidos', pedidos },
        paraModelo: JSON.stringify(pedidos.map(resumenPedido)),
        productosPermitidos: [],
      }
    }
    case 'estado_pedido': {
      const pedidos = await puertos.pedidos()
      const pedido = plan.numero
        ? (pedidos.find((p) => p.order_number.toLowerCase() === plan.numero!.toLowerCase()) ?? null)
        : (pedidos[0] ?? null)
      return {
        datos: { tipo: 'pedido', pedido },
        paraModelo: pedido ? JSON.stringify(resumenPedido(pedido)) : '(no hay ningún pedido tuyo con ese número)',
        productosPermitidos: [],
      }
    }
    case 'mi_credito': {
      const credito = await puertos.credito()
      return {
        datos: { tipo: 'credito', credito },
        // Sin importes: el modelo dice si hay deuda vencida y la vitrina pinta las cifras.
        paraModelo: credito
          ? JSON.stringify({
              cuenta: credito.cuenta,
              tiene_linea: credito.limite !== null,
              tiene_vencido: Number(credito.vencido) > 0,
              proximo_vencimiento: credito.proximo?.due_at?.slice(0, 10) ?? null,
            })
          : '(no compra con una cuenta de empresa con crédito en esta tienda)',
        productosPermitidos: [],
      }
    }
    case 'repetir_pedido': {
      const pedidos = await puertos.pedidos()
      const pedido = plan.numero
        ? (pedidos.find((p) => p.order_number.toLowerCase() === plan.numero!.toLowerCase()) ?? null)
        : (pedidos[0] ?? null)
      if (!pedido) {
        return {
          datos: { tipo: 'carrito', origen: null, lineas: [], avisos: ['SIN_PEDIDO'] },
          paraModelo: '(no hay ningún pedido anterior que repetir con esos datos)',
          productosPermitidos: [],
        }
      }
      const detalle = await puertos.detallePedido(pedido.order_id)
      const { lineas, avisos } = aplicarCambios(detalle, plan.cambios)
      const carrito = await proponerCarrito(lineas, puertos)
      return {
        datos: { tipo: 'carrito', origen: pedido.order_number, lineas: carrito, avisos },
        paraModelo: JSON.stringify({ pedido: pedido.order_number, lineas: resumenCarrito(carrito), avisos }),
        productosPermitidos: [],
      }
    }
    case 'armar_pedido': {
      const carrito = await proponerCarrito(
        plan.items.map((i) => ({ texto: i.producto, cantidad: i.cantidad, sku: null })),
        puertos,
      )
      return {
        datos: { tipo: 'carrito', origen: null, lineas: carrito, avisos: [] },
        paraModelo: JSON.stringify({ lineas: resumenCarrito(carrito) }),
        productosPermitidos: [],
      }
    }
    case 'sustitutos': {
      // El principio activo es lo que busca: «metilfenidato» encuentra Consiv
      // por su descripción. Sin él, el nombre comercial.
      const consulta = plan.principioActivo || plan.producto
      const r = await puertos.buscar(consulta, true)
      const original = normalizar(plan.producto)
      const items = (r.mode === 'fts' ? r.items : [])
        .filter((i) => !original || !normalizar(i.name).startsWith(original))
        .slice(0, MAX_PRODUCTOS)
      const ids = items.map((i) => i.product_id)
      return {
        datos: { tipo: 'sustitutos', producto: plan.producto, principio_activo: plan.principioActivo || null, product_ids: ids },
        paraModelo: JSON.stringify({
          buscado: plan.producto,
          principio_activo: plan.principioActivo || null,
          alternativas: items.map((i) => ({ product_id: i.product_id, nombre: i.name, marca: i.brand_name, con_stock: i.in_stock })),
        }),
        productosPermitidos: ids,
      }
    }
    case 'responder':
      return { datos: { tipo: 'ninguno' }, paraModelo: '(sin datos)', productosPermitidos: [] }
  }
}

// ---------------------------------------------------------------------------
// 4 · Redactar
// ---------------------------------------------------------------------------

export const SISTEMA_RESPUESTA_CHAT = [
  'Eres el asistente de compra de una tienda online y conversas con un cliente con sesión. Responde en su idioma, cálido y directo, en tres frases como máximo, con lo que dicen los datos.',
  'La pantalla muestra aparte los productos, pedidos, el crédito y el carrito propuesto con sus precios y cifras: NO escribas precios, importes, saldos, descuentos ni cantidades de stock.',
  'Si propones un carrito, dilo y pide que lo revise y lo confirme con el botón; menciona las líneas sin coincidencia o donde debe elegir presentación.',
  'Si ofreces alternativas por componente principal, di que comparten ese componente y que confirme que le sirvan (con un profesional si es un medicamento). Nunca digas para qué sirve un medicamento, dosis, síntomas ni recomiendes uno por una dolencia.',
  'Si los datos no responden la pregunta, dilo y sugiere cómo seguir. Si mencionas productos, devuelve sus product_id SOLO de los datos.',
].join('\n')
