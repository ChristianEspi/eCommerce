-- =============================================================================
-- Importación del catálogo desde Excel: vocabulario, categorías y productos
--
-- ## El problema
--
-- Un comercio que llega con 200 o 2 000 artículos no los da de alta de uno en
-- uno. Hasta aquí la única carga masiva era la de precios, y el catálogo —lo
-- que hay que cargar ANTES de poner un precio— solo se podía teclear.
--
-- ## Tres funciones, una por pantalla
--
--  · `import_catalog_vocabulary(p_sheets, p_dry_run)` — Catálogo avanzado:
--    marcas, familias, unidades, atributos y sus valores. Un solo libro con una
--    hoja por asunto, procesadas en ESE orden dentro de la misma transacción:
--    los valores de un atributo que se crea en la misma carga lo encuentran.
--  · `import_catalog_categories(p_store_id, p_rows, p_dry_run)` — Categorías,
--    con la madre por slug. Una hija puede venir antes que su madre en la hoja.
--  · `import_catalog_products(p_store_id, p_rows, p_dry_run)` — Productos, una
--    fila por variante: varias filas con el mismo SKU de producto forman un
--    producto con sus variantes, y las columnas de eje (talla, color…) dicen el
--    valor de cada una.
--
-- ## Simular y aplicar son la MISMA ejecución
--
-- Con `p_dry_run = true` la función hace todo el trabajo —inserta, actualiza,
-- dispara los triggers y las restricciones de verdad— y al final lo deshace.
-- Así la vista previa no es una imitación de la validación: es la validación.
-- Una regla de la base que la vista previa no conociera aparecería después, al
-- aplicar, que es justo lo que una carga masiva no se puede permitir.
--
-- Y aplicar es TODO O NADA: si una sola fila falla, no se escribe ninguna. Media
-- carga deja un catálogo que nadie sabe describir («¿qué filas entraron?»); una
-- carga rechazada entera se corrige en la hoja y se vuelve a subir.
--
-- ## Crear y actualizar
--
-- La clave es la del negocio, nunca un uuid: el SKU del producto y de la
-- variante, el slug de la categoría, el código de marca, familia, atributo,
-- valor y unidad. Lo que existe se actualiza; lo que no, se crea. Una celda
-- VACÍA no borra: conserva el valor actual. Así una hoja con solo `sku` y
-- `price` es un cambio masivo de precios y no un catálogo vaciado.
--
-- ## Lo que la hoja NO decide
--
-- Ni organización, ni sociedad, ni moneda, ni ids. El tenant sale del token (o
-- de la tienda, comprobada contra el token); la moneda es la de la tienda. Una
-- clave no declarada se rechaza para toda la carga (`CAMPO_NO_PERMITIDO`).
--
-- ## Quién puede
--
-- Los mismos roles que escriben el catálogo a mano: owner, admin y catalog. Las
-- marcas, familias, atributos y variantes son `catalog.advanced`; sin el módulo,
-- la hoja de vocabulario no se acepta y en productos las filas que los usan se
-- rechazan con `MODULO_NO_CONTRATADO`, una a una, para que se vea cuáles.
--
-- ## Existencias
--
-- La columna de stock escribe el stock de catálogo (`products.stock` y
-- `product_variants.stock`), exactamente lo que escriben hoy la ficha y el panel
-- de variantes. Si la tienda sirve desde almacenes, la respuesta lo avisa con
-- `inventory_by_warehouse`: las existencias por almacén se ajustan en
-- Inventario, que es quien deja movimiento trazable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Lectura de celdas
--
-- Un Excel manda números donde se esperaba texto (el código de talla `36`) y
-- texto donde se esperaba número (`"59,90"`). Estas funciones aceptan las dos
-- formas y rechazan lo demás con un motivo que nombra la COLUMNA: `CAUSA: campo`.
-- ---------------------------------------------------------------------------
create or replace function ebim.import_text(p_item jsonb, p_key text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_value jsonb := p_item -> p_key;
  v_text  text;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_value) in ('string', 'number', 'boolean') then
    v_text := btrim(v_value #>> '{}');
  else
    raise exception 'FORMATO_INVALIDO: %', p_key using errcode = '22023';
  end if;
  if v_text = '' then
    return null;
  end if;
  if char_length(v_text) > p_max then
    raise exception 'TEXTO_DEMASIADO_LARGO: %', p_key using errcode = '22023';
  end if;
  return v_text;
end;
$fn$;

create or replace function ebim.import_numeric(p_item jsonb, p_key text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_text text := ebim.import_text(p_item, p_key, 40);
begin
  if v_text is null then
    return null;
  end if;
  -- La coma decimal es la de un Excel en castellano. Separador de miles no: un
  -- «1.299,90» es ambiguo y adivinarlo es cobrar mil veces menos.
  v_text := replace(replace(v_text, ' ', ''), ',', '.');
  if v_text !~ '^-?\d{1,12}(\.\d{1,6})?$' then
    raise exception 'NUMERO_INVALIDO: %', p_key using errcode = '22023';
  end if;
  return v_text::numeric;
end;
$fn$;

create or replace function ebim.import_int(p_item jsonb, p_key text)
returns integer
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_number numeric := ebim.import_numeric(p_item, p_key);
begin
  if v_number is null then
    return null;
  end if;
  if v_number <> trunc(v_number) or abs(v_number) > 2000000000 then
    raise exception 'NUMERO_INVALIDO: %', p_key using errcode = '22023';
  end if;
  return v_number::integer;
end;
$fn$;

create or replace function ebim.import_bool(p_item jsonb, p_key text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_text text := lower(ebim.import_text(p_item, p_key, 12));
begin
  if v_text is null then
    return null;
  end if;
  if v_text in ('si', 'sí', 's', 'x', '1', 'true', 'verdadero', 'yes', 'y') then
    return true;
  end if;
  if v_text in ('no', 'n', '0', 'false', 'falso') then
    return false;
  end if;
  raise exception 'VALOR_INVALIDO: %', p_key using errcode = '22023';
end;
$fn$;

/** Slug a partir de un nombre: minúsculas, sin tildes, guiones. */
create or replace function ebim.import_slug(p_text text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(
    btrim(
      left(
        btrim(
          regexp_replace(
            translate(lower(coalesce(p_text, '')),
                      'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
            '[^a-z0-9]+', '-', 'g'),
          '-'),
        p_max),
      '-'),
    '');
$fn$;

/**
 * Una fila rechazada, con un motivo ESTABLE.
 *
 * El texto de la excepción no viaja a la pantalla: se extrae el código
 * (`CAUSA: campo` o el SQLSTATE de la restricción) y, cuando la causa nombra una
 * columna, la columna. El nombre de la restricción sí viaja: es del esquema, no
 * de los datos de nadie, y le dice al comercio QUÉ regla incumple la celda.
 */
create or replace function ebim.import_row_error(
  p_sheet      text,
  p_row        integer,
  p_key        text,
  p_state      text,
  p_message    text,
  p_constraint text
)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'sheet', p_sheet,
    'row', p_row,
    'key', p_key,
    'status', 'error',
    'reason', case
      when p_message ~ '^[A-Z][A-Z_]{2,40}(:|$)' then substring(p_message from '^([A-Z][A-Z_]{2,40})')
      when p_state = '23505' then 'DUPLICADO'
      when p_state = '23514' then 'VALOR_INVALIDO'
      when p_state = '23503' then 'REFERENCIA_INVALIDA'
      when p_state = '23502' then 'CAMPO_REQUERIDO'
      when p_state in ('22P02', '22003', '22001', '22007', '22008') then 'FORMATO_INVALIDO'
      else 'ERROR_INTERNO'
    end,
    'field', case
      when p_message ~ '^[A-Z][A-Z_]{2,40}: [a-z][a-z0-9_]{0,40}$'
        then substring(p_message from ': ([a-z][a-z0-9_]{0,40})$')
    end,
    'constraint', nullif(p_constraint, '')
  );
$fn$;

/** Rechaza la carga entera si trae una clave que la hoja no puede decidir. */
create or replace function ebim.import_assert_rows(
  p_rows    jsonb,
  p_allowed text[],
  p_max     integer
)
returns void
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'FILAS_INVALIDAS: se espera una lista de filas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > p_max then
    raise exception 'FILAS_EXCESIVAS: como mucho % filas por carga', p_max using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) as e(item) where jsonb_typeof(e.item) <> 'object'
  ) then
    raise exception 'FILAS_INVALIDAS: cada fila es un objeto' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as e(item),
         jsonb_object_keys(e.item) as k
    where k <> all (p_allowed)
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: la hoja trae columnas que esta carga no admite'
      using errcode = '22023';
  end if;
end;
$fn$;

create or replace function ebim.import_attribute_type(p_text text)
returns public.attribute_data_type
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_text text := translate(lower(btrim(coalesce(p_text, ''))), 'áéíóú/ ', 'aeiou__');
begin
  return case
    when v_text in ('opcion', 'lista', 'option') then 'option'
    when v_text in ('texto', 'text') then 'text'
    when v_text in ('numero', 'number') then 'number'
    when v_text in ('si_no', 'sino', 'booleano', 'boolean') then 'boolean'
    when v_text in ('fecha', 'date') then 'date'
    else null
  end::public.attribute_data_type;
end;
$fn$;

create or replace function ebim.import_product_status(p_text text)
returns public.product_status
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_text text := lower(btrim(coalesce(p_text, '')));
begin
  if v_text = '' then
    return null;
  end if;
  if v_text in ('borrador', 'draft') then return 'draft'; end if;
  if v_text in ('publicado', 'published') then return 'published'; end if;
  if v_text in ('archivado', 'archived') then return 'archived'; end if;
  raise exception 'VALOR_INVALIDO: status' using errcode = '22023';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Catálogo avanzado: marcas, familias, unidades, atributos y valores
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_vocabulary(
  p_sheets  jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org        uuid := ebim.org_id();
  v_company    uuid := ebim.active_company();
  v_sheet      text;
  v_rows       jsonb;
  v_item       jsonb;
  v_pos        integer;
  v_row        integer;
  v_code       text;
  v_name       text;
  v_existing   uuid;
  v_status     text;
  v_type       public.attribute_data_type;
  v_attr       public.attributes%rowtype;
  v_result     jsonb := '[]'::jsonb;
  v_total      integer := 0;
  v_created    integer := 0;
  v_updated    integer := 0;
  v_errors     integer := 0;
  v_state      text;
  v_msg        text;
  v_constraint text;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: importar exige sesion' using errcode = '42501';
  end if;
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el operador de la suite no edita el catalogo de un tenant'
      using errcode = '42501';
  end if;
  if v_org is null or v_company is null
     or not ebim.has_role(v_org, v_company, array['owner', 'admin', 'catalog']::public.app_role[]) then
    raise exception 'SIN_PERMISO: importar el catalogo exige rol owner, admin o catalog'
      using errcode = '42501';
  end if;
  perform ebim.assert_capability(v_org, v_company, 'catalog.advanced');

  if p_sheets is null or jsonb_typeof(p_sheets) <> 'object' then
    raise exception 'FILAS_INVALIDAS: se espera un libro con hojas' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_sheets) as k
    where k not in ('brands', 'families', 'units', 'attributes', 'attribute_values')
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: hoja no admitida' using errcode = '22023';
  end if;

  perform ebim.import_assert_rows(coalesce(p_sheets -> 'brands', '[]'),
    array['row', 'code', 'name', 'description', 'is_active'], 1000);
  perform ebim.import_assert_rows(coalesce(p_sheets -> 'families', '[]'),
    array['row', 'code', 'name', 'description', 'is_active'], 1000);
  perform ebim.import_assert_rows(coalesce(p_sheets -> 'units', '[]'),
    array['row', 'code', 'name', 'symbol', 'is_active'], 1000);
  perform ebim.import_assert_rows(coalesce(p_sheets -> 'attributes', '[]'),
    array['row', 'code', 'name', 'data_type', 'unit', 'is_variant_axis', 'is_filterable', 'position', 'is_active'], 1000);
  perform ebim.import_assert_rows(coalesce(p_sheets -> 'attribute_values', '[]'),
    array['row', 'attribute_code', 'code', 'label', 'position', 'is_active'], 2000);

  begin
    -- El orden importa: los valores necesitan su atributo.
    foreach v_sheet in array array['brands', 'families', 'units', 'attributes', 'attribute_values'] loop
      v_rows := coalesce(p_sheets -> v_sheet, '[]'::jsonb);
      v_pos := 0;

      for v_item in select e.item from jsonb_array_elements(v_rows) with ordinality as e(item, ord) order by e.ord loop
        v_pos := v_pos + 1;
        v_total := v_total + 1;
        v_row := v_pos;
        v_code := null;

        begin
          v_row := coalesce(ebim.import_int(v_item, 'row'), v_pos);

          if v_sheet in ('brands', 'families') then
            v_code := lower(ebim.import_text(v_item, 'code', 41));
            if v_code is null then
              raise exception 'CAMPO_REQUERIDO: code' using errcode = '22023';
            end if;
            if v_code !~ '^[a-z0-9][a-z0-9_-]{0,40}$' then
              raise exception 'CODIGO_INVALIDO: code' using errcode = '22023';
            end if;
            v_name := ebim.import_text(v_item, 'name', 160);

            if v_sheet = 'brands' then
              select b.id into v_existing from public.brands b
              where b.organization_id = v_org and b.company_id = v_company and lower(b.code) = v_code;
              if v_existing is null then
                if v_name is null then
                  raise exception 'CAMPO_REQUERIDO: name' using errcode = '22023';
                end if;
                insert into public.brands (organization_id, company_id, code, name, description, is_active)
                values (v_org, v_company, v_code, v_name, ebim.import_text(v_item, 'description', 2000),
                        coalesce(ebim.import_bool(v_item, 'is_active'), true));
                v_status := 'created';
              else
                update public.brands b set
                  name        = coalesce(v_name, b.name),
                  description = coalesce(ebim.import_text(v_item, 'description', 2000), b.description),
                  is_active   = coalesce(ebim.import_bool(v_item, 'is_active'), b.is_active)
                where b.id = v_existing;
                v_status := 'updated';
              end if;
            else
              select f.id into v_existing from public.product_families f
              where f.organization_id = v_org and f.company_id = v_company and lower(f.code) = v_code;
              if v_existing is null then
                if v_name is null then
                  raise exception 'CAMPO_REQUERIDO: name' using errcode = '22023';
                end if;
                insert into public.product_families (organization_id, company_id, code, name, description, is_active)
                values (v_org, v_company, v_code, v_name, ebim.import_text(v_item, 'description', 2000),
                        coalesce(ebim.import_bool(v_item, 'is_active'), true));
                v_status := 'created';
              else
                update public.product_families f set
                  name        = coalesce(v_name, f.name),
                  description = coalesce(ebim.import_text(v_item, 'description', 2000), f.description),
                  is_active   = coalesce(ebim.import_bool(v_item, 'is_active'), f.is_active)
                where f.id = v_existing;
                v_status := 'updated';
              end if;
            end if;

          elsif v_sheet = 'units' then
            v_code := upper(ebim.import_text(v_item, 'code', 16));
            if v_code is null then
              raise exception 'CAMPO_REQUERIDO: code' using errcode = '22023';
            end if;
            if v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,15}$' then
              raise exception 'CODIGO_INVALIDO: code' using errcode = '22023';
            end if;
            v_name := ebim.import_text(v_item, 'name', 80);
            select u.id into v_existing from public.units_of_measure u
            where u.organization_id = v_org and u.company_id = v_company and upper(u.code) = v_code;
            if v_existing is null then
              if v_name is null then
                raise exception 'CAMPO_REQUERIDO: name' using errcode = '22023';
              end if;
              insert into public.units_of_measure (organization_id, company_id, code, name, symbol, is_active)
              values (v_org, v_company, v_code, v_name, ebim.import_text(v_item, 'symbol', 12),
                      coalesce(ebim.import_bool(v_item, 'is_active'), true));
              v_status := 'created';
            else
              update public.units_of_measure u set
                name      = coalesce(v_name, u.name),
                symbol    = coalesce(ebim.import_text(v_item, 'symbol', 12), u.symbol),
                is_active = coalesce(ebim.import_bool(v_item, 'is_active'), u.is_active)
              where u.id = v_existing;
              v_status := 'updated';
            end if;

          elsif v_sheet = 'attributes' then
            v_code := lower(ebim.import_text(v_item, 'code', 41));
            if v_code is null then
              raise exception 'CAMPO_REQUERIDO: code' using errcode = '22023';
            end if;
            if v_code !~ '^[a-z][a-z0-9_]{0,40}$' then
              raise exception 'CODIGO_INVALIDO: code' using errcode = '22023';
            end if;
            v_name := ebim.import_text(v_item, 'name', 120);
            v_type := null;
            if ebim.import_text(v_item, 'data_type', 20) is not null then
              v_type := ebim.import_attribute_type(ebim.import_text(v_item, 'data_type', 20));
              if v_type is null then
                raise exception 'VALOR_INVALIDO: data_type' using errcode = '22023';
              end if;
            end if;

            select a.id into v_existing from public.attributes a
            where a.organization_id = v_org and a.company_id = v_company and lower(a.code) = v_code;
            if v_existing is null then
              if v_name is null then
                raise exception 'CAMPO_REQUERIDO: name' using errcode = '22023';
              end if;
              insert into public.attributes
                (organization_id, company_id, code, name, data_type, unit, is_variant_axis,
                 is_filterable, position, is_active)
              values
                (v_org, v_company, v_code, v_name, coalesce(v_type, 'option'),
                 ebim.import_text(v_item, 'unit', 16),
                 coalesce(ebim.import_bool(v_item, 'is_variant_axis'), false),
                 coalesce(ebim.import_bool(v_item, 'is_filterable'), true),
                 coalesce(ebim.import_int(v_item, 'position'), 0),
                 coalesce(ebim.import_bool(v_item, 'is_active'), true));
              v_status := 'created';
            else
              update public.attributes a set
                name            = coalesce(v_name, a.name),
                data_type       = coalesce(v_type, a.data_type),
                unit            = coalesce(ebim.import_text(v_item, 'unit', 16), a.unit),
                is_variant_axis = coalesce(ebim.import_bool(v_item, 'is_variant_axis'), a.is_variant_axis),
                is_filterable   = coalesce(ebim.import_bool(v_item, 'is_filterable'), a.is_filterable),
                position        = coalesce(ebim.import_int(v_item, 'position'), a.position),
                is_active       = coalesce(ebim.import_bool(v_item, 'is_active'), a.is_active)
              where a.id = v_existing;
              v_status := 'updated';
            end if;

          else -- attribute_values
            select * into v_attr from public.attributes a
            where a.organization_id = v_org and a.company_id = v_company
              and lower(a.code) = lower(ebim.import_text(v_item, 'attribute_code', 41));
            if ebim.import_text(v_item, 'attribute_code', 41) is null then
              raise exception 'CAMPO_REQUERIDO: attribute_code' using errcode = '22023';
            end if;
            if not found then
              raise exception 'ATRIBUTO_NO_ENCONTRADO: attribute_code' using errcode = '22023';
            end if;
            if v_attr.data_type <> 'option' then
              raise exception 'ATRIBUTO_NO_ES_LISTA: attribute_code' using errcode = '22023';
            end if;

            v_name := ebim.import_text(v_item, 'label', 120);
            -- Sin código se deriva de la etiqueta: «Azul noche» → `azul-noche`.
            v_code := coalesce(lower(ebim.import_text(v_item, 'code', 41)), ebim.import_slug(v_name, 41));
            if v_code is null then
              raise exception 'CAMPO_REQUERIDO: label' using errcode = '22023';
            end if;
            if v_code !~ '^[a-z0-9][a-z0-9_-]{0,40}$' then
              raise exception 'CODIGO_INVALIDO: code' using errcode = '22023';
            end if;
            v_code := v_attr.code || ':' || v_code;

            select av.id into v_existing from public.attribute_values av
            where av.attribute_id = v_attr.id and lower(av.code) = split_part(v_code, ':', 2);
            if v_existing is null then
              if v_name is null then
                raise exception 'CAMPO_REQUERIDO: label' using errcode = '22023';
              end if;
              insert into public.attribute_values
                (organization_id, company_id, attribute_id, code, label, position, is_active)
              values
                (v_org, v_company, v_attr.id, split_part(v_code, ':', 2), v_name,
                 coalesce(ebim.import_int(v_item, 'position'), 0),
                 coalesce(ebim.import_bool(v_item, 'is_active'), true));
              v_status := 'created';
            else
              update public.attribute_values av set
                label     = coalesce(v_name, av.label),
                position  = coalesce(ebim.import_int(v_item, 'position'), av.position),
                is_active = coalesce(ebim.import_bool(v_item, 'is_active'), av.is_active)
              where av.id = v_existing;
              v_status := 'updated';
            end if;
          end if;

          if v_status = 'created' then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
          v_result := v_result || jsonb_build_array(jsonb_build_object(
            'sheet', v_sheet, 'row', v_row, 'key', v_code, 'status', v_status));
        exception when others then
          get stacked diagnostics
            v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
          v_errors := v_errors + 1;
          v_result := v_result || jsonb_build_array(
            ebim.import_row_error(v_sheet, v_row, v_code, v_state, v_msg, v_constraint));
        end;
      end loop;
    end loop;

    if p_dry_run or v_errors > 0 then
      raise exception 'EBIM_IMPORT_ROLLBACK' using errcode = 'EB001';
    end if;
  exception when sqlstate 'EB001' then
    null; -- se deshace todo lo escrito; los contadores y las filas se conservan
  end;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'applied', not p_dry_run and v_errors = 0,
    'total', v_total,
    'created', v_created,
    'updated', v_updated,
    'errors', v_errors,
    'rows', v_result
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3 · Categorías
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_categories(
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
  v_store       public.stores%rowtype;
  v_count       integer;
  v_pending     integer[];
  v_next        integer[];
  v_index       integer;
  v_item        jsonb;
  v_row         integer;
  v_slug        text;
  v_name        text;
  v_parent_slug text;
  v_parent      uuid;
  v_existing    uuid;
  v_status      text;
  v_batch_slugs text[];
  v_pass        integer := 0;
  v_result      jsonb := '[]'::jsonb;
  v_created     integer := 0;
  v_updated     integer := 0;
  v_errors      integer := 0;
  v_state       text;
  v_msg         text;
  v_constraint  text;
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
    array['row', 'slug', 'name', 'parent_slug', 'position', 'is_active'], 1000);
  v_count := jsonb_array_length(p_rows);

  -- Los slugs que la propia hoja declara: una hija cuya madre viene más abajo
  -- espera a la pasada siguiente en vez de fallar.
  select coalesce(array_agg(s), '{}') into v_batch_slugs
  from (
    select coalesce(lower(btrim(e.item ->> 'slug')), ebim.import_slug(e.item ->> 'name', 80)) as s
    from jsonb_array_elements(p_rows) as e(item)
  ) x
  where s is not null;

  v_pending := array(select generate_series(1, v_count));

  begin
    -- Tres niveles de árbol: cuatro pasadas bastan para cualquier orden.
    while cardinality(v_pending) > 0 and v_pass < 4 loop
      v_pass := v_pass + 1;
      v_next := '{}';

      foreach v_index in array v_pending loop
        v_item := p_rows -> (v_index - 1);
        v_row := v_index;
        v_slug := null;

        -- ¿Espera a su madre? Solo si la madre está en la hoja y aún no existe.
        v_parent_slug := lower(btrim(v_item ->> 'parent_slug'));
        if v_parent_slug is not null and v_parent_slug <> '' and v_pass < 4
           and v_parent_slug = any (v_batch_slugs)
           and not exists (
             select 1 from public.categories c
             where c.store_id = v_store.id and lower(c.slug) = v_parent_slug
           ) then
          v_next := v_next || v_index;
          continue;
        end if;

        begin
          v_row := coalesce(ebim.import_int(v_item, 'row'), v_index);
          v_name := ebim.import_text(v_item, 'name', 160);
          v_slug := coalesce(lower(ebim.import_text(v_item, 'slug', 81)), ebim.import_slug(v_name, 80));
          if v_slug is null then
            raise exception 'CAMPO_REQUERIDO: slug' using errcode = '22023';
          end if;
          if v_slug !~ '^[a-z0-9][a-z0-9-]{0,80}$' then
            raise exception 'SLUG_INVALIDO: slug' using errcode = '22023';
          end if;

          v_parent := null;
          v_parent_slug := lower(ebim.import_text(v_item, 'parent_slug', 81));
          if v_parent_slug is not null then
            if v_parent_slug = v_slug then
              raise exception 'PADRE_INVALIDO: parent_slug' using errcode = '22023';
            end if;
            select c.id into v_parent from public.categories c
            where c.store_id = v_store.id and lower(c.slug) = v_parent_slug;
            if v_parent is null then
              raise exception 'PADRE_NO_ENCONTRADO: parent_slug' using errcode = '22023';
            end if;
          end if;

          select c.id into v_existing from public.categories c
          where c.store_id = v_store.id and lower(c.slug) = v_slug;

          if v_existing is null then
            if v_name is null then
              raise exception 'CAMPO_REQUERIDO: name' using errcode = '22023';
            end if;
            insert into public.categories
              (organization_id, company_id, store_id, parent_id, slug, name, position, is_active)
            values
              (v_store.organization_id, v_store.company_id, v_store.id, v_parent, v_slug, v_name,
               coalesce(ebim.import_int(v_item, 'position'), 0),
               coalesce(ebim.import_bool(v_item, 'is_active'), true));
            v_status := 'created';
            v_created := v_created + 1;
          else
            update public.categories c set
              name      = coalesce(v_name, c.name),
              parent_id = coalesce(v_parent, c.parent_id),
              position  = coalesce(ebim.import_int(v_item, 'position'), c.position),
              is_active = coalesce(ebim.import_bool(v_item, 'is_active'), c.is_active)
            where c.id = v_existing;
            v_status := 'updated';
            v_updated := v_updated + 1;
          end if;

          v_result := v_result || jsonb_build_array(jsonb_build_object(
            'sheet', 'categories', 'row', v_row, 'key', v_slug, 'status', v_status));
        exception when others then
          get stacked diagnostics
            v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
          v_errors := v_errors + 1;
          v_result := v_result || jsonb_build_array(
            ebim.import_row_error('categories', v_row, v_slug, v_state, v_msg, v_constraint));
        end;
      end loop;

      v_pending := v_next;
    end loop;

    if p_dry_run or v_errors > 0 then
      raise exception 'EBIM_IMPORT_ROLLBACK' using errcode = 'EB001';
    end if;
  exception when sqlstate 'EB001' then
    null;
  end;

  select coalesce(jsonb_agg(r order by (r ->> 'row')::integer), '[]'::jsonb)
  into v_result
  from jsonb_array_elements(v_result) as r;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'applied', not p_dry_run and v_errors = 0,
    'total', v_count,
    'created', v_created,
    'updated', v_updated,
    'errors', v_errors,
    'rows', v_result
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4 · Productos y variantes
-- ---------------------------------------------------------------------------
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

        select * into v_product from public.products p
        where p.store_id = v_store.id and lower(p.sku) = v_sku_key;
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
          where pv.store_id = v_store.id and lower(pv.sku) = lower(v_vsku);

          if found then
            if v_variant.product_id <> v_product.id then
              raise exception 'VARIANTE_DE_OTRO_PRODUCTO: variant_sku' using errcode = '22023';
            end if;
            update public.product_variants pv set
              name  = coalesce(v_vname, pv.name),
              price = coalesce(v_vprice, pv.price),
              stock = coalesce(v_vstock, pv.stock)
            where pv.id = v_variant.id
            returning * into v_variant;
            v_v_updated := v_v_updated + 1;
          else
            insert into public.product_variants
              (organization_id, company_id, store_id, product_id, sku, name, price, stock, position, is_default)
            values
              (v_store.organization_id, v_store.company_id, v_store.id, v_product.id, v_vsku,
               left(coalesce(
                 v_vname,
                 v_product.name || case when cardinality(v_labels) > 0
                                        then ' · ' || array_to_string(v_labels, ' / ') else '' end
               ), 240),
               v_vprice, coalesce(v_vstock, 0),
               (select count(*) from public.product_variants pv where pv.product_id = v_product.id),
               not exists (
                 select 1 from public.product_variants pv where pv.product_id = v_product.id and pv.is_default
               ))
            returning * into v_variant;
            v_v_created := v_v_created + 1;
            v_created_any := true;
          end if;

          insert into public.variant_attribute_values
            (organization_id, company_id, store_id, variant_id, attribute_id, value_id)
          select v_store.organization_id, v_store.company_id, v_store.id, v_variant.id, a.attribute_id, a.value_id
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

-- ---------------------------------------------------------------------------
-- 5 · Permisos
-- ---------------------------------------------------------------------------
revoke all on function ebim.import_text(jsonb, text, integer) from public, anon, authenticated;
revoke all on function ebim.import_numeric(jsonb, text) from public, anon, authenticated;
revoke all on function ebim.import_int(jsonb, text) from public, anon, authenticated;
revoke all on function ebim.import_bool(jsonb, text) from public, anon, authenticated;
revoke all on function ebim.import_slug(text, integer) from public, anon, authenticated;
revoke all on function ebim.import_row_error(text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function ebim.import_assert_rows(jsonb, text[], integer) from public, anon, authenticated;
revoke all on function ebim.import_attribute_type(text) from public, anon, authenticated;
revoke all on function ebim.import_product_status(text) from public, anon, authenticated;

revoke all on function public.import_catalog_vocabulary(jsonb, boolean) from public, anon;
revoke all on function public.import_catalog_categories(uuid, jsonb, boolean) from public, anon;
revoke all on function public.import_catalog_products(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_catalog_vocabulary(jsonb, boolean) to authenticated, service_role;
grant execute on function public.import_catalog_categories(uuid, jsonb, boolean) to authenticated, service_role;
grant execute on function public.import_catalog_products(uuid, jsonb, boolean) to authenticated, service_role;

comment on function public.import_catalog_vocabulary(jsonb, boolean) is
  'Importa marcas, familias, unidades, atributos y valores desde un libro de hojas. Simula o aplica, todo o nada.';
comment on function public.import_catalog_categories(uuid, jsonb, boolean) is
  'Importa categorias de una tienda por slug, con la madre por slug. Simula o aplica, todo o nada.';
comment on function public.import_catalog_products(uuid, jsonb, boolean) is
  'Importa productos y variantes de una tienda por SKU, con ejes de variante. Simula o aplica, todo o nada.';
