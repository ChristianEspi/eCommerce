-- =============================================================================
-- IA · Medir resultados (2026-11-19)
--
-- ## Dos preguntas que el comercio se hace y la pantalla no contestaba
--
--  1. **¿Funcionó la campaña?** `promotion_impact(promo)` compara las ventas de
--     los productos de la campaña DURANTE su vigencia con el mismo número de
--     días justo ANTES, y suma los canjes y el descuento dado. Determinista.
--  2. **¿Qué vendió la IA?** Cuando un comprador pasa al carrito líneas que leyó
--     la IA (pedido desde foto/PDF/texto) o que propuso el asistente, la vitrina
--     lo ANOTA (`ai_attribution_mark`). `ai_value_summary(store, días)` suma lo
--     que ese mismo comprador (por correo de la sesión) pidió de ESOS productos
--     en los 7 días siguientes, más las acciones de la IA ejecutadas.
--
-- ## Lo que la atribución NO dice, y se dice
--
-- Es una atribución de «último contacto» acotada: producto anotado + mismo
-- correo + 7 días. No afirma que sin la IA no se habría vendido; dice cuánto se
-- vendió de lo que llegó al carrito con ayuda de la IA. La pantalla lo explica
-- con esas palabras.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Impacto de una campaña
-- ---------------------------------------------------------------------------
create or replace function public.promotion_impact(p_promotion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_promo   public.promotions%rowtype;
  v_desde   timestamptz;
  v_hasta   timestamptz;
  v_largo   interval;
  v_todos   boolean;
  v_parcial boolean;
  v_ids     uuid[];
  v_durante jsonb;
  v_antes   jsonb;
  v_canjes  jsonb;
begin
  select * into v_promo from public.promotions p where p.id = p_promotion_id;
  if v_promo.id is null or not ebim.can_access(v_promo.organization_id, v_promo.company_id) then
    raise exception 'CAMPANA_NO_ENCONTRADA: no hay ninguna campana con ese id' using errcode = '22023';
  end if;
  if not ebim.has_role(v_promo.organization_id, v_promo.company_id,
                       array['owner','admin','orders','viewer']::public.app_role[]) then
    raise exception 'SIN_PERMISO: ver el impacto exige rol de lectura de ventas' using errcode = '42501';
  end if;

  v_desde := v_promo.valid_from;
  v_hasta := least(now(), coalesce(v_promo.valid_to, now()));
  if v_hasta <= v_desde then
    return jsonb_build_object('promotion_id', v_promo.id, 'started', false);
  end if;
  v_largo := v_hasta - v_desde;

  -- Alcance medible: productos, variantes o toda la tienda. Categorías y marcas
  -- quedan fuera de esta versión y se dice (`partial_scope`).
  select coalesce(bool_or(s.scope_kind = 'all' and not s.is_exclusion), false),
         coalesce(bool_or(s.scope_kind in ('category', 'brand')), false),
         array_agg(distinct s.product_id) filter (where s.product_id is not null and not s.is_exclusion)
    into v_todos, v_parcial, v_ids
    from public.promotion_scopes s where s.promotion_id = v_promo.id;

  select jsonb_build_object('units', coalesce(sum(i.quantity), 0), 'revenue', coalesce(sum(i.line_total), 0),
                            'orders', count(distinct o.id))
    into v_durante
    from public.orders o join public.order_items i on i.order_id = o.id
   where o.store_id = v_promo.store_id
     and o.status::text not in ('cancelled', 'refunded')
     and o.placed_at >= v_desde and o.placed_at < v_hasta
     and (v_todos or i.product_id = any (coalesce(v_ids, '{}'::uuid[])));

  select jsonb_build_object('units', coalesce(sum(i.quantity), 0), 'revenue', coalesce(sum(i.line_total), 0),
                            'orders', count(distinct o.id))
    into v_antes
    from public.orders o join public.order_items i on i.order_id = o.id
   where o.store_id = v_promo.store_id
     and o.status::text not in ('cancelled', 'refunded')
     and o.placed_at >= v_desde - v_largo and o.placed_at < v_desde
     and (v_todos or i.product_id = any (coalesce(v_ids, '{}'::uuid[])));

  select jsonb_build_object('count', count(*), 'discount', coalesce(sum(r.discount_amount), 0))
    into v_canjes
    from public.promotion_redemptions r where r.promotion_id = v_promo.id;

  return jsonb_build_object(
    'promotion_id', v_promo.id,
    'started', true,
    'from', v_desde,
    'to', v_hasta,
    'days', round((extract(epoch from v_largo) / 86400)::numeric, 1),
    'partial_scope', v_parcial,
    'during', v_durante,
    'before', v_antes,
    'redemptions', v_canjes,
    -- Variación de unidades; null si antes no hubo nada con qué comparar.
    'units_change_pct', case when (v_antes ->> 'units')::numeric > 0
      then round((((v_durante ->> 'units')::numeric - (v_antes ->> 'units')::numeric)
                  / (v_antes ->> 'units')::numeric) * 100, 1) end);
end;
$fn$;

revoke execute on function public.promotion_impact(uuid) from public, anon;
grant  execute on function public.promotion_impact(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Atribución: lo que llegó al carrito con ayuda de la IA
-- ---------------------------------------------------------------------------
create table if not exists public.ai_cart_attributions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  company_id      uuid        not null,
  store_id        uuid        not null,
  -- El correo de la SESIÓN, en minúsculas. Es con lo que se casa el pedido.
  buyer_email     text        not null,
  product_id      uuid        not null,
  source          text        not null,
  created_at      timestamptz not null default now(),
  constraint ai_cart_attributions_source check (source in ('intake', 'assistant')),
  constraint ai_cart_attributions_store_fk foreign key (store_id, organization_id, company_id)
    references public.stores (id, organization_id, company_id) on delete cascade,
  -- La publicación en la tienda (`store_products`): desde el maestro
  -- (20260917190000) es lo que dice que un producto se vende AQUÍ.
  constraint ai_cart_attributions_product_fk foreign key (product_id, store_id)
    references public.store_products (product_id, store_id) on delete cascade
);

create index if not exists ai_cart_attributions_tenant_idx
  on public.ai_cart_attributions (organization_id, company_id, store_id, created_at desc);

alter table public.ai_cart_attributions enable row level security;
alter table public.ai_cart_attributions force  row level security;
-- Ni lectura ni escritura directa: se anota por comando y se lee agregado.
revoke all on public.ai_cart_attributions from public, anon, authenticated;
grant all on public.ai_cart_attributions to service_role;

create or replace function public.ai_attribution_mark(
  p_store_slug  text,
  p_product_ids uuid[],
  p_source      text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(ebim.email(), '')));
  v_store public.stores%rowtype;
  v_n     integer;
