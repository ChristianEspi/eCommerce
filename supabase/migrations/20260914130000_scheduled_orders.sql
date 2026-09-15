-- =============================================================================
-- Cierre · 4 — Pedidos programados operativos.
--
-- ## Qué había
--
-- `20260902150000_orders_advanced.sql` dejó el esquema: `order_templates` (QUÉ y
-- CUÁNTO, nunca a cuánto), `order_schedules` (CUÁNDO) y
-- `ebim.order_schedule_advance` (mover la fecha). Su cabecera fija la regla que
-- esta migración respeta: «la programación no crea pedidos por su cuenta; quien
-- crea el pedido sigue siendo el pipeline de checkout». Faltaba todo lo demás:
-- nadie ejecutaba los vencimientos, el comprador no veía sus programaciones y no
-- había forma de crearlas, pausarlas ni reanudarlas.
--
-- ## Qué añade — y qué NO
--
--  1. `order_schedule_runs` — una fila por vencimiento `(schedule_id, run_on)`.
--     Es la idempotencia y la observabilidad del trabajo.
--  2. `ebim.run_order_schedules(limit)` — el trabajo. Reclama programaciones
--     vencidas con `for update skip locked`, deja la ejecución PREPARADA, avisa
--     a los compradores de la cuenta y avanza la fecha. Si algo falla, reintenta
--     con espera creciente y a los 5 intentos la da por muerta.
--  3. Funciones del comprador (sesión + cuenta B2B efectiva): ver, guardar,
--     pausar, reanudar, archivar, pasar al carrito y descartar.
--  4. `pg_cron` cada hora, dentro de la comprobación de disponibilidad.
--
-- **No se crea ningún pedido desde SQL.** «Pasar al carrito» devuelve QUÉ y
-- CUÁNTO; el comprador confirma en el checkout oficial, que es el que aplica
-- surtido, ATP, precio, crédito, orden de compra y aprobación. Un pedido que
-- nace solo a las 03:00 con el precio y el crédito de ese momento, sin nadie que
-- lo mire, es exactamente lo que la regla de 150000 quiso evitar.
--
-- ## Quién es el comprador
--
-- La cuenta B2B EFECTIVA de `ebim.effective_business_account` (20260913130000),
-- la misma regla que fija el precio y firma el pedido. Ninguna función acepta una
-- cuenta, un cliente, un usuario ni un tenant: salen del JWT y del slug público.
-- Ver: cualquier vínculo activo. Gestionar y comprar: `admin` o `buyer`.
--
-- ## Módulo
--
-- `orders.advanced`, por `ebim.company_is_entitled` (el comprador no es miembro
-- del tenant, así que `has_capability` —que exige `can_access`— no le sirve).
-- El trabajo también lo mira: una sociedad sin el módulo no avisa a nadie.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. La plantilla gana quién la pidió y la clave de idempotencia de su alta
-- ---------------------------------------------------------------------------
alter table public.order_templates
  add column if not exists created_by  uuid,
  add column if not exists request_key text;

alter table public.order_templates
  drop constraint if exists order_templates_request_key_fmt;
alter table public.order_templates
  add constraint order_templates_request_key_fmt
    check (request_key is null or request_key ~ '^[A-Za-z0-9_-]{16,80}$');

create unique index if not exists order_templates_request_key_idx
  on public.order_templates (organization_id, company_id, request_key)
  where request_key is not null;

comment on column public.order_templates.request_key is
  'Clave del alta desde la tienda: el doble clic o el reintento devuelven la misma plantilla.';

