-- =============================================================================
-- Facturación electrónica Perú · fase 5 — nota de crédito (2026-11-20)
--
-- Un comprobante emitido no se borra ni se edita: se ANULA con una nota de
-- crédito que lo referencia (SUNAT, tipo 07). Hasta hoy, cancelar un pedido
-- con comprobante emitido solo abría un aviso «falta la nota de crédito».
--
--   1. La nota de crédito es un comprobante más (`document_type =
--      'credit_note'`) con su serie (BC01/FC01 por defecto, configurable), su
--      correlativo, las MISMAS líneas que el original y la referencia a él.
--   2. `invoice_request_credit_note(invoice, motivo)`: el comando del
--      backoffice (owner/admin, como «Emitir»). La crea y la encola.
--   3. Al cancelar un pedido con comprobante emitido: si la tienda emite
--      automáticamente, la nota sale sola; si no, queda el aviso de siempre y
--      el botón en Crédito › Comprobantes.
--   4. Cuando SUNAT acepta la nota, el original pasa a «anulado».
--   5. El mensaje `invoice.issue` pasa a v3: `reference` y `credit_note`
--      (null en boletas y facturas).
--
-- Y dos huecos de la fase 2 que esto destapa:
--   · cancelar un pedido cuyo comprobante estaba ENCOLADO y aún no salió dejaba
--     el mensaje vivo: el trabajador lo habría emitido igual. Ahora el mensaje
--     pendiente se retira con el comprobante;
--   · si aun así el emisor ya lo había recibido (mensaje en vuelo), el
--     resultado no «revive» en silencio un comprobante anulado: se registra lo
--     emitido y se avisa de que hace falta la nota.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Columnas
-- ---------------------------------------------------------------------------
alter table public.invoices drop constraint if exists invoices_document_type;
alter table public.invoices add constraint invoices_document_type
  check (document_type is null or document_type in ('receipt', 'invoice', 'credit_note'));

alter table public.invoices
  add column if not exists reference_invoice_id uuid,
  add column if not exists credit_note_type     smallint,
  add column if not exists credit_note_reason   text;

do $$ begin
  alter table public.invoices add constraint invoices_reference_fk
    foreign key (reference_invoice_id, organization_id, company_id)
    references public.invoices (id, organization_id, company_id) on delete restrict;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_credit_note_shape check (
    (document_type = 'credit_note'
       and reference_invoice_id is not null
       and credit_note_type between 1 and 13
       and char_length(btrim(coalesce(credit_note_reason, ''))) between 3 and 250)
    or (coalesce(document_type, '') <> 'credit_note'
       and reference_invoice_id is null and credit_note_type is null));
exception when duplicate_object then null; end $$;

-- Una nota VIGENTE por comprobante (la rechazada no cuenta).
create unique index if not exists invoices_one_credit_note
  on public.invoices (reference_invoice_id)
  where document_type = 'credit_note' and status not in ('rejected', 'cancelled');

alter table public.invoice_settings
  add column if not exists credit_note_receipt_series text not null default 'BC01',
  add column if not exists credit_note_invoice_series text not null default 'FC01';

do $$ begin
  alter table public.invoice_settings add constraint invoice_settings_cn_series check (
    credit_note_receipt_series ~ '^B[A-Z0-9]{3}$' and credit_note_invoice_series ~ '^F[A-Z0-9]{3}$');
exception when duplicate_object then null; end $$;

-- Los valores por defecto cuando la tienda no guardó configuración.
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
    v.store_id                   := p_store_id;
    v.receipt_series             := 'B001';
    v.invoice_series             := 'F001';
    v.credit_note_receipt_series := 'BC01';
    v.credit_note_invoice_series := 'FC01';
    v.shipping_tax_rate          := 0.18;
    v.zero_rate_affectation      := 'exonerado';
    v.auto_issue                 := false;
  end if;
  return v;
end;
$fn$;

