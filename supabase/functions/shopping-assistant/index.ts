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
 */
import { assertNoTenantInPayload } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import { rejectUnknownFields, requireSlug, requireText } from '../_shared/validation.ts'
import { anonClient } from '../_runtime/clients.ts'

const ALLOWED_FIELDS = ['store_slug', 'message'] as const

/** Cuántos candidatos se le enseñan al modelo. */
const CANDIDATOS = 8

/** Techo del mensaje. Una consulta de compra no necesita más, y un prompt
 *  largo es la vía barata para gastar la cuota del proveedor. */
const MAX_MENSAJE = 400

/** Si el proveedor no contesta en este tiempo, se responde sin él. */
const TIMEOUT_MS = 9000

const MODELO = Deno.env.get('EBIM_AI_MODEL') ?? 'claude-haiku-4-5-20251001'

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

interface Candidato {
  product_id: string
  name: string
  brand_name: string | null
  category_name: string | null
  price: string | null
  currency: string | null
  in_stock: boolean
}

/**
 * Le pide al modelo que elija dentro de la lista, y desconfía de la respuesta.
 *
 * Devuelve `null` ante cualquier duda —sin clave, error, tiempo agotado, JSON
 * ilegible, cero elegidos válidos— y quien llama se queda con la búsqueda. No
 * hay ninguna ruta por la que un fallo del proveedor deje al comprador sin
 * respuesta.
 */
async function recomendar(
  mensaje: string,
  candidatos: Candidato[],
): Promise<{ reply: string; ids: string[] } | null> {
  const clave = Deno.env.get('EBIM_AI_API_KEY')
  if (!clave || candidatos.length === 0) return null

  // Al modelo se le da lo justo para razonar: qué es cada cosa y cuánto cuesta.
  // El precio entra como TEXTO y solo para que pueda ordenar y comparar; lo que
  // devuelva no se usa para pintar ningún importe.
  const lista = candidatos
    .map(
      (c, i) =>
        `${i + 1}. id=${c.product_id} · ${c.name}` +
        (c.brand_name ? ` · ${c.brand_name}` : '') +
        (c.category_name ? ` · ${c.category_name}` : '') +
        (c.price ? ` · ${c.currency ?? ''} ${c.price}` : '') +
        (c.in_stock ? ' · con stock' : ' · sin stock'),
    )
    .join('\n')

  const sistema = [
    'Eres el asistente de compra de una tienda. Respondes en español, en dos frases como máximo.',
    'Elige entre 1 y 4 productos EXCLUSIVAMENTE de la lista que se te da.',
    'No inventes productos, precios, stock ni envíos. No prometas plazos ni descuentos.',
    'Si nada encaja, dilo y no elijas ninguno.',
    'Responde SOLO con JSON: {"reply": "...", "ids": ["uuid", ...]}',
  ].join(' ')

  const control = new AbortController()
  const alarma = setTimeout(() => control.abort(), TIMEOUT_MS)

  try {
    const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': clave,
        'anthropic-version': '2023-06-01',
      },
      signal: control.signal,
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 400,
        system: sistema,
        messages: [{ role: 'user', content: `Consulta: ${mensaje}\n\nProductos:\n${lista}` }],
      }),
    })
    if (!respuesta.ok) return null

    const cuerpo = await respuesta.json()
    const texto: string = cuerpo?.content?.[0]?.text ?? ''
    // El modelo a veces envuelve el JSON en prosa o en un bloque de código.
    const recorte = texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)
    if (!recorte) return null

    const elegido = JSON.parse(recorte) as { reply?: unknown; ids?: unknown }
    const permitidos = new Set(candidatos.map((c) => c.product_id))
    // La barrera: lo que no estaba en la lista no sale de aquí.
    const ids = Array.isArray(elegido.ids)
      ? elegido.ids.filter((id): id is string => typeof id === 'string' && permitidos.has(id))
      : []
    const reply = typeof elegido.reply === 'string' ? elegido.reply.slice(0, 600) : ''

    if (!reply || ids.length === 0) return null
    return { reply, ids: ids.slice(0, 4) }
  } catch {
    // Tiempo agotado, red caída o JSON ilegible: da igual cuál. Se degrada.
    return null
  } finally {
    clearTimeout(alarma)
  }
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

    const sugerido = await recomendar(mensaje, candidatos)

    return {
      status: 200,
      body: {
        data: {
          // `search` no es un error: es el modo en el que esto funciona sin
          // proveedor de IA, y la vitrina lo pinta igual de bien.
          mode: sugerido ? 'ai' : 'search',
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
