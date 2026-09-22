-- =============================================================================
-- Inventario y planificación con IA (EBIM_AI_SEQUENCE, fase 05) — DATASETS.
--
-- Tres funciones, lo ÚNICO que ve el modelo en Inventario y Planificación:
--
--   public.ai_inventory_facts(p_store_id, n)             señales de existencia
--   public.ai_planning_facts(p_store_id, p_product_id)   previsión frente a venta
--   public.ai_suggestion_facts(p_store_id, cliente, d)   el sugerido v2, tal cual
--
-- ## CÁLCULO DEL SISTEMA, aquí; INTERPRETACIÓN IA, fuera
--
-- Toda cifra (cobertura, ritmo, error de la previsión, factor de temporada) y
-- toda SEÑAL (riesgo de quiebre, exceso, inmovilizado, alta rotación,
-- movimiento atípico, previsión desviada, tendencia) se calcula en SQL con
-- umbrales DECLARADOS en este archivo y devueltos en `thresholds`. El modelo
-- solo las cita por clave y las explica. No hay aquí ninguna cantidad de
-- reposición: la única cantidad «a pedir» del sistema es la de
-- `ebim.suggest_order_v2` (`history_seasonal_v2`), que `ai_suggestion_facts`
-- LLAMA y devuelve sin tocar — no se reimplementa ni se recalcula.
--
-- ## Reglas comunes (las de las fases 02 y 04)
--
--  1. SECURITY INVOKER + STABLE: RLS de quien llama, solo lectura. Filtradas
--     además por la sociedad ACTIVA del token.
--  2. Guard de rol = roles de la funcionalidad (`ebim.ai_feature_roles`):
--     `inventory` (owner, admin, catalog, orders, viewer) y `planning` (owner,
--     admin, catalog, orders). Además el MÓDULO contratado
--     (`inventory.multiwarehouse`, `planning.demand`): no son baseline, y la
--     pantalla ya está gateada por ellos. Tienda ajena ⇒ `SIN_PERMISO`.
--  3. Reducido: listas con tope, textos recortados, sin datos de clientes (el
--     sugerido no lleva ni el nombre del cliente). Los textos libres que sí
--     viajan (nombre del producto, motivo de un movimiento) son DATO NO
--     CONFIABLE y la Edge Function los delimita.
--  4. La demanda se mide en UNIDADES BASE (`order_items.base_quantity`), que
--     es la unidad de la existencia; pedidos no cancelados de la tienda.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Guard común por funcionalidad + módulo
-- ---------------------------------------------------------------------------
create or replace function ebim.assert_ai_feature_reader(p_feature text, p_module text)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_roles   public.app_role[] := ebim.ai_feature_roles(p_feature);
begin
  if v_org is null or v_company is null then
    raise exception 'SIN_PERMISO: el token no trae la jerarquia de tenant' using errcode = '42501';
  end if;
  if v_roles is null or not ebim.has_role(v_org, v_company, v_roles) then
    raise exception 'SIN_PERMISO: tu rol no puede usar la IA de este modulo' using errcode = '42501';
  end if;
  if p_module is not null and not ebim.company_is_entitled(v_org, v_company, p_module) then
    raise exception 'MODULO_NO_CONTRATADO: el modulo no esta contratado' using errcode = '42501';
  end if;
end;
$fn$;

revoke execute on function ebim.assert_ai_feature_reader(text, text) from public, anon;
grant  execute on function ebim.assert_ai_feature_reader(text, text) to authenticated, service_role;

comment on function ebim.assert_ai_feature_reader(text, text) is
  'Guard de los datasets de IA (fase 05): roles de la funcionalidad (ebim.ai_feature_roles) y modulo contratado. Security invoker.';

