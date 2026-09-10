-- =============================================================================
-- La IA deja de ser UNA capacidad y pasa a ser varias, activables por separado.
--
-- ## Qué estaba mal
--
-- `ai_consume_for` y `ai_entitlement_for` comprobaban `ai.assist` SIEMPRE, con
-- el nombre escrito a mano dentro. `p_feature` solo servía para etiquetar la
-- traza. Consecuencia: contratar el asistente de la vitrina abría también, sin
-- que nadie lo decidiera, cualquier otro uso de IA que se añadiera después. Un
-- addon que se activa solo no es un addon.
--
-- ## Cómo queda
--
--  · Cada FUNCIONALIDAD declara contra qué CAPACIDAD se cobra
--    (`ebim.ai_capability_for`). Una funcionalidad que no esté en esa lista se
--    deniega — y se deniega a propósito, en vez de caer a `ai.assist`: si
--    alguien añade un uso nuevo y olvida declararlo, tiene que romperse
--    ruidosamente y no gastar la cuota contratada para otra cosa.
--  · El PRESUPUESTO sigue siendo uno solo por sociedad. El coste real son
--    tokens y son una sola factura; partirlo en un contador por addon inventa
--    una contabilidad que el proveedor no tiene, y deja a una sociedad sin
--    crédito en un módulo teniendo saldo en otro, que se lee como que está
--    roto. El entitlement es la PUERTA, la cuota es el PRESUPUESTO.
--  · El desglose por módulo sale de la traza, que ya guardaba `feature`. Ver
--    en qué se va el presupuesto no necesita partirlo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Qué capacidad paga cada funcionalidad.
--
-- `immutable` y no una tabla: la lista la define el código que llama, no el
-- comercio. Una tabla haría que el mismo dato viviera en dos sitios y que se
-- pudieran separar; aquí, añadir una funcionalidad es una migración, que es
-- exactamente la ceremonia que merece añadir algo que se cobra.
--
-- `null` = no declarada. Quien llama lo trata como denegado.
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_capability_for(p_feature text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case btrim(coalesce(p_feature, ''))
    -- El asistente de compra de la vitrina (P-IA 1).
    when 'assistant'    then 'ai.assist'
    -- Redactar la ficha de un producto en el backoffice.
    when 'catalog.copy' then 'ai.catalog.copy'
    -- Leer los indicadores y decir qué merece atención.
    when 'insights'     then 'ai.insights'
  end;
$fn$;

comment on function ebim.ai_capability_for(text) is
  'Funcionalidad de IA → capacidad contra la que se cobra. null si no está declarada, y entonces se deniega.';

revoke execute on function ebim.ai_capability_for(text) from public, anon;
grant  execute on function ebim.ai_capability_for(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · El consumo, contra la capacidad de SU funcionalidad.
--
-- Copia viva de la función anterior: lo único que cambia son las dos líneas del
-- entitlement. El resto —el `for update` que impide que dos peticiones
-- simultáneas gasten la misma unidad, el bucket de prueba, el periodo mensual—
-- se conserva tal cual.
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

  -- Una funcionalidad sin capacidad declarada NO gasta la de nadie. Se deniega
  -- en vez de caer a `ai.assist`: si alguien anade un uso nuevo y olvida
  -- declararlo, tiene que romperse ruidosamente y no consumir la cuota que la
  -- sociedad contrato para otra cosa.
  if v_capability is null then
    return jsonb_build_object('allowed', false, 'reason', 'FEATURE_NO_DECLARADA', 'status', 'disabled');
  end if;

  -- `company_is_entitled` y NO `has_capability`: aqui no se comprueba
  -- pertenencia. Es deliberado y es lo que hace utilizable esta funcion desde
  -- la vitrina publica, donde quien pregunta es un visitante anonimo que no es
  -- miembro de nada. Lo que se exige es que la SOCIEDAD lo tenga contratado y
  -- sin apagar por flag. La pertenencia la comprueba el envoltorio de JWT, y
  -- por eso esta funcion solo se concede a `service_role`.
  if not ebim.company_is_entitled(v_org, v_company, v_capability) then
    return jsonb_build_object('allowed', false, 'reason', 'DISABLED', 'status', 'disabled');
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
-- 3 · El saldo, con QUÉ está activado dentro.
--
-- `enabled` pasa a significar «tiene alguna IA contratada» y `features` dice
-- cuál. La forma anterior se conserva entera —`plan`, `used`, `quota`,
-- `remaining`, `status`— para que el medidor que ya existe siga funcionando sin
-- tocarlo: lo que se añade es una clave más, no otro contrato.
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
  v_feature  text;
  v_alguna   boolean := false;
begin
  if v_org is null or v_company is null then
    return jsonb_build_object('enabled', false, 'status', 'disabled', 'features', v_features);
  end if;

  -- Que usos tiene contratados, uno por uno. La lista se escribe aqui y no se
  -- deduce: es la misma de `ai_capability_for`, y tenerla en dos sitios es el
  -- precio de no meter una tabla de configuracion por tres valores.
  --
  -- `company_is_entitled` y no `has_capability` por el mismo motivo que en
  -- `ai_consume_for`: la pertenencia se comprueba en el envoltorio de JWT.
  foreach v_feature in array array['assistant', 'catalog.copy', 'insights'] loop
    if ebim.company_is_entitled(v_org, v_company, ebim.ai_capability_for(v_feature)) then
      v_features := v_features || jsonb_build_object(v_feature, true);
      v_alguna   := true;
    else
      v_features := v_features || jsonb_build_object(v_feature, false);
    end if;
  end loop;

  -- La capacidad manda sobre la cuota: sin NINGUNA contratada no hay nada que
  -- medir, y decir «te quedan 25» a quien no tiene nada es peor que decir que
  -- no tiene nada.
  if not v_alguna then
    return jsonb_build_object('enabled', false, 'status', 'disabled', 'features', v_features);
  end if;

  select * into v_quota
  from public.ai_quotas
  where organization_id = v_org and company_id = v_company;

  -- Sin fila de cuota se aplica la de prueba. Contratado sin configurar no
  -- puede significar «sin limite».
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
-- 4 · En qué se va el presupuesto, por módulo.
--
-- Sale de la traza, que ya guardaba `feature`. Es lo que permite tener UN solo
-- presupuesto sin perder de vista quién lo gasta: partir el contador para poder
-- responder esta pregunta habría sido pagar con complejidad algo que ya estaba
-- escrito.
--
-- Cuenta interacciones y tokens, no unidades de cuota: una llamada que falló
-- gasta tokens y hay que verla, y es justo la que no aparece en el contador.
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_usage_by_feature()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
begin
  if v_org is null or v_company is null then
    return '[]'::jsonb;
  end if;

  -- Pertenencia comprobada aquí: sin esto, el gasto de cualquier sociedad
  -- sería legible pasando su uuid. Es la misma guarda que el resto de
  -- envoltorios de JWT de este módulo.
  if not ebim.can_access(v_org, v_company) then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(fila order by fila->>'feature')
      from (
        select jsonb_build_object(
                 'feature',       i.feature,
                 'calls',         count(*)::int,
                 'ok',            count(*) filter (where i.status = 'ai')::int,
                 'degraded',      count(*) filter (where i.status <> 'ai')::int,
                 'input_tokens',  coalesce(sum(i.input_tokens), 0)::bigint,
                 'output_tokens', coalesce(sum(i.output_tokens), 0)::bigint,
                 'last_at',       max(i.created_at)
               ) as fila
          from public.ai_interactions i
         where i.organization_id = v_org and i.company_id = v_company
         group by i.feature
      ) t
    ),
    '[]'::jsonb
  );
