import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { PRODUCT_DETAIL_PUBLIC_RPC } from '@/shared/lib/db-schema'
import { StorefrontError, storefrontClient } from './api'

/**
 * La ficha completa (2026-10-13): lo que `public_products` no trae porque
 * `anon` no puede leerlo de las tablas.
 *
 * `product_detail_for_slug` (migración 20261013100000) devuelve, de UN
 * producto publicado en la tienda del slug: SKU, destacados, especificaciones
 * (atributos que no son eje de variante), disponibilidad por tienda física
 * —ESTADO, nunca cantidad— y el resumen de entrega. NULL si no se ve.
 *
 * Cada bloque llega con `catch`: una fila rara deja ESE bloque vacío y la
 * ficha sigue en pie, que es la regla de toda la vitrina.
 */

const specSchema = z.object({
  label: z.string(),
  type: z.string(),
  value: z.string().nullable(),
})
export type ProductSpec = z.infer<typeof specSchema>

const storeStockSchema = z.object({
  name: z.string(),
  city: z.string().nullable(),
  status: z.enum(['available', 'low', 'out']),
})
export type StoreStock = z.infer<typeof storeStockSchema>

const detailSchema = z.object({
  sku: z.string().nullable().catch(null),
  highlights: z.array(z.string()).catch([]),
  specs: z.array(specSchema).catch([]),
  stores: z.array(storeStockSchema).catch([]),
  delivery: z
    .object({
      ship: z
        .object({
          min_days: z.number().nullable(),
          max_days: z.number().nullable(),
          free_over: z.coerce.number().nullable(),
        })
        .nullable()
        .catch(null),
      pickup: z
        .object({ min_days: z.number().nullable(), points: z.number() })
        .nullable()
        .catch(null),
    })
    .catch({ ship: null, pickup: null }),
})
export type ProductDetail = z.infer<typeof detailSchema>

export async function fetchProductDetail(
  storeSlug: string,
  productId: string,
  variantId: string | null,
): Promise<ProductDetail | null> {
  const { data, error } = await storefrontClient().rpc(PRODUCT_DETAIL_PUBLIC_RPC, {
    p_store_slug: storeSlug,
    p_product_id: productId,
    ...(variantId ? { p_variant_id: variantId } : {}),
  })
  if (error) throw new StorefrontError(error)
  if (data === null || data === undefined) return null
  return detailSchema.parse(data)
}

/** El detalle de la ficha; con variante elegida, su SKU y su stock. */
export function useProductDetail(storeSlug: string, productId: string | null, variantId: string | null) {
  return useQuery({
    queryKey: ['storefront', 'product-detail', storeSlug, productId, variantId],
    queryFn: () => fetchProductDetail(storeSlug, productId as string, variantId),
    enabled: Boolean(storeSlug && productId),
    staleTime: 60 * 1000,
    // Al cambiar de variante, el bloque anterior se queda hasta que llega el
    // nuevo: vaciar la ficha a cada clic de color la hace parpadear.
    placeholderData: (previous) => previous,
  })
}

// ---------------------------------------------------------------------------
// Cuotas
// ---------------------------------------------------------------------------

const installmentsSchema = z.object({
  count: z.number().int().min(2).max(36),
  provider: z.string().trim().min(1).max(60).optional(),
  min_amount: z.number().min(0).optional(),
})
export type StoreInstallments = z.infer<typeof installmentsSchema>

/** Lo que la tienda declaró, o `null` si no anuncia cuotas o llegó mal. */
export function readInstallments(raw: unknown): StoreInstallments | null {
  const parsed = installmentsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/**
 * La cuota de un precio, o `null` si no aplica (sin cuotas o por debajo del
 * mínimo). Redondea HACIA ARRIBA al céntimo: anunciar 7.29 cuando el banco
 * cobra 7.30 es prometer una cuota que no existe.
 */
export function installmentFor(
  config: StoreInstallments | null,
  price: number,
): { count: number; amount: number; provider: string | null } | null {
  if (!config || !Number.isFinite(price) || price <= 0) return null
  if (config.min_amount !== undefined && price < config.min_amount) return null
  return {
    count: config.count,
    // En céntimos enteros: 21.90 / 3 en coma flotante da 7.3000…01 y subiría a 7.31.
    amount: Math.ceil(Math.round(price * 100) / config.count) / 100,
    provider: config.provider ?? null,
  }
}
