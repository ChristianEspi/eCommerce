-- =============================================================================
-- Estado de cuenta por tienda (2026-11-18).
--
-- `my_account_statement()` devolvía TODAS las cuentas empresa del usuario, de
-- todos los vendedores: un comprador de Distribuidora Andina (cliente de
-- FerroMax) veía esa cuenta en «Tu cuenta» de /s/miquimica. Ahora recibe el
-- slug de la tienda y devuelve solo las cuentas con el vendedor de esa tienda.
-- Sin slug se comporta como antes (todas las del usuario).
--
-- Se borra la versión sin argumentos: con las dos, una llamada sin argumentos
-- sería ambigua.
-- =============================================================================

drop function if exists public.my_account_statement();

create or replace function public.my_account_statement(p_store_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_rows    jsonb;
  v_org     uuid;
  v_company uuid;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  -- Desde una tienda, solo las cuentas con SU vendedor. El slug solo acota:
  -- quién ve qué lo sigue decidiendo el vínculo activo del usuario.
  if p_store_slug is not null then
    select s.organization_id, s.company_id into v_org, v_company
      from public.stores s where s.slug = p_store_slug;
    if v_company is null then
      return '[]'::jsonb;
    end if;
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.account_name), '[]'::jsonb)
    into v_rows
  from (
    select a.id                 as account_id,
           a.name               as account_name,
           a.code               as account_code,
           a.credit_limit::text as credit_limit,
           a.payment_terms_days as payment_terms_days,
           a.credit_status::text as credit_status,
           coalesce((linea->>'used')::numeric, 0)::text    as balance_due,
           case when a.credit_limit is null then null
                else (linea->>'available')::numeric::text end as credit_available,
           coalesce((linea->>'overdue')::numeric, 0)::text as overdue_amount,
           coalesce(deuda.documentos, '[]'::jsonb)          as documents,
           coalesce(anual.comprado, 0)::text  as purchased_12m,
           coalesce(anual.pagado, 0)::text    as paid_12m,
           coalesce(pend.pedidos, '[]'::jsonb)  as pending_payments,
           coalesce(pend.total, 0)::text        as pending_payments_total,
           coalesce(deuda.moneda, anual.moneda, pend.moneda) as currency
    from public.business_accounts a
    join public.business_account_users u
      on u.business_account_id = a.id
     and u.user_id = ebim.user_id()
     and u.status  = 'active'
    cross join lateral (select ebim.credit_line(a.id) as linea) l
    -- Lo que se debe A CRÉDITO: las deudas abiertas, no los pagos pendientes.
    left join lateral (
      select min(d.currency) as moneda,
             jsonb_agg(jsonb_build_object(
               'order_id',       coalesce(d.order_id, d.id),
               'order_number',   d.document_number,
               'placed_at',      d.issued_at,
               'due_at',         d.due_at,
               'days_overdue',   greatest(current_date - d.due_at, 0),
               'total',          d.balance::text,
               'currency',       d.currency,
               'status',         coalesce(o.status::text, 'pending'),
               'payment_status', coalesce(o.payment_status::text, 'pending')
             ) order by d.due_at) as documentos
        from public.ar_documents d
        left join public.orders o on o.id = d.order_id
       where d.voided_at is null and d.balance > 0
         and (d.business_account_id = a.id
              or (d.business_account_id is null and d.customer_id = a.customer_id))
    ) deuda on true
    -- Pagado pero sin confirmar: no es crédito. Lo que ya es deuda a crédito
    -- (tiene documento vivo) se queda en `documents` y no se cuenta dos veces.
    left join lateral (
      select sum(o.grand_total) as total,
             min(o.currency)    as moneda,
             jsonb_agg(jsonb_build_object(
               'order_id',       o.id,
               'order_number',   o.order_number,
               'placed_at',      o.placed_at,
               'total',          o.grand_total::text,
               'currency',       o.currency,
               'method',         (select pm.display_name
                                    from public.payment_intents pi
                                    join public.payment_methods pm on pm.id = pi.payment_method_id
                                   where pi.order_id = o.id
                                   order by pi.created_at desc limit 1)
             ) order by o.placed_at) as pedidos
        from public.orders o
       where o.business_account_id = a.id
         and o.status <> 'cancelled'
         and o.payment_status in ('pending', 'authorized')
         and not exists (select 1 from public.ar_documents d
                          where d.order_id = o.id and d.voided_at is null)
    ) pend on true
    left join lateral (
      select sum(o.grand_total)                                        as comprado,
             sum(o.grand_total) filter (where o.payment_status = 'paid') as pagado,
             min(o.currency)                                           as moneda
        from public.orders o
       where o.business_account_id = a.id
         and o.status <> 'cancelled'
         and o.placed_at > now() - interval '12 months'
    ) anual on true
    where a.is_active
      and (v_company is null or (a.organization_id = v_org and a.company_id = v_company))
  ) t;

  return v_rows;
end;
$fn$;

revoke execute on function public.my_account_statement(text) from public, anon;
grant execute on function public.my_account_statement(text) to authenticated;

comment on function public.my_account_statement(text) is
  'Estado de cuenta del comprador: sus cuentas empresa activas (solo las del vendedor de p_store_slug si se indica), con deuda a credito, vencido, linea disponible y pagos por confirmar.';
