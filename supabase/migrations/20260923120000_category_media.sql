-- =============================================================================
-- Storefront V2 · P03 — Fotografía opcional en las categorías.
--
-- Dos columnas en `public.categories` y nada más: `image_url` e `image_alt`.
--
-- ## Por qué hacía falta
--
-- Las puertas de categoría de la portada se pintaban con un tinte asignado por
-- el nombre y un icono deducido del nombre. Funciona —cada familia tiene sitio
-- propio y se reconoce por el color— y es lo correcto para un catálogo de
-- envases, donde la foto de la categoría no añade nada.
--
-- Para una tienda VISUAL no basta. Quien vende ropa, calzado o mobiliario
-- decide por la imagen: una puerta que dice «Abrigos» sobre un icono genérico
-- pierde contra una que enseña un abrigo. Y no se puede resolver con una
-- condición por rubro —el código no sabe a qué se dedica el comercio, ni debe—:
-- se resuelve dándole a la categoría un sitio donde poner su foto y dejando que
-- cada comercio decida si la usa.
--
-- ## La ausencia de imagen NO invalida la categoría
--
-- Es la regla que gobierna las dos columnas. Todo lo que existe hoy sigue
-- funcionando exactamente igual: sin `image_url`, la puerta se pinta con su
-- tinte y su icono, que es lo que hacía. Nadie tiene que subir nada para que su
-- tienda siga viéndose como se veía.
--
-- ## Por qué no se guardan los bytes
--
-- La imagen va al bucket privado `store-assets` y aquí se guarda la RUTA. Un
-- `bytea` o un base64 en Postgres multiplica el tamaño de la copia de
-- seguridad, no se puede servir con caché de navegador y obliga a pasar la
-- imagen por el servidor de base de datos en cada carga de la portada.
--
-- ## Y por qué una carpeta propia, `categories/`
--
-- El bucket ya tiene `branding/` —el logo y el banner de la tienda— y
-- `content/` —las imágenes de campaña del CMS—. Una categoría no es ninguna de
-- las dos: su ciclo de vida es el del catálogo, no el de la identidad ni el de
-- una campaña de temporada. Tener carpeta propia es lo que permite mirar el
-- bucket y saber qué es cada cosa, y lo que deja borrar las fotos de campaña de
-- una temporada sin tocar las de las categorías.
--
-- La autorización de escritura NO cambia: `ebim.can_write_store_object` lee los
-- dos primeros segmentos de la ruta —organización y tienda— y la carpeta le da
-- igual. Esto no abre nada nuevo; usa lo que ya había.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · ebim.is_category_image_ref — a qué puede apuntar `image_url`.
--
-- Mismo criterio que `ebim.is_store_asset_ref` (migración 15) y por los mismos
-- motivos, con una sola diferencia: la carpeta es `categories/`. Se escribe
-- aparte en vez de generalizar la de branding porque generalizarla sería
-- ampliar lo que acepta el CHECK del logo de la tienda, y ese CHECK está
-- ajustado a propósito.
--
-- Se valida contra `organization_id` y `store_id` de la FILA, no contra un
-- argumento que el cliente elija: un CHECK que recibiera el tenant por
-- parámetro estaría confiando en quien escribe.
-- ---------------------------------------------------------------------------
create or replace function ebim.is_category_image_ref(p_value text, p_org uuid, p_store uuid)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_value is null then true
    -- Externo: solo `https`. Un `http://` degrada la vitrina a contenido mixto
    -- y el navegador lo bloquea igual.
    when p_value like 'https://%'
     and char_length(p_value) >= 12
     and p_value !~ '[[:space:]]' then true
    when p_org is null or p_store is null then false
    else p_value like (p_org::text || '/' || p_store::text || '/categories/%')
     and char_length(p_value) > char_length(p_org::text || '/' || p_store::text || '/categories/')
     -- Sin travesía de directorios: el prefijo autoriza, y un `..` detrás
     -- sacaría el objeto de la carpeta que el prefijo defiende.
     and p_value !~ '\.\.'
  end;
$fn$;

revoke execute on function ebim.is_category_image_ref(text, uuid, uuid) from public;
grant  execute on function ebim.is_category_image_ref(text, uuid, uuid)
  to anon, authenticated, service_role;

comment on function ebim.is_category_image_ref(text, uuid, uuid) is
  'La foto de una categoria es https externo o una ruta {organization_id}/{store_id}/categories/... de la PROPIA tienda. Valida contra las columnas de la fila.';

