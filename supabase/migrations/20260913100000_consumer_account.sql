-- =============================================================================
-- Hardening multi-commerce · H02-H04 — la cuenta del CONSUMIDOR registrado.
--
-- ## El hueco
--
-- Un comprador con sesión y SIN cuenta de empresa no tenía nada suyo en el
-- servidor salvo favoritos y avisos. `orders` no guarda quién compró —ni
-- `user_id` ni `customer_id`, y es deliberado desde P05—, así que «Mis pedidos»
-- no tenía de dónde salir. Buscar por correo NO es una respuesta: los usuarios
-- de Auth son de todo el proyecto, un administrador de OTRO tenant puede crear
-- una cuenta con cualquier correo desde su backoffice, y esa cuenta vería los
-- pedidos de invitado de ese correo en todas las tiendas.
--
-- ## La respuesta: un vínculo que escribe el servidor, no un filtro por correo
--
-- `order_buyers` anota «este pedido lo hizo este usuario verificado». Lo
-- escribe la Edge Function del checkout DESPUÉS de crear el pedido, con el
-- usuario que devolvió `current_buyer()` —PostgREST verificó la firma del token
-- antes—, y a través de una función que solo `service_role` puede ejecutar.
--
--  · No toca `orders`, `create_order` ni `checkout_place_order`: el pedido se
--    crea exactamente igual y el vínculo es aditivo.
--  · Si escribir el vínculo falla, el pedido sigue existiendo: se registra el
--    fallo y la compra no se cae (el pedido es la verdad; el vínculo, un índice).
--  · El primero que vincula gana: un pedido no cambia de dueño.
--
-- ## Lo que el consumidor puede leer
--
-- Tres funciones, ninguna acepta una identidad: el usuario sale del JWT y la
-- tienda del slug público.
--
--  · `my_consumer_orders(slug)`         — su lista, en ESTA tienda.
--  · `my_consumer_order_detail(slug,id)` — líneas y desglose tal como se cobró.
--  · `my_checkout_profile(slug)`        — contacto y direcciones de SUS pedidos
--                                          anteriores, para no reescribirlos.
--
-- No hay libreta de direcciones nueva: las direcciones salen de los pedidos que
-- ya existen. Una libreta editable necesitaría una tabla propia del comprador y
-- queda como follow-up documentado.
-- =============================================================================

create table public.order_buyers (
  order_id        uuid        primary key,
  organization_id uuid        not null,
  company_id      uuid        not null,
  store_id        uuid        not null,
  -- `sub` del JWT VERIFICADO de quien compró. Lo pone la función de servidor;
  -- el navegador no tiene ninguna puerta para escribirlo.
  user_id         uuid        not null,
  created_at      timestamptz not null default now(),
  -- Las dos claves del pedido, con tenant y con tienda: el vínculo no puede
  -- apuntar a un pedido de otra sociedad ni de otra tienda.
  constraint order_buyers_order_fk foreign key (order_id, organization_id, company_id)
    references public.orders (id, organization_id, company_id) on delete cascade,
  constraint order_buyers_order_store_fk foreign key (order_id, store_id)
    references public.orders (id, store_id) on delete cascade
);

create index order_buyers_user_idx   on public.order_buyers (user_id, store_id, created_at desc);
create index order_buyers_tenant_idx on public.order_buyers (organization_id, company_id);

alter table public.order_buyers enable row level security;
alter table public.order_buyers force  row level security;

-- El comprador ve SUS vínculos y nada más.
create policy order_buyers_select_own on public.order_buyers
  for select to authenticated
  using (user_id = ebim.user_id());

-- El backoffice ve los de su tenant: es información de SUS pedidos.
create policy order_buyers_select_member on public.order_buyers
  for select to authenticated
  using (ebim.can_access(organization_id, company_id));

-- Solo lectura para `authenticated`; `anon` no aparece. La escritura no existe
-- como privilegio de tabla: pasa por la función de abajo.
revoke all on public.order_buyers from public, anon, authenticated;
grant select on public.order_buyers to authenticated;
grant all    on public.order_buyers to service_role;

comment on table public.order_buyers is
  'Quien hizo cada pedido, cuando lo hizo con sesion. Lo escribe checkout_link_order_buyer (solo service_role) con el usuario verificado por current_buyer().';

