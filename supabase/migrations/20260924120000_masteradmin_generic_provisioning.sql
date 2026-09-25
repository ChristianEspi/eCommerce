-- =============================================================================
-- EBIM MasterAdmin da de alta tenants de eCommerce por M2M (contrato GENERIC v1).
--
-- MasterAdmin (plano de control de la suite) llama a la Edge Function
-- `platform-provisioning` con un JWT ES256 de vida corta. La funcion verifica
-- firma, emisor, audiencia, sujeto, vida y scope, y recien entonces llama a
-- estas RPC con service_role. Esta migracion es la mitad de base de datos:
--
--   platform_provisioning.requests  <- idempotencia + mapeo controlPlaneTenantId -> tenant
--                                      + el ADMINISTRADOR PENDIENTE (PREPROVISIONED)
--   platform_provisioning.audit     <- bitacora append-only de cada llamada verificada
--   public.platform_provision_tenant()          <- alta ATOMICA (service_role)
--   public.platform_get_provisioning()          <- estado para el GET (service_role)
--   public.platform_record_provisioning_audit() <- rechazos posteriores a la firma (service_role)
--   public.claim_provisioned_tenant()           <- el administrador reclama su tenant (authenticated)
--
-- ## Que es un tenant de eCommerce (y que NO crea esta migracion)
--
-- La raiz es `public.tenants` (PK = `organization_id`, 20260827090100). La
-- sociedad NO tiene tabla propia: es el `company_id` que llevan la membresia y
-- cada fila de negocio. Las tiendas son de la SOCIEDAD y el owner/admin las crea
-- en autoservicio con `public.create_store` (ADR 018, 20260917100000), y el
-- backoffice funciona sin tienda activa. El contrato GENERIC no trae ni slug ni
-- nombre de tienda, asi que este alta NO crea tienda: inventarla seria decidir
-- por el cliente la URL publica de su vitrina.
--
-- ## El administrador PREPROVISIONED
--
-- `tenant_members.user_id` es NOT NULL y es el `sub` del JWT: no hay membresia
-- sin usuario, y MasterAdmin NO crea usuarios en `auth.users`. El cambio de
-- esquema minimo es guardar al administrador pendiente en la fila de
-- seguimiento (`admin_email`, `admin_provisioning_status`) y dejar que la
-- persona lo RECLAME al entrar: `public.claim_provisioned_tenant()` no acepta
-- parametros, toma usuario, organizacion, sociedades y correo del JWT, y solo
-- crea la membresia `owner` si las cuatro cosas coinciden con lo aprovisionado.
-- Hasta entonces el tenant existe y nadie entra: no hay acceso concedido a quien
-- todavia no se ha presentado.
--
-- `bootstrap_tenant` y la Edge Function `bootstrap-tenant` NO cambian.
--
-- Seguridad:
--   * Las tablas viven en `platform_provisioning`, que PostgREST no expone
--     (`config.toml [api].schemas = ["public"]`), con RLS activada y forzada, sin
--     policies y sin un solo GRANT para anon, authenticated ni service_role.
--   * Funciones SECURITY DEFINER con search_path fijo; las de M2M solo para
--     service_role; la de reclamo solo para authenticated (nunca anon).
-- =============================================================================

create schema if not exists platform_provisioning;
revoke all on schema platform_provisioning from public, anon, authenticated;

comment on schema platform_provisioning is
  'Seguimiento del alta de tenants pedida por EBIM MasterAdmin (M2M). Privado: no lo expone PostgREST.';

