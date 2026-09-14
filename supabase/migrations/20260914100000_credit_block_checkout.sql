-- =============================================================================
-- Cierre P0 · A1 — el credito BLOQUEADO de verdad impide comprar.
--
-- ## El hueco
--
-- `business_accounts.credit_status` existe desde `20260902120000_credit_receivables`,
-- y su comentario de columna promete que «`blocked` lo lee el gancho de
-- checkout». Ese gancho nunca se escribio: una cuenta con el credito bloqueado
-- compraba igual que una al dia. El estado solo lo miraba el despacho
-- (`fulfillment_transition`), que es tarde: para entonces el pedido ya existe,
-- el stock ya esta reservado y el pago ya se abrio.
--
-- ## Donde vive la regla, y por que en DOS sitios
--
--  1. **La autoridad es la BASE: un trigger `before insert` sobre `orders`.**
--     Cualquier camino que llegue a crear un pedido —el pipeline de checkout,
--     `create_order_for_slug`, la API enterprise o un `insert` de servidor— pasa
--     por esa fila. Un candado ahi no depende de que nadie se acuerde de
--     llamarlo, y al abortar la insercion revierte en la MISMA transaccion todo
--     lo que `create_order` hizo antes: lineas, consumo de la reserva, cupones.
--
--     No es un `if` dentro de `create_order`, que es justo lo que el comentario
--     original de `credit_receivables` pedia evitar: esa funcion tiene ya
--     ochocientas lineas y cuatro redefiniciones, y otra regla de negocio
--     enterrada en ella seria otra copia que mantener alineada en la siguiente.
--
--  2. **El aviso TEMPRANO es del pipeline**, en su etapa 2 (`validate_account`),
--     antes de precio, reserva y pago. Para eso `my_effective_business_account_for_slug`
--     devuelve ahora `credit_status`. Sin este aviso el trigger seguiria
--     impidiendo el pedido, pero despues de reservar stock y abrir el intento
--     de pago, obligando a compensar lo que nunca debio empezar.
--
-- ## Lo que NO hace
--
--  - `watch` no bloquea. Es una senal para quien cobra, no una prohibicion, y
--    el negocio no ha pedido que lo sea.
--  - Solo mira la INSERCION. Los pedidos que ya existian cuando la cuenta se
--    bloqueo siguen su curso; su despacho lo gobierna `fulfillment_transition`
--    como hasta ahora.
--  - Un pedido sin cuenta corporativa (consumidor, invitado) no se ve afectado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- La autoridad: ningun pedido nuevo para una cuenta con el credito bloqueado.
--
-- `security definer` porque la comprobacion tiene que funcionar sea quien sea
-- el que inserta: el trigger corre con los permisos de quien ejecuta la
-- sentencia, y una policy que le escondiera la fila de la cuenta convertiria el
-- candado en un pase libre. Lee UNA fila por clave primaria y no escribe nada.
-- ---------------------------------------------------------------------------
create or replace function ebim.assert_order_account_credit_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status public.credit_status;
begin
  if new.business_account_id is null then
    return new;
  end if;

  select a.credit_status into v_status
  from public.business_accounts a
  where a.id = new.business_account_id;

  if v_status = 'blocked' then
    raise exception 'CREDITO_BLOQUEADO: la cuenta corporativa tiene el credito bloqueado'
      using errcode = '22023';
  end if;

  return new;
end;
$fn$;

revoke execute on function ebim.assert_order_account_credit_open() from public;

drop trigger if exists orders_assert_account_credit_open on public.orders;
create trigger orders_assert_account_credit_open
  before insert on public.orders
  for each row execute function ebim.assert_order_account_credit_open();

comment on function ebim.assert_order_account_credit_open() is
  'Cierre A1: impide INSERTAR un pedido para una cuenta con credit_status=blocked (CREDITO_BLOQUEADO). Autoridad de base; el pipeline avisa antes de reservar y cobrar.';

-- ---------------------------------------------------------------------------
-- my_effective_business_account_for_slug (+ credit_status)
--
-- Cuerpo identico al de `20260913130000_effective_business_account`, con un
-- campo mas en la respuesta. El estado de credito se devuelve TAL CUAL: la
-- decision de que `blocked` impide comprar la toma el servidor (etapa 2 del
-- pipeline y trigger), no quien lea este jsonb.
-- ---------------------------------------------------------------------------
create or replace function public.my_effective_business_account_for_slug(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user       uuid := ebim.user_id();
  v_store      public.stores%rowtype;
  v_account_id uuid;
  v_result     jsonb;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select s.* into v_store
  from public.stores s
  where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return null;
  end if;

  v_account_id := ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id);
  if v_account_id is null then
    return null;
  end if;

  select jsonb_build_object(
           'account_id',              a.id,
           'code',                    a.code,
           'name',                    a.name,
           'customer_name',           c.name,
           'role',                    u.role,
           'spending_limit',          case when u.spending_limit is null then null
                                           else u.spending_limit::text end,
           'purchase_order_required', a.purchase_order_required,
           'credit_status',           a.credit_status)
    into v_result
  from public.business_accounts a
  join public.customers c on c.id = a.customer_id
  join public.business_account_users u
    on u.business_account_id = a.id and u.user_id = v_user and u.status = 'active'
  where a.id = v_account_id
  limit 1;

  return v_result;
end;
$fn$;

revoke execute on function public.my_effective_business_account_for_slug(text) from public, anon;
grant  execute on function public.my_effective_business_account_for_slug(text) to authenticated;

comment on function public.my_effective_business_account_for_slug(text) is
  'Cuenta B2B efectiva del usuario con sesion en esta tienda (la misma del precio). La usa el checkout para firmar el pedido; desde A1 devuelve credit_status para detenerse antes de reservar y cobrar.';

comment on column public.business_accounts.credit_status is
  'ok | watch | blocked. `blocked` impide crear pedidos nuevos (trigger orders_assert_account_credit_open, A1) y quita la exencion de despacho a credito. `watch` es una senal, no bloquea.';
