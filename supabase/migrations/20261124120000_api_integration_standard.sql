-- =============================================================================
-- Contrato de integración v1 · cierre de huecos (2026-11-24)
--
-- `docs/integrations/CONTRATO_INTEGRACION_v1.md` fija el estándar con el que
-- CUALQUIER ERP se conecta a eCommerce. La API ya cubría leer pedidos,
-- productos, stock y clientes, crear pedidos y cargar catálogo. Esto cierra lo
-- que faltaba para que un ERP cierre el ciclo sin intervención manual:
--
--   POST /v1/orders/{number}/status   order.update    estado, pago y entrega del
--                                                     pedido + referencias del ERP
--   POST /v1/customers:batch          customer.write  clientes por código, con el
--                                                     código del ERP
--   POST /v1/stock:batch              stock.write     saldo absoluto por almacén
--   POST /v1/price-lists/{code}/items:batch  price.write  precios de una lista
--   GET  /v1/orders|products|customers  + updated_since (sincronía incremental)
--
-- ## Una sola lógica, dos puertas
--
-- La pantalla y la API hacen lo MISMO. Para no copiar reglas:
--  · `order_transition` (backoffice) y `api_order_update` (ERP) llaman a
--    `ebim.order_apply_transition`, el cuerpo de siempre sin la comprobación de
--    persona: cada puerta autoriza a su manera (rol del usuario / credencial con
--    scope) y el núcleo registra el origen (`backoffice` / `api`).
--  · `import_customers` (Excel) y `api_customers_upsert` (ERP) llaman a
--    `ebim.import_customers_core`.
--  · Stock y precios reutilizan `sync_inventory_level` y `connector_resolve_sku`,
--    los mismos que las fuentes de lectura: un saldo empujado y uno leído
--    siguen las mismas reglas (solo almacenes cuyo sistema de registro es el ERP).
--
-- ## Lotes
--
-- Igual que `catalog/products:batch`: `dry_run` valida sin escribir, informe
-- fila por fila, TODO O NADA (un lote con errores no escribe nada → 422 con el
-- informe), `Idempotency-Key` obligatoria.
--
-- ## Corrección incluida
--
-- `api_products_list` filtraba por `products.store_id` (la tienda de ORIGEN del
-- maestro) y leía precio y estado de la fachada legacy: en una tienda que no es
-- la de origen la API no devolvía sus productos. Ahora lee la PUBLICACIÓN de la
-- tienda (`store_products`), como la vitrina.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0 · Scopes nuevos
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
    'order.update',
    'product.read',
    'stock.read',
    'stock.write',
    'customer.read',
    'customer.write',
    'catalog.write',
    'price.write'
  ]::text[];
$fn$;

