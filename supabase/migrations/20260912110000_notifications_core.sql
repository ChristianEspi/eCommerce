-- =============================================================================
-- Notificaciones — núcleo.
--
-- Análisis previo y decisiones: `docs/NOTIFICATIONS_ANALYSIS.md`.
--
-- ## Qué había
--
-- `domain_events` ya registraba los hechos que importan —pedido creado,
-- aprobación pedida y decidida, cobro, despacho, devolución— y nadie los
-- convertía en avisos. La tienda prometía por escrito un correo de
-- confirmación que no salía nunca.
--
-- ## Qué añade esta migración
--
--  1. `notifications` — la campanita del backoffice y los avisos de «Tu cuenta».
--     Una fila por persona y por hecho.
--  2. `notification_emails` — la cola de correo. La vacía la Edge Function
--     `notifications-dispatch`, que envía por Microsoft Graph (contrato §14).
--  3. El REPARTO: un disparador sobre `domain_events` que decide quién se
--     entera de qué. Mismo patrón que el reparto a webhooks.
--  4. Hechos NUEVOS que faltaban para los avisos de la primera entrega: acceso
--     al backoffice, vínculo B2B invitado o activado, disyuntor de integración
--     abierto, sugerido generado y enviado.
--
-- ## Tres reglas que no se negocian
--
--  · **Avisar nunca tumba el negocio.** Todo el reparto va dentro de un bloque
--    de excepción: si falla, el pedido se crea igual y queda un incidente en
--    `ops_events`, que es donde el monitor lo enseña.
--  · **El destinatario lo decide el servidor**, por rol, por cartera o por
--    vínculo. Ninguna función de esta migración acepta un destinatario ni un
--    tenant del cliente.
--  · **El aviso enlaza, no copia.** Guarda el tipo, unos pocos datos para el
--    titular y la ruta al objeto. El detalle se lee con la RLS de siempre.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null,
  company_id        uuid        not null,
  -- Opcional: hay avisos de la sociedad que no son de una tienda (una
  -- integración caída, un acceso concedido).
  store_id          uuid,
  recipient_user_id uuid        not null references auth.users (id) on delete cascade,
  -- Dónde se enseña. Un comprador no es miembro del tenant y no puede pasar la
  -- comprobación de `can_access`; un miembro sí. Separarlo en una columna es lo
  -- que permite que la RLS aplique la regla correcta a cada uno.
  audience          text        not null,
  -- Nombre estable del aviso, que es también su clave de traducción.
  kind              text        not null,
  -- Lo justo para el titular: número de pedido, importe, nombre de la cuenta.
  -- Nunca una dirección, un teléfono ni un documento.
  params            jsonb       not null default '{}'::jsonb,
  -- Ruta INTERNA de la aplicación. Nunca una URL absoluta.
  link              text,
  source_event_id   uuid,
  dedupe_key        text        not null,
  read_at           timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),

  constraint notifications_audience check (audience in ('backoffice', 'storefront')),
  constraint notifications_kind_fmt check (kind ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint notifications_link_internal
    check (link is null or (link ~ '^/[A-Za-z0-9/_?=&#.%-]*$' and link !~ '^//')),
  -- Un hecho, un aviso por persona: el reintento de un consumidor no avisa dos
  -- veces.
  constraint notifications_dedupe unique (recipient_user_id, dedupe_key),
  constraint notifications_store_fk
    foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index notifications_tenant_idx on public.notifications (organization_id, company_id);
create index notifications_inbox_idx
  on public.notifications (recipient_user_id, audience, created_at desc)
  where archived_at is null;

alter table public.notifications enable row level security;
alter table public.notifications force  row level security;

revoke all on public.notifications from public, anon;
grant select on public.notifications to authenticated;
-- Lo único que la persona cambia de su aviso: si lo leyó y si lo archivó.
grant update (read_at, archived_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- El backoffice exige además acceso a la sociedad: a quien le quitaron el
-- acceso deja de ver los avisos de esa sociedad, igual que deja de ver sus
-- pedidos. La tienda solo exige ser el destinatario, porque el comprador no es
-- miembro de nada.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (
    recipient_user_id = ebim.user_id()
    and (audience = 'storefront' or ebim.can_access(organization_id, company_id))
  );

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (
    recipient_user_id = ebim.user_id()
    and (audience = 'storefront' or ebim.can_access(organization_id, company_id))
  )
  with check (
    recipient_user_id = ebim.user_id()
    and (audience = 'storefront' or ebim.can_access(organization_id, company_id))
  );

comment on table public.notifications is
  'Avisos por persona. Los escribe solo el reparto de domain_events; la persona solo marca leído o archivado.';

-- ---------------------------------------------------------------------------
-- 2. notification_emails — la cola de correo
-- ---------------------------------------------------------------------------
create table public.notification_emails (
  id                 uuid        primary key default gen_random_uuid(),
  organization_id    uuid        not null,
  company_id         uuid        not null,
  store_id           uuid,
  kind               text        not null,
  locale             text        not null default 'es',
  to_address         text        not null,
  params             jsonb       not null default '{}'::jsonb,
  dedupe_key         text        not null,
  status             text        not null default 'pending',
  attempts           integer     not null default 0,
  max_attempts       integer     not null default 5,
  next_attempt_at    timestamptz not null default now(),
  -- Un correo transaccional caduca. Sin esto, el día que se configure el envío
  -- saldría de golpe un «recibimos tu pedido» de hace dos semanas.
  expires_at         timestamptz not null default (now() + interval '24 hours'),
  claimed_at         timestamptz,
  sent_at            timestamptz,
  -- Solo un CÓDIGO. El mensaje del proveedor puede traer la dirección dentro.
  last_error         text,
  provider_reference text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint notification_emails_status
    check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  constraint notification_emails_kind_fmt check (kind ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint notification_emails_locale check (locale in ('es', 'en')),
  constraint notification_emails_address check (position('@' in to_address) > 1),
  constraint notification_emails_not_suite check (position('@ebim.pe' in lower(to_address)) = 0),
  constraint notification_emails_dedupe unique (organization_id, company_id, dedupe_key),
  constraint notification_emails_store_fk
    foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade
);

create index notification_emails_tenant_idx on public.notification_emails (organization_id, company_id);
create index notification_emails_queue_idx
  on public.notification_emails (next_attempt_at)
  where status = 'pending';

alter table public.notification_emails enable row level security;
alter table public.notification_emails force  row level security;

revoke all on public.notification_emails from public, anon;
grant select on public.notification_emails to authenticated;
grant all on public.notification_emails to service_role;

-- Solo lectura, y solo para quien administra: sirve para ver en Configuración
-- si el correo está saliendo. Escribir la cola es cosa del reparto y del envío.
create policy notification_emails_select_admin on public.notification_emails
  for select to authenticated
  using (
    ebim.can_access(organization_id, company_id)
    and ebim.has_role(organization_id, company_id, array['owner','admin']::public.app_role[])
  );

-- ---------------------------------------------------------------------------
-- 3. Piezas del reparto
-- ---------------------------------------------------------------------------

-- Crea un aviso. Idempotente: el mismo hecho no avisa dos veces a la misma
-- persona.
create or replace function ebim.notify_user(
  p_org      uuid,
  p_company  uuid,
  p_store    uuid,
  p_user     uuid,
  p_audience text,
  p_kind     text,
  p_params   jsonb,
  p_link     text,
  p_event    uuid,
  p_dedupe   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Sin usuario de Auth no hay a quién enseñárselo. Se omite a ESA persona y no
  -- se lanza: una excepción aquí abortaría el reparto entero y nadie del resto
  -- recibiría el aviso.
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    return;
  end if;

  insert into public.notifications (
    organization_id, company_id, store_id, recipient_user_id, audience,
    kind, params, link, source_event_id, dedupe_key
  ) values (
    p_org, p_company, p_store, p_user, p_audience,
    p_kind, coalesce(p_params, '{}'::jsonb), p_link, p_event, p_dedupe
  )
  on conflict (recipient_user_id, dedupe_key) do nothing;
end;
$fn$;

-- Encola un correo. Sin dirección, o con una de la suite, no hace nada: un
-- `@ebim.pe` nunca es destinatario de negocio (contrato §13).
create or replace function ebim.queue_notification_email(
  p_org     uuid,
  p_company uuid,
  p_store   uuid,
  p_kind    text,
  p_address text,
  p_params  jsonb,
  p_dedupe  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_address text := lower(btrim(coalesce(p_address, '')));
  v_locale  text := 'es';
begin
  if position('@' in v_address) <= 1 or position('@ebim.pe' in v_address) > 0 then
    return;
  end if;

  if p_store is not null then
    select coalesce(nullif(s.default_locale, ''), 'es') into v_locale
    from public.store_settings s
    where s.store_id = p_store;
    if v_locale not in ('es', 'en') then
      v_locale := 'es';
    end if;
  end if;

  insert into public.notification_emails (
    organization_id, company_id, store_id, kind, locale, to_address, params, dedupe_key
  ) values (
    p_org, p_company, p_store, p_kind, coalesce(v_locale, 'es'), v_address,
    coalesce(p_params, '{}'::jsonb),
    -- La dirección entra en la clave como huella, no en claro.
    p_dedupe || ':' || md5(v_address)
  )
  on conflict (organization_id, company_id, dedupe_key) do nothing;
end;
$fn$;

-- Datos de la tienda para el titular y el correo: nombre, ruta y logo. Es lo
-- que pone la marca del comercio DENTRO del correo, aunque el remitente sea
-- «eCommerce by EBIM» (contrato §14).
create or replace function ebim.notification_store_params(p_store uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'store_name', s.name,
      'store_slug', s.slug,
      'store_logo', st.logo_url))
    from public.stores s
    left join public.store_settings st on st.store_id = s.id
    where s.id = p_store
  ), '{}'::jsonb);
$fn$;

-- Personal del tenant que debe enterarse, por rol. Excluye a la suite.
create or replace function ebim.notification_staff(
  p_org     uuid,
  p_company uuid,
  p_roles   public.app_role[]
)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.user_id, m.email
  from public.tenant_members m
  where m.organization_id = p_org
    and m.company_id      = p_company
    and m.status          = 'active'
    and m.role            = any (p_roles)
    and position('@ebim.pe' in lower(m.email)) = 0;
$fn$;

-- La persona que hizo el pedido, si tiene cuenta.
--
-- En B2B es el usuario VINCULADO a la cuenta del pedido cuyo correo coincide
-- con el del pedido: es el mismo criterio con el que el portal le enseña sus
-- pedidos. En B2C es la cuenta con ese correo, si existe. Si no hay nadie, el
-- comprador solo recibe el correo.
create or replace function ebim.notification_order_buyer(p_order uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_order public.orders%rowtype;
  v_user  uuid;
begin
  select * into v_order from public.orders o where o.id = p_order;
  if not found then
    return null;
  end if;

  if v_order.business_account_id is not null then
    select u.user_id into v_user
    from public.business_account_users u
    where u.business_account_id = v_order.business_account_id
      and lower(u.email) = lower(v_order.customer_email)
      and u.status = 'active'
    limit 1;
    return v_user;
  end if;

  return ebim.auth_user_for_email(v_order.customer_email);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. El reparto: de hecho a avisos
-- ---------------------------------------------------------------------------
create or replace function ebim.notification_fanout(p_event public.domain_events)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order     public.orders%rowtype;
  v_store     jsonb := '{}'::jsonb;
  v_params    jsonb;
  v_buyer     uuid;
  v_staff     record;
  v_to        text;
  v_kind      text;
  v_admin     text;
  v_account   public.business_account_users%rowtype;
  v_sugg      public.order_suggestions%rowtype;
  v_member    public.tenant_members%rowtype;
  v_key       text := p_event.event_type || ':' || p_event.id::text;
  c_orders    constant public.app_role[] := array['owner','admin','orders']::public.app_role[];
  c_admins    constant public.app_role[] := array['owner','admin']::public.app_role[];
begin
  if p_event.store_id is not null then
    v_store := ebim.notification_store_params(p_event.store_id);
  end if;

  -- ---- Hechos de un PEDIDO ------------------------------------------------
  if p_event.aggregate_type = 'order' and p_event.aggregate_id is not null then
    select * into v_order from public.orders o where o.id = p_event.aggregate_id;
    if not found then
      return;
    end if;

    v_params := v_store || jsonb_build_object(
      'order_id',     v_order.id,
      'order_number', v_order.order_number,
      'grand_total',  v_order.grand_total::text,
      'currency',     v_order.currency);
    v_admin := '/app/orders?order=' || v_order.id::text;
    v_buyer := ebim.notification_order_buyer(v_order.id);

    if p_event.event_type = 'order.created' then
      for v_staff in select * from ebim.notification_staff(v_order.organization_id, v_order.company_id, c_orders) loop
        perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
          v_staff.user_id, 'backoffice', 'order.received', v_params, v_admin, p_event.id, v_key);
      end loop;

    elsif p_event.event_type = 'notification.order_confirmation' then
      perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
        v_buyer, 'storefront', 'order.confirmed', v_params,
        '/s/' || (v_store ->> 'store_slug') || '/account', p_event.id, v_key);
      perform ebim.queue_notification_email(v_order.organization_id, v_order.company_id,
        v_order.store_id, 'order.confirmed', v_order.customer_email,
        v_params || jsonb_build_object('customer_name', v_order.customer_name), v_key);

    elsif p_event.event_type = 'order.approval_requested' then
      for v_staff in select * from ebim.notification_staff(v_order.organization_id, v_order.company_id, c_orders) loop
        perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
          v_staff.user_id, 'backoffice', 'order.approval_requested', v_params, v_admin, p_event.id, v_key);
        perform ebim.queue_notification_email(v_order.organization_id, v_order.company_id,
          v_order.store_id, 'order.approval_requested', v_staff.email,
          v_params || jsonb_build_object('path', v_admin), v_key);
      end loop;
      perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
        v_buyer, 'storefront', 'order.approval_pending', v_params,
        '/s/' || (v_store ->> 'store_slug') || '/account', p_event.id, v_key);

    elsif p_event.event_type = 'order.approval_decided' then
      v_kind := case v_order.approval_status
                  when 'approved' then 'order.approved'
                  when 'rejected' then 'order.rejected'
                end;
      if v_kind is not null then
        v_params := v_params || jsonb_strip_nulls(jsonb_build_object('reason', v_order.approval_reason));
        perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
          v_buyer, 'storefront', v_kind, v_params,
          '/s/' || (v_store ->> 'store_slug') || '/account', p_event.id, v_key);
        perform ebim.queue_notification_email(v_order.organization_id, v_order.company_id,
          v_order.store_id, v_kind, v_order.customer_email, v_params, v_key);
      end if;

    elsif p_event.event_type = 'order.payment_status_changed'
          and p_event.payload ->> 'to' = 'failed' then
      for v_staff in select * from ebim.notification_staff(v_order.organization_id, v_order.company_id, c_orders) loop
        perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
          v_staff.user_id, 'backoffice', 'order.payment_failed', v_params, v_admin, p_event.id, v_key);
      end loop;

    elsif p_event.event_type = 'order.fulfillment_status_changed'
          and p_event.payload ->> 'to' in ('partially_fulfilled', 'fulfilled') then
      perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
        v_buyer, 'storefront', 'order.shipped', v_params,
        '/s/' || (v_store ->> 'store_slug') || '/account', p_event.id, v_key);
      perform ebim.queue_notification_email(v_order.organization_id, v_order.company_id,
        v_order.store_id, 'order.shipped', v_order.customer_email, v_params, v_key);
    end if;

    return;
  end if;

  -- ---- Entregado: el agregado es el despacho, el pedido va en el payload ---
  if p_event.event_type = 'fulfillment.delivered' then
    select * into v_order from public.orders o where o.id = (p_event.payload ->> 'order_id')::uuid;
    if found then
      v_store := ebim.notification_store_params(v_order.store_id);
      perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
        ebim.notification_order_buyer(v_order.id), 'storefront', 'order.delivered',
        v_store || jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number),
        '/s/' || (v_store ->> 'store_slug') || '/account', p_event.id, v_key);
    end if;
    return;
  end if;

  -- ---- Devolución pedida --------------------------------------------------
  if p_event.event_type = 'return.requested' then
    v_params := v_store || jsonb_strip_nulls(jsonb_build_object(
      'order_id',     p_event.payload ->> 'order_id',
      'order_number', p_event.payload ->> 'order_number',
      'rma_number',   p_event.payload ->> 'rma_number'));
    for v_staff in select * from ebim.notification_staff(p_event.organization_id, p_event.company_id, c_orders) loop
      perform ebim.notify_user(p_event.organization_id, p_event.company_id, p_event.store_id,
        v_staff.user_id, 'backoffice', 'return.requested', v_params,
        '/app/orders?order=' || (p_event.payload ->> 'order_id'), p_event.id, v_key);
    end loop;
    return;
  end if;

  -- ---- Integración caída --------------------------------------------------
  if p_event.event_type = 'integration.circuit_opened' then
    v_params := jsonb_build_object(
      'provider_code', p_event.payload ->> 'provider_code',
      'operation',     p_event.payload ->> 'operation');
    for v_staff in select * from ebim.notification_staff(p_event.organization_id, p_event.company_id, c_admins) loop
      perform ebim.notify_user(p_event.organization_id, p_event.company_id, null,
        v_staff.user_id, 'backoffice', 'integration.circuit_opened', v_params,
        '/app/integrations', p_event.id, v_key);
      perform ebim.queue_notification_email(p_event.organization_id, p_event.company_id, null,
        'integration.circuit_opened', v_staff.email,
        v_params || jsonb_build_object('path', '/app/integrations'), v_key);
    end loop;
    return;
  end if;

  -- ---- Acceso al backoffice ----------------------------------------------
  if p_event.aggregate_type = 'tenant_member' and p_event.aggregate_id is not null then
    select * into v_member from public.tenant_members m where m.id = p_event.aggregate_id;
    if not found then
      return;
    end if;
    v_params := jsonb_build_object('role', v_member.role::text);
    v_kind := case p_event.event_type
                when 'member.access_granted' then 'member.access_granted'
                when 'member.role_changed'   then 'member.role_changed'
                when 'member.access_revoked' then 'member.access_revoked'
              end;
    if v_kind is null then
      return;
    end if;
    -- Sin acceso ya no hay campanita que ver: el aviso de acceso retirado va
    -- solo por correo.
    if v_kind <> 'member.access_revoked' then
      perform ebim.notify_user(v_member.organization_id, v_member.company_id, null,
        v_member.user_id, 'backoffice', v_kind, v_params, '/app', p_event.id, v_key);
    end if;
    perform ebim.queue_notification_email(v_member.organization_id, v_member.company_id, null,
      v_kind, v_member.email, v_params || jsonb_build_object('path', '/app'), v_key);
    return;
  end if;

  -- ---- Vínculo con una cuenta B2B ----------------------------------------
  if p_event.aggregate_type = 'business_account_user' and p_event.aggregate_id is not null then
    select * into v_account from public.business_account_users u where u.id = p_event.aggregate_id;
    if not found then
      return;
    end if;
    v_kind := case p_event.event_type
                when 'business_account.user_invited'   then 'business_account.invited'
                when 'business_account.user_activated' then 'business_account.activated'
              end;
    if v_kind is null then
      return;
    end if;
    v_params := jsonb_build_object(
      'account_name', (select a.name from public.business_accounts a where a.id = v_account.business_account_id));
    -- La tienda de la sociedad, para el enlace y la marca del correo.
    select ebim.notification_store_params(s.id) into v_store
    from public.stores s
    where s.organization_id = v_account.organization_id
      and s.company_id = v_account.company_id
      and s.status = 'active'
    order by s.created_at
    limit 1;
    v_params := coalesce(v_store, '{}'::jsonb) || v_params;
    perform ebim.notify_user(v_account.organization_id, v_account.company_id, null,
      v_account.user_id, 'storefront', v_kind, v_params,
      case when v_store ? 'store_slug' then '/s/' || (v_store ->> 'store_slug') || '/account' end,
      p_event.id, v_key);
    perform ebim.queue_notification_email(v_account.organization_id, v_account.company_id, null,
      v_kind, v_account.email, v_params, v_key);
    return;
  end if;

  -- ---- Sugerido de pedido --------------------------------------------------
  if p_event.aggregate_type = 'order_suggestion' and p_event.aggregate_id is not null then
    select * into v_sugg from public.order_suggestions s where s.id = p_event.aggregate_id;
    if not found then
      return;
    end if;
    v_store := ebim.notification_store_params(v_sugg.store_id);
    v_params := v_store || jsonb_build_object(
      'suggestion_id', v_sugg.id,
      'customer_name', (select c.name from public.customers c where c.id = v_sugg.customer_id));

    if p_event.event_type = 'suggestion.generated' then
      -- Al vendedor de esa cartera, si usa la aplicación.
      perform ebim.notify_user(v_sugg.organization_id, v_sugg.company_id, v_sugg.store_id,
        (select r.user_id from public.sales_reps r
          where r.id = v_sugg.sales_rep_id and r.status = 'active'),
        'backoffice', 'suggestion.generated', v_params, '/app/planning', p_event.id, v_key);

    elsif p_event.event_type = 'suggestion.sent' then
      -- A los compradores activos de las cuentas B2B de ese cliente.
      for v_account in
        select u.*
        from public.business_account_users u
        join public.business_accounts a on a.id = u.business_account_id
        where a.customer_id = v_sugg.customer_id
          and a.organization_id = v_sugg.organization_id
          and a.company_id = v_sugg.company_id
          and a.is_active
          and u.status = 'active'
          and u.role in ('admin', 'buyer')
      loop
        perform ebim.notify_user(v_sugg.organization_id, v_sugg.company_id, v_sugg.store_id,
          v_account.user_id, 'storefront', 'suggestion.sent', v_params,
          '/s/' || (v_store ->> 'store_slug') || '/account#sugeridos', p_event.id, v_key);
        perform ebim.queue_notification_email(v_sugg.organization_id, v_sugg.company_id,
          v_sugg.store_id, 'suggestion.sent', v_account.email, v_params, v_key);
      end loop;
    end if;
    return;
  end if;
