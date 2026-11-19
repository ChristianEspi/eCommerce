-- =============================================================================
-- Crédito: lo que quedaba suelto después del ciclo (20261118100000).
--
--  1. Una sola verdad del disponible. «Tu cuenta» del comprador restaba TODOS
--     los pedidos sin pagar (también Yape y transferencia pendientes); el
--     checkout resta solo las deudas a crédito. Policlínico Andino veía
--     S/ 13,463.73 disponibles y la tienda le dejaba comprar S/ 21,939.36.
--     Ahora los dos leen `ebim.credit_line`.
--  2. Mora automática: a los N días de vencida una deuda la cuenta pasa sola a
--     «En vigilancia», y a los M días a «Bloqueado». Al cobrar, vuelve sola.
--     Si quien cobra cambia el estado a mano, se respeta 7 días.
--  3. Cancelar un pedido con algo ya cobrado: la deuda se anula y queda dicho
--     cuánto hay que devolver, con aviso en el monitor.
--  4. Cancelar un pedido con comprobante: el pendiente se anula; el emitido
--     avisa de que falta la nota de crédito.
--  5. El comprobante se genera solo cuando el pedido se paga o nace su deuda a
--     crédito (si la sociedad tiene comprobantes). Nunca tumba el cobro.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 2 · Mora: umbrales por cuenta y quién puso el estado
-- ---------------------------------------------------------------------------
alter table public.business_accounts
  add column if not exists credit_watch_after_days integer default 15,
  add column if not exists credit_block_after_days integer default 30,
  add column if not exists credit_status_auto boolean not null default false,
  add column if not exists credit_status_manual_until date;

alter table public.business_accounts drop constraint if exists business_accounts_mora_range;
alter table public.business_accounts add constraint business_accounts_mora_range check (
  (credit_watch_after_days is null or credit_watch_after_days between 1 and 365)
  and (credit_block_after_days is null or credit_block_after_days between 1 and 365)
  and (credit_watch_after_days is null or credit_block_after_days is null
       or credit_block_after_days >= credit_watch_after_days));

comment on column public.business_accounts.credit_watch_after_days is
  'Dias de atraso de la deuda mas vieja para pasar sola a watch. NULL = nunca.';
comment on column public.business_accounts.credit_block_after_days is
  'Dias de atraso de la deuda mas vieja para pasar sola a blocked. NULL = nunca.';

-- Un cambio de estado hecho por una PERSONA se respeta 7 días.
create or replace function ebim.credit_status_manual_mark()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.credit_status is distinct from old.credit_status
     and coalesce(current_setting('ebim.credit_auto', true), '') <> 'on' then
    new.credit_status_auto := false;
    new.credit_status_manual_until := current_date + 7;
  end if;
  return new;
end;
$fn$;

drop trigger if exists business_accounts_credit_manual on public.business_accounts;
create trigger business_accounts_credit_manual
  before update of credit_status on public.business_accounts
  for each row execute function ebim.credit_status_manual_mark();

create or replace function ebim.credit_refresh_status(p_account_id uuid)
returns public.credit_status
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_acc    public.business_accounts%rowtype;
  v_days   integer;
  v_target public.credit_status;