-- ---------------------------------------------------------------------------
-- 1 · Estado del pedido: núcleo común
-- ---------------------------------------------------------------------------
create or replace function ebim.order_apply_transition(
  p_order_id uuid,
  p_axis     text,
  p_to       text,
  p_reason   text,
  p_source   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order  public.orders%rowtype;
  v_after  public.orders%rowtype;
  v_axis   text := lower(btrim(coalesce(p_axis, '')));
  v_to     text := lower(btrim(coalesce(p_to, '')));
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 1000), '');
  v_from   text;
  v_event  uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese identificador'
      using errcode = '22023';
  end if;


  if v_axis not in ('order_status', 'payment_status', 'fulfillment_status') then
    raise exception 'EJE_NO_VALIDO: "%" no es un eje de estado del pedido', p_axis
      using errcode = '22023';
  end if;

  -- El destino se comprueba contra las etiquetas del enum ANTES de convertirlo.
  -- Sin esto, un valor inventado sale como `invalid input value for enum`, que
  -- es un 22P02 sin codigo de dominio y que la pantalla no sabe traducir.
  if not exists (
    select 1
    from unnest(case v_axis
      when 'order_status'   then enum_range(null::public.order_status)::text[]
      when 'payment_status' then enum_range(null::public.payment_status)::text[]
      else enum_range(null::public.fulfillment_status)::text[]
    end) as label
    where label = v_to
  ) then
    raise exception 'ESTADO_NO_VALIDO: "%" no es un estado de %', p_to, v_axis
      using errcode = '22023';
  end if;

  -- El motivo y el origen viajan por ajustes LOCALES de transaccion. Los lee el
  -- trigger de la linea de tiempo, que es el unico escritor de `order_events`.
  perform set_config('ebim.order_event_reason', coalesce(v_reason, ''), true);
  perform set_config('ebim.order_event_source', p_source, true);

  if v_axis = 'order_status' then
    v_from := v_order.status::text;
    if v_to = v_from then
      raise exception 'TRANSICION_SIN_CAMBIO: el pedido ya esta en "%"', v_to
        using errcode = '22023';
    end if;
    update public.orders set status = v_to::public.order_status where id = v_order.id;

  elsif v_axis = 'payment_status' then
    v_from := v_order.payment_status::text;
    if v_to = v_from then
      raise exception 'TRANSICION_SIN_CAMBIO: el pago ya esta en "%"', v_to
        using errcode = '22023';
    end if;
    update public.orders set payment_status = v_to::public.payment_status where id = v_order.id;

  else
    v_from := v_order.fulfillment_status::text;
    if v_to = v_from then
      raise exception 'TRANSICION_SIN_CAMBIO: la entrega ya esta en "%"', v_to
        using errcode = '22023';
    end if;
    update public.orders set fulfillment_status = v_to::public.fulfillment_status
     where id = v_order.id;
  end if;

  select * into v_after from public.orders o where o.id = v_order.id;

  -- El hecho de dominio se ancla al evento que el trigger acaba de escribir: la
  -- clave de deduplicacion es su id, asi que no hace falta inventar una y no
  -- puede colisionar con la de otro cambio al mismo valor.
  select e.id into v_event
  from public.order_events e
  where e.order_id = v_order.id
    and e.axis = v_axis::public.order_event_axis
    and e.to_value = v_to
  order by e.created_at desc, e.id desc
  limit 1;

  perform ebim.publish_event(
    v_after.organization_id, v_after.company_id, v_after.store_id,
    case v_axis
      when 'order_status'       then 'order.status_changed'
      when 'payment_status'     then 'order.payment_status_changed'
      else 'order.fulfillment_status_changed'
    end,
    'order', v_after.id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_id',           v_after.id,
      'order_number',       v_after.order_number,
      'axis',               v_axis,
      'from',               v_from,
      'to',                 v_to,
      'reason',             v_reason,
      'status',             v_after.status,
      'payment_status',     v_after.payment_status,
      'fulfillment_status', v_after.fulfillment_status,
      'currency',           v_after.currency,
      'grand_total',        v_after.grand_total::text,
      'customer_email',     v_after.customer_email)),
    'order.transition:' || coalesce(v_event::text, v_after.id::text || ':' || v_axis || ':' || v_to));

  return jsonb_build_object(
    'order_id',           v_after.id,
    'order_number',       v_after.order_number,
    'axis',               v_axis,
    'from',               v_from,
    'to',                 v_to,
    'status',             v_after.status,
    'payment_status',     v_after.payment_status,
    'fulfillment_status', v_after.fulfillment_status,
    'approval_status',    v_after.approval_status,
    'updated_at',         v_after.updated_at);
end;
$fn$;

revoke execute on function ebim.order_apply_transition(uuid, text, text, text, text) from public, anon, authenticated;

