-- =============================================================================
-- Copilot (2026-11-22) · «Pregúntale a tu tienda» y copiloto del vendedor
-- =============================================================================
--
-- Dos herramientas de SOLO LECTURA más para EBIM Copilot:
--
--  1. `sales_trend` → `public.ai_copilot_sales_trend(store, días)`: la venta día
--     a día de la ventana y de la ventana anterior, para que el panel la DIBUJE
--     y el modelo la comente con marcadores. Misma autoridad que la analítica
--     (`analytics_timeseries`: sin cancelados, NULL con monedas mezcladas).
--     Funcionalidad `insights` (owner, admin) + módulo `analytics.basic`.
--
--  2. `lapsed_customers` → `public.ai_copilot_lapsed_customers(store, texto,
--     días)`: cuentas que compraban (en el último año) y llevan N días sin
--     comprar; con texto, las que compraban ESE producto y dejaron de pedirlo.
--     Funcionalidad `sales` (owner, admin, sales_rep) + módulo `sales.force`;
--     el vendedor ve SOLO su cartera, como en la agenda (`ebim.due_customers`).
--
-- Ninguna escribe. No hay tablas nuevas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Registro de herramientas (lista cerrada; paridad con aiCopilot.ts)
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_copilot_tool_ids()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array[
    'dashboard_summary', 'sales_summary', 'sales_trend',
    'search_orders', 'order_detail', 'orders_attention',
    'search_products', 'product_detail',
    'inventory_summary', 'customer_summary', 'lapsed_customers'
  ]::text[];
$fn$;

create or replace function ebim.ai_copilot_tool_feature(p_tool text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case btrim(coalesce(p_tool, ''))
    when 'dashboard_summary' then 'insights'
    when 'sales_summary'     then 'insights'
    when 'sales_trend'       then 'insights'
    when 'search_orders'     then 'orders'
    when 'order_detail'      then 'orders'
    when 'orders_attention'  then 'orders'
    when 'search_products'   then 'catalog.copy'
    when 'product_detail'    then 'catalog.copy'
    when 'inventory_summary' then 'inventory'
    when 'customer_summary'  then 'customers'
    -- La cartera es de ventas: el vendedor la ve, el catálogo no.
    when 'lapsed_customers'  then 'sales'
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Tendencia diaria: ventana actual frente a la anterior
-- ---------------------------------------------------------------------------
create or replace function public.ai_copilot_sales_trend(p_store_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now  timestamptz := now();
  v_cur  jsonb;
  v_prev jsonb;
  v_monedas text[];
begin
  perform ebim.assert_ai_feature_reader('insights', 'analytics.basic');
  perform ebim.assert_ai_orders_store(p_store_id);

  if p_days is null or p_days not in (7, 14, 30, 90) then
    raise exception 'CAMPO_INVALIDO: la ventana debe ser 7, 14, 30 o 90 dias' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'revenue', t.revenue, 'orders', t.orders) order by t.day), '[]'::jsonb),
         array_agg(distinct t.currency) filter (where t.currency is not null)
    into v_cur, v_monedas
    from public.analytics_timeseries(p_store_id, v_now - make_interval(days => p_days), v_now) t;

  select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'revenue', t.revenue, 'orders', t.orders) order by t.day), '[]'::jsonb)
    into v_prev
    from public.analytics_timeseries(p_store_id, v_now - make_interval(days => p_days * 2), v_now - make_interval(days => p_days)) t;

  return jsonb_build_object(
    'generated_at', v_now,
    'days',         p_days,
    -- Una sola moneda o ninguna: con mezcla no se dibuja un importe.
    'currency',     case when coalesce(array_length(v_monedas, 1), 0) = 1 then v_monedas[1] end,
    'current',      v_cur,
    'previous',     v_prev,
    -- El mejor y el peor día, calculados AQUÍ: el modelo no compara cifras.
    'best_day',  (select jsonb_build_object('day', x->>'day', 'revenue', x->>'revenue')
                    from jsonb_array_elements(v_cur) x
                   where x->>'revenue' is not null
                   order by (x->>'revenue')::numeric desc limit 1),
    'zero_days', (select count(*) from jsonb_array_elements(v_cur) x where (x->>'orders')::int = 0)
  );
end;
$fn$;

revoke execute on function public.ai_copilot_sales_trend(uuid, integer) from public, anon;
grant  execute on function public.ai_copilot_sales_trend(uuid, integer) to authenticated, service_role;

comment on function public.ai_copilot_sales_trend(uuid, integer) is
  'Copilot: venta diaria de la ventana (7/14/30/90) y de la anterior, para dibujar. Security invoker; insights + analytics.basic.';

