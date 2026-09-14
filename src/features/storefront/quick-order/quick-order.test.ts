import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicProduct, PublicVariant } from '../types'

/**
 * Pedido rápido y CSV, sin red: el texto, el informe y el carrito.
 *
 * Lo que se compra aquí:
 *
 *  · el lector de CSV aguanta lo que produce una hoja de verdad —BOM, CRLF,
 *    punto y coma, comillas, columnas de más— y rechaza lo que no es la
 *    plantilla ANTES de preguntar a nadie;
 *  · un SKU repetido se rechaza en todas sus filas, y el tope de 100 filas es
 *    del archivo entero;
 *  · el informe numera por fila del ARCHIVO aunque el servidor numere por
 *    posición;
 *  · **reimportar la misma lista no duplica el carrito**: la cantidad del
 *    archivo se fija, no se suma.
 */

const productos = vi.hoisted(() => ({ lista: [] as unknown[], variantes: [] as unknown[], sinStock: new Set<string>() }))

vi.mock('../api', () => ({
  fetchPublicProductsByIds: vi.fn(async (_store: string, ids: string[]) =>
    (productos.lista as PublicProduct[]).filter((p) => ids.includes(p.product_id)),
  ),
  fetchPublicVariants: vi.fn(async (productId: string) =>
    (productos.variantes as PublicVariant[]).filter((v) => v.product_id === productId),
  ),
}))

vi.mock('@/features/inventory/api', () => ({
  fetchPublicAvailability: vi.fn(
    async (input: { items: Array<{ product_id: string; variant_id?: string | null; quantity?: number }> }) =>
      input.items.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        quantity: String(item.quantity ?? 1),
        unknown: false,
        source: 'catalog',
        in_stock: !productos.sinStock.has(item.product_id),
      })),
  ),
}))

const { addToCart, emptyCart, setLineQuantity } = await import('../cart/cart')
const {
  QUICK_ORDER_MAX_ROWS,
  buildReport,
  checkLines,
  detectDelimiter,
  draftsFromEditor,
  parseOrderCsv,
  parsePastedLines,
  quickOrderCsvTemplate,
  splitDelimited,
} = await import('./lines')
const { importIntoCart, planCartImport } = await import('./importToCart')

/** BOM de Excel, construido: un U+FEFF literal en el fuente es invisible. */
const BOM = String.fromCharCode(0xfeff)

const STORE = 'aaaaaaaa-0000-4000-8000-000000000001'
const JABON = 'bbbbbbbb-0000-4000-8000-000000000001'
const CAMISETA = 'bbbbbbbb-0000-4000-8000-000000000002'
const ROJA = 'cccccccc-0000-4000-8000-000000000001'
const AGOTADO = 'bbbbbbbb-0000-4000-8000-000000000003'

function producto(product_id: string, name: string): PublicProduct {
  return {
    product_id,
    store_id: STORE,
    category_id: null,
    slug: name.toLowerCase(),
    name,
    description: null,
    price: '10.00',
    compare_at_price: null,
    currency: 'PEN',
    published_at: '2026-01-01T00:00:00Z',
    custom_fields: {},
    kind: 'simple',
    brand_name: null,
    in_stock: true,
    variant_count: 0,
    price_from: '10.00',
    category_slug: null,
    category_name: null,
    primary_image_path: null,
    primary_image_alt: null,
  } as unknown as PublicProduct
}

beforeEach(() => {
  productos.lista = [producto(JABON, 'Jabon'), producto(CAMISETA, 'Camiseta'), producto(AGOTADO, 'Agotado')]
  productos.variantes = [
    {
      variant_id: ROJA,
      product_id: CAMISETA,
      store_id: STORE,
      name: 'Roja',
      position: 0,
      is_default: true,
      in_stock: true,
      price: '12.00',
      compare_at_price: null,
      currency: 'PEN',
    },
  ]
  productos.sinStock = new Set([AGOTADO])
})

// ---------------------------------------------------------------------------

