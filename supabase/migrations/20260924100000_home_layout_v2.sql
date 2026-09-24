-- ---------------------------------------------------------------------------
-- Storefront V3 · P06 · Home Layout V2: la presentación de cada sección
--
-- ## Qué añade
--
-- El orden de la portada podía decir QUÉ secciones y en qué orden. No podía
-- decir CÓMO se enseña cada una, así que la portada de toda tienda era la misma
-- lista de bandas: «título + fila de tarjetas», seis veces. Para un catálogo
-- denso eso es correcto; para una tienda de marca es una lista, no una portada.
--
-- V2 del contrato añade una clave opcional por sección:
--
--   {"id": "new-arrivals", "enabled": true, "maxItems": 12,
--    "presentation": {"variant": "rail", "surface": "soft", "width": "bleed"}}
--
-- ## Lo que NO es
--
-- No es un maquetador. Cada campo es una LISTA CERRADA y las listas dependen de
-- la sección: `spotlight` significa algo en una fila de producto y nada en el
-- hero, así que ahí se rechaza — no por peligroso, por vacío de significado.
--
-- Y no hay CSS, ni HTML, ni una URL de fondo, ni un número de columnas. Un
-- maquetador libre convierte cada tienda en un caso único, y a partir de ahí
-- ninguna mejora de la vitrina llega a nadie sin romperle la portada a alguien.
--
-- ## Compatibilidad: las dos versiones son válidas
--
--   · `version: 1` sigue pasando el CHECK, con o sin `presentation`;
--   · `version: 2` es lo que el editor escribe cuando alguien toca una
--     presentación.
--
-- Una fila guardada en V1 se resuelve exactamente como antes, porque la ausencia
-- de `presentation` significa `auto` —«lo que mi tema considere correcto»— y
-- `auto` de Universal resuelve lo que la portada pintaba ayer. **No se actualiza
-- ninguna fila**: ninguna tienda cambia de portada por aplicar esta migración.
--
-- La migración `20260910220000` no se toca: esto reemplaza sus dos funciones con
-- `create or replace`, y como las listas solo CRECEN, lo que ya pasaba el CHECK
-- sigue pasándolo.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1 · ebim.section_presentation_is_valid — la presentación de UNA sección.
--
-- Recibe también el `id`, porque la validez depende de él. Es la diferencia
-- entre un contrato cerrado y una lista de palabras permitidas: sin el `id`
-- habría que aceptar la unión de todas las variantes en todas las secciones, y
-- entonces una portada podría declarar el hero como `logos`.
-- ---------------------------------------------------------------------------
create or replace function ebim.section_presentation_is_valid(p_id text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce((
    select p_value is not null
     and jsonb_typeof(p_value) = 'object'
     -- Tres claves y solo tres. Lo que no está nombrado no entra.
     and not exists (
       select 1 from jsonb_object_keys(p_value) as k(clave)
       where k.clave not in ('variant', 'surface', 'width')
     )
     -- La VARIANTE, por familia de sección.
     and (
       not (p_value ? 'variant')
       or (
         jsonb_typeof(p_value -> 'variant') = 'string'
         and (
              -- Colecciones de producto.
              (p_id in ('new-arrivals', 'best-sellers', 'featured')
                 and (p_value ->> 'variant') in ('auto', 'rail', 'grid', 'spotlight'))
              -- Familias del catálogo. Las tres del contrato del tema.
           or (p_id = 'categories'
                 and (p_value ->> 'variant') in ('auto', 'tiles', 'pills', 'mosaic'))
              -- Marcas: tarjetas con cuenta, o muro de logotipos.
           or (p_id in ('brands', 'trust')
                 and (p_value ->> 'variant') in ('auto', 'cards', 'logos'))
              -- Lo rebajado y las campañas vigentes.
           or (p_id in ('offers', 'promotions')
                 and (p_value ->> 'variant') in ('auto', 'band', 'split'))
         )
       )
     )
     -- La SUPERFICIE. `contrast` no se ofrece donde taparía fotos propias: en
     -- una banda de familias o de marcas, el peso del fondo se come el
     -- contenido que la sección existe para enseñar.
     and (
       not (p_value ? 'surface')
       or (
         jsonb_typeof(p_value -> 'surface') = 'string'
         and (
              (p_id in ('categories', 'brands', 'trust', 'services', 'business-info', 'newsletter')
                 and (p_value ->> 'surface') in ('plain', 'soft'))
           or (p_id in ('offers', 'promotions', 'new-arrivals', 'best-sellers', 'featured')
                 and (p_value ->> 'surface') in ('plain', 'soft', 'contrast'))
              -- El hero y el CMS traen su propia superficie: una imagen a sangre
              -- o el degradado del acento. Otra encima sería pintar dos fondos.
           or (p_id in ('hero', 'cms') and (p_value ->> 'surface') = 'plain')
         )
       )
     )
     -- El ANCHO. Lo admiten todas: llegar a sangre es una decisión de ritmo, no
     -- de contenido.
     and (
       not (p_value ? 'width')
       or (
         jsonb_typeof(p_value -> 'width') = 'string'
         and (p_value ->> 'width') in ('contained', 'bleed')
       )
     )
  ), false);
$fn$;

revoke execute on function ebim.section_presentation_is_valid(text, jsonb) from public;
grant  execute on function ebim.section_presentation_is_valid(text, jsonb)
  to anon, authenticated, service_role;

comment on function ebim.section_presentation_is_valid(text, jsonb) is
  'Presentacion de una seccion de la portada (V3): variant/surface/width de listas cerradas POR id. Lo que no esta nombrado no entra.';

-- ---------------------------------------------------------------------------
-- 2 · ebim.home_section_is_valid — la sección, ahora con presentación.
--
-- Cuarta clave admitida, y opcional. Una sección sin ella es exactamente la de
-- V1: `auto` en todo.
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
       where k.clave not in ('id', 'enabled', 'maxItems', 'presentation')
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
     -- Storefront V3 · P06
     and (
       not (p_value ? 'presentation')
       or ebim.section_presentation_is_valid(p_value ->> 'id', p_value -> 'presentation')
     )
  ), false);
$fn$;

revoke execute on function ebim.home_section_is_valid(jsonb) from public;
grant  execute on function ebim.home_section_is_valid(jsonb)
  to anon, authenticated, service_role;

comment on function ebim.home_section_is_valid(jsonb) is
  'Una entrada del orden de la Home (V3): id de lista cerrada, enabled, maxItems 1..24 opcional y presentation opcional validada por id.';

-- ---------------------------------------------------------------------------
-- 3 · ebim.home_layout_is_valid — las dos versiones.
--
-- `1` y `2`, nada más. Un `3` no se acepta «por si acaso»: cuando exista, su
-- migración dirá qué significa. Aceptar una versión desconocida es prometer que
-- se sabe leerla.
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
     and (p_value ->> 'version') in ('1', '2')
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
  'Orden de la Home: version 1 o 2, secciones validas y sin identificadores repetidos. V1 sigue siendo valido y no se migra ninguna fila.';