begin
  select * into v_acc from public.business_accounts a where a.id = p_account_id for update;
  if not found or v_acc.credit_limit is null then
    return null;
  end if;
  -- Lo decidió una persona hace poco: se respeta.
  if v_acc.credit_status_manual_until is not null and v_acc.credit_status_manual_until >= current_date then
    return v_acc.credit_status;
  end if;

  select coalesce(max(current_date - d.due_at), 0) into v_days
    from public.ar_documents d
   where d.voided_at is null and d.balance > 0 and d.due_at < current_date
     and (d.business_account_id = v_acc.id
          or (d.business_account_id is null and d.customer_id = v_acc.customer_id));

  v_target := case
    when v_acc.credit_block_after_days is not null and v_days >= v_acc.credit_block_after_days then 'blocked'
    when v_acc.credit_watch_after_days is not null and v_days >= v_acc.credit_watch_after_days then 'watch'
    else 'ok'
  end::public.credit_status;

  -- Sube siempre; baja solo si lo subió el sistema (un bloqueo puesto a mano
  -- lo levanta una persona).
  if v_target = v_acc.credit_status then
    return v_target;
  end if;
  if v_target < v_acc.credit_status and not v_acc.credit_status_auto then
    return v_acc.credit_status;
  end if;

  perform set_config('ebim.credit_auto', 'on', true);
  update public.business_accounts
     set credit_status = v_target,
         credit_status_auto = (v_target <> 'ok'),
         credit_status_manual_until = null
   where id = v_acc.id;
  perform set_config('ebim.credit_auto', '', true);

  if v_target = 'blocked' then
    perform ebim.record_ops_event(
      p_organization_id => v_acc.organization_id,
      p_company_id      => v_acc.company_id,
      p_kind            => 'payment_failed'::public.ops_event_kind,
      p_code            => 'CREDITO_BLOQUEADO_POR_MORA',
      p_dedupe_key      => 'credit.blocked:' || v_acc.id::text || ':' || current_date::text,
      p_severity        => 'warning'::public.ops_severity,
      p_message         => 'La cuenta ' || v_acc.name || ' se bloqueo sola: ' || v_days || ' dias de atraso',
      p_entity_type     => 'business_account',
      p_entity_id       => v_acc.id);
  end if;
  return v_target;
end;
$fn$;

revoke execute on function ebim.credit_refresh_status(uuid) from public, anon, authenticated;

create or replace function ebim.credit_refresh_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  for v_id in select a.id from public.business_accounts a where a.credit_limit is not null loop
    perform ebim.credit_refresh_status(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

revoke execute on function ebim.credit_refresh_all() from public, anon, authenticated;

-- Cada movimiento de una deuda recalcula su cuenta en el acto.
create or replace function ebim.ar_document_refreshes_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_account uuid;
begin
  v_account := coalesce(new.business_account_id,
                        (select a.id from public.business_accounts a where a.customer_id = new.customer_id));
  if v_account is not null then
    perform ebim.credit_refresh_status(v_account);
  end if;
  return new;
end;
$fn$;

drop trigger if exists ar_documents_refresh_account on public.ar_documents;
create trigger ar_documents_refresh_account
  after insert or update of balance, voided_at, due_at on public.ar_documents
  for each row execute function ebim.ar_document_refreshes_account();

-- Y una vez al día, porque una deuda envejece sin que nadie la toque.
do $programacion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  if exists (select 1 from cron.job where jobname = 'ecommerce-credit-refresh') then
    perform cron.unschedule('ecommerce-credit-refresh');
  end if;
  perform cron.schedule('ecommerce-credit-refresh', '10 11 * * *',
                        $trabajo$ select ebim.credit_refresh_all(); $trabajo$);
end
$programacion$;

-- La línea dice también si el estado lo puso el sistema y sus umbrales.
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
    'auto',         a.credit_status_auto,
    'watch_after',  a.credit_watch_after_days,
    'block_after',  a.credit_block_after_days,
    'limit',        a.credit_limit,
    'terms_days',   a.payment_terms_days,
    'used',         coalesce(d.usado, 0),
    'overdue',      coalesce(d.vencido, 0),
    'max_days',     coalesce(d.dias, 0),
    'available',    case when a.credit_limit is null then null
                         else greatest(a.credit_limit - coalesce(d.usado, 0), 0) end)
  from public.business_accounts a
  left join lateral (
    select sum(x.balance) as usado,
           sum(x.balance) filter (where x.due_at < current_date) as vencido,
           max(current_date - x.due_at) filter (where x.due_at < current_date) as dias
      from public.ar_documents x
     where x.voided_at is null
       and x.balance > 0
       and (x.business_account_id = a.id
            or (x.business_account_id is null and x.customer_id = a.customer_id))
  ) d on true
  where a.id = p_account_id;
$fn$;