end;
$fn$;

-- El puente, con la regla de oro: avisar nunca tumba el hecho que avisa.
create or replace function ebim.notification_on_domain_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  begin
    perform ebim.notification_fanout(new);
  exception when others then
    perform ebim.record_ops_event(
      new.organization_id, new.company_id,
      'event_undelivered', 'AVISO_NO_REPARTIDO',
      'notify:' || new.id::text,
      'error',
      'No se pudieron crear los avisos del evento ' || new.event_type,
      'db', 'notification.fanout', null, new.aggregate_type, new.aggregate_id, new.store_id);
  end;
  return null;
end;
$fn$;

create trigger domain_events_notification_fanout
  after insert on public.domain_events
  for each row execute function ebim.notification_on_domain_event();

-- ---------------------------------------------------------------------------
-- 5. Hechos nuevos que faltaban
--
-- Se publican con disparadores y no dentro de cada función que escribe, porque
-- estas tablas se escriben por más de un camino —la función de alta y la
-- edición directa bajo RLS— y un aviso que depende de por dónde entró el cambio
-- es un aviso que un día no sale.
--
-- `txid_current()` en la clave: un mismo vínculo puede activarse, revocarse y
-- volver a activarse, y cada vez es un hecho distinto. Dentro de una misma
-- transacción, en cambio, un reintento no duplica.
-- ---------------------------------------------------------------------------

