-- =============================================================================
-- Enlaces que no llevaban a donde debían (2026-11-20, análisis del operador)
--
-- 1. «Eventos críticos» del centro de vigilancia enlazaba a /app/ops, que no
--    existe (página no encontrada). La pantalla es /app/operations; su primera
--    pestaña, «Salud», es la que cuenta esos eventos. Copia fiel de
--    20261120180000 con solo ese enlace cambiado.
--
-- 2. Los avisos de pedido del comprador (confirmado, pendiente de aprobación,
--    aprobado/rechazado, enviado, entregado) llevaban a «Mi cuenta» en general.
--    Ahora abren ESE pedido: `/s/<tienda>/account?pedido=<número>#pedidos`, que
--    la lista de pedidos lee para abrir su detalle. La página `/order/<n>` no
--    sirve: exige el token de seguimiento, que no viaja en un aviso.
--    `notification_fanout` es la de 20260912110000 (idéntica a la de QAS) con
--    solo esos cinco enlaces cambiados. Los avisos ya guardados se corrigen.
-- =============================================================================

create or replace function public.watch_findings(p_store_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org      uuid := ebim.org_id();
  v_company  uuid := ebim.active_company();
  v_now      timestamptz := now();
  v_today    date := current_date;
  v_items    jsonb := '[]'::jsonb;
  v_muted    jsonb := '[]'::jsonb;
  v_commerce boolean;
  v_catalog  boolean;
  v_admin    boolean;
  v_n        bigint;
  v_days     integer;
  v_extra    jsonb;
begin
  if v_org is null or v_company is null then
    raise exception 'SIN_PERMISO: el token no trae la jerarquia de tenant' using errcode = '42501';
  end if;
  if p_store_id is not null and not exists (
    select 1 from public.stores s
     where s.id = p_store_id and s.organization_id = v_org and s.company_id = v_company
  ) then
    raise exception 'SIN_PERMISO: esa tienda no es de tu sociedad' using errcode = '42501';
  end if;

  v_admin    := ebim.has_role(v_org, v_company, array['owner', 'admin']::public.app_role[]);
  v_commerce := ebim.has_role(v_org, v_company, array['owner', 'admin', 'orders']::public.app_role[]);
  v_catalog  := ebim.has_role(v_org, v_company, array['owner', 'admin', 'catalog', 'orders']::public.app_role[]);

  -- --- Pedidos -------------------------------------------------------------
  if v_commerce then
    select count(*), coalesce(max(floor(extract(epoch from (v_now - o.placed_at)) / 86400))::int, 0)
      into v_n, v_days
      from public.orders o
     where o.organization_id = v_org and o.company_id = v_company
       and (p_store_id is null or o.store_id = p_store_id)
       and o.status = 'pending' and o.payment_status = 'pending'
       and o.placed_at < v_now - interval '3 days';
    if v_n > 0 then
      select coalesce(jsonb_agg(jsonb_build_object(
               'label', left(a.order_number, 40),
               'days', floor(extract(epoch from (v_now - a.placed_at)) / 86400)::int) order by a.placed_at), '[]'::jsonb)
        into v_extra
        from (
          select o.order_number, o.placed_at
            from public.orders o
           where o.organization_id = v_org and o.company_id = v_company
             and (p_store_id is null or o.store_id = p_store_id)
             and o.status = 'pending' and o.payment_status = 'pending'
             and o.placed_at < v_now - interval '3 days'
           order by o.placed_at
           limit 3
        ) a;
      -- Diez pedidos sin cobrar, o uno parado más de una semana, ya no es un
      -- aviso: es dinero que no entra.
      v_items := v_items || ebim.watch_item(
        'orders.unpaid', 'orders',
        case when v_n >= 10 or v_days >= 7 then 'critica' else 'advertencia' end,
        v_n, jsonb_build_object('count', v_n, 'oldest_days', v_days), v_extra, '/app/orders');
    end if;

    select count(*), coalesce(max(floor(extract(epoch from (v_now - o.placed_at)) / 86400))::int, 0)
      into v_n, v_days
      from public.orders o
     where o.organization_id = v_org and o.company_id = v_company
       and (p_store_id is null or o.store_id = p_store_id)
       and o.status = 'paid' and o.fulfillment_status = 'unfulfilled'
       and o.placed_at < v_now - interval '2 days';
    if v_n > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('label', left(a.order_number, 40)) order by a.placed_at), '[]'::jsonb)
        into v_extra
        from (
          select o.order_number, o.placed_at
            from public.orders o
           where o.organization_id = v_org and o.company_id = v_company
             and (p_store_id is null or o.store_id = p_store_id)
             and o.status = 'paid' and o.fulfillment_status = 'unfulfilled'
             and o.placed_at < v_now - interval '2 days'
           order by o.placed_at
           limit 3
        ) a;
      v_items := v_items || ebim.watch_item(
        'orders.paid_unshipped', 'orders',
        case when v_days >= 5 then 'critica' else 'advertencia' end,
        v_n, jsonb_build_object('count', v_n, 'oldest_days', v_days), v_extra, '/app/orders');
    end if;

    select count(*) into v_n
      from public.orders o
     where o.organization_id = v_org and o.company_id = v_company
       and (p_store_id is null or o.store_id = p_store_id)
       and o.approval_status = 'pending';
    if v_n > 0 then
      v_items := v_items || ebim.watch_item(
        'orders.awaiting_approval', 'orders', 'advertencia',
        v_n, jsonb_build_object('count', v_n), '[]'::jsonb, '/app/orders');
    end if;
  end if;

  -- --- Inventario ----------------------------------------------------------
  if v_catalog and ebim.company_is_entitled(v_org, v_company, 'inventory.multiwarehouse') then
    -- La CUENTA es la de avisos, la misma que el indicador del panel: dos
    -- cifras distintas para lo mismo en la misma pantalla no se explican. Los
    -- EJEMPLOS sí van sin repetir, que es lo que no informaba.
    select count(*) into v_n
      from public.inventory_alerts a
     where a.organization_id = v_org and a.company_id = v_company
       and (p_store_id is null or a.store_id = p_store_id)
       and a.kind = 'negative';
    select coalesce(jsonb_agg(jsonb_build_object('label', d.sku) order by d.peor), '[]'::jsonb)
      into v_extra
      from (
        select distinct on (lower(a.sku)) left(a.sku, 40) as sku, a.available_qty as peor
          from public.inventory_alerts a
         where a.organization_id = v_org and a.company_id = v_company
           and (p_store_id is null or a.store_id = p_store_id)
           and a.kind = 'negative'
         order by lower(a.sku), a.available_qty
      ) d;
    if v_n > 0 then
      -- Existencia en negativo es un dato que ya no cuadra con el almacén: se
      -- vende lo que no hay.
      v_items := v_items || ebim.watch_item(
        'inventory.negative', 'inventory', 'critica',
        v_n, jsonb_build_object('count', v_n), ebim.watch_sample(v_extra), '/app/inventory?alerta=negative#alertas');
    end if;

    -- La CUENTA es la de avisos, la misma que el indicador del panel: dos
    -- cifras distintas para lo mismo en la misma pantalla no se explican. Los
    -- EJEMPLOS sí van sin repetir, que es lo que no informaba.
    select count(*) into v_n
      from public.inventory_alerts a
     where a.organization_id = v_org and a.company_id = v_company
       and (p_store_id is null or a.store_id = p_store_id)
       and a.kind = 'below_reorder';
    select coalesce(jsonb_agg(jsonb_build_object('label', d.sku) order by d.margen), '[]'::jsonb)
      into v_extra
      from (
        select distinct on (lower(a.sku)) left(a.sku, 40) as sku,
               a.available_qty - a.reorder_point as margen
          from public.inventory_alerts a
         where a.organization_id = v_org and a.company_id = v_company
           and (p_store_id is null or a.store_id = p_store_id)
           and a.kind = 'below_reorder'
         order by lower(a.sku), a.available_qty - a.reorder_point
      ) d;
    if v_n > 0 then
      v_items := v_items || ebim.watch_item(
        'inventory.below_reorder', 'inventory',
        case when v_n >= 10 then 'critica' else 'advertencia' end,
        v_n, jsonb_build_object('count', v_n), ebim.watch_sample(v_extra), '/app/inventory?alerta=below_reorder#alertas');
    end if;
  end if;

  -- --- Entregas ------------------------------------------------------------
  if v_commerce and ebim.company_is_entitled(v_org, v_company, 'fulfillment') then
    select count(*), coalesce(max(v_today - f.promised_to), 0)
      into v_n, v_days
      from public.fulfillment_overview f
     where f.organization_id = v_org and f.company_id = v_company
       and (p_store_id is null or f.store_id = p_store_id)
       and f.state not in ('delivered', 'cancelled', 'failed')
       and f.promised_to is not null and f.promised_to < v_today;
    if v_n > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('label', left(g.order_number, 40)) order by g.promised_to), '[]'::jsonb)
        into v_extra
        from (
          select f.order_number, f.promised_to
            from public.fulfillment_overview f
           where f.organization_id = v_org and f.company_id = v_company
             and (p_store_id is null or f.store_id = p_store_id)
             and f.state not in ('delivered', 'cancelled', 'failed')
             and f.promised_to is not null and f.promised_to < v_today
           order by f.promised_to
           limit 3
        ) g;
      v_items := v_items || ebim.watch_item(
        'fulfillment.overdue', 'fulfillment',
        case when v_days >= 3 or v_n >= 10 then 'critica' else 'advertencia' end,
        v_n, jsonb_build_object('count', v_n, 'days_late', v_days), v_extra, '/app/fulfillment');
    end if;

    select count(*) into v_n
      from public.fulfillment_overview f
     where f.organization_id = v_org and f.company_id = v_company
       and (p_store_id is null or f.store_id = p_store_id)
       and f.state = 'failed';
    if v_n > 0 then
      v_items := v_items || ebim.watch_item(
        'fulfillment.failed', 'fulfillment', 'critica',
        v_n, jsonb_build_object('count', v_n), '[]'::jsonb, '/app/fulfillment');
    end if;
  end if;

  -- --- Cobranza (de la sociedad: los documentos no son de una tienda) -------
  if v_admin and ebim.company_is_entitled(v_org, v_company, 'credit.management') then
    select count(*), coalesce(max(v_today - d.due_at), 0)
      into v_n, v_days
      from public.ar_documents d
     where d.organization_id = v_org and d.company_id = v_company
       and d.kind <> 'credit_note' and d.balance > 0 and d.due_at < v_today;
    if v_n > 0 then
      v_items := v_items || ebim.watch_item(
        'credit.overdue', 'credit',
        case when v_days >= 30 then 'critica' else 'advertencia' end,
        v_n, jsonb_build_object('count', v_n, 'days_overdue', v_days), '[]'::jsonb, '/app/credit');
    end if;
  end if;

  -- --- Catálogo ------------------------------------------------------------
  if v_catalog and p_store_id is not null then
    select count(*) into v_n
      from public.store_products sp
     where sp.organization_id = v_org and sp.company_id = v_company
       and sp.store_id = p_store_id and sp.status <> 'published';
    if v_n > 0 then
      v_items := v_items || ebim.watch_item(
        'catalog.unpublished', 'catalog', 'advertencia',
        v_n, jsonb_build_object('count', v_n), '[]'::jsonb, '/app/products');
    end if;
  end if;

  -- --- Plataforma: integraciones y operación -------------------------------
  if v_admin then
    select count(*) into v_n
      from public.integration_circuit c
     where c.organization_id = v_org and c.company_id = v_company and c.state <> 'closed';
    if v_n > 0 then
      -- Un disyuntor abierto es una integración que dejó de intentarlo: nada
      -- sale hacia el otro sistema hasta que alguien lo cierre.
      v_items := v_items || ebim.watch_item(
        'integrations.circuit_open', 'integrations', 'critica',
        v_n, jsonb_build_object('count', v_n), '[]'::jsonb, '/app/integrations');
    end if;

    select count(*) into v_n
      from public.ops_events e
     where e.organization_id = v_org and e.company_id = v_company
       and (p_store_id is null or e.store_id = p_store_id or e.store_id is null)
       and e.severity = 'critical'
       and e.occurred_at >= v_now - interval '24 hours';
    if v_n > 0 then
      v_items := v_items || ebim.watch_item(
        'ops.critical_events', 'ops', 'critica',
        v_n, jsonb_build_object('count', v_n, 'window_hours', 24), '[]'::jsonb, '/app/operations#salud');
    end if;
  end if;

  -- --- Silenciados ---------------------------------------------------------
  -- Se apartan, no se borran: la pantalla dice cuántos hay escondidos y desde
  -- cuándo, porque un panel que oculta sin decirlo enseña una calma falsa.
  select coalesce(jsonb_agg(item) filter (where not silenciado), '[]'::jsonb),
         coalesce(jsonb_agg(item) filter (where silenciado), '[]'::jsonb)
    into v_items, v_muted
    from (
      select e.item,
             exists (
               select 1 from public.watch_dismissals d
                where d.organization_id = v_org and d.company_id = v_company
                  and d.store_id is not distinct from p_store_id
                  and d.finding_key = e.item ->> 'key'
                  and d.fingerprint = e.item ->> 'fingerprint'
                  and d.expires_at > v_now
             ) as silenciado
        from jsonb_array_elements(v_items) as e(item)
    ) s;

  return jsonb_build_object(
    'generated_at', v_now,
    'store_id', p_store_id,
    'critical', (select count(*) from jsonb_array_elements(v_items) as e(item) where e.item ->> 'severity' = 'critica'),
    'total', jsonb_array_length(v_items),
    'items', v_items,
    'dismissed', v_muted);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- El enlace a UN pedido del comprador. El número solo entra si es seguro en una
