import { describe, expect, it } from 'vitest'
import { sanitizeSearchTerm } from './api/client'
import { CatalogError, catalogErrorFromDb, mapCatalogCode } from './api/errors'
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  buildImagePath,
  moveImage,
  validateImageFile,
} from './api/images'
import { escapeCsvField, productsToCsv } from './exportCsv'
import {
  categoryFormSchema,
  moneyText,
  productFormSchema,
  productSchema,
  productToForm,
  type ProductImage,
  type ProductMaster,
} from './types'

const ORG = '11111111-1111-4111-8111-111111111111'
const STORE = '55555555-5555-4555-8555-555555555555'
const PRODUCT = '66666666-6666-4666-8666-666666666666'

const image = (id: string): ProductImage => ({
  id,
  product_id: PRODUCT,
  store_id: STORE,
  storage_path: `${ORG}/${STORE}/${PRODUCT}/${id}.jpg`,
  alt: null,
  position: 0,
  is_primary: false,
})

describe('dinero del catalogo', () => {
  it('un numeric que llega como texto se conserva tal cual', () => {
    expect(moneyText.parse('199.90')).toBe('199.90')
  })

  it('si llegara como numero se normaliza a dos decimales, no a float suelto', () => {
    expect(moneyText.parse(199.9)).toBe('199.90')
    expect(moneyText.parse(0)).toBe('0.00')
  })

  it('la fila del producto no guarda el precio como number', () => {
    const parsed = productSchema.parse({
      id: PRODUCT,
      organization_id: ORG,
      company_id: ORG,
      store_id: STORE,
      category_id: null,
      sku: 'A-1',
      name: 'Silla',
      slug: 'silla',
      description: null,
      status: 'draft',
      price: '199.90',
      compare_at_price: null,
      currency: 'PEN',
      stock: 4,
      published_at: null,
      updated_at: '2026-08-27T00:00:00.000Z',
    })
    expect(typeof parsed.price).toBe('string')
    expect(parsed.price).toBe('199.90')
  })
})

describe('validacion del formulario de producto', () => {
  // Alta con publicación inicial: slug y precio se validan porque `publish`
  // está marcado.
  const valid = {
    name: 'Silla ergonomica',
    slug: 'silla-ergonomica',
    sku: 'SIL-001',
    description: '',
    category_id: '',
    price: '199.90',
    stock: '12',
    status: 'draft' as const,
    kind: 'simple' as const,
    brand_id: '',
    family_id: '',
    // Vacio = la categoria fiscal por defecto de la sociedad.
    tax_category_id: '',
    publish: true,
  }

  it('sin publicación inicial, slug y precio no se exigen: son de cada tienda', () => {
    expect(productFormSchema.safeParse({ ...valid, publish: false, slug: '', price: '' }).success).toBe(true)
  })

  it('acepta un producto bien formado', () => {
    expect(productFormSchema.safeParse(valid).success).toBe(true)
  })

  it('rechaza un precio con mas de dos decimales', () => {
    const result = productFormSchema.safeParse({ ...valid, price: '19.999' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('catalog.error.price')
  })

  it('rechaza un precio con coma decimal o con moneda pegada', () => {
    for (const price of ['19,90', 'S/ 19.90', '', '-5.00']) {
      expect(productFormSchema.safeParse({ ...valid, price }).success).toBe(false)
    }
  })

  it('rechaza un stock negativo o decimal', () => {
    for (const stock of ['-1', '1.5', 'muchos']) {
      const result = productFormSchema.safeParse({ ...valid, stock })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('catalog.error.stock')
    }
  })

  it('exige el mismo formato de slug que la Edge Function (3-62, minusculas)', () => {
    expect(productFormSchema.safeParse({ ...valid, slug: 'ab' }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...valid, slug: 'Silla Roja' }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...valid, slug: '-silla' }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...valid, slug: 'silla-2' }).success).toBe(true)
  })

  it('exige SKU y nombre', () => {
    expect(productFormSchema.safeParse({ ...valid, sku: '   ' }).success).toBe(false)
    expect(productFormSchema.safeParse({ ...valid, name: 'A' }).success).toBe(false)
  })

  it('los mensajes de error son claves de i18n, no texto en un idioma', () => {
    const result = productFormSchema.safeParse({ ...valid, name: '' })
    expect(result.error?.issues[0]?.message).toMatch(/^catalog\.error\./)
  })

  it('el formulario de alta arranca en borrador, con stock cero y publicando en la tienda activa', () => {
    expect(productToForm(null)).toMatchObject({ status: 'draft', stock: '0', price: '', publish: true })
  })

  it('la categoria es opcional: la cadena vacia es valida', () => {
    expect(productFormSchema.safeParse({ ...valid, category_id: '' }).success).toBe(true)
  })
})

