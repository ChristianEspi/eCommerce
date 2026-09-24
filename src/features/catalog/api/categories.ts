import {
  CATEGORIES_TABLE,
  categorySchema,
  categoryUsageSchema,
  type Category,
  type CategoryFormValues,
  type CategoryUsage,
} from '../types'
import { catalogClient } from './client'
import { catalogErrorFromDb } from './errors'

import { CATEGORY_USAGE_RPC } from '@/shared/lib/db-schema'

export { CATEGORY_USAGE_RPC }

const CATEGORY_SELECT = 'id, store_id, parent_id, slug, name, position, is_active'
/**
 * Storefront V2 · P03 · Las dos columnas de la foto, aparte.
 *
 * PostgREST no ignora una columna que no existe: responde 400 con `42703` y la
 * consulta ENTERA se cae. Con las dos dentro de la lista base, una tienda cuya
 * base todavía no tiene la migración se quedaría sin pantalla de categorías —
 * no sin fotos, sin pantalla—. Así se piden aparte y hay a dónde caer.
 */
const CATEGORY_SELECT_CON_FOTO = `${CATEGORY_SELECT}, image_url, image_alt`

/** `undefined_column`: la columna pedida no existe todavía en esta base. */
const COLUMNA_INEXISTENTE = '42703'

/**
 * ¿Tiene esta base las columnas de la foto? `null` mientras no se sabe.
 *
 * Es estado de DESPLIEGUE, no de aplicación: describe qué versión del esquema
 * hay enfrente y deja de importar en cuanto la migración se aplica. Se recuerda
 * para lo que queda de sesión porque no tiene sentido volver a pagar una
 * consulta que ya se sabe que falla.
 */
let fotoEnLaBase: boolean | null = null

/** Para la pantalla: no ofrecer subir una foto que no se va a poder guardar. */
export function categoryMediaReady(): boolean {
  return fotoEnLaBase !== false
}

/** Para las pruebas: cada una parte sin saber nada de la base. */
export function resetCategoryMediaProbe(): void {
  fotoEnLaBase = null
}

/**
 * Categorías de la tienda activa. Sin filtro de tenant en la consulta: lo pone
 * la RLS (`categories_select_member`) con los claims del JWT.
 */
export async function fetchCategories(storeId: string | null): Promise<Category[]> {
  if (!storeId) return []
  const supabase = catalogClient()

  const leer = (select: string) =>
    supabase
      .from(CATEGORIES_TABLE)
      .select(select)
      .eq('store_id', storeId)
      .order('position')
      .order('name')

  let { data, error } = await leer(
    fotoEnLaBase === false ? CATEGORY_SELECT : CATEGORY_SELECT_CON_FOTO,
  )

  // La base va por detrás del código: se relee sin las columnas de la foto y la
  // pantalla de categorías sigue sirviendo para todo lo demás.
  if (error && fotoEnLaBase !== false && error.code === COLUMNA_INEXISTENTE) {
    fotoEnLaBase = false
    ;({ data, error } = await leer(CATEGORY_SELECT))
  }

  if (error) throw catalogErrorFromDb(error)
  if (data && fotoEnLaBase === null) fotoEnLaBase = true
  return categorySchema.array().parse(data ?? [])
}

/**
 * Alta y edición de categoría van directas a la tabla bajo RLS: hay policies
 * de insert/update/delete para `owner/admin/catalog` desde P02 y no hace falta
 * un borde propio para tres columnas.
 *
 * `organization_id`/`company_id` se escriben con los valores que el
 * `TenantProvider` derivó del JWT, y la policy `categories_insert_catalog`
 * vuelve a comprobarlos con `ebim.has_role`: un valor manipulado en el
 * navegador no pasa del `with check`.
 */
/**
 * Las dos columnas de la foto, si esta base las tiene.
 *
 * La condición NO es de permisos: es de esquema. Enviarlas a una base que aún
 * no las tiene devuelve 400 y se pierde también el nombre que la persona
 * acababa de escribir. El campo de la foto está apagado en ese caso, así que
 * aquí no hay nada que guardar.
 *
 * El alt vacío se guarda como NULL y no como cadena vacía: el CHECK exige 1..160
 * si viene, y «sin alt» y «alt en blanco» son la misma cosa dicha de dos formas.
 */
function campoDeFoto(values: CategoryFormValues) {
  if (fotoEnLaBase === false) return {}
  return {
    image_url: values.image_url,
    image_alt: values.image_alt.trim() === '' ? null : values.image_alt.trim(),
  }
}

export async function saveCategory(input: {
  categoryId?: string | null
  organizationId: string
  companyId: string
  storeId: string
  values: CategoryFormValues
}): Promise<{ id: string }> {
  const supabase = catalogClient()
  const { values } = input

  if (input.categoryId) {
    const { data, error } = await supabase
      .from(CATEGORIES_TABLE)
      // `parent_id` viaja como cadena vacia desde el formulario: en la base es
      // NULL, que es lo que significa «raiz».
      .update({
        name: values.name,
        slug: values.slug,
        is_active: values.is_active,
        parent_id: values.parent_id || null,
        ...campoDeFoto(values),
      })
      .eq('id', input.categoryId)
      .select('id')
      .single()
    if (error) throw catalogErrorFromDb(error)
    return { id: (data as { id: string }).id }
  }

  const { data, error } = await supabase
    .from(CATEGORIES_TABLE)
    .insert({
      organization_id: input.organizationId,
      company_id: input.companyId,
      store_id: input.storeId,
      name: values.name,
      slug: values.slug,
      is_active: values.is_active,
      parent_id: values.parent_id || null,
      ...campoDeFoto(values),
    })
    .select('id')
    .single()

  if (error) throw catalogErrorFromDb(error)
  return { id: (data as { id: string }).id }
}

/** Desactivar conserva los datos: es la mitad "segura" del estándar §4.2. */
export async function setCategoryActive(input: {
  categoryId: string
  isActive: boolean
}): Promise<void> {
  const supabase = catalogClient()
  const { error } = await supabase
    .from(CATEGORIES_TABLE)
    .update({ is_active: input.isActive })
    .eq('id', input.categoryId)
  if (error) throw catalogErrorFromDb(error)
}

export async function fetchCategoryUsage(categoryId: string): Promise<CategoryUsage> {
  const supabase = catalogClient()
  const { data, error } = await supabase.rpc(CATEGORY_USAGE_RPC, { p_category_id: categoryId })
  if (error) throw catalogErrorFromDb(error)
  return categoryUsageSchema.parse(data)
}

/**
 * Borrado definitivo. Los productos que la usaban NO se van con ella: el FK es
 * `on delete set null`, así que quedan sin categoría en vez de desaparecer del
 * catálogo. Por eso el diálogo enseña cuántos son antes de confirmar.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  const supabase = catalogClient()
  const { error } = await supabase.from(CATEGORIES_TABLE).delete().eq('id', categoryId)
  if (error) throw catalogErrorFromDb(error)
}
