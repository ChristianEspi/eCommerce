-- =============================================================================
-- Stores + Product Master · Fase 03 (1/2) — EXPAND + MIGRATE
--
-- ADR 018 y docs/STORES_PRODUCT_MASTER_MIGRATION_PLAN.md.
--
-- ## Lo que cambia de significado
--
-- `products` deja de ser «un producto de una tienda» y pasa a ser el MAESTRO de
-- la sociedad: identidad, SKU, nombre, tipo, marca, familia y todo el PIM.
-- Lo que es de CADA tienda —dónde se ve, con qué slug, en qué categoría, en qué
-- estado y a qué precio de catálogo— pasa a `store_products`, la publicación.
-- Los precios propios de variante y de presentación, que son importes absolutos
-- en la moneda de una tienda, pasan a `store_price_overrides`.
--
-- ## Lo que NO cambia todavía
--
-- Las columnas legacy de `products` (`store_id`, `slug`, `category_id`,
-- `status`, `published_at`, `price`, `compare_at_price`, `currency`) y los
-- precios de `product_variants`/`product_uoms` siguen existiendo y siguen
-- LLENAS durante la transición: medio centenar de funciones de carrito, pedido,
-- promociones y API las leen y se migran en la fase 05. Para que ninguna lea un
-- dato viejo, la tienda de ORIGEN (`products.store_id`) se mantiene sincronizada
-- en los dos sentidos con su publicación. La publicación en cualquier OTRA
-- tienda solo existe en `store_products`.
--
-- ## Relleno
--
-- Una publicación por producto legacy, en su tienda actual, con sus mismos
-- datos y conservando `products.id`. Idempotente (`on conflict do nothing`) y
-- verificado dentro de la migración: si no cuadra, aborta.
--
-- ## SKU por sociedad
--
-- El SKU pasa a ser único por organización + sociedad, compartido entre
-- productos y variantes. No se fusiona nada: las filas que ya chocaban se marcan
-- `legacy_sku_conflict` y se conservan; el índice único ignora solo esas, y el
-- trigger rechaza cualquier fila NUEVA o SKU editado que choque con otra.
-- =============================================================================

-- ===========================================================================
-- 1 · La publicación
-- ===========================================================================
create table public.store_products (
  id               uuid          primary key default gen_random_uuid(),
  organization_id  uuid          not null,
  company_id       uuid          not null,
  store_id         uuid          not null,
  product_id       uuid          not null,
  category_id      uuid,
  slug             text          not null,
  status           public.product_status not null default 'draft',
  published_at     timestamptz,
  price            numeric(14,2) not null,
  compare_at_price numeric(14,2),
  currency         char(3)       not null,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),
  constraint store_products_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,120}$'),
  constraint store_products_price_positive check (price >= 0),
  constraint store_products_compare_positive check (compare_at_price is null or compare_at_price >= 0),
  constraint store_products_currency_fmt check (currency ~ '^[A-Z]{3}$'),
  constraint store_products_published_needs_date
    check (status <> 'published' or published_at is not null),
  -- Las dos FKs compuestas con organización y sociedad son la garantía de que
  -- una tienda no publica el maestro de otra sociedad: tienda y producto tienen
  -- que compartir la MISMA pareja.
  constraint store_products_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade,
  constraint store_products_product_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade,
  constraint store_products_category_fk foreign key (category_id, store_id)
    references public.categories (id, store_id) on delete set null (category_id),
  constraint store_products_currency_fk foreign key (currency)
    references public.currencies (code) on delete restrict,
  -- Destino de las FKs de lo que se vende o se muestra EN una tienda.
  constraint store_products_publication_key unique (product_id, store_id),
  constraint store_products_tenant_key unique (id, organization_id, company_id)
);

create unique index store_products_slug_key on public.store_products (store_id, lower(slug));
create index store_products_store_status_idx on public.store_products (store_id, status, published_at desc);
create index store_products_product_idx on public.store_products (product_id);
create index store_products_category_idx on public.store_products (category_id) where category_id is not null;
create index store_products_tenant_idx on public.store_products (organization_id, company_id);