-- ---------------------------------------------------------------------------
-- 1 · Inventario: señales por producto de la tienda
-- ---------------------------------------------------------------------------
-- Umbrales (se devuelven en `thresholds` y los repite `aiInventory.ts`):
--   ventana de venta 30 d · ventana larga 90 d · riesgo de quiebre: cobertura
--   < 14 d · exceso: cobertura > 120 d · inmovilizado: sin venta en 60 d (el
--   mismo criterio del dashboard) · alta rotación: vendió en 30 d al menos lo
--   que hay disponible (y ≥ 5 u) · movimiento atípico (30 d): ajuste/recuento
--   de ≥ max(5 u, 50 % de la existencia previa), o salida ≥ 3× la salida media
--   de 90 d (con ≥ 3 salidas).
--
-- Alcance de la tienda (ADR 018): los almacenes que la sirven
-- (`store_warehouses` activos) o, si no declara ninguno, los activos de la
-- sociedad — el mismo criterio de la pantalla de Existencias.
create or replace function public.ai_inventory_facts(p_store_id uuid, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now      timestamptz := now();
  v_org      uuid;
  v_company  uuid;
  v_limit    integer := least(greatest(coalesce(p_limit, 25), 1), 25);
  v_declared boolean;
  v_result   jsonb;
begin
  perform ebim.assert_ai_feature_reader('inventory', 'inventory.multiwarehouse');
  perform ebim.assert_ai_orders_store(p_store_id);
  v_org := ebim.org_id();
  v_company := ebim.active_company();

  select exists (select 1 from public.store_warehouses sw where sw.store_id = p_store_id)
    into v_declared;

  with almacenes as (
    select w.id, w.code, w.source, w.stale_after
      from public.warehouses w
     where w.organization_id = v_org
       and w.company_id = v_company
       and w.is_active
       and (not v_declared or exists (
             select 1 from public.store_warehouses sw
              where sw.store_id = p_store_id and sw.warehouse_id = w.id and sw.is_active))
  ),
  niveles as (
    select l.product_id, l.variant_id,
           sum(l.on_hand_qty)   as on_hand,
           sum(l.reserved_qty)  as reserved,
           sum(l.available_qty) as available,
           sum(l.reorder_point) as reorder_point,
           sum(l.safety_stock)  as safety_stock,
           count(*)             as warehouses,
           bool_or(a.source = 'erp' and a.stale_after is not null
                   and l.synced_at < v_now - a.stale_after) as stale
      from public.inventory_levels l
      join almacenes a on a.id = l.warehouse_id
     where l.organization_id = v_org and l.company_id = v_company
     group by l.product_id, l.variant_id
  ),
  ventas as (
    select i.product_id, i.variant_id,
           coalesce(sum(i.base_quantity) filter (where o.placed_at >= v_now - interval '30 days'), 0) as sold_30,
           coalesce(sum(i.base_quantity) filter (where o.placed_at >= v_now - interval '90 days'), 0) as sold_90,
           max(o.placed_at) as last_sale
      from public.order_items i
      join public.orders o on o.id = i.order_id
     where o.store_id = p_store_id
       and o.organization_id = v_org
       and o.company_id = v_company
       and o.status <> 'cancelled'
       and o.placed_at >= v_now - interval '365 days'
       and i.product_id is not null
     group by i.product_id, i.variant_id
  ),
  mov as (
    select m.id, m.product_id, m.variant_id, m.kind, m.quantity, m.on_hand_after,
           m.occurred_at, m.reason, a.code as warehouse_code
      from public.inventory_movements m
      join almacenes a on a.id = m.warehouse_id
     where m.organization_id = v_org and m.company_id = v_company
       and m.occurred_at >= v_now - interval '90 days'
  ),
  base_salidas as (
    select x.product_id, x.variant_id, avg(abs(x.quantity)) as avg_issue, count(*) as n_issue
      from mov x
     where x.kind = 'issue'
     group by x.product_id, x.variant_id
  ),
  atipicos as (
    select m.*
      from mov m
      left join base_salidas b
        on b.product_id = m.product_id and b.variant_id is not distinct from m.variant_id
     where m.occurred_at >= v_now - interval '30 days'
       and (
         (m.kind in ('adjustment', 'count')
          and abs(m.quantity) >= greatest(5, 0.5 * abs(m.on_hand_after - m.quantity)))
         or (m.kind = 'issue' and coalesce(b.n_issue, 0) >= 3 and abs(m.quantity) >= 3 * b.avg_issue)
       )
  ),
  filas as (
    select n.*,
           coalesce(v.sold_30, 0) as sold_30,
           coalesce(v.sold_90, 0) as sold_90,
           v.last_sale,
           coalesce(v.sold_30, 0) / 30.0 as rate_30,
           coalesce(v.sold_90, 0) / 90.0 as rate_90,
           (select count(*) from atipicos t
             where t.product_id = n.product_id and t.variant_id is not distinct from n.variant_id) as atypical
      from niveles n
      left join ventas v
        on v.product_id = n.product_id and v.variant_id is not distinct from n.variant_id
  ),
  clasificadas as (
    select f.*,
           case when f.rate_30 > 0 then f.available / f.rate_30 end as cover,
           array_remove(array[
             case when f.available <= 0 and f.sold_90 > 0 then 'stockout' end,
             case when f.available < 0 then 'negative' end,
             case when f.available > 0 and f.rate_30 > 0 and f.available / f.rate_30 < 14 then 'stockout_risk' end,
             case when f.reorder_point > 0 and f.available >= 0 and f.available <= f.reorder_point then 'below_reorder' end,
             case when coalesce(f.stale, false) then 'stale' end,
             case when f.atypical > 0 then 'atypical_movement' end,
             case when f.rate_30 > 0 and f.available / f.rate_30 > 120 then 'excess' end,
             case when f.available > 0 and (f.last_sale is null or f.last_sale < v_now - interval '60 days') then 'stagnant' end,
             case when f.sold_30 >= 5 and f.available > 0 and f.available <= f.sold_30 then 'high_rotation' end
           ]::text[], null) as signals
      from filas f
  ),
  ordenadas as (
    select c.*,
           case
             when c.signals && array['stockout', 'negative', 'stockout_risk'] then 0
             when c.signals && array['below_reorder', 'stale', 'atypical_movement'] then 1
             else 2
           end as rank
      from clasificadas c
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'thresholds', jsonb_build_object(
      'sales_window_days', 30, 'long_window_days', 90, 'cover_risk_days', 14,
      'excess_cover_days', 120, 'stagnant_days', 60, 'high_rotation_min_units', 5,
      'atypical_issue_factor', 3),
    'totals', jsonb_build_object(
      'tracked', (select count(*) from ordenadas),
      'with_signals', (select count(*) from ordenadas where cardinality(signals) > 0),
      'stockout', (select count(*) from ordenadas where 'stockout' = any(signals)),
      'negative', (select count(*) from ordenadas where 'negative' = any(signals)),
      'stockout_risk', (select count(*) from ordenadas where 'stockout_risk' = any(signals)),
      'below_reorder', (select count(*) from ordenadas where 'below_reorder' = any(signals)),
      'stale', (select count(*) from ordenadas where 'stale' = any(signals)),
      'atypical_movement', (select count(*) from ordenadas where 'atypical_movement' = any(signals)),
      'excess', (select count(*) from ordenadas where 'excess' = any(signals)),
      'stagnant', (select count(*) from ordenadas where 'stagnant' = any(signals)),
      'high_rotation', (select count(*) from ordenadas where 'high_rotation' = any(signals)),
      'unmapped', (select count(*) from public.inventory_alerts ia
                    where ia.kind = 'unmapped' and ia.store_id = p_store_id
                      and ia.organization_id = v_org and ia.company_id = v_company)),
    'limit', v_limit,
    'items', coalesce((
      select jsonb_agg(x order by n)
        from (
          select jsonb_build_object(
                   'product_id', o.product_id,
                   'variant_id', o.variant_id,
                   'sku', left(coalesce(pv.sku, p.sku), 60),
                   'name', left(coalesce(pv.name, p.name), 80),
                   'on_hand', round(o.on_hand, 2)::text,
                   'reserved', round(o.reserved, 2)::text,
                   'available', round(o.available, 2)::text,
                   'reorder_point', round(o.reorder_point, 2)::text,
                   'safety_stock', round(o.safety_stock, 2)::text,
                   'sold_30d', round(o.sold_30, 2)::text,
                   'sold_90d', round(o.sold_90, 2)::text,
                   'daily_rate_30d', round(o.rate_30, 3)::text,
                   'cover_days', case when o.cover is null then null else round(o.cover, 1)::text end,
                   'days_since_last_sale', case when o.last_sale is null then null
                     else floor(extract(epoch from (v_now - o.last_sale)) / 86400)::int end,
                   'atypical_movements', o.atypical,
                   'warehouses', o.warehouses,
                   'signals', to_jsonb(o.signals)
                 ) as x,
                 row_number() over (order by o.rank, o.sold_30 desc, o.available asc, o.product_id) as n
            from ordenadas o
            join public.products p on p.id = o.product_id
            left join public.product_variants pv on pv.id = o.variant_id
           where cardinality(o.signals) > 0
           order by o.rank, o.sold_30 desc, o.available asc, o.product_id
           limit v_limit
        ) t
    ), '[]'::jsonb),
    'atypical', coalesce((
      select jsonb_agg(x order by n)
        from (
          select jsonb_build_object(
                   'product_id', a.product_id,
                   'variant_id', a.variant_id,
                   'name', left(coalesce(pv.name, p.name), 80),
                   'kind', a.kind,
                   'quantity', round(a.quantity, 2)::text,
                   'on_hand_before', round(a.on_hand_after - a.quantity, 2)::text,
                   'days_ago', floor(extract(epoch from (v_now - a.occurred_at)) / 86400)::int,
                   'warehouse_code', left(a.warehouse_code, 30),
                   'reason', left(a.reason, 120)
                 ) as x,
                 row_number() over (order by abs(a.quantity) desc, a.occurred_at desc, a.id) as n
            from atipicos a
            join public.products p on p.id = a.product_id
            left join public.product_variants pv on pv.id = a.variant_id
           order by abs(a.quantity) desc, a.occurred_at desc, a.id
           limit 10
        ) t
    ), '[]'::jsonb)
  )
    into v_result;

  return v_result;
end;
$fn$;

revoke execute on function public.ai_inventory_facts(uuid, integer) from public, anon;
grant  execute on function public.ai_inventory_facts(uuid, integer) to authenticated, service_role;

comment on function public.ai_inventory_facts(uuid, integer) is
  'Señales de existencia por producto (quiebre, riesgo, bajo punto de pedido, negativo, ERP caducado, movimiento atipico, exceso, inmovilizado, alta rotacion) con umbrales declarados; <=25 productos, <=10 movimientos. Security invoker; roles de la funcionalidad inventory; modulo inventory.multiwarehouse. Fase 05.';

-- ---------------------------------------------------------------------------
-- 2 · Planificación: previsión existente frente a la venta real
-- ---------------------------------------------------------------------------
-- NO produce una previsión. Lee `demand_forecasts` (lo que haya calculado el
-- modelo que sea, con su `model_code`) y la compara con la venta de la tienda:
--   · periodo cerrado (period_end < hoy): error % = (real − previsto)/previsto;
--     desvío ≥ 50 % ⇒ `forecast_over` / `forecast_under`. Previsto 0 y real
--     ≥ 5 u ⇒ `forecast_under`.
--   · periodo en curso: venta a la fecha, sin juicio de error.
--   · con territorio: la venta no se atribuye a territorios ⇒ sin comparación.
-- Observaciones de la venta (no son previsión):
--   · tendencia: últimos 30 d frente a los 30 d previos, ±25 % con ≥ 5 u.
--   · temporada: la MISMA regla de `history_seasonal_v2` a nivel tienda —
--     factor = ritmo de la misma ventana de 30 d hace un año / ritmo medio
--     anual, acotado a [0.5, 2.0], solo con un año de historia, ≥ 3 pedidos
--     y venta en el año. Pico ≥ 1.2, bajo ≤ 0.8.
--   · confianza baja: la última previsión con confianza < 0.5.
--   · sin venta reciente: previsión vigente o futura > 0 y nada vendido en 90 d.
--   · sin previsión: de los 5 productos más vendidos en 30 d, los que no
--     tienen ninguna previsión.
create or replace function public.ai_planning_facts(p_store_id uuid, p_product_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now     timestamptz := now();
  v_today   date := (now() at time zone 'UTC')::date;
  v_org     uuid;
  v_company uuid;
  v_result  jsonb;
begin
  perform ebim.assert_ai_feature_reader('planning', 'planning.demand');
  perform ebim.assert_ai_orders_store(p_store_id);
  v_org := ebim.org_id();
  v_company := ebim.active_company();

  with previstas as (
    select f.*,
           row_number() over (partition by f.product_id, f.variant_id
                              order by f.period_start desc, f.model_code, f.id) as rn
      from public.demand_forecasts f
     where f.store_id = p_store_id
       and f.organization_id = v_org
       and f.company_id = v_company
       and (p_product_id is null or f.product_id = p_product_id)
       and f.period_start <= v_today + 180
  ),
  ultimas as (
    select * from previstas where rn <= 6
  ),
  vendidos as (
    select i.product_id, i.variant_id, o.id as order_id, o.placed_at, i.base_quantity as qty
      from public.order_items i
      join public.orders o on o.id = i.order_id
     where o.store_id = p_store_id
       and o.organization_id = v_org
       and o.company_id = v_company
       and o.status <> 'cancelled'
       and o.placed_at >= v_now - interval '730 days'
       and i.product_id is not null
       and (p_product_id is null or i.product_id = p_product_id)
  ),
  top_sin_prevision as (
    select v.product_id, null::uuid as variant_id
      from vendidos v
     where v.placed_at >= v_now - interval '30 days'
       and not exists (select 1 from previstas f where f.product_id = v.product_id)
     group by v.product_id
     order by sum(v.qty) desc, v.product_id
     limit 5
  ),
  productos as (
    select distinct u.product_id, u.variant_id, true as has_forecast from ultimas u
    union all
    select t.product_id, t.variant_id, false from top_sin_prevision t
  ),
  venta as (
    select p.product_id, p.variant_id, p.has_forecast,
           coalesce(sum(v.qty) filter (where v.placed_at >= v_now - interval '30 days'), 0) as sold_30,
           coalesce(sum(v.qty) filter (where v.placed_at >= v_now - interval '60 days'
                                          and v.placed_at <  v_now - interval '30 days'), 0) as prev_30,
           coalesce(sum(v.qty) filter (where v.placed_at >= v_now - interval '90 days'), 0) as sold_90,
           coalesce(sum(v.qty) filter (where v.placed_at >= v_now - interval '365 days'), 0) as q_year,
           coalesce(sum(v.qty) filter (where v.placed_at >= v_now - interval '365 days'
                                          and v.placed_at <  v_now - interval '335 days'), 0) as q_season,
           count(distinct v.order_id) filter (where v.placed_at >= v_now - interval '365 days') as orders_year,
           coalesce(bool_or(v.placed_at < v_now - interval '365 days'), false) as year_history
      from productos p
      left join vendidos v
        on v.product_id = p.product_id
       and (p.variant_id is null or v.variant_id = p.variant_id)
     group by p.product_id, p.variant_id, p.has_forecast
  ),
  temporada as (
    select v.*,
           (v.year_history and v.orders_year >= 3 and v.q_year > 0) as seasonal_ok,
           case when v.year_history and v.orders_year >= 3 and v.q_year > 0
                then least(2.0, greatest(0.5, (v.q_season / 30.0) / (v.q_year / 365.0)))
           end as factor,
           case
             when v.year_history and v.orders_year >= 3 and v.q_year > 0 then 'historial_anual'
             when not v.year_history then 'menos_de_un_anio'
             when v.orders_year < 3 then 'pocos_pedidos'
             else 'sin_ventas_en_el_anio'
           end as seasonal_reason,
           case when v.prev_30 > 0 then round((v.sold_30 - v.prev_30) / v.prev_30 * 100, 1) end as trend_pct
      from venta v
  ),
  comparadas as (
    select u.product_id, u.variant_id, u.id, u.period_start, u.period_end, u.forecast_quantity,
           u.confidence, u.model_code, u.territory_id,
           case
             when u.territory_id is not null then 'territory'
             when u.period_end < v_today then 'closed'
             when u.period_start <= v_today then 'current'
             else 'future'
           end as phase,
           case when u.territory_id is null and u.period_start <= v_today then (
             select coalesce(sum(v.qty), 0)
               from vendidos v
              where v.product_id = u.product_id
                and (u.variant_id is null or v.variant_id = u.variant_id)
                and (v.placed_at at time zone 'UTC')::date between u.period_start and u.period_end
           ) end as actual
      from ultimas u
  ),
  juzgadas as (
    select c.*,
           case when c.phase = 'closed' and c.forecast_quantity > 0
                then round((c.actual - c.forecast_quantity) / c.forecast_quantity * 100, 1) end as error_pct,
           case
             when c.phase <> 'closed' then null
             when c.forecast_quantity > 0 and c.actual <= c.forecast_quantity * 0.5 then 'forecast_over'
             when c.forecast_quantity > 0 and c.actual >= c.forecast_quantity * 1.5 then 'forecast_under'
             when c.forecast_quantity = 0 and c.actual >= 5 then 'forecast_under'
           end as anomaly
      from comparadas c
  ),
  senales as (
    select t.*,
           array_remove(array[
             case when exists (select 1 from juzgadas j where j.product_id = t.product_id
                                 and j.variant_id is not distinct from t.variant_id
                                 and j.anomaly = 'forecast_over') then 'forecast_over' end,
             case when exists (select 1 from juzgadas j where j.product_id = t.product_id
                                 and j.variant_id is not distinct from t.variant_id
                                 and j.anomaly = 'forecast_under') then 'forecast_under' end,
             case when t.sold_30 >= 5 and (t.prev_30 = 0 or t.sold_30 >= t.prev_30 * 1.25) then 'trend_up' end,
             case when t.prev_30 >= 5 and t.sold_30 <= t.prev_30 * 0.75 then 'trend_down' end,
             case when t.seasonal_ok and t.factor >= 1.2 then 'seasonal_peak' end,
             case when t.seasonal_ok and t.factor <= 0.8 then 'seasonal_low' end,
             case when (select j.confidence from juzgadas j where j.product_id = t.product_id
                          and j.variant_id is not distinct from t.variant_id
                        order by j.period_start desc, j.model_code limit 1) < 0.5 then 'low_confidence' end,
             case when t.has_forecast and t.sold_90 = 0 and exists (
                         select 1 from juzgadas j where j.product_id = t.product_id
                            and j.variant_id is not distinct from t.variant_id
                            and j.phase in ('current', 'future') and j.forecast_quantity > 0) then 'no_recent_sales' end,
             case when not t.has_forecast then 'no_forecast' end
           ]::text[], null) as signals
      from temporada t
  ),
  ordenadas as (
    select s.*,
           case
             when s.signals && array['forecast_over', 'forecast_under'] then 0
             when s.signals && array['no_recent_sales', 'trend_up', 'trend_down', 'no_forecast'] then 1
             else 2
           end as rank
      from senales s
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'today', v_today,
    'thresholds', jsonb_build_object(
      'anomaly_error_pct', 50, 'trend_window_days', 30, 'trend_change_pct', 25,
      'trend_min_units', 5, 'seasonal_window_days', 30, 'seasonal_peak_factor', 1.2,
      'seasonal_low_factor', 0.8, 'low_confidence', 0.5),
    'totals', jsonb_build_object(
      'forecasts', (select count(*) from public.demand_forecasts f
                     where f.store_id = p_store_id and f.organization_id = v_org and f.company_id = v_company
                       and (p_product_id is null or f.product_id = p_product_id)),
      'products_with_forecast', (select count(*) from ordenadas where has_forecast),
      'closed_periods', (select count(*) from juzgadas where phase = 'closed'),
      'anomalies', (select count(*) from juzgadas where anomaly is not null),
      'without_forecast', (select count(*) from ordenadas where not has_forecast)),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object('model_code', left(m.model_code, 60), 'forecasts', m.n) order by m.n desc, m.model_code)
        from (select u.model_code, count(*) as n from ultimas u group by u.model_code order by count(*) desc limit 5) m
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(x order by n)
        from (
          select jsonb_build_object(
                   'product_id', o.product_id,
                   'variant_id', o.variant_id,
                   'sku', left(coalesce(pv.sku, p.sku), 60),
                   'name', left(coalesce(pv.name, p.name), 80),
                   'has_forecast', o.has_forecast,
                   'sales', jsonb_build_object(
                     'last_30d', round(o.sold_30, 2)::text,
                     'prev_30d', round(o.prev_30, 2)::text,
                     'last_90d', round(o.sold_90, 2)::text,
                     'last_365d', round(o.q_year, 2)::text,
                     'same_window_last_year', round(o.q_season, 2)::text,
                     'orders_365d', o.orders_year,
                     'trend_pct', case when o.trend_pct is null then null else o.trend_pct::text end),
                   'seasonal', jsonb_build_object(
                     'applied', o.seasonal_ok,
                     'factor', case when o.factor is null then null else round(o.factor, 2)::text end,
                     'reason', o.seasonal_reason),
                   'forecasts', coalesce((
                     select jsonb_agg(y order by k)
                       from (
                         select jsonb_build_object(
                                  'period_start', j.period_start,
                                  'period_end', j.period_end,
                                  'days', (j.period_end - j.period_start) + 1,
                                  'forecast_quantity', round(j.forecast_quantity, 2)::text,
                                  'confidence', case when j.confidence is null then null else round(j.confidence, 4)::text end,
                                  'model_code', left(j.model_code, 60),
                                  'phase', j.phase,
                                  'actual_quantity', case when j.actual is null then null else round(j.actual, 2)::text end,
                                  'error_pct', case when j.error_pct is null then null else j.error_pct::text end,
                                  'anomaly', j.anomaly
                                ) as y,
                                row_number() over (order by j.period_start desc, j.model_code, j.id) as k
                           from juzgadas j
                          where j.product_id = o.product_id
                            and j.variant_id is not distinct from o.variant_id
                          order by j.period_start desc, j.model_code, j.id
                          limit 6
                       ) z
                   ), '[]'::jsonb),
                   'signals', to_jsonb(o.signals)
                 ) as x,
                 row_number() over (order by o.rank, o.sold_30 desc, o.product_id) as n
            from ordenadas o
            join public.products p on p.id = o.product_id
            left join public.product_variants pv on pv.id = o.variant_id
           order by o.rank, o.sold_30 desc, o.product_id
           limit 15
        ) t
    ), '[]'::jsonb)
  )
    into v_result;

  return v_result;
