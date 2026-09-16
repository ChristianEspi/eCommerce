-- =============================================================================
-- Stores + Product Master · Fase 05 paso D — contracción (ADR 018)
--
-- Los consumidores de comercio ya leen la publicación (pasos A, B y C). Esta
-- migración retira lo que mantenía a `products` como «producto de una tienda»:
--
-- 1. La sincronía INVERSA publicación → columnas legacy desaparece. Las columnas
--    de publicación de `products` (slug, category_id, status, published_at,
--    price, compare_at_price, currency) quedan en NULL: nadie puede leer un dato
--    viejo creyendo que es el vigente.
-- 2. Esas columnas siguen existiendo como FACHADA DE ESCRITURA: una escritura
--    legacy (fixtures, seed, importación, clientes antiguos de la Edge Function)
--    crea o actualiza la publicación de la tienda de origen y la columna vuelve
--    a NULL. Limitación documentada: por la fachada no se puede VACIAR un campo
--    (NULL significa «no tocar»); para eso están los comandos de publicación.
-- 3. `search_vector` deja de indexar el slug (que es de cada tienda).
-- 4. `admin_products` conserva sus columnas leyendo la publicación de origen.
-- 5. Se retiran las claves por tienda que ya no tienen destino: FKs legacy del
--    PIM `(x, store_id)` (las `*_master_fk` de la fase 03 garantizan el tenant),
--    `products_store_key`, `product_variants_store_key`, el SKU/slug por tienda
--    y los índices por tienda del maestro.
-- 6. Borrar una tienda ya no borra maestros ni su PIM: `on delete set null`.
-- 7. Se retiran `ebim.product_is_available(uuid, uuid, numeric)` y
--    `ebim.bundle_is_available(uuid)`, sustituidas por las versiones por tienda.
--
-- DEUDA EXPLÍCITA (no se contrae aquí, ver plan §14): el precio propio de
-- variante y presentación mantiene la sincronía con la tienda de origen
-- (`product_variants.price`, `product_uoms.price` ↔ `store_price_overrides`),
-- porque los paneles del PIM y la importación lo escriben por ahí. Ningún lector
-- de comercio usa esas columnas: `resolve_prices` lee `store_price_overrides`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0 · Verificación: toda fila legacy con datos de publicación tiene publicación
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_missing bigint;
begin
  select count(*) into v_missing
  from public.products p
  where p.store_id is not null
    and p.slug is not null
    and not exists (
      select 1 from public.store_products sp
      where sp.product_id = p.id and sp.store_id = p.store_id);
  if v_missing > 0 then
    raise exception 'CONTRACCION_INCONSISTENTE: % productos con datos de publicacion sin publicacion', v_missing;
  end if;
end;
$verify$;

-- ---------------------------------------------------------------------------
-- 1 · Fin de la sincronía inversa
-- ---------------------------------------------------------------------------
drop trigger store_products_sync_origin on public.store_products;
drop function ebim.sync_products_from_origin();

-- ---------------------------------------------------------------------------
-- 2 · La fachada de escritura
-- ---------------------------------------------------------------------------
alter table public.products alter column status drop default;
alter table public.products alter column status drop not null;
alter table public.products alter column currency drop default;
alter table public.products alter column currency drop not null;
alter table public.products drop constraint products_category_fk;
-- «Publicado exige fecha» es regla de la PUBLICACIÓN (store_products la tiene).
-- En la fachada, `set status = 'published'` sin fecha es legítimo: la fecha la
-- pone la publicación.
alter table public.products drop constraint products_published_needs_date;

create or replace function ebim.sync_origin_publication()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_sp       public.store_products%rowtype;
  v_currency text;
  v_status   public.product_status;
