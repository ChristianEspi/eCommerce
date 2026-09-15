-- =============================================================================
-- Cierre · D2 — Pagos y despacho: tres defectos reales de la revisión.
--
-- La revisión D2 (carril E1) los encontró leyendo el código; aquí se verificaron
-- uno a uno antes de tocar nada. Ninguno cambia firma, GRANT ni tabla.
--
-- ## 1. Un cobro por MENOS de lo debido dejaba el pedido `paid`
--
-- `payment_apply_outcome` escribía el cobro con el importe que traía el aviso
-- (`p_amount`) y, al pasar el intento a `captured`, sincronizaba el pedido a
-- `paid` sin compararlo con lo que se debía. Un aviso de 10 sobre un pedido de
-- 100 —error del adaptador, del proveedor o de alguien— era mercancía liberada
-- por 10 (con `require_payment_before_dispatch`, además, salía el paquete).
--
-- Ahora: el dinero que LLEGÓ se escribe igual (perderlo sería peor), pero el
-- pedido NO pasa a `paid`; queda donde estaba, con nota en la bitácora de pagos
-- y un incidente `payment_failed · COBRO_INCOMPLETO` en `ops_events`, que es
-- donde el monitor lo enseña. El eje de pago del pedido no tiene «pagado en
-- parte» y no se inventa: decidir qué hacer con un cobro incompleto es de una
-- persona.
--
-- ## 2. Un aviso tardío sobre un intento cerrado reintentaba para siempre
--
-- `captured` es terminal. Un webhook que llega después con otro estado (un
-- `authorized` retrasado, un `failed` desordenado) hacía saltar el trigger de la
-- máquina de estados; la función abortaba, el borde contestaba 503 y la pasarela
-- reintentaba sin fin, cada vez con el mismo resultado.
--
-- Ahora, SOLO para lo que viene de la pasarela (`provider_webhook`,
-- `provider_response`): la transición imposible se registra como
-- `payment.transition_ignored`, con su `external_event_id` —así el reenvío cae en
-- el cerrojo 1 y ni siquiera llega aquí— y se contesta `replay` con motivo. El
-- intento no se toca. Lo que llega de una persona o del sistema sigue lanzando:
-- ahí es un error de programación y tiene que verse.
--
-- ## 3. Abrir un envío no miraba la regla «no entregar sin cobrar»
--
-- `require_payment_before_dispatch` (20260908180000, 20260909090000) frena
-- `fulfillment_transition` a `in_transit`/`delivered`. Pero `shipment_open` —el
-- acto de entregar el bulto al transportista— no la miraba, y después el
-- seguimiento del transportista movía la entrega a «en camino» sin pasar por el
-- candado. El seguimiento NO se frena: cuenta algo que ya pasó, y rechazarlo solo
-- desincronizaría el registro de la realidad. Se frena donde el paquete cambia
-- de manos.
--
-- La regla sale a `ebim.assert_dispatch_payment` y la usan las dos funciones: una
-- regla, un sitio. Las dos parten de su última definición (20260914180300,
-- candados de capacidad) y solo cambia el bloque anotado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3a · La regla de despacho, en un sitio
-- ---------------------------------------------------------------------------
create or replace function ebim.assert_dispatch_payment(p_order public.orders)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_exige_pago boolean;
  v_a_credito  boolean;
begin
  if p_order.payment_status = 'paid' then
    return;
  end if;

  -- Apagado por defecto: vender a crédito es despachar hoy y cobrar a treinta días.
  select coalesce(ss.require_payment_before_dispatch, false) into v_exige_pago
  from public.store_settings ss where ss.store_id = p_order.store_id;

  if not coalesce(v_exige_pago, false) then
    return;
  end if;

  -- Exento solo el pedido VENDIDO a crédito de una cuenta con línea viva
  -- (20260909090000): quien elige Yape está diciendo que paga ahora.
  select exists (
    select 1
    from public.payment_intents i
    join public.payment_methods m on m.id = i.payment_method_id
    join public.business_accounts a on a.id = p_order.business_account_id
    where i.order_id = p_order.id
      and m.kind = 'credit'
      and coalesce(a.credit_limit, 0) > 0
      and a.credit_status <> 'blocked'
  ) into v_a_credito;

  if not coalesce(v_a_credito, false) then
    raise exception 'PAGO_PENDIENTE: esta tienda no entrega pedidos sin cobrar'
      using errcode = '22023';
  end if;
