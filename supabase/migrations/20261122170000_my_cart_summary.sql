-- =============================================================================
-- El carrito del comprador, para el chat (2026-11-22)
-- =============================================================================
--
-- «¿Qué tengo en el carrito?» / «¿bajó algo?»: el carrito ACTIVO del comprador
-- con sesión en esa tienda, con el precio de cuando lo añadió frente al de HOY
-- (misma cotización que el checkout: `ebim.build_quote`, con su cuenta) y si hay
-- stock. Es lo que el correo de recuperación de carrito no puede contar.
--
-- No necesita el token del navegador: un carrito con dueño se identifica por la
-- sesión (`carts.user_id`), y el de invitado no tiene a quién hablarle.
-- No escribe: no fusiona, no recotiza, no toca `last_activity_at`.
--
-- SECURITY DEFINER: el comprador no lee `carts` directamente. Autorización
-- explícita: sesión + tienda activa + carrito SUYO. Sin sesión ⇒ error.
-- =============================================================================

create or replace function public.my_cart_summary(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid := ebim.user_id();
  v_store public.stores%rowtype;
  v_cart  public.carts%rowtype;
  v_items jsonb;
  v_quote jsonb;
begin
  if v_uid is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select * into v_store from public.stores s
   where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return null;
  end if;

  select * into v_cart from public.carts c
   where c.store_id = v_store.id and c.user_id = v_uid and c.status = 'active'
   order by c.last_activity_at desc
   limit 1;
  if not found then
    return jsonb_build_object('lineas', '[]'::jsonb, 'moneda', v_store.currency, 'dias_sin_tocar', null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', i.product_id, 'variant_id', i.variant_id,
           'uom_code', i.uom_code, 'quantity', i.quantity) order by i.created_at), '[]'::jsonb)
    into v_items
    from public.cart_items i
   where i.cart_id = v_cart.id;

  begin
    v_quote := ebim.build_quote(v_cart.store_id, v_cart.channel_id, v_items, null, null, now(), true);
  exception when others then
    v_quote := null;   -- Sin cotización no hay «precio de hoy»: se dice igual.
  end;

  return jsonb_build_object(
    'moneda',         coalesce(v_cart.currency, v_store.currency),
    'dias_sin_tocar', current_date - v_cart.last_activity_at::date,
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id',  i.product_id,
               'nombre',      case when v.id is not null then p.name || ' · ' || v.name else p.name end,
               'cantidad',    i.quantity,
               'precio_antes', i.unit_price_snapshot::text,
               'precio_hoy',  q.line ->> 'unit_price',
               'en_stock',    exists (select 1 from public.public_products pp
                                       where pp.store_id = v_cart.store_id and pp.product_id = i.product_id and pp.in_stock))
             order by i.created_at)
        from public.cart_items i
        join public.products p on p.id = i.product_id
        left join public.product_variants v on v.id = i.variant_id
        left join lateral (
          select x.line from jsonb_array_elements(coalesce(v_quote -> 'lines', '[]'::jsonb)) as x(line)
           where (x.line ->> 'product_id')::uuid = i.product_id
             and (x.line ->> 'variant_id') is not distinct from i.variant_id::text
           limit 1
        ) q on true
       where i.cart_id = v_cart.id
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.my_cart_summary(text) from public, anon;
grant  execute on function public.my_cart_summary(text) to authenticated;

comment on function public.my_cart_summary(text) is
  'Carrito activo del comprador con sesión en esa tienda: líneas, precio al añadir frente al de hoy (cotización con su cuenta) y stock. No escribe.';