-- ---------------------------------------------------------------------------
-- 1 . Seguimiento, idempotencia, mapeo y administrador pendiente
-- ---------------------------------------------------------------------------
create table if not exists platform_provisioning.requests (
  id                        uuid primary key default gen_random_uuid(),
  control_plane_tenant_id   uuid not null,
  idempotency_key           text not null,
  -- SHA-256 hex del comando normalizado (sin headers, sin correlation id, sin
  -- los campos que eCommerce no guarda).
  request_hash              text not null,
  -- Nombres con prefijo `tenant_` a proposito: esta fila no es un dato de
  -- negocio del tenant sino el registro del plano de control.
  tenant_organization_id    uuid not null,
  tenant_company_id         uuid not null,
  tenant_slug               text not null,
  admin_email               text not null,
  admin_provisioning_status text not null default 'PREPROVISIONED',
  admin_user_id             uuid,
  admin_activated_at        timestamptz,
  deployment_mode           text not null,
  status                    text not null default 'PROVISIONING',
  correlation_id            uuid not null,
  m2m_subject               text not null,
  m2m_jti                   text not null,
  actor_id                  text,
  actor_role                text,
  -- Comando normalizado + contexto no vinculante: explica un 409 sin guardar
  -- nada del transporte (ni token, ni headers).
  request_payload           jsonb not null,
  created_at                timestamptz not null default now(),
  completed_at              timestamptz,

  -- La proteccion contra duplicados es de la BASE, no de un SELECT previo.
  constraint pp_requests_idempotency_key_key unique (idempotency_key),
  constraint pp_requests_control_plane_tenant_key unique (control_plane_tenant_id),
  constraint pp_requests_tenant_org_key unique (tenant_organization_id),
  constraint pp_requests_tenant_company_key unique (tenant_company_id),

  constraint pp_requests_status_ck check (status in ('PROVISIONING', 'ACTIVE', 'FAILED')),
  constraint pp_requests_admin_status_ck
    check (admin_provisioning_status in ('PREPROVISIONED', 'ACTIVE')),
  -- ACTIVE del administrador implica que alguien lo reclamo, y viceversa.
  constraint pp_requests_admin_active_ck
    check ((admin_provisioning_status = 'ACTIVE') = (admin_user_id is not null and admin_activated_at is not null)),
  constraint pp_requests_deployment_ck
    check (deployment_mode in ('SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED')),
  constraint pp_requests_hash_ck check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint pp_requests_key_ck check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  constraint pp_requests_distinct_ids_ck check (tenant_organization_id <> tenant_company_id),
  constraint pp_requests_active_ck check (status <> 'ACTIVE' or completed_at is not null)
);

create index if not exists pp_requests_admin_email_idx
  on platform_provisioning.requests (lower(admin_email));

comment on table platform_provisioning.requests is
  'Altas de tenant pedidas por EBIM MasterAdmin (M2M). Escritura solo via public.platform_provision_tenant() y public.claim_provisioned_tenant().';

alter table platform_provisioning.requests enable row level security;
alter table platform_provisioning.requests force  row level security;
revoke all on platform_provisioning.requests from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 . Bitacora append-only
-- ---------------------------------------------------------------------------
create table if not exists platform_provisioning.audit (
  id                      bigserial primary key,
  operation               text not null,
  result                  text not null,
  error_code              text,
  http_status             integer,
  provisioning_id         uuid,
  control_plane_tenant_id uuid,
  idempotency_key         text,
  correlation_id          uuid,
  m2m_subject             text,
  m2m_jti                 text,
  actor_id                text,
  actor_role              text,
  created_at              timestamptz not null default now(),
  constraint pp_audit_operation_ck
    check (operation in ('CREATE_TENANT', 'GET_TENANT_STATUS', 'CLAIM_ADMIN')),
  constraint pp_audit_result_ck
    check (result in ('CREATED', 'REPLAYED', 'FOUND', 'REJECTED', 'CONFLICT', 'ERROR', 'CLAIMED')),
  -- Una llamada M2M siempre lleva su hilo; el reclamo lo hace una persona.
  constraint pp_audit_correlation_ck
    check (operation = 'CLAIM_ADMIN' or correlation_id is not null)
);

create index if not exists pp_audit_cpt_idx
  on platform_provisioning.audit (control_plane_tenant_id, created_at desc);
