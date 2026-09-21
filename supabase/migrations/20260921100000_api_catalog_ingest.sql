-- =============================================================================
-- API de socio · ingesta de catálogo (`POST /v1/catalog/products:batch`)
--
-- Contrato: docs/integrations/catalog-ingest.md y catalog-ingest.openapi.yaml.
--
-- Un sistema externo (ERP, distribuidor) envía un LOTE de productos y la base:
-- - hace upsert por SKU en el Product Master de la SOCIEDAD de la credencial;
-- - configura la publicación de cada tienda que el lote nombra (y solo esas);
-- - pone precio propio de variante por tienda en `store_price_overrides`;
-- - todo o nada: una fila rechazada deshace el lote entero, y `dry_run` valida
--   y deshace siempre.
--
-- El tenant NO viaja en el cuerpo: sale de la fila de la credencial
-- (`ebim.api_authorize`), igual que en el resto de recursos de la API. Las
-- tiendas se buscan por slug DENTRO de esa sociedad, así que la tienda de otra
-- sociedad no existe para el integrador.
--
-- Estándares: GS1 GTIN (dígito de control verificado), nombres de campo de
-- schema.org, moneda ISO 4217 e importes como cadena decimal.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Scope nuevo. La lista es el contrato: la comparan los tests con
--    `src/domain/api.ts` y `_shared/api/contract.ts`.
-- ---------------------------------------------------------------------------
create or replace function ebim.api_scope_catalog()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array[
    'order.read',
    'order.create',
    'product.read',
    'stock.read',
    'customer.read',
    'catalog.write'
  ]::text[];
$fn$;

-- ---------------------------------------------------------------------------
-- 2. GTIN del producto simple. La variante ya tiene su código de barras
--    (`product_variants.barcode`); el producto no tenía dónde guardarlo.
--    La base exige la forma; el dígito de control lo verifica la ingesta.
-- ---------------------------------------------------------------------------
alter table public.products add column gtin text;
alter table public.products
  add constraint products_gtin_fmt check (gtin is null or gtin ~ '^([0-9]{8}|[0-9]{12,14})$');
create unique index products_company_gtin_key
  on public.products (organization_id, company_id, gtin)
  where gtin is not null;
comment on column public.products.gtin is
  'GS1 GTIN-8/12/13/14 del producto, único en la sociedad. El de cada variante va en product_variants.barcode.';

-- ---------------------------------------------------------------------------
-- 3. Piezas de lectura del lote. Cada error sale como `CODIGO: mensaje` y
--    lleva en HINT la ruta JSON del campo, que es lo que el socio necesita
--    para arreglar su envío.
-- ---------------------------------------------------------------------------
create or replace function ebim.api_catalog_fail(p_code text, p_field text, p_message text)
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception '%: %', p_code, p_message using errcode = '22023', hint = coalesce(p_field, '');
end;
$fn$;

