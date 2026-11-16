-- =============================================================================
-- lifecycle.v1 · Estado operativo del tenant que ordena EBIM MasterAdmin
-- (contrato de suite `LIFECYCLE_CONTRACT.md`; aquí: docs/platform-provisioning/LIFECYCLE.md)
--
-- La enmienda D-14 dejó dicho que `appActive=false` retira solo lo COMERCIAL
-- (ADR-002). El apagado operativo es este canal aparte: MasterAdmin manda
-- `PUT /tenants/{controlPlaneTenantId}/lifecycle` con `ACTIVE` o `SUSPENDED`
-- y una versión creciente; la Edge Function `platform-provisioning` verifica el
-- JWT M2M (mismo emisor, audiencia, sujeto, clave y `jti` de un solo uso que
-- entitlements, scopes NUEVOS) y llama a estas RPC con service_role.
--
--   platform_lifecycle.tenant_state   último estado aplicado por tenant (uno por organización)
--   platform_lifecycle.events         bitácora append-only de cada PUT verificado
--   platform_lifecycle.exempt_tables  tablas de `public` con `organization_id` SIN guardián, con su porqué
--
-- ## Por qué NO `public.tenants.status`
--
-- `tenants.status = 'suspended'` ya existe y `ebim.member_role` exige
-- `'active'`: suspenderlo cerraría también la LECTURA y el login
-- (`rls-tenant-isolation.test.ts` lo fija). El contrato pide lo contrario:
-- datos legibles y exportables, escritura bloqueada. Por eso el estado vive en
-- un registro propio y esa semántica no se toca. Tampoco se usa
-- `stores.status`: lo cambia el administrador del tenant con `set_store_status`.
--
-- ## La autoridad: un guardián en CADA tabla de negocio
--
-- Hay ~380 funciones SECURITY DEFINER, Edge Functions con service_role, la API
-- de socio y webhooks. Cubrirlos uno a uno no termina nunca; un trigger
-- `BEFORE INSERT OR UPDATE OR DELETE` sí: `ebim.enforce_tenant_lifecycle` mira
-- `organization_id` de la fila (la vieja y la nueva) y, si la organización
-- está suspendida, lanza `TENANT_SUSPENDED` con SQLSTATE `PT423` (PostgREST
-- traduce `PTnnn` a HTTP nnn: 423, no 500). Lo dispara
-- igual una policy, una RPC DEFINER, service_role o un webhook. Leer no pasa por
-- él: SELECT y exportación siguen intactos, y los datos no se tocan.
--
-- `platform_lifecycle.ensure_guards()` lo instala en toda tabla de `public` con
-- `organization_id` que no esté en `exempt_tables`. Es idempotente: una
-- migración que cree una tabla de negocio nueva termina con
-- `select platform_lifecycle.ensure_guards();`, y la prueba estructural
-- (`tenant-lifecycle-db.test.ts`) falla si alguna queda sin guardián.
--
-- ## Tres modos (`ebim.lifecycle_guard`, fijado POR FUNCIÓN con `SET`)
--
--   (vacío)    lo normal: suspendido → TENANT_SUSPENDED.
--   platform   los canales de plataforma (alta, entitlements, contexto del hub)
--              escriben aunque el tenant esté suspendido: así MasterAdmin puede
--              seguir gobernándolo y reactivarlo.
--   access     el ACCESO de un usuario: login permitido (contrato §5). Hoy solo
--              `claim_provisioned_tenant`, el primer ingreso del administrador
--              que MasterAdmin dejó PREPROVISIONED: crea su membresía. Sin esto,
--              el dueño de una cuenta suspendida no podría ni entrar a leer.
--   skip       trabajos de mantenimiento ENTRE tenants (purgas, caducidades,
--              rescates de colas): la fila de un tenant suspendido se SALTA en
--              silencio (el trigger devuelve NULL). Sin esto, una sola fila
--              suspendida tumbaría el lote de todos los demás tenants.
--
-- El modo solo se fija con `ALTER FUNCTION … SET` o en la propia definición:
-- PostgREST no expone `set_config`, así que un cliente no puede pedirlo. Los
-- reclamadores de colas con LÍMITE (integración, eventos, correo, recuperación
-- de carritos, pedidos programados) además FILTRAN lo suspendido al elegir: si
-- solo lo saltaran, las filas suspendidas ocuparían el lote para siempre.
--
-- Exenta (y por qué): solo `api_requests`, el registro de acceso y ventana de
-- tasa de la API de socio; cada GET inserta ahí y bloquearlo cortaría la
-- lectura por API. Los canales de plataforma viven fuera de `public`
-- (`platform_provisioning`, `platform_entitlements`, `platform_usage`, este
-- esquema) o escriben en `public` con el modo `platform`.
--
-- Seguridad: esquema no expuesto por PostgREST y sin USAGE para anon ni
-- authenticated; tablas con RLS forzada y sin GRANT a nadie; RPC M2M SECURITY
-- DEFINER con search_path vacío y EXECUTE solo para service_role.
-- =============================================================================

create schema if not exists platform_lifecycle;
revoke all on schema platform_lifecycle from public, anon, authenticated;

comment on schema platform_lifecycle is
  'Estado operativo del tenant ordenado por EBIM MasterAdmin (lifecycle.v1). Privado: no lo expone PostgREST.';

