-- =============================================================================
-- El seguimiento del pedido dice CON QUÉ se paga
--
-- Un pedido contra entrega se confirmaba igual que uno con transferencia:
-- «Pendiente de pago» y el paso «Pago» antes de «En camino». Es falso para el
-- comprador: en contra entrega no tiene nada pendiente AHORA, paga al recibir.
-- La confirmación no podía distinguirlo porque `order_by_token` no decía el
-- medio, y el que llega del checkout se pierde al recargar o al abrir el enlace.
--
-- Única diferencia con la versión anterior (20260828150700): la clave
-- `payment_method` = {code, kind, display_name, instructions} del intento de
-- cobro más reciente, o null si el pedido no tiene ninguno.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.order_by_token(p_store_slug text, p_order_number text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_order      public.orders%rowtype;
  v_items      jsonb;
  v_deliveries jsonb;
  v_payment    jsonb;
begin
  if p_token is null or char_length(p_token) <> 64 then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con esos datos'
      using errcode = '22023';
  end if;

  select o.* into v_order
  from public.orders o
  join public.stores s       on s.id = o.store_id
  join public.order_tokens t on t.order_id = o.id
  where s.slug = lower(btrim(p_store_slug))
    and s.status = 'active'
    and o.order_number = btrim(p_order_number)
    and t.token = p_token;

  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con esos datos'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sku',        i.sku,
           'name',       i.name,
           'quantity',   i.quantity,
           'unit_price', i.unit_price::text,
           'discount',   i.discount_amount::text,
           -- Solo la ETIQUETA y el importe de cada campana: ni su id, ni su
           -- codigo interno, ni el cupon con el que otro comprador la activo.
           'discounts',  coalesce((
             select jsonb_agg(jsonb_build_object(
                      'label',  d ->> 'label',
                      'amount', d ->> 'amount'))
             from jsonb_array_elements(i.discount_snapshot) as d), '[]'::jsonb)
         ) order by i.name), '[]'::jsonb)
    into v_items
  from public.order_items i
  where i.order_id = v_order.id;

  -- Las entregas del pedido, en el vocabulario del COMPRADOR. Una lista y no un
  -- objeto porque un pedido puede salir en varias: enseñar solo la primera
  -- convertiria un despacho parcial en «tu pedido ya llego» cuando falta media
  -- caja.
  select coalesce(jsonb_agg(jsonb_build_object(
           'sequence',       f.sequence,
           'method_name',    f.method_name,
           'strategy',       f.strategy,
           'state',          f.state,
           'promised_from',  f.promised_from,
           'promised_to',    f.promised_to,
           'window_date',    f.window_date,
           'window_starts_at', f.window_starts_at,
           'window_ends_at', f.window_ends_at,
           -- Donde ir a recogerlo, si es un recojo. El nombre y la direccion
           -- publica del punto, que es exactamente lo que ya se le enseño antes
           -- de comprar.
           'pickup_point',   case when f.pickup_point_id is null then null else
             (select jsonb_build_object('name', pp.name, 'address', pp.address)
                from public.pickup_points pp where pp.id = f.pickup_point_id) end,
           -- La guia y su enlace: lo unico del operador que el comprador
           -- necesita. Ni su codigo interno, ni lo que nos cobra.
           'tracking_number', (select s2.tracking_number from public.shipments s2
                                where s2.fulfillment_id = f.id
                                  and s2.tracking_number is not null
                                order by s2.created_at desc limit 1),
           'tracking_url',    (select s2.tracking_url from public.shipments s2
                                where s2.fulfillment_id = f.id
                                  and s2.tracking_url is not null
                                order by s2.created_at desc limit 1)
         ) order by f.sequence), '[]'::jsonb)
    into v_deliveries
  from public.fulfillments f
  where f.order_id = v_order.id and f.state <> 'cancelled';

  -- 2026-11-17 · Con QUÉ se paga, para que la confirmación diga «pagas al
  -- recibir» en un contra entrega en vez de «pendiente de pago». El intento más
  -- reciente: si el comprador reintentó con otro medio, manda el último. Solo lo
  -- que la tienda ya publica en su selector (nombre, familia, instrucciones):
  -- nada del proveedor ni del cobro.
  select jsonb_build_object(
           'code',         m.code,
           'kind',         m.kind,
           'display_name', m.display_name,
           'instructions', m.instructions)
    into v_payment
  from public.payment_intents i
  join public.payment_methods m on m.id = i.payment_method_id
  where i.order_id = v_order.id
  order by i.created_at desc
  limit 1;

  return jsonb_build_object(
    'order_number',       v_order.order_number,
    'status',             v_order.status,
    'payment_status',     v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status,
    'approval_status',    v_order.approval_status,
    'currency',           v_order.currency,
    'placed_at',          v_order.placed_at,
    'customer_name',      v_order.customer_name,
    'subtotal',           v_order.subtotal::text,
    'tax_total',          v_order.tax_total::text,
    'discount_total',     v_order.discount_total::text,
    -- P12: el transporte va SEPARADO. Un comprador que ve un total mayor que la
    -- suma de sus lineas y ninguna linea que lo explique llama por telefono.
    'shipping_total',     v_order.shipping_total::text,
    'grand_total',        v_order.grand_total::text,
    'shipping_address',   v_order.shipping_address,
    'items',              v_items,
    'deliveries',         v_deliveries,
    'payment_method',     v_payment
  );
end;
$fn$;

comment on function public.order_by_token(text, text, text) is
  'Seguimiento del pedido por su enlace (token). Incluye el medio de pago elegido (nombre, familia, instrucciones), nunca datos del proveedor.';