create trigger store_products_set_updated_at
  before update on public.store_products
  for each row execute function ebim.set_updated_at();

comment on table public.store_products is
  'Publicación de un producto maestro en una tienda: slug, categoría, estado, fecha y precio de catálogo de ESA tienda. Única por (tienda, producto).';

-- ===========================================================================
-- 2 · Precios propios por tienda (variante o presentación)
-- ===========================================================================
create table public.store_price_overrides (
  id               uuid          primary key default gen_random_uuid(),
  organization_id  uuid          not null,
  company_id       uuid          not null,
  store_id         uuid          not null,
  product_id       uuid          not null,
  variant_id       uuid,
  uom_id           uuid,
  price            numeric(14,2) not null,
  compare_at_price numeric(14,2),
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),
  constraint store_price_overrides_target check ((variant_id is null) <> (uom_id is null)),
  constraint store_price_overrides_price_positive check (price >= 0),
  constraint store_price_overrides_compare_positive check (compare_at_price is null or compare_at_price >= 0),
  -- El precio de presentación nunca tuvo tachado propio (ADR 004).
  constraint store_price_overrides_uom_no_compare check (uom_id is null or compare_at_price is null),
  constraint store_price_overrides_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade,
  constraint store_price_overrides_publication_fk foreign key (product_id, store_id)
    references public.store_products (product_id, store_id) on delete cascade,
  constraint store_price_overrides_variant_fk foreign key (variant_id, product_id)
    references public.product_variants (id, product_id) on delete cascade,
  constraint store_price_overrides_uom_fk foreign key (product_id, uom_id)
    references public.product_uoms (product_id, uom_id) on delete cascade
);

create unique index store_price_overrides_variant_key
  on public.store_price_overrides (store_id, variant_id) where variant_id is not null;
create unique index store_price_overrides_uom_key
  on public.store_price_overrides (store_id, product_id, uom_id) where uom_id is not null;
create index store_price_overrides_product_idx on public.store_price_overrides (product_id);
create index store_price_overrides_tenant_idx on public.store_price_overrides (organization_id, company_id);

create trigger store_price_overrides_set_updated_at
  before update on public.store_price_overrides
  for each row execute function ebim.set_updated_at();

comment on table public.store_price_overrides is
  'Precio propio de una variante o de una presentación EN una tienda. Importe absoluto en la moneda de la publicación.';

-- ===========================================================================
-- 3 · RLS
-- ===========================================================================
alter table public.store_products        enable row level security;
alter table public.store_products        force  row level security;
alter table public.store_price_overrides enable row level security;
alter table public.store_price_overrides force  row level security;

revoke all on public.store_products, public.store_price_overrides from public, anon, authenticated;
grant select, insert, update, delete on public.store_products, public.store_price_overrides to authenticated;
grant all on public.store_products, public.store_price_overrides to service_role;

-- El comprador anónimo ve lo que la vitrina pinta. Nada de tenant.
grant select (id, store_id, product_id, category_id, slug, status, published_at,
              price, compare_at_price, currency)
  on public.store_products to anon;
grant select (id, store_id, product_id, variant_id, uom_id, price, compare_at_price)
  on public.store_price_overrides to anon;

create policy store_products_select_member on public.store_products
  for select to authenticated using (ebim.can_access(organization_id, company_id));
create policy store_products_insert_catalog on public.store_products
  for insert to authenticated
  with check (ebim.has_role(organization_id, company_id, array['owner','admin','catalog']::public.app_role[]));
create policy store_products_update_catalog on public.store_products
  for update to authenticated
  using  (ebim.has_role(organization_id, company_id, array['owner','admin','catalog']::public.app_role[]))
  with check (ebim.has_role(organization_id, company_id, array['owner','admin','catalog']::public.app_role[]));
create policy store_products_delete_catalog on public.store_products
  for delete to authenticated
  using (ebim.has_role(organization_id, company_id, array['owner','admin','catalog']::public.app_role[]));
create policy store_products_select_public on public.store_products
  for select to anon
  using (
    status = 'published'
    and published_at is not null
    and published_at <= now()
    and exists (select 1 from public.stores s where s.id = store_products.store_id and s.status = 'active')
  );