-- ---------------------------------------------------------------------------
-- 3 · Clientes que dejaron de comprar (en general o un producto)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER como `sales_due_customers`: la cartera del vendedor cruza
-- tablas (sales_rep_customers) que su rol no lee directamente. La autorización
-- va DENTRO: sesión con sociedad activa, rol de ventas, módulo contratado y
-- tienda de la sociedad; todo filtrado por organization_id/company_id del JWT.
create or replace function public.ai_copilot_lapsed_customers(
  p_store_id uuid,
  p_text     text    default null,
  p_days     integer default 60,
  p_limit    integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_rep     uuid;
  v_text    text := nullif(btrim(regexp_replace(coalesce(p_text, ''), '[%_\\]', ' ', 'g')), '');
  v_rows    jsonb;
begin
  if ebim.user_id() is null or v_org is null or v_company is null then
    raise exception 'SIN_PERMISO: hace falta sesion con sociedad activa' using errcode = '42501';
  end if;
  if not ebim.has_role(v_org, v_company, ebim.ai_feature_roles('sales')) then
    raise exception 'SIN_PERMISO: la cartera es de ventas' using errcode = '42501';
  end if;
  if not ebim.company_is_entitled(v_org, v_company, 'sales.force') then
    raise exception 'MODULO_NO_CONTRATADO: el modulo no esta contratado' using errcode = '42501';
  end if;
  if p_store_id is not null and not exists (
       select 1 from public.stores s
        where s.id = p_store_id and s.organization_id = v_org and s.company_id = v_company) then
    raise exception 'SIN_PERMISO: la tienda no es de tu sociedad' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (30, 60, 90, 180) then
    raise exception 'CAMPO_INVALIDO: la ventana debe ser 30, 60, 90 o 180 dias' using errcode = '22023';
  end if;
  if v_text is not null and length(v_text) > 60 then
    raise exception 'CAMPO_INVALIDO: texto demasiado largo' using errcode = '22023';
  end if;

  -- El vendedor ve SOLO su cartera; dueño y administración, todas.
  if ebim.member_role(v_org, v_company) = 'sales_rep' then
    v_rep := ebim.user_id();
  end if;

  with cartera as (
    select c.id, c.name
      from public.customers c
     where c.organization_id = v_org and c.company_id = v_company
       and (v_rep is null or exists (
             select 1 from public.sales_rep_customers rc
               join public.sales_reps r on r.id = rc.sales_rep_id
              where rc.customer_id = c.id and r.user_id = v_rep))
  ),
  compras as (
    select a.customer_id, o.id as order_id, o.placed_at
      from public.orders o
      join public.business_accounts a on a.id = o.business_account_id
     where o.organization_id = v_org and o.company_id = v_company
       and (p_store_id is null or o.store_id = p_store_id)
       and o.status::text not in ('cancelled', 'refunded')
       and o.placed_at >= now() - interval '365 days'
       and a.customer_id in (select id from cartera)
       and (v_text is null or exists (
             select 1 from public.order_items oi
              where oi.order_id = o.id
                and (oi.name ilike '%' || v_text || '%' or oi.sku ilike '%' || v_text || '%')))
  ),
  resumen as (
    select customer_id, count(distinct order_id)::integer as orders_count, max(placed_at) as last_at
      from compras
     group by customer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'customer_id',  r.customer_id,
           'name',         left(c.name, 120),
           'last_at',      r.last_at,
           'days_since',   floor(extract(epoch from now() - r.last_at) / 86400)::integer,
           'orders_count', r.orders_count
         ) order by r.last_at desc), '[]'::jsonb)
    into v_rows
    from (select * from resumen
           -- Compraban, y llevan la ventana entera sin hacerlo.
           where resumen.last_at < now() - make_interval(days => p_days)
           order by last_at desc
           limit greatest(1, least(coalesce(p_limit, 10), 25))) r
    join cartera c on c.id = r.customer_id;

  return jsonb_build_object(
    'days',      p_days,
    'text',      v_text,
    'scope',     case when v_rep is null then 'all' else 'portfolio' end,
    'customers', v_rows
  );
end;
$fn$;

revoke execute on function public.ai_copilot_lapsed_customers(uuid, text, integer, integer) from public, anon;
grant  execute on function public.ai_copilot_lapsed_customers(uuid, text, integer, integer) to authenticated, service_role;

comment on function public.ai_copilot_lapsed_customers(uuid, text, integer, integer) is
  'Copilot: cuentas que compraban (365 d) y llevan N dias (30/60/90/180) sin comprar, opcionalmente de un producto. Definer con guard: rol de ventas + sales.force + sociedad del JWT; el vendedor solo su cartera.';
