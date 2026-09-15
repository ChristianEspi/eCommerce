-- =============================================================================
-- Cierre · D3 (4/4) — `fulfillment`: candado en la red de entrega y en los
--                      comandos de despacho y devoluciones del backoffice
--
-- Fallback y razonamiento general: cabecera de 20260914180000.
--
-- ## Qué cubre la capacidad, y qué no — la decisión
--
-- `fulfillment` es «zonas y métodos de entrega con tarifa server-side,
-- ventanas, puntos de recojo, cola de preparación, seguimiento normalizado y
-- devoluciones con reposición» (src/domain/capabilities.ts). Mismas tres clases
-- que en cobros:
--
-- 1. **Configuración del comercio** — `delivery_zones`, `delivery_methods`,
--    `delivery_rates`, `pickup_points`, `delivery_windows` y `return_reasons`,
--    escritas por PostgREST desde `/app/fulfillment` con una policy `FOR ALL`.
--    SE CIERRA: la fila que queda escrita (alta o edición) exige la capacidad
--    salvo que quede INACTIVA — apagar un método de entrega sin el addon tiene
--    que poder hacerse, igual que la marca blanca (160000). `using` sigue
--    siendo solo el rol, así que borrar y leer no cambian.
--
-- 2. **Comandos del operador** — `fulfillment_create`, `fulfillment_assign`,
--    `fulfillment_transition`, `shipment_open`, `shipment_track_note`,
--    `return_open` y los seis que pasan por `ebim.assert_return_operator`
--    (`return_decide`, `return_receive`, `return_inspect`, `return_complete`,
--    `return_cancel`, `return_evidence_attach`). SE CIERRAN con UN guard nuevo,
--    `ebim.assert_fulfillment_operator` = operador de pedido + capacidad.
--    `assert_order_operator` NO se toca: es el guard de `orders`, que es
--    baseline, y ponerle la capacidad dejaría sin gestión de pedidos a quien
--    no contrató entregas.
--
--    Los seis cuerpos que llamaban a `assert_order_operator` se reescriben
--    COPIADOS de `pg_get_functiondef` del esquema construido hasta 20260914160100
--    —la misma técnica que 20260908180000—, con un único cambio en cada uno:
--    `assert_order_operator(v_order)` → `assert_fulfillment_operator(v_order)`.
--    `fulfillment_transition` parte de su última versión (20260909090000), con
--    el candado de «no entregar sin cobrar» y la exención de crédito intactos.
--
-- 3. **Camino del comprador, del checkout y del operador logístico** —
--    `ebim.plan_fulfillment` (dentro de `create_order`), las cotizaciones de
--    entrega, `order_by_token`, `return_request_for_slug`, `returns_by_token`,
--    `shipment_apply_outcome`, `shipment_track_ingest` y la Edge Function
--    `fulfillment-webhook`. NO SE CIERRA:
--      · checkout y `create_order` son del carril A (regla del cierre), y ya se
--        degradan solos: sin métodos de entrega activos el pedido nace sin
--        `p_delivery`, con transporte cero, como antes de P12;
--      · el aviso del transportista describe un paquete que YA está en la
--        calle; rechazarlo no lo devuelve al almacén, solo deja al comprador
--        sin seguimiento;
--      · pedir una devolución es un derecho del comprador, no una función del
--        plan del comercio. Lo que exige el módulo es PROCESARLA (punto 2).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · La red de entrega y los motivos de devolución
-- ---------------------------------------------------------------------------
do $migration$
declare
  v_roles constant text :=
    'ebim.has_role(organization_id, company_id, array[''owner'',''admin'']::public.app_role[])';
  v_cap constant text :=
    'ebim.has_capability(organization_id, company_id, ''fulfillment'')';
  v_table text;
begin
  foreach v_table in array array[
    'delivery_zones', 'delivery_methods', 'delivery_rates',
    'pickup_points', 'delivery_windows', 'return_reasons'
  ] loop
    if not exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = v_table and c.column_name = 'is_active'
    ) then
      raise exception 'D3: %.is_active no existe; la regla de apagado no aplica', v_table;
    end if;

    execute format('drop policy if exists %I on public.%I', v_table || '_write_admin', v_table);
    execute format(
      'create policy %I on public.%I for all to authenticated using (%s) with check (%s and (not is_active or %s))',
      v_table || '_write_admin', v_table, v_roles, v_roles, v_cap);
  end loop;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- 2 · ebim.assert_fulfillment_operator — operador de pedido + módulo
--
-- Primero el rol (quien no es miembro recibe SIN_PERMISO y nada más), después
-- la capacidad.
-- ---------------------------------------------------------------------------
create or replace function ebim.assert_fulfillment_operator(p_order public.orders)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  perform ebim.assert_order_operator(p_order);
  perform ebim.assert_capability(p_order.organization_id, p_order.company_id, 'fulfillment');