-- ---------------------------------------------------------------------------
-- 2 · Las dos columnas.
--
-- `image_alt` es TEXTO ALTERNATIVO, no un pie de foto: describe la imagen para
-- quien no la ve. Va acotado a 160 caracteres porque un lector de pantalla lo
-- lee entero y de una vez —un párrafo ahí es una frase interminable— y sin
-- caracteres de control por lo mismo.
--
-- Es opcional, y su ausencia tiene una respuesta definida en la vitrina: la
-- imagen se pinta como DECORATIVA (`alt=""`) y el nombre de la categoría, que
-- ya está escrito al lado, hace de nombre accesible. Eso es correcto y es mejor
-- que inventar un alt con el nombre: repetirlo haría que un lector de pantalla
-- dijera «Abrigos, Abrigos».
-- ---------------------------------------------------------------------------
alter table public.categories
  add column if not exists image_url text,
  add column if not exists image_alt text;

alter table public.categories
  add constraint categories_image_len
    check (image_url is null or char_length(image_url) between 4 and 1024),
  add constraint categories_image_ref
    check (ebim.is_category_image_ref(image_url, organization_id, store_id)),
  add constraint categories_image_alt_len
    check (
      image_alt is null
      or (char_length(btrim(image_alt)) between 1 and 160 and image_alt !~ '[[:cntrl:]]')
    );

comment on column public.categories.image_url is
  'Foto opcional de la categoria: https externo o ruta {organization_id}/{store_id}/categories/... del bucket privado. Sin ella la vitrina pinta tinte + icono.';
comment on column public.categories.image_alt is
  'Texto alternativo de la foto, 1..160. Sin el, la vitrina pinta la imagen como decorativa y el nombre de la categoria hace de nombre accesible.';

-- ---------------------------------------------------------------------------
-- 3 · Permisos.
--
-- `categories` da GRANT DE TABLA a `authenticated` desde P02 (a diferencia de
-- `store_settings`, que lo tiene por columna para dejar fuera el token del
-- dominio), así que las columnas nuevas ya son escribibles por quien la policy
-- `categories_update_catalog` autoriza — owner/admin/catalog de ese tenant. No
-- hay nada que conceder y no se concede nada.
--
-- Para `anon` sí: la lectura pública es por COLUMNA. Se añaden las dos nuevas y
-- solo las dos.
-- ---------------------------------------------------------------------------
grant select (image_url, image_alt) on public.categories to anon;

-- ---------------------------------------------------------------------------
-- 4 · La vista pública, ampliada con las dos columnas.
--
-- ## `create or replace` y NO `drop + create`, contra la costumbre del repo
--
-- Aquí sí importa. La vista NO es un `select … where is_active`: desde
-- `20260901130000` es un CTE RECURSIVO que solo enseña las categorías con TODO
-- su camino activo. Ese cambio arregló un fallo concreto —«una hija activa de
-- una madre desactivada seguía saliendo en la vitrina, y además como si fuera
-- raíz»— y hay una prueba que lo vigila.
--
-- Reescribir la vista de cero desde su versión ORIGINAL habría deshecho esa
-- corrección en silencio: el SQL nuevo se aplica, la vista existe, y apagar una
-- rama deja de apagarla entera. Lo cazó `category-tree.test.ts` al primer
-- intento, y por eso el cuerpo que sigue es el recursivo, copiado tal cual, con
-- las dos columnas nuevas AL FINAL — que es la única forma en que Postgres
-- admite `create or replace` sobre una vista existente, y además conserva los
-- GRANT sin tener que volver a concederlos.
--
-- No entran `organization_id`, `company_id`, `created_at` ni `updated_at`: el
-- comprador anónimo no tiene por qué saber de qué cuenta del hub es la tienda
-- ni cuándo se editó su árbol de categorías.
-- ---------------------------------------------------------------------------
create or replace view public.public_categories
with (security_invoker = on) as
with recursive visible as (
  select c.id, c.store_id, c.parent_id, c.slug, c.name, c.position, c.image_url, c.image_alt
    from public.categories c
   where c.is_active and c.parent_id is null
  union all
  select h.id, h.store_id, h.parent_id, h.slug, h.name, h.position, h.image_url, h.image_alt
    from public.categories h
    join visible v on h.parent_id = v.id
   where h.is_active
)
select
  id            as category_id,
  store_id,
  parent_id,
  slug,
  name,
  position,
  image_url,
  image_alt
from visible;

comment on view public.public_categories is
  'Categorias alcanzables por el comprador: activas Y con todos sus ancestros activos, con su foto opcional. Apagar una rama la apaga entera.';
