-- ---------------------------------------------------------------------------
-- Vitrina · «Ver los productos» de una campaña de productos concretos
--
-- Síntoma (2026-11-20, QAS): la «Liquidación de stock» que propuso la IA y se
-- aprobó en «Acciones de la IA» alcanza productos concretos. Su botón «Ver los
-- productos» solo sabía ir a una categoría o a una marca; si no, caía en
-- `?oferta=1` —todo lo rebajado de la tienda— y enseñaba los -20 % de OTRA
-- campaña con el título de esta.
--
-- Arreglo:
--   · `store_promotions_for_slug` dice si la campaña alcanza productos
--     concretos (`has_products`). Copia fiel de 20261004110000 + ese campo.
--   · `ebim.search_catalog` acepta el filtro `promotion` (uuid) y devuelve
--     solo los productos de esa campaña, si se está anunciando. Copia fiel de
--     20261002120600 + ese filtro. CREATE OR REPLACE conserva los permisos.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ebim.search_catalog(p_store_id uuid, p_query text, p_filters jsonb, p_sort text, p_limit integer, p_offset integer, p_include_unpublished boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_filters   jsonb   := coalesce(p_filters, '{}'::jsonb);
  v_norm      text    := ebim.search_normalize(p_query);
  v_query     tsquery;
  v_limit     integer := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset    integer := greatest(coalesce(p_offset, 0), 0);
  v_sort      text    := coalesce(nullif(btrim(coalesce(p_sort, '')), ''), 'relevance');
  v_category  text    := nullif(btrim(coalesce(v_filters ->> 'category', '')), '');
  -- P18 · La categoria pedida Y SU DESCENDENCIA. Se resuelve una vez, aqui:
  -- dentro del `where` obligaria a recorrer el arbol por fila.
  --
  -- Si el slug no existe, `array_agg` devuelve NULL y `= any (null)` no deja
  -- pasar ninguna fila — que es exactamente lo que hacia el filtro por slug
  -- cuando no encontraba nada.
  v_category_ids uuid[] := case
    when nullif(btrim(coalesce(v_filters ->> 'category', '')), '') is null then null
    else (
      select array_agg(s.category_id)
      from public.categories c
      cross join lateral ebim.category_subtree(c.id) s
      where c.store_id = p_store_id
        and lower(c.slug) = lower(btrim(v_filters ->> 'category'))
    )
  end;
  v_brands    text[];
  v_brand_ids uuid[];
  v_avail     text    := coalesce(nullif(btrim(coalesce(v_filters ->> 'availability', '')), ''), 'all');
  -- P18 · «Solo lo rebajado». Un booleano y no una lista: es un si/no, y el
  -- valor que no sea booleano se ignora en vez de reventar, como el resto de
  -- este bloque — es un filtro, no una orden de cobro.
  v_discount  boolean := coalesce((v_filters ->> 'discounted')::boolean, false);
  -- 2026-11-20 · «Ver los productos» de UNA campaña de productos concretos.
  v_promo_ids uuid[];
  v_price_min numeric;
  v_price_max numeric;
  v_attrs     jsonb   := case when jsonb_typeof(v_filters -> 'attributes') = 'object'
                              then v_filters -> 'attributes' else '{}'::jsonb end;
  v_terms     text[] := ebim.search_terms(p_query);
  v_result    jsonb;
begin
  if v_sort not in ('relevance', 'price-asc', 'price-desc', 'name', 'recent', 'discount') then
    v_sort := 'relevance';
  end if;

  if jsonb_typeof(v_filters -> 'brands') = 'array' then
    select array_agg(lower(btrim(b.value #>> '{}')))
      into v_brands
      from jsonb_array_elements(v_filters -> 'brands') as b(value)
     where jsonb_typeof(b.value) = 'string'
       and btrim(b.value #>> '{}') <> '';
  end if;

  -- Los importes del filtro llegan como TEXTO y se convierten aqui: un numero
  -- de JSON es un double, y un double no es un importe (regla del repositorio
  -- desde P02). Un valor que no sea un numero se ignora en vez de reventar: es
  -- un filtro, no una orden de cobro.
  begin
    v_price_min := nullif(btrim(coalesce(v_filters ->> 'price_min', '')), '')::numeric;
  exception when others then v_price_min := null;
  end;
  begin
    v_price_max := nullif(btrim(coalesce(v_filters ->> 'price_max', '')), '')::numeric;
  exception when others then v_price_max := null;
  end;

  -- 2026-11-20 · Los productos de UNA campaña (`promotion` = uuid). Solo de
  -- una campaña de ESTA tienda que se esté anunciando —activa, vigente y sin
  -- cupón, lo mismo que exige `store_promotions_for_slug`—: el borrador de otra
  -- no se puede listar adivinando su id. Un id que no vale no deja pasar
  -- ninguna fila (`= any('{}')`), igual que una categoría que no existe.
  if nullif(btrim(coalesce(v_filters ->> 'promotion', '')), '') is not null then
    begin
      select coalesce(array_agg(distinct s.product_id), '{}'::uuid[]) into v_promo_ids
        from public.promotions pr
        join public.promotion_scopes s on s.promotion_id = pr.id
       where pr.id = (v_filters ->> 'promotion')::uuid
         and pr.store_id = p_store_id
         and pr.status = 'active'
         and pr.valid_from <= now()
         and (pr.valid_to is null or pr.valid_to > now())
         and not pr.requires_coupon
         and s.scope_kind in ('product', 'variant')
         and not s.is_exclusion
         and s.product_id is not null;
    exception when others then
      v_promo_ids := '{}'::uuid[];
    end;
  end if;

  if v_norm <> '' then
    v_query := ebim.search_tsquery(p_store_id, p_query);
  end if;

  if v_brands is not null then
    select coalesce(array_agg(br.id), '{}'::uuid[]) into v_brand_ids
    from public.brands br where lower(br.code) = any (v_brands);
  end if;

  -- --- El conjunto candidato, ya filtrado por todo lo que NO es texto -------
  with base as materialized (
    select
      p.id           as product_id,
      p.name,
      -- Resumen v2 · el SKU del maestro: el comprador empresa verifica por codigo.
      p.sku,
      sp.slug,
      p.brand_id,
      sp.category_id,
      p.search_vector,
      sp.status,
      sp.published_at,
      pp.price,
      pp.compare_at_price,
      pp.currency,
      pp.in_stock,
      pp.kind,
      pp.brand_name,
      pp.category_slug,
      pp.category_name,
      pp.primary_image_path,
      pp.primary_image_alt,
      pp.price_from,
      pp.description
    from public.products p
    -- ADR 018: el universo de la tienda son sus PUBLICACIONES (con su slug,
    -- categoría y estado); nombre, marca y texto buscable son del maestro.
    join public.store_products sp
      on sp.product_id = p.id and sp.store_id = p_store_id
    -- La vitrina lee de `public_products`, que es la vista que YA sabe que es
    -- publico, con que precio y con que disponibilidad. El backoffice necesita
    -- ademas lo no publicado, y para eso el LEFT JOIN: el borrador aparece sin
    -- precio resuelto, que es la verdad — todavia no tiene precio publico.
    left join public.public_products pp
      on pp.product_id = p.id and pp.store_id = sp.store_id
    where (p_include_unpublished or pp.product_id is not null)
  ),
  filtered as (
    select b.*
    from base b
    -- P18 · Abrir una categoria enseña lo que cuelga de ella. Antes se
    -- comparaba `category_slug` exacto y una madre con toda su carga en las
    -- hijas —«Nutricion», 81 productos— devolvia CERO.
    where (v_category is null or b.category_id = any (v_category_ids))
      and (v_brand_ids is null or b.brand_id = any (v_brand_ids))
      and (v_promo_ids is null or b.product_id = any (v_promo_ids))
      and (v_avail <> 'in-stock' or coalesce(b.in_stock, false))
      -- Rebajado es «hay un antes y es MAYOR»: un `compare_at_price` igual o
      -- menor que el precio no es una oferta, es un dato mal puesto, y
      -- anunciarlo como rebaja seria mentir al comprador.
      and (
        not v_discount
        or (b.compare_at_price is not null and b.compare_at_price > b.price)
      )
      and (v_price_min is null or coalesce(b.price, 0) >= v_price_min)
      and (v_price_max is null or coalesce(b.price, 0) <= v_price_max)
      -- Atributos: AND entre atributos, OR entre los valores de cada uno. Es lo
      -- que espera quien filtra ("rojo o azul", pero "y talla M").
      and (
        v_attrs = '{}'::jsonb
        or not exists (
          select 1
          from jsonb_each(v_attrs) as f(code, values)
          where not exists (
            select 1
            from public.product_attribute_values pav
            join public.attributes a on a.id = pav.attribute_id
            join public.attribute_values av on av.id = pav.value_id
            where pav.product_id = b.product_id
              and lower(a.code) = lower(f.code)
              and jsonb_typeof(f.values) = 'array'
              and lower(av.code) in (
                select lower(v.value #>> '{}')
                from jsonb_array_elements(f.values) as v(value)
                where jsonb_typeof(v.value) = 'string'
              )
          )
        )
      )
  ),
  -- --- Coincidencia por TEXTO, en dos pasadas -------------------------------
  fts as (
    select f.*, ts_rank_cd(f.search_vector, v_query) as text_score
    from filtered f
    where v_query is not null and f.search_vector @@ v_query
  ),
  fts_brand as (
    -- La marca y la categoria no caben en el vector del producto (viven en
    -- otras tablas y una columna generada no puede mirarlas). Entran por aqui,
    -- con puntuacion mas baja que el nombre.
    select f.*, 0.05::real as text_score
    from filtered f
    where v_norm <> ''
      and not exists (select 1 from fts x where x.product_id = f.product_id)
      and (
        ebim.search_normalize(coalesce(f.brand_name, '')) like '%' || v_norm || '%'
        or ebim.search_normalize(coalesce(f.category_name, '')) like '%' || v_norm || '%'
      )
  ),
  exact as (
    select * from fts union all select * from fts_brand
  ),
  fuzzy as (
    -- PLAN B: solo si el texto no encontro nada y la palabra da para
    -- comparar. Con menos de cuatro letras la similitud de trigramas es ruido.
    --
    -- **Todos** los terminos tienen que parecerse, no solo uno. Sin esta
    -- condicion, "bota lampara" devolveria las dos cosas: el plan B habria
    -- convertido el Y de la busqueda exacta en un O silencioso, que es
    -- exactamente el resultado que hace que un buscador deje de ser util.
    select f.*,
           extensions.word_similarity(v_norm, ebim.search_normalize(f.name))::real as text_score
    from filtered f
    where v_norm <> ''
      and char_length(v_norm) >= 4
      and not exists (select 1 from exact)
      and not exists (
        select 1
        from unnest(v_terms) as t(term)
        where extensions.word_similarity(t.term, ebim.search_normalize(f.name)) < 0.4
      )
  ),
  matched as (
    -- `origin` dice de que rama salio cada fila. Es lo que permite responder
    -- "esto se encontro por parecido" sin adivinarlo mirando si hubo
    -- resultados: una respuesta con filas no significa que la coincidencia
    -- fuera exacta.
    select e.*, 'fts'::text as origin from exact e
    union all
    select f.*, 'fuzzy'::text from fuzzy f
    union all
    -- Sin termino de busqueda esto no es una busqueda, es un catalogo: entra
    -- todo lo filtrado con puntuacion neutra.
    select f.*, 0::real as text_score, 'browse'::text from filtered f where v_norm = ''
  ),
  ranked as (
    select m.*,
           -- Lo disponible sube. No es una preferencia estetica: un resultado
           -- agotado es un resultado que no se puede comprar, y ordenarlo por
           -- delante de uno que si convierte la busqueda en una decepcion.
           (m.text_score * 4)::numeric + case when coalesce(m.in_stock, false) then 0.25 else 0 end
             as score
    from matched m
  ),
  counted as (
    -- El orden se calcula UNA vez, como columna. Ordenar en el `page` y volver
    -- a ordenar en el `jsonb_agg` no es redundante: es que manda el segundo, y
    -- el resultado saldria ordenado por relevancia dijera lo que dijera
    -- `p_sort`. Con el numero de orden dentro de la fila, paginar y serializar
    -- usan la MISMA decision.
    select r.*,
           count(*) over ()::int as total,
           row_number() over (
             order by
               case when v_sort = 'relevance'  then score end desc nulls last,
               case when v_sort = 'price-asc'  then price end asc  nulls last,
               case when v_sort = 'price-desc' then price end desc nulls last,
               case when v_sort = 'name'       then name  end asc  nulls last,
               case when v_sort = 'recent'     then published_at end desc nulls last,
               -- Resumen v2 · Mayor descuento primero: el porcentaje, no el
               -- importe, para que una rebaja de 40 % en algo barato no quede
               -- detras de una de 5 % en algo caro. Sin rebaja real, al final.
               case when v_sort = 'discount' then
                 case when compare_at_price > price and compare_at_price > 0
                      then (compare_at_price - price) / compare_at_price end
               end desc nulls last,
               name,
               product_id
           )::int as rank
    from ranked r
  ),
  page as (
    select * from counted
    where rank > v_offset and rank <= v_offset + v_limit
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', pg.product_id,
        'slug',       pg.slug,
        'name',       pg.name,
        'sku',        pg.sku,
        'description', left(coalesce(pg.description, ''), 240),
        'kind',       pg.kind,
        'brand_name', pg.brand_name,
        'category_slug', pg.category_slug,
        'category_name', pg.category_name,
        'price',      pg.price::text,
        'compare_at_price', pg.compare_at_price::text,
        'price_from', pg.price_from::text,
        'currency',   pg.currency,
        'in_stock',   coalesce(pg.in_stock, false),
        'image_path', pg.primary_image_path,
        'image_alt',  pg.primary_image_alt,
        'published',  (pg.published_at is not null and pg.status = 'published'),
        'score',      round(pg.score, 4)::text
      ) order by pg.rank)
      from page pg
    ), '[]'::jsonb),
    'total', coalesce((select max(total) from counted), 0),
    'mode', case
      when v_norm = ''                                             then 'browse'
      when exists (select 1 from counted where origin = 'fts')      then 'fts'
      when exists (select 1 from counted where origin = 'fuzzy')    then 'fuzzy'
      else 'empty'
    end,
    'limit',  v_limit,
    'offset', v_offset,
    'sort',   v_sort,
    'facets', jsonb_build_object(
      'categories', coalesce((
        select jsonb_agg(x order by x->>'name')
        from (
          select jsonb_build_object(
            'slug', c.category_slug, 'name', c.category_name, 'count', count(*)::int
          ) as x
          from counted c
          where c.category_slug is not null
          group by c.category_slug, c.category_name
        ) cats
      ), '[]'::jsonb),
      'brands', coalesce((
        select jsonb_agg(x order by x->>'name')
        from (
          select jsonb_build_object(
            'code', (select br.code from public.brands br where br.id = c.brand_id),
            'name', c.brand_name,
            'count', count(*)::int
          ) as x
          from counted c
          where c.brand_id is not null
          group by c.brand_id, c.brand_name
        ) br
      ), '[]'::jsonb),
      'attributes', coalesce((
        select jsonb_agg(x order by x->>'code')
        from (
          select jsonb_build_object(
            'code', a.code,
            'name', a.name,
            'values', jsonb_agg(
              jsonb_build_object('code', av.code, 'label', av.label, 'count', cnt)
              order by av.position, av.label
            )
          ) as x
          from (
            select pav.attribute_id, pav.value_id, count(*)::int as cnt
            from counted c
            join public.product_attribute_values pav on pav.product_id = c.product_id
            where pav.value_id is not null
            group by pav.attribute_id, pav.value_id
          ) g
          join public.attributes a on a.id = g.attribute_id
          join public.attribute_values av on av.id = g.value_id
          where a.is_filterable and a.is_active
          group by a.code, a.name
        ) attrs
      ), '[]'::jsonb),
      'price', jsonb_build_object(
        'min', (select min(price)::text from counted),
        'max', (select max(price)::text from counted)
      ),
      'availability', jsonb_build_object(
        'in_stock', (select count(*) filter (where coalesce(in_stock, false))::int from counted),
        'total',    (select count(*)::int from counted)
      )
    )
  )
  into v_result;

  -- El MODO ya viene dentro: explica por que salio lo que salio. Sin el, un
  -- resultado por trigramas parece una busqueda que funciono raro; con el, la
  -- vitrina puede decir "quiza quisiste decir" en vez de fingir que era lo que
  -- se pidio.
  return v_result || jsonb_build_object('query', p_query);
end;
$function$
;

create or replace function public.store_promotions_for_slug(
  p_store_slug text,
  p_limit      integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
  v_slug  text := lower(btrim(coalesce(p_store_slug, '')));
  v_at    timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 24);
begin
  if v_slug = '' then
    raise exception 'TIENDA_NO_DISPONIBLE: falta la tienda' using errcode = '22023';
  end if;

  select * into v_store
  from public.stores s
  where lower(s.slug) = v_slug and s.status = 'active';

  if not found then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda "%" no existe o no esta activa', v_slug
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'store_id',    v_store.id,
    'resolved_at', v_at,
    'promotions', coalesce((
      select jsonb_agg(p order by p.priority desc, p.ends_at nulls last, p.name)
      from (
        select
          pr.id,
          pr.name,
          pr.description,
          pr.kind::text                        as kind,
          pr.value_percent                     as percent_off,
          pr.value_amount                      as amount_off,
          pr.buy_quantity,
          pr.free_quantity,
          pr.min_subtotal,
          pr.valid_to                          as ends_at,
          pr.priority,
          pr.image_url,
          -- 2026-10-04 · video de fondo (la imagen queda de respaldo)
          pr.video_url,
          -- A donde lleva el boton. Una promocion de categoria o de marca sabe
          -- ensenar SUS productos; una de «todo el pedido» no tiene a donde
          -- llevar mas que al catalogo, y eso lo decide la vitrina.
          (
            select c.slug
            from public.promotion_scopes s
            join public.categories c on c.id = s.category_id
            where s.promotion_id = pr.id
              and s.scope_kind = 'category'
              and not s.is_exclusion
            order by c.name
            limit 1
          ) as category_slug,
          (
            select b.code
            from public.promotion_scopes s
            join public.brands b on b.id = s.brand_id
            where s.promotion_id = pr.id
              and s.scope_kind = 'brand'
              and not s.is_exclusion
            order by b.name
            limit 1
          ) as brand_code,
          -- 2026-11-20 · ¿Alcanza productos CONCRETOS? Entonces el botón lleva a
          -- esos productos (`search_catalog` con `promotion`), no a «todas las
          -- ofertas», donde se mezclaban las de otras campañas.
          exists (
            select 1
            from public.promotion_scopes s
            where s.promotion_id = pr.id
              and s.scope_kind in ('product', 'variant')
              and not s.is_exclusion
          ) as has_products
        from public.promotions pr
        where pr.store_id = v_store.id
          and pr.status = 'active'
          and pr.valid_from <= v_at
          and (pr.valid_to is null or pr.valid_to > v_at)
          -- Sin cupon: lo que se anuncia en la portada tiene que aplicarse solo.
          and not pr.requires_coupon
        order by pr.priority desc, pr.valid_to nulls last, pr.name
        limit v_limit
      ) as p
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke execute on function public.store_promotions_for_slug(text, integer) from public;
grant execute on function public.store_promotions_for_slug(text, integer) to anon, authenticated;