end;
$fn$;

revoke execute on function public.ai_planning_facts(uuid, uuid) from public, anon;
grant  execute on function public.ai_planning_facts(uuid, uuid) to authenticated, service_role;

comment on function public.ai_planning_facts(uuid, uuid) is
  'Prevision EXISTENTE (demand_forecasts) frente a la venta real de la tienda, tendencia 30/30 d, temporada con la regla de history_seasonal_v2 y señales con umbrales declarados; <=15 productos, <=6 periodos. No calcula prevision. Security invoker; roles de planning; modulo planning.demand. Fase 05.';

-- ---------------------------------------------------------------------------
-- 3 · El sugerido v2, tal cual, para que la IA lo EXPLIQUE
-- ---------------------------------------------------------------------------
-- Llama a `ebim.suggest_order_v2` (security invoker: la RLS del llamante
-- decide el historial, como en la pantalla) y devuelve sus filas SIN tocar
-- las cantidades, con nombre/SKU y el orden del motor. ≤ 20 líneas.
-- Cliente invisible o de otra sociedad ⇒ NULL ⇒ 404.
create or replace function public.ai_suggestion_facts(
  p_store_id    uuid,
  p_customer_id uuid,
  p_days        integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now     timestamptz := now();
  v_org     uuid;
  v_company uuid;
  v_total   bigint;
  v_lines   jsonb;
  v_model   text;
begin
  perform ebim.assert_ai_feature_reader('planning', 'planning.demand');
  perform ebim.assert_ai_orders_store(p_store_id);
  v_org := ebim.org_id();
  v_company := ebim.active_company();

  if not exists (
    select 1 from public.customers c
     where c.id = p_customer_id and c.organization_id = v_org and c.company_id = v_company
  ) then
    return null;
  end if;

  with motor as (
    select s.*
      from ebim.suggest_order_v2(p_store_id, p_customer_id, p_days)
           with ordinality as s(product_id, variant_id, suggested_quantity, last_period_quantity,
                                on_hand_quantity, reason, inputs, model_code, n)
  )
  select (select count(*) from motor),
         (select m.model_code from motor m order by m.n limit 1),
         coalesce((
           select jsonb_agg(x order by n)
             from (
               select jsonb_build_object(
                        'product_id', m.product_id,
                        'variant_id', m.variant_id,
                        'sku', left(coalesce(pv.sku, p.sku), 60),
                        'name', left(coalesce(pv.name, p.name), 80),
                        'suggested_quantity', m.suggested_quantity::text,
                        'last_period_quantity', m.last_period_quantity::text,
                        'on_hand_quantity', case when m.on_hand_quantity is null then null
                                                 else m.on_hand_quantity::text end,
                        'model_code', m.model_code,
                        'inputs', m.inputs
                      ) as x,
                      m.n
                 from motor m
                 join public.products p on p.id = m.product_id
                 left join public.product_variants pv on pv.id = m.variant_id
                order by m.n
                limit 20
             ) t
         ), '[]'::jsonb)
    into v_total, v_model, v_lines;

  return jsonb_build_object(
    'generated_at', v_now,
    'days', p_days,
    'model_code', v_model,
    'total', v_total,
    'lines', v_lines
  );
end;
$fn$;

revoke execute on function public.ai_suggestion_facts(uuid, uuid, integer) from public, anon;
grant  execute on function public.ai_suggestion_facts(uuid, uuid, integer) to authenticated, service_role;

comment on function public.ai_suggestion_facts(uuid, uuid, integer) is
  'Filas de ebim.suggest_order_v2 (history_seasonal_v2 o su fallback historic_v1) SIN recalcular, con nombre/SKU y su explain; <=20. Para que la IA explique el sugerido. Security invoker; roles de planning; modulo planning.demand. Fase 05.';
