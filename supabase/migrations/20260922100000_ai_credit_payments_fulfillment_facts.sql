-- =============================================================================
-- Crédito, pagos y entregas con IA (EBIM_AI_SEQUENCE, fase 08) — DATASETS.
--
-- Tres funciones, lo ÚNICO que ve el modelo en Crédito, Pagos y Fulfillment:
--
--   public.ai_collections_facts(p_customer_id?)          cobranza (cartera o cliente)
--   public.ai_payments_facts(p_store_id, p_intent_id?)   cobros, fallos y conciliación
--   public.ai_fulfillment_facts(p_store_id, p_fulfillment_id?)  atrasos e incidencias
--
-- ## CÁLCULO DEL SISTEMA, aquí; INTERPRETACIÓN IA, fuera
--
-- Toda cifra (saldo, vencido, días de atraso, importes del cobro y del
-- extracto, días sin avance) y toda MARCA por fila (`signals`) se calculan en
-- SQL con umbrales DECLARADOS y devueltos en `thresholds`. El modelo solo las
-- cita por clave y las explica. Ninguna de estas funciones escribe: la IA no
-- puede cambiar un límite, bloquear o desbloquear una cuenta, marcar un cobro
-- como pagado, conciliar, despachar ni cancelar. Esos siguen siendo los
-- comandos de siempre (`ar_receipts`, `payment_reconciliation_match`,
-- `fulfillment_*`), con su validación, pulsados por una persona.
--
-- ## Reglas comunes (las de las fases 02–07)
--
--  1. SECURITY INVOKER + STABLE: RLS de quien llama, solo lectura. Filtradas
--     además por la sociedad ACTIVA del token.
--  2. Guard = roles de la funcionalidad (`ebim.ai_feature_roles`) + MÓDULO
--     contratado (`ebim.assert_ai_feature_reader`): `credit` (owner, admin;
--     `credit.management`), `payments` (owner, admin, orders; `payments`),
--     `fulfillment` (owner, admin, orders; `fulfillment`). Tienda ajena ⇒
--     `SIN_PERMISO`; entidad ajena o invisible ⇒ `NULL` (404, nunca «existe
--     pero es de otro»).
--  3. DATOS MÍNIMOS: sin correos, teléfonos, direcciones, documentos fiscales,
--     nombres de contacto, números de guía, enlaces de seguimiento, datos de
--     quien recibió, geolocalización, método/referencia/notas de un cobro ni
--     el DETALLE técnico de un error (solo su CÓDIGO). Listas con tope y textos
--     recortados; los textos libres que sí viajan (descripción de un evento del
--     operador, motivo de una prueba de entrega) son DATO NO CONFIABLE y la
--     Edge Function los delimita.
--  4. Importes como TEXTO con dos decimales (regla del repositorio). Con más
--     de una moneda en juego, los totales agregados son `NULL`: sumar soles y
--     dólares da una cifra que no existe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Cobranza (funcionalidad `credit`)
-- ---------------------------------------------------------------------------
-- Umbrales: por vencer = vence en los próximos 7 días · cobro sin aplicar =
-- recibo con importe mayor que lo aplicado · sin cobros recientes = ningún
-- recibo en 60 días teniendo deuda vencida.
create or replace function public.ai_collections_facts(p_customer_id uuid default null)
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
  v_c        record;
  v_account  record;
  v_monedas  integer;
  v_moneda   text;
  v_resumen  jsonb;
  v_docs     jsonb;
  v_recibos  jsonb;
  v_clientes jsonb;
  v_thresholds jsonb := jsonb_build_object('due_soon_days', 7, 'no_receipt_days', 60, 'max_documents', 15, 'max_customers', 10);