-- La puerta del backoffice: misma firma, misma respuesta; la persona se
-- comprueba aquí y el núcleo hace el resto.
create or replace function public.order_transition(
  p_order_id uuid,
  p_axis     text,
  p_to       text,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese identificador'
      using errcode = '22023';
  end if;
  perform ebim.assert_order_operator(v_order);
  return ebim.order_apply_transition(p_order_id, p_axis, p_to, p_reason, 'backoffice');
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Clientes: núcleo común
-- ---------------------------------------------------------------------------
create or replace function ebim.import_customers_core(
  p_org        uuid,
  p_company    uuid,
  p_can_erp    boolean,
  p_rows       jsonb,
  p_dry_run    boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org        uuid := p_org;
  v_company    uuid := p_company;
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
  v_can_erp := coalesce(p_can_erp, false);

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

revoke execute on function ebim.import_customers_core(uuid, uuid, boolean, jsonb, boolean) from public, anon, authenticated;

-- La puerta del Excel: misma firma y mismas reglas de quién puede.
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
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
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
  return ebim.import_customers_core(
    v_org, v_company,
    ebim.has_role(v_org, v_company, array['owner', 'admin']::public.app_role[]),
    p_rows, p_dry_run);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3 · POST /v1/orders/{number}/status · order.update
--
-- Cuerpo: { status?, payment_status?, fulfillment_status?, reason?,
--           external_refs?: [{ system, type?, id, url? }] }
-- Un eje que ya está en el valor pedido no es un error: es un reintento del ERP
-- y se informa como `unchanged`. Las referencias del ERP (su número de pedido,
-- su factura, su guía) quedan en `order_external_refs`.
-- ---------------------------------------------------------------------------
create or replace function public.api_order_update(
  p_api_client_id uuid,
  p_number        text,
  p_store         text  default null,
  p_payload       jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_client   public.api_clients%rowtype;
  v_store    public.stores%rowtype;
  v_order    public.orders%rowtype;
  v_payload  jsonb := coalesce(p_payload, '{}'::jsonb);
  v_reason   text;
  v_axis     text;
  v_to       text;
  v_current  text;
  v_changed  jsonb := '[]'::jsonb;
  v_same     jsonb := '[]'::jsonb;
  v_ref      jsonb;
  v_refs     integer := 0;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'order.update');
  v_store  := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'LOTE_INVALIDO: el cuerpo tiene que ser un objeto' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(v_payload) k
              where k not in ('status', 'payment_status', 'fulfillment_status', 'reason', 'external_refs')) then
    raise exception 'CAMPO_NO_PERMITIDO: el cuerpo trae campos desconocidos' using errcode = '22023';
  end if;
  if not (v_payload ?| array['status', 'payment_status', 'fulfillment_status', 'external_refs']) then
    raise exception 'CAMBIOS_REQUERIDOS: indica al menos un estado o una referencia' using errcode = '22023';
  end if;

  select * into v_order from public.orders o
   where o.organization_id = v_client.organization_id and o.company_id = v_client.company_id
     and o.store_id = v_store.id and o.order_number = btrim(coalesce(p_number, ''))
   for update;
  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese numero' using errcode = '22023';
  end if;

  v_reason := nullif(left(btrim(coalesce(v_payload ->> 'reason', '')), 1000), '');

  -- Entrega y pago antes que el estado general: «despachado y pagado, luego
  -- cumplido» es el orden en que pasan las cosas.
  foreach v_axis in array array['fulfillment_status', 'payment_status', 'status'] loop
    continue when not (v_payload ? v_axis);
    v_to := lower(btrim(coalesce(v_payload ->> v_axis, '')));
    select case v_axis when 'status' then o.status::text
                       when 'payment_status' then o.payment_status::text
                       else o.fulfillment_status::text end
      into v_current from public.orders o where o.id = v_order.id;
    if v_to = v_current then
      v_same := v_same || to_jsonb(v_axis);
    else
      perform ebim.order_apply_transition(
        v_order.id, case v_axis when 'status' then 'order_status' else v_axis end, v_to, v_reason, 'api');
      v_changed := v_changed || to_jsonb(v_axis);
    end if;
  end loop;

  if v_payload ? 'external_refs' then
    if jsonb_typeof(v_payload -> 'external_refs') <> 'array' or jsonb_array_length(v_payload -> 'external_refs') > 10 then
      raise exception 'REFERENCIA_INVALIDA: external_refs es una lista de hasta 10' using errcode = '22023';
    end if;
    for v_ref in select x from jsonb_array_elements(v_payload -> 'external_refs') x loop
      if jsonb_typeof(v_ref) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_ref) k where k not in ('system', 'type', 'id', 'url')) then
        raise exception 'REFERENCIA_INVALIDA: cada referencia es { system, type, id, url }' using errcode = '22023';
      end if;
      begin
      insert into public.order_external_refs
        (organization_id, company_id, store_id, order_id, system_code, ref_type, external_id, external_url)
      values
        (v_order.organization_id, v_order.company_id, v_order.store_id, v_order.id,
         lower(btrim(coalesce(v_ref ->> 'system', ''))),
         lower(btrim(coalesce(nullif(v_ref ->> 'type', ''), 'order'))),
         btrim(coalesce(v_ref ->> 'id', '')),
         nullif(btrim(coalesce(v_ref ->> 'url', '')), ''))
      on conflict (order_id, system_code, ref_type) do update
        set external_id = excluded.external_id, external_url = excluded.external_url, updated_at = now();
      exception
        -- Una referencia mal formada viola un CHECK: se nombra como tal.
        when check_violation then
          raise exception 'REFERENCIA_INVALIDA: system, type, id o url no tienen el formato esperado'
            using errcode = '22023';
      end;
      v_refs := v_refs + 1;
    end loop;
  end if;

  return ebim.api_order_json(v_order.id, false) || jsonb_build_object(
    'changes', jsonb_build_object('changed', v_changed, 'unchanged', v_same, 'external_refs', v_refs));
