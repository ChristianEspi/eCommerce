-- =============================================================================
-- Fuentes de lectura: eCommerce consulta la API del ERP (2026-11-12).
--
-- Hasta hoy todo lo que entraba del exterior lo EMPUJABA el otro sistema (API
-- /v1, webhooks de pago y de transporte). Un ERP que solo expone su API y no
-- tiene a nadie que programe el envío se quedaba fuera. Esta migración es el
-- lado servidor del «conector de lectura» del Estándar de integración ERP §11:
--
--   · `connector_sources`  — a QUIÉN se consulta: URL base, cómo se autentica.
--   · `connector_feeds`    — QUÉ se trae de esa fuente y cada cuánto
--                            (stock por almacén, precios de una lista).
--   · `connector_runs`     — cada ejecución, con sus contadores.
--   · `connector_rejects`  — los registros que no entraron y por qué.
--
-- ## La credencial vive en Vault, no en una tabla
--
-- A diferencia de la API de socio —donde guardamos un hash porque solo hay que
-- COMPROBAR el secreto— aquí hay que ENVIARLO al ERP, así que tiene que poder
-- descifrarse. Supabase Vault lo guarda cifrado; la tabla privada
-- `ebim.connector_secrets` solo apunta a su id, y lo descifra únicamente
-- `connector_secret()`, que solo puede ejecutar `service_role`. El navegador
-- escribe el secreto una vez y no lo vuelve a ver.
--
-- ## Lo que entra pasa por las MISMAS puertas que el resto
--
--   · stock  → `public.sync_inventory_level` (saldo absoluto, asiento `count`,
--              idempotente). Solo almacenes cuyo sistema de registro es el ERP
--              (`source = 'erp'`): sobrescribir un almacén `local` borraría lo
--              que esta base decidió (ventas, reservas, ajustes).
--   · precios → `price_list_items` de UNA lista elegida por el tenant. Nunca
--              se borra un precio porque «no vino»: solo con `active: false`.
--
-- ## Seguridad de llamar hacia fuera
--
-- La URL de la fuente (y la del token OAuth) cumple el MISMO CHECK que los
-- webhooks: solo https y nunca direcciones privadas, de bucle local o de
-- enlace-local. Es defensa contra SSRF en la base; el trabajador lo vuelve a
-- comprobar y no sigue redirecciones.
--
-- ## De paso: el alta de webhooks desde la pantalla
--
-- La pantalla no manda el tenant (regla de suite: sale del JWT) y nada lo
-- rellenaba: «Nuevo destino» fallaba con 23502. `ebim.fill_tenant_from_jwt()`
-- lo completa SOLO cuando no viene; si viene, la RLS sigue comprobándolo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0 · Rellenar el tenant desde el JWT
-- ---------------------------------------------------------------------------
create or replace function ebim.fill_tenant_from_jwt()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.organization_id is null then
    new.organization_id := ebim.org_id();
  end if;
  if new.company_id is null then
    new.company_id := ebim.active_company();
  end if;
  return new;
end;
$fn$;

revoke execute on function ebim.fill_tenant_from_jwt() from public, anon;

-- `a_` para correr ANTES que `webhook_endpoints_enable_transport` (los BEFORE
-- de una tabla van por orden alfabético) y que ese ya vea el tenant.
drop trigger if exists webhook_endpoints_a_fill_tenant on public.webhook_endpoints;
create trigger webhook_endpoints_a_fill_tenant
  before insert on public.webhook_endpoints
  for each row execute function ebim.fill_tenant_from_jwt();

drop trigger if exists webhook_subscriptions_a_fill_tenant on public.webhook_subscriptions;
create trigger webhook_subscriptions_a_fill_tenant
  before insert on public.webhook_subscriptions
  for each row execute function ebim.fill_tenant_from_jwt();

