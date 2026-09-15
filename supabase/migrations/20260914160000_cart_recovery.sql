-- =============================================================================
-- Cierre · 8 — Recuperación de carritos abandonados.
--
-- ## Qué había
--
-- La cabecera de `20260830100300_guest_cart_retention.sql` ya lo anunciaba: un
-- carrito abandonado CON líneas «es la materia prima de una campaña de
-- recuperación» y por eso no se borra. Faltaba la campaña. El hecho existía
-- (`cart_abandoned` en analítica, sin datos personales a propósito) y la cola de
-- correo también (`notification_emails`, 20260912110000). Nadie los unía.
--
-- ## Qué añade esta migración — y qué NO añade
--
--  1. Tres ajustes por tienda en `store_settings`, APAGADOS por defecto.
--  2. `cart_recovery_opt_outs` — la baja del comprador, por tienda.
--  3. `cart_recovery_reminders` — un registro por episodio de abandono: qué se
--     encoló, qué se suprimió y por qué. Es la observabilidad y la idempotencia.
--  4. `ebim.enqueue_cart_recovery(p_limit)` — el trabajo que elige carritos y
--     encola el correo `cart.recovery` por `ebim.queue_notification_email`.
--  5. La comprobación en el MOMENTO DE ENVIAR, dentro de
--     `public.notification_email_claim`.
--
-- **No hay segunda cola ni segundo worker.** El correo sale por
-- `notification_emails` y lo envía `notifications-dispatch` como cualquier otro;
-- reintentos, espera creciente, caducidad y fallo terminal son los de esa cola.
--
-- ## A quién se escribe (elegibilidad)
--
-- Solo a un comprador CON SESIÓN: `carts.user_id` no nulo, con usuario de Auth,
-- correo válido y que no sea de la suite (`@ebim.pe`, contrato §13). El carrito
-- tiene que estar `active` o `abandoned`, tener líneas, llevar quieto al menos
-- `cart_recovery_delay_hours` (4 h por defecto) y no más de
-- `cart_recovery_max_age_days` (7 días por defecto). La tienda, activa y con el
-- ajuste encendido.
--
-- **Al invitado no se le escribe nunca.** No hay columna de contacto en
-- `carts` —es deliberado desde 20260828100000— y no hay ninguna base de
-- consentimiento para usar el correo que tecleó en un checkout que no terminó.
--
-- ## Consentimiento: el camino conservador
--
-- No existe en el esquema ningún dato de consentimiento de marketing. Un
-- recordatorio de carrito se parece lo bastante a una comunicación comercial
-- como para que la BASE LEGAL la tenga que confirmar el responsable del negocio
-- antes de encender el ajuste. Mientras tanto:
--
--  · el ajuste nace APAGADO en todas las tiendas;
--  · cada correo lleva un enlace de baja de un clic con un secreto propio;
--  · el comprador con sesión puede darse de baja (y volver a darse de alta)
--    desde «Tu cuenta»;
--  · la baja se comprueba al encolar Y al enviar.
--
-- ## Supresión
--
-- `ebim.cart_recovery_block_reason` dice por qué un recordatorio ya NO debe
-- salir: carrito convertido, fusionado, vaciado, con actividad nueva, fuera de
-- plazo, tienda apagada, sin contacto, comprador de baja, pedido posterior del
-- mismo comprador en esa tienda, o un carrito más reciente del mismo comprador.
-- Es UNA función y la usan los dos momentos: al encolar y al reclamar para
-- enviar. Una compra que ocurre entre el encolado y el envío suprime el correo.
--
-- ## Idempotencia
--
-- Un episodio de abandono es `(cart_id, last_activity_at)`. `unique` sobre ese
-- par en `cart_recovery_reminders` y clave de la cola
-- `cart.recovery:<cart>:<epoch en microsegundos>`: correr el trabajo dos veces
-- no encola dos correos, y un carrito que vuelve a moverse y a quedarse quieto
-- es un episodio nuevo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. El ajuste, por tienda. Nace apagado.
-- ---------------------------------------------------------------------------
alter table public.store_settings
  add column if not exists cart_recovery_enabled      boolean not null default false,
  add column if not exists cart_recovery_delay_hours  integer not null default 4,
  add column if not exists cart_recovery_max_age_days integer not null default 7;