end
$fn$;

revoke execute on function ebim.ai_usage_by_feature() from public, anon;
grant  execute on function ebim.ai_usage_by_feature() to authenticated, service_role;

create or replace function public.ai_usage_by_feature()
returns jsonb
language sql
stable
set search_path = ''
as $fn$ select ebim.ai_usage_by_feature(); $fn$;

comment on function public.ai_usage_by_feature() is
  'Gasto de IA de TU sociedad desglosado por modulo. Un presupuesto, muchos usos: esto dice en cual se va.';

revoke execute on function public.ai_usage_by_feature() from public, anon;
grant  execute on function public.ai_usage_by_feature() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5 · Los dos addons nuevos, en el catalogo de la app.
--
-- Sin fila aqui, `company_is_entitled` devuelve falso aunque la sociedad tenga
-- el entitlement: esta tabla es la lista de lo que la app SABE hacer, y el
-- entitlement solo dice si esta sociedad lo compro. Las dos cosas tienen que
-- existir.
--
-- `is_baseline` en falso a proposito: son addons. La IA no entra en el plan
-- base porque cada consulta cuesta dinero a alguien, y un modulo de pago
-- activado por defecto es una factura que nadie decidio.
--
-- El codigo de entitlement tiene que estar dado de alta en el HUB para que una
-- sociedad pueda contratarlo de verdad. Esta migracion deja la app lista; el
-- catalogo comercial lo declara GMAO, que es su dueno.
-- ---------------------------------------------------------------------------
insert into public.app_capabilities (code, boundary, is_baseline, entitlement_code, state)
values
  ('ai.catalog.copy', 'ai', false, 'ecommerce.ai.catalog.copy', 'implemented'),
  ('ai.insights',     'ai', false, 'ecommerce.ai.insights',     'implemented')
on conflict (code) do update
  set boundary = excluded.boundary,
      entitlement_code = excluded.entitlement_code,
      state = excluded.state;