create or replace function ebim.publish_member_fact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    -- El propietario nace con el tenant y es quien lo crea: no hay a quién
    -- avisar de que tiene acceso.
    if new.status = 'active' and new.role <> 'owner' then
      v_type := 'member.access_granted';
    end if;
  elsif new.status = 'active' and old.status is distinct from 'active' then
    v_type := 'member.access_granted';
  elsif new.status = 'revoked' and old.status = 'active' then
    v_type := 'member.access_revoked';
  elsif new.status = 'active' and new.role is distinct from old.role then
    v_type := 'member.role_changed';
  end if;

  if v_type is not null then
    begin
      perform ebim.publish_event(new.organization_id, new.company_id, null,
        v_type, 'tenant_member', new.id,
        jsonb_build_object('member_id', new.id, 'role', new.role::text),
        v_type || ':' || new.id::text || ':' || txid_current()::text);
    exception when others then
      perform ebim.record_ops_event(new.organization_id, new.company_id,
        'event_undelivered', 'HECHO_NO_PUBLICADO', 'member-fact:' || new.id::text || ':' || txid_current()::text,
        'error', 'No se pudo publicar ' || v_type, 'db', 'notification.publish',
        null, 'tenant_member', new.id);
    end;
  end if;
  return null;
end;
$fn$;

