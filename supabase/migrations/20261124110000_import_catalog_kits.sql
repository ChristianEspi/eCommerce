-- =============================================================================
-- Importar kits por Excel (2026-11-24)
--
-- ## El problema
--
-- La plantilla de productos solo crea productos simples y con variantes. Un kit
-- (producto `bundle` con su receta en `bundle_items`) se armaba a mano,
-- componente por componente, en la pestaña «Componentes» de cada producto.
--
-- ## La hoja «Kits»
--
-- Una fila por COMPONENTE, como las variantes en la hoja de productos: los
-- datos del kit se repiten (o se dejan vacíos) en cada fila de su receta.
--
--   kit_sku *  kit_name  price  category_slug  status  component_sku *  component_variant_sku  quantity *
--
-- Reglas, las mismas que el panel y que la base ya exige:
--  · un kit no lleva kits (`bundle_items_no_nesting`) ni a sí mismo;
--  · si el componente se vende por variantes, hay que decir CUÁL (también vale
--    poner directamente el SKU de la variante en `component_sku`);
--  · cantidad > 0; el mismo componente dos veces en un kit es un error;
--  · la receta de la hoja REEMPLAZA la receta del kit: lo que no está en la hoja
--    deja de ser componente. Es lo que se espera de «subir la receta».
--  · un SKU que ya existe como producto simple o con variantes no se convierte
--    en kit (`TIPO_DISTINTO`).
--  · exige el módulo de catálogo avanzado, como la pestaña «Componentes».
--
-- ## Por qué una función que importa productos Y kits a la vez
--
-- La revisión («simular») deshace lo que escribe. Si los kits se revisaran en
-- otra llamada, no verían los componentes que el MISMO Excel crea en la hoja de
-- productos y darían «componente no encontrado» falsos. Aquí productos y kits
-- corren en la misma transacción, y al simular (o con cualquier error) se
-- deshace TODO. `import_catalog_products` no cambia: se llama tal cual.
-- =============================================================================

