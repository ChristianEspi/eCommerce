-- =============================================================================
-- Stores + Product Master · Fase 05 paso C — vitrina, B2B, engagement y
-- analítica sobre la publicación por tienda (ADR 018)
--
-- Cada función parte de su definición VIGENTE (pg_get_functiondef) y cambia solo
-- lo que trataba a `products` como producto de una tienda:
--
-- - buscar, relacionados, pedido rápido, programados, plantillas y sugeridos
--   ofrecen lo PUBLICADO en la tienda (slug, categoría, estado y moneda de la
--   publicación); el SKU es del maestro, dentro de lo publicado;
-- - favoritos son por tienda: `toggle_product_favorite` recibe la tienda (con
--   un respaldo determinista para clientes antiguos) y la unicidad pasa a
--   (usuario, tienda, producto);
-- - reseñas: el alta exige publicación vigente; la historia referencia al
--   maestro y no se pierde al despublicar;
-- - analítica y KPIs cuentan publicaciones de la tienda.
--
-- Mismos códigos de error que antes para un producto «de otra tienda».
-- =============================================================================

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
  v_avail     text    := coalesce(nullif(btrim(coalesce(v_filters ->> 'availability', '')), ''), 'all');
  -- P18 · «Solo lo rebajado». Un booleano y no una lista: es un si/no, y el
  -- valor que no sea booleano se ignora en vez de reventar, como el resto de
  -- este bloque — es un filtro, no una orden de cobro.
  v_discount  boolean := coalesce((v_filters ->> 'discounted')::boolean, false);
  v_price_min numeric;
  v_price_max numeric;
  v_attrs     jsonb   := case when jsonb_typeof(v_filters -> 'attributes') = 'object'
                              then v_filters -> 'attributes' else '{}'::jsonb end;
  v_terms     text[] := ebim.search_terms(p_query);
  v_result    jsonb;
