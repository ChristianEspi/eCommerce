-- =============================================================================
-- Centro de vigilancia · las alertas de inventario llevan a SUS artículos (2026-11-20)
--
-- «Bajo punto de pedido» y «Existencia negativa» enlazaban a /app/inventory a
-- secas: «Reponer» abría el inventario entero y había que buscar los artículos.
-- Ahora abren Inventario › Alertas filtrado por ese tipo
-- (`?alerta=<tipo>#alertas`, que la pantalla lee). Es la definición de
-- 20260925120000 con solo esos dos enlaces cambiados.
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
        v_n, jsonb_build_object('count', v_n, 'window_hours', 24), '[]'::jsonb, '/app/ops');
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

