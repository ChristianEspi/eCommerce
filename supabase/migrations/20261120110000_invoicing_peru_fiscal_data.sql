-- =============================================================================
-- Facturación electrónica Perú · fase 1 — datos fiscales (2026-11-20)
--
-- Prepara el comprobante para un emisor real (Nubefact, fase 2) sin elegir
-- todavía ninguno. Cuatro cosas que faltaban:
--
-- 1. CONFIGURACIÓN POR TIENDA (`invoice_settings`). La serie estaba fija en el
--    código (`F001`/`B001`); ahora es dato de la tienda y debe coincidir con la
--    registrada en su emisor. También: tasa de IGV del envío, cómo se califica
--    una línea con tasa 0 (exonerado o inafecto) y si se emite solo al cobrar.
--    Sin fila, rigen los valores por defecto de `ebim.invoice_settings_for`.
--
-- 2. EL IGV DEL ENVÍO. `invoice_for_order` facturaba el envío con IGV 0. Lo
--    cobrado no cambia —el comprador pagó `shipping_total` y ese es el importe
--    de la línea—, pero si la tienda está afecta, ese importe LLEVA IGV dentro:
--    27.00 = 22.88 + 4.12. Facturarlo como 0 declaraba menos impuesto del debido.
--    Los comprobantes `pending` aún no encolados se corrigen aquí mismo.
--
-- 3. EL CORRELATIVO (`invoice_sequences`). El emisor exige que le digamos el
--    número, consecutivo por serie. Se asigna al ENCOLAR la emisión, con el
--    emisor ya elegido: un comprobante que queda «sin facturador» no gasta
--    número. Atómico por `insert … on conflict do update … returning`.
--
-- 4. EL CLIENTE COMPLETO. El comprobante guardaba el número de documento pero
--    no su TIPO (RUC/DNI/CE/pasaporte) ni la dirección; el emisor los pide.
--    Salen de `orders.billing_address`, que es fiscal y está congelado.
--
-- Y una regla de SUNAT: una boleta de S/ 700 o más necesita el documento del
-- cliente. El checkout ya lo pide siempre; aquí se impide emitir sin él.
--
-- El mensaje `invoice.issue` pasa a la versión 2 (número, tipo de documento,
-- datos del cliente y afectación por línea). `src/domain/ports/invoicing.ts`
-- declara la misma forma y un test comprueba que coinciden.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Configuración fiscal por tienda
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_settings (
  id                    uuid          primary key default gen_random_uuid(),
  store_id              uuid          not null,
  organization_id       uuid          not null,
  company_id            uuid          not null,
  receipt_series        text          not null default 'B001',
  invoice_series        text          not null default 'F001',
  shipping_tax_rate     numeric(6,4)  not null default 0.18,
  zero_rate_affectation text          not null default 'exonerado',
  auto_issue            boolean       not null default false,
  updated_by            uuid,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint invoice_settings_store_unique unique (store_id),
  constraint invoice_settings_receipt_series check (receipt_series ~ '^B[A-Z0-9]{3}$'),
  constraint invoice_settings_invoice_series check (invoice_series ~ '^F[A-Z0-9]{3}$'),
  constraint invoice_settings_shipping_rate check (shipping_tax_rate >= 0 and shipping_tax_rate < 1),
  constraint invoice_settings_zero_rate check (zero_rate_affectation in ('exonerado', 'inafecto')),
  constraint invoice_settings_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index if not exists invoice_settings_tenant_idx on public.invoice_settings (organization_id, company_id);

drop trigger if exists invoice_settings_updated_at on public.invoice_settings;
create trigger invoice_settings_updated_at
  before update on public.invoice_settings
  for each row execute function ebim.set_updated_at();

alter table public.invoice_settings enable row level security;
alter table public.invoice_settings force  row level security;
revoke all on public.invoice_settings from public, anon, authenticated;
grant select on public.invoice_settings to authenticated;
grant all on public.invoice_settings to service_role;

drop policy if exists invoice_settings_select on public.invoice_settings;
create policy invoice_settings_select on public.invoice_settings
  for select to authenticated
  using (
    organization_id = (select ebim.org_id())
    and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[])
  );