end;
$fn$;

revoke execute on function public.api_order_update(uuid, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.api_order_update(uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4 · POST /v1/customers:batch · customer.write
--
-- Cuerpo: { system?: "sap", customers: [{ code, kind, name, legal_name, tax_id,
--           email, phone, segment, is_active, notes, external_id }] }
-- Mismas reglas que la importación por Excel (upsert por CÓDIGO, celda vacía no
-- borra, todo o nada). `external_id` es el código del cliente en el ERP.
-- ---------------------------------------------------------------------------
create or replace function public.api_customers_upsert(
  p_api_client_id uuid,
  p_dry_run       boolean default false,
  p_payload       jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_client  public.api_clients%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_system  text;
  v_rows    jsonb;
  v_bad     text;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'customer.write');
  if jsonb_typeof(v_payload) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_payload) k where k not in ('system', 'customers'))
     or jsonb_typeof(v_payload -> 'customers') is distinct from 'array' then
    raise exception 'LOTE_INVALIDO: el cuerpo es { system?, customers: [...] }' using errcode = '22023';
  end if;
  if jsonb_array_length(v_payload -> 'customers') > 1000 then
    raise exception 'LOTE_EXCESIVO: como mucho 1000 clientes por lote' using errcode = '22023';
  end if;
  -- Con el vocabulario de la API, no el de la hoja: el socio no subió un Excel.
  select string_agg(distinct k, ', ' order by k) into v_bad
    from jsonb_array_elements(v_payload -> 'customers') c(item),
         lateral jsonb_object_keys(case jsonb_typeof(c.item) when 'object' then c.item else '{}'::jsonb end) k
   where k not in ('code', 'kind', 'name', 'legal_name', 'tax_id', 'email', 'phone', 'segment',
                   'is_active', 'notes', 'external_id');
  if v_bad is not null then
    raise exception 'CAMPO_NO_PERMITIDO: campos que no son del contrato: %', v_bad using errcode = '22023';
  end if;
  v_system := nullif(lower(btrim(coalesce(v_payload ->> 'system', ''))), '');

  -- De la forma de la API a la de la hoja: `external_id` → `erp_code` y el
  -- sistema del lote en cada fila. Un campo desconocido llega tal cual y la
  -- validación común lo rechaza.
  select coalesce(jsonb_agg(
           (c.item - 'external_id')
           || jsonb_build_object('row', c.ord)
           || case when c.item ? 'external_id'
                   then jsonb_build_object('erp_code', c.item -> 'external_id', 'erp_system', coalesce(v_system, 'erp'))
                   else '{}'::jsonb end
           order by c.ord), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(v_payload -> 'customers') with ordinality as c(item, ord);

  return ebim.import_customers_core(v_client.organization_id, v_client.company_id, true, v_rows, coalesce(p_dry_run, false));
end;
$fn$;

revoke execute on function public.api_customers_upsert(uuid, boolean, jsonb) from public, anon, authenticated;
grant  execute on function public.api_customers_upsert(uuid, boolean, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5 · POST /v1/stock:batch · stock.write
--
-- Cuerpo: { items: [{ sku, warehouse, on_hand }] } — saldo ABSOLUTO por almacén.
-- Solo almacenes cuyo sistema de registro es el ERP (`warehouses.source = 'erp'`):
-- el stock de un almacén que lleva la tienda no lo pisa una integración.
-- ---------------------------------------------------------------------------
create or replace function public.api_stock_set(
  p_api_client_id uuid,
  p_dry_run       boolean default false,
  p_payload       jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_client   public.api_clients%rowtype;
  v_payload  jsonb := coalesce(p_payload, '{}'::jsonb);
  v_row      jsonb;
  v_i        integer := 0;
  v_sku      text;
  v_wh       public.warehouses%rowtype;
  v_qty      numeric;
  v_item     record;
  v_out      jsonb;
  v_result   jsonb := '[]'::jsonb;
  v_updated  integer := 0;
  v_same     integer := 0;
  v_errors   integer := 0;
  v_state    text;
  v_msg      text;
  v_count    integer;
  -- Una marca por llamada: el motor de inventario descarta un movimiento cuya
  -- referencia externa ya existe, y el reintento lo cubre la Idempotency-Key.
  v_batch    uuid := gen_random_uuid();
begin
  v_client := ebim.api_authorize(p_api_client_id, 'stock.write');
  if jsonb_typeof(v_payload) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_payload) k where k <> 'items')
     or jsonb_typeof(v_payload -> 'items') is distinct from 'array' then
    raise exception 'LOTE_INVALIDO: el cuerpo es { items: [{ sku, warehouse, on_hand }] }' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(v_payload -> 'items');
  if v_count > 2000 then
    raise exception 'LOTE_EXCESIVO: como mucho 2000 saldos por lote' using errcode = '22023';
  end if;

  begin
    for v_row in select x from jsonb_array_elements(v_payload -> 'items') x loop
      v_i := v_i + 1;
      v_sku := null;
      begin
        if jsonb_typeof(v_row) <> 'object'
           or exists (select 1 from jsonb_object_keys(v_row) k where k not in ('sku', 'warehouse', 'on_hand')) then
          raise exception 'CAMPO_NO_PERMITIDO: cada saldo es { sku, warehouse, on_hand }' using errcode = '22023';
        end if;
        v_sku := nullif(btrim(coalesce(v_row ->> 'sku', '')), '');
        if v_sku is null then
          raise exception 'CAMPO_REQUERIDO: sku' using errcode = '22023';
        end if;
        begin
          v_qty := (v_row ->> 'on_hand')::numeric;
        exception when others then
          raise exception 'FORMATO_INVALIDO: on_hand' using errcode = '22023';
        end;
        if v_qty is null or v_qty < 0 then
          raise exception 'VALOR_INVALIDO: on_hand' using errcode = '22023';
        end if;
        if nullif(btrim(coalesce(v_row ->> 'warehouse', '')), '') is null then
          raise exception 'CAMPO_REQUERIDO: warehouse' using errcode = '22023';
        end if;
        select * into v_wh from public.warehouses w
         where w.organization_id = v_client.organization_id and w.company_id = v_client.company_id
           and lower(w.code) = lower(btrim(v_row ->> 'warehouse'));
        if not found then
          raise exception 'ALMACEN_NO_ENCONTRADO: warehouse' using errcode = '22023';
        end if;
        if v_wh.source::text <> 'erp' then
          raise exception 'ALMACEN_NO_ERP: warehouse' using errcode = '22023';
        end if;
        select * into v_item from ebim.connector_resolve_sku(v_client.organization_id, v_client.company_id, v_sku);
        if v_item.product_id is null then
          raise exception 'SKU_NO_ENCONTRADO: sku' using errcode = '22023';
        end if;

        v_out := public.sync_inventory_level(
          v_wh.id, v_item.product_id, v_item.variant_id, v_qty,
          'api:' || v_batch::text || ':' || v_i::text,
          'sincronizacion por la API de integracion');
        if coalesce((v_out ->> 'applied')::boolean, false) then
          v_updated := v_updated + 1;
          v_result := v_result || jsonb_build_array(jsonb_build_object('row', v_i, 'key', v_sku, 'status', 'updated'));
        else
          v_same := v_same + 1;
          v_result := v_result || jsonb_build_array(jsonb_build_object('row', v_i, 'key', v_sku, 'status', 'unchanged'));
        end if;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
        v_errors := v_errors + 1;
        v_result := v_result || jsonb_build_array(ebim.import_row_error('stock', v_i, v_sku, v_state, v_msg, null));
      end;
    end loop;

    if coalesce(p_dry_run, false) or v_errors > 0 then
      raise exception 'EBIM_IMPORT_ROLLBACK' using errcode = 'EB001';
    end if;
  exception when sqlstate 'EB001' then
    null;
  end;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, false), 'applied', not coalesce(p_dry_run, false) and v_errors = 0,
    'total', v_count, 'updated', v_updated, 'unchanged', v_same, 'errors', v_errors, 'rows', v_result);
