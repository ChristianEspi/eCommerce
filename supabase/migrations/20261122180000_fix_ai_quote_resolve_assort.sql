-- =============================================================================
-- Arreglo · `ai_quote_resolve` fallaba con 500 si el cliente NO quedaba resuelto.
--
-- `v_assort` (record) solo se asignaba con un cliente resuelto, pero el
-- `return` final lo leía siempre dentro de un `case`. PL/pgSQL resuelve los
-- campos del record ANTES de evaluar el `case`, así que con el cliente
-- ausente, no encontrado o ambiguo saltaba «record "v_assort" is not assigned
-- yet» (55000) y la pantalla «Cotizar con IA» mostraba «No se pudo contactar
-- con el asistente», escribiera lo que escribiera la persona.
--
-- Cambio: el surtido se guarda en escalares inicializados a NULL. Misma firma,
-- mismo resultado, mismos permisos.
-- =============================================================================

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
  v_assort_id  uuid;
  v_assort_nm  text;
  v_assort_al  boolean;
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
    select a.id, left(a.name, 120), a.is_allow_list
      into v_assort_id, v_assort_nm, v_assort_al
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
                              'configured', v_assort_id is not null,
                              'name', v_assort_nm,
                              'is_allow_list', v_assort_al) end,
    'lines', v_lines);
end;
$fn$;

revoke execute on function public.ai_quote_resolve(uuid, uuid, text, jsonb) from public, anon;
grant  execute on function public.ai_quote_resolve(uuid, uuid, text, jsonb) to authenticated, service_role;

comment on function public.ai_quote_resolve(uuid, uuid, text, jsonb) is
  'Fase 07 IA: texto interpretado → candidatos REALES de cliente (cartera) y producto (publicado, surtido). Ambiguo ⇒ candidatos, nunca una elección. Security invoker, roles de quotes.';
