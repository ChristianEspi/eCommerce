-- =============================================================================
-- IA · Acciones propuestas con aprobación (2026-11-19)
--
-- ## De «explica» a «propone y ejecuta con tu aprobación»
--
-- Hasta hoy ninguna salida de la IA escribe: sugiere, y una persona rehace a
-- mano lo sugerido. Esto añade el paso que faltaba sin abrir ninguna puerta:
--
--   1. Alguien que usa la IA convierte una sugerencia en una PROPUESTA de
--      acción ya armada (`ai_action_propose`): tipo de LISTA CERRADA, datos
--      validados aquí, en la base, contra su sociedad.
--   2. Quien tiene el rol de esa acción la revisa en la bandeja y la APRUEBA o
--      la RECHAZA (`ai_action_decide`). Aprobar ejecuta el comando de siempre
--      —con las mismas reglas que si lo hiciera a mano— y queda el rastro de
--      quién propuso, quién aprobó, cuándo y qué resultó.
--
-- La IA sigue sin escribir: escribe la persona que aprueba. Lo nuevo es que ya
-- no tiene que rehacer el trabajo.
--
-- ## Acciones de esta versión
--
--  · `promotion.create_draft` — una campaña de porcentaje sobre productos
--    concretos, en BORRADOR. Nunca activa: activarla sigue siendo una decisión
--    aparte en Promociones.
--  · `review.moderate` — publicar o rechazar una reseña pendiente, con el
--    comando de moderación de siempre (`moderate_product_review`).
--
-- Añadir un tipo es: validador en `ai_action_propose`, ejecutor en
-- `ebim.ai_action_execute`, roles en `ebim.ai_action_roles`. Nada más.
-- =============================================================================

create or replace function ebim.ai_action_kinds()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array['promotion.create_draft', 'review.moderate']::text[];
$fn$;

/** Quién puede PROPONER y APROBAR cada tipo: los mismos que hacen la acción a mano. */
create or replace function ebim.ai_action_roles(p_kind text)
returns public.app_role[]
language sql
immutable
set search_path = ''
as $fn$
  select (case p_kind
    when 'promotion.create_draft' then array['owner','admin']
    when 'review.moderate'        then array['owner','admin','catalog']
  end)::public.app_role[];
$fn$;

revoke execute on function ebim.ai_action_kinds()      from public, anon;
revoke execute on function ebim.ai_action_roles(text)  from public, anon;
grant  execute on function ebim.ai_action_kinds()      to authenticated, service_role;
grant  execute on function ebim.ai_action_roles(text)  to authenticated, service_role;

