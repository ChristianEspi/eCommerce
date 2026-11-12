-- =============================================================================
-- Cancelar un pedido anula su cobro PENDIENTE (prueba de compra real en QAS,
-- 2026-11-12).
--
-- Un pedido cancelado dejaba su intento de cobro `open`: el comprador que paga
-- por transferencia seguía viendo «pendiente de pago» y podía pagar un pedido
-- que ya no existía; el backoffice lo contaba como cobro por conciliar. En QAS
-- había 8 pedidos cancelados así.
--
-- Solo se anula lo que NO movió dinero: `open`, `requires_action` y
-- `processing`. Un intento `authorized` o `captured` tiene dinero retenido o
-- cobrado y eso lo deshace una persona (anular o devolver en Pagos), no un
-- trigger: es la misma regla que sigue el checkout con sus compensaciones.
-- =============================================================================

create or replace function ebim.cancel_open_payments_of_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.payment_intents i
     set status = 'cancelled',
         last_error_code = coalesce(i.last_error_code, 'PEDIDO_CANCELADO')
   where i.order_id = new.id
     and i.status in ('open', 'requires_action', 'processing');
  return new;
end;
$fn$;

revoke execute on function ebim.cancel_open_payments_of_cancelled_order() from public, anon, authenticated;

drop trigger if exists orders_cancel_closes_open_payments on public.orders;
create trigger orders_cancel_closes_open_payments
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function ebim.cancel_open_payments_of_cancelled_order();

-- Los que ya están cancelados con el cobro abierto.
update public.payment_intents i
   set status = 'cancelled',
       last_error_code = coalesce(i.last_error_code, 'PEDIDO_CANCELADO')
  from public.orders o
 where o.id = i.order_id
   and o.status = 'cancelled'
   and i.status in ('open', 'requires_action', 'processing');
