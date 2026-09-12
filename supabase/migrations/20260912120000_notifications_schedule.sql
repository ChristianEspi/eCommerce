-- =============================================================================
-- Programación del envío de correo: cada minuto, vaciar la cola.
--
-- ## Por qué con `pg_cron` y `pg_net`
--
-- La cola necesita a alguien que la vacíe periódicamente, y el repositorio no
-- tenía planificador: es la deuda D5 del recorrido B2B. Supabase trae `pg_cron`
-- para programar y `pg_net` para llamar a una Edge Function desde la base, así
-- que no hace falta ningún servicio externo.
--
-- ## Por qué la URL y la clave están en Vault y no aquí
--
-- La clave abre el envío de correo del buzón de la empresa. Escrita en una
-- migración viajaría al repositorio. Vault la guarda cifrada, y el trabajo la
-- lee en el momento de llamar.
--
-- ## Mientras no haya datos en Vault, no llama a nada
--
-- El trabajo comprueba que existan los dos secretos antes de llamar. Los carga
-- `scripts/configurar-correo.mjs` solo cuando el envío por Graph está
-- configurado, así que antes de eso no hay ni una invocación inútil por minuto.
--
-- ## En las pruebas no existe nada de esto
--
-- La base de pruebas no trae `pg_cron`, `pg_net` ni Vault. Todo va dentro de una
-- comprobación de disponibilidad: donde no están, la migración no hace nada.
-- =============================================================================

do $migracion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_cron, pg_net o Vault no disponibles: no se programa el envío de correo';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net with schema extensions';

  -- Idempotente: volver a aplicar la migración no duplica el trabajo.
  if exists (select 1 from cron.job where jobname = 'ecommerce-notifications-dispatch') then
    perform cron.unschedule('ecommerce-notifications-dispatch');
  end if;

  perform cron.schedule(
    'ecommerce-notifications-dispatch',
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
      join vault.decrypted_secrets clave on clave.name = 'notifications_dispatch_key'
      where url.name = 'notifications_dispatch_url'
        and exists (
          select 1 from public.notification_emails
          where status = 'pending' and next_attempt_at <= now()
        );
    $trabajo$
  );
end
$migracion$;
