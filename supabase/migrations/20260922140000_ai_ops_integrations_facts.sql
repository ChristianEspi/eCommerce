-- =============================================================================
-- Fase 10 (EBIM_AI_SEQUENCE) — Operaciones e integraciones con IA: DATASETS
--
-- Lo unico que ve el asistente tecnico. Dos funciones, las dos SECURITY
-- INVOKER + STABLE (solo lectura, RLS de quien llama), sociedad ACTIVA del
-- token y guard `ebim.assert_ai_feature_reader` con la funcionalidad de cada
-- superficie (`operations` / `integrations`: owner, admin; sin modulo, igual
-- que las pantallas, que no estan gateadas por capacidad — P13/P14).
--
--   · public.ai_ops_facts(p_event_id)
--       Sin incidente: la SALUD del tenant (`ops_health`, definer con el mismo
--       rol), los incidentes AGRUPADOS por (tipo, codigo) — abiertos, nuevos en
--       24 h frente a los 6 dias previos, repeticiones, antiguedad, operaciones
--       y fuentes — y conteos por severidad.
--       Con incidente: la fila (mensaje redactado y recortado), su contexto con
--       doble redaccion, los parecidos de 7 d y el HILO (`trace_by_correlation`,
--       20 filas como mucho) en minutos relativos al incidente.
--   · public.ai_integrations_facts(p_outbox_id)
--       Sin mensaje: proveedores (colas, exito/fallo 24 h, horas desde el
--       ultimo exito), ≤25 mensajes fallidos/muertos/reintentando con su ultimo
--       codigo HTTP y error recortado, disyuntores abiertos, endpoints de
--       webhook con entregas fallidas, bandeja de entrada y errores de la API
--       de socio por ruta y estado.
--       Con mensaje: la fila del monitor, el disyuntor y ≤10 intentos (codigo,
--       latencia, error recortado).
--
-- Lo que NO viaja nunca: payloads, cabeceras, URL de endpoints, `secret_ref`,
-- `config` de la integracion, notas de resolucion (texto de una persona),
-- correlation/request ids, ni uuids de actores. Los textos de error se
-- recortan y pasan por `ebim.redact_text` aqui y por el SANITIZADOR del borde
-- (`_shared/observability/redact.ts` → `sanitizeTextForModel`) antes de
-- llegar al proveedor de IA: `redact_text` solo tapa un correo o una tarjeta
-- cuando son TODO el texto; tokens, JWT, cabeceras `Authorization`, cookies y
-- cadenas de conexion dentro de un mensaje de error los tapa el borde (D10).
--
-- La IA no reintenta, no cierra disyuntores, no resuelve incidentes y no toca
-- ninguna integracion: esas son `integration_retry`, `integration_circuit_reset`
-- y `ops_resolve_event`, comandos humanos con motivo y auditoria.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Operaciones
-- ---------------------------------------------------------------------------
-- Umbrales (se devuelven en `thresholds` y los repite `aiOperations.ts`):
--   ventana 7 d · pico: ≥ 5 nuevos en 24 h y ≥ 3× la media diaria de los 6 d
--   previos · recurrente: ≥ 5 repeticiones · abierto viejo: > 168 h · cola
--   parada: el pendiente mas viejo > 15 min · contexto del hub caducado: > 24 h.
create or replace function public.ai_ops_facts(p_event_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now     timestamptz := now();
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_ev      public.ops_events%rowtype;
  v_health  jsonb;
  v_sync    timestamptz;
  v_thresholds jsonb := jsonb_build_object(
    'window_days', 7, 'spike_min', 5, 'spike_factor', 3, 'recurring_repeats', 5,
    'stale_open_hours', 168, 'queue_stalled_minutes', 15, 'context_stale_hours', 24);
begin
  perform ebim.assert_ai_feature_reader('operations', null);

  if p_event_id is not null then
    select * into v_ev
      from public.ops_events e
     where e.id = p_event_id
       and e.organization_id = v_org
       and e.company_id = v_company;
    if not found then
      return null;
    end if;

    return jsonb_build_object(
      'scope', 'incident',
      'generated_at', v_now,
      'thresholds', v_thresholds,
      'incident', jsonb_build_object(
        'event_id',     v_ev.id,
        'kind',         v_ev.kind::text,
        'severity',     v_ev.severity::text,
        'code',         v_ev.code,
        'message',      ebim.redact_text(v_ev.message, 500),
        'source',       v_ev.source,
        'operation',    v_ev.operation,
        'duration_ms',  v_ev.duration_ms,
        'entity_type',  v_ev.entity_type,
        'is_open',      v_ev.resolved_at is null,
        'age_minutes',  floor(extract(epoch from (v_now - v_ev.occurred_at)) / 60)::bigint,
        'first_seen_hours', floor(extract(epoch from (v_now - v_ev.created_at)) / 3600)::bigint,
        'repeats', case when (v_ev.context ->> 'repeats') ~ '^[0-9]{1,9}$'
                        then (v_ev.context ->> 'repeats')::integer else 1 end,
        -- Doble redaccion (tarjeta + datos personales); el borde vuelve a
        -- sanear y se queda solo con valores escalares cortos.
        'context', ebim.redact_pii(ebim.redact_sensitive(v_ev.context - 'repeats')),
        'has_trace', v_ev.correlation_id is not null,
        'similar_7d', (
          select count(*) from public.ops_events s
           where s.organization_id = v_org and s.company_id = v_company
             and s.kind = v_ev.kind and s.code = v_ev.code
             and s.occurred_at > v_now - interval '7 days'),
        'similar_open', (
          select count(*) from public.ops_events s
           where s.organization_id = v_org and s.company_id = v_company
             and s.kind = v_ev.kind and s.code = v_ev.code
             and s.resolved_at is null)),
      'trace', case when v_ev.correlation_id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
                 'domain',      t.domain,
                 'entity_type', t.entity_type,
                 'summary',     ebim.redact_text(t.summary, 120),
                 'status',      t.status,
                 'severity',    t.severity,
                 'is_incident', t.entity_id = v_ev.id,
                 'minutes_from_incident',
                   floor(extract(epoch from (coalesce(t.occurred_at, v_ev.occurred_at) - v_ev.occurred_at)) / 60)::bigint)
               order by t.occurred_at nulls last)
          from (select * from public.trace_by_correlation(v_ev.correlation_id) x
                 order by x.occurred_at nulls last
                 limit 20) t), '[]'::jsonb) end);
  end if;

  -- Misma autorizacion (owner/admin): `ops_health` es SECURITY DEFINER y
  -- vuelve a comprobarla por dentro.
  v_health := public.ops_health(null);
  begin
    v_sync := nullif(v_health #>> '{platform_context,synced_at}', '')::timestamptz;
  exception when others then
    v_sync := null;
  end;

  return jsonb_build_object(
    'scope', 'company',
    'generated_at', v_now,
    'thresholds', v_thresholds,
    'health', jsonb_build_object(
      'queues', jsonb_build_object(
        'domain_events', jsonb_build_object(
          'pending', v_health #> '{queues,domain_events,pending}',
          'dead',    v_health #> '{queues,domain_events,dead}',
          'oldest_pending_minutes',
            floor(coalesce((v_health #>> '{queues,domain_events,oldest_pending_seconds}')::numeric, 0) / 60)::bigint),
        'integration_outbox', jsonb_build_object(
          'pending', v_health #> '{queues,integration_outbox,pending}',
          'failed',  v_health #> '{queues,integration_outbox,failed}',
          'dead',    v_health #> '{queues,integration_outbox,dead}',
          'oldest_pending_minutes',
            floor(coalesce((v_health #>> '{queues,integration_outbox,oldest_pending_seconds}')::numeric, 0) / 60)::bigint),
        'integration_inbox', jsonb_build_object(
          'unprocessed', v_health #> '{queues,integration_inbox,unprocessed}',
          'oldest_pending_minutes',
            floor(coalesce((v_health #>> '{queues,integration_inbox,oldest_pending_seconds}')::numeric, 0) / 60)::bigint)),
      'last_24h', v_health -> 'last_24h',
      'stuck_checkouts', v_health -> 'stuck_checkouts',
      'slow_operations', v_health -> 'slow_operations',
      'platform_context', jsonb_build_object(
        'source', coalesce(v_health #>> '{platform_context,source}', 'sin-contexto'),
        'hours_since_sync',
          case when v_sync is null then null
               else floor(extract(epoch from (v_now - v_sync)) / 3600)::bigint end)),
    'summary', (
      select jsonb_build_object(
        'open_total',     count(*) filter (where e.resolved_at is null),
        'open_critical',  count(*) filter (where e.resolved_at is null and e.severity = 'critical'),
        'open_error',     count(*) filter (where e.resolved_at is null and e.severity = 'error'),
        'open_warning',   count(*) filter (where e.resolved_at is null and e.severity = 'warning'),
        'open_info',      count(*) filter (where e.resolved_at is null and e.severity = 'info'),
        'new_24h',        count(*) filter (where e.occurred_at > v_now - interval '24 hours'),
        'resolved_7d',    count(*) filter (where e.resolved_at > v_now - interval '7 days'),
        'open_over_7d',   count(*) filter (where e.resolved_at is null
                                             and e.occurred_at < v_now - interval '7 days'))
        from public.ops_events e
       where e.organization_id = v_org and e.company_id = v_company),
    'groups', coalesce((
      select jsonb_agg(g.fila order by g.abiertos_primero, g.rango desc nulls last, g.abiertos desc, g.ultimo desc)
        from (
          select
            (count(*) filter (where e.resolved_at is null) = 0) as abiertos_primero,
            max(case e.severity when 'critical' then 4 when 'error' then 3
                                when 'warning' then 2 else 1 end)
              filter (where e.resolved_at is null) as rango,
            count(*) filter (where e.resolved_at is null) as abiertos,
            max(e.occurred_at) as ultimo,
            jsonb_build_object(
              'kind', e.kind::text,
              'code', e.code,
              'severity', (array_agg(e.severity::text order by
                             case e.severity when 'critical' then 4 when 'error' then 3
                                             when 'warning' then 2 else 1 end desc))[1],
              'open_count', count(*) filter (where e.resolved_at is null),
              'resolved_7d', count(*) filter (where e.resolved_at > v_now - interval '7 days'),
              'repeats', sum(case when (e.context ->> 'repeats') ~ '^[0-9]{1,9}$'
                                  then (e.context ->> 'repeats')::integer else 1 end)
                           filter (where e.resolved_at is null),
              'new_24h', count(*) filter (where e.occurred_at > v_now - interval '24 hours'),
              'prev_6d', count(*) filter (where e.occurred_at <= v_now - interval '24 hours'
                                           and e.occurred_at > v_now - interval '7 days'),
              'oldest_open_hours', floor(extract(epoch from (v_now - min(e.occurred_at)
                                     filter (where e.resolved_at is null))) / 3600)::bigint,
              'last_seen_minutes', floor(extract(epoch from (v_now - max(e.occurred_at))) / 60)::bigint,
              'max_duration_ms', max(e.duration_ms),
              'latest_event_id', (array_agg(e.id order by (e.resolved_at is null) desc, e.occurred_at desc))[1],
              'sample_message', ebim.redact_text(
                                  (array_agg(e.message order by e.occurred_at desc)
                                     filter (where e.message is not null))[1], 300),
              'operations', coalesce((array_agg(distinct e.operation)
                                        filter (where e.operation is not null))[1:3], array[]::text[]),
              'sources', coalesce((array_agg(distinct e.source))[1:3], array[]::text[])) as fila
          from public.ops_events e
         where e.organization_id = v_org and e.company_id = v_company
           and (e.resolved_at is null or e.occurred_at > v_now - interval '7 days')
         group by e.kind, e.code
         order by 1, 2 desc nulls last, 3 desc, 4 desc
         limit 12
        ) g), '[]'::jsonb));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Integraciones
-- ---------------------------------------------------------------------------
-- Umbrales (los repite `aiIntegrations.ts`): ventana 7 d · cola parada: > 15 min
-- · sin exito reciente: fallos en 24 h y ningun exito en 24 h · API con
-- errores: ≥ 5 y ≥ 10 % de las peticiones de 24 h · reproducciones repetidas:
-- ≥ 3 en 7 d.
create or replace function public.ai_integrations_facts(p_outbox_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now     timestamptz := now();
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_row     public.integration_outbox%rowtype;
  v_thresholds jsonb := jsonb_build_object(
    'window_days', 7, 'queue_stalled_minutes', 15, 'api_error_min', 5,
    'api_error_percent', 10, 'replays_min', 3);
begin
  perform ebim.assert_ai_feature_reader('integrations', null);

  if p_outbox_id is not null then
    select * into v_row
      from public.integration_outbox o
     where o.id = p_outbox_id
       and o.organization_id = v_org
       and o.company_id = v_company;
    if not found then
      return null;
    end if;

    return jsonb_build_object(
      'scope', 'message',
      'generated_at', v_now,
      'thresholds', v_thresholds,
      'message', (
        select jsonb_build_object(
          'outbox_id',     v_row.id,
          'provider_code', v_row.provider_code,
          'provider_name', p.name,
          'provider_kind', p.kind::text,
          'operation',     v_row.operation,
          -- Nombre del endpoint o del proveedor; nunca la URL.
          'target_label',  coalesce((select e.name from public.webhook_endpoints e
                                      where v_row.target <> '' and e.id::text = v_row.target
                                        and e.organization_id = v_org and e.company_id = v_company),
                                     p.name),
          'status',        v_row.status::text,
          'attempts',      v_row.attempts,
          'max_attempts',  v_row.max_attempts,
          'age_minutes',   floor(extract(epoch from (v_now - v_row.created_at)) / 60)::bigint,
          'minutes_since_update', floor(extract(epoch from (v_now - v_row.updated_at)) / 60)::bigint,
          'next_retry_minutes', case when v_row.status = 'pending'
                                     then greatest(0, ceil(extract(epoch from (v_row.next_retry_at - v_now)) / 60))::bigint end,
          'last_error',    ebim.redact_text(v_row.last_error, 500),
          'circuit_state', coalesce((select c.state::text from public.integration_circuit c
                                      where c.organization_id = v_org and c.company_id = v_company
                                        and c.provider_code = v_row.provider_code
                                        and c.operation = v_row.operation
                                        and c.target = v_row.target), 'closed'),
          'consecutive_fail', (select c.consecutive_fail from public.integration_circuit c
                                where c.organization_id = v_org and c.company_id = v_company
                                  and c.provider_code = v_row.provider_code
                                  and c.operation = v_row.operation
                                  and c.target = v_row.target),
          'event_type', (select d.event_type from public.webhook_deliveries d
                          where d.outbox_id = v_row.id order by d.created_at desc limit 1),
          'replays', (select count(*) from public.webhook_deliveries d
                       where d.replay_of in (select d0.id from public.webhook_deliveries d0
                                              where d0.outbox_id = v_row.id)))
          from public.integration_providers p
         where p.code = v_row.provider_code),
      'attempts', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'attempt',     m.attempt,
                 'succeeded',   m.succeeded,
                 'status_code', m.status_code,
                 'latency_ms',  m.latency_ms,
                 'error',       ebim.redact_text(m.error, 300),
                 'minutes_ago', floor(extract(epoch from (v_now - m.created_at)) / 60)::bigint)
               order by m.created_at desc)
          from (select * from public.integration_messages m0
                 where m0.outbox_id = v_row.id
                   and m0.organization_id = v_org and m0.company_id = v_company
                 order by m0.created_at desc
                 limit 10) m), '[]'::jsonb));
  end if;

  return jsonb_build_object(
    'scope', 'company',
    'generated_at', v_now,
    'thresholds', v_thresholds,
    'summary', (
      select jsonb_build_object(
        'pending',   count(*) filter (where o.status = 'pending'),
        'in_flight', count(*) filter (where o.status = 'in_flight'),
        'retrying',  count(*) filter (where o.status = 'pending' and o.attempts > 0),
        'failed',    count(*) filter (where o.status = 'failed'),
        'dead',      count(*) filter (where o.status = 'dead'),
        'oldest_pending_minutes', floor(extract(epoch from (v_now - min(o.created_at)
                                    filter (where o.status = 'pending'))) / 60)::bigint,
        'succeeded_24h', (select count(*) from public.integration_messages m
                           where m.organization_id = v_org and m.company_id = v_company
                             and m.succeeded and m.created_at > v_now - interval '24 hours'),
        'failed_attempts_24h', (select count(*) from public.integration_messages m
                                 where m.organization_id = v_org and m.company_id = v_company
                                   and not m.succeeded and m.created_at > v_now - interval '24 hours'))
        from public.integration_outbox o
       where o.organization_id = v_org and o.company_id = v_company),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider_code', ti.provider_code,
               'provider_name', p.name,
               'provider_kind', p.kind::text,
               'is_active',     ti.is_active,
               'direction',     ti.direction::text,
               'pending',  (select count(*) from public.integration_outbox o
                             where o.organization_id = v_org and o.company_id = v_company
                               and o.provider_code = ti.provider_code and o.status = 'pending'),
               'dead',     (select count(*) from public.integration_outbox o
                             where o.organization_id = v_org and o.company_id = v_company
                               and o.provider_code = ti.provider_code and o.status = 'dead'),
               'succeeded_24h', (select count(*) from public.integration_messages m
                                  where m.organization_id = v_org and m.company_id = v_company
                                    and m.provider_code = ti.provider_code and m.succeeded
                                    and m.created_at > v_now - interval '24 hours'),
               'failed_24h',    (select count(*) from public.integration_messages m
                                  where m.organization_id = v_org and m.company_id = v_company
                                    and m.provider_code = ti.provider_code and not m.succeeded
                                    and m.created_at > v_now - interval '24 hours'),
               'hours_since_success', (select floor(extract(epoch from (v_now - max(m.created_at))) / 3600)::bigint
                                         from public.integration_messages m
                                        where m.organization_id = v_org and m.company_id = v_company
                                          and m.provider_code = ti.provider_code and m.succeeded),
               'open_circuits', (select count(*) from public.integration_circuit c
                                  where c.organization_id = v_org and c.company_id = v_company
                                    and c.provider_code = ti.provider_code and c.state <> 'closed'))
             order by ti.provider_code)
        from public.tenant_integrations ti
        join public.integration_providers p on p.code = ti.provider_code
       where ti.organization_id = v_org and ti.company_id = v_company), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(x.fila order by x.muerto desc, x.actualizado desc)
        from (
          select (o.status = 'dead') as muerto,
                 o.updated_at as actualizado,
                 jsonb_build_object(
                   'outbox_id',     o.id,
                   'provider_code', o.provider_code,
                   'provider_name', p.name,
                   'operation',     o.operation,
                   'target_label',  coalesce(e.name, p.name),
                   'status',        o.status::text,
                   'attempts',      o.attempts,
                   'max_attempts',  o.max_attempts,
                   'age_minutes',   floor(extract(epoch from (v_now - o.created_at)) / 60)::bigint,
                   'minutes_since_update', floor(extract(epoch from (v_now - o.updated_at)) / 60)::bigint,
                   'last_status_code', (select m.status_code from public.integration_messages m
                                         where m.outbox_id = o.id
                                         order by m.created_at desc limit 1),
                   'last_error',    ebim.redact_text(o.last_error, 300),
                   'circuit_state', coalesce(c.state::text, 'closed')) as fila
            from public.integration_outbox o
            join public.integration_providers p on p.code = o.provider_code
            left join public.webhook_endpoints e
              on o.target <> '' and e.id::text = o.target
             and e.organization_id = o.organization_id and e.company_id = o.company_id
            left join public.integration_circuit c
              on c.organization_id = o.organization_id and c.company_id = o.company_id
             and c.provider_code = o.provider_code and c.operation = o.operation
             and c.target = o.target
           where o.organization_id = v_org and o.company_id = v_company
             and ((o.status in ('failed', 'dead') and o.updated_at > v_now - interval '7 days')
                  or (o.status = 'pending' and o.attempts > 0))
           order by (o.status = 'dead') desc, o.updated_at desc
           limit 25
        ) x), '[]'::jsonb),
    'circuits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider_code',    c.provider_code,
               'operation',        c.operation,
               'target_label',     coalesce(e.name, c.provider_code),
               'state',            c.state::text,
               'consecutive_fail', c.consecutive_fail,
               'threshold',        c.threshold,
               'minutes_open',     floor(extract(epoch from (v_now - c.opened_at)) / 60)::bigint)
             order by c.provider_code, c.operation)
        from (select * from public.integration_circuit c0
               where c0.organization_id = v_org and c0.company_id = v_company
                 and c0.state <> 'closed'
               order by c0.opened_at nulls last
               limit 10) c
        left join public.webhook_endpoints e
          on c.target <> '' and e.id::text = c.target
         and e.organization_id = c.organization_id and e.company_id = c.company_id), '[]'::jsonb),
    'webhooks', coalesce((
      select jsonb_agg(w.fila order by w.fallidas desc)
        from (
          select count(*) filter (where o.status in ('failed', 'dead')) as fallidas,
                 jsonb_build_object(
                   'endpoint_name',   e.name,
                   'is_active',       e.is_active,
                   'deliveries_7d',   count(d.id),
                   'failed_7d',       count(*) filter (where o.status in ('failed', 'dead')),
                   'dead_7d',         count(*) filter (where o.status = 'dead'),
                   'retrying',        count(*) filter (where o.status = 'pending' and o.attempts > 0),
                   'replays_7d',      count(*) filter (where d.replay_of is not null),
                   'last_status_code', (select m.status_code
                                          from public.integration_messages m
                                          join public.webhook_deliveries d2 on d2.outbox_id = m.outbox_id
                                         where d2.endpoint_id = e.id
                                         order by m.created_at desc limit 1),
                   'subscriptions',   (select count(*) from public.webhook_subscriptions s
                                         where s.endpoint_id = e.id and s.is_active)) as fila
            from public.webhook_endpoints e
            join public.webhook_deliveries d
              on d.endpoint_id = e.id and d.created_at > v_now - interval '7 days'
            left join public.integration_outbox o on o.id = d.outbox_id
           where e.organization_id = v_org and e.company_id = v_company
           group by e.id, e.name, e.is_active
          having count(*) filter (where o.status in ('failed', 'dead')
                                     or (o.status = 'pending' and o.attempts > 0)) > 0
              or count(*) filter (where d.replay_of is not null) > 0
           order by 1 desc
           limit 10
        ) w), '[]'::jsonb),
    'inbox', (
      select jsonb_build_object(
        'unprocessed', count(*) filter (where i.processed_at is null),
        'oldest_pending_minutes', floor(extract(epoch from (v_now - min(i.created_at)
                                    filter (where i.processed_at is null))) / 60)::bigint)
        from public.integration_inbox i
       where i.organization_id = v_org and i.company_id = v_company),
    'api', (
      select jsonb_build_object(
        'requests_24h',      count(*),
        'errors_4xx_24h',    count(*) filter (where r.status between 400 and 499),
        'errors_5xx_24h',    count(*) filter (where r.status >= 500),
        'auth_errors_24h',   count(*) filter (where r.status in (401, 403)),
        'rate_limited_24h',  count(*) filter (where r.status = 429),
        'top_errors', coalesce((
          select jsonb_agg(jsonb_build_object('method', t.method, 'route', t.route,
                                              'status', t.status, 'count', t.n)
                           order by t.n desc, t.route)
            from (select r2.method, r2.route, r2.status, count(*) as n
                    from public.api_requests r2
                   where r2.organization_id = v_org and r2.company_id = v_company
                     and r2.created_at > v_now - interval '24 hours'
                     and r2.status >= 400
                   group by r2.method, r2.route, r2.status
                   order by count(*) desc, r2.route
                   limit 8) t), '[]'::jsonb))
        from public.api_requests r
       where r.organization_id = v_org and r.company_id = v_company
         and r.created_at > v_now - interval '24 hours'));
end;
$fn$;

revoke execute on function public.ai_ops_facts(uuid)          from public, anon;
revoke execute on function public.ai_integrations_facts(uuid) from public, anon;
grant  execute on function public.ai_ops_facts(uuid)          to authenticated, service_role;
grant  execute on function public.ai_integrations_facts(uuid) to authenticated, service_role;

comment on function public.ai_ops_facts(uuid) is
  'Fase 10: dataset del asistente de operaciones. Salud del tenant, incidentes agrupados por (tipo, codigo) o UN incidente con su hilo. INVOKER + STABLE, roles de `operations`; sin payloads, notas de resolucion ni identificadores de hilo.';
comment on function public.ai_integrations_facts(uuid) is
  'Fase 10: dataset del asistente de integraciones. Proveedores, mensajes fallidos con su ultimo codigo HTTP, disyuntores, webhooks, bandeja y API; o UN mensaje con sus intentos. INVOKER + STABLE, roles de `integrations`; sin payloads, URL ni secretos.';