end;
$fn$;

revoke execute on function public.api_stock_set(uuid, boolean, jsonb) from public, anon, authenticated;
grant  execute on function public.api_stock_set(uuid, boolean, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6 · POST /v1/price-lists/{code}/items:batch · price.write
--
-- Cuerpo: { items: [{ sku, price, compare_at_price?, min_quantity?, currency?, active? }] }
-- Upsert por SKU y cantidad mínima; `active: false` quita el precio de la lista.
-- La lista (de la tienda) tiene que existir: crearla y asignarla es una decisión
-- comercial que se toma en Precios.
-- ---------------------------------------------------------------------------
create or replace function public.api_price_list_upsert(
  p_api_client_id uuid,
  p_code          text,
  p_store         text    default null,
  p_dry_run       boolean default false,
  p_payload       jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_client    public.api_clients%rowtype;
  v_store     public.stores%rowtype;
  v_list      public.price_lists%rowtype;
  v_payload   jsonb := coalesce(p_payload, '{}'::jsonb);
  v_row       jsonb;
  v_i         integer := 0;
  v_sku       text;
  v_price     numeric;
  v_compare   numeric;
  v_min       numeric;
  v_currency  text;
  v_active    boolean;
  v_item      record;
  v_existing  public.price_list_items%rowtype;
  v_status    text;
  v_result    jsonb := '[]'::jsonb;
  v_created   integer := 0;
  v_updated   integer := 0;
  v_errors    integer := 0;
  v_state     text;
  v_msg       text;
  v_count     integer;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'price.write');
  v_store  := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);
  select * into v_list from public.price_lists l
   where l.store_id = v_store.id and lower(l.code) = lower(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'LISTA_NO_ENCONTRADA: no hay ninguna lista de precios con ese codigo en la tienda'
      using errcode = '22023';
  end if;
  if jsonb_typeof(v_payload) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_payload) k where k <> 'items')
     or jsonb_typeof(v_payload -> 'items') is distinct from 'array' then
    raise exception 'LOTE_INVALIDO: el cuerpo es { items: [{ sku, price, ... }] }' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(v_payload -> 'items');
  if v_count > 2000 then
    raise exception 'LOTE_EXCESIVO: como mucho 2000 precios por lote' using errcode = '22023';
  end if;

  begin
    for v_row in select x from jsonb_array_elements(v_payload -> 'items') x loop
      v_i := v_i + 1;
      v_sku := null;
      begin
        if jsonb_typeof(v_row) <> 'object'
           or exists (select 1 from jsonb_object_keys(v_row) k
                       where k not in ('sku', 'price', 'compare_at_price', 'min_quantity', 'currency', 'active')) then
          raise exception 'CAMPO_NO_PERMITIDO: cada precio es { sku, price, compare_at_price, min_quantity, currency, active }'
            using errcode = '22023';
        end if;
        v_sku := nullif(btrim(coalesce(v_row ->> 'sku', '')), '');
        if v_sku is null then
          raise exception 'CAMPO_REQUERIDO: sku' using errcode = '22023';
        end if;
        v_currency := upper(nullif(btrim(coalesce(v_row ->> 'currency', '')), ''));
        if v_currency is not null and v_currency <> v_list.currency then
          raise exception 'MONEDA_DISTINTA: currency' using errcode = '22023';
        end if;
        begin
          v_min := coalesce((v_row ->> 'min_quantity')::numeric, 1);
          v_price := (v_row ->> 'price')::numeric;
          v_compare := (v_row ->> 'compare_at_price')::numeric;
        exception when others then
          raise exception 'FORMATO_INVALIDO: price' using errcode = '22023';
        end;
        if v_min <= 0 then
          raise exception 'VALOR_INVALIDO: min_quantity' using errcode = '22023';
        end if;
        v_active := case jsonb_typeof(v_row -> 'active') when 'boolean' then (v_row ->> 'active')::boolean else true end;

        select * into v_item from ebim.connector_resolve_sku(v_client.organization_id, v_client.company_id, v_sku, v_list.store_id);
        if v_item.product_id is null then
          raise exception 'SKU_NO_ENCONTRADO: sku' using errcode = '22023';
        end if;

        v_existing := null;
        select * into v_existing from public.price_list_items it
         where it.price_list_id = v_list.id and it.product_id = v_item.product_id
           and it.variant_id is not distinct from v_item.variant_id
           and it.uom_id is null and it.min_quantity = v_min;

        if not v_active then
          if v_existing.id is not null then
            delete from public.price_list_items where id = v_existing.id;
          end if;
          v_status := 'updated';
          v_updated := v_updated + 1;
        else
          if v_price is null or v_price < 0 then
            raise exception 'VALOR_INVALIDO: price' using errcode = '22023';
          end if;
          if v_compare is not null and v_compare < v_price then
            raise exception 'VALOR_INVALIDO: compare_at_price' using errcode = '22023';
          end if;
          if v_existing.id is null then
            insert into public.price_list_items (
              organization_id, company_id, store_id, price_list_id, product_id, variant_id,
              min_quantity, unit_price, compare_at_price)
            values (v_list.organization_id, v_list.company_id, v_list.store_id, v_list.id,
                    v_item.product_id, v_item.variant_id, v_min, round(v_price, 2), round(v_compare, 2));
            v_status := 'created';
            v_created := v_created + 1;
          else
            update public.price_list_items
               set unit_price = round(v_price, 2), compare_at_price = round(v_compare, 2)
             where id = v_existing.id;
            v_status := 'updated';
            v_updated := v_updated + 1;
          end if;
        end if;
        v_result := v_result || jsonb_build_array(jsonb_build_object('row', v_i, 'key', v_sku, 'status', v_status));
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
        v_errors := v_errors + 1;
        v_result := v_result || jsonb_build_array(ebim.import_row_error('prices', v_i, v_sku, v_state, v_msg, null));
      end;
    end loop;

    if coalesce(p_dry_run, false) or v_errors > 0 then
      raise exception 'EBIM_IMPORT_ROLLBACK' using errcode = 'EB001';
    end if;
  exception when sqlstate 'EB001' then
    null;
  end;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, false), 'applied', not coalesce(p_dry_run, false) and v_errors = 0,
    'price_list', v_list.code, 'total', v_count, 'created', v_created, 'updated', v_updated,
    'errors', v_errors, 'rows', v_result);