-- ---------------------------------------------------------------------------
-- 1 · «Tu cuenta» del comprador: el mismo disponible que el checkout
-- ---------------------------------------------------------------------------
create or replace function public.my_account_statement()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_rows jsonb;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.account_name), '[]'::jsonb)
    into v_rows
  from (
    select a.id                 as account_id,
           a.name               as account_name,
           a.code               as account_code,
           a.credit_limit::text as credit_limit,
           a.payment_terms_days as payment_terms_days,
           a.credit_status::text as credit_status,
           coalesce((linea->>'used')::numeric, 0)::text    as balance_due,
           case when a.credit_limit is null then null
                else (linea->>'available')::numeric::text end as credit_available,
           coalesce((linea->>'overdue')::numeric, 0)::text as overdue_amount,
           coalesce(deuda.documentos, '[]'::jsonb)          as documents,
           coalesce(anual.comprado, 0)::text  as purchased_12m,
           coalesce(anual.pagado, 0)::text    as paid_12m,
           coalesce(deuda.moneda, anual.moneda) as currency
    from public.business_accounts a
    join public.business_account_users u
      on u.business_account_id = a.id
     and u.user_id = ebim.user_id()
     and u.status  = 'active'
    cross join lateral (select ebim.credit_line(a.id) as linea) l
    -- Lo que se debe A CRÉDITO: las deudas abiertas, no los pagos pendientes.
    left join lateral (
      select min(d.currency) as moneda,
             jsonb_agg(jsonb_build_object(
               'order_id',       coalesce(d.order_id, d.id),
               'order_number',   d.document_number,
               'placed_at',      d.issued_at,
               'due_at',         d.due_at,
               'days_overdue',   greatest(current_date - d.due_at, 0),
               'total',          d.balance::text,
               'currency',       d.currency,
               'status',         coalesce(o.status::text, 'pending'),
               'payment_status', coalesce(o.payment_status::text, 'pending')
             ) order by d.due_at) as documentos
        from public.ar_documents d
        left join public.orders o on o.id = d.order_id
       where d.voided_at is null and d.balance > 0
         and (d.business_account_id = a.id
              or (d.business_account_id is null and d.customer_id = a.customer_id))
    ) deuda on true
    left join lateral (
      select sum(o.grand_total)                                        as comprado,
             sum(o.grand_total) filter (where o.payment_status = 'paid') as pagado,
             min(o.currency)                                           as moneda
        from public.orders o
       where o.business_account_id = a.id
         and o.status <> 'cancelled'
         and o.placed_at > now() - interval '12 months'
    ) anual on true
    where a.is_active
  ) t;

  return v_rows;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3 y 4 · Cancelar: lo cobrado se devuelve y el comprobante se anula
-- ---------------------------------------------------------------------------
create or replace function ebim.ar_void_documents_of_cancelled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_doc     public.ar_documents%rowtype;
  v_cobrado numeric(14,2);
  v_inv     public.invoices%rowtype;
