-- =============================================================================
-- Promociones, CMS y reseñas con IA (EBIM_AI_SEQUENCE, fase 09) — DATASETS.
--
-- Dos funciones, lo ÚNICO que ve el modelo en Promociones y Reseñas:
--
--   public.ai_promotion_facts(p_promotion_id)                         una promoción
--   public.ai_reviews_facts(p_store_id, p_product_id?, p_review_id?)  reseñas
--
-- El CMS no necesita dataset: redacta sobre lo que la persona está escribiendo
-- en el formulario (su propio borrador) y la Edge Function solo comprueba por
-- RLS que la página o el bloque existen y son de la sociedad.
--
-- ## CÁLCULO DEL SISTEMA, aquí; REDACCIÓN IA, fuera
--
-- Las REGLAS de la promoción (tipo, porcentaje, importe, tope, mínimos, lleva /
-- paga, vigencia, límites de uso, cupón, exclusividad) salen de la tabla tal
-- cual: el modelo las cita por marcador y redacta nombre, descripción, copy y
-- términos resumidos. NO propone valores de descuento ni cambia reglas: el
-- motor (`ebim.evaluate_promotions` / `apply_promotions`) sigue siendo la
-- autoridad y la persona guarda con el formulario de siempre.
--
-- Los CANDIDATOS (productos más vendidos o sin venta reciente, segmentos
-- activos que aún no son audiencia) los elige SQL con reglas declaradas en
-- `thresholds`; el modelo solo puede priorizar entre ellos. Añadirlos al
-- alcance o a la audiencia es el control de siempre, pulsado por una persona.
--
-- En reseñas, conteos, media, reparto por estrellas, tono por estrellas
-- (4–5 positivo, 3 neutro, 1–2 negativo) y marcas por reseña (`low_rating`,
-- `pending_stale`, `contact_like`, `unverified_negative`) son de SQL. El
-- modelo resume temas y señala reseñas a revisar DE LA MUESTRA; nunca publica,
-- rechaza, oculta, borra ni responde (no existe ningún camino de escritura).
--
-- ## Reglas comunes (las de las fases 02–08)
--
--  1. SECURITY INVOKER + STABLE: RLS de quien llama, solo lectura. Filtradas
--     además por la sociedad ACTIVA del token.
--  2. Guard = roles de la funcionalidad + MÓDULO contratado
--     (`ebim.assert_ai_feature_reader`): `promotions` (owner, admin;
--     `promotions`), `reviews` (owner, admin, catalog; `catalog`). Tienda ajena
--     ⇒ `SIN_PERMISO`; entidad ajena o invisible ⇒ `NULL` (404).
--  3. DATOS MÍNIMOS: ni correos, ni ids de usuario, ni nombre para mostrar del
--     autor de una reseña, ni nombres de clientes o cuentas de una audiencia
--     (solo su tipo), ni códigos de cupón, ni precios ni existencias. Los
--     textos de clientes (título y cuerpo de una reseña) y los que escribió el
--     comercio (nombre y descripción actuales de la promoción) viajan
--     recortados como DATO NO CONFIABLE; la Edge Function los delimita.
--  4. Importes como TEXTO con dos decimales (regla del repositorio).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Una promoción: reglas, alcance, audiencia y candidatos
-- ---------------------------------------------------------------------------
-- Umbrales (se devuelven en `thresholds` y los repite `aiPromotions.ts`):
--   ventana de venta 90 d · «sin venta reciente»: publicado hace ≥ 30 d y sin
--   venta en 60 d · hasta 6 más vendidos y 6 sin venta reciente · hasta 8
--   segmentos activos que no son audiencia de la promoción.
create or replace function public.ai_promotion_facts(p_promotion_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now     timestamptz := now();
  v_org     uuid;
  v_company uuid;
  v_p       public.promotions%rowtype;
  v_store   public.stores%rowtype;
  v_result  jsonb;
begin
  perform ebim.assert_ai_feature_reader('promotions', 'promotions');
  v_org := ebim.org_id();
  v_company := ebim.active_company();

  if p_promotion_id is null then
    return null;
  end if;

  select p.* into v_p
    from public.promotions p
   where p.id = p_promotion_id
     and p.organization_id = v_org
     and p.company_id = v_company;
  if v_p.id is null then
    return null;
  end if;

  select s.* into v_store from public.stores s where s.id = v_p.store_id;

  with alcance as (
    select sc.scope_kind::text as scope_kind,
           sc.is_exclusion,
           sc.required_quantity,
           sc.product_id,
           left(coalesce(v.name, pr.name, c.name, b.name, ''), 120) as label
      from public.promotion_scopes sc
      left join public.product_variants v on v.id = sc.variant_id
      left join public.products pr on pr.id = coalesce(sc.product_id, v.product_id)
      left join public.categories c on c.id = sc.category_id
      left join public.brands b on b.id = sc.brand_id
     where sc.promotion_id = v_p.id
     order by sc.is_exclusion, sc.created_at
     limit 20
  ),
  ventas as (
    select i.product_id,
           sum(i.quantity) filter (where o.placed_at >= v_now - interval '90 days')::bigint as units_90d,
           max(o.placed_at) as last_sale
      from public.order_items i
      join public.orders o on o.id = i.order_id
     where i.store_id = v_p.store_id
       and i.product_id is not null
       and o.status::text not in ('cancelled', 'refunded')
     group by i.product_id
  ),
  -- Lo publicado en la tienda de la promoción (la publicación, ADR 018).
  publicados as (
    select pr.id, left(pr.name, 120) as name, sp.published_at,
           coalesce(ve.units_90d, 0) as units_90d,
           ve.last_sale
      from public.store_products sp
      join public.products pr on pr.id = sp.product_id
      left join ventas ve on ve.product_id = pr.id
     where sp.store_id = v_p.store_id
       and sp.status = 'published'
       and sp.published_at is not null
       and sp.published_at <= v_now
       and not exists (
         select 1 from public.promotion_scopes sc
          where sc.promotion_id = v_p.id
            and not sc.is_exclusion
            and sc.product_id = pr.id
       )
  ),
  mas_vendidos as (
    select p.*, 'top_seller'::text as reason
      from publicados p
     where p.units_90d > 0
     order by p.units_90d desc, p.name
     limit 6
  ),
  sin_venta as (
    select p.*, 'slow_mover'::text as reason
      from publicados p
     where p.published_at <= v_now - interval '30 days'
       and (p.last_sale is null or p.last_sale < v_now - interval '60 days')
       and p.id not in (select id from mas_vendidos)
     order by p.last_sale nulls first, p.name
     limit 6
  ),
  candidatos as (
    select * from mas_vendidos
    union all
    select * from sin_venta
  ),
  segmentos as (
    select sg.id, left(sg.name, 120) as name,
           (select count(*) from public.customers cu where cu.segment_id = sg.id)::int as customers
      from public.customer_segments sg
     where sg.organization_id = v_org
       and sg.company_id = v_company
       and sg.is_active
       and not exists (
         select 1 from public.promotion_audiences a
          where a.promotion_id = v_p.id and a.segment_id = sg.id
       )
     order by 3 desc, sg.name
     limit 8
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'thresholds', jsonb_build_object(
      'sales_window_days', 90, 'slow_mover_days', 60, 'slow_mover_min_age_days', 30,
      'top_sellers', 6, 'slow_movers', 6, 'segments', 8),
    'store', jsonb_build_object('currency', v_store.currency),
    'promotion', jsonb_build_object(
      'id', v_p.id,
      'name', left(v_p.name, 160),
      'description', left(coalesce(v_p.description, ''), 600),
      'kind', v_p.kind::text,
      'status', v_p.status::text,
      'requires_coupon', v_p.requires_coupon,
      'is_exclusive', v_p.is_exclusive,
      'value_percent', case when v_p.value_percent is null then null
                            else trim(trailing '.' from trim(trailing '0' from v_p.value_percent::text)) end,
      'value_amount', case when v_p.value_amount is null then null else to_char(v_p.value_amount, 'FM999999999990.00') end,
      'max_discount_amount', case when v_p.max_discount_amount is null then null
                                  else to_char(v_p.max_discount_amount, 'FM999999999990.00') end,
      'buy_quantity', case when v_p.buy_quantity is null then null
                           else trim(trailing '.' from trim(trailing '0' from v_p.buy_quantity::text)) end,
      'free_quantity', case when v_p.free_quantity is null then null
                            else trim(trailing '.' from trim(trailing '0' from v_p.free_quantity::text)) end,
      'min_subtotal', case when v_p.min_subtotal is null then null else to_char(v_p.min_subtotal, 'FM999999999990.00') end,
      'min_quantity', case when v_p.min_quantity is null then null
                           else trim(trailing '.' from trim(trailing '0' from v_p.min_quantity::text)) end,
      'usage_limit', v_p.usage_limit,
      'usage_limit_per_customer', v_p.usage_limit_per_customer,
      'usage_count', v_p.usage_count,
      'starts_in_days', case when v_p.valid_from > v_now
                             then ceil(extract(epoch from (v_p.valid_from - v_now)) / 86400)::int end,
      'ends_in_days', case when v_p.valid_to is null then null
                           when v_p.valid_to <= v_now then 0
                           else ceil(extract(epoch from (v_p.valid_to - v_now)) / 86400)::int end,
      'expired', v_p.valid_to is not null and v_p.valid_to <= v_now,
      'active_coupons', (select count(*) from public.coupons cp
                          where cp.promotion_id = v_p.id and cp.is_active)::int
    ),
    'tiers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'min_quantity', trim(trailing '.' from trim(trailing '0' from t.min_quantity::text)),
               'discount_percent', case when t.discount_percent is null then null
                                        else trim(trailing '.' from trim(trailing '0' from t.discount_percent::text)) end,
               'discount_amount', case when t.discount_amount is null then null
                                       else to_char(t.discount_amount, 'FM999999999990.00') end)
             order by t.min_quantity)
        from (select * from public.promotion_tiers t0 where t0.promotion_id = v_p.id
               order by t0.min_quantity limit 10) t), '[]'::jsonb),
    'scopes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'scope_kind', a.scope_kind,
               'is_exclusion', a.is_exclusion,
               'label', nullif(a.label, ''),
               'required_quantity', case when a.required_quantity is null then null
                                         else trim(trailing '.' from trim(trailing '0' from a.required_quantity::text)) end))
        from alcance a), '[]'::jsonb),
    -- Audiencia: canal y segmento con su nombre; cliente o cuenta, SOLO el tipo.
    'audiences', coalesce((
      select jsonb_agg(jsonb_build_object(
               'audience_kind', x.audience_kind::text,
               'label', case x.audience_kind::text
                          when 'channel' then left(ch.name, 120)
                          when 'segment' then left(sg.name, 120)
                          else null end))
        from (select * from public.promotion_audiences a0 where a0.promotion_id = v_p.id
               order by a0.created_at limit 10) x
        left join public.channels ch on ch.id = x.channel_id
        left join public.customer_segments sg on sg.id = x.segment_id), '[]'::jsonb),
    'candidate_products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', c.id,
               'name', c.name,
               'reason', c.reason,
               'units_90d', c.units_90d,
               'days_since_sale', case when c.last_sale is null then null
                                       else floor(extract(epoch from (v_now - c.last_sale)) / 86400)::int end))
        from candidatos c), '[]'::jsonb),
    'candidate_segments', coalesce((
      select jsonb_agg(jsonb_build_object('segment_id', s.id, 'name', s.name, 'customers', s.customers))
        from segmentos s), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

revoke execute on function public.ai_promotion_facts(uuid) from public, anon;
grant  execute on function public.ai_promotion_facts(uuid) to authenticated, service_role;

comment on function public.ai_promotion_facts(uuid) is
  'IA de promociones (fase 09): reglas de UNA promocion de la sociedad activa tal cual (texto), alcance y audiencia con etiquetas (sin clientes ni cuentas por nombre), candidatos por regla (mas vendidos / sin venta reciente, segmentos activos). Sin precios, existencias ni cupones. Security invoker, solo lectura; roles de promotions + modulo promotions.';

-- ---------------------------------------------------------------------------
-- 2 · Reseñas: resumen agregado, muestra y detalle
-- ---------------------------------------------------------------------------
-- Umbrales (se devuelven en `thresholds` y los repite `aiReviews.ts`):
--   ventana 180 d · negativa: 1–2 estrellas · pendiente estancada: > 3 d ·
--   muestra: las 40 más recientes de la ventana · cuerpo recortado a 600
--   caracteres (1500 en el detalle) · hasta 10 productos.
-- `contact_like`: el texto parece llevar un correo, un enlace o un teléfono
-- (arroba, `http`, `www.` o siete dígitos seguidos). No se envía el dato: se
-- marca para que una persona lo mire antes de publicar.
create or replace function public.ai_reviews_facts(
  p_store_id   uuid,
  p_product_id uuid default null,
  p_review_id  uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_now     timestamptz := now();
  v_org     uuid;
  v_company uuid;
  v_r       public.product_reviews%rowtype;
  v_result  jsonb;
  v_contact text := '(@|https?://|www\.|[0-9][0-9 .-]{6,}[0-9])';
  -- Fase 12: el dato de contacto se MARCA y además se TAPA. El comentario de
  -- arriba prometía no enviarlo, pero el cuerpo viajaba entero al proveedor.
  v_mask    text := '[^[:space:]]*@[^[:space:]]*|https?://[^[:space:]]+|www\.[^[:space:]]+|[0-9][0-9 .-]{6,}[0-9]';
begin
  perform ebim.assert_ai_feature_reader('reviews', 'catalog');
  perform ebim.assert_ai_orders_store(p_store_id);
  v_org := ebim.org_id();
  v_company := ebim.active_company();

  if p_product_id is not null and not exists (
    select 1 from public.store_products sp
     where sp.product_id = p_product_id and sp.store_id = p_store_id
  ) then
    return null;
  end if;

  -- ---- Detalle de UNA reseña (para el borrador de respuesta) ---------------
  if p_review_id is not null then
    select r.* into v_r
      from public.product_reviews r
     where r.id = p_review_id
       and r.store_id = p_store_id
       and r.organization_id = v_org
       and r.company_id = v_company;
    if v_r.id is null then
      return null;
    end if;

    select jsonb_build_object(
      'generated_at', v_now,
      'scope', 'review',
      'thresholds', jsonb_build_object('stale_pending_days', 3, 'negative_max_rating', 2),
      'review', jsonb_build_object(
        'review_id', v_r.id,
        'product_id', v_r.product_id,
        'product_name', left(pr.name, 120),
        'rating', v_r.rating,
        'status', v_r.status,
        'verified_purchase', v_r.verified_purchase,
        'title', left(regexp_replace(coalesce(v_r.title, ''), v_mask, '[contacto]', 'gi'), 120),
        'body', left(regexp_replace(v_r.body, v_mask, '[contacto]', 'gi'), 1500),
        'age_days', floor(extract(epoch from (v_now - v_r.created_at)) / 86400)::int,
        'flags', to_jsonb(array_remove(array[
          case when v_r.rating <= 2 then 'low_rating' end,
          case when v_r.status = 'pending' and v_r.created_at < v_now - interval '3 days' then 'pending_stale' end,
          case when (coalesce(v_r.title, '') || ' ' || v_r.body) ~* v_contact then 'contact_like' end,
          case when v_r.rating <= 2 and not v_r.verified_purchase then 'unverified_negative' end
        ], null))
      ),
      'product', (
        select jsonb_build_object(
                 'published_count', count(*)::int,
                 'published_average', case when count(*) = 0 then null
                                           else to_char(round(avg(x.rating)::numeric, 2), 'FM0.00') end)
          from public.product_reviews x
         where x.product_id = v_r.product_id and x.store_id = p_store_id and x.status = 'published')
    ) into v_result
    from public.products pr
    where pr.id = v_r.product_id;

    return v_result;
  end if;

  -- ---- Conjunto: tienda (o un producto) en la ventana ----------------------
  with base as (
    select r.*,
           (coalesce(r.title, '') || ' ' || r.body) ~* v_contact as contact_like
      from public.product_reviews r
     where r.store_id = p_store_id
       and r.organization_id = v_org
       and r.company_id = v_company
       and r.created_at >= v_now - interval '180 days'
       and (p_product_id is null or r.product_id = p_product_id)
  ),
  muestra as (
    select b.*
      from base b
     order by b.created_at desc, b.id desc
     limit 40
  ),
  por_producto as (
    select b.product_id,
           left(pr.name, 120) as name,
           count(*)::int as reviews,
           count(*) filter (where b.rating <= 2)::int as negative,
           count(*) filter (where b.status = 'pending')::int as pending,
           to_char(round(avg(b.rating)::numeric, 2), 'FM0.00') as average
      from base b
      join public.products pr on pr.id = b.product_id
     group by b.product_id, pr.name
     order by 4 desc, 3 desc, 2
     limit 10
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'scope', case when p_product_id is null then 'store' else 'product' end,
    'thresholds', jsonb_build_object(
      'window_days', 180, 'stale_pending_days', 3, 'negative_max_rating', 2,
      'sample', 40, 'products', 10),
    'summary', (
      select jsonb_build_object(
        'total', count(*)::int,
        'pending', count(*) filter (where b.status = 'pending')::int,
        'published', count(*) filter (where b.status = 'published')::int,
        'rejected', count(*) filter (where b.status = 'rejected')::int,
        'pending_stale', count(*) filter (where b.status = 'pending'
                                            and b.created_at < v_now - interval '3 days')::int,
        'positive', count(*) filter (where b.rating >= 4)::int,
        'neutral', count(*) filter (where b.rating = 3)::int,
        'negative', count(*) filter (where b.rating <= 2)::int,
        'verified', count(*) filter (where b.verified_purchase)::int,
        'unverified_negative', count(*) filter (where b.rating <= 2 and not b.verified_purchase)::int,
        'contact_like', count(*) filter (where b.contact_like)::int,
        'average', case when count(*) = 0 then null
                        else to_char(round(avg(b.rating)::numeric, 2), 'FM0.00') end,
        'published_average', case when count(*) filter (where b.status = 'published') = 0 then null
                                  else to_char(round((avg(b.rating) filter (where b.status = 'published'))::numeric, 2), 'FM0.00') end,
        'distribution', jsonb_build_object(
          '1', count(*) filter (where b.rating = 1),
          '2', count(*) filter (where b.rating = 2),
          '3', count(*) filter (where b.rating = 3),
          '4', count(*) filter (where b.rating = 4),
          '5', count(*) filter (where b.rating = 5)))
        from base b),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', p.product_id, 'name', p.name, 'reviews', p.reviews,
               'negative', p.negative, 'pending', p.pending, 'average', p.average))
        from por_producto p), '[]'::jsonb),
    -- Muestra: SIN autor (ni id ni nombre para mostrar), sin motivo de rechazo.
    'sample', coalesce((
      select jsonb_agg(jsonb_build_object(
               'review_id', m.id,
               'product_id', m.product_id,
               'product_name', left(pr.name, 120),
               'rating', m.rating,
               'status', m.status,
               'verified_purchase', m.verified_purchase,
               'title', left(regexp_replace(coalesce(m.title, ''), v_mask, '[contacto]', 'gi'), 120),
               'body', left(regexp_replace(m.body, v_mask, '[contacto]', 'gi'), 600),
               'age_days', floor(extract(epoch from (v_now - m.created_at)) / 86400)::int,
               'flags', to_jsonb(array_remove(array[
                 case when m.rating <= 2 then 'low_rating' end,
                 case when m.status = 'pending' and m.created_at < v_now - interval '3 days' then 'pending_stale' end,
                 case when m.contact_like then 'contact_like' end,
                 case when m.rating <= 2 and not m.verified_purchase then 'unverified_negative' end
               ], null)))
             order by m.created_at desc, m.id desc)
        from muestra m
        join public.products pr on pr.id = m.product_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

revoke execute on function public.ai_reviews_facts(uuid, uuid, uuid) from public, anon;
grant  execute on function public.ai_reviews_facts(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.ai_reviews_facts(uuid, uuid, uuid) is
  'IA de resenas (fase 09): resumen agregado (conteos por estado y por tono segun estrellas, media, reparto), productos con mas negativas, muestra de las 40 mas recientes (180 d) con marcas por regla, o el detalle de UNA resena. Sin autor, correo ni motivo de rechazo. Security invoker, solo lectura; roles de reviews + modulo catalog.';