-- ---------------------------------------------------------------------------
-- checkout_link_order_buyer — la única puerta de escritura.
--
-- Solo `service_role`: la llama el orquestador del checkout con el usuario que
-- la base ya verificó. Devuelve `true` si el pedido queda vinculado a ESE
-- usuario (recién o de antes) y `false` si no existe, es de otro o es antiguo.
--
-- Ventana de un día: el vínculo nace en la misma petición que el pedido o en su
-- reintento. Vincular un pedido de hace un mes no es un caso del checkout.
-- ---------------------------------------------------------------------------
create or replace function public.checkout_link_order_buyer(
  p_order_id uuid,
  p_user_id  uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner uuid;
begin
  if p_order_id is null or p_user_id is null then
    return false;
  end if;

  insert into public.order_buyers (order_id, organization_id, company_id, store_id, user_id)
  select o.id, o.organization_id, o.company_id, o.store_id, p_user_id
  from public.orders o
  where o.id = p_order_id
    and o.placed_at > now() - interval '1 day'
  on conflict (order_id) do nothing;

  select b.user_id into v_owner from public.order_buyers b where b.order_id = p_order_id;
  return v_owner is not null and v_owner = p_user_id;
end;
$fn$;

revoke execute on function public.checkout_link_order_buyer(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.checkout_link_order_buyer(uuid, uuid) to service_role;

comment on function public.checkout_link_order_buyer(uuid, uuid) is
  'Vincula un pedido recien creado con el usuario verificado que lo compro. Solo service_role. El primero gana; idempotente.';

-- ---------------------------------------------------------------------------
-- my_consumer_orders — «Mis pedidos» del comprador con sesión, en una tienda.
--
-- La tienda por su slug público y ACTIVA; el usuario por el JWT. Devuelve una
-- lista (vacía si no hay nada), nunca un error por «no tener pedidos».
-- ---------------------------------------------------------------------------
create or replace function public.my_consumer_orders(
  p_store_slug text,
  p_limit      integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user  uuid := ebim.user_id();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows  jsonb;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(r.row order by r.placed_at desc, r.order_number desc), '[]'::jsonb)
    into v_rows
  from (
    select o.placed_at,
           o.order_number,
           jsonb_build_object(
             'order_id',           o.id,
             'order_number',       o.order_number,
             'placed_at',          o.placed_at,
             'status',             o.status,
             'payment_status',     o.payment_status,
             'fulfillment_status', o.fulfillment_status,
             'approval_status',    o.approval_status,
             'currency',           o.currency,
             'grand_total',        o.grand_total::text,
             'item_count',         (select coalesce(sum(i.quantity), 0)::int
                                      from public.order_items i where i.order_id = o.id)
           ) as row
    from public.order_buyers b
    join public.orders o on o.id = b.order_id
    join public.stores s on s.id = o.store_id
    where b.user_id = v_user
      and s.slug    = lower(btrim(p_store_slug))
      and s.status  = 'active'
    order by o.placed_at desc, o.order_number desc
    limit v_limit
  ) r;

  return v_rows;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- my_consumer_order_detail — el pedido tal como se cobró.
--
-- Precios y totales son la FOTO guardada en `orders`/`order_items`; ni un
-- importe se recalcula. `product_id` y `variant_id` viajan para poder volver a
-- comprar, que manda las líneas al carrito y las recotiza con el precio de hoy.
-- ---------------------------------------------------------------------------
create or replace function public.my_consumer_order_detail(
  p_store_slug text,
  p_order_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user       uuid := ebim.user_id();
  v_order      public.orders%rowtype;
  v_items      jsonb;
  v_deliveries jsonb;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select o.* into v_order
  from public.order_buyers b
  join public.orders o on o.id = b.order_id
  join public.stores s on s.id = o.store_id
  where b.user_id  = v_user
    and b.order_id = p_order_id
    and s.slug     = lower(btrim(p_store_slug))
    and s.status   = 'active';

  if not found then
    -- Mismo mensaje exista o no, sea de otro o no: no se revela nada.
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido tuyo con ese id'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id',    i.product_id,
           'variant_id',    i.variant_id,
           'name',          i.name,
           'sku',           i.sku,
           'variant_label', i.variant_label,
           'quantity',      i.quantity,
           'unit_price',    i.unit_price::text,
           'discount',      i.discount_amount::text,
           'total',         i.line_total::text
         ) order by i.created_at, i.name), '[]'::jsonb)
    into v_items
  from public.order_items i
  where i.order_id = v_order.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'method_name',   f.method_name,
           'strategy',      f.strategy,
           'state',         f.state,
           'promised_from', f.promised_from,
           'promised_to',   f.promised_to
         ) order by f.sequence), '[]'::jsonb)
    into v_deliveries
  from public.fulfillments f
  where f.order_id = v_order.id and f.state <> 'cancelled';

  return jsonb_build_object(
    'order_id',           v_order.id,
    'order_number',       v_order.order_number,
    'status',             v_order.status,
    'payment_status',     v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status,
    'placed_at',          v_order.placed_at,
    'currency',           v_order.currency,
    'subtotal',           v_order.subtotal::text,
    'discount_total',     v_order.discount_total::text,
    'tax_total',          v_order.tax_total::text,
    'shipping_total',     v_order.shipping_total::text,
    'grand_total',        v_order.grand_total::text,
    'shipping_address',   v_order.shipping_address,
    'items',              v_items,
    'deliveries',         v_deliveries
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- my_checkout_profile — lo que el comprador ya escribió en SUS pedidos.
--
-- Contacto del último pedido y hasta cinco direcciones de entrega distintas, la
-- más reciente primero. Solo de pedidos vinculados a su usuario en esta tienda:
-- un pedido de invitado con su correo NO cuenta, por la misma razón por la que
-- «Mis pedidos» no filtra por correo.
-- ---------------------------------------------------------------------------
create or replace function public.my_checkout_profile(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user      uuid := ebim.user_id();
  v_contact   jsonb;
  v_addresses jsonb;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select jsonb_build_object('name', o.customer_name, 'phone', o.customer_phone)
    into v_contact
  from public.order_buyers b
  join public.orders o on o.id = b.order_id
  join public.stores s on s.id = o.store_id
  where b.user_id = v_user
    and s.slug    = lower(btrim(p_store_slug))
    and s.status  = 'active'
  order by o.placed_at desc
  limit 1;

  select coalesce(jsonb_agg(r.address order by r.last_used desc), '[]'::jsonb)
    into v_addresses
  from (
    select d.address, d.last_used
    from (
      select distinct on (lower(btrim(o.shipping_address ->> 'address')),
                          lower(btrim(coalesce(o.shipping_address ->> 'city', ''))))
             jsonb_strip_nulls(jsonb_build_object(
               'address',     o.shipping_address ->> 'address',
               'reference',   o.shipping_address ->> 'reference',
               'city',        o.shipping_address ->> 'city',
               'region',      o.shipping_address ->> 'region',
               'postal_code', o.shipping_address ->> 'postal_code',
               'country',     o.shipping_address ->> 'country'
             )) as address,
             o.placed_at as last_used
      from public.order_buyers b
      join public.orders o on o.id = b.order_id
      join public.stores s on s.id = o.store_id
      where b.user_id = v_user
        and s.slug    = lower(btrim(p_store_slug))
        and s.status  = 'active'
        and nullif(btrim(o.shipping_address ->> 'address'), '') is not null
      order by lower(btrim(o.shipping_address ->> 'address')),
               lower(btrim(coalesce(o.shipping_address ->> 'city', ''))),
               o.placed_at desc
    ) d
    order by d.last_used desc
    limit 5
  ) r;

  return jsonb_build_object(
    'contact',   v_contact,
    'addresses', v_addresses
  );
end;
$fn$;

revoke execute on function public.my_consumer_orders(text, integer)     from public, anon;
revoke execute on function public.my_consumer_order_detail(text, uuid)  from public, anon;
revoke execute on function public.my_checkout_profile(text)             from public, anon;

grant execute on function public.my_consumer_orders(text, integer)     to authenticated;
grant execute on function public.my_consumer_order_detail(text, uuid)  to authenticated;
grant execute on function public.my_checkout_profile(text)             to authenticated;
