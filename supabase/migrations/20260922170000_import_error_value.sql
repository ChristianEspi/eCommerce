-- =============================================================================
-- Importación de catálogo · el error dice QUÉ valor está mal
--
-- Una fila rechazada decía la regla («Código no válido»), pero no el valor que
-- la incumple, y en la hoja de Valores ni siquiera la clave: la columna salía
-- con un guion. Con 26 filas malas eso obliga a contar filas en el Excel.
--
-- Cambia tres cosas, ninguna de comportamiento:
-- 1. `ebim.import_row_error` acepta el VALOR que falló y lo publica en la fila
--    del informe (`value`). Los llamadores que no lo pasan siguen igual.
-- 2. En la hoja de Valores la CLAVE se arma antes de validar
--    (`atributo:codigo`), así que una fila mala ya se identifica.
-- 3. El código de un ATRIBUTO no admite guiones —lleva guion bajo, por el
--    CHECK `attributes_code_fmt`— y hasta ahora compartía mensaje con los
--    demás códigos, que sí los admiten. Tiene razón propia:
--    `CODIGO_INVALIDO_ATRIBUTO`.
-- =============================================================================

-- La firma cambia (nuevo `p_value` al final, opcional), así que se retira la
-- anterior para no dejar dos sobrecargas ambiguas. Los llamadores de las
-- importaciones de categorías y productos pasan seis argumentos y siguen
-- resolviendo contra esta por el valor por defecto.
drop function if exists ebim.import_row_error(text, integer, text, text, text, text);

create or replace function ebim.import_row_error(
  p_sheet      text,
  p_row        integer,
  p_key        text,
  p_state      text,
  p_message    text,
  p_constraint text,
  p_value      text default null
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
    -- El valor que el Excel traía en ese campo. Es lo que se corrige.
    'value', nullif(left(p_value, 120), ''),
    'constraint', nullif(p_constraint, '')
  );
$fn$;

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
  v_attr_code  text;
  v_hint       text;
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
              raise exception 'CODIGO_INVALIDO: code' using errcode = '22023', hint = v_code;
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
              raise exception 'CODIGO_INVALIDO: code' using errcode = '22023', hint = v_code;
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
            -- Un atributo lleva guion BAJO (`attributes_code_fmt`), al revés
            -- que marcas, familias y valores. Razón propia: el mensaje común
            -- decía «guiones» y mandaba a corregir lo que ya estaba bien.
            if v_code !~ '^[a-z][a-z0-9_]{0,40}$' then
              raise exception 'CODIGO_INVALIDO_ATRIBUTO: code' using errcode = '22023', hint = v_code;
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
            v_attr_code := lower(ebim.import_text(v_item, 'attribute_code', 41));
            v_name := ebim.import_text(v_item, 'label', 120);
            -- Sin código se deriva de la etiqueta: «Azul noche» → `azul-noche`.
            v_code := coalesce(lower(ebim.import_text(v_item, 'code', 41)), ebim.import_slug(v_name, 41));
            -- La CLAVE se arma ANTES de validar: una fila mala sin clave obliga
            -- a contar filas en el Excel para saber a cuál se refiere.
            v_code := coalesce(v_attr_code, '?') || ':' || coalesce(v_code, '?');

            if v_attr_code is null then
              raise exception 'CAMPO_REQUERIDO: attribute_code' using errcode = '22023';
            end if;
            select * into v_attr from public.attributes a
            where a.organization_id = v_org and a.company_id = v_company
              and lower(a.code) = v_attr_code;
            if not found then
              raise exception 'ATRIBUTO_NO_ENCONTRADO: attribute_code'
                using errcode = '22023', hint = v_attr_code;
            end if;
            if v_attr.data_type <> 'option' then
              raise exception 'ATRIBUTO_NO_ES_LISTA: attribute_code'
                using errcode = '22023', hint = v_attr_code;
            end if;

            if split_part(v_code, ':', 2) = '?' then
              raise exception 'CAMPO_REQUERIDO: label' using errcode = '22023';
            end if;
            if split_part(v_code, ':', 2) !~ '^[a-z0-9][a-z0-9_-]{0,40}$' then
              raise exception 'CODIGO_INVALIDO: code'
                using errcode = '22023', hint = split_part(v_code, ':', 2);
            end if;
            v_code := v_attr.code || ':' || split_part(v_code, ':', 2);

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
            v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name,
            v_hint = pg_exception_hint;
          v_errors := v_errors + 1;
          v_result := v_result || jsonb_build_array(
            ebim.import_row_error(v_sheet, v_row, v_code, v_state, v_msg, v_constraint,
                                  nullif(v_hint, '')));
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

revoke all on function public.import_catalog_vocabulary(jsonb, boolean) from public, anon;