-- URL (letras, dígitos y guiones); si no, la lista de pedidos a secas.
-- -----------------------------------------------------------------------------
create or replace function ebim.buyer_order_link(p_store_slug text, p_order_number text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_store_slug is null or p_store_slug !~ '^[a-z0-9][a-z0-9-]*$' then null
    when p_order_number ~ '^[A-Za-z0-9-]{1,40}$'
      then '/s/' || p_store_slug || '/account?pedido=' || p_order_number || '#pedidos'
    else '/s/' || p_store_slug || '/account#pedidos'
  end;
$fn$;

revoke execute on function ebim.buyer_order_link(text, text) from public, anon;
grant  execute on function ebim.buyer_order_link(text, text) to authenticated, service_role;

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
        ebim.buyer_order_link(v_store ->> 'store_slug', v_order.order_number), p_event.id, v_key);
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
        ebim.buyer_order_link(v_store ->> 'store_slug', v_order.order_number), p_event.id, v_key);

    elsif p_event.event_type = 'order.approval_decided' then
      v_kind := case v_order.approval_status
                  when 'approved' then 'order.approved'
                  when 'rejected' then 'order.rejected'
                end;
      if v_kind is not null then
        v_params := v_params || jsonb_strip_nulls(jsonb_build_object('reason', v_order.approval_reason));
        perform ebim.notify_user(v_order.organization_id, v_order.company_id, v_order.store_id,
          v_buyer, 'storefront', v_kind, v_params,
          ebim.buyer_order_link(v_store ->> 'store_slug', v_order.order_number), p_event.id, v_key);
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
        ebim.buyer_order_link(v_store ->> 'store_slug', v_order.order_number), p_event.id, v_key);
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
        ebim.buyer_order_link(v_store ->> 'store_slug', v_order.order_number), p_event.id, v_key);
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

-- Los avisos ya enviados, con el mismo enlace que tendrían hoy.
update public.notifications n
   set link = ebim.buyer_order_link(s.slug, n.params ->> 'order_number')
  from public.stores s
 where s.id = n.store_id
   and n.audience = 'storefront'
   and n.kind in ('order.confirmed', 'order.approval_pending', 'order.approved',
                  'order.rejected', 'order.shipped', 'order.delivered')
   and n.params ? 'order_number'
   and n.link is distinct from ebim.buyer_order_link(s.slug, n.params ->> 'order_number');
