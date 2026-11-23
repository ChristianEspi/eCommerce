-- =============================================================================
-- Limpieza del catálogo (2026-11-22)
-- =============================================================================
--
-- «Revisar catálogo» en Productos: duplicados, tamaños cargados como productos
-- sueltos que deberían ser variantes, productos sin foto, sin descripción o sin
-- categoría y nombres con formato raro. La DETECCIÓN es por reglas y vive en
-- TypeScript puro (`src/features/catalog/cleanup.ts`, con sus tests); aquí solo
-- se entrega lo mínimo de cada producto de UNA tienda para analizarlo.
--
-- SECURITY INVOKER: lee con la RLS de quien mira (miembro de la sociedad), y el
-- tenant sale del JWT además de la tienda pedida. Sin precios, stock ni costes.
-- No escribe: cada arreglo se hace en la ficha, como siempre.
-- =============================================================================

create or replace function public.catalog_cleanup_rows(p_store_id uuid)
returns table (
  product_id      uuid,
  sku             text,
  name            text,
  brand_name      text,
  kind            text,
  status          text,
  has_image       boolean,
  has_description boolean,
  has_category    boolean,
  has_attributes  boolean
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select p.id,
         p.sku,
         p.name,
         b.name,
         p.kind::text,
         sp.status::text,
         exists (select 1 from public.product_images i where i.product_id = p.id),
         coalesce(btrim(p.description), '') <> '',
         sp.category_id is not null,
         exists (select 1 from public.product_attribute_values v where v.product_id = p.id)
    from public.store_products sp
    join public.products p on p.id = sp.product_id
    left join public.brands b on b.id = p.brand_id
   where sp.store_id = p_store_id
     and sp.status <> 'archived'
     and p.organization_id = ebim.org_id()
     and p.company_id = ebim.active_company()
   order by p.name
   limit 5000
$fn$;

revoke execute on function public.catalog_cleanup_rows(uuid) from public, anon;
grant  execute on function public.catalog_cleanup_rows(uuid) to authenticated;

comment on function public.catalog_cleanup_rows(uuid) is
  'Limpieza del catálogo: lo mínimo de cada producto no archivado de una tienda (nombre, marca, foto, descripción, categoría) para detectar duplicados y huecos. Invoker: RLS de quien mira. Sin precios ni stock.';
