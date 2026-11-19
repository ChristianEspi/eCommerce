-- =============================================================================
-- IA · Pedido desde foto, PDF o texto libre (2026-11-19)
--
-- ## Qué añade
--
--  1. La funcionalidad `intake` en el registro de IA (las cuatro funciones de
--     `ebim.ai_*`). Copia literal de la definición vigente (20260922160000 y,
--     para el módulo, 20260921120000) con `intake` añadida.
--  2. `public.ai_intake_check(slug)`: el freno POR COMPRADOR. El de la tienda
--     (`ai_consume_for_store`, 300/h) protege la cuota de la sociedad de un
--     bucle anónimo; este impide que UNA sesión se coma ese techo entero
--     subiendo fotos. Leer una foto cuesta varias veces lo que una búsqueda.
--
-- ## Lo que NO hace
--
-- No resuelve productos ni toca carritos. La IA solo LEE la lista; el producto
-- lo decide el buscador del catálogo y el precio, el surtido, la existencia y
-- el crédito los sigue aplicando el carrito de siempre.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Registro
-- ---------------------------------------------------------------------------
create or replace function ebim.ai_features()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array[
    'assistant', 'intake', 'catalog.copy', 'insights',
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
    -- Ayudar a comprar en la tienda, como el asistente: misma capacidad.
    when 'intake'       then 'ai.assist'
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
    when 'copilot'      then 'ai.insights'
    -- Redactar contenido publicable (siempre como borrador).
    when 'content'      then 'ai.content'
    when 'promotions'   then 'ai.content'
    when 'reviews'      then 'ai.content'
  end;
$fn$;

create or replace function ebim.ai_module_capability_for(p_feature text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case btrim(coalesce(p_feature, ''))
    when 'assistant'    then 'storefront'
    when 'intake'       then 'storefront'
    when 'catalog.copy' then 'catalog'
    when 'insights'     then 'analytics.basic'
    when 'orders'       then 'orders'
    when 'inventory'    then 'inventory.multiwarehouse'
    when 'planning'     then 'planning.demand'
    when 'customers'    then 'customers'
    when 'sales'        then 'sales.force'
    when 'quotes'       then 'trade.quotes'
    when 'credit'       then 'credit.management'
    when 'payments'     then 'payments'
    when 'fulfillment'  then 'fulfillment'
    when 'content'      then 'content.cms'
    when 'promotions'   then 'promotions'
    when 'reviews'      then 'catalog'
  end;
$fn$;

create or replace function ebim.ai_feature_roles(p_feature text)
returns public.app_role[]
language sql
immutable
set search_path = ''
as $fn$
  select (case btrim(coalesce(p_feature, ''))
    when 'assistant'    then array['owner','admin']
    -- Por JWT: quien toma pedidos de un cliente en el backoffice. En la
    -- vitrina mide la tienda (`ai_consume_for_store`) y esto no aplica.
    when 'intake'       then array['owner','admin','orders','sales_rep']
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
    when 'copilot'      then array['owner','admin','catalog','orders','viewer','sales_rep']
  end)::public.app_role[];
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · El freno por comprador
-- ---------------------------------------------------------------------------
create or replace function public.ai_intake_check(p_store_slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := ebim.user_id();
  v_store   public.stores%rowtype;
  v_surface text;
begin
  -- Exige SESIÓN: el SKU no es público (20260914120000) y una lectura anónima
  -- de fotos es la forma más cara de gastar la cuota de otro.
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'SIN_SESION');
  end if;

  select * into v_store from public.stores s
   where lower(s.slug) = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'TIENDA_NO_DISPONIBLE');
  end if;

  -- La superficie lleva a la persona: el techo es por comprador y por tienda.
  -- Un resumen y no el id: `public_rate_events` es un contador, no una
  -- bitácora, y su formato (`^[a-z][a-z0-9_.]{2,60}$`) no admite el uuid.
  v_surface := 'ai.intake.' || left(md5(v_uid::text), 24);
  if ebim.public_rate_exceeded(v_store.id, v_surface, 30) then
    return jsonb_build_object('allowed', false, 'reason', 'RATE_LIMITED');
  end if;
  perform ebim.public_rate_record(v_store.id, v_surface, 1, 30);

  return jsonb_build_object('allowed', true);
end;
$fn$;

revoke execute on function public.ai_intake_check(text) from public, anon;
grant  execute on function public.ai_intake_check(text) to authenticated;

comment on function public.ai_intake_check(text) is
  'Freno por comprador del pedido desde foto/PDF (30/h por sesión y tienda). Exige sesión. No consume cuota de IA: eso lo hace ai_consume_for_store.';
