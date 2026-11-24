-- =============================================================================
-- Complementos IA: la empresa enciende y apaga cada IA (2026-11-23)
--
-- Hasta hoy una IA estaba disponible si la sociedad tenía su capacidad
-- (`ai.assist`, `ai.catalog.copy`, `ai.content`, `ai.insights`) y el módulo
-- que la aloja. El administrador del cliente no podía apagar una que no quería
-- usar: solo EBIM, quitando la capacidad entera.
--
-- Ahora hay una TERCERA condición, que decide el propio cliente: que no la haya
-- apagado en «Complementos IA». Sin fila = encendida, que es como se comportaba
-- todo hasta hoy: aplicar esta migración no cambia nada a nadie.
--
-- Qué cambia:
--   1. `public.ai_feature_settings`: el interruptor por sociedad y funcionalidad.
--      RLS forzada. Leen los miembros; nadie escribe por PostgREST.
--   2. `public.ai_feature_set(feature, enabled)`: la única escritura. SECURITY
--      DEFINER con autorización dentro (owner/admin de la sociedad ACTIVA del
--      token), auditada en `audit_log`.
--   3. `ebim.ai_consume_for` (copia fiel de 20260921120000 + el interruptor):
--      una IA apagada se deniega con `DISABLED`, el motivo que el núcleo ya
--      traduce a `sin_contratar`. Vale para el JWT y para la vitrina.
--   4. `ebim.ai_entitlement_for` (copia fiel de 20260921120000 + el
--      interruptor): `features` ya la da por no usable, y `states` dice POR QUÉ
--      (`on`, `off`, `no_ai`, `no_module`) para que la pantalla lo explique.
--   5. `public.ai_usage_this_month()`: el consumo del mes por funcionalidad
--      (el de `ai_usage_by_feature` es desde siempre).
--
-- Nada de esto toca claims, jerarquía ni la Platform Context API.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · El interruptor
-- ---------------------------------------------------------------------------
create table if not exists public.ai_feature_settings (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  feature         text        not null,
  enabled         boolean     not null,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ai_feature_settings_uq unique (organization_id, company_id, feature),
  constraint ai_feature_settings_feature_ck check (feature ~ '^[a-z][a-z._]{1,39}$')
);

comment on table public.ai_feature_settings is
  'Complementos IA: la sociedad apaga una IA que no quiere usar. Sin fila = encendida. Escritura solo por ai_feature_set.';

alter table public.ai_feature_settings enable row level security;
alter table public.ai_feature_settings force row level security;

revoke all on public.ai_feature_settings from public, anon, authenticated;
grant select on public.ai_feature_settings to authenticated;
grant all on public.ai_feature_settings to service_role;

drop policy if exists ai_feature_settings_select on public.ai_feature_settings;
create policy ai_feature_settings_select on public.ai_feature_settings
  for select to authenticated
  using (
    organization_id = (select ebim.org_id())
    and company_id = (select ebim.active_company())
    and company_id = any ((select ebim.member_companies())::uuid[])
  );

-- La guarda de ciclo de vida (tenant suspendido no escribe), como toda tabla
-- de negocio.
select platform_lifecycle.ensure_guards();

-- ¿La apagó la sociedad? Sin fila = no.
create or replace function ebim.ai_feature_switched_off(p_org uuid, p_company uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.ai_feature_settings s
     where s.organization_id = p_org and s.company_id = p_company
       and s.feature = btrim(coalesce(p_feature, '')) and not s.enabled
  );
$fn$;