create table if not exists public.ai_action_proposals (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  store_id        uuid,
  kind            text        not null,
  title           text        not null,
  rationale       text,
  payload         jsonb       not null,
  source_feature  text,
  interaction_id  uuid,
  status          text        not null default 'pending',
  proposed_by     uuid        not null,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  result          jsonb,
  error_code      text,
  expires_at      timestamptz not null default now() + interval '14 days',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ai_action_proposals_kind check (kind = any (ebim.ai_action_kinds())),
  constraint ai_action_proposals_status check (status in ('pending', 'executed', 'rejected', 'failed', 'expired')),
  constraint ai_action_proposals_title_len check (char_length(btrim(title)) between 3 and 160),
  constraint ai_action_proposals_rationale_len check (rationale is null or char_length(rationale) <= 600),
  constraint ai_action_proposals_note_len check (decision_note is null or char_length(decision_note) <= 500),
  -- Decidida ⇔ con quién y cuándo. Una propuesta «ejecutada» sin aprobador es
  -- justo lo que esta tabla existe para que no pueda pasar.
  constraint ai_action_proposals_decided check (
    (status in ('pending', 'expired')) = (decided_by is null and decided_at is null)
  ),
  constraint ai_action_proposals_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index if not exists ai_action_proposals_tenant_idx
  on public.ai_action_proposals (organization_id, company_id, status, created_at desc);

drop trigger if exists ai_action_proposals_updated_at on public.ai_action_proposals;
create trigger ai_action_proposals_updated_at
  before update on public.ai_action_proposals
  for each row execute function ebim.set_updated_at();

alter table public.ai_action_proposals enable row level security;
alter table public.ai_action_proposals force  row level security;

-- Sin escritura directa: las propuestas nacen y se deciden SOLO por comandos.
revoke all on public.ai_action_proposals from public, anon, authenticated;
grant select on public.ai_action_proposals to authenticated;
grant all on public.ai_action_proposals to service_role;

drop policy if exists ai_action_proposals_select on public.ai_action_proposals;
create policy ai_action_proposals_select on public.ai_action_proposals
  for select to authenticated
  using (
    organization_id = ebim.org_id()
    and company_id = any (ebim.companies())
    and ebim.has_role(organization_id, company_id, ebim.ai_action_roles(kind))
  );

-- ---------------------------------------------------------------------------
-- Proponer
-- ---------------------------------------------------------------------------
create or replace function public.ai_action_propose(
  p_kind           text,
  p_store_id       uuid,
  p_title          text,
  p_rationale      text,
  p_payload        jsonb,
  p_source_feature text default null,
  p_interaction_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user    uuid := ebim.user_id();
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_clean   jsonb;
  v_id      uuid;
  v_pct     numeric;
  v_from    timestamptz;
  v_to      timestamptz;
  v_ids     uuid[];
  v_review  public.product_reviews%rowtype;
  v_reason  text;
begin
  if v_user is null or v_org is null or v_company is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion con sociedad activa' using errcode = '42501';
  end if;
  if not (p_kind = any (ebim.ai_action_kinds())) then
    raise exception 'ACCION_DESCONOCIDA: %', coalesce(p_kind, '') using errcode = '22023';
  end if;
  if not ebim.has_role(v_org, v_company, ebim.ai_action_roles(p_kind)) then
    raise exception 'SIN_PERMISO: tu rol no puede proponer esta accion' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 160 then
    raise exception 'TITULO_INVALIDO: entre 3 y 160 caracteres' using errcode = '22023';
  end if;
  if p_store_id is not null and not exists (
    select 1 from public.stores s
     where s.id = p_store_id and s.organization_id = v_org and s.company_id = v_company
  ) then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no es de esta sociedad' using errcode = '22023';
  end if;
  -- La traza de IA de origen, si se da, tiene que ser de ESTA sociedad.
  if p_interaction_id is not null and not exists (
    select 1 from public.ai_interactions i
     where i.id = p_interaction_id and i.organization_id = v_org and i.company_id = v_company
  ) then
    raise exception 'TRAZA_NO_ENCONTRADA: la interaccion de IA no es de esta sociedad' using errcode = '22023';
  end if;

  -- ---- Validación por tipo: los datos se reescriben con lo validado -------
  if p_kind = 'promotion.create_draft' then
    if p_store_id is null then
      raise exception 'TIENDA_REQUERIDA: una campana es de una tienda' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_payload) k
       where k not in ('name', 'description', 'value_percent', 'valid_from', 'valid_to', 'product_ids')
    ) then
      raise exception 'CAMPO_NO_PERMITIDO: datos de campana con campos desconocidos' using errcode = '22023';
    end if;
    if char_length(btrim(coalesce(v_payload ->> 'name', ''))) not between 1 and 160 then
      raise exception 'NOMBRE_INVALIDO: entre 1 y 160 caracteres' using errcode = '22023';
    end if;
    if char_length(coalesce(v_payload ->> 'description', '')) > 2000 then
      raise exception 'DESCRIPCION_INVALIDA: hasta 2000 caracteres' using errcode = '22023';
    end if;
    begin
      v_pct  := (v_payload ->> 'value_percent')::numeric;
      v_from := coalesce((v_payload ->> 'valid_from')::timestamptz, now());
      v_to   := (v_payload ->> 'valid_to')::timestamptz;
      select array_agg(distinct x::uuid) into v_ids
        from jsonb_array_elements_text(coalesce(v_payload -> 'product_ids', '[]'::jsonb)) x;
    exception when others then
      raise exception 'DATOS_INVALIDOS: porcentaje, fechas o productos con formato incorrecto' using errcode = '22023';
    end;
    -- Un techo de 90 %: por encima es regalar, y eso no lo propone una máquina.
    if v_pct is null or v_pct <= 0 or v_pct > 90 then
      raise exception 'PORCENTAJE_INVALIDO: entre 0 y 90' using errcode = '22023';
    end if;
    if v_to is not null and v_to <= v_from then
      raise exception 'FECHAS_INVALIDAS: el fin va despues del inicio' using errcode = '22023';
    end if;
    if v_ids is null or cardinality(v_ids) not between 1 and 50 then
      raise exception 'PRODUCTOS_INVALIDOS: entre 1 y 50 productos' using errcode = '22023';
    end if;
    if (select count(*) from public.products p where p.id = any (v_ids) and p.store_id = p_store_id)
       <> cardinality(v_ids) then
      raise exception 'PRODUCTO_AJENO: algun producto no es de esta tienda' using errcode = '22023';
    end if;
    v_clean := jsonb_build_object(
      'name', btrim(v_payload ->> 'name'),
      'description', nullif(btrim(coalesce(v_payload ->> 'description', '')), ''),
      'value_percent', round(v_pct, 2),
      'valid_from', v_from,
      'valid_to', v_to,
      'product_ids', to_jsonb(v_ids));

  elsif p_kind = 'review.moderate' then
    if exists (
      select 1 from jsonb_object_keys(v_payload) k where k not in ('review_id', 'decision', 'reason')
    ) then
      raise exception 'CAMPO_NO_PERMITIDO: datos de moderacion con campos desconocidos' using errcode = '22023';
    end if;
    begin
      select r.* into v_review from public.product_reviews r where r.id = (v_payload ->> 'review_id')::uuid;
    exception when others then
      raise exception 'DATOS_INVALIDOS: resena con formato incorrecto' using errcode = '22023';
    end;
    if v_review.id is null or v_review.organization_id <> v_org or v_review.company_id <> v_company then
      raise exception 'RESENA_NO_ENCONTRADA: no hay ninguna resena con ese id' using errcode = '22023';
    end if;
    if v_review.status <> 'pending' then
      raise exception 'RESENA_YA_MODERADA: la resena no esta pendiente' using errcode = '22023';
    end if;
    if (v_payload ->> 'decision') not in ('publish', 'reject') then
      raise exception 'DECISION_INVALIDA: publish o reject' using errcode = '22023';
    end if;
    v_reason := nullif(btrim(coalesce(v_payload ->> 'reason', '')), '');
    if (v_payload ->> 'decision') = 'reject' and (v_reason is null or char_length(v_reason) not between 3 and 500) then
      raise exception 'MOTIVO_REQUERIDO: rechazar exige un motivo de 3 a 500 caracteres' using errcode = '22023';
    end if;
    v_clean := jsonb_build_object(
      'review_id', v_review.id,
      'decision', v_payload ->> 'decision',
      'reason', case when (v_payload ->> 'decision') = 'reject' then v_reason end);
  end if;

  insert into public.ai_action_proposals (
    organization_id, company_id, store_id, kind, title, rationale, payload,
    source_feature, interaction_id, proposed_by)
  values (
    v_org, v_company, coalesce(p_store_id, v_review.store_id), p_kind, btrim(p_title),
    nullif(left(btrim(coalesce(p_rationale, '')), 600), ''), v_clean,
    nullif(left(btrim(coalesce(p_source_feature, '')), 40), ''), p_interaction_id, v_user)
  returning id into v_id;

  perform ebim.audit(
    p_organization_id => v_org,
    p_company_id      => v_company,
    p_action          => 'ai_action.proposed',
    p_entity_type     => 'ai_action_proposal',
    p_entity_id       => v_id,
    p_entity_label    => left(btrim(p_title), 120),
    p_store_id        => coalesce(p_store_id, v_review.store_id),
    p_metadata        => jsonb_build_object('kind', p_kind, 'source_feature', p_source_feature));

  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$fn$;