begin
  perform ebim.assert_ai_feature_reader('credit', 'credit.management');

  -- ---- Un cliente ----------------------------------------------------------
  if p_customer_id is not null then
    select c.id, c.code, c.name, c.is_active
      into v_c
      from public.customers c
     where c.id = p_customer_id
       and c.organization_id = v_org and c.company_id = v_company;
    if v_c.id is null then
      return null;
    end if;

    select a.credit_status, a.credit_limit, a.payment_terms_days, a.is_active
      into v_account
      from public.business_accounts a
     where a.customer_id = p_customer_id
       and a.organization_id = v_org and a.company_id = v_company;

    select count(distinct d.currency), max(d.currency)
      into v_monedas, v_moneda
      from public.ar_documents d
     where d.customer_id = p_customer_id and d.balance > 0
       and d.organization_id = v_org and d.company_id = v_company;

    select jsonb_build_object(
             'open_documents', count(*),
             'overdue_documents', count(*) filter (where d.due_at < current_date),
             'due_soon_documents', count(*) filter (where d.due_at between current_date and current_date + 7),
             'max_days_overdue', max(current_date - d.due_at) filter (where d.due_at < current_date),
             'oldest_issue_days', max(current_date - d.issued_at))
      into v_resumen
      from public.ar_documents d
     where d.customer_id = p_customer_id and d.balance > 0
       and d.organization_id = v_org and d.company_id = v_company;

    select coalesce(jsonb_agg(x order by (x->>'days_overdue')::int desc, x->>'document_number'), '[]'::jsonb)
      into v_docs
      from (
        select jsonb_build_object(
                 'document_id', d.id,
                 'document_number', left(d.document_number, 60),
                 'kind', d.kind,
                 'currency', d.currency,
                 'amount', d.amount::numeric(14,2)::text,
                 'balance', d.balance::numeric(14,2)::text,
                 'days_overdue', current_date - d.due_at,
                 'days_since_issued', current_date - d.issued_at,
                 'has_order', d.order_id is not null) as x
          from public.ar_documents d
         where d.customer_id = p_customer_id and d.balance > 0
           and d.organization_id = v_org and d.company_id = v_company
         order by d.due_at, d.document_number
         limit 15
      ) q;

    -- Cobros: importe y cuánto queda sin aplicar. Ni método, ni referencia, ni
    -- notas: no hacen falta para explicar la deuda y pueden llevar datos
    -- bancarios.
    select coalesce(jsonb_agg(x order by (x->>'days_ago')::int), '[]'::jsonb)
      into v_recibos
      from (
        select jsonb_build_object(
                 'currency', r.currency,
                 'amount', r.amount::numeric(14,2)::text,
                 'unapplied', (r.amount - coalesce(ap.aplicado, 0))::numeric(14,2)::text,
                 'days_ago', current_date - r.received_at) as x
          from public.ar_receipts r
          left join lateral (
            select sum(a.amount) as aplicado from public.ar_applications a where a.receipt_id = r.id
          ) ap on true
         where r.customer_id = p_customer_id
           and r.organization_id = v_org and r.company_id = v_company
         order by r.received_at desc, r.created_at desc
         limit 5
      ) q;

    return jsonb_build_object(
      'generated_at', v_now,
      'scope', 'customer',
      'thresholds', v_thresholds,
      'customer', jsonb_build_object(
        'customer_id', v_c.id,
        'code', left(v_c.code, 40),
        'name', left(v_c.name, 80),
        'is_active', v_c.is_active),
      'account', case when v_account.credit_status is null then null else jsonb_build_object(
        'credit_status', v_account.credit_status,
        'credit_limit', case when v_account.credit_limit is null then null
                             else v_account.credit_limit::numeric(14,2)::text end,
        'payment_terms_days', v_account.payment_terms_days,
        'is_active', v_account.is_active) end,
      'currencies', v_monedas,
      -- Con una sola moneda, la antigüedad de saldos de siempre; con varias, nada.
      'aging', case when v_monedas <= 1 then ebim.customer_aging(p_customer_id) else null end,
      'summary', v_resumen,
      'documents', v_docs,
      'receipts', v_recibos,
      'days_since_last_receipt', (select current_date - max(r.received_at) from public.ar_receipts r
                                   where r.customer_id = p_customer_id
                                     and r.organization_id = v_org and r.company_id = v_company)
    );
  end if;

  -- ---- La cartera de la sociedad --------------------------------------------
  select count(distinct d.currency), max(d.currency)
    into v_monedas, v_moneda
    from public.ar_documents d
   where d.balance > 0 and d.organization_id = v_org and d.company_id = v_company;

  select jsonb_build_object(
           'open_documents', count(*),
           'overdue_documents', count(*) filter (where d.due_at < current_date),
           'due_soon_documents', count(*) filter (where d.due_at between current_date and current_date + 7),
           'customers_with_debt', count(distinct d.customer_id),
           'customers_overdue', count(distinct d.customer_id) filter (where d.due_at < current_date),
           'max_days_overdue', max(current_date - d.due_at) filter (where d.due_at < current_date),
           'total', case when v_monedas = 1 then coalesce(sum(d.balance), 0)::numeric(14,2)::text end,
           'current', case when v_monedas = 1 then coalesce(sum(d.balance) filter (where d.due_at >= current_date), 0)::numeric(14,2)::text end,
           'overdue', case when v_monedas = 1 then coalesce(sum(d.balance) filter (where d.due_at < current_date), 0)::numeric(14,2)::text end,
           'due_1_30', case when v_monedas = 1 then coalesce(sum(d.balance) filter (where current_date - d.due_at between 1 and 30), 0)::numeric(14,2)::text end,
           'due_31_60', case when v_monedas = 1 then coalesce(sum(d.balance) filter (where current_date - d.due_at between 31 and 60), 0)::numeric(14,2)::text end,
           'due_61_90', case when v_monedas = 1 then coalesce(sum(d.balance) filter (where current_date - d.due_at between 61 and 90), 0)::numeric(14,2)::text end,
           'due_over_90', case when v_monedas = 1 then coalesce(sum(d.balance) filter (where current_date - d.due_at > 90), 0)::numeric(14,2)::text end)
    into v_resumen
    from public.ar_documents d
   where d.balance > 0 and d.organization_id = v_org and d.company_id = v_company;

  v_resumen := v_resumen || jsonb_build_object(
    'accounts_blocked', (select count(*) from public.business_accounts a
                          where a.organization_id = v_org and a.company_id = v_company
                            and a.credit_status = 'blocked'),
    'accounts_watch', (select count(*) from public.business_accounts a
                        where a.organization_id = v_org and a.company_id = v_company
                          and a.credit_status = 'watch'),
    'receipts_30d', (select count(*) from public.ar_receipts r
                      where r.organization_id = v_org and r.company_id = v_company
                        and r.received_at >= current_date - 30),
    'collected_30d', case when v_monedas = 1 then (
                       select coalesce(sum(r.amount), 0)::numeric(14,2)::text from public.ar_receipts r
                        where r.organization_id = v_org and r.company_id = v_company
                          and r.received_at >= current_date - 30 and r.currency = v_moneda) end,
    'receipts_unapplied', (select count(*) from public.ar_receipts r
                            where r.organization_id = v_org and r.company_id = v_company
                              and r.amount > coalesce((select sum(a.amount) from public.ar_applications a
                                                        where a.receipt_id = r.id), 0)));

  -- Los diez clientes con más deuda VENCIDA (a igualdad, el atraso mayor).
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb)
    into v_clientes
    from (
      select row_number() over (order by g.vencido desc, g.max_atraso desc nulls last, c.name) as ord,
             jsonb_build_object(
               'customer_id', c.id,
               'name', left(c.name, 80),
               'credit_status', a.credit_status,
               'currency', case when g.monedas = 1 then g.moneda end,
               'balance', case when g.monedas = 1 then g.saldo::numeric(14,2)::text end,
               'overdue', case when g.monedas = 1 then g.vencido::numeric(14,2)::text end,
               'credit_limit', case when g.monedas = 1 and a.credit_limit is not null
                                    then a.credit_limit::numeric(14,2)::text end,
               'over_limit', g.monedas = 1 and a.credit_limit is not null and g.saldo > a.credit_limit,
               'open_documents', g.abiertos,
               'overdue_documents', g.vencidos,
               'max_days_overdue', g.max_atraso,
               'days_since_last_receipt', (select current_date - max(r.received_at) from public.ar_receipts r
                                            where r.customer_id = c.id
                                              and r.organization_id = v_org and r.company_id = v_company)) as x
        from (
          select d.customer_id,
                 count(distinct d.currency) as monedas,
                 max(d.currency) as moneda,
                 sum(d.balance) as saldo,
                 coalesce(sum(d.balance) filter (where d.due_at < current_date), 0) as vencido,
                 count(*) as abiertos,
                 count(*) filter (where d.due_at < current_date) as vencidos,
                 max(current_date - d.due_at) filter (where d.due_at < current_date) as max_atraso
            from public.ar_documents d
           where d.balance > 0 and d.organization_id = v_org and d.company_id = v_company
           group by d.customer_id
          having count(*) filter (where d.due_at < current_date) > 0
        ) g
        join public.customers c on c.id = g.customer_id
        left join public.business_accounts a on a.customer_id = c.id
       order by g.vencido desc, g.max_atraso desc nulls last, c.name
       limit 10
    ) q;

  return jsonb_build_object(
    'generated_at', v_now,
    'scope', 'portfolio',
    'thresholds', v_thresholds,
    'currencies', v_monedas,
    'currency', case when v_monedas = 1 then v_moneda end,
    'summary', v_resumen,
    'customers', v_clientes
  );