revoke execute on function ebim.ai_feature_switched_off(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function ebim.ai_feature_switched_off(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2 · La única escritura
-- ---------------------------------------------------------------------------
create or replace function public.ai_feature_set(p_feature text, p_enabled boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_user    uuid := ebim.user_id();
  v_feature text := btrim(coalesce(p_feature, ''));
  v_antes   boolean;
begin
  if v_org is null or v_company is null or v_user is null then
    raise exception 'SIN_PERMISO: el token no trae la jerarquia de tenant' using errcode = '42501';
  end if;
  if not ebim.has_role(v_org, v_company, array['owner', 'admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: solo propietario o administracion' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'DATOS_INVALIDOS: falta el estado' using errcode = '22023';
  end if;
  if not (v_feature = any (ebim.ai_features())) then
    raise exception 'DATOS_INVALIDOS: IA desconocida' using errcode = '22023';
  end if;

  select s.enabled into v_antes
    from public.ai_feature_settings s
   where s.organization_id = v_org and s.company_id = v_company and s.feature = v_feature;

  insert into public.ai_feature_settings (organization_id, company_id, feature, enabled, updated_by, updated_at)
  values (v_org, v_company, v_feature, p_enabled, v_user, now())
  on conflict (organization_id, company_id, feature)
  do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  perform ebim.audit(
    p_organization_id => v_org,
    p_company_id      => v_company,
    p_action          => case when p_enabled then 'ai_feature.enabled' else 'ai_feature.disabled' end,
    p_entity_type     => 'ai_feature',
    p_entity_label    => v_feature,
    p_changes         => jsonb_build_object('enabled', jsonb_build_object('from', coalesce(v_antes, true), 'to', p_enabled)));

  return jsonb_build_object('feature', v_feature, 'enabled', p_enabled);
end
$fn$;

revoke execute on function public.ai_feature_set(text, boolean) from public, anon;
grant  execute on function public.ai_feature_set(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Consumo: capacidad de IA + MÓDULO + interruptor + cuota
--     Copia fiel de 20260921120000_ai_core.sql §4 con el interruptor añadido.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.ai_consume_for(p_org uuid, p_company uuid, p_feature text DEFAULT 'assistant'::text, p_units integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org     uuid := p_org;
  v_company uuid := p_company;
  v_capability text := ebim.ai_capability_for(p_feature);
  v_module  text := ebim.ai_module_capability_for(p_feature);
  v_quota   public.ai_quotas;
  v_plan    text;
  v_cap     integer;
  v_period  text;
  v_used    integer;
begin
  if p_units is null or p_units < 1 then
    return jsonb_build_object('allowed', false, 'reason', 'BAD_UNITS', 'status', 'disabled');
  end if;

  if v_org is null or v_company is null then
    return jsonb_build_object('allowed', false, 'reason', 'NO_TENANT', 'status', 'disabled');
  end if;

  if v_capability is null then
    return jsonb_build_object('allowed', false, 'reason', 'FEATURE_NO_DECLARADA', 'status', 'disabled');
  end if;

  -- `company_is_entitled` y NO `has_capability`: la pertenencia la comprueba
  -- el envoltorio de JWT; aquí puede llamar la vitrina (sin miembro).
  if not ebim.company_is_entitled(v_org, v_company, v_capability) then
    return jsonb_build_object('allowed', false, 'reason', 'DISABLED', 'status', 'disabled');
  end if;

  -- El módulo, después de la IA: a quien no contrató la IA se le dice eso,
  -- que es lo que tiene que resolver primero.
  if v_module is not null and not ebim.company_is_entitled(v_org, v_company, v_module) then
    return jsonb_build_object('allowed', false, 'reason', 'MODULO_NO_CONTRATADO', 'status', 'disabled');
  end if;

  -- 2026-11-23 · Apagada por la propia empresa en «Complementos IA». Antes de
  -- tocar la cuota: una IA apagada no gasta.
  if ebim.ai_feature_switched_off(v_org, v_company, p_feature) then
    return jsonb_build_object('allowed', false, 'reason', 'DISABLED', 'status', 'disabled', 'switched_off', true);
  end if;

  select * into v_quota
  from public.ai_quotas
  where organization_id = v_org and company_id = v_company;

  v_plan := coalesce(v_quota.plan, 'trial');
  if v_plan = 'trial' then
    v_cap    := coalesce(v_quota.trial_quota, 25);
    v_period := 'trial';
  else
    v_cap    := coalesce(v_quota.monthly_quota, 500);
    v_period := to_char(now(), 'YYYYMM');
  end if;

  insert into public.ai_usage (organization_id, company_id, period, used)
  values (v_org, v_company, v_period, 0)
  on conflict (organization_id, company_id, period) do nothing;

  select used into v_used
  from public.ai_usage
  where organization_id = v_org and company_id = v_company and period = v_period
  for update;

  if v_used + p_units > v_cap then
    return jsonb_build_object(
      'allowed',   false,
      'reason',    case when v_plan = 'trial' then 'TRIAL_EXPIRED' else 'QUOTA_EXCEEDED' end,
      'status',    case when v_plan = 'trial' then 'trial_expired' else 'quota_exceeded' end,
      'plan',      v_plan,
      'used',      v_used,
      'quota',     v_cap,
      'remaining', 0
    );
  end if;

  update public.ai_usage
     set used = used + p_units, updated_at = now()
   where organization_id = v_org and company_id = v_company and period = v_period;

  return jsonb_build_object(
    'allowed',   true,
    'plan',      v_plan,
    'period',    v_period,
    'used',      v_used + p_units,
    'quota',     v_cap,
    'remaining', v_cap - v_used - p_units,
    'status',    case when v_plan = 'trial' then 'trial' else 'active' end
  );
end
$function$;

revoke execute on function ebim.ai_consume_for(uuid, uuid, text, integer) from public, anon, authenticated;
grant  execute on function ebim.ai_consume_for(uuid, uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4 · Saldo: `features` (usable) + `states` (por qué)
--     Copia fiel de 20260921120000_ai_core.sql con el interruptor añadido.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.ai_entitlement_for(p_org uuid, p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org     uuid := p_org;
  v_company uuid := p_company;
  v_quota   public.ai_quotas;
  v_plan    text;
  v_cap     integer;
  v_period  text;
  v_used    integer;
  v_features jsonb := '{}'::jsonb;
  v_states   jsonb := '{}'::jsonb;
  v_feature  text;
  v_module   text;
  v_state    text;
  v_on       boolean;
  v_alguna   boolean := false;
begin
  if v_org is null or v_company is null then
    return jsonb_build_object('enabled', false, 'status', 'disabled', 'features', v_features);
  end if;

  foreach v_feature in array ebim.ai_features() loop
    v_module := ebim.ai_module_capability_for(v_feature);
    v_state := case
      when not ebim.company_is_entitled(v_org, v_company, ebim.ai_capability_for(v_feature)) then 'no_ai'
      when v_module is not null and not ebim.company_is_entitled(v_org, v_company, v_module) then 'no_module'
      when ebim.ai_feature_switched_off(v_org, v_company, v_feature) then 'off'
      else 'on'
    end;
    v_on := v_state = 'on';
    v_features := v_features || jsonb_build_object(v_feature, v_on);
    v_states := v_states || jsonb_build_object(v_feature, v_state);
    v_alguna := v_alguna or v_on;
  end loop;

  if not v_alguna then
    return jsonb_build_object('enabled', false, 'status', 'disabled', 'features', v_features, 'states', v_states);
  end if;

  select * into v_quota
  from public.ai_quotas
  where organization_id = v_org and company_id = v_company;

  v_plan := coalesce(v_quota.plan, 'trial');
  if v_plan = 'trial' then
    v_cap    := coalesce(v_quota.trial_quota, 25);
    v_period := 'trial';
  else
    v_cap    := coalesce(v_quota.monthly_quota, 500);
    v_period := to_char(now(), 'YYYYMM');
  end if;

  select coalesce(used, 0) into v_used
  from public.ai_usage
  where organization_id = v_org and company_id = v_company and period = v_period;
  v_used := coalesce(v_used, 0);

  return jsonb_build_object(
    'enabled',   true,
    'features',  v_features,
    'states',    v_states,
    'plan',      v_plan,
    'period',    v_period,
    'used',      v_used,
    'quota',     v_cap,
    'remaining', greatest(v_cap - v_used, 0),
    'status',    case
                   when v_used >= v_cap then
                     case when v_plan = 'trial' then 'trial_expired' else 'quota_exceeded' end
                   when v_plan = 'trial' then 'trial'
                   else 'active'
                 end
  );
end
$function$;

revoke execute on function ebim.ai_entitlement_for(uuid, uuid) from public, anon, authenticated;
grant  execute on function ebim.ai_entitlement_for(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5 · Consumo del mes por funcionalidad
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: la RLS de `ai_interactions` (propietario o administración)
-- decide quién lo ve. Solo cifras: ni texto de la pregunta ni de la respuesta.
create or replace function public.ai_usage_this_month()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(fila order by (fila->>'calls')::int desc, fila->>'feature'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'feature',       i.feature,
               'calls',         count(*)::int,
               'ok',            count(*) filter (where i.status = 'ai')::int,
               'input_tokens',  coalesce(sum(i.input_tokens), 0)::bigint,
               'output_tokens', coalesce(sum(i.output_tokens), 0)::bigint,
               'last_at',       max(i.created_at)
             ) as fila
        from public.ai_interactions i
       where i.organization_id = ebim.org_id()
         and i.company_id = ebim.active_company()
         and i.created_at >= date_trunc('month', now())
       group by i.feature
    ) t;
$fn$;

revoke execute on function public.ai_usage_this_month() from public, anon;
grant  execute on function public.ai_usage_this_month() to authenticated, service_role;
