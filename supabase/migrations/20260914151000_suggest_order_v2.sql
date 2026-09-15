-- =============================================================================
-- Cierre · item 11 · Sugerido de pedido v2 (`history_seasonal_v2`).
--
-- ## Lo que v1 no miraba
--
-- `ebim.suggest_order` (historic_v1) suma lo que el cliente compro en los
-- ultimos N dias y lo propone tal cual. Es honesto, pero:
--  · un mes raro lo desvia entero (no hay una ventana larga que lo modere);
--  · no sabe que diciembre no es marzo;
--  · propone productos despublicados, fuera del surtido del cliente o que el
--    canal ya no vende — y el checkout los rechazaria despues;
--  · propone 40 unidades de algo que no hay.
--
-- v1 SE QUEDA: es el fallback de v2 y la base de comparacion. Nada de lo que ya
-- se guardo con `historic_v1` cambia de significado.
--
-- ## Las reglas de v2, escritas para poder defenderlas delante del cliente
--
-- 1. HISTORIAL EN DOS VENTANAS. Reciente R = p_days; larga L = max(3R, 90).
--    Ritmo diario de cada una = unidades / dias. Si hubo compras ANTES de la
--    ventana reciente (larga > reciente), el ritmo base mezcla 60 % reciente y
--    40 % largo: lo reciente manda, lo largo amortigua el mes raro. Si todo lo
--    comprado cae en la ventana reciente, se usa solo el ritmo reciente (no hay
--    nada con que mezclar, y mezclar con ceros inventaria una caida).
--    Sin ninguna compra en la ventana larga no hay linea: la temporada modula
--    una demanda que existe, no la crea.
--
-- 2. TEMPORADA, SOLO CON DATOS. Factor = ritmo en la MISMA ventana de hace un
--    año [hoy-365, hoy-365+R) / ritmo medio de los ultimos 365 dias, acotado a
--    [0.5, 2.0]. Solo se aplica si la primera compra de ese producto tiene al
--    menos un año, hay 3 o mas pedidos con el en los ultimos 365 dias y vendio
--    algo en ese año. Si no, factor 1 y `inputs.seasonal.applied = false` con
--    el motivo: sin un año de historia, un «estacional» es un numero inventado.
--
-- 3. DEMANDA = redondeo(ritmo base × R × factor). Entera, porque el pipeline de
--    pedidos solo acepta cantidades enteras. Menos de 1 = no hay linea.
--
-- 4. AUTORIZACION ANTES QUE CANTIDAD. Solo productos `published` de la tienda;
--    variante, si la hay, activa; permitidos por `ebim.product_in_assortment`
--    (con el canal del ultimo pedido del cliente, para la precedencia por
--    canal); y, si ese canal tiene catalogo declarado en `product_channels`,
--    presentes en el. Un SKU que no se puede vender no se propone nunca, ni
--    siquiera en el fallback.
--
-- 5. ATP (`ebim.atp`, foto sin compromiso):
--    · conocido y sin venta bajo cero → la cantidad se RECORTA a lo disponible
--      (`capped`); si no hay nada, la linea sale con cantidad 0 y `shortage`
--      para que la persona sepa que falta, y no se guarda;
--    · desconocido (almacen ERP caducado) o con venta bajo cero permitida → NO
--      se recorta, y el motivo lo dice. Recortar a un «no se sabe» seria
--      inventar un cero.
--
-- 6. FALLBACK. Si v2 no produce ninguna linea (sin datos suficientes o toda la
--    demanda redondea a cero), se devuelve v1 marcado `historic_v1`, con
--    `inputs.fallback = true`, filtrado por las MISMAS reglas de autorizacion
--    del punto 4. El fallback cambia el modelo, no lo que se puede vender.
--
-- ## Autorizacion: la misma que v1
--
-- `ebim.suggest_order_v2` y su puerta `public.suggest_order_v2` son SECURITY
-- INVOKER, igual que v1: la RLS de `orders`, `order_items` y
-- `business_accounts` con el JWT de quien llama decide que historial existe.
-- La unica pieza DEFINER es `ebim.suggest_order_atp`, porque `ebim.atp` no se
-- concede a `authenticated`; comprueba dentro que quien llama es miembro de la
-- sociedad de la tienda y, si no, responde «no se sabe» sin leer nada.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ebim.suggest_order_atp — ATP para el sugerido, con la autorizacion dentro.
-- ---------------------------------------------------------------------------
create or replace function ebim.suggest_order_atp(
  p_store   uuid,
  p_product uuid,
  p_variant uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid;
  v_company uuid;
begin
  select s.organization_id, s.company_id into v_org, v_company
  from public.stores s where s.id = p_store;

  -- Sin pertenencia no hay foto: `null` se lee como «no se sabe», nunca como
  -- cero, y no revela si la tienda o el producto existen.
  if v_org is null or not ebim.can_access(v_org, v_company) then
    return null;
  end if;

  begin
    return ebim.atp(p_store, p_product, p_variant);
  exception when others then
    -- Un kit mal definido (`KIT_SIN_COMPONENTES`) no puede tumbar el sugerido
    -- entero: esa linea queda como disponibilidad desconocida.
    return jsonb_build_object(
      'available', null, 'unknown', true, 'backorder', false,
      'source', 'error', 'warehouses', 0);
  end;
end;
$fn$;

revoke execute on function ebim.suggest_order_atp(uuid, uuid, uuid) from public, anon;
grant  execute on function ebim.suggest_order_atp(uuid, uuid, uuid) to authenticated, service_role;
-- ---------------------------------------------------------------------------
-- ebim.suggest_order_v2 — devuelve FILAS explicadas. No crea nada.
-- ---------------------------------------------------------------------------
create or replace function ebim.suggest_order_v2(
  p_store    uuid,
  p_customer uuid,
  p_days     int default 30
)
returns table (
  product_id           uuid,
  variant_id           uuid,
  suggested_quantity   numeric,
  last_period_quantity numeric,
  on_hand_quantity     numeric,
  reason               text,
  inputs               jsonb,
  model_code           text
)
language plpgsql
stable
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_recent     int;
  v_long       int;
  v_channel    uuid;
  v_scoped     boolean;
  v_assortment uuid;
begin
  if p_days is null or p_days < 7 or p_days > 180 then
    raise exception 'CAMPO_INVALIDO: la ventana debe estar entre 7 y 180 dias'
      using errcode = '22023';
  end if;

  v_recent := p_days;
  v_long   := greatest(p_days * 3, 90);

  -- El canal por el que compro por ultima vez: es el que decide la precedencia
  -- por canal del surtido y el catalogo declarado en `product_channels`.
  select o.channel_id into v_channel
  from public.orders o
  join public.business_accounts ba on ba.id = o.business_account_id
  where o.store_id = p_store
    and ba.customer_id = p_customer
    and o.status <> 'cancelled'
  order by o.created_at desc
  limit 1;

  v_scoped := v_channel is not null and exists (
    select 1 from public.product_channels pc where pc.channel_id = v_channel);
  v_assortment := ebim.assortment_for_customer(p_store, p_customer, v_channel);

  return query
  with hist as (
    -- El mismo universo que v1: pedidos no cancelados de las cuentas B2B de
    -- este cliente en esta tienda. Sin limite inferior de fecha: la regla de
    -- temporada necesita saber cuando fue la PRIMERA compra.
    select i.product_id as pid,
           i.variant_id as vid,
           o.id         as oid,
           o.created_at as at,
           i.quantity::numeric as qty
    from public.orders o
    join public.order_items i on i.order_id = o.id
    join public.business_accounts ba on ba.id = o.business_account_id
    where o.store_id = p_store
      and ba.customer_id = p_customer
      and o.status <> 'cancelled'
      and i.product_id is not null
  ),
  agg as (
    select h.pid, h.vid,
      coalesce(sum(h.qty) filter (where h.at >= now() - make_interval(days => v_recent)), 0) as q_recent,
      coalesce(sum(h.qty) filter (where h.at >= now() - make_interval(days => v_long)), 0)   as q_long,
      coalesce(sum(h.qty) filter (where h.at >= now() - interval '365 days'), 0)            as q_year,
      coalesce(sum(h.qty) filter (
        where h.at >= now() - interval '365 days'
          and h.at <  now() - interval '365 days' + make_interval(days => v_recent)), 0)    as q_season,
      count(distinct h.oid) filter (where h.at >= now() - interval '365 days')              as orders_year,
      min(h.at) as first_at
    from hist h
    group by h.pid, h.vid
  ),
  ritmo as (
    select a.*,
      a.q_recent / v_recent as r_recent,
      a.q_long / v_long     as r_long,
      a.q_long > a.q_recent as blended,
      case when a.q_long > a.q_recent
           then 0.6 * (a.q_recent / v_recent) + 0.4 * (a.q_long / v_long)
           else a.q_recent / v_recent
      end as r_base,
      (a.first_at <= now() - interval '365 days' and a.orders_year >= 3 and a.q_year > 0) as seasonal_ok
    from agg a
    where a.q_long > 0
  ),
  temporada as (
    select r.*,
      case when r.seasonal_ok
           then least(2.0, greatest(0.5, (r.q_season / v_recent) / (r.q_year / 365.0)))
           else 1.0
      end as factor
    from ritmo r
  ),
  autorizados as (
    select t.*
    from temporada t
    join public.products p
      on p.id = t.pid and p.store_id = p_store and p.status = 'published'
    left join public.product_variants pv on pv.id = t.vid
    where (t.vid is null or coalesce(pv.is_active, false))
      and ebim.product_in_assortment(p_store, p_customer, t.pid, v_channel)
      and (not v_scoped or exists (
        select 1 from public.product_channels pc
        where pc.channel_id = v_channel and pc.product_id = t.pid))
  ),
  demanda as (
    select au.*,
      round(au.r_base * v_recent * au.factor)::numeric as demand,
      ebim.suggest_order_atp(p_store, au.pid, au.vid) as atp
    from autorizados au
  ),
  con_atp as (
    select d.*,
      case
        when d.atp is null or coalesce((d.atp ->> 'unknown')::boolean, true) then 'unknown'
        when coalesce((d.atp ->> 'backorder')::boolean, false) then 'backorder'
        else 'known'
      end as atp_state,
      greatest(floor(coalesce((d.atp ->> 'available')::numeric, 0)), 0) as available
    from demanda d
    where d.demand >= 1
  ),
  final as (
    select c.*,
      case when c.atp_state = 'known' then least(c.demand, c.available) else c.demand end as qty,
      (c.atp_state = 'known' and c.available < c.demand) as capped,
      (c.atp_state = 'known' and c.available < 1) as shortage
    from con_atp c
  )
  select f.pid,
         f.vid,
         f.qty,
         f.q_recent,
         case when f.atp_state = 'unknown' then null else f.available end,
         left(
           case when f.blended
                then format('Compró %s en los últimos %s días y %s en los últimos %s (ritmo reciente %s/día frente a %s/día)',
                            f.q_recent, v_recent, f.q_long, v_long,
                            round(f.r_recent, 2), round(f.r_long, 2))
                else format('Compró %s en los últimos %s días', f.q_recent, v_recent)
           end
           || case when f.seasonal_ok
                   then format('. Temporada: hace un año, en estas fechas, compró al %s× de su promedio', round(f.factor, 2))
                   else ''
              end
           || format('. Demanda estimada: %s', f.demand)
           || case
                when f.shortage then '. Sin disponibilidad ahora: no se propone cantidad'
                when f.capped then format('. Limitado a %s disponibles', f.available)
                when f.atp_state = 'unknown' then '. Disponibilidad sin confirmar'
                when f.atp_state = 'backorder' then '. Se admite pedido sin existencia'
                else ''
              end,
           400),
         jsonb_build_object(
           'model', 'history_seasonal_v2',
           'fallback', false,
           'windows', jsonb_build_object('recent_days', v_recent, 'long_days', v_long),
           'quantities', jsonb_build_object(
             'recent', f.q_recent, 'long', f.q_long,
             'last_365_days', f.q_year, 'same_window_last_year', f.q_season),
           'rates', jsonb_build_object(
             'recent', round(f.r_recent, 4), 'long', round(f.r_long, 4), 'base', round(f.r_base, 4)),
           'blend', case when f.blended
                         then jsonb_build_object('recent', 0.6, 'long', 0.4)
                         else jsonb_build_object('recent', 1, 'long', 0) end,
           'seasonal', jsonb_build_object(
             'applied', f.seasonal_ok,
             'factor', round(f.factor, 4),
             'reason', case
               when f.seasonal_ok then 'historial_anual'
               when f.first_at > now() - interval '365 days' then 'menos_de_un_anio'
               when f.orders_year < 3 then 'pocos_pedidos'
               else 'sin_ventas_en_el_anio'
             end),
           'demand', f.demand,
           'atp', jsonb_build_object(
             'state', f.atp_state,
             'available', case when f.atp_state = 'unknown' then null else f.available end,
             'source', f.atp ->> 'source'),
           'capped', f.capped,
           'shortage', f.shortage,
           'channel_id', v_channel,
           'assortment_id', v_assortment),
         'history_seasonal_v2'::text
  from final f
  order by f.demand desc, f.pid;

  if found then
    return;
  end if;

  -- ---- Fallback: v1, con las mismas reglas de autorizacion -----------------
  return query
  select s.product_id,
         s.variant_id,
         s.suggested_quantity,
         s.last_period_quantity,
         case when coalesce((a.atp ->> 'unknown')::boolean, true) then null
              else greatest(floor(coalesce((a.atp ->> 'available')::numeric, 0)), 0) end,
         left(s.reason || '. Modelo simple: no hubo datos suficientes para el sugerido con temporada', 400),
         jsonb_build_object(
           'model', 'historic_v1',
           'fallback', true,
           'fallback_reason', 'v2_sin_lineas',
           'windows', jsonb_build_object('recent_days', p_days),
           'atp', jsonb_build_object(
             'state', case when coalesce((a.atp ->> 'unknown')::boolean, true) then 'unknown' else 'known' end,
             'available', a.atp -> 'available',
             'source', a.atp ->> 'source'),
           'channel_id', v_channel,
           'assortment_id', v_assortment),
         'historic_v1'::text
  from ebim.suggest_order(p_store, p_customer, p_days) s
  join public.products p
    on p.id = s.product_id and p.store_id = p_store and p.status = 'published'
  left join public.product_variants pv on pv.id = s.variant_id
  cross join lateral (select ebim.suggest_order_atp(p_store, s.product_id, s.variant_id) as atp) a
  where (s.variant_id is null or coalesce(pv.is_active, false))
    and ebim.product_in_assortment(p_store, p_customer, s.product_id, v_channel)
    and (not v_scoped or exists (
      select 1 from public.product_channels pc
      where pc.channel_id = v_channel and pc.product_id = s.product_id));
end;
$fn$;

revoke execute on function ebim.suggest_order_v2(uuid, uuid, int) from public, anon;
grant  execute on function ebim.suggest_order_v2(uuid, uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.suggest_order_v2 — la puerta para PostgREST. Misma autorizacion que la
-- de v1: security INVOKER, `anon` fuera, la RLS del llamante decide.
-- ---------------------------------------------------------------------------
create or replace function public.suggest_order_v2(
  p_store    uuid,
  p_customer uuid,
  p_days     int default 30
)
returns table (
  product_id           uuid,
  variant_id           uuid,
  suggested_quantity   numeric,
  last_period_quantity numeric,
  on_hand_quantity     numeric,
  reason               text,
  inputs               jsonb,
  model_code           text
)
language sql
stable
set search_path = ''
as $fn$
  select * from ebim.suggest_order_v2(p_store, p_customer, p_days);
$fn$;

revoke execute on function public.suggest_order_v2(uuid, uuid, int) from public, anon;
grant  execute on function public.suggest_order_v2(uuid, uuid, int) to authenticated, service_role;

comment on function ebim.suggest_order_v2(uuid, uuid, int) is
  'Sugerido history_seasonal_v2: dos ventanas, temporada solo con un año de datos, surtido/canal/publicado y ATP. Cae a historic_v1 si no hay lineas. No crea nada.';
comment on function public.suggest_order_v2(uuid, uuid, int) is
  'Puerta publica de ebim.suggest_order_v2 para PostgREST. Security INVOKER, igual que suggest_order.';
comment on function ebim.suggest_order_atp(uuid, uuid, uuid) is
  'ATP para el sugerido. DEFINER con can_access dentro: sin pertenencia devuelve null (no se sabe).';