-- ---------------------------------------------------------------------------
-- 2. order_schedule_runs — un vencimiento, una fila
-- ---------------------------------------------------------------------------
create table if not exists public.order_schedule_runs (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  store_id        uuid        not null,
  schedule_id     uuid        not null references public.order_schedules (id) on delete cascade,
  template_id     uuid        not null,
  -- La fecha que tocaba (`next_run_on` al reclamar), no la del día en que corrió.
  run_on          date        not null,
  -- ready     : preparada y avisada; espera al comprador.
  -- taken     : el comprador la pasó al carrito.
  -- dismissed : el comprador la descartó.
  -- expired   : llegó el siguiente vencimiento sin que nadie la usara.
  -- skipped   : no se pudo preparar por una razón de negocio (ver skip_reason).
  -- failed    : error técnico; se reintenta en next_attempt_at.
  -- dead      : agotó reintentos.
  status          text        not null,
  skip_reason     text,
  attempts        smallint    not null default 0,
  next_attempt_at timestamptz,
  last_error      text,
  notified_count  integer     not null default 0,
  taken_at        timestamptz,
  taken_by        uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint order_schedule_runs_status check (status in (
    'ready', 'taken', 'dismissed', 'expired', 'skipped', 'failed', 'dead')),
  constraint order_schedule_runs_reason check (
    skip_reason is null or skip_reason in (
      'store_inactive', 'template_inactive', 'not_entitled', 'no_items',
      'customer_inactive', 'no_buyers')),
  constraint order_schedule_runs_reason_pair
    check ((status = 'skipped') = (skip_reason is not null)),
  constraint order_schedule_runs_retry_pair
    check (status <> 'failed' or next_attempt_at is not null),
  constraint order_schedule_runs_attempts check (attempts between 0 and 100),
  constraint order_schedule_runs_error_len check (last_error is null or char_length(last_error) <= 200),
  -- LA idempotencia: un vencimiento, una ejecución.
  constraint order_schedule_runs_unique unique (schedule_id, run_on),
  constraint order_schedule_runs_template_fk
    foreign key (template_id, organization_id, company_id)
    references public.order_templates (id, organization_id, company_id) on delete cascade,
  constraint order_schedule_runs_store_fk
    foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index if not exists order_schedule_runs_tenant_idx
  on public.order_schedule_runs (organization_id, company_id);
create index if not exists order_schedule_runs_template_idx
  on public.order_schedule_runs (template_id, run_on desc);
create index if not exists order_schedule_runs_retry_idx
  on public.order_schedule_runs (next_attempt_at) where status = 'failed';

drop trigger if exists order_schedule_runs_updated_at on public.order_schedule_runs;
create trigger order_schedule_runs_updated_at before update on public.order_schedule_runs
  for each row execute function ebim.set_updated_at();

alter table public.order_schedule_runs enable row level security;
alter table public.order_schedule_runs force  row level security;

revoke all on public.order_schedule_runs from public, anon, authenticated;
grant select on public.order_schedule_runs to authenticated;
grant all    on public.order_schedule_runs to service_role;

-- Lectura del personal, con la misma regla que las programaciones. Nadie escribe
-- desde el cliente: el trabajo y las funciones del comprador.
drop policy if exists order_schedule_runs_select_member on public.order_schedule_runs;
create policy order_schedule_runs_select_member on public.order_schedule_runs
  for select to authenticated
  using (
    ebim.can_access(organization_id, company_id)
    and ebim.has_role(organization_id, company_id,
                      array['owner','admin','orders','sales_rep']::public.app_role[])
  );

comment on table public.order_schedule_runs is
  'Una fila por vencimiento de una programacion (schedule_id, run_on): preparada, usada, descartada, vencida, omitida o fallida. Idempotencia y observabilidad del trabajo. NO es un pedido.';

-- ---------------------------------------------------------------------------
-- 3. Piezas internas
-- ---------------------------------------------------------------------------

-- A quién se avisa de un vencimiento: los vínculos activos `admin`/`buyer` de
-- las cuentas activas del cliente de la plantilla (o de SU cuenta, si la tiene).
create or replace function ebim.order_template_buyers(p_template public.order_templates)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  select distinct u.user_id
  from public.business_account_users u
  join public.business_accounts a on a.id = u.business_account_id
  join public.customers c         on c.id = a.customer_id
  where a.customer_id     = p_template.customer_id
    and a.organization_id = p_template.organization_id
    and a.company_id      = p_template.company_id
    and (p_template.business_account_id is null or a.id = p_template.business_account_id)
    and a.is_active
    and c.is_active
    and u.status = 'active'
    and u.role in ('admin', 'buyer')
    and u.user_id is not null;
$fn$;

-- Contexto del comprador en una tienda: la tienda activa del slug, su cuenta
-- efectiva, el cliente y el rol. Lanza si no hay sesión o no hay cuenta.
create or replace function ebim.order_schedule_actor(
  p_store_slug   text,
  p_need_manage  boolean,
  out store      public.stores,
  out account_id uuid,
  out customer_id uuid,
  out role       public.business_role
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := ebim.user_id();
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  store := ebim.active_store_by_slug(p_store_slug);

  account_id := ebim.effective_business_account(v_user, store.organization_id, store.company_id);
  if account_id is null then
    raise exception 'SIN_CUENTA_B2B: los pedidos programados son de una cuenta de empresa'
      using errcode = '42501';
  end if;

  select a.customer_id into customer_id from public.business_accounts a where a.id = account_id;
  role := ebim.business_role_of(account_id);

  if p_need_manage and coalesce(role::text, '') not in ('admin', 'buyer') then
    raise exception 'SIN_PERMISO: hace falta ser comprador o administrador de la cuenta'
      using errcode = '42501';
  end if;
end;
$fn$;

-- La plantilla, si es de la cuenta del comprador y de esa tienda. Un id ajeno y
-- uno inexistente responden lo mismo: distinguirlos sería un oráculo de ids.
create or replace function ebim.order_template_of_actor(
  p_template_id uuid,
  p_store_id    uuid,
  p_customer_id uuid,
  p_account_id  uuid
)
returns public.order_templates
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tpl public.order_templates%rowtype;
begin
  select * into v_tpl
  from public.order_templates t
  where t.id = p_template_id
    and t.store_id = p_store_id
    and t.customer_id = p_customer_id
    and (t.business_account_id is null or t.business_account_id = p_account_id);
  if not found then
    raise exception 'PROGRAMACION_NO_ENCONTRADA: esa programacion no esta disponible'
      using errcode = '22023';
  end if;
  return v_tpl;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. El trabajo
--
-- Solo servidor. Por cada programación vencida, en su propio bloque:
--
--  · razón de negocio para no preparar (tienda cerrada, plantilla archivada, sin
--    módulo, sin líneas, cliente inactivo, nadie a quien avisar) → `skipped` y
--    se avanza. Reintentar no arregla ninguna de esas cosas, y no avanzar
--    dejaría la programación atascada para siempre;
--  · todo bien → `ready`, aviso en «Tu cuenta» a cada comprador, hecho de
--    dominio y se avanza. La ejecución `ready` anterior de esa programación que
--    nadie usó pasa a `expired`: el comprador ve UNA propuesta, la vigente;
--  · error técnico → se deshace el bloque y queda `failed` con espera creciente
--    (5, 10, 20, 40 min…, tope 6 h). A los 5 intentos, `dead`: deja de
--    reclamarse y se ve en la tabla.
--
-- Idempotencia: `for update of s skip locked` para que dos pasadas no reclamen
-- la misma programación, `unique (schedule_id, run_on)` y el avance en la MISMA
-- transacción que la ejecución. Correr el trabajo dos veces el mismo día no
-- prepara ni avisa dos veces.
-- ---------------------------------------------------------------------------
create or replace function ebim.run_order_schedules(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

-- ---------------------------------------------------------------------------
-- 5. Funciones del comprador
-- ---------------------------------------------------------------------------

-- Una plantilla como la ve el comprador: sin SKU (no es público), sin precio (lo
-- decide el checkout) y con `available` para decir antes lo que no entrará.
create or replace function ebim.order_template_view(p_template public.order_templates)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'id',         p_template.id,
    'name',       p_template.name,
    'created_at', p_template.created_at,
    'schedule', (
      select jsonb_build_object(
        'id',            s.id,
        'status',        s.status,
        'interval_days', s.interval_days,
        'next_run_on',   s.next_run_on,
        'ends_on',       s.ends_on,
        'last_run_at',   s.last_run_at)
      from public.order_schedules s where s.template_id = p_template.id
    ),
    'pending_run', (
      select jsonb_build_object('id', r.id, 'run_on', r.run_on, 'status', r.status)
      from public.order_schedule_runs r
      where r.template_id = p_template.id and r.status = 'ready'
      order by r.run_on desc
      limit 1
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id',   i.product_id,
               'variant_id',   i.variant_id,
               'slug',         p.slug,
               'name',         p.name,
               'variant_name', v.name,
               'quantity',     trunc(i.quantity)::int,
               'available',    p.status = 'published'
                               and p.published_at is not null
                               and p.published_at <= now()
                               and (i.variant_id is null or coalesce(v.is_active, false)))
             order by i.position, p.name)
      from public.order_template_items i
      join public.products p on p.id = i.product_id
      left join public.product_variants v on v.id = i.variant_id
      where i.template_id = p_template.id
    ), '[]'::jsonb)
  );