end;
$fn$;

revoke execute on function ebim.assert_fulfillment_operator(public.orders)
  from public, anon, authenticated;
grant execute on function ebim.assert_fulfillment_operator(public.orders) to service_role;

comment on function ebim.assert_fulfillment_operator(public.orders) is
  'Guard de los comandos de despacho y devolución del backoffice: assert_order_operator + capacidad fulfillment (D3).';

-- Las seis operaciones sobre una devolución ya abierta heredan el candado aquí.
create or replace function ebim.assert_return_operator(p_request public.return_requests)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_request.order_id;
  perform ebim.assert_fulfillment_operator(v_order);
end;
$fn$;

revoke execute on function ebim.assert_return_operator(public.return_requests)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Los seis comandos que autorizaban con el operador de pedido
-- ---------------------------------------------------------------------------

-- public.fulfillment_create — única diferencia con su versión anterior: el guard.
CREATE OR REPLACE FUNCTION public.fulfillment_create(p_order_id uuid, p_method_code text, p_lines jsonb DEFAULT NULL::jsonb, p_pickup_point_id uuid DEFAULT NULL::uuid, p_window jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order  public.orders%rowtype;
  v_lines  jsonb;
  v_option jsonb;
  v_id     uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese identificador'
      using errcode = '22023';
  end if;

  perform ebim.assert_fulfillment_operator(v_order);

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', oi.product_id,
           'variant_id', oi.variant_id,
           'quantity',   oi.quantity)), '[]'::jsonb)
    into v_lines
  from public.order_items oi where oi.order_id = v_order.id;

  v_option := ebim.quote_delivery_choice(
    v_order.store_id, p_method_code, v_order.shipping_address,
    v_lines, v_order.subtotal, p_pickup_point_id);

  v_id := ebim.plan_fulfillment(
    v_order.id,
    v_option,
    jsonb_strip_nulls(jsonb_build_object(
      'pickup_point_id', p_pickup_point_id,
      'window',          p_window)),
    p_lines);

  perform ebim.fulfillment_sync_order(v_order.id);

  return jsonb_build_object('fulfillment_id', v_id, 'order_id', v_order.id);
end;
$function$;

-- public.fulfillment_assign — única diferencia con su versión anterior: el guard.
CREATE OR REPLACE FUNCTION public.fulfillment_assign(p_fulfillment_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ful   public.fulfillments%rowtype;
  v_order public.orders%rowtype;
  v_stock jsonb;
  v_target uuid;
begin
  select * into v_ful from public.fulfillments f where f.id = p_fulfillment_id for update;
  if not found then
    raise exception 'ENTREGA_NO_ENCONTRADA: no hay ninguna entrega con ese identificador'
      using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = v_ful.order_id;
  perform ebim.assert_fulfillment_operator(v_order);

  if v_ful.state in ('delivered', 'cancelled') then
    raise exception 'ENTREGA_CERRADA: una entrega % ya no se reasigna', v_ful.state
      using errcode = '23514';
  end if;

  if p_warehouse_id is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'product_id', oi.product_id,
             'variant_id', oi.variant_id,
             'quantity',   fi.quantity)), '[]'::jsonb)
      into v_stock
    from public.fulfillment_items fi
    join public.order_items oi on oi.id = fi.order_item_id
    where fi.fulfillment_id = v_ful.id and oi.product_id is not null;

    v_target := ebim.select_warehouse(
      v_ful.store_id,
      coalesce((select m.sourcing from public.delivery_methods m where m.id = v_ful.delivery_method_id),
               'store_priority'::public.sourcing_strategy),
      v_ful.pickup_point_id,
      v_stock);
  else
    -- Un almacen de OTRA sociedad no se puede imponer aunque llegue en el
    -- cuerpo: la comprobacion es contra la fila, no contra lo declarado.
    if not exists (
      select 1 from public.warehouses w
      where w.id = p_warehouse_id
        and w.organization_id = v_ful.organization_id
        and w.company_id      = v_ful.company_id
    ) then
      raise exception 'ALMACEN_NO_ENCONTRADO: ese almacen no es de esta sociedad'
        using errcode = '22023';
    end if;
    v_target := p_warehouse_id;
  end if;

  update public.fulfillments
     set warehouse_id = v_target,
         state = case when state = 'pending' and v_target is not null
                      then 'allocated'::public.fulfillment_state else state end
   where id = v_ful.id;

  perform ebim.log_order_fact(
    v_order, 'fulfillment.assigned', null,
    jsonb_strip_nulls(jsonb_build_object(
      'fulfillment_id', v_ful.id, 'warehouse_id', v_target)));

  perform ebim.fulfillment_sync_order(v_order.id);

  return jsonb_build_object('fulfillment_id', v_ful.id, 'warehouse_id', v_target);