begin
  for v_doc in
    select * from public.ar_documents d where d.order_id = new.id and d.voided_at is null for update
  loop
    v_cobrado := v_doc.amount - v_doc.balance;
    update public.ar_documents d
       set voided_at   = now(),
           void_reason = case when v_cobrado > 0
                              then 'Pedido cancelado · devolver ' || v_cobrado::text || ' ' || v_doc.currency || ' cobrados'
                              else 'Pedido cancelado' end,
           balance     = 0,
           updated_at  = now()
     where d.id = v_doc.id;

    if v_cobrado > 0 then
      perform ebim.record_ops_event(
        p_organization_id => v_doc.organization_id,
        p_company_id      => v_doc.company_id,
        p_kind            => 'payment_failed'::public.ops_event_kind,
        p_code            => 'COBRO_A_DEVOLVER',
        p_dedupe_key      => 'ar.refund:' || v_doc.id::text,
        p_severity        => 'warning'::public.ops_severity,
        p_message         => 'Se cancelo el pedido ' || new.order_number || ' con ' || v_cobrado::text || ' '
                             || v_doc.currency || ' ya cobrados: hay que devolverlos',
        p_entity_type     => 'order',
        p_entity_id       => new.id,
        p_store_id        => new.store_id);
    end if;
  end loop;

  for v_inv in select * from public.invoices i where i.order_id = new.id loop
    if v_inv.status = 'pending' then
      update public.invoices set status = 'cancelled', updated_at = now() where id = v_inv.id;
      insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
      values (v_inv.organization_id, v_inv.company_id, v_inv.id, 'cancelled', 'Pedido cancelado');
    elsif v_inv.status in ('issued', 'accepted') then
      perform ebim.record_ops_event(
        p_organization_id => v_inv.organization_id,
        p_company_id      => v_inv.company_id,
        p_kind            => 'integration_failed'::public.ops_event_kind,
        p_code            => 'NOTA_DE_CREDITO_PENDIENTE',
        p_dedupe_key      => 'invoice.credit_note:' || v_inv.id::text,
        p_severity        => 'warning'::public.ops_severity,
        p_message         => 'Se cancelo el pedido ' || new.order_number || ' y su comprobante '
                             || v_inv.series || coalesce('-' || v_inv.number, '')
                             || ' ya estaba emitido: falta emitir la nota de credito',
        p_entity_type     => 'invoice',
        p_entity_id       => v_inv.id,
        p_store_id        => new.store_id);
    end if;
  end loop;
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5 · El comprobante se genera solo
-- ---------------------------------------------------------------------------
create or replace function ebim.invoice_for_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order   public.orders%rowtype;
  v_invoice uuid;
  v_billing jsonb;
  v_pos     smallint := 0;
  v_item    record;
  v_net     numeric(14,2);
  v_tax     numeric(14,2);
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese numero' using errcode = '22023';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'PEDIDO_CANCELADO: un pedido cancelado no se factura' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices i
              where i.order_id = v_order.id and i.status not in ('rejected', 'cancelled')) then
    raise exception 'COMPROBANTE_YA_EXISTE: el pedido ya tiene un comprobante vigente' using errcode = '22023';
  end if;

  v_billing := coalesce(v_order.billing_address, '{}'::jsonb);

  insert into public.invoices (
    organization_id, company_id, store_id, order_id, series, status, currency,
    customer_name, customer_tax_id, net_total, tax_total, gross_total
  ) values (
    v_order.organization_id, v_order.company_id, v_order.store_id, v_order.id,
    case when v_billing->>'document_type' = 'invoice' then 'F001' else 'B001' end, 'pending', v_order.currency,
    coalesce(nullif(btrim(v_billing->>'legal_name'), ''), nullif(btrim(v_order.customer_name), ''),
             v_order.customer_email),
    nullif(btrim(coalesce(v_billing->>'tax_id', '')), ''),
    0, 0, 0
  ) returning id into v_invoice;

  for v_item in
    select oi.name, oi.variant_label, oi.quantity,
           coalesce(oi.tax_rate, 0) as rate, coalesce(oi.tax_amount, 0) as tax,
           coalesce(oi.tax_inclusive, false) as inclusive,
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
    net_total = t.net, tax_total = t.tax, gross_total = t.net + t.tax
  from (select coalesce(sum(net_amount), 0) as net, coalesce(sum(tax_amount), 0) as tax
          from public.invoice_items where invoice_id = v_invoice) t
  where i.id = v_invoice;

  return v_invoice;
end;
$fn$;

revoke execute on function ebim.invoice_for_order(uuid) from public, anon, authenticated;

