-- =============================================================================
-- IA proactiva: agenda del vendedor y resumen diario (2026-11-19)
--
-- ## El problema
--
-- Toda la IA del backoffice es a demanda: un botón. Nadie se entera de nada si
-- no abre la pantalla y pulsa. Esto añade las dos piezas que trabajan solas:
--
--  1. **Agenda del vendedor** (`sales_due_customers`): los clientes que, por su
--     propio ritmo de compra, ya deberían haber pedido. «Suele comprar cada 15
--     días y lleva 25 sin pedir». Determinista: mediana de los intervalos entre
--     sus pedidos, sin modelo.
--  2. **Resumen diario** por correo para dueño y administración, activable por
--     tienda desde Configuración (`ai_digest_settings`): ventas de ayer, pedidos
--     por aprobar, acciones de la IA esperando decisión y clientes atrasados.
--     Lo encola `pg_cron` en la cola de correo de siempre.
--
-- Ninguna cifra la escribe un modelo: salen de la base y el correo las cita.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Agenda: clientes que ya deberían haber pedido
-- ---------------------------------------------------------------------------
create or replace function ebim.due_customers(p_org uuid, p_company uuid, p_only_rep_user uuid)
returns table (
  customer_id       uuid,
  customer_name     text,
  last_order_at     timestamptz,
  orders_count      integer,
  typical_days      numeric,
  days_since        numeric,
  overdue_days      numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with cartera as (
    -- Con vendedor: SOLO su cartera. Sin vendedor (dueño, administración): todos.
    select c.id, c.name
      from public.customers c
     where c.organization_id = p_org and c.company_id = p_company
       and (p_only_rep_user is null or exists (
             select 1 from public.sales_rep_customers rc
               join public.sales_reps r on r.id = rc.sales_rep_id
              where rc.customer_id = c.id and r.user_id = p_only_rep_user))
  ),
  pedidos as (
    select a.customer_id, o.placed_at
      from public.orders o
      join public.business_accounts a on a.id = o.business_account_id
     where o.organization_id = p_org and o.company_id = p_company
       and o.status::text not in ('cancelled', 'refunded')
       and o.placed_at >= now() - interval '365 days'
       and a.customer_id in (select id from cartera)
  ),
  intervalos as (
    select customer_id, placed_at,
           extract(epoch from placed_at - lag(placed_at) over (partition by customer_id order by placed_at)) / 86400 as gap
      from pedidos
  ),
  ritmo as (
    select customer_id,
           count(*)::integer as orders_count,
           max(placed_at) as last_order_at,
           percentile_cont(0.5) within group (order by gap) filter (where gap is not null and gap >= 1) as typical_days
      from intervalos
     group by customer_id
  )
  select r.customer_id, c.name, r.last_order_at, r.orders_count,
         round(r.typical_days::numeric, 1),
         round((extract(epoch from now() - r.last_order_at) / 86400)::numeric, 1),
         round((extract(epoch from now() - r.last_order_at) / 86400 - r.typical_days)::numeric, 1)
    from ritmo r
    join cartera c on c.id = r.customer_id
   -- Tres pedidos como mínimo: con menos no hay «ritmo», hay casualidad.
   where r.orders_count >= 3
     and r.typical_days is not null
     and extract(epoch from now() - r.last_order_at) / 86400 > r.typical_days * 1.3
     and extract(epoch from now() - r.last_order_at) / 86400 >= r.typical_days + 3
   order by (extract(epoch from now() - r.last_order_at) / 86400) / r.typical_days desc
   limit 50;
$fn$;

revoke execute on function ebim.due_customers(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.sales_due_customers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_role    public.app_role;
begin
  if ebim.user_id() is null or v_org is null or v_company is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion con sociedad activa' using errcode = '42501';
  end if;
  if not ebim.has_role(v_org, v_company, array['owner','admin','sales_rep']::public.app_role[]) then
    raise exception 'SIN_PERMISO: la agenda es de ventas' using errcode = '42501';
  end if;
  v_role := ebim.member_role(v_org, v_company);

  return coalesce((
    select jsonb_agg(to_jsonb(d) order by d.overdue_days / nullif(d.typical_days, 0) desc)
      from ebim.due_customers(v_org, v_company, case when v_role = 'sales_rep' then ebim.user_id() end) d
  ), '[]'::jsonb);
end;
$fn$;

revoke execute on function public.sales_due_customers() from public, anon;
grant  execute on function public.sales_due_customers() to authenticated;

comment on function public.sales_due_customers() is
  'Clientes que por su ritmo (mediana de intervalos entre pedidos) ya deberian haber pedido. Vendedor: solo su cartera.';

-- ---------------------------------------------------------------------------
-- 2 · Resumen diario: configuración por tienda
-- ---------------------------------------------------------------------------
create table if not exists public.ai_digest_settings (
  store_id        uuid        primary key,
  organization_id uuid        not null,
  company_id      uuid        not null,
  enabled         boolean     not null default false,
  -- Hora local de Lima a la que sale (0–23).
  send_hour       smallint    not null default 8,
  last_sent_on    date,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ai_digest_settings_hour check (send_hour between 0 and 23),
  constraint ai_digest_settings_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index if not exists ai_digest_settings_tenant_idx on public.ai_digest_settings (organization_id, company_id);

drop trigger if exists ai_digest_settings_updated_at on public.ai_digest_settings;
create trigger ai_digest_settings_updated_at
  before update on public.ai_digest_settings
  for each row execute function ebim.set_updated_at();

alter table public.ai_digest_settings enable row level security;
alter table public.ai_digest_settings force  row level security;
revoke all on public.ai_digest_settings from public, anon, authenticated;
grant select on public.ai_digest_settings to authenticated;
grant all on public.ai_digest_settings to service_role;

drop policy if exists ai_digest_settings_select on public.ai_digest_settings;
create policy ai_digest_settings_select on public.ai_digest_settings
  for select to authenticated
  using (
    organization_id = ebim.org_id()
    and company_id = any (ebim.companies())
    and ebim.has_role(organization_id, company_id, array['owner','admin']::public.app_role[])
  );

create or replace function public.ai_digest_configure(p_store_id uuid, p_enabled boolean, p_send_hour integer)
returns jsonb
language plpgsql
volatile
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
    raise exception 'SIN_PERMISO: configurar el resumen exige rol de administracion' using errcode = '42501';
  end if;
  if p_send_hour is null or p_send_hour not between 0 and 23 then
    raise exception 'HORA_INVALIDA: entre 0 y 23' using errcode = '22023';
  end if;

  insert into public.ai_digest_settings (store_id, organization_id, company_id, enabled, send_hour, updated_by)
  values (v_store.id, v_store.organization_id, v_store.company_id, coalesce(p_enabled, false), p_send_hour, ebim.user_id())
  on conflict (store_id) do update
     set enabled = excluded.enabled, send_hour = excluded.send_hour, updated_by = excluded.updated_by;

  perform ebim.audit(
    p_organization_id => v_store.organization_id,
    p_company_id      => v_store.company_id,
    p_action          => 'ai_digest.configured',
    p_entity_type     => 'store',
    p_entity_id       => v_store.id,
    p_store_id        => v_store.id,
    p_changes         => jsonb_build_object('enabled', coalesce(p_enabled, false), 'send_hour', p_send_hour));

  return jsonb_build_object('store_id', v_store.id, 'enabled', coalesce(p_enabled, false), 'send_hour', p_send_hour);
end;
$fn$;

revoke execute on function public.ai_digest_configure(uuid, boolean, integer) from public, anon;
grant  execute on function public.ai_digest_configure(uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Las cifras del resumen (deterministas) y el encolado
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_digest_facts(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with s as (
    select st.id, st.organization_id, st.company_id, st.name, st.slug
      from public.stores st where st.id = p_store_id
  ),
  ayer as (
    -- «Ayer» en la hora de Lima, que es la del comercio.
    select ((now() at time zone 'America/Lima')::date - 1) as dia
  ),
  ventas as (
    select count(*)::integer as pedidos,
           case when count(distinct o.currency) <= 1 then max(o.currency) end as moneda,
           case when count(distinct o.currency) <= 1 then coalesce(sum(o.grand_total), 0) end as total
      from public.orders o, s, ayer
     where o.store_id = s.id
       and o.status::text not in ('cancelled', 'refunded')
       and (o.placed_at at time zone 'America/Lima')::date = ayer.dia
  )
  select jsonb_build_object(
    'store_name',        (select name from s),
    'store_slug',        (select slug from s),
    'day',               (select dia from ayer),
    'orders_yesterday',  (select pedidos from ventas),
    'sales_yesterday',   (select total from ventas),
    'currency',          (select moneda from ventas),
    'pending_approval',  (select count(*) from public.orders o, s
                           where o.store_id = s.id and o.approval_status = 'pending'
                             and o.status::text not in ('cancelled', 'refunded')),
    'pending_ai_actions', (select count(*) from public.ai_action_proposals a, s
                           where a.organization_id = s.organization_id and a.company_id = s.company_id
                             and a.status = 'pending' and a.expires_at > now()),
    'due_customers',     (select count(*) from s, ebim.due_customers(s.organization_id, s.company_id, null))
  );
$fn$;

revoke execute on function ebim.ai_digest_facts(uuid) from public, anon, authenticated;

/**
 * Encola los resúmenes que tocan a esta hora. Idempotente por día y tienda
 * (`last_sent_on` + `dedupe_key`): el planificador puede pasar dos veces.
 */
create or replace function ebim.enqueue_ai_digests(p_limit integer default 200)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_row    record;
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_hora   integer := extract(hour from now() at time zone 'America/Lima')::integer;
  v_facts  jsonb;
  v_params jsonb;
  v_staff  record;
  v_count  integer := 0;
begin
  for v_row in
    select d.* from public.ai_digest_settings d
      join public.stores s on s.id = d.store_id and s.status = 'active'
     where d.enabled
       and d.send_hour <= v_hora
       and (d.last_sent_on is null or d.last_sent_on < v_hoy)
       and ebim.company_is_entitled(d.organization_id, d.company_id, 'analytics.basic')
     order by d.store_id
     limit greatest(coalesce(p_limit, 200), 1)
     for update of d skip locked
  loop
    v_facts := ebim.ai_digest_facts(v_row.store_id);
    v_params := v_facts || jsonb_build_object(
      'path', '/app',
      'sales_yesterday', coalesce(v_facts ->> 'sales_yesterday', ''),
      'orders_yesterday', coalesce(v_facts ->> 'orders_yesterday', '0'),
      'pending_approval', coalesce(v_facts ->> 'pending_approval', '0'),
      'pending_ai_actions', coalesce(v_facts ->> 'pending_ai_actions', '0'),
      'due_customers', coalesce(v_facts ->> 'due_customers', '0'));

    for v_staff in
      select * from ebim.notification_staff(v_row.organization_id, v_row.company_id,
                                            array['owner','admin']::public.app_role[])
    loop
      perform ebim.queue_notification_email(
        v_row.organization_id, v_row.company_id, v_row.store_id, 'ai.daily_digest', v_staff.email,
        v_params, 'ai.daily_digest:' || v_row.store_id::text || ':' || v_hoy::text || ':' || v_staff.user_id::text);
    end loop;

    update public.ai_digest_settings set last_sent_on = v_hoy where store_id = v_row.store_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

revoke execute on function ebim.enqueue_ai_digests(integer) from public, anon, authenticated;

comment on function ebim.enqueue_ai_digests(integer) is
  'Encola el resumen diario (ai.daily_digest) de las tiendas con el resumen activo y su hora alcanzada en Lima. Idempotente por dia.';

-- ---------------------------------------------------------------------------
-- 4 · Planificador (solo donde existe pg_cron; la base de pruebas no lo trae)
-- ---------------------------------------------------------------------------
do $migracion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron no disponible: no se programa el resumen diario';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  if exists (select 1 from cron.job where jobname = 'ecommerce-ai-digest') then
    perform cron.unschedule('ecommerce-ai-digest');
  end if;
  perform cron.schedule('ecommerce-ai-digest', '5 * * * *', $trabajo$ select ebim.enqueue_ai_digests(200); $trabajo$);
end
$migracion$;

select platform_lifecycle.ensure_guards();
