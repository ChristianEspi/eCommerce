-- =============================================================================
-- Facturación electrónica Perú · fase 4 — el comprador ve su comprobante
-- (2026-11-20)
--
-- 1. `my_order_invoice(order_id)`: el comprobante de UN pedido del comprador,
--    para «Mi cuenta». Solo para quien compró (order_buyers) o un miembro
--    ACTIVO de la cuenta B2B del pedido: las mismas dos reglas que
--    `my_consumer_order_detail` y `my_business_order_detail`. Mismo mensaje si
--    no existe o no es suyo: no se revela nada.
--    Solo datos del comprobante que el comprador ya puede ver en el papel:
--    tipo, serie-número, estado, fecha, total y el PDF.
--
-- 2. El correo «Tu boleta / Tu factura» con el enlace al PDF, UNA vez, cuando
--    el emisor lo emite (pasa de pendiente a emitido o aceptado y hay PDF). Por
--    la cola de correo de siempre (`invoice.issued`), con la marca de la tienda.
-- =============================================================================

create or replace function public.my_order_invoice(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user  uuid := ebim.user_id();
  v_order public.orders%rowtype;
  v_inv   public.invoices%rowtype;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
   where o.id = p_order_id
     and (
       exists (select 1 from public.order_buyers b where b.order_id = o.id and b.user_id = v_user)
       or exists (select 1
                    from public.business_accounts a
                    join public.business_account_users u
                      on u.business_account_id = a.id and u.user_id = v_user and u.status = 'active'
                   where a.id = o.business_account_id and a.is_active)
     );
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido tuyo con ese id' using errcode = '22023';
  end if;

  -- El vigente: el último que no fue anulado ni rechazado; si no hay, el último.
  select i.* into v_inv
    from public.invoices i
   where i.order_id = v_order.id
   order by (i.status in ('cancelled', 'rejected')), i.created_at desc
   limit 1;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'document_type', coalesce(v_inv.document_type, case when v_inv.series like 'F%' then 'invoice' else 'receipt' end),
    'series',        v_inv.series,
    'number',        v_inv.number,
    'status',        v_inv.status::text,
    'issued_at',     v_inv.issued_at,
    'currency',      v_inv.currency,
    'gross_total',   v_inv.gross_total::text,
    -- Solo https: es un enlace que la pantalla abre.
    'pdf_url',       case when v_inv.pdf_url ~ '^https://' then v_inv.pdf_url end);
end;
$fn$;

revoke execute on function public.my_order_invoice(uuid) from public, anon;
grant  execute on function public.my_order_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Correo al comprador cuando el comprobante sale
-- ---------------------------------------------------------------------------
create or replace function ebim.invoice_notify_buyer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order public.orders%rowtype;
  v_doc   text;
begin
  -- Solo la primera vez que sale (pendiente → emitido/aceptado) y con PDF.
  if old.status <> 'pending' or new.status not in ('issued', 'accepted') or new.pdf_url is null
     or new.pdf_url !~ '^https://' then
    return new;
  end if;

  select * into v_order from public.orders o where o.id = new.order_id;
  if not found or v_order.customer_email is null then
    return new;
  end if;

  v_doc := coalesce(new.document_type, case when new.series like 'F%' then 'invoice' else 'receipt' end);

  perform ebim.queue_notification_email(
    new.organization_id, new.company_id, new.store_id, 'invoice.issued', v_order.customer_email,
    ebim.notification_store_params(new.store_id) || jsonb_build_object(
      'order_number',   v_order.order_number,
      'document_type',  v_doc,
      'invoice_number', new.series || '-' || coalesce(new.number, ''),
      'grand_total',    new.gross_total::text,
      'currency',       new.currency,
      'pdf_url',        new.pdf_url),
    'invoice.issued:' || new.id::text);
  return new;
end;
$fn$;

revoke execute on function ebim.invoice_notify_buyer() from public, anon, authenticated;

drop trigger if exists invoices_notify_buyer on public.invoices;
create trigger invoices_notify_buyer
  after update of status on public.invoices
  for each row
  when (old.status is distinct from new.status)
  execute function ebim.invoice_notify_buyer();
