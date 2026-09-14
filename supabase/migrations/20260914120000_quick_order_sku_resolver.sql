-- =============================================================================
-- Cierre · Pedido rápido y pedido masivo por CSV — el traductor SKU → artículo
--
-- ## El problema
--
-- Un comprador que repone no busca «jabón» en la vitrina: tiene una hoja con
-- cuarenta SKU y cantidades. La vitrina, a propósito, no conoce el SKU: las
-- vistas públicas lo omiten (`public_products`, `public_product_variants`,
-- 20260827200300) y `cart_replace_lines` rechaza la clave `sku` con
-- `CAMPO_NO_PERMITIDO` (20260828100100). La única traducción SKU → id que existía
-- era de servidor a servidor, en `api_order_create` (20260828170400).
--
-- ## La respuesta: traducir, no comprar
--
-- `public.resolve_order_lines_for_slug` recibe `[{sku, quantity}]` y devuelve,
-- por fila, o el artículo (producto y variante) o un MOTIVO de rechazo estable.
-- No crea pedidos ni toca carritos: el navegador manda las filas aceptadas al
-- carrito de siempre y es el checkout oficial quien aplica precio, ATP, crédito,
-- orden de compra y aprobación. Esta función no decide ninguna de esas cosas.
--
-- ## Lo que NUNCA devuelve
--
-- Ni precio, ni coste, ni existencia. El precio sale del motor en el carrito y
-- la disponibilidad de `availability_for_slug`, que responde «¿puedo llevar
-- diez?» sin decir cuántos quedan. Devolver aquí un importe sería abrir una
-- segunda puerta al precio que nadie revisa.
--
-- ## Por qué exige sesión
--
-- El SKU no es público por decisión, y una función anónima que dice «este SKU
-- existe y se llama así» es un enumerador del catálogo interno. Con sesión hay
-- una persona detrás y además hay cuenta B2B de la que sacar el surtido. Además,
-- las filas NO ENCONTRADAS gastan el techo de tasa por tienda
-- (`quick_order.sku_probe`, mismo contador que P16): una hoja legítima con dos
-- erratas no lo nota; un bucle que prueba SKU-0001..SKU-9999, sí.
--
-- ## Qué cuenta como «no encontrado»
--
-- Un producto que no está publicado (borrador, archivado o con publicación
-- futura) responde `SKU_NO_ENCONTRADO`, igual que un SKU que no existe o que
-- es de otra tienda. Distinguirlos sería contarle a un comprador qué tiene el
-- comercio en preparación. `NO_DISPONIBLE` queda para lo que el comprador SÍ
-- puede ver en la vitrina y no se puede vender por esta vía: variante retirada,
-- fuera del canal o en otra moneda.
--
-- ## Duplicados
--
-- Un mismo SKU en dos filas se rechaza en TODAS sus apariciones con
-- `SKU_DUPLICADO`. Sumar inventaría una intención («¿eran 5 más 3 u 8 en
-- total?») y quedarse con la primera escondería la segunda; el comprador
-- corrige la hoja y la vuelve a cargar.
-- =============================================================================