describe('separador y campos', () => {
  it('deduce el separador por línea: tabulador, punto y coma o coma', () => {
    expect(detectDelimiter('SKU\t3')).toBe('\t')
    expect(detectDelimiter('SKU;3')).toBe(';')
    expect(detectDelimiter('SKU,3')).toBe(',')
  })

  it('respeta comillas y comillas escapadas', () => {
    expect(splitDelimited('"A,1",2', ',')).toEqual(['A,1', '2'])
    expect(splitDelimited('"di ""hola""";4', ';')).toEqual(['di "hola"', '4'])
  })

  it('con punto y coma, «1,5» es UNA cantidad (inválida), no dos columnas', () => {
    const { lines } = parsePastedLines('SKU-1;1,5')
    expect(lines).toEqual([{ row: 1, sku: 'SKU-1', quantityText: '1,5' }])
    expect(checkLines(lines).rejected[0]?.reason).toBe('CANTIDAD_INVALIDA')
  })
})

describe('CSV', () => {
  it('lee la plantilla que se descarga', () => {
    const parsed = parseOrderCsv(quickOrderCsvTemplate())
    expect(parsed).toEqual({ fileIssue: null, lines: [{ row: 2, sku: 'SKU-EJEMPLO', quantityText: '1' }] })
  })

  it('tolera BOM, CRLF, punto y coma, mayúsculas en la cabecera y columnas de más', () => {
    const text = BOM + 'Descripcion;SKU;Cantidad\r\nJabón;QO-JABON;3\r\n\r\nCamiseta;QO-CAM-ROJA;2\r\n'
    expect(parseOrderCsv(text)).toEqual({
      fileIssue: null,
      lines: [
        { row: 2, sku: 'QO-JABON', quantityText: '3' },
        // La fila vacía cuenta: la 4 es la 4 de la hoja.
        { row: 4, sku: 'QO-CAM-ROJA', quantityText: '2' },
      ],
    })
  })

  it('admite la cabecera en inglés `quantity`', () => {
    expect(parseOrderCsv('sku,quantity\nA,1').lines).toEqual([{ row: 2, sku: 'A', quantityText: '1' }])
  })

  it('sin las columnas sku y cantidad, el archivo entero se rechaza', () => {
    expect(parseOrderCsv('codigo,unidades\nA,1')).toEqual({ lines: [], fileIssue: 'CABECERA_INVALIDA' })
    expect(parseOrderCsv('sku\nA')).toEqual({ lines: [], fileIssue: 'CABECERA_INVALIDA' })
  })

  it('vacío o solo cabecera es un archivo sin datos', () => {
    expect(parseOrderCsv('')).toEqual({ lines: [], fileIssue: 'ARCHIVO_VACIO' })
    expect(parseOrderCsv(BOM + '\r\n')).toEqual({ lines: [], fileIssue: 'ARCHIVO_VACIO' })
    expect(parseOrderCsv('sku,cantidad\r\n')).toEqual({ lines: [], fileIssue: 'ARCHIVO_VACIO' })
  })

  it('100 filas de datos entran; 101 rechazan el archivo entero', () => {
    const filas = (n: number) =>
      ['sku,cantidad', ...Array.from({ length: n }, (_, i) => `SKU-${i},1`)].join('\n')
    expect(parseOrderCsv(filas(QUICK_ORDER_MAX_ROWS)).lines).toHaveLength(100)
    expect(parseOrderCsv(filas(QUICK_ORDER_MAX_ROWS + 1))).toEqual({ lines: [], fileIssue: 'LIMITE_FILAS' })
  })
})

describe('pegar líneas', () => {
  it('coma, punto y coma y tabulador en la misma pegada', () => {
    const { lines, fileIssue } = parsePastedLines('A,1\nB;2\r\nC\t3')
    expect(fileIssue).toBeNull()
    expect(lines.map((l) => [l.row, l.sku, l.quantityText])).toEqual([
      [1, 'A', '1'],
      [2, 'B', '2'],
      [3, 'C', '3'],
    ])
  })

  it('una línea con columnas de más se marca como formato inválido', () => {
    const { lines } = parsePastedLines('A,1,5')
    expect(lines[0]).toMatchObject({ malformed: true })
    expect(checkLines(lines).rejected[0]?.reason).toBe('FORMATO_INVALIDO')
  })

  it('sin cantidad no se inventa un 1', () => {
    const { lines } = parsePastedLines('SOLO-SKU')
    expect(checkLines(lines).rejected[0]?.reason).toBe('CANTIDAD_INVALIDA')
  })

  it('vacía o de más de 100 líneas se rechaza entera', () => {
    expect(parsePastedLines('  \n\n').fileIssue).toBe('ARCHIVO_VACIO')
    expect(parsePastedLines(Array.from({ length: 101 }, (_, i) => `S${i},1`).join('\n')).fileIssue).toBe(
      'LIMITE_FILAS',
    )
  })
})