create policy store_price_overrides_select_member on public.store_price_overrides
  for select to authenticated using (ebim.can_access(organization_id, company_id));
create policy store_price_overrides_insert_catalog on public.store_price_overrides
  for insert to authenticated
  with check (ebim.has_role(organization_id, company_id, array['owner','admin','catalog']::public.app_role[]));
create policy store_price_overrides_update_catalog on public.store_price_overrides
  for update to authenticated
  using  (ebim.has_role(organization_id, company_id, array['owner','admin','catalog']::public.app_role[]))
  with check (ebim.has_role(organization_id, company_id, array['owner','admin','catalog']::public.app_role[]));
create policy store_price_overrides_delete_catalog on public.store_price_overrides
  for delete to authenticated
  using (ebim.has_role(organization_id, company_id, array['owner','admin','catalog']::public.app_role[]));
create policy store_price_overrides_select_public on public.store_price_overrides
  for select to anon
  using (
    exists (
      select 1 from public.store_products sp
      where sp.product_id = store_price_overrides.product_id
        and sp.store_id = store_price_overrides.store_id
    )
  );

-- ===========================================================================
-- 4 · Relleno 1:1 y verificación
-- ===========================================================================
insert into public.store_products
  (organization_id, company_id, store_id, product_id, category_id, slug, status, published_at,
   price, compare_at_price, currency, created_at, updated_at)
select p.organization_id, p.company_id, p.store_id, p.id, p.category_id, p.slug, p.status, p.published_at,
       p.price, p.compare_at_price, p.currency, p.created_at, p.updated_at
from public.products p
where p.store_id is not null
on conflict (product_id, store_id) do nothing;

insert into public.store_price_overrides
  (organization_id, company_id, store_id, product_id, variant_id, price, compare_at_price)
select v.organization_id, v.company_id, v.store_id, v.product_id, v.id, v.price, v.compare_at_price
from public.product_variants v
where v.price is not null and v.store_id is not null
on conflict (store_id, variant_id) where variant_id is not null do nothing;

insert into public.store_price_overrides
  (organization_id, company_id, store_id, product_id, uom_id, price)
select u.organization_id, u.company_id, u.store_id, u.product_id, u.uom_id, u.price
from public.product_uoms u
where u.price is not null and u.store_id is not null
on conflict (store_id, product_id, uom_id) where uom_id is not null do nothing;

do $verify$
declare
  v_products     bigint;
  v_publications bigint;
  v_missing      bigint;
  v_crossed      bigint;
begin
  select count(*) into v_products from public.products where store_id is not null;
  select count(*) into v_publications
  from public.store_products sp
  join public.products p on p.id = sp.product_id and p.store_id = sp.store_id;
  select count(*) into v_missing
  from public.products p
  where p.store_id is not null
    and not exists (select 1 from public.store_products sp where sp.product_id = p.id and sp.store_id = p.store_id);
  select count(*) into v_crossed
  from public.store_products sp
  join public.stores s on s.id = sp.store_id
  join public.products p on p.id = sp.product_id
  where s.organization_id <> p.organization_id or s.company_id <> p.company_id;

  if v_missing > 0 or v_crossed > 0 or v_products <> v_publications then
    raise exception 'RELLENO_INCONSISTENTE: productos=% publicaciones=% sin_publicacion=% cruzadas=%',
      v_products, v_publications, v_missing, v_crossed;
  end if;
end;
$verify$;

-- ===========================================================================
-- 5 · El maestro deja de exigir tienda
--
-- `store_id` pasa a ser «tienda de origen»: la de un producto legacy o la que se
-- indique al crear con la forma antigua. Un maestro creado sin tienda es válido.
-- `slug` y `price` dejan de ser obligatorios por la misma razón; `status` y
-- `currency` conservan su valor por defecto mientras haya escritores legacy.
-- ===========================================================================
alter table public.products alter column store_id drop not null;
alter table public.products alter column slug drop not null;
alter table public.products alter column price drop not null;