create or replace function public.resolve_order_lines_for_slug(
  p_store_slug text,
  p_lines      jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user        uuid := ebim.user_id();
  v_store       public.stores%rowtype;
  v_channel     public.channels%rowtype;
  v_scoped      boolean;
  v_customer    uuid;
  v_assortments boolean;
  v_duplicates  text[];
  v_item        jsonb;
  v_row         integer := 0;
  v_sku         text;
  v_qty_json    jsonb;
  v_qty         integer;
  v_product     public.products%rowtype;
  v_variant     public.product_variants%rowtype;
  v_has_variant boolean;
  v_reason      text;
  v_lines       jsonb := '[]'::jsonb;
  v_accepted    integer := 0;
  v_misses      integer := 0;
begin
  if v_user is null then
    raise exception 'NO_AUTENTICADO: el pedido rapido exige sesion' using errcode = '42501';
  end if;

  v_store   := ebim.active_store_by_slug(p_store_slug);
  -- El MISMO canal del carrito (`cart_open`): lo que aquí se acepta tiene que
  -- ser lo que el carrito acepta después, o el comprador se lo encontraría
  -- rechazado un paso más tarde.
  v_channel := ebim.public_channel(v_store.id);

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'LINEAS_INVALIDAS: se espera una lista de lineas {sku, quantity}'
      using errcode = '22023';
  end if;

  -- El mismo techo de líneas que el carrito de servidor: una hoja más larga no
  -- cabría después en el carrito, y fallar aquí es fallar antes de escribir.
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'LINEAS_EXCESIVAS: como mucho 100 lineas por carga'
      using errcode = '22023';
  end if;

  -- Solo `sku` y `quantity`. Ni tenant, ni cuenta, ni precio, ni usuario, ni
  -- ids: lo que el navegador no puede decidir no se acepta ni para ignorarlo,
  -- porque un campo que se ignora hoy es un campo que alguien lee mañana.
  if exists (
    select 1 from jsonb_array_elements(p_lines) as e(item)
    where jsonb_typeof(e.item) <> 'object'
  ) or exists (
    select 1
    from jsonb_array_elements(p_lines) as e(item),
         jsonb_object_keys(e.item) as k
    where jsonb_typeof(e.item) = 'object'
      and k not in ('sku', 'quantity')
  ) then
    raise exception 'CAMPO_NO_PERMITIDO: cada linea lleva solo sku y quantity'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('lines', '[]'::jsonb, 'accepted', 0, 'rejected', 0);
  end if;

  -- Techo de sondeo. Se pregunta ANTES de mirar el catálogo y se anota al final
  -- solo lo que no se encontró (ver cabecera).
  if ebim.public_rate_exceeded(v_store.id, 'quick_order.sku_probe', 300) then
    raise exception 'LIMITE_DE_TASA: demasiadas referencias no encontradas en esta tienda; intentalo mas tarde'
      using errcode = '22023';
  end if;

  select exists (
    select 1 from public.product_channels pc where pc.channel_id = v_channel.id
  ) into v_scoped;

  -- El cliente de la cuenta B2B EFECTIVA, por la regla única
  -- (`ebim.effective_business_account`, 20260913130000): la misma que fija el
  -- precio y firma el pedido. Sin cuenta —consumidor— no hay surtido que
  -- aplicar, igual que la vitrina no lo aplica para él.
  select a.customer_id into v_customer
  from public.business_accounts a
  where a.id = ebim.effective_business_account(v_user, v_store.organization_id, v_store.company_id);

  -- El surtido solo recorta si la sociedad tiene el módulo contratado. Sin él
  -- se vende como antes de existir, que es la degradación de la fase 08.
  v_assortments := v_customer is not null
    and ebim.company_is_entitled(v_store.organization_id, v_store.company_id, 'trade.assortments');

  select coalesce(array_agg(d.k), '{}'::text[]) into v_duplicates
  from (
    select lower(btrim(e.item ->> 'sku')) as k
    from jsonb_array_elements(p_lines) as e(item)
    where jsonb_typeof(e.item -> 'sku') = 'string'
      and btrim(e.item ->> 'sku') <> ''
    group by 1
    having count(*) > 1
  ) d;

  for v_item in select value from jsonb_array_elements(p_lines)
  loop
    v_row    := v_row + 1;
    v_reason := null;
    v_sku    := case when jsonb_typeof(v_item -> 'sku') = 'string'
                     then nullif(btrim(v_item ->> 'sku'), '') end;
    v_qty    := null;
    v_product := null;
    v_variant := null;
    v_has_variant := false;

    if v_sku is null then
      v_reason := 'SKU_REQUERIDO';
    elsif lower(v_sku) = any (v_duplicates) then
      v_reason := 'SKU_DUPLICADO';
    end if;

    -- Cantidad: entero positivo dentro del tope por línea del carrito de
    -- servidor (10000). Número JSON o texto de dígitos; nada de decimales:
    -- «1,5 cajas» no es una cantidad que el carrito sepa guardar.
    if v_reason is null then
      v_qty_json := v_item -> 'quantity';
      if jsonb_typeof(v_qty_json) = 'number'
         and (v_qty_json #>> '{}') ~ '^[0-9]{1,5}$' then
        v_qty := (v_qty_json #>> '{}')::integer;
      elsif jsonb_typeof(v_qty_json) = 'string'
         and btrim(v_qty_json #>> '{}') ~ '^[0-9]{1,5}$' then
        v_qty := btrim(v_qty_json #>> '{}')::integer;
      end if;
      if v_qty is null or v_qty < 1 or v_qty > 10000 then
        v_reason := 'CANTIDAD_INVALIDA';
      end if;
    end if;

    if v_reason is null then
      -- Primero como VARIANTE y después como producto, como `api_order_create`.
      -- Siempre dentro de ESTA tienda: `store_id` es lo que impide que un SKU de
      -- otra sociedad se resuelva aquí. Sin distinguir mayúsculas, igual que el
      -- índice único `(store_id, lower(sku))`.
      if char_length(v_sku) <= 120 then
        select pv.* into v_variant
        from public.product_variants pv
        where pv.store_id = v_store.id
          and lower(pv.sku) = lower(v_sku)
        limit 1;
        v_has_variant := found;

        if v_has_variant then
          select p.* into v_product
          from public.products p
          where p.id = v_variant.product_id
            and p.store_id = v_store.id;
        else
          select p.* into v_product
          from public.products p
          where p.store_id = v_store.id
            and lower(p.sku) = lower(v_sku)
          limit 1;
        end if;
      end if;

      if v_product.id is null
         or v_product.status <> 'published'
         or v_product.published_at is null
         or v_product.published_at > now() then
        v_reason := 'SKU_NO_ENCONTRADO';
        v_misses := v_misses + 1;
      elsif v_has_variant and not v_variant.is_active then
        v_reason := 'NO_DISPONIBLE';
      elsif v_has_variant and v_product.kind <> 'variant' then
        v_reason := 'NO_DISPONIBLE';
      elsif not v_has_variant and v_product.kind = 'variant' then
        -- El SKU del producto padre no dice qué talla ni qué color: el carrito
        -- lo rechazaría con `VARIANTE_REQUERIDA`, y aquí se dice antes.
        v_reason := 'VARIANTE_REQUERIDA';
      elsif v_scoped and not exists (
        select 1 from public.product_channels pc
        where pc.channel_id = v_channel.id and pc.product_id = v_product.id
      ) then
        v_reason := 'NO_DISPONIBLE';
      elsif v_product.currency <> v_store.currency then
        v_reason := 'NO_DISPONIBLE';
      elsif v_assortments
        and not ebim.product_in_assortment(v_store.id, v_customer, v_product.id, v_channel.id) then
        v_reason := 'FUERA_DE_SURTIDO';
      end if;
    end if;

    if v_reason is null then
      v_accepted := v_accepted + 1;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'row',          v_row,
        'sku',          v_sku,
        'status',       'ok',
        'product_id',   v_product.id,
        'variant_id',   case when v_has_variant then v_variant.id end,
        'slug',         v_product.slug,
        'name',         v_product.name,
        'variant_name', case when v_has_variant then v_variant.name end,
        'quantity',     v_qty));
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'row',    v_row,
        'sku',    v_sku,
        'status', 'rejected',
        'reason', v_reason));
    end if;
  end loop;

  if v_misses > 0 then
    perform ebim.public_rate_record(v_store.id, 'quick_order.sku_probe', v_misses, 300);
  end if;

  return jsonb_build_object(
    'lines',    v_lines,
    'accepted', v_accepted,
    'rejected', v_row - v_accepted);
end;
$fn$;

revoke execute on function public.resolve_order_lines_for_slug(text, jsonb) from public, anon;
grant  execute on function public.resolve_order_lines_for_slug(text, jsonb) to authenticated, service_role;

comment on function public.resolve_order_lines_for_slug(text, jsonb) is
  'Pedido rapido / CSV: traduce [{sku, quantity}] a producto y variante de la tienda del slug, con motivo estable por fila. Exige sesion; surtido de la cuenta B2B efectiva; sin precio, coste ni existencia. No crea pedidos ni toca el carrito.';
