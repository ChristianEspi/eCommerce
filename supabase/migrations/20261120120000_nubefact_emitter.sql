-- =============================================================================
-- Facturación electrónica Perú · fase 2 — emisor Nubefact (2026-11-20)
--
-- La fase 1 dejó el comprobante completo y el mensaje `invoice.issue` v2 en la
-- cola de integraciones. Esta migración pone lo que falta del lado de la base
-- para que un trabajador lo entregue a Nubefact (`invoicing-worker`):
--
--   1. Nubefact en el catálogo de emisores (`invoice.issue`, `invoice.read`).
--   2. Sus credenciales POR SOCIEDAD —cada sociedad emite con su RUC y su
--      cuenta—: la RUTA y el TOKEN van cifrados en Supabase Vault; la tabla
--      privada `ebim.invoicing_credentials` solo apunta al secreto. Las escribe
--      `invoicing_nubefact_configure` (owner/admin) y las lee ÚNICAMENTE
--      `invoicing_credentials_for`, que solo ejecuta `service_role`. El
--      navegador las escribe una vez y no las vuelve a ver: ve una pista.
--      Mismo patrón que la llave secreta de Culqi (20261113140000).
--   3. El resultado del emisor en el comprobante: estado, enlaces a PDF/XML/CDR,
--      respuesta de SUNAT, cadena del QR y hash (`invoice_record_provider_result`).
--   4. Cerrar sin reintento un mensaje que el emisor rechazó por DATOS
--      (`invoice_issue_give_up`): reintentar lo mismo no lo arregla.
--   5. Consultar los que el emisor recibió pero SUNAT aún no confirmó
--      (`invoice_awaiting_confirmation`): las boletas suelen ir por resumen.
--   6. El planificador: cada 2 minutos, solo si hay trabajo y solo si el
--      destino está en Vault (lo carga `scripts/configurar-facturacion.mjs`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Nubefact en el catálogo
-- ---------------------------------------------------------------------------
insert into public.integration_providers (code, kind, name, capabilities, is_active)
values ('nubefact', 'invoicing', 'Nubefact', array['invoice.issue', 'invoice.read'], true)
on conflict (code, kind) do update
  set name = excluded.name, capabilities = excluded.capabilities, is_active = true;

-- ---------------------------------------------------------------------------
-- 2 · Lo que el emisor devuelve, en el comprobante
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists pdf_url             text,
  add column if not exists xml_url             text,
  add column if not exists cdr_url             text,
  add column if not exists sunat_code          text,
  add column if not exists sunat_description   text,
  add column if not exists qr_string           text,
  add column if not exists hash_code           text,
  add column if not exists provider_checked_at timestamptz;

do $$ begin
  alter table public.invoices add constraint invoices_provider_urls check (
    (pdf_url is null or pdf_url ~ '^https://') and
    (xml_url is null or xml_url ~ '^https://') and
    (cdr_url is null or cdr_url ~ '^https://'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3 · Credenciales por sociedad (Vault)
-- ---------------------------------------------------------------------------
create table if not exists ebim.invoicing_credentials (
  tenant_integration_id uuid        primary key references public.tenant_integrations (id) on delete cascade,
  vault_secret_id       uuid        not null,
  updated_at            timestamptz not null default now()
);
revoke all on ebim.invoicing_credentials from public, anon, authenticated;

-- Al borrar la integración, su secreto sale de Vault.
create or replace function ebim.invoicing_credentials_drop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$fn$;
revoke execute on function ebim.invoicing_credentials_drop() from public, anon, authenticated;

drop trigger if exists invoicing_credentials_drop on ebim.invoicing_credentials;
create trigger invoicing_credentials_drop
  after delete on ebim.invoicing_credentials
  for each row execute function ebim.invoicing_credentials_drop();

-- RUTA de Nubefact: online (api.nubefact.com) o de un revendedor (*.pse.pe).
create or replace function ebim.nubefact_ruta_valida(p_ruta text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(p_ruta, '') ~ '^https://(api\.nubefact\.com|[a-z0-9-]+\.pse\.pe)/api/v1/[A-Za-z0-9-]{8,80}$'
$fn$;

create or replace function public.invoicing_nubefact_configure(
  p_store_id uuid,
  p_ruta     text,
  -- Vacío = conservar el token guardado (cambiar solo la ruta o activar/desactivar).
  p_token    text,
  p_active   boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store  public.stores%rowtype;
  v_ruta   text := btrim(coalesce(p_ruta, ''));
  v_token  text := nullif(btrim(coalesce(p_token, '')), '');
  v_ti     public.tenant_integrations%rowtype;
  v_vault  uuid;
  v_hint   text;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not ebim.can_access(v_store.organization_id, v_store.company_id) then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no es de esta sociedad' using errcode = '22023';
  end if;
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el operador de la suite no configura la facturacion de un tenant'
      using errcode = '42501';
  end if;
  if not ebim.has_role(v_store.organization_id, v_store.company_id, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: el emisor lo configura el propietario o un administrador' using errcode = '42501';
  end if;
  if not ebim.nubefact_ruta_valida(v_ruta) then
    raise exception 'RUTA_NO_VALIDA: la ruta de Nubefact es https://api.nubefact.com/api/v1/…' using errcode = '22023';
  end if;
  if v_token is not null and v_token !~ '^[A-Za-z0-9._-]{20,200}$' then
    raise exception 'TOKEN_NO_VALIDO: el token de Nubefact no tiene el formato esperado' using errcode = '22023';
  end if;

  insert into public.tenant_integrations (organization_id, company_id, provider_code, is_active, config)
  values (v_store.organization_id, v_store.company_id, 'nubefact', false, '{}'::jsonb)
  on conflict (organization_id, company_id, provider_code) do nothing;

  select * into v_ti from public.tenant_integrations t
   where t.organization_id = v_store.organization_id and t.company_id = v_store.company_id
     and t.provider_code = 'nubefact'
   for update;

  select c.vault_secret_id into v_vault from ebim.invoicing_credentials c where c.tenant_integration_id = v_ti.id;

  if v_token is null and v_vault is null then
    raise exception 'TOKEN_REQUERIDO: falta el token de Nubefact' using errcode = '22023';
  end if;

  if v_token is not null then
    v_hint := '…' || right(v_token, 4);
    if v_vault is null then
      v_vault := vault.create_secret(
        jsonb_build_object('ruta', v_ruta, 'token', v_token)::text,
        'invoicing_nubefact_' || v_ti.id::text,
        'Credenciales de Nubefact de la sociedad ' || v_store.company_id::text);
      insert into ebim.invoicing_credentials (tenant_integration_id, vault_secret_id) values (v_ti.id, v_vault);
    else
      perform vault.update_secret(v_vault, jsonb_build_object('ruta', v_ruta, 'token', v_token)::text);
      update ebim.invoicing_credentials set updated_at = now() where tenant_integration_id = v_ti.id;
    end if;
  else
    -- Solo cambia la ruta: se reescribe el secreto con el token que ya estaba.
    perform vault.update_secret(
      v_vault,
      jsonb_set((select d.decrypted_secret::jsonb from vault.decrypted_secrets d where d.id = v_vault),
                '{ruta}', to_jsonb(v_ruta))::text);
    v_hint := v_ti.config->>'token_hint';
  end if;

  update public.tenant_integrations
     set is_active = coalesce(p_active, false),
         config    = jsonb_build_object(
                       'ruta_hint',     regexp_replace(v_ruta, '/api/v1/.*$', '/api/v1/…') || right(v_ruta, 4),
                       'token_hint',    v_hint,
                       'configured_at', now())
   where id = v_ti.id;

  -- Con Nubefact activo, otro emisor activo dejaría la emisión «ambigua».
  if coalesce(p_active, false) then
    update public.tenant_integrations t
       set is_active = false
      from public.integration_providers p
     where p.code = t.provider_code and p.kind = 'invoicing'
       and t.organization_id = v_store.organization_id and t.company_id = v_store.company_id
       and t.provider_code <> 'nubefact' and t.is_active;
  end if;

  perform ebim.audit(
    p_organization_id => v_store.organization_id,
    p_company_id      => v_store.company_id,
    p_action          => 'invoicing.provider_configured',
    p_entity_type     => 'integration',
    p_entity_id       => v_ti.id,
    p_store_id        => v_store.id,
    -- Nunca el token: solo si cambió.
    p_changes         => jsonb_build_object('provider', 'nubefact', 'active', coalesce(p_active, false),
                                            'token_changed', v_token is not null));

  return jsonb_build_object('provider', 'nubefact', 'active', coalesce(p_active, false), 'token_hint', v_hint);
end;
$fn$;

revoke execute on function public.invoicing_nubefact_configure(uuid, text, text, boolean) from public, anon;
grant  execute on function public.invoicing_nubefact_configure(uuid, text, text, boolean) to authenticated;

-- Las credenciales para EMITIR. Solo el trabajador (service_role).
create or replace function public.invoicing_credentials_for(p_org uuid, p_company uuid, p_provider text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_vault uuid;
begin
  select c.vault_secret_id into v_vault
    from public.tenant_integrations t
    join ebim.invoicing_credentials c on c.tenant_integration_id = t.id
   where t.organization_id = p_org and t.company_id = p_company
     and t.provider_code = p_provider and t.is_active;
  if v_vault is null then return null; end if;
  return (select d.decrypted_secret::jsonb from vault.decrypted_secrets d where d.id = v_vault);
end;
$fn$;

revoke execute on function public.invoicing_credentials_for(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.invoicing_credentials_for(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4 · Registrar lo que respondió el emisor
-- ---------------------------------------------------------------------------
-- `p_result`: { status: 'accepted'|'issued'|'rejected', number?, document_ref?,
--   pdf_url?, xml_url?, cdr_url?, sunat_code?, sunat_description?, qr_string?,
--   hash_code?, detail? }. Lo arma `_shared/invoicing/nubefact.ts`.
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
  v_url    text;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'COMPROBANTE_NO_ENCONTRADO: no existe ese comprobante' using errcode = '22023';
  end if;
  if v_status not in ('accepted', 'issued', 'rejected') then
    raise exception 'RESULTADO_NO_VALIDO: estado %', v_status using errcode = '22023';
  end if;
  -- El número lo puso la base al encolar; el emisor no lo cambia.
  if p_result ? 'number' and v_inv.number is not null
     and ltrim(p_result->>'number', '0') <> ltrim(v_inv.number, '0') then
    raise exception 'NUMERO_DISTINTO: el emisor respondio % y el comprobante es %', p_result->>'number', v_inv.number
      using errcode = '22023';
  end if;
  -- Aceptado es final: una consulta posterior no lo cambia, y un comprobante
  -- aceptado no se edita (`invoice_guard`), ni siquiera la fecha de consulta.
  if v_inv.status = 'accepted' then
    return jsonb_build_object('invoice_id', v_inv.id, 'status', 'accepted', 'changed', false);
  end if;

  update public.invoices i set
    status              = v_status::public.invoice_status,
    issued_at           = case when v_inv.status = 'pending' then now() else i.issued_at end,
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

  return jsonb_build_object('invoice_id', v_inv.id, 'status', v_status,
                            'changed', v_status::public.invoice_status is distinct from v_inv.status);
end;
$fn$;

revoke execute on function public.invoice_record_provider_result(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.invoice_record_provider_result(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5 · Rechazo por DATOS: cerrar sin reintento
-- ---------------------------------------------------------------------------
create or replace function public.invoice_issue_give_up(p_outbox_id uuid, p_error text, p_status_code integer default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_row public.integration_outbox%rowtype;
  v_inv uuid;
begin
  update public.integration_outbox
     set status = 'dead', completed_at = now(), last_error = left(coalesce(p_error, ''), 2000)
   where id = p_outbox_id and status = 'in_flight' and operation = 'invoice.issue'
  returning * into v_row;
  if not found then
    raise exception 'MENSAJE_NO_EN_VUELO: % no estaba reclamado', p_outbox_id using errcode = '22023';
  end if;

  insert into public.integration_messages
    (organization_id, company_id, outbox_id, provider_code, operation, attempt,
     succeeded, error, target, status_code, correlation_id)
  values
    (v_row.organization_id, v_row.company_id, v_row.id, v_row.provider_code,
     v_row.operation, v_row.attempts, false, left(coalesce(p_error, ''), 2000),
     v_row.target, p_status_code, v_row.correlation_id);

  -- El comprobante sigue `pending` CON su número: corregido el dato, se
  -- reintenta el mismo número (`integration_retry`) y no queda un hueco.
  v_inv := nullif(v_row.payload->>'invoice_id', '')::uuid;
  if v_inv is not null then
    insert into public.invoice_events (organization_id, company_id, invoice_id, status, detail)
    values (v_row.organization_id, v_row.company_id, v_inv, 'pending',
            left('RECHAZADO_POR_EMISOR: ' || coalesce(p_error, ''), 500));

    perform ebim.record_ops_event(
      p_organization_id => v_row.organization_id,
      p_company_id      => v_row.company_id,
      p_kind            => 'integration_failed'::public.ops_event_kind,
      p_code            => 'COMPROBANTE_RECHAZADO_POR_EMISOR',
      p_dedupe_key      => 'invoice.issue.rejected:' || v_inv::text,
      p_severity        => 'warning'::public.ops_severity,
      p_message         => left('El emisor rechazo el comprobante: ' || coalesce(p_error, ''), 500),
      p_operation       => 'invoice.issue',
      p_entity_type     => 'invoice',
      p_entity_id       => v_inv);
  end if;
end;
$fn$;

revoke execute on function public.invoice_issue_give_up(uuid, text, integer) from public, anon, authenticated;
grant  execute on function public.invoice_issue_give_up(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6 · Recibidos por el emisor, sin confirmación de SUNAT todavía
-- ---------------------------------------------------------------------------
create or replace function public.invoice_awaiting_confirmation(p_provider text, p_limit integer default 20)
returns table (
  invoice_id      uuid,
  organization_id uuid,
  company_id      uuid,
  document_type   text,
  series          text,
  number          text
)
language sql
volatile
security definer
set search_path = ''
as $fn$
  with elegidos as (
    select i.id
      from public.invoices i
     where i.provider_code = p_provider
       and i.status = 'issued'
       and i.number is not null
       and i.issued_at > now() - interval '10 days'
       and (i.provider_checked_at is null or i.provider_checked_at < now() - interval '15 minutes')
       and not ebim.tenant_is_suspended(i.organization_id)
     order by i.provider_checked_at nulls first
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.invoices i
     set provider_checked_at = now()
    from elegidos e
   where i.id = e.id
  returning i.id, i.organization_id, i.company_id,
            coalesce(i.document_type, case when i.series like 'F%' then 'invoice' else 'receipt' end),
            i.series, i.number
$fn$;

revoke execute on function public.invoice_awaiting_confirmation(text, integer) from public, anon, authenticated;
grant  execute on function public.invoice_awaiting_confirmation(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7 · El planificador
-- ---------------------------------------------------------------------------
do $migracion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_cron, pg_net o Vault no disponibles: no se programa la emision';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net with schema extensions';

  perform cron.unschedule(jobid) from cron.job where jobname = 'ecommerce-invoicing-worker';
  perform cron.schedule(
    'ecommerce-invoicing-worker',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url     := url.decrypted_secret,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-ebim-worker-key', clave.decrypted_secret),
        body    := '{}'::jsonb,
        timeout_milliseconds := 30000)
      from vault.decrypted_secrets url
      join vault.decrypted_secrets clave on clave.name = 'invoicing_worker_key'
      where url.name = 'invoicing_worker_url'
        and (exists (select 1 from public.integration_outbox o
                      where o.status = 'pending' and o.operation = 'invoice.issue'
                        and o.provider_code = 'nubefact' and o.next_retry_at <= now())
             or exists (select 1 from public.invoices i
                         where i.status = 'issued' and i.provider_code = 'nubefact'
                           and i.issued_at > now() - interval '10 days'
                           and (i.provider_checked_at is null
                                or i.provider_checked_at < now() - interval '15 minutes')));
    $job$);
end
$migracion$;