-- El comando manual delega en la misma función.
create or replace function public.invoice_create_for_order(p_order_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order   public.orders%rowtype;
  v_invoice uuid;
begin
  select * into v_order from public.orders o
   where o.order_number = upper(btrim(coalesce(p_order_number, '')))
     and ebim.can_access(o.organization_id, o.company_id)
   order by o.created_at desc
   limit 1;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese numero' using errcode = '22023';
  end if;
  if ebim.is_suite_super_admin() or not ebim.has_role(
       v_order.organization_id, v_order.company_id, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: hace falta rol de administracion' using errcode = '42501';
  end if;
  if not ebim.has_capability(v_order.organization_id, v_order.company_id, 'invoicing') then
    raise exception 'MODULO_NO_CONTRATADO: comprobantes no esta activo' using errcode = '42501';
  end if;

  v_invoice := ebim.invoice_for_order(v_order.id);
  return jsonb_build_object('invoice_id', v_invoice,
    'lines', (select count(*) from public.invoice_items where invoice_id = v_invoice));
end;
$fn$;

-- Automático: nunca tumba el cobro ni el pedido. Si no puede, lo dice.
create or replace function ebim.invoice_auto_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found or v_order.status = 'cancelled'
     -- Sin sesión (lo dispara el sistema): se mira el contrato de la sociedad,
     -- no el permiso de quien está conectado.
     or not ebim.company_is_entitled(v_order.organization_id, v_order.company_id, 'invoicing')
     or exists (select 1 from public.invoices i
                 where i.order_id = v_order.id and i.status not in ('rejected', 'cancelled')) then
    return;
  end if;
  begin
    perform ebim.invoice_for_order(v_order.id);
  exception when others then
    perform ebim.record_ops_event(
      p_organization_id => v_order.organization_id,
      p_company_id      => v_order.company_id,
      p_kind            => 'integration_failed'::public.ops_event_kind,
      p_code            => 'COMPROBANTE_NO_GENERADO',
      p_dedupe_key      => 'invoice.auto:' || v_order.id::text,
      p_severity        => 'warning'::public.ops_severity,
      p_message         => 'No se pudo generar el comprobante del pedido ' || v_order.order_number || ': ' || left(sqlerrm, 300),
      p_entity_type     => 'order',
      p_entity_id       => v_order.id,
      p_store_id        => v_order.store_id);
  end;
end;
$fn$;

revoke execute on function ebim.invoice_auto_for_order(uuid) from public, anon, authenticated;

create or replace function ebim.invoice_on_paid_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform ebim.invoice_auto_for_order(new.id);
  return new;
end;
$fn$;

drop trigger if exists orders_paid_invoice on public.orders;
create trigger orders_paid_invoice
  after update of payment_status on public.orders
  for each row
  when (new.payment_status = 'paid' and old.payment_status is distinct from 'paid')
  execute function ebim.invoice_on_paid_order();

-- La venta a crédito se factura al nacer la deuda, no al cobrarla.
create or replace function ebim.invoice_on_credit_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.order_id is not null then
    perform ebim.invoice_auto_for_order(new.order_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists ar_documents_invoice on public.ar_documents;
create trigger ar_documents_invoice
  after insert on public.ar_documents
  for each row execute function ebim.invoice_on_credit_document();

-- ---------------------------------------------------------------------------
-- Regularización: el estado de mora de hoy
-- ---------------------------------------------------------------------------
select ebim.credit_refresh_all();

-- ---------------------------------------------------------------------------
-- 6 · Kits: aviso cuando un componente deja armar pocos
--
-- Un kit no tiene existencia propia: se arma con la de sus componentes (ATP =
-- el mínimo). Cuando el componente que limita deja armar 5 o menos, avisa,
-- y dice cuál es. Vista APARTE de `inventory_alerts` para no cambiar los
-- conteos que ya leen la IA y el centro de vigilancia.
-- ---------------------------------------------------------------------------
create or replace view public.bundle_stock_alerts
with (security_invoker = on) as
with comp as (
  select bi.organization_id, bi.company_id, bi.bundle_product_id,
         bi.component_product_id, bi.component_variant_id, bi.quantity,
         coalesce(pv.name, p.name) as component_name,
         floor(coalesce((
           select sum(greatest(l.available_qty, 0))
             from public.inventory_levels l
            where l.product_id = bi.component_product_id
              and l.variant_id is not distinct from bi.component_variant_id
         ), 0) / nullif(bi.quantity, 0)) as kits
    from public.bundle_items bi
    join public.products p on p.id = bi.component_product_id
    left join public.product_variants pv on pv.id = bi.component_variant_id
),
limite as (
  select distinct on (c.bundle_product_id)
         c.organization_id, c.company_id, c.bundle_product_id, c.kits, c.component_name
    from comp c
   order by c.bundle_product_id, c.kits asc, c.component_name
)
select b.organization_id, b.company_id, sp.store_id,
       null::uuid as warehouse_id, null::text as warehouse_code,
       b.id as product_id, null::uuid as variant_id,
       b.sku, b.name,
       'bundle_low'::text as kind,
       lim.kits::numeric as available_qty,
       5::numeric as reorder_point,
       null::timestamptz as synced_at,
       lim.component_name as limiting_component
  from public.products b
  join limite lim on lim.bundle_product_id = b.id
  join public.store_products sp on sp.product_id = b.id and sp.status = 'published'
 where b.kind = 'bundle'::public.product_kind
   and lim.kits <= 5;

revoke all on public.bundle_stock_alerts from public, anon;
grant select on public.bundle_stock_alerts to authenticated, service_role;
