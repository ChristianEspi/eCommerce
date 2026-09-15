-- =============================================================================
-- Cierre · 4 — Programación del trabajo de pedidos programados: cada hora.
--
-- Mismo patrón que la recuperación de carritos (20260914160100): SQL puro, sin
-- `pg_net` ni Vault, sin claves ni URLs. `ebim.run_order_schedules` solo deja
-- ejecuciones preparadas y avisos; no llama a nada fuera de la base.
--
-- Cada hora y no una vez al día: un fallo técnico se reintenta con espera
-- creciente (5 min → 6 h) y una pasada diaria convertiría esa espera en días.
-- Correr de más no cuesta nada: `unique (schedule_id, run_on)` y el avance de la
-- fecha en la misma transacción hacen que una programación ya preparada hoy no
-- se vuelva a elegir.
--
-- La base de pruebas no trae `pg_cron`: donde no está, la migración no hace nada.
-- =============================================================================

do $migracion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron no disponible: no se programa el trabajo de pedidos programados';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  if exists (select 1 from cron.job where jobname = 'ecommerce-order-schedules') then
    perform cron.unschedule('ecommerce-order-schedules');
  end if;

  perform cron.schedule(
    'ecommerce-order-schedules',
    '7 * * * *',
    $trabajo$ select ebim.run_order_schedules(200); $trabajo$
  );
end
$migracion$;
