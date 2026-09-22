-- =============================================================================
-- Núcleo común de IA (EBIM_AI_SEQUENCE, fase 01).
--
-- Cierra la deuda D2/D3/D6/D7/D8 de `docs/AI_IMPLEMENTATION_STATE.md`:
--
--  1. Registro de funcionalidades por MÓDULO. Cada una declara la capacidad de
--     IA que paga, el módulo que además exige y los roles que pueden gastar
--     cuota. Copia SQL de `supabase/functions/_shared/aiCore.ts`
--     (`AI_FEATURES`); `supabase/tests/ai-core.test.ts` las compara.
--  2. `ai_consume` (JWT) exige ROL además de pertenencia (D6) y el consumo
--     exige el MÓDULO contratado: la IA de cobranza no existe sin cobranza.
--  3. `ai_record` (JWT) solo deja traza canjeando un TICKET emitido por
--     `ai_consume` para el mismo usuario y funcionalidad (D7): desde el
--     navegador ya no se pueden fabricar trazas ni inflar tokens sin gastar
--     una unidad de cuota por cada una.
--  4. La traza guarda el tipo de fallo (`error_kind`, D3) y devuelve su id
--     para el pulgar en contexto (D8).
--  5. El pulgar lo pone quien generó la respuesta o quien administra.
--  6. Capacidad `ai.content` DECLARADA (redacción de contenido publicable:
--     promociones, CMS, respuestas a reseñas). El código comercial
--     `ecommerce.ai.content` lo tiene que dar de alta el hub (GMAO).
--
-- Nada de esto cambia la forma de las respuestas que ya existían: se añaden
-- claves (`ticket`, `features` más largo), no se quitan.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Registro de funcionalidades
-- ---------------------------------------------------------------------------

/** Lista cerrada de funcionalidades, en orden estable. */
create or replace function ebim.ai_features()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array[
    'assistant', 'catalog.copy', 'insights',
    'orders', 'inventory', 'planning', 'customers', 'sales', 'quotes',
    'credit', 'payments', 'fulfillment', 'operations', 'integrations',
    'content', 'promotions', 'reviews'
  ]::text[];
$fn$;

comment on function ebim.ai_features() is
  'Funcionalidades de IA declaradas. Copia de AI_FEATURES (_shared/aiCore.ts).';