describe('validación del navegador', () => {
  it('SKU vacío, cantidad inválida, tope de 99 y duplicados en TODAS sus filas', () => {
    const { valid, rejected } = checkLines([
      { row: 1, sku: '', quantityText: '1' },
      { row: 2, sku: 'A', quantityText: '0' },
      { row: 3, sku: 'B', quantityText: '1.5' },
      { row: 4, sku: 'C', quantityText: '100' },
      { row: 5, sku: 'D', quantityText: '99' },
      { row: 6, sku: 'dup', quantityText: '5' },
      { row: 7, sku: ' DUP ', quantityText: '3' },
    ])
    expect(valid).toEqual([{ row: 5, sku: 'D', quantity: 99 }])
    expect(rejected.map((r) => [r.row, r.reason])).toEqual([
      [1, 'SKU_REQUERIDO'],
      [2, 'CANTIDAD_INVALIDA'],
      [3, 'CANTIDAD_INVALIDA'],
      [4, 'CANTIDAD_MAXIMA'],
      [6, 'SKU_DUPLICADO'],
      [7, 'SKU_DUPLICADO'],
    ])
  })

  it('las filas del editor conservan su número aunque haya huecos', () => {
    const parsed = draftsFromEditor([
      { sku: 'A', quantity: '1' },
      { sku: '', quantity: '' },
      { sku: 'B', quantity: '2', malformed: true },
    ])
    expect(parsed.lines).toEqual([
      { row: 1, sku: 'A', quantityText: '1' },
      { row: 3, sku: 'B', quantityText: '2', malformed: true },
    ])
    expect(draftsFromEditor([{ sku: ' ', quantity: '' }]).fileIssue).toBe('ARCHIVO_VACIO')
  })
})

describe('informe', () => {
  it('traduce la posición del servidor a la fila del archivo y ordena', () => {
    const sent = [
      { row: 2, sku: 'QO-JABON', quantity: 3 },
      { row: 5, sku: 'NO-EXISTE', quantity: 1 },
      { row: 6, sku: 'RARO', quantity: 1 },
    ]
    const report = buildReport(
      sent,
      [{ row: 3, sku: '', status: 'rejected', reason: 'SKU_REQUERIDO' }],
      [
        { row: 1, status: 'ok', product_id: JABON, variant_id: null, name: 'Jabon', variant_name: null, quantity: 3 },
        { row: 2, status: 'rejected', reason: 'SKU_NO_ENCONTRADO' },
        // Un código que esta versión no conoce no se acepta ni se pinta crudo.
        { row: 3, status: 'rejected', reason: 'CODIGO_NUEVO' },
      ],
    )
    expect(report.map((l) => [l.row, l.status, l.status === 'rejected' ? l.reason : l.product_id])).toEqual([
      [2, 'ok', JABON],
      [3, 'rejected', 'SKU_REQUERIDO'],
      [5, 'rejected', 'SKU_NO_ENCONTRADO'],
      [6, 'rejected', 'DESCONOCIDO'],
    ])
  })

  it('una fila enviada sin respuesta no entra al carrito', () => {
    const report = buildReport([{ row: 2, sku: 'A', quantity: 1 }], [], [])
    expect(report).toEqual([{ row: 2, sku: 'A', status: 'rejected', reason: 'DESCONOCIDO' }])
  })
})

// ---------------------------------------------------------------------------

type CartState = ReturnType<typeof emptyCart>

