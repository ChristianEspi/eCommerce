-- =============================================================================
-- La IA como capacidad MEDIDA: entitlement, cuota, consumo y traza.
--
-- Portado del diseno que GMAO ya tiene en produccion (`ai_consume` sobre
-- `platform.ai_usage`), con tres cambios que NO son de estilo:
--
-- 1. **La clave es la del contrato, no un `tenant_id`.** GMAO mide contra su
--    modelo antiguo de tenant unico. Aqui la jerarquia es
--    `organization_id` + `company_id` sacados del JWT, como en toda tabla de
--    negocio de esta app. Copiar la firma de GMAO tal cual habria roto el
--    aislamiento el dia que una cuenta tenga dos sociedades.
--
-- 2. **Se cuentan acciones Y tokens.** GMAO solo cuenta acciones. Es facil de
--    facturar y facil de explicar, pero desacopla el precio del coste: una
--    consulta con cinco documentos largos cuesta mucho mas que clasificar dos
--    lineas, y las dos descuentan uno. La cuota comercial sigue siendo por
--    accion; los tokens estan para saber si esa cuota cubre el gasto.
--
-- 3. **La cuota vive en su propia tabla, no en los entitlements.**
--    `tenant_entitlements` es una CACHE de lo que dice el hub —lleva
--    `synced_at`—, asi que escribir configuracion local ahi es firmar que se
--    pierda en la siguiente sincronizacion.
--
-- ## Lo que esta migracion NO hace
--
-- No decide el precio ni activa nada. `ai.assist` nace como capacidad vendible
-- con su codigo de entitlement ESPERADO (`ecommerce.ai.assist`), igual que las
-- otras veintiuna: el catalogo comercial es del hub (contrato principio 2), y
-- hasta que el hub lo confirme este codigo es lo que esta app espera, no lo que
-- la suite vende.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- La cuota contratada. Configuracion COMERCIAL, no del tenant.
--
-- Sin politica de escritura para `authenticated` a proposito: una sociedad que
-- puede subirse su propia cuota no tiene cuota. La fija el operador (hoy) o el
-- flujo de cobro del hub (manana), y en los dos casos el llamador es servidor.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_quotas (
  organization_id uuid        not null,
  company_id      uuid        not null,
  -- `trial` gasta un bucket de por vida; `active` una cuota que se renueva
  -- cada mes natural. Son dos formas de contar, no dos precios.
  plan            text        not null default 'trial',
  trial_quota     integer     not null default 25,
  monthly_quota   integer     not null default 500,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (organization_id, company_id),
  constraint ai_quotas_plan_chk  check (plan in ('trial', 'active')),
  constraint ai_quotas_trial_chk check (trial_quota   between 0 and 1000000),
  constraint ai_quotas_month_chk check (monthly_quota between 0 and 1000000)
);

create trigger ai_quotas_set_updated_at
  before update on public.ai_quotas
  for each row execute function ebim.set_updated_at();

-- ---------------------------------------------------------------------------
-- El contador. Una fila por sociedad y periodo.
--
-- `period` es 'trial' (bucket de por vida) o 'YYYYMM'. Guardar el periodo en la
-- clave y no una fecha de corte es lo que hace que el reinicio mensual no
-- necesite ningun proceso: al cambiar el mes, la fila del mes nuevo aun no
-- existe y se crea en cero.
--
-- Los tokens son `bigint` porque un tenant activo los cuenta por millones y un
-- `integer` se desborda en un trimestre.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  organization_id   uuid        not null,
  company_id        uuid        not null,
  period            text        not null,
  used              integer     not null default 0,
  input_tokens      bigint      not null default 0,
  output_tokens     bigint      not null default 0,
  -- Se separa de `input_tokens` porque cuesta una decima parte: mezclarlos
  -- esconde justo la metrica que dice si la cache esta funcionando.
  cache_read_tokens bigint      not null default 0,
  -- Cuando esta sociedad empezo a gastar en este periodo. En un contador que se
  -- crea con la primera accion, es la fecha de la primera consulta del mes.
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  primary key (organization_id, company_id, period),
  constraint ai_usage_period_fmt check (period = 'trial' or period ~ '^\d{6}$'),
  constraint ai_usage_used_sign  check (used >= 0)
);