create or replace function ebim.import_kit_rows(p_store public.stores, p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_kit_sku     text;
  v_kit         public.products%rowtype;
  v_existed     boolean;
  v_rows        jsonb;
  v_item        jsonb;
  v_first_row   integer;
  v_row         integer;
  v_name        text;
  v_price       numeric;
  v_status      public.product_status;
  v_cat_slug    text;
  v_category    uuid;
  v_slug_base   text;
  v_slug_try    text;
  v_n           integer;
  v_is_origin   boolean;
  v_has_pub     boolean;
  v_csku        text;
  v_cvsku       text;
  v_qty         numeric;
  v_comp        public.products%rowtype;
  v_cvar        public.product_variants%rowtype;
  v_seen        text[];
  v_key         text;
  v_kit_error   jsonb;
  v_result      jsonb := '[]'::jsonb;
  v_errors      integer := 0;
  v_k_created   integer := 0;
  v_k_updated   integer := 0;
  v_components  integer := 0;
  v_state       text;
  v_msg         text;
  v_constraint  text;
begin
  -- Un kit por SKU, en el orden en que aparece por primera vez.
  for v_kit_sku, v_rows in
    select lower(btrim(e.item ->> 'kit_sku')),
           jsonb_agg(e.item order by e.ord)
      from jsonb_array_elements(p_rows) with ordinality as e(item, ord)
     where coalesce(btrim(e.item ->> 'kit_sku'), '') <> ''
     group by 1
     order by min(e.ord)
  loop
    v_first_row := coalesce(ebim.import_int(v_rows -> 0, 'row'), 0);
    v_kit_error := null;

    -- ---- el kit (cabecera) -------------------------------------------------
    begin
      v_name := null; v_price := null; v_status := null; v_cat_slug := null;
      for v_item in select x from jsonb_array_elements(v_rows) x loop
        -- Los datos del kit pueden repetirse; lo que no pueden es contradecirse.
        if ebim.import_text(v_item, 'kit_name', 240) is not null then
          if v_name is not null and v_name <> ebim.import_text(v_item, 'kit_name', 240) then
            raise exception 'DATO_DISTINTO: kit_name' using errcode = '22023';
          end if;
          v_name := ebim.import_text(v_item, 'kit_name', 240);
        end if;
        if ebim.import_numeric(v_item, 'price') is not null then
          if v_price is not null and v_price <> ebim.import_numeric(v_item, 'price') then
            raise exception 'DATO_DISTINTO: price' using errcode = '22023';
          end if;
          v_price := ebim.import_numeric(v_item, 'price');
        end if;
        if ebim.import_text(v_item, 'status', 20) is not null then
          v_status := ebim.import_product_status(ebim.import_text(v_item, 'status', 20));
        end if;
        if ebim.import_text(v_item, 'category_slug', 81) is not null then
          v_cat_slug := lower(ebim.import_text(v_item, 'category_slug', 81));
        end if;
      end loop;
      if v_price < 0 then
        raise exception 'VALOR_INVALIDO: price' using errcode = '22023';
      end if;

      v_category := null;
      if v_cat_slug is not null then
        select c.id into v_category from public.categories c
         where c.store_id = p_store.id and lower(c.slug) = v_cat_slug;
        if v_category is null then
          raise exception 'CATEGORIA_NO_ENCONTRADA: category_slug' using errcode = '22023';
        end if;
      end if;

      select * into v_kit from public.products p
       where p.organization_id = p_store.organization_id and p.company_id = p_store.company_id
         and lower(btrim(p.sku)) = v_kit_sku
       order by (p.store_id = p_store.id) desc nulls last, p.created_at, p.id
       limit 1;
      v_existed := found;

      if not v_existed then
        if v_name is null then
          raise exception 'CAMPO_REQUERIDO: kit_name' using errcode = '22023';
        end if;
        if v_price is null then
          raise exception 'CAMPO_REQUERIDO: price' using errcode = '22023';
        end if;
        v_slug_base := ebim.import_slug(v_name, 110);
        if v_slug_base is null then
          raise exception 'SLUG_INVALIDO: kit_name' using errcode = '22023';
        end if;
        v_slug_try := v_slug_base;
        v_n := 1;
        while exists (select 1 from public.store_products sp where sp.store_id = p_store.id and lower(sp.slug) = v_slug_try)
           or exists (select 1 from public.products p where p.store_id = p_store.id and lower(p.slug) = v_slug_try) loop
          v_n := v_n + 1;
          v_slug_try := v_slug_base || '-' || v_n;
        end loop;

        -- Igual que un producto nuevo de la hoja de productos: la fachada de la
        -- tienda de origen crea maestro y publicación a la vez.
        insert into public.products
          (organization_id, company_id, store_id, category_id, sku, slug, name, price, currency, stock,
           status, published_at, kind)
        values
          (p_store.organization_id, p_store.company_id, p_store.id, v_category,
           btrim(v_rows -> 0 ->> 'kit_sku'), v_slug_try, v_name, v_price, p_store.currency, 0,
           coalesce(v_status, 'draft'),
           case when coalesce(v_status, 'draft') = 'published' then now() end,
           'bundle')
        returning * into v_kit;
        v_k_created := v_k_created + 1;
      else
        if v_kit.kind <> 'bundle' then
          raise exception 'TIPO_DISTINTO: kit_sku' using errcode = '22023';
        end if;
        v_k_updated := v_k_updated + 1;
        v_is_origin := v_kit.store_id is not distinct from p_store.id;
        select exists (select 1 from public.store_products sp where sp.product_id = v_kit.id and sp.store_id = p_store.id)
          into v_has_pub;

        if v_is_origin then
          update public.products p set
            name        = coalesce(v_name, p.name),
            price       = coalesce(v_price, p.price),
            category_id = coalesce(v_category, p.category_id),
            status      = coalesce(v_status, p.status),
            published_at = case when coalesce(v_status, p.status) = 'published'
                                then coalesce(p.published_at, now()) else p.published_at end
          where p.id = v_kit.id;
        elsif v_has_pub then
          update public.products p set name = coalesce(v_name, p.name) where p.id = v_kit.id;
          update public.store_products sp set
            price       = coalesce(v_price, sp.price),
            category_id = coalesce(v_category, sp.category_id),
            status      = coalesce(v_status, sp.status),
            published_at = case when coalesce(v_status, sp.status) = 'published'
                                 then coalesce(sp.published_at, now()) else sp.published_at end
          where sp.product_id = v_kit.id and sp.store_id = p_store.id;
        else
          if v_price is null then
            raise exception 'CAMPO_REQUERIDO: price' using errcode = '22023';
          end if;
          v_slug_base := ebim.import_slug(coalesce(v_name, v_kit.name), 110);
          v_slug_try := v_slug_base;
          v_n := 1;
          while exists (select 1 from public.store_products sp where sp.store_id = p_store.id and lower(sp.slug) = v_slug_try) loop
            v_n := v_n + 1;
            v_slug_try := v_slug_base || '-' || v_n;
          end loop;
          insert into public.store_products
            (organization_id, company_id, store_id, product_id, category_id, slug, status, published_at, price,
             compare_at_price, currency)
          values
            (p_store.organization_id, p_store.company_id, p_store.id, v_kit.id, v_category, v_slug_try,
             coalesce(v_status, 'draft'),
             case when coalesce(v_status, 'draft') = 'published' then now() end,
             v_price, null, p_store.currency);
          perform ebim.adopt_origin_store(v_kit.id, p_store.id);
        end if;
      end if;

      -- La receta de la hoja REEMPLAZA la del kit.
      delete from public.bundle_items b where b.bundle_product_id = v_kit.id;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
      v_kit_error := ebim.import_row_error('kits', v_first_row, v_rows -> 0 ->> 'kit_sku', v_state, v_msg, v_constraint);
    end;

    -- ---- los componentes ---------------------------------------------------
    v_seen := '{}';
    for v_item in select x from jsonb_array_elements(v_rows) x loop
      v_row := coalesce(ebim.import_int(v_item, 'row'), v_first_row);
      v_csku := ebim.import_text(v_item, 'component_sku', 64);
      v_cvsku := ebim.import_text(v_item, 'component_variant_sku', 64);
      if v_kit_error is not null then
        -- Sin kit no hay receta: cada fila dice por qué.
        v_errors := v_errors + 1;
        v_result := v_result || jsonb_build_array(v_kit_error || jsonb_build_object('row', v_row));
        continue;
      end if;
      begin
        if v_csku is null then
          raise exception 'CAMPO_REQUERIDO: component_sku' using errcode = '22023';
        end if;
        v_qty := ebim.import_numeric(v_item, 'quantity');
        if v_qty is null then
          raise exception 'CAMPO_REQUERIDO: quantity' using errcode = '22023';
        end if;
        if v_qty <= 0 then
          raise exception 'VALOR_INVALIDO: quantity' using errcode = '22023';
        end if;

        v_cvar := null;
        select * into v_comp from public.products p
         where p.organization_id = p_store.organization_id and p.company_id = p_store.company_id
           and lower(btrim(p.sku)) = lower(v_csku)
         order by (p.store_id = p_store.id) desc nulls last, p.created_at, p.id
         limit 1;
        if not found then
          -- ¿Es el SKU de una VARIANTE? Entonces el componente es esa variante.
          select * into v_cvar from public.product_variants pv
           where pv.organization_id = p_store.organization_id and pv.company_id = p_store.company_id
             and lower(btrim(pv.sku)) = lower(v_csku)
           order by pv.created_at, pv.id limit 1;
          if v_cvar.id is null then
            raise exception 'COMPONENTE_NO_ENCONTRADO: component_sku' using errcode = '22023';
          end if;
          select * into v_comp from public.products p where p.id = v_cvar.product_id;
          if v_cvsku is not null and lower(v_cvsku) <> lower(v_cvar.sku) then
            raise exception 'DATO_DISTINTO: component_variant_sku' using errcode = '22023';
          end if;
        end if;

        if v_comp.kind = 'bundle' then
          raise exception 'KIT_DENTRO_DE_KIT: component_sku' using errcode = '22023';
        end if;
        if v_comp.id = v_kit.id then
          raise exception 'KIT_EN_SI_MISMO: component_sku' using errcode = '22023';
        end if;

        if v_comp.kind = 'variant' and v_cvar.id is null then
          if v_cvsku is null then
            raise exception 'VARIANTE_REQUERIDA: component_variant_sku' using errcode = '22023';
          end if;
          select * into v_cvar from public.product_variants pv
           where pv.product_id = v_comp.id and lower(btrim(pv.sku)) = lower(v_cvsku);
          if v_cvar.id is null then
            raise exception 'VARIANTE_NO_ENCONTRADA: component_variant_sku' using errcode = '22023';
          end if;
        elsif v_comp.kind = 'simple' and v_cvsku is not null then
          raise exception 'VARIANTE_NO_APLICA: component_variant_sku' using errcode = '22023';
        end if;

        v_key := v_comp.id::text || ':' || coalesce(v_cvar.id::text, '');
        if v_key = any (v_seen) then
          raise exception 'COMPONENTE_REPETIDO: component_sku' using errcode = '22023';
        end if;
        v_seen := v_seen || v_key;

        insert into public.bundle_items
          (organization_id, company_id, store_id, bundle_product_id, component_product_id, component_kind,
           component_variant_id, quantity, position)
        values
          (p_store.organization_id, p_store.company_id, coalesce(v_kit.store_id, p_store.id), v_kit.id, v_comp.id,
           v_comp.kind, v_cvar.id, v_qty, cardinality(v_seen) - 1);
        v_components := v_components + 1;

        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'sheet', 'kits', 'row', v_row, 'key', btrim(v_rows -> 0 ->> 'kit_sku') || ' · ' || v_csku,
          'status', case when v_existed then 'updated' else 'created' end));
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
        v_errors := v_errors + 1;
        v_result := v_result || jsonb_build_array(
          ebim.import_row_error('kits', v_row, coalesce(v_csku, v_rows -> 0 ->> 'kit_sku'), v_state, v_msg, v_constraint));
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'errors', v_errors, 'rows', v_result,
    'kits_created', v_k_created, 'kits_updated', v_k_updated, 'components', v_components);
