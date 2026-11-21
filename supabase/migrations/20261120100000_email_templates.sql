-- =============================================================================
-- Textos de correo por tienda (2026-11-20, «opción A»)
--
-- El admin de cada tienda cambia asunto, título y mensaje de los avisos que
-- recibe el COMPRADOR por un pedido (recibido, aprobado, rechazado, en camino)
-- desde Configuración → Correo. Sin fila, sale el texto original de la app.
--
-- Personalización = configuración + datos (contrato §0.2): una fila por tienda,
-- aviso e idioma. Nada de plantillas por cliente en código ni en MailHub.
--
-- Seguridad:
--  · Lectura: solo owner/admin de la sociedad (RLS, default deny).
--  · Escritura: SOLO por `email_template_save` / `email_template_reset`
--    (SECURITY DEFINER), que comprueban tienda de la sociedad, rol y contenido,
--    y dejan rastro en la auditoría. Sin INSERT/UPDATE/DELETE directos.
--  · Las variables son una lista cerrada por aviso, la misma que
--    `supabase/functions/_shared/notifications/customCopy.ts`. Una variable
--    que no está en la lista se rechaza aquí también: no basta con el front.
--  · El texto es TEXTO: el HTML lo arma el envío y lo escapa todo.
-- =============================================================================

create table if not exists public.email_templates (
  id              uuid        primary key default gen_random_uuid(),
  store_id        uuid        not null,
  organization_id uuid        not null,
  company_id      uuid        not null,
  kind            text        not null,
  locale          text        not null default 'es',
  subject         text        not null,
  title           text        not null,
  body            text        not null,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint email_templates_unique unique (store_id, kind, locale),
  constraint email_templates_kind check (kind in ('order.confirmed', 'order.approved', 'order.rejected', 'order.shipped')),
  constraint email_templates_locale check (locale in ('es', 'en')),
  constraint email_templates_subject check (char_length(btrim(subject)) between 1 and 150),
  constraint email_templates_title check (char_length(btrim(title)) between 1 and 120),
  constraint email_templates_body check (char_length(btrim(body)) between 1 and 2000),
  constraint email_templates_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index if not exists email_templates_tenant_idx on public.email_templates (organization_id, company_id);

drop trigger if exists email_templates_updated_at on public.email_templates;
create trigger email_templates_updated_at
  before update on public.email_templates
  for each row execute function ebim.set_updated_at();

alter table public.email_templates enable row level security;
alter table public.email_templates force  row level security;
revoke all on public.email_templates from public, anon, authenticated;
grant select on public.email_templates to authenticated;
grant all on public.email_templates to service_role;

drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates
  for select to authenticated
  using (
    organization_id = (select ebim.org_id())
    and company_id = any ((select ebim.has_role_companies(array['owner','admin']::public.app_role[]))::uuid[])
  );

-- Variables admitidas por aviso. Espejo de EDITABLE_KINDS en customCopy.ts.
create or replace function ebim.email_template_variables(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select case p_kind
    when 'order.confirmed' then array['pedido','total','cliente','tienda','fecha']
    when 'order.approved'  then array['pedido','total','cliente','tienda','fecha']
    when 'order.rejected'  then array['pedido','total','cliente','tienda','fecha','motivo']
    when 'order.shipped'   then array['pedido','total','cliente','tienda','fecha']
    else array[]::text[]
  end
$fn$;

-- Tienda de la sociedad del llamador y rol de administración, o error.
create or replace function ebim.email_template_store(p_store_id uuid)
returns public.stores
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not ebim.can_access(v_store.organization_id, v_store.company_id) then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no es de esta sociedad' using errcode = '22023';
  end if;
  if not ebim.has_role(v_store.organization_id, v_store.company_id, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: editar los correos exige rol de administracion' using errcode = '42501';
  end if;
  return v_store;
end;
$fn$;

revoke execute on function ebim.email_template_store(uuid) from public, anon, authenticated;

create or replace function public.email_template_save(
  p_store_id uuid,
  p_kind     text,
  p_locale   text,
  p_subject  text,
  p_title    text,
  p_body     text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store    public.stores%rowtype;
  v_locale   text := coalesce(nullif(btrim(p_locale), ''), 'es');
  v_allowed  text[] := ebim.email_template_variables(p_kind);
  v_used     text;
begin
  v_store := ebim.email_template_store(p_store_id);

  if cardinality(v_allowed) = 0 then
    raise exception 'AVISO_NO_EDITABLE: ese aviso no se puede personalizar' using errcode = '22023';
  end if;
  if v_locale not in ('es', 'en') then
    raise exception 'IDIOMA_INVALIDO: es o en' using errcode = '22023';
  end if;

  for v_used in
    select distinct m[1]
      from regexp_matches(coalesce(p_subject, '') || ' ' || coalesce(p_title, '') || ' ' || coalesce(p_body, ''),
                          '\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}', 'g') as m
  loop
    if not (v_used = any (v_allowed)) then
      raise exception 'VARIABLE_DESCONOCIDA: {{%}} no existe en este aviso', v_used using errcode = '22023';
    end if;
  end loop;

  -- Los check de la tabla validan largo y vacío con su propio mensaje.
  insert into public.email_templates
    (store_id, organization_id, company_id, kind, locale, subject, title, body, updated_by)
  values
    (v_store.id, v_store.organization_id, v_store.company_id, p_kind, v_locale,
     btrim(p_subject), btrim(p_title), btrim(p_body), ebim.user_id())
  on conflict (store_id, kind, locale) do update
     set subject = excluded.subject, title = excluded.title, body = excluded.body,
         updated_by = excluded.updated_by;

  perform ebim.audit(
    p_organization_id => v_store.organization_id,
    p_company_id      => v_store.company_id,
    p_action          => 'email_template.saved',
    p_entity_type     => 'store',
    p_entity_id       => v_store.id,
    p_store_id        => v_store.id,
    p_changes         => jsonb_build_object('kind', p_kind, 'locale', v_locale));

  return jsonb_build_object('store_id', v_store.id, 'kind', p_kind, 'locale', v_locale);
end;
$fn$;

revoke execute on function public.email_template_save(uuid, text, text, text, text, text) from public, anon;
grant  execute on function public.email_template_save(uuid, text, text, text, text, text) to authenticated;

create or replace function public.email_template_reset(p_store_id uuid, p_kind text, p_locale text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store  public.stores%rowtype;
  v_locale text := coalesce(nullif(btrim(p_locale), ''), 'es');
begin
  v_store := ebim.email_template_store(p_store_id);

  delete from public.email_templates t
   where t.store_id = v_store.id and t.kind = p_kind and t.locale = v_locale;

  perform ebim.audit(
    p_organization_id => v_store.organization_id,
    p_company_id      => v_store.company_id,
    p_action          => 'email_template.reset',
    p_entity_type     => 'store',
    p_entity_id       => v_store.id,
    p_store_id        => v_store.id,
    p_changes         => jsonb_build_object('kind', p_kind, 'locale', v_locale));

  return jsonb_build_object('store_id', v_store.id, 'kind', p_kind, 'locale', v_locale);
end;
$fn$;

revoke execute on function public.email_template_reset(uuid, text, text) from public, anon;
grant  execute on function public.email_template_reset(uuid, text, text) to authenticated;

-- Ciclo de vida del tenant (`20261116100000_tenant_lifecycle.sql`): una cuenta
-- suspendida no cambia sus textos de correo. Pone el guardián en la tabla nueva.
select platform_lifecycle.ensure_guards();
