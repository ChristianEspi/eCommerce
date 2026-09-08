-- =============================================================================
-- Activa el pago con tarjeta por Culqi en la tienda de demo.
--
-- Son DATOS del tenant, no una migracion: el esquema ya soporta pasarelas desde
-- P09 —`provider_code`, `capture_mode`, `payment_intents`, `payment_attempts`—
-- y aqui solo se rellena una fila que ya existia apagada.
--
-- ## Se REUTILIZA la fila `tarjeta`, no se crea otra
--
-- La tienda ya tenia un metodo `tarjeta` de familia `card` con `is_active =
-- false`: alguien lo dejo preparado y sin proveedor. Crear un `culqi` al lado
-- dejaria dos medios de tarjeta compitiendo en el checkout, y el comprador
-- tendria que elegir entre «Tarjeta» y «Tarjeta». Se rellena el que hay.
--
-- ## `capture_mode = 'automatic'`
--
-- Culqi cobra en el mismo acto: no hay una autorizacion que se capture despues.
-- Dejarlo en `manual` obligaria a una segunda accion del comercio que el
-- proveedor no necesita, y el pedido se quedaria autorizado sin cobrar.
--
-- Idempotente: correrlo dos veces deja lo mismo.
-- Para deshacerlo: `update public.payment_methods set is_active = false
--                   where code = 'tarjeta';`
-- =============================================================================

-- --- 1 · Culqi, en el registro de proveedores -------------------------------
--
-- `payment_methods.provider_code` tiene clave foranea contra
-- `integration_providers`: un metodo no puede apuntar a una pasarela que el
-- sistema no conoce. Es lo que impide que un tenant escriba «culqui» y se quede
-- con un cobro colgando de un proveedor inexistente.
--
-- Las capacidades son las que Culqi ofrece de verdad: cobra y devuelve. No se
-- declara `payment.void` porque no anula sin cobrar.
insert into public.integration_providers (code, kind, name, capabilities, is_active)
values (
  'culqi',
  'payment',
  'Culqi',
  array['payment.authorize', 'payment.capture', 'payment.refund'],
  true
)
on conflict (code, kind) do update
set name = excluded.name,
    capabilities = excluded.capabilities,
    is_active = true;

-- --- 2 · El metodo de la tienda ---------------------------------------------
update public.payment_methods m
set
  provider_code = 'culqi',
  capture_mode  = 'automatic',
  is_active     = true,
  display_name  = 'Tarjeta de credito o debito',
  -- Lo que el comprador lee ANTES de elegir. Sin numero de cuenta ni nada que
  -- tenga que copiar: con tarjeta no hay deberes despues de pedir, y decir lo
  -- contrario haria dudar de si el pedido quedo pagado.
  instructions  = 'Pagas al confirmar el pedido. No compartas tu numero de tarjeta por ningun otro medio.',
  position      = 5
from public.stores s
where s.id = m.store_id
  and s.slug = 'miquimica'
  and m.code = 'tarjeta';

-- Comprobacion: debe salir una fila, activa y con proveedor.
select m.code, m.kind, m.provider_code, m.capture_mode, m.is_active, m.position
from public.payment_methods m
join public.stores s on s.id = m.store_id
where s.slug = 'miquimica' and m.code = 'tarjeta';
