-- ---------------------------------------------------------------------------
-- Vitrina · Qué trae un kit (carrito)
--
-- En el carrito un kit era una línea opaca: «Kit Viajero · S/ 319.90» sin
-- decir qué productos se lleva el comprador. La receta vive en `bundle_items`,
-- que `anon` no lee (es dato interno del catálogo: unidades, ids de variante,
-- posición). Esta función expone SOLO lo que el comprador necesita ver:
-- nombre del componente, variante, cantidad y unidad.
--
-- Reglas:
--   · el tenant sale de la tienda ACTIVA con ese slug, nunca de un id que
--     mande el cliente (misma puerta que `product_price_tiers_for_slug`);
--   · solo responde por kits PUBLICADOS en esa tienda: un id de un kit en
--     borrador, de otra tienda o que no es kit no devuelve nada;
--   · acepta varios productos a la vez (todo el carrito en una consulta) con
--     un tope, para que nadie la use de enumerador.
--   · no devuelve stock ni precios de componentes: el kit tiene su precio y
--     su disponibilidad la resuelve `public_products`.
-- ---------------------------------------------------------------------------

create or replace function public.bundle_components_for_slug(
  p_store_slug  text,
  p_product_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_slug  text := lower(btrim(coalesce(p_store_slug, '')));
  v_rows  jsonb;
begin
  select * into v_store
  from public.stores s
  where lower(s.slug) = v_slug and s.status = 'active';

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda "%" no existe o no esta activa', v_slug
      using errcode = '22023';
  end if;

  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    return '[]'::jsonb;
  end if;

  -- Un carrito de vitrina no pasa de unas decenas de líneas.
  if cardinality(p_product_ids) > 100 then
    raise exception 'DEMASIADOS_PRODUCTOS: maximo 100 por consulta'
      using errcode = '22023';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'bundle_product_id', bi.bundle_product_id,
               'name',              c.name,
               'variant_name',      v.name,
               -- La cantidad es numeric(18,6): viaja como texto, igual que los importes.
               'quantity',          bi.quantity::text,
               -- NULL = unidades base. El símbolo si lo hay; si no, el código.
               'unit',              coalesce(u.symbol, u.code)
             ) order by bi.bundle_product_id, bi.position, c.name
           ),
           '[]'::jsonb
         )
    into v_rows
  from public.store_products sp
  join public.products k
    on k.id = sp.product_id
   and k.kind = 'bundle'
   and k.organization_id = v_store.organization_id
   and k.company_id = v_store.company_id
  join public.bundle_items bi
    on bi.bundle_product_id = k.id
  join public.products c
    on c.id = bi.component_product_id
  left join public.product_variants v
    on v.id = bi.component_variant_id
  left join public.units_of_measure u
    on u.id = bi.uom_id
  where sp.store_id = v_store.id
    and sp.product_id = any(p_product_ids)
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now();

  return v_rows;
end;
$$;

revoke execute on function public.bundle_components_for_slug(text, uuid[]) from public;
grant  execute on function public.bundle_components_for_slug(text, uuid[]) to anon, authenticated, service_role;

comment on function public.bundle_components_for_slug(text, uuid[]) is
  'Vitrina: componentes (nombre, variante, cantidad, unidad) de los kits PUBLICADOS en la tienda activa con ese slug. Sin precios ni stock.';
