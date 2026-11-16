-- =============================================================================
-- tenant-inventory.v1 · inventario de tenants y vínculo («adoptar») desde
-- EBIM MasterAdmin (contrato de suite `TENANT_INVENTORY_CONTRACT.md`; aquí:
-- docs/platform-provisioning/TENANT_INVENTORY.md)
--
-- MasterAdmin solo conoce los tenants que él mismo dio de alta. Los que se
-- crearon en eCommerce (bootstrap-tenant, consola, seed) quedaban invisibles, y
-- los que se «registraron a mano» en MasterAdmin no tenían fila en
-- `platform_provisioning.requests`: status, entitlements y lifecycle respondían
-- 404 porque el mapeo controlPlaneTenantId → organización no existía.
--
--   GET /tenants                       public.platform_list_tenants()  (service_role)
--   PUT /tenants/{cpt}/link            public.platform_link_tenant()   (service_role)
--
-- ## Identidad
--
-- `externalTenantId` = `organization_id` (PK de `public.tenants`), el MISMO
-- valor que devuelve el alta (`platform_provisioning.view`). La sociedad no
-- tiene tabla: `externalCompanyId` es la del alta si la hay y, si no, la
-- sociedad principal que se deduce de los datos (`primary_company`).
--
-- ## El vínculo
--
-- Escribe SOLO una fila en `platform_provisioning.requests` (estado ACTIVE,
-- como deja un alta) y su bitácora. No toca el tenant, sus usuarios, módulos
-- ni datos. Se marca en `request_payload` (`origin = LINKED`, `linked = true`):
-- no hace falta columna nueva. Desde ese momento `GET /tenants/{cpt}`,
-- entitlements.v1 y lifecycle.v1 resuelven el tenant igual que uno creado por
-- MasterAdmin, porque todos leen ese mapeo.
--
-- Administrador: si la sociedad ya tiene un owner activo, el registro nace con
-- `admin_provisioning_status = ACTIVE` apuntando a él (nada que reclamar). Si
-- no lo tiene (tenant sin miembros), nace PREPROVISIONED con `tenants.admin_email`:
-- el reclamo normal (`claim_provisioned_tenant`) aplica al primer ingreso, igual
-- que tras un alta.
--
-- ## Un alta cuyo tenant ya no existe
--
-- QAS tiene un registro ACTIVE cuyo `public.tenants` se borró. El inventario
-- lista TENANTS, no registros: no aparece. Y ahora el GET de estado responde
-- 404 PROVISIONING_NOT_FOUND (antes: 200 con status `TENANT_MISSING`, que
-- MasterAdmin rechaza porque el contrato GENERIC solo admite ACTIVE|PENDING) y
-- lifecycle.v1 responde 404 TENANT_NOT_PROVISIONED: MasterAdmin lo ve como
-- vínculo roto en vez de aplicar estado a un tenant que no está.
--
-- Seguridad: SECURITY DEFINER con search_path vacío; EXECUTE solo service_role.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Bitácora: la operación LINK_TENANT y sus resultados
-- ---------------------------------------------------------------------------
alter table platform_provisioning.audit drop constraint if exists pp_audit_operation_ck;
alter table platform_provisioning.audit add constraint pp_audit_operation_ck
  check (operation in ('CREATE_TENANT', 'GET_TENANT_STATUS', 'CLAIM_ADMIN', 'LINK_TENANT'));

alter table platform_provisioning.audit drop constraint if exists pp_audit_result_ck;
alter table platform_provisioning.audit add constraint pp_audit_result_ck
  check (result in ('CREATED', 'REPLAYED', 'FOUND', 'REJECTED', 'CONFLICT', 'ERROR', 'CLAIMED',
                    'LINKED', 'ALREADY_LINKED'));