create index if not exists pp_audit_corr_idx
  on platform_provisioning.audit (correlation_id);

alter table platform_provisioning.audit enable row level security;
alter table platform_provisioning.audit force  row level security;
revoke all on platform_provisioning.audit from public, anon, authenticated, service_role;
revoke all on sequence platform_provisioning.audit_id_seq from public, anon, authenticated, service_role;

create or replace function platform_provisioning.audit_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'AUDITORIA_INMUTABLE: platform_provisioning.audit es append-only'
    using errcode = '42501';
end;
$fn$;

revoke all on function platform_provisioning.audit_immutable() from public, anon, authenticated, service_role;

drop trigger if exists pp_audit_no_update on platform_provisioning.audit;
create trigger pp_audit_no_update
  before update or delete on platform_provisioning.audit
  for each row execute function platform_provisioning.audit_immutable();

-- TRUNCATE no dispara triggers de fila: se cierra con uno de sentencia.
drop trigger if exists pp_audit_no_truncate on platform_provisioning.audit;
create trigger pp_audit_no_truncate
  before truncate on platform_provisioning.audit
  for each statement execute function platform_provisioning.audit_immutable();

-- ---------------------------------------------------------------------------
-- 3 . Respuesta estandar a partir del registro
--
-- `externalTenantId` es la ORGANIZACION: es la PK de `public.tenants` y la
-- llave de toda la RLS (`ebim.org_id()`). La sociedad va aparte.
-- ---------------------------------------------------------------------------
create or replace function platform_provisioning.view(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'provisioningId',          r.id,
    'status',                  case when r.status = 'ACTIVE' and t.organization_id is null
                                    then 'TENANT_MISSING' else r.status end,
    'controlPlaneTenantId',    r.control_plane_tenant_id,
    'externalTenantId',        r.tenant_organization_id,
    'externalOrganizationId',  r.tenant_organization_id,
    'externalCompanyId',       r.tenant_company_id,
    'resources', jsonb_build_object(
      'tenantSlug',              r.tenant_slug,
      'backofficePath',          '/app',
      'adminProvisioningStatus', r.admin_provisioning_status,
      'storeCount',              (select count(*) from public.stores s
                                   where s.organization_id = r.tenant_organization_id
                                     and s.company_id = r.tenant_company_id),
      'initialStore',            'CREATED_BY_OWNER'
    ),
    'adminProvisioningStatus', r.admin_provisioning_status,
    'deploymentMode',          r.deployment_mode,
    'rawReference',            r.id,
    'requestHash',             r.request_hash,
    'createdAt',               r.created_at,
    'completedAt',             r.completed_at
  )
  from platform_provisioning.requests r
  left join public.tenants t on t.organization_id = r.tenant_organization_id
  where r.id = p_id;
$fn$;

revoke all on function platform_provisioning.view(uuid) from public, anon, authenticated, service_role;

-- Insercion en la bitacora: un solo sitio con los nombres de columna.
create or replace function platform_provisioning.write_audit(
  p_operation text, p_result text, p_error_code text, p_http_status integer,
  p_provisioning_id uuid, p_cpt uuid, p_key text, p_meta jsonb
)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into platform_provisioning.audit(operation, result, error_code, http_status,
    provisioning_id, control_plane_tenant_id, idempotency_key, correlation_id,
    m2m_subject, m2m_jti, actor_id, actor_role)
  values (p_operation, p_result, left(p_error_code, 80), p_http_status,
    p_provisioning_id, p_cpt, left(p_key, 200),
    ebim.safe_uuid(p_meta ->> 'correlationId'),
    left(p_meta ->> 'm2mSubject', 200), left(p_meta ->> 'm2mJti', 200),
    left(p_meta ->> 'actorId', 200), left(p_meta ->> 'actorRole', 200));
$fn$;

