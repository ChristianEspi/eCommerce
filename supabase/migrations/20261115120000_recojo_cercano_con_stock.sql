-- =============================================================================
-- Recojo en tienda: las tiendas MÁS CERCANAS primero y con su STOCK (2026-11-15)
--
-- Pedido del operador: «si el usuario quisiera retirar en tienda poniendo su
-- dirección, se le habilita su recojo en tienda o las tiendas cercanas».
-- Decisiones (2026-11-15): cercanía por DISTRITO (sin mapas ni servicios
-- externos), stock por tienda, sin dirección obligatoria para recoger.
--
-- ## Qué cambia en `ebim.delivery_options` (rama `pickup`)
--
--   · Ya no filtra los puntos por la ZONA de la dirección del comprador. La
--     zona es de reparto (departamento / código postal) y escondía tiendas sin
--     decir por qué; ahora se ven todas, ORDENADAS por cercanía.
--   · Cada punto lleva:
--       `district`   su distrito (de `address.district`);
--       `proximity`  `district` | `city` | `region` | `other` respecto de lo
--                    que el comprador escribió (`district`, `city`, `region`);
--       `stock`      `{ state: available | unavailable | unknown, missing[] }`
--                    con el inventario del almacén de ESA tienda. `unknown` =
--                    la tienda no tiene almacén propio (sale del central).
--   · Orden: con stock primero, luego la más cercana, luego la posición que
--     fijó la tienda.
--   · Si TODAS las tiendas están sin stock, la opción sale no disponible con
--     `SIN_STOCK_EN_TIENDAS` (y no «sin puntos», que sería mentir).
--
-- ## Y en `ebim.quote_delivery_choice`
--
-- Elegir una tienda sin stock del carrito se rechaza en el SERVIDOR
-- (`PUNTO_SIN_STOCK`): la pantalla no deja, pero una petición a mano tampoco.
--
-- ## Datos: `line1` → `address`
--
-- Los puntos sembrados por scripts guardaban la calle en `address.line1`; el
-- backoffice y la vitrina usan `address.address`. Se unifica aquí (idempotente).
-- =============================================================================

update public.pickup_points
   set address = (address - 'line1') || jsonb_build_object('address', address ->> 'line1')
 where address ? 'line1' and not address ? 'address';