-- La configuración vigente de una tienda, con los valores por defecto si no
-- guardó ninguna. Servidor: la usan la generación y la emisión.
create or replace function ebim.invoice_settings_for(p_store_id uuid)
returns public.invoice_settings
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v public.invoice_settings%rowtype;
begin
  select * into v from public.invoice_settings s where s.store_id = p_store_id;
  if not found then
    v.store_id              := p_store_id;
    v.receipt_series        := 'B001';
    v.invoice_series        := 'F001';
    v.shipping_tax_rate     := 0.18;
    v.zero_rate_affectation := 'exonerado';
    v.auto_issue            := false;
  end if;
  return v;
end;
$fn$;

revoke execute on function ebim.invoice_settings_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Correlativo por serie
-- ---------------------------------------------------------------------------
-- Por SOCIEDAD y serie, no por tienda: SUNAT registra la serie por RUC, y
-- `invoices_number_unique` ya es (organización, sociedad, serie, número). Dos
-- tiendas de la misma sociedad con la misma serie comparten correlativo.
create table if not exists public.invoice_sequences (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  series          text        not null,
  -- El último número ENTREGADO a un comprobante. 0 = ninguno todavía.
  last_number     integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint invoice_sequences_unique unique (organization_id, company_id, series),
  constraint invoice_sequences_series check (series ~ '^[BF][A-Z0-9]{3}$'),
  constraint invoice_sequences_range check (last_number between 0 and 99999999)
);

create index if not exists invoice_sequences_tenant_idx on public.invoice_sequences (organization_id, company_id);

drop trigger if exists invoice_sequences_updated_at on public.invoice_sequences;
create trigger invoice_sequences_updated_at
  before update on public.invoice_sequences
  for each row execute function ebim.set_updated_at();

alter table public.invoice_sequences enable row level security;
alter table public.invoice_sequences force  row level security;
revoke all on public.invoice_sequences from public, anon, authenticated;
grant select on public.invoice_sequences to authenticated;
grant all on public.invoice_sequences to service_role;

drop policy if exists invoice_sequences_select on public.invoice_sequences;
create policy invoice_sequences_select on public.invoice_sequences
  for select to authenticated
  using (
    organization_id = (select ebim.org_id())
    and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[])
  );

-- El número más alto ya usado en una serie de la sociedad (comprobantes que
-- vinieron de antes, o de otro sistema). Solo cuenta números puramente numéricos.
create or replace function ebim.invoice_max_number(p_org uuid, p_company uuid, p_series text)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(max(i.number::bigint), 0)::integer
    from public.invoices i
   where i.organization_id = p_org and i.company_id = p_company
     and i.series = p_series and i.number ~ '^\d{1,8}$'
$fn$;

revoke execute on function ebim.invoice_max_number(uuid, uuid, text) from public, anon, authenticated;

