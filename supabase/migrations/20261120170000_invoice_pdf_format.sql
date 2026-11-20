-- =============================================================================
-- Facturación · formato del PDF por tienda (2026-11-20)
--
-- Nubefact genera el PDF en el formato que se le pida (`formato_de_pdf`: A4,
-- A5 o TICKET); sin pedirlo, usa el predeterminado de la cuenta (en la DEMO,
-- ticket de 80 mm para boletas). La tienda lo elige en Configuración ›
-- Facturación; viaja en el mensaje `invoice.issue` (`pdf_format`, null = el
-- predeterminado). Aditivo: la versión del mensaje sigue en 3.
-- =============================================================================

alter table public.invoice_settings add column if not exists pdf_format text;
do $$ begin
  alter table public.invoice_settings add constraint invoice_settings_pdf_format
    check (pdf_format is null or pdf_format in ('A4', 'A5', 'TICKET'));
exception when duplicate_object then null; end $$;

drop function if exists public.invoice_settings_configure(uuid, text, text, numeric, text, boolean, integer, integer, text, text);

-- Encolar (definición de 20261120150000 con el formato en el mensaje)
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
    -- Correlativo por serie Y tipo: la boleta BBB1-1 y su nota BBB1-1 conviven.
    v_inv.number := lpad(ebim.invoice_next_number(v_inv.organization_id, v_inv.company_id, v_inv.series,
                                                  case when v_doc = 'credit_note' then 'credit_note' else 'document' end)::text, 8, '0');
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
    'pdf_format',      v_cfg.pdf_format,
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

-- Configurar (definición de 20261120150000 con el formato)
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
  p_credit_note_invoice_series text default null,
  -- 2026-11-20 · A4, A5 o TICKET; vacío = el predeterminado de la cuenta del emisor.
  p_pdf_format                 text default null
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
  v_pdf   text := nullif(upper(btrim(coalesce(p_pdf_format, ''))), '');
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
  if p_shipping_tax_rate is null or p_shipping_tax_rate < 0 or p_shipping_tax_rate >= 1 then
    raise exception 'TASA_INVALIDA: la tasa del envio va de 0 a 0.99' using errcode = '22023';
  end if;
  if v_pdf is not null and v_pdf not in ('A4', 'A5', 'TICKET') then
    raise exception 'FORMATO_PDF_INVALIDO: A4, A5 o TICKET' using errcode = '22023';
  end if;
  if p_zero_rate_affectation not in ('exonerado', 'inafecto') then
    raise exception 'AFECTACION_INVALIDA: exonerado o inafecto' using errcode = '22023';
  end if;

  insert into public.invoice_settings (
    store_id, organization_id, company_id, receipt_series, invoice_series,
    credit_note_receipt_series, credit_note_invoice_series,
    shipping_tax_rate, zero_rate_affectation, auto_issue, pdf_format, updated_by
  ) values (
    v_store.id, v_store.organization_id, v_store.company_id, v_r, v_f, v_cr, v_cf,
    p_shipping_tax_rate, p_zero_rate_affectation, coalesce(p_auto_issue, false), v_pdf, ebim.user_id()
  )
  on conflict (store_id) do update
     set receipt_series             = excluded.receipt_series,
         invoice_series             = excluded.invoice_series,
         credit_note_receipt_series = excluded.credit_note_receipt_series,
         credit_note_invoice_series = excluded.credit_note_invoice_series,
         shipping_tax_rate          = excluded.shipping_tax_rate,
         zero_rate_affectation      = excluded.zero_rate_affectation,
         auto_issue                 = excluded.auto_issue,
         pdf_format                 = excluded.pdf_format,
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
                          and q.company_id = v_store.company_id and q.series = v_pair.series
                          and q.doc_kind = 'document'), 0),
             ebim.invoice_max_number(v_store.organization_id, v_store.company_id, v_pair.series, 'document'))
      into v_cur;
    if v_pair.n < v_cur then
      raise exception 'CORRELATIVO_NO_RETROCEDE: la serie % ya va en el %', v_pair.series, v_cur using errcode = '22023';
    end if;
    insert into public.invoice_sequences (organization_id, company_id, series, doc_kind, last_number)
    values (v_store.organization_id, v_store.company_id, v_pair.series, 'document', v_pair.n)
    on conflict (organization_id, company_id, doc_kind, series) do update set last_number = excluded.last_number;
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
      'pdf_format', v_pdf,
      'receipt_last_number', p_receipt_last_number, 'invoice_last_number', p_invoice_last_number));

  return jsonb_build_object('store_id', v_store.id, 'receipt_series', v_r, 'invoice_series', v_f);
end;
$fn$;

revoke execute on function public.invoice_settings_configure(uuid, text, text, numeric, text, boolean, integer, integer, text, text, text)
  from public, anon;
grant  execute on function public.invoice_settings_configure(uuid, text, text, numeric, text, boolean, integer, integer, text, text, text)
  to authenticated;
