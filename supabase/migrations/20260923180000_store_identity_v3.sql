-- ---------------------------------------------------------------------------
-- Storefront V3 · P01 · Identidad de la tienda con ROLES SEMÁNTICOS
--
-- ## El problema que resuelve
--
-- `hero_subtitle` hacía dos trabajos incompatibles. Es la bajada del hero —que
-- es estacional: «Campaña de invierno», «Lo nuevo de marzo»— y, desde P09 de
-- V2, también la descripción estable del comercio que pintan el pie y la
-- sección de datos del negocio.
--
-- Un comercio que estrena campaña cambia su hero y, sin querer, cambia lo que
-- dice de sí mismo en el pie de todas sus páginas. Al revés también: quien
-- quiere un resumen serio en el pie se queda sin poder usar el hero para una
-- campaña. Eran dos cosas en un campo.
--
-- ## Lo que se añade, y por qué cada uno
--
--   · `store_description` — el resumen ESTABLE del comercio. Pie, datos del
--     negocio y reserva de SEO. No caduca.
--   · `hero_kicker` — la línea corta de encima del titular del hero. Es lo que
--     permite que el hero deje de repetir el nombre de la tienda: con kicker,
--     el titular puede hablar de la campaña.
--   · `brand_lockup` — qué enseña la cabecera: logo y nombre, solo logo, o solo
--     nombre. Una tienda con un logotipo que ya lleva su nombre dentro no
--     quiere verlo dos veces, y una sin logotipo no quiere un hueco.
--   · `show_theme_toggle` — el selector claro/oscuro de la vitrina, APAGADO por
--     defecto. Es una preferencia de la suite que se colaba en el producto del
--     comercio: en una tienda, un botón de tema compite con el carrito.
--   · `announcement_messages` — la barra de avisos, con lo que el comercio
--     escriba y nada más. Cero mensajes por defecto.
--
-- ## Lo que NO se hace
--
-- No se renombra ni se borra `hero_subtitle`: el hero sigue usándolo, y una
-- tienda que no configure nada se ve exactamente igual que antes.
--
-- No se actualiza en masa ninguna tienda. Las columnas nacen con su defecto y
-- las tiendas antiguas caen a `hero_subtitle` para el pie **solo mientras**
-- `store_description` sea nulo. En cuanto el comercio lo escribe, los dos
-- campos se desacoplan para siempre — que es el motivo de esta migración.
--
-- Y la plataforma no genera ni un aviso. «Envíos a todo el país» es una
-- afirmación sobre el negocio de otro: o la escribe el comercio, o no existe.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1 · ebim.announcement_is_valid — un aviso.
--
-- Un objeto con UNA clave, `text`, y nada más. La lista cerrada es aquí la
-- defensa de verdad: sin ella, el primer `{"html": "<script>"}` que alguien
-- guarde acaba en el DOM de la vitrina de todos sus compradores.
--
-- `[[:cntrl:]]` fuera: una barra de una línea no significa nada con saltos, y
-- un `\n` guardado ahí descuadra la cabecera entera.
--
-- El texto se acota a 80: es una barra, no un párrafo. Más largo no se lee en
-- un teléfono y empuja la cabecera.
-- ---------------------------------------------------------------------------
create or replace function ebim.announcement_is_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce((
    select p_value is not null
     and jsonb_typeof(p_value) = 'object'
     -- Exactamente una clave, y es `text`. Nada de HTML, CSS, iconos
     -- arbitrarios ni URL externas: si mañana hace falta un enlace, entra por
     -- una migración que lo piense, no por un campo libre que lo permita hoy.
     and (select count(*) from jsonb_object_keys(p_value)) = 1
     and p_value ? 'text'
     and jsonb_typeof(p_value -> 'text') = 'string'
     and char_length(btrim(p_value ->> 'text')) between 1 and 80
     and (p_value ->> 'text') !~ '[[:cntrl:]]'
  ), false);
$fn$;

revoke execute on function ebim.announcement_is_valid(jsonb) from public;
grant  execute on function ebim.announcement_is_valid(jsonb)
  to anon, authenticated, service_role;

comment on function ebim.announcement_is_valid(jsonb) is
  'Un aviso de la barra: objeto con UNA sola clave text, de 1..80 caracteres y sin caracteres de control. Ni HTML, ni URL, ni iconos.';

-- ---------------------------------------------------------------------------
-- 2 · ebim.announcements_are_valid — la lista.
--
-- Array de 0..2. El tope no es una cifra redonda: la barra rota entre mensajes
-- y con tres nadie llega a leer el tercero antes de empezar a comprar. La lista
-- vacía es el defecto y significa «sin barra», no «barra en blanco».
--
-- Sin textos repetidos: dos avisos iguales rotando no son una preferencia, son
-- un guardado accidentado.
-- ---------------------------------------------------------------------------
create or replace function ebim.announcements_are_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce((
    select p_value is not null
     and jsonb_typeof(p_value) = 'array'
     and jsonb_array_length(p_value) <= 2
     and not exists (
       select 1 from jsonb_array_elements(p_value) as e(aviso)
       where not ebim.announcement_is_valid(e.aviso)
     )
     and (
       select count(distinct btrim(e.aviso ->> 'text'))
       from jsonb_array_elements(p_value) as e(aviso)
     ) = jsonb_array_length(p_value)
  ), false);
$fn$;

revoke execute on function ebim.announcements_are_valid(jsonb) from public;
grant  execute on function ebim.announcements_are_valid(jsonb)
  to anon, authenticated, service_role;

comment on function ebim.announcements_are_valid(jsonb) is
  'Lista de avisos de la barra: array de 0..2 avisos validos y sin texto repetido. La lista vacia significa "sin barra".';