-- ---------------------------------------------------------------------------
-- 1 · Fuentes
-- ---------------------------------------------------------------------------
create table public.connector_sources (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  name            text        not null,
  description     text,
  base_url        text        not null,
  -- none | api_key (cabecera propia) | bearer | basic | oauth2 (client_credentials)
  auth_type       text        not null default 'none',
  -- Nombre de la cabecera de `api_key` (p. ej. X-API-Key).
  auth_header     text,
  -- Usuario de `basic` o client_id de `oauth2`. No es el secreto.
  auth_username   text,
  oauth_token_url text,
  oauth_scope     text,
  timeout_seconds integer     not null default 20,
  is_active       boolean     not null default true,
  -- Lo mantiene `connector_source_set_secret`; nadie lo escribe a mano.
  has_secret      boolean     not null default false,
  secret_set_at   timestamptz,
  created_by      uuid        default ebim.user_id(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint connector_sources_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint connector_sources_description_len
    check (description is null or char_length(description) <= 500),
  constraint connector_sources_auth_type
    check (auth_type in ('none', 'api_key', 'bearer', 'basic', 'oauth2')),
  constraint connector_sources_url_https
    check (base_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(/[^\s?#]*)?$'),
  constraint connector_sources_url_public
    check (base_url !~* '^https://(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)'
       and base_url !~* '^https://[A-Za-z0-9.-]*\.(local|internal|localdomain)([:/]|$)'),
  constraint connector_sources_token_url_https
    check (oauth_token_url is null
       or oauth_token_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(/[^\s#]*)?$'),
  constraint connector_sources_token_url_public
    check (oauth_token_url is null
       or (oauth_token_url !~* '^https://(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)'
       and oauth_token_url !~* '^https://[A-Za-z0-9.-]*\.(local|internal|localdomain)([:/]|$)')),
  -- Nombre de cabecera HTTP válido, y nunca una que pise lo que pone el
  -- trabajador (Host, Content-Length…).
  constraint connector_sources_header_fmt
    check (auth_header is null
       or (auth_header ~ '^[A-Za-z][A-Za-z0-9-]{1,60}$'
           and lower(auth_header) not in ('host', 'content-length', 'content-type', 'cookie',
                                          'transfer-encoding', 'connection'))),
  constraint connector_sources_username_len
    check (auth_username is null or char_length(auth_username) between 1 and 200),
  constraint connector_sources_scope_len
    check (oauth_scope is null or char_length(oauth_scope) <= 300),
  constraint connector_sources_timeout check (timeout_seconds between 5 and 60),
  -- Cada tipo de autenticación con lo que necesita.
  constraint connector_sources_auth_shape check (
    case auth_type
      when 'api_key' then auth_header is not null
      when 'basic'   then auth_username is not null
      when 'oauth2'  then auth_username is not null and oauth_token_url is not null
      else true
    end),
  constraint connector_sources_name_unique unique (organization_id, company_id, name),
  constraint connector_sources_tenant_key  unique (id, organization_id, company_id)
);

create index connector_sources_tenant_idx on public.connector_sources (organization_id, company_id);

-- Puntero al secreto. Esquema privado: no lo expone PostgREST y no tiene
-- GRANT para nadie salvo las funciones definer de abajo.
create table ebim.connector_secrets (
  source_id       uuid        primary key references public.connector_sources (id) on delete cascade,
  vault_secret_id uuid        not null,
  updated_at      timestamptz not null default now()
);
revoke all on ebim.connector_secrets from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Flujos (qué se trae de cada fuente)
-- ---------------------------------------------------------------------------
create table public.connector_feeds (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null,
  company_id           uuid        not null,
  source_id            uuid        not null,
  resource             text        not null,
  -- Ruta relativa a la URL base (p. ej. /ebim/v1/stock).
  path                 text        not null,
  interval_minutes     integer     not null default 60,
  page_size            integer     not null default 200,
  -- prices: la lista donde se escriben. stock: almacén para registros sin
  -- `warehouse`.
  price_list_id        uuid,
  default_warehouse_id uuid,
  is_active            boolean     not null default true,
  -- Estado del trabajador. Solo lo escribe el servidor.
  watermark            timestamptz,
  next_run_at          timestamptz not null default now(),
  run_requested        boolean     not null default false,
  lease_until          timestamptz,
  consecutive_failures integer     not null default 0,
  last_run_at          timestamptz,
  last_status          text,
  last_error_code      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint connector_feeds_resource check (resource in ('stock', 'prices')),
  constraint connector_feeds_path_fmt
    check (char_length(path) <= 300 and path ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$'),
  constraint connector_feeds_interval check (interval_minutes between 5 and 1440),
  constraint connector_feeds_page_size check (page_size between 1 and 1000),
  constraint connector_feeds_status
    check (last_status is null or last_status in ('succeeded', 'partial', 'failed')),
  constraint connector_feeds_target check (
    case resource
      when 'prices' then price_list_id is not null and default_warehouse_id is null
      when 'stock'  then price_list_id is null
      else false
    end),
  constraint connector_feeds_unique unique (source_id, resource, path),
  constraint connector_feeds_tenant_key unique (id, organization_id, company_id),
  constraint connector_feeds_source_fk foreign key (source_id, organization_id, company_id)
    references public.connector_sources (id, organization_id, company_id) on delete cascade,
  constraint connector_feeds_price_list_fk foreign key (price_list_id, organization_id, company_id)
    references public.price_lists (id, organization_id, company_id) on delete cascade,
  constraint connector_feeds_warehouse_fk foreign key (default_warehouse_id, organization_id, company_id)
    references public.warehouses (id, organization_id, company_id) on delete set null
);

create index connector_feeds_tenant_idx on public.connector_feeds (organization_id, company_id);
create index connector_feeds_due_idx on public.connector_feeds (next_run_at) where is_active;

-- El almacén por defecto tiene que ser del ERP: es el único que se puede
-- sobrescribir desde fuera sin borrar lo que decidió esta base.
create or replace function ebim.connector_feed_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.default_warehouse_id is not null and not exists (
    select 1 from public.warehouses w
     where w.id = new.default_warehouse_id and w.source = 'erp'
  ) then
    raise exception 'ALMACEN_NO_ERP: el almacen por defecto tiene que tener como sistema de registro el ERP'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;
revoke execute on function ebim.connector_feed_validate() from public, anon, authenticated;

create trigger connector_feeds_validate
  before insert or update of default_warehouse_id on public.connector_feeds
  for each row execute function ebim.connector_feed_validate();

-- ---------------------------------------------------------------------------
-- 3 · Ejecuciones y rechazados
-- ---------------------------------------------------------------------------
create table public.connector_runs (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  feed_id         uuid        not null,
  trigger         text        not null default 'schedule',
  status          text        not null default 'running',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  pages           integer     not null default 0,
  received        integer     not null default 0,
  applied         integer     not null default 0,
  unchanged       integer     not null default 0,
  rejected        integer     not null default 0,
  watermark_after timestamptz,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  constraint connector_runs_trigger check (trigger in ('schedule', 'manual')),
  constraint connector_runs_status
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  constraint connector_runs_error_len check (error_message is null or char_length(error_message) <= 500),
  constraint connector_runs_tenant_key unique (id, organization_id, company_id),
  constraint connector_runs_feed_fk foreign key (feed_id, organization_id, company_id)
    references public.connector_feeds (id, organization_id, company_id) on delete cascade
);

create index connector_runs_feed_idx on public.connector_runs (feed_id, started_at desc);
create index connector_runs_tenant_idx on public.connector_runs (organization_id, company_id);

create table public.connector_rejects (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  run_id          uuid        not null,
  row_index       integer     not null,
  sku             text,
  reason          text        not null,
  detail          text,
  created_at      timestamptz not null default now(),
  constraint connector_rejects_detail_len check (detail is null or char_length(detail) <= 300),
  constraint connector_rejects_run_fk foreign key (run_id, organization_id, company_id)
    references public.connector_runs (id, organization_id, company_id) on delete cascade
);

create index connector_rejects_run_idx on public.connector_rejects (run_id, row_index);
create index connector_rejects_tenant_idx on public.connector_rejects (organization_id, company_id);

-- ---------------------------------------------------------------------------
-- 4 · RLS — default deny; leer cualquier miembro, escribir owner/admin + módulo
-- ---------------------------------------------------------------------------
alter table public.connector_sources enable row level security;
alter table public.connector_sources force  row level security;
alter table public.connector_feeds   enable row level security;
alter table public.connector_feeds   force  row level security;
alter table public.connector_runs    enable row level security;
alter table public.connector_runs    force  row level security;
alter table public.connector_rejects enable row level security;
alter table public.connector_rejects force  row level security;

revoke all on public.connector_sources, public.connector_feeds,
              public.connector_runs, public.connector_rejects
  from public, anon, authenticated;
grant all on public.connector_sources, public.connector_feeds,
             public.connector_runs, public.connector_rejects
  to service_role;

grant select on public.connector_sources, public.connector_feeds,
                public.connector_runs, public.connector_rejects
  to authenticated;

-- Escritura POR COLUMNA: el estado del trabajador (marca de agua, lease,
-- fallos) y `has_secret` no se escriben desde el navegador.
grant insert (organization_id, company_id, name, description, base_url, auth_type, auth_header,
              auth_username, oauth_token_url, oauth_scope, timeout_seconds, is_active)
  on public.connector_sources to authenticated;
grant update (name, description, base_url, auth_type, auth_header, auth_username,
              oauth_token_url, oauth_scope, timeout_seconds, is_active)
  on public.connector_sources to authenticated;
grant delete on public.connector_sources to authenticated;

grant insert (organization_id, company_id, source_id, resource, path, interval_minutes,
              page_size, price_list_id, default_warehouse_id, is_active)
  on public.connector_feeds to authenticated;
grant update (path, interval_minutes, page_size, price_list_id, default_warehouse_id, is_active)
  on public.connector_feeds to authenticated;
grant delete on public.connector_feeds to authenticated;

create policy connector_sources_select_member on public.connector_sources
  for select to authenticated
  using (organization_id = (select ebim.org_id()) and company_id = any ((select ebim.member_companies())::uuid[]));
create policy connector_sources_insert_admin on public.connector_sources
  for insert to authenticated
  with check ((organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[]))
              and ebim.has_capability(organization_id, company_id, 'integrations.enterprise'));
create policy connector_sources_update_admin on public.connector_sources
  for update to authenticated
  using      ((organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[]))
              and ebim.has_capability(organization_id, company_id, 'integrations.enterprise'))
  with check ((organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[]))
              and ebim.has_capability(organization_id, company_id, 'integrations.enterprise'));
create policy connector_sources_delete_admin on public.connector_sources
  for delete to authenticated
  using ((organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[])));

create policy connector_feeds_select_member on public.connector_feeds
  for select to authenticated
  using (organization_id = (select ebim.org_id()) and company_id = any ((select ebim.member_companies())::uuid[]));
create policy connector_feeds_insert_admin on public.connector_feeds
  for insert to authenticated
  with check ((organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[]))
              and ebim.has_capability(organization_id, company_id, 'integrations.enterprise'));
create policy connector_feeds_update_admin on public.connector_feeds
  for update to authenticated
  using      ((organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[]))
              and ebim.has_capability(organization_id, company_id, 'integrations.enterprise'))
  with check ((organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[]))
              and ebim.has_capability(organization_id, company_id, 'integrations.enterprise'));
create policy connector_feeds_delete_admin on public.connector_feeds
  for delete to authenticated
  using ((organization_id = (select ebim.org_id()) and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[])));

