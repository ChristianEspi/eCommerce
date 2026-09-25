-- =============================================================================
-- Storefront V2 · P01 — Propuestas de valor de la tienda, configurables.
--
-- Una columna en `store_settings` y nada más: `value_props`, una lista ordenada
-- de como mucho cuatro entradas.
--
-- ## El problema que resuelve, dicho sin rodeos
--
-- La franja bajo la portada tenía cuatro servicios CABLEADOS en el código, y
-- dos de ellos eran afirmaciones de un rubro concreto: «Atención farmacéutica»
-- y «Retiro en tienda». Una zapatería que abría su tienda anunciaba asesoría
-- farmacéutica, y un comercio sin local anunciaba retiro. No es un problema de
-- redacción: es que la plataforma estaba afirmando cosas del negocio de otro.
--
-- La separación que arregla eso tiene tres capas y esta migración es la del
-- medio:
--
--   · PLATAFORMA — lo que el código puede afirmar de cualquier tienda porque
--     lo hace él: hay métodos de entrega en el checkout y el pago se procesa en
--     el servidor. Eso vive en i18n y no necesita fila.
--   · COMERCIO — lo que solo el comercio sabe: si hay local, si hay garantía,
--     si hay asesoría especializada. Eso es ESTO.
--   · RUBRO — no existe. No hay ni habrá una columna «a qué te dedicas», porque
--     en cuanto exista alguien ramificará por ella.
--
-- ## Por qué una columna propia y no `config`
--
-- El mismo motivo que las tres del Theme Engine (`20260910220000`): `config` es
-- el cajón interno del comercio y NO tiene GRANT de lectura para `anon`. Esto
-- lo necesita el comprador anónimo en cada carga de la portada, así que va en su
-- propia columna, se concede una a una y se valida con un CHECK de verdad.
--
-- ## Por qué texto libre aquí sí, cuando el tema es lista cerrada
--
-- Porque son cosas distintas. El tema decide DISPOSICIÓN: una opción fuera de
-- la lista acabaría en un selector de CSS, y ahí no se admite nada que no esté
-- nombrado. Esto es CONTENIDO: el título de una propuesta de valor lo escribe
-- el comercio y no hay lista que pueda contener «Envíos a todo el país en 48 h».
--
-- Lo que sí se cierra es todo lo demás, y es lo que hace que el texto libre no
-- sea un agujero:
--
--   · el ICONO es de lista cerrada — un nombre de icono es una decisión de
--     presentación, no contenido;
--   · el texto tiene TOPE de longitud (40 y 90) y no admite caracteres de
--     control: un salto de línea en un título rompe la franja, y una cadena de
--     diez mil caracteres la convierte en la portada entera;
--   · no hay ninguna clave que pueda contener HTML, una URL o un estilo. El
--     título y el apoyo se pintan como TEXTO (React escapa), así que aquí no se
--     filtra `<script>`: no hay sitio donde pudiera ejecutarse.
--
-- ## Y por qué como mucho cuatro
--
-- Porque es una franja de una línea, no una sección. Con seis entradas o se
-- parte en dos filas —y deja de leerse de un vistazo, que es lo único que hace
-- una franja— o se encoge cada una hasta que el texto no cabe. El tope es de
-- diseño y por eso está también en la base: un tope que solo vive en el
-- formulario lo salta cualquier otro consumidor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ebim.value_prop_is_valid — una entrada.
--
-- Recorre las claves que TRAE el valor y rechaza cualquiera que no esté
-- nombrada, igual que `storefront_style_is_valid`. `iconKey`, `title` y
-- `enabled` son obligatorias; `body` es opcional porque hay propuestas que se
-- explican solas («Compra segura») y forzar una segunda línea produce relleno.
--
-- `coalesce(..., false)` envolviendo todo, y no por costumbre: un CHECK que se
-- evalúa a NULL **pasa**. Como cualquier `->` sobre una clave ausente devuelve
-- NULL, sin el envoltorio un objeto sin `title` entraría por la puerta de atrás
-- — el CHECK estaría escrito, se aplicaría, y no rechazaría nada.
-- ---------------------------------------------------------------------------
create or replace function ebim.value_prop_is_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce((
    select p_value is not null
     and jsonb_typeof(p_value) = 'object'
     and not exists (
       select 1 from jsonb_object_keys(p_value) as k(clave)
       where k.clave not in ('iconKey', 'title', 'body', 'enabled')
     )
     -- El icono, de lista cerrada. Es presentación, no contenido: nombra un
     -- glifo que este repositorio dibuja, así que aquí no cabe nada más.
     and jsonb_typeof(p_value -> 'iconKey') = 'string'
     and (p_value ->> 'iconKey') in (
       'delivery', 'pickup', 'payment', 'support', 'returns', 'warranty',
       'installments', 'quality', 'assortment', 'expertise', 'schedule',
       'certification'
     )
     -- El título: obligatorio, con contenido después de recortar y acotado.
     -- `[[:cntrl:]]` deja fuera saltos de línea y tabuladores, que en una
     -- franja de una línea no significan nada y descuadran la rejilla.
     and jsonb_typeof(p_value -> 'title') = 'string'
     and char_length(btrim(p_value ->> 'title')) between 1 and 40
     and (p_value ->> 'title') !~ '[[:cntrl:]]'
     -- El apoyo: opcional, y si viene tiene que decir algo.
     and (
       not (p_value ? 'body')
       or (
         jsonb_typeof(p_value -> 'body') = 'string'
         and char_length(btrim(p_value ->> 'body')) between 1 and 90
         and (p_value ->> 'body') !~ '[[:cntrl:]]'
       )
     )
     and jsonb_typeof(p_value -> 'enabled') = 'boolean'
  ), false);
