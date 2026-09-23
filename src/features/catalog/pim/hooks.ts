import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addBundleItem,
  addRelation,
  deleteRelation,
  deleteRow,
  fetchAttributeValues,
  fetchAttributes,
  fetchBrands,
  fetchBundleItems,
  fetchFamilies,
  fetchProductAttributes,
  fetchProductUoms,
  fetchRelations,
  fetchUnits,
  fetchVariantAxes,
  fetchVariants,
  reorderRelations,
  saveAttribute,
  saveAttributeValue,
  saveBrand,
  saveFamily,
  saveProductAttribute,
  saveProductUom,
  saveUnit,
  saveVariant,
  setVariantAxes,
} from './api'
import { signedBrandLogoUrls, uploadBrandLogo } from '../api/brandLogos'
import { CATALOG_KEY } from '../useProducts'
import type {
  Attribute,
  AttributeValue,
  Brand,
  BundleItem,
  ProductAttributeValue,
  ProductFamily,
  ProductRelation,
  ProductUom,
  ProductVariant,
  UnitOfMeasure,
  VariantAttributeValue,
} from './types'

/**
 * Estado del PIM en el cliente.
 *
 * Todas las claves cuelgan de `CATALOG_KEY`, así que una escritura en cualquier
 * parte del PIM invalida también el listado de productos y los KPI del panel:
 * publicar una variante cambia lo que la vitrina enseña, y una pantalla que
 * siga mostrando el estado anterior es un error que el usuario interpreta como
 * "no se guardó".
 */

export const PIM_KEY = [...CATALOG_KEY, 'pim'] as const

export const brandsKey = () => [...PIM_KEY, 'brands'] as const
export const brandLogosKey = (refs: readonly string[]) =>
  [...PIM_KEY, 'brand-logos', refs] as const
export const familiesKey = () => [...PIM_KEY, 'families'] as const
export const unitsKey = () => [...PIM_KEY, 'units'] as const
export const attributesKey = () => [...PIM_KEY, 'attributes'] as const
export const attributeValuesKey = () => [...PIM_KEY, 'attribute-values'] as const
export const variantsKey = (productId: string | null) => [...PIM_KEY, 'variants', productId] as const
export const variantAxesKey = (productId: string | null) =>
  [...PIM_KEY, 'variant-axes', productId] as const
export const productUomsKey = (productId: string | null) => [...PIM_KEY, 'uoms', productId] as const
export const productAttributesKey = (productId: string | null) =>
  [...PIM_KEY, 'product-attributes', productId] as const
export const bundleItemsKey = (productId: string | null) =>
  [...PIM_KEY, 'bundle-items', productId] as const
export const relationsKey = (productId: string | null) =>
  [...PIM_KEY, 'relations', productId] as const

function useInvalidatePim() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    void queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  }
}

// --- Vocabulario de la sociedad --------------------------------------------

export function useBrands(enabled = true) {
  return useQuery<Brand[]>({ queryKey: brandsKey(), queryFn: fetchBrands, enabled })
}

/**
 * Las URL para VER los logos de las marcas en el backoffice.
 *
 * UNA petición para todo el lote, nunca una por fila: la tabla de marcas de un
 * catálogo real tiene cuarenta, y cuarenta firmas son cuarenta viajes. Las
 * rutas se deduplican y se ordenan para que la clave de caché no cambie por el
 * orden en que llegaron.
 *
 * Media hora de `staleTime` contra una firma de una hora: así nunca se sirve
 * una URL a punto de caducar desde la caché.
 */