create policy connector_runs_select_member on public.connector_runs
  for select to authenticated
  using (organization_id = (select ebim.org_id()) and company_id = any ((select ebim.member_companies())::uuid[]));
create policy connector_rejects_select_member on public.connector_rejects
  for select to authenticated
  using (organization_id = (select ebim.org_id()) and company_id = any ((select ebim.member_companies())::uuid[]));

create trigger connector_sources_a_fill_tenant before insert on public.connector_sources
  for each row execute function ebim.fill_tenant_from_jwt();
create trigger connector_feeds_a_fill_tenant before insert on public.connector_feeds
  for each row execute function ebim.fill_tenant_from_jwt();
create trigger connector_sources_updated_at before update on public.connector_sources
  for each row execute function ebim.set_updated_at();
create trigger connector_feeds_updated_at before update on public.connector_feeds
  for each row execute function ebim.set_updated_at();

create trigger connector_sources_audit
  after insert or update or delete on public.connector_sources
  for each row execute function ebim.audit_row('connector_source', 'name');
create trigger connector_feeds_audit
  after insert or update or delete on public.connector_feeds
  for each row execute function ebim.audit_row('connector_feed', 'resource');

-- Al borrar la fuente, su secreto sale de Vault (no se deja huérfano).
create or replace function ebim.connector_source_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vault uuid;
begin
  select s.vault_secret_id into v_vault from ebim.connector_secrets s where s.source_id = old.id;
  if v_vault is not null then
    delete from vault.secrets where id = v_vault;
  end if;
  return old;
