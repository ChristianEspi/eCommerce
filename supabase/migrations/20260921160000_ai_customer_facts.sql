-- =============================================================================
-- Clientes y fuerza de ventas con IA (EBIM_AI_SEQUENCE, fase 06) — DATASETS.
--
-- Dos funciones públicas, lo ÚNICO que ve el modelo en Clientes y Visitas:
--
--   public.ai_customer_facts(p_customer_id)   resumen 360 del cliente
--   public.ai_visit_facts(p_visit_id)         la visita + el 360 de su cliente
--
-- y un constructor interno, `ebim.ai_customer_dataset`, que arma el 360 una sola
-- vez para las dos.
--
-- ## Permisos POR DATO, no solo por pantalla
--
--  1. SECURITY INVOKER + STABLE: RLS de quien llama, solo lectura, sociedad
--     ACTIVA del token. Cliente de otra sociedad ⇒ NULL ⇒ 404 (nunca «existe
--     pero es ajeno»).
--  2. Guard de rol = roles de la funcionalidad (`ebim.ai_feature_roles`):
--     `customers` (owner, admin, orders, viewer, sales_rep) y `sales` (owner,
--     admin, sales_rep) + módulo contratado (`customers` es baseline;
--     `sales.force` no).
--  3. CARTERA: la RLS de `customers` deja ver toda la base a cualquier miembro,
--     pero un vendedor (rol `sales_rep` sin otro rol de oficina) solo obtiene
--     el 360 de los clientes de SU cartera (`sales_rep_customers`). Fuera de
--     ella ⇒ NULL, igual que un cliente ajeno.
--  4. CRÉDITO / DEUDA solo con rol owner/admin/orders (los que ven
--     `ar_documents` por RLS) y `credit.management` contratado. Sin permiso la
--     sección es `null` y `sections.credit = false`: no se devuelven ceros que
--     el modelo pudiera leer como «no debe nada».
--  5. VISITAS solo para quien las ve por RLS (owner/admin o el propio
--     vendedor) y con `sales.force`; para el resto `null`, por la misma razón.
--  6. Promociones con `promotions`, devoluciones con `fulfillment`,
--     cotizaciones con `trade.quotes` (y su RLS).
--  7. Reducido: sin correo, teléfono, documento fiscal, dirección ni
--     coordenadas (solo si EXISTEN, en booleanos); sin notas internas de la
--     ficha; listas con tope; textos recortados. Lo que sí viaja escrito por
--     personas (nombre del cliente y de productos, notas y tareas de visita) es
--     DATO NO CONFIABLE y la Edge Function lo delimita.
--
-- ## El enlace pedido → cliente se DECLARA
--
-- `orders` no tiene `customer_id`. Se usan las dos únicas verdades que existen:
-- la cuenta B2B del pedido (`business_account_id`) y el correo de la ficha o de
-- sus contactos (la misma heurística que `public.customer_orders`). El dataset
-- devuelve `orders.link` (`account`, `email`, `account_and_email`, `none`) para
-- que la pantalla y el modelo lo digan.
--
-- Todas las cifras (conteos, importes en texto, días) se calculan aquí. Las
-- SEÑALES (inactivo, caída de frecuencia, productos que dejó de pedir…) las
-- asigna el TS puro (`aiCustomers.ts`) con umbrales declarados, sobre estas
-- cifras. El modelo solo las explica.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ¿Es el que llama SOLO vendedor? (rol de campo sin rol de oficina)
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_is_field_only(p_org uuid, p_company uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select not ebim.has_role(p_org, p_company, array['owner','admin','orders','viewer']::public.app_role[]);
$fn$;

revoke execute on function ebim.ai_is_field_only(uuid, uuid) from public, anon;
grant  execute on function ebim.ai_is_field_only(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El 360 (interno). Presupone el guard de rol/módulo de quien lo llama, pero
-- vuelve a aplicar la regla de cartera: es la que no puede olvidarse.
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_customer_dataset(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now        timestamptz := now();
  v_org        uuid := ebim.org_id();
  v_company    uuid := ebim.active_company();
  v_rep        uuid;
  v_c          record;
  v_account    record;
  v_credit     boolean;
  v_visits     boolean;
  v_promos     boolean;
  v_returns    boolean;
  v_quotes     boolean;
  v_link       text;
  v_orders     jsonb;
  v_recent     jsonb;
  v_products   jsonb;
  v_promotions jsonb;
  v_ret        jsonb;
  v_quote      jsonb;
  v_visit      jsonb;
  v_cred       jsonb;
  v_by_account boolean;
  v_by_email   boolean;
  v_ids        uuid[];
begin
  if v_org is null or v_company is null or p_customer_id is null then
    return null;
  end if;

  -- La ficha, con la RLS de quien llama y de la sociedad activa.
  select c.id, c.kind, c.code, c.name, c.tier, c.visit_frequency, c.is_active,
         c.email is not null as has_email, c.phone is not null as has_phone,
         c.tax_id is not null as has_tax_id, c.created_at,
         s.name as segment_name, bt.name as business_type_name
    into v_c
    from public.customers c
    left join public.customer_segments s on s.id = c.segment_id
    left join public.customer_business_types bt on bt.id = c.business_type_id
   where c.id = p_customer_id
     and c.organization_id = v_org
     and c.company_id = v_company;
  if not found then
    return null;
  end if;

  -- Cartera: el vendedor de campo solo ve el 360 de SUS clientes.
  v_rep := ebim.sales_rep_of(v_org, v_company);
  if ebim.ai_is_field_only(v_org, v_company) then
    if v_rep is null or not exists (
      select 1 from public.sales_rep_customers rc
       where rc.customer_id = p_customer_id and rc.sales_rep_id = v_rep
    ) then
      return null;
    end if;
  end if;

  v_credit := ebim.has_role(v_org, v_company, array['owner','admin','orders']::public.app_role[])
              and ebim.company_is_entitled(v_org, v_company, 'credit.management');
  v_visits := ebim.company_is_entitled(v_org, v_company, 'sales.force')
              and (ebim.has_role(v_org, v_company, array['owner','admin']::public.app_role[]) or v_rep is not null);
  v_promos := ebim.company_is_entitled(v_org, v_company, 'promotions');
  v_returns := ebim.company_is_entitled(v_org, v_company, 'fulfillment');
  v_quotes := ebim.company_is_entitled(v_org, v_company, 'trade.quotes');

  select b.id, b.is_active, b.requires_approval, b.purchase_order_required,
         b.credit_status, b.credit_limit,
         (select count(*) from public.business_locations l where l.business_account_id = b.id) as locations
    into v_account
    from public.business_accounts b
   where b.customer_id = p_customer_id
     and b.organization_id = v_org and b.company_id = v_company;

  -- Pedidos del cliente: por su cuenta B2B y por el correo de la ficha o de sus
  -- contactos. Heurística DECLARADA en `link`.
  with emails as (
    select lower(c.email) as email from public.customers c
     where c.id = p_customer_id and c.email is not null
    union
    select lower(ct.email) from public.customer_contacts ct
     where ct.customer_id = p_customer_id and ct.email is not null
  ),
  enlazados as (
    select o.id,
           (v_account.id is not null and o.business_account_id = v_account.id) as by_account,
           exists (select 1 from emails e where e.email = lower(o.customer_email)) as by_email
      from public.orders o
     where o.organization_id = v_org
       and o.company_id = v_company
       and ((v_account.id is not null and o.business_account_id = v_account.id)
            or exists (select 1 from emails e where e.email = lower(o.customer_email)))
  )
  select coalesce(array_agg(id), '{}'::uuid[]), coalesce(bool_or(by_account), false), coalesce(bool_or(by_email), false)
    into v_ids, v_by_account, v_by_email
    from enlazados;
  v_link := case
              when v_by_account and v_by_email then 'account_and_email'
              when v_by_account then 'account'
              when v_by_email then 'email'
              else 'none'
            end;

  -- Cifras de pedidos. Los importes solo con moneda ÚNICA (si no, null: sumar
  -- soles con dólares es inventar un total). Ventas = sin cancelar ni devolver.
  with v as (
    select o.* from public.orders o where o.id = any(v_ids) and o.status not in ('cancelled', 'refunded')
  ),
  fechas as (
    select placed_at, lag(placed_at) over (order by placed_at) as prev from v
  ),
  mon as (
    select case when count(distinct currency) = 1 then max(currency) end as currency from v
  )
  select jsonb_build_object(
    'link', v_link,
    'total_count', (select count(*) from v),
    'count_90d', (select count(*) from v where placed_at >= v_now - interval '90 days'),
    'count_365d', (select count(*) from v where placed_at >= v_now - interval '365 days'),
    'cancelled_365d', (select count(*) from public.orders o0 where o0.id = any(v_ids)
                         and status = 'cancelled' and placed_at >= v_now - interval '365 days'),
    'open_count', (select count(*) from public.orders o0 where o0.id = any(v_ids)
                         and status not in ('fulfilled', 'cancelled', 'refunded')),
    'awaiting_payment', (select count(*) from public.orders o0 where o0.id = any(v_ids)
                         and status not in ('fulfilled', 'cancelled', 'refunded')
                            and payment_status in ('pending', 'authorized')),
    'payment_failed', (select count(*) from public.orders o0 where o0.id = any(v_ids)
                         and status not in ('fulfilled', 'cancelled', 'refunded')
                          and payment_status = 'failed'),
    'awaiting_approval', (select count(*) from public.orders o0 where o0.id = any(v_ids)
                         and status not in ('cancelled', 'refunded') and approval_status = 'pending'),
    'currency', (select currency from mon),
    'amount_90d', (select case when m.currency is null then null
                               else coalesce(sum(grand_total) filter (where placed_at >= v_now - interval '90 days'), 0)::numeric(14,2)::text end
                     from v, mon m group by m.currency),
    'amount_365d', (select case when m.currency is null then null
                                else coalesce(sum(grand_total) filter (where placed_at >= v_now - interval '365 days'), 0)::numeric(14,2)::text end
                      from v, mon m group by m.currency),
    'avg_ticket_365d', (select case when m.currency is null or count(*) filter (where placed_at >= v_now - interval '365 days') = 0 then null
                                    else (sum(grand_total) filter (where placed_at >= v_now - interval '365 days')
                                          / count(*) filter (where placed_at >= v_now - interval '365 days'))::numeric(14,2)::text end
                          from v, mon m group by m.currency),
    'days_since_last', (select floor(extract(epoch from (v_now - max(placed_at))) / 86400)::int from v),
    'days_since_first', (select floor(extract(epoch from (v_now - min(placed_at))) / 86400)::int from v),
    -- Intervalo medio entre pedidos: solo con al menos tres pedidos.
    'avg_interval_days', (select case when count(prev) >= 2
                                      then round(avg(extract(epoch from (placed_at - prev)) / 86400))::int end
                            from fechas)
  ) into v_orders;

  select coalesce(jsonb_agg(x order by x->>'placed_at' desc), '[]'::jsonb) into v_recent
    from (
      select jsonb_build_object(
               'order_id', o.id,
               'order_number', left(o.order_number, 40),
               'status', o.status,
               'payment_status', o.payment_status,
               'fulfillment_status', o.fulfillment_status,
               'approval_status', o.approval_status,
               'currency', o.currency,
               'grand_total', o.grand_total::numeric(14,2)::text,
               'days_ago', floor(extract(epoch from (v_now - o.placed_at)) / 86400)::int,
               'placed_at', o.placed_at) as x
        from public.orders o
       where o.id = any(v_ids)
       order by o.placed_at desc
       limit 5
    ) r;

  -- Productos frecuentes (365 d): en cuántos pedidos aparece, cantidad en
  -- unidades base y días desde la última compra.
  select coalesce(jsonb_agg(x order by (x->>'orders')::int desc, (x->>'quantity')::numeric desc), '[]'::jsonb)
    into v_products
    from (
      select jsonb_build_object(
               'product_id', i.product_id,
               'name', left((array_agg(i.name order by o.placed_at desc))[1], 80),
               'orders', count(distinct o.id),
               'quantity', sum(coalesce(i.base_quantity, i.quantity))::numeric(14,3)::text,
               'days_since_last', floor(extract(epoch from (v_now - max(o.placed_at))) / 86400)::int) as x
        from public.orders o
        join public.order_items i on i.order_id = o.id
       where o.id = any(v_ids)
         and o.status not in ('cancelled', 'refunded')
         and o.placed_at >= v_now - interval '365 days'
         and i.product_id is not null
       group by i.product_id
       order by count(distinct o.id) desc, sum(coalesce(i.base_quantity, i.quantity)) desc
       limit 8
    ) p;

  if v_promos then
    select coalesce(jsonb_agg(x order by (x->>'uses')::int desc), '[]'::jsonb) into v_promotions
      from (
        select jsonb_build_object(
                 'name', left(pr.name, 60),
                 'uses', count(*),
                 'days_since_last', floor(extract(epoch from (v_now - max(r.redeemed_at))) / 86400)::int) as x
          from public.promotion_redemptions r
          join public.promotions pr on pr.id = r.promotion_id
         where r.order_id = any(v_ids)
           and r.redeemed_at >= v_now - interval '365 days'
         group by pr.id, pr.name
         order by count(*) desc
         limit 5
      ) q;
  end if;

  if v_returns then
    select jsonb_build_object(
             'open', count(*) filter (where rr.state in ('requested', 'approved', 'in_transit', 'received', 'inspected')),
             'total_365d', count(*) filter (where rr.created_at >= v_now - interval '365 days'))
      into v_ret
      from public.return_requests rr
     where rr.order_id = any(v_ids);
  end if;

  if v_quotes then
    select jsonb_build_object(
             'open', count(*) filter (where q.status in ('draft', 'sent') and q.valid_until >= current_date),
             'expiring_7d', count(*) filter (where q.status in ('draft', 'sent')
                                              and q.valid_until between current_date and current_date + 7),
             'accepted_365d', count(*) filter (where q.status = 'accepted' and q.issued_at >= current_date - 365),
             'days_since_last', (current_date - max(q.issued_at))::int)
      into v_quote
      from public.quotes q
     where q.customer_id = p_customer_id
       and q.organization_id = v_org and q.company_id = v_company;
  end if;

  if v_visits then
    with vis as (
      select sv.* from public.sales_visits sv
       where sv.customer_id = p_customer_id
         and sv.organization_id = v_org and sv.company_id = v_company
    )
    select jsonb_build_object(
             'count_90d', (select count(*) from vis where coalesce(checked_in_at, planned_at) >= v_now - interval '90 days'),
             'completed_90d', (select count(*) from vis where outcome = 'completed'
                                 and coalesce(checked_in_at, planned_at) >= v_now - interval '90 days'),
             'with_order_90d', (select count(*) from vis where order_id is not null
                                  and coalesce(checked_in_at, planned_at) >= v_now - interval '90 days'),
             'no_order_90d', (select count(*) from vis where outcome = 'no_order'
                                and coalesce(checked_in_at, planned_at) >= v_now - interval '90 days'),
             'days_since_last_completed', (select floor(extract(epoch from (v_now - max(coalesce(checked_in_at, planned_at)))) / 86400)::int
                                             from vis where outcome = 'completed'),
             'next_planned_in_days', (select floor(extract(epoch from (min(planned_at) - v_now)) / 86400)::int
                                        from vis where outcome = 'planned' and planned_at >= v_now),
             'recent', coalesce((
                select jsonb_agg(x order by (x->>'days_ago')::int)
                  from (
                    select jsonb_build_object(
                             'outcome', vis.outcome,
                             'days_ago', greatest(floor(extract(epoch from (v_now - coalesce(vis.checked_in_at, vis.planned_at))) / 86400)::int, 0),
                             'has_order', vis.order_id is not null,
                             'notes', left(regexp_replace(vis.notes, '\s+', ' ', 'g'), 200)) as x
                      from vis
                     where vis.outcome <> 'planned' or vis.planned_at < v_now
                     order by coalesce(vis.checked_in_at, vis.planned_at) desc nulls last
                     limit 5
                  ) r), '[]'::jsonb),
             'pending_tasks', coalesce((
                select jsonb_agg(left(t.label, 120) order by t.created_at desc)
                  from (
                    select t.label, t.created_at
                      from public.sales_visit_tasks t
                      join vis on vis.id = t.visit_id
                     where not t.is_done
                     order by t.created_at desc
                     limit 8
                  ) t), '[]'::jsonb),
             'in_portfolio', v_rep is not null and exists (
                select 1 from public.sales_rep_customers rc
                 where rc.customer_id = p_customer_id and rc.sales_rep_id = v_rep))
      into v_visit;
  end if;

  if v_credit then
    select jsonb_build_object(
             'status', coalesce(v_account.credit_status::text, 'none'),
             'credit_limit', case when v_account.credit_limit is null then null
                                  else v_account.credit_limit::numeric(14,2)::text end,
             'aging', ebim.customer_aging(p_customer_id),
             'currencies', (select count(distinct d.currency) from public.ar_documents d
                             where d.customer_id = p_customer_id and d.balance > 0),
             'open_documents', (select count(*) from public.ar_documents d
                                 where d.customer_id = p_customer_id and d.balance > 0),
             'overdue_documents', (select count(*) from public.ar_documents d
                                    where d.customer_id = p_customer_id and d.balance > 0 and d.due_at < current_date),
             'max_days_overdue', (select max(current_date - d.due_at)::int from public.ar_documents d
                                   where d.customer_id = p_customer_id and d.balance > 0 and d.due_at < current_date))
      into v_cred;
  end if;

  return jsonb_build_object(
    'generated_at', v_now,
    'customer', jsonb_build_object(
      'customer_id', v_c.id,
      'kind', v_c.kind,
      'code', v_c.code,
      'name', left(v_c.name, 80),
      'tier', v_c.tier,
      'visit_frequency', v_c.visit_frequency,
      'segment', left(v_c.segment_name, 60),
      'business_type', left(v_c.business_type_name, 60),
      'is_active', v_c.is_active,
      'has_email', v_c.has_email,
      'has_phone', v_c.has_phone,
      'has_tax_id', v_c.has_tax_id,
      'contacts', (select count(*) from public.customer_contacts ct where ct.customer_id = p_customer_id),
      'addresses', (select count(*) from public.customer_addresses a where a.customer_id = p_customer_id),
      'days_since_created', floor(extract(epoch from (v_now - v_c.created_at)) / 86400)::int),
    'account', case when v_account.id is null then null else jsonb_build_object(
      'is_active', v_account.is_active,
      'requires_approval', v_account.requires_approval,
      'purchase_order_required', v_account.purchase_order_required,
      'locations', v_account.locations) end,
    'orders', v_orders || jsonb_build_object('recent', v_recent),
    'products', v_products,
    'promotions', v_promotions,
    'returns', v_ret,
    'quotes', v_quote,
    'visits', v_visit,
    'credit', v_cred,
    'sections', jsonb_build_object(
      'credit', v_credit, 'visits', v_visits, 'promotions', v_promos,
      'returns', v_returns, 'quotes', v_quotes)
  );
end;
$fn$;

revoke execute on function ebim.ai_customer_dataset(uuid) from public, anon;
grant  execute on function ebim.ai_customer_dataset(uuid) to authenticated, service_role;

comment on function ebim.ai_customer_dataset(uuid) is
  'Fase 06: el 360 reducido de un cliente para la IA. Invoker, sociedad activa, regla de cartera para el vendedor, credito solo owner/admin/orders con credit.management.';

-- ---------------------------------------------------------------------------
-- 1 · Resumen 360 (funcionalidad `customers`)
-- ---------------------------------------------------------------------------
create or replace function public.ai_customer_facts(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
begin
  perform ebim.assert_ai_feature_reader('customers', 'customers');
  return ebim.ai_customer_dataset(p_customer_id);
end;
$fn$;

revoke execute on function public.ai_customer_facts(uuid) from public, anon;
grant  execute on function public.ai_customer_facts(uuid) to authenticated, service_role;

comment on function public.ai_customer_facts(uuid) is
  'Fase 06: dataset del resumen 360 con IA. Roles de customers; cartera para sales_rep; credito/visitas solo con permiso. NULL si no es visible.';

-- ---------------------------------------------------------------------------
-- 2 · Visita (funcionalidad `sales`): preparar y seguimiento
-- ---------------------------------------------------------------------------
create or replace function public.ai_visit_facts(p_visit_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now     timestamptz := now();
  v_org     uuid;
  v_company uuid;
  v_visit   record;
  v_360     jsonb;
begin
  perform ebim.assert_ai_feature_reader('sales', 'sales.force');
  v_org := ebim.org_id();
  v_company := ebim.active_company();

  -- La visita con la RLS de quien llama: owner/admin o el propio vendedor.
  select sv.id, sv.customer_id, sv.outcome, sv.planned_at, sv.checked_in_at, sv.checked_out_at,
         sv.order_id, sv.notes, r.name as route_name
    into v_visit
    from public.sales_visits sv
    left join public.sales_routes r on r.id = sv.route_id
   where sv.id = p_visit_id
     and sv.organization_id = v_org and sv.company_id = v_company;
  if not found then
    return null;
  end if;

  v_360 := ebim.ai_customer_dataset(v_visit.customer_id);
  if v_360 is null then
    return null;
  end if;

  return v_360 || jsonb_build_object('visit', jsonb_build_object(
    'visit_id', v_visit.id,
    'outcome', v_visit.outcome,
    'planned_in_days', case when v_visit.planned_at >= v_now
                            then floor(extract(epoch from (v_visit.planned_at - v_now)) / 86400)::int end,
    'planned_days_ago', case when v_visit.planned_at < v_now
                             then floor(extract(epoch from (v_now - v_visit.planned_at)) / 86400)::int end,
    'checked_in', v_visit.checked_in_at is not null,
    'checked_out', v_visit.checked_out_at is not null,
    'has_order', v_visit.order_id is not null,
    'route', left(v_visit.route_name, 60),
    'notes', left(regexp_replace(v_visit.notes, '\s+', ' ', 'g'), 300),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('label', left(t.label, 120), 'done', t.is_done) order by t.position, t.created_at)
        from (select * from public.sales_visit_tasks t
               where t.visit_id = v_visit.id
               order by t.position, t.created_at
               limit 10) t), '[]'::jsonb)));
end;
$fn$;

revoke execute on function public.ai_visit_facts(uuid) from public, anon;
grant  execute on function public.ai_visit_facts(uuid) to authenticated, service_role;

comment on function public.ai_visit_facts(uuid) is
  'Fase 06: dataset de Preparar visita / Generar seguimiento. Roles de sales + sales.force; visita por RLS; 360 del cliente con las mismas reglas por dato.';
