-- =============================================================================
-- Crédito y cobranza sin huecos (prueba en QAS, 2026-11-17).
--
-- ## Lo que pasaba
--
-- Un pedido vendido a crédito (medio de familia `credit`) entraba y no dejaba
-- rastro en cobranza: ningún `ar_documents`, el límite no se miraba al comprar,
-- un cobro registrado en Cobranza no ponía el pedido en pagado y cancelar el
-- pedido no liberaba nada. En QAS, Policlínico Andino tenía 2 pedidos a crédito
-- por S/ 4,063.04 y Cobranza enseñaba solo tres facturas de ejemplo.
--
-- ## El ciclo, de punta a punta
--
--   1. Comprar     `checkout_credit_check`: el checkout pregunta ANTES de crear
--                  el pedido si la línea alcanza (y si existe, y si no está
--                  bloqueada). No alcanza → CREDITO_EXCEDIDO, sin pedido.
--   2. Deber       al atar el cobro a crédito al pedido nace su documento por
--                  cobrar: número = número de pedido, vence a los días de
--                  plazo de la cuenta, importe = total del pedido.
--   3. Cobrar      `ar_register_receipt`: recibo + aplicaciones en UNA
--                  transacción. Antes eran dos escrituras desde el navegador.
--   4. Saldar      documento a cero → el pedido pasa a pagado (y su cobro a
--                  crédito queda capturado, 20261117120000).
--      …o al revés «Marcar pagado» en Pedidos salda el documento con un recibo
--                  automático, para que Cobranza no siga reclamando lo cobrado.
--   5. Cancelar    el documento se ANULA (no se borra): saldo a cero, fecha y
--                  motivo. La línea queda libre.
--
-- La mora sigue siendo decisión de una persona: `credit_status` (ok · watch ·
-- blocked) lo cambia quien cobra. Lo que esta migración añade es la verdad
-- sobre la que decide.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0 · Un documento se anula, no se borra
-- ---------------------------------------------------------------------------
alter table public.ar_documents
  add column if not exists voided_at   timestamptz,
  add column if not exists void_reason text;

alter table public.ar_documents
  drop constraint if exists ar_documents_void_reason_len;
alter table public.ar_documents
  add constraint ar_documents_void_reason_len
  check (void_reason is null or char_length(void_reason) <= 300);

create unique index if not exists ar_documents_one_per_order
  on public.ar_documents (order_id)
  where order_id is not null and voided_at is null;

-- ---------------------------------------------------------------------------
-- 1 · La línea de una cuenta: límite, usado, disponible y vencido
-- ---------------------------------------------------------------------------
create or replace function ebim.credit_line(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'account_id',   a.id,
    'status',       a.credit_status,
    'limit',        a.credit_limit,
    'terms_days',   a.payment_terms_days,
    'used',         coalesce(d.usado, 0),
    'overdue',      coalesce(d.vencido, 0),
    'available',    case when a.credit_limit is null then null
                         else greatest(a.credit_limit - coalesce(d.usado, 0), 0) end)
  from public.business_accounts a
  left join lateral (
    select sum(x.balance) as usado,
           sum(x.balance) filter (where x.due_at < current_date) as vencido
      from public.ar_documents x
     where x.voided_at is null
       and x.balance > 0
       and (x.business_account_id = a.id
            or (x.business_account_id is null and x.customer_id = a.customer_id))
  ) d on true
  where a.id = p_account_id;
$fn$;

revoke execute on function ebim.credit_line(uuid) from public, anon, authenticated;

-- Para el backoffice: la línea de las cuentas que el usuario puede ver.
create or replace function public.credit_lines()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return coalesce((
    select jsonb_agg(ebim.credit_line(a.id) || jsonb_build_object(
             'account_name', a.name, 'account_code', a.code, 'customer_id', a.customer_id)
           order by a.name)
      from public.business_accounts a
     where ebim.can_access(a.organization_id, a.company_id)
       and ebim.has_role(a.organization_id, a.company_id,
                         array['owner','admin','orders']::public.app_role[])
       and a.credit_limit is not null
  ), '[]'::jsonb);
