-- =============================================================================
-- El surtido se respeta en TODA la tienda (2026-11-16)
--
-- Hasta hoy el surtido solo actuaba en pedido rápido, pedidos programados,
-- pedido sugerido y cotizaciones. Un comprador B2B con lista blanca podía
-- buscar cualquier producto, añadirlo al carrito y comprarlo por el checkout
-- normal: el surtido decía «qué puede comprar» y no lo hacía cumplir.
--
-- ## Dos piezas
--
-- 1. `order_items_assortment_guard` (BEFORE INSERT en `order_items`): toda
--    línea de pedido de una CUENTA B2B se comprueba contra su surtido con la
--    regla de siempre (`ebim.product_in_assortment`). Es el único punto por el
--    que pasan TODOS los pedidos —checkout, API de socio, cotización
--    convertida, programados—, así que ninguna ruta puede saltárselo, ni las
--    que nazcan mañana. Fuera de surtido → `PRODUCTO_FUERA_DE_SURTIDO` y el
--    pedido entero no se crea.
--
-- 2. `public.my_assortment_blocked(slug, productos[])`: qué productos de una
--    lista NO puede comprar quien navega, para que la tienda los marque y no
--    deje añadirlos (ficha, tarjetas, carrito). La cuenta sale de la SESIÓN con
--    `ebim.pricing_actor` —la misma cuenta efectiva que fija el precio y firma el
--    pedido («Comprando para»)—, nunca de un parámetro.
--
-- Igual que antes: sin cuenta B2B (consumidor) o sin el módulo
-- `trade.assortments` contratado, el surtido no recorta nada.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · La guarda de las líneas de pedido
-- ---------------------------------------------------------------------------
create or replace function ebim.order_items_assortment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order    public.orders%rowtype;
  v_customer uuid;
  v_sku      text;
begin
  select * into v_order from public.orders o where o.id = new.order_id;
  if not found or v_order.business_account_id is null or new.product_id is null then
    return new;
  end if;

  if not ebim.company_is_entitled(v_order.organization_id, v_order.company_id, 'trade.assortments') then
    return new;
  end if;

  select a.customer_id into v_customer
    from public.business_accounts a
   where a.id = v_order.business_account_id;
  if v_customer is null then
    return new;
  end if;

  if not ebim.product_in_assortment(v_order.store_id, v_customer, new.product_id, v_order.channel_id) then
    select p.sku into v_sku from public.products p where p.id = new.product_id;
    raise exception 'PRODUCTO_FUERA_DE_SURTIDO: % no esta en el surtido de esta cuenta', coalesce(v_sku, new.product_id::text)
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;
revoke execute on function ebim.order_items_assortment_guard() from public, anon, authenticated;

drop trigger if exists order_items_assortment_guard on public.order_items;
create trigger order_items_assortment_guard
  before insert on public.order_items
  for each row execute function ebim.order_items_assortment_guard();

-- ---------------------------------------------------------------------------
-- 2 · Qué no puede comprar quien navega
-- ---------------------------------------------------------------------------
create or replace function public.my_assortment_blocked(p_store_slug text, p_product_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype;
  v_channel uuid;
  v_actor   public.customers;
  v_result  uuid[];
begin
  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    return '{}'::uuid[];
  end if;
  if cardinality(p_product_ids) > 500 then
    raise exception 'DEMASIADOS_PRODUCTOS: como mucho 500 por consulta' using errcode = '22023';
  end if;

  select * into v_store from public.stores s
   where lower(s.slug) = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return '{}'::uuid[];
  end if;

  if not ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'trade.assortments') then
    return '{}'::uuid[];
  end if;

  v_actor := ebim.pricing_actor(v_store.organization_id, v_store.company_id);
  if v_actor.id is null then
    return '{}'::uuid[];
  end if;

  select c.id into v_channel from public.channels c
   where c.store_id = v_store.id and c.is_default and c.is_active;

  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) into v_result
    from unnest(p_product_ids) as x(id)
   where not ebim.product_in_assortment(v_store.id, v_actor.id, x.id, v_channel);
  return v_result;
end;
$fn$;
revoke execute on function public.my_assortment_blocked(text, uuid[]) from public, anon;
grant  execute on function public.my_assortment_blocked(text, uuid[]) to authenticated;

comment on function public.my_assortment_blocked(text, uuid[]) is
  'Productos de la lista que la cuenta B2B efectiva de la sesión NO puede comprar por su surtido. Vacío sin cuenta o sin el módulo.';
