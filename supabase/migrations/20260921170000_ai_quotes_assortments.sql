-- =============================================================================
-- Cotizaciones y surtidos con IA (EBIM_AI_SEQUENCE, fase 07) — RESOLUCIÓN,
-- PRECIO Y GUARDADO DETERMINISTAS.
--
-- La IA de esta fase hace dos cosas y ninguna toca un precio:
--
--   1. Interpreta una instrucción en lenguaje natural («cotiza a Bodega San
--      Juan 20 paracetamol 500 y 10 ibuprofeno, válida 30 días») y devuelve
--      TEXTO: cómo se llama el cliente, qué productos se nombran y cuántos.
--      El modelo nunca ve el catálogo, ni SKU, ni clientes, ni precios.
--   2. Explica y prioriza sugerencias de surtido que el SISTEMA ya calculó
--      sobre productos reales, publicados, autorizados y disponibles.
--
-- Todo lo demás vive aquí:
--
--   public.ai_quote_resolve(store, customer?, customer_query, lines)
--        Texto → entidades REALES: candidatos de cliente (con la cartera del
--        vendedor) y de producto por línea (publicados en la tienda, con el
--        surtido autorizado del cliente). Nunca elige cuando hay duda: marca
--        `ambiguous` y devuelve los candidatos para que elija una persona.
--   public.quote_draft_preview(store, customer, lines)
--        El borrador con lo que dice el sistema: precio y lista por
--        `public.price_quote` (motor `ebim.build_quote`), impuesto por línea,
--        disponibilidad por `public.inventory_availability`, surtido por
--        `ebim.product_in_assortment`. Solo lectura.
--   public.quote_create_from_draft(store, customer, number, valid_until,
--                                  notes, lines, request_key)
--        EJECUTAR, tras la confirmación humana: vuelve a preciar en el
--        servidor (el navegador no manda ni un importe), rechaza líneas
--        bloqueadas y crea la cotización en `draft` con sus líneas. Idempotente
--        por `request_key`.
--   public.ai_assortment_facts(store, customer)
--        CÁLCULO DEL SISTEMA de las sugerencias: reposición (lo que el cliente
--        compra con regularidad y ya le toca), venta cruzada (lo que otros
--        compran junto con lo suyo) y complemento (lo más vendido de sus
--        categorías que aún no compra). Solo candidatos publicados, dentro del
--        surtido del cliente y sin rotura conocida; lo excluido se cuenta.
--
-- ## Permisos
--
--  - Funcionalidad `quotes` (ya declarada en la fase 01: owner, admin,
--    orders, sales_rep; módulo `trade.quotes`) vía
--    `ebim.assert_ai_feature_reader`, y tienda de la sociedad ACTIVA.
--  - Cartera: un vendedor (rol de campo sin rol de oficina) solo resuelve,
--    precia, cotiza y recibe sugerencias para clientes de SU cartera. Fuera
--    de ella el cliente no existe (NULL ⇒ 404), igual que uno de otra sociedad.
--  - SECURITY INVOKER: la RLS de quien llama manda en todas las lecturas y en
--    los INSERT de `quotes`/`quote_items` (policy `quotes_write_seller`).
--
-- ## Lo que NO se decide aquí
--
--  - El precio: lo decide el motor. Estas funciones solo leen su resultado.
--  - La disponibilidad no bloquea una cotización (no es una reserva): se
--    informa por línea. Al convertirla en pedido, el checkout vuelve a
--    comprobar ATP, crédito y surtido con sus propias reglas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0 · Auxiliares internos
-- ---------------------------------------------------------------------------

