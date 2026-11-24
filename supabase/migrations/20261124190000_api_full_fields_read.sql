-- =============================================================================
-- API de integración v1 · Campos COMPLETOS de lectura (2026-11-24)
--
-- El operador lo pidió así: «necesito que la integración tenga todos los
-- campos completos, tanto lo que envía como lo que recibe». Hasta hoy la API
-- devolvía lo mínimo (un producto eran 8 campos; un pedido, sin direcciones,
-- sin RUC, sin OC, sin pagos ni envíos ni el detalle fiscal de la línea), y un
-- ERP no puede facturar ni despachar con eso.
--
-- Todo es ADITIVO: ninguna clave existente cambia de nombre ni de tipo, así que
-- quien ya integra sigue funcionando (contrato v1, regla de versionado §10).
--
--  · `ebim.api_order_json`     pedido completo (cabecera, cliente, cuenta de
--                              empresa, direcciones, aprobación, líneas con
--                              variante/unidad/impuesto/descuento, pagos,
--                              devoluciones de dinero, entregas con guías y
--                              referencias externas). Listado y detalle lo usan.
--  · `ebim.api_product_json`   producto completo publicado en una tienda.
--  · `ebim.api_customer_json`  cliente completo (direcciones, contactos, cuenta
--                              de empresa con crédito, ids externos).
--  · `api_stock_read`          + desglose por almacén.
--  · `api_product_get` / `api_customer_get`  lectura de uno.
--  · `ebim.webhook_fanout`     todo evento con `order_id` viaja con el pedido
--                              completo en `data.order`: el ERP ya no tiene que
--                              volver a pedirlo para tener las líneas.
-- =============================================================================