-- ---------------------------------------------------------------------------
-- 1 · Cercanía por distrito
-- ---------------------------------------------------------------------------
create or replace function ebim.pickup_proximity(p_point jsonb, p_buyer jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  bd text := ebim.search_normalize(coalesce(p_buyer ->> 'district', ''));
  bc text := ebim.search_normalize(coalesce(p_buyer ->> 'city', ''));
  br text := ebim.search_normalize(coalesce(p_buyer ->> 'region', ''));
  pd text := ebim.search_normalize(coalesce(p_point ->> 'district', ''));
  pc text := ebim.search_normalize(coalesce(p_point ->> 'city', ''));
  pr text := ebim.search_normalize(coalesce(p_point ->> 'region', ''));
begin
  -- «Surco» y «Santiago de Surco» son el mismo distrito: se acepta que uno
  -- contenga al otro, con un mínimo para que «La» no case con todo.
  if bd <> '' and pd <> '' and (bd = pd
       or (char_length(bd) >= 4 and position(bd in pd) > 0)
       or (char_length(pd) >= 4 and position(pd in bd) > 0)) then
    return 'district';
  end if;
  -- Punto sin distrito declarado cuya «ciudad» es en realidad el distrito.
  if bd <> '' and pd = '' and pc <> '' and bd = pc then
    return 'district';
  end if;
  if bc <> '' and pc <> '' and bc = pc then
    return 'city';
  end if;
  if br <> '' and pr <> '' and br = pr then
    return 'region';
  end if;
  return 'other';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Stock del carrito en el almacén de una tienda
-- ---------------------------------------------------------------------------
create or replace function ebim.pickup_point_stock(
  p_store_id     uuid,
  p_warehouse_id uuid,
  p_lines        jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_line    jsonb;
  v_part    record;
  v_have    numeric;
  v_missing text[] := '{}';
  v_name    text;
begin
  if p_warehouse_id is null then
    return jsonb_build_object('state', 'unknown', 'missing', '[]'::jsonb);
  end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    for v_part in
      select l.product_id, l.variant_id, l.quantity
      from ebim.expand_stock_lines(
             p_store_id,
             (v_line ->> 'product_id')::uuid,
             ebim.safe_uuid(v_line ->> 'variant_id'),
             coalesce((v_line ->> 'quantity')::numeric, 0)) l
    loop
      select coalesce(sum(greatest(il.available_qty - il.safety_stock, 0)), 0)
        into v_have
      from public.inventory_levels il
      where il.warehouse_id = p_warehouse_id
        and il.product_id   = v_part.product_id
        and il.variant_id is not distinct from v_part.variant_id;

      if v_have < v_part.quantity then
        select p.name into v_name from public.products p where p.id = (v_line ->> 'product_id')::uuid;
        if v_name is not null and not (v_name = any(v_missing)) then
          v_missing := v_missing || v_name;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'state',   case when cardinality(v_missing) = 0 then 'available' else 'unavailable' end,
    'missing', to_jsonb(v_missing));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3 · La autoridad de cotización, con la rama de recojo nueva
--     (idéntica a 20260828150200 salvo el bloque `pickup`)
-- ---------------------------------------------------------------------------
create or replace function ebim.delivery_options(
  p_store_id uuid,
  p_address  jsonb,
  p_lines    jsonb,
  p_subtotal numeric
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_store    public.stores%rowtype;
  v_zone     public.delivery_zones%rowtype;
  v_method   public.delivery_methods%rowtype;
  v_weight   jsonb;
  v_known    boolean;
  v_kg       numeric(14,3);
  v_items    integer;
  v_rate     jsonb;
  v_options  jsonb := '[]'::jsonb;
  v_points   jsonb;
  v_from     date;
  v_to       date;
  v_available boolean;
  v_reason   text;
  v_amount   text;
  v_free     boolean;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: no hay tienda con ese identificador'
      using errcode = '22023';
  end if;

  v_zone   := ebim.delivery_zone_for(
                p_store_id,
                p_address ->> 'country',
                p_address ->> 'region',
                p_address ->> 'postal_code');
  v_weight := ebim.basket_weight(p_store_id, p_lines);
  v_known  := coalesce((v_weight ->> 'known')::boolean, false);
  v_kg     := coalesce((v_weight ->> 'weight')::numeric, 0);

  select coalesce(sum(greatest(coalesce((l ->> 'quantity')::numeric, 0), 0)), 0)::integer
    into v_items
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l;

  for v_method in
    select m.*
    from public.delivery_methods m
    where m.store_id = p_store_id and m.is_active
    order by m.position, m.code
  loop
    v_available := true;
    v_reason    := null;
    v_amount    := '0.00';
    v_free      := false;
    v_points    := '[]'::jsonb;

    v_from := (now() at time zone 'utc')::date + v_method.lead_time_min_days;
    v_to   := (now() at time zone 'utc')::date + v_method.lead_time_max_days;

    if v_method.strategy = 'digital' then
      v_from := (now() at time zone 'utc')::date;
      v_to   := v_from;

    elsif v_method.strategy = 'pickup' then
      -- Todas las tiendas activas, ordenadas: con stock, más cerca, posición.
      select coalesce(jsonb_agg(x.punto order by x.sin_stock, x.cercania, x.position, x.code), '[]'::jsonb)
        into v_points
      from (
        select
          jsonb_build_object(
            'pickup_point_id', pp.id,
            'code',            pp.code,
            'name',            pp.name,
            'address',         pp.address,
            'district',        nullif(btrim(coalesce(pp.address ->> 'district', '')), ''),
            'contact_phone',   pp.contact_phone,
            'opening_hours',   pp.opening_hours,
            'proximity',       prox.p,
            'stock',           st.s) as punto,
          (st.s ->> 'state') = 'unavailable' as sin_stock,
          case prox.p when 'district' then 0 when 'city' then 1 when 'region' then 2 else 3 end as cercania,
          pp.position,
          pp.code
        from public.pickup_points pp
        cross join lateral (select ebim.pickup_proximity(pp.address, coalesce(p_address, '{}'::jsonb)) as p) prox
        cross join lateral (select ebim.pickup_point_stock(p_store_id, pp.warehouse_id, p_lines) as s) st
        where pp.store_id = p_store_id and pp.is_active
      ) x;

      if jsonb_array_length(v_points) = 0 then
        v_available := false;
        v_reason    := 'SIN_PUNTOS_DE_RECOJO';
      elsif not exists (
        select 1 from jsonb_array_elements(v_points) pt where pt -> 'stock' ->> 'state' <> 'unavailable'
      ) then
        v_available := false;
        v_reason    := 'SIN_STOCK_EN_TIENDAS';
      end if;

      v_rate := ebim.delivery_rate_for(
                  v_method.id, v_zone.id, v_store.currency,
                  coalesce(p_subtotal, 0), v_items, v_kg, v_known);
      -- Un recojo sin renglón de tarifa es GRATIS, no «no disponible».
      if v_rate is not null then
        v_amount := v_rate ->> 'amount';
        v_free   := coalesce((v_rate ->> 'free')::boolean, false);
      end if;

    else
      if v_zone.id is null then
        v_available := false;
        v_reason    := 'FUERA_DE_COBERTURA';
      else
        v_rate := ebim.delivery_rate_for(
                    v_method.id, v_zone.id, v_store.currency,
                    coalesce(p_subtotal, 0), v_items, v_kg, v_known);
        if v_rate is null then
          v_available := false;
          v_reason := case when not v_known then 'PESO_NO_DECLARADO' else 'SIN_TARIFA' end;
        else
          v_amount := v_rate ->> 'amount';
          v_free   := coalesce((v_rate ->> 'free')::boolean, false);
        end if;
      end if;
    end if;

    v_options := v_options || jsonb_build_array(jsonb_build_object(
      'delivery_method_id', v_method.id,
      'code',               v_method.code,
      'name',               v_method.display_name,
      'description',        v_method.description,
      'instructions',       v_method.instructions,
      'strategy',           v_method.strategy,
      'available',          v_available,
      'reason',             v_reason,
      'currency',           v_store.currency,
      'amount',             case when v_available then v_amount else null end,
      'free',               v_free,
      'zone_code',          v_zone.code,
      'promised_from',      v_from,
      'promised_to',        v_to,
      'requires_window',    v_method.requires_window,
      'pickup_points',      v_points,
      'windows',
        case
          when v_available and v_method.strategy <> 'digital'
            then ebim.delivery_windows_for(v_method.id, null, v_from)
          else '[]'::jsonb
        end));
  end loop;

  return jsonb_build_object(
    'currency',   v_store.currency,
    'zone',       case when v_zone.id is null then null
                       else jsonb_build_object('code', v_zone.code, 'name', v_zone.name) end,
    'weight',     v_weight,
    'item_count', v_items,
    'options',    v_options);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4 · La opción elegida: una tienda sin stock no se acepta
--     (idéntica a 20260828150200 salvo la comprobación de stock)
-- ---------------------------------------------------------------------------
create or replace function ebim.quote_delivery_choice(
  p_store_id    uuid,
  p_method_code text,
  p_address     jsonb,
  p_lines       jsonb,
  p_subtotal    numeric,
  p_point_id    uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_all    jsonb;
  v_option jsonb;
  v_code   text := lower(btrim(coalesce(p_method_code, '')));
  v_point  public.pickup_points%rowtype;
  v_stock  jsonb;
begin
  if v_code = '' then
    raise exception 'ENTREGA_NO_INDICADA: falta el metodo de entrega'
      using errcode = '22023';
  end if;

  v_all := ebim.delivery_options(p_store_id, p_address, p_lines, p_subtotal);

  select o into v_option
  from jsonb_array_elements(v_all -> 'options') as o
  where o ->> 'code' = v_code
  limit 1;

  if v_option is null then
    raise exception 'ENTREGA_NO_DISPONIBLE: "%" no es un metodo de entrega activo de esta tienda', v_code
      using errcode = '22023';
  end if;

  if not coalesce((v_option ->> 'available')::boolean, false) then
    raise exception 'DIRECCION_NO_ENTREGABLE: %',
      coalesce(v_option ->> 'reason', 'FUERA_DE_COBERTURA')
      using errcode = '22023';
  end if;

  if (v_option ->> 'strategy') = 'pickup' then
    if p_point_id is null then
      raise exception 'PUNTO_DE_RECOJO_REQUERIDO: este metodo exige elegir donde recoger'
        using errcode = '22023';
    end if;
    select * into v_point
    from public.pickup_points pp
    where pp.id = p_point_id and pp.store_id = p_store_id and pp.is_active;
    if not found then
      raise exception 'PUNTO_DE_RECOJO_NO_VALIDO: ese punto no existe o no esta activo'
        using errcode = '22023';
    end if;
    v_stock := ebim.pickup_point_stock(p_store_id, v_point.warehouse_id, p_lines);
    if v_stock ->> 'state' = 'unavailable' then
      raise exception 'PUNTO_SIN_STOCK: la tienda % no tiene stock de todo el pedido', v_point.name
        using errcode = '22023';
    end if;
  elsif p_point_id is not null then
    raise exception 'PUNTO_DE_RECOJO_NO_APLICA: este metodo no es de recojo'
      using errcode = '22023';
  end if;

  return v_option || jsonb_build_object(
    'zone',       v_all -> 'zone',
    'weight',     v_all -> 'weight',
    'item_count', v_all -> 'item_count');
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5 · Permisos: lo interno, solo para el servidor (como el resto del motor)
-- ---------------------------------------------------------------------------
revoke execute on function
  ebim.pickup_proximity(jsonb, jsonb),
  ebim.pickup_point_stock(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  ebim.pickup_proximity(jsonb, jsonb),
  ebim.pickup_point_stock(uuid, uuid, jsonb)
to service_role;

comment on function ebim.pickup_point_stock(uuid, uuid, jsonb) is
  'Stock del carrito en el almacén de una tienda de recojo: available / unavailable (con lo que falta) / unknown (sin almacén propio).';
comment on function ebim.pickup_proximity(jsonb, jsonb) is
  'Cercanía de una tienda al comprador por distrito, ciudad y departamento. Sin mapas: lo que el comprador escribe.';