-- Rechazos posteriores a la firma, ahora también del vínculo.
create or replace function public.platform_record_provisioning_audit(p_entry jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if coalesce(p_entry ->> 'operation', '') not in ('CREATE_TENANT', 'GET_TENANT_STATUS', 'LINK_TENANT') then
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
-- 2 · Un alta sin tenant ya no «existe» para estado ni lifecycle
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
  join public.tenants t on t.organization_id = r.tenant_organization_id
  where r.control_plane_tenant_id = p_control_plane_tenant_id;
$fn$;

revoke all on function public.platform_get_provisioning(uuid) from public, anon, authenticated;
grant execute on function public.platform_get_provisioning(uuid) to service_role;

create or replace function platform_lifecycle.organization_of(p_cpt uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.tenant_organization_id
    from platform_provisioning.requests r
    join public.tenants t on t.organization_id = r.tenant_organization_id
   where r.control_plane_tenant_id = p_cpt and r.status = 'ACTIVE';
$fn$;

revoke all on function platform_lifecycle.organization_of(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3 · Sociedad principal de una organización
--
-- La del alta si existe; si no, la del contexto del hub (la que ya recibe
-- entitlements), la del owner activo más antiguo, la de cualquier miembro y, por
-- último, la de la tienda más antigua. Determinista. NULL = sin sociedad visible.
-- ---------------------------------------------------------------------------
create or replace function platform_provisioning.primary_company(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select r.tenant_company_id from platform_provisioning.requests r
      where r.tenant_organization_id = p_org),
    (select c.company_id from public.tenant_platform_context c
      where c.organization_id = p_org order by c.created_at, c.company_id limit 1),
    (select m.company_id from public.tenant_members m
      where m.organization_id = p_org and m.role = 'owner' and m.status = 'active'
      order by m.created_at, m.company_id limit 1),
    (select m.company_id from public.tenant_members m
      where m.organization_id = p_org order by m.created_at, m.company_id limit 1),
    (select s.company_id from public.stores s
      where s.organization_id = p_org order by s.created_at, s.company_id limit 1));
$fn$;

revoke all on function platform_provisioning.primary_company(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 · Inventario (GET /tenants)
--
-- TODOS los tenants del entorno (demo, smoke e internos incluidos), por
-- `organization_id`, con paginación keyset: `p_after` es el último id de la
-- página anterior. Solo identidad y estado: ni usuarios, ni correos, ni importes.
--
--   status: `closed` → INACTIVE; `suspended` (bloqueo propio) o lifecycle.v1
--           SUSPENDED → SUSPENDED; lo demás → ACTIVE.
--
-- Devuelve `{items: [...], hasMore: bool}`; el cursor opaco lo arma la Edge Function.
-- ---------------------------------------------------------------------------
create or replace function public.platform_list_tenants(p_after uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_items jsonb;
  v_count integer;
begin
  with page as (
    select t.organization_id, t.slug, t.name, t.status
      from public.tenants t
     where p_after is null or t.organization_id > p_after
     order by t.organization_id
     limit v_limit + 1
  ), numbered as (
    select p.*, row_number() over (order by p.organization_id) as rn from page p
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'externalTenantId',       n.organization_id,
           'externalOrganizationId', n.organization_id,
           'externalCompanyId',      platform_provisioning.primary_company(n.organization_id),
           'controlPlaneTenantId',   (select r.control_plane_tenant_id
                                        from platform_provisioning.requests r
                                       where r.tenant_organization_id = n.organization_id
                                         and r.status = 'ACTIVE'),
           'code',                   n.slug,
           'name',                   n.name,
           'status', case
             when n.status = 'closed' then 'INACTIVE'
             when n.status = 'suspended' then 'SUSPENDED'
             when exists (select 1 from platform_lifecycle.tenant_state s
                           where s.organization_id = n.organization_id and s.state = 'SUSPENDED')
               then 'SUSPENDED'
             else 'ACTIVE'
           end
         ) order by n.organization_id) filter (where n.rn <= v_limit), '[]'::jsonb)
    into v_count, v_items
    from numbered n;

  return jsonb_build_object('items', v_items, 'hasMore', v_count > v_limit);
end;
$fn$;

revoke all on function public.platform_list_tenants(uuid, integer) from public, anon, authenticated;
grant execute on function public.platform_list_tenants(uuid, integer) to service_role;

comment on function public.platform_list_tenants(uuid, integer) is
  'tenant-inventory.v1: todos los tenants (identidad y estado), keyset por organization_id. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 5 · Vínculo (PUT /tenants/{cpt}/link)
--
-- p_meta: requestId, correlationId, m2mSubject, m2mJti, actorId, actorRole.
-- p_fallback_company: la sociedad derivada del cpt (UUIDv5, la misma regla del
-- alta), solo si la organización no tiene ninguna visible.
--
-- Devuelve `{httpStatus, body}`:
--   200 {status: LINKED | ALREADY_LINKED}
--   404 {error: EXTERNAL_TENANT_NOT_FOUND}
--   409 {error: LINK_CONFLICT}   (el tenant ya está vinculado a otro cpt, o el cpt a otro tenant)
-- ---------------------------------------------------------------------------
create or replace function public.platform_link_tenant(
  p_control_plane_tenant_id uuid,
  p_external_tenant_id      uuid,
  p_fallback_company        uuid,
  p_meta                    jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_cpt     uuid := p_control_plane_tenant_id;
  v_org     uuid := p_external_tenant_id;
  v_req_key text := left(p_meta ->> 'requestId', 200);
  v_tenant  public.tenants;
  v_by_cpt  platform_provisioning.requests;
  v_by_org  platform_provisioning.requests;
  v_company uuid;
  v_owner   public.tenant_members;
  v_req_id  uuid;
begin
  if v_cpt is null or v_org is null or ebim.safe_uuid(p_meta ->> 'correlationId') is null
     or coalesce(p_meta ->> 'm2mSubject', '') = '' or coalesce(p_meta ->> 'm2mJti', '') = '' then
    raise exception 'LINK_INVALID_INPUT' using errcode = '22023';
  end if;

  -- Mismo orden de locks que el alta (cpt) y luego la organización: un alta y un
  -- vínculo simultáneos del mismo cpt se serializan.
  perform pg_advisory_xact_lock(hashtextextended('ecommerce-provisioning:cpt:' || v_cpt::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ecommerce-provisioning:org:' || v_org::text, 0));

  select * into v_tenant from public.tenants t where t.organization_id = v_org;
  if not found then
    perform platform_provisioning.write_audit('LINK_TENANT', 'REJECTED', 'EXTERNAL_TENANT_NOT_FOUND', 404,
      null, v_cpt, v_req_key, p_meta);
    return jsonb_build_object('httpStatus', 404, 'body', jsonb_build_object('error', 'EXTERNAL_TENANT_NOT_FOUND'));
  end if;

  select * into v_by_cpt from platform_provisioning.requests r where r.control_plane_tenant_id = v_cpt;
  if found then
    if v_by_cpt.tenant_organization_id = v_org and v_by_cpt.status = 'ACTIVE' then
      perform platform_provisioning.write_audit('LINK_TENANT', 'ALREADY_LINKED', null, 200,
        v_by_cpt.id, v_cpt, v_req_key, p_meta);
      return jsonb_build_object('httpStatus', 200, 'body', jsonb_build_object(
        'status', 'ALREADY_LINKED', 'provisioningId', v_by_cpt.id));
    end if;
    perform platform_provisioning.write_audit('LINK_TENANT', 'CONFLICT', 'LINK_CONFLICT', 409,
      v_by_cpt.id, v_cpt, v_req_key, p_meta);
    return jsonb_build_object('httpStatus', 409, 'body', jsonb_build_object('error', 'LINK_CONFLICT'));
  end if;

  select * into v_by_org from platform_provisioning.requests r where r.tenant_organization_id = v_org;
  if found then
    perform platform_provisioning.write_audit('LINK_TENANT', 'CONFLICT', 'LINK_CONFLICT', 409,
      v_by_org.id, v_cpt, v_req_key, p_meta);
    return jsonb_build_object('httpStatus', 409, 'body', jsonb_build_object('error', 'LINK_CONFLICT'));
  end if;

  v_company := coalesce(platform_provisioning.primary_company(v_org), p_fallback_company);
  if v_company is null or v_company = v_org then
    raise exception 'LINK_INVALID_INPUT' using errcode = '22023';
  end if;

  select * into v_owner
    from public.tenant_members m
   where m.organization_id = v_org and m.company_id = v_company
     and m.role = 'owner' and m.status = 'active'
   order by m.created_at, m.id
   limit 1;

  begin
    insert into platform_provisioning.requests(
      control_plane_tenant_id, idempotency_key, request_hash, tenant_organization_id,
      tenant_company_id, tenant_slug, admin_email, admin_provisioning_status, admin_user_id,
      admin_activated_at, deployment_mode, status, correlation_id, m2m_subject, m2m_jti,
      actor_id, actor_role, request_payload, completed_at)
    values (
      v_cpt,
      'link:' || v_cpt::text,
      encode(sha256(convert_to('tenant-inventory.v1:link:' || v_cpt::text || ':' || v_org::text, 'UTF8')), 'hex'),
      v_org, v_company, v_tenant.slug, lower(v_tenant.admin_email),
      case when v_owner.id is null then 'PREPROVISIONED' else 'ACTIVE' end,
      v_owner.user_id,
      case when v_owner.id is null then null else v_owner.created_at end,
      'SHARED', 'ACTIVE',
      ebim.safe_uuid(p_meta ->> 'correlationId'),
      left(p_meta ->> 'm2mSubject', 200), left(p_meta ->> 'm2mJti', 200),
      left(p_meta ->> 'actorId', 200), left(p_meta ->> 'actorRole', 200),
      jsonb_build_object(
        'origin', 'LINKED',
        'linked', true,
        'contract', 'tenant-inventory.v1',
        'controlPlaneTenantId', v_cpt,
        'externalTenantId', v_org,
        'externalCompanyId', v_company,
        'requestId', v_req_key),
      now())
    returning id into v_req_id;
  exception when unique_violation then
    -- La sociedad ya está en otro registro (o una carrera que el lock no cubre).
    perform platform_provisioning.write_audit('LINK_TENANT', 'CONFLICT', 'LINK_CONFLICT', 409,
      null, v_cpt, v_req_key, p_meta);
    return jsonb_build_object('httpStatus', 409, 'body', jsonb_build_object('error', 'LINK_CONFLICT'));
  end;

  perform platform_provisioning.write_audit('LINK_TENANT', 'LINKED', null, 200,
    v_req_id, v_cpt, v_req_key, p_meta);

  return jsonb_build_object('httpStatus', 200, 'body', jsonb_build_object(
    'status', 'LINKED', 'provisioningId', v_req_id));
end;
$fn$;

revoke all on function public.platform_link_tenant(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_link_tenant(uuid, uuid, uuid, jsonb) to service_role;

comment on function public.platform_link_tenant(uuid, uuid, uuid, jsonb) is
  'tenant-inventory.v1 §8: vincula un controlPlaneTenantId a un tenant EXISTENTE (solo el registro de alta). Idempotente. Solo service_role.';
