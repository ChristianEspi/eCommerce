-- =============================================================================
-- Precio de vitrina resuelto POR FILA (una tienda, un producto, una variante)
--
-- Contexto: en QAS la ficha de producto (`public_products?store_id=…&slug=…`) y
-- la búsqueda rozaban o superaban el `statement_timeout` de `anon` (3 s,
-- 57014). `ebim.public_unit_prices` resuelve TODAS las listas de precios de
-- TODAS las tiendas con `distinct on`; cualquier consulta que la une —aunque
-- pida un solo producto— paga ese cálculo entero, y dentro de un lateral lo paga
-- por fila.
--
-- Arreglo: `ebim.public_unit_price(tienda, producto, variante)` hace la MISMA
-- resolución (mismas listas activas, mismo alcance público, mismo orden de
-- desempate) acotada por índices a una sola combinación. Las vistas públicas la
-- llaman por fila. Medido en QAS: ficha por slug de ~1,9 s a ~0,2 s; listados
-- de tienda iguales o más rápidos.
--
-- Es SECURITY DEFINER a propósito y por la misma razón que la vista que
-- sustituye: `anon` no lee listas de precios ni entitlements; solo recibe el
-- precio resultante de un producto PUBLICADO en una tienda ACTIVA. La función
-- no acepta tenant: lo deriva de la publicación.
-- =============================================================================

create or replace function ebim.public_unit_price(p_store_id uuid, p_product_id uuid, p_variant_id uuid)
returns table (unit_price numeric, compare_at_price numeric)
language sql
stable
security definer
set search_path = ''
as $fn$
  select it.unit_price, it.compare_at_price
  from public.store_products sp
  join public.stores s
    on s.id = sp.store_id
   and s.status = 'active'
  join ebim.active_price_lists l
    on l.store_id = sp.store_id
   and l.currency = sp.currency
   and l.valid_from <= now()
   and (l.valid_to is null or l.valid_to > now())
   and (
        l.scope = 'store'
     or (l.scope = 'channel' and exists (
          select 1
          from public.channels c
          where c.id = l.channel_id
            and c.store_id = sp.store_id
            and c.is_default
            and c.is_active
            and not c.requires_auth))
   )
  join public.price_list_items it
    on it.price_list_id = l.price_list_id
   and it.product_id    = p_product_id
   and (it.variant_id is null or it.variant_id = p_variant_id)
   and it.uom_id is null
   and it.min_quantity <= 1
  where sp.store_id = p_store_id
    and sp.product_id = p_product_id
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now()
  order by
    l.scope_rank desc, l.priority desc, l.valid_from desc, l.price_list_id,
    (it.variant_id is not null) desc, it.min_quantity desc, it.id
  limit 1
$fn$;

revoke all on function ebim.public_unit_price(uuid, uuid, uuid) from public;
grant execute on function ebim.public_unit_price(uuid, uuid, uuid) to anon, authenticated, service_role;

comment on function ebim.public_unit_price(uuid, uuid, uuid) is
  'Precio de vitrina de UNA publicacion (y variante): la misma resolucion que ebim.public_unit_prices acotada por indices. Definer: anon recibe solo el precio de lo publicado en tienda activa.';

-- ---------------------------------------------------------------------------
-- public_products: mismas columnas, mismo orden, mismos tipos
-- ---------------------------------------------------------------------------
create or replace view public.public_products
with (security_invoker = on) as
select
  p.id            as product_id,
  sp.store_id,
  sp.category_id,
  sp.slug,
  p.name,
  p.description,
  coalesce(up.unit_price, sp.price)::numeric(14,2) as price,
  (case when up.unit_price is null then sp.compare_at_price else up.compare_at_price end)::numeric(14,2)
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
  coalesce(v.min_price, up.unit_price, sp.price)::numeric as price_from,
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
left join lateral ebim.public_unit_price(sp.store_id, p.id, null) up on true
left join lateral (
  select count(*)::int as variant_count,
         bool_or(ebim.store_product_is_available(sp.store_id, pv.product_id, pv.id, 1)) as any_available,
         min(coalesce(
           (select x.unit_price from ebim.public_unit_price(sp.store_id, pv.product_id, pv.id) x),
           ov.price,
           sp.price)) as min_price
  from public.product_variants pv
  left join public.store_price_overrides ov
    on ov.store_id = sp.store_id
   and ov.variant_id = pv.id
  where pv.product_id = p.id
    and pv.is_active
) v on true
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
  'Publicación vendible de un producto maestro EN una tienda (store_products + maestro). Precio por fila con ebim.public_unit_price; in_stock por ATP de los almacenes de esa tienda.';

-- ---------------------------------------------------------------------------
-- public_product_variants: mismas columnas, precio por fila
-- ---------------------------------------------------------------------------
create or replace view public.public_product_variants
with (security_invoker = on) as
select
  v.id            as variant_id,
  v.product_id,
  sp.store_id,
  v.name,
  v.position,
  v.is_default,
  ebim.store_product_is_available(sp.store_id, v.product_id, v.id, 1) as in_stock,
  coalesce(up.unit_price, ov.price, sp.price)::numeric(14,2) as price,
  (case
    when up.unit_price is not null then up.compare_at_price
    when ov.price is null          then sp.compare_at_price
    else ov.compare_at_price
  end)::numeric(14,2) as compare_at_price,
  sp.currency,
  ebim.variant_public_options(v.id) as options
from public.product_variants v
join public.store_products sp
  on sp.product_id = v.product_id
left join lateral ebim.public_unit_price(sp.store_id, v.product_id, v.id) up on true
left join public.store_price_overrides ov
  on ov.store_id = sp.store_id
 and ov.variant_id = v.id
where v.is_active
  and sp.status = 'published'
  and sp.published_at is not null
  and sp.published_at <= now();
