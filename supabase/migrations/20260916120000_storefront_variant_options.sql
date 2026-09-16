-- ---------------------------------------------------------------------------
-- Vitrina · los ejes de cada variante (talla, color...) llegan a la ficha.
--
-- Hasta aqui `public_product_variants` decia QUE variantes hay, cuanto valen y
-- si estan disponibles, pero no QUE ES cada una. La ficha solo podia ofrecer un
-- desplegable con el nombre completo repetido seis veces
-- («Botin Alameda de cuero, Verde oliva · 37», «... · 38»...), y un selector por
-- eje —«Talla: 37 38 39»— era imposible: el comprador anonimo no tiene permiso
-- sobre `attributes`, `attribute_values` ni `variant_attribute_values`, y esta
-- migracion NO se lo da.
--
-- En su lugar, la misma receta que `ebim.product_is_available`: una funcion
-- `SECURITY DEFINER` con la autorizacion DENTRO, que solo responde por una
-- variante activa de un producto publicado en tienda activa, y que solo
-- devuelve lo que la ficha va a pintar (codigo, nombre y orden del eje y del
-- valor). Nada de tenant, ni ids de atributo, ni ejes de productos ocultos.
--
-- Por que una columna de la vista y no una RPC aparte: la variante y su
-- combinacion son el MISMO dato. Pedirlos por separado es una segunda consulta
-- por ficha y la posibilidad de pintar una talla que ya no corresponde a la
-- variante recien cacheada.
-- ---------------------------------------------------------------------------

create or replace function ebim.variant_public_options(p_variant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'code',           a.code,
               'name',           a.name,
               'position',       a.position,
               'value_code',     av.code,
               'label',          av.label,
               'value_position', av.position
             )
             order by a.position, a.name
           ),
           '[]'::jsonb
         )
  from public.product_variants v
  join public.products p
    on p.id = v.product_id
   and p.store_id = v.store_id
  join public.stores s
    on s.id = p.store_id
  join public.variant_attribute_values vav
    on vav.variant_id = v.id
  join public.attributes a
    on a.id = vav.attribute_id
  join public.attribute_values av
    on av.id = vav.value_id
  where v.id = p_variant_id
    and v.is_active
    and p.status = 'published'
    and p.published_at is not null
    and p.published_at <= now()
    and s.status = 'active';
$fn$;

revoke execute on function ebim.variant_public_options(uuid) from public;
grant  execute on function ebim.variant_public_options(uuid)
  to anon, authenticated, service_role;

comment on function ebim.variant_public_options(uuid) is
  'Combinacion de ejes de una variante publica (talla, color...). DEFINER con autorizacion dentro: solo responde por variante activa de producto publicado en tienda activa; para cualquier otra devuelve [].';

-- La definicion vigente es la de 20260827200300, sin tocar una coma: la columna
-- nueva va AL FINAL porque `create or replace view` solo admite anadir columnas
-- detras de las que ya existen.
create or replace view public.public_product_variants
with (security_invoker = on) as
select
  v.id            as variant_id,
  v.product_id,
  v.store_id,
  v.name,
  v.position,
  v.is_default,
  ebim.product_is_available(v.product_id, v.id, 1) as in_stock,
  coalesce(up.unit_price, v.price, p.price) as price,
  case
    when up.unit_price is not null then up.compare_at_price
    when v.price is null           then p.compare_at_price
    else v.compare_at_price
  end             as compare_at_price,
  p.currency,
  ebim.variant_public_options(v.id) as options
from public.product_variants v
join public.products p
  on p.id = v.product_id
 and p.store_id = v.store_id
left join ebim.public_unit_prices up
  on up.variant_id = v.id
where v.is_active;

revoke all on public.public_product_variants from public;
grant select on public.public_product_variants to anon, authenticated, service_role;

comment on view public.public_product_variants is
  'Variantes vendibles con precio resuelto, semaforo por ATP y su combinacion de ejes (`options`). Sin SKU ni existencia exacta.';