$fn$;

create or replace function public.my_order_schedules(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user    uuid := ebim.user_id();
  v_store   public.stores%rowtype;
  v_account uuid;
  v_actor   record;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;
  v_store := ebim.active_store_by_slug(p_store_slug);

  -- Sin cuenta B2B no es un error de pantalla: el consumidor simplemente no
  -- tiene pedidos programados.
  v_account := ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id);
  if v_account is null then
    return jsonb_build_object('has_account', false, 'entitled', false, 'can_manage', false,
                              'templates', '[]'::jsonb);
  end if;

  select * into v_actor from ebim.order_schedule_actor(p_store_slug, false);

  return jsonb_build_object(
    'has_account', true,
    'entitled',    ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'orders.advanced'),
    'can_manage',  coalesce(v_actor.role::text, '') in ('admin', 'buyer'),
    'templates', coalesce((
      select jsonb_agg(ebim.order_template_view(t) order by t.created_at desc, t.id)
      from public.order_templates t
      where t.store_id = v_store.id
        and t.customer_id = v_actor.customer_id
        and (t.business_account_id is null or t.business_account_id = v_actor.account_id)
        and t.is_active
    ), '[]'::jsonb)
  );
end;
$fn$;

-- Alta o edición. `p_template_id` nulo = alta (idempotente por `p_request_key`).
-- En la edición, `p_lines` nulo deja las líneas como están.
create or replace function public.save_my_order_schedule(
  p_store_slug    text,
  p_template_id   uuid,
  p_name          text,
  p_lines         jsonb,
  p_interval_days integer,
  p_next_run_on   date,
  p_ends_on       date,
  p_request_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor     record;
  v_store     public.stores%rowtype;
  v_tpl       public.order_templates%rowtype;
  v_name      text := btrim(coalesce(p_name, ''));
  v_key       text := nullif(btrim(coalesce(p_request_key, '')), '');
  v_channel   public.channels%rowtype;
  v_scoped    boolean;
  v_assort    boolean;
  v_item      jsonb;
  v_pos       integer := 0;
  v_product   public.products%rowtype;
  v_variant   public.product_variants%rowtype;
  v_pid       uuid;
  v_vid       uuid;
  v_qty       integer;
  v_seen      text[] := '{}';
  v_sched     public.order_schedules%rowtype;
begin
  select * into v_actor from ebim.order_schedule_actor(p_store_slug, true);
  v_store := v_actor.store;

  if not ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'orders.advanced') then
    raise exception 'SIN_MODULO: la tienda no tiene pedidos programados' using errcode = '42501';
  end if;

  -- Alta repetida con la misma clave: la plantilla que ya nació, sin tocarla.
  if p_template_id is null and v_key is not null then
    select * into v_tpl
    from public.order_templates t
    where t.organization_id = v_store.organization_id
      and t.company_id = v_store.company_id
      and t.request_key = v_key;
    if found then
      if v_tpl.customer_id <> v_actor.customer_id or v_tpl.store_id <> v_store.id then
        raise exception 'PROGRAMACION_NO_ENCONTRADA: esa programacion no esta disponible'
          using errcode = '22023';
      end if;
      return ebim.order_template_view(v_tpl) || jsonb_build_object('replayed', true);
    end if;
  end if;

  if v_key is not null and v_key !~ '^[A-Za-z0-9_-]{16,80}$' then
    raise exception 'CAMPO_INVALIDO: clave de solicitud con formato invalido' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'NOMBRE_INVALIDO: el nombre va de 1 a 120 caracteres' using errcode = '22023';
  end if;
  if p_interval_days is null or p_interval_days not between 1 and 365 then
    raise exception 'INTERVALO_INVALIDO: cada 1 a 365 dias' using errcode = '22023';
  end if;
  if p_next_run_on is null or p_next_run_on < current_date
     or p_next_run_on > current_date + 365 then
    raise exception 'FECHA_INVALIDA: la primera fecha va de hoy a un año' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < p_next_run_on then
    raise exception 'FECHA_INVALIDA: el fin no puede ser antes de la primera fecha' using errcode = '22023';
  end if;

  if p_template_id is not null then
    v_tpl := ebim.order_template_of_actor(p_template_id, v_store.id, v_actor.customer_id, v_actor.account_id);
    if not v_tpl.is_active then
      raise exception 'PROGRAMACION_NO_ENCONTRADA: esa programacion no esta disponible'
        using errcode = '22023';
    end if;
    perform 1 from public.order_templates t where t.id = v_tpl.id for update;
  end if;

  -- Líneas: se validan TODAS antes de escribir nada.
  if p_template_id is null or p_lines is not null then
    if p_lines is null or jsonb_typeof(p_lines) <> 'array'
       or jsonb_array_length(p_lines) = 0 then
      raise exception 'LINEAS_INVALIDAS: hace falta al menos una linea' using errcode = '22023';
    end if;
    if jsonb_array_length(p_lines) > 100 then
      raise exception 'LINEAS_EXCESIVAS: como mucho 100 lineas' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_lines) e(item) where jsonb_typeof(e.item) <> 'object'
    ) or exists (
      select 1 from jsonb_array_elements(p_lines) e(item), jsonb_object_keys(e.item) k
      where jsonb_typeof(e.item) = 'object' and k not in ('product_id', 'variant_id', 'quantity')
    ) then
      raise exception 'CAMPO_NO_PERMITIDO: cada linea lleva solo product_id, variant_id y quantity'
        using errcode = '22023';
    end if;
  end if;

  v_channel := ebim.public_channel(v_store.id);
  select exists (select 1 from public.product_channels pc where pc.channel_id = v_channel.id)
    into v_scoped;
  v_assort := ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'trade.assortments');

  if p_template_id is null or p_lines is not null then
    for v_item in select value from jsonb_array_elements(p_lines) loop
      if coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or (v_item ? 'variant_id' and jsonb_typeof(v_item -> 'variant_id') <> 'null'
             and coalesce(v_item ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'LINEAS_INVALIDAS: identificador de articulo invalido' using errcode = '22023';
      end if;
      v_pid := (v_item ->> 'product_id')::uuid;
      v_vid := case when jsonb_typeof(v_item -> 'variant_id') = 'string'
                    then (v_item ->> 'variant_id')::uuid end;

      if jsonb_typeof(v_item -> 'quantity') in ('number', 'string')
         and btrim(v_item ->> 'quantity') ~ '^[0-9]{1,5}$' then
        v_qty := btrim(v_item ->> 'quantity')::integer;
      else
        v_qty := null;
      end if;
      if v_qty is null or v_qty not between 1 and 10000 then
        raise exception 'CANTIDAD_INVALIDA: cantidad entera de 1 a 10000' using errcode = '22023';
      end if;

      if (v_pid::text || ':' || coalesce(v_vid::text, '')) = any (v_seen) then
        raise exception 'LINEA_DUPLICADA: el mismo articulo va una sola vez' using errcode = '22023';
      end if;
      v_seen := v_seen || (v_pid::text || ':' || coalesce(v_vid::text, ''));

      v_product := null;
      v_variant := null;
      select * into v_product from public.products p where p.id = v_pid and p.store_id = v_store.id;
      if v_vid is not null then
        select * into v_variant from public.product_variants pv
        where pv.id = v_vid and pv.product_id = v_pid;
      end if;

      -- Mismo criterio que el pedido rápido: lo que no está publicado no existe
      -- para el comprador, y lo que existe pero no se vende por aquí no entra.
      if v_product.id is null
         or v_product.status <> 'published'
         or v_product.published_at is null
         or v_product.published_at > now()
         or v_product.currency <> v_store.currency
         or (v_vid is not null and (v_variant.id is null or not v_variant.is_active
                                    or v_product.kind <> 'variant'))
         or (v_vid is null and v_product.kind = 'variant')
         or (v_scoped and not exists (
               select 1 from public.product_channels pc
               where pc.channel_id = v_channel.id and pc.product_id = v_pid)) then
        raise exception 'PRODUCTO_NO_DISPONIBLE: un articulo de la lista no se puede programar'
          using errcode = '22023';
      end if;
      if v_assort and not ebim.product_in_assortment(v_store.id, v_actor.customer_id, v_pid, v_channel.id) then
        raise exception 'FUERA_DE_SURTIDO: un articulo no esta en el surtido de la cuenta'
          using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_template_id is null then
    insert into public.order_templates (
      organization_id, company_id, store_id, customer_id, business_account_id,
      code, name, created_by, request_key
    ) values (
      v_store.organization_id, v_store.company_id, v_store.id, v_actor.customer_id, v_actor.account_id,
      'PRG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
      v_name, ebim.user_id(), v_key
    )
    returning * into v_tpl;
  else
    update public.order_templates set name = v_name, updated_at = now()
     where id = v_tpl.id
    returning * into v_tpl;
  end if;

  if p_template_id is null or p_lines is not null then
    delete from public.order_template_items i where i.template_id = v_tpl.id;
    for v_item in select value from jsonb_array_elements(p_lines) loop
      insert into public.order_template_items (
        organization_id, company_id, template_id, product_id, variant_id, quantity, position
      ) values (
        v_tpl.organization_id, v_tpl.company_id, v_tpl.id,
        (v_item ->> 'product_id')::uuid,
        case when jsonb_typeof(v_item -> 'variant_id') = 'string' then (v_item ->> 'variant_id')::uuid end,
        btrim(v_item ->> 'quantity')::integer,
        v_pos
      );
      v_pos := v_pos + 1;
    end loop;
  end if;

  select * into v_sched from public.order_schedules s where s.template_id = v_tpl.id for update;
  if not found then
    insert into public.order_schedules (
      organization_id, company_id, store_id, template_id, interval_days, next_run_on, ends_on
    ) values (
      v_tpl.organization_id, v_tpl.company_id, v_tpl.store_id, v_tpl.id,
      p_interval_days, p_next_run_on, p_ends_on
    );
  elsif v_sched.status = 'finished' then
    raise exception 'PROGRAMACION_TERMINADA: esa programacion ya termino' using errcode = '22023';
  else
    update public.order_schedules
       set interval_days = p_interval_days,
           next_run_on   = p_next_run_on,
           ends_on       = p_ends_on,
           updated_at    = now()
     where id = v_sched.id;
  end if;

  return ebim.order_template_view(v_tpl) || jsonb_build_object('replayed', false);
end;
$fn$;

-- Pausar o reanudar. Pedir el estado que ya tiene no es un error.
create or replace function public.set_my_order_schedule_status(
  p_store_slug  text,
  p_template_id uuid,
  p_status      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_tpl   public.order_templates%rowtype;
  v_sched public.order_schedules%rowtype;
  v_next  date;
begin
  select * into v_actor from ebim.order_schedule_actor(p_store_slug, true);
  if p_status is null or p_status not in ('active', 'paused') then
    raise exception 'CAMPO_INVALIDO: el estado es active o paused' using errcode = '22023';
  end if;

  v_tpl := ebim.order_template_of_actor(p_template_id, (v_actor.store).id, v_actor.customer_id, v_actor.account_id);
  if not v_tpl.is_active then
    raise exception 'PROGRAMACION_NO_ENCONTRADA: esa programacion no esta disponible' using errcode = '22023';
  end if;
  if not ebim.company_is_entitled(v_tpl.organization_id, v_tpl.company_id, 'orders.advanced') then
    raise exception 'SIN_MODULO: la tienda no tiene pedidos programados' using errcode = '42501';
  end if;

  select * into v_sched from public.order_schedules s where s.template_id = v_tpl.id for update;
  if not found then
    raise exception 'PROGRAMACION_NO_ENCONTRADA: esa programacion no esta disponible' using errcode = '22023';
  end if;
  if v_sched.status = 'finished' then
    raise exception 'PROGRAMACION_TERMINADA: esa programacion ya termino' using errcode = '22023';
  end if;

  if v_sched.status::text <> p_status then
    if p_status = 'active' then
      -- Reanudar no dispara lo que se perdió mientras estaba en pausa: como
      -- mucho, toca hoy.
      v_next := greatest(v_sched.next_run_on, current_date);
      if v_sched.ends_on is not null and v_sched.ends_on < v_next then
        raise exception 'PROGRAMACION_TERMINADA: la fecha de fin ya paso' using errcode = '22023';
      end if;
      update public.order_schedules
         set status = 'active', next_run_on = v_next, updated_at = now()
       where id = v_sched.id;
    else
      update public.order_schedules set status = 'paused', updated_at = now() where id = v_sched.id;
    end if;
  end if;

  return ebim.order_template_view(v_tpl);
end;
$fn$;

-- Archivar: la plantilla deja de verse, la programación termina y la propuesta
-- pendiente vence. No se borra nada: es historia del cliente.
create or replace function public.archive_my_order_schedule(p_store_slug text, p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_tpl   public.order_templates%rowtype;
begin
  select * into v_actor from ebim.order_schedule_actor(p_store_slug, true);
  v_tpl := ebim.order_template_of_actor(p_template_id, (v_actor.store).id, v_actor.customer_id, v_actor.account_id);

  update public.order_templates set is_active = false, updated_at = now() where id = v_tpl.id;
  update public.order_schedules set status = 'finished', updated_at = now()
   where template_id = v_tpl.id and status <> 'finished';
  update public.order_schedule_runs set status = 'expired'
   where template_id = v_tpl.id and status = 'ready';
end;
$fn$;

-- Pasar la propuesta al carrito. Devuelve QUÉ y CUÁNTO; el precio y todo lo
-- demás lo decide el checkout. Repetirlo devuelve las mismas líneas: el
-- navegador que perdió la respuesta puede volver a pedirlas.
create or replace function public.take_my_order_schedule_run(p_store_slug text, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_run   public.order_schedule_runs%rowtype;
  v_tpl   public.order_templates%rowtype;
begin
  select * into v_actor from ebim.order_schedule_actor(p_store_slug, true);

  select * into v_run from public.order_schedule_runs r where r.id = p_run_id for update;
  select * into v_tpl from public.order_templates t
  where t.id = v_run.template_id
    and t.store_id = (v_actor.store).id
    and t.customer_id = v_actor.customer_id
    and (t.business_account_id is null or t.business_account_id = v_actor.account_id);
  -- Misma respuesta para una ajena que para una inexistente.
  if v_run.id is null or v_tpl.id is null then
    raise exception 'EJECUCION_NO_DISPONIBLE: esa propuesta no esta disponible' using errcode = '22023';
  end if;

  if v_run.status not in ('ready', 'taken') then
    raise exception 'EJECUCION_NO_DISPONIBLE: esa propuesta ya no esta vigente' using errcode = '22023';
  end if;
  if not ebim.company_is_entitled(v_tpl.organization_id, v_tpl.company_id, 'orders.advanced') then
    raise exception 'SIN_MODULO: la tienda no tiene pedidos programados' using errcode = '42501';
  end if;

  if v_run.status = 'ready' then
    update public.order_schedule_runs
       set status = 'taken', taken_at = now(), taken_by = ebim.user_id()
     where id = v_run.id;
  end if;

  return jsonb_build_object(
    'run_id',        v_run.id,
    'already_taken', v_run.status = 'taken',
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', i.product_id,
               'variant_id', i.variant_id,
               'quantity',   trunc(i.quantity)::int)
             order by i.position)
      from public.order_template_items i
      where i.template_id = v_tpl.id
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.dismiss_my_order_schedule_run(p_store_slug text, p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_run   public.order_schedule_runs%rowtype;
begin
  select * into v_actor from ebim.order_schedule_actor(p_store_slug, true);

  select * into v_run from public.order_schedule_runs r where r.id = p_run_id for update;
  if v_run.id is null or not exists (
    select 1 from public.order_templates t
    where t.id = v_run.template_id
      and t.store_id = (v_actor.store).id
      and t.customer_id = v_actor.customer_id
      and (t.business_account_id is null or t.business_account_id = v_actor.account_id)
  ) then
    raise exception 'EJECUCION_NO_DISPONIBLE: esa propuesta no esta disponible' using errcode = '22023';
  end if;

  if v_run.status = 'dismissed' then
    return;
  end if;
  if v_run.status <> 'ready' then
    raise exception 'EJECUCION_NO_DISPONIBLE: esa propuesta ya no esta vigente' using errcode = '22023';
  end if;

  update public.order_schedule_runs set status = 'dismissed' where id = v_run.id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function ebim.order_template_buyers(public.order_templates)          from public, anon, authenticated;
revoke execute on function ebim.order_schedule_actor(text, boolean)                    from public, anon, authenticated;
revoke execute on function ebim.order_template_of_actor(uuid, uuid, uuid, uuid)        from public, anon, authenticated;
revoke execute on function ebim.order_template_view(public.order_templates)            from public, anon, authenticated;
revoke execute on function ebim.run_order_schedules(integer)                           from public, anon, authenticated;
grant  execute on function ebim.run_order_schedules(integer)                           to service_role;

revoke execute on function public.my_order_schedules(text)                                          from public, anon;
revoke execute on function public.save_my_order_schedule(text, uuid, text, jsonb, integer, date, date, text) from public, anon;
revoke execute on function public.set_my_order_schedule_status(text, uuid, text)                    from public, anon;
revoke execute on function public.archive_my_order_schedule(text, uuid)                             from public, anon;
revoke execute on function public.take_my_order_schedule_run(text, uuid)                            from public, anon;
revoke execute on function public.dismiss_my_order_schedule_run(text, uuid)                         from public, anon;
grant  execute on function public.my_order_schedules(text)                                          to authenticated, service_role;
grant  execute on function public.save_my_order_schedule(text, uuid, text, jsonb, integer, date, date, text) to authenticated, service_role;
grant  execute on function public.set_my_order_schedule_status(text, uuid, text)                    to authenticated, service_role;
grant  execute on function public.archive_my_order_schedule(text, uuid)                             to authenticated, service_role;
grant  execute on function public.take_my_order_schedule_run(text, uuid)                            to authenticated, service_role;
grant  execute on function public.dismiss_my_order_schedule_run(text, uuid)                         to authenticated, service_role;

comment on function ebim.run_order_schedules(integer) is
  'Trabajo de pedidos programados: prepara la ejecucion vencida, avisa a los compradores y avanza la fecha. NO crea pedidos. Idempotente por (schedule_id, run_on); reintento con espera creciente; solo servidor.';
comment on function public.take_my_order_schedule_run(text, uuid) is
  'Pasa una propuesta programada al carrito: devuelve producto, variante y cantidad. El pedido lo confirma el comprador en el checkout oficial.';
