-- =============================================================================
-- Confirmar el cobro de un medio SIN pasarela (prueba en QAS, 2026-11-17).
--
-- ## El hueco
--
-- Yape, transferencia, contra entrega y crédito nacen con `capture_mode =
-- 'manual'`: «la captura la confirma una persona». Pero no había con qué
-- confirmarla. `payment_apply_outcome` es de servidor, y lo único que tenía el
-- backoffice era «Marcar pagado» en Pedidos, que mueve el EJE del pedido y no el
-- intento de cobro. Resultado en QAS: 28 pedidos pagados (algunos ya
-- completados) con su cobro en «Abierto», S/ 0 capturado y ningún `payments`.
-- La pantalla de Pagos no servía para saber qué falta cobrar ni para conciliar.
--
-- ## Lo que cambia
--
--  1. `public.payment_confirm_offline` — el botón «Confirmar cobro» de Pagos.
--     Una persona con rol de pedidos confirma que el dinero llegó, con el número
--     de operación si lo tiene. Pasa por `payment_apply_outcome` (origen
--     `operator`): mismo cobro, misma bitácora, mismo espejo en el pedido.
--  2. «Marcar pagado» en Pedidos registra el cobro. Un trigger: cuando el eje de
--     pago del pedido llega a `paid`, el intento OFFLINE pendiente se captura.
--     Uno de pasarela NO: ese lo confirma la pasarela, y darlo por cobrado
--     porque una persona lo dice sería inventar dinero.
--  3. Los intentos sin pedido (checkout que no llegó a crear el pedido) caducan
--     a las 24 h. Solo los que no movieron dinero; uno `authorized` tiene dinero
--     retenido y lo deshace una persona.
--  4. Regularización de lo que ya está así en la base.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · La captura de un intento offline, en un sitio
-- ---------------------------------------------------------------------------
create or replace function ebim.payment_capture_offline(
  p_intent_id uuid,
  p_source    text,
  p_reference text default null,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intent    public.payment_intents%rowtype;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note      text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  select * into v_intent from public.payment_intents i where i.id = p_intent_id for update;
  if not found then
    raise exception 'INTENTO_NO_ENCONTRADO: no hay ningun intento de pago con ese identificador'
      using errcode = '22023';
  end if;

  if v_intent.provider_code is not null or v_intent.capture_mode <> 'manual' then
    raise exception 'COBRO_CON_PASARELA: este cobro lo confirma la pasarela, no una persona'
      using errcode = '42501';
  end if;

  if v_intent.status = 'captured' then
    return jsonb_build_object('intent_id', v_intent.id, 'status', 'captured', 'replay', true);
  end if;
  if v_intent.status not in ('open', 'processing', 'requires_action', 'authorized') then
    raise exception 'COBRO_NO_PENDIENTE: este cobro esta % y ya no se puede confirmar', v_intent.status
      using errcode = '23514';
  end if;

  if v_reference is not null and (
       char_length(v_reference) > 120 or ebim.looks_like_pan(v_reference)) then
    raise exception 'REFERENCIA_NO_VALIDA: el numero de operacion no es valido'
      using errcode = '22023';
  end if;

  return public.payment_apply_outcome(
    p_intent_id          => v_intent.id,
    p_operation          => 'payment.manual_capture',
    -- Una confirmación por intento: dos clics seguidos son una sola.
    p_idempotency_key    => 'manual-capture:' || v_intent.id::text,
    p_attempt_status     => 'succeeded',
    p_intent_status      => 'captured',
    p_amount             => v_intent.amount - v_intent.amount_captured,
    p_provider_reference => v_reference,
    p_source             => p_source,
    p_payload            => jsonb_strip_nulls(jsonb_build_object(
                              'confirmed_by', ebim.email(),
                              'reference',    v_reference,
                              'note',         v_note))
  );
end;
$fn$;

revoke execute on function ebim.payment_capture_offline(uuid, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · «Confirmar cobro» desde Pagos
-- ---------------------------------------------------------------------------
create or replace function public.payment_confirm_offline(
  p_intent_id uuid,
  p_reference text default null,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intent public.payment_intents%rowtype;
begin
  select * into v_intent from public.payment_intents i where i.id = p_intent_id;
  if not found then
    raise exception 'INTENTO_NO_ENCONTRADO: no hay ningun intento de pago con ese identificador'
      using errcode = '22023';
  end if;

  -- El tenant sale de la FILA y se comprueba contra el JWT: rol de pedidos
  -- sobre esa sociedad, y el super admin de suite fuera.
  perform ebim.assert_payment_operator(v_intent.organization_id, v_intent.company_id);

  return ebim.payment_capture_offline(v_intent.id, 'operator', p_reference, p_note);
end;
$fn$;

revoke execute on function public.payment_confirm_offline(uuid, text, text) from public, anon;
grant execute on function public.payment_confirm_offline(uuid, text, text) to authenticated;

comment on function public.payment_confirm_offline(uuid, text, text) is
  'Confirma a mano el cobro de un medio sin pasarela (Yape, transferencia, contra entrega). Rol owner/admin/orders.';

-- ---------------------------------------------------------------------------
-- 3 · «Marcar pagado» en Pedidos captura el cobro offline pendiente
--
-- Cuando el que pone el pedido en `paid` es el propio cobro (la pasarela, o la
-- confirmación de arriba), el intento ya está `captured` antes de que esto
-- corra y no queda nada que hacer: no hay bucle.
-- ---------------------------------------------------------------------------
create or replace function ebim.capture_offline_payment_of_paid_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_intent_id uuid;
begin
  select i.id into v_intent_id
    from public.payment_intents i
   where i.order_id = new.id
     and i.provider_code is null
     and i.capture_mode = 'manual'
     and i.status in ('open', 'processing', 'requires_action', 'authorized')
   order by i.created_at desc
   limit 1;

  if v_intent_id is not null then
    perform ebim.payment_capture_offline(
      v_intent_id,
      case when ebim.user_id() is null then 'system' else 'operator' end,
      null,
      nullif(current_setting('ebim.order_event_reason', true), ''));
  end if;
  return new;
end;
$fn$;

revoke execute on function ebim.capture_offline_payment_of_paid_order() from public, anon, authenticated;

drop trigger if exists orders_paid_captures_offline_payment on public.orders;
create trigger orders_paid_captures_offline_payment
  after update of payment_status on public.orders
  for each row
  when (new.payment_status = 'paid' and old.payment_status is distinct from 'paid')
  execute function ebim.capture_offline_payment_of_paid_order();

-- ---------------------------------------------------------------------------
-- 4 · Cobros sin pedido: caducan
-- ---------------------------------------------------------------------------
create or replace function ebim.expire_orphan_payment_intents(
  p_older_than interval default interval '24 hours'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select i.id
      from public.payment_intents i
     where i.order_id is null
       and i.status in ('open', 'processing', 'requires_action')
       and i.created_at < now() - p_older_than
     order by i.created_at
     limit 500
  loop
    perform public.payment_apply_outcome(
      p_intent_id       => v_id,
      p_operation       => 'payment.expire',
      p_idempotency_key => 'expire-orphan:' || v_id::text,
      p_attempt_status  => 'failed',
      p_intent_status   => 'expired',
      p_error_code      => 'SIN_PEDIDO',
      p_error_detail    => 'el checkout no llego a crear el pedido',
      p_source          => 'system');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

revoke execute on function ebim.expire_orphan_payment_intents(interval) from public, anon, authenticated;

do $programacion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron no disponible: no se programa la caducidad de cobros sin pedido';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  if exists (select 1 from cron.job where jobname = 'ecommerce-expire-orphan-payments') then
    perform cron.unschedule('ecommerce-expire-orphan-payments');
  end if;
  perform cron.schedule(
    'ecommerce-expire-orphan-payments',
    '17 * * * *',
    $trabajo$ select ebim.expire_orphan_payment_intents(); $trabajo$
  );
end
$programacion$;

-- ---------------------------------------------------------------------------
-- 5 · Regularización: pedidos ya pagados con su cobro offline abierto
-- ---------------------------------------------------------------------------
do $regularizacion$
declare
  v_id uuid;
begin
  for v_id in
    select i.id
      from public.payment_intents i
      join public.orders o on o.id = i.order_id
     where o.payment_status = 'paid'
       and i.provider_code is null
       and i.capture_mode = 'manual'
       and i.status in ('open', 'processing', 'requires_action', 'authorized')
  loop
    perform ebim.payment_capture_offline(
      v_id, 'system', null, 'regularizacion: el pedido ya estaba marcado pagado');
  end loop;
end
$regularizacion$;

select ebim.expire_orphan_payment_intents();
