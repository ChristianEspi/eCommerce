-- =============================================================================
-- Hardening multi-commerce · H08 — el país por defecto del checkout, desde la
-- CONFIGURACIÓN de la tienda.
--
-- ## El hueco
--
-- El país del checkout empezaba vacío, y con el país vacío la cotización de
-- entrega no encaja con ninguna zona: al comprador solo le quedaba el recojo
-- (`DEMO_WEDNESDAY_README.md`). Poner `PE` en el código lo arreglaría para una
-- tienda y lo rompería para cualquier otra: la plataforma es multirregión.
--
-- ## De dónde sale
--
-- La tienda YA declara a qué país vende: sus zonas de entrega activas llevan
-- `country` obligatorio. Si todas son del mismo país, ese es el país por defecto;
-- si hay varios —o ninguna zona—, no hay un defecto honesto y se devuelve `null`,
-- que es exactamente lo que el checkout hacía hasta hoy.
--
-- No es una columna nueva ni un ajuste más en Configuración: es un derivado de
-- lo que el comercio ya configuró al dar de alta su cobertura. Cambiar las zonas
-- cambia el defecto, sin que nadie tenga que acordarse de sincronizar dos datos.
--
-- ## Qué se publica
--
-- Solo el código ISO del país, y solo de tiendas ACTIVAS. Es lo mismo que el
-- comprador deduce en cuanto la tienda le cotiza una entrega. Ni zonas, ni
-- regiones, ni prefijos, ni tarifas.
-- =============================================================================

create or replace function ebim.store_default_country(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  -- La autorización es el filtro: solo tiendas activas, que son las que
  -- `public_stores` ya publica. Una tienda en borrador no revela nada.
  select case when count(distinct z.country) = 1 then min(z.country)::text end
  from public.delivery_zones z
  join public.stores s on s.id = z.store_id and s.status = 'active'
  where z.store_id = p_store_id
    and z.is_active;
$fn$;

revoke all on function ebim.store_default_country(uuid) from public;
grant execute on function ebim.store_default_country(uuid) to anon, authenticated, service_role;

comment on function ebim.store_default_country(uuid) is
  'Pais por defecto del checkout: el de las zonas de entrega activas si todas son del mismo pais; null si hay varios o ninguna. Solo tiendas activas.';

-- ---------------------------------------------------------------------------
-- La vista pública, recreada con `default_country`.
--
-- DROP + CREATE en migración NUEVA (las aplicadas son inmutables). Mismas
-- columnas que `20260910220000_storefront_theme.sql`, en el mismo orden, más
-- una al final. Sigue siendo `security_invoker` y sigue filtrando tiendas
-- activas. No entran `organization_id`, `company_id`, `tax_rate`, `config`, el
-- estado del dominio ni la identidad del correo.
-- ---------------------------------------------------------------------------
drop view if exists public.public_stores;

create view public.public_stores
with (security_invoker = on) as
select
  s.id            as store_id,
  s.slug,
  s.name,
  s.currency,
  s.domain,
  ss.accent_color,
  ss.logo_url,
  ss.favicon_url,
  ss.white_label,
  ss.default_locale,
  ss.support_email,
  ss.banner_url,
  ss.hero_title,
  ss.hero_subtitle,
  ss.contact_phone,
  ss.contact_address,
  ss.font_family,
  ss.ui_radius,
  ss.ui_density,
  ss.business_display_name,
  coalesce(ss.checkout_requires_account, false) as checkout_requires_account,
  coalesce(ss.theme_preset, 'universal')                            as theme_preset,
  coalesce(ss.storefront_style, '{}'::jsonb)                        as storefront_style,
  coalesce(ss.home_layout, '{"version": 1, "sections": []}'::jsonb) as home_layout,
  ebim.store_default_country(s.id)                                  as default_country
from public.stores s
left join public.store_settings ss on ss.store_id = s.id
where s.status = 'active';

revoke all on public.public_stores from public;
grant select on public.public_stores to anon, authenticated, service_role;

comment on view public.public_stores is
  'Lo publicable de una tienda activa, incluido su tema y su pais por defecto (derivado de sus zonas de entrega). security_invoker: las policies de stores y store_settings siguen mandando.';
