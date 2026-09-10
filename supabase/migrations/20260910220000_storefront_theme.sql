-- =============================================================================
-- Theme Engine · P02 — La configuración visual de la vitrina, persistida.
--
-- Tres columnas en `store_settings` y nada más:
--
--   · `theme_preset`     — cuál de los cuatro temas cerrados usa la tienda.
--   · `storefront_style` — lo que esa tienda le pisa a su tema.
--   · `home_layout`      — qué secciones pinta la portada y en qué orden.
--
-- ## Por qué columnas propias y no dentro de `config`
--
-- `config` es el cajón interno del comercio: NO tiene GRANT de lectura para
-- `anon` y no debe tenerlo, porque ahí acaba cayendo todo lo que no es
-- publicable. Estos tres campos los necesita el comprador anónimo en cada
-- carga de la vitrina. Meterlos en `config` obligaría a una de dos cosas: abrir
-- `config` entero al público —que es exactamente el agujero que el GRANT POR
-- COLUMNA de P02 existe para evitar— o extraerlos en la vista, con lo que el
-- CHECK de validez tendría que vivir sobre un `jsonb` de forma libre y no
-- podría ser un CHECK. Columnas propias resuelven las dos: se conceden una a
-- una y se validan una a una.
--
-- ## Por qué la validez se comprueba en la BASE si ya se normaliza en el front
--
-- Son dos capas distintas y ninguna sustituye a la otra:
--
--   · el normalizador de TypeScript (P01) es la defensa de LECTURA — lo raro no
--     rompe la vitrina, cae al valor seguro. Sin él, una fila escrita antes de
--     un despliegue dejaría la tienda en blanco;
--   · el CHECK de aquí es la defensa de ESCRITURA — lo raro no entra. Sin él,
--     la basura quedaría guardada esperando a que algún consumidor futuro (la
--     API pública, un ERP, un informe) la leyera sin normalizar.
--
-- ## Por qué el rechazo es por ESQUEMA y no por heurística de strings
--
-- No hay un solo `like '%<script%'` en este archivo. Un tenant no escribe CSS,
-- ni HTML, ni JavaScript, ni URLs: escribe UNA OPCIÓN DE UNA LISTA. `css`,
-- `html`, `onClick` o `backgroundUrl` no se rechazan por sospechosos — se
-- rechazan porque no están nombrados. Un filtro solo detiene lo que alguien
-- previó; una lista blanca detiene también lo que nadie imaginó.
--
-- ## Esto NO es premium
--
-- `content.white_label` gatea lo que hace que la tienda deje de parecer de la
-- suite: el propio `white_label`, la tipografía, la identidad de correo y el
-- dominio propio. El tema no está en esa lista y no se añade. Elegir entre
-- cuatro disposiciones de los MISMOS componentes es tematización, igual que el
-- acento o la densidad, y cobrar por ello sería vender una casilla en vez de
-- una capacidad. La consecuencia práctica: `reset_premium_branding` no toca
-- estas tres columnas, así que una baja comercial no le cambia la cara a la
-- tienda.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ebim.storefront_style_is_valid — la lista blanca del estilo.
--
-- Recorre las claves que TRAE el valor, no las que espera. Así un objeto
-- parcial (lo normal: la tienda pisa dos cosas y hereda el resto del preset) es
-- válido, y una clave de más es inválida, que es justo al revés de lo que haría
-- un `has all keys`.
--
-- `gridColumns` NO está, y su ausencia es deliberada: es el único campo del
-- tema que no es una elección entre opciones nombradas sino tres enteros
-- libres, y abrirlo invita a una rejilla de once columnas en un móvil. Si algún
-- día hace falta, será una lista cerrada de densidades.
-- ---------------------------------------------------------------------------
create or replace function ebim.storefront_style_is_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  -- `coalesce(..., false)` y no la expresión a secas: un CHECK que se evalúa a
  -- NULL **pasa**. Como cualquier `->` sobre una clave ausente devuelve NULL,
  -- sin este envoltorio un objeto al que le faltara una clave obligatoria
  -- entraría por la puerta de atrás. Es la clase de fallo que no se ve leyendo
  -- el código: el CHECK está escrito, se aplica, y no rechaza nada.
  select coalesce((
    select p_value is not null
     and jsonb_typeof(p_value) = 'object'
     and not exists (
       select 1
       from jsonb_each(p_value) as e(clave, valor)
       where jsonb_typeof(e.valor) <> 'string'
          or not (
               (e.clave = 'headerVariant'
                  and e.valor #>> '{}' in ('standard', 'compact'))
            or (e.clave = 'heroVariant'
                  and e.valor #>> '{}' in ('product', 'statement'))
            or (e.clave = 'productCardVariant'
                  and e.valor #>> '{}' in ('comfortable', 'compact'))
            or (e.clave = 'categoryVariant'
                  and e.valor #>> '{}' in ('tiles', 'pills'))
            or (e.clave = 'contentWidth'
                  and e.valor #>> '{}' in ('lg', 'xl'))
            or (e.clave = 'imageRatio'
                  and e.valor #>> '{}' in ('square', 'portrait', 'landscape'))
            or (e.clave = 'sectionSpacing'
                  and e.valor #>> '{}' in ('compact', 'comfortable', 'spacious'))
          )
     )
  ), false);
$fn$;

revoke execute on function ebim.storefront_style_is_valid(jsonb) from public;
grant  execute on function ebim.storefront_style_is_valid(jsonb)
  to anon, authenticated, service_role;

comment on function ebim.storefront_style_is_valid(jsonb) is
  'Lista blanca del estilo de vitrina: claves y valores cerrados. Lo que no esta nombrado no entra, sin heuristica de strings.';

-- ---------------------------------------------------------------------------
-- ebim.home_section_is_valid — una entrada del orden de la Home.
--
-- Tres claves y solo tres. `maxItems` es opcional porque hay secciones que no
-- pintan una colección (el hero enseña una cosa; los servicios, cuatro fijas) y
-- exigirlo ahí sería pedir un dato que nadie puede responder.
--
-- El tope se comprueba con una expresión regular ANTES de convertirlo: `3.5` es
-- un número JSON perfectamente válido y `::int` lo redondearía en silencio a 4.
-- Media sección no existe, así que se rechaza en vez de interpretarse.
-- ---------------------------------------------------------------------------
create or replace function ebim.home_section_is_valid(p_value jsonb)
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
       where k.clave not in ('id', 'enabled', 'maxItems')
     )
     and jsonb_typeof(p_value -> 'id') = 'string'
     and (p_value ->> 'id') in (
       'hero', 'services', 'offers', 'cms', 'promotions', 'categories', 'brands',
       'new-arrivals', 'best-sellers', 'featured', 'trust', 'business-info', 'newsletter'
     )
     and jsonb_typeof(p_value -> 'enabled') = 'boolean'
     and (
       not (p_value ? 'maxItems')
       or (
         jsonb_typeof(p_value -> 'maxItems') = 'number'
         and (p_value ->> 'maxItems') ~ '^[0-9]{1,3}$'
         and (p_value ->> 'maxItems')::int between 1 and 24
       )
     )
  ), false);
$fn$;

revoke execute on function ebim.home_section_is_valid(jsonb) from public;
grant  execute on function ebim.home_section_is_valid(jsonb)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ebim.home_layout_is_valid — el orden completo.
--
-- `version` existe para poder migrar sin adivinar, y por eso su CHECK es de
-- igualdad y no de rango: aceptar una versión 2 que este código no sabe leer
-- guardaría una configuración que la vitrina interpretaría con las reglas
-- equivocadas.
--
-- La lista puede estar INCOMPLETA a propósito —lo que no menciona lo completa
-- el normalizador con su valor por defecto, y así una sección nueva no obliga a
-- reescribir la configuración de todas las tiendas— pero no puede tener
-- REPETIDOS: una sección nombrada dos veces no es una preferencia, es un
-- guardado accidentado, y pintarla dos veces se lee como un fallo de la tienda.
-- ---------------------------------------------------------------------------
create or replace function ebim.home_layout_is_valid(p_value jsonb)
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
       where k.clave not in ('version', 'sections')
     )
     and jsonb_typeof(p_value -> 'version') = 'number'
     and (p_value ->> 'version') = '1'
     and jsonb_typeof(p_value -> 'sections') = 'array'
     and not exists (
       select 1 from jsonb_array_elements(p_value -> 'sections') as s(seccion)
       where not ebim.home_section_is_valid(s.seccion)
     )
     and (
       select count(distinct s.seccion ->> 'id')
       from jsonb_array_elements(p_value -> 'sections') as s(seccion)
     ) = jsonb_array_length(p_value -> 'sections')
  ), false);
$fn$;

revoke execute on function ebim.home_layout_is_valid(jsonb) from public;
grant  execute on function ebim.home_layout_is_valid(jsonb)
  to anon, authenticated, service_role;

comment on function ebim.home_layout_is_valid(jsonb) is
  'Orden de Home V1: sin claves ajenas, sin secciones desconocidas, sin repetidos y con maxItems acotado a 1..24.';

-- ---------------------------------------------------------------------------
-- Las tres columnas.
--
-- El default de `home_layout` es la lista VACÍA, y eso no significa "portada en
-- blanco": significa "usa el orden heredado". Ese orden vive en el contrato de
-- P01 y `normalizeHomeLayout` completa con él todo lo que la fila no mencione.
-- Copiar aquí las trece secciones habría creado dos fuentes de verdad para el
-- mismo dato, y el día que se añadiera la catorceava, la copia de la base se
-- quedaría corta sin que nadie se enterase.
-- ---------------------------------------------------------------------------
alter table public.store_settings
  add column if not exists theme_preset     text  not null default 'universal',
  add column if not exists storefront_style jsonb not null default '{}'::jsonb,
  add column if not exists home_layout      jsonb not null
    default '{"version": 1, "sections": []}'::jsonb;

alter table public.store_settings
  -- Los cuatro, exactos. `Retail` no es `retail` y no se recorta ni se baja a
  -- minúsculas: este valor lo escribe un formulario contra una lista cerrada,
  -- no una persona a mano, así que adivinar la intención escondería el defecto.
  add constraint store_settings_theme_preset
    check (theme_preset in ('universal', 'retail', 'premium', 'catalog')),
  add constraint store_settings_storefront_style
    check (ebim.storefront_style_is_valid(storefront_style)),
  add constraint store_settings_home_layout
    check (ebim.home_layout_is_valid(home_layout));

comment on column public.store_settings.theme_preset is
  'Tema de la vitrina: universal | retail | premium | catalog. No es el rubro del comercio: es una disposicion de los mismos componentes.';
comment on column public.store_settings.storefront_style is
  'Lo que la tienda le pisa a su tema. Claves y valores de lista cerrada; parcial a proposito, el resto lo hereda del preset.';
comment on column public.store_settings.home_layout is
  'Orden y encendido de las secciones de la portada (V1). La lista vacia significa "orden heredado", no "portada vacia".';

-- ---------------------------------------------------------------------------
-- Permisos.
--
-- LECTURA para `anon`: GRANT POR COLUMNA, como todo lo publicable de esta tabla
-- desde P02 — la RLS filtra filas, nunca columnas. Los tres son presentación
-- pura: no dicen nada del comercio, de su tenant ni de sus precios.
--
-- ESCRITURA para `authenticated`: la lista de UPDATE es explícita desde la
-- migración de white-label (el GRANT de tabla se retiró allí para dejar fuera
-- el estado de verificación del dominio). Una columna nueva NO entra sola en
-- esa lista, así que hay que nombrarla — que es precisamente lo que hace que
-- ese mecanismo siga sirviendo.
-- ---------------------------------------------------------------------------
grant select (theme_preset, storefront_style, home_layout)
  on public.store_settings to anon, authenticated;

grant update (theme_preset, storefront_style, home_layout)
  on public.store_settings to authenticated;

-- Las policies de `store_settings` NO se tocan: `store_settings_update_admin`
-- ya exige owner/admin y aislamiento de tenant, y su `with check` premium
-- enumera las columnas de white-label — ninguna de estas tres está ahí, que es
-- lo que hace que el tema funcione sin el addon.

-- ---------------------------------------------------------------------------
-- La vista pública, recreada con los tres campos.
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
  -- `coalesce` porque el JOIN es LEFT: una tienda sin fila de ajustes no puede
  -- devolver `null` en un campo que la vitrina usa para decidir qué pintar.
  coalesce(ss.theme_preset, 'universal')                            as theme_preset,
  coalesce(ss.storefront_style, '{}'::jsonb)                        as storefront_style,
  coalesce(ss.home_layout, '{"version": 1, "sections": []}'::jsonb) as home_layout
from public.stores s
left join public.store_settings ss on ss.store_id = s.id
where s.status = 'active';

revoke all on public.public_stores from public;
grant select on public.public_stores to anon, authenticated, service_role;

comment on view public.public_stores is
  'Lo publicable de una tienda activa, incluido su tema. security_invoker: las policies de stores y store_settings siguen mandando.';
