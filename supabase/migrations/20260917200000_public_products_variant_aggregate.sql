-- =============================================================================
-- public_products: el resumen de variantes se agrega UNA vez, no por fila
--
-- Síntoma en QAS tras aplicar Stores + Product Master: `catalog_search_for_slug`
-- tardaba ~18 s y moría con 57014 (statement_timeout de `anon`, 3 s).
--
-- Causa: el resumen de variantes de la vista (`variant_count`, `any_available`,
-- `min_price`) era un `left join lateral` que unía `ebim.public_unit_prices`
-- correlacionado por tienda y variante. Esa vista resuelve TODAS las listas de
-- precios con `distinct on`, y dentro de un lateral Postgres la vuelve a
-- evaluar por cada producto: 192 productos de Biel = 192 evaluaciones completas.
-- `price_from` pasó de 17 s a 0,4 s con el cambio de abajo (medido en QAS).
--
-- Arreglo: el mismo cálculo como subconsulta agrupada por (tienda, producto)
-- y unida por igualdad, que el planificador resuelve con una sola pasada y
-- empuja el filtro de tienda. Mismas columnas, mismo orden, mismos tipos y
-- mismo significado; `create or replace` conserva los permisos.
-- =============================================================================

create or replace view public.public_products
with (security_invoker = on) as
select
  p.id            as product_id,
  sp.store_id,
  sp.category_id,
  sp.slug,
  p.name,
  p.description,
  coalesce(up.unit_price, sp.price) as price,
  case when up.unit_price is null then sp.compare_at_price else up.compare_at_price end
                  as compare_at_price,
  sp.currency,
  sp.published_at,
  p.custom_fields,
  p.kind,
  b.name          as brand_name,
  case p.kind
    when 'variant' then coalesce(v.any_available, false)
    when 'bundle'  then ebim.store_bundle_is_available(sp.store_id, p.id)
    else ebim.store_product_is_available(sp.store_id, p.id, null, 1)
  end             as in_stock,
  coalesce(v.variant_count, 0) as variant_count,
  coalesce(v.min_price, up.unit_price, sp.price) as price_from,
  c.slug          as category_slug,
  c.name          as category_name,
  img.storage_path as primary_image_path,
  img.alt          as primary_image_alt
from public.store_products sp
join public.products p
  on p.id = sp.product_id
left join public.categories c
  on c.id = sp.category_id
 and c.store_id = sp.store_id
 and c.is_active
left join public.brands b
  on b.id = p.brand_id
left join ebim.public_unit_prices up
  on up.store_id = sp.store_id
 and up.product_id = p.id
 and up.variant_id is null
left join (
  select vsp.store_id,
         pv.product_id,
         count(*)::int as variant_count,
         bool_or(ebim.store_product_is_available(vsp.store_id, pv.product_id, pv.id, 1)) as any_available,
         min(coalesce(vup.unit_price, ov.price, vsp.price)) as min_price
  from public.product_variants pv
  join public.store_products vsp
    on vsp.product_id = pv.product_id
  left join ebim.public_unit_prices vup
    on vup.store_id = vsp.store_id
   and vup.variant_id = pv.id
  left join public.store_price_overrides ov
    on ov.store_id = vsp.store_id
   and ov.variant_id = pv.id
  where pv.is_active
  group by vsp.store_id, pv.product_id
) v
  on v.store_id = sp.store_id
 and v.product_id = p.id
left join lateral (
  select i.storage_path, i.alt
  from public.product_images i
  where i.product_id = p.id
  order by i.is_primary desc, i.position asc
  limit 1
) img on true
where sp.status = 'published'
  and sp.published_at is not null
  and sp.published_at <= now();

comment on view public.public_products is
  'Publicación vendible de un producto maestro EN una tienda (store_products + maestro). Precio del motor por tienda; in_stock por ATP de los almacenes de esa tienda. Resumen de variantes agregado una vez por (tienda, producto).';
