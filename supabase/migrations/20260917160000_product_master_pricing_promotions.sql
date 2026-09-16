-- ===========================================================================
-- Stores + Product Master · fase 05 (A) — precios, listas, canales,
-- promociones y cotizaciones sobre la PUBLICACIÓN (ADR 018).
--
-- `products` es el maestro de la sociedad. Lo que dice «este producto se vende
-- en esta tienda y a este precio» vive en `store_products` (precio de catálogo,
-- moneda, categoría, estado) y en `store_price_overrides` (precio propio de
-- variante o presentación POR tienda). Esta migración cambia a esa frontera:
--
--   1 · `product_channels`, `price_list_items` y `promotion_scopes` referencian
--       la publicación `(product_id, store_id)`: no se puede configurar un
--       maestro que no está publicado en esa tienda, y despublicarlo borra solo
--       la configuración de ESA tienda.
--   2 · `ebim.resolve_prices` (única autoridad de precio base) lee la
--       publicación y los precios propios de la tienda. Mismo motor, misma
--       firma, misma precedencia; no hay precio global.
--   3 · `ebim.build_quote`, `ebim.evaluate_promotions`, `public.request_quote`,
--       `public.accept_quote` y `ebim.store_currency_in_use` dejan de leer las
--       columnas legacy (`products.store_id`, `status`, `published_at`,
--       `category_id`, `price`, `compare_at_price`, `currency`).
--
-- Un producto sin publicación en la tienda recibe el MISMO trato y el mismo
-- código de error que antes recibía un producto de otra tienda.
-- Las funciones se reescriben desde su definición vigente (pg_get_functiondef):
-- misma firma, mismo SECURITY y mismo search_path; `create or replace` conserva
-- los GRANT existentes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 · Claves ajenas hacia la publicación
-- ---------------------------------------------------------------------------
-- Antes de mover nada: si alguna fila apunta a un producto sin publicación en
-- su tienda, la migración se detiene. No se inventan publicaciones ni se borra
-- configuración en silencio.
do $$
declare
  v_channels   bigint;
  v_items      bigint;
  v_scopes     bigint;
begin
  select count(*) into v_channels
  from public.product_channels x
  where not exists (select 1 from public.store_products sp
                    where sp.product_id = x.product_id and sp.store_id = x.store_id);

  select count(*) into v_items
  from public.price_list_items x
  where not exists (select 1 from public.store_products sp
                    where sp.product_id = x.product_id and sp.store_id = x.store_id);

  select count(*) into v_scopes
  from public.promotion_scopes x
  where x.product_id is not null
    and not exists (select 1 from public.store_products sp
                    where sp.product_id = x.product_id and sp.store_id = x.store_id);

  if v_channels + v_items + v_scopes > 0 then
    raise exception 'PUBLICACION_FALTANTE: filas sin publicación en su tienda (product_channels=%, price_list_items=%, promotion_scopes=%)',
      v_channels, v_items, v_scopes;
  end if;
end;
$$;

alter table public.product_channels
  drop constraint product_channels_product_fk,
  add constraint product_channels_product_fk foreign key (product_id, store_id)
    references public.store_products (product_id, store_id) on delete cascade;

alter table public.price_list_items
  drop constraint price_list_items_product_fk,
  add constraint price_list_items_product_fk foreign key (product_id, store_id)
    references public.store_products (product_id, store_id) on delete cascade;

