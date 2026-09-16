-- =============================================================================
-- Stores + Product Master · Fase 03 (2/2) — modelos de lectura sobre la publicación
--
-- La vitrina deja de preguntar «¿este producto está publicado?» y pasa a
-- preguntar «¿este producto está publicado EN ESTA TIENDA?». Las vistas
-- públicas conservan nombre y columnas —la vitrina, el SEO por tienda y el CMS no
-- cambian una línea— pero salen de `store_products` + el maestro:
--
--  · identidad, nombre, descripción, tipo y marca → `products` (maestro);
--  · tienda, slug, categoría, estado, fecha y precio de catálogo → publicación;
--  · precio resuelto → `ebim.public_unit_prices`, ahora POR TIENDA;
--  · disponibilidad → ATP de los almacenes que sirven a ESA tienda.
--
-- Un maestro sin publicación activa en una tienda no existe para la vitrina de
-- esa tienda, aunque esté publicado en otra.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · El inventario reconoce el producto por su SOCIEDAD, no por su tienda
--
-- `ebim.atp` y `ebim.expand_stock_lines` buscaban el tipo del producto con
-- `p.store_id = p_store_id`: una publicación en la tienda B de un maestro nacido
-- en A no tenía tipo y el semáforo decía «no se sabe». La existencia física es
-- del almacén y del maestro (ADR 018 §9); la tienda solo decide QUÉ almacenes
-- la sirven. Cuerpos idénticos a 20260827200100 salvo esa búsqueda.
-- ---------------------------------------------------------------------------
create or replace function ebim.expand_stock_lines(
  p_store_id   uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_base_qty   numeric
)
returns table (product_id uuid, variant_id uuid, quantity numeric)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_kind public.product_kind;
begin
  select p.kind into v_kind
  from public.products p
  join public.stores s
    on s.id = p_store_id
   and s.organization_id = p.organization_id
   and s.company_id = p.company_id
  where p.id = p_product_id;

  if v_kind is null then
    raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(p_product_id::text, 'null')
      using errcode = '22023';
  end if;

  if v_kind <> 'bundle' then
    return query select p_product_id, p_variant_id, p_base_qty;
    return;
  end if;

  if not exists (select 1 from public.bundle_items bi where bi.bundle_product_id = p_product_id) then
    raise exception 'KIT_SIN_COMPONENTES: el kit % no tiene componentes definidos', p_product_id
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.bundle_items bi
    left join public.product_uoms pu
      on pu.product_id = bi.component_product_id and pu.uom_id = bi.uom_id
    where bi.bundle_product_id = p_product_id
      and bi.uom_id is not null
      and pu.factor is null
  ) then
    raise exception 'KIT_UOM_INVALIDA: un componente del kit % usa una unidad sin configurar', p_product_id
      using errcode = '22023';
  end if;

  return query
    select bi.component_product_id,
           bi.component_variant_id,
           bi.quantity * coalesce(pu.factor, 1) * p_base_qty
    from public.bundle_items bi
    left join public.product_uoms pu
      on pu.product_id = bi.component_product_id and pu.uom_id = bi.uom_id
    where bi.bundle_product_id = p_product_id
    order by bi.position, bi.component_product_id;
end;
$fn$;