-- Fechas en UTC ISO-8601, la misma forma que ya usa toda la API.
create or replace function ebim.api_ts(p_value timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then null
              else to_char(p_value at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end;
$$;

revoke execute on function ebim.api_ts(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pedido completo
-- ---------------------------------------------------------------------------
create or replace function ebim.api_order_json(p_order_id uuid, p_with_items boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select
    jsonb_build_object(
      'number',                o.order_number,
      'status',                o.status::text,
      'payment_status',        o.payment_status::text,
      'fulfillment_status',    o.fulfillment_status::text,
      'approval_status',       o.approval_status::text,
      'source',                o.source_channel::text,
      'currency',              o.currency,
      'tax_inclusive',         o.tax_inclusive,
      'subtotal',              ebim.api_money(o.subtotal),
      'tax_total',             ebim.api_money(o.tax_total),
      'shipping_total',        ebim.api_money(o.shipping_total),
      'discount_total',        ebim.api_money(o.discount_total),
      'total',                 ebim.api_money(o.grand_total),
      'purchase_order_number', o.purchase_order_number,
      'notes',                 o.notes,
      'correlation_id',        o.correlation_id,
      'placed_at',             ebim.api_ts(o.placed_at),
      'paid_at',               ebim.api_ts(o.paid_at),
      'fulfilled_at',          ebim.api_ts(o.fulfilled_at),
      'cancelled_at',          ebim.api_ts(o.cancelled_at),
      'created_at',            ebim.api_ts(o.created_at),
      'updated_at',            ebim.api_ts(o.updated_at),
      'store',                 s.slug)
    || jsonb_build_object(
      'customer', jsonb_build_object(
        'email',        o.customer_email,
        'name',         o.customer_name,
        'phone',        o.customer_phone,
        'code',         coalesce(c.code, o.customer_snapshot ->> 'customer_code'),
        'kind',         c.kind::text,
        'legal_name',   coalesce(c.legal_name, o.customer_snapshot ->> 'legal_name'),
        'tax_id',       coalesce(c.tax_id, o.customer_snapshot ->> 'tax_id'),
        'tax_id_type',  c.tax_id_type,
        'external_ids', coalesce((
          select jsonb_object_agg(x.system_code, x.external_id)
          from public.customer_external_ids x where x.customer_id = c.id), '{}'::jsonb)),
      'business_account', case when ba.id is null then null else jsonb_build_object(
        'code',               ba.code,
        'name',               ba.name,
        'payment_terms_days', ba.payment_terms_days,
        'credit_status',      ba.credit_status::text) end,
      'shipping_address', coalesce(o.shipping_address_snapshot, o.shipping_address),
      'billing_address',  o.billing_address,
      'approval', jsonb_build_object(
        'status',     o.approval_status::text,
        'decided_at', ebim.api_ts(o.approval_decided_at),
        'decided_by', o.approval_decided_email,
        'reason',     o.approval_reason))
    || jsonb_build_object(
      'items', case when p_with_items then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku',                   coalesce(v.sku, i.sku),
                 'product_sku',           p.sku,
                 'variant_sku',           v.sku,
                 'name',                  i.name,
                 'variant_label',         i.variant_label,
                 'variant_attributes',    i.variant_attributes,
                 'quantity',              i.quantity,
                 'uom_code',              i.uom_code,
                 'uom_factor',            i.uom_factor,
                 'base_quantity',         i.base_quantity,
                 'unit_price',            ebim.api_money(i.unit_price),
                 'discount_amount',       ebim.api_money(i.discount_amount),
                 'amount_after_discount', ebim.api_money(i.amount_after_discount),
                 'tax_category',          i.tax_category_code,
                 'tax_rate',              i.tax_rate,
                 'tax_amount',            ebim.api_money(i.tax_amount),
                 'tax_inclusive',         i.tax_inclusive,
                 'line_total',            ebim.api_money(i.line_total),
                 'price_list',            i.price_list_code,
                 'price_source',          i.price_source,
                 'discounts',             i.discount_snapshot,
                 'components',            i.components_snapshot)
               order by i.created_at, i.sku)
        from public.order_items i
        left join public.products p on p.id = i.product_id
        left join public.product_variants v on v.id = i.variant_id
        where i.order_id = o.id), '[]'::jsonb) else null end,
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'amount',               ebim.api_money(pa.amount),
                 'amount_refunded',      ebim.api_money(pa.amount_refunded),
                 'currency',             pa.currency,
                 'status',               pa.status::text,
                 'provider',             pa.provider_code,
                 'reference',            pa.provider_reference,
                 'captured_at',          ebim.api_ts(pa.captured_at),
                 'settlement_reference', pa.settlement_reference,
                 'settled_at',           ebim.api_ts(pa.settled_at))
               order by pa.created_at)
        from public.payments pa where pa.order_id = o.id), '[]'::jsonb),
      'refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'amount',       ebim.api_money(r.amount),
                 'currency',     r.currency,
                 'status',       r.status::text,
                 'reason',       r.reason,
                 'provider',     r.provider_code,
                 'reference',    r.provider_reference,
                 'completed_at', ebim.api_ts(r.completed_at))
               order by r.created_at)
        from public.refunds r where r.order_id = o.id), '[]'::jsonb),
      'fulfillments', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sequence',       f.sequence,
                 'state',          f.state::text,
                 'method_code',    f.method_code,
                 'method_name',    f.method_name,
                 'strategy',       f.strategy::text,
                 'provider',       f.provider_code,
                 'warehouse',      w.code,
                 'window_date',    f.window_date,
                 'window_starts',  f.window_starts_at,
                 'window_ends',    f.window_ends_at,
                 'promised_from',  f.promised_from,
                 'promised_to',    f.promised_to,
                 'shipping_cost',  ebim.api_money(f.shipping_cost),
                 'weight',         f.weight,
                 'address',        f.address,
                 'contact_name',   f.contact_name,
                 'contact_phone',  f.contact_phone,
                 'shipped_at',     ebim.api_ts(f.shipped_at),
                 'delivered_at',   ebim.api_ts(f.delivered_at),
                 'cancelled_at',   ebim.api_ts(f.cancelled_at),
                 'cancel_reason',  f.cancel_reason,
                 'items', coalesce((
                   select jsonb_agg(jsonb_build_object('sku', oi.sku, 'quantity', fi.quantity) order by oi.sku)
                   from public.fulfillment_items fi
                   join public.order_items oi on oi.id = fi.order_item_id
                   where fi.fulfillment_id = f.id), '[]'::jsonb),
                 'shipments', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'state',              sh.state::text,
                            'provider',           sh.provider_code,
                            'service',            sh.service_code,
                            'tracking_number',    sh.tracking_number,
                            'tracking_url',       sh.tracking_url,
                            'cost',               ebim.api_money(sh.cost),
                            'weight',             sh.weight,
                            'estimated_delivery', sh.estimated_delivery,
                            'shipped_at',         ebim.api_ts(sh.shipped_at),
                            'delivered_at',       ebim.api_ts(sh.delivered_at))
                          order by sh.created_at)
                   from public.shipments sh where sh.fulfillment_id = f.id), '[]'::jsonb))
               order by f.sequence)
        from public.fulfillments f
        left join public.warehouses w on w.id = f.warehouse_id
        where f.order_id = o.id), '[]'::jsonb),
      'external_refs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'system', x.system_code,
                 'type',   x.ref_type,
                 'id',     x.external_id,
                 'url',    x.external_url,
                 'notes',  x.notes)
               order by x.created_at)
        from public.order_external_refs x where x.order_id = o.id), '[]'::jsonb))
  from public.orders o
  join public.stores s on s.id = o.store_id
  left join public.business_accounts ba on ba.id = o.business_account_id
  left join public.customers c
    on c.id = coalesce(ba.customer_id, ebim.safe_uuid(o.customer_snapshot ->> 'customer_id'))
   and c.organization_id = o.organization_id
   and c.company_id      = o.company_id
  where o.id = p_order_id;