revoke all on function platform_provisioning.write_audit(text, text, text, integer, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 . Alta atomica
--
-- p_payload: comando YA normalizado por la Edge Function:
--   { controlPlaneTenantId, organization{id,slug,name}, company{id,name},
--     admin{email}, deploymentMode, context{...no vinculante...} }
-- p_meta: idempotencyKey, requestHash, correlationId, m2mSubject, m2mJti,
--         actorId, actorRole.
--
-- Devuelve { outcome: CREATED | REPLAYED | CONFLICT, errorCode?, provisioning? }.
-- Un fallo inesperado LANZA: la transaccion de la RPC se deshace entera.
-- ---------------------------------------------------------------------------
create or replace function public.platform_provision_tenant(p_payload jsonb, p_meta jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_key       text := p_meta ->> 'idempotencyKey';
  v_hash      text := p_meta ->> 'requestHash';
  v_corr      uuid := ebim.safe_uuid(p_meta ->> 'correlationId');
  v_sub       text := left(p_meta ->> 'm2mSubject', 200);
  v_jti       text := left(p_meta ->> 'm2mJti', 200);

  v_cpt       uuid := ebim.safe_uuid(p_payload ->> 'controlPlaneTenantId');
  v_org_id    uuid := ebim.safe_uuid(p_payload #>> '{organization,id}');
  v_slug      text := lower(btrim(p_payload #>> '{organization,slug}'));
  v_org_name  text := btrim(p_payload #>> '{organization,name}');
  v_co_id     uuid := ebim.safe_uuid(p_payload #>> '{company,id}');
  v_email     text := lower(btrim(p_payload #>> '{admin,email}'));
  v_mode      text := p_payload ->> 'deploymentMode';

  v_existing  platform_provisioning.requests;
  v_req_id    uuid;
  v_conflict  text;
begin
  -- -- Precondiciones: la Edge Function ya valido; esto es la segunda linea --
  if v_key is null or v_hash is null or v_corr is null or v_sub is null or v_jti is null
     or v_cpt is null or v_org_id is null or v_co_id is null or v_org_id = v_co_id
     or v_org_name is null or v_org_name = '' or v_mode is null then
    raise exception 'PROVISIONING_INVALID_INPUT' using errcode = '22023';
  end if;
  -- Las mismas reglas que los CHECK de `public.tenants` y que `bootstrap_tenant`.
  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$' then
    raise exception 'SLUG_INVALIDO' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'ADMIN_EMAIL_REQUERIDO' using errcode = '22023';
  end if;
  -- Contrato §13: el super admin de suite no es actor de negocio de un tenant.
  if v_email like '%@ebim.pe' then
    raise exception 'ADMIN_EMAIL_INVALIDO' using errcode = '22023';
  end if;

  -- -- Serializacion. Orden FIJO: clave -> tenant del plano de control -> slug.
  -- Las UNIQUE siguen siendo la garantia final; los locks convierten al
  -- perdedor de una carrera en un replay limpio en vez de un 500.
  perform pg_advisory_xact_lock(hashtextextended('ecommerce-provisioning:key:' || v_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('ecommerce-provisioning:cpt:' || v_cpt::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ecommerce-provisioning:slug:' || v_slug, 0));

  -- -- Idempotencia --
  select * into v_existing from platform_provisioning.requests where idempotency_key = v_key;
  if found then
    if v_existing.request_hash = v_hash then
      perform platform_provisioning.write_audit('CREATE_TENANT', 'REPLAYED', null, 200,
        v_existing.id, v_existing.control_plane_tenant_id, v_key, p_meta);
      return jsonb_build_object('outcome', 'REPLAYED',
        'provisioning', platform_provisioning.view(v_existing.id));
    end if;
    v_conflict := 'IDEMPOTENCY_CONFLICT';
  end if;

  if v_conflict is null then
    select * into v_existing from platform_provisioning.requests where control_plane_tenant_id = v_cpt;
    if found then
      -- Mismo contrato con otra clave: ya esta hecho. Contrato distinto: incompatible.
      v_conflict := case when v_existing.request_hash = v_hash
                         then 'TENANT_ALREADY_PROVISIONED' else 'TENANT_CONFLICT' end;
    end if;
  end if;

  -- -- Colisiones con tenants que ya existen (bootstrap-tenant, consola, seed) --
  if v_conflict is null and (
       exists (select 1 from public.tenants t
                where t.organization_id = v_org_id or lower(t.slug) = v_slug)
    or exists (select 1 from public.tenant_members m where m.company_id = v_co_id)
    or exists (select 1 from public.stores s where s.company_id = v_co_id)) then
    v_conflict := 'TENANT_CONFLICT';
  end if;

  if v_conflict is not null then
    perform platform_provisioning.write_audit('CREATE_TENANT', 'CONFLICT', v_conflict, 409,
      v_existing.id, v_cpt, v_key, p_meta);
    return jsonb_build_object('outcome', 'CONFLICT', 'errorCode', v_conflict,
      'provisioningId', v_existing.id);
  end if;

  -- -- Alta --
  begin
    insert into platform_provisioning.requests(
      control_plane_tenant_id, idempotency_key, request_hash, tenant_organization_id,
      tenant_company_id, tenant_slug, admin_email, deployment_mode, status, correlation_id,
      m2m_subject, m2m_jti, actor_id, actor_role, request_payload)
    values (v_cpt, v_key, v_hash, v_org_id, v_co_id, v_slug, v_email, v_mode, 'PROVISIONING',
      v_corr, v_sub, v_jti, left(p_meta ->> 'actorId', 200), left(p_meta ->> 'actorRole', 200),
      p_payload)
    returning id into v_req_id;

    -- El tenant. Sin membresia: el owner la reclama al entrar (seccion 6).
    insert into public.tenants (organization_id, slug, name, admin_email)
    values (v_org_id, v_slug, v_org_name, v_email);

    update platform_provisioning.requests
       set status = 'ACTIVE', completed_at = now()
     where id = v_req_id;
  exception when unique_violation then
    -- Solo llega aca si algo que el lock no cubre colisiona. El bloque ya
    -- deshizo lo insertado.
    perform platform_provisioning.write_audit('CREATE_TENANT', 'CONFLICT', 'TENANT_CONFLICT', 409,
      null, v_cpt, v_key, p_meta);
    return jsonb_build_object('outcome', 'CONFLICT', 'errorCode', 'TENANT_CONFLICT');
  end;

  perform platform_provisioning.write_audit('CREATE_TENANT', 'CREATED', null, 201,
    v_req_id, v_cpt, v_key, p_meta);

  return jsonb_build_object('outcome', 'CREATED',
    'provisioning', platform_provisioning.view(v_req_id));
end;
$fn$;

revoke all on function public.platform_provision_tenant(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.platform_provision_tenant(jsonb, jsonb) to service_role;

comment on function public.platform_provision_tenant(jsonb, jsonb) is
  'Alta M2M de EBIM MasterAdmin (GENERIC v1): tenant + administrador PREPROVISIONED. Idempotente. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 5 . Estado (GET)
-- ---------------------------------------------------------------------------
create or replace function public.platform_get_provisioning(p_control_plane_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select platform_provisioning.view(r.id)
  from platform_provisioning.requests r
  where r.control_plane_tenant_id = p_control_plane_tenant_id;
$fn$;

revoke all on function public.platform_get_provisioning(uuid) from public, anon, authenticated;
grant execute on function public.platform_get_provisioning(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6 . Auditoria desde la Edge Function
--
-- Solo para llamadas con el M2M YA verificado. Un token invalido NO se
-- persiste: sus claims no son de fiar y escribirlos dejaria a cualquiera
-- llenar la bitacora.
-- ---------------------------------------------------------------------------
create or replace function public.platform_record_provisioning_audit(p_entry jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if coalesce(p_entry ->> 'operation', '') not in ('CREATE_TENANT', 'GET_TENANT_STATUS') then
    raise exception 'AUDITORIA_INVALIDA' using errcode = '22023';
  end if;
  perform platform_provisioning.write_audit(
    p_entry ->> 'operation', p_entry ->> 'result', p_entry ->> 'errorCode',
    (p_entry ->> 'httpStatus')::integer,
    ebim.safe_uuid(p_entry ->> 'provisioningId'),
    ebim.safe_uuid(p_entry ->> 'controlPlaneTenantId'),
    p_entry ->> 'idempotencyKey', p_entry);
end;
$fn$;

revoke all on function public.platform_record_provisioning_audit(jsonb) from public, anon, authenticated;
grant execute on function public.platform_record_provisioning_audit(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 7 . El administrador reclama su tenant
--
-- Sin parametros: TODO sale del JWT (contrato §2.6). La membresia `owner` nace
-- solo si coinciden las cuatro cosas:
--   * `org_id` del token = organizacion aprovisionada (claim que emite el hub,
--     o el hook de DEV/QAS desde `app_metadata`, que solo escribe el servidor);
--   * la sociedad aprovisionada esta en `companies[]` del token;
--   * `email` del token = correo que mando MasterAdmin;
--   * el tenant sigue `active`.
-- Idempotente: reclamar dos veces con el mismo usuario devuelve lo mismo.
-- Devuelve solo `claimed` y los ids que el token ya conoce: no es un oraculo.
-- ---------------------------------------------------------------------------
create or replace function public.claim_provisioned_tenant()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user   uuid := ebim.user_id();
  v_org    uuid := ebim.org_id();
  v_email  text := ebim.email();
  v_req    platform_provisioning.requests;
begin
  if v_user is null or v_org is null or v_email is null then
    return jsonb_build_object('claimed', false);
  end if;

  select * into v_req
  from platform_provisioning.requests r
  where r.tenant_organization_id = v_org and r.status = 'ACTIVE'
  for update;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  if v_req.admin_provisioning_status = 'ACTIVE' then
    -- Ya reclamado. Al mismo usuario se le confirma; a otro, nada.
    return jsonb_build_object('claimed', v_req.admin_user_id = v_user);
  end if;

  if lower(v_req.admin_email) <> v_email
     or not (v_req.tenant_company_id = any (ebim.companies()))
     or v_email like '%@ebim.pe'
     or not exists (select 1 from public.tenants t
                     where t.organization_id = v_org and t.status = 'active') then
    insert into platform_provisioning.audit(operation, result, error_code, provisioning_id,
      control_plane_tenant_id)
    values ('CLAIM_ADMIN', 'REJECTED', 'ADMIN_CLAIM_MISMATCH', v_req.id, v_req.control_plane_tenant_id);
    return jsonb_build_object('claimed', false);
  end if;

  insert into public.tenant_members (organization_id, company_id, user_id, email, role, status)
  values (v_org, v_req.tenant_company_id, v_user, v_email, 'owner', 'active')
  on conflict (organization_id, company_id, user_id)
  do update set role = 'owner', status = 'active', email = excluded.email;

  update platform_provisioning.requests
     set admin_provisioning_status = 'ACTIVE',
         admin_user_id = v_user,
         admin_activated_at = now()
   where id = v_req.id;

  insert into platform_provisioning.audit(operation, result, provisioning_id, control_plane_tenant_id,
    actor_id)
  values ('CLAIM_ADMIN', 'CLAIMED', v_req.id, v_req.control_plane_tenant_id, v_user::text);

  return jsonb_build_object('claimed', true,
    'organization_id', v_org, 'company_id', v_req.tenant_company_id);
end;
$fn$;

revoke all on function public.claim_provisioned_tenant() from public, anon;
grant execute on function public.claim_provisioned_tenant() to authenticated, service_role;

comment on function public.claim_provisioned_tenant() is
  'El administrador PREPROVISIONED por MasterAdmin reclama su tenant. Sin parametros: usuario, organizacion, sociedad y correo salen del JWT.';