begin
  -- Solo reacciona a la escritura directa; el NULL de abajo no vuelve a entrar.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if new.slug is null and new.category_id is null and new.status is null
     and new.published_at is null and new.price is null
     and new.compare_at_price is null and new.currency is null then
    return null;
  end if;

  if new.store_id is not null then
    select * into v_sp
    from public.store_products sp
    where sp.product_id = new.id and sp.store_id = new.store_id;

    if found then
      v_status := coalesce(new.status, v_sp.status);
      update public.store_products sp
         set slug             = coalesce(new.slug, sp.slug),
             category_id      = coalesce(new.category_id, sp.category_id),
             status           = v_status,
             published_at     = case
                                  when v_status = 'published'
                                    then coalesce(new.published_at, sp.published_at, now())
                                  when new.status is not null then new.published_at
                                  else coalesce(new.published_at, sp.published_at)
                                end,
             price            = coalesce(new.price, sp.price),
             compare_at_price = coalesce(new.compare_at_price, sp.compare_at_price),
             currency         = coalesce(new.currency, sp.currency)
       where sp.id = v_sp.id;
    elsif new.slug is not null and new.price is not null then
      select s.currency into v_currency from public.stores s where s.id = new.store_id;
      v_status := coalesce(new.status, 'draft');
      insert into public.store_products
        (organization_id, company_id, store_id, product_id, category_id, slug, status,
         published_at, price, compare_at_price, currency)
      values
        (new.organization_id, new.company_id, new.store_id, new.id, new.category_id, new.slug, v_status,
         case when v_status = 'published' then coalesce(new.published_at, now()) else new.published_at end,
         new.price, new.compare_at_price, coalesce(new.currency, v_currency));
    end if;
  end if;

  -- La columna legacy nunca guarda un valor: la verdad es la publicación.
  update public.products p
     set slug = null, category_id = null, status = null, published_at = null,
         price = null, compare_at_price = null, currency = null
   where p.id = new.id;
  return null;
end;
$fn$;

revoke all on function ebim.sync_origin_publication() from public, anon, authenticated;

-- Maestro sin tienda de origen que se publica por primera vez: adopta la tienda
-- (ancla informativa) y re-ancla su PIM. Ya no copia columnas de publicación.
create or replace function ebim.adopt_origin_store(p_product_id uuid, p_store_id uuid)
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  update public.products p
     set store_id = p_store_id
   where p.id = p_product_id
     and p.store_id is null;

  if not found then
    return;
  end if;

  update public.product_variants v set store_id = p_store_id where v.product_id = p_product_id and v.store_id is null;
  update public.variant_attribute_values a set store_id = p_store_id
   where a.store_id is null
     and a.variant_id in (select v.id from public.product_variants v where v.product_id = p_product_id);
  update public.product_attribute_values a set store_id = p_store_id where a.product_id = p_product_id and a.store_id is null;
  update public.product_uoms u set store_id = p_store_id where u.product_id = p_product_id and u.store_id is null;
  update public.product_images i set store_id = p_store_id where i.product_id = p_product_id and i.store_id is null;
end;
$fn$;

-- Los datos legacy ya viven en la publicación (verificado arriba): se vacían.
-- La fachada ignora esta escritura porque solo pone NULL.
update public.products
   set slug = null, category_id = null, status = null, published_at = null,
       price = null, compare_at_price = null, currency = null
 where slug is not null or category_id is not null or status is not null
    or published_at is not null or price is not null or compare_at_price is not null
    or currency is not null;

comment on column public.products.slug is
  'FACHADA DE ESCRITURA (ADR 018): siempre NULL. Escribir aquí actualiza la publicación de la tienda de origen. Leer: store_products.slug.';
comment on column public.products.price is
  'FACHADA DE ESCRITURA (ADR 018): siempre NULL. Escribir aquí actualiza la publicación de la tienda de origen. Leer: store_products.price o ebim.resolve_prices.';
comment on column public.products.status is
  'FACHADA DE ESCRITURA (ADR 018): siempre NULL. Estado por tienda en store_products.status.';
comment on column public.products.store_id is
  'Tienda de ORIGEN (ADR 018): informativa y ancla de la fachada de escritura. No indica dónde se vende: eso es store_products.';

-- ---------------------------------------------------------------------------
-- 3 · search_vector sin slug
-- ---------------------------------------------------------------------------
drop index if exists public.products_search_vector_idx;
alter table public.products drop column search_vector;
alter table public.products
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('spanish'::regconfig, ebim.search_normalize(name)), 'A')
    || setweight(to_tsvector('spanish'::regconfig, ebim.search_normalize(coalesce(description, ''))), 'C')
  ) stored;
create index products_search_vector_idx on public.products using gin (search_vector);
comment on column public.products.search_vector is
  'Indice de texto del MAESTRO: nombre (A) y descripcion (C). El slug es de cada publicacion y no entra. GENERADA.';