create trigger tenant_members_publish_fact
  after insert or update of status, role on public.tenant_members
  for each row execute function ebim.publish_member_fact();

create or replace function ebim.publish_business_link_fact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    v_type := case new.status
                when 'invited' then 'business_account.user_invited'
                when 'active'  then 'business_account.user_activated'
              end;
  elsif new.status = 'active' and old.status is distinct from 'active' then
    v_type := 'business_account.user_activated';
  elsif new.status = 'invited' and old.status is distinct from 'invited' then
    v_type := 'business_account.user_invited';
  end if;

  if v_type is not null then
    begin
      perform ebim.publish_event(new.organization_id, new.company_id, null,
        v_type, 'business_account_user', new.id,
        jsonb_build_object('business_account_id', new.business_account_id, 'role', new.role::text),
        v_type || ':' || new.id::text || ':' || txid_current()::text);
    exception when others then
      perform ebim.record_ops_event(new.organization_id, new.company_id,
        'event_undelivered', 'HECHO_NO_PUBLICADO', 'link-fact:' || new.id::text || ':' || txid_current()::text,
        'error', 'No se pudo publicar ' || v_type, 'db', 'notification.publish',
        null, 'business_account_user', new.id);
    end;
  end if;
  return null;
end;
$fn$;

create trigger business_account_users_publish_fact
  after insert or update of status on public.business_account_users
  for each row execute function ebim.publish_business_link_fact();