$$;

revoke execute on function ebim.api_order_json(uuid, boolean) from public, anon, authenticated;

-- El listado devuelve el pedido COMPLETO, con líneas: es lo que un ERP
-- sincroniza, y pedir cada pedido después era una llamada por fila.
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
as $$
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
  select coalesce(jsonb_agg(ebim.api_order_json(p.id, true) order by p.placed_at desc), '[]'::jsonb),
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
$$;

-- ---------------------------------------------------------------------------
-- Producto completo (lo publicado en UNA tienda)
-- ---------------------------------------------------------------------------
create or replace function ebim.api_attribute_value(
  p_value_id uuid, p_text text, p_number numeric, p_boolean boolean, p_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select to_jsonb(av.code) from public.attribute_values av where av.id = p_value_id),
    to_jsonb(p_text), to_jsonb(p_number), to_jsonb(p_boolean), to_jsonb(p_date));
$$;

revoke execute on function ebim.api_attribute_value(uuid, text, numeric, boolean, date)
  from public, anon, authenticated;

create or replace function ebim.api_product_json(p_product_id uuid, p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select
    jsonb_build_object(
      'sku',              p.sku,
      'name',             p.name,
      'slug',             coalesce(sp.slug, p.slug),
      'kind',             p.kind::text,
      'status',           sp.status::text,
      'currency',         sp.currency,
      'price',            ebim.api_money(sp.price),
      'compare_at_price', ebim.api_money(sp.compare_at_price),
      'published_at',     ebim.api_ts(sp.published_at),
      'description',      p.description,
      'highlights',       to_jsonb(coalesce(p.highlights, '{}'::text[])),
      'gtin',             p.gtin,
      'shipping_weight',  p.shipping_weight,
      'custom_fields',    coalesce(p.custom_fields, '{}'::jsonb),
      'created_at',       ebim.api_ts(p.created_at),
      'updated_at',       ebim.api_ts(greatest(p.updated_at, sp.updated_at)))
    || jsonb_build_object(
      'brand',        case when b.id is null then null else jsonb_build_object('code', b.code, 'name', b.name) end,
      'family',       case when fa.id is null then null else jsonb_build_object('code', fa.code, 'name', fa.name) end,
      'category',     case when cat.id is null then null else jsonb_build_object('slug', cat.slug, 'name', cat.name) end,
      'tax_category', tc.code,
      'attributes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'code',  a.code,
                 'name',  a.name,
                 'unit',  a.unit,
                 'value', ebim.api_attribute_value(pav.value_id, pav.value_text, pav.value_number,
                                                   pav.value_boolean, pav.value_date))
               order by a.position, a.code)
        from public.product_attribute_values pav
        join public.attributes a on a.id = pav.attribute_id
        where pav.product_id = p.id), '[]'::jsonb),
      'variants', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku',              v.sku,
                 'name',             v.name,
                 'barcode',          v.barcode,
                 'price',            ebim.api_money(coalesce(spo.price, v.price)),
                 'compare_at_price', ebim.api_money(coalesce(spo.compare_at_price, v.compare_at_price)),
                 'shipping_weight',  v.shipping_weight,
                 'position',         v.position,
                 'is_default',       v.is_default,
                 'is_active',        v.is_active,
                 'custom_fields',    coalesce(v.custom_fields, '{}'::jsonb),
                 'attributes', coalesce((
                   select jsonb_agg(jsonb_build_object('code', a.code, 'value', av.code, 'label', av.label)
                                    order by a.position, a.code)
                   from public.variant_attribute_values vav
                   join public.attributes a on a.id = vav.attribute_id
                   left join public.attribute_values av on av.id = vav.value_id
                   where vav.variant_id = v.id), '[]'::jsonb))
               order by v.position, v.sku)
        from public.product_variants v
        left join public.store_price_overrides spo
          on spo.store_id = p_store_id and spo.product_id = p.id
         and spo.variant_id = v.id and spo.uom_id is null
        where v.product_id = p.id), '[]'::jsonb),
      'units', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'code',        u.code,
                 'name',        u.name,
                 'factor',      pu.factor,
                 'is_base',     pu.is_base,
                 'is_sellable', pu.is_sellable,
                 'price',       ebim.api_money(pu.price),
                 'barcode',     pu.barcode)
               order by pu.position, u.code)
        from public.product_uoms pu
        join public.units_of_measure u on u.id = pu.uom_id
        where pu.product_id = p.id), '[]'::jsonb),
      -- Ruta dentro del bucket privado de imágenes; la URL firmada la pone el gateway.
      'images', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'path',        im.storage_path,
                 'alt',         im.alt,
                 'position',    im.position,
                 'is_primary',  im.is_primary,
                 'variant_sku', iv.sku)
               order by im.is_primary desc, im.position)
        from public.product_images im
        left join public.product_variants iv on iv.id = im.variant_id
        where im.product_id = p.id), '[]'::jsonb))
  from public.store_products sp
  join public.products p on p.id = sp.product_id
  left join public.brands b on b.id = p.brand_id
  left join public.product_families fa on fa.id = p.family_id
  left join public.categories cat on cat.id = coalesce(sp.category_id, p.category_id)
  left join public.tax_categories tc on tc.id = p.tax_category_id
  where sp.product_id = p_product_id
    and sp.store_id   = p_store_id;