-- ---------------------------------------------------------------------------
-- 1 · Estado aplicado, bitácora y exenciones
-- ---------------------------------------------------------------------------
create table if not exists platform_lifecycle.tenant_state (
  control_plane_tenant_id uuid primary key,
  organization_id         uuid not null,
  state                   text not null,
  reason                  text,
  applied_version         integer not null,
  effective_at            timestamptz,
  applied_at              timestamptz not null default now(),
  idempotency_key         text,
  correlation_id          text,
  constraint pl_state_org_key unique (organization_id),
  constraint pl_state_state_ck check (state in ('ACTIVE', 'SUSPENDED')),
  constraint pl_state_reason_ck check (
    (state = 'ACTIVE' and reason is null)
    or (state = 'SUSPENDED' and reason in ('NON_PAYMENT', 'MANUAL', 'TERMINATED'))),
  constraint pl_state_version_ck check (applied_version >= 1)
);

comment on table platform_lifecycle.tenant_state is
  'Último estado lifecycle.v1 aplicado por tenant. NO es tenants.status: SUSPENDED bloquea escritura, no lectura ni login.';

-- La pregunta del guardián: «¿esta organización está suspendida?». Parcial: solo
-- las suspendidas, que son las que se buscan en cada escritura.
create index if not exists pl_state_suspended_idx
  on platform_lifecycle.tenant_state (organization_id) where state = 'SUSPENDED';

create table if not exists platform_lifecycle.events (
  id                      bigint generated always as identity primary key,
  control_plane_tenant_id uuid,
  organization_id         uuid,
  outcome                 text not null,
  version                 integer,
  state                   text,
  reason                  text,
  applied_version         integer,
  effective_at            timestamptz,
  idempotency_key         text,
  correlation_id          text,
  m2m_subject             text,
  m2m_jti                 text,
  actor_id                text,
  actor_role              text,
  created_at              timestamptz not null default now(),
  constraint pl_events_outcome_ck check (outcome in (
    'APPLIED', 'REPLAYED', 'STALE_LIFECYCLE', 'VERSION_CONFLICT', 'TENANT_NOT_PROVISIONED', 'INVALID_LIFECYCLE'))
);

create index if not exists pl_events_tenant_idx
  on platform_lifecycle.events (control_plane_tenant_id, id);

create table if not exists platform_lifecycle.exempt_tables (
  table_name text primary key,
  reason     text not null,
  constraint pl_exempt_reason_ck check (length(btrim(reason)) >= 40)
);

insert into platform_lifecycle.exempt_tables (table_name, reason) values
  ('api_requests',
   'Registro de acceso y ventana de tasa de la API de socio: cada GET inserta aquí (api_rate_limit_hit). '
   || 'Bloquearlo cortaría la LECTURA por API, que lifecycle.v1 exige mantener. No guarda datos de negocio.')
on conflict (table_name) do nothing;

do $$
declare
  t text;
begin
  foreach t in array array['tenant_state', 'events', 'exempt_tables'] loop
    execute format('alter table platform_lifecycle.%I enable row level security', t);
    execute format('alter table platform_lifecycle.%I force row level security', t);
    execute format('revoke all on platform_lifecycle.%I from public, anon, authenticated, service_role', t);
  end loop;
end
$$;

revoke all on all sequences in schema platform_lifecycle from public, anon, authenticated, service_role;

-- Append-only: la bitácora no se reescribe.
create or replace function platform_lifecycle.append_only()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'AUDITORIA_INMUTABLE: platform_lifecycle.% es append-only', tg_table_name
    using errcode = '42501';
end;
$fn$;

drop trigger if exists pl_events_no_update on platform_lifecycle.events;
create trigger pl_events_no_update
  before update or delete on platform_lifecycle.events
  for each row execute function platform_lifecycle.append_only();
drop trigger if exists pl_events_no_truncate on platform_lifecycle.events;
create trigger pl_events_no_truncate
  before truncate on platform_lifecycle.events
  for each statement execute function platform_lifecycle.append_only();

-- ---------------------------------------------------------------------------
-- 2 · Funciones internas
-- ---------------------------------------------------------------------------
create or replace function platform_lifecycle.iso(p_ts timestamptz)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$fn$;