describe('validacion del formulario de categoria', () => {
  it('acepta nombre y slug validos', () => {
    expect(
      categoryFormSchema.safeParse({ name: 'Sillas', slug: 'sillas', is_active: true }).success,
    ).toBe(true)
  })

  it('normaliza el slug a minusculas en vez de rechazarlo por la caja', () => {
    const result = categoryFormSchema.safeParse({
      name: 'Sillas',
      slug: 'Sillas',
      is_active: true,
    })
    expect(result.success).toBe(true)
    expect(result.data?.slug).toBe('sillas')
  })

  it('pero un slug con espacios o acentos sigue siendo invalido', () => {
    for (const slug of ['Sillas de oficina', 'sillas!', 'ab']) {
      expect(categoryFormSchema.safeParse({ name: 'Sillas', slug, is_active: true }).success).toBe(
        false,
      )
    }
  })
})

describe('imagenes: validacion y ruta', () => {
  it('acepta los formatos declarados', () => {
    for (const type of Object.keys(ALLOWED_IMAGE_TYPES)) {
      expect(validateImageFile({ type, size: 1024 })).toEqual({ ok: true })
    }
  })

  it('rechaza un tipo que no es imagen aunque el nombre lo parezca', () => {
    expect(validateImageFile({ type: 'text/html', size: 10 })).toEqual({
      ok: false,
      key: 'catalog.images.error.type',
    })
    expect(validateImageFile({ type: 'image/svg+xml', size: 10 }).ok).toBe(false)
  })

  it('rechaza por tamano y por archivo vacio', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toEqual({
      ok: false,
      key: 'catalog.images.error.size',
    })
    expect(validateImageFile({ type: 'image/png', size: 0 })).toEqual({
      ok: false,
      key: 'catalog.images.error.empty',
    })
  })

  it('la ruta empieza por {organization_id}/{store_id}/{product_id}/', () => {
    const path = buildImagePath({
      organizationId: ORG,
      storeId: STORE,
      productId: PRODUCT,
      mimeType: 'image/webp',
    })
    expect(path.startsWith(`${ORG}/${STORE}/${PRODUCT}/`)).toBe(true)
    expect(path.endsWith('.webp')).toBe(true)
  })

  it('la extension sale del MIME, no del nombre que traiga el archivo', () => {
    expect(
      buildImagePath({
        organizationId: ORG,
        storeId: STORE,
        productId: PRODUCT,
        mimeType: 'image/jpeg',
      }).endsWith('.jpg'),
    ).toBe(true)
  })

  it('dos subidas seguidas no comparten nombre', () => {
    const input = {
      organizationId: ORG,
      storeId: STORE,
      productId: PRODUCT,
      mimeType: 'image/png',
    }
    expect(buildImagePath(input)).not.toBe(buildImagePath(input))
  })

  it('un MIME no admitido no llega a construir ruta', () => {
    expect(() =>
      buildImagePath({
        organizationId: ORG,
        storeId: STORE,
        productId: PRODUCT,
        mimeType: 'application/pdf',
      }),
    ).toThrow(CatalogError)
  })
})

