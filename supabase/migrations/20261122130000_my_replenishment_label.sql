-- =============================================================================
-- Reposición: nombre sin repeticiones (2026-11-22)
-- =============================================================================
--
-- En miquimica la foto de la línea ya trae «Producto · Producto · Uva» y la
-- etiqueta de la variante es «Producto · Uva»: concatenarlas daba el nombre
-- tres veces. `ebim.replenishment_label` añade la etiqueta solo si el nombre no
-- la contiene y quita los tramos (« · ») repetidos, conservando el orden.
-- Misma función `my_replenishment`, mismos permisos.
-- =============================================================================

create or replace function ebim.replenishment_label(p_name text, p_variant_label text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  with base as (
    select case
             when p_variant_label is null or btrim(p_variant_label) = '' then p_name
             when position(btrim(p_variant_label) in p_name) > 0 then p_name
             else p_name || ' · ' || btrim(p_variant_label)
           end as texto
  ),
  tramos as (
    select btrim(t.seg) as seg, t.ord
      from base, unnest(string_to_array(base.texto, ' · ')) with ordinality as t(seg, ord)
     where btrim(t.seg) <> ''
  ),
  unicos as (
    select distinct on (lower(seg)) seg, ord from tramos order by lower(seg), ord
  )
  select coalesce((select string_agg(seg, ' · ' order by ord) from unicos), p_name)
$fn$;

revoke all on function ebim.replenishment_label(text, text) from public, anon, authenticated;
grant execute on function ebim.replenishment_label(text, text) to service_role;

create or replace function public.my_replenishment(
  p_store_slug   text,
  p_horizon_days integer default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := ebim.user_id();
  v_store   public.stores%rowtype;
  v_horizon integer := least(greatest(coalesce(p_horizon_days, 7), 0), 30);
  v_rows    jsonb;
begin
  if v_uid is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select * into v_store from public.stores s
   where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return '[]'::jsonb;
  end if;

  with mis_pedidos as (
    select o.id, coalesce(o.placed_at, o.created_at) as fecha
      from public.orders o
     where o.store_id = v_store.id
       and o.status in ('pending', 'paid', 'fulfilled')
       and coalesce(o.placed_at, o.created_at) >= now() - interval '365 days'
       and (
         exists (select 1 from public.order_buyers b
                  where b.order_id = o.id and b.user_id = v_uid)
         or exists (select 1
                      from public.business_account_users u
                      join public.business_accounts a on a.id = u.business_account_id and a.is_active
                     where u.business_account_id = o.business_account_id
                       and u.user_id = v_uid
                       and u.status = 'active')
       )
  ),
  lineas as (
    select coalesce(i.variant_id, i.product_id) as clave,
           i.sku,
           i.name,
           i.variant_label,
           i.quantity,
           p.fecha,
           p.fecha::date as dia
      from mis_pedidos p
      join public.order_items i on i.order_id = p.id
     where i.product_id is not null
       and i.sku is not null
       and i.quantity > 0
  ),
  por_dia as (
    select clave, dia, sum(quantity) as cantidad
      from lineas
     group by clave, dia
  ),
  ritmo as (
    select clave,
           count(*)::int                                            as compras,
           min(dia)                                                 as primera,
           max(dia)                                                 as ultima,
           percentile_cont(0.5) within group (order by cantidad)    as mediana
      from por_dia
     group by clave
    having count(*) >= 2
  ),
  ultima_foto as (
    select distinct on (clave) clave, sku, name, variant_label
      from lineas
     order by clave, fecha desc
  ),
  calculo as (
    select r.clave,
           f.sku,
           ebim.replenishment_label(f.name, f.variant_label)            as nombre,
           r.compras,
           greatest(1, round(r.mediana))::int                             as cantidad,
           greatest(1, round((r.ultima - r.primera)::numeric / (r.compras - 1)))::int as cada_dias,
           r.ultima
      from ritmo r
      join ultima_foto f using (clave)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku',            c.sku,
           'nombre',         c.nombre,
           'cantidad',       c.cantidad,
           'compras',        c.compras,
           'cada_dias',      c.cada_dias,
           'ultima_compra',  c.ultima,
           'le_toca',        c.ultima + c.cada_dias,
           'dias_restantes', (c.ultima + c.cada_dias) - current_date
         ) order by (c.ultima + c.cada_dias) - current_date, c.nombre), '[]'::jsonb)
    into v_rows
    from (
      select * from calculo
       where (ultima + cada_dias) - current_date <= v_horizon
         and current_date - (ultima + cada_dias) <= ceil(cada_dias * 1.5)
       order by (ultima + cada_dias) - current_date, nombre
       limit 20
    ) c;

  return v_rows;
end;
$fn$;

revoke execute on function public.my_replenishment(text, integer) from public, anon;
grant  execute on function public.my_replenishment(text, integer) to authenticated;

comment on function public.my_replenishment(text, integer) is
  'Reposición predictiva del comprador: productos que compra con regularidad y le tocan en el horizonte (7 días por defecto). Sin importes; no crea pedidos. Pedidos suyos y de sus cuentas de empresa activas en esa tienda.';
