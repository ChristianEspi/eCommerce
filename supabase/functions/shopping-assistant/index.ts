/**
 * shopping-assistant — ayuda a encontrar QUÉ comprar, sobre el catálogo real.
 *
 * ## Lo que devuelve, y por qué solo eso
 *
 * Devuelve un texto corto y una lista de **identificadores de producto**. Ni un
 * precio, ni un stock, ni una moneda. No es una omisión: es la regla que hace
 * que un modelo de lenguaje pueda participar en una tienda sin poder mentir
 * sobre lo que cuesta algo. La vitrina vuelve a resolver cada producto contra el
 * catálogo antes de pintarlo, así que lo peor que puede hacer el modelo es
 * recomendar mal — nunca cobrar mal.
 *
 * Por la misma razón los identificadores se filtran contra la lista de
 * candidatos antes de salir: si el modelo inventa un uuid, se cae aquí y no
 * llega al navegador.
 *
 * ## El orden importa: primero se busca, después se explica
 *
 * 1. La frase del comprador se traduce a una consulta y unos filtros con reglas
 *    DETERMINISTAS —tope de precio, «con stock»—, no con el modelo.
 * 2. `catalog_search_for_slug` devuelve los candidatos. Esa es la única fuente
 *    de verdad sobre qué existe y qué está publicado.
 * 3. El modelo, si lo hay, elige y explica DENTRO de esa lista cerrada.
 *
 * Invertir el orden —preguntar primero al modelo qué productos hay— es como se
 * acaba recomendando un artículo que la tienda no vende.
 *
 * ## Sin clave de IA sigue funcionando
 *
 * Si no hay `EBIM_AI_API_KEY`, la función responde igual con los resultados de
 * la búsqueda y `mode: "search"`. La demo no puede depender de que un proveedor
 * externo esté disponible, y una tienda cuyo buscador se cae porque expiró una
 * clave de IA es peor que una tienda sin IA. Lo mismo si el proveedor tarda,
 * falla o responde algo que no se entiende: se degrada, nunca se rompe.
 *
 * ## Cuesta dinero, así que se mide
 *
 * Es la única función del producto que cualquiera en internet puede disparar en
 * bucle y que gasta por llamada. Cada consulta que llega al modelo descuenta una
 * acción de la cuota de la sociedad —resuelta por el slug de la tienda, porque
 * aquí no hay JWT— y deja su traza con los tokens que costó
 * (`20260910100000_ai_metering.sql`). Agotada la cuota se responde igual, en
 * modo búsqueda: el comprador no es quien contrató la IA y no tiene por qué
 * encontrarse un muro de pago ajeno.
 */
import { assertNoTenantInPayload } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { rejectUnknownFields, requireSlug, requireText } from '../_shared/validation.ts'
import {
  ESQUEMA_SUGERENCIA,
  SISTEMA_ASISTENTE,
  filtrarPermitidos,
  listarCandidatos,
  recortarRespuesta,
  type AiStatus,
  type CandidatoIA,
} from '../_shared/ai.ts'
import { anonClient, serviceClient } from '../_runtime/clients.ts'
import type { Trace } from '../_shared/observability/index.ts'
import { hayProveedorIA, pedirJson } from '../_runtime/anthropic.ts'

const ALLOWED_FIELDS = ['store_slug', 'message'] as const

/** Cuántos candidatos se le enseñan al modelo. */
const CANDIDATOS = 8

/** Techo del mensaje. Una consulta de compra no necesita más, y un prompt
 *  largo es la vía barata para gastar la cuota del proveedor. */
const MAX_MENSAJE = 400

/** Si el proveedor no contesta en este tiempo, se responde sin él. */
const TIMEOUT_MS = 9000

/**
 * De la frase a los filtros, sin modelo.
 *
 * Son tres reglas y ninguna es lista: un tope de precio, la petición explícita
 * de stock y poco más. Se hacen aquí y no en el modelo porque un filtro es un
 * dato —entra en la consulta SQL— y los datos no se le piden a algo que puede
 * equivocarse. El modelo llega después, cuando ya no puede cambiar QUÉ se buscó.
 */
