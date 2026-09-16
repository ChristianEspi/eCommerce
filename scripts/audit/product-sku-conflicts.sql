-- =============================================================================
-- Auditoría de SKU legacy antes de convertir `products` en maestro de empresa.
--
-- SOLO LECTURA. Portable: DEV, QAS o PRD, con cualquier rol que lea las tablas
-- (en el panel de Supabase, SQL Editor). No escribe ni fusiona nada.
--
-- Hoy el SKU es único POR TIENDA (`products_sku_key (store_id, lower(sku))`) y
-- además comparte espacio de nombres con las variantes de la misma tienda
-- (`ebim.assert_sku_unique_in_store`). El maestro de empresa necesita que sea
-- único POR EMPRESA. Esta consulta dice, antes de migrar, qué filas lo impiden.
--
-- Cada fila del resultado es un SKU normalizado (`lower(btrim(sku))`) que
-- aparece más de una vez dentro de la misma organización + empresa, con:
--   · cuántas filas y en cuántas tiendas;
--   · si difieren nombre, tipo, marca o familia (duplicado «divergente»);
--   · los ids de producto/variante afectados, para decidir a mano.
--
-- La migración NO fusiona por esta lista: la usa solo para marcar
-- `products.legacy_sku_conflict` y dejar la unicidad por empresa activa para
-- todo lo demás (ver docs/STORES_PRODUCT_MASTER_MIGRATION_PLAN.md §4).
-- =============================================================================
with skus as (
  select p.organization_id, p.company_id, p.store_id, 'product'::text as source,
         p.id as product_id, null::uuid as variant_id,
         lower(btrim(p.sku)) as sku_norm, p.sku, p.name, p.kind::text as kind,
         p.brand_id, p.family_id
  from public.products p
  union all
  select v.organization_id, v.company_id, v.store_id, 'variant',
         v.product_id, v.id,
         lower(btrim(v.sku)), v.sku, v.name, null, null, null
  from public.product_variants v
)
select s.organization_id,
       s.company_id,
       s.sku_norm,
       count(*)                                              as rows_total,
       count(distinct s.store_id)                            as stores,
       count(*) filter (where s.source = 'product')          as products,
       count(*) filter (where s.source = 'variant')          as variants,
       count(distinct s.name) > 1                            as name_differs,
       count(distinct s.kind) filter (where s.source = 'product') > 1  as kind_differs,
       count(distinct s.brand_id) filter (where s.source = 'product') > 1 as brand_differs,
       count(distinct s.family_id) filter (where s.source = 'product') > 1 as family_differs,
       array_agg(distinct s.store_id)                        as store_ids,
       array_agg(s.product_id order by s.store_id)           as product_ids,
       array_remove(array_agg(s.variant_id order by s.store_id), null) as variant_ids
from skus s
group by s.organization_id, s.company_id, s.sku_norm
having count(*) > 1
order by rows_total desc, s.sku_norm;
