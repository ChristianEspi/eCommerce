-- =============================================================================
-- Storefront V2 · P02 — Logos de marca, de punta a punta.
--
-- `public.brands.logo_url` existe desde `20260827170000` y `anon` ya tenía
-- GRANT de lectura sobre esa columna. Lo que faltaba no era la columna: era
-- **todo lo demás**. El PIM no la seleccionaba ni la escribía, no había dónde
-- subir el archivo, y la vitrina construía sus marcas desde las FACETAS de la
-- búsqueda, que devuelven código, nombre y cuenta — nunca el logo.
--
-- Esta migración añade las tres piezas que faltaban en la base:
--
--   1. un CHECK de referencia, para que `logo_url` no pueda apuntar a cualquier
--      cosa;
--   2. autorización de Storage para un asset de SOCIEDAD, que es lo que una
--      marca es;
--   3. una vista pública que da el logo por tienda sin una consulta por marca.
--
-- ## Por qué la marca NO es un asset de tienda
--
-- Esta es la decisión que hay que leer antes de tocar nada. `store-assets`
-- autoriza por la ruta `{organization_id}/{store_id}/…`: `ebim.storage_store`
-- saca el segundo segmento y `ebim.can_write_store_object` lo contrasta contra
-- `public.stores`. Funciona para el logo de la tienda porque el logo de una
-- tienda ES de esa tienda.
--
-- Una marca no. `public.brands` no tiene `store_id` y eso es deliberado desde
-- el PIM: «la misma marca se vende en la tienda mayorista y en la minorista de
-- la misma sociedad, y tenerla dos veces significa que un día el logo se cambia
-- en una y no en la otra».
--
-- Así que reutilizar la ruta de tienda habría exigido elegir UNA tienda como
-- dueña del archivo. Con dos tiendas, o el logo se duplica —el problema que el
-- PIM evitó— o queda colgando de una tienda que mañana se cierra y se lleva un
-- logo que la otra seguía usando. La ruta es de la SOCIEDAD:
--
--     {organization_id}/company/{company_id}/brands/{uuid}.{ext}
--
-- El literal `company` en el segundo segmento no es decoración: es lo que
-- distingue las dos familias de rutas del mismo bucket. Con él,
-- `ebim.storage_store` devuelve NULL —`company` no es un uuid— y las policies
-- de tienda no autorizan nada; son las nuevas las que deciden, con el MISMO
-- rigor: organización del primer segmento, sociedad del tercero, y rol
-- comprobado contra la membresía de esa sociedad.
--
-- ## Y por qué no se admite SVG
--
-- Un SVG es un documento que puede llevar `<script>`, lo sube el tenant y lo
-- sirve el dominio de la vitrina. Este repositorio no tiene sanitizador de SVG
-- aprobado, así que no se acepta — ni aquí ni en el branding de la tienda. La
-- lista de tipos vive en el cliente (`ALLOWED_IMAGE_TYPES`) y la extensión sale
-- del MIME, no del nombre del archivo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · ebim.is_brand_logo_ref — a qué puede apuntar `logo_url`.
--
-- Dos formas y ninguna más:
--
--   · una URL `https://` externa (el mismo permiso que el contrato §4.3 da al
--     branding de la tienda: hay proveedores que devuelven el logo de una marca
--     por URL al provisionar);
--   · una ruta del bucket privado bajo el prefijo de la PROPIA sociedad.
--
-- Se valida contra `organization_id` y `company_id` de la FILA, no contra un
-- argumento que el cliente elija. Es la diferencia entre comprobar y preguntar:
-- un CHECK que recibiera el tenant por parámetro estaría confiando en quien
-- escribe.
--
-- `http://` queda fuera a propósito: degrada la vitrina a contenido mixto y el
-- navegador lo bloquea igual. Y sin cuantificador acotado en la regex porque
-- Postgres limita las repeticiones POSIX a 255; la longitud ya la controla
-- `brands_logo_len`.
-- ---------------------------------------------------------------------------
create or replace function ebim.is_brand_logo_ref(p_value text, p_org uuid, p_company uuid)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_value is null then true
    when p_value like 'https://%'
     and char_length(p_value) >= 12
     and p_value !~ '[[:space:]]' then true
    when p_org is null or p_company is null then false
    else p_value like (p_org::text || '/company/' || p_company::text || '/brands/%')
     and char_length(p_value) > char_length(p_org::text || '/company/' || p_company::text || '/brands/')
     -- Sin travesía de directorios: el prefijo autoriza, y un `..` detrás del
     -- prefijo sacaría el objeto de la carpeta que el prefijo defiende.
     and p_value !~ '\.\.'
  end;
$fn$;

