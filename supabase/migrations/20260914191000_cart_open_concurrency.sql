-- =============================================================================
-- Cierre · certificación — `cart_open` concurrente ya no falla con 409.
--
-- ## El defecto
--
-- Encontrado por el E2E de certificación (`enterprise.e2e.ts`, pila local): la
-- consola registró un 409 de `rpc/cart_open`. Reproducido en Postgres 17.6 con
-- llamadas simultáneas de un comprador CON SESIÓN que no tiene carrito activo
-- —el estado en el que queda cualquier comprador justo después de pagar, porque
-- su carrito pasa a `converted`—: con 20 llamadas a la vez fallaron entre 9 y 19
-- con `duplicate key value violates unique constraint
-- "carts_one_active_per_user"`.
--
-- Las dos llamadas veían «no hay carrito activo» y las dos insertaban; el índice
-- único hacía su trabajo —nunca hubo dos carritos— pero la perdedora abortaba en
-- vez de devolver el carrito que acababa de crear la ganadora. La vitrina abre
-- el carrito desde más de un sitio al cargar (proveedor, cabecera, sesión), así
-- que en la práctica ocurre.
--
-- ## El arreglo
--
--  1. El alta del carrito con sesión es `on conflict ... do nothing` sobre el
--     MISMO índice parcial, y si no insertó, lee el que ganó. Mismo resultado
--     para todas las llamadas.
--  2. El carrito del invitado que se va a fusionar se lee `for update`: dos
--     llamadas con el mismo token ya no pueden fusionarlo dos veces; la segunda
--     espera, lo ve `merged` y no hace nada.
--
-- Base: `20260830100300_guest_cart_retention.sql`, la última definición. Nada
-- más cambia: firma, GRANT, recogida de invitados y respuesta son las mismas.
-- =============================================================================

create or replace function public.cart_open(
  p_store_slug text,
  p_token      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype;
  v_channel public.channels%rowtype;
  v_user    uuid := ebim.user_id();
  v_token   text := nullif(btrim(coalesce(p_token, '')), '');
  v_guest   public.carts%rowtype;
  v_cart    public.carts%rowtype;
begin
  v_store   := ebim.active_store_by_slug(p_store_slug);
  v_channel := ebim.public_channel(v_store.id);

  perform ebim.expire_due_carts(v_store.id);
  perform ebim.sweep_empty_guest_carts(v_store.id);

  if v_token is not null and char_length(v_token) = 64 then
    -- Cierre · certificación (2): `for update` para que la fusión sea una sola.
    select * into v_guest
    from public.carts c
    where c.store_id = v_store.id
      and c.token = v_token
      and c.status = 'active'
    for update;
    if not found then v_guest := null; end if;
  end if;

  if v_user is null then
    if v_guest.id is not null and v_guest.user_id is null then
      update public.carts
         set last_activity_at = now()
       where id = v_guest.id;
      return ebim.cart_payload(v_guest.id, true);
    end if;

    insert into public.carts (
      organization_id, company_id, store_id, channel_id, currency, expires_at
    ) values (
      v_store.organization_id, v_store.company_id, v_store.id, v_channel.id,
      v_store.currency, now() + interval '2 hours'
    )
    returning * into v_cart;

    return ebim.cart_payload(v_cart.id, true);
  end if;

  select * into v_cart
  from public.carts c
  where c.store_id   = v_store.id
    and c.channel_id = v_channel.id
    and c.user_id    = v_user
    and c.status     = 'active';

  if not found then
    -- Cierre · certificación (1): si otra llamada lo creó a la vez, no se
    -- aborta; se usa el suyo.
    insert into public.carts (
      organization_id, company_id, store_id, channel_id, user_id, currency, expires_at
    ) values (
      v_store.organization_id, v_store.company_id, v_store.id, v_channel.id, v_user,
      v_store.currency, now() + interval '30 days'
    )
    on conflict (store_id, channel_id, user_id) where status = 'active' and user_id is not null
      do nothing
    returning * into v_cart;

    if v_cart.id is null then
      select * into v_cart
      from public.carts c
      where c.store_id   = v_store.id
        and c.channel_id = v_channel.id
        and c.user_id    = v_user
        and c.status     = 'active';
    end if;
  end if;

  if v_guest.id is not null and v_guest.user_id is null and v_guest.id <> v_cart.id then
    perform ebim.merge_cart_lines(v_guest.id, v_cart.id);
    perform ebim.cart_refresh_prices(v_cart.id);
  end if;

  update public.carts
     set last_activity_at = now()
   where id = v_cart.id;

  return ebim.cart_payload(v_cart.id, true);
end;
$fn$;

comment on function public.cart_open(text, text) is
  'Abre o recupera el carrito de quien llama: con sesion el suyo, sin sesion el del token. Un token de invitado presentado CON sesion fusiona ese carrito en el del usuario. Recoge de paso los carritos de invitado que quedaron vacios (P16-SaaS). Concurrente sin 409: el alta con sesion es on conflict y la fusion bloquea el carrito del invitado.';
