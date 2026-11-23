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
import { respuestaVitrinaSinSalud } from './ai.ts'
import type { EsquemaIA } from './aiCore.ts'
import {
  conPresentaciones,
  palabraPrincipal,
  preferirPorNombre,
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
  'reponer',
  'sobre_producto',
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
  | { readonly herramienta: 'reponer' }
  | { readonly herramienta: 'sobre_producto'; readonly producto: string }
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
    case 'reponer':
      return { herramienta: 'reponer' }
    case 'sobre_producto': {
      const producto = texto(crudo.consulta, 80)
      return producto.length >= 2 ? { herramienta: 'sobre_producto', producto } : { herramienta: 'responder' }
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
  '- sustitutos: un producto no está, no tiene stock o pide una alternativa. consulta = el producto que busca; principio_activo = su principio activo SOLO si lo conoces con certeza; si es una combinación, TODOS sus componentes sin conectores («amoxicilina ácido clavulánico»), porque una alternativa con solo uno no es equivalente (si no lo sabes, vacío).',
  '- reponer: pregunta qué le toca reponer, qué se le está acabando o pide «lo de siempre» / su pedido habitual. Sin campos.',
  '- sobre_producto: pregunta por UN producto concreto: qué contiene, ingredientes, características, especificaciones, sus presentaciones o cuál presentación le conviene más (por ejemplo «¿la caja x100 o la x30?»). consulta = ese producto, sin la pregunta.',
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

/**
 * Un producto que el comprador compra con regularidad y le toca reponer. Sale de
 * `my_replenishment` (aritmética sobre SU historial), nunca del modelo.
 */
export interface ItemReposicion {
  readonly sku: string
  readonly nombre: string
  readonly cantidad: number
  readonly compras: number
  readonly cada_dias: number
  readonly dias_restantes: number
}

/** De la respuesta de `my_replenishment` a items tipados; lo que no encaja se descarta. */
export function leerReposicion(data: unknown): ItemReposicion[] {
  const filas = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
  return filas.flatMap((f): ItemReposicion[] => {
    const cantidad = Number(f.cantidad)
    const compras = Number(f.compras)
    const cadaDias = Number(f.cada_dias)
    const diasRestantes = Number(f.dias_restantes)
    if (typeof f.sku !== 'string' || !f.sku || typeof f.nombre !== 'string' || !f.nombre) return []
    if (![cantidad, compras, cadaDias, diasRestantes].every(Number.isInteger)) return []
    if (cantidad < 1 || cantidad > MAX_CANTIDAD || cadaDias < 1) return []
    return [{ sku: f.sku, nombre: f.nombre.slice(0, 200), cantidad, compras, cada_dias: cadaDias, dias_restantes: diasRestantes }]
  }).slice(0, MAX_ITEMS_CHAT)
}

/** Una presentación de la ficha, con el precio que le toca a ESTE comprador. */
export interface PresentacionFicha {
  readonly variant_id: string
  readonly nombre: string
  readonly en_stock: boolean
  /** Precio unitario cotizado con su sesión (lista B2B incluida); null si no se pudo cotizar. */
  readonly precio: string | null
  readonly moneda: string
}

/** Lo publicado de UN producto: lo único con lo que el chat puede contestar sobre él. */
export interface FichaProducto {
  readonly product_id: string
  readonly nombre: string
  readonly marca: string | null
  readonly descripcion: string | null
  readonly destacados: readonly string[]
  readonly especificaciones: ReadonlyArray<{ readonly etiqueta: string; readonly valor: string }>
  readonly presentaciones: readonly PresentacionFicha[]
}

export type UnidadContenido = 'un' | 'ml' | 'g'

export interface Contenido {
  readonly cantidad: number
  readonly unidad: UnidadContenido
}

/** Una fila de la comparación. Las cifras las calcula el código, nunca el modelo. */
export interface FilaComparacion {
  readonly variant_id: string
  readonly nombre: string
  readonly en_stock: boolean
  readonly precio: string | null
  readonly moneda: string
  readonly contenido: Contenido | null
  /** Precio por unidad (un), por 100 ml o por 100 g, con dos decimales; null si no se compara. */
  readonly por_unidad: string | null
  /** La más barata por unidad entre las comparables (solo si no todas cuestan lo mismo). */
  readonly mejor: boolean
}

const UNIDADES_CONTEO =
  'un|und|unid|unids|unidades|tab|tabs|tabletas?|comp|comprimidos?|cap|caps|capsulas?|sobres?|amp|ampollas?|piezas?|pzs?|rollos?|pares|viales?|grageas?'
/** Tras el número, una medida: entonces no es un conteo («x 500 ml», «caja 10 mg»). */
const NO_ES_CONTEO = '(?!\\s*(?:mg|mcg|ml|l|lt|g|gr|kg)\\b)'
const RE_CONTEO = new RegExp(`\\b(\\d{1,5})\\s*(?:${UNIDADES_CONTEO})\\b`)
const RE_POR = new RegExp(`\\b(?:x|por)\\s*(\\d{1,5})\\b${NO_ES_CONTEO}`)
const RE_ENVASE = new RegExp(`\\b(?:caja|frasco|blister|pack|paquete|bolsa)\\s*(?:de\\s*)?(\\d{1,5})\\b${NO_ES_CONTEO}`)
// Tras normalizar, «1,5 L» es «1 5 l»: el segundo grupo es el decimal.
const RE_VOLUMEN = /\b(\d{1,5})(?: (\d{1,3}))?\s*(ml|l|lt|litros?)\b/
const RE_MASA = /\b(\d{1,5})(?: (\d{1,3}))?\s*(g|gr|grs|gramos?|kg)\b/

function decimal(entero: string, fraccion: string | undefined): number {
  return Number(fraccion ? `${entero}.${fraccion}` : entero)
}

/**
 * Cuánto trae una presentación, leído de su nombre: «Caja x100», «30 un»,
 * «500 ml», «1 L», «250 g». Los miligramos NO son contenido (son la dosis de
 * cada tableta): «500 mg Caja x30» trae 30. Si no se lee, null y no se compara.
 */
export function contenidoDePresentacion(nombre: string): Contenido | null {
  const n = normalizar(nombre)
  const conteo = n.match(RE_CONTEO) ?? n.match(RE_POR) ?? n.match(RE_ENVASE)
  if (conteo) {
    const cantidad = Number(conteo[1])
    if (cantidad > 0) return { cantidad, unidad: 'un' }
  }
  const volumen = n.match(RE_VOLUMEN)
  if (volumen) {
    const valor = decimal(volumen[1]!, volumen[2])
    if (valor > 0) return { cantidad: volumen[3] === 'ml' ? valor : valor * 1000, unidad: 'ml' }
  }
  const masa = n.match(RE_MASA)
  if (masa) {
    const valor = decimal(masa[1]!, masa[2])
    if (valor > 0) return { cantidad: masa[3] === 'kg' ? valor * 1000 : valor, unidad: 'g' }
  }
  return null
}

/** Por unidad para «un»; por 100 ml / 100 g para líquidos y pesos. */
const BASE: Record<UnidadContenido, number> = { un: 1, ml: 100, g: 100 }

/**
 * Compara las presentaciones de un producto por precio por unidad. Solo entran
 * las que tienen precio y contenido de la unidad más frecuente (no se compara
 * una caja con un frasco); la «mejor» es la de menor precio por unidad, y no
 * hay mejor si todas empatan.
 */
export function compararPresentaciones(presentaciones: readonly PresentacionFicha[]): FilaComparacion[] {
  const filas = presentaciones.map((p) => ({
    p,
    contenido: contenidoDePresentacion(p.nombre),
    precio: p.precio === null ? Number.NaN : Number(p.precio),
  }))
  const cuenta = new Map<UnidadContenido, number>()
  for (const f of filas) {
    if (f.contenido && Number.isFinite(f.precio) && f.precio > 0) {
      cuenta.set(f.contenido.unidad, (cuenta.get(f.contenido.unidad) ?? 0) + 1)
    }
  }
  const [unidad, comparables] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  const porUnidad = filas.map((f) =>
    unidad && comparables >= 2 && f.contenido?.unidad === unidad && Number.isFinite(f.precio) && f.precio > 0
      ? (f.precio / f.contenido.cantidad) * BASE[unidad]
      : null,
  )
  const centesimas = porUnidad.map((v) => (v === null ? null : Math.round(v * 10000)))
  const valores = centesimas.filter((v): v is number => v !== null)
  const minimo = valores.length >= 2 && new Set(valores).size > 1 ? Math.min(...valores) : null
  return filas.map((f, i) => ({
    variant_id: f.p.variant_id,
    nombre: f.p.nombre,
    en_stock: f.p.en_stock,
    precio: f.p.precio,
    moneda: f.p.moneda,
    contenido: f.contenido,
    por_unidad: porUnidad[i] == null ? null : porUnidad[i]!.toFixed(2),
    mejor: minimo !== null && centesimas[i] === minimo,
  }))
}

function contenidoLegible(c: Contenido | null): string | null {
  if (!c) return null
  return c.unidad === 'un' ? `${c.cantidad} unidades` : `${c.cantidad} ${c.unidad}`
}

const MAX_DESCRIPCION_MODELO = 1500

/**
 * La descripción que ve el modelo: sin las frases que el candado de salud de la
 * vitrina rechazaría («Indicado para…», «sigue las indicaciones de tu médico»)
 * y sin repetidas. Lo que no ve, no lo repite: si las viera, las copiaría y la
 * respuesta entera se bloquearía. La vitrina sigue mostrando la ficha completa.
 */
export function descripcionParaModelo(descripcion: string | null): string | null {
  if (!descripcion) return null
  const vistas = new Set<string>()
  const frases = descripcion
    .split(/(?<=[.!?])\s+/)
    .map((f) => f.trim())
    .filter((f) => {
      const clave = normalizar(f)
      if (!clave || vistas.has(clave)) return false
      vistas.add(clave)
      return respuestaVitrinaSinSalud(f)
    })
  const texto = frases.join(' ').slice(0, MAX_DESCRIPCION_MODELO)
  return texto || null
}

export interface PuertosChat {
  reposicion(): Promise<readonly ItemReposicion[]>
  ficha(productId: string): Promise<FichaProducto | null>
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
  | { readonly tipo: 'reposicion'; readonly items: readonly ItemReposicion[]; readonly lineas: readonly LineaCarrito[] }
  | { readonly tipo: 'ficha'; readonly product_id: string | null; readonly comparacion: readonly FilaComparacion[] }
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
      const encontrados = (r.mode === 'fts' ? r.items : []).filter((i) => !original || !normalizar(i.name).startsWith(original))
      // Con principio activo: primero los que lo llevan en el NOMBRE (no Zaldiar por «paracetamol»).
      const items = (plan.principioActivo ? preferirPorNombre(encontrados, plan.principioActivo) : encontrados).slice(0, MAX_PRODUCTOS)
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
    case 'reponer': {
      const items = await puertos.reposicion()
      // El SKU es el de su último pedido: el carrito lo resuelve por código y,
      // si ya no se vende, cae a buscar por nombre como cualquier otra línea.
      const lineas = items.length > 0 ? await proponerCarrito(items.map((i) => ({ texto: i.nombre, cantidad: i.cantidad, sku: i.sku })), puertos) : []
      return {
        datos: { tipo: 'reposicion', items, lineas },
        paraModelo: items.length > 0
          ? JSON.stringify({
              reponer: items.map((i) => ({ producto: i.nombre, cada_dias: i.cada_dias, dias_restantes: i.dias_restantes })),
              lineas: resumenCarrito(lineas),
            })
          : '(no hay productos que compre con regularidad y le toquen ahora; puede repetir un pedido o dictar lo que necesita)',
        productosPermitidos: [],
      }
    }
    case 'sobre_producto': {
      // El producto lo elige el buscador de la tienda, no el modelo; la
      // respuesta sale SOLO de su ficha publicada.
      const r = await puertos.buscar(plan.producto, false)
      const encontrado = r.mode === 'fts' || r.mode === 'fuzzy' ? r.items[0] : undefined
      const ficha = encontrado ? await puertos.ficha(encontrado.product_id) : null
      if (!ficha) {
        return {
          datos: { tipo: 'ficha', product_id: null, comparacion: [] },
          paraModelo: '(no se encontró ese producto publicado en esta tienda)',
          productosPermitidos: [],
        }
      }
      const comparacion = compararPresentaciones(ficha.presentaciones)
      const comparables = comparacion.filter((c) => c.por_unidad !== null).length
      return {
        datos: { tipo: 'ficha', product_id: ficha.product_id, comparacion },
        paraModelo: JSON.stringify({
          product_id: ficha.product_id,
          producto: ficha.nombre,
          marca: ficha.marca,
          descripcion: descripcionParaModelo(ficha.descripcion),
          destacados: ficha.destacados.slice(0, 10),
          especificaciones: ficha.especificaciones.slice(0, 20),
          presentaciones: comparacion.map((c) => ({
            nombre: c.nombre,
            con_stock: c.en_stock,
            contenido: contenidoLegible(c.contenido),
            mas_conveniente_por_unidad: c.mejor,
          })),
          comparacion_posible: comparables >= 2,
        }),
        productosPermitidos: [ficha.product_id],
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
  'Si es una reposición, di que es según cada cuánto suele comprar (dias_restantes negativo = ya le tocaba) y que revise las cantidades.',
  'Si es una ficha de producto, contesta SOLO con lo que dicen descripcion, destacados y especificaciones: composición, ingredientes, contenido, formato y características. NO repitas frases de la ficha sobre para qué sirve, a quién ayuda, qué alivia, previene o trata, ni indicaciones o modo de uso; si preguntan eso, di que lo consulte con un profesional. Si la ficha no trae el dato, dilo y sugiere consultarlo con la tienda.',
  'Para elegir presentación usa mas_conveniente_por_unidad y di «la más conveniente por unidad» (nunca «más barata» ni «más económica»; la pantalla muestra los precios). Si ninguna es más conveniente, di que cuestan lo mismo por unidad; si comparacion_posible es falso, di que no se pueden comparar por unidad.',
  'Si propones un carrito, dilo y pide que lo revise y lo confirme con el botón; menciona las líneas sin coincidencia o donde debe elegir presentación.',
  'Si ofreces alternativas por componente principal, di que comparten ese componente y que confirme que le sirvan (con un profesional si es un medicamento). Nunca digas para qué sirve un medicamento, dosis, síntomas ni recomiendes uno por una dolencia.',
  'Si los datos no responden la pregunta, dilo y sugiere cómo seguir. product_ids: SOLO identificadores product_id que aparezcan en los datos; si los datos no traen product_id (pedidos, crédito, carrito), lista vacía. Nunca nombres.',
].join('\n')

/**
 * Los números de pedido que trae el resultado. «EC-20261119-00056» tiene
 * dígitos de sobra para parecer un teléfono al candado de contacto; para
 * revisar la frase se tapan SOLO estos (salen de la base, del propio
 * comprador), y la frase que llega es la original.
 */
export function numerosDePedido(datos: DatosChat): string[] {
  switch (datos.tipo) {
    case 'pedidos':
      return datos.pedidos.map((p) => p.order_number)
    case 'pedido':
      return datos.pedido ? [datos.pedido.order_number] : []
    case 'carrito':
      return datos.origen ? [datos.origen] : []
    case 'credito':
      return datos.credito?.proximo ? [datos.credito.proximo.order_number] : []
    default:
      return []
  }
}

export function taparNumeros(texto: string, numeros: readonly string[]): string {
  return numeros.filter(Boolean).reduce((t, n) => t.split(n).join('pedido'), texto)
}

/**
 * Esquema de la redacción del chat. Más holgado que el del núcleo en
 * `product_ids`: con un carrito los datos no traen ids y el modelo rellenaba
 * nombres largos, que el esquema estricto rechazaba entera («esquema») y la
 * frase se perdía. Los ids se filtran igual contra la lista cerrada
 * (`revisarRespuesta`); lo que no es un id permitido no llega a la vitrina.
 */
export const ESQUEMA_RESPUESTA_CHAT = {
  type: 'object',
  properties: {
    texto: { type: 'string', maxLength: 600 },
    product_ids: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 160 } },
  },
  required: ['texto', 'product_ids'],
  additionalProperties: false,
} as const satisfies EsquemaIA