-- ---------------------------------------------------------------------------
-- La traza: que se pregunto, que se respondio y si sirvio.
--
-- Sin esto no se puede auditar por que el sistema dijo lo que dijo, ni mejorar
-- un prompt con datos en vez de con intuicion. Es la misma razon por la que
-- `order_suggestions` guarda su `model_code`.
--
-- El texto entra RECORTADO Y REDACTADO (`ebim.redact_text`): un prompt de
-- compra lleva dentro lo que el comprador escribio, y eso puede ser un correo o
-- un numero de tarjeta. Se guarda un extracto para poder depurar, nunca la
-- conversacion entera.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_interactions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  -- Que funcion la genero: 'assistant', 'catalog.copy', 'planning.reason'...
  feature         text        not null,
  model           text,
  -- `ai` = respondio el modelo. `search` = se degrado y respondio el sistema.
  -- `blocked` = no habia cuota. `error` = el proveedor fallo.
  status          text        not null default 'ai',
  prompt_excerpt  text,
  reply_excerpt   text,
  input_tokens      integer   not null default 0,
  output_tokens     integer   not null default 0,
  cache_read_tokens integer   not null default 0,
  latency_ms      integer,
  -- 1 pulgar arriba, -1 pulgar abajo, null sin opinar. Es la senal barata que
  -- convierte la traza en datos de mejora.
  feedback        smallint,
  correlation_id  text        default ebim.correlation_id(),
  created_by      uuid,
  created_at      timestamptz not null default now(),

  constraint ai_interactions_feature_len check (char_length(btrim(feature)) between 1 and 60),
  constraint ai_interactions_status_chk  check (status in ('ai', 'search', 'blocked', 'error')),
  constraint ai_interactions_feedback_chk check (feedback is null or feedback in (-1, 1)),
  constraint ai_interactions_tenant_key unique (id, organization_id, company_id)
);

create index if not exists ai_interactions_tenant_idx
  on public.ai_interactions (organization_id, company_id, created_at desc);

create index if not exists ai_interactions_feature_idx
  on public.ai_interactions (organization_id, company_id, feature, created_at desc);

