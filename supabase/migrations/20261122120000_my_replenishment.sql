-- =============================================================================
-- Reposición predictiva del comprador (2026-11-22)
-- =============================================================================
--
-- «Tus productos de siempre te tocan en unos días». Por cada producto que el
-- comprador compró en DOS o más días distintos del último año, en ESTA tienda:
--
--   cada_dias       = (última compra − primera compra) / (compras − 1)
--   cantidad típica = mediana de lo que pidió por día de compra
--   le_toca         = última compra + cada_dias
--   dias_restantes  = le_toca − hoy   (negativo = ya se le pasó)
--
-- Sale lo que toca dentro del horizonte (por defecto 7 días) y lo que se le
-- pasó hace menos de una vuelta y media (más atrás ya no es «reponer», es que
-- dejó de comprarlo). Ordenado por urgencia.
--
-- ## De quién son los pedidos
--
-- Los suyos como consumidor (`order_buyers`) y los de las cuentas de empresa
-- donde es miembro activo: en B2B la reposición es de la EMPRESA, no de quien
-- pulsó «pagar» la última vez. Es el mismo criterio de `my_business_orders`.
--
-- ## Lo que NO hace
--
--  · No crea pedidos ni carritos: devuelve una lista que la vitrina manda al
--    carrito por el verificador de siempre (`resolve_order_lines_for_slug`), con
--    el precio y el stock de hoy. Un sistema que pide por ti se equivoca por ti.
--  · No devuelve importes. Ni la IA ni la tarjeta los necesitan.
--  · No usa IA: es aritmética sobre el historial. El chat solo la redacta.
--
-- SECURITY DEFINER como sus hermanas (`my_business_orders`,
-- `my_consumer_orders`): el comprador no tiene SELECT sobre `orders`; la
-- autorización es explícita (sesión + tienda activa + pedidos SUYOS) y no hay
-- parámetro que la amplíe. No crea tablas.
-- =============================================================================

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
           case when f.variant_label is not null and btrim(f.variant_label) <> ''
                then f.name || ' · ' || f.variant_label else f.name end    as nombre,
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