comment on column public.products.store_id is
  'LEGACY (ADR 018): tienda de ORIGEN. Durante la transición se sincroniza con su publicación. La publicación vigente en cada tienda está en store_products.';
comment on column public.products.price is
  'LEGACY (ADR 018): precio de catálogo de la tienda de origen, espejo de store_products. No leer para precio: usar la publicación.';

-- PIM: el `store_id` de estas tablas existía solo porque el producto era de una
-- tienda. Deja de ser obligatorio; las FKs nuevas contra el maestro son las que
-- garantizan el tenant.
alter table public.product_variants         alter column store_id drop not null;
alter table public.variant_attribute_values alter column store_id drop not null;
alter table public.product_attribute_values alter column store_id drop not null;
alter table public.product_uoms             alter column store_id drop not null;
alter table public.bundle_items             alter column store_id drop not null;
alter table public.product_relations        alter column store_id drop not null;
alter table public.product_images           alter column store_id drop not null;

alter table public.product_variants
  add constraint product_variants_master_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;
alter table public.variant_attribute_values
  add constraint variant_attribute_values_master_fk foreign key (variant_id, organization_id, company_id)
    references public.product_variants (id, organization_id, company_id) on delete cascade;
alter table public.product_attribute_values
  add constraint product_attribute_values_master_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;
alter table public.product_uoms
  add constraint product_uoms_master_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;
