-- =============================================================================
-- Stores + Product Master · Fase 04 — importación contra el maestro (ADR 018)
--
-- `import_catalog_products` nació con el producto de UNA tienda: buscaba el SKU
-- en la tienda y escribía las columnas del producto. Con el maestro de sociedad
-- eso duplicaría el artículo al importar la misma hoja en la segunda tienda (y
-- chocaría con el SKU único por sociedad).
--
-- Ahora, por cada fila:
-- - el SKU se busca en la SOCIEDAD (producto y variante);
-- - nombre, descripción, marca, familia, tipo y stock actualizan el MAESTRO;
-- - slug, categoría (de esta tienda), estado y precio van a la PUBLICACIÓN de la
--   tienda destino, que se crea si el maestro aún no estaba en ella;
-- - el precio de variante en una tienda que no es la de origen va a
--   `store_price_overrides` de esa tienda, no a la variante.
--
-- La tienda de origen sigue escribiendo por la fachada legacy (sincronía de la
-- fase 03), así que una hoja importada en la tienda de siempre se comporta
-- igual que antes. Firma, permisos y resultado no cambian.
-- =============================================================================

create or replace function public.import_catalog_products(
  p_store_id uuid,
  p_rows     jsonb,
  p_dry_run  boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store          public.stores%rowtype;
  v_advanced       boolean;
  v_count          integer;
  v_kinds          jsonb;
  v_item           jsonb;
  v_pos            integer := 0;
  v_row            integer;
  v_sku            text;
  v_sku_key        text;
  v_vsku           text;
  v_axes           jsonb;
  v_kind           public.product_kind;
  v_product        public.products%rowtype;
  v_variant        public.product_variants%rowtype;
  v_existed        boolean;
  v_is_origin      boolean;
  v_has_pub        boolean;
  v_seen           jsonb := '{}'::jsonb;
  v_seen_variants  text[] := '{}';
  v_first          jsonb;
  v_current        jsonb;
  v_field          text;
  v_name           text;
  v_slug           text;
  v_slug_base      text;
  v_slug_try       text;
  v_n              integer;
  v_desc           text;
  v_price          numeric;
  v_compare        numeric;
  v_status         public.product_status;
  v_stock          integer;
  v_category_slug  text;
  v_brand_code     text;
  v_family_code    text;
  v_category       uuid;
  v_brand          uuid;
  v_family         uuid;
  v_vname          text;
  v_vprice         numeric;
  v_vstock         integer;
  v_axis_key       text;
  v_axis_json      jsonb;
  v_axis_val       text;
  v_attr           public.attributes%rowtype;
  v_value_id       uuid;
  v_value_label    text;
  v_axis_attrs     uuid[];
  v_axis_values    uuid[];
  v_labels         text[];
  v_created_any    boolean;
  v_result         jsonb := '[]'::jsonb;
  v_errors         integer := 0;
  v_rows_created   integer := 0;
  v_rows_updated   integer := 0;
  v_p_created      integer := 0;
  v_p_updated      integer := 0;
  v_v_created      integer := 0;
  v_v_updated      integer := 0;
  v_by_warehouse   boolean;
  v_state          text;
  v_msg            text;
  v_constraint     text;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: importar exige sesion' using errcode = '42501';
  end if;
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el operador de la suite no edita el catalogo de un tenant'
      using errcode = '42501';
  end if;
  select * into v_store from public.stores s where s.id = p_store_id;
  if not found
     or not ebim.has_role(v_store.organization_id, v_store.company_id,
                          array['owner', 'admin', 'catalog']::public.app_role[]) then
    raise exception 'SIN_PERMISO: importar el catalogo de esta tienda exige rol owner, admin o catalog'
      using errcode = '42501';
  end if;

  perform ebim.import_assert_rows(p_rows,
    array['row', 'sku', 'name', 'slug', 'description', 'category_slug', 'brand_code', 'family_code',
          'price', 'compare_at_price', 'status', 'stock', 'variant_sku', 'variant_name',
          'variant_price', 'variant_stock', 'axes'], 2000);
  if exists (
    select 1 from jsonb_array_elements(p_rows) as e(item)
    where e.item ? 'axes' and jsonb_typeof(e.item -> 'axes') <> 'object'
  ) then
    raise exception 'FILAS_INVALIDAS: axes es un objeto {atributo: valor}' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rows);

  v_advanced := ebim.has_capability(v_store.organization_id, v_store.company_id, 'catalog.advanced');

  -- El TIPO de cada producto lo decide la hoja entera: si alguna fila del SKU
  -- trae variante, es un producto con variantes.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_kinds
  from (
    select lower(btrim(e.item ->> 'sku')) as k,
           case when bool_or(coalesce(btrim(e.item ->> 'variant_sku'), '') <> '')
                then 'variant' else 'simple' end as v
    from jsonb_array_elements(p_rows) as e(item)
    where coalesce(btrim(e.item ->> 'sku'), '') <> ''
    group by 1
  ) s;

  select exists (
           select 1 from public.store_warehouses sw where sw.store_id = v_store.id and sw.is_active
         )
      or (not exists (select 1 from public.store_warehouses sw where sw.store_id = v_store.id)
          and exists (
            select 1 from public.warehouses w
            where w.organization_id = v_store.organization_id
              and w.company_id = v_store.company_id and w.is_active
          ))
  into v_by_warehouse;

  begin
    for v_item in select e.item from jsonb_array_elements(p_rows) with ordinality as e(item, ord) order by e.ord loop
      v_pos := v_pos + 1;
      v_row := v_pos;
      v_sku := null;
      v_vsku := null;
      v_created_any := false;

      begin
        v_row := coalesce(ebim.import_int(v_item, 'row'), v_pos);

        v_sku := ebim.import_text(v_item, 'sku', 64);
        if v_sku is null then
          raise exception 'CAMPO_REQUERIDO: sku' using errcode = '22023';
        end if;
        v_sku_key := lower(v_sku);
        v_kind := (v_kinds ->> v_sku_key)::public.product_kind;
        v_vsku := ebim.import_text(v_item, 'variant_sku', 64);
        v_axes := coalesce(v_item -> 'axes', '{}'::jsonb);

        if v_vsku is null and (v_kind = 'variant' or v_axes <> '{}'::jsonb) then
          raise exception 'CAMPO_REQUERIDO: variant_sku' using errcode = '22023';
        end if;

        v_name := ebim.import_text(v_item, 'name', 240);
        v_slug := lower(ebim.import_text(v_item, 'slug', 121));
        v_desc := ebim.import_text(v_item, 'description', 10000);
        v_price := ebim.import_numeric(v_item, 'price');
        v_compare := ebim.import_numeric(v_item, 'compare_at_price');
        v_status := ebim.import_product_status(ebim.import_text(v_item, 'status', 20));
        v_stock := ebim.import_int(v_item, 'stock');
        v_category_slug := lower(ebim.import_text(v_item, 'category_slug', 81));
        v_brand_code := lower(ebim.import_text(v_item, 'brand_code', 41));
        v_family_code := lower(ebim.import_text(v_item, 'family_code', 41));

        if not v_advanced then
          if v_vsku is not null then
            raise exception 'MODULO_NO_CONTRATADO: variant_sku' using errcode = '42501';
          elsif v_brand_code is not null then
            raise exception 'MODULO_NO_CONTRATADO: brand_code' using errcode = '42501';
          elsif v_family_code is not null then
            raise exception 'MODULO_NO_CONTRATADO: family_code' using errcode = '42501';
          end if;
        end if;

        if v_price < 0 then
          raise exception 'VALOR_INVALIDO: price' using errcode = '22023';
        end if;
        if v_compare < 0 then
          raise exception 'VALOR_INVALIDO: compare_at_price' using errcode = '22023';
        end if;
        if v_stock < 0 then
          raise exception 'VALOR_INVALIDO: stock' using errcode = '22023';
        end if;
        if v_kind = 'simple' and exists (
          select 1 from jsonb_each(v_seen) as s(k, v) where s.k = v_sku_key
        ) then
          raise exception 'SKU_REPETIDO: sku' using errcode = '22023';
        end if;

        -- Los datos del PRODUCTO se repiten en cada fila de variante. Pueden ir
        -- vacíos en las siguientes; lo que no pueden es contradecir a la primera.
        v_current := jsonb_strip_nulls(jsonb_build_object(
          'name', v_name, 'slug', v_slug, 'description', v_desc, 'price', v_price,
          'compare_at_price', v_compare, 'status', v_status, 'stock', v_stock,
          'category_slug', v_category_slug, 'brand_code', v_brand_code, 'family_code', v_family_code));
        v_first := v_seen -> v_sku_key;
        if v_first is not null then
          foreach v_field in array array['name', 'slug', 'description', 'price', 'compare_at_price',
                                         'status', 'stock', 'category_slug', 'brand_code', 'family_code'] loop
            if v_current ? v_field and v_first ? v_field and (v_current -> v_field) <> (v_first -> v_field) then
              raise exception 'DATO_DISTINTO: %', v_field using errcode = '22023';
            end if;
          end loop;
        end if;

        v_category := null;
        if v_category_slug is not null then
          select c.id into v_category from public.categories c
          where c.store_id = v_store.id and lower(c.slug) = v_category_slug;
          if v_category is null then
            raise exception 'CATEGORIA_NO_ENCONTRADA: category_slug' using errcode = '22023';
          end if;
        end if;
        v_brand := null;
        if v_brand_code is not null then
          select b.id into v_brand from public.brands b
          where b.organization_id = v_store.organization_id and b.company_id = v_store.company_id
            and lower(b.code) = v_brand_code;
          if v_brand is null then
            raise exception 'MARCA_NO_ENCONTRADA: brand_code' using errcode = '22023';
          end if;
        end if;
        v_family := null;
        if v_family_code is not null then
          select f.id into v_family from public.product_families f
          where f.organization_id = v_store.organization_id and f.company_id = v_store.company_id
            and lower(f.code) = v_family_code;
          if v_family is null then
            raise exception 'FAMILIA_NO_ENCONTRADA: family_code' using errcode = '22023';
          end if;
        end if;

        -- El SKU es de la SOCIEDAD. Si una base heredada tiene dos filas con el
        -- mismo SKU (`legacy_sku_conflict`), manda la que nació en esta tienda.
        select * into v_product from public.products p
        where p.organization_id = v_store.organization_id
          and p.company_id = v_store.company_id
          and lower(btrim(p.sku)) = v_sku_key
        order by (p.store_id = v_store.id) desc nulls last, p.created_at, p.id
        limit 1;
        v_existed := found;

        if not v_existed then
          if v_name is null then
            raise exception 'CAMPO_REQUERIDO: name' using errcode = '22023';
          end if;
          if v_price is null then
            raise exception 'CAMPO_REQUERIDO: price' using errcode = '22023';
          end if;

          if v_slug is not null then
            if v_slug !~ '^[a-z0-9][a-z0-9-]{0,120}$' then
              raise exception 'SLUG_INVALIDO: slug' using errcode = '22023';
            end if;
            v_slug_try := v_slug;
          else
            -- Sin slug se deriva del nombre y, si ya está tomado, se numera.
            v_slug_base := ebim.import_slug(v_name, 110);
            if v_slug_base is null then
              raise exception 'SLUG_INVALIDO: name' using errcode = '22023';
            end if;
            v_slug_try := v_slug_base;
            v_n := 1;
            while exists (
              select 1 from public.store_products sp
              where sp.store_id = v_store.id and lower(sp.slug) = v_slug_try
            ) or exists (
              select 1 from public.products p
              where p.store_id = v_store.id and lower(p.slug) = v_slug_try
            ) loop
              v_n := v_n + 1;
              v_slug_try := v_slug_base || '-' || v_n;
            end loop;
          end if;

          insert into public.products
            (organization_id, company_id, store_id, category_id, sku, slug, name, description,
             price, compare_at_price, currency, stock, status, published_at, kind, brand_id, family_id)
          values
            (v_store.organization_id, v_store.company_id, v_store.id, v_category, v_sku, v_slug_try,
             v_name, v_desc, v_price, v_compare, v_store.currency,
             case when v_kind = 'simple' then coalesce(v_stock, 0) else 0 end,
             coalesce(v_status, 'draft'),
             case when coalesce(v_status, 'draft') = 'published' then now() end,
             v_kind, v_brand, v_family)
          returning * into v_product;
          v_p_created := v_p_created + 1;
          v_created_any := true;
        else
          if v_product.kind <> v_kind then
            raise exception 'TIPO_DISTINTO: variant_sku' using errcode = '22023';
          end if;
          if v_first is null then
            v_p_updated := v_p_updated + 1;
          end if;
          if v_slug is not null and v_slug !~ '^[a-z0-9][a-z0-9-]{0,120}$' then
            raise exception 'SLUG_INVALIDO: slug' using errcode = '22023';
          end if;

          v_is_origin := v_product.store_id is not distinct from v_store.id;
          select exists (
            select 1 from public.store_products sp
            where sp.product_id = v_product.id and sp.store_id = v_store.id
          ) into v_has_pub;

          if not v_is_origin then
            -- Otra tienda: el MAESTRO recibe lo que es del maestro…
            update public.products p set
              name        = coalesce(v_name, p.name),
              description = coalesce(v_desc, p.description),
              brand_id    = coalesce(v_brand, p.brand_id),
              family_id   = coalesce(v_family, p.family_id),
              stock       = case when p.kind = 'simple' then coalesce(v_stock, p.stock) else p.stock end
            where p.id = v_product.id
            returning * into v_product;

            -- …y la publicación de ESTA tienda, lo que es de la tienda.
            if v_has_pub then
              update public.store_products sp set
                slug             = coalesce(v_slug, sp.slug),
                price            = coalesce(v_price, sp.price),
                compare_at_price = coalesce(v_compare, sp.compare_at_price),
                category_id      = coalesce(v_category, sp.category_id),
                status           = coalesce(v_status, sp.status),
                published_at     = case
                                     when coalesce(v_status, sp.status) = 'published'
                                       then coalesce(sp.published_at, now())
                                     else sp.published_at
                                   end
              where sp.product_id = v_product.id and sp.store_id = v_store.id;
            else
              if v_price is null then
                raise exception 'CAMPO_REQUERIDO: price' using errcode = '22023';
              end if;
              if v_slug is not null then
                v_slug_try := v_slug;
              else
                v_slug_base := ebim.import_slug(coalesce(v_name, v_product.name), 110);
                if v_slug_base is null then
                  raise exception 'SLUG_INVALIDO: name' using errcode = '22023';
                end if;
                v_slug_try := v_slug_base;
                v_n := 1;
                while exists (
                  select 1 from public.store_products sp
                  where sp.store_id = v_store.id and lower(sp.slug) = v_slug_try
                ) loop
                  v_n := v_n + 1;
                  v_slug_try := v_slug_base || '-' || v_n;
                end loop;
              end if;

              insert into public.store_products
                (organization_id, company_id, store_id, product_id, category_id, slug, status,
                 published_at, price, compare_at_price, currency)
              values
                (v_store.organization_id, v_store.company_id, v_store.id, v_product.id, v_category,
                 v_slug_try, coalesce(v_status, 'draft'),
                 case when coalesce(v_status, 'draft') = 'published' then now() end,
                 v_price, v_compare, v_store.currency);
              perform ebim.adopt_origin_store(v_product.id, v_store.id);
            end if;
          else
          -- Tienda de origen: la fachada legacy escribe maestro y publicación a la vez.
          update public.products p set
            name             = coalesce(v_name, p.name),
            slug             = coalesce(v_slug, p.slug),
            description      = coalesce(v_desc, p.description),
            price            = coalesce(v_price, p.price),
            compare_at_price = coalesce(v_compare, p.compare_at_price),
            category_id      = coalesce(v_category, p.category_id),
            brand_id         = coalesce(v_brand, p.brand_id),
            family_id        = coalesce(v_family, p.family_id),
            status           = coalesce(v_status, p.status),
            published_at     = case
                                 when coalesce(v_status, p.status) = 'published'
                                   then coalesce(p.published_at, now())
                                 else p.published_at
                               end,
            stock            = case when p.kind = 'simple' then coalesce(v_stock, p.stock) else p.stock end
          where p.id = v_product.id
          returning * into v_product;
          end if;
        end if;

        -- El precio de variante de una tienda que no es la de origen es un precio
        -- propio de ESA tienda: no se escribe en la variante, que es del maestro.
        v_is_origin := v_product.store_id is not distinct from v_store.id;

        v_seen := v_seen || jsonb_build_object(v_sku_key, coalesce(v_first, '{}'::jsonb) || v_current);

        if v_vsku is not null then
          if lower(v_vsku) = any (v_seen_variants) then
            raise exception 'SKU_REPETIDO: variant_sku' using errcode = '22023';
          end if;
          v_seen_variants := v_seen_variants || lower(v_vsku);

          v_vname := ebim.import_text(v_item, 'variant_name', 240);
          v_vprice := ebim.import_numeric(v_item, 'variant_price');
          v_vstock := ebim.import_int(v_item, 'variant_stock');
          if v_vprice < 0 then
            raise exception 'VALOR_INVALIDO: variant_price' using errcode = '22023';
          end if;
          if v_vstock < 0 then
            raise exception 'VALOR_INVALIDO: variant_stock' using errcode = '22023';
          end if;

          -- Los ejes se resuelven ANTES de escribir la variante: un valor que no
          -- existe no deja una variante a medias.
          v_axis_attrs := '{}';
          v_axis_values := '{}';
          v_labels := '{}';
          for v_axis_key, v_axis_json in select j.key, j.value from jsonb_each(v_axes) as j loop
            if jsonb_typeof(v_axis_json) not in ('string', 'number') then
              raise exception 'FORMATO_INVALIDO: axes' using errcode = '22023';
            end if;
            v_axis_val := btrim(v_axis_json #>> '{}');
            continue when v_axis_val = '';

            select * into v_attr from public.attributes a
            where a.organization_id = v_store.organization_id and a.company_id = v_store.company_id
              and lower(a.code) = lower(v_axis_key);
            if not found then
              raise exception 'EJE_NO_ENCONTRADO: %', left(lower(v_axis_key), 40) using errcode = '22023';
            end if;
            if not v_attr.is_variant_axis then
              raise exception 'NO_ES_EJE: %', v_attr.code using errcode = '22023';
            end if;

            select av.id, av.label into v_value_id, v_value_label
            from public.attribute_values av
            where av.attribute_id = v_attr.id
              and (lower(av.code) = lower(v_axis_val) or lower(av.label) = lower(v_axis_val))
            order by (lower(av.code) = lower(v_axis_val)) desc
            limit 1;
            if v_value_id is null then
              raise exception 'VALOR_NO_ENCONTRADO: %', v_attr.code using errcode = '22023';
            end if;

            v_axis_attrs := v_axis_attrs || v_attr.id;
            v_axis_values := v_axis_values || v_value_id;
            v_labels := v_labels || v_value_label;
            v_value_id := null;
          end loop;

          select * into v_variant from public.product_variants pv
          where pv.organization_id = v_store.organization_id
            and pv.company_id = v_store.company_id
            and lower(btrim(pv.sku)) = lower(v_vsku)
          order by (pv.product_id = v_product.id) desc, pv.created_at, pv.id
          limit 1;

          if found then
            if v_variant.product_id <> v_product.id then
              raise exception 'VARIANTE_DE_OTRO_PRODUCTO: variant_sku' using errcode = '22023';
            end if;
            update public.product_variants pv set
              name  = coalesce(v_vname, pv.name),
              price = case when v_is_origin then coalesce(v_vprice, pv.price) else pv.price end,
              stock = coalesce(v_vstock, pv.stock)
            where pv.id = v_variant.id
            returning * into v_variant;
            v_v_updated := v_v_updated + 1;
          else
            insert into public.product_variants
              (organization_id, company_id, store_id, product_id, sku, name, price, stock, position, is_default)
            values
              (v_store.organization_id, v_store.company_id, coalesce(v_product.store_id, v_store.id),
               v_product.id, v_vsku,
               left(coalesce(
                 v_vname,
                 v_product.name || case when cardinality(v_labels) > 0
                                        then ' · ' || array_to_string(v_labels, ' / ') else '' end
               ), 240),
               case when v_is_origin then v_vprice end, coalesce(v_vstock, 0),
               (select count(*) from public.product_variants pv where pv.product_id = v_product.id),
               not exists (
                 select 1 from public.product_variants pv where pv.product_id = v_product.id and pv.is_default
               ))
            returning * into v_variant;
            v_v_created := v_v_created + 1;
            v_created_any := true;
          end if;

          if not v_is_origin and v_vprice is not null then
            insert into public.store_price_overrides
              (organization_id, company_id, store_id, product_id, variant_id, price)
            values
              (v_store.organization_id, v_store.company_id, v_store.id, v_product.id, v_variant.id, v_vprice)
            on conflict (store_id, variant_id) where variant_id is not null do update
              set price = excluded.price;
          end if;

          insert into public.variant_attribute_values
            (organization_id, company_id, store_id, variant_id, attribute_id, value_id)
          select v_store.organization_id, v_store.company_id, v_variant.store_id, v_variant.id, a.attribute_id, a.value_id
          from unnest(v_axis_attrs, v_axis_values) as a(attribute_id, value_id)
          on conflict (variant_id, attribute_id) do update set value_id = excluded.value_id;
        end if;

        if v_created_any then
          v_rows_created := v_rows_created + 1;
        else
          v_rows_updated := v_rows_updated + 1;
        end if;
        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'sheet', 'products', 'row', v_row, 'key', coalesce(v_vsku, v_sku),
          'status', case when v_created_any then 'created' else 'updated' end));
      exception when others then
        get stacked diagnostics
          v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
        v_errors := v_errors + 1;
        v_result := v_result || jsonb_build_array(
          ebim.import_row_error('products', v_row, coalesce(v_vsku, v_sku), v_state, v_msg, v_constraint));
      end;
    end loop;

    if p_dry_run or v_errors > 0 then
      raise exception 'EBIM_IMPORT_ROLLBACK' using errcode = 'EB001';
    end if;
  exception when sqlstate 'EB001' then
    null;
  end;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'applied', not p_dry_run and v_errors = 0,
    'total', v_count,
    'created', v_rows_created,
    'updated', v_rows_updated,
    'errors', v_errors,
    'products_created', v_p_created,
    'products_updated', v_p_updated,
    'variants_created', v_v_created,
    'variants_updated', v_v_updated,
    'inventory_by_warehouse', v_by_warehouse,
    'rows', v_result
  );
end;
$fn$;
