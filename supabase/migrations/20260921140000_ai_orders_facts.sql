-- =============================================================================
-- Pedidos con IA (EBIM_AI_SEQUENCE, fase 04) — los DATASETS reducidos.
--
-- Tres funciones, lo ÚNICO que ve el modelo en Pedidos:
--
--   public.ai_order_facts(p_order_id)            un pedido (detalle)
--   public.ai_orders_attention(p_store_id, n)    lote pequeño de pedidos abiertos
--   public.ai_orders_search(p_store_id, …)       búsqueda con filtros TIPADOS
--
-- Reglas comunes (las mismas que `ai_dashboard_facts`, fase 02):
--
--  1. **SECURITY INVOKER.** Leen bajo la RLS de quien llama. La Edge Function
--     las invoca con el JWT del usuario, nunca con `service_role`. Además se
--     filtra por la sociedad ACTIVA del token: un miembro de dos sociedades no
--     mezcla pedidos de ambas.
--  2. **Guard de rol = roles de la funcionalidad `orders`**
--     (`ebim.ai_feature_roles('orders')`: owner, admin, orders, viewer). Un
--     `sales_rep` ve pedidos por RLS, pero no gasta IA sobre ellos.
--  3. **Reducido y sin PII innecesaria.** Nada de correos, teléfonos,
--     direcciones, documentos fiscales, correos de actores ni detalle de
--     errores del proveedor de pago: solo si EXISTEN (booleanos) y códigos.
--     Listas con tope; textos recortados. Los textos libres que sí viajan
--     (nota del comprador, notas internas, motivos) son DATO NO CONFIABLE y la
--     Edge Function los delimita.
--  4. **Calculado aquí, no por el modelo.** Antigüedades, conteos y vencidos
--     salen de SQL. El modelo solo los CITA por clave.
--  5. **Solo lectura.** Ninguna de las tres escribe nada. Los estados se
--     siguen moviendo exclusivamente con `order_transition` /
--     `order_approval_decide` desde el flujo normal de la pantalla.
--
-- Las secciones de módulos (entregas y devoluciones con `fulfillment`, pagos
-- con `payments`, comprobantes con `invoicing`) solo aparecen si la sociedad
-- los tiene contratados: la IA no habla de lo que la pantalla no enseña.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Guard común
-- ---------------------------------------------------------------------------
create or replace function ebim.assert_ai_orders_reader()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
begin
  if v_org is null or v_company is null then
    raise exception 'SIN_PERMISO: el token no trae la jerarquia de tenant' using errcode = '42501';
  end if;
  if not ebim.has_role(v_org, v_company, ebim.ai_feature_roles('orders')) then
    raise exception 'SIN_PERMISO: tu rol no puede usar la IA de pedidos' using errcode = '42501';
  end if;
  -- Sin comprobar el módulo `orders` aquí A PROPÓSITO: es baseline, y lo
  -- baseline no se hace cumplir por entitlement (`capability-enforcement`
  -- test). Gastar cuota sí exige módulo + capacidad de IA en `ai_consume`.
end;
$fn$;

revoke execute on function ebim.assert_ai_orders_reader() from public, anon;
grant  execute on function ebim.assert_ai_orders_reader() to authenticated, service_role;

-- La tienda pedida tiene que ser de la sociedad activa. Una ajena es 403, no
-- una lista vacía que parezca «no hay nada».
create or replace function ebim.assert_ai_orders_store(p_store_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
begin
  if p_store_id is null then
    raise exception 'SIN_PERMISO: falta la tienda' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.stores s
     where s.id = p_store_id
       and s.organization_id = ebim.org_id()
       and s.company_id = ebim.active_company()
  ) then
    raise exception 'SIN_PERMISO: esa tienda no es de tu sociedad' using errcode = '42501';
  end if;
end;
$fn$;

revoke execute on function ebim.assert_ai_orders_store(uuid) from public, anon;
grant  execute on function ebim.assert_ai_orders_store(uuid) to authenticated, service_role;