end;
$fn$;

revoke execute on function ebim.assert_dispatch_payment(public.orders) from public, anon, authenticated;
grant  execute on function ebim.assert_dispatch_payment(public.orders) to service_role;

comment on function ebim.assert_dispatch_payment(public.orders) is
  'Regla require_payment_before_dispatch: lanza PAGO_PENDIENTE si la tienda no entrega sin cobrar y el pedido no esta pagado ni vendido a credito con linea viva. La usan fulfillment_transition y shipment_open.';

-- ---------------------------------------------------------------------------
-- 3b · public.fulfillment_transition — base 20260914180300; el bloque de pago
--      pasa a la función de arriba, sin cambiar lo que decide.
-- ---------------------------------------------------------------------------
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

  if v_to = 'cancelled' and v_reason is null then
    raise exception 'MOTIVO_REQUERIDO: cancelar una entrega exige decir por que'
      using errcode = '22023';
  end if;

  -- Frena la ENTREGA, no la preparación: almacén libre, candado donde el
  -- paquete cambia de manos. La regla vive en `ebim.assert_dispatch_payment`.
  if v_to in ('in_transit', 'delivered') then
    perform ebim.assert_dispatch_payment(v_order);
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

-- ---------------------------------------------------------------------------
-- 3c · public.shipment_open — base 20260914180300; gana el candado de pago.
--      El reintento idempotente sigue respondiendo antes: un envío ya abierto
--      no se «desabre» porque el pago cambie después.
-- ---------------------------------------------------------------------------
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

  -- Cierre · D2. Abrir el envío es entregar el bulto: misma regla que pasar la
  -- entrega a «en camino».
  perform ebim.assert_dispatch_payment(v_order);

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

