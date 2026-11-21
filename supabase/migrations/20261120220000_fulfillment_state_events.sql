-- ---------------------------------------------------------------------------
-- 2026-11-20 · Cada paso de una entrega se AVISA.
--
-- Hasta aquí, mover una entrega (preparando → empacada → lista → en camino)
-- no publicaba nada: solo `fulfillment.created` al nacer y
-- `fulfillment.delivered` al llegar. Un ERP suscrito por webhook no se
-- enteraba de que el pedido había SALIDO, que es justo lo que quiere saber. Y
-- el estado de entrega del PEDIDO, cuando lo recalcula el sistema a partir de
-- sus entregas, cambiaba en silencio: `order.fulfillment_status_changed` solo
-- salía si un operador lo cambiaba a mano en Pedidos.
--
-- 1 · `fulfillment.state_changed` — un disparador en `fulfillments`, para que
--     lo cubra CUALQUIER camino que mueva una entrega (el comando del panel, el
--     resultado del transportista, el seguimiento ingerido, la anulación por
--     pedido cancelado) sin tener que acordarse en cada uno.
--     `fulfillment.delivered` se sigue publicando como hasta ahora.
-- 2 · `order.fulfillment_status_changed` desde `ebim.fulfillment_sync_order`,
--     que es quien recalcula el estado del pedido. Copia íntegra de
--     20260828150300 + la publicación al final. El cambio manual sigue
--     publicándolo `order_transition`: no hay doble aviso porque el manual no
--     pasa por aquí.
-- ---------------------------------------------------------------------------

-- 1 · Disparador de entregas --------------------------------------------------
create or replace function ebim.fulfillment_publish_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order_number text;
begin
  select o.order_number into v_order_number from public.orders o where o.id = new.order_id;

  perform ebim.publish_event(
    new.organization_id, new.company_id, new.store_id,
    'fulfillment.state_changed', 'fulfillment', new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'fulfillment_id', new.id,
      'order_id',       new.order_id,
      'order_number',   v_order_number,
      'sequence',       new.sequence,
      'from',           old.state::text,
      'to',             new.state::text,
      'method_code',    new.method_code,
      'method_name',    new.method_name,
      'shipped_at',     new.shipped_at,
      'delivered_at',   new.delivered_at,
      'cancel_reason',  new.cancel_reason)),
    -- Una entrega puede volver a un estado (falla y sale de nuevo): la
    -- transacción distingue los dos pasos sin dejar de deduplicar un reintento
    -- de la misma.
    'fulfillment.state:' || new.id::text || ':' || old.state::text || '>' || new.state::text
      || ':' || txid_current()::text);
  return null;
end;
$fn$;

revoke execute on function ebim.fulfillment_publish_state() from public, anon, authenticated;

drop trigger if exists fulfillments_publish_state on public.fulfillments;
create trigger fulfillments_publish_state
  after update of state on public.fulfillments
  for each row
  when (old.state is distinct from new.state)
  execute function ebim.fulfillment_publish_state();

-- 2 · Estado de entrega del pedido -------------------------------------------
create or replace function ebim.fulfillment_sync_order(p_order_id uuid)
returns public.fulfillment_status
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order     public.orders%rowtype;
  v_ordered   numeric := 0;
  v_delivered numeric := 0;
  v_active    boolean := false;
  v_target    public.fulfillment_status;
  v_rank      integer;
  v_current   integer;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    return null;
  end if;

  select coalesce(sum(oi.quantity), 0) into v_ordered
  from public.order_items oi where oi.order_id = v_order.id;

  select coalesce(sum(fi.quantity), 0) into v_delivered
  from public.fulfillment_items fi
  join public.fulfillments f on f.id = fi.fulfillment_id
  where f.order_id = v_order.id and f.state = 'delivered';

  select exists (
    select 1 from public.fulfillments f
    where f.order_id = v_order.id
      and f.state in ('allocated','picking','packed','ready','in_transit','failed')
  ) into v_active;

  if v_ordered > 0 and v_delivered >= v_ordered then
    v_target := 'fulfilled';
  elsif v_delivered > 0 then
    v_target := 'partially_fulfilled';
  elsif v_active then
    v_target := 'in_progress';
  else
    return v_order.fulfillment_status;
  end if;

  v_rank := case v_target
    when 'unfulfilled' then 0 when 'in_progress' then 1
    when 'partially_fulfilled' then 2 when 'fulfilled' then 3 else -1 end;
  v_current := case v_order.fulfillment_status
    when 'unfulfilled' then 0 when 'in_progress' then 1
    when 'partially_fulfilled' then 2 when 'fulfilled' then 3 else 99 end;

  if v_rank <= v_current then
    return v_order.fulfillment_status;
  end if;

  update public.orders set fulfillment_status = v_target where id = v_order.id;

  -- 2026-11-20 · El cambio que hace el sistema también se avisa, con la misma
  -- forma que el manual de `order_transition`. Solo AVANZA, así que cada
  -- estado se alcanza una vez por pedido: sirve de clave de deduplicación.
  perform ebim.publish_event(
    v_order.organization_id, v_order.company_id, v_order.store_id,
    'order.fulfillment_status_changed', 'order', v_order.id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_id',           v_order.id,
      'order_number',       v_order.order_number,
      'axis',               'fulfillment_status',
      'from',               v_order.fulfillment_status::text,
      'to',                 v_target::text,
      'status',             v_order.status,
      'payment_status',     v_order.payment_status,
      'fulfillment_status', v_target,
      'currency',           v_order.currency,
      'grand_total',        v_order.grand_total::text,
      'customer_email',     v_order.customer_email)),
    'order.fulfillment_sync:' || v_order.id::text || ':' || v_target::text);

  return v_target;
end;
$fn$;
