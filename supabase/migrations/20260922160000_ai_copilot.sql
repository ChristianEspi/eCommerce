-- =============================================================================
-- EBIM Copilot global (EBIM_AI_SEQUENCE, fase 11).
--
-- El Copilot NO es un chatbot con acceso a la base: es una capa de
-- HERRAMIENTAS de solo lectura con parámetros tipados. El modelo elige
-- herramienta y parámetros de una lista cerrada; la Edge Function `copilot`
-- las ejecuta con el JWT de quien pregunta, y cada herramienta es una función
-- SQL SECURITY INVOKER + STABLE con su propio guard. El modelo nunca recibe
-- SQL, credenciales ni `service_role`.
--
--  1. Funcionalidad `copilot` en el registro (capacidad `ai.insights`, sin
--     módulo propio: cada herramienta exige el suyo; todos los roles del
--     backoffice pueden GASTAR cuota, pero cada herramienta solo existe para
--     los roles de su funcionalidad de origen).
--  2. `ebim.ai_copilot_tool_feature(tool)`: herramienta → funcionalidad de la
--     que hereda roles y módulo. Copia de `COPILOT_TOOLS` (`_shared/aiCopilot.ts`).
--  3. `public.ai_copilot_tools()`: qué herramientas puede usar ESTA persona en
--     ESTA sociedad (rol + módulo). La Edge Function solo ofrece al modelo esas.
--  4. Datasets nuevos (los demás se reutilizan tal cual):
--     - `ai_copilot_products(store, texto, estado, límite≤10)`
--     - `ai_copilot_product(producto, tienda)`
--     - `ai_copilot_sales_facts(store, días ∈ 7/14/30/90)`
--     Reutilizadas: `ai_dashboard_facts`, `ai_orders_search`, `ai_order_facts`,
--     `ai_orders_attention`, `ai_inventory_facts`, `ai_customer_facts`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Registro: funcionalidad `copilot`
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_features()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array[
    'assistant', 'catalog.copy', 'insights',
    'orders', 'inventory', 'planning', 'customers', 'sales', 'quotes',
    'credit', 'payments', 'fulfillment', 'operations', 'integrations',
    'content', 'promotions', 'reviews',
    'copilot'
  ]::text[];
$fn$;

