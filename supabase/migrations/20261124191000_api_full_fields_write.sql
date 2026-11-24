-- =============================================================================
-- API de integración v1 · Campos COMPLETOS de escritura (2026-11-24)
--
-- La otra mitad de «todos los campos, tanto lo que envía como lo que recibe».
-- Aditivo: un cuerpo válido de ayer sigue siendo válido hoy.
--
--  · POST /v1/orders           + business_account, customer.code/external_id,
--                              billing_address, purchase_order_number, delivery,
--                              external_refs. Lo que `create_order` ya sabía
--                              hacer y la API no dejaba pasar. El PRECIO sigue
--                              siendo del motor (listas de precio): un pedido
--                              no trae importes, y `create_order` los rechaza.
--  · POST /v1/customers:batch  + tax_id_type, tier, business_type,
--                              visit_frequency, geo, addresses[], contacts[] y
--                              business_account (condiciones de crédito).
--                              Mismo lote todo-o-nada, mismo informe por fila.
--  · POST /v1/orders/{n}/status + shipment (guía de despacho del ERP o del
--                              operador logístico).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Pedido: todo lo que `create_order` admite
-- ---------------------------------------------------------------------------
create or replace function public.api_order_create(p_api_client_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client   public.api_clients%rowtype;
  v_store    public.stores%rowtype;
  v_payload  jsonb := coalesce(p_payload, '{}'::jsonb);
  v_items    jsonb := '[]'::jsonb;
  v_item     jsonb;
  v_sku      text;
  v_qty      integer;
  v_pid      uuid;
  v_vid      uuid;
  v_result   jsonb;
  v_account  uuid;
  v_code     text;
  v_bad      text;
  v_ref      jsonb;
  v_order    public.orders%rowtype;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'order.create');

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'CUERPO_INVALIDO: el pedido es un objeto' using errcode = '22023';
  end if;
  select string_agg(k, ', ' order by k) into v_bad
    from jsonb_object_keys(v_payload) k
   where k not in ('store', 'customer', 'business_account', 'items', 'shipping_address',
                   'billing_address', 'purchase_order_number', 'notes', 'delivery', 'external_refs');
  if v_bad is not null then
    raise exception 'CAMPO_NO_PERMITIDO: campos que no son del contrato: %', v_bad using errcode = '22023';
  end if;
  if v_payload ? 'customer' and jsonb_typeof(v_payload -> 'customer') <> 'object' then
    raise exception 'CLIENTE_INVALIDO: customer es un objeto' using errcode = '22023';
  end if;
  select string_agg(k, ', ' order by k) into v_bad
    from jsonb_object_keys(coalesce(v_payload -> 'customer', '{}'::jsonb)) k
   where k not in ('email', 'name', 'phone', 'code', 'external_id');
  if v_bad is not null then
    raise exception 'CAMPO_NO_PERMITIDO: campos de customer que no son del contrato: %', v_bad using errcode = '22023';
  end if;

  v_store := ebim.api_store(v_client.organization_id, v_client.company_id, v_payload ->> 'store');

  -- La cuenta de empresa: por su código o por el cliente (código o id del ERP),
  -- SIEMPRE dentro de la sociedad del cliente API.
  v_code := nullif(btrim(coalesce(v_payload ->> 'business_account', '')), '');
  if v_code is not null then
    select a.id into v_account
    from public.business_accounts a
    where a.organization_id = v_client.organization_id
      and a.company_id      = v_client.company_id
      and lower(a.code)     = lower(v_code);
    if v_account is null then
      raise exception 'CUENTA_NO_ENCONTRADA: no hay ninguna cuenta de empresa con el codigo %', v_code
        using errcode = '22023';
    end if;
  else
    v_code := coalesce(nullif(btrim(coalesce(v_payload #>> '{customer,code}', '')), ''),
                       nullif(btrim(coalesce(v_payload #>> '{customer,external_id}', '')), ''));
    if v_code is not null then
      select a.id into v_account
      from public.customers c
      join public.business_accounts a on a.customer_id = c.id
      where c.organization_id = v_client.organization_id
        and c.company_id      = v_client.company_id
        and (lower(c.code) = lower(v_code)
             or exists (select 1 from public.customer_external_ids x
                        where x.customer_id = c.id and x.external_id = v_code))
      limit 1;
      if v_account is null and not exists (
        select 1 from public.customers c
        where c.organization_id = v_client.organization_id
          and c.company_id      = v_client.company_id
          and (lower(c.code) = lower(v_code)
               or exists (select 1 from public.customer_external_ids x
                          where x.customer_id = c.id and x.external_id = v_code))
      ) then
        raise exception 'CLIENTE_NO_ENCONTRADO: no hay ningun cliente con el codigo %', v_code
          using errcode = '22023';
      end if;
    end if;
  end if;

  if jsonb_typeof(v_payload -> 'items') is distinct from 'array'
     or jsonb_array_length(v_payload -> 'items') = 0 then
    raise exception 'ITEMS_REQUERIDOS: el pedido necesita al menos una linea'
      using errcode = '22023';
  end if;
  if jsonb_array_length(v_payload -> 'items') > 200 then
    raise exception 'ITEMS_EXCESIVOS: demasiadas lineas en un solo pedido'
      using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(v_payload -> 'items')
  loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_item) k where k not in ('sku', 'quantity', 'uom_code')) then
      raise exception 'CAMPO_NO_PERMITIDO: cada linea es { sku, quantity, uom_code? }; el precio lo pone la tienda'
        using errcode = '22023';
    end if;
    v_sku := nullif(btrim(coalesce(v_item ->> 'sku', '')), '');
    if v_sku is null then
      raise exception 'SKU_REQUERIDO: cada linea se identifica por su sku'
        using errcode = '22023';
    end if;

    v_qty := coalesce((v_item ->> 'quantity')::integer, 0);
    if v_qty <= 0 then
      raise exception 'CANTIDAD_INVALIDA: la cantidad de % tiene que ser mayor que cero', v_sku
        using errcode = '22023';
    end if;

    v_pid := null;
    v_vid := null;

    select pv.id, pv.product_id into v_vid, v_pid
    from public.product_variants pv
    join public.store_products sp on sp.product_id = pv.product_id and sp.store_id = v_store.id
    where pv.sku = v_sku
    limit 1;

    if v_vid is null then
      select p.id into v_pid
      from public.products p
      join public.store_products sp on sp.product_id = p.id and sp.store_id = v_store.id
      where p.sku = v_sku
      limit 1;
    end if;

    if v_pid is null then
      raise exception 'PRODUCTO_NO_DISPONIBLE: no hay ningun articulo con el sku %', v_sku
        using errcode = '22023';
    end if;

    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'product_id', v_pid,
      'variant_id', v_vid,
      'uom_code',   nullif(btrim(coalesce(v_item ->> 'uom_code', '')), ''),
      'quantity',   v_qty)));
  end loop;

  if v_payload ? 'external_refs'
     and (jsonb_typeof(v_payload -> 'external_refs') <> 'array'
          or jsonb_array_length(v_payload -> 'external_refs') > 10) then
    raise exception 'REFERENCIA_INVALIDA: external_refs es una lista de hasta 10' using errcode = '22023';
  end if;

  v_result := public.create_order(
    p_store_id              => v_store.id,
    p_customer_email        => v_payload #>> '{customer,email}',
    p_items                 => v_items,
    p_customer_name         => v_payload #>> '{customer,name}',
    p_customer_phone        => v_payload #>> '{customer,phone}',
    p_shipping_address      => coalesce(v_payload -> 'shipping_address', '{}'::jsonb),
    p_notes                 => nullif(btrim(coalesce(v_payload ->> 'notes', '')), ''),
    p_reservation_token     => null,
    -- El ORIGEN lo declara esta funcion, no el socio.
    p_source_channel        => 'api',
    p_business_account_id   => v_account,
    p_billing_address       => v_payload -> 'billing_address',
    p_delivery              => v_payload -> 'delivery',
    p_purchase_order_number => v_payload ->> 'purchase_order_number');

  select * into v_order from public.orders where id = ebim.safe_uuid(v_result ->> 'order_id');

  for v_ref in select x from jsonb_array_elements(coalesce(v_payload -> 'external_refs', '[]'::jsonb)) x loop
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
    exception when check_violation then
      raise exception 'REFERENCIA_INVALIDA: system, type, id o url no tienen el formato esperado'
        using errcode = '22023';
    end;
  end loop;

  perform ebim.audit(
    p_organization_id => v_client.organization_id,
    p_company_id      => v_client.company_id,
    p_action          => 'order.created_via_api',
    p_entity_type     => 'order',
    p_entity_id       => v_order.id,
    p_entity_label    => v_order.order_number,
    p_store_id        => v_store.id,
    p_metadata        => jsonb_build_object('api_client_id', v_client.id,
                                            'client_id', v_client.client_id),
    p_actor_kind      => 'service'::public.audit_actor_kind);

  return public.api_order_get(p_api_client_id, v_order.order_number, v_store.slug);
end;
$$;

-- ---------------------------------------------------------------------------
-- Clientes: ficha completa
-- ---------------------------------------------------------------------------

-- Aplica lo que la hoja de Excel no conoce (direcciones, contactos, cuenta de
-- empresa, tipo de documento…) a UN cliente ya creado o actualizado por el
-- núcleo. Lanza excepción con código estable; quien llama la convierte en error
-- de fila.
create or replace function ebim.api_customer_apply_extras(p_customer_id uuid, p_item jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c       public.customers%rowtype;
  v_x       jsonb;
  v_id      uuid;
  v_bt      uuid;
  v_ba      jsonb;
  v_ref     text;
begin
  select * into v_c from public.customers where id = p_customer_id;

  if p_item ? 'tax_id_type' then
    if nullif(lower(btrim(coalesce(p_item ->> 'tax_id_type', ''))), '') is not null
       and lower(btrim(p_item ->> 'tax_id_type')) <> all (array['ruc', 'dni', 'ce', 'passport']) then
      raise exception 'TIPO_DOCUMENTO_INVALIDO: tax_id_type es ruc, dni, ce o passport' using errcode = '22023';
    end if;
    update public.customers set tax_id_type = nullif(lower(btrim(p_item ->> 'tax_id_type')), '')
     where id = p_customer_id;
  end if;
  if p_item ? 'tier' then
    update public.customers set tier = nullif(lower(btrim(p_item ->> 'tier')), '')::public.customer_tier
     where id = p_customer_id;
  end if;
  if p_item ? 'visit_frequency' then
    update public.customers
       set visit_frequency = nullif(lower(btrim(p_item ->> 'visit_frequency')), '')::public.visit_frequency
     where id = p_customer_id;
  end if;
  if p_item ? 'business_type' then
    if nullif(btrim(coalesce(p_item ->> 'business_type', '')), '') is null then
      v_bt := null;
    else
      select bt.id into v_bt from public.customer_business_types bt
       where bt.organization_id = v_c.organization_id and bt.company_id = v_c.company_id
         and lower(bt.code) = lower(btrim(p_item ->> 'business_type'));
      if v_bt is null then
        raise exception 'GIRO_NO_ENCONTRADO: business_type' using errcode = '22023';
      end if;
    end if;
    update public.customers set business_type_id = v_bt where id = p_customer_id;
  end if;
  if p_item ? 'geo' then
    if jsonb_typeof(p_item -> 'geo') = 'null' then
      update public.customers set geo_lat = null, geo_lng = null where id = p_customer_id;
    elsif jsonb_typeof(p_item -> 'geo') <> 'object' then
      raise exception 'VALOR_INVALIDO: geo' using errcode = '22023';
    else
      update public.customers
         set geo_lat = (p_item #>> '{geo,lat}')::numeric, geo_lng = (p_item #>> '{geo,lng}')::numeric
       where id = p_customer_id;
    end if;
  end if;

  -- Direcciones: se identifican por `external_ref` (el id del ERP) o, sin él,
  -- por la etiqueta. Las que no vienen se quedan: el lote no borra.
  if p_item ? 'addresses' then
    if jsonb_typeof(p_item -> 'addresses') <> 'array' or jsonb_array_length(p_item -> 'addresses') > 50 then
      raise exception 'VALOR_INVALIDO: addresses' using errcode = '22023';
    end if;
    for v_x in select x from jsonb_array_elements(p_item -> 'addresses') x loop
      if jsonb_typeof(v_x) <> 'object' or exists (
        select 1 from jsonb_object_keys(v_x) k
        where k not in ('external_ref', 'label', 'recipient', 'phone', 'line1', 'line2', 'city', 'region',
                        'postal_code', 'country', 'is_shipping', 'is_billing', 'is_default_shipping',
                        'is_default_billing', 'is_active')) then
        raise exception 'CAMPO_NO_PERMITIDO: addresses' using errcode = '22023';
      end if;
      v_ref := nullif(btrim(coalesce(v_x ->> 'external_ref', '')), '');
      v_id := null;
      select a.id into v_id from public.customer_addresses a
       where a.customer_id = p_customer_id
         and (case when v_ref is not null then a.external_ref = v_ref
                   else lower(a.label) = lower(btrim(coalesce(v_x ->> 'label', ''))) end)
       limit 1;

      -- Un solo «por defecto» de cada uso: el que llega desplaza al anterior.
      if coalesce((v_x ->> 'is_default_shipping')::boolean, false) then
        update public.customer_addresses set is_default_shipping = false
         where customer_id = p_customer_id and is_default_shipping and id is distinct from v_id;
      end if;
      if coalesce((v_x ->> 'is_default_billing')::boolean, false) then
        update public.customer_addresses set is_default_billing = false
         where customer_id = p_customer_id and is_default_billing and id is distinct from v_id;
      end if;

      if v_id is null then
        insert into public.customer_addresses
          (organization_id, company_id, customer_id, external_ref, label, recipient, phone, line1, line2,
           city, region, postal_code, country, is_shipping, is_billing, is_default_shipping,
           is_default_billing, is_active)
        values
          (v_c.organization_id, v_c.company_id, p_customer_id, v_ref,
           btrim(coalesce(v_x ->> 'label', v_x ->> 'line1', '')),
           v_x ->> 'recipient', v_x ->> 'phone', v_x ->> 'line1', v_x ->> 'line2',
           v_x ->> 'city', v_x ->> 'region', v_x ->> 'postal_code',
           upper(btrim(coalesce(v_x ->> 'country', 'PE'))),
           coalesce((v_x ->> 'is_shipping')::boolean, true),
           coalesce((v_x ->> 'is_billing')::boolean, false),
           coalesce((v_x ->> 'is_default_shipping')::boolean, false),
           coalesce((v_x ->> 'is_default_billing')::boolean, false),
           coalesce((v_x ->> 'is_active')::boolean, true));
      else
        update public.customer_addresses a set
          label               = coalesce(nullif(btrim(v_x ->> 'label'), ''), a.label),
          recipient           = case when v_x ? 'recipient' then v_x ->> 'recipient' else a.recipient end,
          phone               = case when v_x ? 'phone' then v_x ->> 'phone' else a.phone end,
          line1               = coalesce(v_x ->> 'line1', a.line1),
          line2               = case when v_x ? 'line2' then v_x ->> 'line2' else a.line2 end,
          city                = case when v_x ? 'city' then v_x ->> 'city' else a.city end,
          region              = case when v_x ? 'region' then v_x ->> 'region' else a.region end,
          postal_code         = case when v_x ? 'postal_code' then v_x ->> 'postal_code' else a.postal_code end,
          country             = coalesce(upper(btrim(v_x ->> 'country')), a.country),
          is_shipping         = coalesce((v_x ->> 'is_shipping')::boolean, a.is_shipping),
          is_billing          = coalesce((v_x ->> 'is_billing')::boolean, a.is_billing),
          is_default_shipping = coalesce((v_x ->> 'is_default_shipping')::boolean, a.is_default_shipping),
          is_default_billing  = coalesce((v_x ->> 'is_default_billing')::boolean, a.is_default_billing),
          is_active           = coalesce((v_x ->> 'is_active')::boolean, a.is_active)
        where a.id = v_id;
      end if;
    end loop;
  end if;

  -- Contactos: por correo o, sin él, por nombre.
  if p_item ? 'contacts' then
    if jsonb_typeof(p_item -> 'contacts') <> 'array' or jsonb_array_length(p_item -> 'contacts') > 50 then
      raise exception 'VALOR_INVALIDO: contacts' using errcode = '22023';
    end if;
    for v_x in select x from jsonb_array_elements(p_item -> 'contacts') x loop
      if jsonb_typeof(v_x) <> 'object' or exists (
        select 1 from jsonb_object_keys(v_x) k
        where k not in ('name', 'email', 'phone', 'role_title', 'is_primary', 'is_active')) then
        raise exception 'CAMPO_NO_PERMITIDO: contacts' using errcode = '22023';
      end if;
      v_id := null;
      select ct.id into v_id from public.customer_contacts ct
       where ct.customer_id = p_customer_id
         and (case when nullif(btrim(coalesce(v_x ->> 'email', '')), '') is not null
                   then lower(ct.email) = lower(btrim(v_x ->> 'email'))
                   else lower(ct.name) = lower(btrim(coalesce(v_x ->> 'name', ''))) end)
       limit 1;
      if coalesce((v_x ->> 'is_primary')::boolean, false) then
        update public.customer_contacts set is_primary = false
         where customer_id = p_customer_id and is_primary and id is distinct from v_id;
      end if;
      if v_id is null then
        insert into public.customer_contacts
          (organization_id, company_id, customer_id, name, email, phone, role_title, is_primary, is_active)
        values
          (v_c.organization_id, v_c.company_id, p_customer_id, btrim(coalesce(v_x ->> 'name', '')),
           nullif(btrim(coalesce(v_x ->> 'email', '')), ''), nullif(btrim(coalesce(v_x ->> 'phone', '')), ''),
           v_x ->> 'role_title', coalesce((v_x ->> 'is_primary')::boolean, false),
           coalesce((v_x ->> 'is_active')::boolean, true));
      else
        update public.customer_contacts ct set
          name       = coalesce(nullif(btrim(v_x ->> 'name'), ''), ct.name),
          phone      = case when v_x ? 'phone' then nullif(btrim(v_x ->> 'phone'), '') else ct.phone end,
          role_title = case when v_x ? 'role_title' then v_x ->> 'role_title' else ct.role_title end,
          is_primary = coalesce((v_x ->> 'is_primary')::boolean, ct.is_primary),
          is_active  = coalesce((v_x ->> 'is_active')::boolean, ct.is_active)
        where ct.id = v_id;
      end if;
    end loop;
  end if;

  -- Cuenta de empresa (una por cliente): condiciones de compra y de crédito.
  -- El ESTADO de crédito no se escribe: lo calcula la cobranza.
  if p_item ? 'business_account' then
    v_ba := p_item -> 'business_account';
    if jsonb_typeof(v_ba) <> 'object' or exists (
      select 1 from jsonb_object_keys(v_ba) k
      where k not in ('code', 'name', 'is_active', 'requires_approval', 'approval_threshold',
                      'purchase_order_required', 'credit_limit', 'payment_terms_days',
                      'credit_watch_after_days', 'credit_block_after_days', 'notes')) then
      raise exception 'CAMPO_NO_PERMITIDO: business_account' using errcode = '22023';
    end if;
    if v_c.kind <> 'company' then
      raise exception 'CUENTA_SOLO_EMPRESA: business_account' using errcode = '22023';
    end if;
    select a.id into v_id from public.business_accounts a where a.customer_id = p_customer_id;
    if v_id is null then
      insert into public.business_accounts
        (organization_id, company_id, customer_id, customer_kind, code, name, is_active, requires_approval,
         approval_threshold, purchase_order_required, credit_limit, payment_terms_days,
         credit_watch_after_days, credit_block_after_days, notes)
      values
        (v_c.organization_id, v_c.company_id, p_customer_id, 'company',
         coalesce(nullif(btrim(v_ba ->> 'code'), ''), v_c.code),
         coalesce(nullif(btrim(v_ba ->> 'name'), ''), v_c.name),
         coalesce((v_ba ->> 'is_active')::boolean, true),
         coalesce((v_ba ->> 'requires_approval')::boolean, false),
         (v_ba ->> 'approval_threshold')::numeric,
         coalesce((v_ba ->> 'purchase_order_required')::boolean, false),
         (v_ba ->> 'credit_limit')::numeric,
         coalesce((v_ba ->> 'payment_terms_days')::integer, 0),
         (v_ba ->> 'credit_watch_after_days')::integer,
         (v_ba ->> 'credit_block_after_days')::integer,
         v_ba ->> 'notes');
    else
      update public.business_accounts a set
        name                    = coalesce(nullif(btrim(v_ba ->> 'name'), ''), a.name),
        is_active               = coalesce((v_ba ->> 'is_active')::boolean, a.is_active),
        requires_approval       = coalesce((v_ba ->> 'requires_approval')::boolean, a.requires_approval),
        approval_threshold      = case when v_ba ? 'approval_threshold'
                                       then (v_ba ->> 'approval_threshold')::numeric else a.approval_threshold end,
        purchase_order_required = coalesce((v_ba ->> 'purchase_order_required')::boolean, a.purchase_order_required),
        credit_limit            = case when v_ba ? 'credit_limit'
                                       then (v_ba ->> 'credit_limit')::numeric else a.credit_limit end,
        payment_terms_days      = coalesce((v_ba ->> 'payment_terms_days')::integer, a.payment_terms_days),
        credit_watch_after_days = case when v_ba ? 'credit_watch_after_days'
                                       then (v_ba ->> 'credit_watch_after_days')::integer else a.credit_watch_after_days end,
        credit_block_after_days = case when v_ba ? 'credit_block_after_days'
                                       then (v_ba ->> 'credit_block_after_days')::integer else a.credit_block_after_days end,
        notes                   = case when v_ba ? 'notes' then v_ba ->> 'notes' else a.notes end
      where a.id = v_id;
    end if;
  end if;
end;
$$;

revoke execute on function ebim.api_customer_apply_extras(uuid, jsonb) from public, anon, authenticated;

create or replace function public.api_customers_upsert(
  p_api_client_id uuid,
  p_dry_run       boolean default false,
  p_payload       jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client  public.api_clients%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_system  text;
  v_rows    jsonb;
  v_bad     text;
  v_result  jsonb;
  v_report  jsonb;
  v_item    jsonb;
  v_ord     integer;
  v_code    text;
  v_cid     uuid;
  v_errors  integer := 0;
  v_state   text;
  v_msg     text;
  v_extras  constant text[] := array['tax_id_type', 'tier', 'business_type', 'visit_frequency', 'geo',
                                      'addresses', 'contacts', 'business_account'];
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
  select string_agg(distinct k, ', ' order by k) into v_bad
    from jsonb_array_elements(v_payload -> 'customers') c(item),
         lateral jsonb_object_keys(case jsonb_typeof(c.item) when 'object' then c.item else '{}'::jsonb end) k
   where k not in ('code', 'kind', 'name', 'legal_name', 'tax_id', 'email', 'phone', 'segment',
                   'is_active', 'notes', 'external_id')
     and k <> all (v_extras);
  if v_bad is not null then
    raise exception 'CAMPO_NO_PERMITIDO: campos que no son del contrato: %', v_bad using errcode = '22023';
  end if;
  v_system := nullif(lower(btrim(coalesce(v_payload ->> 'system', ''))), '');

  -- Al núcleo va solo lo que conoce; el resto se aplica después, fila a fila.
  select coalesce(jsonb_agg(
           ((c.item - 'external_id') - v_extras)
           || jsonb_build_object('row', c.ord)
           || case when c.item ? 'external_id'
                   then jsonb_build_object('erp_code', c.item -> 'external_id', 'erp_system', coalesce(v_system, 'erp'))
                   else '{}'::jsonb end
           order by c.ord), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(v_payload -> 'customers') with ordinality as c(item, ord);

  -- Todo o nada: núcleo + extras en un mismo bloque que se deshace si hay
  -- cualquier error o si es simulación.
  begin
    v_result := ebim.import_customers_core(v_client.organization_id, v_client.company_id, true, v_rows, false);
    v_report := v_result -> 'rows';

    if (v_result ->> 'errors')::integer = 0 then
      for v_item, v_ord in
        select c.item, c.ord::integer
        from jsonb_array_elements(v_payload -> 'customers') with ordinality as c(item, ord)
        where c.item ?| v_extras
      loop
        v_code := btrim(coalesce(v_item ->> 'code', ''));
        select c.id into v_cid from public.customers c
         where c.organization_id = v_client.organization_id and c.company_id = v_client.company_id
           and lower(c.code) = lower(v_code);
        begin
          perform ebim.api_customer_apply_extras(v_cid, v_item);
        exception when others then
          get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
          v_errors := v_errors + 1;
          select coalesce(jsonb_agg(case when (r ->> 'row')::integer = v_ord
                   then ebim.import_row_error('customers', v_ord, v_code, v_state, v_msg, null, null)
                   else r end), '[]'::jsonb)
            into v_report from jsonb_array_elements(v_report) r;
        end;
      end loop;
    end if;

    if p_dry_run or v_errors > 0 or (v_result ->> 'errors')::integer > 0 then
      raise exception 'EBIM_IMPORT_ROLLBACK' using errcode = 'EB001';
    end if;
  exception when sqlstate 'EB001' then
    null;
  end;

  return jsonb_build_object(
    'dry_run', coalesce(p_dry_run, false),
    'applied', not coalesce(p_dry_run, false) and v_errors = 0 and (v_result ->> 'errors')::integer = 0,
    'total',   (v_result ->> 'total')::integer,
    'created', (v_result ->> 'created')::integer,
    'updated', (v_result ->> 'updated')::integer,
    'errors',  (v_result ->> 'errors')::integer + v_errors,
    'rows',    v_report);
end;
$$;

-- ---------------------------------------------------------------------------
-- Estado del pedido + guía de despacho
-- ---------------------------------------------------------------------------
-- La función de estado ya existe; aquí se añade `shipment` sin tocar el resto:
-- se envuelve. Primero la guía (si la hay), después los ejes de estado.
-- Idempotente: reaplicar la migración no vuelve a mover la función.
do $do$
begin
  if to_regprocedure('ebim.api_order_update_core(uuid, text, text, jsonb)') is null then
    alter function public.api_order_update(uuid, text, text, jsonb) rename to api_order_update_core;
    alter function public.api_order_update_core(uuid, text, text, jsonb) set schema ebim;
  end if;
end
$do$;
revoke execute on function ebim.api_order_update_core(uuid, text, text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.api_order_update(
  p_api_client_id uuid,
  p_number        text,
  p_store         text  default null,
  p_payload       jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client  public.api_clients%rowtype;
  v_store   public.stores%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_ship    jsonb;
  v_order   public.orders%rowtype;
  v_ful     public.fulfillments%rowtype;
  v_track   text;
  v_carrier text;
  v_prov    text;
  v_result  jsonb;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'order.update');

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'CAMBIOS_REQUERIDOS: el cuerpo es un objeto' using errcode = '22023';
  end if;
  v_ship := v_payload -> 'shipment';

  if v_ship is not null then
    if jsonb_typeof(v_ship) <> 'object' or exists (
      select 1 from jsonb_object_keys(v_ship) k
      where k not in ('fulfillment', 'carrier', 'service', 'tracking_number', 'tracking_url',
                      'estimated_delivery', 'cost', 'weight')) then
      raise exception 'CAMPO_NO_PERMITIDO: shipment es { tracking_number, carrier?, service?, tracking_url?, estimated_delivery?, cost?, weight?, fulfillment? }'
        using errcode = '22023';
    end if;
    v_track := nullif(btrim(coalesce(v_ship ->> 'tracking_number', '')), '');
    if v_track is null then
      raise exception 'GUIA_REQUERIDA: shipment.tracking_number' using errcode = '22023';
    end if;

    v_store := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);
    select * into v_order from public.orders o
     where o.organization_id = v_client.organization_id and o.company_id = v_client.company_id
       and o.store_id = v_store.id and o.order_number = btrim(coalesce(p_number, ''));
    if not found then
      raise exception 'PEDIDO_NO_ENCONTRADO: no hay ningun pedido con ese numero' using errcode = '22023';
    end if;

    select * into v_ful from public.fulfillments f
     where f.order_id = v_order.id
       and f.state::text <> 'cancelled'
       and (v_ship ->> 'fulfillment' is null or f.sequence = (v_ship ->> 'fulfillment')::integer)
     order by f.sequence
     limit 1;
    if v_ful.id is null then
      raise exception 'ENTREGA_INEXISTENTE: el pedido no tiene una entrega a la que asignar la guia'
        using errcode = '22023';
    end if;

    v_carrier := nullif(lower(btrim(coalesce(v_ship ->> 'carrier', ''))), '');
    select ip.code into v_prov from public.integration_providers ip
     where ip.code = v_carrier and ip.kind::text = 'logistics';

    begin
      insert into public.shipments
        (organization_id, company_id, store_id, fulfillment_id, provider_code, service_code, state,
         tracking_number, tracking_url, currency, cost, weight, estimated_delivery, shipped_at, idempotency_key)
      values
        (v_order.organization_id, v_order.company_id, v_order.store_id, v_ful.id, v_prov,
         left(coalesce(nullif(btrim(coalesce(v_ship ->> 'service', '')), ''), case when v_prov is null then v_carrier end), 60),
         'in_transit', v_track, nullif(btrim(coalesce(v_ship ->> 'tracking_url', '')), ''),
         case when v_ship ? 'cost' then v_order.currency end,
         (v_ship ->> 'cost')::numeric, (v_ship ->> 'weight')::numeric,
         (v_ship ->> 'estimated_delivery')::date, now(),
         'api:' || left(v_track, 190))
      on conflict (fulfillment_id, idempotency_key) do update
        set tracking_url       = coalesce(excluded.tracking_url, public.shipments.tracking_url),
            estimated_delivery = coalesce(excluded.estimated_delivery, public.shipments.estimated_delivery),
            cost               = coalesce(excluded.cost, public.shipments.cost),
            currency           = coalesce(excluded.currency, public.shipments.currency),
            weight             = coalesce(excluded.weight, public.shipments.weight);
    exception when check_violation or invalid_text_representation or datetime_field_overflow
                   or invalid_datetime_format then
      raise exception 'GUIA_INVALIDA: revisa tracking_number, tracking_url, cost, weight o estimated_delivery'
        using errcode = '22023';
    end;
  end if;

  -- Sin guía, o con más cosas que la guía, decide la función original: sus
  -- validaciones (campos desconocidos, cuerpo vacío…) siguen siendo las mismas.
  if v_ship is null or (v_payload - 'shipment') <> '{}'::jsonb then
    v_result := ebim.api_order_update_core(p_api_client_id, p_number, p_store, v_payload - 'shipment');
  else
    v_result := jsonb_build_object('changes', jsonb_build_object(
      'changed', '[]'::jsonb, 'unchanged', '[]'::jsonb, 'external_refs', 0));
  end if;

  v_store := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);
  return ebim.api_order_json(
           (select o.id from public.orders o
             where o.organization_id = v_client.organization_id and o.company_id = v_client.company_id
               and o.store_id = v_store.id and o.order_number = btrim(coalesce(p_number, ''))),
           true)
         || jsonb_build_object('changes', (v_result -> 'changes')
                               || jsonb_build_object('shipment', v_ship is not null));
end;
$$;

revoke execute on function public.api_order_update(uuid, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public.api_order_update(uuid, text, text, jsonb) to service_role;
revoke execute on function public.api_order_create(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.api_order_create(uuid, jsonb) to service_role;
revoke execute on function public.api_customers_upsert(uuid, boolean, jsonb) from public, anon, authenticated;
grant  execute on function public.api_customers_upsert(uuid, boolean, jsonb) to service_role;