revoke execute on function ebim.is_brand_logo_ref(text, uuid, uuid) from public;
grant  execute on function ebim.is_brand_logo_ref(text, uuid, uuid)
  to anon, authenticated, service_role;

comment on function ebim.is_brand_logo_ref(text, uuid, uuid) is
  'El logo de una marca es https externo o una ruta {organization_id}/company/{company_id}/brands/... de la PROPIA sociedad. Valida contra las columnas de la fila, no contra un argumento del cliente.';

alter table public.brands
  add constraint brands_logo_ref
    check (ebim.is_brand_logo_ref(logo_url, organization_id, company_id));

comment on column public.brands.logo_url is
  'Logo de la marca: https externo o ruta del bucket privado store-assets bajo el prefijo de la sociedad. La vitrina cae al monograma si falta.';

-- ---------------------------------------------------------------------------
-- 2 · Storage: un asset de SOCIEDAD dentro del mismo bucket.
--
-- Tres funciones, cada una con un trabajo:
--
--   · `storage_is_company_path` reconoce la familia de rutas por su segundo
--     segmento. Se comprueba explícitamente en vez de deducirlo de que el
--     segmento no sea un uuid: una ruta de tienda mal escrita no puede acabar
--     autorizándose como si fuera de sociedad;
--   · `storage_company` saca la sociedad del TERCER segmento;
--   · `can_write_company_object` y `company_object_visible` responden las dos
--     preguntas de siempre —quién escribe y qué se publica— con el mismo
--     criterio que sus hermanas de tienda.
--
-- La de ESCRITURA no es definer: quien pregunta responde con sus propios
-- permisos, así que una ruta de otra sociedad simplemente no encuentra fila.
-- La de LECTURA PÚBLICA sí lo es, y está explicado donde se define: `anon` no
-- tiene GRANT sobre `public.stores`, así que sin `definer` la policy de Storage
-- no puede ni evaluarse. Es el mismo fallo —y la misma solución— que
-- `20260901100000` para el logo de la tienda.
-- ---------------------------------------------------------------------------
create or replace function ebim.storage_is_company_path(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select split_part(p_name, '/', 2) = 'company';
$fn$;

create or replace function ebim.storage_company(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $fn$
  select case
    when split_part(p_name, '/', 2) = 'company'
      then ebim.safe_uuid(split_part(p_name, '/', 3))
  end;
$fn$;

/** ¿Quien pregunta puede escribir en el espacio de esa sociedad? */
create or replace function ebim.can_write_company_object(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select ebim.storage_is_company_path(p_name)
     and ebim.storage_org(p_name) is not null
     and ebim.storage_company(p_name) is not null
     and ebim.has_role(ebim.storage_org(p_name), ebim.storage_company(p_name),
                       array['owner','admin','catalog']::public.app_role[]);
$fn$;

/**
 * ¿El objeto de esa sociedad es publicable?
 *
 * Solo si la sociedad tiene al menos UNA tienda ACTIVA. Es el equivalente de
 * `store_object_visible` un nivel más arriba: el logo de una marca se ve porque
 * hay una vitrina donde verlo. Una sociedad sin tienda activa no publica nada,
 * y su carpeta de marcas tampoco.
 *
 * ## Por qué SÍ es SECURITY DEFINER, cuando sus hermanas de escritura no
 *
 * Porque el llamante legítimo es `anon`, y `anon` **no tiene ningún GRANT sobre
 * `public.stores`** más allá de seis columnas publicables: la vitrina lee por
 * las vistas `public_*`, nunca por la tabla. El cuerpo de una función normal se
 * ejecuta con los permisos de quien llama, así que sin `definer` esto responde
 * `permission denied for table stores` y la policy de Storage no puede
 * evaluarse — el logo no se ve nunca.
 *
 * Es exactamente el fallo que arregló `20260901100000` para el logo de la
 * TIENDA, con el mismo síntoma («enseñaba las iniciales») y la misma causa. Se
 * repite aquí la misma solución en vez de inventar otra.
 *
 * Y con ella, la misma obligación del contrato: como la RLS de `stores` deja de
 * filtrar, **la condición de visibilidad se escribe en el cuerpo**
 * (`status = 'active'`). Sin esa línea, el logo de una marca de una sociedad
 * cuyas tiendas están todas en borrador sería público.
 *
 * Lo que revela sigue siendo un BOOLEANO —«esta ruta cae en una sociedad con
 * vitrina abierta»— sobre una organización y una sociedad que quien pregunta ya
 * lleva escritas en la ruta. Ni una columna de `stores` sale de aquí.
 */
create or replace function ebim.company_object_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select ebim.storage_is_company_path(p_name)
     and exists (
       select 1
       from public.stores s
       where s.organization_id = ebim.storage_org(p_name)
         and s.company_id      = ebim.storage_company(p_name)
         and s.status = 'active'
     );
$fn$;

revoke execute on function
  ebim.storage_is_company_path(text), ebim.storage_company(text),
  ebim.can_write_company_object(text), ebim.company_object_visible(text)
from public;

grant execute on function ebim.storage_is_company_path(text), ebim.storage_company(text)
  to anon, authenticated, service_role;
grant execute on function ebim.company_object_visible(text)
  to anon, authenticated, service_role;
grant execute on function ebim.can_write_company_object(text)
  to authenticated, service_role;

comment on function ebim.can_write_company_object(text) is
  'Autorizacion de escritura en Storage para un asset de SOCIEDAD, derivada de la ruta {organization_id}/company/{company_id}/ y del rol.';
comment on function ebim.company_object_visible(text) is
  'Booleano: la ruta cae en una sociedad con al menos una tienda ACTIVA. Definer porque anon no lee public.stores; la condicion de visibilidad va escrita en el cuerpo.';

-- Las policies. Se añaden JUNTO a las de tienda, no en su lugar: el mismo
-- bucket sirve a las dos familias de rutas y cada una autoriza la suya.
-- `storage.objects` ya trae RLS activada y forzada.
create policy ebim_objects_select_company_member on storage.objects
  for select to authenticated
  using (bucket_id = 'store-assets' and ebim.can_write_company_object(name));

create policy ebim_objects_insert_company_catalog on storage.objects
  for insert to authenticated
  with check (bucket_id = 'store-assets' and ebim.can_write_company_object(name));

create policy ebim_objects_update_company_catalog on storage.objects
  for update to authenticated
  using      (bucket_id = 'store-assets' and ebim.can_write_company_object(name))
  with check (bucket_id = 'store-assets' and ebim.can_write_company_object(name));

create policy ebim_objects_delete_company_catalog on storage.objects
  for delete to authenticated
  using (bucket_id = 'store-assets' and ebim.can_write_company_object(name));

-- Lectura anónima: el logo de una marca es publicable por definición —se pinta
-- en la portada— pero solo si la sociedad tiene vitrina activa.
create policy ebim_objects_select_public_company_asset on storage.objects
  for select to anon
  using (bucket_id = 'store-assets' and ebim.company_object_visible(storage.objects.name));

-- ---------------------------------------------------------------------------
-- 3 · public_brands — las marcas de una tienda, con su logo, de una vez.
--
-- ## Por qué hace falta si las marcas ya llegaban
--
-- Llegaban por las FACETAS de `catalog_search_for_slug`, que devuelven código,
-- nombre y cuenta. Es lo correcto para un filtro —las facetas se calculan sobre
-- el resultado ya filtrado— y es inservible para un logo: al elegir una marca,
-- las facetas devuelven una sola.
--
-- La alternativa era pedir el logo marca a marca, y eso es exactamente el N+1
-- que el encargo prohíbe: una portada con cuarenta marcas serían cuarenta
-- peticiones. Esta vista devuelve las marcas de la tienda en UNA consulta, y la
-- vitrina la cruza con las facetas por `code`.
--
-- ## Por qué una vista y no una función
--
-- Porque no hace falta ningún privilegio que `anon` no tenga ya. `store_products`,
-- `products` y `brands` tienen policies `to anon` y GRANT por columna desde el
-- producto maestro; `security_invoker = on` deja que esas tres decidan. Una
-- función SECURITY DEFINER aquí sería elevar permisos para leer algo que ya se
-- puede leer.
--
-- ## Lo que la vista NO trae
--
-- Ni `organization_id`, ni `company_id`, ni `description`, ni la cuenta de
-- productos. El tenant no se publica nunca (el comprador anónimo no tiene por
-- qué saber de qué cuenta del hub es la tienda) y la cuenta ya la dan las
-- facetas — dos fuentes para el mismo número acaban discrepando.
-- ---------------------------------------------------------------------------
create view public.public_brands
with (security_invoker = on) as
select distinct
  sp.store_id,
  b.id       as brand_id,
  b.code,
  b.name,
  b.logo_url
from public.store_products sp
join public.products p on p.id = sp.product_id
join public.brands   b on b.id = p.brand_id
where sp.status = 'published'
  and sp.published_at is not null
  and sp.published_at <= now()
  and b.is_active;

revoke all on public.public_brands from public;
grant select on public.public_brands to anon, authenticated, service_role;

comment on view public.public_brands is
  'Marcas con producto publicado por tienda, con su logo. security_invoker: las policies de store_products, products y brands siguen mandando. Sin tenant y sin contadores.';
