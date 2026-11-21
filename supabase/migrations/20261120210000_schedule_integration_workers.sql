-- ---------------------------------------------------------------------------
-- 2026-11-20 · Los webhooks se ENTREGAN.
--
-- `integration-worker` existía desde P14 y nadie lo llamaba: la cola de
-- webhooks se llenaba y se quedaba así (en QAS, 0 entregas en su historia).
-- Lo programa cada minuto, igual que el correo y la facturación: la URL y la
-- clave del trabajador viven en Vault (`integration_worker_url`,
-- `integration_worker_key`) y sin ellas no se llama a nada. La clave es la
-- misma que la función lee de `EBIM_WORKER_KEY`.
--
-- Solo llama cuando hay algo que hacer: un webhook pendiente cuyo reintento
-- ya tocó, o uno reclamado y sin cerrar (el trabajador lo rescata).
--
-- `connector-pull` ya estaba programado desde 20261112120000; esta migración
-- no lo toca. Sus secretos (`connector_pull_url`, `connector_pull_key` y
-- `EBIM_CONNECTOR_PULL_KEY`) se cargan fuera del repo, como todos.
--
-- En la base de pruebas no hay pg_cron ni Vault: no se programa.
-- ---------------------------------------------------------------------------
do $migracion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_cron, pg_net o Vault no disponibles: no se programa integration-worker';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net with schema extensions';

  if exists (select 1 from cron.job where jobname = 'ecommerce-integration-worker') then
    perform cron.unschedule('ecommerce-integration-worker');
  end if;

  perform cron.schedule(
    'ecommerce-integration-worker',
    '* * * * *',
    $trabajo$
      select net.http_post(
        url     := url.decrypted_secret,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-ebim-worker-key', clave.decrypted_secret),
        body    := '{}'::jsonb,
        timeout_milliseconds := 10000)
      from vault.decrypted_secrets url
      join vault.decrypted_secrets clave on clave.name = 'integration_worker_key'
      where url.name = 'integration_worker_url'
        and exists (
          select 1 from public.integration_outbox o
          where o.provider_code = 'webhook'
            and ((o.status = 'pending' and o.next_retry_at <= now())
                 or o.status = 'in_flight')
        );
    $trabajo$
  );
end
$migracion$;
