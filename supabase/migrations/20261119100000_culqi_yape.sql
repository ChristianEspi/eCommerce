-- =============================================================================
-- Yape por Culqi (2026-11-19).
--
-- Hasta hoy Yape solo existía como medio «manual»: el comprador yapeaba al
-- número del comercio, mandaba la captura por fuera y alguien confirmaba el
-- cobro a mano. Culqi cobra Yape en su misma ventana: el comprador escribe su
-- celular y el código de aprobación de su app, Culqi devuelve un token `ype_…`
-- y ese token se cobra EXACTAMENTE como el de una tarjeta (`POST /v2/charges`,
-- `source_id`). El pedido queda pagado sin intervención.
--
-- Lo único que falta es que el comercio diga si su cuenta Culqi tiene Yape
-- activado: si la vitrina lo ofrece y Culqi no lo tiene, el comprador se
-- encuentra la opción rota. Por eso es un interruptor del medio Culqi, apagado
-- por defecto, y no algo que se encienda solo.
--
-- Las reglas de Culqi (solo soles, máximo S/ 2000 por operación) las aplica la
-- vitrina al abrir la ventana: no son configuración del comercio.
-- =============================================================================

alter table public.payment_methods
  add column if not exists accepts_yape boolean not null default false;

-- Yape por pasarela solo tiene sentido en un medio de tarjeta cobrado por Culqi.
alter table public.payment_methods drop constraint if exists payment_methods_yape_culqi;
alter table public.payment_methods add constraint payment_methods_yape_culqi check (
  not accepts_yape or (provider_code = 'culqi' and kind = 'card')
);

comment on column public.payment_methods.accepts_yape is
  'La ventana de Culqi ofrece también Yape (celular + código de aprobación). Solo medios de tarjeta con pasarela Culqi; requiere Yape activado en la cuenta Culqi del comercio.';

-- La vitrina (anon) tiene permisos POR COLUMNA en la tabla (la vista es
-- `security_invoker`): sin este grant, la vista entera deja de leerse.
grant select (accepts_yape) on public.payment_methods to anon;

-- La vitrina necesita saberlo para abrir la ventana con Yape. Columna nueva al
-- FINAL: `create or replace view` no deja reordenar las existentes.
create or replace view public.public_payment_methods
with (security_invoker = on) as
select
  m.id       as payment_method_id,
  m.store_id,
  m.code,
  m.kind,
  m.display_name,
  m.position,
  m.instructions,
  m.checkout_public_key,
  m.accepts_yape
from public.payment_methods m;

revoke all on public.public_payment_methods from public;
grant select on public.public_payment_methods to anon, authenticated, service_role;

comment on view public.public_payment_methods is
  'Medios de pago publicables de una tienda activa. Sin proveedor, sin config y sin modo de captura; solo la llave PUBLICA de la pasarela, que es publicable por diseño, y si su ventana acepta Yape.';