end;
$fn$;

revoke execute on function public.credit_lines() from public, anon;
grant execute on function public.credit_lines() to authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Comprar: ¿alcanza la línea? (lo pregunta el checkout, con service_role)
-- ---------------------------------------------------------------------------
create or replace function public.checkout_credit_check(
  p_store_slug  text,
  p_method_code text,
  p_account_id  uuid,
  p_amount      numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype;
  v_kind    text;
  v_account public.business_accounts%rowtype;
  v_line    jsonb;
begin
  select * into v_store from public.stores s where s.slug = p_store_slug;
  if not found then
    raise exception 'TIENDA_NO_ENCONTRADA: no hay ninguna tienda con ese identificador'
      using errcode = '22023';
  end if;

  select m.kind::text into v_kind
    from public.payment_methods m
   where m.store_id = v_store.id and m.code = p_method_code;

  -- Solo el crédito tiene línea que mirar.
  if v_kind is distinct from 'credit' then
    return jsonb_build_object('credit', false);
  end if;

  if p_account_id is null then
    raise exception 'CREDITO_SIN_CUENTA: comprar a credito exige una cuenta empresa'
      using errcode = '22023';
  end if;

  select * into v_account from public.business_accounts a
   where a.id = p_account_id
     and a.organization_id = v_store.organization_id
     and a.company_id = v_store.company_id;
  if not found then
    raise exception 'CREDITO_SIN_CUENTA: la cuenta no es de esta tienda'
      using errcode = '22023';
  end if;

  if v_account.credit_status = 'blocked' then
    raise exception 'CREDITO_BLOQUEADO: la cuenta tiene el credito bloqueado'
      using errcode = '22023';
  end if;
  if coalesce(v_account.credit_limit, 0) <= 0 then
    raise exception 'CREDITO_SIN_LINEA: la cuenta no tiene linea de credito'
      using errcode = '22023';
  end if;

  v_line := ebim.credit_line(v_account.id);
  if round(p_amount, 2) > (v_line->>'available')::numeric then
    raise exception 'CREDITO_EXCEDIDO: disponible %, pedido %',
      v_line->>'available', round(p_amount, 2)::text
      using errcode = '22023';
  end if;

  return jsonb_build_object('credit', true, 'available', v_line->'available');
end;
$fn$;

revoke execute on function public.checkout_credit_check(text, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.checkout_credit_check(text, text, uuid, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 3 · Deber: el documento del pedido a crédito
-- ---------------------------------------------------------------------------
create or replace function ebim.ar_document_for_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order   public.orders%rowtype;
  v_account public.business_accounts%rowtype;
  v_id      uuid;
  v_issued  date;
  v_line    jsonb;
begin
  select d.id into v_id from public.ar_documents d
   where d.order_id = p_order_id and d.voided_at is null;
  if v_id is not null then
    return v_id;
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;
  if not found or v_order.status = 'cancelled' or v_order.business_account_id is null then
    return null;
  end if;
  select * into v_account from public.business_accounts a where a.id = v_order.business_account_id;
  if not found then
    return null;
  end if;

  v_issued := coalesce(v_order.placed_at, v_order.created_at)::date;

  insert into public.ar_documents (
    organization_id, company_id, customer_id, business_account_id, order_id,
    kind, document_number, currency, issued_at, due_at, amount, balance
  ) values (
    v_order.organization_id, v_order.company_id, v_account.customer_id, v_account.id, v_order.id,
    'invoice', v_order.order_number, v_order.currency, v_issued,
    v_issued + coalesce(v_account.payment_terms_days, 0),
    v_order.grand_total, v_order.grand_total
  )
  returning id into v_id;

  -- La deuda se escribe SIEMPRE: perderla es peor que pasarse. Si con ella la
  -- cuenta queda por encima de su línea (dos compras a la vez, una línea que
  -- se bajó), lo ve quien cobra en el monitor.
  v_line := ebim.credit_line(v_account.id);
  if v_account.credit_limit is not null
     and (v_line->>'used')::numeric > v_account.credit_limit then
    perform ebim.record_ops_event(
      p_organization_id => v_order.organization_id,
      p_company_id      => v_order.company_id,
      p_kind            => 'payment_failed'::public.ops_event_kind,
      p_code            => 'CREDITO_EXCEDIDO',
      p_dedupe_key      => 'credit.over:' || v_order.id::text,
      p_severity        => 'warning'::public.ops_severity,
      p_message         => 'La cuenta ' || v_account.name || ' quedo por encima de su linea con el pedido '
                           || v_order.order_number,
      p_entity_type     => 'order',
      p_entity_id       => v_order.id,
      p_store_id        => v_order.store_id);
  end if;

  return v_id;
end;
$fn$;

revoke execute on function ebim.ar_document_for_order(uuid) from public, anon, authenticated;

create or replace function ebim.ar_document_on_credit_attach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (
    select 1 from public.payment_methods m
     where m.id = new.payment_method_id and m.kind = 'credit'
  ) then
    perform ebim.ar_document_for_order(new.order_id);
  end if;
  return new;
end;
$fn$;

revoke execute on function ebim.ar_document_on_credit_attach() from public, anon, authenticated;

drop trigger if exists payment_intents_credit_ar_document on public.payment_intents;
create trigger payment_intents_credit_ar_document
  after insert or update of order_id on public.payment_intents
  for each row
  when (new.order_id is not null)
  execute function ebim.ar_document_on_credit_attach();

-- ---------------------------------------------------------------------------
-- 4 · Saldar: documento a cero → pedido pagado
-- ---------------------------------------------------------------------------
create or replace function ebim.ar_document_settles_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform ebim.payment_sync_order(new.order_id, 'paid'::public.payment_status,
                                  'cobranza: documento ' || new.document_number || ' saldado');
  return new;
end;
$fn$;

revoke execute on function ebim.ar_document_settles_order() from public, anon, authenticated;

drop trigger if exists ar_documents_settle_order on public.ar_documents;
create trigger ar_documents_settle_order
  after update of balance on public.ar_documents
  for each row
  when (new.balance = 0 and old.balance > 0 and new.order_id is not null and new.voided_at is null)
  execute function ebim.ar_document_settles_order();

-- …y al revés: «Marcar pagado» salda el documento con un recibo automático.
create or replace function ebim.ar_settle_documents_of_paid_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_doc     public.ar_documents%rowtype;
  v_receipt uuid;
  v_number  text;
begin
  for v_doc in
    select * from public.ar_documents d
     where d.order_id = new.id and d.voided_at is null and d.balance > 0
     for update
  loop
    v_number := 'PED-' || new.order_number;
    if exists (select 1 from public.ar_receipts r
                where r.organization_id = v_doc.organization_id
                  and r.company_id = v_doc.company_id
                  and r.receipt_number = v_number) then
      v_number := v_number || '-' || to_char(now(), 'YYYYMMDDHH24MISS');
    end if;

    insert into public.ar_receipts (
      organization_id, company_id, customer_id, receipt_number, currency,
      received_at, amount, method, notes
    ) values (
      v_doc.organization_id, v_doc.company_id, v_doc.customer_id, v_number, v_doc.currency,
      current_date, v_doc.balance, 'pedido',
      'Automatico: el pedido se marco pagado en Pedidos'
    ) returning id into v_receipt;

    insert into public.ar_applications (organization_id, company_id, receipt_id, document_id, amount)
    values (v_doc.organization_id, v_doc.company_id, v_receipt, v_doc.id, v_doc.balance);
  end loop;
  return new;
end;
$fn$;

revoke execute on function ebim.ar_settle_documents_of_paid_order() from public, anon, authenticated;

drop trigger if exists orders_paid_settles_ar on public.orders;
create trigger orders_paid_settles_ar
  after update of payment_status on public.orders
  for each row
  when (new.payment_status = 'paid' and old.payment_status is distinct from 'paid')
  execute function ebim.ar_settle_documents_of_paid_order();

-- ---------------------------------------------------------------------------
-- 5 · Cancelar: el documento se anula y la línea queda libre
-- ---------------------------------------------------------------------------
create or replace function ebim.ar_void_documents_of_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.ar_documents d
     set voided_at   = now(),
         void_reason = 'Pedido cancelado',
         balance     = 0,
         updated_at  = now()
   where d.order_id = new.id
     and d.voided_at is null;
  return new;
end;
$fn$;

revoke execute on function ebim.ar_void_documents_of_cancelled_order() from public, anon, authenticated;

drop trigger if exists orders_cancel_voids_ar on public.orders;
create trigger orders_cancel_voids_ar
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function ebim.ar_void_documents_of_cancelled_order();

-- Un documento anulado ya no recibe cobros.
create or replace function ebim.ar_reject_application_to_voided()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if exists (select 1 from public.ar_documents d where d.id = new.document_id and d.voided_at is not null) then
    raise exception 'DOCUMENTO_ANULADO: ese documento esta anulado y no admite cobros'
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;

drop trigger if exists ar_applications_not_voided on public.ar_applications;
create trigger ar_applications_not_voided
  before insert on public.ar_applications
  for each row execute function ebim.ar_reject_application_to_voided();

-- ---------------------------------------------------------------------------
-- 6 · Cobrar: recibo y aplicaciones en una transacción
-- ---------------------------------------------------------------------------
create or replace function public.ar_register_receipt(
  p_customer_id    uuid,
  p_receipt_number text,
  p_received_at    date,
  p_amount         numeric,
  p_method         text,
  p_reference      text,
  p_applications   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_customer public.customers%rowtype;
  v_receipt  public.ar_receipts%rowtype;
  v_amount   numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_number   text := nullif(btrim(coalesce(p_receipt_number, '')), '');
  v_app      jsonb;
  v_doc      public.ar_documents%rowtype;
  v_applied  numeric(14,2) := 0;
  v_each     numeric(14,2);
  v_currency text;
begin
  select * into v_customer from public.customers c where c.id = p_customer_id;
  if not found or not ebim.can_access(v_customer.organization_id, v_customer.company_id) then
    raise exception 'CLIENTE_NO_ENCONTRADO: no hay ningun cliente con ese identificador'
      using errcode = '22023';
  end if;
  if ebim.is_suite_super_admin() or not ebim.has_role(
       v_customer.organization_id, v_customer.company_id,
       array['owner','admin','orders']::public.app_role[]) then
    raise exception 'SIN_PERMISO: hace falta rol de pedidos sobre este tenant'
      using errcode = '42501';
  end if;
  if not ebim.has_capability(v_customer.organization_id, v_customer.company_id, 'credit.management') then
    raise exception 'MODULO_NO_CONTRATADO: credito y cobranza no esta activo'
      using errcode = '42501';
  end if;

  if v_amount <= 0 then
    raise exception 'IMPORTE_NO_VALIDO: el cobro tiene que ser mayor que cero'
      using errcode = '22023';
  end if;
  if p_received_at is not null and p_received_at > current_date then
    raise exception 'FECHA_FUTURA: un cobro no puede tener fecha futura'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_applications, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_applications, '[]'::jsonb)) = 0 then
    raise exception 'SIN_DOCUMENTOS: marca al menos un documento que este cobro cancela'
      using errcode = '22023';
  end if;

  -- La moneda del cobro es la de lo que cancela; mezclar monedas no se aplica.
  select min(d.currency), count(distinct d.currency)::int
    into v_currency, v_each
    from public.ar_documents d
   where d.id in (select (x->>'document_id')::uuid from jsonb_array_elements(p_applications) x);
  if v_each = 0 then
    raise exception 'DOCUMENTO_DE_OTRO_CLIENTE: los documentos marcados no existen'
      using errcode = '22023';
  end if;
  if v_each <> 1 then
    raise exception 'MONEDAS_DISTINTAS: los documentos marcados tienen monedas distintas'
      using errcode = '22023';
  end if;

  -- Sin número tecleado: correlativo del día, «RC-20261117-003».
  if v_number is null then
    select 'RC-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad((count(*) + 1)::text, 3, '0')
      into v_number
      from public.ar_receipts r
     where r.organization_id = v_customer.organization_id
       and r.company_id = v_customer.company_id
       and r.receipt_number like 'RC-' || to_char(current_date, 'YYYYMMDD') || '-%';
  end if;

  insert into public.ar_receipts (
    organization_id, company_id, customer_id, receipt_number, currency,
    received_at, amount, method, reference
  ) values (
    v_customer.organization_id, v_customer.company_id, v_customer.id, left(v_number, 60), v_currency,
    coalesce(p_received_at, current_date), v_amount,
    nullif(btrim(coalesce(p_method, '')), ''), nullif(btrim(coalesce(p_reference, '')), '')
  )
  returning * into v_receipt;

  for v_app in select * from jsonb_array_elements(p_applications)
  loop
    select * into v_doc from public.ar_documents d
     where d.id = (v_app->>'document_id')::uuid
     for update;
    if not found or v_doc.customer_id <> v_customer.id then
      raise exception 'DOCUMENTO_DE_OTRO_CLIENTE: un documento marcado no es de este cliente'
        using errcode = '22023';
    end if;
    if v_doc.voided_at is not null then
      raise exception 'DOCUMENTO_ANULADO: el documento % esta anulado', v_doc.document_number
        using errcode = '22023';
    end if;

    v_each := round(coalesce((v_app->>'amount')::numeric, 0), 2);
    if v_each <= 0 then
      continue;
    end if;
    if v_each > v_doc.balance then
      raise exception 'COBRO_EXCEDE_DEUDA: el documento % debe %', v_doc.document_number, v_doc.balance
        using errcode = '22023';
    end if;
    v_applied := v_applied + v_each;
    if v_applied > v_amount then
      raise exception 'APLICADO_EXCEDE_COBRO: se aplica mas de lo que se cobro'
        using errcode = '22023';
    end if;

    insert into public.ar_applications (organization_id, company_id, receipt_id, document_id, amount)
    values (v_customer.organization_id, v_customer.company_id, v_receipt.id, v_doc.id, v_each);
  end loop;

  return jsonb_build_object(
    'receipt_id',     v_receipt.id,
    'receipt_number', v_receipt.receipt_number,
    'amount',         v_amount::text,
    'applied',        v_applied::text,
    'unapplied',      (v_amount - v_applied)::text);
end;
$fn$;

revoke execute on function public.ar_register_receipt(uuid, text, date, numeric, text, text, jsonb) from public, anon;
grant execute on function public.ar_register_receipt(uuid, text, date, numeric, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7 · Regularización: los pedidos a crédito vivos que no tenían documento
-- ---------------------------------------------------------------------------
do $regularizacion$
declare
  v_order uuid;
begin
  for v_order in
    select distinct i.order_id
      from public.payment_intents i
      join public.payment_methods m on m.id = i.payment_method_id and m.kind = 'credit'
      join public.orders o on o.id = i.order_id
     where o.status <> 'cancelled'
       and o.payment_status not in ('paid', 'refunded', 'voided')
       and o.business_account_id is not null
       and not exists (select 1 from public.ar_documents d where d.order_id = o.id and d.voided_at is null)
  loop
    perform ebim.ar_document_for_order(v_order);
  end loop;
end
$regularizacion$;

-- ---------------------------------------------------------------------------
-- 8 · Comprobantes: nacen de un pedido, con sus líneas
--
-- Nada creaba comprobantes: los que había en QAS eran de ejemplo y uno no
-- tenía líneas («Un comprobante sin líneas no se emite»). Este comando lo arma
-- desde el pedido —una línea por producto, más el envío—, y los totales salen
-- de las líneas, así que no puede nacer descuadrado.
-- ---------------------------------------------------------------------------
create or replace function public.invoice_create_for_order(p_order_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order   public.orders%rowtype;
  v_invoice uuid;
  v_billing jsonb;
  v_factura boolean;
  v_pos     smallint := 0;
  v_item    record;
  v_net     numeric(14,2);
  v_tax     numeric(14,2);
begin
  select * into v_order from public.orders o
   where o.order_number = btrim(coalesce(p_order_number, ''))
     and ebim.can_access(o.organization_id, o.company_id)
   order by o.created_at desc
   limit 1;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese numero'
      using errcode = '22023';
  end if;
  if ebim.is_suite_super_admin() or not ebim.has_role(
       v_order.organization_id, v_order.company_id, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: hace falta rol de administracion' using errcode = '42501';
  end if;
  if not ebim.has_capability(v_order.organization_id, v_order.company_id, 'invoicing') then
    raise exception 'MODULO_NO_CONTRATADO: comprobantes no esta activo' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'PEDIDO_CANCELADO: un pedido cancelado no se factura' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices i
              where i.order_id = v_order.id and i.status not in ('rejected', 'cancelled')) then
    raise exception 'COMPROBANTE_YA_EXISTE: el pedido ya tiene un comprobante vigente'
      using errcode = '22023';
  end if;

  v_billing := coalesce(v_order.billing_address, '{}'::jsonb);
  v_factura := v_billing->>'document_type' = 'invoice';

  insert into public.invoices (
    organization_id, company_id, store_id, order_id, series, status, currency,
    customer_name, customer_tax_id, net_total, tax_total, gross_total
  ) values (
    v_order.organization_id, v_order.company_id, v_order.store_id, v_order.id,
    case when v_factura then 'F001' else 'B001' end, 'pending', v_order.currency,
    coalesce(nullif(btrim(v_billing->>'legal_name'), ''), nullif(btrim(v_order.customer_name), ''),
             v_order.customer_email),
    nullif(btrim(coalesce(v_billing->>'tax_id', '')), ''),
    0, 0, 0
  ) returning id into v_invoice;

  for v_item in
    select oi.name, oi.variant_label, oi.quantity, coalesce(oi.tax_rate, 0) as rate,
           coalesce(oi.tax_amount, 0) as tax, coalesce(oi.tax_inclusive, false) as inclusive,
           coalesce(oi.amount_after_discount, oi.line_total) as amount
      from public.order_items oi
     where oi.order_id = v_order.id
     order by oi.created_at, oi.id
  loop
    v_tax := round(v_item.tax, 2);
    v_net := round(case when v_item.inclusive then v_item.amount - v_item.tax else v_item.amount end, 2);
    insert into public.invoice_items (
      organization_id, company_id, invoice_id, description, quantity, unit_price,
      net_amount, tax_rate, tax_amount, position
    ) values (
      v_order.organization_id, v_order.company_id, v_invoice,
      left(v_item.name || coalesce(' · ' || v_item.variant_label, ''), 300),
      v_item.quantity, round(v_net / v_item.quantity, 2), v_net,
      least(greatest(v_item.rate, 0), 1), v_tax, v_pos
    );
    v_pos := v_pos + 1;
  end loop;

  if coalesce(v_order.shipping_total, 0) > 0 then
    insert into public.invoice_items (
      organization_id, company_id, invoice_id, description, quantity, unit_price,
      net_amount, tax_rate, tax_amount, position
    ) values (
      v_order.organization_id, v_order.company_id, v_invoice, 'Envío', 1,
      v_order.shipping_total, v_order.shipping_total, 0, 0, v_pos
    );
  end if;

  update public.invoices i set
    net_total   = t.net,
    tax_total   = t.tax,
    gross_total = t.net + t.tax
  from (select coalesce(sum(net_amount), 0) as net, coalesce(sum(tax_amount), 0) as tax
          from public.invoice_items where invoice_id = v_invoice) t
  where i.id = v_invoice;

  return jsonb_build_object('invoice_id', v_invoice, 'lines', v_pos + case when coalesce(v_order.shipping_total, 0) > 0 then 1 else 0 end);
end;
$fn$;

revoke execute on function public.invoice_create_for_order(text) from public, anon;
grant execute on function public.invoice_create_for_order(text) to authenticated;
