/**
 * Plantillas de importación del catálogo: qué columnas tiene cada hoja.
 *
 * Es la ÚNICA definición de columnas. De aquí salen la plantilla que se
 * descarga, la lectura del Excel que se sube y la ayuda de la pantalla, así que
 * no pueden desalinearse: una columna que se añade aquí aparece en la plantilla
 * y se entiende al leer.
 *
 * Las cabeceras van en castellano porque son las que el comercio escribe y lee
 * en su hoja; al leer se acepta también la clave técnica (`sku`, `price`…) y la
 * cabecera sin tildes ni mayúsculas. El asterisco marca lo obligatorio al CREAR:
 * al actualizar basta la clave y las columnas que cambian.
 */

export type CellKind = 'text' | 'number' | 'integer' | 'boolean'

export interface ImportColumn {
  /** Clave que viaja al servidor. */
  readonly key: string
  /** Cabecera de la plantilla. */
  readonly header: string
  readonly kind: CellKind
  readonly required: boolean
}

export type SheetId =
  | 'brands'
  | 'families'
  | 'units'
  | 'attributes'
  | 'attribute_values'
  | 'categories'
  | 'products'

export interface SheetSpec {
  readonly id: SheetId
  /** Nombre de la pestaña del Excel. */
  readonly name: string
  readonly columns: readonly ImportColumn[]
  readonly examples: readonly Readonly<Record<string, string | number>>[]
  readonly maxRows: number
  /**
   * Cabeceras sin las que la hoja no se puede leer: la CLAVE de la fila. Cada
   * grupo se cumple con cualquiera de sus columnas.
   */
  readonly requiredHeaders: readonly (readonly string[])[]
}

const text = (key: string, header: string, required = false): ImportColumn => ({ key, header, kind: 'text', required })
const number = (key: string, header: string, required = false): ImportColumn => ({ key, header, kind: 'number', required })
const integer = (key: string, header: string): ImportColumn => ({ key, header, kind: 'integer', required: false })
const flag = (key: string, header: string): ImportColumn => ({ key, header, kind: 'boolean', required: false })

export const BRANDS_SHEET: SheetSpec = {
  id: 'brands',
  name: 'Marcas',
  maxRows: 1000,
  requiredHeaders: [['code']],
  columns: [text('code', 'Código', true), text('name', 'Nombre', true), text('description', 'Descripción'), flag('is_active', 'Activa')],
  examples: [
    { code: 'biel-studio', name: 'Biel Studio', description: 'Línea propia', is_active: 'sí' },
    { code: 'lima-denim', name: 'Lima Denim' },
  ],
}

export const FAMILIES_SHEET: SheetSpec = {
  id: 'families',
  name: 'Familias',
  maxRows: 1000,
  requiredHeaders: [['code']],
  columns: [text('code', 'Código', true), text('name', 'Nombre', true), text('description', 'Descripción'), flag('is_active', 'Activa')],
  examples: [
    { code: 'ropa', name: 'Ropa' },
    { code: 'calzado', name: 'Calzado' },
  ],
}

export const UNITS_SHEET: SheetSpec = {
  id: 'units',
  name: 'Unidades',
  maxRows: 1000,
  requiredHeaders: [['code']],
  columns: [text('code', 'Código', true), text('name', 'Nombre', true), text('symbol', 'Símbolo'), flag('is_active', 'Activa')],
  examples: [
    { code: 'UND', name: 'Unidad', symbol: 'und' },
    { code: 'PAR', name: 'Par', symbol: 'par' },
  ],
}

export const ATTRIBUTES_SHEET: SheetSpec = {
  id: 'attributes',
  name: 'Atributos',
  maxRows: 1000,
  requiredHeaders: [['code']],
  columns: [
    text('code', 'Código', true),
    text('name', 'Nombre', true),
    text('data_type', 'Tipo'),
    text('unit', 'Unidad'),
    flag('is_variant_axis', 'Eje de variante'),
    flag('is_filterable', 'Filtrable'),
    integer('position', 'Posición'),
    flag('is_active', 'Activo'),
  ],
  examples: [
    { code: 'talla', name: 'Talla', data_type: 'opción', is_variant_axis: 'sí', position: 1 },
    { code: 'color', name: 'Color', data_type: 'opción', is_variant_axis: 'sí', position: 2 },
    { code: 'material', name: 'Material', data_type: 'texto', is_variant_axis: 'no', position: 3 },
  ],
}