begin
  if v_sort not in ('relevance', 'price-asc', 'price-desc', 'name', 'recent') then
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

  if v_norm <> '' then
    v_query := ebim.search_tsquery(p_store_id, p_query);
  end if;

  -- --- El conjunto candidato, ya filtrado por todo lo que NO es texto -------
  with base as (
    select
      p.id           as product_id,
      p.name,
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
      and (v_brands is null or lower(coalesce((
            select br.code from public.brands br where br.id = b.brand_id
          ), '')) = any (v_brands))
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
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_product_favorites(p_store_id uuid)
 RETURNS TABLE(product_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select f.product_id
  from public.product_favorites f
  join public.store_products sp on sp.product_id = f.product_id and sp.store_id = f.store_id
  where f.user_id = ebim.user_id()
    and f.store_id = p_store_id
    -- Lo despublicado desaparece de la lista sin borrarse: el dia que el
    -- comercio lo vuelva a publicar, sigue guardado.
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now();
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.review_product(p_store_id uuid, p_product_id uuid)
 RETURNS products
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.*
  from public.products p
  join public.store_products sp on sp.product_id = p.id and sp.store_id = p_store_id
  where p.id = p_product_id
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now();
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_relations_for_slug(p_store_slug text, p_product_id uuid, p_kinds text[] DEFAULT NULL::text[], p_limit integer DEFAULT 8)
 RETURNS TABLE(related_product_id uuid, relation_kind text, "position" integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store   public.stores%rowtype;
  v_channel public.channels%rowtype;
  v_scoped  boolean;
  -- Techo duro: la ficha pinta dos o tres filas de cuatro. Veinticuatro da
  -- margen para repartir por tipo sin que una llamada sirva de volcado del
  -- grafo de relaciones de la tienda.
  v_limit   integer := least(greatest(coalesce(p_limit, 8), 1), 24);
begin
  v_store := ebim.active_store_by_slug(p_store_slug);

  -- Los tipos se validan y no se ignoran: un tipo mal escrito que devolviera
  -- «nada» parecería un producto sin relaciones, y el fallo se buscaría en el
  -- backoffice en vez de en la llamada.
  if p_kinds is not null and exists (
    select 1
    from unnest(p_kinds) as k(kind)
    where k.kind is null
       or k.kind not in ('related', 'cross_sell', 'up_sell', 'accessory', 'substitute', 'spare_part')
  ) then
    raise exception 'TIPO_RELACION_INVALIDO: tipo de relacion desconocido'
      using errcode = '22023';
  end if;

  if p_product_id is null then
    return;
  end if;

  -- El canal público, sin lanzar (ver cabecera): mismo criterio que
  -- `ebim.public_channel`, que sí lanza porque lo usa el carrito.
  select * into v_channel
  from public.channels c
  where c.store_id = v_store.id
    and c.is_default
    and c.is_active
    and not c.requires_auth;

  if not found then
    return;
  end if;

  select exists (
    select 1 from public.product_channels pc where pc.channel_id = v_channel.id
  ) into v_scoped;

  -- El producto de ORIGEN también tiene que verse: si no, la función serviría
  -- para preguntar por el grafo de un borrador.
  if not exists (
    select 1
    from public.store_products sp
    where sp.product_id = p_product_id
      and sp.store_id = v_store.id
      and sp.status = 'published'
      and sp.published_at is not null
      and sp.published_at <= now()
      and (not v_scoped or exists (
        select 1 from public.product_channels pc
        where pc.channel_id = v_channel.id and pc.product_id = sp.product_id))
  ) then
    return;
  end if;

  -- ADR 018: la relación es del maestro (su `store_id` es solo ancla de
  -- origen); lo que decide si se muestra es que el RELACIONADO esté publicado
  -- en ESTA tienda.
  return query
  select r.related_product_id,
         r.relation_kind::text,
         r.position
  from public.product_relations r
  join public.store_products sp
    on sp.product_id = r.related_product_id
   and sp.store_id = v_store.id
  where r.product_id = p_product_id
    and (p_kinds is null or r.relation_kind::text = any (p_kinds))
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now()
    and (not v_scoped or exists (
      select 1 from public.product_channels pc
      where pc.channel_id = v_channel.id and pc.product_id = sp.product_id))
  -- El orden es el del comercio (`position`), y el desempate es estable: sin
  -- él, dos relacionados con la misma posición bailarían entre visitas.
  order by r.position asc, r.created_at asc, r.id asc
  limit v_limit;
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_events_for_slug(p_store_slug text, p_session text, p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store    public.stores%rowtype;
  v_channel  public.channels%rowtype;
  v_session  text;
  v_event    jsonb;
  v_type     text;
  v_product  uuid;
  v_variant  uuid;
  v_written  integer := 0;
begin
  v_store   := ebim.active_store_by_slug(p_store_slug);
  v_channel := ebim.public_channel(v_store.id);

  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'ANALYTICS_LOTE_INVALIDO: se espera una lista de hechos'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_events) = 0 then
    return jsonb_build_object('recorded', 0);
  end if;

  if jsonb_array_length(p_events) > 20 then
    raise exception 'ANALYTICS_LOTE_EXCESIVO: como mucho 20 hechos por llamada'
      using errcode = '22023';
  end if;

  -- P16-SaaS. El lote tenia techo; el numero de lotes, no. Se DESCARTA en vez
  -- de lanzar: la vitrina manda estos hechos en segundo plano y un error aqui
  -- se convertiria en un aviso en la consola del comprador por un problema que
  -- no es suyo. La respuesta es la misma forma de siempre, con `recorded: 0`.
  if ebim.public_rate_exceeded(v_store.id, 'analytics.track', 600) then
    return jsonb_build_object('recorded', 0);
  end if;
  perform ebim.public_rate_record(v_store.id, 'analytics.track', 1, 600);

  -- El identificador de visita entra crudo y NO se guarda crudo. Si no tiene la
  -- forma esperada se descarta entero: media sesion mal formada no vale mas que
  -- ninguna, y admitir cualquier texto convierte el campo en un cajon.
  v_session := nullif(btrim(coalesce(p_session, '')), '');
  if v_session is not null and v_session ~ '^[A-Za-z0-9_-]{16,128}$' then
    v_session := ebim.hash_token(v_session);
  else
    v_session := null;
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    v_type := lower(btrim(coalesce(v_event ->> 'type', '')));

    if not (v_type = any (ebim.storefront_event_types())) then
      raise exception 'ANALYTICS_EVENTO_NO_PERMITIDO: la vitrina no puede declarar el hecho %', v_type
        using errcode = '22023';
    end if;

    v_product := ebim.safe_uuid(v_event ->> 'product_id');
    v_variant := ebim.safe_uuid(v_event ->> 'variant_id');

    if v_product is not null
       and not exists (select 1 from public.store_products sp
                        where sp.product_id = v_product and sp.store_id = v_store.id) then
      raise exception 'ANALYTICS_REFERENCIA_INVALIDA: ese producto no es de esta tienda'
        using errcode = '22023';
    end if;

    if v_variant is not null
       and not exists (select 1 from public.product_variants pv
                        join public.store_products sp
                          on sp.product_id = pv.product_id and sp.store_id = v_store.id
                        where pv.id = v_variant) then
      raise exception 'ANALYTICS_REFERENCIA_INVALIDA: esa variante no es de esta tienda'
        using errcode = '22023';
    end if;

    perform ebim.record_analytics_event(
      p_organization_id => v_store.organization_id,
      p_company_id      => v_store.company_id,
      p_store_id        => v_store.id,
      p_event_type      => v_type::public.analytics_event_type,
      p_source          => 'storefront',
      p_channel_id      => v_channel.id,
      p_session_hash    => v_session,
      p_product_id      => v_product,
      p_variant_id      => v_variant,
      p_search_term     => nullif(btrim(coalesce(v_event ->> 'term', '')), ''),
      p_result_count    => ebim.safe_int(v_event ->> 'result_count'),
      p_quantity        => ebim.safe_int(v_event ->> 'quantity'),
      p_props           => case when jsonb_typeof(v_event -> 'props') = 'object'
                                then v_event -> 'props' else '{}'::jsonb end);

    v_written := v_written + 1;
  end loop;

  return jsonb_build_object('recorded', v_written);
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_kpis(p_store_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_products   bigint;
  v_published  bigint;
  v_orders     bigint;
  v_sold       bigint;
  v_sales      numeric(14,2);
  v_currencies text[];
  v_by_status  jsonb;
  v_top        jsonb;
begin
  -- ADR 018: con tienda, sus publicaciones; sin tienda, los maestros de lo que
  -- el llamador ve (publicado = en alguna tienda).
  if p_store_id is null then
    select count(*),
           count(*) filter (where exists (
             select 1 from public.store_products sp
             where sp.product_id = p.id and sp.status = 'published'))
      into v_products, v_published
    from public.products p;
  else
    select count(*),
           count(*) filter (where sp.status = 'published')
      into v_products, v_published
    from public.store_products sp
    where sp.store_id = p_store_id;
  end if;

  -- Las ventas excluyen los pedidos anulados. `array_agg distinct` sobre la
  -- moneda es el guard: si la seleccion mezcla monedas, no hay un total que se
  -- pueda mostrar sin mentir, y la funcion devuelve null en vez de sumar soles
  -- con dolares.
  select count(*),
         count(*) filter (where o.status <> 'cancelled'),
         coalesce(sum(o.grand_total) filter (where o.status <> 'cancelled'), 0),
         coalesce(
           array_agg(distinct o.currency::text) filter (where o.status <> 'cancelled'),
           '{}'::text[]
         )
    into v_orders, v_sold, v_sales, v_currencies
  from public.orders o
  where p_store_id is null or o.store_id = p_store_id;

  -- Reparto por estado, ordenado de mayor a menor. Se devuelve el codigo del
  -- enum, no una etiqueta: quien traduce es la pantalla, que es la que sabe el
  -- idioma del usuario.
  select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'count', s.n)
                            order by s.n desc, s.status), '[]'::jsonb)
    into v_by_status
  from (
    select o.status::text as status, count(*) as n
    from public.orders o
    where p_store_id is null or o.store_id = p_store_id
    group by o.status
  ) s;

  -- Cinco productos por ingreso. Se lee de `order_items`, que guarda el precio
  -- CONGELADO del pedido: si el catalogo sube de precio manana, lo que ya se
  -- vendio no cambia de importe retroactivamente.
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku',     t.sku,
           'name',    t.name,
           'units',   t.units,
           'revenue', t.revenue::text)
           order by t.revenue desc, t.name), '[]'::jsonb)
    into v_top
  from (
    select i.sku,
           max(i.name) as name,
           sum(i.quantity)::bigint as units,
           sum(i.unit_price * i.quantity) as revenue
    from public.order_items i
    join public.orders o on o.id = i.order_id
    where (p_store_id is null or i.store_id = p_store_id)
      and o.status <> 'cancelled'
    group by i.sku
    order by revenue desc, max(i.name)
    limit 5
  ) t;

  return jsonb_build_object(
    'products',  v_products,
    'published', v_published,
    'orders',    v_orders,
    -- Dinero como TEXTO (decision P02 #19): un numeric en JSON se convierte en
    -- float en el primer JSON.parse del navegador.
    'sales',    case when array_length(v_currencies, 1) = 1 then v_sales::text end,
    'currency', case when array_length(v_currencies, 1) = 1 then v_currencies[1] end,
    -- El ticket medio hereda el mismo guard que las ventas: sin moneda unica no
    -- hay promedio que ensenar, y con cero pedidos vendidos no se divide.
    'avg_ticket', case
                    when array_length(v_currencies, 1) = 1 and v_sold > 0
                    then round(v_sales / v_sold, 2)::text
                  end,
    'by_status',    v_by_status,
    'top_products', v_top
  );
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.category_deletion_usage(p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_name text;
begin
  select c.name into v_name from public.categories c where c.id = p_category_id;
  if v_name is null then
    raise exception 'CATEGORIA_NO_ENCONTRADA: La categoria no existe para este tenant';
  end if;

  return jsonb_build_object(
    'name', v_name,
    'products', (
      -- ADR 018: la categoría es de la publicación en su tienda.
      select count(*) from public.store_products sp where sp.category_id = p_category_id
    ),
    'children', (
      select count(*) from public.categories c where c.parent_id = p_category_id
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_order_lines_for_slug(p_store_slug text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- ADR 018: el SKU es del MAESTRO (único por sociedad), y solo se resuelve
      -- dentro de lo PUBLICADO y vigente en esta tienda. Un SKU publicado solo
      -- en otra tienda de la misma sociedad aquí no existe.
      if char_length(v_sku) <= 120 then
        select pv.* into v_variant
        from public.product_variants pv
        join public.store_products sp
          on sp.product_id = pv.product_id
         and sp.store_id = v_store.id
         and sp.status = 'published'
         and sp.published_at is not null
         and sp.published_at <= now()
        where lower(pv.sku) = lower(v_sku)
        limit 1;
        v_has_variant := found;

        if v_has_variant then
          select p.* into v_product
          from public.products p
          where p.id = v_variant.product_id;
        else
          select p.* into v_product
          from public.products p
          join public.store_products sp
            on sp.product_id = p.id
           and sp.store_id = v_store.id
           and sp.status = 'published'
           and sp.published_at is not null
           and sp.published_at <= now()
          where lower(p.sku) = lower(v_sku)
          limit 1;
        end if;
      end if;

      if v_product.id is null then
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
      elsif exists (
        select 1 from public.store_products sp
        where sp.product_id = v_product.id and sp.store_id = v_store.id and sp.currency <> v_store.currency
      ) then
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
        'slug',         (select sp.slug from public.store_products sp
                          where sp.product_id = v_product.id and sp.store_id = v_store.id),
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
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.order_schedule_line_issue(p_store stores, p_customer uuid, p_channel uuid, p_scoped boolean, p_assort boolean, p_item jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_uuid    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_pid     uuid;
  v_vid     uuid;
  v_qty     integer;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
begin
  if jsonb_typeof(p_item) <> 'object'
     or coalesce(p_item ->> 'product_id', '') !~* c_uuid
     or (p_item ? 'variant_id' and jsonb_typeof(p_item -> 'variant_id') <> 'null'
         and coalesce(p_item ->> 'variant_id', '') !~* c_uuid) then
    return 'LINEAS_INVALIDAS';
  end if;
  v_pid := (p_item ->> 'product_id')::uuid;
  v_vid := case when jsonb_typeof(p_item -> 'variant_id') = 'string' then (p_item ->> 'variant_id')::uuid end;

  if jsonb_typeof(p_item -> 'quantity') in ('number', 'string')
     and btrim(p_item ->> 'quantity') ~ '^[0-9]{1,5}$' then
    v_qty := btrim(p_item ->> 'quantity')::integer;
  end if;
  if v_qty is null or v_qty not between 1 and 10000 then
    return 'CANTIDAD_INVALIDA';
  end if;

  -- ADR 018: publicado y vigente en ESTA tienda.
  select p.* into v_product
  from public.products p
  join public.store_products sp
    on sp.product_id = p.id
   and sp.store_id = p_store.id
   and sp.status = 'published'
   and sp.published_at is not null
   and sp.published_at <= now()
  where p.id = v_pid;
  -- No publicado = no existe para el comprador, igual que en la vitrina.
  if v_product.id is null then
    return 'PRODUCTO_NO_DISPONIBLE';
  end if;

  if v_product.kind = 'variant' and v_vid is null then
    return 'VARIANTE_REQUERIDA';
  end if;
  if v_vid is not null then
    select * into v_variant from public.product_variants pv where pv.id = v_vid and pv.product_id = v_pid;
    if v_variant.id is null or not v_variant.is_active or v_product.kind <> 'variant' then
      return 'VARIANTE_NO_DISPONIBLE';
    end if;
  end if;

  if p_scoped and not exists (
    select 1 from public.product_channels pc where pc.channel_id = p_channel and pc.product_id = v_pid
  ) then
    return 'FUERA_DE_CANAL';
  end if;
  if exists (
    select 1 from public.store_products sp
    where sp.product_id = v_pid and sp.store_id = p_store.id and sp.currency <> p_store.currency
  ) then
    return 'OTRA_MONEDA';
  end if;
  if p_assort and not ebim.product_in_assortment(p_store.id, p_customer, v_pid, p_channel) then
    return 'FUERA_DE_SURTIDO';
  end if;

  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.order_template_view(p_template order_templates)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id',         p_template.id,
    'name',       p_template.name,
    'created_at', p_template.created_at,
    'schedule', (
      select jsonb_build_object(
        'id',            s.id,
        'status',        s.status,
        'interval_days', s.interval_days,
        'next_run_on',   s.next_run_on,
        'ends_on',       s.ends_on,
        'last_run_at',   s.last_run_at)
      from public.order_schedules s where s.template_id = p_template.id
    ),
    'pending_run', (
      select jsonb_build_object('id', r.id, 'run_on', r.run_on, 'status', r.status)
      from public.order_schedule_runs r
      where r.template_id = p_template.id and r.status = 'ready'
      order by r.run_on desc
      limit 1
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id',   i.product_id,
               'variant_id',   i.variant_id,
               'slug',         sp.slug,
               'name',         p.name,
               'variant_name', v.name,
               'quantity',     trunc(i.quantity)::int,
               -- ADR 018: disponible = publicado y vigente en la tienda de la
               -- plantilla. Si se despublicó, la línea sigue (es historia) y se
               -- marca no disponible.
               'available',    coalesce(sp.status = 'published', false)
                               and sp.published_at is not null
                               and sp.published_at <= now()
                               and (i.variant_id is null or coalesce(v.is_active, false)))
             order by i.position, p.name)
      from public.order_template_items i
      join public.products p on p.id = i.product_id
      left join public.store_products sp on sp.product_id = i.product_id and sp.store_id = p_template.store_id
      left join public.product_variants v on v.id = i.variant_id
      where i.template_id = p_template.id
    ), '[]'::jsonb)
  );
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ebim.suggest_order_v2(p_store uuid, p_customer uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(product_id uuid, variant_id uuid, suggested_quantity numeric, last_period_quantity numeric, on_hand_quantity numeric, reason text, inputs jsonb, model_code text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_recent     int;
  v_long       int;
  v_channel    uuid;
  v_scoped     boolean;
  v_assortment uuid;
begin
  if p_days is null or p_days < 7 or p_days > 180 then
    raise exception 'CAMPO_INVALIDO: la ventana debe estar entre 7 y 180 dias'
      using errcode = '22023';
  end if;

  v_recent := p_days;
  v_long   := greatest(p_days * 3, 90);

  -- El canal por el que compro por ultima vez: es el que decide la precedencia
  -- por canal del surtido y el catalogo declarado en `product_channels`.
  select o.channel_id into v_channel
  from public.orders o
  join public.business_accounts ba on ba.id = o.business_account_id
  where o.store_id = p_store
    and ba.customer_id = p_customer
    and o.status <> 'cancelled'
  order by o.created_at desc
  limit 1;

  v_scoped := v_channel is not null and exists (
    select 1 from public.product_channels pc where pc.channel_id = v_channel);
  v_assortment := ebim.assortment_for_customer(p_store, p_customer, v_channel);

  return query
  with hist as (
    -- El mismo universo que v1: pedidos no cancelados de las cuentas B2B de
    -- este cliente en esta tienda. Sin limite inferior de fecha: la regla de
    -- temporada necesita saber cuando fue la PRIMERA compra.
    select i.product_id as pid,
           i.variant_id as vid,
           o.id         as oid,
           o.created_at as at,
           i.quantity::numeric as qty
    from public.orders o
    join public.order_items i on i.order_id = o.id
    join public.business_accounts ba on ba.id = o.business_account_id
    where o.store_id = p_store
      and ba.customer_id = p_customer
      and o.status <> 'cancelled'
      and i.product_id is not null
  ),
  agg as (
    select h.pid, h.vid,
      coalesce(sum(h.qty) filter (where h.at >= now() - make_interval(days => v_recent)), 0) as q_recent,
      coalesce(sum(h.qty) filter (where h.at >= now() - make_interval(days => v_long)), 0)   as q_long,
      coalesce(sum(h.qty) filter (where h.at >= now() - interval '365 days'), 0)            as q_year,
      coalesce(sum(h.qty) filter (
        where h.at >= now() - interval '365 days'
          and h.at <  now() - interval '365 days' + make_interval(days => v_recent)), 0)    as q_season,
      count(distinct h.oid) filter (where h.at >= now() - interval '365 days')              as orders_year,
      min(h.at) as first_at
    from hist h
    group by h.pid, h.vid
  ),
  ritmo as (
    select a.*,
      a.q_recent / v_recent as r_recent,
      a.q_long / v_long     as r_long,
      a.q_long > a.q_recent as blended,
      case when a.q_long > a.q_recent
           then 0.6 * (a.q_recent / v_recent) + 0.4 * (a.q_long / v_long)
           else a.q_recent / v_recent
      end as r_base,
      (a.first_at <= now() - interval '365 days' and a.orders_year >= 3 and a.q_year > 0) as seasonal_ok
    from agg a
    where a.q_long > 0
  ),
  temporada as (
    select r.*,
      case when r.seasonal_ok
           then least(2.0, greatest(0.5, (r.q_season / v_recent) / (r.q_year / 365.0)))
           else 1.0
      end as factor
    from ritmo r
  ),
  autorizados as (
    select t.*
    from temporada t
    join public.store_products sp
      on sp.product_id = t.pid and sp.store_id = p_store and sp.status = 'published'
    left join public.product_variants pv on pv.id = t.vid
    where (t.vid is null or coalesce(pv.is_active, false))
      and ebim.product_in_assortment(p_store, p_customer, t.pid, v_channel)
      and (not v_scoped or exists (
        select 1 from public.product_channels pc
        where pc.channel_id = v_channel and pc.product_id = t.pid))
  ),
  demanda as (
    select au.*,
      round(au.r_base * v_recent * au.factor)::numeric as demand,
      ebim.suggest_order_atp(p_store, au.pid, au.vid) as atp
    from autorizados au
  ),
  con_atp as (
    select d.*,
      case
        when d.atp is null or coalesce((d.atp ->> 'unknown')::boolean, true) then 'unknown'
        when coalesce((d.atp ->> 'backorder')::boolean, false) then 'backorder'
        else 'known'
      end as atp_state,
      greatest(floor(coalesce((d.atp ->> 'available')::numeric, 0)), 0) as available
    from demanda d
    where d.demand >= 1
  ),
  final as (
    select c.*,
      case when c.atp_state = 'known' then least(c.demand, c.available) else c.demand end as qty,
      (c.atp_state = 'known' and c.available < c.demand) as capped,
      (c.atp_state = 'known' and c.available < 1) as shortage
    from con_atp c
  )
  select f.pid,
         f.vid,
         f.qty,
         f.q_recent,
         case when f.atp_state = 'unknown' then null else f.available end,
         left(
           case when f.blended
                then format('Compró %s en los últimos %s días y %s en los últimos %s (ritmo reciente %s/día frente a %s/día)',
                            f.q_recent, v_recent, f.q_long, v_long,
                            round(f.r_recent, 2), round(f.r_long, 2))
                else format('Compró %s en los últimos %s días', f.q_recent, v_recent)
           end
           || case when f.seasonal_ok
                   then format('. Temporada: hace un año, en estas fechas, compró al %s× de su promedio', round(f.factor, 2))
                   else ''
              end
           || format('. Demanda estimada: %s', f.demand)
           || case
                when f.shortage then '. Sin disponibilidad ahora: no se propone cantidad'
                when f.capped then format('. Limitado a %s disponibles', f.available)
                when f.atp_state = 'unknown' then '. Disponibilidad sin confirmar'
                when f.atp_state = 'backorder' then '. Se admite pedido sin existencia'
                else ''
              end,
           400),
         jsonb_build_object(
           'model', 'history_seasonal_v2',
           'fallback', false,
           'windows', jsonb_build_object('recent_days', v_recent, 'long_days', v_long),
           'quantities', jsonb_build_object(
             'recent', f.q_recent, 'long', f.q_long,
             'last_365_days', f.q_year, 'same_window_last_year', f.q_season),
           'rates', jsonb_build_object(
             'recent', round(f.r_recent, 4), 'long', round(f.r_long, 4), 'base', round(f.r_base, 4)),
           'blend', case when f.blended
                         then jsonb_build_object('recent', 0.6, 'long', 0.4)
                         else jsonb_build_object('recent', 1, 'long', 0) end,
           'seasonal', jsonb_build_object(
             'applied', f.seasonal_ok,
             'factor', round(f.factor, 4),
             'reason', case
               when f.seasonal_ok then 'historial_anual'
               when f.first_at > now() - interval '365 days' then 'menos_de_un_anio'
               when f.orders_year < 3 then 'pocos_pedidos'
               else 'sin_ventas_en_el_anio'
             end),
           'demand', f.demand,
           'atp', jsonb_build_object(
             'state', f.atp_state,
             'available', case when f.atp_state = 'unknown' then null else f.available end,
             'source', f.atp ->> 'source'),
           'capped', f.capped,
           'shortage', f.shortage,
           'channel_id', v_channel,
           'assortment_id', v_assortment),
         'history_seasonal_v2'::text
  from final f
  order by f.demand desc, f.pid;

  if found then
    return;
  end if;

  -- ---- Fallback: v1, con las mismas reglas de autorizacion -----------------
  return query
  select s.product_id,
         s.variant_id,
         s.suggested_quantity,
         s.last_period_quantity,
         case when coalesce((a.atp ->> 'unknown')::boolean, true) then null
              else greatest(floor(coalesce((a.atp ->> 'available')::numeric, 0)), 0) end,
         left(s.reason || '. Modelo simple: no hubo datos suficientes para el sugerido con temporada', 400),
         jsonb_build_object(
           'model', 'historic_v1',
           'fallback', true,
           'fallback_reason', 'v2_sin_lineas',
           'windows', jsonb_build_object('recent_days', p_days),
           'atp', jsonb_build_object(
             'state', case when coalesce((a.atp ->> 'unknown')::boolean, true) then 'unknown' else 'known' end,
             'available', a.atp -> 'available',
             'source', a.atp ->> 'source'),
           'channel_id', v_channel,
           'assortment_id', v_assortment),
         'historic_v1'::text
  from ebim.suggest_order(p_store, p_customer, p_days) s
  join public.store_products sp
    on sp.product_id = s.product_id and sp.store_id = p_store and sp.status = 'published'
  left join public.product_variants pv on pv.id = s.variant_id
  cross join lateral (select ebim.suggest_order_atp(p_store, s.product_id, s.variant_id) as atp) a
  where (s.variant_id is null or coalesce(pv.is_active, false))
    and ebim.product_in_assortment(p_store, p_customer, s.product_id, v_channel)
    and (not v_scoped or exists (
      select 1 from public.product_channels pc
      where pc.channel_id = v_channel and pc.product_id = s.product_id));
end;
$function$;

-- ===========================================================================
-- Favoritos por tienda
--
-- Hasta ahora el producto era de UNA tienda y el favorito la heredaba. Con el
-- maestro en varias tiendas, «guardar P» solo tiene sentido en la tienda desde
-- la que se guarda: la función recibe la tienda y la unicidad pasa a (usuario,
-- tienda, producto). Un cliente antiguo que no manda la tienda cae en una
-- regla determinista: la tienda de origen si P se publica ahí, o la primera
-- tienda activa donde está publicado.
-- ===========================================================================
alter table public.product_favorites drop constraint product_favorites_unique;
alter table public.product_favorites
  add constraint product_favorites_unique unique (user_id, store_id, product_id);

drop function public.toggle_product_favorite(uuid);

create function public.toggle_product_favorite(p_product_id uuid, p_store_id uuid default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user    uuid := ebim.user_id();
  v_pub     record;
  v_deleted integer;
begin
  if v_user is null then
    raise exception 'SESION_REQUERIDA: hay que iniciar sesion para guardar favoritos'
      using errcode = '28000';
  end if;

  -- El producto tiene que estar PUBLICADO en una tienda ACTIVA. Es la misma
  -- frontera que ve el comprador en la vitrina: si no lo puede ver, no lo puede
  -- guardar, y de paso el tenant sale de aqui y no del cliente.
  select sp.store_id, sp.organization_id, sp.company_id
    into v_pub
  from public.store_products sp
  join public.stores s on s.id = sp.store_id
  left join public.products p on p.id = sp.product_id
  where sp.product_id = p_product_id
    and (p_store_id is null or sp.store_id = p_store_id)
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now()
    and s.status = 'active'
  order by (sp.store_id = p.store_id) desc nulls last, sp.published_at, sp.store_id
  limit 1;

  if not found then
    raise exception 'PRODUCTO_NO_ENCONTRADO: no hay ningun producto publicado con ese id'
      using errcode = '22023';
  end if;

  delete from public.product_favorites f
   where f.user_id = v_user and f.product_id = p_product_id and f.store_id = v_pub.store_id;
  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    return false;
  end if;

  insert into public.product_favorites
    (organization_id, company_id, store_id, product_id, user_id)
  values
    (v_pub.organization_id, v_pub.company_id, v_pub.store_id, p_product_id, v_user);

  return true;
end;
$fn$;

revoke execute on function public.toggle_product_favorite(uuid, uuid) from public, anon;
grant execute on function public.toggle_product_favorite(uuid, uuid) to authenticated;

comment on function public.toggle_product_favorite(uuid, uuid) is
  'Guarda o quita un favorito del usuario de la sesion en UNA tienda (ADR 018). Exige publicacion vigente en tienda activa; el tenant sale de la publicacion.';

-- ===========================================================================
-- Claves ajenas
--
-- - content_block_items y product_favorites: lo que se muestra EN una tienda →
--   su publicación. Quitar el producto de la tienda los quita de esa tienda.
-- - product_reviews: historia → el MAESTRO. Despublicar no borra opiniones; al
--   volver a publicar, siguen ahí.
-- ===========================================================================
do $guard$
declare
  v_blocks    bigint;
  v_favorites bigint;
begin
  select count(*) into v_blocks
  from public.content_block_items i
  where i.product_id is not null
    and not exists (select 1 from public.store_products sp
                    where sp.product_id = i.product_id and sp.store_id = i.store_id);
  select count(*) into v_favorites
  from public.product_favorites f
  where not exists (select 1 from public.store_products sp
                    where sp.product_id = f.product_id and sp.store_id = f.store_id);
  if v_blocks > 0 or v_favorites > 0 then
    raise exception 'PUBLICACION_FALTANTE: filas sin publicacion en su tienda (content_block_items=%, product_favorites=%)',
      v_blocks, v_favorites;
  end if;
end;
$guard$;

alter table public.content_block_items drop constraint content_block_items_product_fk;
alter table public.content_block_items
  add constraint content_block_items_product_fk foreign key (product_id, store_id)
    references public.store_products (product_id, store_id) on delete cascade;

alter table public.product_favorites drop constraint product_favorites_product_fk;
alter table public.product_favorites
  add constraint product_favorites_product_fk foreign key (product_id, store_id)
    references public.store_products (product_id, store_id) on delete cascade;

alter table public.product_reviews drop constraint product_reviews_product_fk;
alter table public.product_reviews
  add constraint product_reviews_product_fk foreign key (product_id, organization_id, company_id)
    references public.products (id, organization_id, company_id) on delete cascade;