end;
$function$;

-- public.fulfillment_transition — única diferencia con su versión anterior: el guard.
CREATE OR REPLACE FUNCTION public.fulfillment_transition(p_fulfillment_id uuid, p_to text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ful    public.fulfillments%rowtype;
  v_order  public.orders%rowtype;
  v_to     text := lower(btrim(coalesce(p_to, '')));
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
  v_from   text;
  v_status public.fulfillment_status;
  v_exige_pago boolean;
  v_a_credito  boolean;
begin
  select * into v_ful from public.fulfillments f where f.id = p_fulfillment_id for update;
  if not found then
    raise exception 'ENTREGA_NO_ENCONTRADA: no hay ninguna entrega con ese identificador'
      using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = v_ful.order_id;
  perform ebim.assert_fulfillment_operator(v_order);

  if not exists (
    select 1 from unnest(enum_range(null::public.fulfillment_state)::text[]) as label
    where label = v_to
  ) then
    raise exception 'ESTADO_NO_VALIDO: "%" no es un estado de entrega', p_to
      using errcode = '22023';
  end if;

  v_from := v_ful.state::text;
  if v_from = v_to then
    return jsonb_build_object('fulfillment_id', v_ful.id, 'state', v_to, 'changed', false);
  end if;

  -- Cancelar sin decir por que deja una entrega anulada que nadie sabe explicar
  -- tres meses despues. Es el mismo criterio que P08 aplica a la anulacion.
  if v_to = 'cancelled' and v_reason is null then
    raise exception 'MOTIVO_REQUERIDO: cancelar una entrega exige decir por que'
      using errcode = '22023';
  end if;

  -- ---- La tienda que no entrega sin cobrar ------------------------------
  --
  -- Apagado por defecto, y ese defecto es la decision. Vender a credito es
  -- despachar hoy y cobrar a treinta dias: encender esto para todos habria
  -- roto la operacion de cualquier tenant que ya vende asi.
  --
  -- Frena la ENTREGA, no la preparacion. Preparar un pedido mientras se espera
  -- la transferencia es trabajo util y sin riesgo; lo que no se recupera es la
  -- mercancia que ya salio. Por eso los estados de almacen —asignada,
  -- preparando, empacada, lista— siguen libres, y el candado esta donde el
  -- paquete cambia de manos.
  --
  -- La exencion es del PEDIDO vendido a credito, no de la cuenta que podria
  -- usarlo: quien elige Yape esta diciendo que paga ahora.
  if v_to in ('in_transit', 'delivered') and v_order.payment_status <> 'paid' then
    select coalesce(ss.require_payment_before_dispatch, false) into v_exige_pago
    from public.store_settings ss where ss.store_id = v_order.store_id;

    if coalesce(v_exige_pago, false) then
      select exists (
        select 1
        from public.payment_intents i
        join public.payment_methods m on m.id = i.payment_method_id
        join public.business_accounts a on a.id = v_order.business_account_id
        where i.order_id = v_order.id
          and m.kind = 'credit'
          and coalesce(a.credit_limit, 0) > 0
          and a.credit_status <> 'blocked'
      ) into v_a_credito;

      if not coalesce(v_a_credito, false) then
        raise exception 'PAGO_PENDIENTE: esta tienda no entrega pedidos sin cobrar'
          using errcode = '22023';
      end if;
    end if;
  end if;

  update public.fulfillments
     set state = v_to::public.fulfillment_state,
         cancel_reason = case when v_to = 'cancelled' then v_reason else cancel_reason end
   where id = v_ful.id;

  perform ebim.log_order_fact(
    v_order, 'fulfillment.state_changed', v_reason,
    jsonb_build_object(
      'fulfillment_id', v_ful.id, 'from', v_from, 'to', v_to));

  v_status := ebim.fulfillment_sync_order(v_order.id);

  if v_to = 'delivered' then
    perform ebim.publish_event(
      v_order.organization_id, v_order.company_id, v_order.store_id,
      'fulfillment.delivered', 'fulfillment', v_ful.id,
      jsonb_build_object(
        'fulfillment_id', v_ful.id,
        'order_id',       v_order.id,
        'order_number',   v_order.order_number),
      'fulfillment.delivered:' || v_ful.id::text);
  end if;

  return jsonb_build_object(
    'fulfillment_id',     v_ful.id,
    'state',              v_to,
    'changed',            true,
    'fulfillment_status', v_status);
end;
$function$;

-- public.shipment_open — única diferencia con su versión anterior: el guard.
CREATE OR REPLACE FUNCTION public.shipment_open(p_fulfillment_id uuid, p_idempotency_key text, p_service_code text DEFAULT NULL::text, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ful      public.fulfillments%rowtype;
  v_order    public.orders%rowtype;
  v_existing public.shipments%rowtype;
  v_id       uuid := gen_random_uuid();
  v_key      text := btrim(coalesce(p_idempotency_key, ''));
begin
  select * into v_ful from public.fulfillments f where f.id = p_fulfillment_id for update;
  if not found then
    raise exception 'ENTREGA_NO_ENCONTRADA: no hay ninguna entrega con ese identificador'
      using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = v_ful.order_id;
  perform ebim.assert_fulfillment_operator(v_order);

  if char_length(v_key) < 8 or char_length(v_key) > 200 then
    raise exception 'IDEMPOTENCIA_INVALIDA: la clave debe tener entre 8 y 200 caracteres'
      using errcode = '22023';
  end if;

  -- Primer cerrojo: el reintento encuentra su envio y no abre otro.
  select * into v_existing
  from public.shipments s
  where s.fulfillment_id = v_ful.id and s.idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'shipment_id', v_existing.id, 'state', v_existing.state, 'replay', true);
  end if;

  if v_ful.state in ('delivered', 'cancelled') then
    raise exception 'ENTREGA_CERRADA: una entrega % no admite envios nuevos', v_ful.state
      using errcode = '23514';
  end if;

  if v_ful.strategy in ('pickup', 'digital') then
    raise exception 'ENVIO_NO_APLICA: una entrega de tipo % no genera envio', v_ful.strategy
      using errcode = '22023';
  end if;

  insert into public.shipments (
    id, organization_id, company_id, store_id, fulfillment_id,
    provider_code, service_code, state, currency, idempotency_key
  ) values (
    v_id, v_ful.organization_id, v_ful.company_id, v_ful.store_id, v_ful.id,
    v_ful.provider_code,
    nullif(btrim(coalesce(p_service_code, '')), ''),
    case when v_ful.provider_code is null
         then 'created'::public.shipment_state
         else 'draft'::public.shipment_state end,
    v_ful.currency, v_key
  );

  -- Sin lineas declaradas, el bulto lleva TODO lo que la entrega comprometio.
  insert into public.shipment_items (
    organization_id, company_id, store_id, shipment_id, fulfillment_item_id, quantity
  )
  select v_ful.organization_id, v_ful.company_id, v_ful.store_id, v_id,
         fi.id, coalesce(sel.quantity, fi.quantity)
  from public.fulfillment_items fi
  left join lateral (
    select (l ->> 'quantity')::integer as quantity
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l
    where (l ->> 'fulfillment_item_id')::uuid = fi.id
    limit 1
  ) sel on true
  where fi.fulfillment_id = v_ful.id
    and (p_lines is null or sel.quantity is not null)
    and coalesce(sel.quantity, fi.quantity) > 0;

  perform ebim.log_order_fact(
    v_order, 'shipment.opened', null,
    jsonb_strip_nulls(jsonb_build_object(
      'fulfillment_id', v_ful.id, 'shipment_id', v_id,
      'provider_code', v_ful.provider_code, 'service_code', p_service_code)));

  return jsonb_build_object('shipment_id', v_id, 'state',
    case when v_ful.provider_code is null then 'created' else 'draft' end,
    'replay', false);
end;
$function$;

-- public.shipment_track_note — única diferencia con su versión anterior: el guard.
CREATE OR REPLACE FUNCTION public.shipment_track_note(p_shipment_id uuid, p_status text, p_description text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ship  public.shipments%rowtype;
  v_ful   public.fulfillments%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_ship from public.shipments s where s.id = p_shipment_id;
  if not found then
    raise exception 'ENVIO_NO_ENCONTRADO: no hay ningun envio con ese identificador'
      using errcode = '22023';
  end if;

  select * into v_ful   from public.fulfillments f where f.id = v_ship.fulfillment_id;
  select * into v_order from public.orders o       where o.id = v_ful.order_id;
  perform ebim.assert_fulfillment_operator(v_order);

  return public.shipment_track_ingest(
    v_ship.id,
    jsonb_build_array(jsonb_build_object(
      'external_event_id', 'operator:' || gen_random_uuid()::text,
      'status',            p_status,
      'occurred_at',       coalesce(p_occurred_at, now()),
      'description',       p_description)),
    'operator',
    false);
end;
$function$;

-- public.return_open — única diferencia con su versión anterior: el guard.
CREATE OR REPLACE FUNCTION public.return_open(p_order_id uuid, p_reason_code text, p_items jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_id    uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese identificador'
      using errcode = '22023';
  end if;

  perform ebim.assert_fulfillment_operator(v_order);

  v_id := ebim.open_return(v_order, p_reason_code, p_items, p_note, 'backoffice');

  return jsonb_build_object(
    'return_request_id', v_id,
    'rma_number', (select rr.rma_number from public.return_requests rr where rr.id = v_id),
    'state', 'requested');
end;
$function$;