export const ATTRIBUTE_VALUES_SHEET: SheetSpec = {
  id: 'attribute_values',
  name: 'Valores',
  maxRows: 2000,
  requiredHeaders: [['attribute_code'], ['code', 'label']],
  columns: [
    text('attribute_code', 'Atributo', true),
    text('code', 'Código'),
    text('label', 'Etiqueta', true),
    integer('position', 'Posición'),
    flag('is_active', 'Activo'),
  ],
  examples: [
    { attribute_code: 'talla', label: 'S', position: 1 },
    { attribute_code: 'talla', label: 'M', position: 2 },
    { attribute_code: 'color', code: 'azul-noche', label: 'Azul noche' },
  ],
}

/** Catálogo avanzado: un libro, cinco hojas, en el orden en que se procesan. */
export const VOCABULARY_SHEETS: readonly SheetSpec[] = [
  BRANDS_SHEET,
  FAMILIES_SHEET,
  UNITS_SHEET,
  ATTRIBUTES_SHEET,
  ATTRIBUTE_VALUES_SHEET,
]

export const CATEGORIES_SHEET: SheetSpec = {
  id: 'categories',
  name: 'Categorías',
  maxRows: 1000,
  requiredHeaders: [['slug', 'name']],
  columns: [
    text('slug', 'Slug'),
    text('name', 'Nombre', true),
    text('parent_slug', 'Slug de la madre'),
    integer('position', 'Posición'),
    flag('is_active', 'Activa'),
  ],
  examples: [
    { slug: 'mujer', name: 'Mujer', position: 1 },
    { slug: 'mujer-vestidos', name: 'Vestidos', parent_slug: 'mujer', position: 1 },
    { slug: 'calzado', name: 'Calzado', position: 2 },
  ],
}

export const PRODUCTS_SHEET: SheetSpec = {
  id: 'products',
  name: 'Productos',
  maxRows: 2000,
  requiredHeaders: [['sku']],
  columns: [
    text('sku', 'SKU', true),
    text('name', 'Nombre', true),
    text('slug', 'Slug'),
    text('description', 'Descripción'),
    text('category_slug', 'Categoría'),
    text('brand_code', 'Marca'),
    text('family_code', 'Familia'),
    number('price', 'Precio', true),
    number('compare_at_price', 'Precio anterior'),
    text('status', 'Estado'),
    integer('stock', 'Stock'),
    text('variant_sku', 'SKU de variante'),
    text('variant_name', 'Nombre de variante'),
    number('variant_price', 'Precio de variante'),
    integer('variant_stock', 'Stock de variante'),
  ],
  examples: [
    { sku: 'BIE-GOR-0001', name: 'Gorra Trucker lavada', category_slug: 'accesorios', price: 59.9, status: 'publicado', stock: 25 },
    { sku: 'BIE-VES-0001', name: 'Vestido Dalia midi', category_slug: 'mujer-vestidos', price: 189.9, compare_at_price: 229.9, status: 'publicado', variant_sku: 'BIE-VES-0001-S', variant_stock: 8 },
    { sku: 'BIE-VES-0001', variant_sku: 'BIE-VES-0001-M', variant_stock: 12 },
  ],
}

/** Un eje de variante de la sociedad, que en la hoja de productos es una columna. */
export interface AxisColumn {
  /** `attributes.code`: la clave dentro de `axes`. */
  readonly code: string
  /** Cabecera: el nombre del atributo («Talla»). */
  readonly header: string
  /** Primeros valores, para el ejemplo de la plantilla. */
  readonly sampleValues: readonly string[]
}

/** Cabecera normalizada: sin tildes, sin mayúsculas, sin asterisco ni separadores. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[\s_\-.]+/g, '')
    .trim()
}

/** Cabecera de plantilla: obligatoria con asterisco. */
export function templateHeader(column: ImportColumn): string {
  return column.required ? `${column.header} *` : column.header
}
