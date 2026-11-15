-- =============================================================================
-- Mapa en la entrega (2026-11-15): tiendas de recojo con su punto y distancia
--
-- Pedido del operador: «¿podrías agregar un mapa? gratuito». Decisiones:
-- OpenStreetMap + Leaflet (sin API key ni costo), y las cuatro piezas:
-- ubicar la dirección con un pin, «usar mi ubicación», tiendas de recojo en el
-- mapa y el punto de entrega en el pedido del backoffice.
--
-- Lo que es de la BASE:
--
--   · `pickup_points.latitude/longitude`: el punto de cada tienda (lo pone el
--     comercio en Logística → Red → Tiendas de recojo). Los dos o ninguno.
--   · `ebim.delivery_options`: si el comprador comparte su punto
--     (`p_address.latitude/longitude`, del GPS o del pin) y la tienda tiene el
--     suyo, cada tienda lleva `distance_km` y se ordena por km (con stock
--     primero, como antes). Sin punto, el orden por distrito de 20261115120000
--     sigue igual. Cada tienda lleva también `location` para pintarla.
--
-- Las coordenadas del PEDIDO no necesitan columna: viajan en
-- `orders.shipping_address` (jsonb) y su puerta es la Edge Function de checkout
-- (`normalizeShippingAddress`), que las valida y redondea.
-- =============================================================================

alter table public.pickup_points
  add column if not exists latitude  numeric(9,6),
  add column if not exists longitude numeric(9,6);

alter table public.pickup_points drop constraint if exists pickup_points_location_ck;
alter table public.pickup_points add constraint pickup_points_location_ck check (
  (latitude is null and longitude is null)
  -- `is not null` explícito: con una sola nula el `between` da NULL y un
  -- CHECK con NULL se da por bueno.
  or (latitude is not null and longitude is not null
      and latitude between -90 and 90 and longitude between -180 and 180)
);

comment on column public.pickup_points.latitude is
  'Punto de la tienda (WGS84). Con él la vitrina la pinta en el mapa y calcula la distancia al comprador.';

-- ---------------------------------------------------------------------------
-- Coordenada de un texto (lo que llega en p_address), o NULL si no lo es.
-- ---------------------------------------------------------------------------
create or replace function ebim.geo_coordinate(p_value text, p_limit numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v numeric;
begin
  if p_value is null or btrim(p_value) !~ '^-?[0-9]{1,3}(\.[0-9]{1,12})?$' then
    return null;
  end if;
  v := btrim(p_value)::numeric;
  if abs(v) > p_limit then return null; end if;
  return v;
end;
$fn$;

-- Distancia en km sobre la esfera (haversine). Para «a 1.2 km» basta.
create or replace function ebim.distance_km(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select (6371 * 2 * asin(sqrt(
           power(sin(radians((p_lat2 - p_lat1)::double precision) / 2), 2)
           + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
             * power(sin(radians((p_lng2 - p_lng1)::double precision) / 2), 2))))::numeric;
$fn$;

-- ---------------------------------------------------------------------------
-- El motor de entrega, con `location` y `distance_km` en cada tienda
-- (idéntico a 20261115120000 salvo la rama `pickup`)
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
  -- El punto del comprador (GPS o pin del mapa), si lo compartió.
  v_lat      numeric := ebim.geo_coordinate(p_address ->> 'latitude', 90);
  v_lng      numeric := ebim.geo_coordinate(p_address ->> 'longitude', 180);
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
      -- Todas las tiendas activas, ordenadas: con stock; luego por km si el
      -- comprador compartió su punto y la tienda tiene el suyo; si no, por
      -- distrito; al final, la posición que fijó la tienda.
      select coalesce(jsonb_agg(x.punto order by x.sin_stock, x.km nulls last, x.cercania, x.position, x.code), '[]'::jsonb)
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
            'stock',           st.s,
            'location',        case when pp.latitude is not null
                                 then jsonb_build_object('lat', pp.latitude, 'lng', pp.longitude) end,
            'distance_km',     km.d) as punto,
          km.d as km,
          (st.s ->> 'state') = 'unavailable' as sin_stock,
          case prox.p when 'district' then 0 when 'city' then 1 when 'region' then 2 else 3 end as cercania,
          pp.position,
          pp.code
        from public.pickup_points pp
        cross join lateral (select ebim.pickup_proximity(pp.address, coalesce(p_address, '{}'::jsonb)) as p) prox
        cross join lateral (select ebim.pickup_point_stock(p_store_id, pp.warehouse_id, p_lines) as s) st
        cross join lateral (select case when v_lat is not null and v_lng is not null and pp.latitude is not null
                                        then round(ebim.distance_km(v_lat, v_lng, pp.latitude, pp.longitude), 1) end as d) km
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


revoke execute on function
  ebim.geo_coordinate(text, numeric),
  ebim.distance_km(numeric, numeric, numeric, numeric)
from public, anon, authenticated;
grant execute on function
  ebim.geo_coordinate(text, numeric),
  ebim.distance_km(numeric, numeric, numeric, numeric)
to service_role;