end;
$fn$;
revoke execute on function ebim.connector_source_drop_secret() from public, anon, authenticated;

create trigger connector_sources_drop_secret
  before delete on public.connector_sources
  for each row execute function ebim.connector_source_drop_secret();

-- ---------------------------------------------------------------------------
-- 5 · Acciones del backoffice (owner/admin + módulo)
-- ---------------------------------------------------------------------------
create or replace function ebim.connector_assert_admin(p_org uuid, p_company uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not ebim.has_role(p_org, p_company, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: las fuentes las gestiona el propietario o un administrador'
      using errcode = '42501';
  end if;
  if not ebim.has_capability(p_org, p_company, 'integrations.enterprise') then
    raise exception 'SIN_MODULO: las integraciones empresariales no estan activas para esta sociedad'
      using errcode = '42501';
  end if;
end;
$fn$;
revoke execute on function ebim.connector_assert_admin(uuid, uuid) from public, anon;
grant  execute on function ebim.connector_assert_admin(uuid, uuid) to authenticated, service_role;

/** Guarda (o borra, con vacío) la credencial de la fuente en Vault. */
create or replace function public.connector_source_set_secret(p_source_id uuid, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_source public.connector_sources%rowtype;
  v_vault  uuid;
  v_secret text := nullif(btrim(coalesce(p_secret, '')), '');
begin
  select * into v_source from public.connector_sources s where s.id = p_source_id;
  if not found or not ebim.can_access(v_source.organization_id, v_source.company_id) then
    raise exception 'FUENTE_NO_ENCONTRADA: %', p_source_id using errcode = '22023';
  end if;
  perform ebim.connector_assert_admin(v_source.organization_id, v_source.company_id);

  if v_secret is not null and char_length(v_secret) > 4000 then
    raise exception 'DATOS_INVALIDOS: la credencial es demasiado larga' using errcode = '22023';
  end if;

  select s.vault_secret_id into v_vault from ebim.connector_secrets s where s.source_id = p_source_id;

  if v_secret is null then
    if v_vault is not null then
      delete from vault.secrets where id = v_vault;
      delete from ebim.connector_secrets where source_id = p_source_id;
    end if;
    update public.connector_sources set has_secret = false, secret_set_at = null where id = p_source_id;
    return jsonb_build_object('has_secret', false);
  end if;

  if v_vault is null then
    v_vault := vault.create_secret(v_secret, 'connector_source_' || p_source_id::text,
                                   'Credencial de la fuente de lectura ' || p_source_id::text);
    insert into ebim.connector_secrets (source_id, vault_secret_id) values (p_source_id, v_vault);
  else
    perform vault.update_secret(v_vault, v_secret);
    update ebim.connector_secrets set updated_at = now() where source_id = p_source_id;
  end if;

  update public.connector_sources set has_secret = true, secret_set_at = now() where id = p_source_id;
  return jsonb_build_object('has_secret', true);
end;
$fn$;
revoke execute on function public.connector_source_set_secret(uuid, text) from public, anon;
grant  execute on function public.connector_source_set_secret(uuid, text) to authenticated;

/** «Sincronizar ahora» (y, con p_full, desde cero: sin marca de agua). */
create or replace function public.connector_feed_run_now(p_feed_id uuid, p_full boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_feed public.connector_feeds%rowtype;
begin
  select * into v_feed from public.connector_feeds f where f.id = p_feed_id;
  if not found or not ebim.can_access(v_feed.organization_id, v_feed.company_id) then
    raise exception 'FLUJO_NO_ENCONTRADO: %', p_feed_id using errcode = '22023';
  end if;
  perform ebim.connector_assert_admin(v_feed.organization_id, v_feed.company_id);

  update public.connector_feeds
     set next_run_at   = now(),
         run_requested = true,
         watermark     = case when coalesce(p_full, false) then null else watermark end
   where id = p_feed_id;
end;
$fn$;
revoke execute on function public.connector_feed_run_now(uuid, boolean) from public, anon;
grant  execute on function public.connector_feed_run_now(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6 · El trabajador (service_role y solo service_role)
-- ---------------------------------------------------------------------------

/** Número de un JSON (número o texto numérico). NULL si no lo es. */
create or replace function ebim.connector_num(p_value jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then null
    when jsonb_typeof(p_value) = 'number' then (p_value #>> '{}')::numeric
    when jsonb_typeof(p_value) = 'string'
         and btrim(p_value #>> '{}') ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$'
      then btrim(p_value #>> '{}')::numeric
    else null
  end;
$fn$;

/** Fecha ISO 8601 de un JSON. NULL si no viene o no se entiende. */
create or replace function ebim.connector_ts(p_value jsonb)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string'
     or (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    return null;
  end if;
  return (p_value #>> '{}')::timestamptz;
exception when others then
  return null;
end;
$fn$;

/**
 * SKU → producto/variante dentro de la sociedad (y de la tienda, si se pide).
 * Primero variante (su SKU es el más concreto), luego producto.
 */
create or replace function ebim.connector_resolve_sku(
  p_org uuid, p_company uuid, p_sku text, p_store_id uuid default null
)
returns table (product_id uuid, variant_id uuid, kind text)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_sku   text := lower(btrim(coalesce(p_sku, '')));
  v_count integer;
begin
  if v_sku = '' then return; end if;

  select count(*) into v_count
    from public.product_variants v
   where v.organization_id = p_org and v.company_id = p_company
     and lower(btrim(v.sku)) = v_sku
     and (p_store_id is null or v.store_id = p_store_id);
  if v_count > 1 then
    raise exception 'SKU_AMBIGUO: % aparece en mas de una variante', p_sku using errcode = '22023';
  end if;
  if v_count = 1 then
    return query
      select v.product_id, v.id, 'variant'::text
        from public.product_variants v
       where v.organization_id = p_org and v.company_id = p_company
         and lower(btrim(v.sku)) = v_sku
         and (p_store_id is null or v.store_id = p_store_id);
    return;
  end if;

  select count(*) into v_count
    from public.products p
   where p.organization_id = p_org and p.company_id = p_company
     and lower(btrim(p.sku)) = v_sku
     and (p_store_id is null or p.store_id = p_store_id);
  if v_count > 1 then
    raise exception 'SKU_AMBIGUO: % aparece en mas de un producto', p_sku using errcode = '22023';
  end if;
  return query
    select p.id, null::uuid, p.kind::text
      from public.products p
     where p.organization_id = p_org and p.company_id = p_company
       and lower(btrim(p.sku)) = v_sku
       and (p_store_id is null or p.store_id = p_store_id);
end;
$fn$;

/** Código de error de negocio desde SQLERRM («CODIGO: detalle» → CODIGO). */
create or replace function ebim.connector_error_code(p_message text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(substring(coalesce(p_message, '') from '^([A-Z][A-Z0-9_]{2,40}):'), 'REGISTRO_INVALIDO');
$fn$;

create or replace function ebim.connector_reject(
  p_run public.connector_runs, p_index integer, p_sku text, p_reason text, p_detail text
)
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  -- Los primeros 200 de cada ejecución con detalle; el resto solo cuenta.
  if (select count(*) from public.connector_rejects r where r.run_id = p_run.id) < 200 then
    insert into public.connector_rejects (organization_id, company_id, run_id, row_index, sku, reason, detail)
    values (p_run.organization_id, p_run.company_id, p_run.id, p_index,
            left(p_sku, 120), p_reason, left(p_detail, 300));
  end if;
end;
$fn$;

/**
 * Reclama los flujos que tocan. Cada uno sale con su ejecución abierta y una
 * concesión de 15 minutos: si el trabajador muere, la siguiente reclamación
 * cierra esa ejecución como fallida y lo vuelve a intentar.
 */
create or replace function public.connector_claim(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_out  jsonb := '[]'::jsonb;
  v_feed record;
  v_run  uuid;
begin
  -- Concesiones vencidas: la ejecución que quedó colgada se cierra.
  update public.connector_runs r
     set status = 'failed', finished_at = now(), error_code = 'CONCESION_VENCIDA',
         error_message = 'El trabajador no cerro la ejecucion a tiempo'
   where r.status = 'running'
     and exists (select 1 from public.connector_feeds f
                  where f.id = r.feed_id and f.lease_until is not null and f.lease_until < now());

  for v_feed in
    select f.*, s.base_url, s.auth_type, s.auth_header, s.auth_username, s.oauth_token_url,
           s.oauth_scope, s.timeout_seconds, s.has_secret
      from public.connector_feeds f
      join public.connector_sources s on s.id = f.source_id
     where f.is_active and s.is_active
       and f.next_run_at <= now()
       and (f.lease_until is null or f.lease_until < now())
       and ebim.company_is_entitled(f.organization_id, f.company_id, 'integrations.enterprise')
     order by f.next_run_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update of f skip locked
  loop
    insert into public.connector_runs (organization_id, company_id, feed_id, trigger)
    values (v_feed.organization_id, v_feed.company_id, v_feed.id,
            case when v_feed.run_requested then 'manual' else 'schedule' end)
    returning id into v_run;

    update public.connector_feeds
       set lease_until = now() + interval '15 minutes', run_requested = false
     where id = v_feed.id;

    v_out := v_out || jsonb_build_object(
      'run_id',    v_run,
      'feed', jsonb_build_object(
        'id', v_feed.id, 'resource', v_feed.resource, 'path', v_feed.path,
        'page_size', v_feed.page_size, 'watermark', v_feed.watermark),
      'source', jsonb_build_object(
        'id', v_feed.source_id, 'base_url', v_feed.base_url, 'auth_type', v_feed.auth_type,
        'auth_header', v_feed.auth_header, 'auth_username', v_feed.auth_username,
        'oauth_token_url', v_feed.oauth_token_url, 'oauth_scope', v_feed.oauth_scope,
        'timeout_seconds', v_feed.timeout_seconds, 'has_secret', v_feed.has_secret));
  end loop;

  return v_out;
end;
$fn$;
revoke execute on function public.connector_claim(integer) from public, anon, authenticated;
grant  execute on function public.connector_claim(integer) to service_role;

/** La credencial descifrada. Solo el trabajador. */
create or replace function public.connector_secret(p_source_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_vault  uuid;
  v_secret text;
begin
  select s.vault_secret_id into v_vault from ebim.connector_secrets s where s.source_id = p_source_id;
  if v_vault is null then return null; end if;
  select d.decrypted_secret into v_secret from vault.decrypted_secrets d where d.id = v_vault;
  return v_secret;
end;
$fn$;
revoke execute on function public.connector_secret(uuid) from public, anon, authenticated;
grant  execute on function public.connector_secret(uuid) to service_role;

/**
 * Una página de STOCK. Registro canónico:
 *   { "sku": "...", "warehouse": "<código>", "on_hand": "12", "updated_at": "..." }
 */
create or replace function public.connector_apply_stock(p_run_id uuid, p_rows jsonb, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_run       public.connector_runs%rowtype;
  v_feed      public.connector_feeds%rowtype;
  v_row       jsonb;
  v_i         integer := 0;
  v_sku       text;
  v_wh_code   text;
  v_wh        public.warehouses%rowtype;
  v_qty       numeric;
  v_ts        timestamptz;
  v_max_ts    timestamptz;
  v_item      record;
  v_result    jsonb;
  v_applied   integer := 0;
  v_unchanged integer := 0;
  v_rejected  integer := 0;
begin
  select * into v_run from public.connector_runs r where r.id = p_run_id and r.status = 'running';
  if not found then
    raise exception 'EJECUCION_NO_ABIERTA: %', p_run_id using errcode = '22023';
  end if;
  select * into v_feed from public.connector_feeds f where f.id = v_run.feed_id;
  if v_feed.resource <> 'stock' then
    raise exception 'FLUJO_INCORRECTO: este flujo no es de stock' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'FORMATO_INVALIDO: data tiene que ser una lista' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_sku := null;
    begin
      if jsonb_typeof(v_row) <> 'object' then
        raise exception 'REGISTRO_INVALIDO: cada registro tiene que ser un objeto';
      end if;
      v_sku := nullif(btrim(coalesce(v_row ->> 'sku', '')), '');
      if v_sku is null then
        raise exception 'SKU_REQUERIDO: falta sku';
      end if;

      v_qty := ebim.connector_num(v_row -> 'on_hand');
      if v_qty is null or v_qty < 0 then
        raise exception 'CANTIDAD_INVALIDA: on_hand tiene que ser un numero mayor o igual a cero';
      end if;

      v_wh_code := nullif(btrim(coalesce(v_row ->> 'warehouse', '')), '');
      if v_wh_code is null then
        if v_feed.default_warehouse_id is null then
          raise exception 'ALMACEN_REQUERIDO: el registro no trae warehouse y el flujo no tiene almacen por defecto';
        end if;
        select * into v_wh from public.warehouses w where w.id = v_feed.default_warehouse_id;
      else
        select * into v_wh from public.warehouses w
         where w.organization_id = v_run.organization_id and w.company_id = v_run.company_id
           and lower(w.code) = lower(v_wh_code);
        if not found then
          raise exception 'ALMACEN_NO_ENCONTRADO: no hay almacen con codigo %', v_wh_code;
        end if;
      end if;
      if v_wh.source <> 'erp' then
        raise exception 'ALMACEN_NO_ERP: el almacen % lo gestiona esta tienda, no el ERP', v_wh.code;
      end if;

      select * into v_item from ebim.connector_resolve_sku(v_run.organization_id, v_run.company_id, v_sku);
      if v_item.product_id is null then
        raise exception 'SKU_NO_ENCONTRADO: % no existe en el catalogo', v_sku;
      end if;

      v_result := public.sync_inventory_level(
        v_wh.id, v_item.product_id, v_item.variant_id, v_qty,
        'pull:' || v_run.id::text || ':' || coalesce(v_item.variant_id, v_item.product_id)::text,
        'sincronizacion de la fuente de lectura');

      if coalesce((v_result ->> 'applied')::boolean, false) then
        v_applied := v_applied + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;

      v_ts := ebim.connector_ts(v_row -> 'updated_at');
      if v_ts is not null and (v_max_ts is null or v_ts > v_max_ts) then v_max_ts := v_ts; end if;
    exception when others then
      v_rejected := v_rejected + 1;
      perform ebim.connector_reject(v_run, coalesce(p_offset, 0) + v_i, v_sku,
                                    ebim.connector_error_code(sqlerrm), sqlerrm);
    end;
  end loop;

  update public.connector_runs
     set received = received + v_i, applied = applied + v_applied,
         unchanged = unchanged + v_unchanged, rejected = rejected + v_rejected,
         pages = pages + 1
   where id = v_run.id;

  return jsonb_build_object('received', v_i, 'applied', v_applied, 'unchanged', v_unchanged,
                            'rejected', v_rejected, 'max_updated_at', v_max_ts);
end;
$fn$;
revoke execute on function public.connector_apply_stock(uuid, jsonb, integer) from public, anon, authenticated;
grant  execute on function public.connector_apply_stock(uuid, jsonb, integer) to service_role;

/**
 * Una página de PRECIOS hacia la lista del flujo. Registro canónico:
 *   { "sku": "...", "price": "19.90", "currency": "PEN", "min_quantity": 1,
 *     "compare_at_price": "24.90", "active": true, "updated_at": "..." }
 */
create or replace function public.connector_apply_prices(p_run_id uuid, p_rows jsonb, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_run       public.connector_runs%rowtype;
  v_feed      public.connector_feeds%rowtype;
  v_list      public.price_lists%rowtype;
  v_row       jsonb;
  v_i         integer := 0;
  v_sku       text;
  v_price     numeric;
  v_compare   numeric;
  v_min       numeric;
  v_currency  text;
  v_active    boolean;
  v_ts        timestamptz;
  v_max_ts    timestamptz;
  v_item      record;
  v_existing  public.price_list_items%rowtype;
  v_applied   integer := 0;
  v_unchanged integer := 0;
  v_rejected  integer := 0;
begin
  select * into v_run from public.connector_runs r where r.id = p_run_id and r.status = 'running';
  if not found then
    raise exception 'EJECUCION_NO_ABIERTA: %', p_run_id using errcode = '22023';
  end if;
  select * into v_feed from public.connector_feeds f where f.id = v_run.feed_id;
  if v_feed.resource <> 'prices' then
    raise exception 'FLUJO_INCORRECTO: este flujo no es de precios' using errcode = '22023';
  end if;
  select * into v_list from public.price_lists l where l.id = v_feed.price_list_id;
  if not found then
    raise exception 'LISTA_NO_ENCONTRADA: el flujo no tiene lista de precios' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'FORMATO_INVALIDO: data tiene que ser una lista' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_sku := null;
    begin
      if jsonb_typeof(v_row) <> 'object' then
        raise exception 'REGISTRO_INVALIDO: cada registro tiene que ser un objeto';
      end if;
      v_sku := nullif(btrim(coalesce(v_row ->> 'sku', '')), '');
      if v_sku is null then
        raise exception 'SKU_REQUERIDO: falta sku';
      end if;

      v_currency := upper(nullif(btrim(coalesce(v_row ->> 'currency', '')), ''));
      if v_currency is not null and v_currency <> v_list.currency then
        raise exception 'MONEDA_DISTINTA: la lista es en % y el registro en %', v_list.currency, v_currency;
      end if;

      v_min := coalesce(ebim.connector_num(v_row -> 'min_quantity'), 1);
      if v_min <= 0 then
        raise exception 'CANTIDAD_INVALIDA: min_quantity tiene que ser mayor que cero';
      end if;

      v_active := case jsonb_typeof(v_row -> 'active') when 'boolean' then (v_row ->> 'active')::boolean else true end;

      select * into v_item
        from ebim.connector_resolve_sku(v_run.organization_id, v_run.company_id, v_sku, v_list.store_id);
      if v_item.product_id is null then
        raise exception 'SKU_NO_ENCONTRADO: % no existe en la tienda de la lista', v_sku;
      end if;

      select * into v_existing from public.price_list_items it
       where it.price_list_id = v_list.id and it.product_id = v_item.product_id
         and it.variant_id is not distinct from v_item.variant_id
         and it.uom_id is null and it.min_quantity = v_min;

      if not v_active then
        if v_existing.id is not null then
          delete from public.price_list_items where id = v_existing.id;
          v_applied := v_applied + 1;
        else
          v_unchanged := v_unchanged + 1;
        end if;
      else
        v_price := ebim.connector_num(v_row -> 'price');
        if v_price is null or v_price < 0 then
          raise exception 'PRECIO_INVALIDO: price tiene que ser un importe mayor o igual a cero';
        end if;
        v_compare := ebim.connector_num(v_row -> 'compare_at_price');
        if v_compare is not null and v_compare < v_price then
          raise exception 'PRECIO_INVALIDO: compare_at_price no puede ser menor que price';
        end if;
        v_price := round(v_price, 2);
        v_compare := round(v_compare, 2);

        if v_existing.id is null then
          insert into public.price_list_items (
            organization_id, company_id, store_id, price_list_id, product_id, variant_id,
            min_quantity, unit_price, compare_at_price)
          values (v_list.organization_id, v_list.company_id, v_list.store_id, v_list.id,
                  v_item.product_id, v_item.variant_id, v_min, v_price, v_compare);
          v_applied := v_applied + 1;
        elsif v_existing.unit_price = v_price
              and v_existing.compare_at_price is not distinct from v_compare then
          v_unchanged := v_unchanged + 1;
        else
          update public.price_list_items
             set unit_price = v_price, compare_at_price = v_compare
           where id = v_existing.id;
          v_applied := v_applied + 1;
        end if;
      end if;

      v_ts := ebim.connector_ts(v_row -> 'updated_at');
      if v_ts is not null and (v_max_ts is null or v_ts > v_max_ts) then v_max_ts := v_ts; end if;
    exception when others then
      v_rejected := v_rejected + 1;
      perform ebim.connector_reject(v_run, coalesce(p_offset, 0) + v_i, v_sku,
                                    ebim.connector_error_code(sqlerrm), sqlerrm);
    end;
  end loop;

  update public.connector_runs
     set received = received + v_i, applied = applied + v_applied,
         unchanged = unchanged + v_unchanged, rejected = rejected + v_rejected,
         pages = pages + 1
   where id = v_run.id;

  return jsonb_build_object('received', v_i, 'applied', v_applied, 'unchanged', v_unchanged,
                            'rejected', v_rejected, 'max_updated_at', v_max_ts);
end;
$fn$;
revoke execute on function public.connector_apply_prices(uuid, jsonb, integer) from public, anon, authenticated;
grant  execute on function public.connector_apply_prices(uuid, jsonb, integer) to service_role;

/**
 * Cierra la ejecución y programa la siguiente. Con fallo, reintento con
 * espera creciente (5, 10, 20… min) sin pasar del intervalo del flujo.
 * La marca de agua solo avanza si la ejecución NO falló.
 */
create or replace function public.connector_finish(
  p_run_id        uuid,
  p_status        text,
  p_watermark     timestamptz default null,
  p_error_code    text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_run      public.connector_runs%rowtype;
  v_feed     public.connector_feeds%rowtype;
  v_status   text := p_status;
  v_failures integer;
begin
  select * into v_run from public.connector_runs r where r.id = p_run_id for update;
  if not found then
    raise exception 'EJECUCION_NO_ENCONTRADA: %', p_run_id using errcode = '22023';
  end if;
  if v_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'DATOS_INVALIDOS: estado %', v_status using errcode = '22023';
  end if;
  if v_status = 'succeeded' and v_run.rejected > 0 then v_status := 'partial'; end if;

  select * into v_feed from public.connector_feeds f where f.id = v_run.feed_id for update;
  v_failures := case when v_status = 'failed' then v_feed.consecutive_failures + 1 else 0 end;

  update public.connector_runs
     set status = v_status, finished_at = now(),
         watermark_after = case when v_status <> 'failed' then p_watermark end,
         error_code = left(p_error_code, 60), error_message = left(p_error_message, 500)
   where id = p_run_id;

  update public.connector_feeds
     set lease_until = null,
         last_run_at = now(),
         last_status = v_status,
         last_error_code = case when v_status = 'failed' then left(p_error_code, 60) end,
         consecutive_failures = v_failures,
         watermark = case
           when v_status <> 'failed' and p_watermark is not null
             then greatest(coalesce(watermark, p_watermark), p_watermark)
           else watermark end,
         next_run_at = now() + case
           when v_status = 'failed'
             then make_interval(mins => least(interval_minutes, 5 * (2 ^ least(v_failures - 1, 8))::integer))
           else make_interval(mins => interval_minutes) end
   where id = v_feed.id;

  -- Historial acotado: 30 días por flujo.
  delete from public.connector_runs
   where feed_id = v_feed.id and started_at < now() - interval '30 days';
end;
$fn$;
revoke execute on function public.connector_finish(uuid, text, timestamptz, text, text) from public, anon, authenticated;
grant  execute on function public.connector_finish(uuid, text, timestamptz, text, text) to service_role;

revoke execute on function ebim.connector_num(jsonb) from public, anon;
revoke execute on function ebim.connector_ts(jsonb) from public, anon;
revoke execute on function ebim.connector_resolve_sku(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function ebim.connector_error_code(text) from public, anon;
revoke execute on function ebim.connector_reject(public.connector_runs, integer, text, text, text) from public, anon, authenticated;

comment on table public.connector_sources is
  'Fuente de lectura (API del ERP que eCommerce consulta). Solo https publico; la credencial vive en Vault.';
comment on table public.connector_feeds is
  'Que se trae de una fuente (stock por almacen ERP, precios de una lista) y cada cuanto. El estado del trabajador no lo escribe el navegador.';
comment on function public.connector_secret(uuid) is
  'Credencial descifrada de la fuente. Solo service_role (el trabajador connector-pull).';

-- ---------------------------------------------------------------------------
-- 7 · Programación: cada minuto, si hay flujos que tocan
--
-- Igual que el envío de correo: la URL y la clave del trabajador están en
-- Vault (`connector_pull_url`, `connector_pull_key`); sin ellas no se llama a
-- nada. En la base de pruebas no hay pg_cron ni Vault: no se programa.
-- ---------------------------------------------------------------------------
do $migracion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_cron, pg_net o Vault no disponibles: no se programa connector-pull';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net with schema extensions';

  if exists (select 1 from cron.job where jobname = 'ecommerce-connector-pull') then
    perform cron.unschedule('ecommerce-connector-pull');
  end if;

  perform cron.schedule(
    'ecommerce-connector-pull',
    '* * * * *',
    $trabajo$
      select net.http_post(
        url     := url.decrypted_secret,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-ebim-worker-key', clave.decrypted_secret),
        body    := '{}'::jsonb,
        timeout_milliseconds := 5000)
      from vault.decrypted_secrets url
      join vault.decrypted_secrets clave on clave.name = 'connector_pull_key'
      where url.name = 'connector_pull_url'
        and exists (
          select 1 from public.connector_feeds f
          where f.is_active and f.next_run_at <= now()
            and (f.lease_until is null or f.lease_until < now())
        );
    $trabajo$
  );
end
$migracion$;