-- ---------------------------------------------------------------------------
-- 4 · admin_products: misma forma, datos de la publicación de origen
-- ---------------------------------------------------------------------------
create or replace view public.admin_products
with (security_invoker = on) as
select
  p.id,
  p.organization_id,
  p.company_id,
  p.store_id,
  sp.category_id,
  p.sku,
  p.name,
  sp.slug,
  p.description,
  sp.status,
  sp.price,
  sp.compare_at_price,
  sp.currency,
  p.stock,
  sp.published_at,
  p.updated_at,
  p.kind,
  p.brand_id,
  p.family_id,
  p.tax_category_id,
  c.name as category_name,
  b.name as brand_name
from public.products p
left join public.store_products sp on sp.product_id = p.id and sp.store_id = p.store_id
left join public.categories c on c.id = sp.category_id
left join public.brands     b on b.id = p.brand_id;

comment on view public.admin_products is
  'COMPATIBILIDAD (ADR 018): forma del listado antiguo con los datos de la publicacion de ORIGEN. El backoffice usa admin_product_masters y admin_store_products.';

-- ---------------------------------------------------------------------------
-- 5 · Claves e índices por tienda
-- ---------------------------------------------------------------------------
alter table public.product_images           drop constraint product_images_product_fk;
alter table public.product_variants         drop constraint product_variants_product_fk;
alter table public.variant_attribute_values drop constraint variant_attribute_values_variant_fk;
alter table public.product_attribute_values drop constraint product_attribute_values_product_fk;
alter table public.product_uoms             drop constraint product_uoms_product_fk;
alter table public.bundle_items             drop constraint bundle_items_bundle_fk;
alter table public.bundle_items             drop constraint bundle_items_component_fk;
alter table public.bundle_items             drop constraint bundle_items_variant_fk;
alter table public.product_relations        drop constraint product_relations_product_fk;
alter table public.product_relations        drop constraint product_relations_related_fk;

do $check$
declare
  v_left text;
begin
  select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ') into v_left
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid in ('public.products'::regclass, 'public.product_variants'::regclass)
    and pg_get_constraintdef(c.oid) ~* '\(\w+, store_id\) references';
  if v_left is not null then
    raise exception 'CONTRACCION_INCONSISTENTE: quedan FKs por tienda hacia el maestro: %', v_left;
  end if;
end;
$check$;

alter table public.products         drop constraint products_store_key;
alter table public.product_variants drop constraint product_variants_store_key;

drop index if exists public.products_slug_key;
drop index if exists public.products_sku_key;
drop index if exists public.products_published_idx;
drop index if exists public.products_available_idx;
drop index if exists public.products_store_status_idx;
drop index if exists public.products_category_idx;
drop index if exists public.products_kind_idx;
drop index if exists public.product_variants_sku_key;
create index if not exists products_kind_idx on public.products (organization_id, company_id, kind);

-- ---------------------------------------------------------------------------
-- 6 · Borrar una tienda no borra maestros ni su PIM
-- ---------------------------------------------------------------------------
do $store_fks$
declare
  v_con record;
begin
  for v_con in
    select c.conrelid::regclass::text as tabla, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.stores'::regclass
      and c.confdeltype = 'c'
      and c.conrelid in (
        'public.products'::regclass, 'public.product_variants'::regclass,
        'public.variant_attribute_values'::regclass, 'public.product_attribute_values'::regclass,
        'public.product_uoms'::regclass, 'public.bundle_items'::regclass,
        'public.product_relations'::regclass, 'public.product_images'::regclass)
      and pg_get_constraintdef(c.oid) ~* '^foreign key \(store_id,'
  loop
    execute format('alter table %s drop constraint %I', v_con.tabla, v_con.conname);
    execute format('alter table %s add constraint %I %s', v_con.tabla, v_con.conname,
      regexp_replace(v_con.def, 'ON DELETE CASCADE', 'ON DELETE SET NULL (store_id)'));
  end loop;
end;
$store_fks$;

-- ---------------------------------------------------------------------------
-- 7 · Disponibilidad con la firma antigua (sin llamadores desde la fase 03)
-- ---------------------------------------------------------------------------
drop function if exists ebim.product_is_available(uuid, uuid, numeric);
drop function if exists ebim.bundle_is_available(uuid);