-- ---------------------------------------------------------------------------
-- 3 · Las columnas.
--
-- `store_description` a 360: cabe un resumen de tres o cuatro líneas, que es lo
-- que pinta el pie sin empujar el aviso legal fuera de vista, y sirve de
-- reserva para la meta descripción, donde de todas formas se corta antes.
--
-- `hero_kicker` a 80: es una línea de encima del titular; si no cabe en una
-- línea en un teléfono, deja de ser un kicker.
--
-- `brand_lockup` con CHECK de lista cerrada y defecto `logo_name`, que es
-- exactamente lo que la cabecera hace hoy: ninguna tienda cambia de aspecto por
-- aplicar esta migración.
--
-- `show_theme_toggle` en `false`. Es el único defecto que CAMBIA la vitrina, y
-- a propósito: el selector de tema estaba en la cabecera de toda tienda sin que
-- ningún comercio lo hubiera pedido. Quien lo quiera, lo enciende.
-- ---------------------------------------------------------------------------
alter table public.store_settings
  add column if not exists store_description text,
  add column if not exists hero_kicker text,
  add column if not exists brand_lockup text not null default 'logo_name',
  add column if not exists show_theme_toggle boolean not null default false,
  add column if not exists announcement_messages jsonb not null default '[]'::jsonb;

-- Los límites, cada uno con su nombre para que un rechazo diga qué falló.
alter table public.store_settings
  add constraint store_settings_store_description_len
    check (store_description is null or char_length(store_description) <= 360);

alter table public.store_settings
  add constraint store_settings_hero_kicker_len
    check (hero_kicker is null or char_length(hero_kicker) <= 80);

alter table public.store_settings
  add constraint store_settings_brand_lockup
    check (brand_lockup in ('logo_name', 'logo', 'name'));

alter table public.store_settings
  add constraint store_settings_announcements
    check (ebim.announcements_are_valid(announcement_messages));

comment on column public.store_settings.store_description is
  'Resumen ESTABLE del comercio para pie, datos del negocio y reserva de SEO. Distinto de hero_subtitle, que es de campana.';
comment on column public.store_settings.hero_kicker is
  'Linea corta encima del titular del hero. Existe para que el hero no repita el nombre de la tienda.';
comment on column public.store_settings.brand_lockup is
  'Que ensena la cabecera: logo_name | logo | name. Defecto logo_name, que es lo que hacia antes.';
comment on column public.store_settings.show_theme_toggle is
  'Selector claro/oscuro en la vitrina publica. Apagado por defecto: en una tienda compite con el carrito.';
comment on column public.store_settings.announcement_messages is
  'Barra de avisos: 0..2 textos del COMERCIO. La plataforma no genera ninguno; la lista vacia significa sin barra.';

-- ---------------------------------------------------------------------------
-- 4 · Permisos.
--
-- Lectura de `anon` por COLUMNA, como todo lo publicable de esta tabla: la RLS
-- filtra filas, nunca columnas. Los cinco campos son contenido de vitrina —lo
-- que el comprador ve— y ninguno dice nada del tenant ni de su configuración
-- interna.
--
-- Escritura para `authenticated`: la lista de UPDATE de esta tabla es explícita
-- desde la migración de white-label, y una columna nueva NO entra sola. Hay que
-- nombrarla, que es justo lo que hace que ese mecanismo siga sirviendo. Las
-- policies no se tocan: `store_settings_update_admin` ya exige owner/admin y
-- aislamiento de tenant, y su `with check` premium enumera las columnas de
-- marca blanca — ninguna de estas cinco está ahí, así que funcionan sin el
-- addon: son contenido de la tienda, no marca blanca.
-- ---------------------------------------------------------------------------
grant select (store_description, hero_kicker, brand_lockup, show_theme_toggle, announcement_messages)
  on public.store_settings to anon, authenticated;
grant update (store_description, hero_kicker, brand_lockup, show_theme_toggle, announcement_messages)
  on public.store_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 5 · La vista pública, recreada con los cinco campos.
--
-- DROP + CREATE en migración NUEVA, nunca editando una aplicada. Se conserva
-- `security_invoker = on` —las policies siguen mandando— y el filtro de tienda
-- ACTIVA. No entran `organization_id`, `company_id`, `tax_rate`, `config`, el
-- estado del dominio ni la identidad del correo.
--
-- Los `coalesce` existen porque el JOIN es LEFT: una tienda sin fila de ajustes
-- no puede devolver `null` en un campo que la vitrina usa para decidir qué
-- pinta. `store_description` y `hero_kicker` sí viajan como `null`, porque ahí
-- «no configurado» es una respuesta con significado y la vitrina la interpreta.
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
  coalesce(ss.value_props, '[]'::jsonb)                             as value_props,
  -- Storefront V3 · P01
  ss.store_description,
  ss.hero_kicker,
  coalesce(ss.brand_lockup, 'logo_name')                            as brand_lockup,
  coalesce(ss.show_theme_toggle, false)                             as show_theme_toggle,
  coalesce(ss.announcement_messages, '[]'::jsonb)                   as announcement_messages,
  ebim.store_default_country(s.id)                                  as default_country
from public.stores s
left join public.store_settings ss on ss.store_id = s.id
where s.status = 'active';

revoke all on public.public_stores from public;
grant select on public.public_stores to anon, authenticated, service_role;

comment on view public.public_stores is
  'Lo publicable de una tienda activa: identidad, contacto, tema, propuestas de valor, identidad V3 (descripcion, kicker, lockup, toggle, avisos) y pais por defecto. security_invoker: las policies de stores y store_settings siguen mandando.';