end;
$fn$;

revoke execute on function ebim.import_kit_rows(public.stores, jsonb) from public, anon, authenticated;

create or replace function public.import_catalog_with_kits(
  p_store_id     uuid,
  p_product_rows jsonb,
  p_kit_rows     jsonb,
  p_dry_run      boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype;
  v_prod    jsonb := jsonb_build_object('total', 0, 'created', 0, 'updated', 0, 'errors', 0, 'rows', '[]'::jsonb);
  v_kits    jsonb;
  v_errors  integer;
  v_created integer;
  v_updated integer;
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
  if not ebim.has_capability(v_store.organization_id, v_store.company_id, 'catalog.advanced') then
    raise exception 'MODULO_NO_CONTRATADO: los kits exigen el catalogo avanzado' using errcode = '42501';
  end if;

  perform ebim.import_assert_rows(coalesce(p_kit_rows, '[]'::jsonb),
    array['row', 'kit_sku', 'kit_name', 'price', 'category_slug', 'status',
          'component_sku', 'component_variant_sku', 'quantity'], 2000);
  if jsonb_array_length(coalesce(p_kit_rows, '[]'::jsonb)) = 0 then
    raise exception 'FILAS_INVALIDAS: la hoja de kits esta vacia' using errcode = '22023';
  end if;

  begin
    -- Productos primero, SIN simular: sus escrituras quedan en esta
    -- transacción para que los kits vean los componentes nuevos. Si algo falla
    -- o se está simulando, el bloque se deshace entero al final.
    if jsonb_array_length(coalesce(p_product_rows, '[]'::jsonb)) > 0 then
      v_prod := public.import_catalog_products(p_store_id, p_product_rows, false);
    end if;
    v_kits := ebim.import_kit_rows(v_store, p_kit_rows);

    v_errors := (v_prod ->> 'errors')::integer + (v_kits ->> 'errors')::integer;
    if p_dry_run or v_errors > 0 then
      raise exception 'EBIM_IMPORT_ROLLBACK' using errcode = 'EB001';
    end if;
  exception when sqlstate 'EB001' then
    null;
  end;

  v_created := (v_prod ->> 'created')::integer
             + (select count(*) from jsonb_array_elements(v_kits -> 'rows') r where r ->> 'status' = 'created');
  v_updated := (v_prod ->> 'updated')::integer
             + (select count(*) from jsonb_array_elements(v_kits -> 'rows') r where r ->> 'status' = 'updated');

  return (v_prod - 'rows') || jsonb_build_object(
    'dry_run', p_dry_run,
    'applied', not p_dry_run and v_errors = 0,
    'total', (v_prod ->> 'total')::integer + jsonb_array_length(p_kit_rows),
    'created', v_created,
    'updated', v_updated,
    'errors', v_errors,
    'kits_created', (v_kits ->> 'kits_created')::integer,
    'kits_updated', (v_kits ->> 'kits_updated')::integer,
    'kit_components', (v_kits ->> 'components')::integer,
    'rows', (v_prod -> 'rows') || (v_kits -> 'rows'));
end;
$fn$;

revoke execute on function public.import_catalog_with_kits(uuid, jsonb, jsonb, boolean) from public, anon;
grant  execute on function public.import_catalog_with_kits(uuid, jsonb, jsonb, boolean) to authenticated;

comment on function public.import_catalog_with_kits(uuid, jsonb, jsonb, boolean) is
  'Importa la hoja de productos (si viene) y la de kits en UNA transacción: simular o cualquier error deshace todo. La receta de la hoja reemplaza la del kit.';
