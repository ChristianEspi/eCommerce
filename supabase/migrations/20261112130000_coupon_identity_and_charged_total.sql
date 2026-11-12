-- =============================================================================
-- Cupón con tope por cliente: el carrito, el cobro y el pedido decían tres cosas
-- distintas (prueba de compra real en QAS, 2026-11-12, pedido EC-20261112-00003).
--
-- ## El fallo
--
-- `promotion_quote_for_slug` —la cotización del carrito y de la etapa 4 del
-- checkout— evaluaba las promociones SIN el correo del comprador. Un cupón con
-- `usage_limit_per_customer` (los de bienvenida) salía `sin_identidad` y no
-- descontaba. Después `create_order` lo volvía a evaluar CON el correo, lo
-- aplicaba y guardaba un total menor. Resultado en Porta, cupón BIENVENIDA y
-- tarjeta regalo de S/ 30:
--
--   pedido          grand_total 149.73 (con el 10 %)
--   cobro abierto   134.70 = 164.70 (SIN el 10 %) − 30 de la tarjeta
--
-- Se le pedían al comprador S/ 14.97 de más, y la vitrina le decía que el
-- cupón no valía cuando sí valía.
--
-- ## La respuesta, en dos capas
--
-- 1. La cotización acepta el correo que el comprador ya tecleó en el checkout
--    (`p_customer_email`, opcional) y se lo pasa al motor: el tope por cliente
--    se decide con el MISMO dato en el carrito, en el cobro y en el pedido. Sin
--    correo, exactamente como antes. Lo único que revela es lo que el pedido
--    revelaría igual («ya usaste este cupón»), y el techo de sondeo sigue.
--
-- 2. `checkout_place_order` recibe el total que se cobró (`p_expected_total`)
--    y, si `create_order` suma otra cosa, aborta: nunca más un pedido cuyo
--    total no es lo cobrado. Cualquier descuadre futuro, venga de donde venga,
--    acaba en «no se pudo registrar el pedido» con el cobro anulado, no en
--    dinero de más.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · La cotización con el correo del comprador
-- ---------------------------------------------------------------------------
drop function if exists public.promotion_quote_for_slug(text, jsonb, text[]);

