-- =============================================================================
-- pgTAP · alta M2M desde EBIM MasterAdmin (20260924120000).
--
-- Corre sobre un Supabase LOCAL recién creado (`supabase test db`), con los
-- roles, `auth.jwt()` y los defaults de privilegios reales de Supabase — lo que
-- el banco PGlite de Vitest recrea a mano. Todo dentro de una transacción que
-- se deshace al final: no deja datos.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(32);

-- ── 1 · Privacidad ──────────────────────────────────────────────────────────
select has_schema('platform_provisioning');
select has_table('platform_provisioning', 'requests', 'requests existe');
select has_table('platform_provisioning', 'audit', 'audit existe');

select ok((select relrowsecurity and relforcerowsecurity from pg_class
           where oid = 'platform_provisioning.requests'::regclass), 'requests: RLS activada y forzada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
           where oid = 'platform_provisioning.audit'::regclass), 'audit: RLS activada y forzada');

select ok(not has_schema_privilege('anon', 'platform_provisioning', 'USAGE'), 'anon sin USAGE');
select ok(not has_schema_privilege('authenticated', 'platform_provisioning', 'USAGE'), 'authenticated sin USAGE');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'platform_provisioning'
              and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), 0,
          'ningun GRANT de tabla en el esquema privado');

select ok(not has_function_privilege('anon', 'public.platform_provision_tenant(jsonb, jsonb)', 'EXECUTE'), 'anon no da altas');
select ok(not has_function_privilege('authenticated', 'public.platform_provision_tenant(jsonb, jsonb)', 'EXECUTE'), 'authenticated no da altas');
select ok(has_function_privilege('service_role', 'public.platform_provision_tenant(jsonb, jsonb)', 'EXECUTE'), 'service_role da altas');
select ok(not has_function_privilege('authenticated', 'public.platform_get_provisioning(uuid)', 'EXECUTE'), 'authenticated no consulta');
select ok(not has_function_privilege('authenticated', 'public.platform_record_provisioning_audit(jsonb)', 'EXECUTE'), 'authenticated no audita');
select ok(not has_function_privilege('anon', 'public.claim_provisioned_tenant()', 'EXECUTE'), 'anon no reclama');
select ok(has_function_privilege('authenticated', 'public.claim_provisioned_tenant()', 'EXECUTE'), 'authenticated reclama');

-- ── 2 · Alta, replay y conflicto (como la Edge Function: service_role) ─────
create temp table t_out (step text, r jsonb) on commit drop;
grant all on t_out to service_role, authenticated;

set local role service_role;
insert into t_out select 'create', public.platform_provision_tenant(
  '{"controlPlaneTenantId":"7e000000-0000-4000-8000-000000000001",
    "organization":{"id":"7e000000-0000-4000-8000-0000000000a1","slug":"pgtap-m2m","name":"PgTap M2M"},
    "company":{"id":"7e000000-0000-4000-8000-0000000000c1"},
    "admin":{"email":"owner@pgtap-m2m.test"},"deploymentMode":"SHARED"}'::jsonb,
  '{"idempotencyKey":"pgtap-key-0001","requestHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "correlationId":"7e000000-0000-4000-8000-00000000cc01","m2mSubject":"masteradmin-provisioning","m2mJti":"j1"}'::jsonb);
insert into t_out select 'replay', public.platform_provision_tenant(
  '{"controlPlaneTenantId":"7e000000-0000-4000-8000-000000000001",
    "organization":{"id":"7e000000-0000-4000-8000-0000000000a1","slug":"pgtap-m2m","name":"PgTap M2M"},
    "company":{"id":"7e000000-0000-4000-8000-0000000000c1"},
    "admin":{"email":"owner@pgtap-m2m.test"},"deploymentMode":"SHARED"}'::jsonb,
  '{"idempotencyKey":"pgtap-key-0001","requestHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "correlationId":"7e000000-0000-4000-8000-00000000cc02","m2mSubject":"masteradmin-provisioning","m2mJti":"j2"}'::jsonb);
insert into t_out select 'conflict', public.platform_provision_tenant(
  '{"controlPlaneTenantId":"7e000000-0000-4000-8000-000000000001",
    "organization":{"id":"7e000000-0000-4000-8000-0000000000a1","slug":"pgtap-otro","name":"Otro"},
    "company":{"id":"7e000000-0000-4000-8000-0000000000c1"},
    "admin":{"email":"owner@pgtap-m2m.test"},"deploymentMode":"SHARED"}'::jsonb,
  '{"idempotencyKey":"pgtap-key-0001","requestHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "correlationId":"7e000000-0000-4000-8000-00000000cc03","m2mSubject":"masteradmin-provisioning","m2mJti":"j3"}'::jsonb);
