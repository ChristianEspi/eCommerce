-- =============================================================================
-- Stores + Product Master · Fase 04 — comandos del backoffice (ADR 018)
--
-- La fase 03 dejó la forma: `products` es el maestro de la sociedad y
-- `store_products` su publicación en cada tienda. Esta migración da al
-- backoffice la frontera para administrarla sin escribir tablas a mano:
--
-- - `admin_product_masters`: el listado de maestros de la sociedad ACTIVA, una
--   fila por producto aunque esté en varias tiendas, con el resumen de
--   publicaciones. Sin precio: el precio es de cada publicación.
-- - `product_store_publications`: todas las tiendas de la sociedad y el estado
--   del producto en cada una (publicada o no).
-- - `publish_product` / `update_product_publication` / `unpublish_product`:
--   asociar, editar y quitar la publicación de UNA tienda sin tocar el maestro
--   ni las demás tiendas.
-- - `delete_product_master`: el borrado definitivo, que el servidor niega si
--   el producto sigue publicado, tiene historia de pedidos o es componente de un
--   kit.
-- - `product_deletion_usage` suma las publicaciones al conteo de uso.
--
-- Todo SECURITY INVOKER: la RLS de `products` y `store_products` sigue siendo
-- la autoridad. El tenant sale de `ebim.org_id()` y `ebim.active_company()`;
-- ninguna función acepta organización ni sociedad como parámetro.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Guardas
-- ---------------------------------------------------------------------------

-- Quien edita el catálogo de la sociedad activa: owner, admin o catalog. Es la
-- misma regla que las policies de escritura, dicha antes para devolver un código
-- estable en vez de un «0 filas» mudo.
create or replace function ebim.assert_catalog_editor()
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: editar el catalogo exige sesion' using errcode = '42501';
  end if;
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el operador de la suite no edita el catalogo de un tenant'
      using errcode = '42501';
  end if;
  if ebim.org_id() is null or ebim.active_company() is null then
    raise exception 'SIN_CONTEXTO: no hay sociedad activa' using errcode = '42501';
  end if;
  if not ebim.has_role(ebim.org_id(), ebim.active_company(),
                       array['owner', 'admin', 'catalog']::public.app_role[]) then
    raise exception 'SIN_PERMISO: el catalogo lo editan owner, admin o catalog' using errcode = '42501';
  end if;
end;
$fn$;

-- El maestro, visto con la RLS de quien llama y solo si es de la sociedad activa.
create or replace function ebim.catalog_master(p_product_id uuid)
returns public.products
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_product public.products%rowtype;
begin
  select * into v_product from public.products p where p.id = p_product_id;
  if not found then
    raise exception 'PRODUCTO_NO_ENCONTRADO: el producto no existe para este tenant' using errcode = '22023';
  end if;
  if v_product.organization_id is distinct from ebim.org_id()
     or v_product.company_id is distinct from ebim.active_company() then
    raise exception 'PRODUCTO_FUERA_DE_SOCIEDAD_ACTIVA: cambia a la sociedad del producto'
      using errcode = '42501';
  end if;
  return v_product;
end;
$fn$;

-- La tienda donde se publica: de la cuenta y de la sociedad ACTIVA. Una tienda de
-- otra sociedad no recibe el maestro aunque la FK compuesta también lo impida:
-- aquí se dice con un código que la pantalla sabe leer.
create or replace function ebim.catalog_store(p_store_id uuid)
returns public.stores
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'TIENDA_NO_ENCONTRADA: la tienda no existe o no es de tu cuenta' using errcode = '22023';
  end if;
  if v_store.organization_id is distinct from ebim.org_id()
     or v_store.company_id is distinct from ebim.active_company() then
    raise exception 'TIENDA_FUERA_DE_SOCIEDAD_ACTIVA: la tienda es de otra sociedad' using errcode = '42501';
  end if;
  return v_store;
end;
$fn$;