-- ---------------------------------------------------------------------------
-- Estado del entitlement. SOLO LECTURA, para el medidor y el muro de pago.
--
-- Devuelve jsonb y no columnas porque quien lo consume es una pantalla y un
-- Edge Function, no una consulta que necesite unir. Nunca escribe: para eso
-- esta `ai_consume`, y separarlos evita que pintar el medidor gaste cuota.
-- ---------------------------------------------------------------------------
-- El nucleo toma la sociedad EXPLICITA. La variante que la saca del JWT es un
-- envoltorio de una linea, mas abajo.
--
-- Existe asi porque el asistente de la VITRINA lo usan visitantes anonimos: no
-- hay JWT del que sacar `org_id`, la sociedad se resuelve por el slug de la
-- tienda. Y es justo el caso que mas hay que medir, porque es el unico que
-- cualquiera en internet puede disparar.
create or replace function ebim.ai_entitlement_for(p_org uuid, p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid := p_org;
  v_company uuid := p_company;
  v_quota   public.ai_quotas;
  v_plan    text;
  v_cap     integer;
  v_period  text;
  v_used    integer;
begin
  if v_org is null or v_company is null then
    return jsonb_build_object('enabled', false, 'status', 'disabled');
  end if;

  -- La capacidad manda sobre la cuota: sin `ai.assist` contratada no hay nada
  -- que medir, y decir «te quedan 25» a quien no lo tiene contratado es peor
  -- que decir que no lo tiene.
  --
  -- `company_is_entitled` y no `has_capability` por el mismo motivo que en
  -- `ai_consume_for`: la pertenencia se comprueba en el envoltorio de JWT.
  if not ebim.company_is_entitled(v_org, v_company, 'ai.assist') then
    return jsonb_build_object('enabled', false, 'status', 'disabled');
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
$fn$;

revoke execute on function ebim.ai_entitlement_for(uuid, uuid) from public, anon, authenticated;
grant  execute on function ebim.ai_entitlement_for(uuid, uuid) to service_role;

/**
 * El saldo de TU sociedad, sacada del JWT. Es lo que llama el medidor.
 *
 * Comprueba pertenencia y delega, igual que `ai_consume`: sin esa comprobacion,
 * el saldo de cualquier sociedad seria legible escribiendo su uuid.
 */
create or replace function ebim.ai_entitlement()
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
    return jsonb_build_object('enabled', false, 'status', 'disabled');
  end if;
  if not ebim.can_access(v_org, v_company) then
    return jsonb_build_object('enabled', false, 'status', 'disabled');
  end if;
  return ebim.ai_entitlement_for(v_org, v_company);
end
$fn$;

revoke execute on function ebim.ai_entitlement() from public;
grant  execute on function ebim.ai_entitlement() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Consumir una accion. Valida y descuenta EN LA MISMA transaccion.
--
-- El `for update` no es prolijidad: sin el, dos peticiones simultaneas leen el
-- mismo `used`, las dos deciden que caben y las dos escriben. Asi es como una
-- cuota de 25 sirve 40 acciones y nadie entiende por que.
--
-- Devuelve `{allowed:false}` en vez de lanzar: quien llama es un Edge Function
-- que tiene que responder 402 con el estado dentro, no un 500.
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_consume_for(
  p_org     uuid,
  p_company uuid,
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
  v_org     uuid := p_org;
  v_company uuid := p_company;
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

  -- `company_is_entitled` y NO `has_capability`: aqui no se comprueba
  -- pertenencia. Es deliberado y es lo que hace utilizable esta funcion desde
  -- la vitrina publica, donde quien pregunta es un visitante anonimo que no es
  -- miembro de nada. Lo que se exige es que la SOCIEDAD lo tenga contratado y
  -- sin apagar por flag. La pertenencia la comprueba el envoltorio de JWT, y
  -- por eso esta funcion solo se concede a `service_role`.
  if not ebim.company_is_entitled(v_org, v_company, 'ai.assist') then
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
$fn$;

-- SOLO `service_role`. Con la sociedad como argumento y sin comprobar
-- pertenencia, conceder esto a `authenticated` seria dejar que cualquiera
-- vacie la cuota de otro tenant escribiendo su uuid.
revoke execute on function ebim.ai_consume_for(uuid, uuid, text, integer) from public, anon, authenticated;
grant  execute on function ebim.ai_consume_for(uuid, uuid, text, integer) to service_role;

/**
 * Gastar de TU sociedad. Comprueba pertenencia y delega.
 *
 * `security definer` para poder llamar al nucleo, que el llamador no tiene
 * concedido. La pertenencia se comprueba AQUI, que es donde hay un JWT del que
 * fiarse.
 */
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
begin
  if v_org is null or v_company is null then
    return jsonb_build_object('allowed', false, 'reason', 'NO_TENANT', 'status', 'disabled');
  end if;
  if not ebim.can_access(v_org, v_company) then
    return jsonb_build_object('allowed', false, 'reason', 'SIN_PERMISO', 'status', 'disabled');
  end if;
  return ebim.ai_consume_for(v_org, v_company, p_feature, p_units);
end
$fn$;

revoke execute on function ebim.ai_consume(text, integer) from public;
grant  execute on function ebim.ai_consume(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registrar lo que paso: la traza y los tokens.
--
-- Va SEPARADA de `ai_consume` porque ocurren en momentos distintos. La cuota se
-- descuenta ANTES de llamar al proveedor —si no, una cuota agotada se descubre
-- despues de haber pagado la llamada—, y los tokens solo se conocen DESPUES,
-- cuando la respuesta trae su `usage`. Unirlas obligaria a adivinar el coste o
-- a cobrar la cuota tarde.
--
-- Suma tokens al periodo VIGENTE. Si el mes cambia entre el consumo y el
-- registro, los tokens caen en el mes nuevo: son unas decenas de tokens al mes
-- y la alternativa es pasear el periodo por toda la pila.
-- ---------------------------------------------------------------------------
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
  p_latency_ms        integer default null
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
begin
  if v_org is null or v_company is null then
    return null;
  end if;

  insert into public.ai_interactions (
    organization_id, company_id, feature, model, status,
    prompt_excerpt, reply_excerpt,
    input_tokens, output_tokens, cache_read_tokens, latency_ms, created_by
  )
  values (
    v_org, v_company, btrim(p_feature), p_model, p_status,
    -- Recortado y redactado en la frontera, no en quien llama: asi ninguna
    -- funcion futura puede olvidarse de hacerlo.
    ebim.redact_text(p_prompt, 500),
    ebim.redact_text(p_reply, 500),
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    greatest(coalesce(p_cache_read_tokens, 0), 0),
    p_latency_ms,
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
  values (
    v_org, v_company, v_period, 0,
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    greatest(coalesce(p_cache_read_tokens, 0), 0)
  )
  on conflict (organization_id, company_id, period) do update
    set input_tokens      = public.ai_usage.input_tokens      + excluded.input_tokens,
        output_tokens     = public.ai_usage.output_tokens     + excluded.output_tokens,
        cache_read_tokens = public.ai_usage.cache_read_tokens + excluded.cache_read_tokens,
        updated_at        = now();

  return v_id;
end
$fn$;

revoke execute on function ebim.ai_record_for(uuid, uuid, text, text, text, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant  execute on function ebim.ai_record_for(uuid, uuid, text, text, text, text, text, integer, integer, integer, integer)
  to service_role;

/** Dejar traza en TU sociedad. Comprueba pertenencia y delega. */
create or replace function ebim.ai_record(
  p_feature           text,
  p_status            text,
  p_model             text    default null,
  p_prompt            text    default null,
  p_reply             text    default null,
  p_input_tokens      integer default 0,
  p_output_tokens     integer default 0,
  p_cache_read_tokens integer default 0,
  p_latency_ms        integer default null
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
begin
  if v_org is null or v_company is null then return null; end if;
  if not ebim.can_access(v_org, v_company) then return null; end if;
  return ebim.ai_record_for(v_org, v_company, p_feature, p_status, p_model, p_prompt, p_reply,
                            p_input_tokens, p_output_tokens, p_cache_read_tokens, p_latency_ms);
end
$fn$;

revoke execute on function ebim.ai_record(text, text, text, text, text, integer, integer, integer, integer) from public;
grant  execute on function ebim.ai_record(text, text, text, text, text, integer, integer, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El pulgar. Unica escritura que hace un usuario sobre la traza.
--
-- Por funcion y no por policy de UPDATE: una policy dejaria escribir CUALQUIER
-- columna de la fila a quien pueda verla, incluidos los tokens y el modelo. Lo
-- unico que puede cambiar una persona es su opinion.
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
  v_rows    integer;
begin
  if v_org is null or v_company is null then return false; end if;
  if p_value is not null and p_value not in (-1, 1) then return false; end if;

  update public.ai_interactions
     set feedback = p_value
   where id = p_interaction
     and organization_id = v_org
     and company_id = v_company;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$fn$;

revoke execute on function ebim.ai_feedback(uuid, smallint) from public;
grant  execute on function ebim.ai_feedback(uuid, smallint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: default deny en las tres.
--
-- `ai_quotas` y `ai_usage` se quedan SIN policy para `authenticated`: son el
-- plano de cobro. Se leen por `ebim.ai_entitlement()`, que es `security
-- definer` y solo devuelve el estado de TU sociedad. Dar SELECT directo sobre
-- el contador no aporta nada que el medidor no diga, y da una superficie mas.
--
-- `ai_interactions` si es legible, pero solo por quien administra el espacio:
-- la traza lleva dentro el texto que escribio una persona.
-- ---------------------------------------------------------------------------
alter table public.ai_quotas       enable row level security;
alter table public.ai_quotas       force  row level security;
alter table public.ai_usage        enable row level security;
alter table public.ai_usage        force  row level security;
alter table public.ai_interactions enable row level security;
alter table public.ai_interactions force  row level security;

revoke all on public.ai_quotas, public.ai_usage, public.ai_interactions from public;
grant select on public.ai_interactions to authenticated;
grant all on public.ai_quotas, public.ai_usage, public.ai_interactions to service_role;

drop policy if exists ai_interactions_select_admin on public.ai_interactions;
create policy ai_interactions_select_admin on public.ai_interactions
  for select to authenticated
  using (
    ebim.can_access(organization_id, company_id)
    and ebim.has_role(organization_id, company_id, array['owner','admin']::public.app_role[])
  );

-- ---------------------------------------------------------------------------
-- Envoltorios en `public`: la unica puerta que PostgREST ve.
--
-- Las funciones de arriba viven en `ebim`, que NO esta expuesto. Sin estos
-- envoltorios, `rpc('ai_consume')` desde el navegador o desde una Edge Function
-- devuelve «function not found» y el fallo se lee como un problema de permisos
-- cuando en realidad es de enrutado (mismo tropiezo que `suggest_order`,
-- migracion 20260902220000).
--
-- `anon` queda fuera a proposito: la vitrina publica llama al asistente a
-- traves de su Edge Function, que es quien tiene la clave del proveedor. Dar
-- EXECUTE a `anon` seria dejar que un visitante gaste la cuota del tenant.
-- ---------------------------------------------------------------------------
create or replace function public.ai_entitlement()
returns jsonb
language sql
stable
set search_path = ''
as $fn$ select ebim.ai_entitlement(); $fn$;

revoke execute on function public.ai_entitlement() from public, anon;
grant  execute on function public.ai_entitlement() to authenticated, service_role;

create or replace function public.ai_consume(p_feature text default 'ai', p_units integer default 1)
returns jsonb
language sql
volatile
set search_path = ''
as $fn$ select ebim.ai_consume(p_feature, p_units); $fn$;

revoke execute on function public.ai_consume(text, integer) from public, anon;
grant  execute on function public.ai_consume(text, integer) to authenticated, service_role;

create or replace function public.ai_record(
  p_feature           text,
  p_status            text,
  p_model             text    default null,
  p_prompt            text    default null,
  p_reply             text    default null,
  p_input_tokens      integer default 0,
  p_output_tokens     integer default 0,
  p_cache_read_tokens integer default 0,
  p_latency_ms        integer default null
)
returns uuid
language sql
volatile
set search_path = ''
as $fn$
  select ebim.ai_record(p_feature, p_status, p_model, p_prompt, p_reply,
                        p_input_tokens, p_output_tokens, p_cache_read_tokens, p_latency_ms);
$fn$;

revoke execute on function public.ai_record(text, text, text, text, text, integer, integer, integer, integer)
  from public, anon;
grant  execute on function public.ai_record(text, text, text, text, text, integer, integer, integer, integer)
  to authenticated, service_role;

create or replace function public.ai_feedback(p_interaction uuid, p_value smallint)
returns boolean
language sql
volatile
set search_path = ''
as $fn$ select ebim.ai_feedback(p_interaction, p_value); $fn$;

revoke execute on function public.ai_feedback(uuid, smallint) from public, anon;
grant  execute on function public.ai_feedback(uuid, smallint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La vitrina: la sociedad sale del SLUG, no de un JWT que no existe.
--
-- El asistente de compra lo dispara un visitante anonimo. Sin estas dos, la
-- unica salida habria sido no medirlo, y es exactamente el caso que mas hay que
-- medir: es el unico que cualquiera en internet puede disparar en bucle.
--
-- `service_role` y nada mas. Quien las llama es la Edge Function del asistente,
-- que es tambien quien tiene la clave del proveedor. El navegador no las ve.
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
  return ebim.ai_consume_for(v_store.organization_id, v_store.company_id, p_feature, p_units);
end
$fn$;

revoke execute on function public.ai_consume_for_store(text, text, integer)
  from public, anon, authenticated;
grant  execute on function public.ai_consume_for_store(text, text, integer) to service_role;

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
  p_latency_ms        integer default null
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
                            p_input_tokens, p_output_tokens, p_cache_read_tokens, p_latency_ms);
end
$fn$;

revoke execute on function public.ai_record_for_store(text, text, text, text, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant  execute on function public.ai_record_for_store(text, text, text, text, text, text, integer, integer, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- El catalogo de esta app: que sabe hacer, y bajo que codigo lo espera del hub.
-- ---------------------------------------------------------------------------
insert into public.app_capabilities (code, boundary, is_baseline, entitlement_code, state)
values ('ai.assist', 'ai', false, 'ecommerce.ai.assist', 'implemented')
on conflict (code) do update
  set boundary = excluded.boundary,
      entitlement_code = excluded.entitlement_code,
      state = excluded.state;

comment on table public.ai_usage is
  'Contador por sociedad y periodo. Acciones para facturar, tokens para saber si la factura cubre el coste.';
comment on table public.ai_quotas is
  'Cuota CONTRATADA. Sin escritura para el tenant: quien puede subirse su cuota no tiene cuota.';
comment on table public.ai_interactions is
  'Traza de IA con texto recortado y redactado. Legible solo por quien administra el espacio.';
comment on function ebim.ai_consume(text, integer) is
  'Valida y descuenta en la misma transaccion. El `for update` es lo que impide servir de mas en concurrencia.';