$$;

revoke execute on function ebim.api_product_json(uuid, uuid) from public, anon, authenticated;

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
as $$
declare
  v_client public.api_clients%rowtype;
  v_store  public.stores%rowtype;
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_rows   jsonb;
  v_next   text;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'product.read');
  v_store  := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);

  with pagina as (
    select p.id, p.sku
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
  select coalesce(jsonb_agg(ebim.api_product_json(g.id, v_store.id) order by g.sku), '[]'::jsonb),
         max(g.sku)
    into v_rows, v_next
  from pagina g;

  return jsonb_build_object(
    'data', v_rows,
    'next_cursor', case when jsonb_array_length(v_rows) = v_limit then v_next else null end,
    'server_time', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USZ'));
end;
$$;

-- Uno por SKU (del producto o de una de sus variantes).
create or replace function public.api_product_get(
  p_api_client_id uuid,
  p_sku           text,
  p_store         text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client public.api_clients%rowtype;
  v_store  public.stores%rowtype;
  v_sku    text := nullif(btrim(coalesce(p_sku, '')), '');
  v_pid    uuid;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'product.read');
  v_store  := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);

  select p.id into v_pid
  from public.products p
  join public.store_products sp on sp.product_id = p.id and sp.store_id = v_store.id
  where p.organization_id = v_client.organization_id
    and p.company_id      = v_client.company_id
    and (p.sku = v_sku or exists (
          select 1 from public.product_variants pv where pv.product_id = p.id and pv.sku = v_sku))
  limit 1;

  if v_pid is null then
    raise exception 'PRODUCTO_NO_DISPONIBLE: no hay ningun articulo con el sku %', coalesce(v_sku, '')
      using errcode = '22023';
  end if;

  return ebim.api_product_json(v_pid, v_store.id);
end;
$$;

revoke execute on function public.api_product_get(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.api_product_get(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Stock con desglose por almacén
-- ---------------------------------------------------------------------------
create or replace function public.api_stock_read(p_api_client_id uuid, p_sku text, p_store text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client public.api_clients%rowtype;
  v_store  public.stores%rowtype;
  v_sku    text := nullif(btrim(coalesce(p_sku, '')), '');
  v_pid    uuid;
  v_vid    uuid;
  v_atp    jsonb;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'stock.read');
  v_store  := ebim.api_store(v_client.organization_id, v_client.company_id, p_store);

  if v_sku is null then
    raise exception 'SKU_REQUERIDO: indica el sku del que quieres la existencia'
      using errcode = '22023';
  end if;

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

  v_atp := ebim.atp(v_store.id, v_pid, v_vid);

  return jsonb_build_object(
    'sku',       v_sku,
    'available', coalesce((v_atp ->> 'available')::numeric, 0)::integer,
    'in_stock',  coalesce((v_atp ->> 'available')::numeric, 0) > 0,
    'unknown',   coalesce((v_atp ->> 'unknown')::boolean, false),
    'backorder', coalesce((v_atp ->> 'backorder')::boolean, false),
    'source',    v_atp ->> 'source',
    'as_of',     ebim.api_ts(now()),
    'warehouses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code',            w.code,
               'name',            w.name,
               'source',          w.source::text,
               'on_hand',         l.on_hand_qty,
               'reserved',        l.reserved_qty,
               'available',       l.available_qty,
               'safety_stock',    l.safety_stock,
               'reorder_point',   l.reorder_point,
               'allow_backorder', l.allow_backorder,
               'synced_at',       ebim.api_ts(l.synced_at))
             order by w.priority, w.code)
      from public.inventory_levels l
      join public.warehouses w on w.id = l.warehouse_id
      where l.product_id = v_pid
        and l.variant_id is not distinct from v_vid
        and (l.store_id is null or l.store_id = v_store.id)
        and w.organization_id = v_client.organization_id
        and w.company_id      = v_client.company_id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Cliente completo
-- ---------------------------------------------------------------------------
create or replace function ebim.api_customer_json(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select
    jsonb_build_object(
      'id',              c.id,
      'kind',            c.kind::text,
      'code',            c.code,
      'name',            c.name,
      'legal_name',      c.legal_name,
      'tax_id',          c.tax_id,
      'tax_id_type',     c.tax_id_type,
      'email',           c.email,
      'phone',           c.phone,
      'segment',         sg.code,
      'business_type',   bt.code,
      'tier',            c.tier::text,
      'visit_frequency', c.visit_frequency::text,
      'geo',             case when c.geo_lat is null then null
                              else jsonb_build_object('lat', c.geo_lat, 'lng', c.geo_lng) end,
      'notes',           c.notes,
      'is_active',       c.is_active,
      'created_at',      ebim.api_ts(c.created_at),
      'updated_at',      ebim.api_ts(c.updated_at))
    || jsonb_build_object(
      'external_ids', coalesce((
        select jsonb_object_agg(x.system_code, x.external_id)
        from public.customer_external_ids x where x.customer_id = c.id), '{}'::jsonb),
      'addresses', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'external_ref',       a.external_ref,
                 'label',              a.label,
                 'recipient',          a.recipient,
                 'phone',              a.phone,
                 'line1',              a.line1,
                 'line2',              a.line2,
                 'city',               a.city,
                 'region',             a.region,
                 'postal_code',        a.postal_code,
                 'country',            a.country,
                 'is_shipping',        a.is_shipping,
                 'is_billing',         a.is_billing,
                 'is_default_shipping', a.is_default_shipping,
                 'is_default_billing', a.is_default_billing,
                 'verification',       a.verification::text,
                 'is_active',          a.is_active)
               order by a.is_default_shipping desc, a.created_at)
        from public.customer_addresses a where a.customer_id = c.id), '[]'::jsonb),
      'contacts', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name',       ct.name,
                 'email',      ct.email,
                 'phone',      ct.phone,
                 'role_title', ct.role_title,
                 'is_primary', ct.is_primary,
                 'is_active',  ct.is_active)
               order by ct.is_primary desc, ct.created_at)
        from public.customer_contacts ct where ct.customer_id = c.id), '[]'::jsonb),
      -- Una por cliente (índice único `business_accounts_one_per_customer`).
      'business_account', (
        select jsonb_build_object(
                 'code',                    ba.code,
                 'name',                    ba.name,
                 'is_active',               ba.is_active,
                 'requires_approval',       ba.requires_approval,
                 'approval_threshold',      ebim.api_money(ba.approval_threshold),
                 'purchase_order_required', ba.purchase_order_required,
                 'credit_limit',            ebim.api_money(ba.credit_limit),
                 'payment_terms_days',      ba.payment_terms_days,
                 'credit_status',           ba.credit_status::text,
                 'credit_watch_after_days', ba.credit_watch_after_days,
                 'credit_block_after_days', ba.credit_block_after_days,
                 'notes',                   ba.notes)
        from public.business_accounts ba where ba.customer_id = c.id))
  from public.customers c
  left join public.customer_segments sg on sg.id = c.segment_id
  left join public.customer_business_types bt on bt.id = c.business_type_id
  where c.id = p_customer_id;