-- Etiqueta de cliente para el modelo: nombre o cuenta B2B, nunca el correo.
create or replace function ebim.ai_order_customer_label(p_customer_name text, p_snapshot jsonb)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select left(coalesce(
    nullif(btrim(p_snapshot ->> 'account_name'), ''),
    nullif(btrim(p_snapshot ->> 'customer_name'), ''),
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_snapshot ->> 'name'), '')
  ), 80);
$fn$;

revoke execute on function ebim.ai_order_customer_label(text, jsonb) from public, anon;
grant  execute on function ebim.ai_order_customer_label(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1 · Un pedido
-- ---------------------------------------------------------------------------
create or replace function public.ai_order_facts(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org       uuid;
  v_company   uuid;
  v_now       timestamptz := now();
  v_order     public.orders;
  v_last_evt  timestamptz;
  v_items     jsonb;
  v_events    jsonb;
  v_notes     jsonb;
  v_fulfill   jsonb := null;
  v_returns   jsonb := null;
  v_payments  jsonb := null;
  v_invoices  jsonb := null;
begin
  perform ebim.assert_ai_orders_reader();
  v_org := ebim.org_id();
  v_company := ebim.active_company();

  select o.* into v_order
    from public.orders o
   where o.id = p_order_id
     and o.organization_id = v_org
     and o.company_id = v_company;
  -- Invisible (otro tenant, otra sociedad o inexistente): NULL, y la Edge
  -- Function responde 404. Nunca se distingue «existe pero no es tuyo».
  if not found then
    return null;
  end if;

  select max(e.created_at) into v_last_evt
    from public.order_events e where e.order_id = v_order.id;

  select jsonb_build_object(
    'count', count(*),
    'units', coalesce(sum(i.quantity), 0),
    'without_product', count(*) filter (where i.product_id is null),
    'lines', coalesce((
      select jsonb_agg(x order by n)
        from (
          select jsonb_build_object(
                   'name', left(l.name, 80),
                   'variant', left(l.variant_label, 40),
                   'quantity', l.quantity,
                   'line_total', l.line_total::text
                 ) as x,
                 row_number() over (order by l.created_at, l.id) as n
            from public.order_items l
           where l.order_id = v_order.id
           order by l.created_at, l.id
           limit 10
        ) t
    ), '[]'::jsonb)
  )
    into v_items
    from public.order_items i
   where i.order_id = v_order.id;

  -- Los 15 hechos MÁS RECIENTES, en orden cronológico. Sin correo del actor:
  -- el modelo no necesita saber quién, solo desde dónde (`source`).
  select jsonb_build_object(
    'count', (select count(*) from public.order_events e where e.order_id = v_order.id),
    'recent', coalesce((
      select jsonb_agg(x order by created_at, id)
        from (
          select e.id, e.created_at,
                 jsonb_build_object(
                   'event_type', left(e.event_type, 60),
                   'axis', e.axis,
                   'from', left(e.from_value, 40),
                   'to', left(coalesce(e.to_value, e.payload ->> 'to'), 40),
                   'source', e.source,
                   'days_ago', floor(extract(epoch from (v_now - e.created_at)) / 86400)::int,
                   'note', left(e.note, 160)
                 ) as x
            from public.order_events e
           where e.order_id = v_order.id
           order by e.created_at desc, e.id desc
           limit 15
        ) t
    ), '[]'::jsonb)
  )
    into v_events;

  select jsonb_build_object(
    'count', (select count(*) from public.order_notes n where n.order_id = v_order.id),
    'latest', coalesce((
      select jsonb_agg(x order by created_at desc)
        from (
          select n.created_at,
                 jsonb_build_object(
                   'body', left(n.body, 200),
                   'days_ago', floor(extract(epoch from (v_now - n.created_at)) / 86400)::int
                 ) as x
            from public.order_notes n
           where n.order_id = v_order.id
           order by n.created_at desc
           limit 3
        ) t
    ), '[]'::jsonb)
  )
    into v_notes;

  if ebim.company_is_entitled(v_org, v_company, 'fulfillment') then
    select jsonb_build_object(
      'count', count(*),
      'open', count(*) filter (where f.state not in ('delivered', 'cancelled')),
      'delivered', count(*) filter (where f.state = 'delivered'),
      'failed', count(*) filter (where f.state = 'failed'),
      'overdue', count(*) filter (
                   where f.state not in ('delivered', 'cancelled')
                     and f.promised_to is not null
                     and f.promised_to < (v_now at time zone 'UTC')::date),
      'shipment_errors', (
        select count(*) from public.shipments s
         where s.fulfillment_id in (select f2.id from public.fulfillments f2 where f2.order_id = v_order.id)
           and s.last_error_code is not null),
      'with_tracking', (
        select count(*) from public.shipments s
         where s.fulfillment_id in (select f2.id from public.fulfillments f2 where f2.order_id = v_order.id)
           and s.tracking_number is not null),
      'latest', coalesce((
        select jsonb_agg(x order by n)
          from (
            select jsonb_build_object(
                     'sequence', g.sequence,
                     'method', left(g.method_name, 60),
                     'state', g.state,
                     'promised_in_days', case when g.promised_to is null then null
                       else (g.promised_to - (v_now at time zone 'UTC')::date) end,
                     'shipped', g.shipped_at is not null,
                     'delivered', g.delivered_at is not null
                   ) as x,
                   row_number() over (order by g.sequence desc) as n
              from public.fulfillments g
             where g.order_id = v_order.id
             order by g.sequence desc
             limit 3
          ) t
      ), '[]'::jsonb)
    )
      into v_fulfill
      from public.fulfillments f
     where f.order_id = v_order.id;

    select jsonb_build_object(
      'count', count(*),
      'open', count(*) filter (where r.state not in ('completed', 'rejected', 'cancelled')),
      'latest_state', (
        select r2.state from public.return_requests r2
         where r2.order_id = v_order.id order by r2.created_at desc limit 1)
    )
      into v_returns
      from public.return_requests r
     where r.order_id = v_order.id;
  end if;

  -- Pagos: estados y CÓDIGO del último error. El detalle del proveedor no
  -- viaja: puede traer datos del medio de pago.
  if ebim.company_is_entitled(v_org, v_company, 'payments') then
    select jsonb_build_object(
      'count', count(*),
      'failed', count(*) filter (where p.status in ('failed', 'expired', 'cancelled')),
      'requires_action', count(*) filter (where p.status = 'requires_action'),
      'latest_status', (
        select p2.status from public.payment_intents p2
         where p2.order_id = v_order.id order by p2.created_at desc limit 1),
      'last_error_code', (
        select left(p3.last_error_code, 60) from public.payment_intents p3
         where p3.order_id = v_order.id and p3.last_error_code is not null
         order by p3.updated_at desc limit 1)
    )
      into v_payments
      from public.payment_intents p
     where p.order_id = v_order.id;
  end if;

  if ebim.company_is_entitled(v_org, v_company, 'invoicing') then
    select jsonb_build_object(
      'count', count(*),
      'latest_status', (
        select i2.status from public.invoices i2
         where i2.order_id = v_order.id order by i2.created_at desc limit 1)
    )
      into v_invoices
      from public.invoices i
     where i.order_id = v_order.id;
  end if;

  return jsonb_build_object(
    'generated_at', v_now,
    'order', jsonb_build_object(
      'order_number', left(v_order.order_number, 40),
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'approval_status', v_order.approval_status,
      'source_channel', v_order.source_channel,
      'currency', v_order.currency,
      'grand_total', v_order.grand_total::text,
      'subtotal', v_order.subtotal::text,
      'tax_total', v_order.tax_total::text,
      'shipping_total', v_order.shipping_total::text,
      'discount_total', v_order.discount_total::text,
      'age_days', floor(extract(epoch from (v_now - v_order.placed_at)) / 86400)::int,
      'days_since_update', floor(extract(epoch from (
                             v_now - greatest(v_order.placed_at, coalesce(v_order.updated_at, v_order.placed_at),
                                              coalesce(v_last_evt, v_order.placed_at)))) / 86400)::int,
      'customer_label', ebim.ai_order_customer_label(v_order.customer_name, v_order.customer_snapshot),
      'is_b2b', coalesce(v_order.customer_snapshot ->> 'account_code', '') <> '',
      'has_email', coalesce(btrim(v_order.customer_email), '') <> '',
      'has_phone', coalesce(btrim(v_order.customer_phone), '') <> '',
      'has_shipping_address', coalesce(btrim(v_order.shipping_address ->> 'address'), '') <> '',
      'has_billing_address', coalesce(btrim(v_order.billing_address ->> 'address'), '') <> '',
      'has_purchase_order', coalesce(btrim(v_order.purchase_order_number), '') <> '',
      'approval_reason', left(v_order.approval_reason, 200),
      'customer_note', left(v_order.notes, 300),
      'paid', v_order.paid_at is not null,
      'cancelled', v_order.cancelled_at is not null
    ),
    'items', v_items,
    'events', v_events,
    'notes', v_notes,
    'tags', coalesce((
      select jsonb_agg(left(t.tag, 40) order by t.tag)
        from (select tg.tag from public.order_tags tg where tg.order_id = v_order.id order by tg.tag limit 10) t
    ), '[]'::jsonb),
    'external_refs', (select count(*) from public.order_external_refs x where x.order_id = v_order.id),
    'fulfillment', v_fulfill,
    'returns', v_returns,
    'payments', v_payments,
    'invoices', v_invoices
  );
end;
$fn$;

revoke execute on function public.ai_order_facts(uuid) from public, anon;
grant  execute on function public.ai_order_facts(uuid) to authenticated, service_role;

comment on function public.ai_order_facts(uuid) is
  'Dataset REDUCIDO de un pedido para la IA de pedidos (fase 04): ejes, antigüedades, lineas <=10, hechos <=15, notas <=3, secciones por modulo contratado. Sin correos/telefonos/direcciones. Security invoker; roles de la funcionalidad orders. NULL si el pedido no es visible.';

-- ---------------------------------------------------------------------------
-- 2 · Lote pequeño de pedidos abiertos que piden atención
-- ---------------------------------------------------------------------------
-- «Abierto» = comercialmente vivo (`pending`/`paid`) con algo por hacer:
-- firma B2B, pago sin cerrar o entrega sin terminar. El orden es una regla
-- declarada (primero lo que bloquea a otro: firma → pago fallido → pagado sin
-- despachar → sin pago), no una opinión del modelo.
create or replace function public.ai_orders_attention(p_store_id uuid, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now   timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 15);
  v_total bigint;
  v_items jsonb;
begin
  perform ebim.assert_ai_orders_reader();
  perform ebim.assert_ai_orders_store(p_store_id);

  with abiertos as (
    select o.*,
           case
             when o.approval_status = 'pending' then 1
             when o.payment_status = 'failed' then 2
             when o.status = 'paid' and o.fulfillment_status in ('unfulfilled', 'in_progress', 'partially_fulfilled') then 3
             when o.status = 'pending' and o.payment_status in ('pending', 'authorized') then 4
             else 5
           end as prioridad
      from public.orders o
     where o.store_id = p_store_id
       and o.organization_id = ebim.org_id()
       and o.company_id = ebim.active_company()
       and o.status in ('pending', 'paid')
       and (
             o.approval_status = 'pending'
          or o.payment_status in ('pending', 'authorized', 'failed')
          or o.fulfillment_status in ('unfulfilled', 'in_progress', 'partially_fulfilled')
       )
  )
  select (select count(*) from abiertos),
         coalesce((
           select jsonb_agg(x order by n)
             from (
               select jsonb_build_object(
                        'id', a.id,
                        'order_number', left(a.order_number, 40),
                        'status', a.status,
                        'payment_status', a.payment_status,
                        'fulfillment_status', a.fulfillment_status,
                        'approval_status', a.approval_status,
                        'currency', a.currency,
                        'grand_total', a.grand_total::text,
                        'placed_at', a.placed_at,
                        'age_days', floor(extract(epoch from (v_now - a.placed_at)) / 86400)::int,
                        'days_since_update', floor(extract(epoch from (
                                               v_now - greatest(a.placed_at, coalesce(a.updated_at, a.placed_at)))) / 86400)::int,
                        'customer_label', ebim.ai_order_customer_label(a.customer_name, a.customer_snapshot),
                        'has_shipping_address', coalesce(btrim(a.shipping_address ->> 'address'), '') <> ''
                      ) as x,
                      row_number() over (order by a.prioridad, a.placed_at, a.id) as n
                 from abiertos a
                order by a.prioridad, a.placed_at, a.id
                limit v_limit
             ) t
         ), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object(
    'generated_at', v_now,
    'total_open', v_total,
    'limit', v_limit,
    'items', v_items
  );
end;
$fn$;

revoke execute on function public.ai_orders_attention(uuid, integer) from public, anon;
grant  execute on function public.ai_orders_attention(uuid, integer) to authenticated, service_role;

comment on function public.ai_orders_attention(uuid, integer) is
  'Lote PEQUEÑO (<=15) de pedidos abiertos que piden atención, en orden de regla declarada (firma, pago fallido, pagado sin despachar, sin pago). Security invoker; roles de la funcionalidad orders; tienda de la sociedad activa.';

-- ---------------------------------------------------------------------------
-- 3 · Búsqueda con filtros TIPADOS (la «herramienta» de la búsqueda en
--     lenguaje natural)
-- ---------------------------------------------------------------------------
-- El modelo NO escribe SQL ni elige columnas: traduce la frase a estos
-- parámetros (enums cerrados, enteros acotados, un término de texto) y la Edge
-- Function los revisa antes de llamar aquí. Un valor fuera de enum es 400, no
-- «sin filtro»: un filtro ignorado en silencio enseña pedidos que no se
-- pidieron.
create or replace function public.ai_orders_search(
  p_store_id            uuid,
  p_status              text    default null,
  p_payment_status      text    default null,
  p_fulfillment_status  text    default null,
  p_approval_status     text    default null,
  p_source_channel      text    default null,
  p_placed_within_days  integer default null,
  p_older_than_days     integer default null,
  p_text                text    default null,
  p_attention_only      boolean default false,
  p_limit               integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now   timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 25);
  v_text  text := nullif(btrim(coalesce(p_text, '')), '');
  v_like  text;
  v_total bigint;
  v_rows  jsonb;
begin
  perform ebim.assert_ai_orders_reader();
  perform ebim.assert_ai_orders_store(p_store_id);

  if p_status is not null and not (p_status = any (enum_range(null::public.order_status)::text[])) then
    raise exception 'FILTRO_INVALIDO: status' using errcode = '22023';
  end if;
  if p_payment_status is not null and not (p_payment_status = any (enum_range(null::public.payment_status)::text[])) then
    raise exception 'FILTRO_INVALIDO: payment_status' using errcode = '22023';
  end if;
  if p_fulfillment_status is not null and not (p_fulfillment_status = any (enum_range(null::public.fulfillment_status)::text[])) then
    raise exception 'FILTRO_INVALIDO: fulfillment_status' using errcode = '22023';
  end if;
  if p_approval_status is not null and not (p_approval_status = any (enum_range(null::public.order_approval_status)::text[])) then
    raise exception 'FILTRO_INVALIDO: approval_status' using errcode = '22023';
  end if;
  if p_source_channel is not null and not (p_source_channel = any (enum_range(null::public.order_source_channel)::text[])) then
    raise exception 'FILTRO_INVALIDO: source_channel' using errcode = '22023';
  end if;
  if p_placed_within_days is not null and (p_placed_within_days < 1 or p_placed_within_days > 366) then
    raise exception 'FILTRO_INVALIDO: placed_within_days' using errcode = '22023';
  end if;
  if p_older_than_days is not null and (p_older_than_days < 1 or p_older_than_days > 366) then
    raise exception 'FILTRO_INVALIDO: older_than_days' using errcode = '22023';
  end if;
  if v_text is not null and char_length(v_text) > 60 then
    raise exception 'FILTRO_INVALIDO: text' using errcode = '22023';
  end if;

  -- Comodines del usuario (o del modelo) escapados: «%» busca un «%».
  if v_text is not null then
    v_like := '%' || replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with filtrados as (
    select o.*
      from public.orders o
     where o.store_id = p_store_id
       and o.organization_id = ebim.org_id()
       and o.company_id = ebim.active_company()
       and (p_status is null or o.status::text = p_status)
       and (p_payment_status is null or o.payment_status::text = p_payment_status)
       and (p_fulfillment_status is null or o.fulfillment_status::text = p_fulfillment_status)
       and (p_approval_status is null or o.approval_status::text = p_approval_status)
       and (p_source_channel is null or o.source_channel::text = p_source_channel)
       and (p_placed_within_days is null or o.placed_at >= v_now - make_interval(days => p_placed_within_days))
       and (p_older_than_days is null or o.placed_at < v_now - make_interval(days => p_older_than_days))
       and (v_like is null or o.order_number ilike v_like or o.customer_name ilike v_like
            or (o.customer_snapshot ->> 'account_name') ilike v_like)
       and (not coalesce(p_attention_only, false) or (
              o.status in ('pending', 'paid')
              and (o.approval_status = 'pending'
                   or o.payment_status in ('pending', 'authorized', 'failed')
                   or o.fulfillment_status in ('unfulfilled', 'in_progress', 'partially_fulfilled'))))
  )
  select (select count(*) from filtrados),
         coalesce((
           select jsonb_agg(x order by n)
             from (
               select jsonb_build_object(
                        'id', f.id,
                        'order_number', left(f.order_number, 40),
                        'status', f.status,
                        'payment_status', f.payment_status,
                        'fulfillment_status', f.fulfillment_status,
                        'approval_status', f.approval_status,
                        'currency', f.currency,
                        'grand_total', f.grand_total::text,
                        'placed_at', f.placed_at,
                        'customer_label', ebim.ai_order_customer_label(f.customer_name, f.customer_snapshot)
                      ) as x,
                      row_number() over (order by f.placed_at desc, f.id desc) as n
                 from filtrados f
                order by f.placed_at desc, f.id desc
                limit v_limit
             ) t
         ), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object(
    'generated_at', v_now,
    'total', v_total,
    'limit', v_limit,
    'rows', v_rows
  );
end;
$fn$;

revoke execute on function public.ai_orders_search(uuid, text, text, text, text, text, integer, integer, text, boolean, integer)
  from public, anon;
grant  execute on function public.ai_orders_search(uuid, text, text, text, text, text, integer, integer, text, boolean, integer)
  to authenticated, service_role;

comment on function public.ai_orders_search(uuid, text, text, text, text, text, integer, integer, text, boolean, integer) is
  'Busqueda de pedidos con filtros TIPADOS (enums cerrados, enteros acotados, texto <=60 escapado), <=25 filas. Es la herramienta controlada de la busqueda en lenguaje natural (fase 04): el modelo propone parametros, nunca SQL. Security invoker; roles de la funcionalidad orders.';
