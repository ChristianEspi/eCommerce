-- =============================================================================
-- Cierre · 8 — Programación de la recuperación de carritos: cada 15 minutos.
--
-- ## Por qué con `pg_cron` y sin `pg_net`
--
-- A diferencia del envío de correo (20260912120000), este trabajo no llama a
-- nada fuera de la base: `ebim.enqueue_cart_recovery` es SQL puro que elige
-- carritos y deja filas en `notification_emails`. Quien envía sigue siendo el
-- trabajo `ecommerce-notifications-dispatch` de siempre. Por eso no hace falta
-- `pg_net` ni Vault, y no hay ni una clave ni una URL en esta migración.
--
-- ## Mientras ninguna tienda lo encienda, no encola nada
--
-- El ajuste `store_settings.cart_recovery_enabled` nace apagado. El trabajo corre
-- y no elige ni un carrito hasta que un comercio lo active, lo que exige antes
-- que el negocio confirme la base de consentimiento.
--
-- ## Lote acotado
--
-- 200 carritos por pasada. Lo que no quepa entra en la siguiente; un carrito que
-- se queda fuera 15 minutos no pierde nada.
--
-- ## En las pruebas no existe nada de esto
--
-- La base de pruebas no trae `pg_cron`. Todo va dentro de una comprobación de
-- disponibilidad, igual que la programación del envío: donde no está, la
-- migración no hace nada.
-- =============================================================================

do $migracion$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron no disponible: no se programa la recuperacion de carritos';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  -- Idempotente: volver a aplicar la migración no duplica el trabajo.
  if exists (select 1 from cron.job where jobname = 'ecommerce-cart-recovery') then
    perform cron.unschedule('ecommerce-cart-recovery');
  end if;

  perform cron.schedule(
    'ecommerce-cart-recovery',
    '*/15 * * * *',
    $trabajo$ select ebim.enqueue_cart_recovery(200); $trabajo$
  );
end
$migracion$;