$$;

revoke execute on function ebim.api_customer_json(uuid) from public, anon, authenticated;

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
as $$
declare
  v_client public.api_clients%rowtype;
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_rows   jsonb;
  v_next   timestamptz;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'customer.read');

  with pagina as (
    select c.id, c.created_at
    from public.customers c
    where c.organization_id = v_client.organization_id
      and c.company_id      = v_client.company_id
      and (p_cursor is null or c.created_at < p_cursor)
      and (p_updated_since is null or c.updated_at >= p_updated_since)
    order by c.created_at desc, c.id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(ebim.api_customer_json(g.id) order by g.created_at desc, g.id desc), '[]'::jsonb),
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
$$;

-- Uno por código interno o por id externo (`system:id` o solo el id del ERP).
create or replace function public.api_customer_get(p_api_client_id uuid, p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client public.api_clients%rowtype;
  v_code   text := nullif(btrim(coalesce(p_code, '')), '');
  v_id     uuid;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'customer.read');

  select c.id into v_id
  from public.customers c
  where c.organization_id = v_client.organization_id
    and c.company_id      = v_client.company_id
    and (c.code = v_code
         or exists (select 1 from public.customer_external_ids x
                    where x.customer_id = c.id and x.external_id = v_code))
  order by (c.code = v_code) desc
  limit 1;

  if v_id is null then
    raise exception 'CLIENTE_NO_ENCONTRADO: no hay ningun cliente con ese codigo'
      using errcode = '22023';
  end if;

  return ebim.api_customer_json(v_id);