end;
$fn$;

revoke execute on function public.ai_collections_facts(uuid) from public, anon;
grant  execute on function public.ai_collections_facts(uuid) to authenticated, service_role;

comment on function public.ai_collections_facts(uuid) is
  'Fase 08: dataset de cobranza para la IA (cartera o un cliente). Invoker, sociedad activa, roles de credit + credit.management. Solo lectura; NULL si el cliente no es visible.';

-- ---------------------------------------------------------------------------
-- 2 · Pagos (funcionalidad `payments`)
-- ---------------------------------------------------------------------------
-- Umbrales (se devuelven en `thresholds`): ventana 30 d · `requires_action` o
-- `processing` sin cambios en 1 d · autorizado sin capturar (captura manual) en
-- 3 d · cobro capturado sin liquidar en 7 d · devolución pedida o en curso sin
-- cerrar en 3 d.
create or replace function public.ai_payments_facts(p_store_id uuid, p_intent_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_now     timestamptz := now();
  v_i       record;
  v_resumen jsonb;
  v_revisar jsonb;
  v_concil  jsonb;
  v_codigos jsonb;
  v_detalle jsonb := null;
  v_thresholds jsonb := jsonb_build_object(
    'window_days', 30, 'stale_days', 1, 'capture_days', 3, 'settlement_days', 7, 'refund_days', 3,
    'max_intents', 12, 'max_records', 10);
begin
  perform ebim.assert_ai_feature_reader('payments', 'payments');
  perform ebim.assert_ai_orders_store(p_store_id);

  -- ---- Un cobro -------------------------------------------------------------
  if p_intent_id is not null then
    select i.*, o.order_number, o.payment_status as order_payment_status,
           m.kind as method_kind, m.display_name as method_name
      into v_i
      from public.payment_intents i
      join public.payment_methods m on m.id = i.payment_method_id
      left join public.orders o on o.id = i.order_id
     where i.id = p_intent_id and i.store_id = p_store_id
       and i.organization_id = v_org and i.company_id = v_company;
    if v_i.id is null then
      return null;
    end if;

    v_detalle := jsonb_build_object(
      'intent_id', v_i.id,
      'order_number', left(v_i.order_number, 40),
      'order_payment_status', v_i.order_payment_status,
      'status', v_i.status,
      'capture_mode', v_i.capture_mode,
      'method_kind', v_i.method_kind,
      'method_name', left(v_i.method_name, 60),
      'provider_code', left(v_i.provider_code, 40),
      'currency', v_i.currency,
      'amount', v_i.amount::numeric(14,2)::text,
      'amount_authorized', v_i.amount_authorized::numeric(14,2)::text,
      'amount_captured', v_i.amount_captured::numeric(14,2)::text,
      'amount_refunded', v_i.amount_refunded::numeric(14,2)::text,
      -- El CÓDIGO del último error; el detalle (texto libre del proveedor) no viaja.
      'last_error_code', left(v_i.last_error_code, 60),
      'days_since_created', floor(extract(epoch from (v_now - v_i.created_at)) / 86400)::int,
      'days_since_update', floor(extract(epoch from (v_now - v_i.updated_at)) / 86400)::int,
      'expired', v_i.expires_at is not null and v_i.expires_at < v_now,
      'attempts', coalesce((
         select jsonb_agg(x order by (x->>'attempt_no')::int desc)
           from (
             select jsonb_build_object(
                      'attempt_no', a.attempt_no,
                      'operation', left(a.operation, 40),
                      'status', a.status,
                      'provider_result_code', left(a.provider_result_code, 60),
                      'error_code', left(a.error_code, 60),
                      'latency_ms', a.latency_ms,
                      'days_ago', floor(extract(epoch from (v_now - a.created_at)) / 86400)::int) as x
               from public.payment_attempts a
              where a.payment_intent_id = v_i.id
              order by a.attempt_no desc
              limit 10
           ) q), '[]'::jsonb),
      'events', coalesce((
         select jsonb_agg(x order by ord)
           from (
             select row_number() over (order by e.created_at desc) as ord,
                    jsonb_build_object(
                      'event_type', left(e.event_type, 60),
                      'source', e.source,
                      'signature_verified', e.signature_verified,
                      'days_ago', floor(extract(epoch from (v_now - e.created_at)) / 86400)::int) as x
               from public.payment_events e
              where e.payment_intent_id = v_i.id
              order by e.created_at desc
              limit 10
           ) q), '[]'::jsonb),
      'payments', coalesce((
         select jsonb_agg(jsonb_build_object(
                  'status', p.status,
                  'currency', p.currency,
                  'amount', p.amount::numeric(14,2)::text,
                  'amount_refunded', p.amount_refunded::numeric(14,2)::text,
                  'settled', p.settled_at is not null,
                  'days_since_capture', floor(extract(epoch from (v_now - p.captured_at)) / 86400)::int)
                order by p.captured_at desc)
           from public.payments p where p.payment_intent_id = v_i.id), '[]'::jsonb),
      'refunds', coalesce((
         select jsonb_agg(x order by (x->>'days_ago')::int)
           from (
             select jsonb_build_object(
                      'status', r.status,
                      'currency', r.currency,
                      'amount', r.amount::numeric(14,2)::text,
                      'error_code', left(r.error_code, 60),
                      'days_ago', floor(extract(epoch from (v_now - r.created_at)) / 86400)::int) as x
               from public.refunds r
               join public.payments p on p.id = r.payment_id
              where p.payment_intent_id = v_i.id
              order by r.created_at desc
              limit 5
           ) q), '[]'::jsonb),
      'reconciliation', coalesce((
         select jsonb_agg(x)
           from (
             select jsonb_build_object(
                      'status', rr.status,
                      'currency', rr.currency,
                      'gross_amount', rr.gross_amount::numeric(14,2)::text,
                      'fee_amount', rr.fee_amount::numeric(14,2)::text,
                      'net_amount', rr.net_amount::numeric(14,2)::text,
                      'days_since_settlement', current_date - rr.settlement_date) as x
               from public.reconciliation_records rr
               join public.payments p on p.id = rr.payment_id
              where p.payment_intent_id = v_i.id
                and rr.organization_id = v_org and rr.company_id = v_company
              order by rr.settlement_date desc
              limit 5
           ) q), '[]'::jsonb));
  end if;

  -- ---- La tienda ------------------------------------------------------------
  select jsonb_build_object(
           'intents_30d', count(*) filter (where i.created_at >= v_now - interval '30 days'),
           'failed_30d', count(*) filter (where i.status = 'failed' and i.updated_at >= v_now - interval '30 days'),
           'expired_30d', count(*) filter (where i.status = 'expired' and i.updated_at >= v_now - interval '30 days'),
           'requires_action_stale', count(*) filter (where i.status = 'requires_action' and i.updated_at < v_now - interval '1 day'),
           'processing_stale', count(*) filter (where i.status in ('open', 'processing') and i.updated_at < v_now - interval '1 day'
                                                 and i.created_at >= v_now - interval '30 days'),
           'authorized_uncaptured', count(*) filter (where i.status = 'authorized'
                                                       and coalesce(i.authorized_at, i.updated_at) < v_now - interval '3 days'),
           'captured_30d', count(*) filter (where i.status = 'captured' and coalesce(i.captured_at, i.updated_at) >= v_now - interval '30 days'))
    into v_resumen
    from public.payment_intents i
   where i.store_id = p_store_id and i.organization_id = v_org and i.company_id = v_company;

  v_resumen := v_resumen || jsonb_build_object(
    -- Un tiempo agotado NO dice que no se cobró: dice que no se sabe.
    'attempts_timeout_30d', (select count(*) from public.payment_attempts a
                              where a.store_id = p_store_id and a.status = 'timeout'
                                and a.created_at >= v_now - interval '30 days'),
    'attempts_failed_30d', (select count(*) from public.payment_attempts a
                             where a.store_id = p_store_id and a.status in ('declined', 'failed')
                               and a.created_at >= v_now - interval '30 days'),
    'refunds_failed_30d', (select count(*) from public.refunds r
                            where r.store_id = p_store_id and r.status = 'failed'
                              and r.updated_at >= v_now - interval '30 days'),
    'refunds_stuck', (select count(*) from public.refunds r
                       where r.store_id = p_store_id and r.status in ('requested', 'processing')
                         and r.created_at < v_now - interval '3 days'),
    'unsettled_7d', (select count(*) from public.payments p
                      where p.store_id = p_store_id and p.settled_at is null
                        and p.captured_at < v_now - interval '7 days'),
    'unverified_events_30d', (select count(*) from public.payment_events e
                               where e.store_id = p_store_id and e.source = 'provider_webhook'
                                 and not e.signature_verified
                                 and e.created_at >= v_now - interval '30 days'),
    -- La conciliación es de la SOCIEDAD: un extracto sin cruzar no tiene tienda.
    'reconciliation_unmatched', (select count(*) from public.reconciliation_records rr
                                  where rr.organization_id = v_org and rr.company_id = v_company
                                    and rr.status = 'unmatched'),
    'reconciliation_discrepancy', (select count(*) from public.reconciliation_records rr
                                    where rr.organization_id = v_org and rr.company_id = v_company
                                      and rr.status = 'discrepancy'),
    'reconciliation_matched_30d', (select count(*) from public.reconciliation_records rr
                                    where rr.organization_id = v_org and rr.company_id = v_company
                                      and rr.status = 'matched' and rr.settlement_date >= current_date - 30));

  -- Los códigos de fallo más repetidos (30 d). Códigos, nunca el detalle.
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'count', n) order by n desc, code), '[]'::jsonb)
    into v_codigos
    from (
      select left(coalesce(a.error_code, a.provider_result_code), 60) as code, count(*) as n
        from public.payment_attempts a
       where a.store_id = p_store_id
         and a.status in ('declined', 'failed', 'timeout')
         and a.created_at >= v_now - interval '30 days'
         and coalesce(a.error_code, a.provider_result_code) is not null
       group by 1
       order by 2 desc, 1
       limit 5
    ) q;

  -- Cobros que piden revisión, con sus marcas.
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb)
    into v_revisar
    from (
      select row_number() over (order by s.prioridad, s.updated_at) as ord,
             jsonb_build_object(
               'intent_id', s.id,
               'order_number', left(s.order_number, 40),
               'status', s.status,
               'method_kind', s.method_kind,
               'provider_code', left(s.provider_code, 40),
               'last_error_code', left(s.last_error_code, 60),
               'failed_attempts', s.fallidos,
               'timeout_attempts', s.timeouts,
               'currency', s.currency,
               'amount', s.amount::numeric(14,2)::text,
               'days_since_update', floor(extract(epoch from (v_now - s.updated_at)) / 86400)::int,
               'signals', s.marcas) as x
        from (
          select i.id, o.order_number, i.status, m.kind as method_kind, i.provider_code, i.last_error_code,
                 i.currency, i.amount, i.updated_at, f.fallidos, f.timeouts,
                 array_remove(array[
                   case when i.status = 'failed' then 'failed' end,
                   case when f.timeouts > 0 and i.status not in ('captured', 'cancelled') then 'timeout_unknown' end,
                   case when i.status = 'requires_action' and i.updated_at < v_now - interval '1 day' then 'requires_action_stale' end,
                   case when i.status in ('open', 'processing') and i.updated_at < v_now - interval '1 day' then 'processing_stale' end,
                   case when i.status = 'authorized' and coalesce(i.authorized_at, i.updated_at) < v_now - interval '3 days'
                        then 'authorized_uncaptured' end,
                   case when f.fallidos >= 3 then 'repeated_failures' end
                 ], null) as marcas,
                 case when i.status = 'failed' then 1
                      when f.timeouts > 0 then 2
                      when i.status = 'authorized' then 3
                      else 4 end as prioridad
            from public.payment_intents i
            join public.payment_methods m on m.id = i.payment_method_id
            left join public.orders o on o.id = i.order_id
            cross join lateral (
              select count(*) filter (where a.status in ('declined', 'failed')) as fallidos,
                     count(*) filter (where a.status = 'timeout') as timeouts
                from public.payment_attempts a where a.payment_intent_id = i.id
            ) f
           where i.store_id = p_store_id and i.organization_id = v_org and i.company_id = v_company
             -- Lo reciente, y lo que sigue abierto aunque sea viejo.
             and (i.updated_at >= v_now - interval '30 days'
                  or i.status in ('open', 'processing', 'requires_action', 'authorized'))
        ) s
       where cardinality(s.marcas) > 0
       order by s.prioridad, s.updated_at
       limit 12
    ) q;

  -- Liquidaciones sin cruzar o con diferencia. La razón de la diferencia NO
  -- viaja como texto (lleva cifras): viajan los dos importes.
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb)
    into v_concil
    from (
      select row_number() over (order by case rr.status when 'discrepancy' then 0 else 1 end, rr.settlement_date) as ord,
             jsonb_build_object(
               'record_id', rr.id,
               'reference', left(rr.external_reference, 40),
               'provider_code', left(rr.provider_code, 40),
               'status', rr.status,
               'currency', rr.currency,
               'gross_amount', rr.gross_amount::numeric(14,2)::text,
               'fee_amount', rr.fee_amount::numeric(14,2)::text,
               'net_amount', rr.net_amount::numeric(14,2)::text,
               'days_since_settlement', current_date - rr.settlement_date,
               'has_payment', rr.payment_id is not null,
               'payment_currency', p.currency,
               'payment_amount', case when p.id is null then null else p.amount::numeric(14,2)::text end,
               'currency_mismatch', p.id is not null and p.currency <> rr.currency) as x
        from public.reconciliation_records rr
        left join public.payments p on p.id = rr.payment_id
       where rr.organization_id = v_org and rr.company_id = v_company
         and rr.status in ('unmatched', 'discrepancy')
       order by case rr.status when 'discrepancy' then 0 else 1 end, rr.settlement_date
       limit 10
    ) q;

  return jsonb_build_object(
    'generated_at', v_now,
    'scope', case when v_detalle is null then 'store' else 'intent' end,
    'thresholds', v_thresholds,
    'summary', v_resumen,
    'error_codes', v_codigos,
    'intents', v_revisar,
    'reconciliation', v_concil,
    'intent', v_detalle
  );