create function public.promotion_quote_for_slug(
  p_store_slug     text,
  p_items          jsonb,
  p_coupon_codes   text[] default null,
  p_customer_email text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store    public.stores%rowtype;
  v_channel  public.channels%rowtype;
  v_slug     text := lower(btrim(coalesce(p_store_slug, '')));
  v_quote    jsonb;
  v_codes    text[] := p_coupon_codes;
  v_result   jsonb;
  v_misses   integer;
  v_account  uuid;
  v_customer uuid;
  v_segment  uuid;
  -- Solo un correo con forma de correo cuenta como identidad; cualquier otra
  -- cosa es «no se sabe», igual que antes de esta migración.
  v_email    text := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
begin
  if v_email is not null
     and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    v_email := null;
  end if;

  if v_slug = '' then
    raise exception 'TIENDA_NO_DISPONIBLE: falta la tienda de la cotizacion'
      using errcode = '22023';
  end if;

  select * into v_store
  from public.stores s
  where lower(s.slug) = v_slug and s.status = 'active';

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda "%" no existe o no esta activa', v_slug
      using errcode = '22023';
  end if;

  select * into v_channel
  from public.channels c
  where c.store_id = v_store.id and c.is_default and c.is_active;

  if not found then
    raise exception 'CANAL_NO_DISPONIBLE: la tienda % no tiene canal por defecto activo', v_store.slug
      using errcode = '22023';
  end if;

  if v_channel.requires_auth then
    raise exception 'CANAL_NO_PUBLICO: el canal por defecto de % exige sesion', v_store.slug
      using errcode = '22023';
  end if;

  -- P16-SaaS. Con el contador de FALLOS por encima del techo, la cotizacion se
  -- calcula igual y sin cupones: el oraculo se apaga, el carrito no.
  if v_codes is not null
     and array_length(v_codes, 1) > 0
     and ebim.public_rate_exceeded(v_store.id, 'promotions.coupon_probe', 100) then
    v_codes := null;
  end if;

  v_quote := ebim.build_quote(v_store.id, v_channel.id, p_items, null, null, now(), true);

  -- N04 · La identidad comercial, del JWT y de la regla única.
  v_account := ebim.effective_business_account(ebim.user_id(), v_store.organization_id, v_store.company_id);
  if v_account is not null then
    select c.id, c.segment_id into v_customer, v_segment
    from public.business_accounts a
    join public.customers c on c.id = a.customer_id
    where a.id = v_account
      and c.is_active
      and c.organization_id = v_store.organization_id
      and c.company_id      = v_store.company_id;
  end if;

  v_result := ebim.apply_promotions(
    v_store.id, v_channel.id, v_quote, v_codes,
    v_customer, v_segment, v_account, v_email, now(), false);

  select count(*)::integer into v_misses
  from jsonb_array_elements(
         coalesce(v_result -> 'promotions' -> 'coupons', '[]'::jsonb)) as c(value)
  where c.value ->> 'status' = 'no_existe';

  if coalesce(v_misses, 0) > 0 then
    perform ebim.public_rate_record(v_store.id, 'promotions.coupon_probe', v_misses, 100);
  end if;

  return v_result;
end;
$fn$;

comment on function public.promotion_quote_for_slug(text, jsonb, text[], text) is
  'Cotizacion publica con promociones. Identidad comercial de la sesion (N04) y, desde 2026-11-12, el correo tecleado para los topes de uso por cliente: mismo dato que create_order. Techo de sondeo de cupones intacto (P16-SaaS).';

revoke execute on function public.promotion_quote_for_slug(text, jsonb, text[], text) from public;
grant  execute on function public.promotion_quote_for_slug(text, jsonb, text[], text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · El pedido no puede sumar otra cosa que lo cobrado
-- ---------------------------------------------------------------------------
drop function if exists public.checkout_place_order(uuid, text, jsonb, text, text, jsonb, text, text, jsonb, uuid, jsonb, jsonb, text[], jsonb, text);

CREATE FUNCTION public.checkout_place_order(p_intent_id uuid, p_customer_email text, p_items jsonb, p_customer_name text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_shipping_address jsonb DEFAULT '{}'::jsonb, p_notes text DEFAULT NULL::text, p_reservation_token text DEFAULT NULL::text, p_payment jsonb DEFAULT NULL::jsonb, p_business_account_id uuid DEFAULT NULL::uuid, p_billing_address jsonb DEFAULT NULL::jsonb, p_approval jsonb DEFAULT NULL::jsonb, p_coupon_codes text[] DEFAULT NULL::text[], p_delivery jsonb DEFAULT NULL::jsonb, p_purchase_order_number text DEFAULT NULL::text, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_intent   public.checkout_intents%rowtype;
  v_store    public.stores%rowtype;
  v_order    jsonb;
  v_order_id uuid;
  v_cart     public.carts%rowtype;
  v_payment  jsonb;
begin
  select * into v_intent
  from public.checkout_intents i
  where i.id = p_intent_id
  for update;

  if not found then
    raise exception 'INTENTO_NO_ENCONTRADO: no hay ningun intento de compra con esos datos'
      using errcode = '22023';
  end if;

  if v_intent.status = 'succeeded' then
    return v_intent.result || jsonb_build_object('replay', true, 'intent_id', v_intent.id);
  end if;

  if v_intent.status <> 'running' then
    raise exception 'INTENTO_NO_VIGENTE: ese intento de compra ya se cerro'
      using errcode = '22023';
  end if;

  select * into v_store from public.stores s where s.id = v_intent.store_id;

  v_order := public.create_order(
    v_store.id,
    p_customer_email,
    p_items,
    p_customer_name,
    p_customer_phone,
    p_shipping_address,
    p_notes,
    p_reservation_token,
    -- El origen de este camino es la vitrina, y no se acepta de nadie: esta
    -- funcion la llama exclusivamente la Edge Function del checkout publico.
    'storefront',
    p_business_account_id,
    p_billing_address,
    p_approval,
    p_coupon_codes,
    p_delivery,
    p_purchase_order_number
  );

  v_order_id := (v_order ->> 'order_id')::uuid;

  -- 2026-11-12 · Lo que se cobró tiene que ser lo que suma el pedido. El
  -- pipeline autoriza el cobro (y gasta la tarjeta regalo) ANTES de crear el
  -- pedido, con su propia cotización; si `create_order` llega a otro total
  -- —un cupón que una cotización ve y la otra no—, el comprador pagaría una
  -- cifra y el pedido diría otra. Se aborta TODA la transacción: no queda
  -- pedido, y el pipeline anula el cobro y devuelve saldo y existencias.
  if p_expected_total is not null
     and round(p_expected_total, 2) <> round((v_order ->> 'grand_total')::numeric, 2) then
    raise exception 'TOTAL_DESCUADRADO: se cobraria % y el pedido suma %',
      round(p_expected_total, 2), v_order ->> 'grand_total'
      using errcode = '22023';
  end if;

  if v_intent.cart_id is not null then
    select * into v_cart from public.carts c where c.id = v_intent.cart_id for update;
    if found and v_cart.status = 'active' then
      update public.carts
         set status = 'converted', order_id = v_order_id, last_activity_at = now()
       where id = v_cart.id;
    end if;
  end if;

  v_payment := case
    when p_payment is null then null
    else jsonb_build_object(
      'status',             p_payment ->> 'status',
      'provider_reference', p_payment ->> 'provider_reference',
      'provider_code',      p_payment ->> 'provider_code')
  end;

  perform ebim.publish_event(
    v_store.organization_id, v_store.company_id, v_store.id,
    'order.created', 'order', v_order_id,
    jsonb_build_object(
      'order_id',        v_order_id,
      'order_number',    v_order ->> 'order_number',
      'status',          v_order ->> 'status',
      'channel',         v_order ->> 'channel',
      'source_channel',  v_order ->> 'source_channel',
      'approval_status', v_order ->> 'approval_status',
      'currency',        v_order ->> 'currency',
      'subtotal',        v_order ->> 'subtotal',
      'tax_total',       v_order ->> 'tax_total',
      'discount_total',  v_order ->> 'discount_total',
      -- P12: un consumidor que factura o sincroniza con un ERP necesita el
      -- transporte por separado —tributa distinto— y no puede deducirlo del
      -- total sin volver a leer el pedido.
      'shipping_total',  v_order ->> 'shipping_total',
      'delivery',        v_order -> 'delivery',
      'grand_total',     v_order ->> 'grand_total',
      'customer_email',  lower(btrim(coalesce(p_customer_email, ''))),
      'item_count',      jsonb_array_length(coalesce(v_order -> 'items', '[]'::jsonb)),
      'payment',         v_payment),
    'order.created:' || v_intent.idempotency_key);

  -- Un pedido que espera firma NO es un pedido confirmado, y avisar de lo
  -- contrario es peor que no avisar: el comprador cree que ya esta comprado.
  if (v_order ->> 'approval_status') = 'pending' then
    perform ebim.publish_event(
      v_store.organization_id, v_store.company_id, v_store.id,
      'order.approval_requested', 'order', v_order_id,
      jsonb_strip_nulls(jsonb_build_object(
        'order_id',            v_order_id,
        'order_number',        v_order ->> 'order_number',
        'business_account_id', p_business_account_id,
        'reason',              v_order ->> 'approval_reason',
        'grand_total',         v_order ->> 'grand_total',
        'currency',            v_order ->> 'currency',
        'customer_email',      lower(btrim(coalesce(p_customer_email, ''))))),
      'order.approval_requested:' || v_intent.idempotency_key);
  else
    perform ebim.publish_event(
      v_store.organization_id, v_store.company_id, v_store.id,
      'notification.order_confirmation', 'order', v_order_id,
      jsonb_build_object(
        'order_id',       v_order_id,
        'order_number',   v_order ->> 'order_number',
        'customer_email', lower(btrim(coalesce(p_customer_email, ''))),
        'customer_name',  nullif(btrim(coalesce(p_customer_name, '')), ''),
        'grand_total',    v_order ->> 'grand_total',
        'currency',       v_order ->> 'currency'),
      'notification.order_confirmation:' || v_intent.idempotency_key);
  end if;

  update public.checkout_intents
     set status = 'succeeded',
         stage = 'publish_events',
         order_id = v_order_id,
         result = v_order,
         reservation_token = null,
         completed_at = now()
   where id = v_intent.id;

  return v_order || jsonb_build_object('replay', false, 'intent_id', v_intent.id);
end;
$function$;

revoke execute on function public.checkout_place_order(uuid, text, jsonb, text, text, jsonb, text, text, jsonb, uuid, jsonb, jsonb, text[], jsonb, text, numeric) from public, anon, authenticated;
grant  execute on function public.checkout_place_order(uuid, text, jsonb, text, text, jsonb, text, text, jsonb, uuid, jsonb, jsonb, text[], jsonb, text, numeric) to service_role;

comment on function public.checkout_place_order(uuid, text, jsonb, text, text, jsonb, text, text, jsonb, uuid, jsonb, jsonb, text[], jsonb, text, numeric) is
  'Crea el pedido del checkout publico dentro de la transaccion del intento. Desde 2026-11-12 recibe el total cobrado (p_expected_total) y aborta con TOTAL_DESCUADRADO si create_order suma otra cosa.';

-- ---------------------------------------------------------------------------
-- 3 · Cancelar un pedido devuelve el saldo de la tarjeta regalo
--
-- Mismo hueco que el stock (20261111120000): cancelar dejaba la tarjeta
-- gastada. El comprador que pagó S/ 30 con su tarjeta y vio cancelado el
-- pedido perdía los S/ 30 — y era el único efecto que no podía reclamar por
-- su cuenta: no sale en ningún extracto.
--
-- Se devuelve, a cada tarjeta, lo que el pedido gastó de ella y aún no se le
-- devolvió (canjes − devoluciones con ese `order_id`). Idempotente por la
-- referencia `cancel:<pedido>`: volver a cancelar no devuelve dos veces. Una
-- tarjeta anulada no admite devoluciones; eso NO impide cancelar el pedido
-- (queda para un ajuste manual desde Tarjetas de regalo).
-- ---------------------------------------------------------------------------
create or replace function ebim.refund_gift_cards_of_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_card record;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then
    return new;
  end if;

  for v_card in
    select t.gift_card_id, -sum(t.amount) as owed
      from public.gift_card_transactions t
     where t.order_id = new.id
       and t.kind in ('redeem', 'refund')
     group by t.gift_card_id
    having sum(t.amount) < 0
  loop
    begin
      perform ebim.gift_card_move(v_card.gift_card_id, 'refund'::public.gift_card_movement,
                                  v_card.owed, 'cancel:' || new.id::text, new.id);
    exception when others then
      raise notice 'No se pudo devolver saldo a la tarjeta % del pedido %: %',
        v_card.gift_card_id, new.order_number, sqlerrm;
    end;
  end loop;

  return new;
end;
$fn$;

revoke execute on function ebim.refund_gift_cards_of_cancelled_order() from public, anon, authenticated;

drop trigger if exists orders_cancel_refunds_gift_cards on public.orders;
create trigger orders_cancel_refunds_gift_cards
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function ebim.refund_gift_cards_of_cancelled_order();