end;
$$;

revoke execute on function public.api_customer_get(uuid, text) from public, anon, authenticated;
grant  execute on function public.api_customer_get(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Webhooks: el pedido completo viaja en el evento
-- ---------------------------------------------------------------------------
create or replace function ebim.webhook_fanout(
  p_organization_id uuid,
  p_company_id      uuid,
  p_event_id        uuid,
  p_event_type      text,
  p_payload         jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint  record;
  v_delivery  uuid;
  v_outbox    uuid;
  v_count     integer := 0;
  v_body      jsonb;
  v_order_id  uuid;
begin
  if not exists (
    select 1 from public.tenant_integrations ti
    where ti.organization_id = p_organization_id
      and ti.company_id      = p_company_id
      and ti.provider_code   = 'webhook'
      and ti.is_active
  ) then
    return 0;
  end if;

  v_body := coalesce(p_payload, '{}'::jsonb);

  -- 2026-11-24 · El pedido COMPLETO (mismo objeto que GET /v1/orders/{number})
  -- en `data.order`: el ERP factura y despacha con el evento, sin volver a
  -- llamar. Solo si es un pedido de ESTA sociedad.
  v_order_id := ebim.safe_uuid(v_body ->> 'order_id');
  if v_order_id is not null and exists (
    select 1 from public.orders o
    where o.id = v_order_id
      and o.organization_id = p_organization_id
      and o.company_id      = p_company_id
  ) then
    v_body := v_body || jsonb_build_object('order', ebim.api_order_json(v_order_id, true));
  end if;

  -- Redacción de datos de TARJETA (P09) antes de salir del sistema.
  v_body := ebim.redact_sensitive(v_body);

  for v_endpoint in
    select distinct e.id, e.max_attempts
    from public.webhook_endpoints e
    join public.webhook_subscriptions s
      on s.endpoint_id = e.id and s.is_active
    where e.organization_id = p_organization_id
      and e.company_id      = p_company_id
      and e.is_active
      and ebim.webhook_matches(s.event_type, p_event_type)
  loop
    begin
      insert into public.webhook_deliveries
        (organization_id, company_id, endpoint_id, event_id, event_type)
      values (p_organization_id, p_company_id, v_endpoint.id, p_event_id, p_event_type)
      on conflict do nothing
      returning id into v_delivery;

      if v_delivery is null then
        continue;
      end if;

      v_outbox := public.integration_enqueue(
        p_organization_id,
        p_company_id,
        'webhook',
        'event.publish',
        jsonb_build_object(
          'event_id',    p_event_id,
          'event_type',  p_event_type,
          'delivery_id', v_delivery,
          'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'data',        v_body),
        'wh:' || v_delivery::text,
        v_endpoint.id::text);

      update public.webhook_deliveries set outbox_id = v_outbox where id = v_delivery;
      update public.integration_outbox
         set max_attempts = v_endpoint.max_attempts
       where id = v_outbox;

      v_count := v_count + 1;
    exception when others then
      perform ebim.record_ops_event(
        p_organization_id, p_company_id,
        'integration_failed', 'WEBHOOK_NO_ENCOLADO',
        'wh-enqueue:' || v_endpoint.id::text || ':' || p_event_id::text,
        'error',
        'No se pudo encolar la entrega del evento ' || p_event_type,
        'db', 'event.publish', null, 'webhook_endpoint', v_endpoint.id);
    end;
  end loop;

  return v_count;
end;
$$;
