-- =============================================================================
-- El listado de productos del backoffice, con el nombre de su categoria y su
-- marca al lado.
--
-- Sintoma: en la tabla de Productos se ve la columna «Categoria», pero escribir
-- «cabello» en el buscador no devuelve nada. Lo mismo con «eucerin». El
-- buscador miraba `name`, `sku` y `slug` —las tres columnas propias— y la
-- categoria y la marca viven en otras tablas.
--
-- Por que una VISTA y no un `or=` con recursos embebidos: PostgREST sabe
-- filtrar por una tabla relacionada (`categories.name=ilike.*x*`), pero NO sabe
-- meter esa condicion dentro de un `or=` junto a columnas propias. Y «busca en
-- todo esto a la vez» es exactamente un OR. Con las dos columnas aplanadas
-- aqui, el filtro vuelve a ser el de siempre y el cliente no aprende una
-- sintaxis nueva.
--
-- `security_invoker = on`: la vista NO amplia ni un permiso. Se ejecuta con la
-- identidad de quien pregunta, asi que la RLS de `products` —y la de
-- `categories` y `brands` al unir— sigue decidiendo. Una vista sin esto seria
-- una puerta de atras al catalogo de otro tenant.
-- =============================================================================

create or replace view public.admin_products
with (security_invoker = on) as
select
  p.id,
  p.organization_id,
  p.company_id,
  p.store_id,
  p.category_id,
  p.sku,
  p.name,
  p.slug,
  p.description,
  p.status,
  p.price,
  p.compare_at_price,
  p.currency,
  p.stock,
  p.published_at,
  p.updated_at,
  p.kind,
  p.brand_id,
  p.family_id,
  p.tax_category_id,
  -- Los dos nombres, que son lo unico que esta vista anade.
  --
  -- `left join` en los dos: un producto sin categoria o sin marca sigue estando
  -- en el catalogo y tiene que salir en el listado. Con `join` a secas, dar de
  -- alta un producto y no elegirle marca lo haria desaparecer de su propia
  -- tabla, que es la forma mas rapida de que alguien crea que no se guardo.
  c.name as category_name,
  b.name as brand_name
from public.products p
left join public.categories c on c.id = p.category_id
left join public.brands     b on b.id = p.brand_id;

comment on view public.admin_products is
  'Listado de productos del backoffice con category_name y brand_name aplanados, para que el buscador general los alcance en el mismo or=. security_invoker: no amplia ni un permiso.';

-- El comprador anonimo no entra aqui: esto es el backoffice. Lo publicado se
-- lee por `public_products`, que es otra vista y otro contrato.
revoke all   on public.admin_products from public, anon;
grant  select on public.admin_products to authenticated, service_role;