alter table public.bundle_items
  add constraint bundle_items_bundle_master_fk foreign key (bundle_product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;
alter table public.bundle_items
  add constraint bundle_items_component_master_fk foreign key (component_product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete restrict;
alter table public.bundle_items
  add constraint bundle_items_component_variant_master_fk foreign key (component_variant_id, component_product_id)
    references public.product_variants (id, product_id) on delete restrict;
alter table public.product_relations
  add constraint product_relations_master_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;
alter table public.product_relations
  add constraint product_relations_related_master_fk foreign key (related_product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;
alter table public.product_images
  add constraint product_images_master_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;

-- ===========================================================================
-- 6 · Imágenes: la fila es del maestro; el objeto no se mueve
--
-- El CHECK exigía `{org}/{store_id de la fila}/…`. Ahora basta con que la
-- carpeta sea una tienda de la MISMA sociedad: una imagen subida desde la tienda
-- A sirve al maestro en todas. Un CHECK no puede consultar tablas; lo hace un
-- trigger.
-- ===========================================================================
alter table public.product_images drop constraint if exists product_images_path_tenant;

create or replace function ebim.assert_product_image_path()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_org   text := split_part(new.storage_path, '/', 1);
  v_store uuid := ebim.safe_uuid(split_part(new.storage_path, '/', 2));
begin
  if v_org is distinct from new.organization_id::text
     or v_store is null
     or not exists (
       select 1 from public.stores s
       where s.id = v_store
         and s.organization_id = new.organization_id
         and s.company_id = new.company_id
     ) then
    raise exception 'IMAGEN_RUTA_INVALIDA: la ruta debe ser {organizacion}/{tienda de la sociedad}/...'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

revoke all on function ebim.assert_product_image_path() from public, anon, authenticated;

create trigger product_images_path_tenant
  before insert or update of storage_path, organization_id, company_id on public.product_images
  for each row execute function ebim.assert_product_image_path();

-- ===========================================================================
-- 7 · SKU único por sociedad, sin fusionar nada
-- ===========================================================================
alter table public.products         add column legacy_sku_conflict boolean not null default false;
alter table public.product_variants add column legacy_sku_conflict boolean not null default false;

comment on column public.products.legacy_sku_conflict is
  'ADR 018: el SKU coincidía con otra fila de la sociedad al migrar a maestro. Se conserva sin fusionar; renombrar el SKU la desmarca.';

with skus as (
  select p.id, 'product'::text as source, p.organization_id, p.company_id, lower(btrim(p.sku)) as sku
  from public.products p
  union all
  select v.id, 'variant', v.organization_id, v.company_id, lower(btrim(v.sku))
  from public.product_variants v
),
dupes as (
  select s.organization_id, s.company_id, s.sku
  from skus s
  group by s.organization_id, s.company_id, s.sku
  having count(*) > 1
)
update public.products p
   set legacy_sku_conflict = true
  from dupes d
 where d.organization_id = p.organization_id and d.company_id = p.company_id
   and d.sku = lower(btrim(p.sku));

with skus as (
  select p.organization_id, p.company_id, lower(btrim(p.sku)) as sku from public.products p
  union all
  select v.organization_id, v.company_id, lower(btrim(v.sku)) from public.product_variants v
),
dupes as (
  select s.organization_id, s.company_id, s.sku
  from skus s
  group by s.organization_id, s.company_id, s.sku
  having count(*) > 1
)
update public.product_variants v
   set legacy_sku_conflict = true
  from dupes d
 where d.organization_id = v.organization_id and d.company_id = v.company_id
   and d.sku = lower(btrim(v.sku));

create unique index products_company_sku_key
  on public.products (organization_id, company_id, lower(btrim(sku)))
  where not legacy_sku_conflict;
create unique index product_variants_company_sku_key
  on public.product_variants (organization_id, company_id, lower(btrim(sku)))
  where not legacy_sku_conflict;

-- El cruce producto ↔ variante y el caso de una fila marcada: lo que ningún
-- índice parcial puede decir. Mismo nombre de función que antes para no dejar
-- dos triggers con la regla vieja.
create or replace function ebim.assert_sku_unique_in_store()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_sku      text := lower(btrim(new.sku));
  v_conflict boolean;
begin
  select exists (
           select 1 from public.products p
           where p.organization_id = new.organization_id
             and p.company_id = new.company_id
             and lower(btrim(p.sku)) = v_sku
             and (tg_table_name <> 'products' or p.id <> new.id)
         )
      or exists (
           select 1 from public.product_variants v
           where v.organization_id = new.organization_id
             and v.company_id = new.company_id
             and lower(btrim(v.sku)) = v_sku
             and (tg_table_name <> 'product_variants' or v.id <> new.id)
         )
    into v_conflict;

  if v_conflict then
    raise exception 'SKU_DUPLICADO: el SKU % ya existe en esta sociedad', new.sku
      using errcode = '23505';
  end if;

  -- Un SKU que ya no choca con nada deja de ser un conflicto heredado.
  new.legacy_sku_conflict := false;
  return new;
end;
$fn$;

drop trigger if exists products_sku_unique_across_variants on public.products;
create trigger products_sku_unique_across_variants
  before insert or update of sku on public.products
  for each row execute function ebim.assert_sku_unique_in_store();

drop trigger if exists product_variants_sku_unique_across_products on public.product_variants;
create trigger product_variants_sku_unique_across_products
  before insert or update of sku on public.product_variants
  for each row execute function ebim.assert_sku_unique_in_store();

-- ===========================================================================
-- 8 · Sincronía de la tienda de ORIGEN (solo durante la transición)
--
-- Escribir la forma antigua (`products` con tienda, slug, precio…) crea o
-- actualiza la publicación de esa tienda; editar la publicación de la tienda de
-- origen actualiza las columnas legacy. `pg_trigger_depth()` corta el eco: cada
-- lado solo reacciona a una escritura directa, no a la que hizo el otro.
-- Se retira en la contracción de la fase 05.
-- ===========================================================================
create or replace function ebim.sync_origin_publication()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if pg_trigger_depth() > 1 or new.store_id is null or new.slug is null or new.price is null then
    return null;
  end if;

  insert into public.store_products
    (organization_id, company_id, store_id, product_id, category_id, slug, status, published_at,
     price, compare_at_price, currency)
  values
    (new.organization_id, new.company_id, new.store_id, new.id, new.category_id, new.slug,
     coalesce(new.status, 'draft'), new.published_at, new.price, new.compare_at_price,
     coalesce(new.currency, 'PEN'))
  on conflict (product_id, store_id) do update
    set category_id      = excluded.category_id,
        slug             = excluded.slug,
        status           = excluded.status,
        published_at     = excluded.published_at,
        price            = excluded.price,
        compare_at_price = excluded.compare_at_price,
        currency         = excluded.currency;
  return null;
end;
$fn$;

create trigger products_sync_origin_publication
  after insert or update of store_id, category_id, slug, status, published_at, price, compare_at_price, currency
  on public.products
  for each row execute function ebim.sync_origin_publication();

create or replace function ebim.sync_products_from_origin()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'DELETE' then
    -- Quitar la publicación de origen deja el producto sin vender ahí también
    -- para los lectores legacy.
    update public.products p
       set status = 'draft'
     where p.id = old.product_id and p.store_id = old.store_id and p.status <> 'draft';
    return null;
  end if;

  update public.products p
     set category_id      = new.category_id,
         slug             = new.slug,
         status           = new.status,
         published_at     = new.published_at,
         price            = new.price,
         compare_at_price = new.compare_at_price,
         currency         = new.currency
   where p.id = new.product_id
     and p.store_id = new.store_id;
  return null;
end;
$fn$;

create trigger store_products_sync_origin
  after insert or update or delete on public.store_products
  for each row execute function ebim.sync_products_from_origin();

-- Precio propio de variante y de presentación: mismo espejo, misma guarda.
create or replace function ebim.sync_origin_price_override()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if pg_trigger_depth() > 1 or new.store_id is null then
    return null;
  end if;

  -- La publicación de origen tiene que existir para colgar un precio de ella.
  if not exists (
    select 1 from public.store_products sp
    where sp.product_id = new.product_id and sp.store_id = new.store_id
  ) then
    return null;
  end if;

  if tg_table_name = 'product_variants' then
    if new.price is null then
      delete from public.store_price_overrides o
       where o.store_id = new.store_id and o.variant_id = new.id;
    else
      insert into public.store_price_overrides
        (organization_id, company_id, store_id, product_id, variant_id, price, compare_at_price)
      values
        (new.organization_id, new.company_id, new.store_id, new.product_id, new.id, new.price, new.compare_at_price)
      on conflict (store_id, variant_id) where variant_id is not null do update
        set price = excluded.price, compare_at_price = excluded.compare_at_price;
    end if;
  else
    if new.price is null then
      delete from public.store_price_overrides o
       where o.store_id = new.store_id and o.product_id = new.product_id and o.uom_id = new.uom_id;
    else
      insert into public.store_price_overrides
        (organization_id, company_id, store_id, product_id, uom_id, price)
      values
        (new.organization_id, new.company_id, new.store_id, new.product_id, new.uom_id, new.price)
      on conflict (store_id, product_id, uom_id) where uom_id is not null do update
        set price = excluded.price;
    end if;
  end if;
  return null;
end;
$fn$;

create trigger product_variants_sync_origin_price
  after insert or update of price, compare_at_price, store_id on public.product_variants
  for each row execute function ebim.sync_origin_price_override();

create trigger product_uoms_sync_origin_price
  after insert or update of price, store_id on public.product_uoms
  for each row execute function ebim.sync_origin_price_override();

create or replace function ebim.sync_price_from_origin_override()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_row public.store_price_overrides%rowtype;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;

  if v_row.variant_id is not null then
    update public.product_variants v
       set price            = case when tg_op = 'DELETE' then null else v_row.price end,
           compare_at_price = case when tg_op = 'DELETE' then null else v_row.compare_at_price end
     where v.id = v_row.variant_id and v.store_id = v_row.store_id;
  else
    update public.product_uoms u
       set price = case when tg_op = 'DELETE' then null else v_row.price end
     where u.product_id = v_row.product_id and u.uom_id = v_row.uom_id and u.store_id = v_row.store_id;
  end if;
  return null;
end;
$fn$;

create trigger store_price_overrides_sync_origin
  after insert or update or delete on public.store_price_overrides
  for each row execute function ebim.sync_price_from_origin_override();

revoke all on function ebim.sync_origin_publication() from public, anon, authenticated;
revoke all on function ebim.sync_products_from_origin() from public, anon, authenticated;
revoke all on function ebim.sync_origin_price_override() from public, anon, authenticated;
revoke all on function ebim.sync_price_from_origin_override() from public, anon, authenticated;