reset role;

select is((select r ->> 'outcome' from t_out where step = 'create'), 'CREATED', 'alta: CREATED');
select is((select r #>> '{provisioning,adminProvisioningStatus}' from t_out where step = 'create'), 'PREPROVISIONED', 'owner PREPROVISIONED');
select is((select r ->> 'outcome' from t_out where step = 'replay'), 'REPLAYED', 'replay: REPLAYED');
select is((select r #>> '{provisioning,provisioningId}' from t_out where step = 'replay'),
          (select r #>> '{provisioning,provisioningId}' from t_out where step = 'create'), 'replay: mismo provisioningId');
select is((select r ->> 'errorCode' from t_out where step = 'conflict'), 'IDEMPOTENCY_CONFLICT', 'misma clave, otro cuerpo: 409');

select is((select count(*)::int from auth.users where email = 'owner@pgtap-m2m.test'), 0, 'no se crea usuario de Auth');
select is((select count(*)::int from public.tenant_members where organization_id = '7e000000-0000-4000-8000-0000000000a1'), 0,
          'sin membresia hasta el reclamo');
select is((select count(*)::int from public.tenants where organization_id = '7e000000-0000-4000-8000-0000000000a1'), 1, 'tenant creado');

-- ── 3 · Bitácora append-only ────────────────────────────────────────────────
select throws_ok($$update platform_provisioning.audit set result = 'ERROR'$$, '42501', null, 'audit: UPDATE rechazado');
select throws_ok($$delete from platform_provisioning.audit$$, '42501', null, 'audit: DELETE rechazado');

-- ── 4 · Reclamo con el JWT (authenticated) ──────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '7e000000-0000-4000-8000-0000000000e1', 'email', 'intruso@pgtap-m2m.test',
  'org_id', '7e000000-0000-4000-8000-0000000000a1', 'role', 'authenticated',
  'companies', json_build_array(json_build_object('id', '7e000000-0000-4000-8000-0000000000c1', 'role', 'owner')),
  'active_company', '7e000000-0000-4000-8000-0000000000c1')::text, true);
insert into t_out select 'claim-wrong', public.claim_provisioned_tenant();

select throws_ok($$select public.platform_provision_tenant('{}'::jsonb, '{}'::jsonb)$$, '42501', null,
                 'authenticated no puede llamar a la RPC M2M');
select throws_ok($$select * from platform_provisioning.requests$$, '42501', null,
                 'authenticated no lee el esquema privado');

select set_config('request.jwt.claims', json_build_object(
  'sub', '7e000000-0000-4000-8000-0000000000d1', 'email', 'OWNER@pgtap-m2m.test',
  'org_id', '7e000000-0000-4000-8000-0000000000a1', 'role', 'authenticated',
  'companies', json_build_array(json_build_object('id', '7e000000-0000-4000-8000-0000000000c1', 'role', 'owner')),
  'active_company', '7e000000-0000-4000-8000-0000000000c1')::text, true);
insert into t_out select 'claim-ok', public.claim_provisioned_tenant();
insert into t_out select 'store', public.create_store('pgtap-m2m-tienda', 'Tienda PgTap', 'PEN');
reset role;

select is((select r ->> 'claimed' from t_out where step = 'claim-wrong'), 'false', 'correo distinto: no reclama');
select is((select r ->> 'claimed' from t_out where step = 'claim-ok'), 'true', 'owner correcto: reclama');
select is((select role::text from public.tenant_members
            where organization_id = '7e000000-0000-4000-8000-0000000000a1'
              and user_id = '7e000000-0000-4000-8000-0000000000d1'), 'owner', 'membresia owner activa');
select is((select public.platform_get_provisioning('7e000000-0000-4000-8000-000000000001') ->> 'adminProvisioningStatus'),
          'ACTIVE', 'GET: administrador ACTIVE');
select is((select count(*)::int from public.stores where organization_id = '7e000000-0000-4000-8000-0000000000a1'), 1,
          'el owner crea su primera tienda');

select * from finish();
rollback;