revoke execute on function ebim.invoice_settings_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Crear la nota de crédito de un comprobante
-- ---------------------------------------------------------------------------
create or replace function ebim.invoice_credit_note_for(p_invoice_id uuid, p_reason text, p_type smallint default 1)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_orig   public.invoices%rowtype;
  v_cfg    public.invoice_settings%rowtype;
  v_doc    text;
  v_note   uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_orig from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante' using errcode = '22023';
  end if;
  v_doc := coalesce(v_orig.document_type, case when v_orig.series like 'F%' then 'invoice' else 'receipt' end);
  if v_doc = 'credit_note' then
    raise exception 'NOTA_DE_NOTA: una nota de credito no se anula con otra' using errcode = '22023';
  end if;
  if v_orig.status not in ('issued', 'accepted') or v_orig.number is null then
    raise exception 'COMPROBANTE_NO_EMITIDO: solo se anula con nota un comprobante ya emitido' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices n
              where n.reference_invoice_id = v_orig.id and n.document_type = 'credit_note'
                and n.status not in ('rejected', 'cancelled')) then
    raise exception 'NOTA_YA_EXISTE: el comprobante ya tiene una nota de credito' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 250 then
    raise exception 'MOTIVO_REQUERIDO: el motivo va de 3 a 250 caracteres' using errcode = '22023';
  end if;
  if p_type is null or p_type not between 1 and 13 then
    raise exception 'TIPO_DE_NOTA_INVALIDO: entre 1 y 13 (catalogo SUNAT)' using errcode = '22023';
  end if;

  v_cfg := ebim.invoice_settings_for(v_orig.store_id);

  insert into public.invoices (
    organization_id, company_id, store_id, order_id, series, status, currency,
    customer_name, customer_tax_id, net_total, tax_total, gross_total,
    document_type, customer_doc_type, customer_address,
    reference_invoice_id, credit_note_type, credit_note_reason
  ) values (
    v_orig.organization_id, v_orig.company_id, v_orig.store_id, v_orig.order_id,
    case when v_doc = 'invoice' then v_cfg.credit_note_invoice_series else v_cfg.credit_note_receipt_series end,
    'pending', v_orig.currency,
    v_orig.customer_name, v_orig.customer_tax_id, v_orig.net_total, v_orig.tax_total, v_orig.gross_total,
    'credit_note', v_orig.customer_doc_type, v_orig.customer_address,
    v_orig.id, p_type, v_reason
  ) returning id into v_note;

  -- Las MISMAS líneas: la nota anula la operación completa.
  insert into public.invoice_items (
    organization_id, company_id, invoice_id, description, quantity, unit_price,
    net_amount, tax_rate, tax_amount, position, tax_affectation, line_kind
  )
  select it.organization_id, it.company_id, v_note, it.description, it.quantity, it.unit_price,
         it.net_amount, it.tax_rate, it.tax_amount, it.position, it.tax_affectation, it.line_kind
    from public.invoice_items it
   where it.invoice_id = v_orig.id;

  insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
  values (v_orig.organization_id, v_orig.company_id, v_orig.id, v_orig.status,
          left('NOTA_DE_CREDITO_CREADA: ' || v_reason, 500));

  return v_note;
end;
$fn$;