create or replace function ebim.publish_circuit_fact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.state = 'open' and old.state is distinct from 'open' then
    begin
      perform ebim.publish_event(new.organization_id, new.company_id, null,
        'integration.circuit_opened', 'integration_circuit', new.id,
        jsonb_build_object('provider_code', new.provider_code, 'operation', new.operation,
                           'consecutive_fail', new.consecutive_fail),
        'integration.circuit_opened:' || new.id::text || ':' || txid_current()::text);
    exception when others then
      perform ebim.record_ops_event(new.organization_id, new.company_id,
        'event_undelivered', 'HECHO_NO_PUBLICADO', 'circuit-fact:' || new.id::text || ':' || txid_current()::text,
        'error', 'No se pudo publicar integration.circuit_opened', 'db', 'notification.publish',
        null, 'integration_circuit', new.id);
    end;
  end if;
  return null;
end;
$fn$;

create trigger integration_circuit_publish_fact
  after update of state on public.integration_circuit
  for each row execute function ebim.publish_circuit_fact();

create or replace function ebim.publish_suggestion_fact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    v_type := 'suggestion.generated';
  elsif new.status = 'sent' and old.status is distinct from 'sent' then
    v_type := 'suggestion.sent';
  end if;

  if v_type is not null then
    begin
      perform ebim.publish_event(new.organization_id, new.company_id, new.store_id,
        v_type, 'order_suggestion', new.id,
        jsonb_build_object('suggestion_id', new.id, 'customer_id', new.customer_id),
        v_type || ':' || new.id::text || ':' || txid_current()::text);
    exception when others then
      perform ebim.record_ops_event(new.organization_id, new.company_id,
        'event_undelivered', 'HECHO_NO_PUBLICADO', 'suggestion-fact:' || new.id::text || ':' || txid_current()::text,
        'error', 'No se pudo publicar ' || v_type, 'db', 'notification.publish',
        null, 'order_suggestion', new.id, new.store_id);
    end;
  end if;
  return null;
