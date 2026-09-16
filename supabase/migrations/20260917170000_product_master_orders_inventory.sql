-- =============================================================================
-- Stores + Product Master · Fase 05 paso B — carrito, pedido, inventario y API
-- de socio sobre la publicación por tienda (ADR 018)
--
-- Cada función parte de su definición VIGENTE (pg_get_functiondef sobre el
-- esquema efectivo) y cambia solo lo que trataba a `products` como producto de
-- una tienda:
--
-- - «vendible en la tienda S» = publicación de S con status 'published' y
--   published_at <= now(); la moneda de la línea es la de la publicación;
-- - el producto de una operación de inventario se reconoce por la SOCIEDAD de
--   la tienda (maestro), no por su tienda de origen: devolver o descontar
--   existencias no depende de que la publicación siga viva;
-- - el SKU de la API de socio se busca en el maestro dentro de lo publicado en
--   la tienda pedida;
-- - `inventory_levels.store_id` queda como ancla informativa (se copia a los
--   movimientos, que la exigen): tienda de origen o, sin ella, la primera tienda
--   de la sociedad. Nada filtra por ella. Su FK pasa al maestro.
--
-- Mismos códigos de error que antes para un producto «de otra tienda».
-- `create or replace` conserva firmas y grants.
-- =============================================================================

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cart_replace_lines(p_store_slug text, p_token text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store    public.stores%rowtype;
  v_cart     public.carts%rowtype;
  v_scoped   boolean := false;
  v_item     jsonb;
  v_product  public.products%rowtype;
  v_variant  public.product_variants%rowtype;
  v_has_var  boolean;
  v_uom_code text;
  v_qty      integer;
  v_normalized jsonb;
begin
  v_store := ebim.active_store_by_slug(p_store_slug);
  v_cart  := ebim.cart_authorize(v_store.id, p_token);

  if v_cart.status <> 'active' then
    raise exception 'CARRITO_NO_VIGENTE: ese carrito ya se cerro'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'ITEMS_REQUERIDOS: hace falta una lista de lineas'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_lines) > 100 then
    raise exception 'ITEMS_EXCESIVOS: maximo 100 lineas por carrito'
      using errcode = '22023';
  end if;

  -- La misma lista negra de `create_order` y `ebim.build_quote`. Un carrito con
  -- precio dentro seria la primera pieza de un checkout que se cree el precio.
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as item,
         jsonb_object_keys(item) as k
    where k in ('price', 'unit_price', 'unit_price_snapshot', 'line_total',
                'subtotal', 'total', 'currency', 'discount',
                'organization_id', 'company_id', 'store_id', 'tenant_id',
                'order_id', 'cart_id', 'user_id', 'channel_id',
                'tax_rate', 'tax_total', 'tax_category_id',
                'segment_id', 'customer_id', 'price_list_id', 'price_source',
                'uom_id', 'uom_factor', 'factor', 'base_quantity', 'sku',
                'warehouse_id', 'reservation_id', 'level_id', 'stock', 'available')
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: el precio, el canal, el tenant y el almacen los decide el servidor, no el carrito'
      using errcode = '22023';
  end if;

  select exists (
    select 1 from public.product_channels pc where pc.channel_id = v_cart.channel_id
  ) into v_scoped;

  -- Agrupacion por la TERNA, la misma de `create_order` y de `build_quote`.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'product_id', product_id,
             'variant_id', variant_id,
             'uom_code',   uom_code,
             'quantity',   quantity
           )),
           '[]'::jsonb)
    into v_normalized
  from (
    select (item ->> 'product_id')                                     as product_id,
           nullif(btrim(coalesce(item ->> 'variant_id', '')), '')      as variant_id,
           nullif(upper(btrim(coalesce(item ->> 'uom_code', ''))), '') as uom_code,
           sum((item ->> 'quantity')::numeric)::integer                as quantity
    from jsonb_array_elements(p_lines) as item
    group by 1, 2, 3
  ) grouped;

  delete from public.cart_items where cart_id = v_cart.id;

  for v_item in select * from jsonb_array_elements(v_normalized)
  loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser un entero mayor que cero'
        using errcode = '22023';
    end if;
    if v_qty > 10000 then
      raise exception 'CANTIDAD_INVALIDA: la cantidad maxima por linea es 10000'
        using errcode = '22023';
    end if;

    -- ADR 018: vendible = publicado en ESTA tienda.
    select p.* into v_product
    from public.products p
    join public.store_products sp
      on sp.product_id = p.id
     and sp.store_id = v_store.id
    where p.id = ebim.safe_uuid(v_item ->> 'product_id')
      and sp.status = 'published'
      and sp.published_at is not null
      and sp.published_at <= now();

    if not found then
      raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(v_item ->> 'product_id', 'null')
        using errcode = '22023';
    end if;

    if v_scoped and not exists (
      select 1 from public.product_channels pc
      where pc.channel_id = v_cart.channel_id and pc.product_id = v_product.id
    ) then
      raise exception 'PRODUCTO_FUERA_DE_CANAL: % no esta a la venta en este canal', v_product.sku
        using errcode = '22023';
    end if;

    -- La moneda es la de la publicación en esta tienda.
    if exists (
      select 1 from public.store_products sp
      where sp.product_id = v_product.id and sp.store_id = v_store.id and sp.currency <> v_store.currency
    ) then
      raise exception 'MONEDA_INCONSISTENTE: % esta en % y la tienda en %',
        v_product.sku,
        (select sp.currency from public.store_products sp
          where sp.product_id = v_product.id and sp.store_id = v_store.id),
        v_store.currency
        using errcode = '22023';
    end if;

    v_has_var := (v_item ->> 'variant_id') is not null;

    if v_product.kind = 'variant' and not v_has_var then
      raise exception 'VARIANTE_REQUERIDA: % se vende por variante y el carrito no dice cual', v_product.sku
        using errcode = '22023';
    end if;
    if v_product.kind <> 'variant' and v_has_var then
      raise exception 'VARIANTE_NO_APLICA: % no tiene variantes', v_product.sku
        using errcode = '22023';
    end if;

    if v_has_var then
      select * into v_variant
      from public.product_variants pv
      where pv.id = ebim.safe_uuid(v_item ->> 'variant_id')
        and pv.product_id = v_product.id
        and pv.is_active;
      if not found then
        raise exception 'VARIANTE_NO_DISPONIBLE: %', coalesce(v_item ->> 'variant_id', 'null')
          using errcode = '22023';
      end if;
    end if;

    v_uom_code := v_item ->> 'uom_code';
    if v_uom_code is not null and not exists (
      select 1
      from public.product_uoms pu
      join public.units_of_measure u
        on u.id = pu.uom_id
       and u.organization_id = pu.organization_id
       and u.company_id      = pu.company_id
      where pu.product_id = v_product.id
        and upper(u.code) = v_uom_code
        and pu.is_sellable
        and u.is_active
    ) then
      raise exception 'UOM_NO_DISPONIBLE: % no se vende en la unidad %', v_product.sku, v_uom_code
        using errcode = '22023';
    end if;

    insert into public.cart_items (
      organization_id, company_id, store_id, cart_id,
      product_id, variant_id, uom_code, quantity
    ) values (
      v_cart.organization_id, v_cart.company_id, v_cart.store_id, v_cart.id,
      v_product.id,
      case when v_has_var then v_variant.id else null end,
      v_uom_code, v_qty
    );
  end loop;

  -- Un carrito con intencion de compra deja de ser el de un rastreador.
  update public.carts
     set last_activity_at = now(),
         expires_at = greatest(expires_at,
                               now() + case when user_id is null
                                            then interval '7 days'
                                            else interval '30 days' end)
   where id = v_cart.id;

  perform ebim.cart_refresh_prices(v_cart.id);

  return ebim.cart_payload(v_cart.id, false);
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.cart_payload(p_cart_id uuid, p_with_token boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_cart      public.carts%rowtype;
  v_channel   public.channels%rowtype;
  v_items     jsonb := '[]'::jsonb;
  v_quote     jsonb := null;
  v_error     text  := null;
  v_lines     jsonb := '[]'::jsonb;
  v_row       record;
  v_quoted    jsonb;
  v_atp       jsonb;
  v_price     text;
begin
  select * into v_cart from public.carts c where c.id = p_cart_id;
  if not found then
    raise exception 'CARRITO_NO_ENCONTRADO: no hay ningun carrito con esos datos'
      using errcode = '22023';
  end if;

  select * into v_channel from public.channels c where c.id = v_cart.channel_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', i.product_id,
           'variant_id', i.variant_id,
           'uom_code',   i.uom_code,
           'quantity',   i.quantity
         ) order by i.created_at, i.id), '[]'::jsonb)
    into v_items
  from public.cart_items i
  where i.cart_id = v_cart.id;

  if jsonb_array_length(v_items) > 0 then
    begin
      v_quote := ebim.build_quote(
        v_cart.store_id, v_cart.channel_id, v_items, null, null, now(), true);
    exception when others then
      -- El codigo de negocio, no el texto de Postgres: es lo que la pantalla
      -- puede traducir a algo que el comprador sepa arreglar.
      v_quote := null;
      v_error := coalesce(
        substring(sqlerrm from '^([A-Z][A-Z0-9_]{3,60}):'), 'COTIZACION_NO_DISPONIBLE');
    end;
  end if;

  for v_row in
    select i.*, sp.slug as product_slug, p.name as product_name, p.kind,
           v.name as variant_name, img.storage_path as image_path
    from public.cart_items i
    join public.products p on p.id = i.product_id
    -- ADR 018: la dirección del producto es la de su publicación en la tienda
    -- del carrito.
    left join public.store_products sp on sp.product_id = i.product_id and sp.store_id = v_cart.store_id
    left join public.product_variants v on v.id = i.variant_id
    -- La foto, con la MISMA regla que `public_products`: la marcada como
    -- principal y, a igualdad, la primera por posicion. Dos sitios que eligen
    -- la foto de un producto con criterios distintos acaban ensenando dos
    -- fotos distintas del mismo producto en la misma pagina.
    left join lateral (
      select pi.storage_path
      from public.product_images pi
      where pi.product_id = i.product_id
      order by pi.is_primary desc, pi.position asc
      limit 1
    ) img on true
    where i.cart_id = v_cart.id
    order by i.created_at, i.id
  loop
    v_quoted := null;
    if v_quote is not null then
      select line into v_quoted
      from jsonb_array_elements(v_quote -> 'lines') as line
      where (line ->> 'product_id')::uuid = v_row.product_id
        and ebim.safe_uuid(line ->> 'variant_id') is not distinct from v_row.variant_id
        and nullif(line ->> 'uom_code', '') is not distinct from v_row.uom_code
      limit 1;
    end if;

    -- Semaforo, jamas la cifra: es la misma regla de `availability_for_slug`.
    v_atp := ebim.atp(v_cart.store_id, v_row.product_id, v_row.variant_id);
    v_price := v_quoted ->> 'unit_price';

    v_lines := v_lines || jsonb_build_object(
      'product_id',   v_row.product_id,
      'variant_id',   v_row.variant_id,
      'uom_code',     v_row.uom_code,
      'quantity',     v_row.quantity,
      'slug',         v_row.product_slug,
      -- La RUTA del bucket, nunca una URL: la firma cada lado con su cliente,
      -- igual que la foto del catalogo desde P04.
      'image_path',   v_row.image_path,
      'name',         case when v_row.variant_name is null
                           then v_row.product_name
                           else v_row.product_name || ' · ' || v_row.variant_name end,
      'unit_price_snapshot', case when v_row.unit_price_snapshot is null then null
                                  else v_row.unit_price_snapshot::text end,
      'unit_price',   v_price,
      -- El aviso solo aparece cuando hay las dos cifras y difieren. Sin
      -- snapshot no hay con que comparar, y decir "cambio" seria inventarlo.
      'price_changed', case
                         when v_row.unit_price_snapshot is null or v_price is null then false
                         else v_row.unit_price_snapshot <> v_price::numeric
                       end,
      'in_stock',     coalesce((v_atp ->> 'backorder')::boolean, false)
                      or coalesce((v_atp ->> 'unknown')::boolean, false)
                      or coalesce((v_atp ->> 'available')::numeric, 0) >= v_row.quantity,
      'availability_unknown', coalesce((v_atp ->> 'unknown')::boolean, false)
    );
  end loop;

  return jsonb_build_object(
    'cart_id',      v_cart.id,
    'token',        case when p_with_token then v_cart.token else null end,
    'status',       v_cart.status,
    'channel',      v_channel.code,
    'currency',     v_cart.currency,
    'owned',        v_cart.user_id is not null,
    'expires_at',   v_cart.expires_at,
    'order_id',     v_cart.order_id,
    'lines',        v_lines,
    'quote',        v_quote,
    'quote_error',  v_error
  );
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order(p_store_id uuid, p_customer_email text, p_items jsonb, p_customer_name text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_shipping_address jsonb DEFAULT '{}'::jsonb, p_notes text DEFAULT NULL::text, p_reservation_token text DEFAULT NULL::text, p_source_channel text DEFAULT 'storefront'::text, p_business_account_id uuid DEFAULT NULL::uuid, p_billing_address jsonb DEFAULT NULL::jsonb, p_approval jsonb DEFAULT NULL::jsonb, p_coupon_codes text[] DEFAULT NULL::text[], p_delivery jsonb DEFAULT NULL::jsonb, p_purchase_order_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store       public.stores%rowtype;
  v_channel     public.channels%rowtype;
  v_scoped      boolean := false;
  v_inclusive   boolean := false;
  v_order_id    uuid := gen_random_uuid();
  v_seq         bigint;
  v_number      text;
  v_token       text;
  v_subtotal    numeric(14,2) := 0;
  v_tax         numeric(14,2) := 0;
  v_item        jsonb;
  v_product     public.products%rowtype;
  v_variant     public.product_variants%rowtype;
  v_has_variant boolean;
  v_uom_code    text;
  v_uom_id      uuid;
  v_factor      numeric(18,6);
  v_priced      jsonb;
  v_unit_price  numeric(14,2);
  v_base_qty    numeric(18,6);
  v_qty         integer;
  v_rate        numeric(6,4);
  v_amount      numeric(14,2);
  v_reservation public.inventory_reservations%rowtype;
  v_res_id      uuid := null;
  v_res_item    record;
  v_email       text := lower(btrim(coalesce(p_customer_email, '')));
  v_lines       jsonb := '[]'::jsonb;
  v_normalized  jsonb;
  -- ---- P08-SaaS ---------------------------------------------------------
  v_source      public.order_source_channel;
  v_source_txt  text := lower(btrim(coalesce(p_source_channel, 'storefront')));
  v_account     public.business_accounts%rowtype;
  v_customer    public.customers%rowtype;
  v_approval    public.order_approval_status := 'not_required';
  v_appr_reason text;
  v_snapshot    jsonb;
  -- ---- P12-SaaS ---------------------------------------------------------
  v_option      jsonb := null;   -- la opcion de entrega ya cotizada
  v_ship        numeric(14,2) := 0;
  v_ful         uuid := null;
  v_billing     jsonb;
  v_shipping    jsonb;
  v_grand       numeric(14,2);
  v_var_label   text;
  v_var_attrs   jsonb;
  v_tax_code    text;
  v_components  jsonb;
  -- ---- P10-SaaS ---------------------------------------------------------
  v_discount    numeric(14,2) := 0;
  v_promotions  jsonb := '{}'::jsonb;
  v_totals      jsonb;
  -- ---- N05 · orden de compra --------------------------------------------
  v_po          text := nullif(regexp_replace(btrim(coalesce(p_purchase_order_number, '')), '\s+', ' ', 'g'), '');
begin
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'EMAIL_REQUERIDO: el pedido necesita un correo de contacto valido'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUERIDOS: el pedido necesita al menos una linea'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'ITEMS_EXCESIVOS: maximo 100 lineas por pedido'
      using errcode = '22023';
  end if;

  -- El origen se comprueba contra las etiquetas del enum. Convertir a ciegas
  -- daria un `invalid input value for enum` (22P02) sin codigo de dominio, que
  -- es un 500 disfrazado para la pantalla que lo recibe.
  if not exists (
    select 1 from unnest(enum_range(null::public.order_source_channel)::text[]) as label
    where label = v_source_txt
  ) then
    raise exception 'ORIGEN_NO_VALIDO: "%" no es un origen de pedido', p_source_channel
      using errcode = '22023';
  end if;
  v_source := v_source_txt::public.order_source_channel;

  -- La lista negra crece con las llaves del inventario. Elegir almacen es
  -- elegir de donde sale la mercancia; nombrar una reserva o un nivel es
  -- nombrar filas internas. Las tres las decide el servidor.
  if exists (
    select 1
    from jsonb_array_elements(p_items) as item,
         jsonb_object_keys(item) as k
    where k in ('price', 'unit_price', 'line_total', 'subtotal', 'total',
                'currency', 'organization_id', 'company_id', 'store_id',
                'order_id', 'tenant_id', 'tax_rate', 'tax_total',
                'tax_category_id', 'channel_id',
                'uom_id', 'uom_factor', 'factor', 'base_quantity', 'sku',
                'segment_id', 'customer_id', 'price_list_id', 'price_source',
                'warehouse_id', 'reservation_id', 'level_id', 'stock', 'available',
                'discount', 'discount_amount', 'discount_total', 'discount_snapshot',
                'promotion_id', 'promotion_code', 'coupon_id', 'gift_card_id',
                'purchase_order_number')
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: el precio, el canal, la lista, el factor, el almacen, el descuento y el tenant los decide el servidor, no el payload'
      using errcode = '22023';
  end if;

  select * into v_store
  from public.stores s
  where s.id = p_store_id and s.status = 'active'
  for update;

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda % no existe o no esta activa', p_store_id
      using errcode = '22023';
  end if;

  perform ebim.assert_checkout_allowed(v_store.id, v_email);

  -- ---- La cuenta corporativa, si el borde resolvio una -------------------
  -- Segunda comprobacion del tenant: el borde ya la saco de la sesion, y aqui
  -- se exige ademas que sea de ESTA sociedad. Un uuid mal copiado no puede
  -- acabar firmando el pedido de otro comercio.
  if p_business_account_id is not null then
    select * into v_account
    from public.business_accounts a
    where a.id              = p_business_account_id
      and a.organization_id = v_store.organization_id
      and a.company_id      = v_store.company_id
      and a.is_active;

    if not found then
      raise exception 'CUENTA_NO_APLICA: esa cuenta corporativa no es de esta tienda'
        using errcode = '22023';
    end if;

    select * into v_customer from public.customers c where c.id = v_account.customer_id;
  end if;

  -- ---- N05 · La orden de compra: una REFERENCIA, y a veces obligatoria -----
  -- Formato: texto de 1 a 60 caracteres sin controles, espacios compactados.
  -- Es lo que el comprador copia de SU sistema; no identifica a nadie ni fija
  -- ningún importe.
  if v_po is not null and (char_length(v_po) > 60 or v_po ~ '[[:cntrl:]]') then
    raise exception 'ORDEN_COMPRA_INVALIDA: la orden de compra tiene que tener entre 1 y 60 caracteres'
      using errcode = '22023';
  end if;

  -- La autoridad es la FILA de la cuenta, no una casilla de la pantalla: si la
  -- cuenta con la que se firma el pedido exige orden de compra y no llegó, no
  -- hay pedido. Sin cuenta (consumidor, invitado) no aplica.
  if v_account.id is not null and v_account.purchase_order_required and v_po is null then
    raise exception 'ORDEN_COMPRA_REQUERIDA: esta cuenta exige un numero de orden de compra'
      using errcode = '22023';
  end if;

  -- Antes de mirar existencia: soltar lo que caduco. Sin esto, un carrito
  -- abandonado hace media hora seguiria impidiendo vender.
  perform ebim.expire_due_reservations(v_store.id);

  -- ---- La reserva del comprador, si la trae -------------------------------
  if p_reservation_token is not null and btrim(p_reservation_token) <> '' then
    select * into v_reservation
    from public.inventory_reservations r
    where r.store_id = v_store.id and r.token = p_reservation_token
    for update;

    if not found then
      raise exception 'RESERVA_NO_ENCONTRADA: no hay ninguna reserva con esos datos'
        using errcode = '22023';
    end if;

    if v_reservation.status <> 'held' then
      raise exception 'RESERVA_NO_VIGENTE: esa reserva ya se uso o caduco'
        using errcode = '22023';
    end if;

    -- Devolver al fondo comun DENTRO de esta transaccion. Las filas de
    -- existencia quedan bloqueadas hasta el commit, asi que nadie puede colarse
    -- entre la devolucion y el consumo de mas abajo.
    for v_res_item in
      select i.level_id, i.quantity
      from public.inventory_reservation_items i
      where i.reservation_id = v_reservation.id
    loop
      perform ebim.give_back_units(v_res_item.level_id, v_res_item.quantity, 'reserve');
    end loop;

    v_res_id := v_reservation.id;
  end if;

  select * into v_channel
  from public.channels c
  where c.store_id = v_store.id
    and c.is_default
    and c.is_active;

  if not found then
    raise exception 'CANAL_NO_DISPONIBLE: la tienda % no tiene canal por defecto activo', v_store.slug
      using errcode = '22023';
  end if;

  if v_channel.requires_auth then
    raise exception 'CANAL_NO_PUBLICO: el canal por defecto de % exige sesion', v_store.slug
      using errcode = '22023';
  end if;

  select exists (
    select 1 from public.product_channels pc where pc.channel_id = v_channel.id
  ) into v_scoped;

  select coalesce(ss.tax_inclusive, false) into v_inclusive
  from public.store_settings ss where ss.store_id = v_store.id;
  v_inclusive := coalesce(v_inclusive, false);

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'product_id', product_id,
             'variant_id', variant_id,
             'uom_code',   uom_code,
             'quantity',   quantity
           )),
           '[]'::jsonb)
    into v_normalized
  from (
    select (item ->> 'product_id')                    as product_id,
           nullif(btrim(coalesce(item ->> 'variant_id', '')), '') as variant_id,
           nullif(upper(btrim(coalesce(item ->> 'uom_code', ''))), '') as uom_code,
           sum((item ->> 'quantity')::numeric)::integer as quantity
    from jsonb_array_elements(p_items) as item
    group by 1, 2, 3
  ) grouped;

  for v_item in select * from jsonb_array_elements(v_normalized)
  loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser un entero mayor que cero'
        using errcode = '22023';
    end if;

    -- ADR 018: vendible = publicado en ESTA tienda. El bloqueo sigue siendo el
    -- del maestro (stock de catálogo).
    select p.* into v_product
    from public.products p
    join public.store_products sp
      on sp.product_id = p.id
     and sp.store_id = v_store.id
    where p.id = ebim.safe_uuid(v_item ->> 'product_id')
      and sp.status = 'published'
      and sp.published_at is not null
      and sp.published_at <= now()
    for update of p;

    if not found then
      raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(v_item ->> 'product_id', 'null')
        using errcode = '22023';
    end if;

    if v_scoped and not exists (
      select 1 from public.product_channels pc
      where pc.channel_id = v_channel.id and pc.product_id = v_product.id
    ) then
      raise exception 'PRODUCTO_FUERA_DE_CANAL: % no esta a la venta en el canal %',
        v_product.sku, v_channel.code
        using errcode = '22023';
    end if;

    -- La moneda es la de la publicación en esta tienda.
    if exists (
      select 1 from public.store_products sp
      where sp.product_id = v_product.id and sp.store_id = v_store.id and sp.currency <> v_store.currency
    ) then
      raise exception 'MONEDA_INCONSISTENTE: % esta en % y la tienda en %',
        v_product.sku,
        (select sp.currency from public.store_products sp
          where sp.product_id = v_product.id and sp.store_id = v_store.id),
        v_store.currency
        using errcode = '22023';
    end if;

    -- ---- Variante ---------------------------------------------------------
    v_has_variant := (v_item ->> 'variant_id') is not null;

    if v_product.kind = 'variant' and not v_has_variant then
      raise exception 'VARIANTE_REQUERIDA: % se vende por variante y el pedido no dice cual', v_product.sku
        using errcode = '22023';
    end if;

    if v_product.kind <> 'variant' and v_has_variant then
      raise exception 'VARIANTE_NO_APLICA: % no tiene variantes', v_product.sku
        using errcode = '22023';
    end if;

    if v_has_variant then
      select * into v_variant
      from public.product_variants pv
      where pv.id = ebim.safe_uuid(v_item ->> 'variant_id')
        and pv.product_id = v_product.id
        and pv.is_active
      for update;

      if not found then
        raise exception 'VARIANTE_NO_DISPONIBLE: %', coalesce(v_item ->> 'variant_id', 'null')
          using errcode = '22023';
      end if;
    else
      v_variant := null;
    end if;

    -- ---- Unidad de venta --------------------------------------------------
    v_uom_code := v_item ->> 'uom_code';

    if v_uom_code is null then
      v_uom_id := null;
      v_factor := 1;
    else
      select pu.uom_id, pu.factor into v_uom_id, v_factor
      from public.product_uoms pu
      join public.units_of_measure u
        on u.id = pu.uom_id
       and u.organization_id = pu.organization_id
       and u.company_id      = pu.company_id
      where pu.product_id = v_product.id
        and upper(u.code) = v_uom_code
        and pu.is_sellable
        and u.is_active;

      if v_factor is null then
        raise exception 'UOM_NO_DISPONIBLE: % no se vende en la unidad %', v_product.sku, v_uom_code
          using errcode = '22023';
      end if;
    end if;

    -- ---- Precio: UNA sola autoridad ---------------------------------------
    -- El acuerdo del cliente entra AQUI, y no solo en la cotizacion previa.
    -- Hasta ahora esto pasaba `null, null` aunque `v_customer` ya estuviera
    -- resuelto diez lineas mas arriba: la vitrina podia ensenar el precio de
    -- convenio y el pedido se cobraba al de catalogo. Un pedido que no cuadra
    -- con lo que se enseno es la peor clase de fallo, porque se descubre en la
    -- factura.
    --
    -- `v_customer` viene de `p_business_account_id`, que el borde saco de
    -- `my_business_accounts()` con la sesion del comprador y esta funcion ya
    -- revalido contra la sociedad de la tienda. Con comprador anonimo los dos
    -- siguen siendo nulos y no cambia ni un centimo.
    v_priced := ebim.resolve_price(
      v_store.id,
      v_channel.id,
      v_product.id,
      case when v_has_variant then v_variant.id else null end,
      v_uom_id,
      v_qty,
      v_store.currency,
      now(),
      v_customer.segment_id,
      v_customer.id
    );

    if v_priced is null or v_priced ->> 'unit_price' is null then
      raise exception 'PRECIO_NO_RESUELTO: % no tiene un precio aplicable', v_product.sku
        using errcode = '22023';
    end if;

    v_unit_price := (v_priced ->> 'unit_price')::numeric;

    v_base_qty := v_qty * v_factor;
    if v_base_qty <> trunc(v_base_qty) then
      raise exception 'CANTIDAD_INVALIDA: % x % no da un numero entero de unidades base',
        v_qty, v_factor
        using errcode = '22023';
    end if;

    -- ---- Existencia: una sola llamada, dos caminos por debajo --------------
    -- Con almacenes que sirvan a la tienda, reparte y deja asiento; sin ellos,
    -- descuenta `products.stock` exactamente como antes de esta fase.
    perform ebim.consume_stock(
      v_store.id,
      v_product.id,
      case when v_has_variant then v_variant.id else null end,
      v_base_qty,
      'order',
      v_order_id,
      null
    );

    v_rate := coalesce(
      ebim.effective_tax_rate(v_store.id, v_product.tax_category_id, now()),
      0
    );

    -- ---- Lo que se congela de esta linea ---------------------------------
    -- El CODIGO de la categoria fiscal y no su uuid: es snapshot. Si mañana el
    -- tenant borra la categoria o la reasigna, el pedido tiene que seguir
    -- diciendo bajo que regimen se vendio.
    select tc.code into v_tax_code
    from public.tax_categories tc where tc.id = v_product.tax_category_id;

    if v_has_variant then
      v_var_label := v_variant.name;
      -- La combinacion que ES la variante (talla, color...), por codigo de
      -- atributo. Consultable aunque despues se borre la variante entera.
      select coalesce(jsonb_object_agg(a.code, jsonb_build_object(
               'attribute', a.name,
               'code',      av.code,
               'label',     av.label)), '{}'::jsonb)
        into v_var_attrs
      from public.variant_attribute_values vav
      join public.attributes       a  on a.id  = vav.attribute_id
      join public.attribute_values av on av.id = vav.value_id
      where vav.variant_id = v_variant.id;
    else
      v_var_label := null;
      v_var_attrs := '{}'::jsonb;
    end if;

    if v_product.kind = 'bundle' then
      -- La receta, congelada. Un kit no tiene existencia propia: si la receta
      -- cambia despues de vender, sin esto no queda registro de que salio.
      select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', bi.component_product_id,
               'variant_id', bi.component_variant_id,
               'sku',        coalesce(pv.sku, cp.sku),
               'name',       case when pv.id is null then cp.name
                                  else cp.name || ' · ' || pv.name end,
               'quantity',   bi.quantity::text,
               'uom_code',   u.code
             ) order by bi.position, bi.component_product_id), '[]'::jsonb)
        into v_components
      from public.bundle_items bi
      join public.products cp on cp.id = bi.component_product_id
      left join public.product_variants pv on pv.id = bi.component_variant_id
      left join public.units_of_measure  u on u.id  = bi.uom_id
      where bi.bundle_product_id = v_product.id;
    else
      v_components := '[]'::jsonb;
    end if;

    v_amount := round(v_unit_price * v_qty, 2);

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', case when v_has_variant then v_variant.id else null end,
      'sku',        case when v_has_variant then v_variant.sku else v_product.sku end,
      'name',       case when v_has_variant
                         then v_product.name || ' · ' || v_variant.name
                         else v_product.name end,
      'unit_price', v_unit_price::text,
      'quantity',   v_qty,
      'uom_code',   v_uom_code,
      'uom_factor', v_factor::text,
      'amount',     v_amount::text,
      'tax_rate',   v_rate::text,
      'price_source',  v_priced ->> 'source',
      'price_list_id', v_priced ->> 'price_list_id',
      'price_list_code', v_priced ->> 'price_list_code',
      'variant_label',      v_var_label,
      'variant_attributes', v_var_attrs,
      'tax_category_code',  v_tax_code,
      'components',         v_components
    );
  end loop;

  -- ---- Las lineas, NUMERADAS ----------------------------------------------
  -- El motor de promociones necesita poder devolver "esta linea" y no "este
  -- producto": dos lineas del mismo producto en distinta presentacion son dos
  -- lineas, y un descuento que no supiera distinguirlas se aplicaria dos veces
  -- o ninguna.
  select coalesce(jsonb_agg(line || jsonb_build_object('line_key', ord) order by ord), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) with ordinality as t(line, ord);

  -- ---- P10 - Promociones, y aqui SI con los cerrojos puestos --------------
  --
  -- Es la SEGUNDA evaluacion de esta compra: la primera fue la del carrito, que
  -- solo ensenaba. Esta es la que decide, y por eso pasa `p_lock := true`: las
  -- campanas y los cupones con tope de uso se bloquean antes de contarse, asi
  -- que dos compras simultaneas no gastan el mismo ultimo uso.
  --
  -- El navegador NO puede declarar que una promocion se aplico. Lo unico que
  -- llega de fuera son los CODIGOS de cupon, que es lo unico que el comprador
  -- tiene que poder teclear; todo lo demas -campanas vigentes, alcance,
  -- audiencia, prioridad, combinacion y limites- sale de la base.
  v_promotions := ebim.evaluate_promotions(
    v_store.id,
    v_channel.id,
    (select coalesce(jsonb_agg(jsonb_build_object(
              'line_key',   (line ->> 'line_key')::integer,
              'product_id', line ->> 'product_id',
              'variant_id', line ->> 'variant_id',
              'quantity',   line ->> 'quantity',
              'unit_price', line ->> 'unit_price',
              'amount',     line ->> 'amount',
              'tax_rate',   line ->> 'tax_rate')), '[]'::jsonb)
     from jsonb_array_elements(v_lines) as line),
    p_coupon_codes,
    v_customer.id,
    null,
    v_account.id,
    v_email,
    now(),
    true);

  -- El descuento se pega a la linea junto con su POR QUE. Sin
  -- `discount_snapshot`, dentro de un ano nadie puede explicar por que ese
  -- pedido costo eso: la campana puede haberse borrado.
  select coalesce(jsonb_agg(
           line || jsonb_build_object(
             'discount',          coalesce(d.entry ->> 'discount', '0'),
             'discount_snapshot', coalesce(d.entry -> 'adjustments', '[]'::jsonb))
           order by (line ->> 'line_key')::integer), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) as line
  left join lateral (
    select e as entry
    from jsonb_array_elements(coalesce(v_promotions -> 'lines', '[]'::jsonb)) as e
    where (e ->> 'line_key')::integer = (line ->> 'line_key')::integer
    limit 1
  ) d on true;

  -- ---- Los totales, con UNA sola autoridad fiscal -------------------------
  --
  -- Hasta P09 el reparto del impuesto por grupo de tasa y su distribucion por
  -- linea vivian AQUI, escritos dos veces (aqui y en `ebim.build_quote`). Con
  -- descuentos hay una tercera pregunta -sobre que base se calcula el
  -- impuesto- y mantener dos copias de la respuesta seria garantizar que un dia
  -- discrepen. `ebim.promotion_totals` es esa unica copia, y con descuento cero
  -- devuelve EXACTAMENTE los mismos numeros que este bloque devolvia: por eso
  -- ningun pedido de P02 a P09 cambia ni un centimo.
  v_totals := ebim.promotion_totals(
    (select coalesce(jsonb_agg(jsonb_build_object(
              'line_key', (line ->> 'line_key')::integer,
              'amount',   line ->> 'amount',
              'discount', line ->> 'discount',
              'tax_rate', line ->> 'tax_rate')), '[]'::jsonb)
     from jsonb_array_elements(v_lines) as line),
    v_inclusive);

  v_subtotal := (v_totals ->> 'subtotal')::numeric;
  v_discount := (v_totals ->> 'discount_total')::numeric;
  v_tax      := (v_totals ->> 'tax_total')::numeric;
  v_grand    := (v_totals ->> 'grand_total')::numeric;

  -- ---- P12 · La ENTREGA, resuelta en el SERVIDOR --------------------------
  --
  -- `p_delivery` trae una eleccion y jamas un importe. El coste sale de
  -- `ebim.quote_delivery_choice`, que vuelve a comprobar cobertura, tarifa,
  -- tramo y umbral de gratuidad con el subtotal que el motor acaba de calcular
  -- —no con el que viera la vitrina hace diez minutos, que pudo cambiar—.
  --
  -- Se suma ANTES del umbral de aprobacion B2B a proposito: lo que la empresa
  -- paga incluye el transporte, y dejarlo fuera haria que un pedido cruzara el
  -- limite sin pedir firma.
  --
  -- Sin `p_delivery`, transporte CERO y ningun fulfillment: un tenant que no
  -- ha configurado entregas vende exactamente como antes de P12.
  if p_delivery is not null
     and nullif(btrim(coalesce(p_delivery ->> 'method_code', '')), '') is not null then
    v_option := ebim.quote_delivery_choice(
      v_store.id,
      p_delivery ->> 'method_code',
      coalesce(p_shipping_address, '{}'::jsonb),
      v_lines,
      v_subtotal,
      ebim.safe_uuid(p_delivery ->> 'pickup_point_id'));
    v_ship  := coalesce((v_option ->> 'amount')::numeric, 0);
    v_grand := v_grand + v_ship;
  end if;

  select coalesce(jsonb_agg(
           line || jsonb_build_object('tax_amount', coalesce(f.entry ->> 'tax_amount', '0.00'))
           order by (line ->> 'line_key')::integer), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) as line
  left join lateral (
    select e as entry
    from jsonb_array_elements(coalesce(v_totals -> 'lines', '[]'::jsonb)) as e
    where (e ->> 'line_key')::integer = (line ->> 'line_key')::integer
    limit 1
  ) f on true;
  -- ---- ¿Hace falta que alguien autorice esta compra? ----------------------
  --
  -- Dos fuentes, y la de la base manda:
  --
  --  · **el umbral de la CUENTA** lo decide esta funcion, con la fila delante.
  --    No depende de que ningun llamante se acuerde de preguntarlo.
  --  · **el limite de la PERSONA** solo se puede saber donde hay sesion, y aqui
  --    no la hay: esta funcion corre con `service_role` y `ebim.user_id()` es
  --    NULL. Lo resuelve el borde llamando a `public.purchase_approval` con el
  --    JWT del comprador, y llega en `p_approval`.
  --
  -- `p_approval` solo puede AÑADIR una aprobacion; no existe forma de que
  -- quite la que el umbral de la cuenta impone. Un payload manipulado no
  -- convierte una compra que necesita firma en una que no.
  if v_account.id is not null then
    if v_account.requires_approval
       and (v_account.approval_threshold is null or v_grand >= v_account.approval_threshold)
    then
      v_approval    := 'pending';
      v_appr_reason := 'account_threshold';
    elsif lower(btrim(coalesce(p_approval ->> 'required', ''))) in ('true', 't', '1') then
      v_approval    := 'pending';
      v_appr_reason := nullif(left(btrim(coalesce(p_approval ->> 'reason', '')), 1000), '');
    end if;
  end if;

  -- ---- Los snapshots del pedido -------------------------------------------
  v_shipping := coalesce(p_shipping_address, '{}'::jsonb);
  if jsonb_typeof(v_shipping) <> 'object' then
    raise exception 'DIRECCION_NO_VALIDA: la direccion de envio tiene que ser un objeto'
      using errcode = '22023';
  end if;

  -- Sin direccion fiscal declarada se factura donde se entrega, que es lo que
  -- pasa en el 99% de las compras B2C. Copiar es mejor que dejarla vacia: una
  -- factura sin direccion no se puede emitir.
  v_billing := coalesce(p_billing_address, v_shipping);
  if jsonb_typeof(v_billing) <> 'object' then
    raise exception 'DIRECCION_NO_VALIDA: la direccion de facturacion tiene que ser un objeto'
      using errcode = '22023';
  end if;

  -- El cliente, tal y como se identifico. Sale del correo y el nombre que
  -- escribio el comprador y, si hay cuenta corporativa, de la ficha que el
  -- SERVIDOR resolvio a partir de ella. `orders` sigue SIN `customer_id`
  -- (decision de P05, intacta): esa columna solo la podria rellenar el
  -- navegador en una compra anonima. Aqui es un SNAPSHOT, no una referencia
  -- viva, y por eso puede llevar los datos sin abrir esa puerta.
  v_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'email',        v_email,
    'name',         nullif(btrim(coalesce(p_customer_name, '')), ''),
    'phone',        nullif(btrim(coalesce(p_customer_phone, '')), ''),
    'customer_id',   v_customer.id,
    'customer_code', v_customer.code,
    'customer_name', v_customer.name,
    'legal_name',    v_customer.legal_name,
    'tax_id',        v_customer.tax_id,
    'account_id',    v_account.id,
    'account_code',  v_account.code,
    'account_name',  v_account.name));

  update public.stores
     set order_seq = order_seq + 1
   where id = v_store.id
  returning order_seq into v_seq;

  v_number := 'EC-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 5, '0');

  insert into public.orders (
    id, organization_id, company_id, store_id, channel_id, order_number, status,
    customer_email, customer_name, customer_phone, currency,
    subtotal, tax_total, shipping_total, discount_total, grand_total,
    shipping_address, notes,
    source_channel, business_account_id, approval_status, approval_reason,
    tax_inclusive, billing_address, shipping_address_snapshot, customer_snapshot,
    purchase_order_number
  ) values (
    v_order_id, v_store.organization_id, v_store.company_id, v_store.id, v_channel.id,
    v_number, 'pending',
    v_email, nullif(btrim(coalesce(p_customer_name, '')), ''),
    nullif(btrim(coalesce(p_customer_phone, '')), ''), v_store.currency,
    v_subtotal, v_tax, v_ship, v_discount, v_grand,
    v_shipping, nullif(btrim(coalesce(p_notes, '')), ''),
    v_source, v_account.id, v_approval, v_appr_reason,
    v_inclusive, v_billing, v_shipping, v_snapshot,
    v_po
  );

  insert into public.order_tokens (order_id, organization_id, company_id)
  values (v_order_id, v_store.organization_id, v_store.company_id)
  returning token into v_token;

  insert into public.order_items (
    organization_id, company_id, store_id, order_id,
    product_id, variant_id, sku, name, unit_price, quantity, uom_code, uom_factor,
    price_source, price_list_id,
    variant_label, variant_attributes, tax_rate, tax_amount, tax_inclusive,
    tax_category_code, price_list_code, components_snapshot,
    discount_amount, discount_snapshot
  )
  select
    v_store.organization_id, v_store.company_id, v_store.id, v_order_id,
    (line ->> 'product_id')::uuid,
    ebim.safe_uuid(line ->> 'variant_id'),
    line ->> 'sku', line ->> 'name',
    (line ->> 'unit_price')::numeric, (line ->> 'quantity')::integer,
    line ->> 'uom_code', (line ->> 'uom_factor')::numeric,
    coalesce(line ->> 'price_source', 'catalog'),
    ebim.safe_uuid(line ->> 'price_list_id'),
    line ->> 'variant_label',
    coalesce(line -> 'variant_attributes', '{}'::jsonb),
    (line ->> 'tax_rate')::numeric,
    (line ->> 'tax_amount')::numeric,
    v_inclusive,
    line ->> 'tax_category_code',
    line ->> 'price_list_code',
    coalesce(line -> 'components', '[]'::jsonb),
    coalesce((line ->> 'discount')::numeric, 0),
    coalesce(line -> 'discount_snapshot', '[]'::jsonb)
  from jsonb_array_elements(v_lines) as line;

  -- ---- P10 - El canje, en ESTA transaccion --------------------------------
  --
  -- Apuntar quien uso que campana y mover el contador de usos pasa DESPUES de
  -- que el pedido exista y ANTES del commit. Los cerrojos que tomo
  -- `evaluate_promotions` siguen puestos, asi que entre contar y gastar no cabe
  -- otra transaccion: es lo que hace que "maximo 100 usos" sean 100 y no 101.
  perform ebim.redeem_promotions(
    v_order_id,
    coalesce(v_promotions -> 'applied', '[]'::jsonb),
    v_customer.id,
    v_account.id);

  -- La reserva acabo en este pedido. Sus unidades ya salieron por los asientos
  -- de arriba; lo que queda es dejar dicho donde acabo.
  if v_res_id is not null then
    update public.inventory_reservations
       set status = 'committed', committed_at = now(), order_id = v_order_id
     where id = v_res_id;
  end if;

  -- ---- P12 · La promesa de entrega, en ESTA transaccion -------------------
  --
  -- El fulfillment nace CON el pedido y no despues, por la misma razon que el
  -- canje de promociones: entre dos transacciones cabe un proceso muerto, y el
  -- estado que deja —«pedido cobrado del que nadie sabe como sale»— es
  -- precisamente el que este proyecto no puede tener.
  --
  -- Lleva TODAS las lineas. Partirlo en dos entregas es una decision de
  -- operacion que se toma despues, con `fulfillment_create`, y que no cobra
  -- transporte de mas porque el reparto de `shipping_total` es estructural.
  if v_option is not null then
    v_ful := ebim.plan_fulfillment(v_order_id, v_option, coalesce(p_delivery, '{}'::jsonb));
  end if;

  return jsonb_build_object(
    'order_id',       v_order_id,
    'order_number',   v_number,
    'access_token',   v_token,
    'status',         'pending',
    'currency',       v_store.currency,
    'channel',        v_channel.code,
    'subtotal',       v_subtotal::text,
    'tax_total',      v_tax::text,
    'discount_total', v_discount::text,
    'shipping_total', v_ship::text,
    'grand_total',    v_grand::text,
    -- P12: el comprador tiene derecho a ver COMO le llega y CUANDO, en la misma
    -- respuesta en la que se le dice cuanto pago. Sin entrega configurada es
    -- `null`, que es distinto de un objeto vacio: no se eligio nada.
    'delivery', case when v_option is null then null else jsonb_strip_nulls(jsonb_build_object(
      'fulfillment_id', v_ful,
      'method_code',    v_option ->> 'code',
      'method_name',    v_option ->> 'name',
      'strategy',       v_option ->> 'strategy',
      'amount',         v_option ->> 'amount',
      'currency',       v_option ->> 'currency',
      'promised_from',  v_option ->> 'promised_from',
      'promised_to',    v_option ->> 'promised_to')) end,
    'tax_inclusive',  v_inclusive,
    'items',          v_lines,
    -- P08: el comprador tiene que enterarse EN LA RESPUESTA de que su compra
    -- espera una firma. Descubrirlo dias despues, cuando no llega nada, es la
    -- version cara del mismo dato.
    'source_channel',  v_source,
    -- N05: la orden de compra con la que se firmó, tal como quedó guardada.
    'purchase_order_number', v_po,
    'approval_status', v_approval,
    'approval_reason', v_appr_reason,
    -- P10: el desglose viaja con el pedido. El comprador tiene derecho a saber
    -- que campana le rebajo cuanto y, lo que casi nunca se devuelve, por que su
    -- cupon no hizo nada.
    'promotions', jsonb_build_object(
      'applied', coalesce(v_promotions -> 'applied', '[]'::jsonb),
      'skipped', coalesce(v_promotions -> 'skipped', '[]'::jsonb),
      'coupons', coalesce(v_promotions -> 'coupons', '[]'::jsonb))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.availability_for_slug(p_store_slug text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store_id uuid;
  v_slug     text := lower(btrim(coalesce(p_store_slug, '')));
  v_item     jsonb;
  v_product  uuid;
  v_variant  uuid;
  v_qty      numeric;
  v_atp      jsonb;
  v_visible  boolean;
  v_out      jsonb := '[]'::jsonb;
begin
  if v_slug = '' then
    raise exception 'TIENDA_NO_DISPONIBLE: falta la tienda' using errcode = '22023';
  end if;

  select s.id into v_store_id
  from public.stores s
  where lower(s.slug) = v_slug and s.status = 'active';

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda "%" no existe o no esta activa', v_slug
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_REQUERIDOS: hace falta una lista de referencias' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'ITEMS_EXCESIVOS: maximo 100 lineas por consulta' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product := ebim.safe_uuid(v_item ->> 'product_id');
    v_variant := ebim.safe_uuid(v_item ->> 'variant_id');
    v_qty     := greatest(coalesce((v_item ->> 'quantity')::numeric, 1), 1);

    -- La misma autorizacion que el semaforo: solo se responde por producto
    -- publicado de esta tienda activa. Un uuid de otra tienda no revela nada.
    select exists (
      select 1 from public.store_products sp
      where sp.product_id = v_product
        and sp.store_id = v_store_id
        and sp.status = 'published'
        and sp.published_at is not null
        and sp.published_at <= now()
    ) into v_visible;

    if not v_visible then
      v_out := v_out || jsonb_build_object(
        'product_id', v_item ->> 'product_id',
        'variant_id', v_item ->> 'variant_id',
        'quantity',   v_qty,
        'in_stock',   false,
        'unknown',    false,
        'source',     'catalog');
      continue;
    end if;

    v_atp := ebim.atp(v_store_id, v_product, v_variant);

    v_out := v_out || jsonb_build_object(
      'product_id', v_item ->> 'product_id',
      'variant_id', v_item ->> 'variant_id',
      'quantity',   v_qty,
      'in_stock',   coalesce((v_atp ->> 'backorder')::boolean, false)
                    or coalesce((v_atp ->> 'unknown')::boolean, false)
                    or coalesce((v_atp ->> 'available')::numeric, 0) >= v_qty,
      'unknown',    coalesce((v_atp ->> 'unknown')::boolean, false),
      'source',     v_atp ->> 'source');
  end loop;

  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.hold_stock(p_store_id uuid, p_reference_kind text, p_reference_key text, p_items jsonb, p_ttl_seconds integer, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_store       public.stores%rowtype;
  v_existing    public.inventory_reservations%rowtype;
  v_reservation uuid;
  v_token       text;
  v_expires     timestamptz;
  v_item        jsonb;
  v_product     public.products%rowtype;
  v_variant_id  uuid;
  v_uom_code    text;
  v_factor      numeric(18,6);
  v_qty         numeric;
  v_base        numeric;
  v_line        record;
  v_result      jsonb;
  v_alloc       jsonb;
  v_lines       jsonb := '[]'::jsonb;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 86400 then
    raise exception 'CADUCIDAD_INVALIDA: la reserva dura entre 60 y 86400 segundos'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUERIDOS: la reserva necesita al menos una linea'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'ITEMS_EXCESIVOS: maximo 100 lineas por reserva'
      using errcode = '22023';
  end if;

  select * into v_store
  from public.stores s
  where s.id = p_store_id and s.status = 'active';

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda % no existe o no esta activa', p_store_id
      using errcode = '22023';
  end if;

  -- Antes de decir que no hay: soltar lo caducado de esta tienda.
  perform ebim.expire_due_reservations(p_store_id);

  -- Idempotencia de negocio.
  select * into v_existing
  from public.inventory_reservations r
  where r.store_id = p_store_id
    and r.reference_kind = p_reference_kind
    and lower(r.reference_key) = lower(p_reference_key)
    and r.status = 'held';

  if found then
    return jsonb_build_object(
      'reservation_id', v_existing.id,
      'token',          v_existing.token,
      'status',         v_existing.status,
      'expires_at',     v_existing.expires_at,
      'created',        false,
      'lines',          coalesce((
        select jsonb_agg(jsonb_build_object(
                 'product_id', i.product_id,
                 'variant_id', i.variant_id,
                 'warehouse_id', i.warehouse_id,
                 'quantity', i.quantity))
        from public.inventory_reservation_items i
        where i.reservation_id = v_existing.id), '[]'::jsonb));
  end if;

  v_expires := now() + make_interval(secs => p_ttl_seconds);

  insert into public.inventory_reservations (
    organization_id, company_id, store_id, reference_kind, reference_key,
    expires_at, created_by
  ) values (
    v_store.organization_id, v_store.company_id, v_store.id,
    p_reference_kind, p_reference_key, v_expires, p_actor
  )
  returning id, token into v_reservation, v_token;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser mayor que cero'
        using errcode = '22023';
    end if;

    -- ADR 018: el producto de ESTA tienda es el que tiene publicación aquí.
    select p.* into v_product
    from public.products p
    where p.id = ebim.safe_uuid(v_item ->> 'product_id')
      and exists (
        select 1 from public.store_products sp
        where sp.product_id = p.id and sp.store_id = v_store.id);

    if not found then
      raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(v_item ->> 'product_id', 'null')
        using errcode = '22023';
    end if;

    v_variant_id := ebim.safe_uuid(v_item ->> 'variant_id');

    if v_product.kind = 'variant' and v_variant_id is null then
      raise exception 'VARIANTE_REQUERIDA: % se vende por variante', v_product.sku
        using errcode = '22023';
    end if;
    if v_product.kind <> 'variant' and v_variant_id is not null then
      raise exception 'VARIANTE_NO_APLICA: % no tiene variantes', v_product.sku
        using errcode = '22023';
    end if;
    if v_variant_id is not null and not exists (
      select 1 from public.product_variants pv
      where pv.id = v_variant_id and pv.product_id = v_product.id and pv.is_active
    ) then
      raise exception 'VARIANTE_NO_DISPONIBLE: %', v_variant_id using errcode = '22023';
    end if;

    -- Presentacion -> unidades base. Misma regla que el pedido: una conversion
    -- que no da un entero de unidades base no se puede descontar sin inventarse
    -- un redondeo, asi que se rechaza.
    v_uom_code := nullif(upper(btrim(coalesce(v_item ->> 'uom_code', ''))), '');
    if v_uom_code is null then
      v_factor := 1;
    else
      select pu.factor into v_factor
      from public.product_uoms pu
      join public.units_of_measure u
        on u.id = pu.uom_id
       and u.organization_id = pu.organization_id
       and u.company_id      = pu.company_id
      where pu.product_id = v_product.id
        and upper(u.code) = v_uom_code
        and pu.is_sellable
        and u.is_active;

      if v_factor is null then
        raise exception 'UOM_NO_DISPONIBLE: % no se vende en la unidad %', v_product.sku, v_uom_code
          using errcode = '22023';
      end if;
    end if;

    v_base := v_qty * v_factor;
    if v_base <> trunc(v_base) then
      raise exception 'CANTIDAD_INVALIDA: % x % no da un numero entero de unidades base',
        v_qty, v_factor using errcode = '22023';
    end if;

    for v_line in
      select l.product_id, l.variant_id, l.quantity
      from ebim.expand_stock_lines(v_store.id, v_product.id, v_variant_id, v_base) l
    loop
      if v_line.quantity <> trunc(v_line.quantity) then
        raise exception 'KIT_CANTIDAD_INVALIDA: % necesita % unidades de un componente y no es un entero',
          v_product.sku, v_line.quantity using errcode = '22023';
      end if;

      v_result := ebim.take_units(
        v_store.id, v_line.product_id, v_line.variant_id, v_line.quantity, 'reserve');

      if not coalesce((v_result ->> 'ok')::boolean, false) then
        if (v_result ->> 'reason') = 'unknown' then
          raise exception 'DISPONIBILIDAD_DESCONOCIDA: % no se puede prometer ahora mismo', v_product.sku
            using errcode = '22023';
        end if;
        raise exception 'STOCK_INSUFICIENTE: % (no hay existencia suficiente para reservar)', v_product.sku
          using errcode = '22023';
      end if;

      for v_alloc in select * from jsonb_array_elements(v_result -> 'allocations')
      loop
        insert into public.inventory_reservation_items (
          organization_id, company_id, reservation_id, level_id, warehouse_id,
          product_id, variant_id, quantity
        ) values (
          v_store.organization_id, v_store.company_id, v_reservation,
          (v_alloc ->> 'level_id')::uuid, (v_alloc ->> 'warehouse_id')::uuid,
          v_line.product_id, v_line.variant_id, (v_alloc ->> 'quantity')::numeric
        );

        v_lines := v_lines || jsonb_build_object(
          'product_id',   v_line.product_id,
          'variant_id',   v_line.variant_id,
          'warehouse_id', (v_alloc ->> 'warehouse_id')::uuid,
          'quantity',     (v_alloc ->> 'quantity')::numeric);
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'reservation_id', v_reservation,
    'token',          v_token,
    'status',         'held',
    'expires_at',     v_expires,
    'created',        true,
    'lines',          v_lines);
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.consume_stock(p_store_id uuid, p_product_id uuid, p_variant_id uuid, p_base_qty numeric, p_reference_kind text DEFAULT 'order'::text, p_reference_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_product   public.products%rowtype;
  v_count     integer;
  v_line      record;
  v_result    jsonb;
  v_available numeric;
  v_moves     integer := 0;
  v_sku       text;
begin
  -- ADR 018: el maestro de la SOCIEDAD de la tienda. Descontar existencias no
  -- depende de que la publicación siga viva (devoluciones, pedidos en curso).
  select p.* into v_product
  from public.products p
  join public.stores s
    on s.id = p_store_id
   and s.organization_id = p.organization_id
   and s.company_id = p.company_id
  where p.id = p_product_id;

  if not found then
    raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(p_product_id::text, 'null')
      using errcode = '22023';
  end if;

  v_sku := v_product.sku;
  select count(*) into v_count from ebim.serving_warehouses(p_store_id);

  -- ---- Camino de ALMACEN --------------------------------------------------
  if v_count > 0 then
    for v_line in
      select l.product_id, l.variant_id, l.quantity
      from ebim.expand_stock_lines(p_store_id, p_product_id, p_variant_id, p_base_qty) l
    loop
      if v_line.quantity <> trunc(v_line.quantity) then
        raise exception 'KIT_CANTIDAD_INVALIDA: % necesita % unidades de un componente y no es un entero',
          v_sku, v_line.quantity using errcode = '22023';
      end if;

      v_result := ebim.take_units(
        p_store_id, v_line.product_id, v_line.variant_id, v_line.quantity, 'issue');

      if not coalesce((v_result ->> 'ok')::boolean, false) then
        if (v_result ->> 'reason') = 'unknown' then
          raise exception 'DISPONIBILIDAD_DESCONOCIDA: % no se puede prometer ahora mismo', v_sku
            using errcode = '22023';
        end if;
        raise exception 'STOCK_INSUFICIENTE: % (no hay existencia suficiente)', v_sku
          using errcode = '22023';
      end if;

      v_moves := v_moves + ebim.log_allocation(
        v_result -> 'allocations', 'issue'::public.movement_kind, -1,
        null, p_reference_kind, p_reference_id, p_actor);
    end loop;

    return jsonb_build_object('source', 'warehouse', 'movements', v_moves);
  end if;

  -- ---- Camino de CATALOGO (lo de siempre) ---------------------------------
  if v_product.kind = 'bundle' then
    for v_line in
      select l.product_id, l.variant_id, l.quantity
      from ebim.expand_stock_lines(p_store_id, p_product_id, p_variant_id, p_base_qty) l
    loop
      if v_line.quantity <> trunc(v_line.quantity) then
        raise exception 'KIT_CANTIDAD_INVALIDA: % necesita % unidades de un componente y no es un entero',
          v_sku, v_line.quantity using errcode = '22023';
      end if;

      if v_line.variant_id is not null then
        select pv.stock into v_available
        from public.product_variants pv where pv.id = v_line.variant_id for update;
      else
        select p2.stock into v_available
        from public.products p2 where p2.id = v_line.product_id for update;
      end if;

      if coalesce(v_available, 0) < v_line.quantity then
        raise exception 'STOCK_INSUFICIENTE: % (componente sin existencia suficiente)', v_sku
          using errcode = '22023';
      end if;

      if v_line.variant_id is not null then
        update public.product_variants
           set stock = stock - v_line.quantity::integer
         where id = v_line.variant_id;
      else
        update public.products
           set stock = stock - v_line.quantity::integer
         where id = v_line.product_id;
      end if;
    end loop;

  elsif p_variant_id is not null then
    select pv.stock into v_available
    from public.product_variants pv where pv.id = p_variant_id for update;

    if coalesce(v_available, 0) < p_base_qty then
      raise exception 'STOCK_INSUFICIENTE: % (disponible %, pedido %)',
        v_sku, coalesce(v_available, 0), p_base_qty using errcode = '22023';
    end if;

    update public.product_variants
       set stock = stock - p_base_qty::integer
     where id = p_variant_id;

  else
    select p2.stock into v_available
    from public.products p2 where p2.id = p_product_id for update;

    if coalesce(v_available, 0) < p_base_qty then
      raise exception 'STOCK_INSUFICIENTE: % (disponible %, pedido %)',
        v_sku, coalesce(v_available, 0), p_base_qty using errcode = '22023';
    end if;

    update public.products
       set stock = stock - p_base_qty::integer
     where id = p_product_id;
  end if;

  return jsonb_build_object('source', 'catalog', 'movements', 0);
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.ensure_level(p_warehouse_id uuid, p_product_id uuid, p_variant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_warehouse public.warehouses%rowtype;
  v_product   public.products%rowtype;
  v_id        uuid;
begin
  select * into v_warehouse from public.warehouses w where w.id = p_warehouse_id;
  if not found then
    raise exception 'ALMACEN_NO_ENCONTRADO: %', p_warehouse_id using errcode = '22023';
  end if;

  select * into v_product from public.products p where p.id = p_product_id;
  if not found then
    raise exception 'PRODUCTO_NO_DISPONIBLE: %', p_product_id using errcode = '22023';
  end if;

  -- El almacen y el producto tienen que ser de la MISMA sociedad. La FK ya lo
  -- impediria por el camino de la tienda, pero el mensaje seria el de una clave
  -- foranea y no el de un error de negocio.
  if v_product.organization_id <> v_warehouse.organization_id
     or v_product.company_id <> v_warehouse.company_id then
    raise exception 'ALMACEN_DE_OTRA_SOCIEDAD: el almacen % no puede guardar %',
      v_warehouse.code, v_product.sku using errcode = '22023';
  end if;

  if v_product.kind = 'bundle' then
    raise exception 'KIT_SIN_EXISTENCIA: % es un kit y su existencia es la de sus componentes',
      v_product.sku using errcode = '22023';
  end if;

  if v_product.kind = 'variant' and p_variant_id is null then
    raise exception 'VARIANTE_REQUERIDA: % lleva existencia por variante', v_product.sku
      using errcode = '22023';
  end if;

  if v_product.kind <> 'variant' and p_variant_id is not null then
    raise exception 'VARIANTE_NO_APLICA: % no tiene variantes', v_product.sku
      using errcode = '22023';
  end if;

  select l.id into v_id
  from public.inventory_levels l
  where l.warehouse_id = p_warehouse_id
    and l.product_id   = p_product_id
    and l.variant_id is not distinct from p_variant_id;

  if found then return v_id; end if;

  insert into public.inventory_levels (
    organization_id, company_id, warehouse_id, store_id, product_id, variant_id,
    allow_backorder
  ) values (
    v_product.organization_id, v_product.company_id, p_warehouse_id,
    -- ADR 018: ancla informativa (los movimientos la copian y la exigen). Nada
    -- filtra existencias por ella: la disponibilidad va por los almacenes que
    -- sirven a cada tienda.
    coalesce(
      v_product.store_id,
      (select sp.store_id from public.store_products sp
        where sp.product_id = p_product_id order by sp.created_at, sp.store_id limit 1),
      (select s.id from public.stores s
        where s.organization_id = v_product.organization_id and s.company_id = v_product.company_id
        order by s.created_at, s.id limit 1)),
    p_product_id, p_variant_id, v_warehouse.allows_backorder
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_inventory_from_catalog(p_warehouse_id uuid, p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_warehouse public.warehouses%rowtype;
  v_store     public.stores%rowtype;
  v_row       record;
  v_level     uuid;
  v_seeded    integer := 0;
begin
  select * into v_warehouse from public.warehouses w where w.id = p_warehouse_id;
  if not found then
    raise exception 'ALMACEN_NO_ENCONTRADO: %', p_warehouse_id using errcode = '22023';
  end if;

  perform ebim.assert_inventory_role(
    v_warehouse.organization_id, v_warehouse.company_id,
    array['owner','admin']::public.app_role[]);

  select * into v_store from public.stores s where s.id = p_store_id;
  if not found
     or v_store.organization_id <> v_warehouse.organization_id
     or v_store.company_id <> v_warehouse.company_id then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no es de la sociedad del almacen'
      using errcode = '22023';
  end if;

  for v_row in
    -- ADR 018: lo publicado en ESTA tienda. El stock de catálogo es del
    -- maestro; `ensure_level` es idempotente por almacén × producto × variante,
    -- así que sembrar desde dos tiendas no duplica el nivel.
    select p.id as product_id, null::uuid as variant_id, p.stock::numeric as qty
    from public.products p
    join public.store_products sp on sp.product_id = p.id and sp.store_id = v_store.id
    where p.kind = 'simple' and p.stock > 0
    union all
    select pv.product_id, pv.id, pv.stock::numeric
    from public.product_variants pv
    join public.store_products sp on sp.product_id = pv.product_id and sp.store_id = v_store.id
    where pv.stock > 0
  loop
    v_level := ebim.ensure_level(p_warehouse_id, v_row.product_id, v_row.variant_id);

    perform ebim.apply_movement(
      v_level, 'count'::public.movement_kind, v_row.qty,
      'existencia inicial migrada del catalogo',
      'import', null,
      'seed:' || p_warehouse_id::text || ':' || coalesce(v_row.variant_id, v_row.product_id)::text,
      ebim.user_id(), 'local'::public.inventory_source);

    v_seeded := v_seeded + 1;
  end loop;

  return jsonb_build_object('warehouse_id', p_warehouse_id, 'store_id', p_store_id, 'seeded', v_seeded);
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_order_create(p_api_client_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client public.api_clients%rowtype;
  v_store  public.stores%rowtype;
  v_items  jsonb := '[]'::jsonb;
  v_item   jsonb;
  v_sku    text;
  v_qty    integer;
  v_pid    uuid;
  v_vid    uuid;
  v_result jsonb;
begin
  v_client := ebim.api_authorize(p_api_client_id, 'order.create');
  v_store  := ebim.api_store(v_client.organization_id, v_client.company_id,
                             p_payload ->> 'store');

  if jsonb_typeof(p_payload -> 'items') <> 'array'
     or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'ITEMS_REQUERIDOS: el pedido necesita al menos una linea'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload -> 'items') > 200 then
    raise exception 'ITEMS_EXCESIVOS: demasiadas lineas en un solo pedido'
      using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_payload -> 'items')
  loop
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

    -- Primero como VARIANTE, despues como producto: el espacio de nombres de
    -- SKU es unico por tienda (trigger `ebim.assert_sku_unique_in_store`), asi
    -- que no hay ambiguedad posible entre los dos.
    v_pid := null;
    v_vid := null;

    select pv.id, pv.product_id into v_vid, v_pid
    -- ADR 018: SKU del maestro, dentro de lo publicado en esta tienda.
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

  v_result := public.create_order(
    v_store.id,
    p_payload #>> '{customer,email}',
    v_items,
    p_payload #>> '{customer,name}',
    p_payload #>> '{customer,phone}',
    coalesce(p_payload -> 'shipping_address', '{}'::jsonb),
    nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
    null,
    -- El ORIGEN lo declara esta funcion, no el socio: por donde entro un pedido
    -- es un hecho del servidor. `api` ya existe en `order_source_channel`.
    'api');

  perform ebim.audit(
    p_organization_id => v_client.organization_id,
    p_company_id      => v_client.company_id,
    p_action          => 'order.created_via_api',
    p_entity_type     => 'order',
    p_entity_id       => ebim.safe_uuid(v_result ->> 'order_id'),
    p_entity_label    => v_result ->> 'order_number',
    p_store_id        => v_store.id,
    p_metadata        => jsonb_build_object('api_client_id', v_client.id,
                                            'client_id', v_client.client_id),
    p_actor_kind      => 'service'::public.audit_actor_kind);

  return public.api_order_get(p_api_client_id, v_result ->> 'order_number', v_store.slug);
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_products_list(p_api_client_id uuid, p_limit integer DEFAULT 50, p_cursor text DEFAULT NULL::text, p_store text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- ADR 018: las publicaciones de la tienda, con su estado, moneda, precio de
    -- catálogo y dirección; sku, nombre y tipo del maestro.
    select p.sku, p.name, sp.status::text as status, sp.currency::text as currency, sp.price,
           p.kind::text as kind, sp.slug
    from public.store_products sp
    join public.products p on p.id = sp.product_id
    where p.organization_id = v_client.organization_id
      and p.company_id      = v_client.company_id
      and sp.store_id       = v_store.id
      and (p_cursor is null or p.sku > p_cursor)
    order by p.sku
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku',       g.sku,
           'name',      g.name,
           'slug',      g.slug,
           'kind',      g.kind,
           'status',    g.status,
           'currency',  g.currency,
           'price',     ebim.api_money(g.price)) order by g.sku), '[]'::jsonb),
         max(g.sku)
    into v_rows, v_next
  from pagina g;

  return jsonb_build_object(
    'data', v_rows,
    'next_cursor', case when jsonb_array_length(v_rows) = v_limit then v_next else null end);
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.api_stock_read(p_api_client_id uuid, p_sku text, p_store text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- ADR 018: SKU del maestro, dentro de lo publicado en la tienda pedida.
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
    'as_of',     to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end;
$function$;

-- ===========================================================================
-- Claves ajenas
--
-- - cart_items: lo que se vende EN una tienda → la publicación de esa tienda.
--   Quitar el producto de la tienda vacía esa línea de los carritos abiertos.
-- - order_items: historia → el MAESTRO, con `set null` como antes. Despublicar
--   no toca un pedido; borrar el maestro (que el servidor ya niega con pedidos)
--   dejaría la instantánea sin referencia, igual que hasta ahora.
-- - inventory_levels: existencia física → el MAESTRO. Un almacén que sirve a
--   dos tiendas guarda UN nivel por producto, no uno por tienda.
-- ===========================================================================
do $guard$
declare
  v_orphans bigint;
begin
  select count(*) into v_orphans
  from public.cart_items ci
  where not exists (
    select 1 from public.store_products sp
    where sp.product_id = ci.product_id and sp.store_id = ci.store_id);
  if v_orphans > 0 then
    raise exception 'PUBLICACION_FALTANTE: % lineas de carrito sin publicacion en su tienda', v_orphans;
  end if;
end;
$guard$;

alter table public.cart_items drop constraint cart_items_product_fk;
alter table public.cart_items
  add constraint cart_items_product_fk foreign key (product_id, store_id)
    references public.store_products (product_id, store_id) on delete cascade;

alter table public.cart_items drop constraint cart_items_variant_fk;
alter table public.cart_items
  add constraint cart_items_variant_fk foreign key (variant_id, product_id)
    references public.product_variants (id, product_id) on delete cascade;

alter table public.order_items drop constraint order_items_product_fk;
alter table public.order_items
  add constraint order_items_product_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete set null (product_id);

alter table public.order_items drop constraint order_items_variant_fk;
alter table public.order_items
  add constraint order_items_variant_fk foreign key (variant_id, organization_id, company_id)
    references public.product_variants (id, organization_id, company_id) on delete set null (variant_id);

alter table public.inventory_levels drop constraint inventory_levels_product_fk;
alter table public.inventory_levels
  add constraint inventory_levels_product_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;

comment on column public.inventory_levels.store_id is
  'ADR 018: ancla informativa (tienda de origen del producto o primera tienda de la sociedad). No filtra disponibilidad: eso lo hacen los almacenes que sirven a cada tienda.';

-- ===========================================================================
-- inventory_alerts: la rama «sin mapear» miraba el estado y la tienda del
-- producto. Ahora: publicado en ALGUNA tienda, y la tienda que se informa es
-- la primera publicación vigente (una fila por producto, como antes).
-- ===========================================================================
create or replace view public.inventory_alerts
with (security_invoker = on) as
select l.organization_id, l.company_id, l.store_id, l.warehouse_id,
       w.code as warehouse_code, w.name as warehouse_name,
       l.product_id, l.variant_id,
       coalesce(pv.sku, p.sku) as sku, coalesce(pv.name, p.name) as name,
       'below_reorder'::text as kind, l.available_qty, l.reorder_point, l.synced_at
from public.inventory_levels l
join public.warehouses w on w.id = l.warehouse_id
join public.products p on p.id = l.product_id
left join public.product_variants pv on pv.id = l.variant_id
where l.reorder_point > 0 and l.available_qty <= l.reorder_point and l.available_qty >= 0
union all
select l.organization_id, l.company_id, l.store_id, l.warehouse_id,
       w.code, w.name, l.product_id, l.variant_id,
       coalesce(pv.sku, p.sku), coalesce(pv.name, p.name),
       'negative'::text, l.available_qty, l.reorder_point, l.synced_at
from public.inventory_levels l
join public.warehouses w on w.id = l.warehouse_id
join public.products p on p.id = l.product_id
left join public.product_variants pv on pv.id = l.variant_id
where l.available_qty < 0
union all
select l.organization_id, l.company_id, l.store_id, l.warehouse_id,
       w.code, w.name, l.product_id, l.variant_id,
       coalesce(pv.sku, p.sku), coalesce(pv.name, p.name),
       'stale'::text, l.available_qty, l.reorder_point, l.synced_at
from public.inventory_levels l
join public.warehouses w on w.id = l.warehouse_id
join public.products p on p.id = l.product_id
left join public.product_variants pv on pv.id = l.variant_id
where w.source = 'erp'::public.inventory_source
  and w.stale_after is not null
  and l.synced_at < now() - w.stale_after
union all
select p.organization_id, p.company_id, pub.store_id,
       null::uuid, null::text, null::text,
       p.id, pv.id,
       coalesce(pv.sku, p.sku), coalesce(pv.name, p.name),
       'unmapped'::text, null::numeric, null::numeric, null::timestamptz
from public.products p
join lateral (
  select sp.store_id
  from public.store_products sp
  where sp.product_id = p.id and sp.status = 'published'
  order by sp.published_at, sp.store_id
  limit 1
) pub on true
left join public.product_variants pv on pv.product_id = p.id and pv.is_active
where p.kind <> 'bundle'::public.product_kind
  and (p.kind <> 'variant'::public.product_kind or pv.id is not null)
  and exists (
    select 1 from public.warehouses w
    where w.organization_id = p.organization_id and w.company_id = p.company_id and w.is_active)
  and not exists (
    select 1 from public.inventory_levels l
    where l.product_id = p.id and l.variant_id is not distinct from pv.id);