/** Un carrito con la MISMA lógica que el de la vitrina, sin React. */
function carritoFalso(inicial?: CartState) {
  let state = inicial ?? emptyCart(STORE)
  return {
    get cart() {
      return state
    },
    add: vi.fn(async (product: PublicProduct, quantity = 1, variant: PublicVariant | null = null) => {
      // La existencia la pregunta el carrito real con `availability_for_slug`;
      // aquí, igual: lo agotado no entra.
      if (productos.sinStock.has(product.product_id)) return false
      state = addToCart(state, product, quantity, variant)
      return true
    }),
    setQuantity: vi.fn((productId: string, quantity: number, variantId: string | null = null) => {
      state = setLineQuantity(state, productId, quantity, variantId)
    }),
  }
}

function aceptada(row: number, product_id: string, quantity: number, variant_id: string | null = null) {
  return { row, sku: `SKU-${row}`, status: 'ok' as const, product_id, variant_id, name: 'x', variant_name: null, quantity }
}

describe('pasar al carrito es repetible', () => {
  it('planifica: lo que no está se añade, lo que está con otra cantidad se fija, lo igual no se toca', () => {
    const plan = planCartImport(
      [
        { product_id: JABON, variant_id: null, quantity: 3 },
        { product_id: CAMISETA, variant_id: ROJA, quantity: 1 },
      ],
      [aceptada(2, JABON, 3), aceptada(3, CAMISETA, 4, ROJA), aceptada(4, CAMISETA, 2)],
    )
    expect(plan.unchanged.map((l) => l.row)).toEqual([2])
    expect(plan.toSet.map((l) => l.row)).toEqual([3])
    // Mismo producto SIN variante es otra línea: se añade.
    expect(plan.toAdd.map((l) => l.row)).toEqual([4])
  })

  it('importar dos veces la misma lista deja las cantidades del archivo, no el doble', async () => {
    const carrito = carritoFalso()
    const lista = [aceptada(2, JABON, 3), aceptada(3, CAMISETA, 2, ROJA)]

    const primera = await importIntoCart(carrito, { storeId: STORE, storeSlug: 'tienda' }, lista)
    expect(primera).toEqual({ added: 2, updated: 0, unchanged: 0, skipped: 0 })

    const segunda = await importIntoCart(carrito, { storeId: STORE, storeSlug: 'tienda' }, lista)
    expect(segunda).toEqual({ added: 0, updated: 0, unchanged: 2, skipped: 0 })

    expect(carrito.cart.lines.map((l) => [l.product_id, l.variant_id, l.quantity])).toEqual([
      [JABON, null, 3],
      [CAMISETA, ROJA, 2],
    ])
  })

  it('una lista corregida FIJA la nueva cantidad sobre lo que ya había, sin sumar', async () => {
    const carrito = carritoFalso()
    await carrito.add(producto(JABON, 'Jabon'), 7)

    const r = await importIntoCart(carrito, { storeId: STORE, storeSlug: 'tienda' }, [aceptada(2, JABON, 2)])
    expect(r).toEqual({ added: 0, updated: 1, unchanged: 0, skipped: 0 })
    expect(carrito.cart.lines[0]?.quantity).toBe(2)
  })

  it('lo que el carrito no admite se cuenta como omitido y no se inventa', async () => {
    const carrito = carritoFalso()
    const r = await importIntoCart(carrito, { storeId: STORE, storeSlug: 'tienda' }, [
      aceptada(2, JABON, 1),
      aceptada(3, AGOTADO, 1),
    ])
    expect(r).toEqual({ added: 1, updated: 0, unchanged: 0, skipped: 1 })
    expect(carrito.cart.lines.map((l) => l.product_id)).toEqual([JABON])
  })

  it('subir la cantidad de algo que ya no tiene existencia no lo fija', async () => {
    const carrito = carritoFalso()
    productos.sinStock = new Set()
    await carrito.add(producto(AGOTADO, 'Agotado'), 1)
    productos.sinStock = new Set([AGOTADO])

    const r = await importIntoCart(carrito, { storeId: STORE, storeSlug: 'tienda' }, [aceptada(2, AGOTADO, 5)])
    expect(r).toEqual({ added: 0, updated: 0, unchanged: 0, skipped: 1 })
    expect(carrito.cart.lines[0]?.quantity).toBe(1)
    expect(carrito.setQuantity).not.toHaveBeenCalled()
  })
})