end;
$fn$;

revoke execute on function public.ai_payments_facts(uuid, uuid) from public, anon;
grant  execute on function public.ai_payments_facts(uuid, uuid) to authenticated, service_role;

comment on function public.ai_payments_facts(uuid, uuid) is
  'Fase 08: dataset de pagos para la IA (tienda + un cobro opcional). Invoker, sociedad activa, roles de payments + modulo payments. Codigos de error, nunca el detalle. Solo lectura; NULL si el cobro no es visible.';

-- ---------------------------------------------------------------------------
-- 3 · Entregas (funcionalidad `fulfillment`)
-- ---------------------------------------------------------------------------
-- Umbrales: sin avance = entrega abierta (pendiente → lista) sin cambios en 2 d
-- · en tránsito largo = en camino desde hace más de 7 d · devolución sin decidir
-- = pedida hace más de 3 d · incidencias del operador = eventos `exception` o
-- `delivery_attempted` de los últimos 7 d.
create or replace function public.ai_fulfillment_facts(p_store_id uuid, p_fulfillment_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_now     timestamptz := now();
  v_hoy     date := (now() at time zone 'utc')::date;
  v_f       record;
  v_resumen jsonb;
  v_lista   jsonb;
  v_detalle jsonb := null;
  v_thresholds jsonb := jsonb_build_object(
    'stalled_days', 2, 'transit_days', 7, 'return_decision_days', 3, 'incident_days', 7, 'max_items', 15);
begin
  perform ebim.assert_ai_feature_reader('fulfillment', 'fulfillment');
  perform ebim.assert_ai_orders_store(p_store_id);

  -- ---- Las entregas abiertas de la tienda, con sus marcas --------------------
  -- Una CTE y no una vista: las marcas y la lista son la misma regla.
  with ent as (
    select f.id, f.order_id, f.sequence, f.state, f.strategy, f.method_name, f.promised_to, f.updated_at,
           f.shipped_at, f.created_at, o.order_number, o.fulfillment_status as order_fulfillment_status,
           o.status as order_status,
           (select count(*) from public.tracking_events te
              join public.shipments s on s.id = te.shipment_id
             where s.fulfillment_id = f.id and te.status in ('exception', 'delivery_attempted')
               and te.occurred_at >= v_now - interval '7 days') as incidencias,
           (select count(*) from public.shipments s
             where s.fulfillment_id = f.id and s.last_error_code is not null
               and s.state not in ('delivered', 'cancelled')) as envios_con_error,
           (select count(*) from public.proof_of_delivery pod
             where pod.fulfillment_id = f.id and pod.outcome <> 'delivered'
               and pod.created_at >= v_now - interval '30 days') as pod_fallidas
      from public.fulfillments f
      join public.orders o on o.id = f.order_id
     where f.store_id = p_store_id and f.organization_id = v_org and f.company_id = v_company
  ), marcadas as (
    select e.*,
           array_remove(array[
             case when e.state = 'failed' then 'failed' end,
             case when e.promised_to is not null and e.state not in ('delivered', 'cancelled')
                   and e.promised_to < v_hoy then 'late' end,
             case when e.incidencias > 0 and e.state not in ('delivered', 'cancelled') then 'carrier_incident' end,
             case when e.envios_con_error > 0 then 'shipment_error' end,
             case when e.pod_fallidas > 0 and e.state <> 'delivered' then 'delivery_failed' end,
             case when e.state in ('pending', 'allocated', 'picking', 'packed', 'ready')
                   and e.updated_at < v_now - interval '2 days' then 'stalled' end,
             case when e.state = 'in_transit' and coalesce(e.shipped_at, e.updated_at) < v_now - interval '7 days'
                  then 'long_transit' end,
             case when e.order_fulfillment_status = 'partially_fulfilled' and e.state not in ('delivered', 'cancelled')
                  then 'partial' end
           ], null) as marcas
      from ent e
  )
  select
    jsonb_build_object(
      'open', count(*) filter (where m.state not in ('delivered', 'cancelled')),
      'late', count(*) filter (where 'late' = any(m.marcas)),
      'stalled', count(*) filter (where 'stalled' = any(m.marcas)),
      'failed', count(*) filter (where m.state = 'failed'),
      'long_transit', count(*) filter (where 'long_transit' = any(m.marcas)),
      'carrier_incident', count(*) filter (where 'carrier_incident' = any(m.marcas)),
      'shipment_error', count(*) filter (where 'shipment_error' = any(m.marcas)),
      'delivery_failed', count(*) filter (where 'delivery_failed' = any(m.marcas)),
      'partial_orders', count(distinct m.order_id) filter (where 'partial' = any(m.marcas)),
      'delivered_30d', count(*) filter (where m.state = 'delivered' and m.updated_at >= v_now - interval '30 days')),
    coalesce((
      select jsonb_agg(x order by ord)
        from (
          select row_number() over (order by k.prioridad, k.promised_to nulls last, k.updated_at) as ord,
                 jsonb_build_object(
                   'fulfillment_id', k.id,
                   'order_number', left(k.order_number, 40),
                   'sequence', k.sequence,
                   'state', k.state,
                   'strategy', k.strategy,
                   'method_name', left(k.method_name, 60),
                   'days_late', case when k.promised_to is not null and k.promised_to < v_hoy then v_hoy - k.promised_to end,
                   'days_since_update', floor(extract(epoch from (v_now - k.updated_at)) / 86400)::int,
                   'signals', k.marcas) as x
            from (
              select m.*,
                     case when m.state = 'failed' then 1
                          when 'delivery_failed' = any(m.marcas) or 'carrier_incident' = any(m.marcas) then 2
                          when 'late' = any(m.marcas) then 3
                          when 'shipment_error' = any(m.marcas) then 4
                          else 5 end as prioridad
                from marcadas m
               where cardinality(m.marcas) > 0 and m.state <> 'cancelled'
            ) k
           order by k.prioridad, k.promised_to nulls last, k.updated_at
           limit 15
        ) q), '[]'::jsonb)
    into v_resumen, v_lista
    from marcadas m;

  v_resumen := v_resumen || jsonb_build_object(
    'returns_open', (select count(*) from public.return_requests r
                      where r.store_id = p_store_id and r.organization_id = v_org and r.company_id = v_company
                        and r.state in ('requested', 'approved', 'in_transit', 'received', 'inspected')),
    'returns_undecided', (select count(*) from public.return_requests r
                           where r.store_id = p_store_id and r.organization_id = v_org and r.company_id = v_company
                             and r.state = 'requested' and r.created_at < v_now - interval '3 days'));

  -- ---- Una entrega ------------------------------------------------------------
  if p_fulfillment_id is not null then
    select f.*, o.order_number, o.status as order_status, o.payment_status as order_payment_status,
           o.fulfillment_status as order_fulfillment_status
      into v_f
      from public.fulfillments f
      join public.orders o on o.id = f.order_id
     where f.id = p_fulfillment_id and f.store_id = p_store_id
       and f.organization_id = v_org and f.company_id = v_company;
    if v_f.id is null then
      return null;
    end if;

    v_detalle := jsonb_build_object(
      'fulfillment_id', v_f.id,
      'order_number', left(v_f.order_number, 40),
      'order_status', v_f.order_status,
      'order_payment_status', v_f.order_payment_status,
      'order_fulfillment_status', v_f.order_fulfillment_status,
      'sequence', v_f.sequence,
      'state', v_f.state,
      'strategy', v_f.strategy,
      'method_name', left(v_f.method_name, 60),
      'provider_code', left(v_f.provider_code, 40),
      'days_late', case when v_f.promised_to is not null and v_f.promised_to < v_hoy
                         and v_f.state not in ('delivered', 'cancelled') then v_hoy - v_f.promised_to end,
      'days_to_promise', case when v_f.promised_to is not null and v_f.promised_to >= v_hoy then v_f.promised_to - v_hoy end,
      'days_since_created', floor(extract(epoch from (v_now - v_f.created_at)) / 86400)::int,
      'days_since_update', floor(extract(epoch from (v_now - v_f.updated_at)) / 86400)::int,
      'days_since_shipped', case when v_f.shipped_at is null then null
                                 else floor(extract(epoch from (v_now - v_f.shipped_at)) / 86400)::int end,
      'units', (select coalesce(sum(fi.quantity), 0) from public.fulfillment_items fi where fi.fulfillment_id = v_f.id),
      'order_units', (select coalesce(sum(oi.quantity), 0) from public.order_items oi where oi.order_id = v_f.order_id),
      'order_units_delivered', (select coalesce(sum(fi.quantity), 0)
                                  from public.fulfillment_items fi
                                  join public.fulfillments f2 on f2.id = fi.fulfillment_id
                                 where f2.order_id = v_f.order_id and f2.state = 'delivered'),
      'order_fulfillments', (select count(*) from public.fulfillments f2
                              where f2.order_id = v_f.order_id and f2.state <> 'cancelled'),
      'signals', coalesce((select to_jsonb(m.marcas) from (
          select array_remove(array[
            case when v_f.state = 'failed' then 'failed' end,
            case when v_f.promised_to is not null and v_f.state not in ('delivered', 'cancelled')
                  and v_f.promised_to < v_hoy then 'late' end,
            case when v_f.state not in ('delivered', 'cancelled') and exists (
                   select 1 from public.tracking_events te join public.shipments s on s.id = te.shipment_id
                    where s.fulfillment_id = v_f.id and te.status in ('exception', 'delivery_attempted')
                      and te.occurred_at >= v_now - interval '7 days') then 'carrier_incident' end,
            case when exists (select 1 from public.shipments s where s.fulfillment_id = v_f.id
                                and s.last_error_code is not null and s.state not in ('delivered', 'cancelled'))
                 then 'shipment_error' end,
            case when v_f.state <> 'delivered' and exists (
                   select 1 from public.proof_of_delivery pod where pod.fulfillment_id = v_f.id
                      and pod.outcome <> 'delivered' and pod.created_at >= v_now - interval '30 days')
                 then 'delivery_failed' end,
            case when v_f.state in ('pending', 'allocated', 'picking', 'packed', 'ready')
                  and v_f.updated_at < v_now - interval '2 days' then 'stalled' end,
            case when v_f.state = 'in_transit' and coalesce(v_f.shipped_at, v_f.updated_at) < v_now - interval '7 days'
                 then 'long_transit' end,
            case when v_f.order_fulfillment_status = 'partially_fulfilled' and v_f.state not in ('delivered', 'cancelled')
                 then 'partial' end
          ], null) as marcas) m), '[]'::jsonb),
      -- Envíos: estado y código de error; sin número de guía ni enlace.
      'shipments', coalesce((
         select jsonb_agg(x order by ord)
           from (
             select row_number() over (order by s.created_at desc) as ord,
                    jsonb_build_object(
                      'state', s.state,
                      'provider_code', left(s.provider_code, 40),
                      'has_tracking', s.tracking_number is not null,
                      'last_error_code', left(s.last_error_code, 60),
                      'days_since_shipped', case when s.shipped_at is null then null
                                                 else floor(extract(epoch from (v_now - s.shipped_at)) / 86400)::int end,
                      'estimated_in_days', case when s.estimated_delivery is null then null
                                                else s.estimated_delivery - v_hoy end) as x
               from public.shipments s
              where s.fulfillment_id = v_f.id
              order by s.created_at desc
              limit 5
           ) q), '[]'::jsonb),
      -- Seguimiento: la descripción del operador es DATO NO CONFIABLE (recortada);
      -- la ubicación no viaja.
      'tracking', coalesce((
         select jsonb_agg(x order by ord)
           from (
             select row_number() over (order by te.occurred_at desc) as ord,
                    jsonb_build_object(
                      'status', te.status,
                      'provider_status', left(te.provider_status, 60),
                      'description', left(regexp_replace(te.description, '\s+', ' ', 'g'), 160),
                      'days_ago', floor(extract(epoch from (v_now - te.occurred_at)) / 86400)::int) as x
               from public.tracking_events te
               join public.shipments s on s.id = te.shipment_id
              where s.fulfillment_id = v_f.id
              order by te.occurred_at desc
              limit 10
           ) q), '[]'::jsonb),
      -- Pruebas de entrega: resultado y motivo; ni quién recibió, ni su
      -- documento, ni la geolocalización.
      'pod', coalesce((
         select jsonb_agg(x order by ord)
           from (
             select row_number() over (order by pod.created_at desc) as ord,
                    jsonb_build_object(
                      'outcome', pod.outcome,
                      'reason', left(regexp_replace(pod.reason, '\s+', ' ', 'g'), 160),
                      'days_ago', floor(extract(epoch from (v_now - pod.created_at)) / 86400)::int) as x
               from public.proof_of_delivery pod
              where pod.fulfillment_id = v_f.id
              order by pod.created_at desc
              limit 3
           ) q), '[]'::jsonb),
      'returns', coalesce((
         select jsonb_agg(x order by ord)
           from (
             select row_number() over (order by r.created_at desc) as ord,
                    jsonb_build_object(
                      'state', r.state,
                      'resolution', r.resolution,
                      'reason_code', left(r.reason_code, 40),
                      'days_ago', floor(extract(epoch from (v_now - r.created_at)) / 86400)::int) as x
               from public.return_requests r
              where r.order_id = v_f.order_id
              order by r.created_at desc
              limit 3
           ) q), '[]'::jsonb),
      'route', (select jsonb_build_object('plan_status', dp.status)
                  from public.delivery_plan_stops st
                  join public.delivery_plans dp on dp.id = st.plan_id
                 where st.fulfillment_id = v_f.id));
  end if;

  return jsonb_build_object(
    'generated_at', v_now,
    'scope', case when v_detalle is null then 'store' else 'fulfillment' end,
    'thresholds', v_thresholds,
    'summary', v_resumen,
    'items', v_lista,
    'fulfillment', v_detalle
  );
end;
$fn$;

revoke execute on function public.ai_fulfillment_facts(uuid, uuid) from public, anon;
grant  execute on function public.ai_fulfillment_facts(uuid, uuid) to authenticated, service_role;

comment on function public.ai_fulfillment_facts(uuid, uuid) is
  'Fase 08: dataset de entregas para la IA (tienda + una entrega opcional). Invoker, sociedad activa, roles de fulfillment + modulo fulfillment. Sin direccion, contacto, guia ni datos de quien recibio. Solo lectura; NULL si la entrega no es visible.';