end;
$fn$;

revoke execute on function public.api_price_list_upsert(uuid, text, text, boolean, jsonb) from public, anon, authenticated;
grant  execute on function public.api_price_list_upsert(uuid, text, text, boolean, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 7 · Lecturas incrementales: `updated_since`
--
-- Filtro, no orden: el ERP pide «lo que cambió desde mi última sincronía» y
-- pagina con el cursor de siempre hasta que `next_cursor` sea null. La
-- respuesta trae `server_time`: es la marca que debe guardar para la próxima
-- vez (la del servidor, no la de su reloj).
-- ---------------------------------------------------------------------------
drop function if exists public.api_orders_list(uuid, integer, timestamptz, text, text);
create or replace function public.api_orders_list(
  p_api_client_id uuid,
  p_limit         integer     default 50,
  p_cursor        timestamptz default null,
  p_status        text        default null,
  p_store         text        default null,
  p_updated_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_client public.api_clients%rowtype;
  v_store  public.stores%rowtype;
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_rows   jsonb;
  v_next   timestamptz;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'order.read');
  v_store  := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);

  with pagina as (
    select o.id, o.placed_at
    from public.orders o
    where o.organization_id = v_client.organization_id
      and o.company_id      = v_client.company_id
      and o.store_id        = v_store.id
      and (p_cursor is null or o.placed_at < p_cursor)
      and (p_status is null or o.status::text = lower(btrim(p_status)))
      and (p_updated_since is null or o.updated_at >= p_updated_since)
    order by o.placed_at desc, o.id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(ebim.api_order_json(p.id, false) order by p.placed_at desc), '[]'::jsonb),
         min(p.placed_at)
    into v_rows, v_next
  from pagina p;

  return jsonb_build_object(
    'data', v_rows,
    'next_cursor',
      case when jsonb_array_length(v_rows) = v_limit
           then to_char(v_next at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USZ')
           else null end,
    'server_time', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USZ'));
end;
$fn$;

drop function if exists public.api_products_list(uuid, integer, text, text);
create or replace function public.api_products_list(
  p_api_client_id uuid,
  p_limit         integer     default 50,
  p_cursor        text        default null,
  p_store         text        default null,
  p_updated_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_client public.api_clients%rowtype;
  v_store  public.stores%rowtype;
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_rows   jsonb;
  v_next   text;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'product.read');
  v_store  := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);

  -- La PUBLICACIÓN de esta tienda (`store_products`), no la tienda de origen del
  -- maestro: es lo que se vende aquí y a qué precio.
  with pagina as (
    select p.sku, p.name, sp.status::text as status, sp.currency, sp.price, p.kind::text as kind, sp.slug,
           greatest(p.updated_at, sp.updated_at) as updated_at
    from public.store_products sp
    join public.products p on p.id = sp.product_id
    where sp.store_id = v_store.id
      and p.organization_id = v_client.organization_id
      and p.company_id      = v_client.company_id
      and (p_cursor is null or p.sku > p_cursor)
      and (p_updated_since is null or greatest(p.updated_at, sp.updated_at) >= p_updated_since)
    order by p.sku
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku',        g.sku,
           'name',       g.name,
           'slug',       g.slug,
           'kind',       g.kind,
           'status',     g.status,
           'currency',   g.currency,
           'price',      ebim.api_money(g.price),
           'updated_at', to_char(g.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by g.sku), '[]'::jsonb),
         max(g.sku)
    into v_rows, v_next
  from pagina g;

  return jsonb_build_object(
    'data', v_rows,
    'next_cursor', case when jsonb_array_length(v_rows) = v_limit then v_next else null end,
    'server_time', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USZ'));
end;
$fn$;

drop function if exists public.api_customers_list(uuid, integer, timestamptz);
create or replace function public.api_customers_list(
  p_api_client_id uuid,
  p_limit         integer     default 50,
  p_cursor        timestamptz default null,
  p_updated_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_client public.api_clients%rowtype;
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_rows   jsonb;
  v_next   timestamptz;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'customer.read');

  with pagina as (
    select c.id, c.created_at, c.updated_at, c.kind::text as kind, c.code, c.name,
           c.legal_name, c.email, c.phone, c.tax_id, c.is_active
    from public.customers c
    where c.organization_id = v_client.organization_id
      and c.company_id      = v_client.company_id
      and (p_cursor is null or c.created_at < p_cursor)
      and (p_updated_since is null or c.updated_at >= p_updated_since)
    order by c.created_at desc, c.id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           g.id,
           'kind',         g.kind,
           'code',         g.code,
           'name',         g.name,
           'legal_name',   g.legal_name,
           'email',        g.email,
           'phone',        g.phone,
           'tax_id',       g.tax_id,
           'is_active',    g.is_active,
           -- Los códigos del cliente en cada sistema externo: el ERP se reconoce.
           'external_ids', coalesce((select jsonb_object_agg(x.system_code, x.external_id)
                                       from public.customer_external_ids x where x.customer_id = g.id), '{}'::jsonb),
           'created_at',   to_char(g.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'updated_at',   to_char(g.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
         order by g.created_at desc), '[]'::jsonb),
         min(g.created_at)
    into v_rows, v_next
  from pagina g;

  return jsonb_build_object(
    'data', v_rows,
    'next_cursor',
      case when jsonb_array_length(v_rows) = v_limit
           then to_char(v_next at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USZ')
           else null end,
    'server_time', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USZ'));
end;
$fn$;

revoke execute on function public.api_orders_list(uuid, integer, timestamptz, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.api_products_list(uuid, integer, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.api_customers_list(uuid, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.api_orders_list(uuid, integer, timestamptz, text, text, timestamptz) to service_role;
grant  execute on function public.api_products_list(uuid, integer, text, text, timestamptz) to service_role;
grant  execute on function public.api_customers_list(uuid, integer, timestamptz, timestamptz) to service_role;
