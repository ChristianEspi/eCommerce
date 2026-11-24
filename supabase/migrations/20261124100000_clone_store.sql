-- =============================================================================
-- Crear una tienda a partir de otra (2026-11-24)
--
-- ## El problema
--
-- Una tienda nueva nace con lo mínimo (canal, cinco medios de pago, cinco
-- métodos de entrega, motivos de devolución y ajustes de fábrica) y SIN nada de
-- la tienda que ya funciona: diseño, categorías, publicaciones con precio,
-- pagos y entregas reales, abastecimiento, portada, correos. Una cadena que
-- abre su segunda o tercera tienda rehacía todo a mano.
--
-- ## La regla
--
-- `public.clone_store(origen, slug, nombre, secciones[])` crea la tienda con el
-- alta de siempre (`create_store`, que dispara las siembras) y COPIA de la
-- tienda de origen las secciones pedidas. Copia CONFIGURACIÓN, nunca operación:
-- ni pedidos, ni carritos, ni stock, ni clientes, ni reseñas.
--
--   design             store_settings (sin dominio propio ni su verificación)
--   categories         árbol de categorías (ids nuevos, padres re-mapeados)
--   catalog            publicaciones (store_products) y precios por tienda
--   payments_delivery  medios de pago, métodos, zonas, tarifas y horarios
--   supply             qué almacenes abastecen la tienda
--   content            páginas y bloques de la portada (CMS)
--   emails             textos de correo por tienda
--   synonyms           sinónimos de búsqueda
--
-- ## Lo que NO se copia, a propósito
--
--  · Moneda distinta: la tienda nueva nace con la MONEDA DE ORIGEN, porque los
--    precios copiados están en ella.
--  · Dominio propio: es único y se verifica por tienda.
--  · Secretos de pago (Culqi): no se duplica un secreto. El medio se copia sin
--    él y, si lo necesitaba, nace INACTIVO hasta que el comercio lo cargue.
--  · Puntos de recojo: son direcciones físicas de cada local. Los horarios
--    atados a un punto de recojo tampoco se copian.
--  · Promociones, cupones, listas de precio, surtidos: son decisiones
--    comerciales de cada tienda. Un bloque de portada que apuntaba a una
--    promoción o a un canal de la otra tienda se copia sin ese enlace.
--
-- SECURITY DEFINER con autorización explícita: `assert_store_manager` sobre la
-- sociedad de la SESIÓN, y la tienda de origen tiene que ser de esa sociedad.
-- La tienda nueva nace en BORRADOR, como cualquier alta.
-- =============================================================================

create or replace function ebim.clone_store_sections()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array['design', 'categories', 'catalog', 'payments_delivery', 'supply', 'content', 'emails', 'synonyms']::text[];
$fn$;

revoke execute on function ebim.clone_store_sections() from public, anon;
grant  execute on function ebim.clone_store_sections() to authenticated, service_role;