create or replace function ebim.gtin_is_valid(p_gtin text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_gtin is null or p_gtin !~ '^([0-9]{8}|[0-9]{12,14})$' then false
    else (
      select (10 - (sum(substr(p_gtin, length(p_gtin) - i, 1)::int
                        * case when i % 2 = 1 then 3 else 1 end) % 10)) % 10
      from generate_series(1, length(p_gtin) - 1) as i
    ) = substr(p_gtin, length(p_gtin), 1)::int
  end;
$fn$;

create or replace function ebim.api_assert_keys(p_obj jsonb, p_allowed text[], p_path text)
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_key text;
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    perform ebim.api_catalog_fail('VALOR_INVALIDO', p_path, 'se espera un objeto');
  end if;
  select k.key into v_key
  from jsonb_object_keys(p_obj) as k(key)
  where k.key <> all (p_allowed)
  order by k.key
  limit 1;
  if v_key is not null then
    perform ebim.api_catalog_fail('CAMPO_NO_PERMITIDO', p_path || '.' || v_key,
                                  format('el campo %s no existe en el contrato', v_key));
  end if;
end;
$fn$;

create or replace function ebim.api_text_in(p_obj jsonb, p_key text, p_max integer, p_field text)
returns text
language plpgsql
set search_path = ''
as $fn$
declare
  v_value jsonb := p_obj -> p_key;
  v_text  text;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_value) <> 'string' then
    perform ebim.api_catalog_fail('VALOR_INVALIDO', p_field, 'se espera texto');
  end if;
  v_text := nullif(btrim(v_value #>> '{}'), '');
  if v_text is not null and char_length(v_text) > p_max then
    perform ebim.api_catalog_fail('VALOR_INVALIDO', p_field, format('como maximo %s caracteres', p_max));
  end if;
  return v_text;
end;
$fn$;

create or replace function ebim.api_int_in(p_value jsonb, p_field text)
returns integer
language plpgsql
set search_path = ''
as $fn$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,9}$' then
    perform ebim.api_catalog_fail('VALOR_INVALIDO', p_field, 'se espera un entero mayor o igual a cero');
  end if;
  return (p_value #>> '{}')::integer;
end;
$fn$;

-- Importe: cadena decimal y nunca número JSON, que al otro lado se lee como
-- double y descuadra céntimos.
create or replace function ebim.api_money_in(p_value jsonb, p_field text)
returns numeric
language plpgsql
set search_path = ''
as $fn$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    perform ebim.api_catalog_fail('VALOR_INVALIDO', p_field,
                                  'el importe va como cadena decimal, por ejemplo "101.90"');
  end if;
  return (p_value #>> '{}')::numeric;
end;
$fn$;

-- La huella de lo que el lote puede tocar de un producto. Si no cambia, la fila
-- sale como `unchanged`: un ERP que reenvía el catálogo entero cada noche ve
-- qué cambió de verdad.
create or replace function ebim.api_product_fingerprint(p_product_id uuid)
returns text
language sql
stable
set search_path = ''
as $fn$
  select md5(jsonb_build_array(
    (select to_jsonb(p) - array['created_at', 'updated_at', 'search_vector']
       from public.products p where p.id = p_product_id),
    (select coalesce(jsonb_agg(to_jsonb(v) - array['created_at', 'updated_at'] order by v.id), '[]'::jsonb)
       from public.product_variants v where v.product_id = p_product_id),
    (select coalesce(jsonb_agg(to_jsonb(a) - array['id', 'created_at', 'updated_at'] order by a.attribute_id), '[]'::jsonb)
       from public.product_attribute_values a where a.product_id = p_product_id),
    (select coalesce(jsonb_agg(to_jsonb(a) - array['id', 'created_at', 'updated_at']
                               order by a.variant_id, a.attribute_id), '[]'::jsonb)
       from public.variant_attribute_values a
       join public.product_variants v on v.id = a.variant_id
      where v.product_id = p_product_id)
  )::text);
$fn$;

create or replace function ebim.api_publication_fingerprint(p_product_id uuid, p_store_id uuid)
returns text
language sql
stable
set search_path = ''
as $fn$
  select md5(jsonb_build_array(
    (select to_jsonb(sp) - array['created_at', 'updated_at']
       from public.store_products sp where sp.product_id = p_product_id and sp.store_id = p_store_id),
    (select coalesce(jsonb_agg(to_jsonb(o) - array['id', 'created_at', 'updated_at']
                               order by o.variant_id, o.uom_id), '[]'::jsonb)
       from public.store_price_overrides o
      where o.product_id = p_product_id and o.store_id = p_store_id)
  )::text);
$fn$;

-- Error de una fila en el vocabulario del contrato. Un error interno nunca sale
-- con su texto: se nombra el campo y se da un código estable.
create or replace function ebim.api_catalog_error(
  p_state      text,
  p_message    text,
  p_field      text,
  p_constraint text
)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'code', c.code,
    'field', coalesce(nullif(p_field, ''), 'products'),
    'message', c.message)
  from (
    select
      case
        when p_message ~ '^[A-Z][A-Z0-9_]{2,60}: ' then substring(p_message from '^([A-Z][A-Z0-9_]{2,60}): ')
        when p_state = '23505' and p_constraint = 'store_products_slug_key' then 'SLUG_DUPLICADO'
        when p_state = '23505' and p_constraint in ('products_company_sku_key', 'product_variants_company_sku_key')
          then 'SKU_DUPLICADO'
        when p_state = '23505' and p_constraint in ('products_company_gtin_key', 'product_variants_barcode_key')
          then 'GTIN_EN_OTRO_PRODUCTO'
        when p_state = '23505' then 'DUPLICADO'
        when p_state = '23514' then 'VALOR_INVALIDO'
        when p_state = '23503' then 'REFERENCIA_INVALIDA'
        when p_state like '22%' then 'FORMATO_INVALIDO'
        else 'ERROR_INTERNO'
      end as code,
      case
        when p_message ~ '^[A-Z][A-Z0-9_]{2,60}: ' then substring(p_message from '^[A-Z][A-Z0-9_]{2,60}: (.*)$')
        when p_state = '23505' and p_constraint = 'store_products_slug_key'
          then 'la tienda ya tiene un producto con ese slug'
        when p_state = '23505' then 'el valor ya existe en esta sociedad'
        when p_state = '23514' then 'un valor no cumple las reglas del catalogo'
        when p_state = '23503' then 'una referencia no existe'
        when p_state like '22%' then 'el valor no tiene el formato esperado'
        else 'error interno al procesar el producto'
      end as message
  ) c;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. El recurso
-- ---------------------------------------------------------------------------
create or replace function public.api_catalog_upsert(
  p_api_client_id uuid,
  p_payload       jsonb,
  p_dry_run       boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_client       public.api_clients%rowtype;
  v_org          uuid;
  v_company      uuid;
  v_advanced     boolean;
  v_products     jsonb;
  v_count        integer;
  v_dupes        text[];
  v_p            jsonb;
  v_idx          integer;
  v_path         text;
  v_field        text;
  v_sku          text;
  v_product      public.products%rowtype;
  v_existed      boolean;
  v_before       text;
  v_kind_in      text;
  v_kind         public.product_kind;
  v_name         text;
  v_desc         text;
  v_gtin         text;
  v_brand        uuid;
  v_family       uuid;
  v_tax          uuid;
  v_code         text;
  v_stock        integer;
  v_custom       jsonb;
  v_has_variants boolean;
  -- ficha técnica
  v_key          text;
  v_val          jsonb;
  v_attr         public.attributes%rowtype;
  v_value_id     uuid;
  v_value_label  text;
  v_text         text;
  v_number       numeric;
  v_bool         boolean;
  v_date         date;
  -- publicaciones
  v_pub          jsonb;
  v_pidx         integer;
  v_ppath        text;
  v_store        public.stores%rowtype;
  v_seen_stores  text[];
  v_currency     text;
  v_price        numeric;
  v_compare      numeric;
  v_status_in    text;
  v_pstatus      public.product_status;
  v_category     uuid;
  v_pslug        text;
  v_slug_base    text;
  v_n            integer;
  v_sp           public.store_products%rowtype;
  v_pubs         jsonb;
  v_pub_out      jsonb;
  v_pub_item     jsonb;
  v_pub_changed  boolean;
  -- variantes
  v_var          jsonb;
  v_vidx         integer;
  v_vpath        text;
  v_vsku         text;
  v_vgtin        text;
  v_vname        text;
  v_vstock       integer;
  v_active       boolean;
  v_axis_attrs   uuid[];
  v_axis_values  uuid[];
  v_labels       text[];
  v_variant      public.product_variants%rowtype;
  v_vprice_obj   jsonb;
  v_vpp          integer;
  v_vppath       text;
  v_price_stores text[];
  v_has_compare  boolean;
  -- resultado
  v_status       text;
  v_items        jsonb := '[]'::jsonb;
  v_created      integer := 0;
  v_updated      integer := 0;
  v_unchanged    integer := 0;
  v_rejected     integer := 0;
  v_applied      boolean;
  v_state        text;
  v_msg          text;
  v_hint         text;
  v_constraint   text;
begin
  v_client  := ebim.api_authorize(p_api_client_id, 'catalog.write');
  v_org     := v_client.organization_id;
  v_company := v_client.company_id;

  -- Forma del lote: lo que no se puede leer fila por fila es un 400 del lote.
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'LOTE_INVALIDO: el cuerpo tiene que ser un objeto con "products"' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) as k(key) where k.key <> 'products') then
    raise exception 'CAMPO_NO_PERMITIDO: el lote solo admite "products"; la sociedad la define la credencial'
      using errcode = '22023';
  end if;
  v_products := p_payload -> 'products';
  if v_products is null or jsonb_typeof(v_products) <> 'array' or jsonb_array_length(v_products) = 0 then
    raise exception 'LOTE_INVALIDO: products tiene que ser una lista con al menos un producto' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(v_products);
  if v_count > 500 then
    raise exception 'LOTE_EXCESIVO: como maximo 500 productos por lote' using errcode = '22023';
  end if;

  v_advanced := ebim.company_is_entitled(v_org, v_company, 'catalog.advanced');

  -- Un SKU repetido dentro del lote (entre productos y variantes) es ambiguo:
  -- no se adivina cuál manda, se rechazan todas sus apariciones.
  select coalesce(array_agg(d.k), '{}') into v_dupes
  from (
    select lower(btrim(x.sku)) as k
    from (
      select e.item ->> 'sku' as sku
      from jsonb_array_elements(v_products) as e(item)
      where jsonb_typeof(e.item) = 'object'
      union all
      select v.item ->> 'sku'
      from jsonb_array_elements(v_products) as e(item),
           jsonb_array_elements(case when jsonb_typeof(e.item) = 'object'
                                      and jsonb_typeof(e.item -> 'variants') = 'array'
                                     then e.item -> 'variants' else '[]'::jsonb end) as v(item)
      where jsonb_typeof(v.item) = 'object'
    ) x
    where coalesce(btrim(x.sku), '') <> ''
    group by 1
    having count(*) > 1
  ) d;

  begin
    for v_p, v_idx in
      select e.item, (e.ord - 1)::integer
      from jsonb_array_elements(v_products) with ordinality as e(item, ord)
      order by e.ord
    loop
      v_path := format('products[%s]', v_idx);
      v_field := v_path;
      v_sku := null;
      v_pubs := '[]'::jsonb;

      begin
        perform ebim.api_assert_keys(v_p,
          array['sku', 'gtin', 'name', 'description', 'kind', 'brand_code', 'family_code',
                'tax_category_code', 'stock', 'attributes', 'custom_fields', 'variants', 'publications'],
          v_path);

        v_field := v_path || '.sku';
        v_sku := ebim.api_text_in(v_p, 'sku', 64, v_field);
        if v_sku is null then
          perform ebim.api_catalog_fail('CAMPO_REQUERIDO', v_field, 'cada producto se identifica por su sku');
        end if;
        if lower(v_sku) = any (v_dupes) then
          perform ebim.api_catalog_fail('SKU_REPETIDO_EN_LOTE', v_field,
                                        format('el sku %s aparece mas de una vez en el lote', v_sku));
        end if;

        select * into v_product
        from public.products p
        where p.organization_id = v_org and p.company_id = v_company
          and lower(btrim(p.sku)) = lower(v_sku)
        order by p.legacy_sku_conflict, p.created_at, p.id
        limit 1;
        v_existed := found;
        v_before := case when v_existed then ebim.api_product_fingerprint(v_product.id) end;

        if not v_existed and exists (
          select 1 from public.product_variants pv
          where pv.organization_id = v_org and pv.company_id = v_company
            and lower(btrim(pv.sku)) = lower(v_sku)
        ) then
          perform ebim.api_catalog_fail('SKU_DUPLICADO', v_field,
                                        format('el sku %s ya es de una variante', v_sku));
        end if;

        -- --- Maestro ---------------------------------------------------------
        v_field := v_path || '.name';
        v_name := ebim.api_text_in(v_p, 'name', 240, v_field);
        if v_name is null and (v_p ? 'name' or not v_existed) then
          perform ebim.api_catalog_fail('CAMPO_REQUERIDO', v_field, 'el producto necesita nombre');
        end if;
        if v_name is not null and char_length(v_name) < 2 then
          perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'el nombre necesita al menos 2 caracteres');
        end if;

        v_field := v_path || '.description';
        v_desc := ebim.api_text_in(v_p, 'description', 8000, v_field);

        v_field := v_path || '.gtin';
        v_gtin := ebim.api_text_in(v_p, 'gtin', 14, v_field);
        if v_gtin is not null then
          if not ebim.gtin_is_valid(v_gtin) then
            perform ebim.api_catalog_fail('GTIN_INVALIDO', v_field,
                                          'GTIN-8/12/13/14 con digito de control valido');
          end if;
          if exists (
            select 1 from public.products p
            where p.organization_id = v_org and p.company_id = v_company and p.gtin = v_gtin
              and p.id is distinct from v_product.id
          ) or exists (
            select 1 from public.product_variants pv
            where pv.organization_id = v_org and pv.company_id = v_company and pv.barcode = v_gtin
              and pv.product_id is distinct from v_product.id
          ) then
            perform ebim.api_catalog_fail('GTIN_EN_OTRO_PRODUCTO', v_field,
                                          format('el GTIN %s ya es de otro articulo', v_gtin));
          end if;
        end if;

        v_field := v_path || '.variants';
        v_has_variants := case when jsonb_typeof(v_p -> 'variants') = 'array'
                               then jsonb_array_length(v_p -> 'variants') > 0 else false end;
        if v_p ? 'variants' and jsonb_typeof(v_p -> 'variants') <> 'array' then
          perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'variants es una lista');
        end if;
        if v_has_variants and jsonb_array_length(v_p -> 'variants') > 50 then
          perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'como maximo 50 variantes por producto');
        end if;

        v_field := v_path || '.kind';
        v_kind_in := ebim.api_text_in(v_p, 'kind', 20, v_field);
        if v_kind_in is not null and v_kind_in not in ('simple', 'variant') then
          perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'kind es simple o variant');
        end if;
        if v_existed then
          if v_kind_in is not null and v_kind_in <> v_product.kind::text then
            perform ebim.api_catalog_fail('TIPO_DISTINTO', v_field,
                                          format('el producto ya existe como %s', v_product.kind));
          end if;
          v_kind := v_product.kind;
        else
          v_kind := coalesce(v_kind_in, case when v_has_variants then 'variant' else 'simple' end)::public.product_kind;
        end if;
        if v_has_variants and v_kind <> 'variant' then
          perform ebim.api_catalog_fail('TIPO_DISTINTO', v_path || '.variants',
                                        'solo un producto con variantes (kind=variant) lleva variants');
        end if;
        if not v_existed and v_kind = 'variant' and not v_has_variants then
          perform ebim.api_catalog_fail('CAMPO_REQUERIDO', v_path || '.variants',
                                        'un producto con variantes nace con al menos una');
        end if;
        if v_has_variants and not v_advanced then
          perform ebim.api_catalog_fail('MODULO_NO_CONTRATADO', v_path || '.variants',
                                        'las variantes requieren el catalogo avanzado');
        end if;

        v_field := v_path || '.brand_code';
        v_brand := null;
        v_code := lower(ebim.api_text_in(v_p, 'brand_code', 41, v_field));
        if v_code is not null then
          if not v_advanced then
            perform ebim.api_catalog_fail('MODULO_NO_CONTRATADO', v_field, 'las marcas requieren el catalogo avanzado');
          end if;
          select b.id into v_brand from public.brands b
          where b.organization_id = v_org and b.company_id = v_company and lower(b.code) = v_code;
          if v_brand is null then
            perform ebim.api_catalog_fail('MARCA_NO_ENCONTRADA', v_field, format('no hay ninguna marca %s', v_code));
          end if;
        end if;

        v_field := v_path || '.family_code';
        v_family := null;
        v_code := lower(ebim.api_text_in(v_p, 'family_code', 41, v_field));
        if v_code is not null then
          if not v_advanced then
            perform ebim.api_catalog_fail('MODULO_NO_CONTRATADO', v_field, 'las familias requieren el catalogo avanzado');
          end if;
          select f.id into v_family from public.product_families f
          where f.organization_id = v_org and f.company_id = v_company and lower(f.code) = v_code;
          if v_family is null then
            perform ebim.api_catalog_fail('FAMILIA_NO_ENCONTRADA', v_field, format('no hay ninguna familia %s', v_code));
          end if;
        end if;

        v_field := v_path || '.tax_category_code';
        v_tax := null;
        v_code := lower(ebim.api_text_in(v_p, 'tax_category_code', 41, v_field));
        if v_code is not null then
          select t.id into v_tax from public.tax_categories t
          where t.organization_id = v_org and t.company_id = v_company and lower(t.code) = v_code;
          if v_tax is null then
            perform ebim.api_catalog_fail('CATEGORIA_FISCAL_NO_ENCONTRADA', v_field,
                                          format('no hay ninguna categoria fiscal %s', v_code));
          end if;
        end if;

        v_field := v_path || '.stock';
        v_stock := ebim.api_int_in(v_p -> 'stock', v_field);
        if v_stock is not null and v_kind <> 'simple' then
          perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field,
                                        'el stock de un producto con variantes va en cada variante');
        end if;

        v_field := v_path || '.custom_fields';
        v_custom := v_p -> 'custom_fields';
        if v_p ? 'custom_fields' and jsonb_typeof(v_custom) <> 'object' then
          perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'custom_fields es un objeto');
        end if;
        if v_custom is not null and length(v_custom::text) > 16000 then
          perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'custom_fields demasiado grande');
        end if;

        v_field := v_path;
        if not v_existed then
          insert into public.products
            (organization_id, company_id, sku, name, description, gtin, kind, stock,
             brand_id, family_id, tax_category_id, custom_fields)
          values
            (v_org, v_company, v_sku, v_name, v_desc, v_gtin, v_kind,
             case when v_kind = 'simple' then coalesce(v_stock, 0) else 0 end,
             v_brand, v_family, v_tax, coalesce(jsonb_strip_nulls(v_custom), '{}'::jsonb))
          returning * into v_product;
        else
          update public.products p set
            name            = coalesce(v_name, p.name),
            description     = case when v_p ? 'description' then v_desc else p.description end,
            gtin            = case when v_p ? 'gtin' then v_gtin else p.gtin end,
            brand_id        = case when v_p ? 'brand_code' then v_brand else p.brand_id end,
            family_id       = case when v_p ? 'family_code' then v_family else p.family_id end,
            tax_category_id = case when v_p ? 'tax_category_code' then v_tax else p.tax_category_id end,
            stock           = case when p.kind = 'simple' then coalesce(v_stock, p.stock) else p.stock end,
            custom_fields   = case
                                when v_p ? 'custom_fields' then (
                                  select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
                                  from jsonb_each(p.custom_fields || v_custom) as c(key, value)
                                  where jsonb_typeof(c.value) <> 'null')
                                else p.custom_fields
                              end
          where p.id = v_product.id
          returning * into v_product;
        end if;

        -- --- Ficha técnica ---------------------------------------------------
        if v_p ? 'attributes' then
          if jsonb_typeof(v_p -> 'attributes') <> 'object' then
            perform ebim.api_catalog_fail('VALOR_INVALIDO', v_path || '.attributes', 'attributes es un objeto');
          end if;
          if not v_advanced and v_p -> 'attributes' <> '{}'::jsonb then
            perform ebim.api_catalog_fail('MODULO_NO_CONTRATADO', v_path || '.attributes',
                                          'la ficha tecnica requiere el catalogo avanzado');
          end if;
          for v_key, v_val in select a.key, a.value from jsonb_each(v_p -> 'attributes') as a(key, value) order by a.key loop
            v_field := v_path || '.attributes.' || v_key;
            select * into v_attr from public.attributes a
            where a.organization_id = v_org and a.company_id = v_company and lower(a.code) = lower(v_key);
            if not found then
              perform ebim.api_catalog_fail('ATRIBUTO_NO_ENCONTRADO', v_field, format('no hay ningun atributo %s', v_key));
            end if;
            if v_attr.is_variant_axis then
              perform ebim.api_catalog_fail('ES_EJE', v_field, 'un eje de variante va en variants[].axes');
            end if;

            if jsonb_typeof(v_val) = 'null' then
              delete from public.product_attribute_values pav
              where pav.product_id = v_product.id and pav.attribute_id = v_attr.id;
              continue;
            end if;

            v_value_id := null; v_text := null; v_number := null; v_bool := null; v_date := null;
            if v_attr.data_type = 'option' then
              if jsonb_typeof(v_val) not in ('string', 'number') then
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'se espera el codigo del valor');
              end if;
              select av.id into v_value_id from public.attribute_values av
              where av.attribute_id = v_attr.id
                and (lower(av.code) = lower(btrim(v_val #>> '{}')) or lower(av.label) = lower(btrim(v_val #>> '{}')))
              order by (lower(av.code) = lower(btrim(v_val #>> '{}'))) desc
              limit 1;
              if v_value_id is null then
                perform ebim.api_catalog_fail('VALOR_NO_ENCONTRADO', v_field,
                                              format('%s no es un valor de %s', v_val #>> '{}', v_attr.code));
              end if;
            elsif v_attr.data_type = 'text' then
              if jsonb_typeof(v_val) not in ('string', 'number') then
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'se espera texto');
              end if;
              v_text := nullif(btrim(v_val #>> '{}'), '');
              if v_text is null or char_length(v_text) > 500 then
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'texto de 1 a 500 caracteres');
              end if;
            elsif v_attr.data_type = 'number' then
              if jsonb_typeof(v_val) = 'number' then
                v_number := (v_val #>> '{}')::numeric;
              elsif jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') ~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' then
                v_number := btrim(v_val #>> '{}')::numeric;
              else
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'se espera un numero');
              end if;
            elsif v_attr.data_type = 'boolean' then
              if jsonb_typeof(v_val) <> 'boolean' then
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'se espera true o false');
              end if;
              v_bool := (v_val #>> '{}')::boolean;
            else
              if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'se espera una fecha AAAA-MM-DD');
              end if;
              v_date := (v_val #>> '{}')::date;
            end if;

            insert into public.product_attribute_values
              (organization_id, company_id, product_id, attribute_id,
               value_id, value_text, value_number, value_boolean, value_date)
            values
              (v_org, v_company, v_product.id, v_attr.id, v_value_id, v_text, v_number, v_bool, v_date)
            on conflict (product_id, attribute_id) do update set
              value_id = excluded.value_id, value_text = excluded.value_text,
              value_number = excluded.value_number, value_boolean = excluded.value_boolean,
              value_date = excluded.value_date;
          end loop;
        end if;

        -- --- Publicaciones por tienda (antes que las variantes: su precio por
        --     tienda cuelga de la publicación) ---------------------------------
        if v_p ? 'publications' then
          v_field := v_path || '.publications';
          if jsonb_typeof(v_p -> 'publications') <> 'array' then
            perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'publications es una lista');
          end if;
          if jsonb_array_length(v_p -> 'publications') > 20 then
            perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'como maximo 20 tiendas por producto');
          end if;
          v_seen_stores := '{}';

          for v_pub, v_pidx in
            select e.item, (e.ord - 1)::integer
            from jsonb_array_elements(v_p -> 'publications') with ordinality as e(item, ord)
            order by e.ord
          loop
            v_ppath := format('%s.publications[%s]', v_path, v_pidx);
            perform ebim.api_assert_keys(v_pub,
              array['store', 'slug', 'category_slug', 'status', 'price', 'compare_at_price', 'currency'], v_ppath);

            v_field := v_ppath || '.store';
            v_code := lower(ebim.api_text_in(v_pub, 'store', 63, v_field));
            if v_code is null then
              perform ebim.api_catalog_fail('CAMPO_REQUERIDO', v_field, 'la publicacion nombra su tienda');
            end if;
            if v_code = any (v_seen_stores) then
              perform ebim.api_catalog_fail('TIENDA_REPETIDA', v_field, format('la tienda %s aparece dos veces', v_code));
            end if;
            v_seen_stores := v_seen_stores || v_code;
            select * into v_store from public.stores s
            where s.organization_id = v_org and s.company_id = v_company and lower(s.slug) = v_code;
            if not found then
              perform ebim.api_catalog_fail('TIENDA_NO_ENCONTRADA', v_field,
                                            format('no hay ninguna tienda %s en esta sociedad', v_code));
            end if;

            v_field := v_ppath || '.currency';
            v_currency := upper(ebim.api_text_in(v_pub, 'currency', 3, v_field));
            if v_currency is not null and v_currency <> v_store.currency then
              perform ebim.api_catalog_fail('MONEDA_INCONSISTENTE', v_field,
                                            format('la tienda %s vende en %s', v_store.slug, v_store.currency));
            end if;

            v_field := v_ppath || '.price';
            v_price := ebim.api_money_in(v_pub -> 'price', v_field);
            if v_pub ? 'price' and v_price is null then
              perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'el precio no puede quedar vacio');
            end if;
            v_field := v_ppath || '.compare_at_price';
            v_compare := ebim.api_money_in(v_pub -> 'compare_at_price', v_field);

            v_field := v_ppath || '.status';
            v_status_in := ebim.api_text_in(v_pub, 'status', 20, v_field);
            if v_status_in is not null and v_status_in not in ('draft', 'published', 'archived') then
              perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'status es draft, published o archived');
            end if;
            v_pstatus := v_status_in::public.product_status;

            v_field := v_ppath || '.category_slug';
            v_category := null;
            v_code := lower(ebim.api_text_in(v_pub, 'category_slug', 81, v_field));
            if v_code is not null then
              select c.id into v_category from public.categories c
              where c.store_id = v_store.id and lower(c.slug) = v_code;
              if v_category is null then
                perform ebim.api_catalog_fail('CATEGORIA_NO_ENCONTRADA', v_field,
                                              format('la categoria %s no existe en la tienda %s', v_code, v_store.slug));
              end if;
            end if;

            v_field := v_ppath || '.slug';
            v_pslug := lower(ebim.api_text_in(v_pub, 'slug', 121, v_field));
            if v_pub ? 'slug' and v_pslug is null then
              perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'el slug no puede quedar vacio');
            end if;
            if v_pslug is not null and v_pslug !~ '^[a-z0-9][a-z0-9-]{0,120}$' then
              perform ebim.api_catalog_fail('SLUG_INVALIDO', v_field, 'minusculas, numeros y guiones');
            end if;

            v_field := v_ppath;
            select * into v_sp from public.store_products sp
            where sp.product_id = v_product.id and sp.store_id = v_store.id;

            if found then
              v_pubs := v_pubs || jsonb_build_array(jsonb_build_object(
                'store', v_store.slug, 'store_id', v_store.id, 'status', 'updated',
                'before', ebim.api_publication_fingerprint(v_product.id, v_store.id)));
              update public.store_products sp set
                slug             = coalesce(v_pslug, sp.slug),
                category_id      = case when v_pub ? 'category_slug' then v_category else sp.category_id end,
                status           = coalesce(v_pstatus, sp.status),
                published_at     = case
                                     when coalesce(v_pstatus, sp.status) = 'published'
                                       then coalesce(sp.published_at, now())
                                     else sp.published_at
                                   end,
                price            = coalesce(v_price, sp.price),
                compare_at_price = case when v_pub ? 'compare_at_price' then v_compare else sp.compare_at_price end
              where sp.id = v_sp.id;
            else
              if v_price is null then
                perform ebim.api_catalog_fail('CAMPO_REQUERIDO', v_ppath || '.price',
                                              'una publicacion nueva necesita precio');
              end if;
              if v_pslug is null then
                -- Sin slug se deriva del nombre y, si ya está tomado, se numera.
                v_slug_base := ebim.import_slug(v_product.name, 110);
                if v_slug_base is null then
                  perform ebim.api_catalog_fail('SLUG_INVALIDO', v_ppath || '.slug',
                                                'no se puede derivar un slug del nombre; envialo');
                end if;
                v_pslug := v_slug_base;
                v_n := 1;
                while exists (
                  select 1 from public.store_products sp
                  where sp.store_id = v_store.id and lower(sp.slug) = v_pslug
                ) loop
                  v_n := v_n + 1;
                  v_pslug := v_slug_base || '-' || v_n;
                end loop;
              end if;

              insert into public.store_products
                (organization_id, company_id, store_id, product_id, category_id, slug, status,
                 published_at, price, compare_at_price, currency)
              values
                (v_org, v_company, v_store.id, v_product.id, v_category, v_pslug,
                 coalesce(v_pstatus, 'draft'),
                 case when coalesce(v_pstatus, 'draft') = 'published' then now() end,
                 v_price, v_compare, v_store.currency);
              perform ebim.adopt_origin_store(v_product.id, v_store.id);
              v_pubs := v_pubs || jsonb_build_array(jsonb_build_object(
                'store', v_store.slug, 'store_id', v_store.id, 'status', 'created'));
            end if;
          end loop;
        end if;

        -- --- Variantes -------------------------------------------------------
        if v_has_variants then
          for v_var, v_vidx in
            select e.item, (e.ord - 1)::integer
            from jsonb_array_elements(v_p -> 'variants') with ordinality as e(item, ord)
            order by e.ord
          loop
            v_vpath := format('%s.variants[%s]', v_path, v_vidx);
            perform ebim.api_assert_keys(v_var,
              array['sku', 'gtin', 'name', 'axes', 'stock', 'active', 'prices'], v_vpath);

            v_field := v_vpath || '.sku';
            v_vsku := ebim.api_text_in(v_var, 'sku', 64, v_field);
            if v_vsku is null then
              perform ebim.api_catalog_fail('CAMPO_REQUERIDO', v_field, 'cada variante se identifica por su sku');
            end if;
            if lower(v_vsku) = any (v_dupes) then
              perform ebim.api_catalog_fail('SKU_REPETIDO_EN_LOTE', v_field,
                                            format('el sku %s aparece mas de una vez en el lote', v_vsku));
            end if;

            select * into v_variant from public.product_variants pv
            where pv.organization_id = v_org and pv.company_id = v_company
              and lower(btrim(pv.sku)) = lower(v_vsku)
            order by pv.legacy_sku_conflict, pv.created_at, pv.id
            limit 1;
            if found and v_variant.product_id <> v_product.id then
              perform ebim.api_catalog_fail('VARIANTE_DE_OTRO_PRODUCTO', v_field,
                                            format('la variante %s es de otro producto', v_vsku));
            end if;
            if not found then
              v_variant := null;
            end if;

            v_field := v_vpath || '.gtin';
            v_vgtin := ebim.api_text_in(v_var, 'gtin', 14, v_field);
            if v_vgtin is not null then
              if not ebim.gtin_is_valid(v_vgtin) then
                perform ebim.api_catalog_fail('GTIN_INVALIDO', v_field,
                                              'GTIN-8/12/13/14 con digito de control valido');
              end if;
              if exists (
                select 1 from public.products p
                where p.organization_id = v_org and p.company_id = v_company and p.gtin = v_vgtin
              ) or exists (
                select 1 from public.product_variants pv
                where pv.organization_id = v_org and pv.company_id = v_company and pv.barcode = v_vgtin
                  and pv.id is distinct from v_variant.id
              ) then
                perform ebim.api_catalog_fail('GTIN_EN_OTRO_PRODUCTO', v_field,
                                              format('el GTIN %s ya es de otro articulo', v_vgtin));
              end if;
            end if;

            v_field := v_vpath || '.name';
            v_vname := ebim.api_text_in(v_var, 'name', 240, v_field);
            if v_var ? 'name' and v_vname is null then
              perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'el nombre no puede quedar vacio');
            end if;

            v_field := v_vpath || '.stock';
            v_vstock := ebim.api_int_in(v_var -> 'stock', v_field);

            v_field := v_vpath || '.active';
            v_active := null;
            if v_var ? 'active' then
              if jsonb_typeof(v_var -> 'active') <> 'boolean' then
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'se espera true o false');
              end if;
              v_active := (v_var ->> 'active')::boolean;
            end if;

            -- Los ejes se resuelven ANTES de escribir: un valor que no existe no
            -- deja una variante a medias.
            v_axis_attrs := '{}';
            v_axis_values := '{}';
            v_labels := '{}';
            if v_var ? 'axes' then
              v_field := v_vpath || '.axes';
              if jsonb_typeof(v_var -> 'axes') <> 'object' then
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'axes es un objeto {atributo: valor}');
              end if;
              for v_key, v_val in select a.key, a.value from jsonb_each(v_var -> 'axes') as a(key, value) order by a.key loop
                v_field := v_vpath || '.axes.' || v_key;
                if jsonb_typeof(v_val) not in ('string', 'number') then
                  perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'se espera el codigo del valor');
                end if;
                select * into v_attr from public.attributes a
                where a.organization_id = v_org and a.company_id = v_company and lower(a.code) = lower(v_key);
                if not found then
                  perform ebim.api_catalog_fail('ATRIBUTO_NO_ENCONTRADO', v_field, format('no hay ningun atributo %s', v_key));
                end if;
                if not v_attr.is_variant_axis then
                  perform ebim.api_catalog_fail('NO_ES_EJE', v_field, format('%s no es un eje de variante', v_attr.code));
                end if;
                v_value_id := null;
                select av.id, av.label into v_value_id, v_value_label from public.attribute_values av
                where av.attribute_id = v_attr.id
                  and (lower(av.code) = lower(btrim(v_val #>> '{}')) or lower(av.label) = lower(btrim(v_val #>> '{}')))
                order by (lower(av.code) = lower(btrim(v_val #>> '{}'))) desc
                limit 1;
                if v_value_id is null then
                  perform ebim.api_catalog_fail('VALOR_NO_ENCONTRADO', v_field,
                                                format('%s no es un valor de %s', v_val #>> '{}', v_attr.code));
                end if;
                v_axis_attrs := v_axis_attrs || v_attr.id;
                v_axis_values := v_axis_values || v_value_id;
                v_labels := v_labels || v_value_label;
              end loop;
            end if;

            v_field := v_vpath;
            if v_variant.id is not null then
              update public.product_variants pv set
                name      = coalesce(v_vname, pv.name),
                barcode   = case when v_var ? 'gtin' then v_vgtin else pv.barcode end,
                stock     = coalesce(v_vstock, pv.stock),
                is_active = coalesce(v_active, pv.is_active)
              where pv.id = v_variant.id
              returning * into v_variant;
            else
              insert into public.product_variants
                (organization_id, company_id, product_id, sku, name, barcode, stock, is_active, position, is_default)
              values
                (v_org, v_company, v_product.id, v_vsku,
                 left(coalesce(
                   v_vname,
                   v_product.name || case when cardinality(v_labels) > 0
                                          then ' · ' || array_to_string(v_labels, ' / ') else '' end
                 ), 240),
                 v_vgtin, coalesce(v_vstock, 0), coalesce(v_active, true),
                 (select count(*) from public.product_variants pv where pv.product_id = v_product.id),
                 not exists (
                   select 1 from public.product_variants pv where pv.product_id = v_product.id and pv.is_default
                 ))
              returning * into v_variant;
            end if;

            insert into public.variant_attribute_values
              (organization_id, company_id, variant_id, attribute_id, value_id)
            select v_org, v_company, v_variant.id, a.attribute_id, a.value_id
            from unnest(v_axis_attrs, v_axis_values) as a(attribute_id, value_id)
            on conflict (variant_id, attribute_id) do update set value_id = excluded.value_id;

            -- Precio propio de la variante EN una tienda.
            if v_var ? 'prices' then
              v_field := v_vpath || '.prices';
              if jsonb_typeof(v_var -> 'prices') <> 'array' then
                perform ebim.api_catalog_fail('VALOR_INVALIDO', v_field, 'prices es una lista');
              end if;
              v_price_stores := '{}';
              for v_vprice_obj, v_vpp in
                select e.item, (e.ord - 1)::integer
                from jsonb_array_elements(v_var -> 'prices') with ordinality as e(item, ord)
                order by e.ord
              loop
                v_vppath := format('%s.prices[%s]', v_vpath, v_vpp);
                perform ebim.api_assert_keys(v_vprice_obj, array['store', 'price', 'compare_at_price'], v_vppath);

                v_field := v_vppath || '.store';
                v_code := lower(ebim.api_text_in(v_vprice_obj, 'store', 63, v_field));
                if v_code is null then
                  perform ebim.api_catalog_fail('CAMPO_REQUERIDO', v_field, 'el precio nombra su tienda');
                end if;
                if v_code = any (v_price_stores) then
                  perform ebim.api_catalog_fail('TIENDA_REPETIDA', v_field, format('la tienda %s aparece dos veces', v_code));
                end if;
                v_price_stores := v_price_stores || v_code;
                select * into v_store from public.stores s
                where s.organization_id = v_org and s.company_id = v_company and lower(s.slug) = v_code;
                if not found then
                  perform ebim.api_catalog_fail('TIENDA_NO_ENCONTRADA', v_field,
                                                format('no hay ninguna tienda %s en esta sociedad', v_code));
                end if;
                if not exists (
                  select 1 from public.store_products sp
                  where sp.product_id = v_product.id and sp.store_id = v_store.id
                ) then
                  perform ebim.api_catalog_fail('PUBLICACION_FALTANTE', v_field,
                                                format('publica el producto en %s antes de poner precio a sus variantes', v_code));
                end if;

                if not (v_vprice_obj ? 'price') then
                  perform ebim.api_catalog_fail('CAMPO_REQUERIDO', v_vppath || '.price',
                                                'precio de la variante, o null para quitarlo');
                end if;
                v_price := ebim.api_money_in(v_vprice_obj -> 'price', v_vppath || '.price');
                v_compare := ebim.api_money_in(v_vprice_obj -> 'compare_at_price', v_vppath || '.compare_at_price');
                v_has_compare := v_vprice_obj ? 'compare_at_price';

                v_field := v_vppath;
                if v_price is null then
                  delete from public.store_price_overrides o
                  where o.store_id = v_store.id and o.variant_id = v_variant.id;
                else
                  insert into public.store_price_overrides as o
                    (organization_id, company_id, store_id, product_id, variant_id, price, compare_at_price)
                  values
                    (v_org, v_company, v_store.id, v_product.id, v_variant.id, v_price, v_compare)
                  on conflict (store_id, variant_id) where variant_id is not null do update set
                    price = excluded.price,
                    compare_at_price = case when v_has_compare then excluded.compare_at_price else o.compare_at_price end;
                end if;
              end loop;
            end if;
          end loop;
        end if;

        -- --- Resultado de la fila --------------------------------------------
        v_pub_changed := false;
        v_pub_out := '[]'::jsonb;
        for v_pub_item in select e.item from jsonb_array_elements(v_pubs) as e(item) loop
          if v_pub_item ->> 'status' = 'updated'
             and v_pub_item ->> 'before' = ebim.api_publication_fingerprint(v_product.id, (v_pub_item ->> 'store_id')::uuid) then
            v_pub_item := jsonb_set(v_pub_item, '{status}', '"unchanged"');
          else
            v_pub_changed := true;
          end if;
          v_pub_out := v_pub_out || jsonb_build_array(jsonb_build_object(
            'store', v_pub_item ->> 'store', 'status', v_pub_item ->> 'status'));
        end loop;

        if not v_existed then
          v_status := 'created';
          v_created := v_created + 1;
        elsif not v_pub_changed and v_before = ebim.api_product_fingerprint(v_product.id) then
          v_status := 'unchanged';
          v_unchanged := v_unchanged + 1;
        else
          v_status := 'updated';
          v_updated := v_updated + 1;
        end if;

        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'index', v_idx, 'sku', v_sku, 'status', v_status, 'product_id', v_product.id,
          'publications', v_pub_out, 'errors', '[]'::jsonb));
      exception when others then
        get stacked diagnostics
          v_state = returned_sqlstate, v_msg = message_text,
          v_hint = pg_exception_hint, v_constraint = constraint_name;
        v_rejected := v_rejected + 1;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'index', v_idx,
          'sku', coalesce(v_sku, v_p ->> 'sku', ''),
          'status', 'rejected',
          'product_id', null,
          'publications', '[]'::jsonb,
          'errors', jsonb_build_array(
            ebim.api_catalog_error(v_state, v_msg, coalesce(nullif(v_hint, ''), v_field), v_constraint))));
      end;
    end loop;

    if p_dry_run or v_rejected > 0 then
      raise exception 'EBIM_API_CATALOG_ROLLBACK' using errcode = 'EB002';
    end if;
  exception when sqlstate 'EB002' then
    null;
  end;

  v_applied := not p_dry_run and v_rejected = 0;

  -- Lo que no se escribió no tiene identificador.
  if not v_applied then
    select coalesce(jsonb_agg(
             case when i.item ->> 'status' = 'created'
                  then jsonb_set(i.item, '{product_id}', 'null'::jsonb) else i.item end
             order by i.ord), '[]'::jsonb)
      into v_items
    from jsonb_array_elements(v_items) with ordinality as i(item, ord);
  end if;

  if v_applied then
    perform ebim.audit(
      p_organization_id => v_org,
      p_company_id      => v_company,
      p_action          => 'catalog.batch_via_api',
      p_entity_type     => 'catalog',
      p_entity_label    => format('%s productos', v_count),
      p_metadata        => jsonb_build_object(
                             'api_client_id', v_client.id, 'client_id', v_client.client_id,
                             'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged),
      p_actor_kind      => 'service'::public.audit_actor_kind);
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'applied', v_applied,
    'summary', jsonb_build_object(
      'received', v_count, 'created', v_created, 'updated', v_updated,
      'unchanged', v_unchanged, 'rejected', v_rejected),
    'items', v_items);
end;
$fn$;

comment on function public.api_catalog_upsert(uuid, jsonb, boolean) is
  'Ingesta de catálogo por la API de socio: upsert por SKU en el maestro de la sociedad de la credencial, publicaciones por tienda y precios de variante por tienda. Todo o nada; dry_run valida sin escribir.';

-- ---------------------------------------------------------------------------
-- 5. Permisos: solo el borde (`service_role`) llama al recurso. Las piezas
--    internas no las llama nadie desde fuera.
-- ---------------------------------------------------------------------------
revoke all on function public.api_catalog_upsert(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.api_catalog_upsert(uuid, jsonb, boolean) to service_role;

revoke all on function ebim.api_catalog_fail(text, text, text) from public, anon, authenticated;
revoke all on function ebim.api_assert_keys(jsonb, text[], text) from public, anon, authenticated;
revoke all on function ebim.api_text_in(jsonb, text, integer, text) from public, anon, authenticated;
revoke all on function ebim.api_int_in(jsonb, text) from public, anon, authenticated;
revoke all on function ebim.api_money_in(jsonb, text) from public, anon, authenticated;
revoke all on function ebim.api_product_fingerprint(uuid) from public, anon, authenticated;
revoke all on function ebim.api_publication_fingerprint(uuid, uuid) from public, anon, authenticated;
revoke all on function ebim.api_catalog_error(text, text, text, text) from public, anon, authenticated;