$fn$;

revoke execute on function ebim.value_prop_is_valid(jsonb) from public;
grant  execute on function ebim.value_prop_is_valid(jsonb)
  to anon, authenticated, service_role;

comment on function ebim.value_prop_is_valid(jsonb) is
  'Una propuesta de valor: icono de lista cerrada, titulo obligatorio de 1..40, apoyo opcional de 1..90, sin caracteres de control.';

-- ---------------------------------------------------------------------------
-- ebim.value_props_are_valid — la lista.
--
-- Tres reglas, cada una por su motivo:
--
--   · ARRAY, y la lista vacía es válida: significa «uso las propuestas que la
--     plataforma puede afirmar». No significa «franja en blanco», igual que el
--     orden de Home vacío no significa portada vacía;
--   · como mucho CUATRO, por lo explicado en la cabecera;
--   · sin ICONO REPETIDO. Dos entradas con el mismo glifo no son una
--     preferencia: se leen como un fallo de la tienda, y casi siempre son un
--     guardado accidentado.
--
-- El ORDEN de la lista es el orden en que se pintan. No hay campo `position`
-- porque un array ya está ordenado, y un segundo orden dentro de un orden es
-- una fuente de verdad de más.
-- ---------------------------------------------------------------------------
create or replace function ebim.value_props_are_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce((
    select p_value is not null
     and jsonb_typeof(p_value) = 'array'
     and jsonb_array_length(p_value) <= 4
     and not exists (
       select 1 from jsonb_array_elements(p_value) as e(entrada)
       where not ebim.value_prop_is_valid(e.entrada)
     )
     and (
       select count(distinct e.entrada ->> 'iconKey')
       from jsonb_array_elements(p_value) as e(entrada)
     ) = jsonb_array_length(p_value)
  ), false);
$fn$;

revoke execute on function ebim.value_props_are_valid(jsonb) from public;
grant  execute on function ebim.value_props_are_valid(jsonb)
  to anon, authenticated, service_role;

comment on function ebim.value_props_are_valid(jsonb) is
  'Lista de propuestas de valor: array de 0..4 entradas validas y sin icono repetido. La lista vacia significa "usa las de plataforma".';

-- ---------------------------------------------------------------------------
-- La columna.
-- ---------------------------------------------------------------------------
alter table public.store_settings
  add column if not exists value_props jsonb not null default '[]'::jsonb;

alter table public.store_settings
  add constraint store_settings_value_props
    check (ebim.value_props_are_valid(value_props));

comment on column public.store_settings.value_props is
  'Propuestas de valor de la vitrina (0..4). Contenido del comercio, no del rubro: la lista vacia deja las que la plataforma puede afirmar de cualquier tienda.';

-- ---------------------------------------------------------------------------
-- Permisos.
--
-- LECTURA para `anon`: GRANT POR COLUMNA, como todo lo publicable de esta tabla
-- desde P02 — la RLS filtra filas, nunca columnas. Es contenido de portada: no
-- dice nada del tenant, ni de sus precios, ni de su configuración interna.
--
-- ESCRITURA para `authenticated`: la lista de UPDATE es explícita desde la
-- migración de white-label. Una columna nueva NO entra sola en esa lista, así
-- que hay que nombrarla — que es precisamente lo que hace que ese mecanismo
-- siga sirviendo. Las policies de `store_settings` no se tocan:
-- `store_settings_update_admin` ya exige owner/admin y aislamiento de tenant, y
-- su `with check` premium enumera las columnas de white-label; esta no está ahí,
-- así que las propuestas de valor funcionan sin el addon — son contenido de la
-- tienda, no marca blanca.
-- ---------------------------------------------------------------------------
grant select (value_props) on public.store_settings to anon, authenticated;
grant update (value_props) on public.store_settings to authenticated;

-- ---------------------------------------------------------------------------
-- La vista pública, recreada con el campo nuevo.
--
-- DROP + CREATE en migración NUEVA, nunca editando la que ya existe: una
-- migración aplicada es inmutable (regla del repositorio). Se conserva
-- `security_invoker = on` —las policies siguen mandando— y el filtro de tienda
-- ACTIVA. No entran `organization_id`, `company_id`, `tax_rate`, `config`, el
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
  -- `coalesce` porque el JOIN es LEFT: una tienda sin fila de ajustes no puede
  -- devolver `null` en un campo que la vitrina usa para decidir qué pintar.
  coalesce(ss.value_props, '[]'::jsonb)                             as value_props,
  ebim.store_default_country(s.id)                                  as default_country
from public.stores s
left join public.store_settings ss on ss.store_id = s.id
where s.status = 'active';

revoke all on public.public_stores from public;
grant select on public.public_stores to anon, authenticated, service_role;

comment on view public.public_stores is
  'Lo publicable de una tienda activa: identidad, contacto, tema, propuestas de valor y pais por defecto. security_invoker: las policies de stores y store_settings siguen mandando.';
