import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteCategory,
  fetchCategories,
  fetchCategoryUsage,
  saveCategory,
  setCategoryActive,
} from './api/categories'
import { signedCategoryImageUrls, uploadCategoryImage } from './api/categoryMedia'
import type { Category, CategoryFormValues, CategoryUsage } from './types'
import { CATALOG_KEY } from './useProducts'

export const categoriesKey = (storeId: string | null) =>
  [...CATALOG_KEY, 'categories', storeId] as const

export const categoryUsageKey = (categoryId: string | null) =>
  [...CATALOG_KEY, 'category-usage', categoryId] as const

export function useCategories(storeId: string | null) {
  return useQuery<Category[]>({
    queryKey: categoriesKey(storeId),
    queryFn: () => fetchCategories(storeId),
    enabled: Boolean(storeId),
    staleTime: 30_000,
  })
}

/**
 * Las URL para VER las fotos de las categorías en el backoffice.
 *
 * UN lote, nunca una por fila: el árbol de una tienda real tiene treinta
 * categorías. Las rutas se deduplican y se ordenan para que la clave de caché
 * no cambie por el orden en que llegaron, y media hora de `staleTime` contra
 * una firma de una hora evita servir desde caché una URL a punto de caducar.
 */
export function useCategoryImageUrls(refs: readonly (string | null)[]): Record<string, string> {
  const lote = [...new Set(refs.filter((ref): ref is string => Boolean(ref)))].sort()

  const { data } = useQuery({
    queryKey: [...CATALOG_KEY, 'category-images', lote] as const,
    queryFn: () => signedCategoryImageUrls(lote),
    enabled: lote.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  return data ?? {}
}

/**
 * Sube la foto y devuelve su ruta.
 *
 * No invalida nada: lo que cambia el estado de la pantalla es GUARDAR la
 * categoría, y hasta entonces la ruta solo vive en el formulario.
 */
export function useUploadCategoryImage() {
  return useMutation({ mutationFn: uploadCategoryImage })
}

export function useCategoryUsage(categoryId: string | null) {
  return useQuery<CategoryUsage>({
    queryKey: categoryUsageKey(categoryId),
    queryFn: () => fetchCategoryUsage(categoryId as string),
    enabled: Boolean(categoryId),
    retry: false,
    gcTime: 0,
  })
}

function useInvalidateCategories() {
  const queryClient = useQueryClient()
  // Los productos muestran el nombre de su categoría: si cambia, la tabla de
  // productos también está desactualizada.
  return () => void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
}

export function useSaveCategory() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: (input: {
      categoryId?: string | null
      organizationId: string
      companyId: string
      storeId: string
      values: CategoryFormValues
    }) => saveCategory(input),
    onSuccess: invalidate,
  })
}

export function useSetCategoryActive() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: (input: { categoryId: string; isActive: boolean }) => setCategoryActive(input),
    onSuccess: invalidate,
  })
}

export function useDeleteCategory() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: (categoryId: string) => deleteCategory(categoryId),
    onSuccess: invalidate,
  })
}