export function useBrandLogoUrls(refs: readonly (string | null)[]): Record<string, string> {
  const lote = [...new Set(refs.filter((ref): ref is string => Boolean(ref)))].sort()

  const { data } = useQuery({
    queryKey: brandLogosKey(lote),
    queryFn: () => signedBrandLogoUrls(lote),
    enabled: lote.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  return data ?? {}
}

/**
 * Sube el logo y devuelve su ruta.
 *
 * No invalida nada: lo que cambia el estado de la pantalla es GUARDAR la marca,
 * y hasta entonces la ruta solo vive en el formulario. Invalidar aquí haría
 * recargar la tabla para enseñar lo de antes.
 */
export function useUploadBrandLogo() {
  return useMutation({ mutationFn: uploadBrandLogo })
}

export function useFamilies(enabled = true) {
  return useQuery<ProductFamily[]>({ queryKey: familiesKey(), queryFn: fetchFamilies, enabled })
}

export function useUnits(enabled = true) {
  return useQuery<UnitOfMeasure[]>({ queryKey: unitsKey(), queryFn: fetchUnits, enabled })
}

export function useAttributes(enabled = true) {
  return useQuery<Attribute[]>({ queryKey: attributesKey(), queryFn: fetchAttributes, enabled })
}

export function useAttributeValues(enabled = true) {
  return useQuery<AttributeValue[]>({
    queryKey: attributeValuesKey(),
    queryFn: fetchAttributeValues,
    enabled,
  })
}

export function useSaveBrand() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: saveBrand, onSuccess: invalidate })
}

export function useSaveFamily() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: saveFamily, onSuccess: invalidate })
}

export function useSaveUnit() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: saveUnit, onSuccess: invalidate })
}

export function useSaveAttribute() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: saveAttribute, onSuccess: invalidate })
}

export function useSaveAttributeValue() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: saveAttributeValue, onSuccess: invalidate })
}

export function useDeleteRow() {
  const invalidate = useInvalidatePim()
  return useMutation({
    mutationFn: (input: { table: string; id: string }) => deleteRow(input.table, input.id),
    onSuccess: invalidate,
  })
}

// --- Lo que cuelga del producto --------------------------------------------

export function useVariants(productId: string | null) {
  return useQuery<ProductVariant[]>({
    queryKey: variantsKey(productId),
    queryFn: () => fetchVariants(productId),
    enabled: Boolean(productId),
  })
}

export function useVariantAxes(productId: string | null) {
  return useQuery<VariantAttributeValue[]>({
    queryKey: variantAxesKey(productId),
    queryFn: () => fetchVariantAxes(productId),
    enabled: Boolean(productId),
  })
}

export function useProductUoms(productId: string | null) {
  return useQuery<ProductUom[]>({
    queryKey: productUomsKey(productId),
    queryFn: () => fetchProductUoms(productId),
    enabled: Boolean(productId),
  })
}

export function useProductAttributes(productId: string | null) {
  return useQuery<ProductAttributeValue[]>({
    queryKey: productAttributesKey(productId),
    queryFn: () => fetchProductAttributes(productId),
    enabled: Boolean(productId),
  })
}

export function useBundleItems(productId: string | null) {
  return useQuery<BundleItem[]>({
    queryKey: bundleItemsKey(productId),
    queryFn: () => fetchBundleItems(productId),
    enabled: Boolean(productId),
  })
}

export function useRelations(productId: string | null) {
  return useQuery<ProductRelation[]>({
    queryKey: relationsKey(productId),
    queryFn: () => fetchRelations(productId),
    enabled: Boolean(productId),
  })
}

export function useSaveVariant() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: saveVariant, onSuccess: invalidate })
}

export function useSetVariantAxes() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: setVariantAxes, onSuccess: invalidate })
}

export function useSaveProductUom() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: saveProductUom, onSuccess: invalidate })
}

export function useSaveProductAttribute() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: saveProductAttribute, onSuccess: invalidate })
}

export function useAddBundleItem() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: addBundleItem, onSuccess: invalidate })
}

export function useAddRelation() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: addRelation, onSuccess: invalidate })
}

// Cierre · quitar y reordenar. Se invalida también al FALLAR el reordenado:
// una parte pudo quedar escrita y la lista tiene que volver a decir la verdad.
export function useDeleteRelation() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: deleteRelation, onSuccess: invalidate })
}

export function useReorderRelations() {
  const invalidate = useInvalidatePim()
  return useMutation({ mutationFn: reorderRelations, onSettled: invalidate })
}
