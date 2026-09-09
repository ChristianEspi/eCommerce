/**
 * catalog-product — alta y edición de producto desde el backoffice.
 *
 * NO usa `service_role`. Actúa con el JWT del usuario contra la clave
 * publicable: quien decide si puede escribir es la RLS (`products_*_catalog`),
 * no este archivo. Aquí solo se valida la forma del payload y se traduce el
 * error a algo legible.
 *
 * El tenant se toma del token. `organization_id`/`company_id` en el cuerpo se
 * rechazan con 400, no se ignoran.
 */
import { assertNoTenantInPayload, assertNotSuiteOperator, requireTenantContext } from '../_shared/auth.ts'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { badRequest, fromDatabaseError, notFound } from '../_shared/errors.ts'
import { serveJson } from '../_shared/http.ts'
import {
  optionalText,
  optionalUuid,
  requireEnum,
  requireSlug,
  requireText,
  requireUuid,
  rejectUnknownFields,
} from '../_shared/validation.ts'
import { userClient } from '../_runtime/clients.ts'

const ALLOWED_FIELDS = [
  'action',
  'product_id',
  'store_id',
  'sku',
  'slug',
  'name',
  'description',
  'price',
  'compare_at_price',
  'currency',
  'stock',
  'status',
  'category_id',
  // PIM (P03-SaaS). `kind` decide si el producto se vende solo, por variantes o
  // como kit; la base impide bajarlo a `simple` si ya tiene variantes.
  'kind',
  'brand_id',
  'family_id',
  // La categoria fiscal del producto es el PRIMER escalon de
  // `ebim.effective_tax_rate`: sin ella, todo el catalogo cae en la que la
  // sociedad marco por defecto. Nulo no es «sin impuesto», es «el de siempre».
  'tax_category_id',
] as const

const PRODUCT_STATUS = ['draft', 'published', 'archived'] as const
const PRODUCT_KIND = ['simple', 'variant', 'bundle'] as const

/** El dinero llega como string o número y se normaliza a string decimal: el
 *  float del JavaScript no toca el importe que va a la base (`numeric`). */
function requireMoney(body: Record<string, unknown>, field: string, required: boolean): string | null {
  const value = body[field]
  if (value === undefined || value === null) {
    if (required) throw badRequest('CAMPO_INVALIDO', `\`${field}\` es obligatorio`)
    return null
  }
  const text = typeof value === 'number' ? value.toString() : String(value).trim()
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) {
    throw badRequest(
      'CAMPO_INVALIDO',
      `\`${field}\` debe ser un importe positivo con hasta 2 decimales`,
    )
  }
  return text
}

function requireStock(body: Record<string, unknown>): number {
  const value = body.stock ?? 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
    throw badRequest('CAMPO_INVALIDO', '`stock` debe ser un entero mayor o igual que cero')
  }
  return value
}

const handler = serveJson(
  {
    allowedOrigins: parseAllowedOrigins(Deno.env.get('EBIM_ADMIN_ORIGINS')),
    service: 'catalog-product',
  },
  async ({ request, body, trace }) => {
    const { context } = requireTenantContext(request)
    assertNotSuiteOperator(context.email)
    assertNoTenantInPayload(body)
    rejectUnknownFields(body, ALLOWED_FIELDS)

    const action = requireEnum(body, 'action', ['create', 'update'] as const)
    const client = userClient(request, trace)
    const status = body.status === undefined ? 'draft' : requireEnum(body, 'status', PRODUCT_STATUS)

    if (action === 'create') {
      const storeId = requireUuid(body, 'store_id')

      // La tienda tiene que ser del tenant del token. La RLS ya lo garantiza,
      // pero comprobarlo aquí devuelve 404 en vez de un error de constraint.
      const { data: store, error: storeError } = await client
        .from('stores')
        .select('id, organization_id, company_id, currency')
        .eq('id', storeId)
        .maybeSingle()

      if (storeError) throw fromDatabaseError(storeError)
      if (!store) throw notFound('TIENDA_NO_ENCONTRADA', 'La tienda no existe para este tenant')

      const insert = {
        // Del TOKEN, no del cuerpo (contrato §3).
        organization_id: context.organizationId,
        company_id: context.companyId,
        store_id: storeId,
        sku: requireText(body, 'sku', { min: 1, max: 64 }),
        slug: requireSlug(body, 'slug'),
        name: requireText(body, 'name', { min: 2, max: 240 }),
        description: optionalText(body, 'description', 8000),
        price: requireMoney(body, 'price', true),
        compare_at_price: requireMoney(body, 'compare_at_price', false),
        currency: (optionalText(body, 'currency', 3) ?? store.currency).toUpperCase(),
        stock: requireStock(body),
        status,
        published_at: status === 'published' ? new Date().toISOString() : null,
        category_id: optionalUuid(body, 'category_id'),
        kind: body.kind === undefined ? 'simple' : requireEnum(body, 'kind', PRODUCT_KIND),
        brand_id: optionalUuid(body, 'brand_id'),
        family_id: optionalUuid(body, 'family_id'),
        tax_category_id: optionalUuid(body, 'tax_category_id'),
      }

      const { data, error } = await client
        .from('products')
        .insert(insert)
        .select('id, store_id, sku, slug, name, price, currency, stock, status, published_at, kind')
        .single()

      if (error) throw fromDatabaseError(error)
      return { status: 201, body: { data } }
    }

    const productId = requireUuid(body, 'product_id')
    const { data: current, error: currentError } = await client
      .from('products')
      .select('id, status, published_at')
      .eq('id', productId)
      .maybeSingle()

    if (currentError) throw fromDatabaseError(currentError)
    if (!current) throw notFound('PRODUCTO_NO_ENCONTRADO', 'El producto no existe para este tenant')

    const patch: Record<string, unknown> = {}
    if ('name' in body) patch.name = requireText(body, 'name', { min: 2, max: 240 })
    if ('slug' in body) patch.slug = requireSlug(body, 'slug')
    if ('sku' in body) patch.sku = requireText(body, 'sku', { min: 1, max: 64 })
    if ('description' in body) patch.description = optionalText(body, 'description', 8000)
    if ('price' in body) patch.price = requireMoney(body, 'price', true)
    if ('compare_at_price' in body) patch.compare_at_price = requireMoney(body, 'compare_at_price', false)
    if ('stock' in body) patch.stock = requireStock(body)
    if ('category_id' in body) patch.category_id = optionalUuid(body, 'category_id')
    if ('kind' in body) patch.kind = requireEnum(body, 'kind', PRODUCT_KIND)
    if ('brand_id' in body) patch.brand_id = optionalUuid(body, 'brand_id')
    if ('family_id' in body) patch.family_id = optionalUuid(body, 'family_id')
    if ('tax_category_id' in body) patch.tax_category_id = optionalUuid(body, 'tax_category_id')
    if ('status' in body) {
      patch.status = status
      // `published` sin fecha viola el CHECK de la tabla: se rellena aquí.
      patch.published_at =
        status === 'published' ? (current.published_at ?? new Date().toISOString()) : null
    }

    if (Object.keys(patch).length === 0) {
      throw badRequest('SIN_CAMBIOS', 'No se envio ningun campo modificable')
    }

    const { data, error } = await client
      .from('products')
      .update(patch)
      .eq('id', productId)
      .select('id, store_id, sku, slug, name, price, currency, stock, status, published_at, kind')
      .single()

    if (error) throw fromDatabaseError(error)
    return { status: 200, body: { data } }
  },
)

Deno.serve(handler)
