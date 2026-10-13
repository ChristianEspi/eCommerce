-- ===========================================================================
-- La ficha completa: destacados, cuotas, especificaciones, stock por tienda y
-- entrega (2026-10-13)
--
-- La lámina de la ficha universal pide bloques que la base ya sabía pero la
-- vitrina no podía leer, y dos que no existían:
--
--   · NUEVO `products.highlights`: 0..6 frases cortas que van bajo la galería
--     («Elimina el 99.9 % de bacterias»). Son del MAESTRO: valen en toda tienda
--     que lo publique.
--   · NUEVO `store_settings.installments`: «o 3 cuotas de S/ 7.30 sin
--     intereses con Tarjeta Andes». El comercio declara cuántas cuotas, con qué
--     medio y desde qué importe; la vitrina solo divide. NULL = no se anuncia.
--   · `product_detail_for_slug`: lo que la ficha necesita y `anon` no puede
--     leer de las tablas —SKU, especificaciones (atributos que no son eje de
--     variante), destacados, disponibilidad en las tiendas físicas y el resumen
--     de entrega—, de UN producto publicado.
--
-- ## Lo que NO sale
--
-- La disponibilidad por tienda va como ESTADO (`available` / `low` / `out`) y
-- nunca como cantidad: el inventario por local es información comercial que la
-- competencia no tiene por qué leer en la vitrina (decisión del operador,
-- 2026-10-13). «Últimas unidades» es 1..5 unidades prometibles.
--
-- Del envío salen plazos y el umbral de gratuidad más bajo; ni tarifas ni
-- zonas: el precio real lo calcula la cotización con la dirección.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 · Destacados del producto
-- ---------------------------------------------------------------------------
create or replace function ebim.highlights_valid(p_value text[])
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(cardinality(p_value), 0) <= 6
     and not exists (
       select 1 from unnest(p_value) h(txt)
       where h.txt is null or char_length(btrim(h.txt)) not between 1 and 120
     );
$fn$;

alter table public.products
  add column if not exists highlights text[] not null default '{}';

alter table public.products drop constraint if exists products_highlights_check;
alter table public.products
  add constraint products_highlights_check check (ebim.highlights_valid(highlights));

comment on column public.products.highlights is
  'Hasta 6 frases cortas (1..120) que la ficha pinta bajo la galería. Del maestro: valen en toda tienda que lo publique.';

-- ---------------------------------------------------------------------------
-- 2 · Cuotas que anuncia la tienda
-- ---------------------------------------------------------------------------
create or replace function ebim.installments_valid(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_value is null or coalesce((
    jsonb_typeof(p_value) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(p_value) k
      where k not in ('count', 'provider', 'min_amount')
    )
    and jsonb_typeof(p_value -> 'count') = 'number'
    and (p_value ->> 'count') ~ '^[0-9]+$'
    and (p_value ->> 'count')::int between 2 and 36
    and (
      not (p_value ? 'provider')
      or (jsonb_typeof(p_value -> 'provider') = 'string'
          and char_length(btrim(p_value ->> 'provider')) between 1 and 60)
    )
    and (
      not (p_value ? 'min_amount')
      or (jsonb_typeof(p_value -> 'min_amount') = 'number'
          and (p_value ->> 'min_amount')::numeric between 0 and 1000000)
    )
  ), false);
$fn$;

alter table public.store_settings
  add column if not exists installments jsonb;

alter table public.store_settings drop constraint if exists store_settings_installments_check;
alter table public.store_settings
  add constraint store_settings_installments_check check (ebim.installments_valid(installments));

comment on column public.store_settings.installments is
  'Cuotas sin intereses que anuncia la ficha: {count 2..36, provider?, min_amount?}. NULL = no se anuncian.';

grant select (installments) on public.store_settings to anon, authenticated;
grant update (installments) on public.store_settings to authenticated;

-- La vista pública, con la columna AL FINAL (copia fiel de 20261004100000).
create or replace view public.public_stores
with (security_invoker = on) as
select
  s.id            as store_id,
  s.slug,
  s.name,
  s.currency,
  s.domain,
  ss.accent_color,
  ss.logo_url,
  ss.favicon_url,
  ss.white_label,
  ss.default_locale,
  ss.support_email,
  ss.banner_url,
  ss.hero_title,
  ss.hero_subtitle,
  ss.contact_phone,
  ss.contact_address,
  ss.font_family,
  ss.ui_radius,
  ss.ui_density,
  ss.business_display_name,
  coalesce(ss.checkout_requires_account, false) as checkout_requires_account,
  coalesce(ss.theme_preset, 'universal')                            as theme_preset,
  coalesce(ss.storefront_style, '{}'::jsonb)                        as storefront_style,
  coalesce(ss.home_layout, '{"version": 1, "sections": []}'::jsonb) as home_layout,
  coalesce(ss.value_props, '[]'::jsonb)                             as value_props,
  ss.store_description,
  ss.hero_kicker,
  coalesce(ss.brand_lockup, 'logo_name')                            as brand_lockup,
  coalesce(ss.show_theme_toggle, false)                             as show_theme_toggle,
  coalesce(ss.announcement_messages, '[]'::jsonb)                   as announcement_messages,
  -- 2026-10-02 · ayuda y datos legales
  ss.legal_name,
  ss.tax_id,
  ss.whatsapp_phone,
  ss.help_note,
  ss.business_hours,
  coalesce(ss.social_links, '[]'::jsonb)                            as social_links,
  ebim.store_default_country(s.id)                                  as default_country,
  -- 2026-10-02 · indicador de carga propio
  ss.loader_url,
  coalesce(ss.loader_animation, 'spin')                             as loader_animation,
  -- 2026-10-04 · videos del carrusel de la portada
  coalesce(ss.home_videos, '[]'::jsonb)                             as home_videos,
  -- 2026-10-13 · cuotas que anuncia la ficha
  ss.installments