-- ¿Puede quien llama cotizar a este cliente? Sociedad activa + cartera.
create or replace function ebim.ai_quote_customer_visible(p_customer_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select p_customer_id is not null and exists (
    select 1
      from public.customers c
     where c.id = p_customer_id
       and c.organization_id = ebim.org_id()
       and c.company_id = ebim.active_company()
       and (
         not ebim.ai_is_field_only(c.organization_id, c.company_id)
         or exists (
           select 1 from public.sales_rep_customers rc
            where rc.customer_id = c.id
              and rc.sales_rep_id = ebim.sales_rep_of(c.organization_id, c.company_id)
         )
       )
  );
$fn$;

revoke execute on function ebim.ai_quote_customer_visible(uuid) from public, anon;
grant  execute on function ebim.ai_quote_customer_visible(uuid) to authenticated, service_role;

-- Pedidos (vendidos) del cliente en ESTA tienda: por su cuenta B2B y por el
-- correo de la ficha o de sus contactos. La misma heurística declarada de la
-- fase 06 (`ebim.ai_customer_dataset`) y de `public.customer_orders`.
create or replace function ebim.ai_customer_order_ids(p_customer_id uuid, p_store_id uuid)
returns uuid[]
language sql
stable
security invoker
set search_path = ''
as $fn$
  with emails as (
    select lower(c.email) as email from public.customers c
     where c.id = p_customer_id and c.email is not null
    union
    select lower(ct.email) from public.customer_contacts ct
     where ct.customer_id = p_customer_id and ct.email is not null
  ),
  cuentas as (
    select b.id from public.business_accounts b
     where b.customer_id = p_customer_id
       and b.organization_id = ebim.org_id()
       and b.company_id = ebim.active_company()
  )
  select coalesce(array_agg(o.id), '{}'::uuid[])
    from public.orders o
   where o.organization_id = ebim.org_id()
     and o.company_id = ebim.active_company()
     and o.store_id = p_store_id
     and o.status not in ('cancelled', 'refunded')
     and (o.business_account_id in (select id from cuentas)
          or lower(o.customer_email) in (select email from emails));
$fn$;

revoke execute on function ebim.ai_customer_order_ids(uuid, uuid) from public, anon;
grant  execute on function ebim.ai_customer_order_ids(uuid, uuid) to authenticated, service_role;

-- Candidatos de producto para un texto: SKU exacto (del producto o de una
-- variante), nombre exacto o nombre que contiene TODAS las palabras. Solo lo
-- PUBLICADO en la tienda (ADR 018). Nunca más de cinco. Con cliente, cada
-- candidato dice si está en su surtido autorizado.
create or replace function ebim.ai_quote_product_candidates(
  p_store_id    uuid,
  p_query       text,
  p_customer_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_norm  text := ebim.search_normalize(left(coalesce(p_query, ''), 80));
  v_sku   text := upper(btrim(left(coalesce(p_query, ''), 80)));
  v_words text[];
begin
  if v_norm = '' then
    return '[]'::jsonb;
  end if;
  select array_agg(w) into v_words
    from unnest(string_to_array(v_norm, ' ')) w
   where char_length(w) >= 2;
  if v_words is null then
    v_words := array[v_norm];
  end if;

  return coalesce((
    select jsonb_agg(x.item order by x.rank, x.name)
      from (
        select
          jsonb_build_object(
            'product_id', p.id,
            'sku', left(p.sku, 64),
            'name', left(p.name, 120),
            'kind', p.kind,
            'match', case
                       when upper(p.sku) = v_sku or mv.id is not null then 'sku'
                       when ebim.search_normalize(p.name) = v_norm then 'name'
                       else 'partial'
                     end,
            'matched_variant_id', mv.id,
            'in_assortment', case when p_customer_id is null then null
                                  else ebim.product_in_assortment(p_store_id, p_customer_id, p.id) end,
            'variants', case when p.kind = 'variant' then coalesce((
                select jsonb_agg(jsonb_build_object(
                         'variant_id', v.id, 'sku', left(v.sku, 64), 'name', left(v.name, 80))
                         order by v.position, v.name)
                  from (select pv.id, pv.sku, pv.name, pv.position
                          from public.product_variants pv
                         where pv.product_id = p.id and pv.is_active
                         order by pv.position, pv.name
                         limit 10) v), '[]'::jsonb)
              else '[]'::jsonb end
          ) as item,
          case
            when upper(p.sku) = v_sku or mv.id is not null then 0
            when ebim.search_normalize(p.name) = v_norm then 1
            else 2
          end as rank,
          p.name
          from public.store_products sp
          join public.products p on p.id = sp.product_id
          left join lateral (
            select pv.id from public.product_variants pv
             where pv.product_id = p.id and pv.is_active and upper(pv.sku) = v_sku
             limit 1
          ) mv on true
         where sp.store_id = p_store_id
           and sp.status = 'published'
           and (
             upper(p.sku) = v_sku
             or mv.id is not null
             or (select bool_and(position(w in ebim.search_normalize(p.name)) > 0) from unnest(v_words) w)
           )
         order by rank, p.name
         limit 5
      ) x
  ), '[]'::jsonb);
end;
$fn$;

revoke execute on function ebim.ai_quote_product_candidates(uuid, text, uuid) from public, anon;
grant  execute on function ebim.ai_quote_product_candidates(uuid, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1 · Texto → entidades reales (sin elegir cuando hay duda)
-- ---------------------------------------------------------------------------
create or replace function public.ai_quote_resolve(
  p_store_id       uuid,
  p_customer_id    uuid  default null,
  p_customer_query text  default null,
  p_lines          jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org        uuid := ebim.org_id();
  v_company    uuid := ebim.active_company();
  v_lines_in   jsonb := coalesce(p_lines, '[]'::jsonb);
  v_query_c    text := nullif(btrim(coalesce(p_customer_query, '')), '');
  v_norm       text;
  v_code       text;
  v_status     text;
  v_customer   uuid;
  v_customers  jsonb := '[]'::jsonb;
  v_exact      uuid[];
  v_assort     record;
  v_line       jsonb;
  v_key        text;
  v_query      text;
  v_qty        integer;
  v_cands      jsonb;
  v_allowed    jsonb;
  v_exacts     jsonb;
  v_lstatus    text;
  v_selected   uuid;
  v_lines      jsonb := '[]'::jsonb;
  v_i          integer := 0;
begin
  perform ebim.assert_ai_feature_reader('quotes', 'trade.quotes');
  perform ebim.assert_ai_orders_store(p_store_id);

  if jsonb_typeof(v_lines_in) <> 'array' or jsonb_array_length(v_lines_in) > 20 then
    raise exception 'FILTRO_INVALIDO: lines' using errcode = '22023';
  end if;
  if v_query_c is not null and char_length(v_query_c) > 80 then
    raise exception 'FILTRO_INVALIDO: customer_query' using errcode = '22023';
  end if;

  -- ---- Cliente --------------------------------------------------------
  if p_customer_id is not null then
    -- Elegido por la persona: o lo puede cotizar, o no existe para ella.
    if not ebim.ai_quote_customer_visible(p_customer_id) then
      return null;
    end if;
    v_customer := p_customer_id;
    v_status := 'resolved';
    select jsonb_build_array(jsonb_build_object(
             'customer_id', c.id, 'code', left(c.code, 40), 'name', left(c.name, 80),
             'kind', c.kind, 'segment', left(s.name, 60), 'match', 'selected'))
      into v_customers
      from public.customers c
      left join public.customer_segments s on s.id = c.segment_id
     where c.id = p_customer_id;
  elsif v_query_c is null then
    v_status := 'missing';
  else
    v_norm := ebim.search_normalize(v_query_c);
    v_code := upper(v_query_c);
    with cand as (
      select c.id, c.code, c.name, c.kind, s.name as segment,
             case when upper(c.code) = v_code then 0
                  when ebim.search_normalize(c.name) = v_norm then 1
                  else 2 end as rank
        from public.customers c
        left join public.customer_segments s on s.id = c.segment_id
       where c.organization_id = v_org
         and c.company_id = v_company
         and c.is_active
         and v_norm <> ''
         and (upper(c.code) = v_code
              or (select bool_and(position(w in ebim.search_normalize(c.name)) > 0)
                    from unnest(string_to_array(v_norm, ' ')) w))
         and ebim.ai_quote_customer_visible(c.id)
       order by rank, c.name
       limit 5
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'customer_id', id, 'code', left(code, 40), 'name', left(name, 80), 'kind', kind,
             'segment', left(segment, 60),
             'match', case rank when 0 then 'code' when 1 then 'name' else 'partial' end)
             order by rank, name), '[]'::jsonb),
           array_agg(id) filter (where rank < 2)
      into v_customers, v_exact
      from cand;

    if jsonb_array_length(v_customers) = 0 then
      v_status := 'not_found';
    elsif jsonb_array_length(v_customers) = 1 then
      v_status := 'resolved';
      v_customer := (v_customers -> 0 ->> 'customer_id')::uuid;
    elsif coalesce(array_length(v_exact, 1), 0) = 1 then
      -- Varios parecidos pero UNO exacto (código o nombre): ese.
      v_status := 'resolved';
      v_customer := v_exact[1];
    else
      v_status := 'ambiguous';
    end if;
  end if;

  if v_customer is not null then
    select a.id, left(a.name, 120) as name, a.is_allow_list
      into v_assort
      from public.assortments a
     where a.id = ebim.assortment_for_customer(p_store_id, v_customer, null);
  end if;

  -- ---- Líneas ---------------------------------------------------------
  for v_line in select value from jsonb_array_elements(v_lines_in)
  loop
    v_i := v_i + 1;
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'FILTRO_INVALIDO: line' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_line)
    loop
      if v_key not in ('query', 'quantity') then
        raise exception 'CAMPO_NO_PERMITIDO: %', v_key using errcode = '22023';
      end if;
    end loop;

    v_query := left(btrim(coalesce(v_line ->> 'query', '')), 80);
    v_qty := null;
    if jsonb_typeof(v_line -> 'quantity') = 'number'
       and (v_line ->> 'quantity') ~ '^[0-9]{1,6}$'
       and (v_line ->> 'quantity')::integer between 1 and 100000 then
      v_qty := (v_line ->> 'quantity')::integer;
    end if;

    v_cands := ebim.ai_quote_product_candidates(p_store_id, v_query, v_customer);
    select coalesce(jsonb_agg(c), '[]'::jsonb) into v_allowed
      from jsonb_array_elements(v_cands) c
     where (c ->> 'in_assortment') is distinct from 'false';
    select coalesce(jsonb_agg(c), '[]'::jsonb) into v_exacts
      from jsonb_array_elements(v_allowed) c
     where c ->> 'match' in ('sku', 'name');

    v_selected := null;
    if jsonb_array_length(v_cands) = 0 then
      v_lstatus := 'not_found';
    elsif jsonb_array_length(v_allowed) = 0 then
      v_lstatus := 'out_of_assortment';
    elsif jsonb_array_length(v_allowed) = 1 then
      v_lstatus := 'resolved';
      v_selected := (v_allowed -> 0 ->> 'product_id')::uuid;
    elsif jsonb_array_length(v_exacts) = 1 then
      v_lstatus := 'resolved';
      v_selected := (v_exacts -> 0 ->> 'product_id')::uuid;
    else
      v_lstatus := 'ambiguous';
    end if;

    v_lines := v_lines || jsonb_build_object(
      'index', v_i,
      'query', v_query,
      'quantity', v_qty,
      'status', v_lstatus,
      'selected_product_id', v_selected,
      'candidates', v_cands);
  end loop;

  return jsonb_build_object(
    'generated_at', now(),
    'customer', jsonb_build_object(
      'status', v_status,
      'query', left(v_query_c, 80),
      'selected_customer_id', v_customer,
      'candidates', v_customers),
    'assortment', case when v_customer is null then null
                       else jsonb_build_object(
                              'configured', v_assort.id is not null,
                              'name', v_assort.name,
                              'is_allow_list', v_assort.is_allow_list) end,
    'lines', v_lines);
end;
$fn$;

revoke execute on function public.ai_quote_resolve(uuid, uuid, text, jsonb) from public, anon;
grant  execute on function public.ai_quote_resolve(uuid, uuid, text, jsonb) to authenticated, service_role;

comment on function public.ai_quote_resolve(uuid, uuid, text, jsonb) is
  'Fase 07 IA: texto interpretado → candidatos REALES de cliente (cartera) y producto (publicado, surtido). Ambiguo ⇒ candidatos, nunca una elección. Security invoker, roles de quotes.';

-- ---------------------------------------------------------------------------
-- 2 · El borrador con lo que dice el sistema (solo lectura)
-- ---------------------------------------------------------------------------
create or replace function public.quote_draft_preview(
  p_store_id    uuid,
  p_customer_id uuid,
  p_lines       jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_line        jsonb;
  v_key         text;
  v_pid         uuid;
  v_vid         uuid;
  v_qty         integer;
  v_prod        record;
  v_block       text;
  v_in_assort   boolean;
  v_rows        jsonb := '[]'::jsonb;
  v_items       jsonb := '[]'::jsonb;
  v_quote       jsonb;
  v_avail       jsonb := '[]'::jsonb;
  v_pricing_err text;
  v_inclusive   boolean := false;
  v_currency    text;
  v_out         jsonb := '[]'::jsonb;
  v_row         jsonb;
  v_priced      jsonb;
  v_av          jsonb;
  v_rate        numeric;
  v_net         numeric;
  v_tax         numeric(14,2);
  v_total       numeric(14,2);
  v_subtotal    numeric(14,2) := 0;
  v_tax_total   numeric(14,2) := 0;
  v_blocked     integer := 0;
  v_i           integer := 0;
  v_customer    jsonb;
begin
  perform ebim.assert_ai_feature_reader('quotes', 'trade.quotes');
  perform ebim.assert_ai_orders_store(p_store_id);

  if not ebim.ai_quote_customer_visible(p_customer_id) then
    return null;
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'ITEMS_REQUERIDOS: el borrador necesita al menos una linea' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'ITEMS_EXCESIVOS: maximo 50 lineas por borrador' using errcode = '22023';
  end if;

  -- Validación de forma ANTES de nada. Lista BLANCA: un precio, un impuesto
  -- o un descuento dentro de una línea no se ignora, se rechaza.
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'CAMPO_INVALIDO: cada linea tiene que ser un objeto' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_line)
    loop
      if v_key not in ('product_id', 'variant_id', 'quantity') then
        raise exception 'CAMPO_NO_PERMITIDO: la linea no admite el campo %', v_key using errcode = '22023';
      end if;
    end loop;
    if ebim.safe_uuid(v_line ->> 'product_id') is null
       or (v_line ? 'variant_id' and jsonb_typeof(v_line -> 'variant_id') <> 'null'
           and ebim.safe_uuid(v_line ->> 'variant_id') is null) then
      raise exception 'CAMPO_INVALIDO: identificador de producto o variante invalido' using errcode = '22023';
    end if;
    if coalesce(v_line ->> 'quantity', '') !~ '^[0-9]{1,6}$'
       or (v_line ->> 'quantity')::integer < 1
       or (v_line ->> 'quantity')::integer > 100000 then
      raise exception 'CANTIDAD_INVALIDA: la cantidad tiene que ser un entero entre 1 y 100000' using errcode = '22023';
    end if;
  end loop;

  if (select count(*) <> count(distinct (l ->> 'product_id', coalesce(l ->> 'variant_id', '')))
        from jsonb_array_elements(p_lines) l) then
    raise exception 'LINEA_DUPLICADA: el mismo producto aparece dos veces en el borrador' using errcode = '22023';
  end if;

  -- Cada línea: publicada, variante correcta, dentro del surtido.
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_i := v_i + 1;
    v_pid := ebim.safe_uuid(v_line ->> 'product_id');
    v_vid := ebim.safe_uuid(v_line ->> 'variant_id');
    v_qty := (v_line ->> 'quantity')::integer;
    v_block := null;
    v_in_assort := null;

    select p.id, left(p.sku, 64) as sku, left(p.name, 120) as name, p.kind
      into v_prod
      from public.store_products sp
      join public.products p on p.id = sp.product_id
     where sp.store_id = p_store_id and sp.product_id = v_pid and sp.status = 'published';

    if not found then
      v_block := 'PRODUCTO_NO_DISPONIBLE';
    elsif v_prod.kind = 'variant' and v_vid is null then
      v_block := 'VARIANTE_REQUERIDA';
    elsif v_prod.kind <> 'variant' and v_vid is not null then
      v_block := 'VARIANTE_NO_APLICA';
    elsif v_vid is not null and not exists (
      select 1 from public.product_variants pv
       where pv.id = v_vid and pv.product_id = v_pid and pv.is_active) then
      v_block := 'VARIANTE_NO_DISPONIBLE';
    else
      v_in_assort := ebim.product_in_assortment(p_store_id, p_customer_id, v_pid);
      if not v_in_assort then
        v_block := 'FUERA_DE_SURTIDO';
      end if;
    end if;

    if v_block is not null then
      v_blocked := v_blocked + 1;
    else
      v_items := v_items || jsonb_build_object('product_id', v_pid, 'variant_id', v_vid, 'quantity', v_qty);
    end if;

    v_rows := v_rows || jsonb_build_object(
      'index', v_i,
      'product_id', v_pid,
      'variant_id', v_vid,
      'quantity', v_qty,
      'sku', case when v_prod.id is null then null else v_prod.sku end,
      'name', case when v_prod.id is null then null else v_prod.name end,
      'in_assortment', v_in_assort,
      'blocked', v_block);
  end loop;

  -- Precio: el motor, una llamada para todas las líneas válidas. El navegador
  -- no manda ni un importe; si el motor rechaza, se dice por qué y no se precia.
  if jsonb_array_length(v_items) > 0 then
    begin
      v_quote := public.price_quote(p_store_id, v_items, null, null, p_customer_id);
    exception when others then
      v_pricing_err := coalesce(nullif(split_part(sqlerrm, ':', 1), ''), 'PRECIO_NO_DISPONIBLE');
      if v_pricing_err !~ '^[A-Z_]{3,40}$' then
        v_pricing_err := 'PRECIO_NO_DISPONIBLE';
      end if;
      v_quote := null;
    end;
    v_avail := public.inventory_availability(p_store_id, v_items);
  end if;

  if v_quote is not null then
    v_inclusive := coalesce((v_quote ->> 'tax_inclusive')::boolean, false);
    v_currency := v_quote ->> 'currency';
  else
    select s.currency into v_currency from public.stores s where s.id = p_store_id;
  end if;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    v_priced := null;
    v_av := null;
    if (v_row ->> 'blocked') is null then
      if v_quote is not null then
        select l into v_priced
          from jsonb_array_elements(v_quote -> 'lines') l
         where l ->> 'product_id' = v_row ->> 'product_id'
           and (l ->> 'variant_id') is not distinct from (v_row ->> 'variant_id')
         limit 1;
      end if;
      select a into v_av
        from jsonb_array_elements(v_avail) a
       where a ->> 'product_id' = v_row ->> 'product_id'
         and (a ->> 'variant_id') is not distinct from (v_row ->> 'variant_id')
       limit 1;
    end if;

    if v_priced is not null then
      v_rate := coalesce((v_priced ->> 'tax_rate')::numeric, 0);
      v_net := (v_priced ->> 'net_amount')::numeric;
      -- Impuesto POR LÍNEA, como lo guarda `quote_items`: el IGV de una
      -- cotización es el del día en que se cotizó.
      if v_inclusive then
        v_tax := round(v_net - v_net / (1 + v_rate), 2);
        v_total := v_net - v_tax;
      else
        v_tax := round(v_net * v_rate, 2);
        v_total := v_net;
      end if;
      v_subtotal := v_subtotal + v_total;
      v_tax_total := v_tax_total + v_tax;
    else
      v_tax := null;
      v_total := null;
    end if;

    v_out := v_out || (v_row || jsonb_build_object(
      'variant_name', case when v_priced is null then null else left(v_priced ->> 'name', 160) end,
      'unit_price', v_priced ->> 'unit_price',
      'compare_at_price', v_priced ->> 'compare_at_price',
      'tax_rate', case when v_priced is null then null else v_rate::text end,
      'tax_amount', case when v_tax is null then null else v_tax::text end,
      'line_total', case when v_total is null then null else v_total::text end,
      'price_source', v_priced ->> 'source',
      'price_list_code', left(v_priced ->> 'price_list_code', 60),
      'availability', case when v_av is null then null else jsonb_build_object(
                         'available', v_av -> 'available',
                         'unknown', coalesce((v_av ->> 'unknown')::boolean, false),
                         'backorder', coalesce((v_av ->> 'backorder')::boolean, false),
                         'in_stock', coalesce((v_av ->> 'in_stock')::boolean, false)) end));
  end loop;

  select jsonb_build_object('customer_id', c.id, 'code', left(c.code, 40), 'name', left(c.name, 80))
    into v_customer
    from public.customers c where c.id = p_customer_id;

  return jsonb_build_object(
    'generated_at', now(),
    'customer', v_customer,
    'currency', v_currency,
    'tax_inclusive', v_inclusive,
    'lines', v_out,
    'blocked', v_blocked,
    'pricing_error', v_pricing_err,
    -- Totales = suma de las líneas tal como se guardarán (la misma cuenta que
    -- hace la pantalla de cotizaciones al editar una línea).
    'subtotal', case when v_quote is null then null else v_subtotal::text end,
    'tax_total', case when v_quote is null then null else v_tax_total::text end,
    'grand_total', case when v_quote is null then null else (v_subtotal + v_tax_total)::text end,
    'ready', v_quote is not null and v_blocked = 0 and v_pricing_err is null);
end;
$fn$;

revoke execute on function public.quote_draft_preview(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.quote_draft_preview(uuid, uuid, jsonb) to authenticated, service_role;

comment on function public.quote_draft_preview(uuid, uuid, jsonb) is
  'Fase 07: borrador de cotizacion preciado por el motor (price_quote), con impuesto por linea, disponibilidad y surtido. Solo lectura; el navegador no manda importes.';

-- ---------------------------------------------------------------------------
-- 3 · Ejecutar, tras la confirmación humana
-- ---------------------------------------------------------------------------
create or replace function public.quote_create_from_draft(
  p_store_id     uuid,
  p_customer_id  uuid,
  p_quote_number text,
  p_valid_until  date,
  p_notes        text,
  p_lines        jsonb,
  p_request_key  text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_org      uuid := ebim.org_id();
  v_company  uuid := ebim.active_company();
  v_number   text := btrim(coalesce(p_quote_number, ''));
  v_notes    text := nullif(btrim(coalesce(p_notes, '')), '');
  v_existing public.quotes%rowtype;
  v_preview  jsonb;
  v_quote_id uuid;
  v_rep      uuid;
begin
  perform ebim.assert_ai_feature_reader('quotes', 'trade.quotes');
  perform ebim.assert_ai_orders_store(p_store_id);

  if p_request_key is not null and p_request_key !~ '^[A-Za-z0-9_.:-]{8,120}$' then
    raise exception 'CAMPO_INVALIDO: request_key' using errcode = '22023';
  end if;

  -- Repetición (doble clic, reintento de red): la misma cotización, no otra.
  if p_request_key is not null then
    select * into v_existing
      from public.quotes q
     where q.organization_id = v_org and q.company_id = v_company
       and q.request_key = p_request_key;
    if found then
      if v_existing.customer_id is distinct from p_customer_id or v_existing.store_id is distinct from p_store_id then
        raise exception 'IDEMPOTENCIA_EN_CONFLICTO: esa clave ya se uso para otra cotizacion' using errcode = '22023';
      end if;
      return jsonb_build_object(
        'quote_id', v_existing.id,
        'quote_number', v_existing.quote_number,
        'status', v_existing.status,
        'currency', v_existing.currency,
        'grand_total', v_existing.grand_total::text,
        'already_created', true);
    end if;
  end if;

  if not ebim.ai_quote_customer_visible(p_customer_id) then
    raise exception 'NO_ENCONTRADO: el cliente no existe o no es de tu cartera' using errcode = '22023';
  end if;
  if char_length(v_number) not between 1 and 60 then
    raise exception 'CAMPO_INVALIDO: quote_number' using errcode = '22023';
  end if;
  if p_valid_until is null or p_valid_until < current_date or p_valid_until > current_date + 365 then
    raise exception 'CAMPO_INVALIDO: valid_until' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'CAMPO_INVALIDO: notes' using errcode = '22023';
  end if;

  -- VALIDACIÓN DEL SISTEMA: se vuelve a preciar aquí, dentro de la misma
  -- transacción. Lo que la persona vio es orientativo; lo que se guarda es lo
  -- que el motor dice ahora.
  v_preview := public.quote_draft_preview(p_store_id, p_customer_id, p_lines);
  if v_preview is null then
    raise exception 'NO_ENCONTRADO: el cliente no existe o no es de tu cartera' using errcode = '22023';
  end if;
  if (v_preview ->> 'pricing_error') is not null then
    raise exception '%: el motor de precios rechazo el borrador', v_preview ->> 'pricing_error' using errcode = '22023';
  end if;
  if (v_preview ->> 'blocked')::integer > 0 then
    raise exception 'LINEA_BLOQUEADA: %', (
      select l ->> 'blocked' from jsonb_array_elements(v_preview -> 'lines') l
       where l ->> 'blocked' is not null limit 1) using errcode = '22023';
  end if;

  -- Un vendedor de campo firma SU cotización (lo exige la policy); la oficina
  -- la crea sin vendedor, como la pantalla manual.
  if ebim.ai_is_field_only(v_org, v_company) then
    v_rep := ebim.sales_rep_of(v_org, v_company);
  end if;

  insert into public.quotes (
    organization_id, company_id, store_id, customer_id, sales_rep_id,
    quote_number, status, currency, issued_at, valid_until,
    subtotal, tax_total, grand_total, notes, request_key)
  values (
    v_org, v_company, p_store_id, p_customer_id, v_rep,
    v_number, 'draft', v_preview ->> 'currency', current_date, p_valid_until,
    (v_preview ->> 'subtotal')::numeric, (v_preview ->> 'tax_total')::numeric,
    (v_preview ->> 'grand_total')::numeric, v_notes, p_request_key)
  returning id into v_quote_id;

  insert into public.quote_items (
    organization_id, company_id, quote_id, product_id, variant_id, uom_code,
    quantity, unit_price, tax_rate, tax_amount, line_total, position)
  select v_org, v_company, v_quote_id,
         (l ->> 'product_id')::uuid,
         ebim.safe_uuid(l ->> 'variant_id'),
         null,
         (l ->> 'quantity')::numeric,
         (l ->> 'unit_price')::numeric,
         (l ->> 'tax_rate')::numeric,
         (l ->> 'tax_amount')::numeric,
         (l ->> 'line_total')::numeric,
         ((l ->> 'index')::integer - 1)::smallint
    from jsonb_array_elements(v_preview -> 'lines') l;

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'quote_number', v_number,
    'status', 'draft',
    'currency', v_preview ->> 'currency',
    'grand_total', v_preview ->> 'grand_total',
    'already_created', false);
end;
$fn$;

revoke execute on function public.quote_create_from_draft(uuid, uuid, text, date, text, jsonb, text) from public, anon;
grant  execute on function public.quote_create_from_draft(uuid, uuid, text, date, text, jsonb, text) to authenticated, service_role;

comment on function public.quote_create_from_draft(uuid, uuid, text, date, text, jsonb, text) is
  'Fase 07: crea la cotizacion en draft tras la confirmacion humana, re-preciando con el motor en el servidor. Idempotente por request_key. Security invoker (RLS de quotes).';

-- ---------------------------------------------------------------------------
-- 4 · Sugerencias de surtido: CÁLCULO DEL SISTEMA
-- ---------------------------------------------------------------------------
-- Umbrales (se devuelven en `thresholds` y los repite `aiQuotes.ts`):
--   historial 365 d · reposición: ≥ 2 pedidos y días desde la última compra ≥
--   su intervalo medio · venta cruzada: pedidos de OTROS clientes de la tienda
--   en 180 d que llevan alguno de sus productos, ≥ 2 pedidos en común ·
--   complemento: sus categorías, vendido en la tienda en 90 d (≥ 1 pedido),
--   aún no comprado. Cinco por tipo como máximo.
create or replace function public.ai_assortment_facts(p_store_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now       timestamptz := now();
  v_ids       uuid[];
  v_history   jsonb;
  v_bought    uuid[];
  v_raw       jsonb := '[]'::jsonb;
  v_cand      jsonb;
  v_items     jsonb;
  v_av        jsonb;
  v_in        boolean;
  v_unknown   boolean;
  v_in_stock  boolean;
  v_out       jsonb := '[]'::jsonb;
  v_kind_n    jsonb := '{}'::jsonb;
  v_kind      text;
  v_n         integer;
  v_ex_assort integer := 0;
  v_ex_stock  integer := 0;
  v_assort    record;
  v_customer  jsonb;
begin
  perform ebim.assert_ai_feature_reader('quotes', 'trade.quotes');
  perform ebim.assert_ai_orders_store(p_store_id);

  if not ebim.ai_quote_customer_visible(p_customer_id) then
    return null;
  end if;

  v_ids := ebim.ai_customer_order_ids(p_customer_id, p_store_id);

  -- Historial (365 d) por producto.
  with h as (
    select i.product_id,
           count(distinct o.id)::int as orders,
           sum(coalesce(i.base_quantity, i.quantity))::numeric(14,3) as quantity,
           min(o.placed_at) as first_at,
           max(o.placed_at) as last_at
      from public.orders o
      join public.order_items i on i.order_id = o.id
     where o.id = any(v_ids)
       and o.placed_at >= v_now - interval '365 days'
       and i.product_id is not null
     group by i.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', h.product_id,
           'name', left(p.name, 80),
           'orders_365d', h.orders,
           'quantity_365d', h.quantity::text,
           'days_since_last', floor(extract(epoch from (v_now - h.last_at)) / 86400)::int,
           'avg_interval_days', case when h.orders >= 2
                                     then round(extract(epoch from (h.last_at - h.first_at)) / 86400 / (h.orders - 1))::int end)
           order by h.orders desc, h.quantity desc, p.name), '[]'::jsonb),
         coalesce(array_agg(h.product_id), '{}'::uuid[])
    into v_history, v_bought
    from h join public.products p on p.id = h.product_id;

  -- Reposición: lo que compra con regularidad y ya le toca.
  select v_raw || coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'replenish',
           'product_id', (x ->> 'product_id')::uuid,
           'orders_365d', (x ->> 'orders_365d')::int,
           'days_since_last', (x ->> 'days_since_last')::int,
           'avg_interval_days', (x ->> 'avg_interval_days')::int)
           order by (x ->> 'days_since_last')::int - (x ->> 'avg_interval_days')::int desc), '[]'::jsonb)
    into v_raw
    from jsonb_array_elements(v_history) x
   where (x ->> 'orders_365d')::int >= 2
     and (x ->> 'avg_interval_days')::int >= 1
     and (x ->> 'days_since_last')::int >= (x ->> 'avg_interval_days')::int;

  -- Venta cruzada: lo que OTROS pedidos de la tienda (180 d) llevan junto con
  -- sus productos y él no compra.
  if array_length(v_bought, 1) > 0 then
    with otros as (
      select distinct o.id
        from public.orders o
        join public.order_items i on i.order_id = o.id
       where o.organization_id = ebim.org_id()
         and o.company_id = ebim.active_company()
         and o.store_id = p_store_id
         and o.status not in ('cancelled', 'refunded')
         and o.placed_at >= v_now - interval '180 days'
         and not (o.id = any(v_ids))
         and i.product_id = any(v_bought)
    ),
    co as (
      select i.product_id, count(distinct i.order_id)::int as co_orders
        from public.order_items i
       where i.order_id in (select id from otros)
         and i.product_id is not null
         and not (i.product_id = any(v_bought))
       group by i.product_id
      having count(distinct i.order_id) >= 2
       order by count(distinct i.order_id) desc
       limit 12
    ),
    ancla as (
      select distinct on (c.product_id) c.product_id, a.product_id as anchor, count(distinct a.order_id) as n
        from co c
        join public.order_items b on b.product_id = c.product_id and b.order_id in (select id from otros)
        join public.order_items a on a.order_id = b.order_id and a.product_id = any(v_bought)
       group by c.product_id, a.product_id
       order by c.product_id, count(distinct a.order_id) desc, a.product_id
    )
    select v_raw || coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'cross_sell',
             'product_id', co.product_id,
             'co_orders', co.co_orders,
             'anchor_product_id', ancla.anchor)
             order by co.co_orders desc), '[]'::jsonb)
      into v_raw
      from co left join ancla on ancla.product_id = co.product_id;
  end if;

  -- Complemento: lo más vendido (90 d) de SUS categorías que aún no compra.
  if array_length(v_bought, 1) > 0 then
    with cats as (
      select distinct sp.category_id
        from public.store_products sp
       where sp.store_id = p_store_id and sp.product_id = any(v_bought) and sp.category_id is not null
    ),
    ventas as (
      select i.product_id, count(distinct o.id)::int as n
        from public.orders o
        join public.order_items i on i.order_id = o.id
       where o.organization_id = ebim.org_id()
         and o.company_id = ebim.active_company()
         and o.store_id = p_store_id
         and o.status not in ('cancelled', 'refunded')
         and o.placed_at >= v_now - interval '90 days'
         and i.product_id is not null
       group by i.product_id
    )
    select v_raw || coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'complement',
             'product_id', t.product_id,
             'store_orders_90d', t.n,
             'category', t.category)
             order by t.n desc, t.name), '[]'::jsonb)
      into v_raw
      from (
        select sp.product_id, v.n, left(c.name, 60) as category, p.name
          from public.store_products sp
          join cats on cats.category_id = sp.category_id
          join ventas v on v.product_id = sp.product_id
          join public.products p on p.id = sp.product_id
          left join public.categories c on c.id = sp.category_id
         where sp.store_id = p_store_id
           and sp.status = 'published'
           and not (sp.product_id = any(v_bought))
         order by v.n desc, p.name
         limit 12
      ) t;
  end if;

  -- Filtro del sistema: publicado, surtido autorizado, sin rotura conocida,
  -- sin repetir producto entre tipos; cinco por tipo.
  for v_cand in select value from jsonb_array_elements(v_raw)
  loop
    v_kind := v_cand ->> 'kind';
    v_n := coalesce((v_kind_n ->> v_kind)::int, 0);
    if v_n >= 5 then continue; end if;
    if exists (select 1 from jsonb_array_elements(v_out) o where o ->> 'product_id' = v_cand ->> 'product_id') then
      continue;
    end if;
    if not exists (
      select 1 from public.store_products sp
       where sp.store_id = p_store_id and sp.product_id = (v_cand ->> 'product_id')::uuid
         and sp.status = 'published') then
      continue;
    end if;

    v_in := ebim.product_in_assortment(p_store_id, p_customer_id, (v_cand ->> 'product_id')::uuid);
    if not v_in then
      v_ex_assort := v_ex_assort + 1;
      continue;
    end if;

    -- Disponibilidad: por producto o, si se vende por variante, por sus
    -- variantes activas (basta una con existencia).
    select case when p.kind = 'variant' then
             coalesce((select jsonb_agg(jsonb_build_object('product_id', p.id, 'variant_id', pv.id))
                         from (select pv0.id from public.product_variants pv0
                                where pv0.product_id = p.id and pv0.is_active
                                order by pv0.position limit 10) pv), '[]'::jsonb)
           else jsonb_build_array(jsonb_build_object('product_id', p.id)) end
      into v_items
      from public.products p where p.id = (v_cand ->> 'product_id')::uuid;
    if jsonb_array_length(v_items) = 0 then
      v_ex_stock := v_ex_stock + 1;
      continue;
    end if;
    v_av := public.inventory_availability(p_store_id, v_items);
    select coalesce(bool_or((a ->> 'in_stock')::boolean), false),
           coalesce(bool_or((a ->> 'unknown')::boolean), false)
      into v_in_stock, v_unknown
      from jsonb_array_elements(v_av) a;
    if not v_in_stock and not v_unknown then
      v_ex_stock := v_ex_stock + 1;
      continue;
    end if;

    select v_cand || jsonb_build_object(
             'name', left(p.name, 80),
             'sku', left(p.sku, 64),
             'kind_of_product', p.kind,
             'availability', case when v_in_stock then 'in_stock' else 'unknown' end)
      into v_cand
      from public.products p where p.id = (v_cand ->> 'product_id')::uuid;
    v_out := v_out || v_cand;
    v_kind_n := v_kind_n || jsonb_build_object(v_kind, v_n + 1);
  end loop;

  select a.id, left(a.name, 120) as name, a.is_allow_list
    into v_assort
    from public.assortments a
   where a.id = ebim.assortment_for_customer(p_store_id, p_customer_id, null);

  select jsonb_build_object('customer_id', c.id, 'code', left(c.code, 40), 'name', left(c.name, 80))
    into v_customer
    from public.customers c where c.id = p_customer_id;

  return jsonb_build_object(
    'generated_at', v_now,
    'customer', v_customer,
    'assortment', jsonb_build_object(
      'configured', v_assort.id is not null,
      'name', v_assort.name,
      'is_allow_list', v_assort.is_allow_list),
    'history', (select coalesce(jsonb_agg(h.value order by h.n), '[]'::jsonb)
                  from jsonb_array_elements(v_history) with ordinality h(value, n)
                 where h.n <= 10),
    'candidates', v_out,
    'excluded', jsonb_build_object('out_of_assortment', v_ex_assort, 'unavailable', v_ex_stock),
    'thresholds', jsonb_build_object(
      'history_days', 365, 'co_purchase_days', 180, 'co_orders_min', 2,
      'popularity_days', 90, 'per_kind', 5));
end;
$fn$;

revoke execute on function public.ai_assortment_facts(uuid, uuid) from public, anon;
grant  execute on function public.ai_assortment_facts(uuid, uuid) to authenticated, service_role;

comment on function public.ai_assortment_facts(uuid, uuid) is
  'Fase 07 IA: candidatos de surtido (reposicion, venta cruzada, complemento) calculados en SQL sobre productos publicados, autorizados y sin rotura conocida. Security invoker, roles de quotes, cartera.';