create or replace function public.clone_store(
  p_source_store_id uuid,
  p_slug            text,
  p_name            text,
  p_sections        text[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org      uuid := ebim.org_id();
  v_company  uuid := ebim.active_company();
  v_src      public.stores%rowtype;
  v_summary  jsonb;
  v_new      uuid;
  v_sections text[] := coalesce(p_sections, ebim.clone_store_sections());
  v_counts   jsonb := '{}'::jsonb;
  v_n        integer;
begin
  perform ebim.assert_store_manager(v_org, v_company);

  select * into v_src from public.stores s where s.id = p_source_store_id;
  -- La de otra sociedad responde igual que la que no existe.
  if v_src.id is null or v_src.organization_id <> v_org or v_src.company_id <> v_company then
    raise exception 'TIENDA_NO_ENCONTRADA: no hay ninguna tienda con ese id' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_sections) s where not (s = any (ebim.clone_store_sections()))) then
    raise exception 'SECCION_INVALIDA: secciones admitidas: %', array_to_string(ebim.clone_store_sections(), ', ')
      using errcode = '22023';
  end if;

  -- El alta de siempre: valida nombre, slug y cuenta activa, y dispara las
  -- siembras (canal por defecto, pagos y entregas, motivos de devolución).
  v_summary := public.create_store(p_slug, p_name, v_src.currency::text, null);
  v_new := (v_summary ->> 'id')::uuid;
  if v_new is null then
    raise exception 'ALTA_FALLIDA: no se pudo crear la tienda' using errcode = 'P0001';
  end if;

  -- Ids viejos → nuevos, para re-mapear referencias entre secciones.
  create temporary table if not exists pg_temp.clone_map (kind text, old_id uuid, new_id uuid) on commit drop;
  delete from pg_temp.clone_map;

  -- ---- design ------------------------------------------------------------
  if 'design' = any (v_sections) then
    update public.store_settings d set
      accent_color = s.accent_color, logo_url = s.logo_url, favicon_url = s.favicon_url,
      white_label = s.white_label, default_locale = s.default_locale, support_email = s.support_email,
      tax_rate = s.tax_rate, config = s.config, banner_url = s.banner_url, hero_title = s.hero_title,
      hero_subtitle = s.hero_subtitle, contact_phone = s.contact_phone, contact_address = s.contact_address,
      tax_category_id = s.tax_category_id, tax_inclusive = s.tax_inclusive, font_family = s.font_family,
      ui_radius = s.ui_radius, ui_density = s.ui_density, business_display_name = s.business_display_name,
      email_from_name = s.email_from_name, email_reply_to = s.email_reply_to,
      checkout_requires_account = s.checkout_requires_account,
      require_payment_before_dispatch = s.require_payment_before_dispatch,
      theme_preset = s.theme_preset, storefront_style = s.storefront_style, home_layout = s.home_layout,
      cart_recovery_enabled = s.cart_recovery_enabled, cart_recovery_delay_hours = s.cart_recovery_delay_hours,
      cart_recovery_max_age_days = s.cart_recovery_max_age_days, value_props = s.value_props,
      store_description = s.store_description, hero_kicker = s.hero_kicker, brand_lockup = s.brand_lockup,
      show_theme_toggle = s.show_theme_toggle, announcement_messages = s.announcement_messages,
      legal_name = s.legal_name, tax_id = s.tax_id, whatsapp_phone = s.whatsapp_phone, help_note = s.help_note,
      business_hours = s.business_hours, social_links = s.social_links, loader_url = s.loader_url,
      loader_animation = s.loader_animation, home_videos = s.home_videos, installments = s.installments
    from public.store_settings s
    where s.store_id = v_src.id and d.store_id = v_new;
    v_counts := v_counts || jsonb_build_object('design', 1);
  end if;

  -- ---- categories (padres antes que hijos: se insertan todas y luego se
  -- re-enlazan, así el orden de inserción no importa) -----------------------
  if 'categories' = any (v_sections) then
    insert into pg_temp.clone_map (kind, old_id, new_id)
    select 'category', c.id, gen_random_uuid() from public.categories c where c.store_id = v_src.id;

    insert into public.categories (id, organization_id, company_id, store_id, parent_id, slug, name, position,
                                   is_active, image_url, image_alt)
    select m.new_id, v_org, v_company, v_new, null, c.slug, c.name, c.position, c.is_active, c.image_url, c.image_alt
      from public.categories c join pg_temp.clone_map m on m.kind = 'category' and m.old_id = c.id
     where c.store_id = v_src.id;
    get diagnostics v_n = row_count;

    update public.categories n set parent_id = mp.new_id
      from public.categories c
      join pg_temp.clone_map mc on mc.kind = 'category' and mc.old_id = c.id
      join pg_temp.clone_map mp on mp.kind = 'category' and mp.old_id = c.parent_id
     where c.store_id = v_src.id and n.id = mc.new_id;
    v_counts := v_counts || jsonb_build_object('categories', v_n);
  end if;

  -- ---- catalog -------------------------------------------------------------
  if 'catalog' = any (v_sections) then
    insert into public.store_products (organization_id, company_id, store_id, product_id, category_id, slug,
                                       status, published_at, price, compare_at_price, currency)
    select v_org, v_company, v_new, sp.product_id,
           (select m.new_id from pg_temp.clone_map m where m.kind = 'category' and m.old_id = sp.category_id),
           sp.slug, sp.status, sp.published_at, sp.price, sp.compare_at_price, sp.currency
      from public.store_products sp
     where sp.store_id = v_src.id
    on conflict do nothing;
    get diagnostics v_n = row_count;

    insert into public.store_price_overrides (organization_id, company_id, store_id, product_id, variant_id,
                                              uom_id, price, compare_at_price)
    select v_org, v_company, v_new, o.product_id, o.variant_id, o.uom_id, o.price, o.compare_at_price
      from public.store_price_overrides o
     where o.store_id = v_src.id
    on conflict do nothing;
    v_counts := v_counts || jsonb_build_object('catalog', v_n);
  end if;

  -- ---- payments_delivery (reemplaza lo sembrado por el alta) --------------
  if 'payments_delivery' = any (v_sections) then
    delete from public.delivery_rates   where store_id = v_new;
    delete from public.delivery_windows where store_id = v_new;
    delete from public.delivery_methods where store_id = v_new;
    delete from public.delivery_zones   where store_id = v_new;
    delete from public.payment_methods  where store_id = v_new;

    insert into public.payment_methods (organization_id, company_id, store_id, code, kind, display_name,
                                        provider_code, provider_kind, capture_mode, is_active, position,
                                        public_config, instructions, checkout_public_key, accepts_yape,
                                        has_secret, secret_hint, secret_set_at)
    -- El secreto NO viaja: el medio que lo necesitaba nace inactivo.
    select v_org, v_company, v_new, p.code, p.kind, p.display_name, p.provider_code, p.provider_kind,
           p.capture_mode, p.is_active and not p.has_secret, p.position, p.public_config, p.instructions,
           p.checkout_public_key, p.accepts_yape, false, null, null
      from public.payment_methods p where p.store_id = v_src.id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('payment_methods', v_n);

    insert into pg_temp.clone_map (kind, old_id, new_id)
    select 'zone', z.id, gen_random_uuid() from public.delivery_zones z where z.store_id = v_src.id;
    insert into public.delivery_zones (id, organization_id, company_id, store_id, code, name, country, regions,
                                       postal_prefixes, priority, is_active)
    select m.new_id, v_org, v_company, v_new, z.code, z.name, z.country, z.regions, z.postal_prefixes,
           z.priority, z.is_active
      from public.delivery_zones z join pg_temp.clone_map m on m.kind = 'zone' and m.old_id = z.id;

    insert into pg_temp.clone_map (kind, old_id, new_id)
    select 'method', dm.id, gen_random_uuid() from public.delivery_methods dm where dm.store_id = v_src.id;
    insert into public.delivery_methods (id, organization_id, company_id, store_id, code, strategy, display_name,
                                         description, provider_code, provider_kind, sourcing, lead_time_min_days,
                                         lead_time_max_days, requires_window, is_active, position, public_config,
                                         instructions)
    select m.new_id, v_org, v_company, v_new, dm.code, dm.strategy, dm.display_name, dm.description,
           dm.provider_code, dm.provider_kind, dm.sourcing, dm.lead_time_min_days, dm.lead_time_max_days,
           -- Un recojo sin punto de recojo no se puede elegir: nace inactivo.
           dm.requires_window, dm.is_active and dm.strategy::text <> 'pickup', dm.position, dm.public_config,
           dm.instructions
      from public.delivery_methods dm join pg_temp.clone_map m on m.kind = 'method' and m.old_id = dm.id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('delivery_methods', v_n);

    insert into public.delivery_rates (organization_id, company_id, store_id, delivery_method_id, zone_id, currency,
                                       base_amount, per_item_amount, per_weight_amount, free_over_subtotal,
                                       min_subtotal, max_subtotal, min_weight, max_weight, priority, is_active)
    select v_org, v_company, v_new, mm.new_id, mz.new_id, r.currency, r.base_amount, r.per_item_amount,
           r.per_weight_amount, r.free_over_subtotal, r.min_subtotal, r.max_subtotal, r.min_weight, r.max_weight,
           r.priority, r.is_active
      from public.delivery_rates r
      join pg_temp.clone_map mm on mm.kind = 'method' and mm.old_id = r.delivery_method_id
      left join pg_temp.clone_map mz on mz.kind = 'zone' and mz.old_id = r.zone_id
     where r.store_id = v_src.id and (r.zone_id is null or mz.new_id is not null);

    insert into public.delivery_windows (organization_id, company_id, store_id, delivery_method_id, pickup_point_id,
                                         weekday, starts_at, ends_at, capacity, cutoff_minutes, is_active)
    select v_org, v_company, v_new, mm.new_id, null, w.weekday, w.starts_at, w.ends_at, w.capacity,
           w.cutoff_minutes, w.is_active
      from public.delivery_windows w
      join pg_temp.clone_map mm on mm.kind = 'method' and mm.old_id = w.delivery_method_id
     where w.store_id = v_src.id and w.pickup_point_id is null;
  end if;

  -- ---- supply ----------------------------------------------------------------
  if 'supply' = any (v_sections) then
    insert into public.store_warehouses (organization_id, company_id, store_id, warehouse_id, priority, is_active)
    select v_org, v_company, v_new, sw.warehouse_id, sw.priority, sw.is_active
      from public.store_warehouses sw where sw.store_id = v_src.id
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('supply', v_n);
  end if;

  -- ---- content -----------------------------------------------------------------
  if 'content' = any (v_sections) then
    insert into pg_temp.clone_map (kind, old_id, new_id)
    select 'page', p.id, gen_random_uuid() from public.content_pages p where p.store_id = v_src.id;
    insert into public.content_pages (id, organization_id, company_id, store_id, slug, title, kind, status,
                                      channel_id, priority, publish_from, publish_to, show_in_nav, nav_position,
                                      seo_title, seo_description, og_image_url)
    select m.new_id, v_org, v_company, v_new, p.slug, p.title, p.kind, p.status, null, p.priority,
           p.publish_from, p.publish_to, p.show_in_nav, p.nav_position, p.seo_title, p.seo_description, p.og_image_url
      from public.content_pages p join pg_temp.clone_map m on m.kind = 'page' and m.old_id = p.id;
    get diagnostics v_n = row_count;

    insert into pg_temp.clone_map (kind, old_id, new_id)
    select 'block', b.id, gen_random_uuid() from public.content_blocks b where b.store_id = v_src.id;
    insert into public.content_blocks (id, organization_id, company_id, store_id, page_id, block_type, position,
                                       title, subtitle, body, media_url, media_alt, cta_label, cta_href,
                                       promotion_id, category_id, item_limit, is_active, publish_from, publish_to,
                                       channel_id, segment_id, settings)
    select mb.new_id, v_org, v_company, v_new,
           (select mp.new_id from pg_temp.clone_map mp where mp.kind = 'page' and mp.old_id = b.page_id),
           b.block_type, b.position, b.title, b.subtitle, b.body, b.media_url, b.media_alt, b.cta_label, b.cta_href,
           null,
           (select mc.new_id from pg_temp.clone_map mc where mc.kind = 'category' and mc.old_id = b.category_id),
           b.item_limit, b.is_active, b.publish_from, b.publish_to, null, b.segment_id, b.settings
      from public.content_blocks b join pg_temp.clone_map mb on mb.kind = 'block' and mb.old_id = b.id
     -- Un bloque de una página que no se copió no tiene dónde vivir.
     where b.page_id is null or exists (select 1 from pg_temp.clone_map mp where mp.kind = 'page' and mp.old_id = b.page_id);

    insert into public.content_block_items (organization_id, company_id, store_id, block_id, block_type, item_kind,
                                            product_id, variant_id, category_id, position, media_url, media_alt, href)
    select v_org, v_company, v_new, mb.new_id, i.block_type, i.item_kind, i.product_id, i.variant_id,
           (select mc.new_id from pg_temp.clone_map mc where mc.kind = 'category' and mc.old_id = i.category_id),
           i.position, i.media_url, i.media_alt, i.href
      from public.content_block_items i
      join pg_temp.clone_map mb on mb.kind = 'block' and mb.old_id = i.block_id
     where i.store_id = v_src.id
       -- Un ítem de categoría sin su categoría copiada se queda fuera.
       and (i.category_id is null or exists (select 1 from pg_temp.clone_map mc where mc.kind = 'category' and mc.old_id = i.category_id));
    v_counts := v_counts || jsonb_build_object('content', v_n);
  end if;

  -- ---- emails ----------------------------------------------------------------
  if 'emails' = any (v_sections) then
    insert into public.email_templates (store_id, organization_id, company_id, kind, locale, subject, title, body, updated_by)
    select v_new, v_org, v_company, e.kind, e.locale, e.subject, e.title, e.body, ebim.user_id()
      from public.email_templates e where e.store_id = v_src.id
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('emails', v_n);
  end if;

  -- ---- synonyms --------------------------------------------------------------
  if 'synonyms' = any (v_sections) then
    insert into public.search_synonyms (organization_id, company_id, store_id, term, expansions, is_active)
    select v_org, v_company, v_new, s.term, s.expansions, s.is_active
      from public.search_synonyms s where s.store_id = v_src.id
    on conflict do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('synonyms', v_n);
  end if;

  perform ebim.audit(
    p_organization_id => v_org,
    p_company_id      => v_company,
    p_action          => 'store.cloned',
    p_entity_type     => 'store',
    p_entity_id       => v_new,
    p_entity_label    => left(btrim(p_name), 120),
    p_store_id        => v_new,
    p_metadata        => jsonb_build_object('source_store_id', v_src.id, 'sections', to_jsonb(v_sections), 'counts', v_counts));

  return v_summary || jsonb_build_object('cloned_from', v_src.id, 'counts', v_counts);
end;
$fn$;

revoke execute on function public.clone_store(uuid, text, text, text[]) from public, anon;
grant  execute on function public.clone_store(uuid, text, text, text[]) to authenticated;

comment on function public.clone_store(uuid, text, text, text[]) is
  'Crea una tienda (borrador) y copia de otra de la misma sociedad las secciones pedidas: diseño, categorías, catálogo, pagos y entregas (sin secretos), abastecimiento, portada, correos y sinónimos. Nunca operación.';