-- Siguiente número de la serie, atómico. Dos emisiones a la vez nunca reciben
-- el mismo: la segunda espera el bloqueo de la fila y ve el número de la primera.
-- La primera vez arranca DESPUÉS del más alto ya usado: nunca repite un número.
create or replace function ebim.invoice_next_number(p_org uuid, p_company uuid, p_series text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  insert into public.invoice_sequences (organization_id, company_id, series, last_number)
  values (p_org, p_company, p_series, ebim.invoice_max_number(p_org, p_company, p_series) + 1)
  on conflict (organization_id, company_id, series) do update
     set last_number = public.invoice_sequences.last_number + 1
  returning last_number into v_n;
  return v_n;
exception when check_violation then
  raise exception 'SERIE_AGOTADA: la serie % llegó a su último número', p_series using errcode = '22023';
end;
$fn$;

revoke execute on function ebim.invoice_next_number(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · El comprobante guarda el cliente completo y la afectación por línea
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists document_type     text,
  add column if not exists customer_doc_type text,
  add column if not exists customer_address  text;

do $$ begin
  alter table public.invoices add constraint invoices_document_type
    check (document_type is null or document_type in ('receipt', 'invoice'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoices add constraint invoices_customer_doc_type
    check (customer_doc_type is null or customer_doc_type in ('ruc', 'dni', 'ce', 'passport'));
exception when duplicate_object then null; end $$;

-- Los existentes: la serie dice qué son.
update public.invoices
   set document_type = case when series like 'F%' then 'invoice' else 'receipt' end
 where document_type is null;

alter table public.invoice_items
  add column if not exists tax_affectation text,
  add column if not exists line_kind       text not null default 'item';

do $$ begin
  alter table public.invoice_items add constraint invoice_items_tax_affectation
    check (tax_affectation is null or tax_affectation in ('gravado', 'exonerado', 'inafecto'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoice_items add constraint invoice_items_line_kind
    check (line_kind in ('item', 'shipping'));
exception when duplicate_object then null; end $$;

-- Tipo de documento del cliente a partir de lo que guardó el checkout.
create or replace function ebim.invoice_customer_doc_type(p_document_type text, p_billing jsonb)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_document_type = 'invoice' then 'ruc'
    when p_billing->>'id_type' in ('ruc', 'dni', 'ce', 'passport') then p_billing->>'id_type'
    when coalesce(p_billing->>'tax_id', '') ~ '^\d{11}$' then 'ruc'
    when coalesce(p_billing->>'tax_id', '') ~ '^\d{8}$' then 'dni'
    else null
  end
$fn$;

-- ---------------------------------------------------------------------------
-- 4 · Generar el comprobante desde el pedido (redefinida)
-- ---------------------------------------------------------------------------
create or replace function ebim.invoice_for_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order    public.orders%rowtype;
  v_cfg      public.invoice_settings%rowtype;
  v_invoice  uuid;
  v_billing  jsonb;
  v_doc      text;
  v_pos      smallint := 0;
  v_item     record;
  v_net      numeric(14,2);
  v_tax      numeric(14,2);
  v_ship     numeric(14,2);
  v_ship_net numeric(14,2);
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

  v_cfg     := ebim.invoice_settings_for(v_order.store_id);
  v_billing := coalesce(v_order.billing_address, '{}'::jsonb);
  v_doc     := case when v_billing->>'document_type' = 'invoice' then 'invoice' else 'receipt' end;

  insert into public.invoices (
    organization_id, company_id, store_id, order_id, series, status, currency,
    customer_name, customer_tax_id, net_total, tax_total, gross_total,
    document_type, customer_doc_type, customer_address
  ) values (
    v_order.organization_id, v_order.company_id, v_order.store_id, v_order.id,
    case when v_doc = 'invoice' then v_cfg.invoice_series else v_cfg.receipt_series end,
    'pending', v_order.currency,
    coalesce(nullif(btrim(v_billing->>'legal_name'), ''), nullif(btrim(v_order.customer_name), ''),
             v_order.customer_email),
    nullif(btrim(coalesce(v_billing->>'tax_id', '')), ''),
    0, 0, 0,
    v_doc,
    ebim.invoice_customer_doc_type(v_doc, v_billing),
    nullif(btrim(coalesce(v_billing->>'address', v_order.shipping_address->>'address', '')), '')
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
      net_amount, tax_rate, tax_amount, position, tax_affectation, line_kind
    ) values (
      v_order.organization_id, v_order.company_id, v_invoice,
      left(v_item.name || coalesce(' · ' || v_item.variant_label, ''), 300),
      v_item.quantity, round(v_net / v_item.quantity, 2), v_net,
      least(greatest(v_item.rate, 0), 1), v_tax, v_pos,
      case when v_item.rate > 0 then 'gravado' else v_cfg.zero_rate_affectation end,
      'item'
    );
    v_pos := v_pos + 1;
  end loop;

  -- El envío: lo cobrado es el importe CON IGV si la tienda lo grava.
  v_ship := coalesce(v_order.shipping_total, 0);
  if v_ship > 0 then
    v_ship_net := round(v_ship / (1 + v_cfg.shipping_tax_rate), 2);
    insert into public.invoice_items (
      organization_id, company_id, invoice_id, description, quantity, unit_price,
      net_amount, tax_rate, tax_amount, position, tax_affectation, line_kind
    ) values (
      v_order.organization_id, v_order.company_id, v_invoice, 'Envío', 1,
      v_ship_net, v_ship_net, v_cfg.shipping_tax_rate, v_ship - v_ship_net, v_pos,
      case when v_cfg.shipping_tax_rate > 0 then 'gravado' else v_cfg.zero_rate_affectation end,
      'shipping'
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

-- Corrige el envío de los comprobantes que aún no salieron: pendientes y sin
-- emisión encolada. Lo emitido no se toca (se corrige con una nota).
with envios as (
  select it.id, it.invoice_id, it.net_amount as gross
    from public.invoice_items it
    join public.invoices i on i.id = it.invoice_id
   where i.status = 'pending'
     and it.description = 'Envío'
     and it.tax_rate = 0
     and it.tax_amount = 0
     and not exists (select 1 from public.invoice_issue_requests r
                      where r.invoice_id = i.id and r.state = 'enqueued')
)
update public.invoice_items it
   set unit_price      = round(e.gross / 1.18, 2),
       net_amount      = round(e.gross / 1.18, 2),
       tax_rate        = 0.18,
       tax_amount      = e.gross - round(e.gross / 1.18, 2),
       tax_affectation = 'gravado',
       line_kind       = 'shipping'
  from envios e
 where it.id = e.id;

update public.invoices i set
  net_total = t.net, tax_total = t.tax, gross_total = t.net + t.tax
from (select it.invoice_id, sum(it.net_amount) as net, sum(it.tax_amount) as tax
        from public.invoice_items it
        join public.invoices x on x.id = it.invoice_id
       where x.status = 'pending'
       group by it.invoice_id) t
where i.id = t.invoice_id
  and i.status = 'pending'
  and (i.net_total <> t.net or i.tax_total <> t.tax);

-- ---------------------------------------------------------------------------
-- 5 · Encolar la emisión: versión 2 del mensaje, correlativo y regla de boleta
-- ---------------------------------------------------------------------------
create or replace function ebim.invoice_issue_enqueue(
  p_invoice_id   uuid,
  p_requested_by uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_version   constant smallint := 2;
  v_inv       public.invoices%rowtype;
  v_cfg       public.invoice_settings%rowtype;
  v_req       public.invoice_issue_requests%rowtype;
  v_key       text;
  v_lines     jsonb;
  v_count     integer;
  v_net       numeric;
  v_tax       numeric;
  v_providers text[];
  v_blocked   text;
  v_outbox    uuid;
  v_status    text;
  v_payload   jsonb;
  v_doc       text;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante'
      using errcode = '22023';
  end if;

  v_key := 'invoice.issue:' || v_inv.id::text;

  select * into v_req
    from public.invoice_issue_requests r
   where r.organization_id = v_inv.organization_id
     and r.company_id      = v_inv.company_id
     and r.invoice_id      = v_inv.id;

  if found and v_req.state = 'enqueued' then
    update public.invoice_issue_requests
       set request_count = request_count + 1, last_requested_at = now()
     where id = v_req.id;

    select o.id, o.status::text into v_outbox, v_status
      from public.integration_outbox o
     where o.organization_id = v_inv.organization_id
       and o.company_id      = v_inv.company_id
       and o.idempotency_key = v_key;

    return jsonb_build_object(
      'invoice_id',     v_inv.id,
      'state',          'enqueued',
      'provider_code',  v_req.provider_code,
      'outbox_id',      v_outbox,
      'outbox_status',  v_status,
      'schema_version', v_req.schema_version,
      'replay',         true);
  end if;

  if v_inv.status <> 'pending' then
    raise exception 'COMPROBANTE_NO_EMITIBLE: el comprobante esta en estado %', v_inv.status
      using errcode = '22023';
  end if;

  v_cfg := ebim.invoice_settings_for(v_inv.store_id);
  v_doc := coalesce(v_inv.document_type, case when v_inv.series like 'F%' then 'invoice' else 'receipt' end);

  -- SUNAT: boleta de S/ 700 o más, con documento del cliente. Una factura
  -- siempre con RUC.
  if v_doc = 'invoice' and coalesce(v_inv.customer_tax_id, '') !~ '^\d{11}$' then
    raise exception 'FACTURA_REQUIERE_RUC: una factura necesita el RUC del cliente'
      using errcode = '22023';
  end if;
  if v_doc = 'receipt' and v_inv.customer_tax_id is null
     and v_inv.currency = 'PEN' and v_inv.gross_total >= 700 then
    raise exception 'BOLETA_REQUIERE_DOCUMENTO: una boleta de S/ 700 o mas necesita el documento del cliente'
      using errcode = '22023';
  end if;

  select count(*),
         coalesce(sum(it.net_amount), 0),
         coalesce(sum(it.tax_amount), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'position',        it.position,
           'description',     it.description,
           'quantity',        it.quantity::text,
           'unit_price',      it.unit_price::text,
           'net_amount',      it.net_amount::text,
           'tax_rate',        it.tax_rate::text,
           'tax_amount',      it.tax_amount::text,
           'tax_affectation', coalesce(it.tax_affectation,
                                       case when it.tax_rate > 0 then 'gravado' else v_cfg.zero_rate_affectation end),
           'line_kind',       it.line_kind)
           order by it.position, it.created_at, it.id), '[]'::jsonb)
    into v_count, v_net, v_tax, v_lines
    from public.invoice_items it
   where it.organization_id = v_inv.organization_id
     and it.company_id      = v_inv.company_id
     and it.invoice_id      = v_inv.id;

  if v_count = 0 then
    raise exception 'COMPROBANTE_SIN_LINEAS: un comprobante sin lineas no se emite'
      using errcode = '22023';
  end if;
  if v_net <> v_inv.net_total or v_tax <> v_inv.tax_total then
    raise exception 'COMPROBANTE_DESCUADRADO: las lineas no suman los totales de la cabecera'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(ti.provider_code order by ti.provider_code), '{}'::text[])
    into v_providers
    from public.tenant_integrations ti
    join public.integration_providers p on p.code = ti.provider_code
   where ti.organization_id = v_inv.organization_id
     and ti.company_id      = v_inv.company_id
     and ti.is_active
     and p.is_active
     and p.kind = 'invoicing'
     and 'invoice.issue' = any (p.capabilities);

  v_blocked := case cardinality(v_providers)
                 when 0 then 'FACTURADOR_NO_CONFIGURADO'
                 when 1 then null
                 else 'FACTURADOR_AMBIGUO'
               end;

  if v_blocked is not null then
    insert into public.invoice_issue_requests as r (
      organization_id, company_id, invoice_id, state, blocked_code,
      idempotency_key, schema_version, requested_by
    ) values (
      v_inv.organization_id, v_inv.company_id, v_inv.id, 'pending_configuration', v_blocked,
      v_key, c_version, p_requested_by
    )
    on conflict (organization_id, company_id, invoice_id) do update
      set blocked_code      = excluded.blocked_code,
          request_count     = r.request_count + 1,
          last_requested_at = now()
    returning * into v_req;

    insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
    values (v_inv.organization_id, v_inv.company_id, v_inv.id, 'pending', v_blocked);

    perform ebim.record_ops_event(
      p_organization_id => v_inv.organization_id,
      p_company_id      => v_inv.company_id,
      p_store_id        => v_inv.store_id,
      p_kind            => 'integration_failed',
      p_code            => v_blocked,
      p_dedupe_key      => v_key,
      p_severity        => 'warning',
      p_message         => case v_blocked
                             when 'FACTURADOR_AMBIGUO'
                               then 'Hay mas de un proveedor fiscal activo; no se elige uno a ciegas'
                             else 'La sociedad no tiene un proveedor fiscal activo'
                           end,
      p_operation       => 'invoice.issue',
      p_entity_type     => 'invoice',
      p_entity_id       => v_inv.id,
      p_context         => jsonb_build_object('providers', cardinality(v_providers)));

    return jsonb_build_object(
      'invoice_id',     v_inv.id,
      'state',          'pending_configuration',
      'blocked_code',   v_blocked,
      'provider_code',  null,
      'outbox_id',      null,
      'outbox_status',  null,
      'schema_version', c_version,
      'replay',         v_req.request_count > 1);
  end if;

  -- El correlativo, recién ahora: hay emisor y el mensaje sale en esta misma
  -- transacción. Un comprobante que ya tenía número lo conserva.
  if v_inv.number is null then
    v_inv.number := lpad(ebim.invoice_next_number(v_inv.organization_id, v_inv.company_id, v_inv.series)::text, 8, '0');
    update public.invoices set number = v_inv.number where id = v_inv.id;
  end if;

  v_payload := jsonb_build_object(
    'schema_version',  c_version,
    'operation',       'invoice.issue',
    'idempotency_key', v_key,
    'store_id',        v_inv.store_id,
    'invoice_id',      v_inv.id,
    'order_id',        v_inv.order_id,
    'document_type',   v_doc,
    'series',          v_inv.series,
    'number',          v_inv.number,
    'issued_at',       to_char(v_inv.issued_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'currency',        v_inv.currency,
    'customer',        jsonb_build_object('name',     v_inv.customer_name,
                                          'tax_id',   v_inv.customer_tax_id,
                                          'doc_type', v_inv.customer_doc_type,
                                          'address',  v_inv.customer_address),
    'totals',          jsonb_build_object('net',   v_inv.net_total::text,
                                          'tax',   v_inv.tax_total::text,
                                          'gross', v_inv.gross_total::text),
    'lines',           v_lines);

  v_outbox := public.integration_enqueue(
    v_inv.organization_id, v_inv.company_id, v_providers[1],
    'invoice.issue', v_payload, v_key);

  insert into public.invoice_issue_requests as r (
    organization_id, company_id, invoice_id, state, provider_code,
    idempotency_key, schema_version, requested_by, enqueued_at
  ) values (
    v_inv.organization_id, v_inv.company_id, v_inv.id, 'enqueued', v_providers[1],
    v_key, c_version, p_requested_by, now()
  )
  on conflict (organization_id, company_id, invoice_id) do update
    set state             = 'enqueued',
        blocked_code      = null,
        provider_code     = excluded.provider_code,
        schema_version    = excluded.schema_version,
        enqueued_at       = now(),
        request_count     = r.request_count + 1,
        last_requested_at = now()
  returning * into v_req;

  update public.invoices
     set provider_code = v_providers[1]
   where id = v_inv.id
     and provider_code is distinct from v_providers[1];

  insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
  values (v_inv.organization_id, v_inv.company_id, v_inv.id, 'pending',
          'EMISION_ENCOLADA:' || v_providers[1]);

  update public.ops_events e
     set resolved_at     = now(),
         resolved_by     = p_requested_by,
         resolution_note = 'Emision encolada tras configurar el proveedor fiscal'
   where e.organization_id = v_inv.organization_id
     and e.company_id      = v_inv.company_id
     and e.dedupe_key      = v_key
     and e.resolved_at is null;

  select o.status::text into v_status from public.integration_outbox o where o.id = v_outbox;

  return jsonb_build_object(
    'invoice_id',     v_inv.id,
    'state',          'enqueued',
    'provider_code',  v_providers[1],
    'outbox_id',      v_outbox,
    'outbox_status',  v_status,
    'schema_version', c_version,
    'replay',         false);
end;
$fn$;

revoke execute on function ebim.invoice_issue_enqueue(uuid, uuid)
  from public, anon, authenticated;
grant execute on function ebim.invoice_issue_enqueue(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6 · Automático: generar y, si la tienda lo pidió, emitir
-- ---------------------------------------------------------------------------
create or replace function ebim.invoice_auto_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order   public.orders%rowtype;
  v_invoice uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found or v_order.status = 'cancelled'
     or not ebim.company_is_entitled(v_order.organization_id, v_order.company_id, 'invoicing')
     or exists (select 1 from public.invoices i
                 where i.order_id = v_order.id and i.status not in ('rejected', 'cancelled')) then
    return;
  end if;
  begin
    v_invoice := ebim.invoice_for_order(v_order.id);
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
    return;
  end;

  -- Emisión automática: también aislada. Si no sale (sin emisor, sin documento),
  -- el comprobante queda pendiente y el motivo, a la vista.
  if (ebim.invoice_settings_for(v_order.store_id)).auto_issue then
    begin
      perform ebim.invoice_issue_enqueue(v_invoice, null);
    exception when others then
      perform ebim.record_ops_event(
        p_organization_id => v_order.organization_id,
        p_company_id      => v_order.company_id,
        p_kind            => 'integration_failed'::public.ops_event_kind,
        p_code            => 'COMPROBANTE_NO_EMITIDO',
        p_dedupe_key      => 'invoice.auto_issue:' || v_invoice::text,
        p_severity        => 'warning'::public.ops_severity,
        p_message         => 'No se pudo pedir la emision del comprobante del pedido ' || v_order.order_number || ': ' || left(sqlerrm, 300),
        p_entity_type     => 'invoice',
        p_entity_id       => v_invoice,
        p_store_id        => v_order.store_id);
    end;
  end if;
end;
$fn$;

revoke execute on function ebim.invoice_auto_for_order(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7 · El comando del backoffice para configurar
-- ---------------------------------------------------------------------------
create or replace function public.invoice_settings_configure(
  p_store_id              uuid,
  p_receipt_series        text,
  p_invoice_series        text,
  p_shipping_tax_rate     numeric,
  p_zero_rate_affectation text,
  p_auto_issue            boolean,
  -- Último número YA emitido en cada serie (si la tienda viene de otro sistema).
  -- Solo sube: el correlativo nunca retrocede.
  p_receipt_last_number   integer default null,
  p_invoice_last_number   integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
  v_r     text := upper(btrim(coalesce(p_receipt_series, '')));
  v_f     text := upper(btrim(coalesce(p_invoice_series, '')));
  v_pair  record;
  v_cur   integer;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not ebim.can_access(v_store.organization_id, v_store.company_id) then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no es de esta sociedad' using errcode = '22023';
  end if;
  if not ebim.has_role(v_store.organization_id, v_store.company_id, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: configurar la facturacion exige rol de administracion' using errcode = '42501';
  end if;
  if v_r !~ '^B[A-Z0-9]{3}$' then
    raise exception 'SERIE_INVALIDA: la serie de boletas es B y tres caracteres (ej. B001)' using errcode = '22023';
  end if;
  if v_f !~ '^F[A-Z0-9]{3}$' then
    raise exception 'SERIE_INVALIDA: la serie de facturas es F y tres caracteres (ej. F001)' using errcode = '22023';
  end if;
  if p_shipping_tax_rate is null or p_shipping_tax_rate < 0 or p_shipping_tax_rate >= 1 then
    raise exception 'TASA_INVALIDA: la tasa del envio va de 0 a 0.99' using errcode = '22023';
  end if;
  if p_zero_rate_affectation not in ('exonerado', 'inafecto') then
    raise exception 'AFECTACION_INVALIDA: exonerado o inafecto' using errcode = '22023';
  end if;

  insert into public.invoice_settings (
    store_id, organization_id, company_id, receipt_series, invoice_series,
    shipping_tax_rate, zero_rate_affectation, auto_issue, updated_by
  ) values (
    v_store.id, v_store.organization_id, v_store.company_id, v_r, v_f,
    p_shipping_tax_rate, p_zero_rate_affectation, coalesce(p_auto_issue, false), ebim.user_id()
  )
  on conflict (store_id) do update
     set receipt_series        = excluded.receipt_series,
         invoice_series        = excluded.invoice_series,
         shipping_tax_rate     = excluded.shipping_tax_rate,
         zero_rate_affectation = excluded.zero_rate_affectation,
         auto_issue            = excluded.auto_issue,
         updated_by            = excluded.updated_by;

  for v_pair in select * from (values (v_r, p_receipt_last_number), (v_f, p_invoice_last_number)) as t(series, n)
  loop
    continue when v_pair.n is null;
    if v_pair.n < 0 or v_pair.n > 99999999 then
      raise exception 'CORRELATIVO_INVALIDO: entre 0 y 99999999' using errcode = '22023';
    end if;
    -- Lo ya usado manda: el de la secuencia o el más alto emitido en la serie.
    select greatest(
             coalesce((select q.last_number from public.invoice_sequences q
                        where q.organization_id = v_store.organization_id
                          and q.company_id = v_store.company_id and q.series = v_pair.series), 0),
             ebim.invoice_max_number(v_store.organization_id, v_store.company_id, v_pair.series))
      into v_cur;
    if v_pair.n < v_cur then
      raise exception 'CORRELATIVO_NO_RETROCEDE: la serie % ya va en el %', v_pair.series, v_cur using errcode = '22023';
    end if;
    insert into public.invoice_sequences (organization_id, company_id, series, last_number)
    values (v_store.organization_id, v_store.company_id, v_pair.series, v_pair.n)
    on conflict (organization_id, company_id, series) do update set last_number = excluded.last_number;
  end loop;

  perform ebim.audit(
    p_organization_id => v_store.organization_id,
    p_company_id      => v_store.company_id,
    p_action          => 'invoice_settings.configured',
    p_entity_type     => 'store',
    p_entity_id       => v_store.id,
    p_store_id        => v_store.id,
    p_changes         => jsonb_build_object(
      'receipt_series', v_r, 'invoice_series', v_f,
      'shipping_tax_rate', p_shipping_tax_rate, 'zero_rate_affectation', p_zero_rate_affectation,
      'auto_issue', coalesce(p_auto_issue, false),
      'receipt_last_number', p_receipt_last_number, 'invoice_last_number', p_invoice_last_number));

  return jsonb_build_object('store_id', v_store.id, 'receipt_series', v_r, 'invoice_series', v_f);
end;
$fn$;

revoke execute on function public.invoice_settings_configure(uuid, text, text, numeric, text, boolean, integer, integer)
  from public, anon;
grant  execute on function public.invoice_settings_configure(uuid, text, text, numeric, text, boolean, integer, integer)
  to authenticated;

-- Toda tabla de negocio nueva lleva el guardián de suspensión (tenant_lifecycle).
select platform_lifecycle.ensure_guards();