create or replace function ebim.publication_slug_or_fail(p_slug text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if v_slug !~ '^[a-z0-9][a-z0-9-]{0,120}$' then
    raise exception 'SLUG_INVALIDO: minusculas, numeros y guiones' using errcode = '22023';
  end if;
  return v_slug;
end;
$fn$;

create or replace function ebim.publication_price_or_fail(p_price numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_price is null or p_price < 0 or p_price >= 1e12 or p_price <> round(p_price, 2) then
    raise exception 'PRECIO_INVALIDO: importe positivo con hasta 2 decimales' using errcode = '22023';
  end if;
  return p_price;
end;
$fn$;

create or replace function ebim.publication_category_or_fail(p_store_id uuid, p_category_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_category_id is null then
    return null;
  end if;
  if not exists (
    select 1 from public.categories c where c.id = p_category_id and c.store_id = p_store_id
  ) then
    raise exception 'CATEGORIA_FUERA_DE_TIENDA: la categoria no es de esta tienda' using errcode = '22023';
  end if;
  return p_category_id;
end;
$fn$;

create or replace function ebim.raise_publication_conflict(p_constraint text)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_constraint = 'store_products_slug_key' then
    raise exception 'SLUG_DUPLICADO: la tienda ya tiene un producto con ese slug' using errcode = '23505';
  end if;
  raise exception 'PUBLICACION_DUPLICADA: el producto ya esta en esta tienda' using errcode = '23505';
end;
$fn$;

-- Lo que la pantalla necesita de una publicación. Importes como texto: el float
-- del navegador no toca dinero.
create or replace function ebim.publication_summary(p_row public.store_products)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'id', p_row.id,
    'store_id', p_row.store_id,
    'product_id', p_row.product_id,
    'category_id', p_row.category_id,
    'slug', p_row.slug,
    'status', p_row.status,
    'published_at', p_row.published_at,
    'price', p_row.price::text,
    'compare_at_price', p_row.compare_at_price::text,
    'currency', p_row.currency,
    'updated_at', p_row.updated_at
  );
$fn$;

-- Transición (hasta la contracción de la fase 05): un maestro creado SIN tienda
-- adopta como tienda de origen la primera donde se publica. Así los lectores de
-- comercio que aún leen `products.store_id` lo encuentran en esa tienda, igual
-- que a un producto legacy. Solo actúa si el maestro no tiene origen.
create or replace function ebim.adopt_origin_store(p_product_id uuid, p_store_id uuid)
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  update public.products p
     set store_id         = sp.store_id,
         category_id      = sp.category_id,
         slug             = sp.slug,
         status           = sp.status,
         published_at     = sp.published_at,
         price            = sp.price,
         compare_at_price = sp.compare_at_price,
         currency         = sp.currency
    from public.store_products sp
   where p.id = p_product_id
     and p.store_id is null
     and sp.product_id = p.id
     and sp.store_id = p_store_id
     -- Un legacy quitado de esa tienda conserva su slug en `products`: adoptar el
     -- mismo slug chocaría con su clave única. En ese caso no se adopta; la
     -- publicación ya es la verdad y la vitrina lee de ella.
     and not exists (
       select 1 from public.products o
       where o.store_id = sp.store_id and o.slug = sp.slug and o.id <> p.id
     );

  if not found then
    return;
  end if;

  -- Lo que se cargó en el PIM antes de la primera publicación quedó sin ancla:
  -- se re-ancla ahora (el trigger de ancla pone la tienda de origen).
  update public.product_variants v set store_id = p_store_id where v.product_id = p_product_id and v.store_id is null;
  update public.variant_attribute_values a set store_id = p_store_id
   where a.store_id is null
     and a.variant_id in (select v.id from public.product_variants v where v.product_id = p_product_id);
  update public.product_attribute_values a set store_id = p_store_id where a.product_id = p_product_id and a.store_id is null;
  update public.product_uoms u set store_id = p_store_id where u.product_id = p_product_id and u.store_id is null;
  update public.product_images i set store_id = p_store_id where i.product_id = p_product_id and i.store_id is null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 1b · El PIM se ancla a la tienda de ORIGEN del maestro
--
-- Variantes, presentaciones, ficha, kits, relaciones e imágenes son del maestro
-- (ADR 018, decisión 10). Su `store_id` sobrevive solo como ancla de
-- transición y todavía lo leen las claves ajenas legacy `(product_id, store_id)
-- → products (id, store_id)` y los lectores de comercio que la fase 05 migra.
--
-- El backoffice edita el maestro desde CUALQUIER tienda activa, así que el
-- `store_id` que manda el cliente no puede decidir nada: este trigger lo
-- reemplaza por la tienda de origen del producto. Sin origen (maestro aún no
-- publicado) queda NULL, que las FK legacy (MATCH SIMPLE) no comprueban; las FK
-- `*_master_fk` de la fase 03 siguen garantizando organización y sociedad.
-- En kits y relaciones entre maestros de orígenes distintos también queda NULL:
-- la FK legacy exigiría que ambos compartan tienda, que ya no es verdad.
-- ---------------------------------------------------------------------------
create or replace function ebim.anchor_pim_origin_store()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_origin uuid;
  v_other  uuid;
begin
  if tg_table_name = 'variant_attribute_values' then
    select v.store_id into v_origin from public.product_variants v where v.id = new.variant_id;
  elsif tg_table_name = 'bundle_items' then
    select p.store_id into v_origin from public.products p where p.id = new.bundle_product_id;
    select p.store_id into v_other from public.products p where p.id = new.component_product_id;
    if v_other is distinct from v_origin then
      v_origin := null;
    elsif new.component_variant_id is not null then
      select v.store_id into v_other from public.product_variants v where v.id = new.component_variant_id;
      if v_other is distinct from v_origin then
        v_origin := null;
      end if;
    end if;
  elsif tg_table_name = 'product_relations' then
    select p.store_id into v_origin from public.products p where p.id = new.product_id;
    select p.store_id into v_other from public.products p where p.id = new.related_product_id;
    if v_other is distinct from v_origin then
      v_origin := null;
    end if;
  else
    select p.store_id into v_origin from public.products p where p.id = new.product_id;
  end if;

  new.store_id := v_origin;
  return new;
end;
$fn$;

revoke all on function ebim.anchor_pim_origin_store() from public, anon, authenticated;

create trigger product_images_anchor_origin
  before insert or update of store_id, product_id on public.product_images
  for each row execute function ebim.anchor_pim_origin_store();
create trigger product_variants_anchor_origin
  before insert or update of store_id, product_id on public.product_variants
  for each row execute function ebim.anchor_pim_origin_store();
create trigger product_attribute_values_anchor_origin
  before insert or update of store_id, product_id on public.product_attribute_values
  for each row execute function ebim.anchor_pim_origin_store();
create trigger product_uoms_anchor_origin
  before insert or update of store_id, product_id on public.product_uoms
  for each row execute function ebim.anchor_pim_origin_store();
create trigger variant_attribute_values_anchor_origin
  before insert or update of store_id, variant_id on public.variant_attribute_values
  for each row execute function ebim.anchor_pim_origin_store();
create trigger bundle_items_anchor_origin
  before insert or update of store_id, bundle_product_id, component_product_id, component_variant_id
  on public.bundle_items
  for each row execute function ebim.anchor_pim_origin_store();
create trigger product_relations_anchor_origin
  before insert or update of store_id, product_id, related_product_id on public.product_relations
  for each row execute function ebim.anchor_pim_origin_store();

-- ---------------------------------------------------------------------------
-- 2 · Listado de maestros
-- ---------------------------------------------------------------------------
create or replace view public.admin_product_masters
with (security_invoker = on) as
select
  p.id,
  p.organization_id,
  p.company_id,
  p.store_id as origin_store_id,
  p.sku,
  p.name,
  p.description,
  p.kind,
  p.brand_id,
  b.name as brand_name,
  p.family_id,
  f.name as family_name,
  p.tax_category_id,
  p.stock,
  p.legacy_sku_conflict,
  p.created_at,
  p.updated_at,
  coalesce(pub.publication_count, 0)::integer as publication_count,
  coalesce(pub.published_count, 0)::integer   as published_count,
  coalesce(pub.store_ids, '{}'::uuid[])       as store_ids,
  coalesce(pub.published_store_names, '{}'::text[]) as published_store_names,
  coalesce(pub.category_ids, '{}'::uuid[])    as category_ids,
  -- Estado AGREGADO, no un estado global inventado: «publicado» si se vende en
  -- al menos una tienda, «archivado» si todas sus publicaciones lo están, y
  -- «borrador» en cualquier otro caso (incluido no estar en ninguna tienda).
  case
    when coalesce(pub.published_count, 0) > 0 then 'published'
    when coalesce(pub.publication_count, 0) > 0
         and pub.archived_count = pub.publication_count then 'archived'
    else 'draft'
  end::public.product_status as publication_state
from public.products p
left join public.brands b on b.id = p.brand_id
left join public.product_families f on f.id = p.family_id
left join lateral (
  select
    count(*)                                          as publication_count,
    count(*) filter (where sp.status = 'published')   as published_count,
    count(*) filter (where sp.status = 'archived')    as archived_count,
    array_agg(sp.store_id order by s.name)            as store_ids,
    array_agg(s.name order by s.name) filter (where sp.status = 'published') as published_store_names,
    array_agg(distinct sp.category_id) filter (where sp.category_id is not null) as category_ids
  from public.store_products sp
  join public.stores s on s.id = sp.store_id
  where sp.product_id = p.id
) pub on true
-- La sociedad ACTIVA del token: el backoffice trabaja en una sociedad a la vez,
-- y quien pertenece a dos no ve mezclados sus catálogos.
where p.organization_id = ebim.org_id()
  and p.company_id = ebim.active_company();

comment on view public.admin_product_masters is
  'Backoffice: un producto maestro por fila (sociedad activa) con el resumen de sus publicaciones por tienda. Sin precio: el precio es de cada publicacion. security_invoker.';

revoke all on public.admin_product_masters from public, anon;
grant select on public.admin_product_masters to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3 · Estado del producto en cada tienda de la sociedad
-- ---------------------------------------------------------------------------
create or replace function public.product_store_publications(p_product_id uuid)
returns table (
  store_id          uuid,
  store_name        text,
  store_slug        text,
  store_status      text,
  store_currency    text,
  is_origin         boolean,
  publication_id    uuid,
  category_id       uuid,
  category_name     text,
  slug              text,
  status            public.product_status,
  published_at      timestamptz,
  price             text,
  compare_at_price  text,
  currency          text,
  updated_at        timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_product public.products%rowtype;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: consultar el catalogo exige sesion' using errcode = '42501';
  end if;
  v_product := ebim.catalog_master(p_product_id);

  return query
  select s.id, s.name, s.slug, s.status::text, s.currency::text,
         s.id = v_product.store_id,
         sp.id, sp.category_id, c.name, sp.slug, sp.status, sp.published_at,
         sp.price::text, sp.compare_at_price::text, sp.currency::text, sp.updated_at
  from public.stores s
  left join public.store_products sp on sp.store_id = s.id and sp.product_id = v_product.id
  left join public.categories c on c.id = sp.category_id
  where s.organization_id = v_product.organization_id
    and s.company_id = v_product.company_id
  order by s.name, s.id;
end;
$fn$;

comment on function public.product_store_publications(uuid) is
  'Todas las tiendas de la sociedad activa y la publicacion del producto en cada una (NULL = no publicado ahi). Bajo RLS.';

-- ---------------------------------------------------------------------------
-- 4 · Publicar en una tienda
-- ---------------------------------------------------------------------------
create or replace function public.publish_product(
  p_product_id       uuid,
  p_store_id         uuid,
  p_slug             text,
  p_price            numeric,
  p_category_id      uuid default null,
  p_status           public.product_status default 'draft',
  p_compare_at_price numeric default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_product    public.products%rowtype;
  v_store      public.stores%rowtype;
  v_row        public.store_products%rowtype;
  v_status     public.product_status := coalesce(p_status, 'draft');
  v_constraint text;
begin
  perform ebim.assert_catalog_editor();
  v_product := ebim.catalog_master(p_product_id);
  v_store := ebim.catalog_store(p_store_id);

  if exists (
    select 1 from public.store_products sp where sp.product_id = v_product.id and sp.store_id = v_store.id
  ) then
    raise exception 'PUBLICACION_DUPLICADA: el producto ya esta en esta tienda' using errcode = '23505';
  end if;

  begin
    insert into public.store_products
      (organization_id, company_id, store_id, product_id, category_id, slug, status, published_at,
       price, compare_at_price, currency)
    values
      (v_store.organization_id, v_store.company_id, v_store.id, v_product.id,
       ebim.publication_category_or_fail(v_store.id, p_category_id),
       ebim.publication_slug_or_fail(p_slug),
       v_status,
       case when v_status = 'published' then now() end,
       ebim.publication_price_or_fail(p_price),
       case when p_compare_at_price is null then null else ebim.publication_price_or_fail(p_compare_at_price) end,
       -- La moneda es la de la tienda: un importe sin su moneda no es un precio.
       v_store.currency)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform ebim.raise_publication_conflict(v_constraint);
  end;

  perform ebim.adopt_origin_store(v_product.id, v_store.id);
  return ebim.publication_summary(v_row);
end;
$fn$;

comment on function public.publish_product(uuid, uuid, text, numeric, uuid, public.product_status, numeric) is
  'Publica un producto maestro de la sociedad activa en una de sus tiendas: slug, categoria de ESA tienda, estado y precio en la moneda de la tienda. No copia variantes ni imagenes.';

-- ---------------------------------------------------------------------------
-- 5 · Editar la publicación de una tienda
-- ---------------------------------------------------------------------------
create or replace function public.update_product_publication(
  p_product_id             uuid,
  p_store_id               uuid,
  p_slug                   text default null,
  p_category_id            uuid default null,
  p_clear_category         boolean default false,
  p_status                 public.product_status default null,
  p_price                  numeric default null,
  p_compare_at_price       numeric default null,
  p_clear_compare_at_price boolean default false
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_product    public.products%rowtype;
  v_store      public.stores%rowtype;
  v_row        public.store_products%rowtype;
  v_status     public.product_status;
  v_constraint text;
begin
  perform ebim.assert_catalog_editor();
  v_product := ebim.catalog_master(p_product_id);
  v_store := ebim.catalog_store(p_store_id);

  select * into v_row from public.store_products sp
  where sp.product_id = v_product.id and sp.store_id = v_store.id;
  if not found then
    raise exception 'PUBLICACION_NO_ENCONTRADA: el producto no esta en esta tienda' using errcode = '22023';
  end if;

  if p_slug is null and p_category_id is null and not coalesce(p_clear_category, false)
     and p_status is null and p_price is null and p_compare_at_price is null
     and not coalesce(p_clear_compare_at_price, false) then
    raise exception 'SIN_CAMBIOS: no se envio ningun campo de la publicacion' using errcode = '22023';
  end if;

  v_status := coalesce(p_status, v_row.status);

  begin
    update public.store_products sp
       set slug             = case when p_slug is null then sp.slug
                                   else ebim.publication_slug_or_fail(p_slug) end,
           category_id      = case
                                when coalesce(p_clear_category, false) then null
                                when p_category_id is not null
                                  then ebim.publication_category_or_fail(sp.store_id, p_category_id)
                                else sp.category_id
                              end,
           status           = v_status,
           -- `published` sin fecha viola el CHECK; volver a publicar conserva la
           -- fecha original, y salir de publicado la borra.
           published_at     = case
                                when v_status = 'published' then coalesce(sp.published_at, now())
                                else null
                              end,
           price            = case when p_price is null then sp.price
                                   else ebim.publication_price_or_fail(p_price) end,
           compare_at_price = case
                                when coalesce(p_clear_compare_at_price, false) then null
                                when p_compare_at_price is not null
                                  then ebim.publication_price_or_fail(p_compare_at_price)
                                else sp.compare_at_price
                              end
     where sp.id = v_row.id
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform ebim.raise_publication_conflict(v_constraint);
  end;

  return ebim.publication_summary(v_row);
end;
$fn$;

comment on function public.update_product_publication(uuid, uuid, text, uuid, boolean, public.product_status, numeric, numeric, boolean) is
  'Edita la publicacion de UNA tienda (slug, categoria, estado, precio). NULL no toca; p_clear_* vacia. No toca el maestro ni las otras tiendas.';

-- ---------------------------------------------------------------------------
-- 6 · Quitar de una tienda (el maestro se conserva)
-- ---------------------------------------------------------------------------
create or replace function public.unpublish_product(p_product_id uuid, p_store_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_product public.products%rowtype;
  v_store   public.stores%rowtype;
begin
  perform ebim.assert_catalog_editor();
  v_product := ebim.catalog_master(p_product_id);
  v_store := ebim.catalog_store(p_store_id);

  delete from public.store_products sp
  where sp.product_id = v_product.id and sp.store_id = v_store.id;
  if not found then
    raise exception 'PUBLICACION_NO_ENCONTRADA: el producto no esta en esta tienda' using errcode = '22023';
  end if;
end;
$fn$;

comment on function public.unpublish_product(uuid, uuid) is
  'Quita el producto de UNA tienda borrando su publicacion. El maestro, sus variantes, imagenes y las publicaciones de las demas tiendas no cambian.';

-- ---------------------------------------------------------------------------
-- 7 · Uso real y borrado protegido del maestro
-- ---------------------------------------------------------------------------
create or replace function public.product_deletion_usage(p_product_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_name text;
begin
  select p.name into v_name from public.products p where p.id = p_product_id;
  if v_name is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: El producto no existe para este tenant';
  end if;

  return jsonb_build_object(
    'name', v_name,
    'order_lines', (
      select count(*) from public.order_items oi where oi.product_id = p_product_id
    ),
    'images', (
      select count(*) from public.product_images pi where pi.product_id = p_product_id
    ),
    'variants', (
      select count(*) from public.product_variants pv where pv.product_id = p_product_id
    ),
    'bundles', (
      select count(distinct bi.bundle_product_id)
      from public.bundle_items bi
      where bi.component_product_id = p_product_id
    ),
    -- Tiendas donde sigue publicado (ADR 018). Mientras sea mayor que cero el
    -- borrado lo niega `delete_product_master`: primero se quita de las tiendas.
    'publications', (
      select count(*) from public.store_products sp where sp.product_id = p_product_id
    )
  );
end;
$fn$;

comment on function public.product_deletion_usage(uuid) is
  'Conteo de uso real antes de borrar (contrato 4.2): lineas, imagenes, variantes, kits y publicaciones por tienda. Cuenta bajo la RLS de quien pregunta.';

create or replace function public.delete_product_master(p_product_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_product public.products%rowtype;
begin
  perform ebim.assert_catalog_editor();
  v_product := ebim.catalog_master(p_product_id);

  if exists (select 1 from public.store_products sp where sp.product_id = v_product.id) then
    raise exception 'PRODUCTO_PUBLICADO: quitalo de todas las tiendas antes de borrarlo' using errcode = '23503';
  end if;
  if exists (select 1 from public.order_items oi where oi.product_id = v_product.id) then
    raise exception 'PRODUCTO_CON_HISTORIA: tiene pedidos; archivalo en sus tiendas en vez de borrarlo'
      using errcode = '23503';
  end if;
  if exists (select 1 from public.bundle_items bi where bi.component_product_id = v_product.id) then
    raise exception 'PRODUCTO_EN_KIT: es componente de un kit' using errcode = '23503';
  end if;

  delete from public.products p where p.id = v_product.id;
  if not found then
    raise exception 'SIN_PERMISO: el catalogo lo editan owner, admin o catalog' using errcode = '42501';
  end if;
end;
$fn$;

comment on function public.delete_product_master(uuid) is
  'Borrado definitivo del maestro de la sociedad activa. Lo niega si sigue publicado en alguna tienda, tiene pedidos o es componente de un kit.';

-- ---------------------------------------------------------------------------
-- 8 · Permisos
-- ---------------------------------------------------------------------------
revoke all on function ebim.assert_catalog_editor() from public, anon;
revoke all on function ebim.catalog_master(uuid) from public, anon;
revoke all on function ebim.catalog_store(uuid) from public, anon;
revoke all on function ebim.publication_slug_or_fail(text) from public, anon;
revoke all on function ebim.publication_price_or_fail(numeric) from public, anon;
revoke all on function ebim.publication_category_or_fail(uuid, uuid) from public, anon;
revoke all on function ebim.raise_publication_conflict(text) from public, anon;
revoke all on function ebim.publication_summary(public.store_products) from public, anon;
revoke all on function ebim.adopt_origin_store(uuid, uuid) from public, anon;
grant execute on function ebim.assert_catalog_editor() to authenticated, service_role;
grant execute on function ebim.catalog_master(uuid) to authenticated, service_role;
grant execute on function ebim.catalog_store(uuid) to authenticated, service_role;
grant execute on function ebim.publication_slug_or_fail(text) to authenticated, service_role;
grant execute on function ebim.publication_price_or_fail(numeric) to authenticated, service_role;
grant execute on function ebim.publication_category_or_fail(uuid, uuid) to authenticated, service_role;
grant execute on function ebim.raise_publication_conflict(text) to authenticated, service_role;
grant execute on function ebim.publication_summary(public.store_products) to authenticated, service_role;
grant execute on function ebim.adopt_origin_store(uuid, uuid) to authenticated, service_role;

revoke all on function public.product_store_publications(uuid) from public, anon;
revoke all on function public.publish_product(uuid, uuid, text, numeric, uuid, public.product_status, numeric) from public, anon;
revoke all on function public.update_product_publication(uuid, uuid, text, uuid, boolean, public.product_status, numeric, numeric, boolean) from public, anon;
revoke all on function public.unpublish_product(uuid, uuid) from public, anon;
revoke all on function public.delete_product_master(uuid) from public, anon;
grant execute on function public.product_store_publications(uuid) to authenticated, service_role;
grant execute on function public.publish_product(uuid, uuid, text, numeric, uuid, public.product_status, numeric) to authenticated, service_role;
grant execute on function public.update_product_publication(uuid, uuid, text, uuid, boolean, public.product_status, numeric, numeric, boolean) to authenticated, service_role;
grant execute on function public.unpublish_product(uuid, uuid) to authenticated, service_role;
grant execute on function public.delete_product_master(uuid) to authenticated, service_role;
