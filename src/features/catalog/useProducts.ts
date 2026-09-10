import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteProduct,
  fetchProductUsage,
  fetchProducts,
  saveProduct,
  setProductStatus,
  type ProductPage,
  type ProductQuery,
} from './api/products'
import type { ProductFormValues, ProductStatus, ProductUsage } from './types'

export const CATALOG_KEY = ['catalog'] as const

/**
 * La clave lleva la consulta ENTERA.
 *
 * Antes eran cuatro trozos sueltos y cada filtro nuevo obligaba a acordarse de
 * añadirlo aquí; olvidarse no rompe nada visible, simplemente devuelve la
 * página anterior en caché y el filtro parece que no funciona. Con el objeto
 * completo, un filtro nuevo entra en la clave el día que nace.
 */
export const productsKey = (query: ProductQuery) =>
  [
    ...CATALOG_KEY,
    'products',
    query.storeId,
    query.status,
    query.search,
    query.page,
    query.sort ?? null,
    query.categoryIds ?? null,
    query.brandId ?? null,
    query.minStock ?? null,
  ] as const

export const productUsageKey = (productId: string | null) =>
  [...CATALOG_KEY, 'product-usage', productId] as const

export function useProducts(query: ProductQuery) {
  return useQuery<ProductPage>({
    queryKey: productsKey(query),
    queryFn: () => fetchProducts(query),
    enabled: Boolean(query.storeId),
    // Mantener la tabla anterior mientras se teclea —o mientras se pasa de
    // página— evita el parpadeo a esqueleto en cada letra del buscador.
    placeholderData: (previous) => previous,
  })
}

/** Uso real del producto, para el diálogo de eliminación segura (contrato §4.2). */
export function useProductUsage(productId: string | null) {
  return useQuery<ProductUsage>({
    queryKey: productUsageKey(productId),
    queryFn: () => fetchProductUsage(productId as string),
    enabled: Boolean(productId),
    retry: false,
    gcTime: 0,
  })
}

/** Invalida TODO el catálogo: el panel de inicio también cuenta productos. */
function useInvalidateCatalog() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    void queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  }
}

export function useSaveProduct() {
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: (input: { productId?: string | null; storeId: string; values: ProductFormValues }) =>
      saveProduct(input),
    onSuccess: invalidate,
  })
}

export function useSetProductStatus() {
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: (input: { productId: string; status: ProductStatus }) => setProductStatus(input),
    onSuccess: invalidate,
  })
}

export function useDeleteProduct() {
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: (productId: string) => deleteProduct(productId),
    onSuccess: invalidate,
  })
}