end;
$fn$;

create trigger order_suggestions_publish_fact
  after insert or update of status on public.order_suggestions
  for each row execute function ebim.publish_suggestion_fact();

-- Ninguna pieza del reparto la llama un cliente: son de disparador o internas.
revoke execute on function ebim.notify_user(uuid, uuid, uuid, uuid, text, text, jsonb, text, uuid, text) from public;
revoke execute on function ebim.queue_notification_email(uuid, uuid, uuid, text, text, jsonb, text) from public;
revoke execute on function ebim.notification_store_params(uuid) from public;
revoke execute on function ebim.notification_staff(uuid, uuid, public.app_role[]) from public;
revoke execute on function ebim.notification_order_buyer(uuid) from public;
revoke execute on function ebim.notification_fanout(public.domain_events) from public;
revoke execute on function ebim.notification_on_domain_event() from public;
revoke execute on function ebim.publish_member_fact() from public;
revoke execute on function ebim.publish_business_link_fact() from public;
revoke execute on function ebim.publish_circuit_fact() from public;
revoke execute on function ebim.publish_suggestion_fact() from public;

-- ---------------------------------------------------------------------------
-- 6. La cola de correo, para el que envía
--
-- Solo `service_role`: vaciar la cola es una operación de servidor. Mismo
-- patrón que `integration_claim`: `for update skip locked` para que dos pasadas
-- en paralelo no envíen dos veces el mismo correo.
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

  return query
  with elegidos as (
    select e.id
    from public.notification_emails e
    where e.status = 'pending'
      and e.next_attempt_at <= now()
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

create or replace function public.notification_email_complete(
  p_id        uuid,
  p_reference text default null
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  update public.notification_emails
     set status = 'sent', sent_at = now(), last_error = null,
         provider_reference = left(p_reference, 200), updated_at = now()
   where id = p_id and status = 'sending';
$fn$;

create or replace function public.notification_email_fail(
  p_id        uuid,
  p_error     text,
  p_retryable boolean default true
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  update public.notification_emails
     set status = case
                    when not p_retryable or attempts >= max_attempts then 'failed'
                    else 'pending'
                  end,
         -- Espera creciente: 2, 4, 8, 16 minutos.
         next_attempt_at = now() + make_interval(mins => power(2, least(attempts, 6))::int),
         last_error = left(regexp_replace(coalesce(p_error, 'ERROR'), '[^A-Z0-9_]', '', 'g'), 60),
         claimed_at = null,
         updated_at = now()
   where id = p_id and status = 'sending';
$fn$;

revoke execute on function public.notification_email_claim(integer) from public, anon, authenticated;
revoke execute on function public.notification_email_complete(uuid, text) from public, anon, authenticated;
revoke execute on function public.notification_email_fail(uuid, text, boolean) from public, anon, authenticated;
grant  execute on function public.notification_email_claim(integer) to service_role;
grant  execute on function public.notification_email_complete(uuid, text) to service_role;
grant  execute on function public.notification_email_fail(uuid, text, boolean) to service_role;