/** Mapping del alta M2M: controlPlaneTenantId → organización. NULL = sin alta. */
create or replace function platform_lifecycle.organization_of(p_cpt uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.tenant_organization_id
    from platform_provisioning.requests r
   where r.control_plane_tenant_id = p_cpt and r.status = 'ACTIVE';
$fn$;

create or replace function platform_lifecycle.record(
  p_cpt uuid, p_org uuid, p_outcome text, p_version integer, p_state text, p_reason text,
  p_applied integer, p_effective timestamptz, p_meta jsonb, p_idem text, p_corr text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  insert into platform_lifecycle.events (
    control_plane_tenant_id, organization_id, outcome, version, state, reason, applied_version,
    effective_at, idempotency_key, correlation_id, m2m_subject, m2m_jti, actor_id, actor_role)
  values (
    p_cpt, p_org, p_outcome, p_version, left(p_state, 40), left(p_reason, 40), p_applied,
    p_effective, left(p_idem, 200), left(p_corr, 200),
    left(v_meta ->> 'm2mSubject', 200), left(v_meta ->> 'm2mJti', 200),
    left(v_meta ->> 'actorId', 200), left(v_meta ->> 'actorRole', 200));
end;
$fn$;

/**
 * ¿La organización está suspendida por lifecycle.v1? La pregunta del guardián,
 * de los reclamadores de colas y de la policy de Storage. Solo responde un
 * booleano sobre la organización que se le pasa.
 */
create or replace function ebim.tenant_is_suspended(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_organization_id is not null
     and exists (
       select 1 from platform_lifecycle.tenant_state s
        where s.organization_id = p_organization_id and s.state = 'SUSPENDED');
$fn$;

-- ---------------------------------------------------------------------------
-- 3 · El guardián
-- ---------------------------------------------------------------------------
create or replace function ebim.enforce_tenant_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_mode text := coalesce(current_setting('ebim.lifecycle_guard', true), '');
  v_old  uuid;
  v_new  uuid;
begin
  -- Canal de plataforma (alta, entitlements, contexto del hub) y acceso del
  -- usuario (login): siempre abiertos.
  if v_mode in ('platform', 'access') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- OLD y NEW solo se leen donde existen (INSERT no tiene OLD; DELETE no tiene NEW).
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := old.organization_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := new.organization_id;
  end if;

  if ebim.tenant_is_suspended(v_old)
     or (v_new is distinct from v_old and ebim.tenant_is_suspended(v_new)) then
    -- Mantenimiento entre tenants: la fila del suspendido se queda como está.
    if v_mode = 'skip' then
      return null;
    end if;
    raise exception 'TENANT_SUSPENDED: la cuenta esta suspendida; los datos se pueden consultar pero no modificar'
      using errcode = 'PT423';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

comment on function ebim.enforce_tenant_lifecycle() is
  'Guardián lifecycle.v1: BEFORE INSERT/UPDATE/DELETE en cada tabla de negocio. Organización suspendida → TENANT_SUSPENDED (PT423); modo platform deja pasar, modo skip salta la fila.';

/**
 * Instala el guardián en toda tabla de `public` con `organization_id` que no
 * esté exenta. Idempotente; devuelve cuántos instaló. El nombre empieza por
 * `a_` para que dispare ANTES que los demás BEFORE de la tabla (orden
 * alfabético): un rechazo no debe llegar después de otro trigger con efectos.
 */
create or replace function platform_lifecycle.ensure_guards()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_table text;
  v_count integer := 0;
begin
  for v_table in
    select c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and not c.relispartition
       and exists (
         select 1 from pg_catalog.pg_attribute a
          where a.attrelid = c.oid and a.attname = 'organization_id'
            and a.attnum > 0 and not a.attisdropped)
       and not exists (
         select 1 from platform_lifecycle.exempt_tables x where x.table_name = c.relname)
       and not exists (
         select 1 from pg_catalog.pg_trigger t
          where t.tgrelid = c.oid and t.tgname = 'a_tenant_lifecycle_guard')
     order by c.relname
  loop
    execute format(
      'create trigger a_tenant_lifecycle_guard before insert or update or delete on public.%I '
      'for each row execute function ebim.enforce_tenant_lifecycle()', v_table);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4 · RPC del canal M2M (service_role)
-- ---------------------------------------------------------------------------

/**
 * PUT /tenants/{id}/lifecycle, en UNA transacción. La Edge Function ya
 * verificó JWT, jti, forma, producto y entorno; aquí se revalida lo mínimo y
 * se decide versión e idempotencia. Devuelve `{httpStatus, body}`.
 */
create or replace function public.platform_apply_lifecycle(
  p_control_plane_tenant_id uuid,
  p_command jsonb,
  p_meta jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_cpt       uuid := p_control_plane_tenant_id;
  v_cmd       jsonb := coalesce(p_command, 'null'::jsonb);
  v_state     text;
  v_reason    text;
  v_num       numeric;
  v_version   integer;
  v_effective timestamptz;
  v_idem      text;
  v_corr      text;
  v_org       uuid;
  v_current   platform_lifecycle.tenant_state;
  v_valid     boolean;
begin
  if jsonb_typeof(v_cmd) = 'object' then
    v_state  := v_cmd ->> 'state';
    v_reason := v_cmd ->> 'reason';
    v_idem   := v_cmd ->> 'idempotencyKey';
    v_corr   := v_cmd ->> 'correlationId';
    if jsonb_typeof(v_cmd -> 'version') = 'number' then
      v_num := (v_cmd ->> 'version')::numeric;
    end if;
  end if;

  v_valid := v_cpt is not null
    and jsonb_typeof(v_cmd) = 'object'
    and lower(v_cmd ->> 'controlPlaneTenantId') = v_cpt::text
    and v_num is not null and v_num = trunc(v_num) and v_num between 1 and 2147483647
    and v_state in ('ACTIVE', 'SUSPENDED')
    and ((v_state = 'ACTIVE' and v_reason is null)
         or (v_state = 'SUSPENDED' and v_reason in ('NON_PAYMENT', 'MANUAL', 'TERMINATED')));

  if v_valid then
    begin
      v_effective := (v_cmd ->> 'effectiveAt')::timestamptz;
    exception when others then
      v_valid := false;
    end;
  end if;

  if not coalesce(v_valid, false) then
    perform platform_lifecycle.record(v_cpt, null, 'INVALID_LIFECYCLE', null, v_state, v_reason, null, null,
      p_meta, v_idem, v_corr);
    return jsonb_build_object('httpStatus', 400, 'body',
      jsonb_build_object('error', 'INVALID_LIFECYCLE', 'message', 'Cuerpo lifecycle.v1 inválido'));
  end if;
  v_version := v_num::integer;

  v_org := platform_lifecycle.organization_of(v_cpt);
  if v_org is null then
    perform platform_lifecycle.record(v_cpt, null, 'TENANT_NOT_PROVISIONED', v_version, v_state, v_reason, null,
      v_effective, p_meta, v_idem, v_corr);
    return jsonb_build_object('httpStatus', 404, 'body',
      jsonb_build_object('error', 'TENANT_NOT_PROVISIONED', 'message', 'Tenant sin provisioning local'));
  end if;

  -- Serializa los PUT del mismo tenant (dos entregas concurrentes).
  perform pg_advisory_xact_lock(hashtextextended('ebim.lifecycle:' || v_cpt::text, 0));

  select * into v_current from platform_lifecycle.tenant_state s
   where s.control_plane_tenant_id = v_cpt for update;

  if found then
    if v_version < v_current.applied_version then
      perform platform_lifecycle.record(v_cpt, v_org, 'STALE_LIFECYCLE', v_version, v_state, v_reason,
        v_current.applied_version, v_effective, p_meta, v_idem, v_corr);
      return jsonb_build_object('httpStatus', 409, 'body', jsonb_build_object(
        'error', 'STALE_LIFECYCLE', 'message', 'Versión anterior a la aplicada',
        'appliedVersion', v_current.applied_version));
    end if;
    if v_version = v_current.applied_version then
      -- El «estado» de una versión es estado + causa: la misma versión con otra
      -- causa tampoco es una repetición.
      if v_state = v_current.state and v_reason is not distinct from v_current.reason then
        perform platform_lifecycle.record(v_cpt, v_org, 'REPLAYED', v_version, v_state, v_reason,
          v_current.applied_version, v_effective, p_meta, v_idem, v_corr);
        return jsonb_build_object('httpStatus', 200, 'body', jsonb_build_object(
          'appliedVersion', v_current.applied_version,
          'state',          v_current.state,
          'reason',         v_current.reason,
          'appliedAt',      platform_lifecycle.iso(v_current.applied_at),
          'replayed',       true));
      end if;
      perform platform_lifecycle.record(v_cpt, v_org, 'VERSION_CONFLICT', v_version, v_state, v_reason,
        v_current.applied_version, v_effective, p_meta, v_idem, v_corr);
      return jsonb_build_object('httpStatus', 409, 'body', jsonb_build_object(
        'error', 'VERSION_CONFLICT', 'message', 'Misma versión con otro estado',
        'appliedVersion', v_current.applied_version));
    end if;
  end if;

  insert into platform_lifecycle.tenant_state as s (
    control_plane_tenant_id, organization_id, state, reason, applied_version, effective_at, applied_at,
    idempotency_key, correlation_id)
  values (
    v_cpt, v_org, v_state, v_reason, v_version, v_effective, now(), left(v_idem, 200), left(v_corr, 200))
  on conflict (control_plane_tenant_id) do update
    set organization_id = excluded.organization_id,
        state           = excluded.state,
        reason          = excluded.reason,
        applied_version = excluded.applied_version,
        effective_at    = excluded.effective_at,
        applied_at      = excluded.applied_at,
        idempotency_key = excluded.idempotency_key,
        correlation_id  = excluded.correlation_id;

  perform platform_lifecycle.record(v_cpt, v_org, 'APPLIED', v_version, v_state, v_reason, v_version,
    v_effective, p_meta, v_idem, v_corr);

  return jsonb_build_object('httpStatus', 200, 'body', jsonb_build_object(
    'appliedVersion', v_version,
    'state',          v_state,
    'reason',         v_reason,
    'appliedAt',      platform_lifecycle.iso(now()),
    'replayed',       false));
end;
$fn$;

/** GET /tenants/{id}/lifecycle. NULL = tenant sin provisioning local. Sin PUT previo: ACTIVE, versión null. */
create or replace function public.platform_get_lifecycle(p_control_plane_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row platform_lifecycle.tenant_state;
begin
  if platform_lifecycle.organization_of(p_control_plane_tenant_id) is null then
    return null;
  end if;
  select * into v_row from platform_lifecycle.tenant_state s
   where s.control_plane_tenant_id = p_control_plane_tenant_id;
  return jsonb_build_object(
    'appliedVersion', v_row.applied_version,
    'state',          coalesce(v_row.state, 'ACTIVE'),
    'reason',         v_row.reason,
    'appliedAt',      case when v_row.applied_at is null then null
                           else platform_lifecycle.iso(v_row.applied_at) end);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5 · Lectura para la UI (solo UX: la autoridad es el guardián)
-- ---------------------------------------------------------------------------

/** Estado operativo del tenant de quien pregunta (org del JWT + membresía). NULL sin acceso. */
create or replace function public.my_tenant_lifecycle()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org uuid := ebim.org_id();
  v_row platform_lifecycle.tenant_state;
begin
  if not ebim.can_access(v_org, ebim.active_company()) then
    return null;
  end if;
  select * into v_row from platform_lifecycle.tenant_state s where s.organization_id = v_org;
  return jsonb_build_object(
    'state',      coalesce(v_row.state, 'ACTIVE'),
    'reason',     v_row.reason,
    'applied_at', case when v_row.applied_at is null then null
                       else platform_lifecycle.iso(v_row.applied_at) end);
end;
$fn$;

/**
 * ¿La tienda pública puede vender ahora? Para el aviso de la vitrina. Solo un
 * booleano: la CAUSA de una suspensión no es asunto del comprador. NULL si el
 * slug no es una tienda activa (la vitrina ya responde 404 por su lado).
 */
create or replace function public.store_operational_for_slug(p_store_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object('operational', not ebim.tenant_is_suspended(s.organization_id))
    from public.stores s
   where lower(s.slug) = lower(btrim(coalesce(p_store_slug, '')))
     and s.status = 'active'
   limit 1;
$fn$;

-- ---------------------------------------------------------------------------
-- 6 · Permisos
-- ---------------------------------------------------------------------------
revoke all on all functions in schema platform_lifecycle from public, anon, authenticated, service_role;

revoke all on function ebim.enforce_tenant_lifecycle() from public, anon, authenticated, service_role;
revoke all on function ebim.tenant_is_suspended(uuid) from public, anon;
-- La policy restrictiva de Storage la evalúa como `authenticated`.
grant execute on function ebim.tenant_is_suspended(uuid) to authenticated, service_role;

revoke all on function public.platform_apply_lifecycle(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.platform_get_lifecycle(uuid) from public, anon, authenticated;
grant execute on function public.platform_apply_lifecycle(uuid, jsonb, jsonb) to service_role;
grant execute on function public.platform_get_lifecycle(uuid) to service_role;

revoke all on function public.my_tenant_lifecycle() from public, anon;
grant execute on function public.my_tenant_lifecycle() to authenticated, service_role;

revoke all on function public.store_operational_for_slug(text) from public;
grant execute on function public.store_operational_for_slug(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7 · Canales de plataforma: siempre abiertos (modo `platform`)
--
-- Alta, entitlements (aplicar, modo, reconciliar) y el contexto del hub
-- escriben `tenants`, `tenant_platform_context`, `tenant_entitlements`,
-- `ai_quotas` y `store_settings.white_label`. Un tenant suspendido tiene que
-- seguir recibiendo sus entitlements: si no, MasterAdmin no podría gobernarlo.
-- ---------------------------------------------------------------------------
alter function public.platform_provision_tenant(jsonb, jsonb) set ebim.lifecycle_guard = 'platform';
alter function public.platform_apply_entitlements(uuid, jsonb, jsonb) set ebim.lifecycle_guard = 'platform';
alter function public.platform_set_entitlement_enforcement_mode(text, text, text) set ebim.lifecycle_guard = 'platform';
alter function public.platform_reconcile_entitlements(uuid) set ebim.lifecycle_guard = 'platform';
alter function public.sync_platform_context(uuid, uuid, boolean, text[], public.entitlement_source, text)
  set ebim.lifecycle_guard = 'platform';

-- Login permitido (contrato §5): el ingreso del backoffice solo LEE
-- (`tenants`, `tenant_members`, `stores`, `my_tenant_lifecycle`); la única
-- escritura del camino de entrada es el reclamo del administrador
-- PREPROVISIONED, que crea su membresía `owner`. Esa escritura de ACCESO pasa.
alter function public.claim_provisioned_tenant() set ebim.lifecycle_guard = 'access';

-- ---------------------------------------------------------------------------
-- 8 · Mantenimiento entre tenants: salta lo suspendido (modo `skip`)
--
-- Purgas, caducidades y rescates recorren las filas de TODOS los tenants en una
-- sola sentencia. Con el guardián en modo normal, una fila de un suspendido
-- abortaría la sentencia entera. En `skip` esa fila se queda intacta (no se
-- borra ni caduca mientras dure la suspensión) y el resto se procesa.
-- ---------------------------------------------------------------------------
alter function public.expire_carts() set ebim.lifecycle_guard = 'skip';
alter function public.expire_inventory_reservations() set ebim.lifecycle_guard = 'skip';
alter function public.expire_gift_cards(uuid) set ebim.lifecycle_guard = 'skip';
alter function public.purge_api_idempotency(interval) set ebim.lifecycle_guard = 'skip';
alter function public.purge_api_requests(interval) set ebim.lifecycle_guard = 'skip';
alter function public.purge_api_tokens(interval) set ebim.lifecycle_guard = 'skip';
alter function public.purge_checkout_attempts(interval) set ebim.lifecycle_guard = 'skip';
alter function public.purge_empty_guest_carts(interval) set ebim.lifecycle_guard = 'skip';
alter function public.purge_public_rate_events(interval) set ebim.lifecycle_guard = 'skip';
alter function public.integration_reclaim_stale(interval) set ebim.lifecycle_guard = 'skip';
alter function public.reclaim_stale_domain_events(interval) set ebim.lifecycle_guard = 'skip';
alter function ebim.cart_recovery_guard_queue() set ebim.lifecycle_guard = 'skip';

-- ---------------------------------------------------------------------------
-- 9 · Reclamadores con límite: además FILTRAN lo suspendido
--
-- Las definiciones vigentes (integration_targets, domain_events, cart_recovery,
-- scheduled_orders, connector_feeds), sin otro cambio que el filtro y el modo `skip` para sus
-- actualizaciones auxiliares (disyuntor, caducidad, rescate). Lo suspendido se
-- queda `pending` y sale solo cuando el tenant vuelve a ACTIVE.
-- ---------------------------------------------------------------------------

create or replace function public.integration_claim(
  p_provider_code text,
  p_worker        text,
  p_limit         integer default 10
)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path = ''
set ebim.lifecycle_guard = 'skip'
as $fn$
begin
  update public.integration_circuit c
     set state = 'half_open'
   where c.provider_code = p_provider_code
     and c.state = 'open'
     and c.opened_at + make_interval(secs => c.cooldown_seconds) <= now();

  return query
  with candidatos as (
    select o.id
    from public.integration_outbox o
    where o.provider_code = p_provider_code
      and o.status = 'pending'
      and o.next_retry_at <= now()
      -- lifecycle.v1: lo de un tenant suspendido espera, no ocupa el lote.
      and not ebim.tenant_is_suspended(o.organization_id)
      and not exists (
        select 1 from public.integration_circuit c
        where c.organization_id = o.organization_id
          and c.company_id = o.company_id
          and c.provider_code = o.provider_code
          and c.operation = o.operation
          and c.target = o.target
          and c.state = 'open'
      )
    order by o.next_retry_at, o.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update skip locked
  )
  update public.integration_outbox o
     set status = 'in_flight',
         attempts = o.attempts + 1,
         claimed_by = p_worker,
         claimed_at = now()
   from candidatos c
  where o.id = c.id
  returning o.*;
end;
$fn$;

create or replace function public.claim_domain_events(
  p_worker      text,
  p_limit       integer default 10,
  p_event_types text[] default null
)
returns setof public.domain_events
language plpgsql
security definer
set search_path = ''
set ebim.lifecycle_guard = 'skip'
as $fn$
begin
  return query
  with candidatos as (
    select e.id
    from public.domain_events e
    where e.status = 'pending'
      and e.next_retry_at <= now()
      -- lifecycle.v1: lo de un tenant suspendido espera, no ocupa el lote.
      and not ebim.tenant_is_suspended(e.organization_id)
      and (p_event_types is null or e.event_type = any (p_event_types))
    order by e.next_retry_at, e.created_at
    limit greatest(1, least(coalesce(p_limit, 10), 100))
    for update skip locked
  )
  update public.domain_events e
     set status = 'in_flight',
         attempts = e.attempts + 1,
         claimed_by = p_worker,
         claimed_at = now()
   from candidatos c
  where e.id = c.id
  returning e.*;
end;
$fn$;

create or replace function public.notification_email_claim(p_limit integer default 20)
returns table (
  id         uuid,
  kind       text,
  locale     text,
  to_address text,
  params     jsonb,
  attempts   integer
)
language plpgsql
security definer
set search_path = ''
set ebim.lifecycle_guard = 'skip'
as $fn$
declare
  v_guard_ok boolean;
begin
  -- Lo caducado no se envía: un aviso de hace días confunde más que no llegar.
  update public.notification_emails e
     set status = 'expired', updated_at = now()
   where e.status in ('pending', 'sending')
     and e.expires_at <= now();

  -- Rescate de huérfanos: una pasada que se cayó a mitad no deja correos
  -- `sending` para siempre.
  update public.notification_emails e
     set status = 'pending', claimed_at = null, updated_at = now()
   where e.status = 'sending'
     and e.claimed_at < now() - interval '10 minutes';

  -- Recuperación de carritos: lo que ya no debe salir se suprime AQUÍ, en el
  -- último momento en el que la base todavía decide.
  v_guard_ok := ebim.cart_recovery_guard_queue();

  return query
  with elegidos as (
    select e.id
    from public.notification_emails e
    where e.status = 'pending'
      and e.next_attempt_at <= now()
      -- lifecycle.v1: lo de un tenant suspendido espera, no ocupa el lote.
      and not ebim.tenant_is_suspended(e.organization_id)
      and (
        e.kind <> 'cart.recovery'
        or (v_guard_ok and exists (
              select 1 from public.cart_recovery_reminders r
              where r.email_id = e.id and r.status = 'queued'))
      )
    order by e.next_attempt_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.notification_emails e
     set status = 'sending', claimed_at = now(), attempts = e.attempts + 1, updated_at = now()
    from elegidos
   where e.id = elegidos.id
  returning e.id, e.kind, e.locale, e.to_address, e.params, e.attempts;
end;
$fn$;

create or replace function ebim.enqueue_cart_recovery(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
set ebim.lifecycle_guard = 'skip'
as $fn$
declare
  v_limit      integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_row        record;
  v_reason     text;
  v_token      text;
  v_key        text;
  v_reminder   uuid;
  v_email_id   uuid;
  v_params     jsonb;
  v_lines      integer;
  v_queued     integer := 0;
  v_suppressed integer := 0;
begin
  for v_row in
    select c.id, c.organization_id, c.company_id, c.store_id, c.user_id,
           c.last_activity_at, u.email
    from public.carts c
    join public.store_settings ss on ss.store_id = c.store_id and ss.cart_recovery_enabled
    join public.stores s          on s.id = c.store_id and s.status = 'active'
    join auth.users u             on u.id = c.user_id
    where c.user_id is not null
      -- lifecycle.v1: una tienda suspendida no invita a volver a un carrito que no puede pagar.
      and not ebim.tenant_is_suspended(c.organization_id)
      and c.status in ('active', 'abandoned')
      and c.last_activity_at <= now() - make_interval(hours => ss.cart_recovery_delay_hours)
      and c.last_activity_at >  now() - make_interval(days  => ss.cart_recovery_max_age_days)
      and exists (select 1 from public.cart_items i where i.cart_id = c.id)
      and not exists (
        select 1 from public.cart_recovery_reminders r
        where r.cart_id = c.id and r.episode_at = c.last_activity_at
      )
    order by c.last_activity_at
    limit v_limit
    for update of c skip locked
  loop
    v_reminder := null;
    v_email_id := null;
    v_reason := ebim.cart_recovery_block_reason(v_row.id, v_row.last_activity_at);

    if v_reason is not null then
      insert into public.cart_recovery_reminders (
        organization_id, company_id, store_id, cart_id, user_id, episode_at,
        status, suppressed_reason
      ) values (
        v_row.organization_id, v_row.company_id, v_row.store_id, v_row.id, v_row.user_id,
        v_row.last_activity_at, 'suppressed', v_reason
      )
      on conflict (cart_id, episode_at) do nothing;
      v_suppressed := v_suppressed + 1;
      continue;
    end if;

    -- 2 uuid v4 sin guiones: mismo patrón que `carts.token`. Núcleo de Postgres,
    -- sin depender de pgcrypto.
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    v_key := 'cart.recovery:' || v_row.id::text || ':'
          || floor(extract(epoch from v_row.last_activity_at) * 1000000)::bigint::text;

    insert into public.cart_recovery_reminders (
      organization_id, company_id, store_id, cart_id, user_id, episode_at,
      status, unsubscribe_token_hash
    ) values (
      v_row.organization_id, v_row.company_id, v_row.store_id, v_row.id, v_row.user_id,
      v_row.last_activity_at, 'queued', encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
    )
    on conflict (cart_id, episode_at) do nothing
    returning id into v_reminder;

    if v_reminder is null then
      continue;
    end if;

    select count(*)::int into v_lines from public.cart_items i where i.cart_id = v_row.id;

    -- Lo justo: la marca de la tienda, cuántas líneas y el secreto de baja.
    -- Ni un precio —se confirma al pagar— ni un producto, ni un nombre.
    v_params := ebim.notification_store_params(v_row.store_id)
             || jsonb_build_object('line_count', v_lines, 'unsubscribe_token', v_token);

    perform ebim.queue_notification_email(
      v_row.organization_id, v_row.company_id, v_row.store_id,
      'cart.recovery', v_row.email, v_params, v_key);

    -- `queue_notification_email` añade la huella de la dirección a la clave.
    select e.id into v_email_id
    from public.notification_emails e
    where e.organization_id = v_row.organization_id
      and e.company_id = v_row.company_id
      and e.dedupe_key = v_key || ':' || md5(lower(btrim(coalesce(v_row.email, ''))));

    if v_email_id is null then
      update public.cart_recovery_reminders
         set status = 'suppressed', suppressed_reason = 'no_contact', unsubscribe_token_hash = null
       where id = v_reminder;
      v_suppressed := v_suppressed + 1;
    else
      update public.cart_recovery_reminders set email_id = v_email_id where id = v_reminder;
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object('queued', v_queued, 'suppressed', v_suppressed);
end;
$fn$;

create or replace function ebim.run_order_schedules(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
set ebim.lifecycle_guard = 'skip'
as $fn$
declare
  c_max_attempts constant integer := 5;
  v_limit    integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_sched    record;
  v_tpl      public.order_templates%rowtype;
  v_store    public.stores%rowtype;
  v_reason   text;
  v_run      uuid;
  v_user     uuid;
  v_params   jsonb;
  v_notified integer;
  v_prev     integer;
  v_ready    integer := 0;
  v_skipped  integer := 0;
  v_failed   integer := 0;
  v_dead     integer := 0;
begin
  for v_sched in
    select s.id, s.organization_id, s.company_id, s.store_id, s.template_id, s.next_run_on
    from public.order_schedules s
    where s.status = 'active'
      and s.next_run_on <= current_date
      -- lifecycle.v1: la programación de un tenant suspendido queda en pausa
      -- (ni corre ni avanza) y no ocupa el lote de los demás.
      and not ebim.tenant_is_suspended(s.organization_id)
      and not exists (
        select 1 from public.order_schedule_runs r
        where r.schedule_id = s.id
          and r.run_on = s.next_run_on
          and (r.status = 'dead' or (r.status = 'failed' and r.next_attempt_at > now()))
      )
    order by s.next_run_on, s.id
    limit v_limit
    for update of s skip locked
  loop
    begin
      v_reason   := null;
      v_run      := null;
      v_notified := 0;

      select * into v_tpl   from public.order_templates t where t.id = v_sched.template_id;
      select * into v_store from public.stores s where s.id = v_sched.store_id;

      if v_store.status::text <> 'active' then
        v_reason := 'store_inactive';
      elsif not v_tpl.is_active then
        v_reason := 'template_inactive';
      elsif not ebim.company_is_entitled(v_sched.organization_id, v_sched.company_id, 'orders.advanced') then
        v_reason := 'not_entitled';
      elsif not exists (select 1 from public.order_template_items i where i.template_id = v_tpl.id) then
        v_reason := 'no_items';
      elsif not exists (
        select 1 from public.customers c where c.id = v_tpl.customer_id and c.is_active
      ) then
        v_reason := 'customer_inactive';
      elsif not exists (select 1 from ebim.order_template_buyers(v_tpl)) then
        v_reason := 'no_buyers';
      end if;

      -- La propuesta anterior que nadie usó ya no es la vigente.
      update public.order_schedule_runs r
         set status = 'expired'
       where r.schedule_id = v_sched.id
         and r.status = 'ready'
         and r.run_on < v_sched.next_run_on;

      -- Un reintento reescribe SU fila `failed`; cualquier otro estado es un
      -- vencimiento ya resuelto y no se toca.
      insert into public.order_schedule_runs (
        organization_id, company_id, store_id, schedule_id, template_id, run_on,
        status, skip_reason, attempts
      ) values (
        v_sched.organization_id, v_sched.company_id, v_sched.store_id, v_sched.id,
        v_sched.template_id, v_sched.next_run_on,
        case when v_reason is null then 'ready' else 'skipped' end, v_reason, 1
      )
      on conflict (schedule_id, run_on) do update
         set status = excluded.status,
             skip_reason = excluded.skip_reason,
             attempts = public.order_schedule_runs.attempts + 1,
             next_attempt_at = null,
             last_error = null
       where public.order_schedule_runs.status = 'failed'
      returning id into v_run;

      if v_run is not null and v_reason is null then
        v_params := ebim.notification_store_params(v_sched.store_id)
                 || jsonb_build_object('template_name', v_tpl.name, 'run_on', v_sched.next_run_on);
        for v_user in select b.user_id from ebim.order_template_buyers(v_tpl) b loop
          perform ebim.notify_user(
            v_sched.organization_id, v_sched.company_id, v_sched.store_id,
            v_user, 'storefront', 'order_schedule.run_ready', v_params,
            '/s/' || v_store.slug || '/account#programados',
            null, 'order_schedule.run_ready:' || v_run::text);
          v_notified := v_notified + 1;
        end loop;

        update public.order_schedule_runs set notified_count = v_notified where id = v_run;

        perform ebim.publish_event(
          v_sched.organization_id, v_sched.company_id, v_sched.store_id,
          'order_schedule.run_ready', 'order_schedule', v_sched.id,
          jsonb_build_object('run_id', v_run, 'template_id', v_tpl.id,
                             'run_on', v_sched.next_run_on, 'notified', v_notified),
          'order_schedule.run_ready:' || v_run::text);
      end if;

      perform ebim.order_schedule_advance(v_sched.id);

      if v_run is not null then
        if v_reason is null then v_ready := v_ready + 1; else v_skipped := v_skipped + 1; end if;
      end if;
    exception when others then
      -- El bloque se deshizo entero: ni ejecución, ni avisos, ni avance. Queda la
      -- constancia del fallo con su espera, fuera del bloque deshecho.
      select r.attempts into v_prev
      from public.order_schedule_runs r
      where r.schedule_id = v_sched.id and r.run_on = v_sched.next_run_on;

      v_prev := coalesce(v_prev, 0) + 1;

      insert into public.order_schedule_runs (
        organization_id, company_id, store_id, schedule_id, template_id, run_on,
        status, attempts, next_attempt_at, last_error
      ) values (
        v_sched.organization_id, v_sched.company_id, v_sched.store_id, v_sched.id,
        v_sched.template_id, v_sched.next_run_on,
        case when v_prev >= c_max_attempts then 'dead' else 'failed' end,
        v_prev,
        now() + least(interval '6 hours', interval '5 minutes' * power(2, v_prev - 1)),
        left(sqlstate || ' ' || sqlerrm, 200)
      )
      on conflict (schedule_id, run_on) do update
         set status = excluded.status,
             attempts = excluded.attempts,
             next_attempt_at = excluded.next_attempt_at,
             last_error = excluded.last_error
       where public.order_schedule_runs.status in ('failed', 'dead');

      if v_prev >= c_max_attempts then v_dead := v_dead + 1; else v_failed := v_failed + 1; end if;
    end;
  end loop;

  return jsonb_build_object('ready', v_ready, 'skipped', v_skipped, 'failed', v_failed, 'dead', v_dead);
end;
$fn$;

-- Conector de lectura (20261112120000_connector_sources): misma definición,
-- con el filtro y el modo `skip` para el cierre de concesiones vencidas, que
-- recorre las ejecuciones de todos los tenants.
create or replace function public.connector_claim(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
set ebim.lifecycle_guard = 'skip'
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
       -- lifecycle.v1: el flujo de un tenant suspendido espera, no ocupa el lote.
       and not ebim.tenant_is_suspended(f.organization_id)
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

-- ---------------------------------------------------------------------------
-- 10 · Storage: los objetos van bajo `{organization_id}/…`. Una policy
-- RESTRICTIVA impide subir, reemplazar o borrar archivos de un tenant
-- suspendido (las lecturas no cambian). No hay trigger posible en
-- `storage.objects`; el rechazo es el de RLS (403 en la API de Storage).
-- ---------------------------------------------------------------------------
drop policy if exists ebim_objects_lifecycle_insert on storage.objects;
create policy ebim_objects_lifecycle_insert on storage.objects
  as restrictive for insert to authenticated
  with check (not ebim.tenant_is_suspended(ebim.storage_org(name)));

drop policy if exists ebim_objects_lifecycle_update on storage.objects;
create policy ebim_objects_lifecycle_update on storage.objects
  as restrictive for update to authenticated
  using      (not ebim.tenant_is_suspended(ebim.storage_org(name)))
  with check (not ebim.tenant_is_suspended(ebim.storage_org(name)));

drop policy if exists ebim_objects_lifecycle_delete on storage.objects;
create policy ebim_objects_lifecycle_delete on storage.objects
  as restrictive for delete to authenticated
  using (not ebim.tenant_is_suspended(ebim.storage_org(name)));

-- ---------------------------------------------------------------------------
-- 11 · Instalar el guardián en todas las tablas de negocio
-- ---------------------------------------------------------------------------
select platform_lifecycle.ensure_guards();

comment on function public.platform_apply_lifecycle(uuid, jsonb, jsonb) is
  'lifecycle.v1 PUT: aplica ACTIVE/SUSPENDED con versión creciente (STALE_LIFECYCLE / VERSION_CONFLICT / replay). Solo service_role.';
comment on function public.platform_get_lifecycle(uuid) is
  'lifecycle.v1 GET: último estado aplicado; NULL si el tenant no tiene alta. Solo service_role.';
comment on function public.my_tenant_lifecycle() is
  'Estado operativo (state, reason, applied_at) del tenant del JWT, para el aviso «Cuenta suspendida». Solo UX.';
comment on function public.store_operational_for_slug(text) is
  'Booleano para el aviso de la vitrina: ¿la tienda puede vender ahora? Sin la causa. Solo UX.';
comment on function platform_lifecycle.ensure_guards() is
  'Instala a_tenant_lifecycle_guard en toda tabla public con organization_id no exenta. Toda migración que cree una tabla de negocio la llama.';