revoke execute on function public.ai_action_propose(text, uuid, text, text, jsonb, text, uuid) from public, anon;
grant  execute on function public.ai_action_propose(text, uuid, text, text, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ejecutar (solo desde `ai_action_decide`)
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_action_execute(p_row public.ai_action_proposals)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_promo uuid;
  v_code  text;
  v_out   jsonb;
begin
  if p_row.kind = 'promotion.create_draft' then
    if not ebim.company_is_entitled(p_row.organization_id, p_row.company_id, 'promotions') then
      raise exception 'MODULO_NO_CONTRATADO: promociones' using errcode = '42501';
    end if;
    -- Código propio, con el formato de `promotions_code_fmt`.
    v_code := 'ia-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || left(md5(p_row.id::text), 4);
    insert into public.promotions (
      organization_id, company_id, store_id, code, name, description, kind, status,
      value_percent, valid_from, valid_to)
    values (
      p_row.organization_id, p_row.company_id, p_row.store_id, v_code,
      p_row.payload ->> 'name', p_row.payload ->> 'description', 'percentage', 'draft',
      (p_row.payload ->> 'value_percent')::numeric,
      (p_row.payload ->> 'valid_from')::timestamptz,
      (p_row.payload ->> 'valid_to')::timestamptz)
    returning id into v_promo;

    insert into public.promotion_scopes (
      organization_id, company_id, store_id, promotion_id, promotion_kind, scope_kind, product_id)
    select p_row.organization_id, p_row.company_id, p_row.store_id, v_promo, 'percentage', 'product', x::uuid
      from jsonb_array_elements_text(p_row.payload -> 'product_ids') x;

    return jsonb_build_object('promotion_id', v_promo, 'code', v_code, 'status', 'draft');

  elsif p_row.kind = 'review.moderate' then
    -- El comando de moderación de siempre, con la sesión de quien aprueba: él
    -- vuelve a comprobar rol, pertenencia y estado.
    v_out := public.moderate_product_review(
      (p_row.payload ->> 'review_id')::uuid,
      p_row.payload ->> 'decision',
      p_row.payload ->> 'reason');
    return jsonb_build_object('review_id', p_row.payload ->> 'review_id', 'review', v_out);
  end if;

  raise exception 'ACCION_DESCONOCIDA: %', p_row.kind using errcode = '22023';
end;
$fn$;

revoke execute on function ebim.ai_action_execute(public.ai_action_proposals) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Decidir: aprobar (ejecuta) o rechazar
-- ---------------------------------------------------------------------------
create or replace function public.ai_action_decide(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user   uuid := ebim.user_id();
  v_row    public.ai_action_proposals%rowtype;
  v_note   text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_result jsonb;
  v_code   text;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'DECISION_INVALIDA: approve o reject' using errcode = '22023';
  end if;

  select * into v_row from public.ai_action_proposals a where a.id = p_id for update;
  if v_row.id is null
     or v_row.organization_id <> ebim.org_id()
     or not (v_row.company_id = any (ebim.companies()))
     or not ebim.has_role(v_row.organization_id, v_row.company_id, ebim.ai_action_roles(v_row.kind)) then
    -- Lo de otra sociedad y lo que tu rol no ve responden igual: no existe.
    raise exception 'PROPUESTA_NO_ENCONTRADA: no hay ninguna propuesta con ese id' using errcode = '22023';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'PROPUESTA_YA_DECIDIDA: la propuesta ya no esta pendiente' using errcode = '22023';
  end if;
  if v_row.expires_at <= now() then
    update public.ai_action_proposals set status = 'expired' where id = v_row.id;
    return jsonb_build_object('id', v_row.id, 'status', 'expired');
  end if;

  if p_decision = 'reject' then
    update public.ai_action_proposals
       set status = 'rejected', decided_by = v_user, decided_at = now(), decision_note = v_note
     where id = v_row.id;
    perform ebim.audit(
      p_organization_id => v_row.organization_id,
      p_company_id      => v_row.company_id,
      p_action          => 'ai_action.rejected',
      p_entity_type     => 'ai_action_proposal',
      p_entity_id       => v_row.id,
      p_entity_label    => left(v_row.title, 120),
      p_store_id        => v_row.store_id,
      p_metadata        => jsonb_build_object('kind', v_row.kind));
    return jsonb_build_object('id', v_row.id, 'status', 'rejected');
  end if;

  -- Aprobar = ejecutar. En un bloque propio: si el comando falla, se deshace SU
  -- escritura y la propuesta queda `failed` con el código, para que se vea por
  -- qué y no se reintente a ciegas.
  begin
    v_result := ebim.ai_action_execute(v_row);
  exception when others then
    v_code := coalesce(nullif(split_part(sqlerrm, ':', 1), ''), 'ERROR_INTERNO');
    if v_code !~ '^[A-Z][A-Z0-9_]{2,60}$' then v_code := 'ERROR_INTERNO'; end if;
    update public.ai_action_proposals
       set status = 'failed', decided_by = v_user, decided_at = now(), decision_note = v_note,
           error_code = v_code
     where id = v_row.id;
    perform ebim.audit(
      p_organization_id => v_row.organization_id,
      p_company_id      => v_row.company_id,
      p_action          => 'ai_action.failed',
      p_entity_type     => 'ai_action_proposal',
      p_entity_id       => v_row.id,
      p_entity_label    => left(v_row.title, 120),
      p_store_id        => v_row.store_id,
      p_metadata        => jsonb_build_object('kind', v_row.kind, 'error_code', v_code));
    return jsonb_build_object('id', v_row.id, 'status', 'failed', 'error_code', v_code);
  end;

  update public.ai_action_proposals
     set status = 'executed', decided_by = v_user, decided_at = now(), decision_note = v_note,
         result = v_result
   where id = v_row.id;
  perform ebim.audit(
    p_organization_id => v_row.organization_id,
    p_company_id      => v_row.company_id,
    p_action          => 'ai_action.executed',
    p_entity_type     => 'ai_action_proposal',
    p_entity_id       => v_row.id,
    p_entity_label    => left(v_row.title, 120),
    p_store_id        => v_row.store_id,
    p_metadata        => jsonb_build_object('kind', v_row.kind, 'result', v_result));
  return jsonb_build_object('id', v_row.id, 'status', 'executed', 'result', v_result);
end;
$fn$;

revoke execute on function public.ai_action_decide(uuid, text, text) from public, anon;
grant  execute on function public.ai_action_decide(uuid, text, text) to authenticated;

comment on table public.ai_action_proposals is
  'Acciones que la IA deja armadas y una persona aprueba o rechaza. Sin escritura directa: ai_action_propose / ai_action_decide.';

-- Toda tabla de negocio nueva lleva el guardián de suspensión de MasterAdmin
-- (`20261116100000_tenant_lifecycle.sql`): una cuenta suspendida no propone ni
-- decide acciones. Idempotente.
select platform_lifecycle.ensure_guards();