function interpretar(mensaje: string): { query: string; filters: Record<string, unknown> } {
  const filters: Record<string, unknown> = {}
  let resto = mensaje

  /**
   * Cada filtro se lleva SU FRASE al salir.
   *
   * Es el detalle que hace que esto funcione. El índice de texto exige que casen
   * todos los términos, así que dejar dentro las palabras que ya se
   * convirtieron en filtro —«con stock», «por menos de 60»— es pedirle al
   * catálogo un producto que se llame «vitaminas con stock». Devuelve cero, y
   * el fallo no se ve: la búsqueda ha funcionado perfectamente sobre una
   * pregunta imposible.
   */
  function extraer(patron: RegExp): RegExpMatchArray | null {
    const encontrado = resto.match(patron)
    if (encontrado) resto = resto.replace(patron, ' ')
    return encontrado
  }

  // «menos de 60», «hasta S/ 60», «bajo 60 soles».
  const tope = extraer(
    /(?:por\s+)?(?:menos de|hasta|bajo|máximo|maximo|max\.?)\s*(?:s\/\.?\s*)?(\d+)(?:\s*soles?)?/i,
  )
  if (tope?.[1]) filters.price_max = tope[1]

  if (extraer(/\b(?:con\s+stock|disponibles?|en\s+stock)\b/i)) filters.availability = 'in_stock'
  if (extraer(/\b(?:en\s+)?(?:oferta|ofertas|rebajad\w*|descuento|promoci\w*)\b/i)) {
    filters.discounted = true
  }

  // Lo que solo sirve para dirigirse a alguien no ayuda a buscar y, peor, tiene
  // que casar igual que el nombre del producto.
  const query = resto
    .replace(
      /\b(hola|busco|buscando|necesito|quiero|quisiera|muéstrame|muestrame|recomiéndame|recomiendame|dame|algo|alguna|alguno|para|un|una|unos|unas|de|del|la|el|los|las|mi|me|por favor)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()

  return { query, filters }
}

type Candidato = CandidatoIA & { in_stock: boolean }

/**
 * Le pide al modelo que elija dentro de la lista, y desconfía de la respuesta.
 *
 * Devuelve `null` ante cualquier duda —sin clave, sin cuota, error del
 * proveedor, tiempo agotado, cero elegidos válidos— y quien llama se queda con
 * la búsqueda. No hay ninguna ruta por la que un fallo del proveedor deje al
 * comprador sin respuesta.
 *
 * ## Cuándo se descuenta la cuota
 *
 * ANTES de llamar al proveedor, nunca después. Descontar al volver significa
 * que una cuota agotada se descubre cuando la llamada ya está pagada, que es
 * justo lo que la cuota existía para evitar.
 *
 * ## Por qué agotarse NO devuelve un 402 aquí
 *
 * Quien pregunta es un comprador, no el cliente que contrató la IA. Enseñarle
 * un muro de pago por una cuota que no es suya sería incomprensible: se degrada
 * al buscador, que sigue siendo una respuesta útil, y el tenant se entera por
 * su medidor.
 */
async function recomendar(
  storeSlug: string,
  mensaje: string,
  candidatos: Candidato[],
  trace: Trace,
): Promise<{ reply: string; ids: string[]; status: AiStatus } | null> {
  // Ni se mira la cuota si no hay proveedor o no hay entre qué elegir: gastar
  // una acción para no llamar a nadie es cobrar por nada.
  if (!hayProveedorIA() || candidatos.length === 0) return null

  // `serviceClient` y no `anonClient`: las funciones de medición son de
  // servidor a propósito, porque llevan la sociedad como argumento y no
  // comprueban pertenencia. La clave de servicio vive en los secretos de esta
  // función y no sale de aquí.
  const servicio = serviceClient(trace)

  const { data: cuota } = await servicio.rpc('ai_consume_for_store', {
    p_store_slug: storeSlug,
    p_feature: 'assistant',
    p_units: 1,
  })
  if (!cuota?.allowed) return null

  const respuesta = await pedirJson<{ reply?: unknown; ids?: unknown }>({
    system: SISTEMA_ASISTENTE,
    user: `Consulta: ${mensaje}\n\nProductos:\n${listarCandidatos(candidatos)}`,
    schema: ESQUEMA_SUGERENCIA,
    maxTokens: 400,
    timeoutMs: TIMEOUT_MS,
  })

  const permitidos = new Set(candidatos.map((c) => c.product_id))
  // La barrera se mantiene AUNQUE la respuesta venga con esquema: el esquema
  // garantiza que `ids` son cadenas, no que nombren algo que existe.
  const ids = filtrarPermitidos(respuesta.data?.ids, permitidos)
  const reply = recortarRespuesta(respuesta.data?.reply)
  const salioBien = Boolean(respuesta.data) && Boolean(reply) && ids.length > 0

  // La traza se deja SIEMPRE, también cuando falló: una llamada que no
  // respondió cuesta lo mismo y es la que más interesa mirar después.
  await servicio.rpc('ai_record_for_store', {
    p_store_slug: storeSlug,
    p_feature: 'assistant',
    p_status: salioBien ? 'ai' : respuesta.motivo === 'proveedor' ? 'error' : 'search',
    p_model: respuesta.model,
    p_prompt: mensaje,
    p_reply: reply || null,
    p_input_tokens: respuesta.usage.inputTokens,
    p_output_tokens: respuesta.usage.outputTokens,
    p_cache_read_tokens: respuesta.usage.cacheReadTokens,
    p_latency_ms: respuesta.latencyMs,
  })

  if (!salioBien) return null
  return { reply, ids, status: 'ai' }
}

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_STOREFRONT_ORIGINS')),
    service: 'shopping-assistant',
  },
  async ({ body, trace }) => {
    assertNoTenantInPayload(body)
    rejectUnknownFields(body, ALLOWED_FIELDS)

    const storeSlug = requireSlug(body, 'store_slug')
    const mensaje = requireText(body, 'message', { min: 2, max: MAX_MENSAJE })

    const { query, filters } = interpretar(mensaje)
    // Sin nada que buscar tras limpiar la frase, no se llama a nadie: es una
    // consulta que devolvería el catálogo entero y costaría lo mismo.
    if (query.length < 2) {
      throw badRequest('CONSULTA_VACIA', 'Escribe qué estás buscando')
    }

    // `anonClient`: el catálogo público se lee como cualquier visitante. La RPC
    // es `security definer` y ya fuerza tienda activa y productos publicados;
    // usar `service_role` aquí sería darle a un buscador permisos de escritura.
    const cliente = anonClient(trace)

    /**
     * `mode` del buscador, y no es un detalle interno.
     *
     * `fuzzy` significa que NO hubo coincidencia de texto y el catálogo devolvió
     * lo mas parecido por trigramas. Para una caja de búsqueda es lo correcto
     * —quien teclea «shampu» quiere sus champús— pero para un ASISTENTE es la
     * diferencia entre responder y inventar: preguntando «pañales» a un catálogo
     * que no tiene pañales, «vaginales» sale como vecino lexico y presentarlo
     * como recomendacion es peor que decir que no hay.
     *
     * No se filtra por puntuacion porque la puntuacion no separa los casos: el
     * acierto de «vitamnas» puntua 2.03 y el disparate de «pañales» 2.25. Lo que
     * se hace es DECIRLO, y que la pantalla enmarque el resultado como lo que
     * es: un parecido, no una respuesta.
     */
    let match = 'empty'

    async function buscar(termino: string) {
      const { data, error } = await cliente.rpc('catalog_search_for_slug', {
        p_store_slug: storeSlug,
        p_query: termino,
        p_filters: filters,
        p_sort: 'relevance',
        p_limit: CANDIDATOS,
        p_offset: 0,
      })
      if (error) throw fromDatabaseError(error)
      match = typeof data?.mode === 'string' ? data.mode : 'empty'
      return (data?.items ?? []) as Candidato[]
    }

    let items = await buscar(query)

    /**
     * Segundo intento con la palabra más larga.
     *
     * El índice exige que casen TODOS los términos, así que una frase de tres
     * palabras falla entera si sobra una. Limpiar la frase cubre lo previsible
     * —«con stock», «por menos de»— y esto cubre lo demás: de «pastillas para el
     * dolor de cabeza» rescata «pastillas», que es peor recomendación que la
     * ideal y muchísimo mejor que un panel vacío.
     *
     * La palabra más larga y no la primera: en castellano el sustantivo que
     * importa casi nunca abre la frase, pero sí suele ser el término largo.
     */
    if (items.length === 0) {
      const palabras = query.split(' ').filter((p) => p.length > 3)
      const principal = palabras.sort((a, b) => b.length - a.length)[0]
      if (principal && principal !== query) items = await buscar(principal)
    }
    const candidatos = items.map((item) => ({
      product_id: item.product_id,
      name: item.name,
      brand_name: item.brand_name ?? null,
      category_name: item.category_name ?? null,
      price: item.price ?? null,
      currency: item.currency ?? null,
      in_stock: Boolean(item.in_stock),
    }))

    const sugerido = await recomendar(storeSlug, mensaje, candidatos, trace)

    return {
      status: 200,
      body: {
        data: {
          // `search` no es un error: es el modo en el que esto funciona sin
          // proveedor de IA, y la vitrina lo pinta igual de bien.
          mode: sugerido ? 'ai' : 'search',
          /** Cómo se encontró: `fts` es coincidencia real, `fuzzy` es parecido. */
          match,
          /** Lo que de verdad se buscó, ya limpio. La pantalla lo cita. */
          query,
          reply: sugerido?.reply ?? null,
          // SOLO identificadores. El precio, el stock y la foto los resuelve la
          // vitrina contra el catálogo.
          product_ids: sugerido?.ids ?? candidatos.map((c) => c.product_id),
        },
      },
    }
  },
)

Deno.serve(handler)