revoke execute on function ebim.invoice_credit_note_for(uuid, text, smallint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · El comando del backoffice
-- ---------------------------------------------------------------------------
create or replace function public.invoice_request_credit_note(p_invoice_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_inv    public.invoices%rowtype;
  v_note   uuid;
  v_result jsonb;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice_id;
  if not found or not ebim.can_access(v_inv.organization_id, v_inv.company_id) then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante' using errcode = '22023';
  end if;
  if not ebim.has_role(v_inv.organization_id, v_inv.company_id, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: anular un comprobante es cosa del propietario o un administrador'
      using errcode = '42501';
  end if;
  if not ebim.has_capability(v_inv.organization_id, v_inv.company_id, 'invoicing') then
    raise exception 'MODULO_NO_CONTRATADO: la facturacion no esta activa para esta sociedad' using errcode = '42501';
  end if;

  v_note   := ebim.invoice_credit_note_for(v_inv.id, p_reason, 1::smallint);
  v_result := ebim.invoice_issue_enqueue(v_note, ebim.user_id());

  perform ebim.audit(
    p_organization_id => v_inv.organization_id,
    p_company_id      => v_inv.company_id,
    p_action          => 'invoice.credit_note_requested',
    p_entity_type     => 'invoice',
    p_entity_id       => v_inv.id,
    p_entity_label    => v_inv.series || coalesce('-' || v_inv.number, ''),
    p_store_id        => v_inv.store_id,
    p_metadata        => jsonb_build_object('credit_note_id', v_note, 'state', v_result ->> 'state',
                                            'blocked_code', v_result ->> 'blocked_code'));

  return v_result || jsonb_build_object('credit_note_id', v_note);
end;
$fn$;

revoke execute on function public.invoice_request_credit_note(uuid, text) from public, anon;
grant  execute on function public.invoice_request_credit_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Encolar: versión 3 del mensaje (referencia y tipo de nota)
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
  c_version   constant smallint := 3;
  v_inv       public.invoices%rowtype;
  v_ref       public.invoices%rowtype;
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
  v_ref_doc   text;
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

  if v_doc = 'credit_note' then
    select * into v_ref from public.invoices r where r.id = v_inv.reference_invoice_id;
    v_ref_doc := coalesce(v_ref.document_type, case when v_ref.series like 'F%' then 'invoice' else 'receipt' end);
    if v_ref.id is null or v_ref.number is null or v_ref.status not in ('issued', 'accepted') then
      raise exception 'REFERENCIA_NO_EMITIDA: la nota anula un comprobante que no esta emitido'
        using errcode = '22023';
    end if;
  end if;

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
    'lines',           v_lines,
    'reference',       case when v_doc = 'credit_note'
                            then jsonb_build_object('document_type', v_ref_doc,
                                                    'series',        v_ref.series,
                                                    'number',        v_ref.number) end,
    'credit_note',     case when v_doc = 'credit_note'
                            then jsonb_build_object('type',   v_inv.credit_note_type,
                                                    'reason', v_inv.credit_note_reason) end);

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

revoke execute on function ebim.invoice_issue_enqueue(uuid, uuid) from public, anon, authenticated;
grant execute on function ebim.invoice_issue_enqueue(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5 · El resultado del emisor: nota aceptada anula el original; un comprobante
--     anulado que el emisor igual recibió no revive en silencio
-- ---------------------------------------------------------------------------
create or replace function public.invoice_record_provider_result(p_invoice_id uuid, p_result jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_inv    public.invoices%rowtype;
  v_status text := p_result->>'status';
  v_ref    public.invoices%rowtype;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante' using errcode = '22023';
  end if;
  if v_status not in ('accepted', 'issued', 'rejected') then
    raise exception 'RESULTADO_NO_VALIDO: estado %', v_status using errcode = '22023';
  end if;
  if p_result ? 'number' and v_inv.number is not null
     and ltrim(p_result->>'number', '0') <> ltrim(v_inv.number, '0') then
    raise exception 'NUMERO_DISTINTO: el emisor respondio % y el comprobante es %', p_result->>'number', v_inv.number
      using errcode = '22023';
  end if;
  if v_inv.status = 'accepted' then
    return jsonb_build_object('invoice_id', v_inv.id, 'status', 'accepted', 'changed', false);
  end if;

  update public.invoices i set
    status              = v_status::public.invoice_status,
    issued_at           = case when v_inv.status in ('pending', 'cancelled') then now() else i.issued_at end,
    document_ref        = coalesce(nullif(p_result->>'document_ref', ''), i.document_ref),
    pdf_url             = coalesce(nullif(p_result->>'pdf_url', ''), i.pdf_url),
    xml_url             = coalesce(nullif(p_result->>'xml_url', ''), i.xml_url),
    cdr_url             = coalesce(nullif(p_result->>'cdr_url', ''), i.cdr_url),
    sunat_code          = coalesce(nullif(p_result->>'sunat_code', ''), i.sunat_code),
    sunat_description   = coalesce(left(nullif(p_result->>'sunat_description', ''), 500), i.sunat_description),
    qr_string           = coalesce(nullif(p_result->>'qr_string', ''), i.qr_string),
    hash_code           = coalesce(nullif(p_result->>'hash_code', ''), i.hash_code),
    reject_reason       = case when v_status = 'rejected'
                               then left(coalesce(p_result->>'sunat_description', p_result->>'detail'), 500)
                               else i.reject_reason end,
    provider_checked_at = now()
  where i.id = v_inv.id;

  if v_status::public.invoice_status is distinct from v_inv.status then
    insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
    values (v_inv.organization_id, v_inv.company_id, v_inv.id, v_status::public.invoice_status,
            left(coalesce(p_result->>'detail', p_result->>'sunat_description', v_status), 500));
  end if;

  -- Estaba anulado (pedido cancelado) y el emisor igual lo emitió: existe ante
  -- SUNAT, así que hace falta su nota. Se dice; no se finge que no salió.
  if v_inv.status = 'cancelled' and v_status in ('issued', 'accepted')
     and coalesce(v_inv.document_type, '') <> 'credit_note' then
    perform ebim.record_ops_event(
      p_organization_id => v_inv.organization_id,
      p_company_id      => v_inv.company_id,
      p_kind            => 'integration_failed'::public.ops_event_kind,
      p_code            => 'NOTA_DE_CREDITO_PENDIENTE',
      p_dedupe_key      => 'invoice.credit_note:' || v_inv.id::text,
      p_severity        => 'warning'::public.ops_severity,
      p_message         => 'El comprobante ' || v_inv.series || coalesce('-' || v_inv.number, '')
                           || ' salio despues de cancelarse el pedido: falta emitir la nota de credito',
      p_entity_type     => 'invoice',
      p_entity_id       => v_inv.id,
      p_store_id        => v_inv.store_id);
  end if;

  -- Nota aceptada: el original queda anulado.
  if v_inv.document_type = 'credit_note' and v_status = 'accepted' then
    select * into v_ref from public.invoices r where r.id = v_inv.reference_invoice_id for update;
    if found and v_ref.status in ('issued', 'accepted') then
      update public.invoices set status = 'cancelled' where id = v_ref.id;
      insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
      values (v_ref.organization_id, v_ref.company_id, v_ref.id, 'cancelled',
              'ANULADO_POR_NOTA: ' || v_inv.series || '-' || coalesce(v_inv.number, ''));
      update public.ops_events e
         set resolved_at = now(), resolution_note = 'Nota de credito aceptada'
       where e.organization_id = v_ref.organization_id and e.company_id = v_ref.company_id
         and e.dedupe_key = 'invoice.credit_note:' || v_ref.id::text and e.resolved_at is null;
    end if;
  end if;

  return jsonb_build_object('invoice_id', v_inv.id, 'status', v_status,
                            'changed', v_status::public.invoice_status is distinct from v_inv.status);
end;
$fn$;

revoke execute on function public.invoice_record_provider_result(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.invoice_record_provider_result(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6 · Cancelar el pedido
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

  for v_inv in
    select * from public.invoices i
     where i.order_id = new.id and coalesce(i.document_type, '') <> 'credit_note'
  loop
    if v_inv.status = 'pending' then
      update public.invoices set status = 'cancelled', updated_at = now() where id = v_inv.id;
      insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
      values (v_inv.organization_id, v_inv.company_id, v_inv.id, 'cancelled', 'Pedido cancelado');
      -- El mensaje que aún no salió se retira con él (el que ya está en vuelo
      -- no se puede parar: si sale, `invoice_record_provider_result` lo avisa).
      update public.integration_outbox o
         set status = 'dead', completed_at = now(), last_error = 'COMPROBANTE_ANULADO: pedido cancelado'
       where o.organization_id = v_inv.organization_id and o.company_id = v_inv.company_id
         and o.idempotency_key = 'invoice.issue:' || v_inv.id::text
         and o.status = 'pending';
    elsif v_inv.status in ('issued', 'accepted') then
      -- Con emisión automática, la nota sale sola. Aislado: no tumba la cancelación.
      if (ebim.invoice_settings_for(v_inv.store_id)).auto_issue then
        begin
          perform ebim.invoice_issue_enqueue(
            ebim.invoice_credit_note_for(v_inv.id, 'Pedido ' || new.order_number || ' cancelado', 1::smallint),
            null);
          continue;
        exception when others then
          null; -- cae al aviso de abajo
        end;
      end if;
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
-- 7 · Configurar: series de nota de crédito (nueva firma)
-- ---------------------------------------------------------------------------
drop function if exists public.invoice_settings_configure(uuid, text, text, numeric, text, boolean, integer, integer);

create or replace function public.invoice_settings_configure(
  p_store_id                   uuid,
  p_receipt_series             text,
  p_invoice_series             text,
  p_shipping_tax_rate          numeric,
  p_zero_rate_affectation      text,
  p_auto_issue                 boolean,
  p_receipt_last_number        integer default null,
  p_invoice_last_number        integer default null,
  p_credit_note_receipt_series text default null,
  p_credit_note_invoice_series text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
  v_cur_s public.invoice_settings%rowtype;
  v_r     text := upper(btrim(coalesce(p_receipt_series, '')));
  v_f     text := upper(btrim(coalesce(p_invoice_series, '')));
  v_cr    text;
  v_cf    text;
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

  v_cur_s := ebim.invoice_settings_for(v_store.id);
  v_cr := upper(btrim(coalesce(p_credit_note_receipt_series, v_cur_s.credit_note_receipt_series)));
  v_cf := upper(btrim(coalesce(p_credit_note_invoice_series, v_cur_s.credit_note_invoice_series)));

  if v_r !~ '^B[A-Z0-9]{3}$' or v_cr !~ '^B[A-Z0-9]{3}$' then
    raise exception 'SERIE_INVALIDA: las series de boletas y sus notas son B y tres caracteres (ej. B001, BC01)' using errcode = '22023';
  end if;
  if v_f !~ '^F[A-Z0-9]{3}$' or v_cf !~ '^F[A-Z0-9]{3}$' then
    raise exception 'SERIE_INVALIDA: las series de facturas y sus notas son F y tres caracteres (ej. F001, FC01)' using errcode = '22023';
  end if;
  if v_cr = v_r or v_cf = v_f then
    raise exception 'SERIE_INVALIDA: la nota de credito necesita una serie distinta de la del comprobante' using errcode = '22023';
  end if;
  if p_shipping_tax_rate is null or p_shipping_tax_rate < 0 or p_shipping_tax_rate >= 1 then
    raise exception 'TASA_INVALIDA: la tasa del envio va de 0 a 0.99' using errcode = '22023';
  end if;
  if p_zero_rate_affectation not in ('exonerado', 'inafecto') then
    raise exception 'AFECTACION_INVALIDA: exonerado o inafecto' using errcode = '22023';
  end if;

  insert into public.invoice_settings (
    store_id, organization_id, company_id, receipt_series, invoice_series,
    credit_note_receipt_series, credit_note_invoice_series,
    shipping_tax_rate, zero_rate_affectation, auto_issue, updated_by
  ) values (
    v_store.id, v_store.organization_id, v_store.company_id, v_r, v_f, v_cr, v_cf,
    p_shipping_tax_rate, p_zero_rate_affectation, coalesce(p_auto_issue, false), ebim.user_id()
  )
  on conflict (store_id) do update
     set receipt_series             = excluded.receipt_series,
         invoice_series             = excluded.invoice_series,
         credit_note_receipt_series = excluded.credit_note_receipt_series,
         credit_note_invoice_series = excluded.credit_note_invoice_series,
         shipping_tax_rate          = excluded.shipping_tax_rate,
         zero_rate_affectation      = excluded.zero_rate_affectation,
         auto_issue                 = excluded.auto_issue,
         updated_by                 = excluded.updated_by;

  for v_pair in select * from (values (v_r, p_receipt_last_number), (v_f, p_invoice_last_number)) as t(series, n)
  loop
    continue when v_pair.n is null;
    if v_pair.n < 0 or v_pair.n > 99999999 then
      raise exception 'CORRELATIVO_INVALIDO: entre 0 y 99999999' using errcode = '22023';
    end if;
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
      'credit_note_receipt_series', v_cr, 'credit_note_invoice_series', v_cf,
      'shipping_tax_rate', p_shipping_tax_rate, 'zero_rate_affectation', p_zero_rate_affectation,
      'auto_issue', coalesce(p_auto_issue, false),
      'receipt_last_number', p_receipt_last_number, 'invoice_last_number', p_invoice_last_number));

  return jsonb_build_object('store_id', v_store.id, 'receipt_series', v_r, 'invoice_series', v_f);
end;
$fn$;

revoke execute on function public.invoice_settings_configure(uuid, text, text, numeric, text, boolean, integer, integer, text, text)
  from public, anon;
grant  execute on function public.invoice_settings_configure(uuid, text, text, numeric, text, boolean, integer, integer, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8 · «Mi cuenta»: el comprobante del pedido, nunca su nota
-- ---------------------------------------------------------------------------
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

  select i.* into v_inv
    from public.invoices i
   where i.order_id = v_order.id
     and coalesce(i.document_type, '') <> 'credit_note'
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
    'pdf_url',       case when v_inv.pdf_url ~ '^https://' then v_inv.pdf_url end);
end;
$fn$;

revoke execute on function public.my_order_invoice(uuid) from public, anon;
grant  execute on function public.my_order_invoice(uuid) to authenticated;

-- El correo «Tu boleta» es del comprobante, no de su nota.
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
  if old.status <> 'pending' or new.status not in ('issued', 'accepted') or new.pdf_url is null
     or new.pdf_url !~ '^https://' or coalesce(new.document_type, '') = 'credit_note' then
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