create or replace function ebim.atp(
  p_store_id   uuid,
  p_product_id uuid,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_kind       public.product_kind;
  v_available  numeric := 0;
  v_unknown    boolean := false;
  v_backorder  boolean := false;
  v_any_erp    boolean := false;
  v_count      integer := 0;
  v_component  record;
  v_child      jsonb;
  v_per_unit   numeric;
  v_possible   numeric;
  v_min        numeric := null;
begin
  select p.kind into v_kind
  from public.products p
  join public.stores s
    on s.id = p_store_id
   and s.organization_id = p.organization_id
   and s.company_id = p.company_id
  where p.id = p_product_id;

  if v_kind is null then
    return jsonb_build_object(
      'available', null, 'unknown', true, 'backorder', false,
      'source', 'catalog', 'warehouses', 0);
  end if;

  if v_kind = 'bundle' then
    for v_component in
      select l.product_id, l.variant_id, l.quantity
      from ebim.expand_stock_lines(p_store_id, p_product_id, null, 1) l
    loop
      v_per_unit := v_component.quantity;
      if v_per_unit is null or v_per_unit <= 0 then continue; end if;

      v_child := ebim.atp(p_store_id, v_component.product_id, v_component.variant_id);
      v_unknown   := v_unknown   or coalesce((v_child ->> 'unknown')::boolean, false);
      v_backorder := v_backorder or coalesce((v_child ->> 'backorder')::boolean, false);
      if (v_child ->> 'source') = 'erp' then v_any_erp := true; end if;

      v_possible := floor(coalesce((v_child ->> 'available')::numeric, 0) / v_per_unit);
      v_min := least(coalesce(v_min, v_possible), v_possible);
    end loop;

    return jsonb_build_object(
      'available',  coalesce(v_min, 0),
      'unknown',    v_unknown,
      'backorder',  v_backorder,
      'source',     case when v_any_erp then 'erp' else 'warehouse' end,
      'warehouses', 0);
  end if;

  select count(*) into v_count from ebim.serving_warehouses(p_store_id);

  if v_count = 0 then
    if p_variant_id is not null then
      select coalesce(pv.stock, 0) into v_available
      from public.product_variants pv where pv.id = p_variant_id;
    else
      select coalesce(p.stock, 0) into v_available
      from public.products p where p.id = p_product_id;
    end if;

    return jsonb_build_object(
      'available',  coalesce(v_available, 0),
      'unknown',    false,
      'backorder',  false,
      'source',     'catalog',
      'warehouses', 0);
  end if;

  select
    coalesce(sum(
      case when x.is_unknown then 0
           else greatest(x.available_qty - x.safety_stock, 0) end), 0),
    coalesce(bool_or(x.is_unknown), false),
    coalesce(bool_or(x.allows_backorder), false),
    coalesce(bool_or(x.source = 'erp'), false),
    count(*)::integer
  into v_available, v_unknown, v_backorder, v_any_erp, v_count
  from (
    select l.available_qty,
           l.safety_stock,
           w.allows_backorder,
           w.source,
           (w.source = 'erp'
             and w.stale_after is not null
             and l.synced_at < now() - w.stale_after
             and w.stale_policy = 'unknown') as is_unknown
    from ebim.serving_warehouses(p_store_id) w
    join public.inventory_levels l
      on l.warehouse_id = w.warehouse_id
     and l.product_id   = p_product_id
     and l.variant_id is not distinct from p_variant_id
  ) x;

  return jsonb_build_object(
    'available',  coalesce(v_available, 0),
    'unknown',    coalesce(v_unknown, false),
    'backorder',  coalesce(v_backorder, false),
    'source',     case when v_any_erp then 'erp' else 'warehouse' end,
    'warehouses', coalesce(v_count, 0));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Semáforo por tienda
--
-- Hermanas de `ebim.product_is_available` / `ebim.bundle_is_available` con la
-- tienda EXPLÍCITA. Misma autorización dentro: solo responden por una
-- publicación publicada de una tienda activa; para cualquier otra, `false`.
-- Las de un argumento menos quedan para los lectores legacy de la fase 05.
-- ---------------------------------------------------------------------------
create or replace function ebim.store_product_is_available(
  p_store_id   uuid,
  p_product_id uuid,
  p_variant_id uuid default null,
  p_quantity   numeric default 1
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_atp jsonb;
begin
  if not exists (
    select 1
    from public.store_products sp
    join public.stores s on s.id = sp.store_id
    where sp.store_id = p_store_id
      and sp.product_id = p_product_id
      and sp.status = 'published'
      and sp.published_at is not null
      and sp.published_at <= now()
      and s.status = 'active'
  ) then
    return false;
  end if;

  if p_variant_id is not null and not exists (
    select 1 from public.product_variants pv
    where pv.id = p_variant_id and pv.product_id = p_product_id and pv.is_active
  ) then
    return false;
  end if;

  v_atp := ebim.atp(p_store_id, p_product_id, p_variant_id);

  return coalesce((v_atp ->> 'backorder')::boolean, false)
      or coalesce((v_atp ->> 'unknown')::boolean, false)
      or coalesce((v_atp ->> 'available')::numeric, 0) >= coalesce(p_quantity, 1);
end;
$fn$;

create or replace function ebim.store_bundle_is_available(p_store_id uuid, p_bundle_product_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_atp jsonb;
begin
  if not exists (
    select 1
    from public.store_products sp
    join public.stores s on s.id = sp.store_id
    join public.products p on p.id = sp.product_id
    where sp.store_id = p_store_id
      and sp.product_id = p_bundle_product_id
      and p.kind = 'bundle'
      and sp.status = 'published'
      and sp.published_at is not null
      and sp.published_at <= now()
      and s.status = 'active'
  ) then
    return false;
  end if;

  if not exists (
    select 1 from public.bundle_items bi where bi.bundle_product_id = p_bundle_product_id
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.bundle_items bi
    left join public.product_uoms pu
      on pu.product_id = bi.component_product_id and pu.uom_id = bi.uom_id
    where bi.bundle_product_id = p_bundle_product_id
      and bi.uom_id is not null
      and pu.factor is null
  ) then
    return false;
  end if;

  v_atp := ebim.atp(p_store_id, p_bundle_product_id, null);

  return coalesce((v_atp ->> 'backorder')::boolean, false)
      or coalesce((v_atp ->> 'unknown')::boolean, false)
      or coalesce((v_atp ->> 'available')::numeric, 0) > 0;
end;
$fn$;

revoke execute on function ebim.store_product_is_available(uuid, uuid, uuid, numeric) from public;
grant  execute on function ebim.store_product_is_available(uuid, uuid, uuid, numeric)
  to anon, authenticated, service_role;
revoke execute on function ebim.store_bundle_is_available(uuid, uuid) from public;
grant  execute on function ebim.store_bundle_is_available(uuid, uuid)
  to anon, authenticated, service_role;

comment on function ebim.store_product_is_available(uuid, uuid, uuid, numeric) is
  'Semáforo de una publicación: solo responde por producto publicado EN esa tienda activa, con el ATP de los almacenes que la sirven. Solo un booleano.';
comment on function ebim.store_bundle_is_available(uuid, uuid) is
  'Semáforo de un kit publicado EN esa tienda activa, contra el ATP de sus componentes. Solo un booleano.';

-- Los ejes de una variante son del MAESTRO: iguales en todas las tiendas. Se
-- responden si el producto está publicado en alguna tienda activa.
create or replace function ebim.variant_public_options(p_variant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'code',           a.code,
               'name',           a.name,
               'position',       a.position,
               'value_code',     av.code,
               'label',          av.label,
               'value_position', av.position
             )
             order by a.position, a.name
           ),
           '[]'::jsonb
         )
  from public.product_variants v
  join public.variant_attribute_values vav
    on vav.variant_id = v.id
  join public.attributes a
    on a.id = vav.attribute_id
  join public.attribute_values av
    on av.id = vav.value_id
  where v.id = p_variant_id
    and v.is_active
    and exists (
      select 1
      from public.store_products sp
      join public.stores s on s.id = sp.store_id
      where sp.product_id = v.product_id
        and sp.status = 'published'
        and sp.published_at is not null
        and sp.published_at <= now()
        and s.status = 'active'
    );
$fn$;

-- ---------------------------------------------------------------------------
-- 3 · Policies anónimas: «publicado en alguna tienda activa»
--
-- Las tablas del maestro dejan de mirar `products.status/store_id`. Qué tienda
-- concreta enseña cada fila lo decide la vista, que filtra por publicación.
-- ---------------------------------------------------------------------------
create or replace function ebim.product_is_public(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.store_products sp
    join public.stores s on s.id = sp.store_id
    where sp.product_id = p_product_id
      and sp.status = 'published'
      and sp.published_at is not null
      and sp.published_at <= now()
      and s.status = 'active'
  );
$fn$;

revoke execute on function ebim.product_is_public(uuid) from public;
grant  execute on function ebim.product_is_public(uuid) to anon, authenticated, service_role;

comment on function ebim.product_is_public(uuid) is
  'El maestro tiene al menos una publicación publicada en una tienda activa. Solo un booleano; lo usan las policies anónimas del PIM.';

drop policy if exists products_select_public on public.products;
create policy products_select_public on public.products
  for select to anon
  using (ebim.product_is_public(id));

drop policy if exists product_images_select_public on public.product_images;
create policy product_images_select_public on public.product_images
  for select to anon
  using (ebim.product_is_public(product_id));

drop policy if exists product_variants_select_public on public.product_variants;
create policy product_variants_select_public on public.product_variants
  for select to anon
  using (is_active and ebim.product_is_public(product_id));

drop policy if exists brands_select_public on public.brands;
create policy brands_select_public on public.brands
  for select to anon
  using (
    is_active
    and exists (
      select 1 from public.products p
      where p.brand_id = brands.id
        and ebim.product_is_public(p.id)
    )
  );

-- Columnas del maestro que las vistas públicas leen con la identidad de `anon`.
grant select (id, name, description, custom_fields, kind, brand_id) on public.products to anon;

-- ---------------------------------------------------------------------------
-- 4 · Precio de vitrina POR TIENDA
--
-- Misma resolución y mismas cinco columnas que 20260827180100. Cambian dos
-- cosas: las filas salen de las publicaciones (y no de `products`), y el
-- desempate es por tienda, porque el mismo producto puede tener otro precio en
-- otra tienda.
-- ---------------------------------------------------------------------------
create or replace view ebim.public_unit_prices as
select store_id, product_id, variant_id, unit_price, compare_at_price
from (
select distinct on (t.store_id, t.product_id, t.variant_id)
  t.store_id,
  t.product_id,
  t.variant_id,
  it.unit_price,
  it.compare_at_price,
  l.price_list_id,
  l.price_list_code
from (
  select sp.product_id, null::uuid as variant_id, sp.store_id, sp.currency
  from public.store_products sp
  join public.stores s on s.id = sp.store_id
  where s.status = 'active'
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now()
  union all
  select v.product_id, v.id as variant_id, sp.store_id, sp.currency
  from public.product_variants v
  join public.store_products sp on sp.product_id = v.product_id
  join public.stores s on s.id = sp.store_id
  where v.is_active
    and s.status = 'active'
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now()
) t
join ebim.active_price_lists l
  on l.store_id = t.store_id
 and l.currency = t.currency
 and l.valid_from <= now()
 and (l.valid_to is null or l.valid_to > now())
 and (
      l.scope = 'store'
   or (l.scope = 'channel' and exists (
        select 1
        from public.channels c
        where c.id = l.channel_id
          and c.store_id = t.store_id
          and c.is_default
          and c.is_active
          and not c.requires_auth))
 )
join public.price_list_items it
  on it.price_list_id = l.price_list_id
 and it.product_id    = t.product_id
 and (it.variant_id is null or it.variant_id = t.variant_id)
 and it.uom_id is null
 and it.min_quantity <= 1
order by
  t.store_id, t.product_id, t.variant_id,
  l.scope_rank desc, l.priority desc, l.valid_from desc, l.price_list_id,
  (it.variant_id is not null) desc, it.min_quantity desc, it.id
) resolved;

-- ---------------------------------------------------------------------------
-- 5 · Vistas públicas: mismas columnas, publicación por tienda
-- ---------------------------------------------------------------------------
drop view if exists public.public_products;

create view public.public_products
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
left join lateral (
  select count(*)::int as variant_count,
         bool_or(ebim.store_product_is_available(sp.store_id, pv.product_id, pv.id, 1)) as any_available,
         min(coalesce(vup.unit_price, ov.price, sp.price)) as min_price
  from public.product_variants pv
  left join ebim.public_unit_prices vup
    on vup.store_id = sp.store_id
   and vup.variant_id = pv.id
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

drop view if exists public.public_product_variants;

create view public.public_product_variants
with (security_invoker = on) as
select
  v.id            as variant_id,
  v.product_id,
  sp.store_id,
  v.name,
  v.position,
  v.is_default,
  ebim.store_product_is_available(sp.store_id, v.product_id, v.id, 1) as in_stock,
  coalesce(up.unit_price, ov.price, sp.price) as price,
  case
    when up.unit_price is not null then up.compare_at_price
    when ov.price is null          then sp.compare_at_price
    else ov.compare_at_price
  end             as compare_at_price,
  sp.currency,
  ebim.variant_public_options(v.id) as options
from public.product_variants v
join public.store_products sp
  on sp.product_id = v.product_id
left join ebim.public_unit_prices up
  on up.store_id = sp.store_id
 and up.variant_id = v.id
left join public.store_price_overrides ov
  on ov.store_id = sp.store_id
 and ov.variant_id = v.id
where v.is_active
  and sp.status = 'published'
  and sp.published_at is not null
  and sp.published_at <= now();

revoke all on public.public_products         from public;
revoke all on public.public_product_variants from public;
grant select on public.public_products         to anon, authenticated, service_role;
grant select on public.public_product_variants to anon, authenticated, service_role;

comment on view public.public_products is
  'Publicación vendible de un producto maestro EN una tienda (store_products + maestro). Precio del motor por tienda; in_stock por ATP de los almacenes de esa tienda.';
comment on view public.public_product_variants is
  'Variantes del maestro en cada tienda donde está publicado: precio resuelto por tienda (lista, precio propio o catálogo), semáforo por ATP y ejes. Sin SKU ni existencia exacta.';

-- ---------------------------------------------------------------------------
-- 6 · Backoffice: la publicación con el maestro al lado
--
-- `admin_products` conserva su forma hasta que la pantalla de productos pase a
-- listar maestros (fase 04). Esta vista es el contrato de «este producto en esta
-- tienda»: una fila por publicación, con los datos del maestro que la pantalla
-- necesita para reconocerla.
-- ---------------------------------------------------------------------------
create or replace view public.admin_store_products
with (security_invoker = on) as
select
  sp.id              as publication_id,
  sp.organization_id,
  sp.company_id,
  sp.store_id,
  sp.product_id,
  p.sku,
  p.name,
  p.kind,
  p.brand_id,
  b.name             as brand_name,
  sp.category_id,
  c.name             as category_name,
  sp.slug,
  sp.status,
  sp.published_at,
  sp.price,
  sp.compare_at_price,
  sp.currency,
  sp.created_at,
  sp.updated_at
from public.store_products sp
join public.products p on p.id = sp.product_id
left join public.categories c on c.id = sp.category_id
left join public.brands b on b.id = p.brand_id;

revoke all on public.admin_store_products from public, anon;
grant select on public.admin_store_products to authenticated, service_role;

comment on view public.admin_store_products is
  'Backoffice: una fila por publicación (tienda × producto maestro) con sku, nombre, marca y categoría de ESA tienda. security_invoker.';