-- ---------------------------------------------------------------------------
-- 1 y 2 · public.payment_apply_outcome — base 20260828120100 (única definición
--         previa). Cambian solo los bloques marcados «Cierre · D2».
-- ---------------------------------------------------------------------------
create or replace function public.payment_apply_outcome(
  p_intent_id            uuid,
  p_operation            text,
  p_idempotency_key      text,
  p_attempt_status       text,
  p_intent_status        text    default null,
  p_amount               numeric default null,
  p_provider_reference   text    default null,
  p_provider_result_code text    default null,
  p_error_code           text    default null,
  p_error_detail         text    default null,
  p_latency_ms           integer default null,
  p_source               text    default 'provider_response',
  p_external_event_id    text    default null,
  p_signature_verified   boolean default false,
  p_payload              jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intent    public.payment_intents%rowtype;
  v_after     public.payment_intents%rowtype;
  v_payment   public.payments%rowtype;
  v_attempt   uuid;
  v_source    public.payment_event_source;
  v_from      text;
  v_to        text := nullif(lower(btrim(coalesce(p_intent_status, ''))), '');
  v_amount    numeric;
  v_owed      numeric;
  v_underpaid boolean := false;
  v_synced    boolean := false;
  v_target    public.payment_status;
begin
  -- ---- 1 · De donde viene esto, y si puede decidir -----------------------
  if not exists (
    select 1 from unnest(enum_range(null::public.payment_event_source)::text[]) as label
    where label = lower(btrim(coalesce(p_source, '')))
  ) then
    raise exception 'ORIGEN_NO_VALIDO: "%" no es un origen de hecho de pago', p_source
      using errcode = '22023';
  end if;
  v_source := lower(btrim(p_source))::public.payment_event_source;

  if v_source = 'browser_return' and (v_to is not null or p_amount is not null) then
    raise exception 'RETORNO_NO_DECIDE: la vuelta del navegador no cambia el estado de un cobro'
      using errcode = '42501';
  end if;

  if v_source = 'provider_webhook' and not coalesce(p_signature_verified, false) then
    raise exception 'FIRMA_NO_VERIFICADA: un aviso de pasarela sin firma valida no mueve dinero'
      using errcode = '42501';
  end if;

  select * into v_intent from public.payment_intents i where i.id = p_intent_id for update;
  if not found then
    raise exception 'INTENTO_NO_ENCONTRADO: no hay ningun intento de pago con ese identificador'
      using errcode = '22023';
  end if;
  v_from := v_intent.status::text;

  -- ---- 2 · Regla 5, cerrojo 1: este evento del proveedor ya se vio -------
  if p_external_event_id is not null and exists (
    select 1 from public.payment_events e
    where e.provider_code = coalesce(v_intent.provider_code, '')
      and e.external_event_id = p_external_event_id
  ) then
    return jsonb_build_object(
      'intent_id', v_intent.id, 'status', v_from, 'from', v_from, 'to', v_from,
      'replay', true, 'reason', 'evento_ya_procesado');
  end if;

  -- ---- 3 · Regla 5, cerrojo 2: esta llamada ya se registro ---------------
  insert into public.payment_attempts (
    organization_id, company_id, store_id, payment_intent_id, attempt_no,
    operation, status, provider_code, provider_reference, provider_result_code,
    error_code, error_detail, latency_ms, idempotency_key
  )
  select
    v_intent.organization_id, v_intent.company_id, v_intent.store_id, v_intent.id,
    coalesce((select max(a.attempt_no) from public.payment_attempts a
               where a.payment_intent_id = v_intent.id), 0) + 1,
    p_operation, p_attempt_status::public.payment_attempt_status, v_intent.provider_code,
    p_provider_reference, p_provider_result_code, p_error_code,
    left(p_error_detail, 2000), p_latency_ms, p_idempotency_key
  on conflict (payment_intent_id, operation, idempotency_key) do nothing
  returning id into v_attempt;

  if v_attempt is null then
    return jsonb_build_object(
      'intent_id', v_intent.id, 'status', v_from, 'from', v_from, 'to', v_from,
      'replay', true, 'reason', 'llamada_ya_registrada');
  end if;

  -- ---- 4 · La maquina de estados del intento -----------------------------
  if v_to is not null and v_to <> v_from then
    if not exists (
      select 1 from unnest(enum_range(null::public.payment_intent_status)::text[]) as label
      where label = v_to
    ) then
      raise exception 'ESTADO_NO_VALIDO: "%" no es un estado de un intento de pago', p_intent_status
        using errcode = '22023';
    end if;

    begin
      update public.payment_intents i set
        status             = v_to::public.payment_intent_status,
        provider_reference = coalesce(p_provider_reference, i.provider_reference),
        last_error_code    = case when v_to in ('failed','cancelled','expired')
                                  then p_error_code else null end,
        last_error_detail  = case when v_to in ('failed','cancelled','expired')
                                  then left(p_error_detail, 2000) else null end
      where i.id = v_intent.id;
    exception when check_violation then
      -- Cierre · D2 (2). Solo la transición imposible, y solo si la trae la
      -- pasarela: se deja constancia y se contesta como ya resuelto, para que
      -- no reintente sin fin. Cualquier otra violación, o de otro origen, sube.
      if sqlerrm not like 'PAGO_INTENTO_TRANSICION_INVALIDA%'
         or v_source not in ('provider_webhook', 'provider_response') then
        raise;
      end if;

      insert into public.payment_events (
        organization_id, company_id, store_id, payment_intent_id,
        event_type, source, provider_code, external_event_id, signature_verified,
        payload, note
      ) values (
        v_intent.organization_id, v_intent.company_id, v_intent.store_id, v_intent.id,
        'payment.transition_ignored', v_source, v_intent.provider_code, p_external_event_id,
        coalesce(p_signature_verified, false),
        ebim.redact_sensitive(coalesce(p_payload, '{}'::jsonb)) ||
          jsonb_strip_nulls(jsonb_build_object(
            'operation', p_operation, 'attempt_status', p_attempt_status,
            'from', v_from, 'requested', v_to, 'result_code', p_provider_result_code)),
        'aviso tardio o desordenado: el intento ya estaba en ' || v_from || ' y no admite ' || v_to
      );

      return jsonb_build_object(
        'intent_id', v_intent.id, 'status', v_from, 'from', v_from, 'to', v_from,
        'replay', true, 'reason', 'transicion_no_aplicable');
    end;

  elsif p_provider_reference is not null and v_intent.provider_reference is null then
    update public.payment_intents i set provider_reference = p_provider_reference
     where i.id = v_intent.id;
  end if;

  select * into v_after from public.payment_intents i where i.id = v_intent.id;

  -- ---- 5 · El dinero ------------------------------------------------------
  if v_after.status = 'authorized' and v_from <> 'authorized' then
    v_amount := round(coalesce(p_amount, v_after.amount), 2);
    update public.payment_intents set amount_authorized = v_amount where id = v_after.id;
  end if;

  if v_after.status = 'captured' and v_from <> 'captured' then
    v_owed   := round(v_after.amount - v_after.amount_captured, 2);
    v_amount := round(coalesce(p_amount, v_owed), 2);
    if v_amount <= 0 then
      raise exception 'IMPORTE_NO_VALIDO: no queda nada por capturar en este cobro'
        using errcode = '22023';
    end if;

    -- Cierre · D2 (1). Llegó menos de lo que se debía: el cobro se escribe,
    -- el pedido NO se da por pagado (ver paso 6).
    v_underpaid := v_amount < v_owed;

    insert into public.payments (
      organization_id, company_id, store_id, payment_intent_id, order_id,
      amount, currency, provider_code, provider_reference
    ) values (
      v_after.organization_id, v_after.company_id, v_after.store_id, v_after.id,
      v_after.order_id, v_amount, v_after.currency, v_after.provider_code,
      coalesce(p_provider_reference, v_after.provider_reference)
    )
    on conflict (provider_code, provider_reference) where provider_reference is not null
      do nothing
    returning * into v_payment;

    if v_payment.id is not null then
      update public.payment_intents set
        amount_captured   = amount_captured + v_amount,
        amount_authorized = greatest(amount_authorized, v_amount)
      where id = v_after.id;
    end if;
    select * into v_after from public.payment_intents i where i.id = v_intent.id;

    if v_underpaid then
      perform ebim.record_ops_event(
        p_organization_id => v_after.organization_id,
        p_company_id      => v_after.company_id,
        p_kind            => 'payment_failed'::public.ops_event_kind,
        p_code            => 'COBRO_INCOMPLETO',
        p_dedupe_key      => 'payment.underpaid:' || v_after.id::text,
        p_severity        => 'error'::public.ops_severity,
        p_message         => 'Se capturo ' || v_amount::text || ' de ' || v_owed::text || ' ' || v_after.currency
                             || '; el pedido no se marco pagado',
        p_operation       => p_operation,
        p_entity_type     => 'payment_intent',
        p_entity_id       => v_after.id,
        p_store_id        => v_after.store_id,
        p_context         => jsonb_build_object('captured', v_amount::text, 'owed', v_owed::text,
                                                'currency', v_after.currency, 'order_id', v_after.order_id));
    end if;
  end if;

  -- ---- 6 · El eje del pedido, que es un espejo y no una dependencia ------
  if v_after.order_id is not null and v_after.status::text <> v_from then
    v_target := case v_after.status
      when 'authorized' then 'authorized'::public.payment_status
      -- Cierre · D2 (1): capturado por menos de lo debido no es `paid`.
      when 'captured'   then case when v_underpaid then null else 'paid'::public.payment_status end
      when 'failed'     then 'failed'::public.payment_status
      when 'cancelled'  then 'voided'::public.payment_status
      when 'expired'    then 'voided'::public.payment_status
      else null
    end;
    if v_target is not null then
      v_synced := ebim.payment_sync_order(
        v_after.order_id, v_target,
        'pago: ' || v_from || ' -> ' || v_after.status::text);
    end if;
  end if;

  -- ---- 7 · La bitacora ----------------------------------------------------
  insert into public.payment_events (
    organization_id, company_id, store_id, payment_intent_id, payment_id,
    event_type, source, provider_code, external_event_id, signature_verified,
    payload, note
  ) values (
    v_after.organization_id, v_after.company_id, v_after.store_id, v_after.id,
    v_payment.id,
    'payment.' || coalesce(nullif(v_after.status::text, v_from), p_attempt_status),
    v_source, v_after.provider_code, p_external_event_id,
    coalesce(p_signature_verified, false),
    ebim.redact_sensitive(coalesce(p_payload, '{}'::jsonb)) ||
      jsonb_strip_nulls(jsonb_build_object(
        'operation', p_operation,
        'attempt_status', p_attempt_status,
        'from', v_from,
        'to', v_after.status,
        'amount', case when v_amount is null then null else v_amount::text end,
        'owed', case when v_underpaid then v_owed::text end,
        'result_code', p_provider_result_code,
        'error_code', p_error_code)),
    case
      when v_underpaid
        then 'COBRO_INCOMPLETO: se capturo menos de lo debido; el pedido no se marco pagado'
      when v_after.order_id is not null and not v_synced and v_after.status::text <> v_from
        then 'el eje de pago del pedido no acepto la transicion; el cobro si quedo escrito'
    end
  );

  if v_after.status::text <> v_from then
    perform ebim.publish_event(
      v_after.organization_id, v_after.company_id, v_after.store_id,
      'payment.' || v_after.status::text, 'payment_intent', v_after.id,
      jsonb_strip_nulls(jsonb_build_object(
        'intent_id',   v_after.id,
        'order_id',    v_after.order_id,
        'payment_id',  v_payment.id,
        'from',        v_from,
        'to',          v_after.status,
        'amount',      v_after.amount::text,
        'captured',    v_after.amount_captured::text,
        'underpaid',   case when v_underpaid then true end,
        'currency',    v_after.currency,
        'provider_code', v_after.provider_code,
        'provider_reference', v_after.provider_reference)),
      'payment.outcome:' || v_after.id::text || ':' || v_from || ':' || v_after.status::text);
  end if;

  return jsonb_build_object(
    'intent_id',   v_after.id,
    'attempt_id',  v_attempt,
    'payment_id',  v_payment.id,
    'from',        v_from,
    'to',          v_after.status,
    'status',      v_after.status,
    'amount',      v_after.amount::text,
    'captured',    v_after.amount_captured::text,
    'refunded',    v_after.amount_refunded::text,
    'order_id',    v_after.order_id,
    'order_synced', v_synced,
    'underpaid',   v_underpaid,
    'replay',      false);
end;
$fn$;

-- Mismos permisos que su definición anterior (create or replace los conserva;
-- se repiten para que la migración sea autosuficiente).
revoke execute on function public.payment_apply_outcome(
  uuid, text, text, text, text, numeric, text, text, text, text, integer, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.payment_apply_outcome(
  uuid, text, text, text, text, numeric, text, text, text, text, integer, text, text, boolean, jsonb)
  to service_role;