-- MATCH SIMPLE: los alcances de categoría, marca o «todo» llevan product_id
-- nulo y la clave no se comprueba.
alter table public.promotion_scopes
  drop constraint promotion_scopes_product_fk,
  add constraint promotion_scopes_product_fk foreign key (product_id, store_id)
    references public.store_products (product_id, store_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2 · ebim.resolve_prices — precio base desde la publicación de la tienda.
--
-- Precio de catálogo = store_products.price; variante = precio propio de ESA
-- tienda o, si no tiene, el de la publicación; tachado con la misma regla de
-- siempre; presentación = precio propio en la tienda o base × factor. Moneda =
-- la de la publicación.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.resolve_prices(p_store_id uuid, p_channel_id uuid, p_lines jsonb, p_currency character DEFAULT NULL::bpchar, p_at timestamp with time zone DEFAULT now(), p_segment_id uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF ebim.price_resolution
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with input as (
    select
      coalesce(nullif(btrim(l.line_key), ''), l.product_id::text) as line_key,
      l.product_id,
      l.variant_id,
      l.uom_id,
      coalesce(l.quantity, 1) as quantity
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as l(line_key text, product_id uuid, variant_id uuid, uom_id uuid, quantity numeric)
    where l.product_id is not null
  ),
  resolved as (
    select
      i.line_key,
      i.product_id,
      i.variant_id,
      i.uom_id,
      i.quantity,
      sp.store_id,
      coalesce(p_currency, sp.currency)  as currency,
      coalesce(pu.factor, 1)             as uom_factor,
      ou.price                           as uom_price,
      -- Herencia de la variante, la misma de P03-SaaS: sin precio propio EN
      -- ESTA TIENDA, el de la publicacion. Escrita aqui una vez para las tres
      -- pantallas.
      coalesce(ov.price, sp.price)       as catalog_base_price,
      case
        when i.variant_id is null then sp.compare_at_price
        when ov.price is null     then sp.compare_at_price
        else ov.compare_at_price
      end                                as catalog_base_compare
    from input i
    -- ADR 018: el producto se vende en la tienda si esta PUBLICADO en ella. La
    -- publicacion trae el precio de catalogo y la moneda; el maestro no tiene
    -- precio.
    join public.store_products sp
      on sp.product_id = i.product_id
     and sp.store_id   = p_store_id
    left join public.product_variants v
      on v.id = i.variant_id
     and v.product_id = sp.product_id
    left join public.store_price_overrides ov
      on ov.store_id   = sp.store_id
     and ov.variant_id = v.id
    left join public.product_uoms pu
      on pu.uom_id = i.uom_id
     and pu.product_id = sp.product_id
    left join public.store_price_overrides ou
      on ou.store_id   = sp.store_id
     and ou.product_id = sp.product_id
     and ou.uom_id     = pu.uom_id
  ),
  best as (
    select distinct on (r.line_key)
      r.line_key,
      l.price_list_id,
      l.price_list_code,
      l.scope::text        as scope,
      it.id                as item_id,
      it.unit_price,
      it.compare_at_price,
      it.min_quantity,
      it.uom_id            as item_uom_id
    from resolved r
    join ebim.active_price_lists l
      on l.store_id = r.store_id
     and l.currency = r.currency
     and l.valid_from <= p_at
     and (l.valid_to is null or l.valid_to > p_at)
     and (
          l.scope = 'store'
       or (l.scope = 'channel'  and l.channel_id  = p_channel_id)
       or (l.scope = 'segment'  and l.segment_id  = p_segment_id)
       or (l.scope = 'customer' and l.customer_id = p_customer_id)
     )
    join public.price_list_items it
      on it.price_list_id = l.price_list_id
     and it.product_id    = r.product_id
     -- Un renglon sin variante vale para todas; con variante, solo para esa.
     and (it.variant_id is null or it.variant_id = r.variant_id)
     -- Un precio absoluto de OTRA presentacion no dice nada de esta.
     and (it.uom_id is null or it.uom_id = r.uom_id)
     -- La escala se mide en unidades base.
     and it.min_quantity <= r.quantity * r.uom_factor
    order by
      r.line_key,
      l.scope_rank desc, l.priority desc, l.valid_from desc, l.price_list_id,
      (it.variant_id is not null) desc, (it.uom_id is not null) desc,
      it.min_quantity desc, it.id
  )
  select
    r.line_key,
    r.product_id,
    r.variant_id,
    r.uom_id,
    r.quantity,
    r.uom_factor,
    r.quantity * r.uom_factor as quantity_base,
    case
      -- Sin lista: el precio de catalogo, tal cual se calculaba antes de P04.
      when b.item_id is null then
        coalesce(r.uom_price, round(r.catalog_base_price * r.uom_factor, 2))
      -- Renglon de la presentacion pedida: precio ABSOLUTO, no se multiplica.
      when b.item_uom_id is not null then b.unit_price
      -- Renglon por unidad base: se convierte con el factor.
      else round(b.unit_price * r.uom_factor, 2)
    end as unit_price,
    case
      when b.item_id is null then
        -- Con precio propio de presentacion no se arrastra el tachado del
        -- catalogo: anunciaria un descuento que nadie declaro.
        case when r.uom_price is not null then null
             else round(r.catalog_base_compare * r.uom_factor, 2) end
      when b.item_uom_id is not null then b.compare_at_price
      else round(b.compare_at_price * r.uom_factor, 2)
    end as compare_at_price,
    case when b.item_id is null then 'catalog' else 'price_list' end as source,
    b.price_list_id,
    b.price_list_code,
    b.item_id as price_list_item_id,
    b.scope,
    b.min_quantity,
    r.currency
  from resolved r
  left join best b on b.line_key = r.line_key;
$function$
;

-- ---------------------------------------------------------------------------
-- 3 · ebim.build_quote — el producto se cotiza si está publicado en la tienda.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.build_quote(p_store_id uuid, p_channel_id uuid, p_items jsonb, p_segment_id uuid, p_customer_id uuid, p_at timestamp with time zone, p_public boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store      public.stores%rowtype;
  v_channel    public.channels%rowtype;
  v_scoped     boolean := false;
  v_inclusive  boolean := false;
  v_item       jsonb;
  v_product    public.products%rowtype;
  v_variant    public.product_variants%rowtype;
  v_has_var    boolean;
  v_uom_code   text;
  v_uom_id     uuid;
  v_qty        numeric;
  v_prepared   jsonb := '[]'::jsonb;
  v_normalized jsonb;
  v_lines      jsonb := '[]'::jsonb;
  v_subtotal   numeric(14,2) := 0;
  v_tax        numeric(14,2) := 0;
  v_index      integer := 0;
  -- El actor comercial de esta cotizacion. Arranca con lo que declaro quien
  -- llama y, en las rutas PUBLICAS, se completa con quien tiene la sesion.
  v_segment    uuid := p_segment_id;
  v_customer   uuid := p_customer_id;
  v_actor      public.customers%rowtype;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUERIDOS: la cotizacion necesita al menos una linea'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'ITEMS_EXCESIVOS: maximo 100 lineas por cotizacion'
      using errcode = '22023';
  end if;

  -- La misma lista negra de `create_order`, y por la misma razon: si el
  -- navegador pudiera declarar precio, canal, segmento o cliente, cotizar seria
  -- una forma de pedirse a uno mismo el precio negociado del vecino.
  if exists (
    select 1
    from jsonb_array_elements(p_items) as item,
         jsonb_object_keys(item) as k
    where k in ('price', 'unit_price', 'line_total', 'subtotal', 'total',
                'currency', 'organization_id', 'company_id', 'store_id',
                'order_id', 'tenant_id', 'tax_rate', 'tax_total',
                'tax_category_id', 'channel_id', 'segment_id', 'customer_id',
                'price_list_id', 'uom_id', 'uom_factor', 'factor',
                'base_quantity', 'sku')
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: el precio, el canal, el segmento y el cliente los decide el servidor'
      using errcode = '22023';
  end if;

  select * into v_store from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda % no existe', p_store_id
      using errcode = '22023';
  end if;

  select * into v_channel from public.channels c where c.id = p_channel_id and c.store_id = v_store.id;
  if not found then
    raise exception 'CANAL_NO_DISPONIBLE: el canal no pertenece a esta tienda'
      using errcode = '22023';
  end if;

  -- ---- Quien esta comprando ----------------------------------------------
  --
  -- Hasta aqui, TODA ruta publica cotizaba con segmento y cliente nulos: la
  -- vitrina resolvia siempre el precio de catalogo, aunque el comprador
  -- tuviera un acuerdo firmado y una sesion abierta. El motor de precios
  -- nunca estuvo mal — nadie le decia a quien le estaba cotizando.
  --
  -- Sale del JWT y NUNCA de un parametro: `ebim.pricing_actor` mira quien
  -- firma la peticion, no quien dice ser. Un comprador no puede pedir el
  -- precio de otra empresa porque no hay donde escribirlo.
  --
  -- Solo en las rutas publicas y solo cuando quien llama NO declaro nada: el
  -- simulador del backoffice (`p_public = false`) sigue mandando, que es para
  -- lo que existe.
  if p_public and v_segment is null and v_customer is null then
    v_actor := ebim.pricing_actor(v_store.organization_id, v_store.company_id);
    if v_actor.id is not null then
      v_segment  := v_actor.segment_id;
      v_customer := v_actor.id;
    end if;
  end if;

  select exists (
    select 1 from public.product_channels pc where pc.channel_id = v_channel.id
  ) into v_scoped;

  select coalesce(ss.tax_inclusive, false) into v_inclusive
  from public.store_settings ss where ss.store_id = v_store.id;
  v_inclusive := coalesce(v_inclusive, false);

  -- Agrupacion por producto + variante + presentacion, igual que el pedido.
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
    select (item ->> 'product_id')                                          as product_id,
           nullif(btrim(coalesce(item ->> 'variant_id', '')), '')           as variant_id,
           nullif(upper(btrim(coalesce(item ->> 'uom_code', ''))), '')      as uom_code,
           sum((item ->> 'quantity')::numeric)                              as quantity
    from jsonb_array_elements(p_items) as item
    group by 1, 2, 3
  ) grouped;

  for v_item in select * from jsonb_array_elements(v_normalized)
  loop
    v_index := v_index + 1;
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) then
      raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser un entero mayor que cero'
        using errcode = '22023';
    end if;

    -- ADR 018: el maestro se cotiza en esta tienda solo si tiene publicacion
    -- en ella; en las rutas publicas, ademas, publicada y vigente.
    select p.* into v_product
    from public.products p
    join public.store_products sp
      on sp.product_id = p.id
     and sp.store_id   = v_store.id
    where p.id = ebim.safe_uuid(v_item ->> 'product_id')
      and (not p_public
           or (sp.status = 'published' and sp.published_at is not null and sp.published_at <= now()));

    if not found then
      raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(v_item ->> 'product_id', 'null')
        using errcode = '22023';
    end if;

    if p_public and v_scoped and not exists (
      select 1 from public.product_channels pc
      where pc.channel_id = v_channel.id and pc.product_id = v_product.id
    ) then
      raise exception 'PRODUCTO_FUERA_DE_CANAL: % no esta a la venta en el canal %',
        v_product.sku, v_channel.code
        using errcode = '22023';
    end if;

    v_has_var := (v_item ->> 'variant_id') is not null;

    if v_product.kind = 'variant' and not v_has_var then
      raise exception 'VARIANTE_REQUERIDA: % se vende por variante y la cotizacion no dice cual', v_product.sku
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
    else
      v_variant := null;
    end if;

    v_uom_code := v_item ->> 'uom_code';
    if v_uom_code is null then
      v_uom_id := null;
    else
      select pu.uom_id into v_uom_id
      from public.product_uoms pu
      join public.units_of_measure u
        on u.id = pu.uom_id
       and u.organization_id = pu.organization_id
       and u.company_id      = pu.company_id
      where pu.product_id = v_product.id
        and upper(u.code) = v_uom_code
        and pu.is_sellable
        and u.is_active;

      if v_uom_id is null then
        raise exception 'UOM_NO_DISPONIBLE: % no se vende en la unidad %', v_product.sku, v_uom_code
          using errcode = '22023';
      end if;
    end if;

    v_prepared := v_prepared || jsonb_build_object(
      'line_key',   v_index::text,
      'product_id', v_product.id,
      'variant_id', case when v_has_var then v_variant.id else null end,
      'uom_id',     v_uom_id,
      'uom_code',   v_uom_code,
      'quantity',   v_qty,
      'name',       case when v_has_var
                         then v_product.name || ' · ' || v_variant.name
                         else v_product.name end,
      'tax_rate',   coalesce(ebim.effective_tax_rate(v_store.id, v_product.tax_category_id, p_at), 0)::text
    );
  end loop;

  -- UNA llamada al motor para TODAS las lineas. Es el punto de la funcion en
  -- lote: cotizar 50 articulos no puede costar 50 resoluciones.
  select coalesce(jsonb_agg(line order by line_index), '[]'::jsonb)
    into v_lines
  from (
    select
      (m.item ->> 'line_key')::integer as line_index,
      jsonb_build_object(
        'product_id',       r.product_id,
        'variant_id',       r.variant_id,
        'name',             m.item ->> 'name',
        'uom_code',         m.item ->> 'uom_code',
        'quantity',         r.quantity,
        'unit_price',       r.unit_price::text,
        'compare_at_price', case when r.compare_at_price is null then null
                                 else r.compare_at_price::text end,
        'net_amount',       round(r.unit_price * r.quantity, 2)::text,
        'tax_rate',         m.item ->> 'tax_rate',
        'source',           r.source,
        'price_list_id',    r.price_list_id,
        'price_list_code',  r.price_list_code,
        'scope',            r.scope,
        'min_quantity',     case when r.min_quantity is null then null
                                 else r.min_quantity::text end
      ) as line
    from jsonb_array_elements(v_prepared) as m(item)
    join ebim.resolve_prices(
           v_store.id, v_channel.id, v_prepared,
           v_store.currency, p_at, v_segment, v_customer
         ) r on r.line_key = m.item ->> 'line_key'
  ) ordered;

  -- Redondeo por grupo de tasa, exactamente como `create_order`: por linea o
  -- sobre el total daria un centimo distinto y la cotizacion dejaria de
  -- coincidir con el pedido.
  if v_inclusive then
    select coalesce(sum(g.gross - round(g.gross - g.gross / (1 + g.rate), 2)), 0),
           coalesce(sum(round(g.gross - g.gross / (1 + g.rate), 2)), 0)
      into v_subtotal, v_tax
    from (
      select (line ->> 'tax_rate')::numeric as rate,
             sum((line ->> 'net_amount')::numeric) as gross
      from jsonb_array_elements(v_lines) as line
      group by 1
    ) g;
  else
    select coalesce(sum(g.net), 0),
           coalesce(sum(round(g.net * g.rate, 2)), 0)
      into v_subtotal, v_tax
    from (
      select (line ->> 'tax_rate')::numeric as rate,
             sum((line ->> 'net_amount')::numeric) as net
      from jsonb_array_elements(v_lines) as line
      group by 1
    ) g;
  end if;

  return jsonb_build_object(
    'currency',      v_store.currency,
    'channel',       v_channel.code,
    'tax_inclusive', v_inclusive,
    'quoted_at',     p_at,
    'lines',         v_lines,
    'subtotal',      v_subtotal::text,
    'tax_total',     v_tax::text,
    'grand_total',   (v_subtotal + v_tax)::text
  );
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 4 · ebim.evaluate_promotions — categoría de la publicación, marca del maestro.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.evaluate_promotions(p_store_id uuid, p_channel_id uuid, p_lines jsonb, p_coupon_codes text[] DEFAULT NULL::text[], p_customer_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid, p_business_account_id uuid DEFAULT NULL::uuid, p_customer_email text DEFAULT NULL::text, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_lock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store     public.stores%rowtype;
  v_at        timestamptz := coalesce(p_at, now());
  v_email     text := lower(btrim(coalesce(p_customer_email, '')));
  v_segment   uuid := p_segment_id;
  v_customer  uuid := p_customer_id;
  v_account   uuid := p_business_account_id;
  v_codes     text[] := '{}';
  v_lines     jsonb := '[]'::jsonb;
  v_gross     numeric(14,2) := 0;
  v_coupons   jsonb := '[]'::jsonb;
  v_applied   jsonb := '[]'::jsonb;
  v_skipped   jsonb := '[]'::jsonb;
  v_promo     record;
  v_coupon    public.coupons%rowtype;
  v_code      text;
  v_used      integer;
  v_matched   integer[];
  v_qty       numeric;
  v_base      numeric(14,2);
  v_target    numeric(14,2);
  v_parts     jsonb;
  v_share     jsonb;
  v_total     numeric(14,2) := 0;
  v_exclusive boolean := false;
  v_any       boolean := false;
  v_groups    text[] := '{}';
  v_coupon_id uuid;
  v_coupon_code text;
  v_sets      numeric;
  v_units     jsonb;
  v_reason    text;
begin
  -- ---- 0 · Contexto -----------------------------------------------------
  select * into v_store from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no existe' using errcode = '22023';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object(
      'entitled', false, 'discount_total', '0.00',
      'lines', '[]'::jsonb, 'applied', '[]'::jsonb,
      'skipped', '[]'::jsonb, 'coupons', '[]'::jsonb);
  end if;

  -- El entitlement se comprueba con `company_is_entitled` y NO con
  -- `has_capability`: esta funcion corre tambien para un comprador anonimo, y
  -- `has_capability` empieza por `can_access`, que para `anon` es siempre
  -- falso. Es exactamente la leccion que P04 dejo escrita en
  -- `ebim.active_price_lists`.
  if not ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'promotions') then
    return jsonb_build_object(
      'entitled', false, 'discount_total', '0.00',
      'lines', '[]'::jsonb, 'applied', '[]'::jsonb,
      'skipped', '[]'::jsonb, 'coupons', '[]'::jsonb);
  end if;

  -- El segmento se deriva de la ficha cuando no se declara, igual que hace
  -- `public.price_quote` desde P05. Un segmento que el llamante no puso no se
  -- inventa: se busca donde esta escrito.
  if v_segment is null and v_customer is not null then
    select c.segment_id into v_segment
    from public.customers c
    where c.id = v_customer
      and c.organization_id = v_store.organization_id
      and c.company_id      = v_store.company_id;
  end if;

  if v_customer is null and v_account is not null then
    select a.customer_id into v_customer
    from public.business_accounts a
    where a.id = v_account
      and a.organization_id = v_store.organization_id
      and a.company_id      = v_store.company_id;
    if v_segment is null and v_customer is not null then
      select c.segment_id into v_segment from public.customers c where c.id = v_customer;
    end if;
  end if;

  -- ---- 1 · Las lineas, con su categoria y su marca ----------------------
  -- Se resuelven AQUI y no las pide el llamante: la categoria y la marca de un
  -- producto son un hecho del catalogo, y aceptarlas como parametro seria abrir
  -- la puerta a que alguien declarase la categoria que le conviene.
  select coalesce(jsonb_agg(jsonb_build_object(
           'line_key',    (l ->> 'line_key')::integer,
           'product_id',  pr.id,
           'variant_id',  nullif(btrim(coalesce(l ->> 'variant_id', '')), '')::uuid,
           'category_id', sp.category_id,
           'brand_id',    pr.brand_id,
           'quantity',    coalesce((l ->> 'quantity')::numeric, 0),
           'unit_price',  coalesce((l ->> 'unit_price')::numeric, 0),
           'amount',      coalesce((l ->> 'amount')::numeric, 0),
           'remaining',   coalesce((l ->> 'amount')::numeric, 0),
           'discount',    0,
           'adjustments', '[]'::jsonb
         ) order by (l ->> 'line_key')::integer), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(p_lines) as l
  -- ADR 018: la categoria es la de la publicacion en ESTA tienda; la marca,
  -- del maestro.
  join public.store_products sp
    on sp.product_id = ebim.safe_uuid(l ->> 'product_id')
   and sp.store_id   = v_store.id
  join public.products pr
    on pr.id = sp.product_id;

  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object(
      'entitled', true, 'discount_total', '0.00',
      'lines', '[]'::jsonb, 'applied', '[]'::jsonb,
      'skipped', '[]'::jsonb, 'coupons', '[]'::jsonb);
  end if;

  select coalesce(sum((l ->> 'amount')::numeric), 0) into v_gross
  from jsonb_array_elements(v_lines) as l;

  -- ---- 2 · Los cupones tecleados ----------------------------------------
  -- Como maximo cinco. No es una limitacion tecnica: mas de cinco codigos en un
  -- carrito es un intento de probar codigos, no una compra.
  select coalesce(array_agg(distinct ebim.normalize_promo_code(c)), '{}')
    into v_codes
  from unnest(coalesce(p_coupon_codes, '{}')) as c
  where char_length(ebim.normalize_promo_code(c)) between 3 and 40;

  if array_length(v_codes, 1) > 5 then
    raise exception 'CUPONES_EXCESIVOS: maximo 5 codigos por pedido'
      using errcode = '22023';
  end if;

  -- ---- 3 · Los cerrojos --------------------------------------------------
  -- Solo se bloquea lo que puede AGOTARSE: una campana sin tope de uso no
  -- necesita cerrojo, y bloquearla serializaria todos los checkouts de la
  -- tienda sin proteger nada. El orden de bloqueo es por `id` ascendente en las
  -- dos tablas —campanas primero, cupones despues— para que dos transacciones
  -- simultaneas no se abracen.
  if p_lock then
    perform 1
    from public.promotions p
    where p.store_id = v_store.id
      and p.status = 'active'
      and (p.usage_limit is not null or p.usage_limit_per_customer is not null)
    order by p.id
    for update;

    if array_length(v_codes, 1) > 0 then
      perform 1
      from public.coupons c
      where c.store_id = v_store.id
        and c.code_normalized = any (v_codes)
      order by c.id
      for update;
    end if;
  end if;

  -- ---- 4 · Resolver cada cupon ------------------------------------------
  -- El orden es el que tecleo el comprador (`v_codes` viene ordenado por el
  -- `array_agg(distinct)`, que es estable): con dos cupones de la MISMA campana
  -- gana el primero y el segundo se marca `duplicado`. Sin esa regla, cual de
  -- los dos gana dependeria del plan de ejecucion.
  foreach v_code in array coalesce(v_codes, '{}')
  loop
    select * into v_coupon
    from public.coupons c
    where c.store_id = v_store.id and c.code_normalized = v_code;

    if not found then
      v_coupons := v_coupons || jsonb_build_array(
        jsonb_build_object('code', v_code, 'status', 'no_existe', 'promotion_id', null));
      continue;
    end if;

    if not v_coupon.is_active then
      v_reason := 'inactivo';
    elsif (v_coupon.valid_from is not null and v_coupon.valid_from > v_at)
       or (v_coupon.valid_to   is not null and v_coupon.valid_to  <= v_at) then
      v_reason := 'fuera_de_vigencia';
    elsif v_coupon.usage_limit is not null and v_coupon.usage_count >= v_coupon.usage_limit then
      v_reason := 'agotado';
    else
      v_reason := null;
      if v_coupon.usage_limit_per_customer is not null then
        if v_email = '' then
          -- Un tope por cliente sin forma de saber quien es el cliente no se
          -- puede cumplir. Se niega, no se ignora.
          v_reason := 'sin_identidad';
        else
          select count(*)::integer into v_used
          from public.promotion_redemptions r
          where r.coupon_id = v_coupon.id
            and (lower(r.customer_email) = v_email
                 or (v_customer is not null and r.customer_id = v_customer));
          if v_used >= v_coupon.usage_limit_per_customer then
            v_reason := 'agotado_para_ti';
          end if;
        end if;
      end if;
    end if;

    if v_reason is null and exists (
      select 1 from jsonb_array_elements(v_coupons) as e
      where (e ->> 'promotion_id')::uuid = v_coupon.promotion_id
        and e ->> 'status' = 'aplicable'
    ) then
      v_reason := 'duplicado';
    end if;

    v_coupons := v_coupons || jsonb_build_array(jsonb_build_object(
      'code', v_coupon.code,
      'normalized', v_code,
      'status', coalesce(v_reason, 'aplicable'),
      'coupon_id', v_coupon.id,
      'promotion_id', v_coupon.promotion_id));
  end loop;

  -- ---- 5 · Las candidatas, en orden TOTAL --------------------------------
  for v_promo in
    select p.*
    from public.promotions p
    where p.store_id = v_store.id
      and p.status = 'active'
      and p.valid_from <= v_at
      and (p.valid_to is null or p.valid_to > v_at)
    order by p.priority desc, p.created_at, p.id
  loop
    v_coupon_id := null;
    v_coupon_code := null;

    -- 5.1 · Cupon. Una campana con cupon NO existe sin el, y su ausencia no se
    -- reporta: enumerar los cupones que hay seria regalar el folleto.
    if v_promo.requires_coupon then
      select (e ->> 'coupon_id')::uuid, e ->> 'code'
        into v_coupon_id, v_coupon_code
      from jsonb_array_elements(v_coupons) as e
      where (e ->> 'promotion_id')::uuid = v_promo.id
        and e ->> 'status' = 'aplicable'
      limit 1;

      if v_coupon_id is null then
        continue;
      end if;
    end if;

    -- 5.2 · Audiencia. Sin filas = todo el mundo.
    if exists (select 1 from public.promotion_audiences a where a.promotion_id = v_promo.id)
       and not exists (
         select 1
         from public.promotion_audiences a
         where a.promotion_id = v_promo.id
           and (a.audience_kind = 'all'
             or (a.audience_kind = 'channel'          and a.channel_id          = p_channel_id)
             or (a.audience_kind = 'segment'          and a.segment_id          = v_segment)
             or (a.audience_kind = 'customer'         and a.customer_id         = v_customer)
             or (a.audience_kind = 'business_account' and a.business_account_id = v_account))
       )
    then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'fuera_de_publico'));
      continue;
    end if;

    -- 5.3 · Minimo de compra. Contra el BRUTO del pedido, antes de descuentos.
    if v_promo.min_subtotal is not null and v_gross < v_promo.min_subtotal then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'minimo_no_alcanzado'));
      continue;
    end if;

    -- 5.4 · Topes de uso. Con `p_lock` estas filas ya estan bloqueadas.
    if v_promo.usage_limit is not null and v_promo.usage_count >= v_promo.usage_limit then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'limite_global_agotado'));
      continue;
    end if;

    if v_promo.usage_limit_per_customer is not null then
      if v_email = '' then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'sin_identidad'));
        continue;
      end if;
      select count(*)::integer into v_used
      from public.promotion_redemptions r
      where r.promotion_id = v_promo.id
        and (lower(r.customer_email) = v_email
             or (v_customer is not null and r.customer_id = v_customer));
      if v_used >= v_promo.usage_limit_per_customer then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'limite_por_cliente_agotado'));
        continue;
      end if;
    end if;

    -- 5.5 · Combinacion.
    if v_exclusive then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'exclusiva_previa'));
      continue;
    end if;
    if v_promo.is_exclusive and v_any then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'no_combina'));
      continue;
    end if;
    if v_promo.stack_group is not null and v_promo.stack_group = any (v_groups) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'grupo_excluyente'));
      continue;
    end if;

    -- 5.6 · Que lineas alcanza. La exclusion gana siempre.
    select coalesce(array_agg(ln.line_key order by ln.line_key), '{}')
      into v_matched
    from (
      select (l ->> 'line_key')::integer as line_key,
             ebim.safe_uuid(l ->> 'product_id')  as product_id,
             ebim.safe_uuid(l ->> 'variant_id')  as variant_id,
             ebim.safe_uuid(l ->> 'category_id') as category_id,
             ebim.safe_uuid(l ->> 'brand_id')    as brand_id
      from jsonb_array_elements(v_lines) as l
    ) ln
    where exists (
        select 1 from public.promotion_scopes s
        where s.promotion_id = v_promo.id and not s.is_exclusion
          and (s.scope_kind = 'all'
            or (s.scope_kind = 'product'  and s.product_id  = ln.product_id)
            or (s.scope_kind = 'variant'  and s.variant_id  = ln.variant_id)
            or (s.scope_kind = 'category' and (
                 -- P18 · Exacta, o toda la rama si el alcance lo pide. La
                 -- casilla esta apagada por defecto: una campana guardada no
                 -- puede ampliarse sola a lo que alguien cuelgue manana.
                 case when s.include_descendants
                   then ln.category_id in (
                     select category_id from ebim.category_subtree(s.category_id))
                   else s.category_id = ln.category_id
                 end))
            or (s.scope_kind = 'brand'    and s.brand_id    = ln.brand_id)))
      and not exists (
        select 1 from public.promotion_scopes s
        where s.promotion_id = v_promo.id and s.is_exclusion
          and (s.scope_kind = 'all'
            or (s.scope_kind = 'product'  and s.product_id  = ln.product_id)
            or (s.scope_kind = 'variant'  and s.variant_id  = ln.variant_id)
            or (s.scope_kind = 'category' and (
                 -- P18 · Exacta, o toda la rama si el alcance lo pide. La
                 -- casilla esta apagada por defecto: una campana guardada no
                 -- puede ampliarse sola a lo que alguien cuelgue manana.
                 case when s.include_descendants
                   then ln.category_id in (
                     select category_id from ebim.category_subtree(s.category_id))
                   else s.category_id = ln.category_id
                 end))
            or (s.scope_kind = 'brand'    and s.brand_id    = ln.brand_id)));

    if coalesce(array_length(v_matched, 1), 0) = 0 then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'sin_alcance'));
      continue;
    end if;

    -- 5.7 · Cantidad minima ALCANZADA.
    if v_promo.min_quantity is not null then
      select coalesce(sum((l ->> 'quantity')::numeric), 0) into v_qty
      from jsonb_array_elements(v_lines) as l
      where (l ->> 'line_key')::integer = any (v_matched);
      if v_qty < v_promo.min_quantity then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'promotion_id', v_promo.id, 'code', v_promo.code,
          'reason', 'cantidad_minima_no_alcanzada'));
        continue;
      end if;
    end if;

    -- 5.8 · Cuanto descuenta, por tipo. Cada rama deja `v_parts` = el reparto
    -- objetivo por linea ({key, weight, cap}) y `v_target` = el importe total.
    v_parts := '[]'::jsonb;
    v_target := 0;

    if v_promo.kind = 'percentage' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', (l ->> 'line_key')::integer,
               'weight', round((l ->> 'remaining')::numeric * v_promo.value_percent / 100, 2),
               'cap', least(round((l ->> 'remaining')::numeric * v_promo.value_percent / 100, 2),
                            (l ->> 'remaining')::numeric))), '[]'::jsonb),
             coalesce(sum(least(round((l ->> 'remaining')::numeric * v_promo.value_percent / 100, 2),
                                (l ->> 'remaining')::numeric)), 0)
        into v_parts, v_target
      from jsonb_array_elements(v_lines) as l
      where (l ->> 'line_key')::integer = any (v_matched);

      if v_promo.max_discount_amount is not null then
        v_target := least(v_target, v_promo.max_discount_amount);
      end if;

    elsif v_promo.kind = 'fixed_amount' then
      -- El importe fijo se reparte entre las lineas alcanzadas en proporcion a
      -- lo que queda de cada una. Con alcance `all` esto es exactamente "un
      -- descuento sobre el pedido", y por eso no hace falta un tipo aparte.
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', (l ->> 'line_key')::integer,
               'weight', (l ->> 'remaining')::numeric,
               'cap', (l ->> 'remaining')::numeric)), '[]'::jsonb),
             coalesce(sum((l ->> 'remaining')::numeric), 0)
        into v_parts, v_target
      from jsonb_array_elements(v_lines) as l
      where (l ->> 'line_key')::integer = any (v_matched);

      v_target := least(v_promo.value_amount, v_target);

    elsif v_promo.kind = 'volume_tier' then
      -- Por linea, la escala MAS ALTA que la cantidad de esa linea alcanza.
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', d.line_key, 'weight', d.amount, 'cap', d.amount)), '[]'::jsonb),
             coalesce(sum(d.amount), 0)
        into v_parts, v_target
      from (
        select (l ->> 'line_key')::integer as line_key,
               least(
                 case when t.discount_percent is not null
                      then round((l ->> 'remaining')::numeric * t.discount_percent / 100, 2)
                      else round((l ->> 'quantity')::numeric * t.discount_amount, 2)
                 end,
                 (l ->> 'remaining')::numeric) as amount
        from jsonb_array_elements(v_lines) as l
        cross join lateral (
          select tt.discount_percent, tt.discount_amount
          from public.promotion_tiers tt
          where tt.promotion_id = v_promo.id
            and tt.min_quantity <= (l ->> 'quantity')::numeric
          order by tt.min_quantity desc
          limit 1
        ) t
        where (l ->> 'line_key')::integer = any (v_matched)
      ) d;

      if v_promo.max_discount_amount is not null then
        v_target := least(v_target, v_promo.max_discount_amount);
      end if;

    elsif v_promo.kind = 'x_for_y' then
      -- Por cada bloque completo de `buy_quantity` unidades EN LA MISMA LINEA,
      -- `free_quantity` salen al precio de esa linea. Por linea y no por
      -- carrito: si se mezclaran lineas de precios distintos habria que elegir
      -- cual sale gratis, y esa eleccion no la puede tomar el motor sin que el
      -- comercio la haya escrito.
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', d.line_key, 'weight', d.amount, 'cap', d.amount)), '[]'::jsonb),
             coalesce(sum(d.amount), 0)
        into v_parts, v_target
      from (
        select (l ->> 'line_key')::integer as line_key,
               least(
                 round(floor((l ->> 'quantity')::numeric / v_promo.buy_quantity)
                       * v_promo.free_quantity * (l ->> 'unit_price')::numeric, 2),
                 (l ->> 'remaining')::numeric) as amount
        from jsonb_array_elements(v_lines) as l
        where (l ->> 'line_key')::integer = any (v_matched)
      ) d;

    elsif v_promo.kind = 'bundle' then
      -- Cuantos conjuntos COMPLETOS hay en el carrito: el minimo, entre todos
      -- los componentes declarados, de (unidades presentes / unidades exigidas).
      select min(floor(coalesce(disp.qty, 0) / s.required_quantity))
        into v_sets
      from public.promotion_scopes s
      left join lateral (
        select sum((l ->> 'quantity')::numeric) as qty
        from jsonb_array_elements(v_lines) as l
        where (l ->> 'line_key')::integer = any (v_matched)
          and ebim.safe_uuid(l ->> 'product_id') = s.product_id
          and (s.variant_id is null
               or ebim.safe_uuid(l ->> 'variant_id') = s.variant_id)
      ) disp on true
      where s.promotion_id = v_promo.id and not s.is_exclusion;

      if coalesce(v_sets, 0) < 1 then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'combo_incompleto'));
        continue;
      end if;

      -- Las unidades que ENTRAN en los conjuntos, tomadas de las lineas en
      -- orden de `line_key` (regla determinista: sin ella, con dos lineas del
      -- mismo producto el reparto dependeria del orden de la consulta).
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', u.line_key,
               'weight', u.in_bundle,
               'cap', u.remaining) order by u.line_key), '[]'::jsonb),
             coalesce(sum(u.in_bundle), 0)
        into v_units, v_base
      from (
        select (l ->> 'line_key')::integer as line_key,
               (l ->> 'remaining')::numeric as remaining,
               round(least(
                 (l ->> 'quantity')::numeric,
                 coalesce(s.required_quantity, 0) * v_sets
               ) * (l ->> 'unit_price')::numeric, 2) as in_bundle
        from jsonb_array_elements(v_lines) as l
        join public.promotion_scopes s
          on s.promotion_id = v_promo.id
         and not s.is_exclusion
         and s.product_id = ebim.safe_uuid(l ->> 'product_id')
         and (s.variant_id is null or s.variant_id = ebim.safe_uuid(l ->> 'variant_id'))
        where (l ->> 'line_key')::integer = any (v_matched)
      ) u;

      v_parts := v_units;
      if v_promo.value_percent is not null then
        v_target := round(v_base * v_promo.value_percent / 100, 2);
      else
        v_target := round(v_promo.value_amount * v_sets, 2);
      end if;
      if v_promo.max_discount_amount is not null then
        v_target := least(v_target, v_promo.max_discount_amount);
      end if;
    end if;

    if v_target is null or v_target <= 0 then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'sin_efecto'));
      continue;
    end if;

    -- 5.9 · El reparto por lineas, sin perder ni ganar un centimo.
    v_share := ebim.distribute_amount(v_target, v_parts);

    select coalesce(sum((e ->> 'amount')::numeric), 0) into v_base
    from jsonb_array_elements(v_share) as e;

    if v_base <= 0 then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'promotion_id', v_promo.id, 'code', v_promo.code, 'reason', 'sin_efecto'));
      continue;
    end if;

    -- 5.10 · Anotar en las lineas. El remanente baja: la siguiente campana no
    -- puede descontar lo que esta ya descontó.
    select coalesce(jsonb_agg(
             case when sh.amount is null or sh.amount = 0 then l
                  else l
                       || jsonb_build_object(
                            'remaining', ((l ->> 'remaining')::numeric - sh.amount),
                            'discount',  ((l ->> 'discount')::numeric  + sh.amount))
                       || jsonb_build_object('adjustments',
                            (l -> 'adjustments') || jsonb_build_array(jsonb_build_object(
                              'promotion_id', v_promo.id,
                              'code',   v_promo.code,
                              'label',  v_promo.name,
                              'kind',   v_promo.kind,
                              'amount', sh.amount::text,
                              'coupon_code', v_coupon_code)))
             end order by (l ->> 'line_key')::integer), '[]'::jsonb)
      into v_lines
    from jsonb_array_elements(v_lines) as l
    left join lateral (
      select (e ->> 'amount')::numeric as amount
      from jsonb_array_elements(v_share) as e
      where (e ->> 'key')::integer = (l ->> 'line_key')::integer
      limit 1
    ) sh on true;

    v_total := v_total + v_base;
    v_any := true;
    if v_promo.is_exclusive then v_exclusive := true; end if;
    if v_promo.stack_group is not null then
      v_groups := v_groups || v_promo.stack_group;
    end if;

    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'promotion_id', v_promo.id,
      'code',      v_promo.code,
      'label',     v_promo.name,
      'kind',      v_promo.kind,
      'priority',  v_promo.priority,
      'exclusive', v_promo.is_exclusive,
      'stack_group', v_promo.stack_group,
      'amount',    v_base::text,
      'coupon_id',   v_coupon_id,
      'coupon_code', v_coupon_code));
  end loop;

  -- ---- 6 · El estado final de cada cupon --------------------------------
  -- `aplicable` era una respuesta provisional: lo que el comprador necesita
  -- saber es si su codigo hizo ALGO. Un cupon valido cuya campana no alcanzo
  -- ninguna linea no es "aplicado".
  select coalesce(jsonb_agg(
           case when e ->> 'status' <> 'aplicable' then e
                when exists (select 1 from jsonb_array_elements(v_applied) as a
                             where (a ->> 'promotion_id')::uuid = (e ->> 'promotion_id')::uuid)
                then e || jsonb_build_object('status', 'aplicado')
                else e || jsonb_build_object('status', 'no_aplicable')
           end), '[]'::jsonb)
    into v_coupons
  from jsonb_array_elements(v_coupons) as e;

  return jsonb_build_object(
    'entitled',       true,
    'discount_total', v_total::text,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'line_key',    (l ->> 'line_key')::integer,
               'discount',    (l ->> 'discount'),
               'adjustments', (l -> 'adjustments'))
             order by (l ->> 'line_key')::integer), '[]'::jsonb)
      from jsonb_array_elements(v_lines) as l),
    'applied', v_applied,
    'skipped', v_skipped,
    'coupons', v_coupons);
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 5 · public.request_quote — solo productos publicados (no archivados) aquí.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_quote(p_store_slug text, p_lines jsonb, p_notes text DEFAULT NULL::text, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user      uuid := ebim.user_id();
  v_store     public.stores%rowtype;
  v_account   public.business_accounts%rowtype;
  v_customer  public.customers%rowtype;
  v_role      public.business_role;
  v_channel   uuid;
  v_existing  public.quotes%rowtype;
  v_quote_id  uuid;
  v_number    text;
  v_line      jsonb;
  v_key       text;
  v_notes     text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_.:-]{8,120}$' then
    raise exception 'IDEMPOTENCIA_INVALIDA: hace falta una clave de solicitud valida'
      using errcode = '22023';
  end if;

  select s.* into v_store
  from public.stores s
  where s.slug = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no existe o no esta activa'
      using errcode = '22023';
  end if;

  select a.* into v_account
  from public.business_accounts a
  where a.id = ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id)
    and a.is_active;
  if not found then
    raise exception 'CUENTA_NO_VINCULADA: tu usuario no compra para ninguna empresa en esta tienda'
      using errcode = '42501';
  end if;

  select u.role into v_role
  from public.business_account_users u
  where u.business_account_id = v_account.id and u.user_id = v_user and u.status = 'active';

  if v_role is null or v_role not in ('admin', 'approver', 'buyer') then
    raise exception 'SIN_PERMISO: tu rol en la cuenta no permite pedir cotizaciones'
      using errcode = '42501';
  end if;

  if not ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'trade.quotes') then
    raise exception 'SIN_MODULO: las cotizaciones no estan activas para esta tienda'
      using errcode = '42501';
  end if;

  -- Repeticion de la misma solicitud.
  select * into v_existing
  from public.quotes q
  where q.organization_id = v_store.organization_id
    and q.company_id      = v_store.company_id
    and q.request_key     = p_request_key;
  if found then
    if v_existing.requested_by is distinct from v_user then
      raise exception 'IDEMPOTENCIA_EN_CONFLICTO: esa clave ya se uso para otra solicitud'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'quote_id',          v_existing.id,
      'quote_number',      v_existing.quote_number,
      'status',            'requested',
      'already_requested', true);
  end if;

  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'CAMPO_INVALIDO: la nota admite como maximo 1000 caracteres'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ITEMS_REQUERIDOS: la solicitud necesita al menos una linea'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'ITEMS_EXCESIVOS: una solicitud admite como maximo 50 lineas'
      using errcode = '22023';
  end if;

  -- Cada linea, validada ANTES de escribir nada.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'CAMPO_INVALIDO: cada linea tiene que ser un objeto' using errcode = '22023';
    end if;

    -- Lista BLANCA: un precio, un descuento o un cliente dentro de una linea no
    -- se ignora en silencio, se rechaza.
    for v_key in select jsonb_object_keys(v_line) loop
      if v_key not in ('product_id', 'variant_id', 'uom_code', 'quantity') then
        raise exception 'CAMPO_NO_PERMITIDO: la linea no admite el campo %', v_key
          using errcode = '22023';
      end if;
    end loop;

    if ebim.safe_uuid(v_line ->> 'product_id') is null
       or not exists (
         -- ADR 018: publicado en ESTA tienda (no archivado).
         select 1 from public.store_products sp
         where sp.product_id = ebim.safe_uuid(v_line ->> 'product_id')
           and sp.store_id = v_store.id
           and sp.status <> 'archived')
    then
      raise exception 'PRODUCTO_NO_DISPONIBLE: una linea nombra un producto que esta tienda no ofrece'
        using errcode = '22023';
    end if;

    if coalesce(v_line ->> 'quantity', '') !~ '^[0-9]{1,5}$'
       or (v_line ->> 'quantity')::integer < 1
       or (v_line ->> 'quantity')::integer > 10000
    then
      raise exception 'CANTIDAD_INVALIDA: la cantidad tiene que ser un entero entre 1 y 10000'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(*) <> count(distinct (l ->> 'product_id', coalesce(l ->> 'variant_id', ''), coalesce(l ->> 'uom_code', '')))
    from jsonb_array_elements(p_lines) l
  ) then
    raise exception 'LINEA_DUPLICADA: el mismo producto aparece dos veces en la solicitud'
      using errcode = '22023';
  end if;

  select * into v_customer from public.customers c where c.id = v_account.customer_id;

  select ch.id into v_channel
  from public.channels ch
  where ch.store_id = v_store.id and ch.is_default and ch.is_active
  limit 1;

  v_number := 'SOL-' || to_char(current_date, 'YYYYMMDD') || '-'
              || upper(left(replace(gen_random_uuid()::text, '-', ''), 6));

  insert into public.quotes (
    organization_id, company_id, store_id, customer_id, business_account_id,
    quote_number, status, currency, issued_at, valid_until, notes,
    request_key, requested_by
  )
  values (
    v_store.organization_id, v_store.company_id, v_store.id, v_customer.id, v_account.id,
    v_number, 'draft', v_store.currency, current_date, current_date + 15, v_notes,
    p_request_key, v_user
  )
  returning id into v_quote_id;

  insert into public.quote_items (
    organization_id, company_id, quote_id, product_id, variant_id, uom_code,
    quantity, unit_price, line_total, position
  )
  select
    v_store.organization_id, v_store.company_id, v_quote_id,
    l.product_id, l.variant_id, l.uom_code, l.quantity,
    coalesce(r.unit_price, 0),
    round(coalesce(r.unit_price, 0) * l.quantity, 2),
    l.position
  from (
    select
      ebim.safe_uuid(e.value ->> 'product_id')        as product_id,
      ebim.safe_uuid(e.value ->> 'variant_id')        as variant_id,
      nullif(btrim(e.value ->> 'uom_code'), '')       as uom_code,
      (e.value ->> 'quantity')::integer               as quantity,
      (e.ordinality - 1)::smallint                    as position,
      e.ordinality::text                              as line_key
    from jsonb_array_elements(p_lines) with ordinality e
  ) l
  left join public.units_of_measure u
    on u.code = l.uom_code
   and u.organization_id = v_store.organization_id
   and u.company_id      = v_store.company_id
  left join lateral ebim.resolve_prices(
    v_store.id, v_channel,
    jsonb_build_array(jsonb_build_object(
      'line_key', l.line_key, 'product_id', l.product_id,
      'variant_id', l.variant_id, 'uom_id', u.id, 'quantity', l.quantity)),
    v_store.currency, now(), v_customer.segment_id, v_customer.id
  ) r on true;

  update public.quotes q
     set subtotal    = t.total,
         grand_total = t.total,
         updated_at  = now()
    from (select coalesce(sum(line_total), 0) as total from public.quote_items where quote_id = v_quote_id) t
   where q.id = v_quote_id;

  perform ebim.publish_event(
    v_store.organization_id, v_store.company_id, v_store.id,
    'quote.requested', 'quote', v_quote_id,
    jsonb_strip_nulls(jsonb_build_object(
      'quote_id',            v_quote_id,
      'quote_number',        v_number,
      'business_account_id', v_account.id,
      'requested_by',        v_user,
      'lines',               jsonb_array_length(p_lines))),
    'quote.requested:' || v_quote_id::text);

  return jsonb_build_object(
    'quote_id',          v_quote_id,
    'quote_number',      v_number,
    'status',            'requested',
    'already_requested', false);
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 6 · public.accept_quote — no convierte en acuerdo un producto despublicado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_quote(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user     uuid := ebim.user_id();
  v_quote    public.quotes%rowtype;
  v_store    public.stores%rowtype;
  v_buyer    record;
  v_list_id  uuid;
  v_lines    jsonb;
  v_bad      text;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: hace falta sesion' using errcode = '42501';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'COTIZACION_NO_ENCONTRADA: no hay una cotizacion tuya con ese identificador'
      using errcode = '22023';
  end if;

  select s.* into v_store from public.stores s where s.id = v_quote.store_id and s.status = 'active';

  select * into v_buyer from ebim.quote_buyer(v_quote, v_user);

  -- Mismo mensaje para «no existe», «es de otro cliente», «es de otra sociedad»
  -- y «la tienda esta apagada»: distinguirlos le diria a quien pregunta que
  -- esa cotizacion existe.
  if v_store.id is null or v_buyer.business_account_id is null then
    raise exception 'COTIZACION_NO_ENCONTRADA: no hay una cotizacion tuya con ese identificador'
      using errcode = '22023';
  end if;

  -- Quien solo mira no compromete dinero.
  if v_buyer.role not in ('admin', 'approver', 'buyer') then
    raise exception 'SIN_PERMISO: tu rol en la cuenta no permite aceptar cotizaciones'
      using errcode = '42501';
  end if;

  if not ebim.company_is_entitled(v_quote.organization_id, v_quote.company_id, 'trade.quotes') then
    raise exception 'SIN_MODULO: las cotizaciones no estan activas para esta tienda'
      using errcode = '42501';
  end if;

  if v_quote.order_id is not null then
    raise exception 'COTIZACION_YA_CONVERTIDA: esta cotizacion ya se convirtio en un pedido'
      using errcode = '22023';
  end if;

  -- La vigencia se mira ANTES que la repeticion: devolver lineas de una
  -- cotizacion vencida mandaria al carrito una promesa de precio que el motor
  -- ya no va a cumplir.
  if v_quote.valid_until < current_date then
    raise exception 'COTIZACION_VENCIDA: la cotizacion vencio el %', v_quote.valid_until
      using errcode = '22023';
  end if;

  if v_quote.status not in ('sent', 'accepted') then
    raise exception 'COTIZACION_NO_ACEPTABLE: una cotizacion en estado % no se puede aceptar', v_quote.status
      using errcode = '22023';
  end if;

  if v_quote.currency <> v_store.currency then
    raise exception 'COTIZACION_MONEDA_INCONSISTENTE: la cotizacion esta en % y la tienda vende en %',
      v_quote.currency, v_store.currency
      using errcode = '22023';
  end if;

  -- Las lineas, tal como iran al carrito.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', i.product_id,
           'variant_id', i.variant_id,
           'uom_code',   i.uom_code,
           'quantity',   i.quantity::integer
         ) order by i.position, i.id), '[]'::jsonb)
    into v_lines
  from public.quote_items i
  where i.quote_id = v_quote.id;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'COTIZACION_NO_ACEPTABLE: la cotizacion no tiene lineas'
      using errcode = '22023';
  end if;

  -- Repeticion: ya convertida en acuerdo. Mismo resultado, ninguna escritura.
  if v_quote.price_list_id is not null then
    return jsonb_build_object(
      'quote_id',         v_quote.id,
      'quote_number',     v_quote.quote_number,
      'status',           'accepted',
      'already_accepted', true,
      'valid_until',      v_quote.valid_until,
      'currency',         v_quote.currency,
      'lines',            v_lines);
  end if;

  -- El pedido lleva unidades enteras. Una cotizacion por 2,5 unidades no puede
  -- honrarse tal cual, y redondear por el comprador seria decidir por el.
  select i.id::text into v_bad
  from public.quote_items i
  where i.quote_id = v_quote.id
    and (i.quantity <> trunc(i.quantity) or i.quantity > 10000)
  limit 1;
  if v_bad is not null then
    raise exception 'COTIZACION_CANTIDAD_NO_ENTERA: la cotizacion tiene cantidades que no se pueden pedir tal cual'
      using errcode = '22023';
  end if;

  -- Una presentacion que el producto ya no tiene no se puede tarifar.
  select i.id::text into v_bad
  from public.quote_items i
  where i.quote_id = v_quote.id
    and i.uom_code is not null
    and not exists (
      select 1
      from public.units_of_measure u
      join public.product_uoms pu on pu.uom_id = u.id and pu.product_id = i.product_id
      where u.code = i.uom_code
        and u.organization_id = v_quote.organization_id
        and u.company_id      = v_quote.company_id
    )
  limit 1;
  if v_bad is not null then
    raise exception 'COTIZACION_UOM_NO_DISPONIBLE: una presentacion cotizada ya no esta disponible'
      using errcode = '22023';
  end if;

  -- ADR 018: el acuerdo se escribe en price_list_items, que exige publicacion
  -- del producto en la tienda. Un producto despublicado despues de cotizar no
  -- se puede tarifar: se niega con codigo estable, no con un 23503.
  select i.id::text into v_bad
  from public.quote_items i
  where i.quote_id = v_quote.id
    and not exists (
      select 1 from public.store_products sp
      where sp.product_id = i.product_id
        and sp.store_id   = v_quote.store_id
    )
  limit 1;
  if v_bad is not null then
    raise exception 'COTIZACION_PRODUCTO_NO_DISPONIBLE: un producto cotizado ya no se ofrece en esta tienda'
      using errcode = '22023';
  end if;

  -- ---- A partir de aqui, solo escrituras ------------------------------------
  insert into public.price_lists (
    organization_id, company_id, store_id, code, name, currency,
    priority, valid_from, valid_to, is_active, notes, source_quote_id
  )
  values (
    v_quote.organization_id, v_quote.company_id, v_quote.store_id,
    'cot-' || left(replace(v_quote.id::text, '-', ''), 24),
    left('Cotizacion ' || v_quote.quote_number, 120),
    v_quote.currency,
    -- La mas alta del rango: dentro del alcance de cliente, lo firmado para
    -- esta cotizacion gana a un acuerdo general del mismo cliente.
    1000,
    now(),
    (v_quote.valid_until + 1)::timestamptz,
    true,
    'Generada al aceptar la cotizacion ' || v_quote.quote_number,
    v_quote.id
  )
  returning id into v_list_id;

  insert into public.price_list_items (
    organization_id, company_id, store_id, price_list_id,
    product_id, variant_id, uom_id, min_quantity, unit_price
  )
  select
    v_quote.organization_id, v_quote.company_id, v_quote.store_id, v_list_id,
    i.product_id, i.variant_id, pu.uom_id,
    -- La escala del motor se mide en unidades BASE.
    i.quantity * coalesce(pu.factor, 1),
    i.unit_price
  from public.quote_items i
  left join public.units_of_measure u
    on u.code = i.uom_code
   and u.organization_id = v_quote.organization_id
   and u.company_id      = v_quote.company_id
  left join public.product_uoms pu
    on pu.uom_id = u.id and pu.product_id = i.product_id
  where i.quote_id = v_quote.id;

  insert into public.price_list_assignments (
    organization_id, company_id, store_id, price_list_id, scope, customer_id, is_active
  )
  values (
    v_quote.organization_id, v_quote.company_id, v_quote.store_id, v_list_id,
    'customer', v_quote.customer_id, true
  );

  update public.quotes
     set status         = 'accepted',
         accepted_at    = now(),
         accepted_by    = v_user,
         accepted_email = ebim.email(),
         price_list_id  = v_list_id,
         updated_at     = now()
   where id = v_quote.id;

  perform ebim.publish_event(
    v_quote.organization_id, v_quote.company_id, v_quote.store_id,
    'quote.accepted', 'quote', v_quote.id,
    jsonb_build_object(
      'quote_id',            v_quote.id,
      'quote_number',        v_quote.quote_number,
      'business_account_id', v_buyer.business_account_id,
      'accepted_by',         v_user,
      'price_list_id',       v_list_id,
      'valid_until',         v_quote.valid_until,
      'grand_total',         v_quote.grand_total::text,
      'currency',            v_quote.currency),
    'quote.accepted:' || v_quote.id::text);

  return jsonb_build_object(
    'quote_id',         v_quote.id,
    'quote_number',     v_quote.quote_number,
    'status',           'accepted',
    'already_accepted', false,
    'valid_until',      v_quote.valid_until,
    'currency',         v_quote.currency,
    'lines',            v_lines);
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 7 · ebim.store_currency_in_use — el catálogo de la tienda son sus publicaciones.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.store_currency_in_use(p_store_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store public.stores%rowtype;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  -- Solo responde a quien administra ESA tienda: para cualquier otro, la
  -- pregunta «¿esta tienda tiene pedidos?» sería un oráculo sobre otro tenant.
  if not found
     or not ebim.has_role(v_store.organization_id, v_store.company_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: administrar tiendas exige rol owner o admin' using errcode = '42501';
  end if;
  return exists (select 1 from public.orders o where o.store_id = p_store_id)
      or exists (select 1 from public.price_lists pl where pl.store_id = p_store_id)
      or exists (select 1 from public.store_products sp where sp.store_id = p_store_id)
      or exists (select 1 from public.carts c where c.store_id = p_store_id);
end;
$function$
;