describe('reordenar imagenes', () => {
  const list = [image('a'), image('b'), image('c')]

  it('sube una posicion', () => {
    expect(moveImage(list, 'c', -1)).toEqual(['a', 'c', 'b'])
  })

  it('baja una posicion', () => {
    expect(moveImage(list, 'a', 1)).toEqual(['b', 'a', 'c'])
  })

  it('en los extremos devuelve el mismo orden en vez de perder elementos', () => {
    expect(moveImage(list, 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveImage(list, 'c', 1)).toEqual(['a', 'b', 'c'])
  })

  it('siempre devuelve la lista completa: la funcion de la base la exige entera', () => {
    expect(moveImage(list, 'b', 1)).toHaveLength(list.length)
  })
})

describe('buscador', () => {
  it('quita los separadores que cambiarian la sintaxis del filtro `or`', () => {
    expect(sanitizeSearchTerm('silla,sku.eq.X')).toBe('silla sku.eq.X')
    expect(sanitizeSearchTerm('a(b)c')).toBe('a b c')
  })

  it('quita los comodines que el usuario no pidio', () => {
    expect(sanitizeSearchTerm('%si_lla%')).toBe('si lla')
  })

  it('recorta y no se va de largo', () => {
    expect(sanitizeSearchTerm('   silla   roja   ')).toBe('silla roja')
    expect(sanitizeSearchTerm('x'.repeat(200))).toHaveLength(80)
  })
})

describe('traduccion de errores', () => {
  it('un duplicado de SKU se explica como duplicado', () => {
    expect(mapCatalogCode('23505')).toBe('catalog.error.duplicate')
    expect(mapCatalogCode('DUPLICADO')).toBe('catalog.error.duplicate')
  })

  it('una violacion de RLS se explica como falta de permiso, no como error interno', () => {
    expect(mapCatalogCode('42501')).toBe('catalog.error.forbidden')
    expect(catalogErrorFromDb({ code: '42501', message: 'new row violates row-level security' }).key)
      .toBe('catalog.error.forbidden')
  })

  it('un codigo de negocio de la base se lee del mensaje', () => {
    expect(catalogErrorFromDb({ message: 'SIN_PERMISO: Tu rol no puede...' }).key).toBe(
      'catalog.error.forbidden',
    )
    expect(catalogErrorFromDb({ message: 'PRODUCTO_NO_ENCONTRADO: no existe' }).key).toBe(
      'catalog.error.notFound',
    )
  })

  it('lo desconocido cae en el generico y NO filtra el mensaje de Postgres', () => {
    const error = catalogErrorFromDb({ message: 'relation "secreto" does not exist', code: '42P01' })
    expect(error.key).toBe('catalog.error.generic')
    expect(error.message).not.toMatch(/relation/)
  })
})

describe('exportar a CSV', () => {
  const product = (over: Partial<ProductMaster>): ProductMaster => ({
    id: PRODUCT,
    organization_id: ORG,
    company_id: ORG,
    origin_store_id: STORE,
    sku: 'A-1',
    name: 'Silla',
    description: null,
    stock: 4,
    updated_at: '2026-08-27T00:00:00.000Z',
    kind: 'simple',
    brand_id: null,
    brand_name: null,
    family_id: null,
    family_name: null,
    tax_category_id: null,
    legacy_sku_conflict: false,
    publication_count: 0,
    published_count: 0,
    store_ids: [],
    published_store_names: [],
    category_ids: [],
    publication_state: 'draft',
    ...over,
  })

  it('neutraliza las celdas que Excel interpretaria como formula', () => {
    expect(escapeCsvField('=1+1')).toBe(`"'=1+1"`)
    expect(escapeCsvField('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(escapeCsvField('Silla')).toBe('"Silla"')
  })

  it('escapa las comillas duplicandolas', () => {
    expect(escapeCsvField('Silla "premium"')).toBe('"Silla ""premium"""')
  })

  it('exporta maestros con sus tiendas y SIN un precio global', () => {
    const csv = productsToCsv([
      product({ published_count: 2, published_store_names: ['Tienda A1', 'Tienda A2'], publication_state: 'published' }),
    ])
    const [header, row] = csv.split('\r\n')
    expect(header).toBe('sku,name,kind,brand,family,stock,published_stores,stores,state')
    expect(header).not.toContain('price')
    expect(row).toContain('"Tienda A1 | Tienda A2"')
    expect(row).toContain('"published"')
  })

  it('un producto sin marca deja la celda vacia, no un "null"', () => {
    const csv = productsToCsv([product({})])
    expect(csv.split('\r\n')[1]).toContain('"simple","","",')
  })
})
