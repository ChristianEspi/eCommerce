-- =============================================================================
-- Importación de clientes y de usuarios B2B desde Excel
--
-- ## El problema
--
-- Un comercio que llega con su cartera (300 clientes en el ERP, 40 empresas con
-- sus compradores) solo podía teclearla ficha por ficha. Los productos ya
-- tenían importación (20260916100000_catalog_import.sql); los clientes, no.
--
-- ## Dos funciones, una por pantalla
--
--  · `import_customers(p_rows, p_dry_run)` — Clientes → Importar. La clave es el
--    CÓDIGO del cliente: si existe se actualiza, si no se crea. Opcionalmente,
--    el código con el que el cliente existe en el ERP (`customer_external_ids`).
--  · `import_business_account_users(p_account_id, p_rows, p_dry_run)` — quién
--    compra a nombre de cada cuenta B2B. Con `p_account_id` (desde la ficha de
--    la cuenta) todas las filas son de esa cuenta; sin él (desde la pestaña
--    Cuentas B2B) cada fila dice su cuenta por código.
--
-- ## Mismo contrato que la importación de catálogo
--
--  · Simular y aplicar son la MISMA ejecución: con `p_dry_run` se hace todo y se
--    deshace al final, así que la vista previa es la validación de verdad.
--  · TODO O NADA: si una fila falla no se escribe ninguna.
--  · Una celda VACÍA no borra: conserva el valor actual.
--  · El tenant sale del token; la hoja no puede decidir organización, sociedad
--    ni ids (`CAMPO_NO_PERMITIDO` para toda la carga).
--
-- ## Quién puede
--
--  · Clientes: los roles que ya escriben clientes a mano (owner, admin, orders).
--    El código del ERP es configuración de integración y la RLS lo reserva a
--    owner/admin: una fila que lo trae, importada por `orders`, se rechaza.
--  · Usuarios B2B: owner/admin y el módulo `customers.b2b`. Cada fila pasa por
--    `add_business_account_user`, la misma función de la pantalla, así que las
--    reglas (correo de la suite, cuenta de acceso existente, estado respetado)
--    son una sola.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Lectura de los valores en castellano que escribe el comercio
-- ---------------------------------------------------------------------------
create or replace function ebim.import_word(p_text text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(
    translate(lower(btrim(coalesce(p_text, ''))), 'áéíóúü', 'aeiouu'),
    '');
$fn$;

create or replace function ebim.import_customer_kind(p_text text)
returns public.customer_kind
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_word text := ebim.import_word(p_text);
begin
  if v_word is null then
    return null;
  end if;
  if v_word in ('empresa', 'company', 'juridica', 'persona juridica', 'e') then
    return 'company';
  end if;
  if v_word in ('persona', 'person', 'natural', 'persona natural', 'p') then
    return 'person';
  end if;
  raise exception 'VALOR_INVALIDO: kind' using errcode = '22023';
end;
$fn$;

create or replace function ebim.import_business_role(p_text text)
returns public.business_role
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_word text := ebim.import_word(p_text);
begin
  if v_word is null then
    return null;
  end if;
  if v_word in ('administrador', 'admin') then
    return 'admin';
  end if;
  if v_word in ('comprador', 'buyer') then
    return 'buyer';
  end if;
  if v_word in ('aprobador', 'approver') then
    return 'approver';
  end if;
  if v_word in ('observador', 'viewer', 'lector') then
    return 'viewer';
  end if;
  raise exception 'VALOR_INVALIDO: role' using errcode = '22023';
end;
$fn$;

create or replace function ebim.import_member_status(p_text text)
returns public.member_status
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_word text := ebim.import_word(p_text);
begin
  if v_word is null then
    return null;
  end if;
  if v_word in ('activo', 'activa', 'active') then
    return 'active';
  end if;
  if v_word in ('invitado', 'invitada', 'pendiente', 'invited') then
    return 'invited';
  end if;
  if v_word in ('revocado', 'revocada', 'inactivo', 'revoked') then
    return 'revoked';
  end if;
  raise exception 'VALOR_INVALIDO: status' using errcode = '22023';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 1 · Clientes
-- ---------------------------------------------------------------------------
create or replace function public.import_customers(
  p_rows    jsonb,
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
  v_can_erp    boolean;
  v_count      integer;
  v_index      integer;
  v_item       jsonb;
  v_row        integer;
  v_code       text;
  v_kind       public.customer_kind;
  v_name       text;
  v_email      text;
  v_segment    text;
  v_segment_id uuid;
  v_erp_code   text;
  v_erp_system text;
  v_existing   uuid;
  v_customer   uuid;
  v_status     text;
  v_seen       text[] := '{}';
  v_result     jsonb := '[]'::jsonb;
  v_created    integer := 0;
  v_updated    integer := 0;
  v_errors     integer := 0;
  v_state      text;
  v_msg        text;
  v_constraint text;
  v_value      text;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: importar exige sesion' using errcode = '42501';
  end if;
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el operador de la suite no edita los clientes de un tenant'
      using errcode = '42501';
  end if;
  if v_org is null or v_company is null
     or not ebim.has_role(v_org, v_company, array['owner', 'admin', 'orders']::public.app_role[]) then
    raise exception 'SIN_PERMISO: importar clientes exige rol owner, admin u orders'
      using errcode = '42501';
  end if;
  v_can_erp := ebim.has_role(v_org, v_company, array['owner', 'admin']::public.app_role[]);

  perform ebim.import_assert_rows(p_rows,
    array['row', 'code', 'kind', 'name', 'legal_name', 'tax_id', 'email', 'phone',
          'segment', 'is_active', 'notes', 'erp_code', 'erp_system'], 5000);
  v_count := jsonb_array_length(p_rows);

  begin
    for v_index in 1 .. v_count loop
      v_item := p_rows -> (v_index - 1);
      v_row := v_index;
      v_code := null;
      v_value := null;

      begin
        v_row := coalesce(ebim.import_int(v_item, 'row'), v_index);

        v_value := v_item ->> 'code';
        v_code := ebim.import_text(v_item, 'code', 41);
        if v_code is null then
          raise exception 'CAMPO_REQUERIDO: code' using errcode = '22023';
        end if;
        if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$' then
          raise exception 'CODIGO_CLIENTE_INVALIDO: code' using errcode = '22023';
        end if;
        if lower(v_code) = any (v_seen) then
          raise exception 'CODIGO_REPETIDO: code' using errcode = '22023';
        end if;
        v_seen := v_seen || lower(v_code);

        v_value := v_item ->> 'kind';
        v_kind := ebim.import_customer_kind(ebim.import_text(v_item, 'kind', 40));

        v_value := v_item ->> 'name';
        v_name := ebim.import_text(v_item, 'name', 200);

        v_value := v_item ->> 'email';
        v_email := lower(ebim.import_text(v_item, 'email', 254));
        if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
          raise exception 'CORREO_INVALIDO: email' using errcode = '22023';
        end if;

        -- El segmento por su código o por su nombre: el comercio escribe el
        -- nombre que ve en pantalla («Mayorista»), no el código.
        v_value := v_item ->> 'segment';
        v_segment := ebim.import_text(v_item, 'segment', 120);
        v_segment_id := null;
        if v_segment is not null then
          select s.id into v_segment_id
          from public.customer_segments s
          where s.organization_id = v_org and s.company_id = v_company
            and (lower(s.code) = lower(v_segment) or lower(btrim(s.name)) = lower(v_segment))
          order by (lower(s.code) = lower(v_segment)) desc
          limit 1;
          if v_segment_id is null then
            raise exception 'SEGMENTO_NO_ENCONTRADO: segment' using errcode = '22023';
          end if;
        end if;

        v_value := v_item ->> 'erp_code';
        v_erp_code := ebim.import_text(v_item, 'erp_code', 120);
        v_value := v_item ->> 'erp_system';
        v_erp_system := lower(ebim.import_text(v_item, 'erp_system', 41));
        if v_erp_system is not null and v_erp_system !~ '^[a-z0-9][a-z0-9_-]{0,40}$' then
          raise exception 'CODIGO_INVALIDO: erp_system' using errcode = '22023';
        end if;
        if v_erp_system is not null and v_erp_code is null then
          raise exception 'CAMPO_REQUERIDO: erp_code' using errcode = '22023';
        end if;
        if v_erp_code is not null and not v_can_erp then
          v_value := v_erp_code;
          raise exception 'SIN_PERMISO_ERP: erp_code' using errcode = '22023';
        end if;
        v_value := null;

        select c.id into v_existing
        from public.customers c
        where c.organization_id = v_org and c.company_id = v_company
          and lower(c.code) = lower(v_code);

        if v_existing is null then
          if v_name is null then
            raise exception 'CAMPO_REQUERIDO: name' using errcode = '22023';
          end if;
          if v_kind is null then
            raise exception 'CAMPO_REQUERIDO: kind' using errcode = '22023';
          end if;
          insert into public.customers
            (organization_id, company_id, kind, code, name, legal_name, tax_id, email, phone,
             segment_id, is_active, notes)
          values
            (v_org, v_company, v_kind, v_code, v_name,
             ebim.import_text(v_item, 'legal_name', 200),
             ebim.import_text(v_item, 'tax_id', 40),
             v_email,
             ebim.import_text(v_item, 'phone', 40),
             v_segment_id,
             coalesce(ebim.import_bool(v_item, 'is_active'), true),
             ebim.import_text(v_item, 'notes', 2000))
          returning id into v_customer;
          v_status := 'created';
          v_created := v_created + 1;
        else
          update public.customers c set
            kind       = coalesce(v_kind, c.kind),
            name       = coalesce(v_name, c.name),
            legal_name = coalesce(ebim.import_text(v_item, 'legal_name', 200), c.legal_name),
            tax_id     = coalesce(ebim.import_text(v_item, 'tax_id', 40), c.tax_id),
            email      = coalesce(v_email, c.email),
            phone      = coalesce(ebim.import_text(v_item, 'phone', 40), c.phone),
            segment_id = coalesce(v_segment_id, c.segment_id),
            is_active  = coalesce(ebim.import_bool(v_item, 'is_active'), c.is_active),
            notes      = coalesce(ebim.import_text(v_item, 'notes', 2000), c.notes)
          where c.id = v_existing;
          v_customer := v_existing;
          v_status := 'updated';
          v_updated := v_updated + 1;
        end if;

        if v_erp_code is not null then
          v_value := v_erp_code;
          insert into public.customer_external_ids
            (organization_id, company_id, customer_id, system_code, external_id)
          values (v_org, v_company, v_customer, coalesce(v_erp_system, 'erp'), v_erp_code)
          on conflict (customer_id, system_code)
          do update set external_id = excluded.external_id;
          v_value := null;
        end if;

        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'sheet', 'customers', 'row', v_row, 'key', v_code, 'status', v_status));
      exception when others then
        get stacked diagnostics
          v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
        v_errors := v_errors + 1;
        -- Un código de ERP que ya usa OTRO cliente choca con el índice único de
        -- `customer_external_ids`: se nombra como tal y no como un genérico.
        if v_state = '23505' and v_constraint = 'customer_external_ids_value_key' then
          v_msg := 'CODIGO_ERP_EN_USO: erp_code';
        end if;
        v_result := v_result || jsonb_build_array(
          ebim.import_row_error('customers', v_row, v_code, v_state, v_msg, v_constraint, v_value));
      end;
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
-- 2 · Usuarios de cuentas B2B
-- ---------------------------------------------------------------------------
create or replace function public.import_business_account_users(
  p_account_id uuid,
  p_rows       jsonb,
  p_dry_run    boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org          uuid := ebim.org_id();
  v_company      uuid := ebim.active_company();
  v_fixed        public.business_accounts%rowtype;
  v_account      public.business_accounts%rowtype;
  v_count        integer;
  v_index        integer;
  v_item         jsonb;
  v_row          integer;
  v_key          text;
  v_account_code text;
  v_email        text;
  v_role         public.business_role;
  v_member_state public.member_status;
  v_limit        numeric;
  v_location     text;
  v_location_id  uuid;
  v_current      public.business_account_users%rowtype;
  v_status       text;
  v_seen         text[] := '{}';
  v_result       jsonb := '[]'::jsonb;
  v_created      integer := 0;
  v_updated      integer := 0;
  v_errors       integer := 0;
  v_state        text;
  v_msg          text;
  v_constraint   text;
  v_value        text;
begin
  if ebim.user_id() is null then
    raise exception 'NO_AUTENTICADO: importar exige sesion' using errcode = '42501';
  end if;
  if ebim.is_suite_super_admin() then
    raise exception 'OPERADOR_NO_ES_ACTOR: el operador de la suite no edita las cuentas de un tenant'
      using errcode = '42501';
  end if;
  if v_org is null or v_company is null
     or not ebim.has_role(v_org, v_company, array['owner', 'admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: importar usuarios B2B exige rol owner o admin'
      using errcode = '42501';
  end if;
  perform ebim.assert_capability(v_org, v_company, 'customers.b2b');

  if p_account_id is not null then
    select * into v_fixed from public.business_accounts a
    where a.id = p_account_id and a.organization_id = v_org and a.company_id = v_company;
    if not found then
      raise exception 'CUENTA_NO_ENCONTRADA: esa cuenta no es de esta sociedad' using errcode = '22023';
    end if;
  end if;

  perform ebim.import_assert_rows(p_rows,
    array['row', 'account_code', 'email', 'role', 'spending_limit', 'status', 'location_code'], 5000);
  v_count := jsonb_array_length(p_rows);

  begin
    for v_index in 1 .. v_count loop
      v_item := p_rows -> (v_index - 1);
      v_row := v_index;
      v_key := null;
      v_value := null;

      begin
        v_row := coalesce(ebim.import_int(v_item, 'row'), v_index);

        v_value := v_item ->> 'email';
        v_email := lower(ebim.import_text(v_item, 'email', 254));
        v_key := v_email;
        if v_email is null then
          raise exception 'CAMPO_REQUERIDO: email' using errcode = '22023';
        end if;
        if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
          raise exception 'CORREO_INVALIDO: email' using errcode = '22023';
        end if;

        -- La cuenta: la fijada por la pantalla o la que dice la fila.
        v_value := v_item ->> 'account_code';
        v_account_code := ebim.import_text(v_item, 'account_code', 41);
        if p_account_id is not null then
          if v_account_code is not null and lower(v_account_code) <> lower(v_fixed.code) then
            raise exception 'OTRA_CUENTA: account_code' using errcode = '22023';
          end if;
          v_account := v_fixed;
        else
          if v_account_code is null then
            raise exception 'CAMPO_REQUERIDO: account_code' using errcode = '22023';
          end if;
          select * into v_account from public.business_accounts a
          where a.organization_id = v_org and a.company_id = v_company
            and lower(a.code) = lower(v_account_code);
          if not found then
            raise exception 'CUENTA_NO_ENCONTRADA: account_code' using errcode = '22023';
          end if;
        end if;
        v_key := v_account.code || ' · ' || v_email;

        if (v_account.id::text || ':' || v_email) = any (v_seen) then
          v_value := v_email;
          raise exception 'CORREO_REPETIDO: email' using errcode = '22023';
        end if;
        v_seen := v_seen || (v_account.id::text || ':' || v_email);

        v_value := v_item ->> 'role';
        v_role := ebim.import_business_role(ebim.import_text(v_item, 'role', 40));
        v_value := v_item ->> 'status';
        v_member_state := ebim.import_member_status(ebim.import_text(v_item, 'status', 40));
        v_value := v_item ->> 'spending_limit';
        v_limit := ebim.import_numeric(v_item, 'spending_limit');
        if v_limit is not null and v_limit < 0 then
          raise exception 'NUMERO_INVALIDO: spending_limit' using errcode = '22023';
        end if;

        v_value := v_item ->> 'location_code';
        v_location := ebim.import_text(v_item, 'location_code', 120);
        v_location_id := null;
        if v_location is not null then
          select l.id into v_location_id
          from public.business_locations l
          where l.business_account_id = v_account.id
            and (lower(l.code) = lower(v_location) or lower(btrim(l.name)) = lower(v_location))
          order by (lower(l.code) = lower(v_location)) desc
          limit 1;
          if v_location_id is null then
            raise exception 'SUCURSAL_NO_ENCONTRADA: location_code' using errcode = '22023';
          end if;
        end if;
        v_value := v_email;

        -- Lo que ya tiene ese vínculo se conserva cuando la celda está vacía.
        select u.* into v_current
        from public.business_account_users u
        where u.business_account_id = v_account.id and lower(u.email) = v_email
        limit 1;

        if found then
          perform public.add_business_account_user(
            v_account.id, v_email,
            coalesce(v_role, v_current.role),
            coalesce(v_limit, v_current.spending_limit),
            coalesce(v_location_id, v_current.default_location_id),
            coalesce(v_member_state, v_current.status));
          v_status := 'updated';
          v_updated := v_updated + 1;
        else
          -- Importar es dar acceso a quien ya se conoce: por defecto ACTIVO.
          perform public.add_business_account_user(
            v_account.id, v_email,
            coalesce(v_role, 'buyer'::public.business_role),
            v_limit,
            v_location_id,
            coalesce(v_member_state, 'active'::public.member_status));
          v_status := 'created';
          v_created := v_created + 1;
        end if;

        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'sheet', 'account_users', 'row', v_row, 'key', v_key, 'status', v_status));
      exception when others then
        get stacked diagnostics
          v_state = returned_sqlstate, v_msg = message_text, v_constraint = constraint_name;
        v_errors := v_errors + 1;
        -- Las causas de `add_business_account_user` no nombran columna: todas
        -- son del correo.
        if v_msg ~ '^(SIN_CUENTA|CORREO_DE_SUITE|CORREO_INVALIDO):' then
          v_msg := substring(v_msg from '^([A-Z_]+)') || ': email';
          v_value := v_email;
        end if;
        v_result := v_result || jsonb_build_array(
          ebim.import_row_error('account_users', v_row, v_key, v_state, v_msg, v_constraint, v_value));
      end;
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

revoke all on function ebim.import_word(text) from public, anon, authenticated;
revoke all on function ebim.import_customer_kind(text) from public, anon, authenticated;
revoke all on function ebim.import_business_role(text) from public, anon, authenticated;
revoke all on function ebim.import_member_status(text) from public, anon, authenticated;

revoke all on function public.import_customers(jsonb, boolean) from public, anon;
revoke all on function public.import_business_account_users(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_customers(jsonb, boolean) to authenticated, service_role;
grant execute on function public.import_business_account_users(uuid, jsonb, boolean) to authenticated, service_role;

comment on function public.import_customers(jsonb, boolean) is
  'Importa clientes desde Excel por CÓDIGO (crea o actualiza). Simula con p_dry_run; aplicar es todo o nada. Tenant del token.';
comment on function public.import_business_account_users(uuid, jsonb, boolean) is
  'Importa compradores de cuentas B2B por correo vía add_business_account_user. Simula con p_dry_run; aplicar es todo o nada.';
