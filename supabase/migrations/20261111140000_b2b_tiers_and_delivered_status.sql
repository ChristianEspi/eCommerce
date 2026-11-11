-- =============================================================================
-- Dos hallazgos de la prueba de punta a punta (2026-11-11).
--
-- 1 · La ficha no enseñaba la escala por volumen del COMPRADOR B2B.
--
--     `product_price_tiers_for_slug` solo mira listas públicas (tienda y canal
--     por defecto) y eso es correcto para un anónimo. Pero el comprador de una
--     empresa con lista por segmento o por cliente veía «S/ 220 · precio
--     acordado» y no sabía que llevando 10 pagaba S/ 199: el carrito SÍ se lo
--     cobraba, la ficha no se lo decía.
--
--     Con sesión y cuenta B2B activa, las escalas se calculan con el MISMO
--     motor que el carrito (`ebim.resolve_price` con el segmento y el cliente
--     de la cuenta), en cada umbral de cualquier lista que le alcance. Sin
--     sesión o sin cuenta, todo sigue exactamente como antes.
--
-- 2 · Un pedido cobrado y entregado seguía en «Pagado».
--
--     La entrega llega a `delivered`, `fulfillment_status` pasa a `fulfilled`,
--     pero `status` se quedaba en `paid`: el comprador veía «Pagado» en un
--     pedido que ya tenía en la mano, y no salía en la pestaña «Entregado» del
--     backoffice. Ahora, en cuanto un pedido está a la vez cobrado y servido,
--     pasa a `fulfilled` — llegue antes el cobro o la entrega (contra entrega).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Escalas del comprador
-- ---------------------------------------------------------------------------
create or replace function ebim.buyer_price_tiers(p_store_id uuid, p_product_id uuid, p_user uuid)
returns table (min_quantity numeric, unit_price numeric)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store    public.stores%rowtype;
  v_account  public.business_accounts%rowtype;
  v_segment  uuid;
  v_channel  uuid;
  v_q        numeric;
  v_price    numeric;
  v_prev     numeric := null;
begin
  select * into v_store from public.stores s where s.id = p_store_id and s.status = 'active';
  if not found or p_user is null then return; end if;

  select a.* into v_account
  from public.business_accounts a
  where a.id = ebim.effective_business_account(p_user, v_store.organization_id, v_store.company_id)
    and a.is_active;
  if not found then return; end if;

  select c.segment_id into v_segment from public.customers c where c.id = v_account.customer_id;
  select c.id into v_channel
  from public.channels c
  where c.store_id = v_store.id and c.is_default and c.is_active
  limit 1;

  -- Publicado en la tienda: sin publicación no hay ficha que pintar.
  if not exists (
    select 1 from public.store_products sp
    where sp.store_id = v_store.id and sp.product_id = p_product_id and sp.status = 'published'
  ) then
    return;
  end if;

  for v_q in
    select 1::numeric
    union
    select it.min_quantity
    from ebim.active_price_lists l
    join public.price_list_items it
      on it.price_list_id = l.price_list_id
     and it.product_id    = p_product_id
     and it.variant_id is null
     and it.uom_id is null
    where l.store_id = v_store.id
      and l.valid_from <= now()
      and (l.valid_to is null or l.valid_to > now())
      and it.min_quantity > 1
      and (
           l.scope = 'store'
        or (l.scope = 'channel'  and l.channel_id  = v_channel)
        or (l.scope = 'segment'  and l.segment_id  = v_segment)
        or (l.scope = 'customer' and l.customer_id = v_account.customer_id)
      )
    order by 1
  loop
    v_price := (ebim.resolve_price(
      v_store.id, v_channel, p_product_id, null, null, v_q, null, now(),
      v_segment, v_account.customer_id) ->> 'unit_price')::numeric;
    if v_price is not null and (v_prev is null or v_price < v_prev) then
      min_quantity := v_q; unit_price := v_price; v_prev := v_price;
      return next;
    end if;
  end loop;
end;
$fn$;

revoke execute on function ebim.buyer_price_tiers(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.product_price_tiers_for_slug(p_store_slug text, p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
  v_slug  text := lower(btrim(coalesce(p_store_slug, '')));
  v_tiers jsonb;
  v_user  uuid := ebim.user_id();
begin
  select * into v_store
  from public.stores s
  where lower(s.slug) = v_slug and s.status = 'active';

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda "%" no existe o no esta activa', v_slug
      using errcode = '22023';
  end if;

  -- Con sesión y cuenta B2B: las escalas que ESE comprador paga.
  if v_user is not null then
    select jsonb_agg(jsonb_build_object('min_quantity', t.min_quantity::text, 'unit_price', t.unit_price::text)
                     order by t.min_quantity)
      into v_tiers
    from ebim.buyer_price_tiers(v_store.id, p_product_id, v_user) t;
  end if;

  if v_tiers is null then
    select coalesce(
             jsonb_agg(jsonb_build_object('min_quantity', t.min_quantity::text, 'unit_price', t.unit_price::text)
                       order by t.min_quantity),
             '[]'::jsonb)
      into v_tiers
    from ebim.public_price_tiers(v_store.id, p_product_id) t;
  end if;

  -- Los importes viajan como TEXTO: un número de JSON es un double y un double
  -- no es un importe (regla del repositorio desde P02).
  return jsonb_build_object('currency', v_store.currency, 'tiers', v_tiers);
end;
$fn$;

revoke execute on function public.product_price_tiers_for_slug(text, uuid) from public;
grant  execute on function public.product_price_tiers_for_slug(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Cobrado + servido = entregado
--
-- BEFORE y con un nombre que ordena DESPUÉS de `orders_axes_sync`: los
-- triggers BEFORE de la misma tabla corren por orden alfabético, y así este ve
-- el estado ya sincronizado (cobro que pasó el pedido a `paid`, etc.).
-- `paid → fulfilled` es una transición válida de `assert_order_transition`, y
-- `orders_log_status_changed` deja el evento en la línea de tiempo.
-- ---------------------------------------------------------------------------
create or replace function ebim.promote_delivered_order()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.status = 'paid' and new.fulfillment_status = 'fulfilled' then
    new.status := 'fulfilled'::public.order_status;
  end if;
  return new;
end;
$fn$;

revoke execute on function ebim.promote_delivered_order() from public, anon, authenticated;

drop trigger if exists orders_zz_promote_delivered on public.orders;
create trigger orders_zz_promote_delivered
  before update of status, payment_status, fulfillment_status on public.orders
  for each row
  execute function ebim.promote_delivered_order();

-- Los que ya están cobrados y servidos.
update public.orders
   set status = 'fulfilled'
 where status = 'paid' and fulfillment_status = 'fulfilled';