create or replace function ebim.ai_capability_for(p_feature text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case btrim(coalesce(p_feature, ''))
    when 'assistant'    then 'ai.assist'
    when 'catalog.copy' then 'ai.catalog.copy'
    -- Explicar lo que YA calculó la base: análisis y alertas.
    when 'insights'     then 'ai.insights'
    when 'orders'       then 'ai.insights'
    when 'inventory'    then 'ai.insights'
    when 'planning'     then 'ai.insights'
    when 'customers'    then 'ai.insights'
    when 'sales'        then 'ai.insights'
    when 'quotes'       then 'ai.insights'
    when 'credit'       then 'ai.insights'
    when 'payments'     then 'ai.insights'
    when 'fulfillment'  then 'ai.insights'
    when 'operations'   then 'ai.insights'
    when 'integrations' then 'ai.insights'
    -- Redactar contenido publicable (siempre como borrador).
    when 'content'      then 'ai.content'
    when 'promotions'   then 'ai.content'
    when 'reviews'      then 'ai.content'
  end;
$fn$;

/**
 * El módulo que la funcionalidad exige contratado. `null` = sin módulo propio
 * (operaciones e integraciones son del tenant, no un addon).
 */
create or replace function ebim.ai_module_capability_for(p_feature text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case btrim(coalesce(p_feature, ''))
    when 'assistant'    then 'storefront'
    when 'catalog.copy' then 'catalog'
    when 'insights'     then 'analytics.basic'
    when 'orders'       then 'orders'
    when 'inventory'    then 'inventory.multiwarehouse'
    when 'planning'     then 'planning.demand'
    when 'customers'    then 'customers'
    when 'sales'        then 'sales.force'
    when 'quotes'       then 'trade.quotes'
    when 'credit'       then 'credit.management'
    when 'payments'     then 'payments'
    when 'fulfillment'  then 'fulfillment'
    when 'content'      then 'content.cms'
    when 'promotions'   then 'promotions'
    when 'reviews'      then 'catalog'
  end;
$fn$;

/**
 * Qué roles pueden GASTAR cuota por JWT en cada funcionalidad. Espejo de
 * quién puede leer los datos del módulo; lo que el modelo ve lo sigue
 * decidiendo la RLS del usuario. `null` = no declarada.
 */
create or replace function ebim.ai_feature_roles(p_feature text)
returns public.app_role[]
language sql
immutable
set search_path = ''
as $fn$
  select (case btrim(coalesce(p_feature, ''))
    when 'assistant'    then array['owner','admin']
    when 'catalog.copy' then array['owner','admin','catalog']
    when 'insights'     then array['owner','admin']
    when 'orders'       then array['owner','admin','orders','viewer']
    when 'inventory'    then array['owner','admin','catalog','orders','viewer']
    when 'planning'     then array['owner','admin','catalog','orders']
    when 'customers'    then array['owner','admin','orders','viewer','sales_rep']
    when 'sales'        then array['owner','admin','sales_rep']
    when 'quotes'       then array['owner','admin','orders','sales_rep']
    when 'credit'       then array['owner','admin']
    when 'payments'     then array['owner','admin','orders']
    when 'fulfillment'  then array['owner','admin','orders']
    when 'operations'   then array['owner','admin']
    when 'integrations' then array['owner','admin']
    when 'content'      then array['owner','admin']
    when 'promotions'   then array['owner','admin']
    when 'reviews'      then array['owner','admin','catalog']
  end)::public.app_role[];
$fn$;

revoke execute on function ebim.ai_features()                   from public, anon;
revoke execute on function ebim.ai_module_capability_for(text)  from public, anon;
revoke execute on function ebim.ai_feature_roles(text)          from public, anon;
grant  execute on function ebim.ai_features()                   to authenticated, service_role;
grant  execute on function ebim.ai_module_capability_for(text)  to authenticated, service_role;
grant  execute on function ebim.ai_feature_roles(text)          to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · Tickets: lo que une un consumo con SU traza
--
-- Plano de cobro: sin policy para nadie más que `service_role`. Se escriben y
-- se canjean solo dentro de `ai_consume` / `ai_record` (security definer).
-- ---------------------------------------------------------------------------
create table if not exists public.ai_tickets (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  feature         text        not null,
  user_id         uuid        not null,
  created_at      timestamptz not null default now(),
  redeemed_at     timestamptz,
  constraint ai_tickets_feature_len check (char_length(btrim(feature)) between 1 and 60)
);

create index if not exists ai_tickets_open_idx
  on public.ai_tickets (organization_id, company_id, user_id, feature, created_at)
  where redeemed_at is null;

-- Fase 12: el freno por persona de `ai_consume` y la purga diaria miran por
-- fecha, canjeados o no.
create index if not exists ai_tickets_user_recent_idx
  on public.ai_tickets (user_id, created_at);

alter table public.ai_tickets enable row level security;
alter table public.ai_tickets force  row level security;
revoke all on public.ai_tickets from public, anon, authenticated;
grant  all on public.ai_tickets to service_role;

comment on table public.ai_tickets is
  'Un consumo de IA por JWT emite un ticket; ai_record solo registra canjeándolo. Plano de cobro: sin acceso de usuario.';

-- ---------------------------------------------------------------------------
-- 3 · Tipo de fallo en la traza
-- ---------------------------------------------------------------------------
alter table public.ai_interactions add column if not exists error_kind text;

alter table public.ai_interactions drop constraint if exists ai_interactions_error_kind_chk;
alter table public.ai_interactions add constraint ai_interactions_error_kind_chk check (
  error_kind is null or error_kind in (
    'sin_proveedor', 'sin_contratar', 'sin_cuota', 'sin_permiso', 'modulo_no_contratado',
    'no_declarada', 'timeout', 'rate_limit', 'proveedor', 'refusal', 'truncado',
    'esquema', 'vacia', 'bloqueada'
  )
);

-- ---------------------------------------------------------------------------
-- 4 · Consumo: capacidad de IA + MÓDULO + cuota (núcleo de servidor)
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
-- 5 · Consumo por JWT: pertenencia + ROL, y emite ticket
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_consume(
  p_feature text default 'ai',
  p_units   integer default 1
)
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
  v_roles   public.app_role[] := ebim.ai_feature_roles(p_feature);
  v_result  jsonb;
  v_ticket  uuid;
begin
  if v_org is null or v_company is null or v_user is null then
    return jsonb_build_object('allowed', false, 'reason', 'NO_TENANT', 'status', 'disabled');
  end if;
  if not ebim.can_access(v_org, v_company) then
    return jsonb_build_object('allowed', false, 'reason', 'SIN_PERMISO', 'status', 'disabled');
  end if;
  -- No declarada: se deja al núcleo, que la deniega con su motivo propio.
  if v_roles is not null and not ebim.has_role(v_org, v_company, v_roles) then
    return jsonb_build_object('allowed', false, 'reason', 'SIN_PERMISO', 'status', 'disabled');
  end if;

  -- Fase 12 · esta función es alcanzable desde el navegador (PostgREST con el
  -- JWT del usuario), así que no puede aceptar lo que solo tiene sentido en
  -- el servidor:
  --  · Una llamada al modelo = UNA unidad. Con `p_units` libre, cualquier rol
  --    de la funcionalidad vaciaba la cuota de la sociedad de un golpe.
  if p_units is distinct from 1 then
    return jsonb_build_object('allowed', false, 'reason', 'BAD_UNITS', 'status', 'disabled');
  end if;

  --  · Freno por persona: más de 30 consumos en un minuto no es una persona
  --    usando la IA, es un bucle. Se deniega sin gastar.
  if (select count(*) from public.ai_tickets t
       where t.organization_id = v_org and t.company_id = v_company
         and t.user_id = v_user and t.created_at > now() - interval '1 minute') >= 30 then
    return jsonb_build_object('allowed', false, 'reason', 'RATE_LIMITED', 'status', 'disabled');
  end if;

  --  · Los tickets son plano de cobro, no histórico (la traza vive en
  --    `ai_interactions`): pasado un día ya no se pueden canjear y se purgan.
  delete from public.ai_tickets where created_at < now() - interval '1 day';

  v_result := ebim.ai_consume_for(v_org, v_company, p_feature, p_units);

  if coalesce((v_result->>'allowed')::boolean, false) then
    insert into public.ai_tickets (organization_id, company_id, feature, user_id)
    values (v_org, v_company, btrim(p_feature), v_user)
    returning id into v_ticket;
    v_result := v_result || jsonb_build_object('ticket', v_ticket);
  end if;

  return v_result;
end
$fn$;

revoke execute on function ebim.ai_consume(text, integer) from public, anon;
grant  execute on function ebim.ai_consume(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6 · Traza con tipo de fallo, tokens acotados
--
-- Cambia la firma (nuevo `p_error_kind`), así que se borran las viejas para no
-- dejar dos sobrecargas ambiguas. Orden: primero los envoltorios.
-- ---------------------------------------------------------------------------
drop function if exists public.ai_record(text, text, text, text, text, integer, integer, integer, integer);
drop function if exists public.ai_record_for_store(text, text, text, text, text, text, integer, integer, integer, integer);
drop function if exists ebim.ai_record(text, text, text, text, text, integer, integer, integer, integer);
drop function if exists ebim.ai_record_for(uuid, uuid, text, text, text, text, text, integer, integer, integer, integer);

create or replace function ebim.ai_record_for(
  p_org               uuid,
  p_company           uuid,
  p_feature           text,
  p_status            text,
  p_model             text    default null,
  p_prompt            text    default null,
  p_reply             text    default null,
  p_input_tokens      integer default 0,
  p_output_tokens     integer default 0,
  p_cache_read_tokens integer default 0,
  p_latency_ms        integer default null,
  p_error_kind        text    default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid := p_org;
  v_company uuid := p_company;
  v_period  text;
  v_plan    text;
  v_id      uuid;
  -- Tope defensivo: lo que se suma al contador de cobro no puede ser un
  -- número arbitrario. Mismo valor que AI_MAX_TOKENS_TRAZA en aiCore.ts.
  v_in      integer := least(greatest(coalesce(p_input_tokens, 0), 0), 1000000);
  v_out     integer := least(greatest(coalesce(p_output_tokens, 0), 0), 1000000);
  v_cache   integer := least(greatest(coalesce(p_cache_read_tokens, 0), 0), 1000000);
begin
  if v_org is null or v_company is null then
    return null;
  end if;
  -- Solo funcionalidades declaradas: la traza también es plano de cobro.
  if ebim.ai_capability_for(p_feature) is null then
    return null;
  end if;

  insert into public.ai_interactions (
    organization_id, company_id, feature, model, status, error_kind,
    prompt_excerpt, reply_excerpt,
    input_tokens, output_tokens, cache_read_tokens, latency_ms, created_by
  )
  values (
    v_org, v_company, btrim(p_feature), left(p_model, 80), p_status,
    -- Un tipo desconocido no rompe la traza: se guarda sin tipo.
    case when p_error_kind in (
      'sin_proveedor', 'sin_contratar', 'sin_cuota', 'sin_permiso', 'modulo_no_contratado',
      'no_declarada', 'timeout', 'rate_limit', 'proveedor', 'refusal', 'truncado',
      'esquema', 'vacia', 'bloqueada') then p_error_kind end,
    ebim.redact_text(p_prompt, 500),
    ebim.redact_text(p_reply, 500),
    v_in, v_out, v_cache,
    case when p_latency_ms is null then null else least(greatest(p_latency_ms, 0), 600000) end,
    ebim.user_id()
  )
  returning id into v_id;

  select coalesce(plan, 'trial') into v_plan
  from public.ai_quotas
  where organization_id = v_org and company_id = v_company;
  v_period := case when coalesce(v_plan, 'trial') = 'trial' then 'trial'
                   else to_char(now(), 'YYYYMM') end;

  insert into public.ai_usage (
    organization_id, company_id, period, used,
    input_tokens, output_tokens, cache_read_tokens
  )
  values (v_org, v_company, v_period, 0, v_in, v_out, v_cache)
  on conflict (organization_id, company_id, period) do update
    set input_tokens      = public.ai_usage.input_tokens      + excluded.input_tokens,
        output_tokens     = public.ai_usage.output_tokens     + excluded.output_tokens,
        cache_read_tokens = public.ai_usage.cache_read_tokens + excluded.cache_read_tokens,
        updated_at        = now();

  return v_id;
end
$fn$;

revoke execute on function ebim.ai_record_for(uuid, uuid, text, text, text, text, text, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant  execute on function ebim.ai_record_for(uuid, uuid, text, text, text, text, text, integer, integer, integer, integer, text)
  to service_role;

/**
 * Traza por JWT: canjea el ticket abierto más antiguo de ESTE usuario para
 * ESTA funcionalidad (vigencia 15 minutos). Sin ticket no hay traza: así una
 * traza cuesta siempre una unidad de cuota y no se puede fabricar desde fuera.
 */
create or replace function ebim.ai_record(
  p_feature           text,
  p_status            text,
  p_model             text    default null,
  p_prompt            text    default null,
  p_reply             text    default null,
  p_input_tokens      integer default 0,
  p_output_tokens     integer default 0,
  p_cache_read_tokens integer default 0,
  p_latency_ms        integer default null,
  p_error_kind        text    default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_user    uuid := ebim.user_id();
  v_ticket  uuid;
begin
  if v_org is null or v_company is null or v_user is null then return null; end if;
  if not ebim.can_access(v_org, v_company) then return null; end if;

  select t.id into v_ticket
    from public.ai_tickets t
   where t.organization_id = v_org
     and t.company_id      = v_company
     and t.user_id         = v_user
     and t.feature         = btrim(p_feature)
     and t.redeemed_at is null
     and t.created_at > now() - interval '15 minutes'
   order by t.created_at
   limit 1
   for update skip locked;

  if v_ticket is null then return null; end if;

  update public.ai_tickets set redeemed_at = now() where id = v_ticket;

  -- Fase 12 · topes de la ruta JWT, más bajos que los del servidor: el
  -- llamador puede ser el navegador. Una pregunta real (el Copilot suma dos
  -- llamadas de ≤4096 tokens de salida) cabe de sobra; inflar los contadores
  -- de cobro de la propia sociedad con un ticket, no.
  return ebim.ai_record_for(v_org, v_company, p_feature, p_status, p_model, p_prompt, p_reply,
                            least(greatest(coalesce(p_input_tokens, 0), 0), 200000),
                            least(greatest(coalesce(p_output_tokens, 0), 0), 16000),
                            least(greatest(coalesce(p_cache_read_tokens, 0), 0), 200000),
                            p_latency_ms, p_error_kind);
end
$fn$;

revoke execute on function ebim.ai_record(text, text, text, text, text, integer, integer, integer, integer, text) from public, anon;
grant  execute on function ebim.ai_record(text, text, text, text, text, integer, integer, integer, integer, text)
  to authenticated, service_role;

create or replace function public.ai_record(
  p_feature           text,
  p_status            text,
  p_model             text    default null,
  p_prompt            text    default null,
  p_reply             text    default null,
  p_input_tokens      integer default 0,
  p_output_tokens     integer default 0,
  p_cache_read_tokens integer default 0,
  p_latency_ms        integer default null,
  p_error_kind        text    default null
)
returns uuid
language sql
volatile
set search_path = ''
as $fn$
  select ebim.ai_record(p_feature, p_status, p_model, p_prompt, p_reply,
                        p_input_tokens, p_output_tokens, p_cache_read_tokens, p_latency_ms,
                        p_error_kind);
$fn$;

revoke execute on function public.ai_record(text, text, text, text, text, integer, integer, integer, integer, text)
  from public, anon;
grant  execute on function public.ai_record(text, text, text, text, text, integer, integer, integer, integer, text)
  to authenticated, service_role;

create or replace function public.ai_record_for_store(
  p_store_slug        text,
  p_feature           text,
  p_status            text,
  p_model             text    default null,
  p_prompt            text    default null,
  p_reply             text    default null,
  p_input_tokens      integer default 0,
  p_output_tokens     integer default 0,
  p_cache_read_tokens integer default 0,
  p_latency_ms        integer default null,
  p_error_kind        text    default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  v_store := ebim.active_store_by_slug(p_store_slug);
  return ebim.ai_record_for(v_store.organization_id, v_store.company_id, p_feature, p_status,
                            p_model, p_prompt, p_reply,
                            p_input_tokens, p_output_tokens, p_cache_read_tokens, p_latency_ms,
                            p_error_kind);
end
$fn$;

revoke execute on function public.ai_record_for_store(text, text, text, text, text, text, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant  execute on function public.ai_record_for_store(text, text, text, text, text, text, integer, integer, integer, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7 · El pulgar: quien generó la respuesta, o quien administra
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_feedback(p_interaction uuid, p_value smallint)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_user    uuid := ebim.user_id();
  v_admin   boolean;
  v_rows    integer;
begin
  if v_org is null or v_company is null then return false; end if;
  if not ebim.can_access(v_org, v_company) then return false; end if;
  if p_value is not null and p_value not in (-1, 1) then return false; end if;

  v_admin := ebim.has_role(v_org, v_company, array['owner','admin']::public.app_role[]);

  update public.ai_interactions
     set feedback = p_value
   where id = p_interaction
     and organization_id = v_org
     and company_id = v_company
     and (v_admin or created_by = v_user);

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$fn$;

revoke execute on function ebim.ai_feedback(uuid, smallint) from public, anon;
grant  execute on function ebim.ai_feedback(uuid, smallint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8 · El saldo, con TODAS las funcionalidades declaradas
--
-- Igual que antes; la lista sale de `ebim.ai_features()` en vez de estar
-- escrita a mano, y `features` dice si la funcionalidad está USABLE: capacidad
-- de IA + módulo. El rol no entra: el saldo es de la sociedad, no de la persona
-- (el front lo cruza con el rol para la UX).
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
  v_module   text;
  v_on       boolean;
  v_alguna   boolean := false;
begin
  if v_org is null or v_company is null then
    return jsonb_build_object('enabled', false, 'status', 'disabled', 'features', v_features);
  end if;

  foreach v_feature in array ebim.ai_features() loop
    v_module := ebim.ai_module_capability_for(v_feature);
    v_on := ebim.company_is_entitled(v_org, v_company, ebim.ai_capability_for(v_feature))
            and (v_module is null or ebim.company_is_entitled(v_org, v_company, v_module));
    v_features := v_features || jsonb_build_object(v_feature, v_on);
    v_alguna := v_alguna or v_on;
  end loop;

  if not v_alguna then
    return jsonb_build_object('enabled', false, 'status', 'disabled', 'features', v_features);
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
-- 9 · Capacidad declarada para la redacción de contenido
-- ---------------------------------------------------------------------------
insert into public.app_capabilities (code, boundary, is_baseline, entitlement_code, state)
values ('ai.content', 'ai', false, 'ecommerce.ai.content', 'declared')
on conflict (code) do update
  set boundary = excluded.boundary,
      entitlement_code = excluded.entitlement_code,
      state = excluded.state;

-- ---------------------------------------------------------------------------
-- 10 · Freno de la vitrina (fase 12, deuda D9)
--
-- `shopping-assistant` lo dispara cualquiera con la clave publicable. Hasta
-- aquí solo lo frenaba la cuota del tenant: un bucle anónimo la vaciaba y el
-- comercio se enteraba por el medidor. Ahora, antes de consumir, un techo por
-- TIENDA y hora con la infraestructura de límites públicos que ya usan cupones,
-- reseñas y pedido rápido (`public_rate_*`, configurable por tienda en
-- `store_settings.config.rate_limits.ai.assistant`; `0` lo desactiva).
--
-- Se cuenta cada intento que llega a consumir, se permita o no: el que insiste
-- sobre una tienda sin cuota también es el bucle que se quiere frenar. Al
-- saltar, se deniega con `RATE_LIMITED` y la función degrada a la búsqueda
-- determinista («degradar, no negar»), sin gastar.
-- ---------------------------------------------------------------------------
create or replace function public.ai_consume_for_store(
  p_store_slug text,
  p_feature    text default 'ai',
  p_units      integer default 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  -- Levanta TIENDA_NO_DISPONIBLE si el slug no existe o la tienda no esta
  -- activa. Una tienda apagada no gasta cuota.
  v_store := ebim.active_store_by_slug(p_store_slug);

  if ebim.public_rate_exceeded(v_store.id, 'ai.assistant', 300) then
    return jsonb_build_object('allowed', false, 'reason', 'RATE_LIMITED', 'status', 'disabled');
  end if;
  perform ebim.public_rate_record(v_store.id, 'ai.assistant', 1, 300);

  return ebim.ai_consume_for(v_store.organization_id, v_store.company_id, p_feature, p_units);
end
$fn$;

revoke execute on function public.ai_consume_for_store(text, text, integer)
  from public, anon, authenticated;
grant  execute on function public.ai_consume_for_store(text, text, integer) to service_role;
