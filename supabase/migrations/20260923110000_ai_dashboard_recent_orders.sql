-- =============================================================================
-- Analista IA del dashboard: los ULTIMOS pedidos entran en el dataset.
--
-- En QAS (2026-09-23) «¿cual fue mi ultima venta?» no tenia respuesta: el
-- dataset solo traia agregados y la cola de pedidos que piden atencion
-- (ordenada del MAS ANTIGUO), asi que el modelo sabia que hubo un pedido esta
-- semana pero no cual. Se anade `orders.recent`: los 5 ultimos pedidos (numero,
-- fecha, total, moneda y los tres ejes de estado; nada del comprador).
--
-- Ademas, cada pedido (recientes y cola de atencion) lleva su `id`. No lo ve
-- el modelo: lo usa el front para abrir ESE pedido (`/app/orders?order=<id>`),
-- y la RLS vuelve a decidir al leerlo.
--
-- Mismas reglas que 20260921130000: SECURITY INVOKER, owner/admin, sociedad
-- ACTIVA, listas <=5. Es la definicion completa (create or replace).
-- =============================================================================

create or replace function public.ai_dashboard_facts(p_store_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org        uuid := ebim.org_id();
  v_company    uuid := ebim.active_company();
  v_now        timestamptz := now();
  v_days       integer := 7;
  v_kpis       jsonb;
  v_cur        jsonb;
  v_prev       jsonb;
  v_orders     jsonb;
  v_inventory  jsonb;
  v_fulfill    jsonb;
  v_credit     jsonb;
  v_sales_cur  numeric;
  v_sales_prev numeric;
  v_ord_cur    bigint;
  v_ord_prev   bigint;
begin
  if v_org is null or v_company is null then
    raise exception 'SIN_PERMISO: el token no trae la jerarquia de tenant' using errcode = '42501';
  end if;
  if not ebim.has_role(v_org, v_company, array['owner', 'admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: el analista IA es del propietario o un administrador'
      using errcode = '42501';
  end if;
  if p_store_id is not null and not exists (
    select 1 from public.stores s
     where s.id = p_store_id and s.organization_id = v_org and s.company_id = v_company
  ) then
    raise exception 'SIN_PERMISO: esa tienda no es de tu sociedad' using errcode = '42501';
  end if;

  -- Lo que el dashboard ya enseña. Misma función, misma cifra.
  v_kpis := public.dashboard_kpis(p_store_id);

  -- Variación: últimos 7 días frente a los 7 anteriores, con la autoridad de
  -- analítica. Sin moneda única, `gross_sales` es NULL y no hay variación que
  -- afirmar.
  v_cur  := public.analytics_kpis(p_store_id, v_now - make_interval(days => v_days), v_now);
  v_prev := public.analytics_kpis(
    p_store_id,
    v_now - make_interval(days => v_days * 2),
    v_now - make_interval(days => v_days)
  );
  v_sales_cur  := nullif(v_cur ->> 'gross_sales', '')::numeric;
  v_sales_prev := nullif(v_prev ->> 'gross_sales', '')::numeric;
  v_ord_cur    := coalesce((v_cur ->> 'orders')::bigint, 0);
  v_ord_prev   := coalesce((v_prev ->> 'orders')::bigint, 0);

  -- Fase 12: cada lectura filtra además por la sociedad ACTIVA. La RLS deja
  -- ver todas las sociedades del token; el rol y los módulos se comprobaron
  -- solo para la activa, así que el resumen no puede mezclar otra.
  --
  -- Pedidos que piden atención. Umbrales declarados, no «a ojo del modelo».
  select jsonb_build_object(
    'pending',            count(*) filter (where o.status = 'pending'),
    'awaiting_approval',  count(*) filter (where o.approval_status = 'pending'),
    'unpaid_over_3d',     count(*) filter (
                            where o.status = 'pending'
                              and o.payment_status = 'pending'
                              and o.placed_at < v_now - interval '3 days'),
    'paid_unshipped_over_2d', count(*) filter (
                            where o.status = 'paid'
                              and o.fulfillment_status = 'unfulfilled'
                              and o.placed_at < v_now - interval '2 days'),
    'attention', coalesce((
      select jsonb_agg(x order by n)
        from (
          select jsonb_build_object(
                   'id', a.id,
                   'order_number', left(a.order_number, 40),
                   'reason', case
                     when a.approval_status = 'pending' then 'awaiting_approval'
                     when a.status = 'paid' then 'paid_unshipped'
                     else 'unpaid'
                   end,
                   'age_days', floor(extract(epoch from (v_now - a.placed_at)) / 86400)::int
                 ) as x,
                 row_number() over (order by a.placed_at asc, a.order_number) as n
            from public.orders a
           where a.organization_id = v_org and a.company_id = v_company
             and (p_store_id is null or a.store_id = p_store_id)
             and (
                   a.approval_status = 'pending'
                or (a.status = 'pending' and a.payment_status = 'pending'
                    and a.placed_at < v_now - interval '3 days')
                or (a.status = 'paid' and a.fulfillment_status = 'unfulfilled'
                    and a.placed_at < v_now - interval '2 days')
             )
           order by a.placed_at asc
           limit 5
        ) t
    ), '[]'::jsonb),
    -- Los ultimos pedidos, del mas nuevo al mas antiguo (R1 = el ultimo). Sin
    -- datos del comprador: numero, fecha, total y los tres ejes de estado.
    'recent', coalesce((
      select jsonb_agg(x order by n)
        from (
          select jsonb_build_object(
                   'id', r.id,
                   'order_number', left(r.order_number, 40),
                   'placed_at', r.placed_at,
                   'status', r.status,
                   'payment_status', r.payment_status,
                   'fulfillment_status', r.fulfillment_status,
                   'grand_total', r.grand_total::text,
                   'currency', r.currency,
                   'age_days', floor(extract(epoch from (v_now - r.placed_at)) / 86400)::int
                 ) as x,
                 row_number() over (order by r.placed_at desc, r.order_number desc) as n
            from public.orders r
           where r.organization_id = v_org and r.company_id = v_company
             and (p_store_id is null or r.store_id = p_store_id)
           order by r.placed_at desc, r.order_number desc
           limit 5
        ) t
    ), '[]'::jsonb)
  )
    into v_orders
    from public.orders o
   where o.organization_id = v_org and o.company_id = v_company
     and (p_store_id is null or o.store_id = p_store_id);

  -- Inventario: bajo punto de pedido, negativo, sin sincronizar (vista
  -- `inventory_alerts`) y stock SIN MOVIMIENTO (disponible > 0 y ninguna venta
  -- del producto en 60 días) como señal de exceso.
  if ebim.company_is_entitled(v_org, v_company, 'inventory.multiwarehouse') then
    select jsonb_build_object(
      'below_reorder', count(*) filter (where a.kind = 'below_reorder'),
      'negative',      count(*) filter (where a.kind = 'negative'),
      'stale',         count(*) filter (where a.kind = 'stale'),
      'low', coalesce((
        select jsonb_agg(x order by n)
          from (
            select jsonb_build_object(
                     'sku', left(b.sku, 60),
                     'name', left(b.name, 80),
                     'kind', b.kind,
                     'available', round(b.available_qty, 2)::text,
                     'reorder_point', round(b.reorder_point, 2)::text
                   ) as x,
                   row_number() over (
                     order by (b.kind = 'negative') desc, b.available_qty - b.reorder_point asc, b.sku
                   ) as n
              from public.inventory_alerts b
             where b.organization_id = v_org and b.company_id = v_company
               and b.kind in ('below_reorder', 'negative')
               and (p_store_id is null or b.store_id = p_store_id)
             order by (b.kind = 'negative') desc, b.available_qty - b.reorder_point asc, b.sku
             limit 5
          ) t
      ), '[]'::jsonb),
      'idle', (
        select count(*)
          from public.inventory_levels l
         where l.organization_id = v_org and l.company_id = v_company
           and l.available_qty > 0
           and (p_store_id is null or l.store_id = p_store_id)
           and not exists (
             select 1 from public.order_items oi
               join public.orders o2 on o2.id = oi.order_id
              where oi.product_id = l.product_id
                and o2.organization_id = v_org and o2.company_id = v_company
                and o2.status <> 'cancelled'
                and o2.placed_at >= v_now - interval '60 days')
      ),
      'idle_top', coalesce((
        select jsonb_agg(x order by n)
          from (
            select jsonb_build_object(
                     'sku', left(coalesce(pv.sku, p.sku), 60),
                     'name', left(coalesce(pv.name, p.name), 80),
                     'available', round(l.available_qty, 2)::text
                   ) as x,
                   row_number() over (order by l.available_qty desc, p.sku) as n
              from public.inventory_levels l
              join public.products p on p.id = l.product_id
              left join public.product_variants pv on pv.id = l.variant_id
             where l.organization_id = v_org and l.company_id = v_company
               and l.available_qty > 0
               and (p_store_id is null or l.store_id = p_store_id)
               and not exists (
                 select 1 from public.order_items oi
                   join public.orders o2 on o2.id = oi.order_id
                  where oi.product_id = l.product_id
                    and o2.organization_id = v_org and o2.company_id = v_company
                    and o2.status <> 'cancelled'
                    and o2.placed_at >= v_now - interval '60 days')
             order by l.available_qty desc, p.sku
             limit 5
          ) t
      ), '[]'::jsonb)
    )
      into v_inventory
      from public.inventory_alerts a
     where a.organization_id = v_org and a.company_id = v_company
       and (p_store_id is null or a.store_id = p_store_id);
  end if;

  -- Entregas abiertas, vencidas (promesa pasada) y fallidas.
  if ebim.company_is_entitled(v_org, v_company, 'fulfillment') then
    select jsonb_build_object(
      'open',    count(*) filter (where f.state not in ('delivered', 'cancelled')),
      'overdue', count(*) filter (
                   where f.state not in ('delivered', 'cancelled', 'failed')
                     and f.promised_to is not null and f.promised_to < current_date),
      'failed',  count(*) filter (where f.state = 'failed'),
      'late', coalesce((
        select jsonb_agg(x order by n)
          from (
            select jsonb_build_object(
                     'order_number', left(g.order_number, 40),
                     'state', g.state,
                     'days_late', (current_date - g.promised_to)
                   ) as x,
                   row_number() over (order by g.promised_to asc, g.order_number) as n
              from public.fulfillment_overview g
             where g.organization_id = v_org and g.company_id = v_company
               and g.state not in ('delivered', 'cancelled', 'failed')
               and g.promised_to is not null and g.promised_to < current_date
               and (p_store_id is null or g.store_id = p_store_id)
             order by g.promised_to asc, g.order_number
             limit 5
          ) t
      ), '[]'::jsonb)
    )
      into v_fulfill
      from public.fulfillment_overview f
     where f.organization_id = v_org and f.company_id = v_company
       and (p_store_id is null or f.store_id = p_store_id);
  end if;

  -- Cobranza: deuda vencida de la SOCIEDAD (los documentos no son de una
  -- tienda). Importe solo con moneda única; por cliente, solo conteo y días.
  if ebim.company_is_entitled(v_org, v_company, 'credit.management') then
    with vencidos as (
      select d.customer_id, d.currency, d.balance, (current_date - d.due_at) as dias
        from public.ar_documents d
       where d.organization_id = v_org and d.company_id = v_company
         and d.kind <> 'credit_note' and d.balance > 0 and d.due_at < current_date
    )
    select jsonb_build_object(
      'overdue_documents', (select count(*) from vencidos),
      'overdue_currency', (select case when count(distinct currency) = 1 then min(currency)::text end from vencidos),
      'overdue_balance', (select case when count(distinct currency) = 1 then sum(balance)::text end from vencidos),
      'accounts_blocked', (select count(*) from public.business_accounts b where b.organization_id = v_org and b.company_id = v_company and b.credit_status = 'blocked' and b.is_active),
      'accounts_watch',   (select count(*) from public.business_accounts b where b.organization_id = v_org and b.company_id = v_company and b.credit_status = 'watch' and b.is_active),
      'customers', coalesce((
        select jsonb_agg(x order by n)
          from (
            select jsonb_build_object(
                     'name', left(c.name, 80),
                     'documents', count(*),
                     'max_days_overdue', max(v.dias)
                   ) as x,
                   row_number() over (order by max(v.dias) desc, count(*) desc, c.name) as n
              from vencidos v
              join public.customers c on c.id = v.customer_id
             group by c.id, c.name
             order by max(v.dias) desc, count(*) desc, c.name
             limit 5
          ) t
      ), '[]'::jsonb)
    )
      into v_credit;
  end if;

  return jsonb_build_object(
    'generated_at', v_now,
    'period_days', v_days,
    'currency', v_kpis -> 'currency',
    'catalog', jsonb_build_object(
      'products',    v_kpis -> 'products',
      'published',   v_kpis -> 'published',
      'unpublished', greatest(coalesce((v_kpis ->> 'products')::int, 0) - coalesce((v_kpis ->> 'published')::int, 0), 0),
      'top_products', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku', left(tp ->> 'sku', 60),
                 'name', left(tp ->> 'name', 80),
                 'units', (tp ->> 'units')::int,
                 'revenue', tp ->> 'revenue'))
          from (select tp from jsonb_array_elements(coalesce(v_kpis -> 'top_products', '[]'::jsonb)) tp limit 5) s
      ), '[]'::jsonb)
    ),
    'sales', jsonb_build_object(
      'currency',           v_cur -> 'currency',
      'gross_current',      v_cur -> 'gross_sales',
      'gross_previous',     v_prev -> 'gross_sales',
      'gross_delta_pct',    case
                              when v_sales_cur is not null and v_sales_prev is not null and v_sales_prev > 0
                               and (v_cur ->> 'currency') is not distinct from (v_prev ->> 'currency')
                                then round((v_sales_cur - v_sales_prev) / v_sales_prev * 100, 1)::text
                            end,
      'orders_current',     v_ord_cur,
      'orders_previous',    v_ord_prev,
      'orders_delta_pct',   case when v_ord_prev > 0
                              then round((v_ord_cur - v_ord_prev)::numeric / v_ord_prev * 100, 1)::text end,
      'avg_ticket_current', v_cur -> 'average_ticket',
      'avg_ticket_previous', v_prev -> 'average_ticket',
      'conversion_rate',    v_cur -> 'conversion_rate',
      'abandonment_rate',   v_cur -> 'abandonment_rate',
      'orders_total',       v_kpis -> 'orders',
      'sales_total',        v_kpis -> 'sales'
    ),
    'orders', v_orders,
    'inventory', v_inventory,
    'fulfillment', v_fulfill,
    'credit', v_credit
  );
end;
$fn$;

revoke execute on function public.ai_dashboard_facts(uuid) from public, anon;
grant  execute on function public.ai_dashboard_facts(uuid) to authenticated, service_role;

comment on function public.ai_dashboard_facts(uuid) is
  'Dataset REDUCIDO del analista IA del dashboard (fase 02; pedidos recientes y id de pedido 2026-09-23): agregados y listas <=5, calculados en SQL bajo la RLS de quien llama (security invoker). Owner/admin. El modelo solo cita estas cifras por clave.';