create or replace function ebim.ai_capability_for(p_feature text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case btrim(coalesce(p_feature, ''))
    when 'assistant'    then 'ai.assist'
    when 'catalog.copy' then 'ai.catalog.copy'
    -- Explicar lo que YA calculó la base: análisis y alertas.
    when 'insights'     then 'ai.insights'
    when 'orders'       then 'ai.insights'
    when 'inventory'    then 'ai.insights'
    when 'planning'     then 'ai.insights'
    when 'customers'    then 'ai.insights'
    when 'sales'        then 'ai.insights'
    when 'quotes'       then 'ai.insights'
    when 'credit'       then 'ai.insights'
    when 'payments'     then 'ai.insights'
    when 'fulfillment'  then 'ai.insights'
    when 'operations'   then 'ai.insights'
    when 'integrations' then 'ai.insights'
    -- El Copilot explica datos que ya calcularon las herramientas: análisis.
    when 'copilot'      then 'ai.insights'
    -- Redactar contenido publicable (siempre como borrador).
    when 'content'      then 'ai.content'
    when 'promotions'   then 'ai.content'
    when 'reviews'      then 'ai.content'
  end;
$fn$;

-- `ai_module_capability_for` no cambia: `copilot` no tiene módulo propio (cae
-- en `null`, igual que operaciones e integraciones). El módulo lo exige cada
-- herramienta.

create or replace function ebim.ai_feature_roles(p_feature text)
returns public.app_role[]
language sql
immutable
set search_path = ''
as $fn$
  select (case btrim(coalesce(p_feature, ''))
    when 'assistant'    then array['owner','admin']
    when 'catalog.copy' then array['owner','admin','catalog']
    when 'insights'     then array['owner','admin']
    when 'orders'       then array['owner','admin','orders','viewer']
    when 'inventory'    then array['owner','admin','catalog','orders','viewer']
    when 'planning'     then array['owner','admin','catalog','orders']
    when 'customers'    then array['owner','admin','orders','viewer','sales_rep']
    when 'sales'        then array['owner','admin','sales_rep']
    when 'quotes'       then array['owner','admin','orders','sales_rep']
    when 'credit'       then array['owner','admin']
    when 'payments'     then array['owner','admin','orders']
    when 'fulfillment'  then array['owner','admin','orders']
    when 'operations'   then array['owner','admin']
    when 'integrations' then array['owner','admin']
    when 'content'      then array['owner','admin']
    when 'promotions'   then array['owner','admin']
    when 'reviews'      then array['owner','admin','catalog']
    -- Cualquier rol del backoffice puede preguntar; lo que obtiene lo decide
    -- cada herramienta con los roles de SU funcionalidad.
    when 'copilot'      then array['owner','admin','catalog','orders','viewer','sales_rep']
  end)::public.app_role[];
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Herramientas: lista cerrada y funcionalidad de origen
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_copilot_tool_ids()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array[
    'dashboard_summary', 'sales_summary',
    'search_orders', 'order_detail', 'orders_attention',
    'search_products', 'product_detail',
    'inventory_summary', 'customer_summary'
  ]::text[];
$fn$;

/**
 * De qué funcionalidad hereda roles y módulo cada herramienta. Una
 * herramienta del Copilot nunca ve más que la IA de su módulo.
 */
create or replace function ebim.ai_copilot_tool_feature(p_tool text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case btrim(coalesce(p_tool, ''))
    when 'dashboard_summary' then 'insights'
    when 'sales_summary'     then 'insights'
    when 'search_orders'     then 'orders'
    when 'order_detail'      then 'orders'
    when 'orders_attention'  then 'orders'
    -- Productos: los mismos que usan la IA del catálogo (owner, admin, catalog).
    when 'search_products'   then 'catalog.copy'
    when 'product_detail'    then 'catalog.copy'
    when 'inventory_summary' then 'inventory'
    when 'customer_summary'  then 'customers'
  end;
$fn$;

revoke execute on function ebim.ai_copilot_tool_ids()           from public, anon;
revoke execute on function ebim.ai_copilot_tool_feature(text)   from public, anon;
grant  execute on function ebim.ai_copilot_tool_ids()           to authenticated, service_role;
grant  execute on function ebim.ai_copilot_tool_feature(text)   to authenticated, service_role;

/**
 * Las herramientas que ESTA persona puede usar en la sociedad ACTIVA del
 * token. Security invoker: no concede nada, solo describe; cada herramienta
 * vuelve a comprobar rol y módulo al ejecutarse.
 */
create or replace function public.ai_copilot_tools()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_org     uuid := ebim.org_id();
  v_company uuid := ebim.active_company();
  v_tool    text;
  v_feature text;
  v_module  text;
  v_reason  text;
  v_tools   jsonb := '[]'::jsonb;
begin
  if v_org is null or v_company is null or not ebim.can_access(v_org, v_company) then
    raise exception 'SIN_PERMISO: el token no trae la jerarquia de tenant' using errcode = '42501';
  end if;

  foreach v_tool in array ebim.ai_copilot_tool_ids() loop
    v_feature := ebim.ai_copilot_tool_feature(v_tool);
    v_module  := ebim.ai_module_capability_for(v_feature);
    v_reason  := null;
    if not ebim.has_role(v_org, v_company, ebim.ai_feature_roles(v_feature)) then
      v_reason := 'SIN_PERMISO';
    elsif v_module is not null and not ebim.company_is_entitled(v_org, v_company, v_module) then
      v_reason := 'MODULO_NO_CONTRATADO';
    end if;
    v_tools := v_tools || jsonb_build_array(jsonb_build_object(
      'tool',      v_tool,
      'feature',   v_feature,
      'available', v_reason is null,
      'reason',    v_reason
    ));
  end loop;

  return jsonb_build_object('tools', v_tools);
end;
$fn$;

revoke execute on function public.ai_copilot_tools() from public, anon;
grant  execute on function public.ai_copilot_tools() to authenticated, service_role;

comment on function public.ai_copilot_tools() is
  'Copilot (fase 11): herramientas de solo lectura disponibles para quien llama (rol + modulo). Security invoker.';

-- ---------------------------------------------------------------------------
-- 3 · Productos: búsqueda acotada
-- ---------------------------------------------------------------------------
create or replace function public.ai_copilot_products(
  p_store_id uuid,
  p_text     text    default null,
  p_status   text    default null,
  p_limit    integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_text   text := nullif(left(btrim(coalesce(p_text, '')), 60), '');
  v_like   text;
  v_limit  integer := greatest(1, least(coalesce(p_limit, 10), 10));
  v_rows   jsonb;
  v_total  bigint;
  v_counts jsonb;
begin
  perform ebim.assert_ai_feature_reader('catalog.copy', 'catalog');
  perform ebim.assert_ai_orders_store(p_store_id);

  if p_status is not null and p_status not in ('draft', 'published', 'archived') then
    raise exception 'FILTRO_INVALIDO: estado de producto desconocido' using errcode = '22023';
  end if;

  -- Comodines escapados: el texto es un literal, nunca un patrón.
  if v_text is not null then
    v_like := '%' || replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select count(*) into v_total
    from public.admin_store_products sp
   where sp.store_id = p_store_id
     and (p_status is null or sp.status::text = p_status)
     and (v_like is null or sp.name ilike v_like escape '\' or sp.sku ilike v_like escape '\');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               x.product_id,
           'sku',              left(x.sku, 60),
           'name',             left(x.name, 120),
           'status',           x.status::text,
           'category_name',    left(x.category_name, 80),
           'brand_name',       left(x.brand_name, 80),
           'price',            x.price::text,
           'compare_at_price', x.compare_at_price::text,
           'currency',         x.currency::text,
           'days_since_update', greatest(0, (current_date - x.updated_at::date))
         ) order by x.updated_at desc, x.product_id), '[]'::jsonb)
    into v_rows
    from (
      select sp.*
        from public.admin_store_products sp
       where sp.store_id = p_store_id
         and (p_status is null or sp.status::text = p_status)
         and (v_like is null or sp.name ilike v_like escape '\' or sp.sku ilike v_like escape '\')
       order by sp.updated_at desc, sp.product_id
       limit v_limit
    ) x;

  select jsonb_build_object(
           'total',     count(*),
           'published', count(*) filter (where sp.status = 'published'),
           'draft',     count(*) filter (where sp.status = 'draft'),
           'archived',  count(*) filter (where sp.status = 'archived')
         )
    into v_counts
    from public.admin_store_products sp
   where sp.store_id = p_store_id;

  return jsonb_build_object(
    'generated_at', now(),
    'total',        v_total,
    'limit',        v_limit,
    'counts',       v_counts,
    'rows',         v_rows
  );
end;
$fn$;

revoke execute on function public.ai_copilot_products(uuid, text, text, integer) from public, anon;
grant  execute on function public.ai_copilot_products(uuid, text, text, integer) to authenticated, service_role;

comment on function public.ai_copilot_products(uuid, text, text, integer) is
  'Copilot (fase 11): productos de la tienda (<=10) por texto literal y estado, con conteos. Roles de catalog.copy + modulo catalog. Security invoker, solo lectura.';

-- ---------------------------------------------------------------------------
-- 4 · Un producto: ficha reducida
-- ---------------------------------------------------------------------------
create or replace function public.ai_copilot_product(p_product_id uuid, p_store_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_p        record;
  v_variants bigint;
  v_images   bigint;
  v_reviews  jsonb;
begin
  perform ebim.assert_ai_feature_reader('catalog.copy', 'catalog');
  perform ebim.assert_ai_orders_store(p_store_id);

  select sp.product_id, sp.sku, sp.name, sp.kind, sp.status, sp.category_name, sp.brand_name,
         sp.price, sp.compare_at_price, sp.currency, sp.published_at, sp.updated_at,
         p.description
    into v_p
    from public.admin_store_products sp
    join public.products p on p.id = sp.product_id
   where sp.store_id = p_store_id
     and sp.product_id = p_product_id;

  -- Invisible o de otra tienda/sociedad: NULL (404), nunca «existe pero es ajeno».
  if not found then
    return null;
  end if;

  select count(*) into v_variants from public.product_variants v where v.product_id = p_product_id;
  select count(*) into v_images   from public.product_images   i where i.product_id = p_product_id;

  select jsonb_build_object(
           'published', count(*) filter (where r.status = 'published'),
           'pending',   count(*) filter (where r.status = 'pending'),
           'avg_rating', case when count(*) filter (where r.status = 'published') > 0 then
             round(avg(r.rating) filter (where r.status = 'published'), 2)::text end
         )
    into v_reviews
    from public.product_reviews r
   where r.product_id = p_product_id and r.store_id = p_store_id;

  return jsonb_build_object(
    'generated_at', now(),
    'product', jsonb_build_object(
      'id',               v_p.product_id,
      'sku',              left(v_p.sku, 60),
      'name',             left(v_p.name, 120),
      'kind',             v_p.kind::text,
      'status',           v_p.status::text,
      'category_name',    left(v_p.category_name, 80),
      'brand_name',       left(v_p.brand_name, 80),
      'price',            v_p.price::text,
      'compare_at_price', v_p.compare_at_price::text,
      'currency',         v_p.currency::text,
      'has_description',  coalesce(char_length(btrim(v_p.description)), 0) > 0,
      'days_since_update', greatest(0, (current_date - v_p.updated_at::date)),
      'days_since_published', case when v_p.published_at is not null
        then greatest(0, (current_date - v_p.published_at::date)) end,
      'variants',         v_variants,
      'images',           v_images
    ),
    'reviews', v_reviews
  );
end;
$fn$;

revoke execute on function public.ai_copilot_product(uuid, uuid) from public, anon;
grant  execute on function public.ai_copilot_product(uuid, uuid) to authenticated, service_role;

comment on function public.ai_copilot_product(uuid, uuid) is
  'Copilot (fase 11): ficha reducida de un producto de la tienda (sin descripcion completa). NULL si no es visible. Security invoker, solo lectura.';

-- ---------------------------------------------------------------------------
-- 5 · Ventas: ventana frente a la anterior, con los KPIs de analítica
-- ---------------------------------------------------------------------------
create or replace function public.ai_copilot_sales_facts(p_store_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now  timestamptz := now();
  v_cur  jsonb;
  v_prev jsonb;
  v_top  jsonb;
  v_g_cur  numeric;
  v_g_prev numeric;
  v_o_cur  numeric;
  v_o_prev numeric;
begin
  perform ebim.assert_ai_feature_reader('insights', 'analytics.basic');
  perform ebim.assert_ai_orders_store(p_store_id);

  if p_days is null or p_days not in (7, 14, 30, 90) then
    raise exception 'CAMPO_INVALIDO: la ventana debe ser 7, 14, 30 o 90 dias' using errcode = '22023';
  end if;

  -- La MISMA autoridad que la pantalla de analítica (sin cancelados, dinero
  -- como texto, NULL con monedas mezcladas).
  v_cur  := public.analytics_kpis(p_store_id, v_now - make_interval(days => p_days), v_now);
  v_prev := public.analytics_kpis(p_store_id, v_now - make_interval(days => p_days * 2), v_now - make_interval(days => p_days));

  v_g_cur  := nullif(v_cur  ->> 'gross_sales', '')::numeric;
  v_g_prev := nullif(v_prev ->> 'gross_sales', '')::numeric;
  v_o_cur  := (v_cur  ->> 'orders')::numeric;
  v_o_prev := (v_prev ->> 'orders')::numeric;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sku',      left(t.sku, 60),
           'name',     left(t.name, 120),
           'units',    t.units,
           'revenue',  t.revenue,
           'currency', t.currency
         )), '[]'::jsonb)
    into v_top
    from public.analytics_top_products(p_store_id, v_now - make_interval(days => p_days), v_now, 5) t;

  return jsonb_build_object(
    'generated_at', v_now,
    'days',         p_days,
    'currency',     v_cur ->> 'currency',
    'current', jsonb_build_object(
      'gross_sales',    v_cur ->> 'gross_sales',
      'paid_sales',     v_cur ->> 'paid_sales',
      'orders',         (v_cur ->> 'orders')::bigint,
      'units',          (v_cur ->> 'units')::bigint,
      'average_ticket', v_cur ->> 'average_ticket',
      'conversion_rate', v_cur ->> 'conversion_rate'
    ),
    'previous', jsonb_build_object(
      'gross_sales',    v_prev ->> 'gross_sales',
      'orders',         (v_prev ->> 'orders')::bigint,
      'average_ticket', v_prev ->> 'average_ticket'
    ),
    -- Variaciones calculadas AQUÍ: el modelo no compara cifras.
    'gross_delta_pct', case when v_g_cur is not null and v_g_prev is not null and v_g_prev > 0
      then round((v_g_cur - v_g_prev) / v_g_prev * 100, 1)::text end,
    'orders_delta_pct', case when v_o_prev > 0
      then round((v_o_cur - v_o_prev) / v_o_prev * 100, 1)::text end,
    'top_products', v_top
  );
end;
$fn$;

revoke execute on function public.ai_copilot_sales_facts(uuid, integer) from public, anon;
grant  execute on function public.ai_copilot_sales_facts(uuid, integer) to authenticated, service_role;

comment on function public.ai_copilot_sales_facts(uuid, integer) is
  'Copilot (fase 11): ventas de la ventana (7/14/30/90 d) frente a la anterior con analytics_kpis y top 5. Roles de insights + analytics.basic. Security invoker, solo lectura.';