alter table public.store_settings
  add constraint store_settings_cart_recovery_delay
    check (cart_recovery_delay_hours between 1 and 72),
  add constraint store_settings_cart_recovery_max_age
    check (cart_recovery_max_age_days between 1 and 30),
  -- Una ventana que empieza después de caducar no elige nunca nada, y un ajuste
  -- que no hace nada es un ajuste que alguien encenderá creyendo que funciona.
  add constraint store_settings_cart_recovery_window
    check (cart_recovery_max_age_days * 24 > cart_recovery_delay_hours);

comment on column public.store_settings.cart_recovery_enabled is
  'Recordatorio por correo de carritos abandonados de compradores con sesion. APAGADO por defecto: encenderlo exige que el negocio confirme la base de consentimiento. Se escribe por cart_recovery_configure.';
comment on column public.store_settings.cart_recovery_delay_hours is
  'Horas sin actividad antes de considerar abandonado un carrito (1-72, 4 por defecto).';
comment on column public.store_settings.cart_recovery_max_age_days is
  'Dias maximos desde la ultima actividad para seguir recordando un carrito (1-30, 7 por defecto).';

-- ---------------------------------------------------------------------------
-- 2. cart_recovery_opt_outs — la baja del comprador, por tienda
-- ---------------------------------------------------------------------------
create table public.cart_recovery_opt_outs (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  store_id        uuid        not null,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  -- Por dónde llegó: el enlace del correo o «Tu cuenta». Sirve para explicar
  -- una baja, no para decidir nada.
  source          text        not null,
  created_at      timestamptz not null default now(),

  constraint cart_recovery_opt_outs_source check (source in ('email_link', 'account')),
  constraint cart_recovery_opt_outs_unique unique (store_id, user_id),
  constraint cart_recovery_opt_outs_store_fk
    foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index cart_recovery_opt_outs_tenant_idx on public.cart_recovery_opt_outs (organization_id, company_id);
create index cart_recovery_opt_outs_user_idx   on public.cart_recovery_opt_outs (user_id);

alter table public.cart_recovery_opt_outs enable row level security;
alter table public.cart_recovery_opt_outs force  row level security;

revoke all on public.cart_recovery_opt_outs from public, anon, authenticated;
grant select on public.cart_recovery_opt_outs to authenticated;
grant all    on public.cart_recovery_opt_outs to service_role;

-- La persona ve SUS bajas y nada más. Escribir pasa por las funciones de abajo:
-- ninguna acepta un usuario, lo sacan del JWT o del secreto del correo.
create policy cart_recovery_opt_outs_select_own on public.cart_recovery_opt_outs
  for select to authenticated
  using (user_id = ebim.user_id());

comment on table public.cart_recovery_opt_outs is
  'Compradores que no quieren recordatorios de carrito de una tienda. Se escribe solo por cart_recovery_unsubscribe (secreto del correo) o set_my_cart_reminders (sesion).';

-- ---------------------------------------------------------------------------
-- 3. cart_recovery_reminders — un registro por episodio de abandono
-- ---------------------------------------------------------------------------
create table public.cart_recovery_reminders (
  id                     uuid        primary key default gen_random_uuid(),
  organization_id        uuid        not null,
  company_id             uuid        not null,
  store_id               uuid        not null,
  cart_id                uuid        not null,
  user_id                uuid        not null,
  -- El `last_activity_at` del carrito cuando se decidió. Identifica el episodio.
  episode_at             timestamptz not null,
  -- `queued`: hay un correo en la cola. `suppressed`: no salió ni saldrá.
  -- El resto del estado (enviado, fallido, caducado) es el de la cola, y se lee
  -- de allí: copiarlo aquí sería una segunda verdad que se desincroniza.
  status                 text        not null,
  suppressed_reason      text,
  email_id               uuid        references public.notification_emails (id) on delete set null,
  -- sha256 del secreto de baja. El secreto en claro solo viaja dentro del correo.
  unsubscribe_token_hash text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint cart_recovery_reminders_status check (status in ('queued', 'suppressed')),
  constraint cart_recovery_reminders_reason check (
    suppressed_reason is null or suppressed_reason in (
      'missing', 'converted', 'merged', 'activity', 'emptied', 'disabled',
      'too_old', 'no_contact', 'opted_out', 'ordered', 'superseded')),
  constraint cart_recovery_reminders_reason_pair
    check ((status = 'suppressed') = (suppressed_reason is not null)),
  constraint cart_recovery_reminders_token_fmt
    check (unsubscribe_token_hash is null or unsubscribe_token_hash ~ '^[0-9a-f]{64}$'),
  -- LA idempotencia: un episodio, un recordatorio.
  constraint cart_recovery_reminders_episode unique (cart_id, episode_at),
  constraint cart_recovery_reminders_store_fk
    foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade,
  constraint cart_recovery_reminders_cart_fk
    foreign key (cart_id, organization_id, company_id)
    references public.carts (id, organization_id, company_id) on delete cascade
);

create index cart_recovery_reminders_tenant_idx on public.cart_recovery_reminders (organization_id, company_id);
create index cart_recovery_reminders_store_idx  on public.cart_recovery_reminders (store_id, created_at desc);
create index cart_recovery_reminders_user_idx   on public.cart_recovery_reminders (store_id, user_id) where status = 'queued';
create index cart_recovery_reminders_email_idx  on public.cart_recovery_reminders (email_id) where email_id is not null;
create unique index cart_recovery_reminders_token_idx
  on public.cart_recovery_reminders (unsubscribe_token_hash) where unsubscribe_token_hash is not null;

create trigger cart_recovery_reminders_updated_at before update on public.cart_recovery_reminders
  for each row execute function ebim.set_updated_at();

alter table public.cart_recovery_reminders enable row level security;
alter table public.cart_recovery_reminders force  row level security;

revoke all on public.cart_recovery_reminders from public, anon, authenticated;
-- Por columna y SIN el hash del secreto: quien administra ve qué pasó con cada
-- carrito, no el material con el que se da de baja a alguien.
grant select (
  id, organization_id, company_id, store_id, cart_id, user_id, episode_at,
  status, suppressed_reason, email_id, created_at, updated_at
) on public.cart_recovery_reminders to authenticated;
grant all on public.cart_recovery_reminders to service_role;

create policy cart_recovery_reminders_select_admin on public.cart_recovery_reminders
  for select to authenticated
  using (
    ebim.can_access(organization_id, company_id)
    and ebim.has_role(organization_id, company_id, array['owner','admin']::public.app_role[])
  );

comment on table public.cart_recovery_reminders is
  'Un registro por episodio de abandono (cart_id, episode_at): encolado o suprimido y por que. El estado de envio es el de notification_emails.';

-- ---------------------------------------------------------------------------
-- 4. Por qué un recordatorio ya no debe salir
--
-- `null` = puede salir. Cualquier otro valor es el motivo, y es el mismo
-- vocabulario que guarda `cart_recovery_reminders.suppressed_reason`.
-- ---------------------------------------------------------------------------
create or replace function ebim.cart_recovery_block_reason(
  p_cart_id    uuid,
  p_episode_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_cart     public.carts%rowtype;
  v_store_ok boolean;
  v_enabled  boolean;
  v_max_days integer;
  v_email    text;
begin
  select * into v_cart from public.carts c where c.id = p_cart_id;
  if not found then
    return 'missing';
  end if;
  if v_cart.user_id is null then
    return 'no_contact';
  end if;
  if v_cart.status = 'converted' then
    return 'converted';
  end if;
  if v_cart.status = 'merged' then
    return 'merged';
  end if;
  -- El comprador volvió: este episodio terminó. Si se vuelve a quedar quieto,
  -- será otro episodio con su propio recordatorio.
  if v_cart.last_activity_at is distinct from p_episode_at then
    return 'activity';
  end if;
  if not exists (select 1 from public.cart_items i where i.cart_id = v_cart.id) then
    return 'emptied';
  end if;

  select s.status::text = 'active', coalesce(ss.cart_recovery_enabled, false), ss.cart_recovery_max_age_days
    into v_store_ok, v_enabled, v_max_days
  from public.stores s
  left join public.store_settings ss on ss.store_id = s.id
  where s.id = v_cart.store_id;
  if not coalesce(v_store_ok, false) or not coalesce(v_enabled, false) then
    return 'disabled';
  end if;
  if v_cart.last_activity_at <= now() - make_interval(days => coalesce(v_max_days, 7)) then
    return 'too_old';
  end if;

  select u.email into v_email from auth.users u where u.id = v_cart.user_id;
  v_email := lower(btrim(coalesce(v_email, '')));
  if position('@' in v_email) <= 1 or position('@ebim.pe' in v_email) > 0 then
    return 'no_contact';
  end if;

  if exists (
    select 1 from public.cart_recovery_opt_outs o
    where o.store_id = v_cart.store_id and o.user_id = v_cart.user_id
  ) then
    return 'opted_out';
  end if;

  -- Compró después. Por el vínculo verificado del checkout (`order_buyers`) o,
  -- mientras ese vínculo todavía no se ha escrito, por el correo de su cuenta en
  -- ESTA tienda. Suprimir de más es barato; recordarle un carrito a quien acaba
  -- de pagar, no.
  if exists (
    select 1
    from public.order_buyers b
    join public.orders o on o.id = b.order_id
    where b.user_id = v_cart.user_id
      and b.store_id = v_cart.store_id
      and o.status <> 'cancelled'
      and o.placed_at >= v_cart.last_activity_at
  ) or exists (
    select 1
    from public.orders o
    where o.store_id = v_cart.store_id
      and lower(o.customer_email) = v_email
      and o.status <> 'cancelled'
      and o.placed_at >= v_cart.last_activity_at
  ) then
    return 'ordered';
  end if;

  -- Tiene un carrito más reciente en la tienda: el enlace del correo abriría
  -- ese, no este. Recordar el viejo sería recordar algo que ya no ve.
  if exists (
    select 1 from public.carts c2
    where c2.store_id = v_cart.store_id
      and c2.user_id = v_cart.user_id
      and c2.id <> v_cart.id
      and c2.last_activity_at > v_cart.last_activity_at
  ) then
    return 'superseded';
  end if;

  return null;
end;
$fn$;

-- Suprime un recordatorio encolado y caduca su correo si aún no salió. Un correo
-- `sending` ya está en manos del worker y no se toca: la ventana es de segundos.
create or replace function ebim.cart_recovery_suppress_reminder(
  p_reminder_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email uuid;
begin
  update public.cart_recovery_reminders r
     set status = 'suppressed', suppressed_reason = p_reason
   where r.id = p_reminder_id
     and r.status = 'queued'
     -- Lo que ya salió, falló o caducó es historia: una baja posterior no la
     -- reescribe como «suprimido».
     and (r.email_id is null or exists (
           select 1 from public.notification_emails e
           where e.id = r.email_id and e.status = 'pending'))
  returning r.email_id into v_email;

  if v_email is not null then
    update public.notification_emails e
       set status = 'expired', last_error = 'SUPRIMIDO', updated_at = now()
     where e.id = v_email and e.status = 'pending';
  end if;
end;
$fn$;

-- La baja surte efecto YA sobre lo que esté en la cola para ese comprador y
-- esa tienda, sin esperar a la comprobación del envío.
create or replace function ebim.cart_recovery_suppress_user(p_store uuid, p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select r.id
    from public.cart_recovery_reminders r
    where r.store_id = p_store and r.user_id = p_user and r.status = 'queued'
  loop
    perform ebim.cart_recovery_suppress_reminder(v_id, 'opted_out');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. El trabajo: elegir carritos y encolar
--
-- Solo servidor. `for update of c skip locked`: dos pasadas en paralelo no
-- eligen el mismo carrito, y un carrito que el checkout tiene bloqueado en ese
-- instante se salta —se verá en la siguiente pasada, ya convertido—.
-- ---------------------------------------------------------------------------
create or replace function ebim.enqueue_cart_recovery(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_limit      integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_row        record;
  v_reason     text;
  v_token      text;
  v_key        text;
  v_reminder   uuid;
  v_email_id   uuid;
  v_params     jsonb;
  v_lines      integer;
  v_queued     integer := 0;
  v_suppressed integer := 0;
begin
  for v_row in
    select c.id, c.organization_id, c.company_id, c.store_id, c.user_id,
           c.last_activity_at, u.email
    from public.carts c
    join public.store_settings ss on ss.store_id = c.store_id and ss.cart_recovery_enabled
    join public.stores s          on s.id = c.store_id and s.status = 'active'
    join auth.users u             on u.id = c.user_id
    where c.user_id is not null
      and c.status in ('active', 'abandoned')
      and c.last_activity_at <= now() - make_interval(hours => ss.cart_recovery_delay_hours)
      and c.last_activity_at >  now() - make_interval(days  => ss.cart_recovery_max_age_days)
      and exists (select 1 from public.cart_items i where i.cart_id = c.id)
      and not exists (
        select 1 from public.cart_recovery_reminders r
        where r.cart_id = c.id and r.episode_at = c.last_activity_at
      )
    order by c.last_activity_at
    limit v_limit
    for update of c skip locked
  loop
    v_reminder := null;
    v_email_id := null;
    v_reason := ebim.cart_recovery_block_reason(v_row.id, v_row.last_activity_at);

    if v_reason is not null then
      insert into public.cart_recovery_reminders (
        organization_id, company_id, store_id, cart_id, user_id, episode_at,
        status, suppressed_reason
      ) values (
        v_row.organization_id, v_row.company_id, v_row.store_id, v_row.id, v_row.user_id,
        v_row.last_activity_at, 'suppressed', v_reason
      )
      on conflict (cart_id, episode_at) do nothing;
      v_suppressed := v_suppressed + 1;
      continue;
    end if;

    -- 2 uuid v4 sin guiones: mismo patrón que `carts.token`. Núcleo de Postgres,
    -- sin depender de pgcrypto.
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    v_key := 'cart.recovery:' || v_row.id::text || ':'
          || floor(extract(epoch from v_row.last_activity_at) * 1000000)::bigint::text;

    insert into public.cart_recovery_reminders (
      organization_id, company_id, store_id, cart_id, user_id, episode_at,
      status, unsubscribe_token_hash
    ) values (
      v_row.organization_id, v_row.company_id, v_row.store_id, v_row.id, v_row.user_id,
      v_row.last_activity_at, 'queued', encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
    )
    on conflict (cart_id, episode_at) do nothing
    returning id into v_reminder;

    if v_reminder is null then
      continue;
    end if;

    select count(*)::int into v_lines from public.cart_items i where i.cart_id = v_row.id;

    -- Lo justo: la marca de la tienda, cuántas líneas y el secreto de baja.
    -- Ni un precio —se confirma al pagar— ni un producto, ni un nombre.
    v_params := ebim.notification_store_params(v_row.store_id)
             || jsonb_build_object('line_count', v_lines, 'unsubscribe_token', v_token);

    perform ebim.queue_notification_email(
      v_row.organization_id, v_row.company_id, v_row.store_id,
      'cart.recovery', v_row.email, v_params, v_key);

    -- `queue_notification_email` añade la huella de la dirección a la clave.
    select e.id into v_email_id
    from public.notification_emails e
    where e.organization_id = v_row.organization_id
      and e.company_id = v_row.company_id
      and e.dedupe_key = v_key || ':' || md5(lower(btrim(coalesce(v_row.email, ''))));

    if v_email_id is null then
      update public.cart_recovery_reminders
         set status = 'suppressed', suppressed_reason = 'no_contact', unsubscribe_token_hash = null
       where id = v_reminder;
      v_suppressed := v_suppressed + 1;
    else
      update public.cart_recovery_reminders set email_id = v_email_id where id = v_reminder;
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object('queued', v_queued, 'suppressed', v_suppressed);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. La comprobación en el momento de enviar
--
-- Recorre los `cart.recovery` que el worker está a punto de reclamar y suprime
-- los que ya no deben salir. Devuelve `false` si algo falla: entonces la pasada
-- NO reclama ningún recordatorio de carrito —mejor un recordatorio tarde que
-- uno a quien ya compró— y el resto del correo sale igual.
-- ---------------------------------------------------------------------------
create or replace function ebim.cart_recovery_guard_queue()
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row    record;
  v_reason text;
begin
  for v_row in
    select r.id as reminder_id, r.cart_id, r.episode_at
    from public.notification_emails e
    join public.cart_recovery_reminders r on r.email_id = e.id and r.status = 'queued'
    where e.kind = 'cart.recovery'
      and e.status = 'pending'
      and e.next_attempt_at <= now()
    for update of e skip locked
  loop
    v_reason := ebim.cart_recovery_block_reason(v_row.cart_id, v_row.episode_at);
    if v_reason is not null then
      perform ebim.cart_recovery_suppress_reminder(v_row.reminder_id, v_reason);
    end if;
  end loop;
  return true;
exception when others then
  raise warning 'cart_recovery_guard_queue no se pudo completar (%)', sqlstate;
  return false;
end;
$fn$;

-- El secreto de baja no se queda en la cola más de lo necesario.
-- `notification_emails` es legible por owner/admin; mientras el correo espera, el
-- secreto está ahí (y solo sirve para dar de baja a ESE comprador de ESA tienda,
-- algo que el administrador ya controla con el ajuste). En cuanto el correo
-- termina —enviado, fallido o caducado— se borra de los parámetros. El hash sigue
-- en `cart_recovery_reminders`, así que el enlace del correo sigue funcionando.
create or replace function ebim.cart_recovery_scrub_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.kind = 'cart.recovery'
     and new.status in ('sent', 'failed', 'expired')
     and new.params ? 'unsubscribe_token' then
    new.params := new.params - 'unsubscribe_token';
  end if;
  return new;
end;
$fn$;

create trigger notification_emails_cart_recovery_scrub
  before update of status on public.notification_emails
  for each row execute function ebim.cart_recovery_scrub_token();

-- ---------------------------------------------------------------------------
-- 7. notification_email_claim — la definición de 20260912110000, con la guarda
--
-- Idéntica salvo dos cosas: llama a `ebim.cart_recovery_guard_queue()` antes de
-- elegir, y no elige un `cart.recovery` si la guarda falló o si no tiene su
-- registro encolado. El worker no cambia.
-- ---------------------------------------------------------------------------
create or replace function public.notification_email_claim(p_limit integer default 20)
returns table (
  id         uuid,
  kind       text,
  locale     text,
  to_address text,
  params     jsonb,
  attempts   integer
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_guard_ok boolean;
begin
  -- Lo caducado no se envía: un aviso de hace días confunde más que no llegar.
  update public.notification_emails e
     set status = 'expired', updated_at = now()
   where e.status in ('pending', 'sending')
     and e.expires_at <= now();

  -- Rescate de huérfanos: una pasada que se cayó a mitad no deja correos
  -- `sending` para siempre.
  update public.notification_emails e
     set status = 'pending', claimed_at = null, updated_at = now()
   where e.status = 'sending'
     and e.claimed_at < now() - interval '10 minutes';

  -- Recuperación de carritos: lo que ya no debe salir se suprime AQUÍ, en el
  -- último momento en el que la base todavía decide.
  v_guard_ok := ebim.cart_recovery_guard_queue();

  return query
  with elegidos as (
    select e.id
    from public.notification_emails e
    where e.status = 'pending'
      and e.next_attempt_at <= now()
      and (
        e.kind <> 'cart.recovery'
        or (v_guard_ok and exists (
              select 1 from public.cart_recovery_reminders r
              where r.email_id = e.id and r.status = 'queued'))
      )
    order by e.next_attempt_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.notification_emails e
     set status = 'sending', claimed_at = now(), attempts = e.attempts + 1, updated_at = now()
    from elegidos
   where e.id = elegidos.id
  returning e.id, e.kind, e.locale, e.to_address, e.params, e.attempts;
end;
$fn$;

revoke execute on function public.notification_email_claim(integer) from public, anon, authenticated;
grant  execute on function public.notification_email_claim(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8. La baja de un clic, con el secreto del correo
--
-- `anon` a propósito: quien pulsa el enlace puede no tener sesión en ese
-- navegador. Lo que protege es el secreto —dos uuid v4, 244 bits aleatorios—,
-- que solo existe dentro del correo y se guarda como sha256. Responde un
-- booleano y nada más, no devuelve ningún dato de nadie y solo puede dar de baja
-- al comprador para el que se emitió, en esa tienda.
-- ---------------------------------------------------------------------------
create or replace function public.cart_recovery_unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_rem   public.cart_recovery_reminders%rowtype;
begin
  if v_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('unsubscribed', false);
  end if;

  select * into v_rem
  from public.cart_recovery_reminders r
  where r.unsubscribe_token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('unsubscribed', false);
  end if;

  insert into public.cart_recovery_opt_outs (organization_id, company_id, store_id, user_id, source)
  values (v_rem.organization_id, v_rem.company_id, v_rem.store_id, v_rem.user_id, 'email_link')
  on conflict (store_id, user_id) do nothing;

  perform ebim.cart_recovery_suppress_user(v_rem.store_id, v_rem.user_id);

  return jsonb_build_object('unsubscribed', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 9. La preferencia desde «Tu cuenta» (sesión)
--
-- La tienda por su slug público y activa; el usuario por el JWT. Ninguna acepta
-- un usuario ni un tenant.
-- ---------------------------------------------------------------------------
create or replace function public.my_cart_reminders(p_store_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user  uuid := ebim.user_id();
  v_store public.stores%rowtype;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;
  v_store := ebim.active_store_by_slug(p_store_slug);

  return jsonb_build_object(
    'store_enabled', coalesce((
      select ss.cart_recovery_enabled from public.store_settings ss where ss.store_id = v_store.id
    ), false),
    'receive', not exists (
      select 1 from public.cart_recovery_opt_outs o
      where o.store_id = v_store.id and o.user_id = v_user
    )
  );
end;
$fn$;

create or replace function public.set_my_cart_reminders(p_store_slug text, p_receive boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user  uuid := ebim.user_id();
  v_store public.stores%rowtype;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;
  if p_receive is null then
    raise exception 'CAMPO_INVALIDO: falta la preferencia' using errcode = '22023';
  end if;
  v_store := ebim.active_store_by_slug(p_store_slug);

  if p_receive then
    delete from public.cart_recovery_opt_outs o
     where o.store_id = v_store.id and o.user_id = v_user;
  else
    insert into public.cart_recovery_opt_outs (organization_id, company_id, store_id, user_id, source)
    values (v_store.organization_id, v_store.company_id, v_store.id, v_user, 'account')
    on conflict (store_id, user_id) do nothing;
    perform ebim.cart_recovery_suppress_user(v_store.id, v_user);
  end if;

  return public.my_cart_reminders(p_store_slug);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10. Backoffice: el ajuste y los números (owner/admin)
--
-- La tienda llega como alcance de pantalla; el tenant sale de la fila de
-- `stores` y el permiso, de `ebim.has_role` sobre los claims del JWT.
-- ---------------------------------------------------------------------------
create or replace function public.cart_recovery_overview(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
  v_ss    public.store_settings%rowtype;
  v_since timestamptz := now() - interval '30 days';
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if not found
     or not ebim.has_role(v_store.organization_id, v_store.company_id,
                          array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: solo propietario o administrador' using errcode = '42501';
  end if;

  select * into v_ss from public.store_settings ss where ss.store_id = v_store.id;

  return jsonb_build_object(
    'enabled',       coalesce(v_ss.cart_recovery_enabled, false),
    'delay_hours',   coalesce(v_ss.cart_recovery_delay_hours, 4),
    'max_age_days',  coalesce(v_ss.cart_recovery_max_age_days, 7),
    'window_days',   30,
    'counts', (
      select jsonb_build_object(
        'queued',     count(*) filter (where r.status = 'queued' and e.status in ('pending', 'sending')),
        'sent',       count(*) filter (where r.status = 'queued' and e.status = 'sent'),
        'failed',     count(*) filter (where r.status = 'queued' and e.status = 'failed'),
        'expired',    count(*) filter (where r.status = 'queued' and (e.status = 'expired' or e.id is null)),
        'suppressed', count(*) filter (where r.status = 'suppressed'))
      from public.cart_recovery_reminders r
      left join public.notification_emails e on e.id = r.email_id
      where r.store_id = v_store.id and r.created_at >= v_since
    ),
    'opted_out', (
      select count(*) from public.cart_recovery_opt_outs o where o.store_id = v_store.id
    )
  );
end;
$fn$;

create or replace function public.cart_recovery_configure(
  p_store_id     uuid,
  p_enabled      boolean,
  p_delay_hours  integer,
  p_max_age_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if not found
     or not ebim.has_role(v_store.organization_id, v_store.company_id,
                          array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: solo propietario o administrador' using errcode = '42501';
  end if;

  if p_enabled is null
     or p_delay_hours is null or p_delay_hours not between 1 and 72
     or p_max_age_days is null or p_max_age_days not between 1 and 30
     or p_max_age_days * 24 <= p_delay_hours then
    raise exception 'CAMPO_INVALIDO: ventana de recuperacion fuera de rango' using errcode = '22023';
  end if;

  update public.store_settings
     set cart_recovery_enabled      = p_enabled,
         cart_recovery_delay_hours  = p_delay_hours,
         cart_recovery_max_age_days = p_max_age_days
   where store_id = v_store.id;

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no tiene configuracion' using errcode = '22023';
  end if;

  return public.cart_recovery_overview(p_store_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on function ebim.cart_recovery_block_reason(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function ebim.cart_recovery_suppress_reminder(uuid, text)   from public, anon, authenticated;
revoke execute on function ebim.cart_recovery_suppress_user(uuid, uuid)       from public, anon, authenticated;
revoke execute on function ebim.cart_recovery_guard_queue()                   from public, anon, authenticated;
revoke execute on function ebim.cart_recovery_scrub_token()                   from public, anon, authenticated;
revoke execute on function ebim.enqueue_cart_recovery(integer)                from public, anon, authenticated;
grant  execute on function ebim.enqueue_cart_recovery(integer)                to service_role;

revoke execute on function public.cart_recovery_unsubscribe(text) from public;
grant  execute on function public.cart_recovery_unsubscribe(text) to anon, authenticated, service_role;

revoke execute on function public.my_cart_reminders(text)              from public, anon;
revoke execute on function public.set_my_cart_reminders(text, boolean) from public, anon;
grant  execute on function public.my_cart_reminders(text)              to authenticated, service_role;
grant  execute on function public.set_my_cart_reminders(text, boolean) to authenticated, service_role;

revoke execute on function public.cart_recovery_overview(uuid)                             from public, anon;
revoke execute on function public.cart_recovery_configure(uuid, boolean, integer, integer) from public, anon;
grant  execute on function public.cart_recovery_overview(uuid)                             to authenticated, service_role;
grant  execute on function public.cart_recovery_configure(uuid, boolean, integer, integer) to authenticated, service_role;

comment on function ebim.enqueue_cart_recovery(integer) is
  'Encola recordatorios cart.recovery para carritos elegibles (con sesion, con lineas, dentro de la ventana, tienda con el ajuste encendido y comprador sin baja). Solo servidor; idempotente por episodio.';
comment on function public.cart_recovery_unsubscribe(text) is
  'Baja de un clic con el secreto del correo. Solo da de baja al comprador para el que se emitio el secreto, en esa tienda.';