from public.stores s
left join public.store_settings ss on ss.store_id = s.id
where s.status = 'active';

comment on view public.public_stores is
  'Lo publicable de una tienda activa: identidad, contacto, tema, propuestas de valor, identidad V3, ayuda y datos legales, pais por defecto, indicador de carga, videos de la portada y cuotas. security_invoker: las policies siguen mandando.';

-- ---------------------------------------------------------------------------
-- 3 · El detalle de la ficha
-- ---------------------------------------------------------------------------
create or replace function public.product_detail_for_slug(
  p_store_slug text,
  p_product_id uuid,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store   public.stores%rowtype;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_scoped  boolean;
begin
  v_store := ebim.active_store_by_slug(p_store_slug);

  if p_product_id is null then
    return null;
  end if;

  -- AUTORIZACIÓN: solo un producto publicado en ESTA tienda activa. Uno en
  -- borrador, de otra tienda o inexistente responde igual (NULL): distinguirlos
  -- contaría qué tiene el comercio en preparación.
  select p.* into v_product
  from public.products p
  join public.store_products sp on sp.product_id = p.id and sp.store_id = v_store.id
  where p.id = p_product_id
    and sp.status = 'published'
    and sp.published_at is not null
    and sp.published_at <= now();

  if not found then
    return null;
  end if;

  -- La variante, solo si es DE ese producto y está activa.
  if p_variant_id is not null then
    select * into v_variant
    from public.product_variants v
    where v.id = p_variant_id and v.product_id = v_product.id and v.is_active;
  end if;

  -- Almacenes de la tienda: los declarados o, sin declarar, todos los activos
  -- de la sociedad (misma regla que el ATP, 20260827200000).
  select exists (
    select 1 from public.store_warehouses sw where sw.store_id = v_store.id and sw.is_active
  ) into v_scoped;

  return jsonb_build_object(
    'sku', coalesce(v_variant.sku, v_product.sku),
    'highlights', to_jsonb(coalesce(v_product.highlights, '{}'::text[])),
    'specs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label', a.name,
               'type', a.data_type::text,
               'value', case
                 when pav.value_id is not null then av.label
                 when pav.value_text is not null then btrim(pav.value_text)
                 when pav.value_number is not null then
                   trim(trailing '.' from trim(trailing '0' from pav.value_number::text))
                   || coalesce(' ' || a.unit, '')
                 when pav.value_boolean is not null then pav.value_boolean::text
                 else pav.value_date::text
               end)
             order by a.position, a.name)
      from public.product_attribute_values pav
      join public.attributes a on a.id = pav.attribute_id
      left join public.attribute_values av on av.id = pav.value_id
      where pav.product_id = v_product.id
        and a.is_active
        and not a.is_variant_axis
        and a.organization_id = v_product.organization_id
        and a.company_id = v_product.company_id
    ), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', w.name,
               'city', w.city,
               'status', case
                 when q.qty <= 0 then 'out'
                 when q.qty <= 5 then 'low'
                 else 'available'
               end)
             order by w.priority, w.name)
      from public.warehouses w
      cross join lateral (
        select coalesce(sum(greatest(l.available_qty - l.safety_stock, 0)), 0) as qty
        from public.inventory_levels l
        where l.warehouse_id = w.id
          and l.product_id = v_product.id
          and (v_variant.id is null or l.variant_id = v_variant.id)
      ) q
      -- Un kit no tiene existencia propia (sale de sus componentes): no se
      -- inventa un estado por tienda que nadie lleva.
      where v_product.kind <> 'bundle'
        and w.kind = 'store'
        and w.is_active
        and w.organization_id = v_store.organization_id
        and w.company_id = v_store.company_id
        and (not v_scoped or exists (
          select 1 from public.store_warehouses sw
          where sw.store_id = v_store.id and sw.warehouse_id = w.id and sw.is_active))
    ), '[]'::jsonb),
    'delivery', jsonb_build_object(
      'ship', (
        select jsonb_build_object(
                 'min_days', min(m.lead_time_min_days),
                 'max_days', min(m.lead_time_max_days),
                 'free_over', (
                   select min(r.free_over_subtotal)
                   from public.delivery_rates r
                   join public.delivery_methods m2 on m2.id = r.delivery_method_id
                   where m2.store_id = v_store.id
                     and m2.is_active
                     and m2.strategy in ('ship', 'local_delivery')
                     and r.is_active
                     and r.free_over_subtotal is not null))
        from public.delivery_methods m
        where m.store_id = v_store.id
          and m.is_active
          and m.strategy in ('ship', 'local_delivery')
        having count(*) > 0
      ),
      'pickup', (
        select jsonb_build_object(
                 'min_days', min(m.lead_time_min_days),
                 'points', (
                   select count(*) from public.pickup_points pp
                   where pp.store_id = v_store.id and pp.is_active))
        from public.delivery_methods m
        where m.store_id = v_store.id
          and m.is_active
          and m.strategy = 'pickup'
        having count(*) > 0
      )
    )
  );
end;
$fn$;

revoke execute on function public.product_detail_for_slug(text, uuid, uuid) from public;
-- `anon` SÍ: es la ficha pública. Lo que devuelve ya está acotado arriba.
grant execute on function public.product_detail_for_slug(text, uuid, uuid)
  to anon, authenticated, service_role;

comment on function public.product_detail_for_slug(text, uuid, uuid) is
  'Vitrina: SKU, destacados, especificaciones, disponibilidad por tienda física (estado, nunca cantidad) y resumen de entrega de UN producto publicado en la tienda activa del slug. NULL si no se ve.';
