-- =============================================================================
-- La exencion de credito miraba la CUENTA y tiene que mirar el PEDIDO.
--
-- `20260908180000` dejo pasar sin cobrar cualquier entrega de una cuenta con
-- linea de credito viva. Suena razonable y no lo es: tener credito disponible
-- no significa estar usandolo. Un comprador de esa misma cuenta que elige Yape
-- o transferencia esta diciendo que paga ahora, y su pedido salia igual sin
-- cobrar — el control quedaba apagado para toda la cuenta por el solo hecho de
-- que existiera una linea.
--
-- Encontrado en `EC-20260909-00031`: cuenta Policlinico Andino (linea de
-- S/ 25,000), medio elegido `yape`, `payment_status = pending`, y la mercancia
-- fuera.
--
-- La pregunta correcta no es «¿esta cuenta tiene credito?» sino «¿ESTE pedido
-- se esta vendiendo a credito?». Y eso lo dice el medio de pago del pedido:
-- `payment_method_kind = 'credit'`, la familia que existe justo para esto —«lo
-- cobra el comercio, no una pasarela»—.
--
-- Se exigen las DOS cosas, y ninguna sobra:
--
--   · el pedido se vende a credito  → si no, no hay nada que fiar;
--   · y la cuenta tiene linea viva  → si no, el credito no esta autorizado.
--
-- Sin intencion de cobro registrada no hay venta a credito que demostrar, asi
-- que la entrega se frena: el defecto de un control es negar.
-- =============================================================================

comment on column public.store_settings.require_payment_before_dispatch is
  'Impide marcar una entrega como en camino o entregada mientras el pedido no este cobrado. Exento solo el pedido VENDIDO a credito (medio de familia credit) de una cuenta con linea viva.';

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
  perform ebim.assert_order_operator(v_order);

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
$function$
;