begin
  -- Sin sesión no hay a quién atribuir. No es un error: no se anota.
  if ebim.user_id() is null or position('@' in v_email) <= 1 then
    return 0;
  end if;
  if p_source not in ('intake', 'assistant') then
    raise exception 'ORIGEN_INVALIDO: intake o assistant' using errcode = '22023';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_product_ids) > 100 then
    raise exception 'DEMASIADOS_PRODUCTOS: como mucho 100' using errcode = '22023';
  end if;

  select * into v_store from public.stores s
   where lower(s.slug) = lower(btrim(coalesce(p_store_slug, ''))) and s.status = 'active';
  if not found then
    return 0;
  end if;

  insert into public.ai_cart_attributions (organization_id, company_id, store_id, buyer_email, product_id, source)
  select distinct v_store.organization_id, v_store.company_id, v_store.id, v_email, sp.product_id, p_source
    from public.store_products sp
   where sp.product_id = any (p_product_ids) and sp.store_id = v_store.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke execute on function public.ai_attribution_mark(text, uuid[], text) from public, anon;
grant  execute on function public.ai_attribution_mark(text, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · El valor de la IA, agregado
-- ---------------------------------------------------------------------------
create or replace function public.ai_value_summary(p_store_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores%rowtype;
  v_dias  integer := least(greatest(coalesce(p_days, 30), 7), 180);
  v_desde timestamptz;
  v_out   jsonb;
begin
  select * into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null or not ebim.can_access(v_store.organization_id, v_store.company_id) then
    raise exception 'TIENDA_NO_DISPONIBLE: la tienda no es de esta sociedad' using errcode = '22023';
  end if;
  if not ebim.has_role(v_store.organization_id, v_store.company_id, array['owner','admin']::public.app_role[]) then
    raise exception 'SIN_PERMISO: el valor de la IA es de administracion' using errcode = '42501';
  end if;
  v_desde := now() - make_interval(days => v_dias);

  with marcas as (
    select a.buyer_email, a.product_id, a.source, a.created_at
      from public.ai_cart_attributions a
     where a.store_id = v_store.id and a.created_at >= v_desde
  ),
  lineas as (
    -- Cada línea de pedido cuenta UNA vez, con la marca más reciente anterior.
    select distinct on (i.id) i.id, i.line_total, o.currency, o.id as order_id, m.source
      from public.orders o
      join public.order_items i on i.order_id = o.id
      join marcas m on m.product_id = i.product_id
                   and m.buyer_email = lower(o.customer_email)
                   and o.placed_at >= m.created_at
                   and o.placed_at < m.created_at + interval '7 days'
     where o.store_id = v_store.id
       and o.status::text not in ('cancelled', 'refunded')
     order by i.id, m.created_at desc
  )
  select jsonb_build_object(
    'days', v_dias,
    'currency', (select case when count(distinct currency) <= 1 then max(currency) end from lineas),
    'attributed_revenue', (select case when count(distinct currency) <= 1 then coalesce(sum(line_total), 0) end from lineas),
    'attributed_orders', (select count(distinct order_id) from lineas),
    'by_source', jsonb_build_object(
      'intake', (select coalesce(sum(line_total), 0) from lineas where source = 'intake'),
      'assistant', (select coalesce(sum(line_total), 0) from lineas where source = 'assistant')),
    'marked_lines', (select count(*) from marcas),
    'actions_executed', (select count(*) from public.ai_action_proposals p
                          where p.organization_id = v_store.organization_id and p.company_id = v_store.company_id
                            and p.status = 'executed' and p.decided_at >= v_desde),
    'actions_pending', (select count(*) from public.ai_action_proposals p
                          where p.organization_id = v_store.organization_id and p.company_id = v_store.company_id
                            and p.status = 'pending' and p.expires_at > now())
  ) into v_out;
  return v_out;
end;
$fn$;

revoke execute on function public.ai_value_summary(uuid, integer) from public, anon;
grant  execute on function public.ai_value_summary(uuid, integer) to authenticated;

select platform_lifecycle.ensure_guards();
